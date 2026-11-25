/* MARSA v4 tests — run: node --test test/ */
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { createService, MemoryStore } = require('../shared/service.js');
const H = 3600e3;
const OFF = { id: 'OFFICER', username: 'port.officer', role: 'officer' };
function mk() { let t = Date.UTC(2026, 11, 3, 6, 0, 0); const clock = () => t; const s = createService({ store: new MemoryStore(), clock }); return { s, adv: h => { t += h * H; }, now: () => t }; }
const bridgeOf = (s, vid) => s.store.get('users', 'B-' + vid);

test('test data is present when the system opens', () => {
  const { s } = mk(), sn = s.snapshot(OFF);
  assert.equal(sn.seaAreas.length, 8); assert.equal(sn.vessels.length, 24); assert.equal(sn.ports.length, 7);
  for (const f of sn.weatherForecasts) assert.equal(f.series.length, 49);
  assert.ok(sn.vessels.every(v => /^TEST-/.test(v.imo) && /^999/.test(v.mmsi)), 'test identities only');
  assert.ok(sn.maritimeRisks.some(r => r.source === 'rules') && sn.maritimeRisks.some(r => r.source === 'record'));
  assert.ok(!JSON.stringify(sn).match(/\b(Live|Real-time)\b/), 'no Live/Real-time labels');
});

test('weather values are temporally consistent (no random jumps)', () => {
  const { s } = mk();
  for (const f of s.snapshot(OFF).weatherForecasts) for (let h = 1; h <= 48; h++) {
    assert.ok(Math.abs(f.series[h].windKn - f.series[h - 1].windKn) < 6, 'wind step ' + f.areaId + ' h' + h);
    assert.ok(Math.abs(f.series[h].waveM - f.series[h - 1].waveM) < .8, 'wave step ' + f.areaId + ' h' + h);
  }
});

test('analysis engine: explicit thresholds, explanation, affected vessels', () => {
  const { s } = mk(), sn = s.snapshot(OFF), r = sn.maritimeRisks.find(x => x.areaId === 'JED');
  assert.equal(r.level, 'critical'); assert.equal(r.type, 'high_waves');
  assert.ok(r.indicators.find(i => i.name === 'waveM').threshold.includes('3.5'));
  assert.match(r.explanation.en, /because/); assert.ok(r.durationH > 0 && r.end > r.start);
  const av = sn.affectedVessels.filter(a => a.riskId === r.id && a.relation !== 'crossing');
  assert.equal(r.affectedCount, av.length); assert.ok(av.some(a => a.relation === 'inside') && av.some(a => a.relation === 'entering'));
  assert.ok(av.filter(a => a.relation === 'entering').every(a => a.etaToZone > s.snapshot(OFF).now && a.reason.en));
});

test('editable rules change the result', () => {
  const { s } = mk();
  const before = s.snapshot(OFF).maritimeRisks.filter(r => r.source === 'rules').length;
  s.updateRules(OFF, { minLevel: 'high' });
  const after = s.snapshot(OFF).maritimeRisks.filter(r => r.source === 'rules');
  assert.ok(after.length < before && after.every(r => ['high', 'critical'].includes(r.level)));
  assert.throws(() => s.updateRules(OFF, { waveM: [3, 2, 1, 0] }), /INVALID/);
});

