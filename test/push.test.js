// End-to-end Web Push test: the server encrypts and sends to a local fake push service, which decrypts with the
// subscriber's private key and verifies the VAPID signature – the same bytes a browser push service would receive.
'use strict';
const test = require('node:test'), assert = require('node:assert'), crypto = require('crypto'), http = require('http'), { spawn } = require('child_process'), path = require('path');
const P = require('../server/push.js');
test('RFC 8291 vector, round trip and VAPID', () => { const r = P.selfTest(P.generateVapidKeys(), 'mailto:t@example.invalid'); assert.deepStrictEqual(r, { rfc8291: true, roundTrip: true, vapidSignature: true }); });
test('alert dispatch → encrypted Web Push → decrypted payload; receipts; SSE', async () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = P.b64u(crypto.randomBytes(16)); const got = [];
  const fake = http.createServer((req, res) => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => { got.push({ headers: req.headers, payload: JSON.parse(P.decrypt(Buffer.concat(ch), P.b64u(ua.getPrivateKey()), auth)) }); res.writeHead(201); res.end(); }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r)); const fport = fake.address().port, port = 8700 + Math.floor(Math.random() * 200);
  const srv = spawn(process.execPath, [path.join(__dirname, '../server/server.js')], { env: Object.assign({}, process.env, { PORT: String(port), MARSA_DB: '/tmp/marsa-push-test-' + port + '.db', MARSA_PUSH_ALLOW_LOCAL: '1' }), stdio: 'ignore' });
  try {
    await new Promise(r => setTimeout(r, 1200));
    const j = async (p, b, t) => { const r = await fetch('http://127.0.0.1:' + port + p, { method: b ? 'POST' : 'GET', headers: Object.assign({ 'content-type': 'application/json' }, t ? { authorization: 'Bearer ' + t } : {}), body: b ? JSON.stringify(b) : undefined }); return r.json(); };
    const cfg = await j('/api/push/config'); const off = await j('/api/demo-login', { userId: 'OFFICER' });
    const s0 = await j('/api/snapshot', null, off.token); const vid = s0.vessels.find(v => v.channel === 'bridge' && v.inTerritorialSea).id; const rk = s0.maritimeRisks.slice().sort((a, b) => b.end - a.end)[0];
    const al = (await j('/api/rpc/createAlert', { riskId: rk.id, targets: [vid], severity: 'critical', title: { ar: 'اختبار', en: 'Test' }, body: { ar: 'نص', en: 'Body' }, instructions: { ar: 'تعليمات', en: 'Instr' } }, off.token)).result; assert.ok(al && al.id, 'alert created');
    assert.ok((await j('/api/rpc/submitAlert', { id: al.id }, off.token)).result);
    const br = await j('/api/demo-login', { userId: 'B-' + vid });
    const reg = await j('/api/push/subscribe', { subscription: { endpoint: 'http://127.0.0.1:' + fport + '/push/abc', keys: { p256dh: P.b64u(ua.getPublicKey()), auth } }, name: 'Phone', deviceType: 'mobile', browser: 'Chrome' }, br.token);
    assert.strictEqual(reg.device.status, 'active');
    for (const m of ['approveAlert', 'prepareDispatch', 'dispatchAlert']) { const r = await j('/api/rpc/' + m, m === 'approveAlert' ? { id: al.id, disclaimer: true } : { id: al.id }, off.token); assert.ok(r.result, m + ' ' + JSON.stringify(r)); }
    for (let i = 0; i < 30 && !got.length; i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(got.length >= 1, 'push received'); const g = got[0];
    assert.match(g.headers.authorization, /^vapid t=.+, k=/); assert.ok(P.verifyVapidJwt(g.headers.authorization, cfg.publicKey));
    assert.strictEqual(g.headers['content-encoding'], 'aes128gcm'); assert.strictEqual(g.headers.urgency, 'high');
    assert.strictEqual(g.payload.url, '/?v=' + vid + '&alert=' + al.id); assert.ok(g.payload.title.includes('MARSA')); assert.ok(g.payload.body.includes(al.number));
    await new Promise(r => setTimeout(r, 300));
    let snap = await j('/api/snapshot', null, off.token); let log = snap.pushLog.find(l => l.alertId === al.id);
    assert.strictEqual(log.status, 'accepted'); assert.strictEqual(log.httpStatus, 201); assert.ok(!log.shownAt, 'not claimed shown before receipt');
    assert.ok((await j('/api/push/receipt', { pid: g.payload.pid, ev: 'shown' })).ok);
    snap = await j('/api/snapshot', null, off.token); log = snap.pushLog.find(l => l.alertId === al.id); assert.ok(log.shownAt);
    assert.ok(snap.auditLogs.some(a => a.action === 'push.accepted') && snap.auditLogs.some(a => a.action === 'device.register') && snap.auditLogs.some(a => a.action === 'push.shown'));
    const bs = await j('/api/snapshot', null, br.token); assert.ok(bs.devices.every(d => d.vesselId === vid)); assert.ok(!JSON.stringify(bs.devices).includes('p256dh'));
    const other = await j('/api/demo-login', { userId: 'B-' + snap.vessels.find(v => v.id !== vid).id });
    assert.strictEqual((await j('/api/push/test', { id: reg.device.id }, other.token)).error, 'NOT_FOUND');
    // expired subscription is marked
    fake.removeAllListeners('request'); fake.on('request', (q, s) => { q.resume(); q.on('end', () => { s.writeHead(410); s.end(); }); });
    const t = await j('/api/push/test', { id: reg.device.id }, br.token); assert.strictEqual(t.result, 'expired');
    snap = await j('/api/snapshot', null, off.token); assert.strictEqual(snap.devices.find(d => d.id === reg.device.id).status, 'expired');
  } finally { srv.kill(); fake.close(); }
});
