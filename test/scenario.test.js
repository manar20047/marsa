// Run: npm test   (node --test test/scenario.test.js)
const test = require('node:test'), assert = require('node:assert');
const M = require('../shared/service.js'), C = require('../shared/core.js');
function setup() {
  let T = Date.UTC(2026, 11, 3, 6); const svc = M.createService({ clock: () => T }); const u = id => svc.store.get('users', id);
  return { svc, u, step: (n = 1) => { for (let i = 0; i < n; i++) { T += 1000; svc.tick(); } }, adv: ms => { T += ms; svc.tick(); } };
}
const D = { disclaimer: true };

test('routing avoids hazard: Dammam→Europe goes round the Cape when Bab el-Mandeb is blocked', () => {
  const hz = { id: 'h', poly: [[42.55, 13.75], [43.75, 13.55], [44.35, 12.45], [43.65, 11.95], [42.85, 12.35]] };
  const p = C.shortestPath('DMM_A', 'EUROPE', { hazards: [hz] });
  assert.ok(p.nodes.includes('CPT')); assert.ok(!p.nodes.includes('BAB'));
});

test('warning level classification: local / coastal / international by extent', () => {
  const jed = C.PORTS.find(p => p.id === 'JED').p;
  assert.deepStrictEqual(C.classifyWarningLevel(C.circlePoly(jed, 20, 16)).levels, ['LOCAL']);
  assert.ok(C.classifyWarningLevel(C.circlePoly(jed, 80, 16)).levels.includes('COASTAL'));
  assert.ok(C.classifyWarningLevel([[42.55, 13.75], [43.75, 13.55], [44.35, 12.45], [43.65, 11.95], [42.85, 12.35]]).levels.includes('INTERNATIONAL'));
});

test('baseline: routine weather produces no warnings and no closure recommendation', () => {
  const { svc, u, step } = setup(); step(3);
  const s = svc.snapshot(u('U1'));
  assert.strictEqual(s.warnings.length, 0); assert.strictEqual(s.closureRecs.length, 0);
});

test('Jeddah scenario end-to-end: prediction → local alert → delivery → acknowledgement → alternative routes → notices to ports/Karachi → audit', () => {
  const { svc, u, step, adv } = setup(); const off = u('U3'), cap = u('U7');
  svc.runScenario(off, { id: 'jed_storm' }); step(2);
  let s = svc.snapshot(off);
  const pr = s.predictions.filter(p => p.portId === 'JED');
  assert.ok(pr.some(p => p.category === 'waves' && ['high', 'critical'].includes(p.severity)));
  const vx = s.predictions.filter(p => p.category === 'vessel_exposure');
  assert.ok(vx.some(p => p.vesselId === 'V20' && p.severity === 'critical'), 'vessels expected at risk are listed');
  for (const p of vx) { assert.ok(p.explanation.ar && p.action.en && p.sources.length && p.position); }
  assert.strictEqual(new Set(vx.map(p => p.vesselId)).size, vx.length, 'one exposure per vessel');
  const lw = s.warnings.find(w => w.level === 'LOCAL'); assert.strictEqual(lw.status, 'pending_approval');
  assert.strictEqual(s.deliveries.length, 0, 'nothing is sent before the officer sends it');
  assert.throws(() => svc.decideLocalWarning(off, { id: lw.id, decision: 'approve' }), /disclaimer_required/);
  assert.throws(() => svc.decideLocalWarning(cap, { id: lw.id, decision: 'approve', disclaimer: true }), /FORBIDDEN/);
  svc.decideLocalWarning(off, Object.assign({ id: lw.id, decision: 'approve' }, D)); step(2);
  s = svc.snapshot(off);
  const dl = s.deliveries.filter(d => d.warningId === lw.id); assert.ok(dl.length >= 5);
  assert.ok(dl.every(d => !d.receivedAt && !d.ackAt), 'never marked received just because it was sent');
  assert.ok(dl.some(d => d.status === 'failed' && d.failReason), 'a vessel without an active channel is shown as failed');
  // bridge: delivered → received → acknowledged
  const mine = svc.snapshot(cap).deliveries; assert.strictEqual(mine.length, 1);
  svc.deliveryEvent(cap, { ids: [mine[0].id], event: 'received' });
  assert.throws(() => svc.acknowledge(cap, { id: mine[0].id }), /officer/);
  svc.acknowledge(cap, { id: mine[0].id, officer: 'C/O Ali' });
  // alternative route linked to the MARSA alert reaches the bridge
  const rec = svc.snapshot(cap).recs.find(r => r.vesselId === 'V20'); assert.ok(rec && rec.released && rec.warningId === lw.id);
  assert.ok(rec.options.length >= 1 && rec.current.coords.length >= 2);
  svc.respondRecommendation(cap, { id: rec.id, response: 'reviewed', officer: 'Capt Ahmed' });
  // unreleased (higher-risk) recommendations wait for the officer
  const pend = svc.snapshot(off).recs.filter(r => r.status === 'pending');
  for (const r of pend) assert.ok(!svc.snapshot(u('B-' + r.vesselId)).recs.length);
  // escalation
  adv(6 * 60e3);
  s = svc.snapshot(off);
  assert.ok(s.deliveries.some(d => d.status === 'unacknowledged' && d.escalatedAt));
  // notice from NCM analysis → ports (+ Karachi) → simulated receipt → awaiting official issuance → recorded
  const n = s.navnotices[0]; assert.ok(n && n.status === 'ready');
  assert.throws(() => svc.routeNotice(cap, { id: n.id, disclaimer: true }), /FORBIDDEN/);
  svc.routeNotice(off, { id: n.id, recipients: ['PORT:JED', 'KHI'], disclaimer: true });
  assert.strictEqual(svc.snapshot(off).navnotices[0].status, 'sent');
  for (let i = 0; i < 10; i++) step(1);
  const n2 = svc.snapshot(off).navnotices[0]; assert.strictEqual(n2.status, 'awaiting_official'); assert.ok(n2.recipients.every(r => r.ackAt && r.simulated));
  assert.throws(() => svc.recordOfficialIssue(off, { id: n.id }), /officialRef/);
  svc.recordOfficialIssue(off, { id: n.id, ref: 'NAVAREA IX 0123/26', issuer: 'Karachi' });
  assert.strictEqual(svc.snapshot(off).navnotices[0].status, 'published');
  assert.ok(svc.verifyAudit().ok);
});