test('full journey: alert → approve → dispatch → ship receives → acknowledges → officer sees status → alt route → audit', () => {
  const { s } = mk();
  let sn = s.snapshot(OFF); const r = sn.maritimeRisks.find(x => x.areaId === 'JED');
  const targets = sn.affectedVessels.filter(a => a.riskId === r.id && a.relation !== 'crossing').map(a => a.vesselId);
  const al = s.createAlert(OFF, { riskId: r.id, targets, priority: 'urgent', title: { ar: 'أمواج عالية', en: 'High waves' }, body: { ar: 'نص', en: 'Text' }, instructions: { ar: 'خفض السرعة', en: 'Reduce speed' } });
  assert.equal(al.status, 'draft'); assert.match(al.number, /^MRS-TA-/);
  s.submitAlert(OFF, { id: al.id });
  assert.throws(() => s.approveAlert(OFF, { id: al.id }), /disclaimer/);
  s.approveAlert(OFF, { id: al.id, disclaimer: true });
  sn = s.snapshot(OFF); assert.equal(sn.alerts[0].status, 'approved');
  const routes = sn.alternativeRoutes.filter(x => x.alertId === al.id); assert.ok(routes.length > 0);
  for (const x of routes) { assert.equal(x.validation, 'unverified'); assert.ok(x.reason.ar && x.validationNote.en.includes('NOT verified')); if (x.alternative) assert.ok(x.alternative.nm >= 0 && x.current.nm > 0); }
  s.prepareDispatch(OFF, { id: al.id }); assert.equal(s.snapshot(OFF).alerts[0].status, 'ready_for_dispatch');
  const d = s.dispatchAlert(OFF, { id: al.id }); assert.ok(d.ok > 0); assert.ok(d.fail >= 1, 'vessel without channel fails');
  assert.equal(s.snapshot(OFF).alerts[0].status, 'dispatched_test');
  const V = id => s.store.get('vessels', id);
  const held = s.snapshot(OFF).deliveryRecords.filter(x => x.alertId === al.id && x.status === 'held_outside_ts');
  assert.ok(held.length > 0 && held.every(x => !V(x.vesselId).inTerritorialSea), 'vessels outside territorial waters are held');
  assert.ok(s.snapshot(OFF).deliveryRecords.filter(x => x.alertId === al.id && x.status === 'dispatched').every(x => V(x.vesselId).inTerritorialSea));
  const vid = targets.find(id => V(id).channel === 'bridge' && V(id).inTerritorialSea && V(id).routeNodes.length), B = bridgeOf(s, vid);
  let bs = s.snapshot(B); assert.equal(bs.alerts.length, 1); assert.equal(bs.deliveryRecords.length, 1); assert.ok(bs.alternativeRoutes.length >= 1);
  assert.ok(!bs.vessels.some(v => v.id !== vid), 'bridge sees only its own vessel');
  s.markReceived(B, { ids: [bs.deliveryRecords[0].id] });
  assert.equal(s.snapshot(OFF).deliveryRecords.find(x => x.vesselId === vid && x.alertId === al.id).status, 'received');
  assert.throws(() => s.acknowledge(B, { id: bs.deliveryRecords[0].id, officer: '' }), /officer/);
  s.acknowledge(B, { id: bs.deliveryRecords[0].id, officer: 'C/O Test' });
  const rec = s.snapshot(OFF).deliveryRecords.find(x => x.vesselId === vid && x.alertId === al.id);
  assert.equal(rec.status, 'acknowledged'); assert.equal(rec.ackBy, 'C/O Test');
  // acknowledge all bridge deliveries → alert acknowledged
  for (const x of s.snapshot(OFF).deliveryRecords.filter(x => x.alertId === al.id && x.status === 'dispatched')) { const b = bridgeOf(s, x.vesselId); if (x.channel === 'test_bridge_screen') s.acknowledge(b, { id: x.id, officer: 'OOW' }); }
  const st = s.snapshot(OFF).alerts[0].status; assert.ok(['received', 'acknowledged', 'dispatched_test'].includes(st));
  const actions = s.snapshot(OFF).auditLogs.map(a => a.action);
  for (const a of ['alert.create', 'alert.submit', 'alert.approve', 'route.propose', 'alert.prepare', 'alert.dispatch', 'alert.received', 'alert.ack']) assert.ok(actions.includes(a), a);
  assert.equal(s.verifyAudit(OFF).ok, true);
  // a held vessel that enters territorial waters receives the alert
  const h = held.find(x => V(x.vesselId).channel === 'bridge'), hv = V(h.vesselId), port = require('../shared/core.js').PORTS.find(p => p.id === 'JED');
  s.upsertVessel(OFF, { id: hv.id, name: hv.name, type: hv.type, lat: port.p[1] + .02, lon: port.p[0] - .08, sog: 6, cog: 90, draft: hv.draft, destId: 'JED', status: 'underway', channel: 'bridge' });
  assert.equal(s.snapshot(OFF).deliveryRecords.find(x => x.id === h.id).status, 'dispatched');
  assert.ok(s.snapshot(OFF).auditLogs.some(a => a.action === 'alert.release'));
});

test('bridge cannot act on other vessels or officer methods', () => {
  const { s } = mk(), B = bridgeOf(s, 'V1');
  assert.throws(() => s.createAlert(B, {}), /FORBIDDEN/);
  assert.throws(() => s.resetTestData(B), /FORBIDDEN/);
});

test('alternative route avoids the risk area and respects test depth constraints', () => {
  const { s } = mk(), C = require('../shared/core.js');
  const sn = s.snapshot(OFF), r = sn.maritimeRisks.find(x => x.areaId === 'JED');
  const row = s.proposeRoute(OFF, { vesselId: 'V13', riskId: r.id });
  assert.ok(row.alternative); const legs = row.alternative.coords;
  if (row.kind === 'reroute') for (let i = 1; i < legs.length; i++) for (const k of sn.constraints) if (C.segmentHitsPoly(legs[i - 1], legs[i], k.poly)) assert.ok(k.kind === 'shallow' && k.minDepthM >= 11 + 1, 'constraint ' + k.id);
  assert.ok(row.checks.length >= 3);
});

