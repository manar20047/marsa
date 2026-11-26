/* MARSA v4 server — zero-dependency Node.js (>= 22.13). Run: node server/server.js  → http://localhost:8080
 * TEST DATA environment: the database is seeded with structured sample data on first start.
 * Env: PORT, MARSA_DB (sqlite file), MARSA_INTEGRATION_KEY (for the proposed NCM test endpoint), MARSA_DEMO=1|0 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createService } = require('../shared/service.js');
const { SqliteStore } = require('./store-sqlite.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const DB = process.env.MARSA_DB || path.join(ROOT, 'data', 'marsa-v4.db');
const INTEG_KEY = process.env.MARSA_INTEGRATION_KEY || crypto.randomBytes(16).toString('hex');
const DEMO = process.env.MARSA_DEMO !== '0';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const store = new SqliteStore(DB);
const svc = store.tx(() => createService({ store }));

// ---------- Sessions (the two interfaces are opened without passwords in this test environment) ----------
const sessions = new Map(); // token -> { userId, exp }
const TTL = 12 * 3600e3;
const userFor = req => { const m = /^Bearer (\w+)$/.exec(req.headers.authorization || ''); const s = m && sessions.get(m[1]); if (!s || s.exp < Date.now()) return null; return store.get('users', s.userId); };
setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k); }, 600e3).unref();

const RPC = new Set(['verifyAudit', 'resetTestData', 'updateRules', 'upsertVessel', 'deleteVessel', 'updatePort', 'editWeather', 'importWeather', 'addRisk', 'deleteRisk',
  'createAlert', 'editAlert', 'submitAlert', 'approveAlert', 'prepareDispatch', 'dispatchAlert', 'cancelAlert', 'proposeRoute', 'markReceived', 'acknowledge',
  'createBulletin', 'editBulletin', 'submitBulletin', 'approveBulletin', 'issueBulletin', 'readyBulletin', 'sendBulletin', 'confirmBulletinRecipient', 'recordOfficialIssue', 'markBulletinRead', 'chooseRecommendation', 'simulateEnterTerritorialWaters', 'runAllocation', 'approveAllocation', 'modifyAllocation', 'recalculate', 'runScenario', 'cancelBulletin', 'saveNavtex', 'exportNavtex', 'dispatchNavtexTest', 'marineForecast']);
const rate = new Map();
const limited = (req, max) => { const ip = req.socket.remoteAddress, now = Date.now(), r = rate.get(ip) || { n: 0, t: now }; if (now - r.t > 60e3) { r.n = 0; r.t = now; } r.n++; rate.set(ip, r); return r.n > max; };
setInterval(() => { const now = Date.now(); for (const [k, r] of rate) if (now - r.t > 120e3) rate.delete(k); }, 60e3).unref();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'" };
const send = (res, code, obj) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, SEC)); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, bad) => { let n = 0, b = ''; req.on('data', c => { n += c.length; if (n > 1e6) { bad(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); } else b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(new Error('BAD_JSON')); } }); });
const keyOk = req => { const k = String(req.headers['x-integration-key'] || ''); return k.length === INTEG_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(INTEG_KEY)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (p === '/api/health' || p === '/healthz') { const m = store.get('meta', 'meta') || {}; return send(res, 200, { ok: true, environment: 'TEST_DATA', datasetAt: m.datasetAt || null, time: Date.now(), auditEntries: store.all('auditLogs').length }); }
    if (p.startsWith('/api/') && limited(req, 900)) return send(res, 429, { error: 'RATE_LIMITED' });
    if (p === '/api/bridges') { if (!DEMO) return send(res, 403, { error: 'FORBIDDEN' }); return send(res, 200, { vessels: store.all('users').filter(u => u.role === 'bridge').map(u => { const v = store.get('vessels', u.vesselId); return v && { userId: u.id, id: v.id, name: v.name, mmsi: v.mmsi, type: v.type, status: v.status, destId: v.destId, channel: v.channel }; }).filter(Boolean) }); }
    if (p === '/api/demo-login' && req.method === 'POST') {
      if (!DEMO) return send(res, 403, { error: 'FORBIDDEN' }); if (limited(req, 200)) return send(res, 429, { error: 'RATE_LIMITED' });
      const b = await body(req), u = store.get('users', String(b.userId || ''));
      if (!u || !['officer', 'bridge'].includes(u.role)) return send(res, 400, { error: 'INVALID:user' });
      const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { userId: u.id, exp: Date.now() + TTL });
      store.tx(() => svc.recordLogin(u)); return send(res, 200, { token, snapshot: svc.snapshot(u) });
    }
    if (p === '/api/logout' && req.method === 'POST') { const m = /^Bearer (\w+)$/.exec(req.headers.authorization || ''); if (m) sessions.delete(m[1]); return send(res, 200, { ok: true }); }
    if (p === '/api/snapshot') { const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' }); return send(res, 200, svc.snapshot(u)); }
    if (p.startsWith('/api/rpc/') && req.method === 'POST') {
      const u = userFor(req); if (!u) return send(res, 401, { error: 'UNAUTHENTICATED' });
      const m = p.slice(9); if (!RPC.has(m)) return send(res, 404, { error: 'UNKNOWN_METHOD' });
      const args = await body(req);
      return send(res, 200, { result: store.tx(() => svc[m](u, args)) });
    }
    // Proposed Integration – NCM: test endpoint receiving weather records in the unified data model (X-Integration-Key).
    if (p === '/api/integrations/ncm/weather' && req.method === 'POST') { if (!keyOk(req)) return send(res, 401, { error: 'BAD_KEY' }); const b = await body(req); return send(res, 200, store.tx(() => svc.ingestWeather(b))); }
    if (p === '/api/openapi.json') return send(res, 200, OPENAPI);
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace('<head>', '<head><script>window.MARSA_SERVER=true</script>');
      res.writeHead(200, Object.assign({ 'content-type': MIME['.html'], 'cache-control': 'no-store' }, SEC)); return res.end(html);
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

setInterval(() => { try { store.tx(() => svc.tick()); } catch (e) { log('tick error', e); } }, 1000);
server.listen(PORT, '0.0.0.0', () => {
  log('MARSA v4 (TEST DATA ENVIRONMENT) listening on http://localhost:' + PORT, '| db', DB);
  log('integration key for the proposed NCM test endpoint:', process.env.MARSA_INTEGRATION_KEY ? '(from env)' : INTEG_KEY);
});