test('Bab el-Mandeb: notice scoped international is routed to Karachi, MARSA does not issue it', () => {
  const { svc, u, step } = setup(); const off = u('U3');
  svc.runScenario(off, { id: 'bab' }); step(3);
  const n = svc.snapshot(off).navnotices.find(x => x.scope === 'INTERNATIONAL'); assert.ok(n);
  assert.ok(n.suggested.some(r => r.to === 'KHI'));
  svc.routeNotice(off, { id: n.id, disclaimer: true });
  const n2 = svc.snapshot(off).navnotices.find(x => x.id === n.id); assert.ok(n2.recipients.some(r => r.to === 'KHI' && r.status === 'sent'));
  assert.strictEqual(n2.officialRef, null);
  assert.ok(svc.snapshot(off).recs.length > 0, 'vessels exposed to the hazard get recommendations');
});

test('organisation isolation and protected credentials', () => {
  const { svc, u } = setup();
  const cs = svc.snapshot(u('U6')); assert.ok(cs.vessels.every(v => v.companyId === 'C2'));
  assert.strictEqual(svc.snapshot(u('U7')).vessels.length, 1);
  svc.updateIntegration(u('U1'), { id: 'ncm', credential: 'super-secret-token-1234' });
  const snap = JSON.stringify(svc.snapshot(u('U1'))); assert.ok(!snap.includes('super-secret')); assert.ok(snap.includes('••••1234'));
  assert.throws(() => svc.updateIntegration(u('U2'), { id: 'ncm', mode: 'production' }), /FORBIDDEN/);
  assert.throws(() => svc.updateIntegration(u('U1'), { id: 'ncm', endpoint: 'http://insecure' }), /endpoint_https/);
  assert.strictEqual(svc.testIntegration(u('U1'), { id: 'authority' }).status, 'connected');
  svc.updateIntegration(u('U1'), { id: 'ais', mode: 'production', endpoint: 'https://ais.example.sa/v1' });
  assert.strictEqual(svc.testIntegration(u('U1'), { id: 'ais' }).status, 'not_implemented', 'no fabricated live connection');
});

test('audit chain detects tampering', () => {
  const { svc, u } = setup(); svc.runScenario(u('U2'), { id: 'jed_storm' });
  assert.ok(svc.verifyAudit().ok);
  svc.store.all('audit')[2].summary = { ar: 'x', en: 'x' };
  assert.strictEqual(svc.verifyAudit().ok, false);
});