test('CRUD on test data: add/edit/delete vessel, edit weather, add risk, edit port, bulletin, reset', () => {
  const { s } = mk();
  const v = s.upsertVessel(OFF, { name: 'Test Added', type: 'general', lat: 22.6, lon: 38.4, sog: 12, cog: 170, draft: 8, destId: 'JZN', status: 'underway' });
  assert.ok(v.routeNodes.length > 0 && v.etaAt); assert.ok(s.store.get('users', 'B-' + v.id));
  s.upsertVessel(OFF, { id: v.id, name: 'Test Edited', type: 'general', lat: 22.6, lon: 38.4, sog: 10, cog: 170, draft: 8, destId: 'JED', status: 'underway' });
  assert.equal(s.store.get('vessels', v.id).name, 'Test Edited');
  assert.throws(() => s.upsertVessel(OFF, { name: 'x2', lat: 0, lon: 0, sog: 1, draft: 5, destId: 'JED' }), /position/);
  s.deleteVessel(OFF, { id: v.id }); assert.equal(s.store.get('vessels', v.id), null);
  s.editWeather(OFF, { areaId: 'YNB', fromH: 0, toH: 10, values: { windKn: 36, waveM: 3.8 } });
  assert.ok(s.snapshot(OFF).maritimeRisks.some(r => r.areaId === 'YNB' && r.level === 'critical'));
  const rk = s.addRisk(OFF, { type: 'navigation_hazard', level: 'high', lat: 20.5, lon: 39.5, radiusNm: 20, startH: 0, durationH: 12, title: { ar: 'خطر', en: 'Hazard' } });
  assert.ok(rk.id); s.deleteRisk(OFF, { id: rk.id });
  s.updatePort(OFF, { id: 'JED', status: 'closed', untilH: 12, restrictions: { ar: 'إغلاق', en: 'Closed' } });
  const pr = s.snapshot(OFF).maritimeRisks.find(r => r.id === 'R:PORT:JED'); assert.ok(pr && pr.type === 'port_closure' && pr.affectedCount > 0);
  const b = s.createBulletin(OFF, { type: 'port_closure', portId: 'JED', title: { ar: 'إغلاق', en: 'Closure' }, body: { ar: 'نص', en: 'Text' } });
  assert.equal(b.scope, 'LOCAL'); s.issueBulletin(OFF, { id: b.id }); assert.equal(s.snapshot(OFF).bulletins[0].status, 'issued_test');
  s.resetTestData(OFF); const sn = s.snapshot(OFF);
  assert.equal(sn.vessels.length, 24); assert.equal(sn.alerts.length, 0); assert.equal(sn.bulletins.length, 0); assert.equal(sn.ports.find(p => p.id === 'JED').status, 'open');
  assert.ok(sn.auditLogs.some(a => a.action === 'data.reset'));
});

