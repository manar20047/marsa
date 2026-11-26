/* MARSA v4 server — zero-dependency Node.js (>= 22.13). Run: node server/server.js  → http://localhost:8080
 * TEST DATA environment: the database is seeded with structured sample data on first start.
 * Env: PORT, MARSA_DB (sqlite file), MARSA_INTEGRATION_KEY (for the proposed NCM test endpoint), MARSA_DEMO=1|0 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createService } = require('../shared/service.js');
const { SqliteStore } = require('./store-sqlite.js');
const Push = require('./push.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const DB = process.env.MARSA_DB || path.join(ROOT, 'data', 'marsa-v4.db');
const INTEG_KEY = process.env.MARSA_INTEGRATION_KEY || crypto.randomBytes(16).toString('hex');
const DEMO = process.env.MARSA_DEMO !== '0';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const store = new SqliteStore(DB);
const svc = store.tx(() => createService({ store }));

// ---------- VAPID keys (private key stays on the server) ----------
// Priority: MARSA_VAPID_PUBLIC_KEY + MARSA_VAPID_PRIVATE_KEY → derived from MARSA_VAPID_SEED (stable across restarts) → generated and kept in the database.
const VAPID_SUBJECT = process.env.MARSA_VAPID_SUBJECT || 'mailto:marsa-demo@example.invalid';
const VAPID = (() => {
  if (process.env.MARSA_VAPID_PUBLIC_KEY && process.env.MARSA_VAPID_PRIVATE_KEY) return { publicKey: process.env.MARSA_VAPID_PUBLIC_KEY, privateKey: process.env.MARSA_VAPID_PRIVATE_KEY, source: 'env' };
  const seed = process.env.MARSA_VAPID_SEED || (process.env.MARSA_INTEGRATION_KEY ? 'ik:' + process.env.MARSA_INTEGRATION_KEY : '');
  if (seed && seed.length >= 16) return Object.assign(Push.deriveVapidKeys(seed), { source: process.env.MARSA_VAPID_SEED ? 'seed' : 'derived-server-secret' });
  let k = store.get('vapid', 'keys'); if (!k) { k = Object.assign({ id: 'keys' }, Push.generateVapidKeys(), { createdAt: Date.now() }); store.tx(() => store.insert('vapid', k)); }
  return { publicKey: k.publicKey, privateKey: k.privateKey, source: 'database' };
})();
const PUSH_SELFTEST = Push.selfTest(VAPID, VAPID_SUBJECT);

// ---------- Real-time sync (Server-Sent Events) ----------
const streams = new Set(); let extVer = 0;
const curVer = () => ((store.get('meta', 'meta') || {}).version || 0) + ':' + extVer;
let lastVer = null;
setInterval(() => { const v = curVer(); if (v === lastVer) return; lastVer = v; for (const r of streams) r.write('event: change\ndata: ' + JSON.stringify({ v, t: Date.now() }) + '\n\n'); }, 400).unref();
setInterval(() => { for (const r of streams) r.write(': hb ' + Date.now() + '\n\n'); }, 20000).unref();
const bumpExt = () => { extVer++; };

// ---------- Devices and push delivery ----------
const SEVAR = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' };
const pubDevice = d => ({ id: d.id, vesselId: d.vesselId, role: d.role, name: d.name, deviceType: d.deviceType, browser: d.browser, platform: d.platform, standalone: d.standalone, permission: d.permission, status: d.status, endpointHost: d.endpointHost, registeredAt: d.registeredAt, lastRegisteredAt: d.lastRegisteredAt, lastActiveAt: d.lastActiveAt, lastPushAt: d.lastPushAt, lastResult: d.lastResult, registeredBy: d.registeredBy });
const pubLog = l => ({ id: l.id, kind: l.kind, deviceId: l.deviceId, deviceName: l.deviceName, vesselId: l.vesselId, alertId: l.alertId, alertNumber: l.alertNumber, deliveryId: l.deliveryId, critical: l.critical, at: l.at, status: l.status, httpStatus: l.httpStatus, error: l.error, respondedAt: l.respondedAt, shownAt: l.shownAt, clickedAt: l.clickedAt, ackAt: l.ackAt, title: l.title });
function audit(u, action, entity, entityId, ar, en, prev, next) { try { svc.recordEvent(u, { action, entity, entityId, ar, en, prev, next }); } catch (e) { log('audit error', e.message); } }
const SYSU = { username: 'marsa-push', role: 'system' };
async function pushTo(dev, payload, meta) {
  const pid = crypto.randomBytes(12).toString('hex');
  const row = Object.assign({ id: 'PL-' + pid.slice(0, 10), pid, deviceId: dev.id, deviceName: dev.name, vesselId: dev.vesselId, at: Date.now(), status: 'sending', title: payload.title }, meta);
  store.tx(() => store.insert('pushLog', row)); bumpExt();
  let r; try { r = await Push.send(dev.sub, Object.assign({ pid }, payload), VAPID, VAPID_SUBJECT, { urgency: meta.critical ? 'high' : 'normal', ttl: meta.critical ? 6 * 3600 : 86400, topic: meta.topic }); } catch (e) { r = { ok: false, status: 0, error: e.message }; }
  const status = r.ok ? 'accepted' : r.expired ? 'expired' : 'failed';
  store.tx(() => {
    store.update('pushLog', row.id, { status, httpStatus: r.status, error: r.ok ? null : (r.error || r.body || null), respondedAt: Date.now() });
    store.update('devices', dev.id, Object.assign({ lastPushAt: Date.now(), lastResult: status + (r.status ? ' ' + r.status : '') }, r.expired ? { status: 'expired' } : {}));
    if (meta.deliveryId && store.get('deliveryRecords', meta.deliveryId)) { const d = store.get('deliveryRecords', meta.deliveryId); store.update('deliveryRecords', d.id, { push: Object.assign({}, d.push, { lastStatus: status, attempts: ((d.push || {}).attempts || 0) + 1, accepted: ((d.push || {}).accepted || 0) + (r.ok ? 1 : 0) }) }); }
    audit(SYSU, r.ok ? 'push.accepted' : r.expired ? 'push.expired' : 'push.failed', 'device', dev.id,
      (r.ok ? 'قبلت خدمة الإشعارات الطلب (' + r.status + ') للجهاز ' : r.expired ? 'اشتراك منتهٍ (' + r.status + ') وأُزيل الجهاز ' : 'فشل إرسال الإشعار (' + (r.status || r.error) + ') للجهاز ') + dev.name + (meta.alertNumber ? ' · ' + meta.alertNumber : ''),
      (r.ok ? 'Push service accepted the request (' + r.status + ') for ' : r.expired ? 'Subscription expired (' + r.status + '), device removed: ' : 'Push failed (' + (r.status || r.error) + ') for ') + dev.name + (meta.alertNumber ? ' · ' + meta.alertNumber : ''), 'sending', status);
  }); bumpExt();
  return Object.assign({ status, logId: row.id }, r);
}
const activeDevices = pred => store.all('devices').filter(d => d.status === 'active' && pred(d));
let pushBusy = false;
function processPushQueue() {
  if (pushBusy) return; pushBusy = true;
  try {
    const jobs = [];
    store.tx(() => {
      for (const d of store.all('deliveryRecords')) {
        if (d.status === 'dispatched' && !d.push) {
          const al = store.get('alerts', d.alertId), v = store.get('vessels', d.vesselId); if (!al || !v) continue;
          const devs = activeDevices(x => x.vesselId === d.vesselId);
          store.update('deliveryRecords', d.id, { push: { queuedAt: Date.now(), devices: devs.length, attempts: 0, accepted: 0, lastStatus: devs.length ? 'sending' : 'no_device' } });
          const crit = ['critical', 'high'].includes(al.severity);
          for (const dev of devs) jobs.push([dev, { title: 'مَرسى | MARSA · إنذار ' + (SEVAR[al.severity] || '') , body: v.name + ': ' + (al.title.ar || al.title.en) + ' — ' + al.number, tag: 'marsa-' + al.id, url: '/?v=' + encodeURIComponent(v.id) + '&alert=' + encodeURIComponent(al.id), severity: al.severity, critical: crit, alertNumber: al.number, vesselName: v.name },
            { kind: 'alert', alertId: al.id, alertNumber: al.number, deliveryId: d.id, critical: crit, topic: al.id }]);
        }
        if (d.status === 'rejected' && !d.pushOfficer) {
          const al = store.get('alerts', d.alertId) || {}, v = store.get('vessels', d.vesselId) || {};
          store.update('deliveryRecords', d.id, { pushOfficer: { at: Date.now() } });
          for (const dev of activeDevices(x => x.role === 'officer')) jobs.push([dev, { title: 'مَرسى | MARSA · رفض توصية', body: (v.name || '') + ' رفضت التوصية — ' + (al.number || '') + (d.rejectReason ? ': ' + d.rejectReason : ''), tag: 'marsa-rej-' + d.id, url: '/?officer=1&alert=' + encodeURIComponent(al.id || ''), severity: 'high', critical: true, alertNumber: al.number }, { kind: 'officer', alertId: al.id, alertNumber: al.number, critical: true }]);
        }
      }
    });
    if (jobs.length) bumpExt();
    for (const [dev, p, m] of jobs) pushTo(dev, p, m).catch(e => log('push error', e.message));
  } finally { pushBusy = false; }
}

// ---------- Sessions (the two interfaces are opened without passwords in this test environment) ----------
const sessions = new Map(); // token -> { userId, exp }
const TTL = 12 * 3600e3;
const userFor = (req, qtoken) => { const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '') || (qtoken && /^(\w+)$/.exec(qtoken)); const s = m && sessions.get(m[1]); if (!s || s.exp < Date.now()) return null; return store.get('users', s.userId); };
setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k); }, 600e3).unref();

const RPC = new Set(['verifyAudit', 'resetTestData', 'updateRules', 'upsertVessel', 'deleteVessel', 'updatePort', 'editWeather', 'importWeather', 'addRisk', 'deleteRisk',
  'createAlert', 'editAlert', 'submitAlert', 'approveAlert', 'prepareDispatch', 'dispatchAlert', 'cancelAlert', 'proposeRoute', 'markReceived', 'acknowledge',
  'createBulletin', 'editBulletin', 'submitBulletin', 'approveBulletin', 'issueBulletin', 'readyBulletin', 'sendBulletin', 'confirmBulletinRecipient', 'recordOfficialIssue', 'markBulletinRead', 'chooseRecommendation', 'simulateEnterTerritorialWaters', 'runAllocation', 'approveAllocation', 'modifyAllocation', 'recalculate', 'runScenario', 'cancelBulletin', 'saveNavtex', 'exportNavtex', 'dispatchNavtexTest', 'marineForecast']);
const rate = new Map();
const limited = (req, max) => { const ip = req.socket.remoteAddress, now = Date.now(), r = rate.get(ip) || { n: 0, t: now }; if (now - r.t > 60e3) { r.n = 0; r.t = now; } r.n++; rate.set(ip, r); return r.n > max; };
setInterval(() => { const now = Date.now(); for (const [k, r] of rate) if (now - r.t > 120e3) rate.delete(k); }, 60e3).unref();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const MIME2 = { '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'geolocation=(), camera=(), microphone=()', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'" };
if (process.env.RENDER || process.env.MARSA_HTTPS === '1') SEC['strict-transport-security'] = 'max-age=31536000';
const send = (res, code, obj) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, SEC)); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, bad) => { let n = 0, b = ''; req.on('data', c => { n += c.length; if (n > 1e6) { bad(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); } else b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(new Error('BAD_JSON')); } }); });
const keyOk = req => { const k = String(req.headers['x-integration-key'] || ''); return k.length === INTEG_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(INTEG_KEY)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (p === '/api/health' || p === '/healthz') { const m = store.get('meta', 'meta') || {}; return send(res, 200, { ok: true, environment: 'TEST_DATA', datasetAt: m.datasetAt || null, time: Date.now(), auditEntries: store.all('auditLogs').length }); }
    if (p.startsWith('/api/') && limited(req, 900)) return send(res, 429, { error: 'RATE_LIMITED' });
    if (p === '/api/bridges') { if (!DEMO) return send(res, 403, { error: 'FORBIDDEN' }); return send(res, 200, { vessels: store.all('users').filter(u => u.role === 'bridge').map(u => { const v = store.get('vessels', u.vesselId); return v && { userId: u.id, id: v.id, name: v.name, mmsi: v.mmsi, type: v.type, status: v.status, destId: v.destId, channel: v.channel, inTerritorialSea: v.inTerritorialSea }; }).filter(Boolean).sort((a, b) => (b.inTerritorialSea ? 1 : 0) - (a.inTerritorialSea ? 1 : 0)) }); }
    if (p === '/api/demo-login' && req.method === 'POST') {
      if (!DEMO) return send(res, 403, { error: 'FORBIDDEN' }); if (limited(req, 200)) return send(res, 429, { error: 'RATE_LIMITED' });
      const b = await body(req), u = store.get('users', String(b.userId || ''));
      if (!u || !['officer', 'bridge'].includes(u.role)) return send(res, 400, { error: 'INVALID:user' });
      const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { userId: u.id, exp: Date.now() + TTL });
      store.tx(() => svc.recordLogin(u)); return send(res, 200, { token, snapshot: withPush(u, svc.snapshot(u)) });
    }
    if (p === '/api/logout' && req.method === 'POST') { const m = /^Bearer (\w+)$/.exec(req.headers.authorization || ''); if (m) sessions.delete(m[1]); return send(res, 200, { ok: true }); }
    if (p === '/api/events') { // real-time stream; EventSource cannot send headers, so the session token comes as a query value
      const u = userFor(req, url.searchParams.get('token')); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' });
      res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' }, SEC));
      res.write('retry: 3000\nevent: change\ndata: ' + JSON.stringify({ v: curVer(), t: Date.now() }) + '\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return;
    }
    if (p === '/api/push/config') return send(res, 200, { publicKey: VAPID.publicKey, keySource: VAPID.source, subject: VAPID_SUBJECT.replace(/^mailto:.*@/, 'mailto:…@'), selfTest: PUSH_SELFTEST, https: !!(req.headers['x-forwarded-proto'] === 'https' || process.env.RENDER), serverTime: Date.now() });
    if (p === '/api/push/receipt' && req.method === 'POST') { // posted by the service worker: notification shown / clicked (no session in the worker; the random pid is the capability)
      if (limited(req, 300)) return send(res, 429, { error: 'RATE_LIMITED' });
      const b = await body(req), pid = String(b.pid || ''), ev = String(b.ev || ''); const row = /^[a-f0-9]{24}$/.test(pid) && store.all('pushLog').find(x => x.pid === pid);
      if (!row || !['shown', 'clicked', 'closed'].includes(ev)) return send(res, 404, { error: 'NOT_FOUND' });
      const k = ev + 'At'; if (!row[k]) store.tx(() => { store.update('pushLog', row.id, { [k]: Date.now() }); if (store.get('devices', row.deviceId)) store.update('devices', row.deviceId, { lastActiveAt: Date.now() });
        if (ev !== 'closed') audit(SYSU, 'push.' + ev, 'device', row.deviceId, (ev === 'shown' ? 'أبلغ الجهاز بعرض الإشعار: ' : 'ضغط المستخدم على الإشعار: ') + row.deviceName + (row.alertNumber ? ' · ' + row.alertNumber : ''), (ev === 'shown' ? 'Device reported the notification shown: ' : 'User tapped the notification: ') + row.deviceName + (row.alertNumber ? ' · ' + row.alertNumber : ''), null, ev); });
      bumpExt(); return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/push/') && req.method === 'POST') {
      const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' });
      const b = await body(req), act = p.slice(10);
      if (act === 'subscribe') {
        const sub = b.subscription || {}, keys = sub.keys || {};
        if (!Push.validEndpoint(String(sub.endpoint || ''))) return send(res, 400, { error: 'INVALID:endpoint' });
        if (!/^[A-Za-z0-9_-]{80,100}$/.test(String(keys.p256dh || '')) || !/^[A-Za-z0-9_-]{16,32}$/.test(String(keys.auth || ''))) return send(res, 400, { error: 'INVALID:keys' });
        let vesselId = null, role = 'bridge';
        if (u.role === 'bridge') vesselId = u.vesselId; else if (b.vesselId) { if (!store.get('vessels', String(b.vesselId))) return send(res, 400, { error: 'INVALID:vessel' }); vesselId = String(b.vesselId); } else role = 'officer';
        const id = 'DEV-' + crypto.createHash('sha256').update(String(sub.endpoint)).digest('hex').slice(0, 10).toUpperCase(), t = Date.now(), cl = x => String(x || '').replace(/[<>]/g, '').slice(0, 60);
        const ex = store.get('devices', id), v = vesselId && store.get('vessels', vesselId);
        const doc = { id, vesselId, role, name: cl(b.name) || (cl(b.deviceType) + ' · ' + cl(b.browser)), deviceType: cl(b.deviceType), browser: cl(b.browser), platform: cl(b.platform), standalone: !!b.standalone, permission: cl(b.permission) || 'granted', status: 'active', endpointHost: new URL(sub.endpoint).hostname,
          sub: { endpoint: String(sub.endpoint), keys: { p256dh: keys.p256dh, auth: keys.auth } }, registeredAt: ex ? ex.registeredAt : t, lastRegisteredAt: t, lastActiveAt: t, lastPushAt: ex ? ex.lastPushAt : null, lastResult: ex ? ex.lastResult : null, registeredBy: u.username };
        const changed = !ex || ex.vesselId !== vesselId || ex.status !== 'active' || ex.sub.endpoint !== doc.sub.endpoint;
        store.tx(() => { if (ex) store.update('devices', id, doc); else store.insert('devices', doc);
          if (changed) audit(u, 'device.register', 'device', id, 'تسجيل جهاز استقبال: ' + doc.name + (v ? ' ← السفينة ' + v.name : ' ← ضابط الميناء'), 'Receiving device registered: ' + doc.name + (v ? ' → vessel ' + v.name : ' → Port Officer'), ex ? ex.status : null, 'active'); });
        bumpExt(); return send(res, 200, { ok: true, device: pubDevice(store.get('devices', id)) });
      }
      const dev = store.get('devices', String(b.id || ''));
      const own = dev && (u.role === 'officer' || (dev.vesselId && dev.vesselId === u.vesselId));
      if (act === 'unsubscribe') {
        if (!own) return send(res, 404, { error: 'NOT_FOUND' });
        store.tx(() => { store.remove('devices', dev.id); audit(u, 'device.remove', 'device', dev.id, 'إزالة جهاز الاستقبال: ' + dev.name, 'Receiving device removed: ' + dev.name, dev.status, 'removed'); }); bumpExt(); return send(res, 200, { ok: true });
      }
      if (act === 'test') {
        if (!own) return send(res, 404, { error: 'NOT_FOUND' }); if (dev.status !== 'active') return send(res, 400, { error: 'INVALID:device_inactive' });
        const crit = !!b.critical, v = dev.vesselId && store.get('vessels', dev.vesselId);
        const r = await pushTo(dev, { title: 'مَرسى | MARSA · ' + (crit ? 'اختبار إنذار حرج' : 'إشعار اختبار'), body: (v ? v.name + ': ' : '') + (crit ? 'هذا اختبار لإنذار حرج من مركز اختبار الإشعارات' : 'هذا إشعار اختبار من مَرسى') + ' — ' + new Date().toISOString().slice(11, 16) + ' UTC', tag: 'marsa-test-' + Date.now(), url: dev.vesselId ? '/?v=' + encodeURIComponent(dev.vesselId) + '&page=settings' : '/?officer=1&page=pushtest', severity: crit ? 'critical' : 'low', critical: crit, test: true },
          { kind: crit ? 'test_critical' : 'test', critical: crit });
        return send(res, 200, { ok: r.ok, status: r.status, result: r.status === 0 ? 'network_error' : r.status && r.ok ? 'accepted' : r.expired ? 'expired' : 'failed', error: r.ok ? null : (r.error || r.body || null), logId: r.logId });
      }
      return send(res, 404, { error: 'UNKNOWN_METHOD' });
    }
    if (p === '/api/snapshot') { const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' }); return send(res, 200, withPush(u, svc.snapshot(u))); }
    if (p.startsWith('/api/rpc/') && req.method === 'POST') {
      const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' });
      const m = p.slice(9); if (!RPC.has(m)) return send(res, 404, { error: 'UNKNOWN_METHOD' });
      const args = await body(req);
      const result = store.tx(() => svc[m](u, args)); processPushQueue(); return send(res, 200, { result });
    }
    // Proposed Integration – NCM: test endpoint receiving weather records in the unified data model (X-Integration-Key).
    if (p === '/api/integrations/ncm/weather' && req.method === 'POST') { if (!keyOk(req)) return send(res, 401, { error: 'BAD_KEY' }); const b = await body(req); return send(res, 200, store.tx(() => svc.ingestWeather(b))); }
    if (p === '/api/openapi.json') return send(res, 200, OPENAPI);
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace('<head>', '<head><script>window.MARSA_SERVER=true</script>');
      res.writeHead(200, Object.assign({ 'content-type': MIME['.html'], 'cache-control': 'no-store' }, SEC)); return res.end(html);
    }
    if (p === '/sw.js') { res.writeHead(200, Object.assign({ 'content-type': MIME['.js'], 'cache-control': 'no-cache', 'service-worker-allowed': '/' }, SEC)); return fs.createReadStream(path.join(ROOT, 'web/sw.js')).pipe(res); }
    if (p === '/manifest.webmanifest' || /^\/icons\/[\w.-]+\.(png|svg)$/.test(p)) {
      const f = path.join(ROOT, 'web', p === '/manifest.webmanifest' ? 'manifest.webmanifest' : p.slice(1)); if (!fs.existsSync(f)) return send(res, 404, { error: 'NOT_FOUND' });
      res.writeHead(200, Object.assign({ 'content-type': MIME2[path.extname(f)], 'cache-control': 'public, max-age=86400' }, SEC)); return fs.createReadStream(f).pipe(res);
    }
    if (/^\/(web|shared)\/[\w.-]+\.(js|css)$/.test(p)) {
      const f = path.join(ROOT, p); if (!fs.existsSync(f)) return send(res, 404, { error: 'NOT_FOUND' });
      res.writeHead(200, Object.assign({ 'content-type': MIME[path.extname(f)], 'cache-control': 'no-cache' }, SEC)); return fs.createReadStream(f).pipe(res);
    }
    send(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : /NOT_FOUND/.test(e.message) ? 404 : 400;
    send(res, code, { error: e.message });
  }
});

const OPENAPI = { openapi: '3.0.0', info: { title: 'MARSA API (test data environment)', version: '4.0' }, paths: {
  '/api/demo-login': { post: { summary: 'Open the Port Officer (userId "OFFICER") or a Ship Bridge (userId "B-<vesselId>") interface → bearer token' } },
  '/api/snapshot': { get: { summary: 'Role-filtered state snapshot' } },
  '/api/rpc/{method}': { post: { summary: 'Operations (permission-checked, written to the audit log): ' + [...RPC].join(', ') } },
  '/api/integrations/ncm/weather': { post: { summary: 'Proposed Integration (test only). X-Integration-Key. Body: { source, records:[{ areaId, recordedAt ISO, reliability 0–1, observation:{ windKn, windDir, gustKn, waveM, waveDir, currentKn, currentDir, visNm, tempC }, forecast:[{ h:0–48, ...same fields }] }] }. Invalid records are rejected with reasons; missing critical fields (windKn, waveM) reject the record.' } },
  '/healthz': { get: { summary: 'Liveness' } } } };

function withPush(u, snap) {
  const devs = store.all('devices').filter(d => u.role === 'officer' || d.vesselId === u.vesselId), ids = new Set(devs.map(d => d.id));
  snap.devices = devs.map(pubDevice); snap.pushLog = store.all('pushLog').filter(l => u.role === 'officer' || ids.has(l.deviceId) || l.vesselId === u.vesselId).slice(-200).map(l => { const o = pubLog(l), d = l.deliveryId && store.get('deliveryRecords', l.deliveryId); if (d) { o.ackAt = d.ackAt || null; o.deliveryStatus = d.status; o.action = d.action || null; } return o; });
  snap.push = { publicKey: VAPID.publicKey, keySource: VAPID.source, selfTest: PUSH_SELFTEST, sseClients: u.role === 'officer' ? streams.size : undefined };
  return snap;
}
setInterval(() => { try { store.tx(() => svc.tick()); processPushQueue(); } catch (e) { log('tick error', e); } }, 1000);
server.listen(PORT, '0.0.0.0', () => {
  log('MARSA v4 (TEST DATA ENVIRONMENT) listening on http://localhost:' + PORT, '| db', DB);
  log('integration key for the proposed NCM test endpoint:', process.env.MARSA_INTEGRATION_KEY ? '(from env)' : INTEG_KEY);
});
