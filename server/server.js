/* MARSA server — zero-dependency Node.js (>= 22.5). Run: node server/server.js  → http://localhost:8080
 * Env: PORT, MARSA_DB (sqlite file), MARSA_MET_SOURCE=sim|openmeteo, MARSA_INTEGRATION_KEY, MARSA_SECRET_KEY (64 hex), MARSA_DEMO=1|0 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createService, SimulatedNcmAdapter } = require('../shared/service.js');
const { SqliteStore } = require('./store-sqlite.js');
const { OpenMeteoFeed, NullNcm } = require('./adapters/index.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const DB = process.env.MARSA_DB || path.join(ROOT, 'data', 'marsa.db');
const MET = process.env.MARSA_MET_SOURCE || 'sim';
const INTEG_KEY = process.env.MARSA_INTEGRATION_KEY || crypto.randomBytes(16).toString('hex');
const DEMO = process.env.MARSA_DEMO !== '0';
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Service over SQLite ----------
const store = new SqliteStore(DB);
// Credentials for external integrations are sealed with AES-256-GCM before they reach the database.
const KEYFILE = path.join(path.dirname(DB), 'secret.key');
const SECRET = process.env.MARSA_SECRET_KEY ? Buffer.from(process.env.MARSA_SECRET_KEY, 'hex') : (() => { try { return fs.readFileSync(KEYFILE); } catch (e) { const k = crypto.randomBytes(32); fs.mkdirSync(path.dirname(KEYFILE), { recursive: true }); fs.writeFileSync(KEYFILE, k, { mode: 0o600 }); return k; } })();
const secretBox = {
  seal(txt) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', SECRET, iv); const enc = Buffer.concat([c.update(txt, 'utf8'), c.final()]); return 'gcm$' + iv.toString('hex') + '$' + c.getAuthTag().toString('hex') + '$' + enc.toString('hex'); },
  open(box) { const [, iv, tag, enc] = box.split('$'); const d = crypto.createDecipheriv('aes-256-gcm', SECRET, Buffer.from(iv, 'hex')); d.setAuthTag(Buffer.from(tag, 'hex')); return Buffer.concat([d.update(Buffer.from(enc, 'hex')), d.final()]).toString('utf8'); }
};
const extra = MET === 'openmeteo' ? [{ id: 'open_meteo', name: { ar: 'Open-Meteo (بيانات مفتوحة – ليست المركز الوطني)', en: 'Open-Meteo (open data – not NCM)' }, mode: 'production', endpoint: 'https://api.open-meteo.com', authType: 'none', credentialSet: false, status: 'connected', lastSync: null, records: 0, note: { ar: 'مصدر مفتوح بديل مؤقت لحين توفر واجهة المركز الوطني للأرصاد. بياناته حقيقية لكنها ليست صادرة من المركز.', en: 'Interim open-data source until the NCM interface is available. Real data, but not issued by NCM.' } }] : [];
const svc = store.tx(() => createService({ store, ncm: MET === 'openmeteo' ? NullNcm() : SimulatedNcmAdapter(), extraIntegrations: extra, secretBox }));

// ---------- Passwords (scrypt) ----------
const DEMO_ACCOUNTS = store.all('users').filter(u => u.password).map(u => ({ username: u.username, password: u.password, role: u.role, name: u.name, org: (store.get('organizations', u.orgId) || {}).name }));
const hash = pw => { const salt = crypto.randomBytes(16); return 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 32).toString('hex'); };
const verify = (pw, h) => { if (!h) return false; const [, s, d] = h.split('$'); const got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32); return crypto.timingSafeEqual(got, Buffer.from(d, 'hex')); };
function hashPlaintext() { for (const u of store.all('users')) if (u.password) store.update('users', u.id, { pwHash: hash(u.password), password: null }); }
store.tx(hashPlaintext);

// ---------- Sessions ----------
const sessions = new Map(); // token -> { userId, exp }
const TTL = 12 * 3600e3;
const userFor = req => { const m = /^Bearer (\w+)$/.exec(req.headers.authorization || ''); const s = m && sessions.get(m[1]); if (!s || s.exp < Date.now()) return null; const u = store.get('users', s.userId); return u && u.active ? u : null; };
const loginAttempts = new Map();

// ---------- HTTP ----------
const RPC = new Set(['runScenario', 'resetDemo', 'markRead', 'verifyAudit', 'updatePortOps', 'reportRestriction', 'decideClosure', 'reopenPort', 'createWarning', 'editWarning', 'submitWarning', 'decideLocalWarning', 'cancelWarning', 'reviseWarning', 'authorityDecide',
  'deliveryEvent', 'acknowledge', 'respondRecommendation', 'resendDelivery', 'recordManualAck', 'decideRoute', 'upsertVessel', 'updateIntegration', 'testIntegration', 'updateSettings', 'createUser', 'setUserActive', 'createOrganization', 'publishPeriodicBulletin', 'truckAction', 'createNotice', 'createPeriodicNotice', 'editNotice', 'markNoticeReady', 'routeNotice', 'recordOfficialIssue', 'cancelNotice', 'setAutoRoute']);
// simple fixed-window rate limit per client address
const rate = new Map();
const limited = (req, max) => { const ip = req.socket.remoteAddress, now = Date.now(), r = rate.get(ip) || { n: 0, t: now }; if (now - r.t > 60e3) { r.n = 0; r.t = now; } r.n++; rate.set(ip, r); return r.n > max; };
setInterval(() => { const now = Date.now(); for (const [k, r] of rate) if (now - r.t > 120e3) rate.delete(k); }, 60e3).unref();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'" };
const send = (res, code, obj) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, SEC)); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, bad) => { let n = 0, b = ''; req.on('data', c => { n += c.length; if (n > 1e6) { bad(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); } else b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(new Error('BAD_JSON')); } }); });
const keyOk = req => { const k = req.headers['x-integration-key'] || ''; return k.length === INTEG_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(INTEG_KEY)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (p === '/api/health' || p === '/healthz') { const m = store.get('meta', 'meta') || {}; return send(res, 200, { ok: true, db: path.basename(DB), met: MET, time: Date.now(), lastForecast: m.lastNcm || null, audit: store.all('audit').length }); }
    if (p.startsWith('/api/') && limited(req, 600)) return send(res, 429, { error: 'RATE_LIMITED' });
    if (p === '/api/demo-accounts') return send(res, 200, { accounts: DEMO ? DEMO_ACCOUNTS : [] });
    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress, a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
      if (Date.now() - a.t > 60e3) { a.n = 0; a.t = Date.now(); }
      if (++a.n > 10) { loginAttempts.set(ip, a); return send(res, 429, { error: 'TOO_MANY_ATTEMPTS' }); }
      loginAttempts.set(ip, a);
      const { username, password } = await body(req);
      const u = store.all('users').find(x => x.username === username && x.active);
      if (!u || !verify(String(password || ''), u.pwHash)) return send(res, 401, { error: 'BAD_LOGIN' });
      const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { userId: u.id, exp: Date.now() + TTL });
      store.tx(() => svc.recordLogin(u));
      return send(res, 200, { token, snapshot: svc.snapshot(u) });
    }
    // Demo entry for the two interfaces (Port Officer, Ship Bridge). Disabled with MARSA_DEMO=0.
    if (p === '/api/bridges') { if (!DEMO) return send(res, 403, { error: 'FORBIDDEN' }); return send(res, 200, { vessels: store.all('users').filter(u => u.bridge && u.active).map(u => { const v = store.get('vessels', u.vesselId); return v && { userId: u.id, id: v.id, name: v.name, mmsi: v.mmsi, type: v.type, status: v.status, destId: v.destId }; }).filter(Boolean) }); }
    if (p === '/api/demo-login' && req.method === 'POST') {
      if (!DEMO) return send(res, 403, { error: 'FORBIDDEN' }); if (limited(req, 120)) return send(res, 429, { error: 'RATE_LIMITED' });
      const b = await body(req), u = store.get('users', String(b.userId || ''));
      if (!u || !u.active || !(u.id === 'U3' || u.bridge)) return send(res, 400, { error: 'INVALID:user' });
      const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { userId: u.id, exp: Date.now() + TTL });
      store.tx(() => svc.recordLogin(u)); return send(res, 200, { token, snapshot: svc.snapshot(u) });
    }
    if (p === '/api/logout' && req.method === 'POST') { const m = /^Bearer (\w+)$/.exec(req.headers.authorization || ''); if (m) sessions.delete(m[1]); return send(res, 200, { ok: true }); }
    if (p === '/api/snapshot') { const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' }); return send(res, 200, svc.snapshot(u)); }
    if (p.startsWith('/api/rpc/') && req.method === 'POST') {
      const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' });
      const m = p.slice(9); if (!RPC.has(m)) return send(res, 404, { error: 'UNKNOWN_METHOD' });
      if (m === 'resetDemo' && !DEMO) return send(res, 403, { error: 'FORBIDDEN:demo_disabled' });
      const args = await body(req);
      const result = store.tx(() => { const r = svc[m](u, args); hashPlaintext(); return r; });
      return send(res, 200, { result });
    }
    // Integration endpoints (machine-to-machine, protected by X-Integration-Key)
    if (p === '/api/integrations/forecast' && req.method === 'POST') { if (!keyOk(req)) return send(res, 401, { error: 'BAD_KEY' }); const b = await body(req); if (!Array.isArray(b.points)) return send(res, 400, { error: 'INVALID:points' }); return send(res, 200, store.tx(() => svc.ingestForecast(b))); }
    if (p === '/api/integrations/authority-callback' && req.method === 'POST') { if (!keyOk(req)) return send(res, 401, { error: 'BAD_KEY' }); const b = await body(req); return send(res, 200, store.tx(() => svc.authorityCallback(b))); }
    if (p === '/api/backup') { // consistent online copy of the database, administrators only
      const u = userFor(req); if (!u || u.role !== 'admin') return send(res, 403, { error: 'FORBIDDEN' });
      const tmp = path.join(require('os').tmpdir(), 'marsa-backup-' + Date.now() + '.db'); store.db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'");
      res.writeHead(200, Object.assign({ 'content-type': 'application/vnd.sqlite3', 'content-disposition': 'attachment; filename="marsa-' + new Date().toISOString().slice(0, 10) + '.db"' }, SEC));
      return fs.createReadStream(tmp).on('close', () => fs.unlink(tmp, () => {})).pipe(res);
    }
    if (p === '/api/openapi.json') return send(res, 200, OPENAPI);
    // Static
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace('<head>', '<head><script>window.MARSA_SERVER=true</script>');
      res.writeHead(200, Object.assign({ 'content-type': MIME['.html'] }, SEC)); return res.end(html);
    }
    if (/^\/(web|shared)\/[\w.-]+\.(js|css)$/.test(p)) {
      const f = path.join(ROOT, p); res.writeHead(200, Object.assign({ 'content-type': MIME[path.extname(f)] }, SEC)); return fs.createReadStream(f).pipe(res);
    }
    send(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    const code = e.code === 'FORBIDDEN' ? 403 : /NOT_FOUND/.test(e.message) ? 404 : 400;
    send(res, code, { error: e.message });
  }
});

const OPENAPI = { openapi: '3.0.0', info: { title: 'MARSA API', version: '2.0' }, paths: {
  '/api/login': { post: { summary: 'Authenticate → bearer token' } }, '/api/snapshot': { get: { summary: 'Role-filtered state snapshot' } },
  '/api/rpc/{method}': { post: { summary: 'Business operations (permission-checked, audited): ' + [...RPC].join(', ') } },
  '/api/integrations/forecast': { post: { summary: 'Push hourly forecasts (X-Integration-Key). Body: { issuedAt, provider:{ar,en}, simulated, integrationId, points:[{ id:"P:JED"|"A:<area>", kind:"port"|"area", portId?, areaId?, name:{ar,en}, p:[lon,lat], series:[{ h, t, windKn, gustKn, windDir, waveM, waveDir, periodS, visNm, rainMm, warning?, conf }] }] }' } },
  '/api/integrations/authority-callback': { post: { summary: 'Status callback from the competent maritime authority (X-Integration-Key). Body: { warningNumber, status: published|updated|cancelled|rejected, officialRef }' } },
  '/api/backup': { get: { summary: 'Database backup (admin bearer token)' } },
  '/healthz': { get: { summary: 'Liveness and data freshness' } } } };

setInterval(() => { try { store.tx(() => svc.tick()); } catch (e) { log('tick error', e); } }, 1000);
if (MET === 'openmeteo') OpenMeteoFeed(d => store.tx(() => svc.ingestForecast(d)), log).start();
server.listen(PORT, '0.0.0.0', () => {
  log('MARSA listening on http://localhost:' + PORT, '| db', DB, '| met', MET);
  const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  for (const ip of ips) log('>> other devices on the same network open:  http://' + ip + ':' + PORT); log('integration key (X-Integration-Key):', process.env.MARSA_INTEGRATION_KEY ? '(from env)' : INTEG_KEY); });