test('NAVTEX-format tool: validation, coordinator vs station, export, test dispatch only', () => {
  const { s, now } = mk();
  const bad = s.saveNavtex(OFF, { subject: 'A', scope: 'INTERNATIONAL', targetId: 'H_JED', areaText: 'Red Sea', textEn: 'x', validFrom: now(), validTo: now() + H });
  assert.equal(bad.status, 'invalid'); assert.ok(bad.errors.some(e => /coordinator/.test(e)));
  assert.throws(() => s.dispatchNavtexTest(OFF, { id: bad.id }), /validation/);
  const miss = s.saveNavtex(OFF, { subject: 'B', scope: 'COASTAL', targetId: 'H_JED' }); assert.ok(miss.errors.length >= 3);
  const ok = s.saveNavtex(OFF, { subject: 'B', scope: 'COASTAL', targetId: 'H_JED', areaText: 'Off Jeddah', lat: 21.4, lon: 38.9, textEn: 'Gale warning', validFrom: now(), validTo: now() + 12 * H });
  assert.equal(ok.status, 'formatted'); assert.match(ok.formatted, /^ZCZC /); assert.match(ok.formatted, /NOT FOR TRANSMISSION/); assert.match(ok.formatted, /NNNN$/);
  const intl = s.saveNavtex(OFF, { subject: 'A', scope: 'INTERNATIONAL', targetId: 'KHI_NAV', areaText: 'Red Sea', textEn: 'Drifting object', validFrom: now(), validTo: now() + H });
  assert.equal(intl.status, 'formatted'); assert.match(intl.formatted, /NAVAREA IX TEST/);
  const rec = s.dispatchNavtexTest(OFF, { id: intl.id });
  assert.equal(rec.response.status, 'accepted_by_test_endpoint'); assert.match(rec.endpoint, /^proposed:\/\//); assert.match(rec.response.note.en, /Not sent/);
  s.exportNavtex(OFF, { id: ok.id });
  assert.ok(s.snapshot(OFF).integrationEvents.some(e => e.integration === 'navarea_ix' && e.status === 'test_only'));
});

test('NCM test interface: validation, missing/invalid data, freshness', () => {
  const { s, now } = mk();
  const r = s.importWeather(OFF, { records: [
    { areaId: 'AGC', recordedAt: new Date(now()).toISOString(), observation: { windKn: 35, waveM: 3.2, visNm: 4 } },
    { areaId: 'XXX', recordedAt: 'bad', observation: {} },
    { areaId: 'JED', recordedAt: new Date(now() + 3 * H).toISOString(), observation: { windKn: 10, waveM: 1 } },
    { areaId: 'YNB', recordedAt: new Date(now()).toISOString(), observation: { windKn: 500, waveM: 1 } }] });
  assert.equal(r.accepted, 1); assert.equal(r.rejected.length, 3);
  assert.ok(r.rejected.some(x => x.errors.some(e => /future/.test(e)))); assert.ok(r.rejected.some(x => x.errors.some(e => /out of range/.test(e))));
  assert.ok(r.warnings[0].warnings.some(w => /missing/.test(w)));
  const st = s.importWeather(OFF, { records: [{ areaId: 'NRS', recordedAt: new Date(now() - 8 * H).toISOString(), observation: { windKn: 10, waveM: 1 } }] });
  assert.ok(st.warnings[0].warnings.some(w => /stale/.test(w)));
  assert.ok(s.snapshot(OFF).maritimeRisks.some(x => x.areaId === 'AGC' && x.level === 'critical'));
  assert.deepEqual(s.importWeather(OFF, { nope: 1 }).accepted, 0);
});

test('alerts expire after validity', () => {
  const { s, adv } = mk();
  const al = s.createAlert(OFF, { customArea: true, lat: 21.5, lon: 38.9, radiusNm: 20, targets: ['V1'], title: { ar: 'ا', en: 'a' }, body: { ar: 'ب', en: 'b' }, validTo: Date.UTC(2026, 11, 3, 8) });
  adv(3); s.tick(); assert.equal(s.store.get('alerts', al.id).status, 'expired');
});

test('IMO/territorial rules: local warnings not on NAVTEX, direct alerts only up to territorial waters', () => {
  const { s, now } = mk();
  const loc = s.saveNavtex(OFF, { subject: 'A', scope: 'LOCAL', targetId: 'H_JED', areaText: 'Jeddah port', textEn: 'Buoy unlit', validFrom: now(), validTo: now() + H });
  assert.equal(loc.status, 'invalid'); assert.ok(loc.errors.some(e => /should not be broadcast on international NAVTEX/.test(e)));
  const off = s.createAlert(OFF, { customArea: true, lat: 20.0, lon: 38.6, radiusNm: 10, targets: ['V1'], title: { ar: 'ا', en: 'a' }, body: { ar: 'ب', en: 'b' } });
  assert.equal(off.wwnws.reachesTerritorialSea, false); s.submitAlert(OFF, { id: off.id });
  assert.throws(() => s.approveAlert(OFF, { id: off.id, disclaimer: true }), /outside_territorial_sea/);
  const port = s.createAlert(OFF, { customArea: true, lat: 21.47, lon: 39.1, radiusNm: 6, targets: ['V12'], title: { ar: 'ا', en: 'a' }, body: { ar: 'ب', en: 'b' } });
  assert.equal(port.wwnws.level, 'LOCAL'); assert.equal(port.wwnws.directAlertAllowed, true);
  const r = s.snapshot(OFF).maritimeRisks.find(x => x.areaId === 'NRS' || x.areaId === 'JED');
  assert.ok(r.indicators.some(i => i.name !== 'windKn' || i.beaufort >= 1));
  const mf = s.marineForecast(OFF, { areaId: 'JED' });
  assert.match(mf.text.en, /PART I - WARNINGS/); assert.match(mf.text.en, /PART III - FORECAST/); assert.ok(mf.validTo - mf.validFrom >= 23 * H);
});
