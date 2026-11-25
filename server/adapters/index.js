/* Integration adapters. Each one is a replaceable boundary: the service layer only depends on the contracts below.
 *
 * NCM adapter contract      : { id, mode, pull(now, horizonH) -> { issuedAt, points: [{ id, kind, areaId?, portId?, name, p:[lon,lat], series:[{ h, t, windKn, gustKn, windDir, waveM, waveDir, periodS, visNm, rainMm, warning?, conf }] }] } }
 * Authority channel contract: manual secure workflow inside MARSA today; a future adapter would submit structured drafts and call back /api/integrations/authority-callback.
 *
 * No official NCM API or NAVAREA/NAVTEX gateway specification has been provided, so the "official" adapters below
 * deliberately refuse to run instead of guessing endpoints or protocols. Replace them once the specifications exist.
 */
'use strict';
const C = require('../../shared/core.js');

function OfficialNcmAdapter(config = {}) {
  return {
    id: 'ncm', mode: 'not_configured',
    pull() { throw new Error('NCM_NOT_CONFIGURED: official API specification and credentials are required (config: ' + Object.keys(config).join(',') + ')'); }
  };
}
function OfficialStationChannel() {
  return {
    id: 'navarea-official', mode: 'not_configured',
    submit() { return { accepted: false, error: 'CHANNEL_NOT_CONFIGURED' }; },
    poll() { return {}; }
  };
}

// Optional, clearly labelled open-data source (NOT the NCM): Open-Meteo forecast + marine APIs (hourly, 48 h).
// Endpoints are Open-Meteo's public documented APIs. Enabled with MARSA_MET_SOURCE=openmeteo.
function OpenMeteoFeed(onData, log) {
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  const points = () => C.MET_AREAS.map(a => ({ id: 'A:' + a.id, kind: 'area', areaId: a.id, name: { ar: a.ar, en: a.en }, p: a.p }))
    .concat(C.PORTS.filter(p => p.country === 'SA').map(p => ({ id: 'P:' + p.id, kind: 'port', portId: p.id, name: { ar: p.ar, en: p.en }, p: p.p })));
  async function fetchPoint(pt, now) {
    const [lon, lat] = pt.p;
    const w = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,precipitation&wind_speed_unit=kn&forecast_hours=49&timezone=UTC')).json();
    const m = await (await fetch('https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + '&hourly=wave_height,wave_direction,wave_period&forecast_hours=49&timezone=UTC')).json();
    const H = w.hourly, M = m.hourly || {};
    const series = H.time.slice(0, 49).map((t, h) => ({ h, t: Date.parse(t + 'Z'), windKn: r1(H.wind_speed_10m[h]), gustKn: r1(H.wind_gusts_10m[h]), windDir: Math.round(H.wind_direction_10m[h] || 0), waveM: r1((M.wave_height || [])[h] ?? 0.3), waveDir: Math.round((M.wave_direction || [])[h] || 0), periodS: r1((M.wave_period || [])[h] ?? 4), visNm: H.visibility[h] != null ? r1(H.visibility[h] / 1852) : 10, rainMm: r1(H.precipitation[h] || 0), warning: null, conf: Math.round((0.93 - 0.0075 * h) * 100) / 100 }));
    return Object.assign({}, pt, { series });
  }
  async function run() {
    try { const now = Date.now(), pts = []; for (const pt of points()) pts.push(await fetchPoint(pt, now)); onData({ issuedAt: now, points: pts, provider: { ar: 'Open-Meteo (بيانات مفتوحة)', en: 'Open-Meteo (open data)' }, simulated: false, integrationId: 'open_meteo' }); }
    catch (e) { log('open-meteo fetch failed: ' + e.message); }
  }
  return { start(intervalMs = 30 * 60e3) { run(); return setInterval(run, intervalMs); } };
}
const NullNcm = () => ({ id: 'ncm', mode: 'disabled', pull: () => { throw new Error('NCM_DISABLED: using Open-Meteo feed'); } });

module.exports = { OfficialNcmAdapter, OfficialStationChannel, OpenMeteoFeed, NullNcm };
