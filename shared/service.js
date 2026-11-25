/* MARSA service layer v2 — prediction-driven port continuity, three warning levels (local / coastal-NAVTEX / international-NAVAREA),
 * human approval with responsibility statement, vessel acknowledgement with escalation, notifications, tamper-evident audit.
 * Synchronous over a Store { all, get, insert, update, remove, clear }. Runs in the browser (MemoryStore) and on Node (SqliteStore). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./predict.js'));
  else root.MarsaService = factory(root.MarsaCore, root.MarsaPredict);
})(typeof self !== 'undefined' ? self : this, function (C, PR) {
  'use strict';
  const H = 3600e3, MIN = 60e3;
  const tx = (ar, en) => ({ ar, en });
  const r1 = v => Math.round(v * 10) / 10;
  const fmtN = v => Math.round(v).toLocaleString('en-US');
  const DISCLAIMER = tx('تُعد التوصيات الصادرة عن منصة مَرسى توصيات استشارية مبنية على البيانات المتاحة والنماذج التنبؤية، ولا تُعد بحد ذاتها قرارًا رسميًا بإغلاق الميناء أو تغيير مسار السفينة أو بديلًا عن التحذيرات والتعليمات الصادرة من الجهات البحرية المختصة. تقع مسؤولية اعتماد القرارات التشغيلية والملاحية وتنفيذها على الجهات والأطراف المخولة نظامًا، مع الالتزام بالتعليمات البحرية الرسمية وإجراءات السلامة المعتمدة.',
    'MARSA recommendations are advisory and are based on available data and predictive models. They do not constitute official port closure decisions, vessel navigation orders, or substitutes for official maritime warnings and instructions. Operational and navigational decisions remain the responsibility of duly authorized authorities and responsible parties, in accordance with applicable maritime regulations and safety procedures.');
  const DISCLAIMER_HASH = C.sha256(DISCLAIMER.ar + DISCLAIMER.en).slice(0, 16);

  // ---------- Roles & permissions ----------
  const ROLES = {
    admin: tx('مدير نظام مَرسى', 'MARSA system administrator'),
    port_manager: tx('مدير عمليات الميناء', 'Port operations manager'),
    warning_officer: tx('ضابط السلامة البحرية والتحذيرات', 'Maritime safety / warning officer'),
    authority: tx('الجهة البحرية المختصة (NAVTEX/NAVAREA)', 'Competent maritime authority (NAVTEX/NAVAREA)'),
    port_staff: tx('موظف عمليات الميناء', 'Port operations personnel'),
    company: tx('شركة ملاحة', 'Shipping company'),
    captain: tx('ربان / ضابط السفينة', 'Ship captain / onboard officer'),
    truck: tx('النقل البري', 'Land transport')
  };
  const OPS = ['view:dashboard', 'view:map', 'view:predict', 'view:weather', 'view:ports', 'view:local', 'view:coastal', 'view:intl', 'view:vessels', 'view:routes', 'view:approvals', 'view:acks', 'view:records', 'view:reports', 'view:bulletins'];
  const PERMS = {
    admin: ['*'],
    port_manager: OPS.concat(['port:decide', 'port:update', 'route:decide', 'scenario:run', 'vessel:edit']),
    warning_officer: OPS.concat(['notice:manage', 'warning:draft', 'warning:local:approve', 'warning:submit', 'ack:manage', 'route:decide', 'scenario:run', 'bulletin:publish']),
    authority: ['view:dashboard', 'view:map', 'view:weather', 'view:coastal', 'view:intl', 'view:records', 'view:reports', 'warning:authority'],
    port_staff: ['view:dashboard', 'view:map', 'view:weather', 'view:ports', 'view:vessels', 'view:records', 'port:update', 'port:report'],
    company: ['view:dashboard', 'view:map', 'view:vessels', 'view:routes', 'view:acks'],
    captain: ['view:bridge'],
    truck: ['view:truck', 'truck:manage']
  };
  const can = (u, p) => !!u && ((PERMS[u.role] || []).includes('*') || (PERMS[u.role] || []).includes(p));
  class PermissionError extends Error { constructor(p) { super('FORBIDDEN:' + p); this.code = 'FORBIDDEN'; } }
  class ValidationError extends Error { constructor(m) { super('INVALID:' + m); this.code = 'INVALID'; } }
  const need = (u, p) => { if (!can(u, p)) throw new PermissionError(p); };
  const needPort = (u, p, portId) => { need(u, p); if (u.role !== 'admin' && u.portId && u.portId !== portId) throw new PermissionError(p + ':port'); };
  const needDisclaimer = a => { if (!a || a.disclaimer !== true) throw new ValidationError('disclaimer_required'); };

  // ---------- In-memory store ----------
  class MemoryStore {
    constructor(data) { this.t = data || {}; }
    all(t) { return this.t[t] || (this.t[t] = []); }
    get(t, id) { return this.all(t).find(r => r.id === id) || null; }
    insert(t, row) { this.all(t).push(row); return row; }
    update(t, id, patch) { const r = this.get(t, id); if (r) Object.assign(r, patch); return r; }
    remove(t, id) { const a = this.all(t), i = a.findIndex(r => r.id === id); if (i >= 0) a.splice(i, 1); }
    clear() { this.t = {}; }
    dump() { return this.t; }
  }

  // ---------- Simulated NCM: hourly 48 h forecasts for sea areas and Saudi port points ----------
  function SimulatedNcmAdapter() {
    const events = [];
    const shape = (t, e) => t < e.start || t > e.end ? 0 : t < e.peakStart ? (t - e.start) / (e.peakStart - e.start) : t <= e.peakEnd ? 1 : 1 - (t - e.peakEnd) / (e.end - e.peakEnd);
    const spatial = (p, e) => { const d = C.gcNm(p, e.center); return d <= 0.35 * e.radiusNm ? 1 : d >= e.radiusNm ? 0 : 1 - (d - 0.35 * e.radiusNm) / (0.65 * e.radiusNm); };
    function points() {
      const pts = C.MET_AREAS.map(a => ({ id: 'A:' + a.id, kind: 'area', areaId: a.id, name: tx(a.ar, a.en), p: a.p, base: a.base }));
      for (const p of C.PORTS.filter(p => p.country === 'SA')) {
        const near = C.MET_AREAS.reduce((b, a) => C.gcNm(a.p, p.p) < C.gcNm(b.p, p.p) ? a : b);
        pts.push({ id: 'P:' + p.id, kind: 'port', portId: p.id, name: tx(p.ar, p.en), p: p.p, base: { w: near.base.w - 3, g: near.base.g - 5, d: near.base.d, h: near.base.h * 0.8, v: near.base.v } });
      }
      return pts;
    }
    function value(pt, t, i) {
      const hod = new Date(t).getUTCHours() + 3, sea = Math.sin(2 * Math.PI * (hod - 9) / 24), slow = Math.sin(t / 5.4e6 + i);
      let w = pt.base.w + 2.5 * sea + 1.2 * slow, g = pt.base.g + 3 * sea + 1.5 * slow, h = pt.base.h + 0.2 * sea + 0.15 * slow, v = pt.base.v + 0.8 * slow, rain = 0, warn = null;
      for (const e of events) {
        const k = shape(t, e) * spatial(pt.p, e); if (k <= 0) continue;
        if (e.windKn != null) w += (e.windKn - w) * k; if (e.gustKn != null) g += (e.gustKn - g) * k; if (e.waveM != null) h += (e.waveM - h) * k;
        if (e.visNm != null) v += (e.visNm - v) * k; if (e.rainMm) rain += e.rainMm * k; if (k > 0.5 && e.warning) warn = e.warning;
      }
      return { t, windKn: r1(Math.max(2, w)), gustKn: r1(Math.max(w + 2, g)), windDir: Math.round((pt.base.d + 15 * slow + 360) % 360), waveM: r1(Math.max(0.2, h)), waveDir: Math.round((pt.base.d + 10 + 360) % 360), periodS: r1(4 + h * 1.6), visNm: r1(Math.max(0.3, v)), rainMm: r1(rain), warning: warn };
    }
    return {
      id: 'ncm', mode: 'sandbox', provider: tx('محاكي واجهة المركز الوطني للأرصاد', 'NCM interface simulator'),
      addEvent(e) { events.push(e); }, clear() { events.length = 0; }, events,
      pull(now, horizonH = 48) {
        const t0 = Math.floor(now / H) * H;
        return { issuedAt: now, points: points().map((pt, i) => ({ id: pt.id, kind: pt.kind, areaId: pt.areaId || null, portId: pt.portId || null, name: pt.name, p: pt.p,
          series: Array.from({ length: horizonH + 1 }, (_, h) => Object.assign(value(pt, h === 0 ? now : t0 + h * H, i), { h, conf: Math.round((0.93 - 0.0075 * h) * 100) / 100 })) })) };
      }
    };
  }

  // ---------- Service ----------
  function createService({ store, clock = () => Date.now(), ncm = SimulatedNcmAdapter(), extraIntegrations = [], secretBox = null } = {}) {
    const S = store || new MemoryStore();
    const listeners = []; let seq = 0;
    const now = () => clock();
    const uid = p => p + '-' + now().toString(36).slice(-5).toUpperCase() + (++seq).toString(36).toUpperCase();
    const meta = () => S.get('meta', 'meta');
    const counter = k => { const m = meta(); const c = Object.assign({}, m.counters); c[k] = (c[k] || 0) + 1; S.update('meta', 'meta', { counters: c }); return c[k]; };
    const num = (prefix, k) => prefix + '-' + new Date(now()).getUTCFullYear() + '-' + String(counter(k)).padStart(4, '0');
    const bump = () => { const m = meta(); S.update('meta', 'meta', { version: m.version + 1 }); for (const f of listeners) try { f(m.version + 1); } catch (e) { /* ignore */ } };
    const settings = () => S.get('settings', 'settings');
    const SYS = { username: 'system', role: 'system', orgId: 'ORG-MARSA', name: tx('النظام', 'System') };
    const ENGINE = { username: 'marsa-engine', role: 'system', orgId: 'ORG-MARSA', name: tx('محرك مَرسى', 'MARSA engine') };
    const INTEG = n => ({ username: 'integration:' + n, role: 'integration', orgId: 'ORG-MARSA', name: tx('تكامل ' + n, 'Integration ' + n) });
    const portOf = id => S.get('ports', id);
    const vesselOf = id => S.get('vessels', id);
    const verify = obj => C.sha256(JSON.stringify(obj)).slice(0, 20).toUpperCase();

    // Tamper-evident audit chain: hash = sha256(prevHash + canonical row)
    function audit(actor, action, entity, entityId, summary, extra = {}) {
      const last = S.all('audit').slice(-1)[0];
      const row = { id: uid('AU'), seq: (last ? last.seq : 0) + 1, ts: now(), actor: actor.username, role: actor.role, orgId: actor.orgId || null, action, entity, entityId, summary, simulated: extra.simulated !== false, details: extra.details || null, prevHash: last ? last.hash : 'GENESIS' };
      row.hash = C.sha256(row.prevHash + JSON.stringify([row.seq, row.ts, row.actor, row.action, row.entity, row.entityId, row.summary, row.details]));
      S.insert('audit', row);
    }
    function verifyAudit() {
      let prev = 'GENESIS', i = 0;
      for (const r of S.all('audit')) { i++; const h = C.sha256(prev + JSON.stringify([r.seq, r.ts, r.actor, r.action, r.entity, r.entityId, r.summary, r.details])); if (r.prevHash !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq, checked: i }; prev = r.hash; }
      return { ok: true, checked: i, head: prev.slice(0, 16) };
    }
    // Notifications: audience by roles + optional scoping (port, vessel, company, user)
    function notify(category, title, body, ref, aud) {
      S.insert('notifications', { id: uid('NF'), category, title, body, ref, roles: aud.roles || [], portId: aud.portId || null, vesselId: aud.vesselId || null, companyId: aud.companyId || null, userId: aud.userId || null, level: aud.level || 'info', createdAt: now(), readBy: [] });
    }
    function forUser(n, u) {
      if (n.userId) return n.userId === u.id;
      if (u.role === 'admin') return n.roles.some(r => ['admin', 'port_manager', 'warning_officer', 'authority'].includes(r));
      if (!n.roles.includes(u.role)) return false;
      if (n.portId && u.portId && n.portId !== u.portId && ['port_manager', 'port_staff'].includes(u.role)) return false;
      if (u.role === 'captain') return n.vesselId === u.vesselId;
      if (u.role === 'company') return !n.companyId || n.companyId === u.companyId;
      return true;
    }
    function record(kind, refId, decision, user, extra = {}) {
      const d = { id: uid('DC'), number: num('DEC', 'dec'), kind, refId, decision, by: user.username, name: user.name, role: user.role, orgId: user.orgId || null, at: now(),
        disclaimer: extra.disclaimer ? { acknowledged: true, at: now(), textHash: DISCLAIMER_HASH } : null, previous: extra.previous || null, modifications: extra.modifications || null, note: extra.note || null, supporting: extra.supporting || null };
      d.verification = verify(d); S.insert('decisions', d); return d;
    }

    // ---------- Seed ----------
    const ORGS = [
      ['ORG-MARSA', 'marsa', 'مَرسى', 'MARSA'], ['ORG-JED', 'port', 'ميناء جدة الإسلامي (تجريبي)', 'Jeddah Islamic Port (demo)'], ['ORG-DMM', 'port', 'ميناء الملك عبدالعزيز بالدمام (تجريبي)', 'King Abdulaziz Port Dammam (demo)'],
      ['ORG-AUTH', 'authority', 'الجهة البحرية المختصة بالتحذيرات الملاحية (حساب تجريبي)', 'Competent maritime warning authority (demo account)'],
      ['C1', 'shipping', 'شركة الخليج للملاحة (تجريبية)', 'Gulf Navigation Co. (demo)'], ['C2', 'shipping', 'خطوط البحر الأحمر (تجريبية)', 'Red Sea Lines (demo)'], ['C3', 'shipping', 'العربية لنقل البضائع السائبة (تجريبية)', 'Arabian Bulk Carriers (demo)'],
      ['T1', 'trucking', 'النقل البري المتحد (تجريبية)', 'United Land Transport (demo)']
    ];
    const DEMO_USERS = [
      ['U1', 'admin', 'admin', 'admin', 'ORG-MARSA', null, null, 'مدير النظام', 'System Admin'],
      ['U2', 'manager', 'manager', 'port_manager', 'ORG-JED', 'JED', null, 'م. خالد الحربي', 'Eng. Khalid Alharbi'],
      ['U3', 'officer', 'officer', 'warning_officer', 'ORG-JED', 'JED', null, 'النقيب سارة القحطاني', 'Capt. Sara Alqahtani'],
      ['U4', 'authority', 'authority', 'authority', 'ORG-AUTH', null, null, 'أ. فيصل العتيبي', 'Faisal Alotaibi'],
      ['U5', 'staff', 'staff', 'port_staff', 'ORG-JED', 'JED', null, 'ريم الزهراني', 'Reem Alzahrani'],
      ['U6', 'company', 'company', 'company', 'C2', null, null, 'نورة الشهري', 'Noura Alshehri'],
      ['U7', 'captain', 'captain', 'captain', 'C2', null, 'V20', 'الربان أحمد سالم', 'Capt. Ahmed Salem'],
      ['U8', 'captain2', 'captain', 'captain', 'C1', null, 'V21', 'Capt. Nikos Andreou', 'Capt. Nikos Andreou'],
      ['U9', 'truck', 'truck', 'truck', 'T1', null, null, 'ماجد الشمري', 'Majed Alshammari'],
      ['U10', 'manager.dmm', 'manager', 'port_manager', 'ORG-DMM', 'DMM', null, 'م. فهد الدوسري', 'Eng. Fahad Aldosari']
    ];
    const MID = { SA: '403', PA: '352', LR: '636', MH: '538', SG: '563', AE: '470', DJ: '621', QA: '466', GR: '237', MT: '215', EG: '622', IN: '419', PK: '463' };
    // id, name, type, flag, company, origin, dest, at|'anchor'|'berth', back(nm), speed, draft, length, fuel t/day, TEU
    const VESSELS = [
      ['V1', 'Nawras Star', 'container', 'SA', 'C1', 'JED', 'ASIA', 'RS5', 30, 17, 14.2, 300, 95, 9000], ['V2', 'Lulu Bay', 'tanker', 'SA', 'C1', 'RTN', 'EUROPE', 'GUA', 60, 13.5, 15.8, 250, 55, 0],
      ['V3', 'Dana Explorer', 'container', 'SG', 'C1', 'ASIA', 'JED', 'AS1', 120, 18, 13.2, 330, 110, 11000], ['V4', 'Rawabi Trader', 'bulk', 'PA', 'C3', 'PSD', 'MUM', 'RS2', 40, 13, 12.8, 190, 38, 0],
      ['V5', 'Hilal Express', 'container', 'LR', 'C1', 'MUM', 'EUROPE', 'GA2', 20, 17.5, 13.9, 300, 100, 8500], ['V6', 'Sadaf Carrier', 'container', 'DJ', 'C2', 'DJI', 'JED', 'DJI_A', 5, 15, 11.5, 200, 55, 2800],
      ['V7', 'Wahat Pride', 'tanker', 'SA', 'C2', 'JUB', 'MUM', 'AG1', 30, 14, 13.2, 230, 48, 0], ['V8', 'Zahra Voyager', 'container', 'AE', 'C2', 'JEA', 'KHI', 'GOO', 50, 16, 12.5, 260, 70, 4500],
      ['V9', 'Baraka Spirit', 'roro', 'SA', 'C2', 'YNB', 'PSD', 'RS1', 60, 16, 8.5, 180, 40, 0], ['V10', 'Najm Ocean', 'lng', 'QA', 'C3', 'KWT', 'ASIA', 'AS3', 80, 18.5, 11.8, 290, 130, 0],
      ['V11', 'Faisal Horizon', 'container', 'SA', 'C1', 'KHI', 'DMM', 'AS3', 120, 16.5, 12.2, 260, 72, 5200], ['V12', 'Khaleej Pearl', 'container', 'MH', 'C2', 'JEA', 'DMM', 'AG1', 10, 15, 12.0, 240, 60, 4200],
      // Jeddah traffic: inbound from north and south, at anchor, at berth
      ['V20', 'Murjan Glory', 'bulk', 'SA', 'C2', 'JZN', 'JED', 'RS4', 15, 12.5, 10.5, 180, 30, 0], ['V21', 'Aegean Star', 'container', 'GR', 'C1', 'PSD', 'JED', 'RS3', 25, 15, 12.6, 260, 65, 6000],
      ['V22', 'Sawari Trader', 'general', 'SA', 'C3', 'AQB', 'JED', 'RS2', 30, 13, 9.8, 160, 26, 0], ['V23', 'Ocean Falcon', 'container', 'MT', 'C2', 'PSU', 'JED', 'RS4', 40, 16, 12.0, 250, 62, 5000],
      ['V24', 'Tihama Bulk', 'bulk', 'PA', 'C3', 'JZN', 'JED', 'RS5', 20, 12, 11.0, 190, 28, 0], ['V25', 'Red Sea Breeze', 'roro', 'EG', 'C2', 'PSD', 'JED', 'RS1', 10, 17, 8.8, 200, 45, 0],
      ['V26', 'Asir Spirit', 'container', 'SA', 'C1', 'YNB', 'JED', 'YNB_A', 15, 15, 11.2, 220, 50, 3200], ['V27', 'Hejaz Carrier', 'bulk', 'LR', 'C3', 'PSU', 'JED', 'PSU_A', 20, 12.5, 10.8, 185, 29, 0],
      ['V28', 'Corniche Express', 'container', 'SA', 'C2', 'KAP', 'JED', 'anchor', 0, 15, 11.5, 230, 55, 4000], ['V29', 'Fanar Pioneer', 'general', 'SA', 'C3', 'YNB', 'JED', 'anchor', 0, 13, 9.5, 150, 22, 0],
      ['V30', 'Balad Trader', 'bulk', 'PA', 'C3', 'AQB', 'JED', 'anchor', 0, 12, 10.2, 170, 26, 0], ['V31', 'Obhur Star', 'container', 'SA', 'C1', 'PSD', 'JED', 'berth', 0, 16, 12.8, 270, 70, 6500],
      ['V32', 'Salam Voyager', 'roro', 'AE', 'C2', 'PSU', 'JED', 'berth', 0, 16, 8.6, 190, 42, 0], ['V33', 'Yanbu Express', 'container', 'SA', 'C2', 'JED', 'YNB', 'JED_A', 8, 15, 11.0, 210, 48, 2500],
      ['V34', 'Kandara Bay', 'container', 'IN', 'C1', 'MUM', 'KAP', 'RS4', 60, 17, 12.9, 280, 75, 7000], ['V35', 'Sharm Trader', 'general', 'EG', 'C3', 'PSD', 'JZN', 'RS2', 80, 13, 9.0, 150, 22, 0]
    ];
    const OCC = { JED: 72, KAP: 58, YNB: 52, JZN: 44, DMM: 66, JUB: 61, RTN: 55, PSD: 63, AQB: 49, PSU: 57, DJI: 74, ADN: 38, SLL: 69, JEA: 77, KHI: 72, MUM: 79, KWT: 60 };
    const TRUCKS = [['TR1', 'أ ب ج 4521', 'JED', 6, 'حاويات مبردة', 'Reefer containers'], ['TR2', 'د هـ و 1187', 'JED', 10, 'مواد بناء', 'Construction materials'], ['TR3', 'س ص ط 3390', 'JED', 20, 'حاويات عامة', 'General containers'],
      ['TR4', 'ق ر ش 7742', 'DMM', 8, 'قطع غيار', 'Spare parts'], ['TR5', 'ك ل م 2056', 'DMM', 14, 'حاويات عامة', 'General containers'], ['TR6', 'ن هـ ي 6631', 'KAP', 12, 'أغذية', 'Food products'], ['TR7', 'ع غ ف 9014', 'JZN', 18, 'حديد', 'Steel']];

    function vesselLine(v) { return [v.routeStart].concat(v.routeNodes.map(n => C.NODES[n])); }
    function vesselPos(v) { if (!v.routeNodes.length) return { pos: v.routeStart, cog: 0, nextIdx: 0 }; const a = C.pointAlong(vesselLine(v), v.nmTraveled); return { pos: a.pos, cog: Math.round(a.cog), nextIdx: Math.max(0, a.idx - 1) }; }
    function remaining(v) {
      const { pos, nextIdx } = vesselPos(v); const nodes = v.routeNodes.slice(nextIdx);
      if (!nodes.length) return { pos, nodes: [], coords: [pos], nm: 0, prevNode: null };
      return { pos, nodes, coords: [pos].concat(C.nodesToCoords(nodes)), nm: C.gcNm(pos, C.NODES[nodes[0]]) + C.nodesNm(nodes), prevNode: v.routeNodes[nextIdx - 1] || null };
    }
    function etaH(v) { if (v.status !== 'underway') return null; const d = portOf(v.destId); if (!d || d.virtual) return null; const r = remaining(v); return r1(r.nm / v.speedKn + (v.hold && v.status !== 'holding' ? Math.max(0, (v.hold.until - now()) / H) : 0)); }
    function seed() {
      S.clear(); const t = now();
      S.insert('meta', { id: 'meta', version: 1, counters: {}, scenario: null, lastNcm: 0, lastTick: t, seededAt: t, forecastIssuedAt: 0 });
      S.insert('settings', { id: 'settings', horizonH: 48, ackTimeoutMin: 5, alertRadiusNm: 50, autoRoute: false, autoReleaseRoutes: true, capacityCapPct: 88, simAccel: 10, ncmIntervalSec: 15, autoDraftLocal: true, autoDraftCoastal: true, thresholds: Object.assign({}, C.DEFAULT_THRESHOLDS) });
      for (const [id, kind, ar, en] of ORGS) S.insert('organizations', { id, kind, name: tx(ar, en), active: true });
      for (const [id, username, password, role, orgId, portId, vesselId, ar, en] of DEMO_USERS) S.insert('users', { id, username, password, role, orgId, companyId: ['company', 'captain', 'truck'].includes(role) ? orgId : null, portId, vesselId, name: tx(ar, en), active: true, createdAt: t });
      for (const p of C.PORTS) {
        const prof = C.PORT_PROFILES[p.id] || {};
        S.insert('ports', { id: p.id, name: tx(p.ar, p.en), country: p.country, p: p.p, node: p.node, maxDraft: p.maxDraft, berths: p.berths, virtual: !!p.virtual, saudi: p.country === 'SA', occupancy: OCC[p.id] ?? null,
          cargo: prof.cargo || ['container', 'bulk', 'general', 'tanker', 'roro', 'lng'], availableBerths: prof.availableBerths || Math.round(p.berths * 0.4), avgBerthHours: prof.avgBerthHours || 26, waiting: prof.waiting || [],
          terminals: (prof.terminals || []).map(n => ({ name: n, available: true })), thresholds: p.country === 'SA' ? Object.assign({}, C.DEFAULT_THRESHOLDS) : null,
          status: 'open', statusWindow: null, statusReason: null, statusBy: null, statusAt: t, restrictions: [], reopenConditions: null, incoming: 0, localRadiusNm: p.country === 'SA' ? C.LOCAL_RADIUS_NM : null, opsUpdatedAt: t, opsUpdatedBy: 'seed' });
      }
      for (const r of VESSELS) {
        const [id, name, type, flag, companyId, originId, destId, at, back, speedKn, draft, lengthM, fuelTPD, teu] = r;
        const o = C.PORTS.find(p => p.id === originId), d = C.PORTS.find(p => p.id === destId);
        const v = { id, name, mmsi: MID[flag] + String(100000 + parseInt(id.slice(1), 10) * 731).padStart(6, '0'), imo: String(9300000 + parseInt(id.slice(1), 10) * 1373), type, flag, companyId, originId, destId, speedKn, draft, lengthM, fuelTPD, teu,
          status: 'underway', hold: null, aisSource: 'SIM', lastAis: t, routeStart: null, routeNodes: [], nmTraveled: 0, pos: null, cog: 0, nextIdx: 0 };
        if (at === 'anchor' || at === 'berth') {
          v.status = at === 'anchor' ? 'anchored' : 'moored'; v.routeStart = at === 'anchor' ? [C.NODES[d.node][0] + 0.06 * (parseInt(id.slice(1), 10) % 3), C.NODES[d.node][1] + 0.05 * ((parseInt(id.slice(1), 10) % 4) - 1.5)] : [d.p[0] - 0.02, d.p[1] + 0.01 * (parseInt(id.slice(1), 10) % 3)];
          v.pos = v.routeStart; if (at === 'berth') v.destId = d.id;
        } else {
          const path = C.shortestPath(o.node, d.node, { draft });
          v.routeStart = o.virtual ? C.NODES[path.nodes[0]] : o.p; v.routeNodes = path.nodes;
          const line = vesselLine(v); let acc = 0;
          for (let i = 1; i < line.length; i++) { acc += C.gcNm(line[i - 1], line[i]); if (v.routeNodes[i - 1] === at) break; }
          v.nmTraveled = Math.max(0, acc - back); Object.assign(v, vesselPos(v));
        }
        v.bridgeApp = !['V4', 'V27', 'V35'].includes(id); v.noComms = id === 'V30';
        if (v.noComms) v.lastAis = t - 3 * H;
        S.insert('vessels', v);
        S.insert('users', { id: 'B-' + id, username: 'bridge.' + v.mmsi, password: null, role: 'captain', orgId: companyId, companyId, portId: null, vesselId: id, name: tx('جسر ' + name, name + ' bridge'), active: true, createdAt: t, bridge: true });
      }
      for (const [id, plate, portId, inH, ar, en] of TRUCKS) S.insert('trucks', { id, plate, companyId: 'T1', portId, slotAt: t + inH * H, cargo: tx(ar, en), status: 'scheduled', note: null, history: [] });
      const I = (id, ar, en, mode, note, extra = {}) => S.insert('integrations', Object.assign({ id, name: tx(ar, en), mode, endpoint: null, authType: 'none', credentialSet: false, credentialHint: null, status: mode === 'disabled' ? 'disabled' : 'connected', lastCheck: null, lastSync: null, records: 0, note }, extra));
      I('ncm', 'المركز الوطني للأرصاد', 'National Center for Meteorology (NCM)', 'sandbox', tx('لا توجد واجهة رسمية أو مفاتيح بعد. البيانات من محاكي يتبع عقد التكامل نفسه وتُوسم «محاكاة».', 'No official API or credentials yet. Data comes from a simulator that follows the same integration contract and is labelled "SIM".'));
      I('authority', 'الجهة البحرية المختصة بالتحذيرات', 'Competent maritime warning authority', 'manual', tx('لا توجد واجهة تقنية رسمية. يعمل مسار يدوي آمن: مستخدم الجهة يراجع ويعتمد داخل المنصة ويسجل الرقم المرجعي الرسمي.', 'No official technical interface. A secure manual workflow runs: the authority user reviews and approves inside MARSA and records the official reference.'));
      I('ais', 'مزود بيانات AIS', 'AIS data provider', 'sandbox', tx('مواقع السفن محاكاة. الربط الحي يتطلب مزودًا معتمدًا أو مستقبل AIS بالميناء.', 'Vessel positions are simulated. A live link needs an authorised provider or a port AIS receiver.'));
      I('ais_srm', 'رسائل السلامة عبر محطة AIS بالميناء', 'Safety messages via port AIS station', 'sandbox', tx('قناة تحذير محلية للسفن دون حساب في مَرسى. في بيئة العرض لا يُرسل شيء فعليًا ولا يتوفر تأكيد تسليم.', 'Local warning channel for vessels without a MARSA account. In the demo nothing is transmitted and no delivery confirmation exists.'));
      I('marsa_app', 'تطبيق جسر السفينة في مَرسى', 'MARSA vessel bridge app', 'production', tx('قناة داخل المنصة تعمل فعليًا: تسجل الوصول والاطلاع والرد.', 'In-platform channel that works today: records delivery, acknowledgement and response.'));
      I('karachi', 'محطة كراتشي (منسق NAVAREA IX)', 'Karachi station (NAVAREA IX coordinator)', 'sandbox', tx('قناة تكامل تجريبية: تُسجل مَرسى الإرسال وتأكيد الاستلام بمحاكاة موسومة. لا يوجد ربط فعلي مع محطة كراتشي، والبث الرسمي مسؤولية المحطة.', 'Sandbox integration channel: MARSA records dispatch and a labelled simulated receipt. There is no live link with the Karachi station; official broadcast is the station\'s responsibility.'));
      I('ports_channel', 'قناة الموانئ السعودية', 'Saudi ports channel', 'sandbox', tx('توجيه النشرات إلى الموانئ المعنية. تأكيد الاستلام محاكاة في بيئة العرض.', 'Routes notices to the concerned ports. Receipt confirmation is simulated in the demo.'));
      I('port_systems', 'أنظمة تشغيل الميناء', 'Port operational systems', 'manual', tx('الإدخال اليدوي من موظفي الميناء مفعّل. التكامل الآلي يتطلب واجهة من مشغل الميناء.', 'Manual entry by port staff is active. Automatic integration needs an interface from the port operator.'));
      if (ncm.mode === 'disabled') S.update('integrations', 'ncm', { mode: 'disabled', status: 'disabled' });
      for (const x of extraIntegrations) S.insert('integrations', x);
      audit(SYS, 'system.seed', 'system', null, tx('تهيئة بيئة العرض ببيانات تجريبية', 'Demo environment initialised with sample data'));
      pullForecast(t); runPredictions(); issuePeriodicBulletin(SYS); evaluate(); bump();
    }

    // ---------- Vessel movement ----------
    function moveVessels(dtMs) {
      const accel = settings().simAccel, t = now();
      for (const v of S.all('vessels')) {
        if (v.status !== 'underway' && v.status !== 'holding') continue;
        if (v.status === 'holding') { if (v.hold && t >= v.hold.until) { S.update('vessels', v.id, { status: 'underway', hold: Object.assign({}, v.hold, { done: true }) }); audit(SYS, 'vessel.resume', 'vessel', v.id, tx('استئناف الإبحار بعد الانتظار: ' + v.name, 'Resumed after waiting: ' + v.name)); } continue; }
        let nm = v.nmTraveled + v.speedKn * (dtMs / H) * accel; const total = C.polylineLength(vesselLine(v)); const patch = {};
        if (v.hold && !v.hold.done && nm >= v.hold.atNm) { nm = v.hold.atNm; patch.status = 'holding'; audit(SYS, 'vessel.hold', 'vessel', v.id, tx(v.name + ' وصلت منطقة الانتظار', v.name + ' reached the waiting area')); }
        if (nm >= total) {
          nm = total; const d = portOf(v.destId);
          if (d && !d.virtual) patch.status = 'anchored';
          else patch.status = 'out_of_area';
        }
        patch.nmTraveled = nm; Object.assign(patch, vesselPos(Object.assign({}, v, patch)), { lastAis: t }); S.update('vessels', v.id, patch);
      }
      // berth turnover: anchored vessels berth when port open and berths available (simple)
      for (const p of S.all('ports').filter(p => p.saudi)) {
        if (effectiveStatus(p) !== 'open') continue;
        const anch = S.all('vessels').filter(v => v.destId === p.id && v.status === 'anchored');
        if (anch.length && Math.random() < 0.002 * settings().simAccel) { const v = anch[0]; S.update('vessels', v.id, { status: 'moored', pos: [p.p[0] - 0.02, p.p[1]], routeStart: [p.p[0] - 0.02, p.p[1]], routeNodes: [] }); }
      }
    }

    // ---------- Forecast ingestion ----------
    function pullForecast(t) {
      if (ncm.mode === 'disabled') return;
      let res; try { res = ncm.pull(t, settings().horizonH); } catch (e) {
        S.update('integrations', 'ncm', { status: 'error', lastError: String(e.message || e) }); intLog('ncm', 'error', String(e.message || e));
        notify('integration_failure', tx('تعذر استقبال بيانات الأرصاد', 'Met data pull failed'), tx(String(e.message || e), String(e.message || e)), { type: 'integration', id: 'ncm' }, { roles: ['warning_officer', 'port_manager'], level: 'warning' }); return;
      }
      ingestForecast(res, ncm.mode !== 'production', t);
    }
    function ingestForecast(res, simulated, t, integrationId = 'ncm', provider) {
      for (const p of res.points) {
        const cur = p.series[0];
        S.insert('met', { id: uid('MET'), pointId: p.id, areaId: p.areaId, portId: p.portId, p: p.p, area: p.name, source: integrationId.toUpperCase(), simulated, receivedAt: t, issuedAt: res.issuedAt,
          windKn: cur.windKn, gustKn: cur.gustKn, windDir: cur.windDir, waveM: cur.waveM, waveDir: cur.waveDir, periodS: cur.periodS, visNm: cur.visNm, rainMm: cur.rainMm, warning: cur.warning, conf: cur.conf });
        const f = { id: p.id, kind: p.kind, areaId: p.areaId, portId: p.portId, name: p.name, p: p.p, series: p.series, issuedAt: res.issuedAt, provider: provider || ncm.provider, simulated };
        if (S.get('forecasts', p.id)) S.update('forecasts', p.id, f); else S.insert('forecasts', f);
      }
      const all = S.all('met'), cap = 50 * res.points.length; if (all.length > cap) for (const r of all.slice(0, all.length - cap)) S.remove('met', r.id);
      const integ = S.get('integrations', integrationId);
      if (integ) S.update('integrations', integrationId, { status: 'connected', lastSync: t, records: (integ.records || 0) + res.points.length, lastError: null });
      S.update('meta', 'meta', { lastNcm: t, forecastIssuedAt: res.issuedAt });
    }
    const intLog = (id, level, msg) => { S.insert('integrationLogs', { id: uid('IL'), integrationId: id, at: now(), level, message: msg }); const all = S.all('integrationLogs'); if (all.length > 300) S.remove('integrationLogs', all[0].id); };

    // ---------- Port status (human decisions) ----------
    function effectiveStatus(p) {
      const w = p.statusWindow, t = now();
      if (w && w.to && t > w.to) return 'open';
      if (w && w.from && t < w.from) return 'open';
      return p.status;
    }

    // ---------- Predictions ----------
    // open-sea limits for ships under way (ports use their own, stricter operating thresholds)
    const SEA_TH = { gustRestrict: 30, gustClose: 40, waveRestrict: 2.5, waveClose: 4.0, visRestrict: 1.0, visClose: 0.5 };
    function runPredictions() {
      const t = now(), hz = settings().horizonH;
      const vs = S.all('vessels').map(v => Object.assign({}, v, { etaH: etaH(v) }));
      const preds = [], timelines = {};
      for (const p of S.all('ports').filter(p => p.saudi)) {
        const f = S.get('forecasts', 'P:' + p.id); if (!f) continue;
        const pp = Object.assign({}, p, { status: effectiveStatus(p), thresholds: Object.assign({}, settings().thresholds, p.thresholds) });
        const r = PR.predictPort({ port: pp, forecast: f, vessels: vs, now: t, horizonH: hz });
        // a scheduled human closure/restriction window reduces capacity in those hours
        if (p.statusWindow) for (const x of r.timeline) if (x.t >= p.statusWindow.from && x.t <= p.statusWindow.to) x.capacity = Math.min(x.capacity, p.status === 'closed' ? 0 : 0.6);
        timelines[p.id] = r.timeline; preds.push(...r.predictions);
      }
      // sea-area state (route risk) with default thresholds
      for (const f of S.all('forecasts').filter(f => f.kind === 'area')) {
        const th = settings().thresholds; let cur = null;
        for (const s of f.series) {
          const wl = PR.weatherLevel(s, th);
          if (PR.rank(wl.level) >= 3) { if (!cur) { cur = { from: s.h, to: s.h, sev: wl.level, peak: s }; preds.push(cur); } cur.to = s.h; cur.sev = PR.maxL(cur.sev, wl.level); if (s.waveM > cur.peak.waveM) cur.peak = s; }
          else if (cur) { cur.done = true; cur = null; }
        }
        for (const w of preds.filter(x => x.from != null && !x.key)) {
          const pk = w.peak; w.peak = pk;
          Object.assign(w, { key: f.id + ':sea:' + w.from, category: 'sea_state', severity: w.sev, areaId: f.areaId, area: f.name, poly: C.circlePoly(f.p, 80, 20), start: t + w.from * H, end: t + (w.to + 1) * H, peakAt: pk.t, peak: pk.waveM + ' m / ' + pk.gustKn + ' kn',
            confidence: { value: pk.conf, level: pk.conf >= 0.75 ? 'high' : pk.conf >= 0.6 ? 'medium' : 'low' }, sources: [{ kind: 'forecast', id: f.id, provider: f.provider, issuedAt: f.issuedAt, simulated: f.simulated }],
            explanation: tx('حالة بحر خطرة متوقعة في ' + f.name.ar + ': أمواج ' + pk.waveM + ' م وهبّات ' + pk.gustKn + ' عقدة.', 'Hazardous sea state expected in ' + f.name.en + ': waves ' + pk.waveM + ' m, gusts ' + pk.gustKn + ' kn.'),
            action: tx('تقييم الحاجة لتحذير ساحلي (NAVTEX) وإحالته للجهة المختصة.', 'Assess whether a coastal (NAVTEX) warning is needed and refer it to the competent authority.') });
          delete w.from; delete w.to; delete w.sev; delete w.done;
        }
      }
      // vessel exposure along the planned track (hourly positions vs nearest forecast point within 90 nm)
      const fcs = S.all('forecasts');
      for (const v of S.all('vessels')) {
        if (v.status === 'out_of_area' || !v.pos) continue;
        const pts = [];
        if (v.status === 'underway' || v.status === 'holding') { const r = remaining(v); for (let h = 0; h <= hz; h += 1) { const nm = h * v.speedKn; if (nm > r.nm) break; pts.push({ h, pos: C.pointAlong(r.coords, nm).pos }); } }
        else for (let h = 0; h <= hz; h++) pts.push({ h, pos: v.pos });
        let hit = null;
        for (const x of pts) {
          let best = null, bd = 90; for (const f of fcs) { const d = C.gcNm(x.pos, f.p); if (d < bd) { bd = d; best = f; } }
          if (!best || !best.series[x.h]) continue;
          const port = best.portId ? portOf(best.portId) : null, th = port ? Object.assign({}, settings().thresholds, port.thresholds) : Object.assign({}, SEA_TH, settings().seaThresholds), s0 = best.series[x.h], wl = PR.weatherLevel(s0, th);
          if (PR.rank(wl.level) >= 2 && (!hit || PR.rank(wl.level) > PR.rank(hit.level))) hit = { level: wl.level, x, f: best, s0, why: wl.drivers || [] };
          if (hit && PR.rank(hit.level) >= 4) break;
        }
        if (!hit) continue;
        const cth = hit.f.portId ? settings().thresholds : Object.assign({}, SEA_TH, settings().seaThresholds); const cause = hit.s0.waveM >= cth.waveRestrict ? 'waves' : hit.s0.gustKn >= cth.gustRestrict ? 'wind' : 'visibility';
        const CA = { waves: tx('أمواج عالية', 'High waves'), wind: tx('رياح شديدة', 'Strong winds'), visibility: tx('انخفاض الرؤية', 'Reduced visibility') }[cause];
        preds.push({ key: 'VX:' + v.id, category: 'vessel_exposure', vesselId: v.id, cause, severity: hit.level, area: hit.f.name, position: hit.x.pos, poly: C.circlePoly(hit.x.pos, 12, 12), start: t + hit.x.h * H, end: t + (hit.x.h + 1) * H, peakAt: t + hit.x.h * H, peak: hit.s0.waveM + ' m / ' + hit.s0.gustKn + ' kn / ' + hit.s0.visNm + ' nm',
          confidence: { value: hit.s0.conf, level: hit.s0.conf >= 0.75 ? 'high' : hit.s0.conf >= 0.6 ? 'medium' : 'low' }, sources: [{ kind: 'forecast', id: hit.f.id, provider: hit.f.provider, issuedAt: hit.f.issuedAt, simulated: hit.f.simulated }, { kind: 'ais', id: v.mmsi, provider: tx('موقع ومسار السفينة (محاكاة AIS)', 'Vessel position and track (simulated AIS)'), issuedAt: v.lastAis, simulated: true }],
          explanation: tx(v.name + ' متوقع أن تكون في ' + hit.f.name.ar + ' بعد ' + hit.x.h + ' ساعة حيث يُتوقع ' + CA.ar + ' (موج ' + hit.s0.waveM + ' م، هبات ' + hit.s0.gustKn + ' عقدة، رؤية ' + hit.s0.visNm + ' ميل).', v.name + ' is expected in ' + hit.f.name.en + ' in ' + hit.x.h + ' h where ' + CA.en.toLowerCase() + ' are forecast (waves ' + hit.s0.waveM + ' m, gusts ' + hit.s0.gustKn + ' kn, visibility ' + hit.s0.visNm + ' nm).'),
          action: PR.rank(hit.level) >= 3 ? tx('إصدار إنذار محلي للسفينة واقتراح مسار بديل أو الانتظار في منطقة آمنة.', 'Issue a local alert to the vessel and suggest an alternative route or waiting in a safe area.') : tx('متابعة السفينة وإبلاغها بالأحوال المتوقعة.', 'Monitor the vessel and inform it of expected conditions.') });
      }
      for (const p of S.all('predictions').slice()) S.remove('predictions', p.id);
      for (const p of preds) S.insert('predictions', Object.assign({ id: 'PRD:' + p.key, generatedAt: t, model: 'rules-v1 (prototype)' }, p));
      if (S.get('timelines', 'current')) S.update('timelines', 'current', { data: timelines, at: t }); else S.insert('timelines', { id: 'current', data: timelines, at: t });
    }

    // ---------- Hazard zones (active = official/approved or reported) ----------
    function activeHazards() { const t = now(); return S.all('hazards').filter(h => h.status === 'active' && h.validFrom <= t + 6 * H && h.validTo > t); }
    function createHazard(actor, a) {
      const t = now();
      const hz = { id: uid('HZ'), type: a.type, severity: a.severity || 'high', title: a.title, area: a.area, detail: a.detail, poly: a.poly, validFrom: a.validFrom || t, validTo: a.validTo || t + 24 * H, source: a.source, simulated: a.simulated !== false, status: 'active', createdAt: t, createdBy: actor.username, portId: a.portId || null, eventKey: a.eventKey || null, warningId: a.warningId || null, affects: { ports: [], vessels: [] } };
      S.insert('hazards', hz); audit(actor, 'hazard.create', 'hazard', hz.id, tx('منطقة خطر: ' + hz.title.ar, 'Hazard zone: ' + hz.title.en), { simulated: hz.simulated });
      return hz;
    }

    // ---------- Warnings ----------
    const LEVEL_PREFIX = { LOCAL: 'MRS-L', COASTAL: 'MRS-C', INTERNATIONAL: 'MRS-I' };
    const CAT = { severe_weather: tx('طقس شديد', 'Severe weather'), dangerous_winds: tx('رياح خطرة', 'Dangerous winds'), high_waves: tx('أمواج عالية', 'High waves'), reduced_visibility: tx('انخفاض الرؤية', 'Reduced visibility'),
      navigation_hazard: tx('خطر ملاحي', 'Navigation hazard'), port_closure: tx('إغلاق ميناء', 'Port closure'), port_restriction: tx('قيود تشغيلية على الميناء', 'Port operational restriction'), congestion: tx('ازدحام يؤثر على سلامة الملاحة', 'Congestion affecting safe navigation'), other: tx('إشعار سلامة ملاحية', 'Navigational safety notice') };
    function newWarning(actor, a) {
      const t = now();
      const w = { id: uid('WR'), number: num(LEVEL_PREFIX[a.level], 'w' + a.level), level: a.level, category: a.category, title: a.title, body: a.body, action: a.action || tx('', ''), poly: a.poly, zone: a.zone, portId: a.portId || null,
        issueAt: null, startAt: a.startAt || t, expiryAt: a.expiryAt || t + 24 * H, severity: a.severity || 'high', source: a.source, simulated: !!a.simulated, approvalAuthority: a.level === 'LOCAL' ? tx('ضابط السلامة البحرية المخول بالميناء', 'Authorised port maritime safety officer') : tx('الجهة البحرية المختصة', 'Competent maritime authority'),
        channel: a.level === 'LOCAL' ? 'marsa_app+ais_srm' : a.level === 'COASTAL' ? 'navtex_authorised' : 'navarea_referral', status: a.status || 'draft', history: [{ s: a.status || 'draft', at: t, by: actor.username }],
        officialRef: null, publishedAt: null, replacesId: a.replacesId || null, eventKey: a.eventKey || null, predictionKey: a.predictionKey || null, createdBy: actor.username, createdAt: t, classification: C.classifyWarningLevel(a.poly), verification: null, navareas: [] };
      S.insert('warnings', w); audit(actor, 'warning.create', 'warning', w.id, tx('مسودة تحذير ' + w.number + ' (' + w.level + '): ' + w.title.ar, 'Warning draft ' + w.number + ' (' + w.level + '): ' + w.title.en), { simulated: w.simulated });
      return w;
    }
    function setW(w, status, actor, note, patch = {}) {
      const cur = S.get('warnings', w.id);
      S.update('warnings', w.id, Object.assign({ status, history: cur.history.concat([{ s: status, at: now(), by: actor.username, note: note || null }]) }, patch));
    }
    function messageText(w) { // structured text for authority / printing (English, S-53 style)
      return C.buildStationMessage({ hazard: { type: w.category === 'navigation_hazard' ? 'maritime' : w.category === 'port_closure' ? 'closure' : 'weather', areaEn: w.zone.en, poly: w.poly, detailEn: w.body.en, validFrom: w.startAt, validTo: w.expiryAt, sourceEn: w.source.en, severity: w.severity, simulated: w.simulated }, scope: w.level === 'COASTAL' ? 'REGIONAL' : w.level, station: { en: w.level === 'COASTAL' ? 'Competent maritime authority – NAVTEX workflow' : 'National coordinator – NAVAREA IX referral' }, issuedAt: now() }).text;
    }
    // recipients of a local warning: inside the area, or underway and heading into it before expiry
    function localRecipients(w) {
      const out = [];
      for (const v of S.all('vessels')) {
        if (v.status === 'out_of_area' || !v.pos) continue;
        let why = null;
        if (C.pointInPoly(v.pos, w.poly)) why = 'inside';
        else if (v.status === 'underway' || v.status === 'holding') {
          const r = remaining(v);
          for (let i = 0; i < r.coords.length - 1 && !why; i++) if (!C.VIRTUAL[r.nodes[i]] && C.segmentHitsPoly(r.coords[i], r.coords[i + 1], w.poly)) why = 'approaching';
          if (!why && w.portId && v.destId === w.portId) why = 'approaching';
          if (why === 'approaching' && r.nm / v.speedKn > (w.expiryAt - now()) / H + 6) why = null; // arrives well after expiry
        }
        if (why) out.push({ v, why });
      }
      return out;
    }
    function distribute(w, actor) {
      const t = now();
      const rec = localRecipients(w); let n = 0; const byCo = {};
      for (const { v, why } of rec) {
        if (S.all('deliveries').some(d => d.warningId === w.id && d.vesselId === v.id)) continue;
        const ch = v.noComms ? 'none' : v.bridgeApp ? 'marsa_app' : 'ais_srm', failed = ch === 'none';
        S.insert('deliveries', { id: uid('DL'), warningId: w.id, vesselId: v.id, mmsi: v.mmsi, why, channel: ch, status: failed ? 'failed' : 'sent', sentAt: t, failReason: failed ? tx('تعذر الإرسال: لا توجد قناة اتصال نشطة (آخر إشارة AIS قبل أكثر من ساعتين)', 'Delivery failed: no active channel (last AIS signal over 2 h ago)') : null, deliveredAt: null, receivedAt: null, ackAt: null, ackBy: null, response: null, reason: null, altAction: null, escalatedAt: null, manual: null,
          history: [{ s: failed ? 'failed' : 'sent', at: t, via: ch }], simulated: ch !== 'marsa_app' });
        if (ch === 'marsa_app') notify('local_warning', tx('تحذير محلي: ' + w.title.ar, 'Local warning: ' + w.title.en), w.body, { type: 'warning', id: w.id }, { roles: ['captain'], vesselId: v.id, level: 'critical' });
        (byCo[v.companyId] = byCo[v.companyId] || []).push(v.name);
        n++;
      }
      for (const [co, names] of Object.entries(byCo)) notify('local_warning', tx('تحذير محلي ' + w.number + ' لـ' + names.length + ' من سفنك', 'Local warning ' + w.number + ' for ' + names.length + ' of your vessels'), tx(names.join('، '), names.join(', ')), { type: 'warning', id: w.id }, { roles: ['company'], companyId: co, level: 'warning' });
      S.update('integrations', 'marsa_app', { lastSync: t }); S.update('integrations', 'ais_srm', { lastSync: t });
      audit(actor, 'warning.distribute', 'warning', w.id, tx('توزيع التحذير ' + w.number + ' على ' + n + ' سفن (تطبيق مَرسى / AIS تجريبي)', 'Warning ' + w.number + ' distributed to ' + n + ' vessels (MARSA app / AIS sandbox)'));
      return n;
    }

    // ---------- Routes & recommendations ----------
    function pathFromPos(pos, starts, destNode, ctx) {
      let best = null;
      for (const s of starts) {
        if (!s) continue;
        if (ctx.hazards.some(h => C.segmentHitsPoly(pos, C.NODES[s], h.poly))) continue;
        const p = C.shortestPath(s, destNode, ctx); if (!p) continue;
        const nm = C.gcNm(pos, C.NODES[s]) + p.nm; if (!best || nm < best.nm) best = { nodes: p.nodes, nm };
      }
      return best;
    }
    function hazardsFor(v) {
      const r = remaining(v), out = [], t = now();
      for (const h of activeHazards()) {
        // reached before the hazard ends? (nm along the route to the first crossing / speed)
        let hitNm = null, acc = 0;
        if (C.pointInPoly(r.pos, h.poly)) hitNm = 0;
        for (let i = 0; i < r.coords.length - 1 && hitNm == null; i++) { if (!C.VIRTUAL[r.nodes[i]] && C.segmentHitsPoly(r.coords[i], r.coords[i + 1], h.poly)) hitNm = acc; acc += C.gcNm(r.coords[i], r.coords[i + 1]); }
        if (hitNm == null && h.portId && v.destId === h.portId) hitNm = r.nm;
        if (hitNm != null && t + (hitNm / v.speedKn) * H < h.validTo) out.push(h);
      }
      const d = portOf(v.destId); if (d && !d.virtual && effectiveStatus(d) === 'closed') out.push({ id: 'closed:' + d.id, closedPort: d.id, poly: C.circlePoly(d.p, 8, 10), validTo: d.statusWindow ? d.statusWindow.to : now() + 12 * H, severity: 'high', title: tx('إغلاق ' + d.name.ar, 'Closure of ' + d.name.en) });
      return out;
    }
    const occ = p => p && p.occupancy != null ? Math.min(100, p.occupancy + r1(100 * (p.incoming || 0) / p.berths)) : null;
    function computePlan(v, hz) {
      const rem0 = remaining(v);
      const inside = hz.filter(h => C.pointInPoly(rem0.pos, h.poly)); // already inside: the plan leads out, so those zones do not block the first legs
      const t = now(), ctx = { hazards: hz.filter(h => !inside.includes(h)).map(h => ({ id: h.id, poly: h.poly })), draft: v.draft };
      const rem = rem0, dest = portOf(v.destId), cap = settings().capacityCapPct;
      const metAll = S.all('forecasts').map(f => Object.assign({ p: f.p, areaId: f.areaId || f.portId }, f.series[Math.min(6, f.series.length - 1)]));
      const base = C.voyageCost(v, rem.nm);
      const destBlocked = hz.some(h => h.closedPort === v.destId || (h.portId && h.portId === v.destId) || (dest && C.pointInPoly(dest.p, h.poly)));
      const leaving = inside.length ? [{ k: 'leaving_area', pts: 20 }] : [];
      const current = { coords: rem.coords, nodes: rem.nodes, nm: Math.round(rem.nm), hours: r1(base.hours), fuelT: Math.round(base.fuelT), costSAR: Math.round(base.costSAR), risk: C.scoreRoute(rem.coords, { hazards: ctx.hazards, met: metAll, destOcc: occ(dest) }) };
      if (destBlocked) { current.risk.score = Math.max(current.risk.score, 80); current.risk.level = 'critical'; current.risk.factors.push({ k: 'dest_closed', pts: 80 }); }
      const options = [];
      const fin = (o, waitH = 0, extraCost = 0, extraH = 0, add = []) => {
        const c = C.voyageCost(v, o.nm, waitH); o.hours = r1(c.hours + extraH); o.fuelT = Math.round(c.fuelT); o.costSAR = Math.round(c.costSAR + extraCost);
        o.extraNm = o.nm - current.nm; o.extraHours = r1(o.hours - current.hours); o.extraFuelT = o.fuelT - current.fuelT; o.extraCostSAR = o.costSAR - current.costSAR;
        o.etaAt = t + o.hours * H; const dp = portOf(o.destId);
        const r = C.scoreRoute(o.riskCoords || o.coords, { hazards: ctx.hazards, met: metAll, destOcc: occ(dp), draftMargin: dp ? dp.maxDraft - v.draft : null, longHaul: o.nm > current.nm * 1.6 });
        for (const a of add.concat(leaving)) { r.score = Math.min(100, r.score + a.pts); r.factors.push(a); }
        r.level = r.score >= 75 ? 'critical' : r.score >= 50 ? 'high' : r.score >= 25 ? 'medium' : 'low'; o.risk = r; delete o.riskCoords; options.push(o);
      };
      const mk = (kind, nodes, extra) => Object.assign({ id: uid('OP'), kind, nodes, coords: [rem.pos].concat(C.nodesToCoords(nodes)), nm: Math.round(C.gcNm(rem.pos, C.NODES[nodes[0]]) + C.nodesNm(nodes)) }, extra);
      // 1) modified safe route to the same destination
      if (!destBlocked && dest) { const p = pathFromPos(rem.pos, [rem.nodes[0], rem.prevNode], dest.node, ctx); if (p) { const o = mk('reroute', p.nodes, { destId: v.destId, constraints: [] }); if (p.nodes.some(n => n === 'CPT' || n === 'AGU')) o.constraints.push({ k: 'via_cape' }); if (p.nodes.includes('SCN')) o.constraints.push({ k: 'suez_draft', v: v.draft, max: 20.1 }); fin(o); } }
      // 2) designated waiting area until the hazard ends (+2 h)
      const end = Math.max(...hz.map(h => h.validTo));
      const waitCands = new Set([].concat(dest && dest.waiting ? dest.waiting : [], ['HOLD_JN', 'HOLD_JS', 'HOLD_DN', 'HOLD_RS', 'HOLD_GA', 'HOLD_SLL']));
      let bw = null;
      for (const hn of waitCands) {
        if (ctx.hazards.some(h => C.pointInPoly(C.NODES[hn], h.poly) || C.distPolyToPolyline(h.poly, [C.NODES[hn], C.NODES[hn]]) < 12)) continue;
        const to = pathFromPos(rem.pos, [rem.nodes[0], rem.prevNode], hn, ctx); if (!to || to.nm > 600) continue;
        const after = dest ? C.shortestPath(hn, dest.node, { draft: v.draft }) : null; if (!after) continue;
        const tot = to.nm + after.nm; if (!bw || tot < bw.tot) bw = { hn, to, after, tot };
      }
      if (bw) {
        const arr = bw.to.nm / v.speedKn, waitH = Math.max(0, (end + 2 * H - t) / H - arr);
        const o = mk('wait', bw.to.nodes.concat(bw.after.nodes.slice(1)), { destId: v.destId, holdNode: bw.hn, holdName: C.WAITING_AREAS[bw.hn] || tx(bw.hn, bw.hn), holdNm: Math.round(bw.to.nm), waitHours: r1(waitH), holdUntil: Math.round(t + (arr + waitH) * H), constraints: [{ k: 'designated_area' }, { k: 'depends_on_hazard_end', until: end }] });
        o.riskCoords = [rem.pos].concat(C.nodesToCoords(bw.to.nodes)); fin(o, waitH, 0, 0, [{ k: 'uncertain_duration', pts: 15 }]);
      }
      // 3) alternative port: compatible cargo, draft, open, outside hazards, projected occupancy below cap
      const cands = [];
      for (const p of S.all('ports')) {
        if (p.virtual || p.id === v.destId || effectiveStatus(p) === 'closed') continue;
        if (!p.cargo.includes(v.type)) continue; if (p.maxDraft < v.draft + 0.5) continue;
        if (ctx.hazards.some(h => C.pointInPoly(p.p, h.poly))) continue;
        const proj = occ(p) + r1(100 / p.berths); if (proj >= cap) continue;
        const pr = S.all('predictions').find(x => x.portId === p.id && x.category === 'closure' && x.start < t + 24 * H); if (pr) continue;
        const path = pathFromPos(rem.pos, [rem.nodes[0], rem.prevNode], p.node, ctx); if (!path || path.nm > rem.nm * 2 + 400) continue;
        let landKm = null, landCost = 0, landH = 0;
        if (!dest || !dest.saudi || !p.saudi) continue; landKm = C.roadKm(p.id, dest.id); if (!landKm) continue;
        if (landKm && v.teu) { const trucks = Math.ceil(v.teu * 0.6 / C.ASSUMPTIONS.teuPerTruck); landCost = trucks * landKm * C.ASSUMPTIONS.truckSARperKm; landH = landKm / 60 + 24; }
        cands.push({ p, path, landKm, landCost, landH, proj, rank: path.nm + (landKm || 0) * 0.35 });
      }
      cands.sort((a, b) => a.rank - b.rank);
      for (const c of cands.slice(0, 2)) {
        const pred = S.all('predictions').filter(x => x.portId === c.p.id && PR.rank(x.severity) >= 2);
        const o = mk('alt_port', c.path.nodes, { destId: c.p.id, constraints: [{ k: 'port_capacity', v: r1(c.proj), cap }, { k: 'port_draft', v: c.p.maxDraft, draft: v.draft }, { k: 'cargo_ok', v: v.type }] });
        if (c.landKm) o.constraints.push({ k: 'landside', km: c.landKm, trucks: v.teu ? Math.ceil(v.teu * 0.6 / C.ASSUMPTIONS.teuPerTruck) : null, to: v.destId });
        fin(o, 0, c.landCost, c.landH, pred.length ? [{ k: 'alt_port_weather', pts: 12 }] : []);
      }
      let best = null;
      for (const o of options) { if (o.risk.level === 'critical') continue; o.objective = r1(o.risk.score + Math.max(0, o.extraHours) * 0.05 + Math.max(0, o.extraCostSAR) / 100000); if (!best || o.objective < best.objective) best = o; }
      return { current, options, recommendedOptionId: best ? best.id : null, destBlocked };
    }
    const ACTION_FOR = { reroute: 'reroute', wait: 'wait', alt_port: 'alt_port' };
    const actionName = a => ({ continue: tx('الاستمرار في مسار معدّل آمن', 'Continue on a modified safe route'), reroute: tx('الاستمرار في مسار معدّل آمن', 'Continue on a modified safe route'), wait: tx('الانتظار في منطقة انتظار مخصصة', 'Wait at a designated waiting area'), alt_port: tx('التحويل إلى ميناء بديل', 'Divert to an alternative port'), none: tx('لا يوجد خيار مقبول', 'No acceptable option') })[a] || tx(a, a);
    function rationale(v, plan, opt, hz) {
      const dest = portOf(v.destId), hn = hz.map(h => h.title.ar).join('، '), he = hz.map(h => h.title.en).join(', ');
      if (!opt) return tx('لا يوجد خيار بمستوى مخاطر مقبول ضمن نطاق التغطية. يُوصى بالتواصل مع مركز خدمة حركة السفن وإعادة التقييم عند التحديث.', 'No option within an acceptable risk level. Contact VTS and reassess on the next update.');
      if (opt.kind === 'reroute') return tx('المسار الحالي يتقاطع مع (' + hn + '). المسار المعدّل يتجنبه ويصل إلى ' + dest.name.ar + ' بزيادة ' + fmtN(opt.extraNm) + ' ميل بحري و' + fmtN(opt.extraHours) + ' ساعة.', 'The current route crosses (' + he + '). The modified route avoids it and reaches ' + dest.name.en + ' with +' + fmtN(opt.extraNm) + ' nm and +' + fmtN(opt.extraHours) + ' h.');
      if (opt.kind === 'wait') return tx('الانتظار في ' + opt.holdName.ar + ' نحو ' + fmtN(opt.waitHours) + ' ساعة حتى انتهاء الحالة (' + hn + ')، ثم الدخول بعد إعادة التقييم. يتجنب تكدس المخطاف ويقلل الوقود مقارنة بالتحويل.', 'Wait at the ' + opt.holdName.en + ' for about ' + fmtN(opt.waitHours) + ' h until the condition ends (' + he + '), then enter after reassessment. Avoids anchorage congestion and saves fuel versus diverting.');
      const ap = portOf(opt.destId), land = opt.constraints.find(c => c.k === 'landside');
      return tx('التحويل إلى ' + ap.name.ar + ' بدل ' + dest.name.ar + ': متوافق مع نوع الحمولة والغاطس، والإشغال المتوقع بعد التحويل ' + opt.constraints[0].v + '٪ (الحد ' + opt.constraints[0].cap + '٪)' + (land ? '، مع نقل بري ' + fmtN(land.km) + ' كم' : '') + '.', 'Divert to ' + ap.name.en + ' instead of ' + dest.name.en + ': cargo- and draft-compatible; projected occupancy after diversion ' + opt.constraints[0].v + '% (cap ' + opt.constraints[0].cap + '%)' + (land ? ', with ' + fmtN(land.km) + ' km land transport' : '') + '.');
    }
    function planFor(v, hz, why) {
      const t = now(), pl = computePlan(v, hz), opt = pl.options.find(o => o.id === pl.recommendedOptionId) || null;
      const basis = hz.map(h => ({ kind: 'hazard', id: h.id, label: h.title, at: h.createdAt || t, simulated: h.simulated !== false }));
      const fc = S.get('forecasts', 'P:' + (v.destId || '')) || S.all('forecasts')[0];
      if (fc) basis.push({ kind: 'forecast', id: fc.id, label: tx('توقعات الأرصاد ' + fc.name.ar, 'Met forecast ' + fc.name.en), at: fc.issuedAt, simulated: fc.simulated });
      basis.push({ kind: 'ais', id: v.mmsi, label: tx('موقع AIS للسفينة', 'Vessel AIS position'), at: v.lastAis, simulated: true });
      if (opt && opt.kind === 'alt_port') basis.push({ kind: 'port', id: opt.destId, label: tx('إشغال وطاقة ' + portOf(opt.destId).name.ar, portOf(opt.destId).name.en + ' occupancy and capacity'), at: t, simulated: true });
      const rec = { id: uid('RC'), number: num('REC', 'rec'), vesselId: v.id, companyId: v.companyId, hazardIds: hz.map(h => h.id), warningId: why.warningId || null, key: why.key, current: pl.current, options: pl.options, recommendedOptionId: pl.recommendedOptionId, optionId: pl.recommendedOptionId,
        action: opt ? ACTION_FOR[opt.kind] : 'none', rationale: rationale(v, pl, opt, hz), basis, riskLevel: opt ? opt.risk.level : pl.current.risk.level, riskScore: opt ? opt.risk.score : pl.current.risk.score,
        impact: opt ? { extraHours: opt.extraHours, extraCostSAR: opt.extraCostSAR, extraFuelT: opt.extraFuelT } : null, createdAt: t, validUntil: Math.max(...hz.map(h => h.validTo)), reassessAt: t + 2 * H,
        status: 'pending', history: [{ s: 'pending', at: t, by: 'marsa-engine' }], decisionId: null, released: false, releasedAt: null, response: null };
      S.insert('recs', rec);
      audit(ENGINE, 'rec.create', 'recommendation', rec.id, tx('توصية ' + rec.number + ' للسفينة ' + v.name + ': ' + actionName(rec.action).ar, 'Recommendation ' + rec.number + ' for ' + v.name + ': ' + actionName(rec.action).en));
      // notifications are grouped per evaluation cycle in evaluate()
      return rec;
    }

    // ---------- Engine: from predictions to proposals ----------
    function proposeFromPredictions() {
      const t = now(), st = settings();
      for (const p of S.all('ports').filter(p => p.saudi)) {
        const cl = S.all('predictions').filter(x => x.portId === p.id && x.category === 'closure').sort((a, b) => a.start - b.start)[0];
        if (!cl) continue;
        // one recommendation per weather event: any earlier record whose window overlaps this one (rejected ones included) is the same event
        const open = S.all('closureRecs').find(r => r.portId === p.id && r.type === 'weather' && r.status !== 'superseded' && r.window.to >= cl.start - 6 * H && r.window.from <= cl.end + 6 * H);
        const key = open ? open.eventKey : p.id + ':wx:' + Math.round(cl.start / 60000);
        const tl = (S.get('timelines', 'current') || { data: {} }).data[p.id] || [];
        const fromH = Math.max(0, Math.round((cl.start - t) / H)), toH = Math.min(tl.length - 1, Math.round((cl.end - t) / H));
        const affected = S.all('vessels').filter(v => (v.destId === p.id && ['underway', 'anchored', 'moored', 'holding'].includes(v.status)) || (v.pos && C.gcNm(v.pos, p.p) <= p.localRadiusNm));
        const sim = PR.simulateDecision({ port: p, timeline: tl, from: fromH, to: toH });
        const recommended = cl.severity === 'critical' ? 'close' : 'restrict';
        const drivers = [...new Set(S.all('predictions').filter(x => x.portId === p.id && ['wind', 'waves', 'visibility'].includes(x.category)).map(x => x.category))];
        if (open) { if (open.status === 'pending') S.update('closureRecs', open.id, { simulation: sim, window: { from: cl.start, to: cl.end }, severity: cl.severity, affectedVessels: affected.map(v => v.id), updatedAt: t }); continue; }
        const rec = { id: uid('CR'), number: num('PCR', 'pcr'), portId: p.id, type: 'weather', eventKey: key, predictionKey: cl.key, severity: cl.severity, window: { from: cl.start, to: cl.end }, drivers, capacityMin: (S.all('predictions').find(x => x.portId === p.id && x.category === 'port_disruption') || {}).capacityMin ?? 0.5,
          affectedVessels: affected.map(v => v.id), simulation: sim, recommended, measures: [
            tx('إيقاف الترصيف والمغادرة خلال نافذة الخطر وتأمين السفن على الأرصفة', 'Suspend berthing and departures during the hazard window and secure vessels alongside'),
            tx('توجيه السفن القادمة إلى مناطق الانتظار المخصصة أو موانئ بديلة', 'Direct inbound vessels to designated waiting areas or alternative ports'),
            tx('إعادة جدولة مواعيد بوابة الشاحنات', 'Reschedule truck gate appointments'),
            tx('تجهيز تحذير محلي للسفن داخل منطقة الميناء والقريبة منها', 'Prepare a local warning for vessels in and near the port area')],
          explanation: cl.explanation, status: 'pending', history: [{ s: 'pending', at: t, by: 'marsa-engine' }], createdAt: t, decisionId: null };
        S.insert('closureRecs', rec);
        audit(ENGINE, 'closure.recommend', 'closureRec', rec.id, tx('توصية ' + (recommended === 'close' ? 'إغلاق' : 'تقييد') + ' ' + p.name.ar + ' متوقعة بعد ' + fromH + ' ساعة (' + rec.number + ')', (recommended === 'close' ? 'Closure' : 'Restriction') + ' of ' + p.name.en + ' recommended, expected in ' + fromH + ' h (' + rec.number + ')'));
        notify('approval_request', tx('قرار مطلوب: ' + p.name.ar + ' – احتمال تعطل بعد ' + fromH + ' ساعة', 'Decision needed: ' + p.name.en + ' – disruption expected in ' + fromH + ' h'), cl.explanation, { type: 'closureRec', id: rec.id }, { roles: ['port_manager'], portId: p.id, level: 'critical' });
        notify('weather', tx('تنبؤ: ' + cl.area.ar, 'Prediction: ' + cl.area.en), cl.explanation, { type: 'prediction', id: 'PRD:' + cl.key }, { roles: ['warning_officer', 'port_staff'], portId: p.id, level: 'warning' });
        // local warning draft for vessels in/near the port area
        if (st.autoDraftLocal && !S.all('warnings').some(w => w.eventKey === key && w.level === 'LOCAL')) {
          const drv = drivers.includes('waves') ? 'high_waves' : drivers.includes('wind') ? 'dangerous_winds' : drivers.includes('visibility') ? 'reduced_visibility' : 'severe_weather';
          const peaks = S.all('predictions').filter(x => x.portId === p.id && ['wind', 'waves', 'visibility'].includes(x.category)).map(x => x.peak).join(' · ');
          const w = newWarning(ENGINE, { level: 'LOCAL', category: drv, eventKey: key, predictionKey: cl.key, portId: p.id, poly: C.circlePoly(p.p, st.alertRadiusNm || 50, 24), zone: tx('منطقة ' + p.name.ar + ' والممر الملاحي المقابل (' + (st.alertRadiusNm || 50) + ' ميل)', p.name.en + ' and the adjacent shipping lane (' + (st.alertRadiusNm || 50) + ' nm)'),
            startAt: cl.start, expiryAt: cl.end + 2 * H, severity: cl.severity, status: 'pending_approval', simulated: true,
            title: tx(CAT[drv].ar + ' متوقع في منطقة ' + p.name.ar, CAT[drv].en + ' expected in the ' + p.name.en + ' area'),
            body: tx('تتوقع منصة مَرسى ' + CAT[drv].ar + ' في منطقة ' + p.name.ar + ' (' + peaks + ') خلال النافذة المذكورة، مع احتمال تعليق حركة الدخول والمغادرة.', 'MARSA predicts ' + CAT[drv].en.toLowerCase() + ' in the ' + p.name.en + ' area (' + peaks + ') during the stated window, with possible suspension of entry and departure.'),
            action: tx('خفض السرعة، تجنب الدخول إلى منطقة الميناء دون تنسيق مع مركز خدمة حركة السفن، الانتظار في مناطق الانتظار المخصصة، وتأمين السفن على الأرصفة.', 'Reduce speed, do not enter the port area without VTS coordination, wait at designated waiting areas, and secure vessels alongside.'),
            source: tx('محرك تنبؤ مَرسى (نموذج قواعد أولي) على توقعات المركز الوطني للأرصاد (محاكاة)', 'MARSA prediction engine (rule-based prototype) on NCM forecasts (simulated)') });
          notify('approval_request', tx('تحذير محلي بانتظار اعتمادك: ' + w.number, 'Local warning awaiting your approval: ' + w.number), w.title, { type: 'warning', id: w.id }, { roles: ['warning_officer'], portId: p.id, level: 'critical' });
        }
        // coastal draft when the sea area beyond the port is also affected
        const near = C.MET_AREAS.reduce((b, a) => C.gcNm(a.p, p.p) < C.gcNm(b.p, p.p) ? a : b);
        const sea = S.all('predictions').find(x => x.areaId === near.id && x.category === 'sea_state');
        if (sea && !S.all('navnotices').some(n => n.eventKey === key)) noticeFromNcm({ eventKey: key, poly: sea.poly, zone: sea.area, start: sea.start, end: sea.end, severity: sea.severity, explanation: sea.explanation, areaId: near.id });
      }
    }

    // ---------- Navigational notices & warnings (prepared by MARSA, routed to ports / Karachi; broadcast is theirs) ----------
    const NOTICE_ACK_MS = 8000;
    function noticeRecipients(poly, scope) {
      const sa = S.all('ports').filter(p => p.saudi);
      let ports = sa.filter(p => C.pointInPoly(p.p, poly) || C.distPolyToPolyline(poly, [p.p, p.p]) <= 60);
      if (!ports.length) ports = [sa.reduce((b, p) => C.distPolyToPolyline(poly, [p.p, p.p]) < C.distPolyToPolyline(poly, [b.p, b.p]) ? p : b)];
      const out = ports.map(p => ({ to: 'PORT:' + p.id, kind: 'port', name: p.name }));
      if (scope === 'INTERNATIONAL') out.push({ to: 'KHI', kind: 'karachi', name: tx('محطة كراتشي – منسق NAVAREA IX', 'Karachi station – NAVAREA IX coordinator') });
      return out;
    }
    function newNotice(actor, a) {
      const t = now(), cls = C.classifyWarningLevel(a.poly), scope = cls.levels.includes('INTERNATIONAL') ? 'INTERNATIONAL' : cls.levels.includes('COASTAL') ? 'COASTAL' : 'LOCAL';
      const n = { id: uid('NN'), number: num(a.kind === 'periodic' ? 'MRS-B' : 'MRS-N', 'nn'), kind: a.kind || 'warning', category: a.category || 'severe_weather', title: a.title, body: a.body, action: a.action || tx('', ''), poly: a.poly, zone: a.zone, scope, classification: cls,
        startAt: a.startAt || t, expiryAt: a.expiryAt || t + 24 * H, severity: a.severity || 'high', source: a.source, simulated: !!a.simulated, eventKey: a.eventKey || null, rows: a.rows || null,
        status: 'drafting', history: [{ s: 'drafting', at: t, by: actor.username }], recipients: [], suggested: noticeRecipients(a.poly, scope), officialRef: null, officialBy: null, createdAt: t, createdBy: actor.username, messageText: null };
      n.messageText = C.buildStationMessage({ hazard: { type: n.category === 'navigation_hazard' ? 'maritime' : 'weather', areaEn: n.zone.en, poly: n.poly, detailEn: n.body.en, validFrom: n.startAt, validTo: n.expiryAt, sourceEn: n.source.en, severity: n.severity, simulated: n.simulated }, scope: scope === 'COASTAL' ? 'REGIONAL' : scope, station: { en: 'Concerned Saudi ports' + (scope === 'INTERNATIONAL' ? ' / Karachi (NAVAREA IX coordinator)' : '') }, issuedAt: t }).text;
      S.insert('navnotices', n);
      audit(actor, 'notice.create', 'notice', n.id, tx('إنشاء نشرة/إشعار ملاحي ' + n.number + ': ' + n.title.ar, 'Navigational notice ' + n.number + ' created: ' + n.title.en), { simulated: n.simulated });
      return n;
    }
    function setN(n, status, actor, note, patch = {}) { const cur = S.get('navnotices', n.id); S.update('navnotices', n.id, Object.assign({ status, history: cur.history.concat([{ s: status, at: now(), by: actor.username, note: note || null }]) }, patch)); }
    function noticeFromNcm(e) {
      const t = now(), area = e.zone;
      const n = newNotice(ENGINE, { kind: 'warning', category: 'severe_weather', eventKey: e.eventKey, poly: e.poly, zone: area, startAt: e.start, expiryAt: e.end, severity: e.severity, simulated: true,
        title: tx('تحذير ملاحي: طقس بحري شديد في ' + area.ar, 'Navigational warning: severe marine weather in ' + area.en), body: e.explanation,
        action: tx('ينصح الملاحون بتجنب المنطقة أو اتخاذ الحيطة.', 'Mariners are advised to avoid the area or exercise caution.'), source: tx('تحليل مَرسى لتوقعات وتحذيرات المركز الوطني للأرصاد (محاكاة)', 'MARSA analysis of NCM forecasts and warnings (simulated)') });
      setN(n, 'ready', ENGINE, 'analysis complete');
      notify('regional_workflow', tx('نشرة ملاحية جاهزة للإرسال: ' + n.number, 'Navigational notice ready to send: ' + n.number), n.title, { type: 'notice', id: n.id }, { roles: ['warning_officer'], level: 'warning' });
      if (settings().autoRoute) routeNotice(ENGINE, n.id, null);
    }
    function routeNotice(actor, id, list) {
      const n = S.get('navnotices', id), t = now();
      const rc = (list && list.length ? list : n.suggested.map(x => x.to)).map(to => { const s0 = n.suggested.find(x => x.to === to); const p = to.startsWith('PORT:') ? portOf(to.slice(5)) : null;
        return { to, kind: to === 'KHI' ? 'karachi' : 'port', name: s0 ? s0.name : p ? p.name : tx('محطة كراتشي – منسق NAVAREA IX', 'Karachi station – NAVAREA IX coordinator'), channel: to === 'KHI' ? 'karachi' : 'ports_channel', status: 'sent', sentAt: t, ackAt: null, ackRef: null, simulated: true }; });
      const hist = n.history.concat(rc.some(r => r.kind === 'port') ? [{ s: 'sent_port', at: t, by: actor.username }] : []).concat(rc.some(r => r.kind === 'karachi') ? [{ s: 'sent_karachi', at: t, by: actor.username }] : []);
      S.update('navnotices', n.id, { status: 'sent', recipients: rc, routedAt: t, routedBy: actor.username, history: hist });
      for (const r of rc) { const integ = S.get('integrations', r.channel); if (integ) S.update('integrations', r.channel, { lastSync: t, records: (integ.records || 0) + 1 }); intLog(r.channel, 'info', n.number + ' → ' + r.to + ' (sandbox)'); }
      audit(actor, 'notice.route', 'notice', n.id, tx('توجيه ' + n.number + ' آليًا إلى: ' + rc.map(r => r.name.ar).join('، ') + ' (قناة تجريبية)', n.number + ' routed to: ' + rc.map(r => r.name.en).join(', ') + ' (sandbox channel)'), { simulated: true });
    }
    function progressNotices() {
      const t = now();
      for (const n of S.all('navnotices')) {
        if (n.status !== 'sent') continue;
        let changed = false; const rc = n.recipients.map(r => { if (!r.ackAt && t - r.sentAt >= NOTICE_ACK_MS) { changed = true; return Object.assign({}, r, { status: 'acknowledged', ackAt: t, ackRef: 'SIM-ACK-' + n.number.slice(-4) + '-' + r.to.replace('PORT:', ''), }); } return r; });
        if (!changed) continue;
        S.update('navnotices', n.id, { recipients: rc });
        if (rc.every(r => r.ackAt)) {
          const cur = S.get('navnotices', n.id);
          S.update('navnotices', n.id, { status: 'awaiting_official', history: cur.history.concat([{ s: 'acknowledged', at: t, by: 'sandbox' }, { s: 'awaiting_official', at: t, by: 'sandbox' }]) });
          audit(INTEG('sandbox'), 'notice.ack', 'notice', n.id, tx('تأكيد استلام ' + n.number + ' من جميع الجهات (محاكاة) – بانتظار الإصدار الرسمي', n.number + ' receipt confirmed by all recipients (simulated) – awaiting official issuance'));
          notify('regional_workflow', tx('تأكيد استلام ' + n.number + ' – بانتظار الإصدار الرسمي', n.number + ' received – awaiting official issuance'), n.title, { type: 'notice', id: n.id }, { roles: ['warning_officer'], level: 'info' });
        }
      }
    }

    // ---------- Evaluation loop ----------
    function evaluate() {
      const t = now(), st = settings();
      for (const h of S.all('hazards')) if (h.status === 'active' && h.validTo <= t) { S.update('hazards', h.id, { status: 'expired' }); audit(SYS, 'hazard.expire', 'hazard', h.id, tx('انتهاء منطقة الخطر: ' + h.title.ar, 'Hazard zone ended: ' + h.title.en)); }
      for (const w of S.all('warnings')) if (['distributed', 'published', 'updated', 'approved', 'ready_for_transmission'].includes(w.status) && w.expiryAt <= t) setW(w, 'expired', SYS);
      for (const p of S.all('ports')) if (p.statusWindow && p.statusWindow.to && t > p.statusWindow.to && p.status !== 'open') { S.update('ports', p.id, { status: 'open', statusWindow: null, statusReason: null }); audit(SYS, 'port.reopen.auto', 'port', p.id, tx('انتهت نافذة القرار وعاد ' + p.name.ar + ' للتشغيل', 'Decision window ended; ' + p.name.en + ' back in operation')); }
      for (const r of S.all('recs')) if (['pending', 'approved', 'more_analysis'].includes(r.status) && r.validUntil <= t) S.update('recs', r.id, { status: 'expired' });
      // hazard affects
      for (const h of activeHazards()) S.update('hazards', h.id, { affects: { ports: S.all('ports').filter(p => !p.virtual && C.pointInPoly(p.p, h.poly)).map(p => p.id), vessels: S.all('vessels').filter(v => v.pos && (C.pointInPoly(v.pos, h.poly) || hazardsFor(v).some(x => x.id === h.id))).map(v => v.id) } });
      proposeFromPredictions(); progressNotices();
      const newRecs = [];
      // route recommendations for underway vessels exposed to active hazards / closed destination
      for (const v of S.all('vessels')) {
        if (v.status !== 'underway') continue;
        const hz = hazardsFor(v); if (!hz.length) continue;
        const key = v.id + '|' + hz.map(h => h.id).sort().join(',') + '|' + v.destId;
        if (S.all('recs').some(r => r.key === key && r.status !== 'superseded')) continue;
        if (S.all('recs').some(r => r.vesselId === v.id && r.response && r.response.kind === 'accepted' && r.status === 'released' && r.validUntil > t)) continue;
        for (const r of S.all('recs').filter(r => r.vesselId === v.id && ['pending', 'more_analysis'].includes(r.status))) S.update('recs', r.id, { status: 'superseded' });
        const w = S.all('warnings').find(x => x.status === 'distributed' && hz.some(h => h.warningId === x.id));
        const rec = planFor(v, hz, { key, warningId: w ? w.id : null });
        const o = rec.options.find(x => x.id === rec.recommendedOptionId);
        if (st.autoReleaseRoutes && w && o && ['low', 'medium'].includes(o.risk.level)) {
          // released under the officer's approval of the MARSA local alert; enough data → advisory sent with the alert
          const by = S.all('users').find(x => x.username === w.approvedBy) || SYS;
          const d = record('route', rec.id, 'approve', by, { previous: { status: 'pending' }, note: 'auto-release with local alert ' + w.number, disclaimer: true, supporting: { warning: w.number, risk: o.risk } });
          S.update('recs', rec.id, { status: 'released', released: true, releasedAt: t, autoReleased: true, decisionId: d.id, verification: d.verification, history: rec.history.concat([{ s: 'released', at: t, by: 'auto (' + w.number + ')' }]) });
          notify('route_rec', tx('مسار بديل مقترح لسفينتك', 'Alternative route suggested for your vessel'), rec.rationale, { type: 'rec', id: rec.id }, { roles: ['captain'], vesselId: v.id, level: 'critical' });
          audit(ENGINE, 'rec.auto_release', 'recommendation', rec.id, tx('إرسال المسار البديل ' + rec.number + ' مع الإنذار ' + w.number + ' (خطر ' + o.risk.level + ')', 'Alternative route ' + rec.number + ' sent with alert ' + w.number + ' (risk ' + o.risk.level + ')'));
        } else newRecs.push(rec);
      }
      if (newRecs.length) {
        const names = newRecs.map(r => vesselOf(r.vesselId).name);
        notify('approval_request', tx(newRecs.length + ' توصيات مسار جديدة بانتظار القرار', newRecs.length + ' new route recommendations awaiting decision'), tx(names.join('، '), names.join(', ')), { type: 'rec', id: newRecs[0].id }, { roles: ['port_manager', 'warning_officer'], level: 'warning' });
        const byCo = {}; for (const r of newRecs) (byCo[r.companyId] = byCo[r.companyId] || []).push(r);
        for (const [co, rs] of Object.entries(byCo)) notify('route_rec', tx(rs.length + ' من سفن أسطولك متأثرة', rs.length + ' fleet vessels affected'), tx(rs.map(r => vesselOf(r.vesselId).name).join('، '), rs.map(r => vesselOf(r.vesselId).name).join(', ')), { type: 'rec', id: rs[0].id }, { roles: ['company'], companyId: co, level: 'warning' });
      }
      // acknowledgement timeouts → escalation
      const lim = st.ackTimeoutMin * MIN, esc = {};
      for (const d of S.all('deliveries')) {
        if (d.ackAt || d.escalatedAt || ['cancelled', 'failed'].includes(d.status)) continue;
        if (t - d.sentAt >= lim) {
          const v = vesselOf(d.vesselId), w = S.get('warnings', d.warningId);
          S.update('deliveries', d.id, { status: 'unacknowledged', escalatedAt: t, history: d.history.concat([{ s: 'unacknowledged', at: t }, { s: 'escalated', at: t }]) });
          audit(SYS, 'ack.escalate', 'delivery', d.id, tx('لم تؤكد السفينة ' + v.name + ' اطلاعها على ' + w.number + ' خلال ' + st.ackTimeoutMin + ' دقائق – تصعيد', v.name + ' did not acknowledge ' + w.number + ' within ' + st.ackTimeoutMin + ' min – escalated'));
          (esc[w.id] = esc[w.id] || { w, names: [], d }).names.push(v.name);
        }
      }
      for (const { w, names, d } of Object.values(esc)) notify('ack_update', tx('تصعيد: ' + names.length + ' سفن لم تؤكد الاطلاع على ' + w.number, 'Escalation: ' + names.length + ' vessels have not acknowledged ' + w.number), tx(names.join('، ') + ' — تواصل عبر VHF أو الوكيل الملاحي وسجّل النتيجة.', names.join(', ') + ' — contact by VHF or the agent and record the outcome.'), { type: 'delivery', id: d.id }, { roles: ['warning_officer', 'port_manager'], portId: w.portId, level: 'critical' });
      // incoming diversions & trucks
      const inc = {};
      for (const r of S.all('recs')) if (r.status === 'released' && r.response && r.response.kind === 'accepted') { const o = r.options.find(x => x.id === r.optionId); if (o && o.kind === 'alt_port') inc[o.destId] = (inc[o.destId] || 0) + 1; }
      for (const p of S.all('ports')) if ((p.incoming || 0) !== (inc[p.id] || 0)) S.update('ports', p.id, { incoming: inc[p.id] || 0 });
      for (const tr of S.all('trucks')) {
        const p = portOf(tr.portId), es = effectiveStatus(p), pred = S.all('predictions').find(x => x.portId === p.id && x.category === 'closure');
        const inWin = (p.statusWindow && tr.slotAt >= p.statusWindow.from && tr.slotAt <= p.statusWindow.to) || es !== 'open' || (pred && tr.slotAt >= pred.start && tr.slotAt <= pred.end);
        if (inWin && tr.status === 'scheduled') { S.update('trucks', tr.id, { status: 'at_risk', note: pred && es === 'open' && !p.statusWindow ? tx('تعطل متوقع في الميناء وقت الموعد (تنبؤ)', 'Port disruption predicted at slot time (prediction)') : tx('موعد البوابة يقع ضمن نافذة إغلاق أو تقييد', 'Gate slot falls within a closure/restriction window') }); notify('port_status', tx('موعد بوابة متأثر: ' + tr.plate, 'Gate slot affected: ' + tr.plate), tx(p.name.ar, p.name.en), { type: 'truck', id: tr.id }, { roles: ['truck'], companyId: tr.companyId, level: 'warning' }); }
        if (!inWin && tr.status === 'at_risk') S.update('trucks', tr.id, { status: 'scheduled', note: null });
      }
    }

    // ---------- Bulletins (periodic marine weather, kept from v1) ----------
    function issuePeriodicBulletin(actor) {
      const t = now();
      for (const b of S.all('bulletins')) if (b.status === 'published') S.update('bulletins', b.id, { status: 'superseded' });
      const rows = S.all('forecasts').filter(f => f.kind === 'area').map(f => { const s = f.series[0], th = settings().thresholds, l = PR.weatherLevel(s, th).level; return { areaId: f.areaId, area: f.name, windKn: s.windKn, gustKn: s.gustKn, windDir: s.windDir, waveM: s.waveM, visNm: s.visNm, level: l, max24: Math.max(...f.series.slice(0, 25).map(x => x.waveM)) }; });
      const b = { id: uid('BL'), kind: 'periodic', category: 'weather', number: num('MB-P', 'blp'), title: tx('النشرة البحرية الدورية', 'Periodic marine bulletin'), summary: tx('ملخص الأحوال البحرية وأعلى ارتفاع موج متوقع خلال ٢٤ ساعة لكل منطقة. هذه نشرة إرشادية وليست تحذيرًا ملاحيًا.', 'Sea conditions and the highest wave expected within 24 h per area. Advisory bulletin, not a navigational warning.'), rows, issuedAt: t, validTo: t + 12 * H, status: 'published', simulated: true, issuedBy: actor.username };
      S.insert('bulletins', b); audit(actor, 'bulletin.publish', 'bulletin', b.id, tx('إصدار ' + b.number, 'Issued ' + b.number)); return b;
    }

    // ---------- Scenarios ----------
    const SCEN = {
      jed_storm: {
        title: tx('طقس شديد يؤثر على ميناء جدة الإسلامي خلال ٦ ساعات', 'Severe weather expected at Jeddah Islamic Port within 6 hours'),
        run(actor) {
          const t = now();
          ncm.addEvent && ncm.addEvent({ center: [39.0, 21.45], radiusNm: 75, start: t + 3 * H, peakStart: t + 6.5 * H, peakEnd: t + 20 * H, end: t + 30 * H, waveM: 3.7, gustKn: 37, windKn: 28, visNm: 1.8, rainMm: 14,
            warning: tx('تحذير أرصاد: رياح شديدة وأمواج عالية على وسط البحر الأحمر', 'Met warning: strong winds and high waves over the central Red Sea') });
          audit(actor, 'scenario.start', 'scenario', 'jed_storm', tx('بدء سيناريو الطقس الشديد في جدة', 'Jeddah severe-weather scenario started'));
          S.update('meta', 'meta', { scenario: { id: 'jed_storm', startedAt: t } });
          pullForecast(t);
          audit(INTEG('ncm'), 'forecast.update', 'integration', 'ncm', tx('استقبال تحديث توقعات من المركز الوطني للأرصاد (محاكاة) يتضمن تحذيرًا جويًا لوسط البحر الأحمر', 'Forecast update received from NCM (simulated) including a met warning for the central Red Sea'));
          runPredictions();
        }
      },
      bab: {
        title: tx('تهديد أمني في مضيق باب المندب (خارج النطاق الساحلي)', 'Security threat in Bab el-Mandeb (beyond coastal coverage)'),
        run(actor) {
          const t = now();
          S.update('meta', 'meta', { scenario: { id: 'bab', startedAt: t } });
          const hz = createHazard(INTEG('security'), { type: 'security', severity: 'critical', poly: [[42.55, 13.75], [43.75, 13.55], [44.35, 12.45], [43.65, 11.95], [42.85, 12.35]], validTo: t + 96 * H,
            title: tx('تهديد أمني بحري في مضيق باب المندب', 'Maritime security threat in Bab el-Mandeb Strait'), area: tx('مضيق باب المندب ومقارباته', 'Bab el-Mandeb Strait and approaches'),
            detail: tx('بلاغ عن تهديد أمني للسفن العابرة. يُنصح بتجنب المنطقة حتى إشعار آخر.', 'Reported security threat to transiting ships. Avoid the area until further notice.'), source: tx('جهة مختصة بالأمن البحري (محاكاة)', 'Maritime security authority (simulated)') });
          const n = newNotice(ENGINE, { kind: 'warning', category: 'navigation_hazard', eventKey: 'bab:' + hz.id, poly: hz.poly, zone: hz.area, startAt: t, expiryAt: hz.validTo, severity: 'critical', title: hz.title, body: hz.detail, action: tx('ينصح الملاحون بتجنب المنطقة.', 'Mariners are advised to avoid the area.'), source: hz.source, simulated: true });
          setN(n, 'ready', ENGINE, 'analysis complete'); if (settings().autoRoute) routeNotice(ENGINE, n.id, null);
        }
      }
    };

    // ---------- Snapshot (role-filtered) ----------
    function publicUser(u) { const { password, pwHash, ...r } = u; return r; }
    function snapshot(user) {
      const t = now(), m = meta(), role = user.role;
      let vessels = S.all('vessels');
      if (role === 'captain') vessels = vessels.filter(v => v.id === user.vesselId);
      else if (role === 'company') vessels = vessels.filter(v => v.companyId === user.companyId);
      else if (['truck', 'authority'].includes(role)) vessels = [];
      const vids = new Set(vessels.map(v => v.id));
      const ops = ['admin', 'port_manager', 'warning_officer', 'port_staff'].includes(role);
      const warnings = S.all('warnings').filter(w => role === 'authority' ? w.level !== 'LOCAL' || w.status !== 'draft' : role === 'captain' ? S.all('deliveries').some(d => d.warningId === w.id && d.vesselId === user.vesselId) : ['truck'].includes(role) ? (w.level === 'LOCAL' && w.status === 'distributed') : true);
      const deliveries = S.all('deliveries').filter(d => ops || role === 'admin' ? true : vids.has(d.vesselId));
      const recs = S.all('recs').filter(r => ops ? true : role === 'captain' ? r.vesselId === user.vesselId && r.released : role === 'company' ? vids.has(r.vesselId) : false);
      const notes = S.all('notifications').filter(n => forUser(n, user)).slice(-200);
      const sa = S.all('ports').filter(p => p.saudi);
      const preds = S.all('predictions');
      const kpi = {
        monitoredVessels: S.all('vessels').filter(v => v.status !== 'out_of_area').length,
        activeLocal: S.all('warnings').filter(w => w.level === 'LOCAL' && w.status === 'distributed').length,
        pendingAcks: S.all('deliveries').filter(d => !d.ackAt && d.status !== 'cancelled').length,
        restrictedPorts: sa.filter(p => effectiveStatus(p) !== 'open' || p.statusWindow).length,
        predicted48: preds.filter(p => PR.rank(p.severity) >= 2 && p.category !== 'vessel_delay').length,
        pendingApprovals: S.all('closureRecs').filter(r => r.status === 'pending').length + S.all('warnings').filter(w => w.status === 'pending_approval' || (w.status === 'pending_review' && role === 'authority')).length + S.all('recs').filter(r => r.status === 'pending').length
      };
      const integrations = S.all('integrations').map(i => { const { credential, ...r } = i; return r; });
      return {
        version: m.version, now: t, me: publicUser(user), scenario: m.scenario, settings: settings(), kpi, disclaimer: DISCLAIMER, roles: ROLES, perms: PERMS[role],
        ports: S.all('ports').map(p => Object.assign({}, p, { effectiveStatus: effectiveStatus(p) })), stations: S.all('stations').length ? S.all('stations') : C.STATIONS.map(s => ({ id: s.id, role: s.role, navarea: s.navarea, name: tx(s.ar, s.en), country: s.country, p: s.p, b1: s.b1, rangeNm: s.rangeNm })),
        vessels: vessels.map(v => Object.assign({}, v, { etaH: etaH(v) })), hazards: S.all('hazards'), predictions: role === 'captain' || role === 'truck' ? preds.filter(p => role === 'truck' ? p.portId && ['closure', 'port_disruption'].includes(p.category) : p.vesselId === user.vesselId) : preds,
        timelines: ops || role === 'authority' ? (S.get('timelines', 'current') || { data: {} }).data : {}, forecasts: S.all('forecasts'), met: ops ? S.all('met').slice(-600) : [],
        closureRecs: ops ? S.all('closureRecs') : [], warnings, deliveries, recs, decisions: ops || role === 'authority' ? S.all('decisions') : S.all('decisions').filter(d => recs.some(r => r.id === d.refId)),
        notifications: notes, navnotices: ['admin', 'warning_officer', 'port_manager', 'authority'].includes(role) ? S.all('navnotices') : [], bulletins: S.all('bulletins'), trucks: role === 'truck' ? S.all('trucks').filter(x => x.companyId === user.companyId) : (ops ? S.all('trucks') : []),
        audit: ['admin', 'port_manager', 'warning_officer', 'authority'].includes(role) ? S.all('audit').slice(-500) : [], organizations: S.all('organizations'), integrations, integrationLogs: role === 'admin' ? S.all('integrationLogs').slice(-100) : [],
        users: role === 'admin' ? S.all('users').map(publicUser) : [], appVessels: S.all('users').filter(u => u.role === 'captain' && u.active).map(u => u.vesselId)
      };
    }

    // ---------- Public API (permission-checked, audited) ----------
    const touch = () => { evaluate(); bump(); };
    const api = {
      snapshot: u => snapshot(u),
      runScenario(u, { id }) { need(u, 'scenario:run'); const s = SCEN[id]; if (!s) throw new ValidationError('scenario'); audit(u, 'scenario.run', 'scenario', id, tx('تشغيل سيناريو: ' + s.title.ar, 'Scenario: ' + s.title.en)); s.run(u); touch(); return { ok: true }; },
      resetDemo(u) { need(u, 'scenario:run'); ncm.clear && ncm.clear(); seed(); audit(u, 'system.reset', 'system', null, tx('إعادة ضبط بيئة العرض', 'Demo environment reset')); bump(); return { ok: true }; },
      markRead(u, { ids, all }) { for (const n of S.all('notifications')) if ((all || (ids || []).includes(n.id)) && forUser(n, u) && !n.readBy.includes(u.id)) S.update('notifications', n.id, { readBy: n.readBy.concat([u.id]) }); bump(); return { ok: true }; },
      recordLogin(u) { audit(u, 'auth.login', 'user', u.id, tx('تسجيل دخول', 'Signed in'), { simulated: false }); return { ok: true }; },
      verifyAudit(u) { if (!['admin', 'port_manager', 'warning_officer', 'authority'].includes(u.role)) throw new PermissionError('audit'); return verifyAudit(); },

      // Ports
      updatePortOps(u, a) {
        needPort(u, 'port:update', a.portId); const p = portOf(a.portId); if (!p || !p.saudi) throw new ValidationError('port');
        const patch = { opsUpdatedAt: now(), opsUpdatedBy: u.username };
        if (a.availableBerths != null) { const n = Number(a.availableBerths); if (!(n >= 0 && n <= p.berths)) throw new ValidationError('availableBerths'); patch.availableBerths = n; }
        if (a.avgBerthHours != null) { const n = Number(a.avgBerthHours); if (!(n >= 4 && n <= 120)) throw new ValidationError('avgBerthHours'); patch.avgBerthHours = n; }
        if (a.occupancy != null) { const n = Number(a.occupancy); if (!(n >= 0 && n <= 100)) throw new ValidationError('occupancy'); patch.occupancy = n; }
        if (Array.isArray(a.terminals)) patch.terminals = a.terminals.map(x => ({ name: String(x.name).slice(0, 80), available: !!x.available }));
        if (a.reopenConditions != null) patch.reopenConditions = String(a.reopenConditions).slice(0, 500);
        if (a.thresholds) { if (u.role !== 'admin' && u.role !== 'port_manager') throw new PermissionError('thresholds'); const th = Object.assign({}, p.thresholds); for (const k of Object.keys(C.DEFAULT_THRESHOLDS)) if (a.thresholds[k] != null) { const n = Number(a.thresholds[k]); if (!(n > 0 && n < 100)) throw new ValidationError('threshold ' + k); th[k] = n; } patch.thresholds = th; }
        S.update('ports', p.id, patch); audit(u, 'port.ops_update', 'port', p.id, tx('تحديث البيانات التشغيلية لـ' + p.name.ar, 'Operational data updated for ' + p.name.en), { simulated: false, details: JSON.stringify(patch) });
        runPredictions(); touch(); return { ok: true };
      },
      reportRestriction(u, a) {
        needPort(u, 'port:update', a.portId); const p = portOf(a.portId); const t = now();
        const types = ['terminal_malfunction', 'equipment_failure', 'berth_unavailable', 'congestion', 'infrastructure', 'incident', 'other']; if (!types.includes(a.type)) throw new ValidationError('type');
        if (!a.description || String(a.description).trim().length < 5) throw new ValidationError('description');
        const from = Number(a.from) || t, to = Number(a.to) || t + 12 * H; if (to <= from) throw new ValidationError('window');
        const sim = PR.simulateDecision({ port: p, timeline: (S.get('timelines', 'current') || { data: {} }).data[p.id] || [], from: Math.max(0, Math.round((from - t) / H)), to: Math.round((to - t) / H) });
        const rec = { id: uid('CR'), number: num('PCR', 'pcr'), portId: p.id, type: 'operational', opType: a.type, description: String(a.description).slice(0, 600), navSafety: !!a.navSafety, severity: a.capacityImpact >= 0.8 ? 'high' : 'moderate', window: { from, to },
          capacityMin: 1 - (Number(a.capacityImpact) || 0.3), affectedVessels: S.all('vessels').filter(v => v.destId === p.id && v.status !== 'out_of_area').map(v => v.id), simulation: sim, recommended: (Number(a.capacityImpact) || 0) >= 0.8 ? 'close' : 'restrict',
          measures: [tx('إعادة جدولة الترصيف حسب الأرصفة المتاحة', 'Reschedule berthing to available berths'), tx('إبلاغ السفن القادمة والوكلاء الملاحيين', 'Inform inbound vessels and shipping agents')], explanation: tx('بلاغ تشغيلي من ' + u.name.ar + ': ' + a.description, 'Operational report by ' + u.name.en + ': ' + a.description),
          status: 'pending', history: [{ s: 'pending', at: t, by: u.username }], createdAt: t, reportedBy: u.username, decisionId: null };
        S.insert('closureRecs', rec); audit(u, 'port.restriction_report', 'closureRec', rec.id, tx('بلاغ قيد تشغيلي على ' + p.name.ar + ': ' + a.description, 'Operational restriction reported at ' + p.name.en + ': ' + a.description), { simulated: false });
        notify('approval_request', tx('بلاغ تشغيلي يحتاج قرارًا: ' + p.name.ar, 'Operational report needs a decision: ' + p.name.en), rec.explanation, { type: 'closureRec', id: rec.id }, { roles: ['port_manager'], portId: p.id, level: 'warning' });
        touch(); return rec;
      },
      decideClosure(u, a) {
        const r = S.get('closureRecs', a.id); if (!r) throw new ValidationError('id'); needPort(u, 'port:decide', r.portId);
        if (!['pending', 'more_analysis'].includes(r.status)) throw new ValidationError('state');
        const p = portOf(r.portId), t = now(), prev = { status: r.status, recommended: r.recommended, window: r.window };
        if (a.decision === 'more_analysis') {
          runPredictions(); const tl = (S.get('timelines', 'current') || { data: {} }).data[p.id] || [];
          S.update('closureRecs', r.id, { status: 'pending', simulation: PR.simulateDecision({ port: p, timeline: tl, from: Math.max(0, Math.round((r.window.from - t) / H)), to: Math.round((r.window.to - t) / H) }), history: r.history.concat([{ s: 'more_analysis', at: t, by: u.username, note: a.note || null }, { s: 'pending', at: now(), by: 'marsa-engine', note: 'analysis refreshed' }]) });
          const d = record('closure', r.id, 'more_analysis', u, { previous: prev, note: a.note }); audit(u, 'closure.more_analysis', 'closureRec', r.id, tx('طلب تحليل إضافي لـ' + r.number, 'Additional analysis requested for ' + r.number), { simulated: false, details: d.number }); touch(); return d;
        }
        needDisclaimer(a);
        if (a.decision === 'reject') {
          S.update('closureRecs', r.id, { status: 'rejected', history: r.history.concat([{ s: 'rejected', at: t, by: u.username, note: a.note || null }]) });
          const d = record('closure', r.id, 'reject', u, { previous: prev, note: a.note, disclaimer: true }); S.update('closureRecs', r.id, { decisionId: d.id });
          audit(u, 'closure.reject', 'closureRec', r.id, tx('رفض توصية ' + r.number + ' – الاستمرار في التشغيل', 'Recommendation ' + r.number + ' rejected – operations continue'), { simulated: false, details: d.number }); touch(); return d;
        }
        if (!['close', 'restrict', 'continue'].includes(a.decision)) throw new ValidationError('decision');
        const from = Number(a.from) || r.window.from, to = Number(a.to) || r.window.to; if (to <= from) throw new ValidationError('window');
        const mods = a.decision !== r.recommended || from !== r.window.from || to !== r.window.to ? { decision: a.decision, recommended: r.recommended, window: { from, to } } : null;
        S.update('closureRecs', r.id, { status: 'approved', decided: a.decision, decidedWindow: { from, to }, history: r.history.concat([{ s: 'approved', at: t, by: u.username, note: a.note || null }]) });
        const d = record('closure', r.id, a.decision, u, { previous: prev, modifications: mods, note: a.note, disclaimer: true, supporting: { predictionKey: r.predictionKey, simulation: r.simulation } });
        S.update('closureRecs', r.id, { decisionId: d.id });
        if (a.decision !== 'continue') {
          S.update('ports', p.id, { status: a.decision === 'close' ? 'closed' : 'restricted', statusWindow: { from, to }, statusReason: r.type === 'weather' ? tx('ظروف جوية وبحرية', 'Weather and sea conditions') : tx(r.description, r.description), statusBy: u.username, statusAt: t, decisionId: d.id });
          // operational notice + navigation-warning assessment
          const notice = { id: uid('ON'), number: num('MRS-N', 'notice'), portId: p.id, decisionId: d.id, kind: a.decision, title: tx((a.decision === 'close' ? 'إغلاق ' : 'تقييد العمليات في ') + p.name.ar, (a.decision === 'close' ? 'Closure of ' : 'Restricted operations at ') + p.name.en), from, to, issuedAt: t, by: u.username,
            navWarningAssessment: S.all('warnings').some(w => w.eventKey === r.eventKey && w.level === 'LOCAL') ? 'linked' : (r.type === 'weather' || r.navSafety ? 'recommended' : 'not_required') };
          S.insert('notices', notice);
          if (notice.navWarningAssessment === 'recommended' && !S.all('warnings').some(w => w.eventKey === r.eventKey && w.level === 'LOCAL')) {
            const w = newWarning(u, { level: 'LOCAL', category: a.decision === 'close' ? 'port_closure' : 'port_restriction', eventKey: r.eventKey || ('ops:' + r.id), portId: p.id, poly: C.circlePoly(p.p, p.localRadiusNm, 20), zone: tx('منطقة التحذير المحلية لـ' + p.name.ar, p.name.en + ' local warning area'), startAt: from, expiryAt: to + H, severity: r.severity, status: 'pending_approval', simulated: false,
              title: notice.title, body: tx('قرار مدير عمليات الميناء: ' + notice.title.ar + ' خلال النافذة المذكورة. ' + (r.description || ''), 'Port operations decision: ' + notice.title.en + ' during the stated window. ' + (r.description || '')), action: tx('عدم الاقتراب من الميناء دون تنسيق مع مركز خدمة حركة السفن.', 'Do not approach the port without VTS coordination.'), source: tx('قرار مدير عمليات ' + p.name.ar, p.name.en + ' operations manager decision') });
            notify('approval_request', tx('تحذير إغلاق/تقييد بانتظار اعتمادك: ' + w.number, 'Closure/restriction warning awaiting approval: ' + w.number), w.title, { type: 'warning', id: w.id }, { roles: ['warning_officer'], portId: p.id, level: 'warning' });
          }
          notify('port_status', notice.title, tx('من ' + new Date(from).toISOString().slice(11, 16) + 'Z إلى ' + new Date(to).toISOString().slice(11, 16) + 'Z', 'From ' + new Date(from).toISOString().slice(11, 16) + 'Z to ' + new Date(to).toISOString().slice(11, 16) + 'Z'), { type: 'notice', id: notice.id }, { roles: ['port_staff', 'warning_officer', 'company', 'truck', 'authority'], portId: p.id, level: 'critical' });
        }
        audit(u, 'closure.decide', 'closureRec', r.id, tx('قرار ' + ({ close: 'إغلاق', restrict: 'تقييد', continue: 'استمرار التشغيل' })[a.decision] + ' لـ' + p.name.ar + ' (' + d.number + ') مع الإقرار بالمسؤولية', ({ close: 'Closure', restrict: 'Restriction', continue: 'Continue operations' })[a.decision] + ' decided for ' + p.name.en + ' (' + d.number + ') with responsibility statement'), { simulated: false, details: d.number });
        runPredictions(); touch(); return d;
      },
      reopenPort(u, a) {
        const p = portOf(a.portId); needPort(u, 'port:decide', p.id); needDisclaimer(a);
        const prev = { status: p.status, statusWindow: p.statusWindow };
        S.update('ports', p.id, { status: 'open', statusWindow: null, statusReason: null, statusBy: u.username, statusAt: now() });
        const d = record('reopen', p.id, 'reopen', u, { previous: prev, note: a.note, disclaimer: true });
        audit(u, 'port.reopen', 'port', p.id, tx('إعادة فتح ' + p.name.ar + ' (' + d.number + ')', p.name.en + ' reopened (' + d.number + ')'), { simulated: false, details: d.number });
        notify('port_status', tx('إعادة فتح ' + p.name.ar, p.name.en + ' reopened'), tx(a.note || '', a.note || ''), { type: 'port', id: p.id }, { roles: ['port_staff', 'warning_officer', 'company', 'truck', 'authority'], portId: p.id, level: 'info' });
        runPredictions(); touch(); return d;
      },

      // Warnings
      createWarning(u, a) {
        need(u, 'warning:draft'); if (!['LOCAL', 'COASTAL', 'INTERNATIONAL'].includes(a.level)) throw new ValidationError('level'); if (!CAT[a.category]) throw new ValidationError('category');
        if (!a.title || !a.title.ar || !a.title.en) throw new ValidationError('title'); if (!Array.isArray(a.poly) || a.poly.length < 3) throw new ValidationError('area');
        if (a.level === 'LOCAL' && u.role !== 'admin' && a.portId && u.portId && a.portId !== u.portId) throw new PermissionError('local:port');
        const w = newWarning(u, Object.assign({}, a, { status: 'draft', simulated: false, source: a.source || tx(u.name.ar + ' – ' + ROLES[u.role].ar, u.name.en + ' – ' + ROLES[u.role].en) }));
        touch(); return w;
      },
      editWarning(u, a) {
        const w = S.get('warnings', a.id); if (!w) throw new ValidationError('id');
        const authorityEdit = can(u, 'warning:authority') && w.level !== 'LOCAL' && w.status === 'pending_review';
        if (!authorityEdit) { need(u, 'warning:draft'); if (!['draft', 'pending_approval', 'returned'].includes(w.status)) throw new ValidationError('state'); }
        const patch = {}, mods = {};
        for (const k of ['title', 'body', 'action', 'zone']) if (a[k]) { patch[k] = { ar: String(a[k].ar || '').slice(0, 2000), en: String(a[k].en || '').slice(0, 2000) }; mods[k] = true; }
        for (const k of ['startAt', 'expiryAt']) if (a[k]) { patch[k] = Number(a[k]); mods[k] = true; }
        if (a.severity) { if (!PR.LEVELS.includes(a.severity)) throw new ValidationError('severity'); patch.severity = a.severity; mods.severity = true; }
        if (a.category) { if (!CAT[a.category]) throw new ValidationError('category'); patch.category = a.category; mods.category = true; }
        if ((patch.expiryAt || w.expiryAt) <= (patch.startAt || w.startAt)) throw new ValidationError('window');
        patch.history = w.history.concat([{ s: 'edited', at: now(), by: u.username, note: Object.keys(mods).join(',') }]);
        S.update('warnings', w.id, patch); audit(u, 'warning.edit', 'warning', w.id, tx('تعديل ' + w.number + ': ' + Object.keys(mods).join('، '), w.number + ' edited: ' + Object.keys(mods).join(', ')), { simulated: false });
        bump(); return { ok: true };
      },
      submitWarning(u, a) { // LOCAL draft → pending_approval; COASTAL/INTERNATIONAL draft → pending_review at the authority
        const w = S.get('warnings', a.id); if (!w) throw new ValidationError('id'); need(u, w.level === 'LOCAL' ? 'warning:draft' : 'warning:submit');
        if (!['draft', 'returned'].includes(w.status)) throw new ValidationError('state');
        if (w.level === 'LOCAL') { setW(w, 'pending_approval', u, a.note); notify('approval_request', tx('تحذير محلي بانتظار الاعتماد: ' + w.number, 'Local warning awaiting approval: ' + w.number), w.title, { type: 'warning', id: w.id }, { roles: ['warning_officer'], portId: w.portId, level: 'warning' }); }
        else {
          setW(w, 'pending_review', u, a.note, { submittedAt: now(), messageText: messageText(w), verification: verify({ n: w.number, t: w.title, b: w.body, p: w.poly, s: w.startAt, e: w.expiryAt }) });
          S.update('integrations', 'authority', { lastSync: now(), records: (S.get('integrations', 'authority').records || 0) + 1 }); intLog('authority', 'info', 'submitted ' + w.number + ' (manual secure workflow)');
          notify(w.level === 'COASTAL' ? 'regional_workflow' : 'international_workflow', tx((w.level === 'COASTAL' ? 'مسودة تحذير ساحلي' : 'إحالة دولية') + ' للمراجعة: ' + w.number, (w.level === 'COASTAL' ? 'Coastal warning draft' : 'International referral') + ' for review: ' + w.number), w.title, { type: 'warning', id: w.id }, { roles: ['authority'], level: 'warning' });
        }
        audit(u, 'warning.submit', 'warning', w.id, tx('إرسال ' + w.number + (w.level === 'LOCAL' ? ' للاعتماد' : ' إلى الجهة البحرية المختصة'), w.number + (w.level === 'LOCAL' ? ' submitted for approval' : ' submitted to the competent maritime authority')), { simulated: false });
        touch(); return { ok: true };
      },
      decideLocalWarning(u, a) {
        const w = S.get('warnings', a.id); if (!w || w.level !== 'LOCAL') throw new ValidationError('id'); need(u, 'warning:local:approve');
        if (u.role !== 'admin' && u.portId && w.portId && u.portId !== w.portId) throw new PermissionError('local:port');
        if (w.status !== 'pending_approval') throw new ValidationError('state');
        const prev = { status: w.status };
        if (a.decision === 'more_analysis') { setW(w, 'returned', u, a.note); runPredictions(); const d = record('local_warning', w.id, 'more_analysis', u, { previous: prev, note: a.note }); audit(u, 'warning.more_analysis', 'warning', w.id, tx('إعادة ' + w.number + ' لتحليل إضافي', w.number + ' returned for additional analysis'), { simulated: false }); touch(); return d; }
        needDisclaimer(a);
        if (a.decision === 'reject') { setW(w, 'rejected', u, a.note); const d = record('local_warning', w.id, 'reject', u, { previous: prev, note: a.note, disclaimer: true }); audit(u, 'warning.reject', 'warning', w.id, tx('رفض التحذير المحلي ' + w.number, 'Local warning ' + w.number + ' rejected'), { simulated: false, details: d.number }); touch(); return d; }
        if (a.decision !== 'approve') throw new ValidationError('decision');
        const ver = verify({ n: w.number, t: w.title, b: w.body, a: w.action, p: w.poly, s: w.startAt, e: w.expiryAt });
        setW(w, 'approved', u, a.note, { issueAt: now(), verification: ver, approvedBy: u.username });
        const d = record('local_warning', w.id, 'approve', u, { previous: prev, note: a.note, disclaimer: true, supporting: { predictionKey: w.predictionKey, verification: ver } });
        const hz = createHazard(u, { type: ['port_closure', 'port_restriction'].includes(w.category) ? 'closure' : w.category === 'navigation_hazard' ? 'maritime' : 'weather', severity: w.severity, poly: w.poly, validFrom: w.startAt, validTo: w.expiryAt, title: w.title, area: w.zone, detail: w.body, source: w.source, simulated: w.simulated, portId: w.portId, eventKey: w.eventKey, warningId: w.id });
        const n = distribute(S.get('warnings', w.id), u); setW(S.get('warnings', w.id), 'distributed', u, n + ' recipients', { decisionId: d.id, hazardId: hz.id, recipients: n });
        audit(u, 'warning.approve', 'warning', w.id, tx('اعتماد التحذير المحلي ' + w.number + ' مع الإقرار بالمسؤولية (' + d.number + ')', 'Local warning ' + w.number + ' approved with responsibility statement (' + d.number + ')'), { simulated: false, details: d.number });
        touch(); return d;
      },
      cancelWarning(u, a) {
        const w = S.get('warnings', a.id); if (!w) throw new ValidationError('id');
        if (w.level === 'LOCAL') need(u, 'warning:local:approve'); else need(u, 'warning:authority');
        if (['cancelled', 'rejected', 'expired'].includes(w.status)) throw new ValidationError('state');
        setW(w, 'cancelled', u, a.note, a.officialRef ? { cancelRef: a.officialRef } : {});
        if (w.hazardId) S.update('hazards', w.hazardId, { status: 'cancelled' });
        for (const d of S.all('deliveries').filter(d => d.warningId === w.id)) { S.update('deliveries', d.id, { status: d.ackAt ? d.status : 'cancelled', history: d.history.concat([{ s: 'cancellation_sent', at: now() }]) }); notify('local_warning', tx('إلغاء التحذير ' + w.number, 'Warning ' + w.number + ' cancelled'), w.title, { type: 'warning', id: w.id }, { roles: ['captain'], vesselId: d.vesselId, level: 'info' }); }
        record(w.level === 'LOCAL' ? 'local_warning' : 'authority', w.id, 'cancel', u, { note: a.note });
        audit(u, 'warning.cancel', 'warning', w.id, tx('إلغاء ' + w.number, w.number + ' cancelled'), { simulated: false }); touch(); return { ok: true };
      },
      reviseWarning(u, a) { // update a distributed/published warning: new version replacing the old
        const w = S.get('warnings', a.id); if (!w) throw new ValidationError('id'); need(u, 'warning:draft');
        if (!['distributed', 'published', 'updated'].includes(w.status)) throw new ValidationError('state');
        const nw = newWarning(u, { level: w.level, category: w.category, eventKey: w.eventKey, predictionKey: w.predictionKey, portId: w.portId, poly: w.poly, zone: w.zone, startAt: Number(a.startAt) || w.startAt, expiryAt: Number(a.expiryAt) || w.expiryAt, severity: a.severity || w.severity,
          status: w.level === 'LOCAL' ? 'pending_approval' : 'draft', simulated: w.simulated, title: a.title || w.title, body: a.body || w.body, action: a.action || w.action, source: w.source, replacesId: w.id });
        audit(u, 'warning.revise', 'warning', nw.id, tx('نسخة محدثة ' + nw.number + ' تحل محل ' + w.number, 'Updated version ' + nw.number + ' replaces ' + w.number), { simulated: false }); touch(); return nw;
      },
      authorityDecide(u, a) {
        need(u, 'warning:authority'); const w = S.get('warnings', a.id); if (!w || w.level === 'LOCAL') throw new ValidationError('id');
        const t = now(), prev = { status: w.status };
        const step = { approve: ['pending_review', 'approved'], reject: ['pending_review', 'rejected'], return: ['pending_review', 'returned'], ready: ['approved', 'ready_for_transmission'], refer_navarea: ['approved', 'referred_navarea'], publish: [null, 'published'], update: [null, 'updated'] }[a.decision];
        if (!step) throw new ValidationError('decision');
        if (step[0] && w.status !== step[0]) throw new ValidationError('state');
        if (a.decision === 'ready' && w.level !== 'COASTAL') throw new ValidationError('level');
        if (a.decision === 'refer_navarea' && w.level !== 'INTERNATIONAL') throw new ValidationError('level');
        if (a.decision === 'publish') { if (!(w.level === 'COASTAL' ? w.status === 'ready_for_transmission' : w.status === 'referred_navarea')) throw new ValidationError('state'); if (!a.officialRef || String(a.officialRef).trim().length < 3) throw new ValidationError('officialRef'); }
        if (a.decision === 'update' && !['published', 'updated'].includes(w.status)) throw new ValidationError('state');
        if (['approve', 'reject', 'publish'].includes(a.decision)) needDisclaimer(a);
        const patch = {};
        if (a.decision === 'publish') Object.assign(patch, { officialRef: String(a.officialRef).trim().slice(0, 60), publishedAt: Number(a.publishedAt) || t, issueAt: Number(a.publishedAt) || t, publicationChannel: a.channel || (w.level === 'COASTAL' ? 'NAVTEX' : 'NAVAREA IX') });
        if (a.decision === 'update') Object.assign(patch, { officialRef: a.officialRef ? String(a.officialRef).slice(0, 60) : w.officialRef, updateNote: a.note || null });
        if (a.decision === 'refer_navarea') Object.assign(patch, { referredTo: 'KHI_NAV', referredAt: t });
        setW(w, step[1], u, a.note, patch);
        const d = record('authority', w.id, a.decision, u, { previous: prev, note: a.note, disclaimer: ['approve', 'reject', 'publish'].includes(a.decision), modifications: a.officialRef ? { officialRef: a.officialRef } : null });
        intLog('authority', 'info', w.number + ' → ' + step[1] + (patch.officialRef ? ' ref ' + patch.officialRef : ''));
        const lbl = { approve: tx('اعتماد', 'approved'), reject: tx('رفض', 'rejected'), return: tx('إعادة للتعديل', 'returned for changes'), ready: tx('جاهز للإرسال المعتمد', 'ready for authorised transmission'), refer_navarea: tx('إحالة لمنسق المنطقة الملاحية التاسعة', 'referred to NAVAREA IX coordinator'), publish: tx('نُشر – المرجع ' + (patch.officialRef || ''), 'published – ref ' + (patch.officialRef || '')), update: tx('تحديث', 'updated') }[a.decision];
        audit(u, 'authority.' + a.decision, 'warning', w.id, tx('الجهة المختصة: ' + w.number + ' ' + lbl.ar, 'Authority: ' + w.number + ' ' + lbl.en), { simulated: false, details: d.number });
        notify(w.level === 'COASTAL' ? 'regional_workflow' : 'international_workflow', tx(w.number + ': ' + lbl.ar, w.number + ': ' + lbl.en), w.title, { type: 'warning', id: w.id }, { roles: ['warning_officer', 'port_manager'], level: a.decision === 'publish' ? 'info' : 'warning' });
        if (a.decision === 'publish' && w.eventKey && !S.all('hazards').some(h => h.warningId === w.id)) createHazard(u, { type: 'weather', severity: w.severity, poly: w.poly, validFrom: w.startAt, validTo: w.expiryAt, title: w.title, area: w.zone, detail: w.body, source: tx('تحذير رسمي ' + patch.officialRef, 'Official warning ' + patch.officialRef), simulated: w.simulated, warningId: w.id });
        touch(); return d;
      },

      // Navigational notices
      createNotice(u, a) {
        need(u, 'notice:manage'); if (!a.title || !a.title.ar || !a.title.en) throw new ValidationError('title'); if (!Array.isArray(a.poly) || a.poly.length < 3) throw new ValidationError('area');
        const n = newNotice(u, Object.assign({}, a, { kind: a.kind === 'periodic' ? 'periodic' : 'warning', simulated: false, source: a.source || tx(u.name.ar + ' – ' + ROLES[u.role].ar, u.name.en + ' – ' + ROLES[u.role].en) }));
        touch(); return n;
      },
      createPeriodicNotice(u) {
        need(u, 'notice:manage'); const t = now(), th = settings().thresholds;
        const rows = S.all('forecasts').filter(f => f.kind === 'area').map(f => { const s0 = f.series[0]; return { area: f.name, windKn: s0.windKn, gustKn: s0.gustKn, waveM: s0.waveM, visNm: s0.visNm, level: PR.weatherLevel(s0, th).level, max24: Math.max(...f.series.slice(0, 25).map(x => x.waveM)) }; });
        const poly = [[34.5, 28.5], [43.5, 16.0], [43.5, 13.0], [41.5, 13.0], [32.6, 27.5], [34.5, 28.5]];
        const n = newNotice(u, { kind: 'periodic', category: 'other', poly, zone: tx('البحر الأحمر والخليج العربي – المياه السعودية', 'Red Sea and Arabian Gulf – Saudi waters'), startAt: t, expiryAt: t + 12 * H, severity: 'low', rows, simulated: true,
          title: tx('النشرة البحرية الدورية', 'Periodic marine bulletin'), body: tx(rows.map(r => r.area.ar + ': رياح ' + r.windKn + ' عقدة، موج ' + r.waveM + ' م').join('؛ '), rows.map(r => r.area.en + ': wind ' + r.windKn + ' kn, waves ' + r.waveM + ' m').join('; ')),
          source: tx('تحليل مَرسى لتوقعات المركز الوطني للأرصاد (محاكاة)', 'MARSA analysis of NCM forecasts (simulated)') });
        S.update('navnotices', n.id, { suggested: S.all('ports').filter(p => p.saudi).map(p => ({ to: 'PORT:' + p.id, kind: 'port', name: p.name })) });
        setN(n, 'ready', u, 'periodic'); touch(); return n;
      },
      editNotice(u, a) {
        need(u, 'notice:manage'); const n = S.get('navnotices', a.id); if (!n || !['drafting', 'ready'].includes(n.status)) throw new ValidationError('state');
        const patch = {}; for (const k of ['title', 'body', 'action']) if (a[k]) patch[k] = { ar: String(a[k].ar || '').slice(0, 2000), en: String(a[k].en || '').slice(0, 2000) };
        S.update('navnotices', n.id, patch); audit(u, 'notice.edit', 'notice', n.id, tx('تعديل ' + n.number, n.number + ' edited'), { simulated: false }); bump(); return { ok: true };
      },
      markNoticeReady(u, { id }) { need(u, 'notice:manage'); const n = S.get('navnotices', id); if (!n || n.status !== 'drafting') throw new ValidationError('state'); setN(n, 'ready', u); audit(u, 'notice.ready', 'notice', id, tx(n.number + ' جاهزة للإرسال', n.number + ' ready to send'), { simulated: false }); touch(); return { ok: true }; },
      routeNotice(u, { id, recipients, disclaimer }) {
        need(u, 'notice:manage'); const n = S.get('navnotices', id); if (!n || !['drafting', 'ready'].includes(n.status)) throw new ValidationError('state'); needDisclaimer({ disclaimer });
        if (recipients && (!Array.isArray(recipients) || recipients.some(r => !(r === 'KHI' || (r.startsWith('PORT:') && portOf(r.slice(5)) && portOf(r.slice(5)).saudi))))) throw new ValidationError('recipients');
        if (n.status === 'drafting') setN(n, 'ready', u);
        routeNotice(u, id, recipients); record('notice', id, 'route', u, { disclaimer: true, modifications: recipients ? { recipients } : null }); touch(); return { ok: true };
      },
      recordOfficialIssue(u, { id, ref, issuer }) {
        need(u, 'notice:manage'); const n = S.get('navnotices', id); if (!n || !['awaiting_official', 'sent'].includes(n.status)) throw new ValidationError('state'); if (!ref || String(ref).trim().length < 3) throw new ValidationError('officialRef');
        setN(n, 'published', u, issuer || null, { officialRef: String(ref).trim().slice(0, 60), officialBy: issuer ? String(issuer).slice(0, 80) : null, publishedAt: now() });
        audit(u, 'notice.official', 'notice', id, tx('تسجيل الإصدار الرسمي لـ' + n.number + ' – المرجع ' + ref, n.number + ' official issuance recorded – ref ' + ref), { simulated: false }); bump(); return { ok: true };
      },
      cancelNotice(u, { id, note }) { need(u, 'notice:manage'); const n = S.get('navnotices', id); if (!n || ['cancelled', 'published'].includes(n.status) && !note) throw new ValidationError('state'); setN(n, 'cancelled', u, note); audit(u, 'notice.cancel', 'notice', id, tx('إلغاء ' + n.number, n.number + ' cancelled'), { simulated: false }); bump(); return { ok: true }; },
      setAutoRoute(u, { on }) { need(u, 'notice:manage'); S.update('settings', 'settings', { autoRoute: !!on }); audit(u, 'settings.autoroute', 'settings', 'settings', tx((on ? 'تفعيل' : 'إيقاف') + ' التوجيه الآلي للنشرات', 'Automatic notice routing ' + (on ? 'enabled' : 'disabled')), { simulated: false }); bump(); return { ok: true }; },

      // Vessel side
      deliveryEvent(u, { ids, event }) {
        if (u.role !== 'captain') throw new PermissionError('delivery'); if (!['delivered', 'received'].includes(event)) throw new ValidationError('event'); const t = now(); let n = 0;
        for (const d of S.all('deliveries').filter(d => (ids || []).includes(d.id) && d.vesselId === u.vesselId && d.channel === 'marsa_app')) {
          const patch = {};
          if (!d.deliveredAt) { patch.deliveredAt = t; patch.status = 'delivered'; }
          if (event === 'received' && !d.receivedAt) { patch.receivedAt = t; patch.status = 'received'; }
          if (d.ackAt) delete patch.status;
          if (Object.keys(patch).length) { patch.history = d.history.concat(Object.keys(patch).filter(k => k.endsWith('At')).map(k => ({ s: k.replace('At', ''), at: t }))); S.update('deliveries', d.id, patch); n++; }
        }
        if (n) { audit(u, 'delivery.' + event, 'vessel', u.vesselId, tx('تطبيق السفينة ' + vesselOf(u.vesselId).name + ': ' + (event === 'received' ? 'عُرض التحذير' : 'وصل التحذير') + ' (' + n + ')', vesselOf(u.vesselId).name + ' app: warning ' + event + ' (' + n + ')'), { simulated: false }); bump(); }
        return { ok: true, n };
      },
      acknowledge(u, { id, officer }) {
        if (u.role !== 'captain') throw new PermissionError('ack'); const d = S.get('deliveries', id); if (!d || d.vesselId !== u.vesselId) throw new PermissionError('ack:own');
        if (!officer || String(officer).trim().length < 3) throw new ValidationError('officer'); if (d.ackAt) return { ok: true, duplicate: true };
        const t = now(), v = vesselOf(d.vesselId), w = S.get('warnings', d.warningId);
        S.update('deliveries', d.id, { status: 'acknowledged', deliveredAt: d.deliveredAt || t, receivedAt: d.receivedAt || t, ackAt: t, ackBy: String(officer).trim().slice(0, 80), history: d.history.concat([{ s: 'acknowledged', at: t, by: officer }]) });
        audit(u, 'delivery.ack', 'delivery', d.id, tx('السفينة ' + v.name + ' (MMSI ' + v.mmsi + ') أكدت الاطلاع على ' + w.number + ' – ' + officer, v.name + ' (MMSI ' + v.mmsi + ') acknowledged ' + w.number + ' – ' + officer), { simulated: false });
        notify('ack_update', tx('أكدت ' + v.name + ' الاطلاع على ' + w.number, v.name + ' acknowledged ' + w.number), tx(officer + ' · ' + new Date(t).toISOString().slice(11, 19) + 'Z', officer + ' · ' + new Date(t).toISOString().slice(11, 19) + 'Z'), { type: 'delivery', id: d.id }, { roles: ['warning_officer', 'port_manager', 'company'], portId: w.portId, companyId: v.companyId, level: 'info' });
        bump(); return { ok: true };
      },
      respondRecommendation(u, a) {
        if (u.role !== 'captain') throw new PermissionError('respond'); const r = S.get('recs', a.id); if (!r || r.vesselId !== u.vesselId || !r.released) throw new PermissionError('respond:own');
        if (!['reviewed', 'accepted', 'rejected', 'alt_action'].includes(a.response)) throw new ValidationError('response'); if (!a.officer || String(a.officer).trim().length < 3) throw new ValidationError('officer');
        if ((a.response === 'rejected' || a.response === 'alt_action') && (!a.reason || String(a.reason).trim().length < 3)) throw new ValidationError('reason');
        if (r.response && !(r.response.kind === 'reviewed' && a.response !== 'reviewed')) throw new ValidationError('already');
        const t = now(), v = vesselOf(r.vesselId);
        S.update('recs', r.id, { response: { kind: a.response, by: String(a.officer).trim().slice(0, 80), at: t, reason: a.reason ? String(a.reason).slice(0, 500) : null }, history: r.history.concat([{ s: 'response:' + a.response, at: t, by: a.officer }]) });
        if (a.response !== 'reviewed') for (const d of S.all('deliveries').filter(d => d.vesselId === v.id && d.warningId && d.warningId === r.warningId)) S.update('deliveries', d.id, { status: a.response === 'accepted' ? 'accepted' : a.response === 'rejected' ? 'rejected' : 'alt_action', response: a.response, reason: a.reason || null, altAction: a.response === 'alt_action' ? a.reason : null, history: d.history.concat([{ s: a.response, at: t, by: a.officer }]) });
        if (a.response === 'accepted' && r.optionId) {
          const o = r.options.find(x => x.id === r.optionId), pos = v.pos;
          const vp = { routeStart: pos, routeNodes: o.nodes, nmTraveled: 0, destId: o.destId, status: 'underway', hold: o.kind === 'wait' ? { atNm: C.gcNm(pos, C.NODES[o.nodes[0]]) + C.nodesNm(o.nodes.slice(0, o.nodes.indexOf(o.holdNode) + 1)), until: o.holdUntil, node: o.holdNode } : null };
          S.update('vessels', v.id, vp); S.update('vessels', v.id, vesselPos(S.get('vessels', v.id)));
        }
        audit(u, 'rec.response', 'recommendation', r.id, tx(v.name + ': ' + ({ accepted: 'قبول', rejected: 'رفض', alt_action: 'إجراء بديل' })[a.response] + ' التوصية ' + r.number + ' – ' + a.officer + (a.reason ? ' (' + a.reason + ')' : ''), v.name + ': recommendation ' + r.number + ' ' + a.response + ' – ' + a.officer + (a.reason ? ' (' + a.reason + ')' : '')), { simulated: false });
        notify('ack_update', tx(v.name + ': ' + ({ accepted: 'قبلت التوصية', rejected: 'رفضت التوصية', alt_action: 'أبلغت عن إجراء بديل' })[a.response], v.name + ': recommendation ' + a.response), tx(a.reason || '', a.reason || ''), { type: 'rec', id: r.id }, { roles: ['warning_officer', 'port_manager', 'company'], portId: r.current && v.destId, companyId: v.companyId, level: a.response === 'accepted' ? 'info' : 'warning' });
        touch(); return { ok: true };
      },
      resendDelivery(u, { id }) {
        need(u, 'ack:manage'); const d = S.get('deliveries', id); if (!d || d.ackAt) throw new ValidationError('state'); const t = now();
        const vv = vesselOf(d.vesselId), ch = vv.noComms ? 'none' : vv.bridgeApp ? 'marsa_app' : 'ais_srm';
        S.update('deliveries', d.id, { channel: ch, status: ch === 'none' ? 'failed' : 'sent', sentAt: t, escalatedAt: null, history: d.history.concat([{ s: ch === 'none' ? 'failed' : 'resent', at: t, by: u.username }]) });
        if (d.channel === 'marsa_app') notify('local_warning', tx('إعادة إرسال تحذير', 'Warning re-sent'), S.get('warnings', d.warningId).title, { type: 'warning', id: d.warningId }, { roles: ['captain'], vesselId: d.vesselId, level: 'critical' });
        audit(u, 'delivery.resend', 'delivery', d.id, tx('إعادة إرسال إلى ' + vesselOf(d.vesselId).name, 'Re-sent to ' + vesselOf(d.vesselId).name), { simulated: false }); bump(); return { ok: true };
      },
      recordManualAck(u, { id, via, officer, note }) {
        need(u, 'ack:manage'); const d = S.get('deliveries', id); if (!d || d.ackAt) throw new ValidationError('state');
        if (!['VHF', 'phone', 'agent', 'email'].includes(via)) throw new ValidationError('via'); if (!officer || String(officer).trim().length < 3) throw new ValidationError('officer');
        const t = now(); S.update('deliveries', d.id, { status: 'acknowledged', ackAt: t, ackBy: String(officer).slice(0, 80), manual: { via, by: u.username, note: note || null }, history: d.history.concat([{ s: 'acknowledged_manual', at: t, via, by: u.username }]) });
        audit(u, 'delivery.manual_ack', 'delivery', d.id, tx('تسجيل اطلاع يدوي عبر ' + via + ' لـ' + vesselOf(d.vesselId).name + ' (' + officer + ')', 'Manual acknowledgement via ' + via + ' for ' + vesselOf(d.vesselId).name + ' (' + officer + ')'), { simulated: false }); bump(); return { ok: true };
      },

      // Routes
      decideRoute(u, a) {
        need(u, 'route:decide'); const r = S.get('recs', a.id); if (!r || !['pending', 'more_analysis'].includes(r.status)) throw new ValidationError('state');
        const v = vesselOf(r.vesselId), prev = { status: r.status, optionId: r.optionId };
        if (a.decision === 'more_analysis') {
          const hz = hazardsFor(v); const pl = computePlan(v, hz.length ? hz : r.hazardIds.map(id => S.get('hazards', id)).filter(Boolean));
          const opt = pl.options.find(o => o.id === pl.recommendedOptionId);
          S.update('recs', r.id, { current: pl.current, options: pl.options, recommendedOptionId: pl.recommendedOptionId, optionId: pl.recommendedOptionId, action: opt ? opt.kind : 'none', riskLevel: opt ? opt.risk.level : pl.current.risk.level, rationale: rationale(v, pl, opt, hz), status: 'pending', history: r.history.concat([{ s: 'more_analysis', at: now(), by: u.username }, { s: 'pending', at: now(), by: 'marsa-engine' }]) });
          const d = record('route', r.id, 'more_analysis', u, { previous: prev, note: a.note }); audit(u, 'rec.more_analysis', 'recommendation', r.id, tx('تحليل إضافي لـ' + r.number, 'Additional analysis for ' + r.number), { simulated: false }); touch(); return d;
        }
        needDisclaimer(a);
        if (a.decision === 'reject') { S.update('recs', r.id, { status: 'rejected', history: r.history.concat([{ s: 'rejected', at: now(), by: u.username, note: a.note }]) }); const d = record('route', r.id, 'reject', u, { previous: prev, note: a.note, disclaimer: true }); audit(u, 'rec.reject', 'recommendation', r.id, tx('رفض التوصية ' + r.number, 'Recommendation ' + r.number + ' rejected'), { simulated: false, details: d.number }); touch(); return d; }
        if (!['approve', 'modify'].includes(a.decision)) throw new ValidationError('decision');
        let patch = { status: 'released', released: true, releasedAt: now() };
        if (a.decision === 'modify') { const o = r.options.find(x => x.id === a.optionId); if (!o) throw new ValidationError('option'); Object.assign(patch, { optionId: o.id, action: o.kind, riskLevel: o.risk.level, riskScore: o.risk.score, impact: { extraHours: o.extraHours, extraCostSAR: o.extraCostSAR, extraFuelT: o.extraFuelT }, rationale: rationale(v, { current: r.current }, o, r.hazardIds.map(id => S.get('hazards', id)).filter(Boolean)) }); }
        patch.history = r.history.concat([{ s: a.decision === 'modify' ? 'modified_released' : 'released', at: now(), by: u.username, note: a.note || null }]);
        const d = record('route', r.id, a.decision, u, { previous: prev, modifications: a.decision === 'modify' ? { optionId: a.optionId } : null, note: a.note, disclaimer: true, supporting: { basis: r.basis.map(b => b.id) } });
        patch.decisionId = d.id; patch.verification = d.verification; S.update('recs', r.id, patch);
        notify('route_rec', tx('توصية مسار معتمدة لسفينتك', 'Approved route recommendation for your vessel'), S.get('recs', r.id).rationale, { type: 'rec', id: r.id }, { roles: ['captain'], vesselId: v.id, level: 'warning' });
        notify('route_rec', tx('توصية معتمدة لـ' + v.name, 'Approved recommendation for ' + v.name), S.get('recs', r.id).rationale, { type: 'rec', id: r.id }, { roles: ['company'], companyId: v.companyId, level: 'info' });
        audit(u, 'rec.release', 'recommendation', r.id, tx((a.decision === 'modify' ? 'تعديل واعتماد ' : 'اعتماد ') + r.number + ' وإتاحتها لـ' + v.name + ' (' + d.number + ')', (a.decision === 'modify' ? 'Modified and approved ' : 'Approved ') + r.number + ' and released to ' + v.name + ' (' + d.number + ')'), { simulated: false, details: d.number });
        touch(); return d;
      },

      // Vessels
      upsertVessel(u, a) {
        need(u, 'vessel:edit'); if (!/^\d{9}$/.test(String(a.mmsi || ''))) throw new ValidationError('mmsi'); if (a.imo && !/^\d{7}$/.test(String(a.imo))) throw new ValidationError('imo'); if (!a.name || String(a.name).trim().length < 2) throw new ValidationError('name');
        const ex = a.id && vesselOf(a.id);
        if (S.all('vessels').some(v => v.mmsi === String(a.mmsi) && (!ex || v.id !== ex.id))) throw new ValidationError('mmsi_taken');
        const fields = { name: String(a.name).trim().slice(0, 60), mmsi: String(a.mmsi), imo: a.imo ? String(a.imo) : null, type: a.type || 'general', flag: (a.flag || 'SA').slice(0, 2).toUpperCase(), companyId: a.companyId || null, draft: Number(a.draft) || 10, lengthM: Number(a.lengthM) || 150 };
        if (ex) { S.update('vessels', ex.id, fields); audit(u, 'vessel.update', 'vessel', ex.id, tx('تحديث بيانات السفينة ' + fields.name, 'Vessel updated ' + fields.name), { simulated: false }); bump(); return ex; }
        const dest = portOf(a.destId || 'JED'); const pos = [C.NODES[dest.node][0] + 0.12, C.NODES[dest.node][1] + 0.08];
        const v = Object.assign({ id: uid('V'), speedKn: 13, fuelTPD: 30, teu: 0, originId: dest.id, destId: dest.id, status: 'anchored', hold: null, aisSource: 'MANUAL', lastAis: now(), routeStart: pos, routeNodes: [], nmTraveled: 0, pos, cog: 0, nextIdx: 0 }, fields);
        v.bridgeApp = true; S.insert('vessels', v); S.insert('users', { id: 'B-' + v.id, username: 'bridge.' + v.mmsi, password: null, role: 'captain', orgId: v.companyId, companyId: v.companyId, portId: null, vesselId: v.id, name: tx('جسر ' + v.name, v.name + ' bridge'), active: true, createdAt: now(), bridge: true }); audit(u, 'vessel.create', 'vessel', v.id, tx('تسجيل سفينة ' + v.name + ' (MMSI ' + v.mmsi + ')', 'Vessel registered ' + v.name + ' (MMSI ' + v.mmsi + ')'), { simulated: false }); touch(); return v;
      },

      // Integrations, settings, users
      updateIntegration(u, a) {
        need(u, '*'); const i = S.get('integrations', a.id); if (!i) throw new ValidationError('id');
        if (a.mode && !['sandbox', 'manual', 'production', 'disabled'].includes(a.mode)) throw new ValidationError('mode');
        if (a.endpoint && !/^https:\/\/[\w.-]+(:\d+)?(\/[\w\-./?=&%]*)?$/.test(a.endpoint)) throw new ValidationError('endpoint_https');
        if (a.authType && !['none', 'api_key', 'oauth2', 'mtls'].includes(a.authType)) throw new ValidationError('authType');
        const patch = {}; for (const k of ['mode', 'endpoint', 'authType']) if (a[k] != null) patch[k] = a[k];
        if (a.credential) { patch.credential = secretBox ? secretBox.seal(String(a.credential)) : String(a.credential); patch.credentialSet = true; patch.credentialHint = '••••' + String(a.credential).slice(-4); }
        if (patch.mode) patch.status = patch.mode === 'disabled' ? 'disabled' : patch.mode === 'production' && !(patch.endpoint || i.endpoint) ? 'not_configured' : i.status;
        S.update('integrations', i.id, patch); intLog(i.id, 'info', 'configuration updated by ' + u.username);
        audit(u, 'integration.update', 'integration', i.id, tx('تحديث إعدادات تكامل ' + i.name.ar, 'Integration settings updated: ' + i.name.en), { simulated: false, details: JSON.stringify(Object.assign({}, patch, { credential: patch.credential ? '[set]' : undefined })) });
        bump(); return { ok: true };
      },
      testIntegration(u, { id }) {
        need(u, '*'); const i = S.get('integrations', id); if (!i) throw new ValidationError('id'); const t = now();
        let status, msg;
        if (i.mode === 'disabled') { status = 'disabled'; msg = 'disabled'; }
        else if (i.mode === 'sandbox') { status = 'connected'; msg = 'sandbox adapter responded (simulated)'; }
        else if (i.mode === 'manual') { status = 'connected'; msg = 'manual secure workflow available inside MARSA'; }
        else if (i.id === 'marsa_app') { status = 'connected'; msg = 'in-platform channel operational'; }
        else if (!i.endpoint) { status = 'not_configured'; msg = 'production mode without endpoint'; }
        else { status = 'not_implemented'; msg = 'production adapter requires the official interface specification; no call was made'; }
        S.update('integrations', i.id, { status, lastCheck: t }); intLog(i.id, status === 'connected' ? 'info' : 'warning', 'health check: ' + msg);
        if (status !== 'connected' && status !== 'disabled') notify('integration_failure', tx('فحص تكامل: ' + i.name.ar, 'Integration check: ' + i.name.en), tx(msg, msg), { type: 'integration', id: i.id }, { roles: ['admin'], level: 'warning' });
        audit(u, 'integration.test', 'integration', i.id, tx('فحص صحة التكامل ' + i.name.ar + ': ' + status, 'Integration health check ' + i.name.en + ': ' + status), { simulated: false }); bump(); return { status, msg };
      },
      updateSettings(u, a) {
        need(u, '*'); const p = {};
        const num1 = (k, lo, hi) => { if (a[k] != null) { const n = Number(a[k]); if (!(n >= lo && n <= hi)) throw new ValidationError(k); p[k] = n; } };
        num1('horizonH', 6, 48); num1('ackTimeoutMin', 1, 240); num1('capacityCapPct', 50, 100); num1('simAccel', 1, 120);
        for (const k of ['autoDraftLocal', 'autoDraftCoastal']) if (a[k] != null) p[k] = !!a[k];
        if (a.thresholds) { const th = Object.assign({}, settings().thresholds); for (const k of Object.keys(C.DEFAULT_THRESHOLDS)) if (a.thresholds[k] != null) th[k] = Number(a.thresholds[k]); p.thresholds = th; }
        S.update('settings', 'settings', p); audit(u, 'settings.update', 'settings', 'settings', tx('تحديث إعدادات المنصة', 'Platform settings updated'), { simulated: false, details: JSON.stringify(p) });
        runPredictions(); touch(); return { ok: true };
      },
      createUser(u, a) {
        need(u, '*'); if (!ROLES[a.role]) throw new ValidationError('role'); if (!/^[a-z0-9._-]{3,30}$/.test(a.username || '')) throw new ValidationError('username'); if (S.all('users').some(x => x.username === a.username)) throw new ValidationError('username_taken');
        if (!a.password || String(a.password).length < 6) throw new ValidationError('password'); if (!S.get('organizations', a.orgId)) throw new ValidationError('org');
        if (['port_manager', 'warning_officer', 'port_staff'].includes(a.role) && !portOf(a.portId)) throw new ValidationError('port'); if (a.role === 'captain' && !vesselOf(a.vesselId)) throw new ValidationError('vessel');
        const row = { id: uid('U'), username: a.username, password: a.password, role: a.role, orgId: a.orgId, companyId: ['company', 'captain', 'truck'].includes(a.role) ? a.orgId : null, portId: a.portId || null, vesselId: a.vesselId || null, name: tx(a.name, a.name), active: true, createdAt: now() };
        S.insert('users', row); audit(u, 'user.create', 'user', row.id, tx('إنشاء مستخدم ' + a.username + ' (' + ROLES[a.role].ar + ')', 'User ' + a.username + ' created (' + ROLES[a.role].en + ')'), { simulated: false }); bump(); return publicUser(row);
      },
      setUserActive(u, { id, active }) { need(u, '*'); if (id === u.id) throw new ValidationError('self'); S.update('users', id, { active: !!active }); audit(u, 'user.active', 'user', id, tx((active ? 'تفعيل' : 'تعطيل') + ' مستخدم', 'User ' + (active ? 'enabled' : 'disabled')), { simulated: false }); bump(); return { ok: true }; },
      createOrganization(u, a) { need(u, '*'); if (!['port', 'shipping', 'authority', 'trucking', 'marsa'].includes(a.kind)) throw new ValidationError('kind'); if (!a.name || a.name.length < 3) throw new ValidationError('name'); const o = { id: uid('ORG'), kind: a.kind, name: tx(a.name, a.nameEn || a.name), active: true }; S.insert('organizations', o); audit(u, 'org.create', 'organization', o.id, tx('إنشاء جهة ' + a.name, 'Organisation created ' + a.name), { simulated: false }); bump(); return o; },
      publishPeriodicBulletin(u) { need(u, 'bulletin:publish'); const b = issuePeriodicBulletin(u); bump(); return b; },
      truckAction(u, { id, action, portId }) {
        need(u, 'truck:manage'); const tr = S.get('trucks', id); if (!tr || tr.companyId !== u.companyId) throw new PermissionError('truck:own');
        const p = portOf(tr.portId), end = Math.max(now(), p.statusWindow ? p.statusWindow.to : 0, ...S.all('predictions').filter(x => x.portId === p.id && x.category === 'closure').map(x => x.end));
        const patch = { history: tr.history.concat([{ at: now(), action, from: tr.portId, slotAt: tr.slotAt }]) };
        if (action === 'reschedule') Object.assign(patch, { status: 'rescheduled', slotAt: end + 2 * H, note: tx('أعيدت الجدولة إلى ما بعد نافذة الإغلاق', 'Rescheduled after the closure window') });
        else if (action === 'redirect') { const np = portOf(portId); if (!np || !np.saudi) throw new ValidationError('port'); Object.assign(patch, { status: 'redirected', portId, note: tx('حُوّلت إلى ' + np.name.ar, 'Redirected to ' + np.name.en) }); }
        else if (action === 'keep') Object.assign(patch, { status: 'kept', note: tx('أُبقي الموعد مع المتابعة', 'Slot kept, monitoring') }); else throw new ValidationError('action');
        S.update('trucks', id, patch); audit(u, 'truck.' + action, 'truck', id, tx('الشاحنة ' + tr.plate + ': ' + action, 'Truck ' + tr.plate + ': ' + action), { simulated: false }); touch(); return { ok: true };
      },

      // Machine-to-machine integration endpoints
      ingestForecast(payload) { ingestForecast({ issuedAt: payload.issuedAt || now(), points: payload.points || [] }, !!payload.simulated, now(), payload.integrationId || 'ncm', payload.provider); runPredictions(); touch(); return { ok: true }; },
      authorityCallback({ warningNumber, status, officialRef }) {
        const w = S.all('warnings').find(x => x.number === warningNumber); if (!w) throw new ValidationError('warning');
        if (!['published', 'cancelled', 'updated', 'rejected'].includes(status)) throw new ValidationError('status');
        setW(w, status, INTEG('authority'), 'callback', officialRef ? { officialRef, publishedAt: status === 'published' ? now() : w.publishedAt } : {}); intLog('authority', 'info', 'callback ' + warningNumber + ' → ' + status);
        audit(INTEG('authority'), 'authority.callback', 'warning', w.id, tx('إشعار من الجهة المختصة: ' + w.number + ' ' + status, 'Authority callback: ' + w.number + ' ' + status)); touch(); return { ok: true };
      },

      tick() {
        const t = now(), m = meta(), dt = Math.min(10e3, t - (m.lastTick || t));
        S.update('meta', 'meta', { lastTick: t }); moveVessels(dt);
        if (t - m.lastNcm >= settings().ncmIntervalSec * 1000) { pullForecast(t); runPredictions(); }
        evaluate(); bump();
      },
      onChange(f) { listeners.push(f); },
      seed, store: S, can, ROLES, PERMS, DISCLAIMER, actionName, CAT, verifyAudit
    };
    if (!S.get('meta', 'meta')) seed();
    return api;
  }
  return { createService, MemoryStore, SimulatedNcmAdapter, ROLES, PERMS, can, DISCLAIMER };
});
