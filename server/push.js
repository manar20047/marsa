/* MARSA Web Push – zero-dependency implementation of
 *   RFC 8292 (VAPID, ES256 JWT) and RFC 8291 / RFC 8188 (aes128gcm message encryption)
 * using node:crypto only. The private VAPID key never leaves the server. */
'use strict';
const crypto = require('crypto'), https = require('https'), http = require('http');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'); // P-256 order

function keysFromPrivate(d) { // d: 32-byte Buffer
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 65 bytes uncompressed
  return { publicKey: b64u(pub), privateKey: b64u(d) };
}
function generateVapidKeys() { const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) }; }
// Deterministic key from a server secret (e.g. a Render generated env value) so keys stay stable across restarts.
function deriveVapidKeys(seed) {
  const h = BigInt('0x' + crypto.createHash('sha256').update('marsa-vapid-v1:' + seed).digest('hex'));
  const d = (h % (N - 1n)) + 1n; return keysFromPrivate(Buffer.from(d.toString(16).padStart(64, '0'), 'hex'));
}
function privateKeyObject(vapid) {
  const pub = unb64u(vapid.publicKey);
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}
function vapidHeader(endpoint, vapid, subject, nowSec) {
  const aud = new URL(endpoint).origin, exp = (nowSec || Math.floor(Date.now() / 1000)) + 12 * 3600;
  const data = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64u(JSON.stringify({ aud, exp, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(vapid), dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + data + '.' + b64u(sig) + ', k=' + vapid.publicKey;
}
function verifyVapidJwt(header, publicKey) { // used by the test centre self-check
  const m = /t=([^,]+), k=(\S+)/.exec(header); if (!m) return false; const [h, p, s] = m[1].split('.'); const pub = unb64u(publicKey);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  return crypto.verify('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' }, unb64u(s));
}

// RFC 8291 – optional fixed asPrivate/salt are only used by the test vector.
function encrypt(payload, p256dh, authSecret, fixed = {}) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('BAD_P256DH'); if (auth.length !== 16) throw new Error('BAD_AUTH');
  const as = crypto.createECDH('prime256v1'); if (fixed.asPrivate) as.setPrivateKey(unb64u(fixed.asPrivate)); else as.generateKeys();
  const asPublic = as.getPublicKey(), ecdhSecret = as.computeSecret(uaPublic);
  const prkKey = hmac(auth, ecdhSecret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = fixed.salt ? unb64u(fixed.salt) : crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}
// Decrypt (receiver side) – used only by the self-test to prove the round trip.
function decrypt(body, uaPrivate, authSecret) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ua = crypto.createECDH('prime256v1'); ua.setPrivateKey(unb64u(uaPrivate)); const uaPublic = ua.getPublicKey();
  const prkKey = hmac(unb64u(authSecret), ua.computeSecret(asPublic));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm), cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); return pt.subarray(0, pt.lastIndexOf(2)).toString();
}

// Only the browsers' push services are accepted as endpoints (prevents the server being used to call arbitrary URLs).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/];
function validEndpoint(ep) { try { const u = new URL(ep); if (process.env.MARSA_PUSH_ALLOW_LOCAL === '1' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true; /* automated tests only */ return u.protocol === 'https:' && PUSH_HOSTS.some(r => r.test(u.hostname)) && ep.length < 1024; } catch (e) { return false; } }

function send(sub, payload, vapid, subject, opts = {}) {
  return new Promise(resolve => {
    let body; try { body = encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth); } catch (e) { return resolve({ ok: false, status: 0, error: e.message }); }
    const u = new URL(sub.endpoint);
    const headers = { TTL: String(opts.ttl || 86400), Urgency: opts.urgency || 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': body.length };
    if (opts.topic) headers.Topic = String(opts.topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    try { headers.Authorization = vapidHeader(sub.endpoint, vapid, subject); } catch (e) { return resolve({ ok: false, status: 0, error: 'VAPID: ' + e.message }); }
    let rq; try { rq = (u.protocol === 'http:' ? http : https).request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', timeout: 15000, headers }, res => {
      let t = ''; res.on('data', c => { if (t.length < 500) t += c; }); res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, expired: res.statusCode === 404 || res.statusCode === 410, body: t.slice(0, 300) }));
    }); } catch (e) { return resolve({ ok: false, status: 0, error: e.message }); }
    rq.on('timeout', () => rq.destroy(new Error('TIMEOUT'))); rq.on('error', e => resolve({ ok: false, status: 0, error: e.message })); rq.end(body);
  });
}

function selfTest(vapid, subject) {
  const out = {};
  try { // RFC 8291 §5 test vector
    const v = encrypt('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
    out.rfc8291 = b64u(v) === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  } catch (e) { out.rfc8291 = false; }
  try { const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = b64u(crypto.randomBytes(16)); out.roundTrip = decrypt(encrypt('{"t":"مرسى"}', b64u(ua.getPublicKey()), auth), b64u(ua.getPrivateKey()), auth) === '{"t":"مرسى"}'; } catch (e) { out.roundTrip = false; }
  try { out.vapidSignature = verifyVapidJwt(vapidHeader('https://fcm.googleapis.com/fcm/send/x', vapid, subject), vapid.publicKey); } catch (e) { out.vapidSignature = false; }
  return out;
}

module.exports = { b64u, unb64u, generateVapidKeys, deriveVapidKeys, keysFromPrivate, vapidHeader, verifyVapidJwt, encrypt, decrypt, send, validEndpoint, selfTest };
