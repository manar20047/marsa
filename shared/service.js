/* MARSA v4 — maritime risk & alert management on a structured TEST DATA environment.
 * No live feeds and no simulation buttons: the system ships with sample weather, vessel, port, risk and
 * navigational-constraint records, analyses them with explicit rules, and every operation updates the
 * test database and the audit log. Runs in the browser (MemoryStore) and on Node (SqliteStore). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.MarsaService = factory(root.MarsaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const H = 3600e3, MIN = 60e3;
  const tx = (ar, en) => ({ ar, en });
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DISCLAIMER = tx('تُعد التوصيات الصادرة عن منصة مَرسى توصيات استشارية مبنية على البيانات المتاحة والنماذج التنبؤية، ولا تُعد بحد ذاتها قرارًا رسميًا بإغلاق الميناء أو تغيير مسار السفينة أو بديلًا عن التحذيرات والتعليمات الصادرة من الجهات البحرية المختصة. تقع مسؤولية اعتماد القرارات التشغيلية والملاحية وتنفيذها على الجهات والأطراف المخولة نظامًا، مع الالتزام بالتعليمات البحرية الرسمية وإجراءات السلامة المعتمدة.',
    'MARSA recommendations are advisory and are based on available data and predictive models. They do not constitute official port closure decisions, vessel navigation orders, or substitutes for official maritime warnings and instructions. Operational and navigational decisions remain the responsibility of duly authorized authorities and responsible parties, in accordance with applicable maritime regulations and safety procedures.');
  const LEVELS = ['none', 'low', 'medium', 'high', 'critical'];
  const rank = l => LEVELS.indexOf(l);
  const maxL = (a, b) => rank(a) >= rank(b) ? a : b;
  class PermissionError extends Error { constructor(p) { super('FORBIDDEN:' + p); this.code = 'FORBIDDEN'; } }
  class ValidationError extends Error { constructor(m) { super('INVALID:' + m); this.code = 'INVALID'; } }

  // ---------------------------------------------------------------- TEST DATASETS
  // Saudi sea areas used for sample weather data (centre, radius of the analysis zone in nm, climate baseline).
  const SEA_AREAS = [
    { id: 'NRS', ar: 'شمال البحر الأحمر (ضباء – الوجه)', en: 'Northern Red Sea (Duba – Al Wajh)', sea: 'RS', p: [35.7, 26.7], r: 70, b: { w: 14, wd: 330, h: 1.0, hd: 335, c: .5, cd: 150, v: 9, t: 24 } },
    { id: 'YNB', ar: 'ساحل ينبع', en: 'Yanbu coast', sea: 'RS', p: [37.75, 24.0], r: 55, b: { w: 12, wd: 320, h: .9, hd: 325, c: .4, cd: 145, v: 9, t: 26 } },
    { id: 'RBG', ar: 'ساحل رابغ – مدينة الملك عبدالله', en: 'Rabigh – King Abdullah Port coast', sea: 'RS', p: [38.75, 22.7], r: 50, b: { w: 12, wd: 320, h: .9, hd: 320, c: .5, cd: 150, v: 8, t: 27 } },
    { id: 'JED', ar: 'ساحل جدة', en: 'Jeddah coast', sea: 'RS', p: [38.95, 21.45], r: 55, b: { w: 11, wd: 315, h: .8, hd: 320, c: .5, cd: 155, v: 8, t: 28 } },
    { id: 'LTH', ar: 'ساحل الليث – القنفذة', en: 'Al Lith – Al Qunfudhah coast', sea: 'RS', p: [40.3, 19.6], r: 60, b: { w: 12, wd: 320, h: .9, hd: 320, c: .6, cd: 160, v: 8, t: 29 } },
    { id: 'JZN', ar: 'ساحل جازان – فرسان', en: 'Jazan – Farasan coast', sea: 'RS', p: [41.9, 16.9], r: 60, b: { w: 13, wd: 170, h: 1.0, hd: 165, c: 1.1, cd: 330, v: 7, t: 31 } },
    { id: 'AGN', ar: 'شمال الخليج العربي (الخفجي – الجبيل)', en: 'Northern Arabian Gulf (Khafji – Jubail)', sea: 'AG', p: [49.5, 27.6], r: 60, b: { w: 13, wd: 330, h: .9, hd: 330, c: .4, cd: 140, v: 7, t: 23 } },
    { id: 'AGC', ar: 'وسط الخليج العربي (الدمام – رأس تنورة)', en: 'Central Arabian Gulf (Dammam – Ras Tanura)', sea: 'AG', p: [50.45, 26.65], r: 45, b: { w: 12, wd: 330, h: .8, hd: 330, c: .4, cd: 140, v: 7, t: 24 } }
  ];
  // Weather systems embedded in the sample dataset (hours relative to the dataset reference time).
  // Each affects areas with an explicit weight, so values are coherent in space and time.
  const SAMPLE_SYSTEMS = [
    { id: 'S1', ar: 'منخفض جوي على وسط البحر الأحمر', en: 'Low-pressure system over the central Red Sea', start: 3, peakFrom: 8, peakTo: 20, end: 30, areas: { JED: 1, RBG: .85, LTH: .55, YNB: .3 }, set: { w: 30, wd: 300, h: 3.6, hd: 305, v: 2.0, c: 1.6, t: -3 } },
    { id: 'S2', ar: 'رياح شمالية غربية (شمال) على الخليج العربي', en: 'North-westerly (Shamal) winds over the Arabian Gulf', start: 18, peakFrom: 23, peakTo: 34, end: 42, areas: { AGN: 1, AGC: .85 }, set: { w: 27, wd: 320, h: 2.6, hd: 320, v: 3.0, c: .9, t: -4 } },
    { id: 'S3', ar: 'غبار وانخفاض رؤية مع تيارات قوية – جازان وفرسان', en: 'Dust, reduced visibility and strong currents – Jazan & Farasan', start: 1, peakFrom: 3, peakTo: 10, end: 14, areas: { JZN: 1 }, set: { w: 21, wd: 180, h: 1.6, hd: 175, v: .8, c: 2.6, t: 2 } }
  ];
  // Test navigational constraints (depths are test values, NOT nautical-chart data).
  const CONSTRAINTS = [
    { id: 'NC1', kind: 'shallow', minDepthM: 9, ar: 'شعاب جنوب جدة (عمق تجريبي ٩ م)', en: 'Reefs south of Jeddah (test depth 9 m)', poly: [[38.55, 20.95], [38.95, 20.95], [38.95, 21.2], [38.55, 21.2]] },
    { id: 'NC2', kind: 'shallow', minDepthM: 11, ar: 'ضحول غرب فرسان (عمق تجريبي ١١ م)', en: 'Shoals west of Farasan (test depth 11 m)', poly: [[40.9, 16.4], [41.55, 16.4], [41.55, 17.25], [40.9, 17.25]] },
    { id: 'NC3', kind: 'restricted', minDepthM: null, ar: 'منطقة محظورة للملاحة (تمارين – تجريبي)', en: 'Restricted area (exercises – test)', poly: [[36.2, 22.9], [36.75, 22.9], [36.75, 23.4], [36.2, 23.4]] },
    { id: 'NC4', kind: 'shallow', minDepthM: 12, ar: 'منطقة ضحلة شمال رأس تنورة (عمق تجريبي ١٢ م)', en: 'Shallow area north of Ras Tanura (test depth 12 m)', poly: [[50.0, 26.95], [50.4, 26.95], [50.4, 27.25], [50.0, 27.25]] }
  ];
  const UKC_M = 1.0; // under-keel clearance used against test depths
  // Test vessel records: [id, name, type, origin, dest, atNode, nmBack, sog, draft, lengthM, channel]
  const VESSELS = [
    ['V1', 'Murjan Glory', 'bulk', 'JZN', 'JED', 'approach', 0, 8, 10.5, 180, 'bridge'], ['V2', 'Aegean Star', 'container', 'PSD', 'JED', 'RS3', 25, 15, 12.6, 260, 'bridge'],
    ['V3', 'Sawari Trader', 'general', 'AQB', 'JED', 'RS2', 30, 13, 9.8, 160, 'bridge'], ['V4', 'Ocean Falcon', 'container', 'PSU', 'JED', 'RS4', 40, 16, 12.0, 250, 'bridge'],
    ['V5', 'Tihama Bulk', 'bulk', 'JZN', 'JED', 'RS5', 20, 12, 9.8, 190, 'bridge'], ['V6', 'Red Sea Breeze', 'roro', 'PSD', 'JED', 'RS1', 10, 17, 8.8, 200, 'bridge'],
    ['V7', 'Asir Spirit', 'container', 'YNB', 'JED', 'YNB_A', 15, 15, 11.2, 220, 'bridge'], ['V8', 'Hejaz Carrier', 'bulk', 'PSU', 'JED', 'PSU_A', 20, 12.5, 10.8, 185, 'vhf'],
    ['V9', 'Corniche Express', 'container', 'KAP', 'JED', 'anchor', 0, 15, 11.5, 230, 'bridge'], ['V10', 'Fanar Pioneer', 'general', 'YNB', 'JED', 'anchor', 0, 13, 9.5, 150, 'bridge'],
    ['V11', 'Balad Trader', 'bulk', 'AQB', 'JED', 'anchor', 0, 12, 10.2, 170, 'none'], ['V12', 'Obhur Star', 'container', 'PSD', 'JED', 'berth', 0, 16, 12.8, 270, 'bridge'],
    ['V13', 'Yanbu Express', 'container', 'JED', 'YNB', 'JED_A', 8, 15, 11.0, 210, 'bridge'], ['V14', 'Kandara Bay', 'container', 'MUM', 'KAP', 'RS4', 60, 17, 12.9, 280, 'bridge'],
    ['V15', 'Nawras Star', 'container', 'JED', 'ASIA', 'RS5', 30, 17, 14.2, 300, 'bridge'], ['V16', 'Sharm Trader', 'general', 'PSD', 'JZN', 'RS2', 80, 13, 9.0, 150, 'bridge'],
    ['V17', 'Farasan Pearl', 'roro', 'JED', 'JZN', 'RS5', 10, 15, 7.5, 160, 'bridge'], ['V18', 'Lulu Bay', 'tanker', 'RTN', 'EUROPE', 'GUA', 60, 13.5, 15.8, 250, 'bridge'],
    ['V19', 'Khaleej Pearl', 'container', 'JEA', 'DMM', 'AG1', 10, 15, 12.0, 240, 'bridge'], ['V20', 'Wahat Pride', 'tanker', 'JUB', 'MUM', 'AG1', 30, 14, 13.2, 230, 'bridge'],
    ['V21', 'Faisal Horizon', 'container', 'KHI', 'DMM', 'AS3', 120, 16.5, 12.2, 260, 'bridge'], ['V22', 'Dammam Spirit', 'general', 'KWT', 'DMM', 'AG3', 20, 12, 9.5, 160, 'bridge'],
    ['V23', 'Jubail Carrier', 'bulk', 'DMM', 'JUB', 'DMM_A', 5, 11, 10.5, 190, 'ais'], ['V24', 'Najm Ocean', 'lng', 'KWT', 'ASIA', 'AG2', 40, 18.5, 11.8, 290, 'bridge']
  ];
  const PORT_TEST = { JED: [72, 'Operating normally; all terminals available (test record).', 'عمليات اعتيادية وجميع المحطات متاحة (سجل تجريبي).'], KAP: [58, 'Normal operations (test).', 'تشغيل اعتيادي (تجريبي).'], YNB: [52, 'Normal operations (test).', 'تشغيل اعتيادي (تجريبي).'], JZN: [44, 'Pilotage by day only (test).', 'الإرشاد نهارًا فقط (تجريبي).'], DMM: [66, 'Berth 12 under maintenance (test).', 'الرصيف ١٢ تحت الصيانة (تجريبي).'], JUB: [61, 'Normal operations (test).', 'تشغيل اعتيادي (تجريبي).'], RTN: [55, 'Tanker berths only (test).', 'أرصفة الناقلات فقط (تجريبي).'] };
  // Hand-entered test hazard records (non-weather), present when the system opens.
  const RISK_RECORDS = [
    { key: 'TR1', type: 'navigation_hazard', level: 'high', p: [36.6, 24.35], r: 10, start: -2, end: 30, ar: 'حاوية طافية منجرفة على الممر الملاحي غرب ينبع (بلاغ تجريبي)', en: 'Drifting container on the shipping lane west of Yanbu (test report)', ind: tx('بلاغ ملاحي: جسم طافٍ غير مضاء', 'Navigational report: unlit floating object') },
    { key: 'TR2', type: 'operational', level: 'medium', p: [50.2, 26.5], r: 6, start: 0, end: 24, ar: 'قيود تشغيلية في ميناء الملك عبدالعزيز بالدمام (صيانة رصيف – تجريبي)', en: 'Operational restriction at King Abdulaziz Port Dammam (berth maintenance – test)', ind: tx('إشغال مرتفع وصيانة الرصيف ١٢', 'High occupancy and berth 12 maintenance') }
  ];
  const DEFAULT_RULES = {
    minLevel: 'medium',
    windKn: [15, 22, 28, 34], waveM: [1.25, 2.0, 2.5, 3.5], visNm: [6, 2, 1, 0.5], currentKn: [1.5, 2.0, 2.5, 3.0],
    seaPenaltyPct: 30, ukcM: UKC_M
  };
  const IND = { windKn: tx('سرعة الرياح', 'Wind speed'), waveM: tx('ارتفاع الأمواج', 'Wave height'), visNm: tx('الرؤية الأفقية', 'Visibility'), currentKn: tx('سرعة التيار', 'Current speed') };
  const UNIT = { windKn: 'kn', waveM: 'm', visNm: 'nm', currentKn: 'kn' };
  const RTYPE = { severe_weather: tx('طقس شديد', 'Severe weather'), port_congestion: tx('ازدحام ميناء', 'Port congestion'), strong_winds: tx('رياح شديدة', 'Strong winds'), high_waves: tx('أمواج عالية', 'High waves'), reduced_visibility: tx('انخفاض الرؤية', 'Reduced visibility'), strong_currents: tx('تيارات قوية', 'Strong currents'), navigation_hazard: tx('خطر ملاحي', 'Navigation hazard'), operational: tx('قيود تشغيلية', 'Operational restriction'), port_closure: tx('إغلاق ميناء', 'Port closure'), port_restriction: tx('قيود على ميناء', 'Port restriction'), security: tx('تهديد أمني', 'Security threat'), other: tx('خطر آخر', 'Other hazard') };
  const ACTIONS = {
    strong_winds: tx('خفض السرعة، تأمين البضائع على السطح، تجنب المنطقة أو الانتظار في منطقة آمنة، ومتابعة النشرات.', 'Reduce speed, secure deck cargo, avoid the area or wait in a safe location, and monitor bulletins.'),
    high_waves: tx('تجنب المرور بالمنطقة، تعديل الاتجاه لتقليل التدحرج، الانتظار حتى تحسن الأحوال، وتأجيل عمليات الإرشاد.', 'Avoid transiting the area, adjust heading to reduce rolling, wait for improvement, and postpone pilotage.'),
    severe_weather: tx('تجنب المنطقة كليًا، الانتظار في منطقة آمنة أو التحويل لميناء بديل، وتعليق العمليات البحرية غير الضرورية.', 'Avoid the area entirely, wait in a safe location or divert, and suspend non-essential marine operations.'),
    reduced_visibility: tx('خفض السرعة، تشغيل الرادار والإشارات الصوتية، زيادة المراقبة، والالتزام بقواعد منع التصادم.', 'Reduce speed, use radar and sound signals, increase lookout, and comply with COLREGs.'),
    strong_currents: tx('مراعاة الانجراف عند الاقتراب من الشعاب والموانئ، وطلب الإرشاد، وتجنب المناورات القريبة.', 'Allow for set and drift near reefs and ports, request pilotage, and avoid close-quarter manoeuvres.'),
    navigation_hazard: tx('الابتعاد عن الموقع، مراقبة الجسم الطافي، وإبلاغ الميناء بأي مشاهدة.', 'Keep clear of the position, keep watch for the object, and report sightings to the port.'),
    operational: tx('التنسيق مع الميناء قبل الوصول وتعديل موعد الوصول.', 'Coordinate with the port before arrival and adjust the arrival time.'),
    port_closure: tx('عدم الدخول للميناء، الانتظار في منطقة الانتظار المحددة، أو التحويل لميناء بديل.', 'Do not enter the port; wait at the designated waiting area or divert to an alternative port.'),
    port_restriction: tx('الالتزام بقيود الدخول والتنسيق مع الميناء.', 'Comply with entry restrictions and coordinate with the port.'),
    port_congestion: tx('تأجيل الوصول أو التحويل لميناء بديل لا يتجاوز إشغاله ٨٨٪.', 'Delay arrival or divert to an alternative port not exceeding 88% occupancy.'),
    security: tx('اتباع تعليمات الجهات المختصة وتجنب المنطقة.', 'Follow the competent authorities\' instructions and avoid the area.'),
    other: tx('متابعة تعليمات الميناء.', 'Follow port instructions.')
  };
  const confidenceOf = (rel, source) => { const v = source === 'rules' ? (rel >= .85 ? 'high' : rel >= .7 ? 'medium' : 'low') : source === 'port' ? 'high' : 'medium'; return { level: v, label: tx({ high: 'مرتفعة', medium: 'متوسطة', low: 'منخفضة' }[v] + ' – تقدير محاكى قائم على القواعد، وليس احتمالًا إحصائيًا مثبتًا', v + ' – simulated rule-based assessment, not a statistically validated probability') }; };
  const DOMINANT = { waveM: 'high_waves', windKn: 'strong_winds', visNm: 'reduced_visibility', currentKn: 'strong_currents' };

  function levelOf(ind, v, rules) {
    const t = rules[ind]; if (v == null || !t) return 'none';
    if (ind === 'visNm') return v <= t[3] ? 'critical' : v <= t[2] ? 'high' : v <= t[1] ? 'medium' : v <= t[0] ? 'low' : 'none';
    return v >= t[3] ? 'critical' : v >= t[2] ? 'high' : v >= t[1] ? 'medium' : v >= t[0] ? 'low' : 'none';
  }

  // Beaufort scale and WMO wind-warning categories (MSC.470(101) – revised WWMIWS guidance, 4.2.1.2)
  const BFT = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64]; // lower knot bound of Beaufort 1..12
  const beaufort = kn => { let b = 0; for (let i = 0; i < BFT.length; i++) if (kn >= BFT[i]) b = i + 1; return b; };
  const windWarning = kn => { const b = beaufort(kn); return b >= 12 ? 'hurricane' : b >= 10 ? 'storm' : b >= 8 ? 'gale' : null; };
  const WWARN = { gale: tx('تحذير عاصفة (Gale) – بوفورت ٨–٩', 'Gale warning – Beaufort 8–9'), storm: tx('تحذير عاصفة شديدة (Storm) – بوفورت ١٠–١١', 'Storm warning – Beaufort 10–11'), hurricane: tx('تحذير إعصار (Hurricane-force) – بوفورت ١٢', 'Hurricane-force warning – Beaufort 12') };
  const WWMIWS_REF = 'IMO Res. A.1051(27) as revised by MSC.470(101) (WWMIWS)';

  // ---------------------------------------------------------------- STORE
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

  // ---------------------------------------------------------------- SERVICE
  function createService({ store, clock = () => Date.now() } = {}) {
    const S = store || new MemoryStore();
    const listeners = []; let seq = 0;
    const now = () => clock();
    const uid = p => p + '-' + now().toString(36).slice(-5).toUpperCase() + (++seq).toString(36).toUpperCase();
    const meta = () => S.get('meta', 'meta');
    const rules = () => S.get('settings', 'rules');
    const counter = k => { const m = meta(); const c = Object.assign({}, m.counters); c[k] = (c[k] || 0) + 1; S.update('meta', 'meta', { counters: c }); return c[k]; };
    const num = (p, k) => p + '-' + new Date(now()).getUTCFullYear() + '-' + String(counter(k)).padStart(4, '0');
    const bump = () => { const m = meta(); S.update('meta', 'meta', { version: m.version + 1 }); for (const f of listeners) try { f(); } catch (e) { /* ignore */ } };
    const SYS = { username: 'marsa-engine', role: 'system', name: tx('محرك مَرسى', 'MARSA engine') };
    const clear = (t) => { for (const r of S.all(t).slice()) S.remove(t, r.id); };
    const area = id => S.get('seaAreas', id);
    const vessel = id => S.get('vessels', id);
    const port = id => S.get('ports', id);
    const needOfficer = u => { if (!u || u.role !== 'officer') throw new PermissionError('officer'); };
    const needDisc = a => { if (!a || a.disclaimer !== true) throw new ValidationError('disclaimer_required'); };
    const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const bil = (o, n = 2000) => ({ ar: str(o && o.ar, n), en: str(o && o.en, n) });

    // Audit log: append-only hash chain
    let pendingTx = null; // status transition captured by setAlert/setBulletin/setAllocation for the next audit row of the same entity
    const markTx = (id, prev, next) => { pendingTx = { id, prev, next }; };
    function audit(actor, action, entity, entityId, summary, details, prevStatus, newStatus) {
      const last = S.all('auditLogs').slice(-1)[0];
      if (pendingTx && pendingTx.id === entityId && prevStatus === undefined) { prevStatus = pendingTx.prev; newStatus = pendingTx.next; pendingTx = null; }
      const row = { id: uid('AU'), seq: (last ? last.seq : 0) + 1, ts: now(), actor: actor.username, role: actor.role || 'system', action, entity, entityId: entityId || null, summary, details: details || null, prevStatus: prevStatus || null, newStatus: newStatus || null, prevHash: last ? last.hash : 'GENESIS' };
      row.hash = C.sha256(row.prevHash + JSON.stringify([row.seq, row.ts, row.actor, row.action, row.entity, row.entityId, row.summary, row.details, row.prevStatus, row.newStatus]));
      S.insert('auditLogs', row);
    }
    function verifyAudit() {
      let prev = 'GENESIS', n = 0;
      for (const r of S.all('auditLogs')) { n++; const h = C.sha256(prev + JSON.stringify([r.seq, r.ts, r.actor, r.action, r.entity, r.entityId, r.summary, r.details, r.prevStatus || null, r.newStatus || null])); if (r.prevHash !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq, checked: n }; prev = r.hash; }
      return { ok: true, checked: n, head: prev.slice(0, 16) };
    }

    // ---------------- Routing helpers (weighted: constraints, hazards, sea conditions)
    function edgeLegal(a, b, ctx) {
      for (const k of ctx.constraints) { if (C.segmentHitsPoly(a, b, k.poly)) { if (k.kind === 'restricted') return false; if (k.minDepthM != null && ctx.draft + ctx.ukc > k.minDepthM) return false; } }
      for (const h of ctx.avoid) if (C.segmentHitsPoly(a, b, h.poly)) return false;
      return true;
    }
    function edgeCost(a, b, nm, ctx) {
      let pen = 0; for (const z of ctx.rough) if (C.segmentHitsPoly(a, b, z.poly)) pen = Math.max(pen, z.pen);
      return nm * (1 + pen);
    }
    function route(fromPos, startNodes, destNode, ctx) {
      // multi-source Dijkstra from the vessel position through candidate first nodes
      const dist = {}, prev = {}, done = new Set(), q = [];
      for (const s of startNodes) { if (!s || !C.NODES[s]) continue; if (!edgeLegal(fromPos, C.NODES[s], ctx)) continue; const d = edgeCost(fromPos, C.NODES[s], C.gcNm(fromPos, C.NODES[s]), ctx); if (d < (dist[s] ?? Infinity)) { dist[s] = d; prev[s] = null; q.push([d, s]); } }
      while (q.length) {
        q.sort((x, y) => x[0] - y[0]); const [d, u] = q.shift(); if (done.has(u)) continue; done.add(u); if (u === destNode) break;
        for (const e of C.GRAPH[u]) {
          if (C.VIRTUAL[u]) continue; if (e.o && e.o.maxDraft && ctx.draft > e.o.maxDraft) continue;
          if (!C.VIRTUAL[e.to] && !edgeLegal(C.NODES[u], C.NODES[e.to], ctx)) continue;
          const nd = d + (C.VIRTUAL[e.to] ? e.nm : edgeCost(C.NODES[u], C.NODES[e.to], e.nm, ctx));
          if (nd < (dist[e.to] ?? Infinity)) { dist[e.to] = nd; prev[e.to] = u; q.push([nd, e.to]); }
        }
      }
      if (dist[destNode] === undefined) return null;
      const nodes = [destNode]; while (prev[nodes[0]] != null) nodes.unshift(prev[nodes[0]]);
      return { nodes, cost: dist[destNode], nm: C.gcNm(fromPos, C.NODES[nodes[0]]) + C.nodesNm(nodes) };
    }
    const nearestNodes = (p, k = 3) => Object.keys(C.NODES).filter(n => !C.VIRTUAL[n]).map(n => [n, C.gcNm(p, C.NODES[n])]).sort((a, b) => a[1] - b[1]).slice(0, k).map(x => x[0]);
    const destNodeOf = id => { const p = C.PORTS.find(x => x.id === id); return p ? p.node : null; };
    const portOcc = p => { const extra = S.all('allocations').filter(a => a.toPort === p.id && ['approved', 'modified'].includes(a.status)).length + S.all('alternativeRoutes').filter(x => x.kind === 'divert' && x.alternative && x.alternative.portId === p.id && ['approved', 'modified'].includes(x.status)).length; return Math.round(p.congestionPct + extra * 100 / p.capacityBerths); };
    const geo = v => { v.distCoastNm = r1(C.distToSaudiCoastNm(v.pos)); v.inTerritorialSea = v.distCoastNm <= C.TERRITORIAL_SEA_NM; return v; };
    const coordsOf = v => [v.pos].concat(v.routeNodes.map(n => C.NODES[n]));
    function remainingNm(v) { return v.routeNodes.length ? C.gcNm(v.pos, C.NODES[v.routeNodes[0]]) + C.nodesNm(v.routeNodes) : 0; }
    function planVesselRoute(v) {
      const dn = destNodeOf(v.destId); if (!dn) return { routeNodes: [], routeNm: 0 };
      const r = route(v.pos, nearestNodes(v.pos, 4), dn, { constraints: [], avoid: [], rough: [], draft: v.draft, ukc: 0 });
      return r ? { routeNodes: r.nodes, routeNm: Math.round(r.nm) } : { routeNodes: [], routeNm: 0 };
    }

    // ---------------- Seed: the test dataset
    function seed() {
      for (const t of ['meta', 'settings', 'users', 'seaAreas', 'ports', 'vessels', 'constraints', 'weatherObservations', 'weatherForecasts', 'maritimeRisks', 'affectedVessels', 'alerts', 'deliveryRecords', 'alternativeRoutes', 'bulletins', 'bulletinDeliveries', 'allocations', 'navtexMessages', 'integrationEvents', 'dataSources', 'auditLogs']) clear(t);
      const T0 = Math.floor(now() / (10 * MIN)) * 10 * MIN; // dataset reference time
      S.insert('meta', { id: 'meta', version: 1, counters: {}, datasetAt: T0, seededAt: now() });
      S.insert('settings', Object.assign({ id: 'rules' }, JSON.parse(JSON.stringify(DEFAULT_RULES))));
      S.insert('users', { id: 'OFFICER', username: 'port.officer', role: 'officer', name: tx('ضابط الميناء (حساب اختبار)', 'Port Officer (test account)') });
      for (const a of SEA_AREAS) S.insert('seaAreas', { id: a.id, name: tx(a.ar, a.en), sea: a.sea, p: a.p, radiusNm: a.r, poly: C.circlePoly(a.p, a.r, 24) });
      for (const k of CONSTRAINTS) S.insert('constraints', { id: k.id, kind: k.kind, minDepthM: k.minDepthM, name: tx(k.ar, k.en), poly: k.poly, source: 'test' });
      for (const p of C.PORTS.filter(p => p.country === 'SA')) {
        const t = PORT_TEST[p.id] || [50, 'Normal operations (test).', 'تشغيل اعتيادي (تجريبي).'];
        S.insert('ports', { id: p.id, name: tx(p.ar, p.en), p: p.p, node: p.node, status: 'open', congestionPct: t[0], capacityBerths: p.berths, availableBerths: Math.round(p.berths * (1 - t[0] / 100)), maxDraftM: p.maxDraft, conditions: tx(t[2], t[1]), restrictions: tx('', ''), statusUntil: null, updatedAt: T0 - 30 * MIN, updatedBy: 'test-dataset' });
      }
      // weather: forecasts 0..48 h and the latest observation per area
      for (const a of SEA_AREAS) {
        const series = [];
        for (let h = 0; h <= 48; h++) series.push(Object.assign({ h, validAt: T0 + h * H, reliability: r2(.95 - .006 * h) }, sampleValue(a, h, T0)));
        S.insert('weatherForecasts', { id: 'F:' + a.id, areaId: a.id, issuedAt: T0 - 20 * MIN, source: 'sample', label: 'Sample Weather Data', series });
        const o = Object.assign({}, series[0]); delete o.h; delete o.validAt; delete o.reliability;
        S.insert('weatherObservations', Object.assign({ id: 'O:' + a.id, areaId: a.id, recordedAt: T0 - 15 * MIN, source: 'sample', label: 'Sample Weather Data', reliability: .9 }, o));
      }
      // vessels (static test AIS positions at the dataset time)
      for (const [id, name, type, oId, dId, at, back, sog, draft, len, ch] of VESSELS) {
        const o = C.PORTS.find(p => p.id === oId), d = C.PORTS.find(p => p.id === dId), n = parseInt(id.slice(1), 10);
        const v = { id, name, imo: 'TEST-' + (9100000 + n * 4111 + 1), mmsi: '999' + String(100000 + n * 731).slice(-6), type, flag: 'SA', originId: oId, destId: dId, sog, cog: 0, draft, lengthM: len, channel: ch, status: 'underway', pos: null, routeNodes: [], recordedAt: T0 - (3 + n % 7) * MIN, source: 'test' };
        if (at === 'anchor' || at === 'berth') { v.status = at === 'anchor' ? 'anchored' : 'moored'; v.sog = 0; const N0 = C.NODES[d.node]; v.pos = at === 'anchor' ? [d.p[0] * .55 + N0[0] * .45 - .01 + .02 * (n % 3), d.p[1] * .55 + N0[1] * .45 + .025 * ((n % 4) - 1.5)] : [d.p[0] - .02, d.p[1] + .01 * (n % 3)]; }
        else if (at === 'approach') { const N0 = C.NODES[d.node]; v.pos = [N0[0] + (d.p[0] - N0[0]) * .35, N0[1] + (d.p[1] - N0[1]) * .35 - .03]; v.cog = Math.round(C.bearing ? C.bearing(v.pos, d.p) : 90); v.routeNodes = []; v.approachNm = C.gcNm(v.pos, d.p); }
        else {
          const path = C.shortestPath(o.node, d.node, { draft }); const line = [o.virtual ? C.NODES[path.nodes[0]] : o.p].concat(path.nodes.map(x => C.NODES[x]));
          let acc = 0, idx = 1; for (; idx < line.length; idx++) { acc += C.gcNm(line[idx - 1], line[idx]); if (path.nodes[idx - 1] === at) break; }
          const pa = C.pointAlong(line, Math.max(0, acc - back)); v.pos = pa.pos; v.cog = Math.round(pa.cog); v.routeNodes = path.nodes.slice(Math.max(0, pa.idx - 1));
        }
        v.routeNm = Math.round(v.approachNm || remainingNm(v)); delete v.approachNm; v.etaAt = v.status === 'underway' && !C.VIRTUAL[d.node] ? T0 + v.routeNm / v.sog * H : null; geo(v);
        S.insert('vessels', v);
        S.insert('users', { id: 'B-' + id, username: 'bridge.' + v.mmsi, role: 'bridge', vesselId: id, name: tx('جسر ' + name, name + ' bridge') });
      }
      for (const r of RISK_RECORDS) S.insert('maritimeRisks', { id: 'R:' + r.key, key: r.key, source: 'record', type: r.type, level: r.level, title: tx(r.ar, r.en), areaName: tx(r.ar, r.en), center: r.p, radiusNm: r.r, poly: C.circlePoly(r.p, r.r, 16), start: T0 + r.start * H, end: T0 + r.end * H, durationH: r.end - r.start, indicators: [{ name: 'report', text: r.ind, level: r.level }], explanation: tx('سجل خطر من بيانات الاختبار: ' + r.ind.ar + '.', 'Risk record from the test dataset: ' + r.ind.en + '.'), actions: ACTIONS[r.type], confidence: confidenceOf(.8, 'record'), createdAt: T0 - H, createdBy: 'test-dataset' });
      S.insert('dataSources', { id: 'ncm', name: tx('بيانات الأرصاد البحرية', 'Marine weather data'), label: 'Sample Weather Data', kind: 'test', lastReceivedAt: T0 - 20 * MIN, accepted: SEA_AREAS.length, rejected: 0, lastErrors: [] });
      S.insert('dataSources', { id: 'ais', name: tx('مواقع السفن', 'Vessel positions'), label: 'Test AIS Data', kind: 'test', lastReceivedAt: T0 - 3 * MIN, accepted: VESSELS.length, rejected: 0, lastErrors: [] });
      S.insert('dataSources', { id: 'ports', name: tx('بيانات الموانئ', 'Port data'), label: 'Test Port Records', kind: 'test', lastReceivedAt: T0 - 30 * MIN, accepted: 7, rejected: 0, lastErrors: [] });
      S.insert('dataSources', { id: 'navtex', name: tx('توزيع NAVTEX المعتمد', 'Authorized NAVTEX distribution'), label: 'Proposed Integration', kind: 'not_connected', lastReceivedAt: null, accepted: 0, rejected: 0, lastErrors: [] });
      S.insert('dataSources', { id: 'navarea', name: tx('تنسيق NAVAREA IX', 'NAVAREA IX coordination'), label: 'Proposed Integration', kind: 'not_connected', lastReceivedAt: null, accepted: 0, rejected: 0, lastErrors: [] });
      audit(SYS, 'data.load', 'dataset', null, tx('تحميل بيانات الاختبار: ' + SEA_AREAS.length + ' مناطق أرصاد، ' + VESSELS.length + ' سفينة، ' + C.PORTS.filter(p => p.country === 'SA').length + ' موانئ، ' + RISK_RECORDS.length + ' سجلات مخاطر، ' + CONSTRAINTS.length + ' قيود ملاحية', 'Test data loaded: ' + SEA_AREAS.length + ' weather areas, ' + VESSELS.length + ' vessels, ' + C.PORTS.filter(p => p.country === 'SA').length + ' ports, ' + RISK_RECORDS.length + ' risk records, ' + CONSTRAINTS.length + ' navigational constraints'));
      analyse('dataset load');
      // three sample bulletins at different stages
      const OFFU = { username: 'port.officer', role: 'officer' };
      const rj = S.all('maritimeRisks').filter(x => x.areaId === 'JED').sort((a, b) => rank(b.level) - rank(a.level))[0];
      const b1 = api.createBulletin(OFFU, { type: 'weather_bulletin', areaId: 'AGC', title: tx('نشرة بحرية – وسط الخليج العربي', 'Marine bulletin – Central Arabian Gulf'), body: tx(marineForecast('AGC', 24).text.ar, marineForecast('AGC', 24).text.en) });
      api.submitBulletin(OFFU, { id: b1.id }); api.approveBulletin(OFFU, { id: b1.id }); api.sendBulletin(OFFU, { id: b1.id });
      const b2 = api.createBulletin(OFFU, { type: 'nav_restriction', riskId: 'R:TR1', title: tx('جسم طافٍ على الممر الملاحي غرب ينبع', 'Floating object on the shipping lane west of Yanbu'), body: S.get('maritimeRisks', 'R:TR1').explanation });
      api.submitBulletin(OFFU, { id: b2.id });
      if (rj) api.createBulletin(OFFU, { type: 'wind_wave_warning', riskId: rj.id, title: rj.title, body: rj.explanation });
    }
    function sampleValue(a, h, T0) {
      const hod = (new Date(T0 + h * H).getUTCHours() + 3) % 24, di = Math.sin(2 * Math.PI * (hod - 9) / 24), b = a.b;
      let w = b.w + 3 * di, wd = b.wd, wave = b.h + .15 * di, wvd = b.hd, c = b.c, cd = b.cd, v = b.v - .5 * di, t = b.t + 3 * di;
      for (const s of SAMPLE_SYSTEMS) {
        const k0 = s.areas[a.id] || 0; if (!k0) continue;
        const sh = h < s.start || h > s.end ? 0 : h < s.peakFrom ? (h - s.start) / (s.peakFrom - s.start) : h <= s.peakTo ? 1 : 1 - (h - s.peakTo) / (s.end - s.peakTo);
        const k = k0 * sh; if (k <= 0) continue;
        w += (s.set.w - w) * k; wave += (s.set.h - wave) * k; v += (s.set.v - v) * k; c += (s.set.c - c) * k; t += s.set.t * k;
        if (k > .4) { wd = s.set.wd; wvd = s.set.hd; }
      }
      return { windKn: r1(Math.max(2, w)), windDir: Math.round(wd), gustKn: r1(Math.max(2, w) * 1.3), waveM: r1(Math.max(.2, wave)), waveDir: Math.round(wvd), currentKn: r1(Math.max(.1, c)), currentDir: Math.round(cd), visNm: r1(clamp(v, .2, 15)), tempC: r1(t) };
    }

    // ---------------- Analysis engine (rules) → maritimeRisks + affectedVessels
    function analyse(reason) {
      const R = rules(), T0 = meta().datasetAt, t = now();
      for (const r of S.all('maritimeRisks').filter(r => r.source === 'rules' || r.source === 'port').slice()) S.remove('maritimeRisks', r.id);
      const found = [];
      for (const f of S.all('weatherForecasts')) {
        const a = area(f.areaId); let cur = null;
        for (const s of f.series) {
          const inds = ['windKn', 'waveM', 'visNm', 'currentKn'].map(k => ({ name: k, value: s[k], level: levelOf(k, s[k], R) }));
          const lvl = inds.reduce((m, x) => maxL(m, x.level), 'none');
          if (rank(lvl) >= rank(R.minLevel)) {
            if (!cur) { cur = { a, f, fromH: s.h, toH: s.h, level: lvl, peak: s, inds: {} }; found.push(cur); }
            cur.toH = s.h; cur.level = maxL(cur.level, lvl);
            if (s.waveM > cur.peak.waveM || s.windKn > cur.peak.windKn) cur.peak = s;
            for (const x of inds) if (rank(x.level) >= rank(R.minLevel) && (!cur.inds[x.name] || rank(x.level) > rank(cur.inds[x.name].level) || (x.name === 'visNm' ? x.value < cur.inds[x.name].value : x.value > cur.inds[x.name].value))) cur.inds[x.name] = { name: x.name, value: x.value, level: x.level, at: s.validAt };
          } else cur = null;
        }
      }
      const LVA = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' };
      for (const w of found) {
        const inds = Object.values(w.inds).sort((x, y) => rank(y.level) - rank(x.level));
        let dom = inds[0] ? DOMINANT[inds[0].name] : 'high_waves'; if (inds.filter(x => rank(x.level) >= 3 && (x.name === 'windKn' || x.name === 'waveM')).length === 2 && w.level === 'critical') dom = 'severe_weather';
        const start = w.f.series[w.fromH].validAt, end = w.f.series[w.toH].validAt + H;
        const th = x => { const tt = R[x.name], i = Math.max(0, rank(x.level) - 1); return (x.name === 'visNm' ? '≤ ' : '≥ ') + tt[i] + ' ' + UNIT[x.name]; };
        const expAr = 'صُنّفت ' + w.a.name.ar + ' بمستوى «' + LVA[w.level] + '» لأن: ' + inds.map(x => IND[x.name].ar + ' ' + x.value + ' ' + UNIT[x.name] + ' (حد مستوى «' + LVA[x.level] + '» ' + th(x) + ')').join('، ') + '. المدة ' + (w.toH - w.fromH + 1) + ' ساعة في بيانات التوقعات التجريبية.';
        const expEn = w.a.name.en + ' is rated ' + w.level + ' because: ' + inds.map(x => IND[x.name].en + ' ' + x.value + ' ' + UNIT[x.name] + ' (' + x.level + ' threshold ' + th(x) + ')').join(', ') + '. Duration ' + (w.toH - w.fromH + 1) + ' h in the sample forecast.';
        S.insert('maritimeRisks', { id: 'R:' + w.a.id + ':' + Math.round((start - T0) / H), key: w.a.id + ':' + Math.round((start - T0) / H), source: 'rules', type: dom, level: w.level, title: tx(RTYPE[dom].ar + ' – ' + w.a.name.ar, RTYPE[dom].en + ' – ' + w.a.name.en), areaId: w.a.id, areaName: w.a.name, center: w.a.p, radiusNm: w.a.radiusNm, poly: w.a.poly,
          start, end, durationH: w.toH - w.fromH + 1, peak: { at: w.peak.validAt, windKn: w.peak.windKn, gustKn: w.peak.gustKn, waveM: w.peak.waveM, visNm: w.peak.visNm, currentKn: w.peak.currentKn }, indicators: inds.map(x => Object.assign({ name: x.name, label: IND[x.name], value: x.value, unit: UNIT[x.name], level: x.level, threshold: th(x), at: x.at }, x.name === 'windKn' ? { beaufort: beaufort(x.value), wmoWarning: windWarning(x.value) } : {})),
          wmoWindWarning: windWarning(w.peak.windKn) ? { category: windWarning(w.peak.windKn), label: WWARN[windWarning(w.peak.windKn)], beaufort: beaufort(w.peak.windKn), ref: WWMIWS_REF } : null,
          reliability: w.f.series[w.fromH].reliability, explanation: tx(expAr, expEn), actions: ACTIONS[dom], confidence: confidenceOf(w.f.series[w.fromH].reliability, 'rules'), createdAt: t, createdBy: 'rules-engine' });
      }
      for (const p of S.all('ports').filter(p => p.status !== 'open')) {
        const ty = p.status === 'closed' ? 'port_closure' : 'port_restriction';
        S.insert('maritimeRisks', { id: 'R:PORT:' + p.id, key: 'PORT:' + p.id, source: 'port', type: ty, level: p.status === 'closed' ? 'high' : 'medium', title: tx(RTYPE[ty].ar + ' – ' + p.name.ar, RTYPE[ty].en + ' – ' + p.name.en), areaName: p.name, center: p.p, radiusNm: 12, poly: C.circlePoly(p.p, 12, 16), start: p.updatedAt, end: p.statusUntil || p.updatedAt + 24 * H, durationH: Math.round(((p.statusUntil || p.updatedAt + 24 * H) - p.updatedAt) / H),
          indicators: [{ name: 'port', text: tx('حالة الميناء: ' + (p.status === 'closed' ? 'مغلق' : 'مقيّد') + (p.restrictions.ar ? ' – ' + p.restrictions.ar : ''), 'Port status: ' + p.status + (p.restrictions.en ? ' – ' + p.restrictions.en : '')), level: p.status === 'closed' ? 'high' : 'medium' }],
          explanation: tx('خطر تشغيلي ناتج عن حالة الميناء التي حددها ضابط الميناء.', 'Operational risk derived from the port status set by the port officer.'), actions: ACTIONS[ty], confidence: confidenceOf(1, 'port'), createdAt: t, createdBy: 'rules-engine' });
      }
      for (const p of S.all('ports').filter(p => p.status === 'open' && portOcc(p) >= 85)) {
        const occ = portOcc(p), lvl = occ >= 92 ? 'high' : 'medium';
        S.insert('maritimeRisks', { id: 'R:CONG:' + p.id, key: 'CONG:' + p.id, source: 'port', type: 'port_congestion', level: lvl, title: tx(RTYPE.port_congestion.ar + ' – ' + p.name.ar, RTYPE.port_congestion.en + ' – ' + p.name.en), areaName: p.name, center: p.p, radiusNm: 12, poly: C.circlePoly(p.p, 12, 16), start: t, end: t + 24 * H, durationH: 24,
          indicators: [{ name: 'port', text: tx('الإشغال ' + occ + '٪ (حد التنبيه ٨٥٪، الحد الأعلى للتحويل ٨٨٪)', 'Occupancy ' + occ + '% (alert threshold 85%, diversion ceiling 88%)'), level: lvl }],
          explanation: tx('إشغال الميناء مرتفع؛ السفن القادمة قد تحتاج تأجيل الوصول أو التحويل.', 'Port occupancy is high; incoming vessels may need to delay arrival or divert.'), actions: ACTIONS.port_congestion, confidence: confidenceOf(1, 'port'), createdAt: t, createdBy: 'rules-engine' });
      }
      computeAffected();
      const n = S.all('maritimeRisks').length;
      audit(SYS, 'risk.analyse', 'analysis', null, tx('تحليل المخاطر (' + reason + '): ' + n + ' مخاطر، ' + S.all('affectedVessels').filter(x => x.relation !== 'crossing').length + ' حالة تأثر سفن', 'Risk analysis (' + reason + '): ' + n + ' risks, ' + S.all('affectedVessels').filter(x => x.relation !== 'crossing').length + ' vessel exposures'));
    }
    function computeAffected() {
      clear('affectedVessels');
      const t = now(), horizon = t + 48 * H;
      for (const r of S.all('maritimeRisks')) {
        let cnt = 0;
        if (r.end < t) { S.update('maritimeRisks', r.id, { affectedCount: 0, affectedPorts: [] }); continue; }
        for (const v of S.all('vessels')) {
          if (!v.pos) continue;
          let rel = null, eta = null, dist = 0;
          if (C.pointInPoly(v.pos, r.poly)) { rel = 'inside'; eta = t; }
          else if (v.status === 'underway' && v.routeNodes.length && v.sog > 0) {
            const cs = coordsOf(v); let acc = 0;
            for (let i = 0; i < cs.length - 1; i++) { if (C.VIRTUAL[v.routeNodes[i]]) break; if (C.segmentHitsPoly(cs[i], cs[i + 1], r.poly)) { dist = acc + entryOffset(cs[i], cs[i + 1], r.poly); eta = t + dist / v.sog * H; break; } acc += C.gcNm(cs[i], cs[i + 1]); }
            if (eta != null) rel = eta <= horizon && eta <= r.end ? 'entering' : 'crossing';
          }
          if (!rel) continue;
          const during = rel === 'inside' ? r.start <= horizon : (eta >= r.start - 2 * H && eta <= r.end);
          const reason = rel === 'inside' ? tx('السفينة داخل منطقة الخطر الآن', 'Vessel is inside the risk area now')
            : rel === 'entering' ? tx('مسارها يدخل المنطقة بعد ' + r1(dist) + ' ميل بحري (~' + r1((eta - t) / H) + ' ساعة) ' + (during ? 'خلال فترة الخطر' : 'قبل بداية الخطر'), 'Its route enters the area after ' + r1(dist) + ' nm (~' + r1((eta - t) / H) + ' h) ' + (during ? 'during the risk window' : 'before the risk starts'))
              : tx('مسارها يتقاطع مع المنطقة لكن الوصول خارج فترة الخطر أو بعد ٤٨ ساعة', 'Its route crosses the area but arrival is outside the risk window or beyond 48 h');
          S.insert('affectedVessels', { id: 'AV:' + r.id + ':' + v.id, riskId: r.id, vesselId: v.id, relation: rel, etaToZone: eta, distanceNm: r1(dist), duringRisk: during, reason, computedAt: t });
          if (rel !== 'crossing') cnt++;
        }
        const ports = S.all('ports').filter(pt => C.pointInPoly(pt.p, r.poly) || C.gcNm(pt.p, r.center) <= r.radiusNm + 5).map(pt => pt.id);
        S.update('maritimeRisks', r.id, { affectedCount: cnt, affectedPorts: ports });
      }
    }
    function trackTo(cs, nm) { const out = [cs[0]]; let acc = 0; for (let i = 1; i < cs.length; i++) { const d = C.gcNm(cs[i - 1], cs[i]); if (acc + d >= nm) { out.push(C.pointAlong([cs[i - 1], cs[i]], nm - acc).pos); return out; } out.push(cs[i]); acc += d; } return out; }
    function entryOffset(a, b, poly) { const L = C.gcNm(a, b); for (let k = 0; k <= 40; k++) { const p = [a[0] + (b[0] - a[0]) * k / 40, a[1] + (b[1] - a[1]) * k / 40]; if (C.pointInPoly(p, poly)) return L * k / 40; } return L / 2; }

    // ---------------- Alternative routes
    function roughZones(exceptId) {
      const R = rules(), out = [];
      for (const r of S.all('maritimeRisks')) if (r.id !== exceptId && r.source === 'rules' && r.level === 'medium') out.push({ poly: r.poly, pen: R.seaPenaltyPct / 100 });
      return out;
    }
    // ---------------- Decision engine per vessel: continue / reroute / delay entry / divert to an alternative port
    // Chosen by safety first, then lowest estimated cost (time + fuel). OPTIMIZE: diversions never push a port above 88 % occupancy.
    const FUEL_TPD = { container: 60, tanker: 45, bulk: 30, general: 22, roro: 35, lng: 70 }; // test assumptions (t/day at sea)
    const OPEX = { container: 32000, tanker: 28000, bulk: 18000, general: 14000, roro: 22000, lng: 60000 }; // USD/day, test assumptions
    const MAX_OCC = 88;
    function metrics(v, nm, waitH) {
      const sog = Math.max(1, v.sog || 12), seaH = nm / sog, rate = FUEL_TPD[v.type] || 30, hours = seaH + waitH;
      const fuelT = seaH * rate / 24 + waitH * rate * C.ASSUMPTIONS.waitFuelFactor / 24;
      const costSAR = (fuelT * C.ASSUMPTIONS.fuelPriceUSDperT + hours / 24 * (OPEX[v.type] || 18000)) * C.ASSUMPTIONS.usdToSar;
      return { nm: Math.round(nm), hours: r1(hours), waitH: r1(waitH), fuelT: r1(fuelT), costSAR: Math.round(costSAR / 100) * 100 };
    }
    function decideOptions(v, r, row, alloc) {
      row._base = { kind: row.kind, alternative: row.alternative, checks: row.checks, reason: row.reason };
      const t = now(), R = rules(), aff = S.all('affectedVessels').find(a => a.riskId === r.id && a.vesselId === v.id);
      const destP = port(v.destId), destClosed = destP && destP.status === 'closed';
      const arrival = t + (row.current.nm || 0) / Math.max(1, v.sog || 12) * H, beforeRisk = !destClosed && destP && arrival < r.start;
      const unsafe = !beforeRisk && ((aff && aff.relation !== 'crossing') || destClosed || C.pointInPoly(v.pos, r.poly));
      const opts = [Object.assign({ kind: 'continue', label: tx('الاستمرار في المسار الحالي', 'Continue on current route'), safe: !unsafe }, metrics(v, row.current.nm, 0))];
      if (row.kind === 'reroute') opts.push(Object.assign({ kind: 'reroute', label: tx('تغيير المسار', 'Change route'), safe: true }, metrics(v, row.alternative.nm, 0)));
      if (row.kind === 'wait') opts.push(Object.assign({ kind: 'wait', label: tx('الانتظار في منطقة آمنة', 'Wait in a safe area'), safe: true }, metrics(v, row.alternative.nm, row.alternative.waitHours || 0)));
      if (unsafe && aff && aff.relation === 'entering' && row.kind !== 'wait') opts.push(Object.assign({ kind: 'delay', label: tx('تأجيل الدخول حتى انتهاء الخطر', 'Delay entry until the risk ends'), safe: true }, metrics(v, row.current.nm, Math.max(0, (r.end - aff.etaToZone) / H))));
      const dest = C.PORTS.find(p => p.id === v.destId), region = dest && dest.region;
      const high = S.all('maritimeRisks').filter(x => rank(x.level) >= 3 && x.end > t);
      for (const p of S.all('ports')) {
        const cp = C.PORTS.find(x => x.id === p.id);
        if (p.id === v.destId || p.status !== 'open' || !cp || cp.region !== region || p.maxDraftM < v.draft + R.ukcM || high.some(x => C.pointInPoly(p.p, x.poly))) continue;
        const occ = portOcc(p) + ((alloc[p.id] || 0) + 1) * 100 / p.capacityBerths;
        const rt = route(v.pos, nearestNodes(v.pos, 4), p.node, { constraints: S.all('constraints'), avoid: high.filter(x => !C.pointInPoly(v.pos, x.poly)).map(x => ({ poly: x.poly })), rough: [], draft: v.draft, ukc: R.ukcM });
        if (!rt) continue;
        opts.push(Object.assign({ kind: 'divert', portId: p.id, label: tx('التحويل إلى ' + p.name.ar, 'Divert to ' + p.name.en), safe: occ <= MAX_OCC, occupancyAfter: Math.round(occ), nodes: rt.nodes }, metrics(v, rt.nm, 0)));
      }
      const pool = opts.filter(o => o.safe), best = pool.length ? pool.slice().sort((a, b) => a.costSAR - b.costSAR)[0] : (opts.find(o => o.kind === 'wait') || opts[0]);
      row.needsReview = !pool.length;
      row.options = opts.map(o => Object.assign({}, o, { recommended: o === best, nodes: undefined }));
      row.recommended = { kind: best.kind, portId: best.portId || null, label: best.label };
      row._nodes = Object.fromEntries(opts.filter(o => o.nodes).map(o => [o.portId, o.nodes]));
      if (best.kind === 'divert') {
        alloc[best.portId] = (alloc[best.portId] || 0) + 1;
        row.kind = 'divert'; row.alternative = { nodes: best.nodes, nm: best.nm, hours: best.hours, portId: best.portId, coords: [v.pos].concat(C.nodesToCoords(best.nodes)) };
        row.reason = tx('التحويل إلى ' + port(best.portId).name.ar + ' أقل تكلفة وأكثر أمانًا من الانتظار أو تغيير المسار؛ إشغال الميناء بعد التحويل ' + best.occupancyAfter + '٪ (الحد ' + MAX_OCC + '٪).', 'Diverting to ' + port(best.portId).name.en + ' is safer and cheaper than waiting or rerouting; port occupancy after diversion ' + best.occupancyAfter + '% (limit ' + MAX_OCC + '%).');
        row.checks = [{ k: 'risk', ok: true, text: tx('يتجنب مناطق الخطر المرتفع', 'Avoids high-risk areas') }, { k: 'capacity', ok: best.occupancyAfter <= MAX_OCC, text: tx('إشغال الميناء البديل بعد التحويل ' + best.occupancyAfter + '٪', 'Alternative port occupancy after diversion ' + best.occupancyAfter + '%') }, { k: 'depth', ok: true, text: tx('غاطس السفينة ضمن حد الميناء', 'Vessel draft within the port limit') }];
      } else if (best.kind === 'delay') {
        row.kind = 'delay'; row.alternative = { nodes: row.current.nodes, nm: best.nm, hours: best.hours, waitHours: best.waitH, coords: row.current.coords };
        row.reason = tx('تخفيض السرعة أو الانتظار قبل المنطقة ' + best.waitH + ' ساعة حتى انتهاء الخطر ثم إكمال الرحلة هو الأقل تكلفة.', 'Slowing down or waiting before the area for ' + best.waitH + ' h until the risk ends, then continuing, is the lowest-cost option.');
      } else if (best.kind === 'continue') { row.kind = 'continue'; row.alternative = null; row.checks = []; row.reason = beforeRisk ? tx('السفينة تصل الميناء قبل بداية الخطر؛ يُوصى بإكمال الدخول دون تأخير.', 'The vessel reaches port before the risk starts; completing entry without delay is recommended.') : tx('الاستمرار في المسار الحالي آمن خلال فترة الخطر.', 'Continuing on the current route is safe during the risk window.'); }
      return row;
    }
    function genRecs(al) {
      const r = al.riskId && S.get('maritimeRisks', al.riskId) || { id: 'ALERT:' + al.id, title: al.title, level: al.severity, poly: al.poly, start: al.validFrom, end: al.validTo, areaName: al.areaName };
      const ae = v => (S.all('affectedVessels').find(x => x.vesselId === v.id && x.riskId === r.id) || {}).etaToZone || 0;
      const alloc = {}; for (const v of al.targets.map(vessel).filter(v => v && v.status === 'underway').sort((a, b) => ae(a) - ae(b))) proposeRoute(v, r, al.id, SYS, alloc);
    }
    function proposeRoute(v, r, alertId, actor, alloc) {
      const t = now(), R = rules();
      const cur = { nodes: v.routeNodes, coords: v.routeNodes.length ? coordsOf(v) : [v.pos, (C.PORTS.find(p => p.id === v.destId) || { p: v.pos }).p], nm: Math.round(remainingNm(v) || v.routeNm || 0) }; cur.hours = v.sog ? r1(cur.nm / v.sog) : null;
      const blocking = S.all('maritimeRisks').filter(x => (x.id === r.id || rank(x.level) >= rank('high')) && x.end > t && !C.pointInPoly(v.pos, x.poly));
      const avoid = blocking.map(x => ({ poly: x.poly })); if (r.poly && !blocking.some(x => x.id === r.id) && !C.pointInPoly(v.pos, r.poly)) avoid.push({ poly: r.poly });
      const ctx = { constraints: S.all('constraints'), avoid, rough: roughZones(r.id), draft: v.draft, ukc: R.ukcM };
      const dn = destNodeOf(v.destId), checks = [];
      const destPort = C.PORTS.find(p => p.id === v.destId);
      const destInZone = destPort && C.pointInPoly(destPort.p, r.poly);
      let alt = null, kind = null, why = null;
      if (dn && !destInZone) {
        const p = route(v.pos, nearestNodes(v.pos, 4), dn, ctx);
        if (p) { kind = 'reroute'; alt = { nodes: p.nodes, nm: Math.round(p.nm), coords: [v.pos].concat(C.nodesToCoords(p.nodes)) }; alt.hours = r1(alt.nm / Math.max(1, v.sog)); why = tx('يتجنب منطقة الخطر والقيود الملاحية في بيانات الاختبار مع مراعاة الغاطس، ويقلل المرور بمناطق الأحوال البحرية المتوسطة؛ الوصول إلى الوجهة نفسها.', 'Avoids the risk area and the test navigational constraints for this draft, and limits passage through medium sea-condition areas; same destination.'); }
      }
      if (!alt && dn) {
        // wait at the nearest designated waiting area outside every high risk, then continue after the risk ends
        const holds = Object.keys(C.WAITING_AREAS || {}).filter(n => C.NODES[n] && !S.all('maritimeRisks').some(x => rank(x.level) >= 3 && x.end > t && C.pointInPoly(C.NODES[n], x.poly)));
        let best = null;
        for (const hn of holds) { const p = route(v.pos, nearestNodes(v.pos, 4), hn, ctx); if (!p || p.nm > 400) continue; if (!best || p.nm < best.p.nm) best = { hn, p }; }
        // also consider holding on the vessel's own track, 10 nm before it would enter the area
        const cs = coordsOf(v); let acc = 0, entry = null;
        for (let i = 0; i < cs.length - 1; i++) { if (C.segmentHitsPoly(cs[i], cs[i + 1], r.poly)) { entry = acc + entryOffset(cs[i], cs[i + 1], r.poly); break; } acc += C.gcNm(cs[i], cs[i + 1]); }
        let back = null;
        if (entry != null) for (let off = 10; entry - off >= 3; off += 10) { const q = C.pointAlong(cs, entry - off).pos; if (!S.all('maritimeRisks').some(x => rank(x.level) >= 3 && x.end > t && C.pointInPoly(q, x.poly))) { back = off; break; } }
        if (back != null) {
          const hp = C.pointAlong(cs, entry - back).pos;
          {
            const arr = (entry - back) / Math.max(1, v.sog), wait = Math.max(0, (r.end - t) / H - arr), nm = Math.round(remainingNm(v));
            const own = { kind: 'track', hp, nm, hours: r1(nm / Math.max(1, v.sog) + wait), wait, toHold: entry - back, back };
            best = { own }; // holding on the vessel's own track is the smallest deviation; designated waiting areas are the fallback
          }
        }
        if (best && best.own) {
          const o = best.own, ll = (Math.abs(o.hp[1]).toFixed(2) + '°' + (o.hp[1] >= 0 ? 'N' : 'S') + ' ' + Math.abs(o.hp[0]).toFixed(2) + '°E');
          kind = 'wait'; alt = { nodes: v.routeNodes, holdPoint: o.hp, holdName: tx('نقطة انتظار مقترحة على المسار خارج منطقة الخطر (' + ll + ')', 'Proposed holding point on track outside the risk area (' + ll + ')'), waitHours: r1(o.wait), nm: o.nm, hours: o.hours, toHoldNm: Math.round(o.toHold) };
          alt.coords = coordsOf(v); alt.holdCoords = trackTo(alt.coords, alt.toHoldNm);
          why = tx('لا يوجد مسار يتجنب المنطقة للوصول إلى الوجهة ضمن القيود؛ يُقترح التوقف على المسار قبل دخول منطقة الخطر بنحو ' + o.back + ' ميل بحري، خارج مناطق الخطر المرتفع، والانتظار ' + r1(o.wait) + ' ساعة حتى انتهاء الخطر، ثم إكمال الرحلة.', 'No route reaches the destination around the area within the constraints; holding on track about ' + o.back + ' nm before the risk area, outside high-risk areas, for ' + r1(o.wait) + ' h until the risk ends, then continuing, is proposed.');
        } else if (best) {
          const after = C.shortestPath(best.hn, dn, { draft: v.draft }) || { nodes: [best.hn], nm: 0 };
          const arr = best.p.nm / Math.max(1, v.sog), wait = Math.max(0, (r.end - t) / H - arr);
          kind = 'wait'; alt = { nodes: best.p.nodes.concat(after.nodes.slice(1)), holdNode: best.hn, holdName: C.WAITING_AREAS[best.hn], waitHours: r1(wait), nm: Math.round(best.p.nm + after.nm) };
          alt.coords = [v.pos].concat(C.nodesToCoords(alt.nodes)); alt.hours = r1(alt.nm / Math.max(1, v.sog) + wait);
          why = destInZone ? tx('الوجهة داخل منطقة الخطر؛ يُقترح الانتظار في ' + C.WAITING_AREAS[best.hn].ar + ' حتى انتهاء الخطر ثم إكمال الرحلة.', 'The destination is inside the risk area; waiting at the ' + C.WAITING_AREAS[best.hn].en + ' until the risk ends, then continuing, is proposed.') : tx('لا يوجد مسار يتجنب المنطقة ضمن القيود؛ يُقترح الانتظار في منطقة انتظار حتى انتهاء الخطر.', 'No route avoids the area within the constraints; waiting at a designated area until the risk ends is proposed.');
        }
      }
      if (alt) {
        const legs = kind === 'wait' ? (alt.holdPoint ? trackTo(alt.coords, alt.toHoldNm) : [v.pos].concat(C.nodesToCoords(alt.nodes.slice(0, alt.nodes.indexOf(alt.holdNode) + 1)))) : alt.coords;
        const crossesRisk = legs.some((p, i) => i && C.segmentHitsPoly(legs[i - 1], p, r.poly));
        const others = S.all('maritimeRisks').filter(x => x.end > t && x.id !== r.id && rank(x.level) >= 2 && legs.some((p, i) => i && C.segmentHitsPoly(legs[i - 1], p, x.poly)));
        const shallow = S.all('constraints').filter(k => k.kind === 'shallow' && legs.some((p, i) => i && C.segmentHitsPoly(legs[i - 1], p, k.poly)));
        checks.push({ k: 'risk', ok: !crossesRisk || C.pointInPoly(v.pos, r.poly), text: C.pointInPoly(v.pos, r.poly) ? tx('السفينة داخل المنطقة؛ المسار يخرج منها بأقصر طريق متاح', 'Vessel is inside the area; the route exits it by the shortest available way') : tx('يتجنب منطقة الخطر المرتبطة', 'Avoids the linked risk area') });
        checks.push({ k: 'depth', ok: true, text: shallow.length ? tx('يمر بمنطقة ضحلة تجريبية عمقها كافٍ لغاطس ' + v.draft + ' م + ' + R.ukcM + ' م', 'Crosses a test shallow area with enough depth for draft ' + v.draft + ' m + ' + R.ukcM + ' m') : tx('غاطس ' + v.draft + ' م + هامش ' + R.ukcM + ' م: لا تعارض مع أعماق الاختبار', 'Draft ' + v.draft + ' m + ' + R.ukcM + ' m clearance: no conflict with test depths') });
        checks.push({ k: 'restricted', ok: true, text: tx('لا يمر بالمناطق المحظورة في بيانات الاختبار', 'Does not cross restricted areas in the test data') });
        checks.push({ k: 'sea', ok: !others.length, text: others.length ? tx('يمر بمناطق ذات أحوال أو مخاطر أخرى: ' + others.map(x => x.title.ar).join('، '), 'Passes other risk areas: ' + others.map(x => x.title.en).join(', ')) : tx('لا يمر بمناطق مخاطر أخرى متوقعة', 'No other forecast risk areas on the route') });
      }
      const row = { id: uid('ALT'), number: num('ALT', 'alt'), vesselId: v.id, riskId: r.id, alertId: alertId || null, kind: alt ? kind : 'none', current: cur, alternative: alt, riskPoly: r.poly, avoided: { title: r.title, level: r.level, start: r.start, end: r.end },
        reason: alt ? why : tx('تعذر إيجاد بديل ضمن بيانات الاختبار والقيود الملاحية المتاحة. يلزم تقييم الضابط والتواصل مع السفينة.', 'No alternative could be found within the test data and available navigational constraints. Officer assessment and contact with the vessel are needed.'),
        checks, validation: 'unverified', validationNote: tx('صلاحية المسار غير متحققة: لا تتوفر خرائط ملاحية معتمدة أو بيانات أعماق موثوقة، والأعماق المستخدمة قيم اختبار. لا يُعد المسار آمنًا أو صالحًا للملاحة الفعلية.', 'Route validity is NOT verified: no approved nautical charts or reliable depth data are available; depths used are test values. The route is not declared safe or fit for actual navigation.'), createdAt: t, createdBy: actor.username };
      decideOptions(v, r, row, alloc || {}); row.status = 'proposed';
      if (row.needsReview) row.reason = tx('لا يوجد خيار آمن ضمن القيود؛ يُوصى بالانتظار في منطقة آمنة ويحتاج القرار مراجعة الضابط.', 'No safe option within the constraints; waiting at a safe location is recommended and the case needs officer review.');
      for (const o of S.all('alternativeRoutes').filter(x => x.vesselId === v.id && x.riskId === r.id).slice()) S.remove('alternativeRoutes', o.id);
      S.insert('alternativeRoutes', row);
      audit(actor, 'route.propose', 'alternativeRoute', row.id, tx('توصية ' + row.number + ' للسفينة ' + v.name + ': ' + row.recommended.label.ar, 'Recommendation ' + row.number + ' for ' + v.name + ': ' + row.recommended.label.en));
      return row;
    }

    // ---------------- Alerts lifecycle
    function setAlert(a, status, actor, note, patch = {}) { const cur = S.get('alerts', a.id); markTx(a.id, cur.status, status); S.update('alerts', a.id, Object.assign({ status, history: cur.history.concat([{ s: status, at: now(), by: actor.username, note: note || null }]) }, patch)); }
    function releaseHeld(vid, actor) {
      const v = vessel(vid); if (!v || !C.inSaudiTerritorialSea(v.pos)) return; const t = now();
      for (const d of S.all('deliveryRecords').filter(x => x.vesselId === vid && x.status === 'held_outside_ts')) {
        const al = S.get('alerts', d.alertId); if (!al || !['dispatched_test', 'received', 'acknowledged'].includes(al.status) || al.validTo <= t) continue;
        if (al.status !== 'dispatched_test' && d.channel === 'test_bridge_screen') setAlert(al, 'dispatched_test', SYS, 'new delivery: ' + v.name + ' entered territorial waters');
        const ok = d.channel !== 'none';
        S.update('deliveryRecords', d.id, ok ? { status: 'dispatched', dispatchedAt: t, history: d.history.concat([{ s: 'dispatched', at: t, note: 'entered territorial waters' }]) } : { status: 'failed', failReason: tx('لا توجد قناة اتصال مسجلة', 'No communication channel registered'), history: d.history.concat([{ s: 'failed', at: t }]) });
        audit(actor || SYS, 'alert.release', 'delivery', d.id, tx('دخلت ' + v.name + ' المياه الإقليمية: إرسال الإنذار ' + al.number + ' المحجوز', v.name + ' entered territorial waters: held alert ' + al.number + ' dispatched'));
      }
    }
    function aggregateAlert(id) {
      const a = S.get('alerts', id); if (!a || !['dispatched_test', 'received'].includes(a.status)) return;
      const d = S.all('deliveryRecords').filter(x => x.alertId === id && !['failed', 'held_outside_ts'].includes(x.status) && x.channel === 'test_bridge_screen');
      if (!d.length) return;
      if (d.every(x => x.ackAt)) setAlert(a, 'acknowledged', SYS, 'all targets acknowledged');
      else if (a.status === 'dispatched_test' && d.every(x => x.receivedAt)) setAlert(a, 'received', SYS, 'all targets received');
    }

    // ---------------- IMO Res. A.706(17) as amended – World-Wide Navigational Warning Service (WWNWS)
  // Four warning levels. Local warnings are disseminated by VHF/local means and are NOT broadcast on international NAVTEX (§10.2.1.3).
  const WWNWS_REF = 'IMO Res. A.706(17), as amended (WWNWS), 10.2.1.3';
  const KSA_WATERS_NM = 120; // test approximation of the Kingdom's maritime areas (distance from Saudi ports and coastal sea areas) – not an official boundary
  const WW = {
    NAVAREA: { name: tx('تحذير NAVAREA', 'NAVAREA warning'), area: tx('المناطق البحرية الدولية الواسعة', 'Wide international sea areas'), means: tx('NAVTEX / EGC (SafetyNET) حسب التغطية – عبر منسق NAVAREA IX', 'NAVTEX / EGC (SafetyNET) per coverage – via the NAVAREA IX coordinator') },
    SUBAREA: { name: tx('تحذير منطقة فرعية', 'Sub-area warning'), area: tx('المناطق البحرية الفرعية', 'Sub-areas'), means: tx('وسائل نشر MSI المعتمدة', 'Approved MSI dissemination means') },
    COASTAL: { name: tx('تحذير ساحلي', 'Coastal warning'), area: tx('المياه الساحلية والمسارات البحرية', 'Coastal waters and sea routes'), means: tx('NAVTEX / EGC حسب التغطية', 'NAVTEX / EGC per coverage') },
    LOCAL: { name: tx('تحذير محلي', 'Local warning'), area: tx('المياه المحلية ونطاق اختصاص الموانئ', 'Local waters and port jurisdiction'), means: tx('VHF والقنوات المحلية المناسبة – لا يُبث على NAVTEX الدولي', 'VHF and appropriate local channels – not broadcast on international NAVTEX') }
  };
  function warningClass(poly) {
    const cls = C.classifyWarningLevel(poly), sa = C.PORTS.filter(p => p.country === 'SA');
    const ref = sa.map(p => p.p).concat(SEA_AREAS.map(a => a.p)); // Saudi ports + Saudi coastal sea-area centres
    const inKingdom = poly.every(v => Math.min(...ref.map(q => C.gcNm(q, v))) <= KSA_WATERS_NM);
    const reachesTS = poly.some(v => C.inSaudiTerritorialSea(v)) || C.SA_COAST.some(l => l.some(q => C.pointInPoly(q, poly)));
    const level = cls.levels.includes('LOCAL') && inKingdom ? 'LOCAL' : inKingdom ? 'COASTAL' : 'NAVAREA';
    const navtex = C.STATIONS.filter(st => st.role === 'NAVTEX' && st.country === 'SA' && poly.every(v => C.gcNm(st.p, v) <= st.rangeNm)).map(st => st.id);
    const means = level === 'LOCAL' ? WW.LOCAL.means : level === 'COASTAL' ? (navtex.length ? tx('NAVTEX عبر ' + navtex.map(id => C.STATIONS.find(x => x.id === id).ar).join('، '), 'NAVTEX via ' + navtex.map(id => C.STATIONS.find(x => x.id === id).en).join(', ')) : tx('EGC (SafetyNET) – المنطقة خارج تغطية NAVTEX السعودية في بيانات الاختبار', 'EGC (SafetyNET) – area outside Saudi NAVTEX coverage in the test data')) : WW.NAVAREA.means;
    const direct = !reachesTS && inKingdom ? tx('المنطقة لا تصل إلى المياه الإقليمية السعودية (١٢ ميلًا بحريًا): لا يُرسل الإنذار مباشرة؛ يُنشر تحذيرًا ساحليًا عبر NAVTEX/EGC من الجهة المختصة.', 'The area does not reach Saudi territorial waters (12 nm): no direct alert; promulgate as a coastal warning via NAVTEX/EGC by the competent authority.') : inKingdom
      ? (level === 'LOCAL' ? tx('ضمن المياه المحلية للمملكة: يُرسل الإنذار مباشرة بوسائل محلية دون NAVTEX (' + WWNWS_REF + ') للسفن الموجودة داخل المياه الإقليمية فقط.', 'Within the Kingdom\'s local waters: the alert is sent directly by local means without NAVTEX (' + WWNWS_REF + ') to vessels inside territorial waters only.')
        : tx('ضمن المناطق البحرية للمملكة: يُرسل الإنذار مباشرة دون NAVTEX للسفن المستهدفة الموجودة داخل المياه الإقليمية فقط، وتُحجز البقية حتى دخولها؛ ويبقى التحذير الساحلي عبر NAVTEX/EGC من اختصاص الجهة المختصة.', 'Within the Kingdom\'s maritime areas: the alert goes directly, without NAVTEX, only to targeted vessels inside territorial waters; others are held until they enter; the coastal warning via NAVTEX/EGC remains with the competent authority.'))
      : tx('المنطقة خارج المناطق البحرية للمملكة (حسب التقريب التجريبي): لا يُرسل الإنذار مباشرة؛ يلزم تحذير NAVAREA عبر منسق المنطقة التاسعة.', 'Area is outside the Kingdom\'s maritime areas (test approximation): no direct alert; a NAVAREA warning via the NAVAREA IX coordinator is required.');
    return { level, name: WW[level].name, means, inKingdom, reachesTerritorialSea: reachesTS, directAlertAllowed: inKingdom && reachesTS, navtexStations: navtex, ports: cls.ports, extentNm: cls.extentNm, ref: WWNWS_REF, note: direct };
  }
  const normScope = sc => sc === 'INTERNATIONAL' ? 'NAVAREA' : ['LOCAL', 'COASTAL', 'SUBAREA', 'NAVAREA'].includes(sc) ? sc : null;

  // ---------------- NAVTEX-format message preparation (test only)
    const SUBJECT = { A: tx('تحذير ملاحي', 'Navigational warning'), B: tx('تحذير أرصاد', 'Meteorological warning'), E: tx('توقعات أرصاد', 'Meteorological forecast'), L: tx('تحذير ملاحي إضافي', 'Additional navigational warning') };
    const pad = (n, k) => String(n).padStart(k, '0');
    const dtg = ts => { const d = new Date(ts); return pad(d.getUTCDate(), 2) + pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + ' UTC ' + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); };
    const dm = (v, pos, neg, w) => { const a = Math.abs(v), d = Math.floor(a), m = Math.round((a - d) * 60); return pad(d, w) + '-' + pad(m === 60 ? 0 : m, 2) + (v >= 0 ? pos : neg); };
    function formatNavtex(m) {
      const errors = [];
      for (const [k, lbl] of [['subject', 'subject indicator'], ['scope', 'scope'], ['targetId', 'addressee'], ['areaText', 'area'], ['textEn', 'message text'], ['validFrom', 'start time'], ['validTo', 'end time']]) if (!m[k]) errors.push(lbl + ' is required');
      if (m.validTo && m.validFrom && m.validTo <= m.validFrom) errors.push('end time must be after start time');
      if (m.textEn && /[^\x20-\x7E\n]/.test(m.textEn)) errors.push('NAVTEX text must use plain English characters');
      if (m.textEn && m.textEn.length > 1500) errors.push('message text too long (max 1500 characters)');
      const st = C.STATIONS.find(s => s.id === m.targetId);
      if (m.scope === 'LOCAL') errors.push('Local warnings should not be broadcast on international NAVTEX (' + WWNWS_REF + '); disseminate by VHF and appropriate local channels');
      if (m.scope === 'SUBAREA') errors.push('no Sub-area coordinator is defined in the test data (to be verified officially); use approved MSI means');
      if (m.scope === 'NAVAREA' && st && st.role !== 'COORDINATOR') errors.push('NAVAREA scope is addressed to the NAVAREA IX coordinator, not a NAVTEX station');
      if (m.scope === 'COASTAL' && st && st.role === 'COORDINATOR') errors.push('coastal scope is addressed to a NAVTEX transmitting station, not the NAVAREA IX coordinator');
      const b1 = st && st.b1 ? st.b1 : 'X', serial = pad(m.serial || 1, 2);
      const yy = String(new Date(m.validFrom || now()).getUTCFullYear()).slice(2);
      const header = m.scope === 'NAVAREA' ? 'NAVAREA IX TEST ' + pad(m.serial || 1, 3) + '/' + yy : (st ? st.en.toUpperCase() : 'COASTAL') + ' TEST ' + pad(m.serial || 1, 3) + '/' + yy;
      const pos = m.position ? dm(m.position[1], 'N', 'S', 2) + ' ' + dm(m.position[0], 'E', 'W', 3) : null;
      const text = ['ZCZC ' + b1 + (m.subject || '?') + serial, dtg(m.preparedAt || now()), header, String(m.areaText || '').toUpperCase(), pos ? 'IN POSITION ' + pos : null,
        String(m.textEn || '').toUpperCase().trim(), 'VALID ' + (m.validFrom ? dtg(m.validFrom) : '?') + ' TO ' + (m.validTo ? dtg(m.validTo) : '?') + '.', 'TEST MESSAGE - NOT FOR TRANSMISSION', 'NNNN'].filter(Boolean).join('\n');
      return { errors, text };
    }

    // ---------------- Integration: weather data validation (Proposed Integration – NCM)
    const FIELD_RANGE = { windKn: [0, 120], windDir: [0, 360], gustKn: [0, 160], waveM: [0, 20], waveDir: [0, 360], currentKn: [0, 10], currentDir: [0, 360], visNm: [0, 50], tempC: [-10, 55] };
    const CRITICAL = ['windKn', 'waveM'];
    function validateWeather(payload) {
      const t = now(), accepted = [], rejected = [], warnings = [];
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.records)) return { ok: false, accepted, rejected: [{ index: -1, errors: ['payload must be an object with a "records" array'] }], warnings };
      payload.records.forEach((rec, i) => {
        const errs = [], warn = [];
        const a = rec && area(rec.areaId);
        if (!a) errs.push('unknown areaId "' + (rec && rec.areaId) + '"');
        const ts = Date.parse(rec && rec.recordedAt);
        if (!rec || !rec.recordedAt || isNaN(ts)) errs.push('recordedAt must be an ISO date-time');
        else if (ts > t + 10 * MIN) errs.push('recordedAt is in the future');
        else if (t - ts > 6 * H) warn.push('data is older than 6 h (stale)');
        const obs = rec && rec.observation || {};
        for (const k of Object.keys(FIELD_RANGE)) { const v = obs[k]; if (v == null || v === '') { if (CRITICAL.includes(k)) errs.push('missing critical field ' + k); else warn.push('missing ' + k + ' (previous value kept)'); continue; } if (typeof v !== 'number' || isNaN(v) || v < FIELD_RANGE[k][0] || v > FIELD_RANGE[k][1]) errs.push(k + ' out of range ' + FIELD_RANGE[k].join('–')); }
        const fc = Array.isArray(rec && rec.forecast) ? rec.forecast : [];
        fc.forEach((x, j) => { if (!(x && Number.isInteger(x.h) && x.h >= 0 && x.h <= 48)) errs.push('forecast[' + j + '].h must be 0–48'); for (const k of Object.keys(FIELD_RANGE)) if (x && x[k] != null && (typeof x[k] !== 'number' || x[k] < FIELD_RANGE[k][0] || x[k] > FIELD_RANGE[k][1])) errs.push('forecast[' + j + '].' + k + ' out of range'); });
        if (errs.length) rejected.push({ index: i, areaId: rec && rec.areaId, errors: errs }); else { accepted.push({ index: i, rec, ts, warnings: warn }); if (warn.length) warnings.push({ index: i, areaId: rec.areaId, warnings: warn }); }
      });
      return { ok: rejected.length === 0, accepted, rejected, warnings };
    }
    function applyWeather(actor, res, source) {
      const t = now();
      for (const { rec, ts } of res.accepted) {
        const o = S.get('weatherObservations', 'O:' + rec.areaId), patch = { recordedAt: ts, source, label: 'Test API Data', reliability: rec.reliability != null ? clamp(+rec.reliability, 0, 1) : o.reliability };
        for (const k of Object.keys(FIELD_RANGE)) if (rec.observation[k] != null && rec.observation[k] !== '') patch[k] = rec.observation[k];
        S.update('weatherObservations', o.id, patch);
        const f = S.get('weatherForecasts', 'F:' + rec.areaId), series = f.series.map(s => Object.assign({}, s));
        Object.assign(series[0], Object.fromEntries(Object.keys(FIELD_RANGE).filter(k => rec.observation[k] != null && rec.observation[k] !== '').map(k => [k, rec.observation[k]])));
        for (const x of rec.forecast || []) { const s = series[x.h]; for (const k of Object.keys(FIELD_RANGE)) if (x[k] != null) s[k] = x[k]; }
        S.update('weatherForecasts', f.id, { series, issuedAt: ts, source, label: 'Test API Data' });
      }
      const ds = S.get('dataSources', 'ncm');
      S.update('dataSources', 'ncm', { lastReceivedAt: t, accepted: ds.accepted + res.accepted.length, rejected: ds.rejected + res.rejected.length, lastErrors: res.rejected.slice(0, 10), lastWarnings: res.warnings.slice(0, 10) });
      S.insert('integrationEvents', { id: uid('IE'), at: t, integration: 'ncm', direction: 'in', status: res.rejected.length ? (res.accepted.length ? 'partial' : 'rejected') : 'accepted', accepted: res.accepted.length, rejected: res.rejected.length, errors: res.rejected.slice(0, 10), warnings: res.warnings.slice(0, 10), by: actor.username });
      audit(actor, 'weather.receive', 'weather', null, tx('استقبال بيانات أرصاد اختبار عبر واجهة التكامل: قُبل ' + res.accepted.length + ' ورُفض ' + res.rejected.length, 'Test weather data received via the integration interface: ' + res.accepted.length + ' accepted, ' + res.rejected.length + ' rejected'), res.rejected.length ? JSON.stringify(res.rejected.slice(0, 5)) : null);
      if (res.accepted.length) analyse('weather update');
    }

    // ---------------- Bulletins & navigational notices: routed by WWNWS level to the competent parties (test environment)
  // ---------------- Structured English navigational-warning draft (prepared by MARSA; issuance remains with the authorized entity)
  function warningDraft(b) {
    const w = b.warning || {}, c = b.poly.reduce((a, q) => [a[0] + q[0] / b.poly.length, a[1] + q[1] / b.poly.length], [0, 0]);
    const rad = Math.round(Math.max(...b.poly.map(q => C.gcNm(c, q))));
    const cls = { LOCAL: 'LOCAL WARNING', COASTAL: 'COASTAL WARNING', NAVAREA: 'NAVAREA IX WARNING' }[b.scope] || b.scope;
    return ['MARSA DRAFT - FOR REVIEW BY THE AUTHORIZED ENTITY - NOT AN OFFICIAL WARNING', 'WARNING ID: ' + b.number, 'CLASSIFICATION: ' + cls, 'AREA: ' + String(b.areaName.en || '').toUpperCase(),
      'POSITION: ' + dm(c[1], 'N', 'S', 2) + ' ' + dm(c[0], 'E', 'W', 3) + ' RADIUS ' + rad + ' NM', 'VALID: ' + dtg(b.validFrom) + ' TO ' + dtg(b.validTo),
      'HAZARD: ' + String(w.hazard || '').toUpperCase(), 'NAVIGATIONAL IMPACT: ' + String(w.impact || '').toUpperCase(), 'PRECAUTIONS: ' + String(w.precautions || '').toUpperCase(),
      'SOURCE: ' + String(w.source || '').toUpperCase(), 'RESPONSIBLE AUTHORITY: ' + String(w.authority || '').toUpperCase()].join('\n');
  }
  function warningDefaults(r, scope, b) {
    const auth = { LOCAL: 'Port authority (harbour master)', COASTAL: 'Saudi NAVTEX station (authorized)', NAVAREA: 'NAVAREA IX coordinator (Karachi)' }[scope] || 'Port authority';
    if (!r) return { hazard: b.title.en, impact: 'Vessels in the area may be affected', precautions: 'Navigate with caution and follow port instructions', source: 'MARSA test data (simulated)', authority: auth };
    const pk = r.peak || {}, vals = [pk.windKn ? 'winds up to ' + Math.round(pk.windKn) + ' kt' : '', pk.waveM ? 'waves up to ' + pk.waveM + ' m' : '', pk.visNm && pk.visNm < 6 ? 'visibility down to ' + pk.visNm + ' nm' : ''].filter(Boolean).join(', ');
    return { hazard: RTYPE[r.type].en + (vals ? ': ' + vals : ''), impact: r.type.startsWith('port') ? 'Port entry and berthing affected' : 'Hazardous conditions for navigation in the area', precautions: (r.actions || ACTIONS.other).en, source: r.source === 'rules' ? 'National Center for Meteorology forecast (simulated test data)' : 'MARSA test data (simulated)', authority: auth };
  }
  // ---------------- Alternative port allocation for closed or congested ports (88% ceiling)
  const MAX_ALLOC_OCC = 88;
  function runAllocationFor(u, portId) {
    const from = port(portId); if (!from) throw new ValidationError('port');
    const t = now(), R = rules(), high = S.all('maritimeRisks').filter(x => rank(x.level) >= 3 && x.end > t && x.source !== 'port'), region = (C.PORTS.find(x => x.id === portId) || {}).region;
    for (const a of S.all('allocations').filter(a => a.fromPort === portId && a.status === 'proposed').slice()) S.remove('allocations', a.id);
    const incoming = S.all('vessels').filter(v => v.destId === portId && v.status !== 'moored').sort((a, b) => (a.etaAt || 0) - (b.etaAt || 0));
    const extra = {}, out = [];
    for (const v of incoming) {
      const calc = [];
      for (const p of S.all('ports')) {
        if (p.id === portId) continue; const cp = C.PORTS.find(x => x.id === p.id), before = portOcc(p) + Math.round((extra[p.id] || 0) * 100 / p.capacityBerths), after = Math.round(before + 100 / p.capacityBerths);
        let reason = null; if (!cp || cp.region !== region) reason = tx('بحر مختلف', 'Different sea'); else if (p.status !== 'open') reason = tx('الميناء غير متاح', 'Port not open'); else if (p.maxDraftM < v.draft + R.ukcM) reason = tx('الغاطس يتجاوز حد الميناء', 'Draft exceeds port limit'); else if (after > MAX_ALLOC_OCC) reason = tx('الإشغال بعد التحويل ' + after + '٪ > ٨٨٪', 'Occupancy after ' + after + '% > 88%');
        if (cp && cp.region !== region) continue;
        const rt = reason ? null : route(v.pos, nearestNodes(v.pos, 4), p.node, { constraints: S.all('constraints'), avoid: high.filter(x => !C.pointInPoly(v.pos, x.poly) && x.start <= t + 6 * H).map(x => ({ poly: x.poly })), rough: [], draft: v.draft, ukc: R.ukcM });
        if (!reason && !rt) reason = tx('لا يوجد مسار آمن', 'No safe route');
        if (!reason && rt) { const arr = t + rt.nm / Math.max(1, v.sog || 12) * H, hz = high.find(x => C.pointInPoly(p.p, x.poly) && x.start <= arr && x.end > arr); if (hz) reason = tx('الميناء داخل منطقة خطر عند وصول السفينة', 'Port inside a risk area when the vessel arrives'); }
        calc.push({ portId: p.id, occBefore: before, occAfter: after, availableBerths: p.availableBerths, nm: rt ? Math.round(rt.nm) : null, eligible: !reason, reason });
      }
      const best = calc.filter(c => c.eligible).sort((a, b) => a.nm - b.nm || a.occAfter - b.occAfter)[0];
      if (best) extra[best.portId] = (extra[best.portId] || 0) + 1;
      const row = { id: uid('PA'), number: num('PA', 'pa'), vesselId: v.id, fromPort: portId, toPort: best ? best.portId : null, status: best ? 'proposed' : 'no_capacity', calc, createdAt: t, createdBy: u.username, history: [{ s: best ? 'proposed' : 'no_capacity', at: t, by: u.username }],
        explanation: best ? tx('اختير ' + port(best.portId).name.ar + ': أقرب ميناء آمن (' + best.nm + ' ميل) بإشغال بعد التحويل ' + best.occAfter + '٪ ضمن حد ٨٨٪.', port(best.portId).name.en + ' selected: nearest safe port (' + best.nm + ' nm), occupancy after diversion ' + best.occAfter + '% within the 88% ceiling.') : tx('لا يوجد ميناء بديل آمن ضمن حد ٨٨٪؛ يُوصى بالانتظار في منطقة آمنة ومراجعة الضابط.', 'No safe alternative port within the 88% ceiling; waiting at a safe location and officer review are recommended.') };
      S.insert('allocations', row); out.push(row);
    }
    audit(u, 'allocation.run', 'port', portId, tx('توزيع السفن القادمة إلى ' + from.name.ar + ': ' + out.length + ' سفن، ' + out.filter(a => a.toPort).length + ' لها ميناء بديل', 'Allocation for vessels bound to ' + from.name.en + ': ' + out.length + ' vessels, ' + out.filter(a => a.toPort).length + ' with an alternative port'));
    return out;
  }
  function setAllocation(a, status, actor, note, patch) { markTx(a.id, a.status, status); S.update('allocations', a.id, Object.assign({ status, history: a.history.concat([{ s: status, at: now(), by: actor.username, note: note || null }]) }, patch || {})); }
  function bulletinRecipients(b) {
    const out = [], ports = S.all('ports').filter(p => C.pointInPoly(p.p, b.poly) || (b.portId === p.id)).slice(0, 4);
    if (!ports.length) { const c = b.poly.reduce((a, q) => [a[0] + q[0] / b.poly.length, a[1] + q[1] / b.poly.length], [0, 0]); const n = S.all('ports').slice().sort((x, y) => C.gcNm(x.p, c) - C.gcNm(y.p, c))[0]; if (n) ports.push(n); }
    if (b.scope === 'LOCAL') for (const p of ports) out.push({ id: 'V:' + p.id, kind: 'vhf', targetId: p.id, name: tx('قناة VHF المحلية – ضابط ' + p.name.ar, 'Local VHF channel – ' + p.name.en + ' officer'), means: tx('بث VHF', 'VHF broadcast'), status: 'pending' });
    for (const p of ports) out.push({ id: 'P:' + p.id, kind: 'port', targetId: p.id, name: tx('إدارة ' + p.name.ar + ' (مأمور الميناء)', p.name.en + ' (harbour master)'), means: tx('VHF والقنوات المحلية', 'VHF and local channels'), status: 'pending' });
    if (b.scope === 'COASTAL' || b.scope === 'NAVAREA') {
      const st = (b.wwnws && b.wwnws.navtexStations || []).map(id => C.STATIONS.find(x => x.id === id)).filter(Boolean);
      const c = b.poly[0], near = st.length ? st : C.STATIONS.filter(x => x.role === 'NAVTEX' && x.country === 'SA').sort((x, y) => C.gcNm(x.p, c) - C.gcNm(y.p, c)).slice(0, 1);
      for (const x of near) out.push({ id: 'N:' + x.id, kind: 'navtex', targetId: x.id, name: tx(x.ar, x.en), means: tx('بث NAVTEX (' + x.b1 + ')', 'NAVTEX broadcast (' + x.b1 + ')'), status: 'pending' });
    }
    if (b.scope === 'NAVAREA') { const k = C.STATIONS.find(x => x.id === 'KHI_NAV'); out.push({ id: 'C:KHI_NAV', kind: 'coordinator', targetId: k.id, name: tx(k.ar, k.en), means: tx('تحذير NAVAREA عبر NAVTEX/EGC', 'NAVAREA warning via NAVTEX/EGC'), status: 'pending' }); }
    return out;
  }
  function setBulletin(b, status, actor, note, patch) { const cur = S.get('bulletins', b.id); markTx(b.id, cur.status, status); S.update('bulletins', b.id, Object.assign({ status, history: cur.history.concat([{ s: status, at: now(), by: actor.username, note: note || null }]) }, patch || {})); }

  // ---------------- Marine forecast text in the WWMIWS structure (Part I warnings, Part II synopsis, Part III forecast)
  function marineForecast(areaId, hours) {
    const a = area(areaId), f = S.get('weatherForecasts', 'F:' + areaId); if (!a || !f) throw new ValidationError('area');
    const H0 = 0, lag = Math.ceil(Math.max(0, now() - meta().datasetAt) / H), H1 = clamp((+hours || 24) + lag, 24, 48); // valid at least 24 h from now // valid period at least 24 h (MSC.470(101) 4.2.2.2)
    const ser = f.series.filter(x => x.h >= H0 && x.h <= H1), mx = k => Math.max(...ser.map(x => x[k])), mn = k => Math.min(...ser.map(x => x[k]));
    const peak = ser.reduce((m, x) => x.windKn > m.windKn ? x : m, ser[0]), cat = windWarning(peak.windKn);
    const card = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8], cardAr = d => ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية', 'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
    const systems = SAMPLE_SYSTEMS.filter(x => x.areas[areaId] && x.start <= H1);
    const vis = mn('visNm'), from = ser[0].validAt, to = ser[ser.length - 1].validAt;
    const en = ['MARINE FORECAST - TEST DATA - NOT FOR TRANSMISSION', 'ISSUED ' + dtg(now()) + '. VALID ' + dtg(from) + ' TO ' + dtg(to) + '.', 'AREA: ' + a.name.en.toUpperCase() + '.',
      'PART I - WARNINGS: ' + (cat ? WWARN[cat].en.toUpperCase().replace(' – ', ' ') + ' IN FORCE. MAX WIND ' + Math.round(peak.windKn) + ' KT (BEAUFORT ' + beaufort(peak.windKn) + ') AT ' + dtg(peak.validAt) + '.' : 'NO WIND WARNINGS IN FORCE.'),
      'PART II - SYNOPSIS: ' + (systems.length ? systems.map(x => x.en.toUpperCase()).join('. ') + '.' : 'NO SIGNIFICANT SYSTEMS AFFECTING THE AREA.'),
      'PART III - FORECAST: WIND ' + card(ser[0].windDir) + ' ' + Math.round(mn('windKn')) + '-' + Math.round(mx('windKn')) + ' KT. SEA STATE ' + r1(mn('waveM')) + '-' + r1(mx('waveM')) + ' M.' + (vis < 6 ? ' VISIBILITY ' + r1(vis) + ' NM AT TIMES.' : '')].join('\n');
    const ar = ['توقعات بحرية – بيانات اختبار', 'صدرت ' + dtg(now()) + '، صالحة من ' + dtg(from) + ' إلى ' + dtg(to) + '.', 'المنطقة: ' + a.name.ar + '.',
      'الجزء الأول – التحذيرات: ' + (cat ? WWARN[cat].ar + ' ساري. أقصى رياح ' + Math.round(peak.windKn) + ' عقدة (بوفورت ' + beaufort(peak.windKn) + ').' : 'لا توجد تحذيرات رياح سارية.'),
      'الجزء الثاني – الحالة العامة: ' + (systems.length ? systems.map(x => x.ar).join('؛ ') + '.' : 'لا توجد أنظمة مؤثرة.'),
      'الجزء الثالث – التوقعات: رياح ' + cardAr(ser[0].windDir) + ' ' + Math.round(mn('windKn')) + '–' + Math.round(mx('windKn')) + ' عقدة، ارتفاع الموج ' + r1(mn('waveM')) + '–' + r1(mx('waveM')) + ' م' + (vis < 6 ? '، الرؤية تنخفض إلى ' + r1(vis) + ' ميل بحري أحيانًا' : '') + '.'].join('\n');
    return { areaId, validFrom: from, validTo: to, hours: H1, warning: cat, text: tx(ar, en), ref: WWMIWS_REF };
  }

  // ---------------- Snapshot
    function snapshot(user) {
      const m = meta(), t = now();
      if (user.role === 'bridge') {
        const v = vessel(user.vesselId);
        const dl = S.all('deliveryRecords').filter(d => d.vesselId === user.vesselId && !['queued'].includes(d.status));
        const aIds = new Set(dl.map(d => d.alertId));
        const bd = S.all('bulletinDeliveries').filter(d => d.vesselId === user.vesselId), bIds = new Set(bd.map(d => d.bulletinId));
        return { now: t, me: user, version: m.version, datasetAt: m.datasetAt, disclaimer: DISCLAIMER, vessels: v ? [v] : [], bulletinDeliveries: bd, bulletins: S.all('bulletins').filter(b => bIds.has(b.id)).map(b => ({ id: b.id, number: b.number, type: b.type, title: b.title, body: b.body, areaName: b.areaName, validFrom: b.validFrom, validTo: b.validTo, status: b.status })), ports: S.all('ports'), alerts: S.all('alerts').filter(a => aIds.has(a.id)), deliveryRecords: dl,
          alternativeRoutes: S.all('alternativeRoutes').filter(r => r.vesselId === user.vesselId && r.alertId && aIds.has(r.alertId) && ['approved', 'modified'].includes(r.status)), constraints: S.all('constraints'), dataSources: S.all('dataSources').filter(x => x.id === 'ais') };
      }
      return { now: t, me: user, version: m.version, datasetAt: m.datasetAt, disclaimer: DISCLAIMER, rules: rules(), seaAreas: S.all('seaAreas'), ports: S.all('ports'), vessels: S.all('vessels'), constraints: S.all('constraints'),
        weatherObservations: S.all('weatherObservations'), weatherForecasts: S.all('weatherForecasts'), maritimeRisks: S.all('maritimeRisks'), affectedVessels: S.all('affectedVessels'), alerts: S.all('alerts'), deliveryRecords: S.all('deliveryRecords'),
        alternativeRoutes: S.all('alternativeRoutes'), allocations: S.all('allocations'), portOccupancy: Object.fromEntries(S.all('ports').map(p => [p.id, portOcc(p)])), bulletins: S.all('bulletins'), bulletinDeliveries: S.all('bulletinDeliveries'), navtexMessages: S.all('navtexMessages'), integrationEvents: S.all('integrationEvents').slice(-60), dataSources: S.all('dataSources'), auditLogs: S.all('auditLogs').slice(-500),
        stations: C.STATIONS.filter(s => s.navarea === 'IX').map(s => ({ id: s.id, role: s.role, name: tx(s.ar, s.en), country: s.country, b1: s.b1 })), sampleSystems: SAMPLE_SYSTEMS.map(s => ({ id: s.id, name: tx(s.ar, s.en) })), wwnws: { ref: WWNWS_REF, levels: WW, kingdomWatersNm: KSA_WATERS_NM }, wwmiwsRef: WWMIWS_REF };
    }

    const touch = () => { bump(); };
    // ---------------- Public API
    const api = {
      snapshot: u => snapshot(u),
      verifyAudit: u => { needOfficer(u); return verifyAudit(); },
      recordLogin(u) { audit(u, 'session.open', 'user', u.id, tx('فتح واجهة ' + (u.role === 'officer' ? 'ضابط الميناء' : 'جسر السفينة'), 'Opened ' + (u.role === 'officer' ? 'Port Officer' : 'Ship Bridge') + ' interface')); return { ok: true }; },
      resetTestData(u) { needOfficer(u); seed(); audit(u, 'data.reset', 'dataset', null, tx('إعادة تهيئة بيانات الاختبار', 'Test data reset')); touch(); return { ok: true }; },
      updateRules(u, a) {
        needOfficer(u); const patch = {};
        for (const k of ['windKn', 'waveM', 'visNm', 'currentKn']) if (a[k]) { const v = a[k].map(Number); if (v.length !== 4 || v.some(x => !(x >= 0))) throw new ValidationError('rules ' + k); const asc = k !== 'visNm'; for (let i = 1; i < 4; i++) if (asc ? v[i] <= v[i - 1] : v[i] >= v[i - 1]) throw new ValidationError('rules order ' + k); patch[k] = v; }
        if (a.minLevel) { if (!['low', 'medium', 'high'].includes(a.minLevel)) throw new ValidationError('minLevel'); patch.minLevel = a.minLevel; }
        if (a.seaPenaltyPct != null && a.seaPenaltyPct !== '') patch.seaPenaltyPct = clamp(+a.seaPenaltyPct, 0, 200);
        if (a.ukcM != null && a.ukcM !== '') patch.ukcM = clamp(+a.ukcM, 0, 5);
        S.update('settings', 'rules', patch); audit(u, 'rules.update', 'settings', 'rules', tx('تعديل قواعد تحليل المخاطر', 'Risk analysis rules updated'), JSON.stringify(patch));
        analyse('rules change'); touch(); return rules();
      },
      upsertVessel(u, a) {
        needOfficer(u); if (!a.name || str(a.name, 60).length < 2) throw new ValidationError('name');
        const lon = +a.lon, lat = +a.lat; if (!(lon >= 32 && lon <= 60 && lat >= 12 && lat <= 31)) throw new ValidationError('position');
        const sog = +a.sog, draft = +a.draft, cog = +a.cog || 0; if (!(sog >= 0 && sog <= 30)) throw new ValidationError('sog'); if (!(draft > 1 && draft < 25)) throw new ValidationError('draft'); if (!(cog >= 0 && cog <= 360)) throw new ValidationError('cog');
        if (!C.PORTS.some(p => p.id === a.destId)) throw new ValidationError('destination');
        const ex = a.id && vessel(a.id), t = now();
        const v = Object.assign(ex ? Object.assign({}, ex) : { id: uid('V'), imo: 'TEST-' + (9200000 + (seq * 7919) % 90000), mmsi: '999' + String((seq * 104729) % 1e6).padStart(6, '0'), flag: 'SA', source: 'test', lengthM: 150 }, {
          name: str(a.name, 60), type: ['container', 'tanker', 'bulk', 'general', 'roro', 'lng'].includes(a.type) ? a.type : 'general', pos: [lon, lat], sog, cog, draft, originId: a.originId || (ex && ex.originId) || null, destId: a.destId,
          status: ['underway', 'anchored', 'moored'].includes(a.status) ? a.status : 'underway', channel: ['bridge', 'vhf', 'ais', 'none'].includes(a.channel) ? a.channel : (ex ? ex.channel : 'bridge'), recordedAt: t });
        if (v.status !== 'underway') { v.sog = 0; v.routeNodes = []; v.routeNm = 0; v.etaAt = null; } else { Object.assign(v, planVesselRoute(v)); v.etaAt = v.sog > 0 && !C.VIRTUAL[destNodeOf(v.destId)] ? t + v.routeNm / v.sog * H : null; }
        geo(v);
        if (ex) S.update('vessels', v.id, v); else { S.insert('vessels', v); S.insert('users', { id: 'B-' + v.id, username: 'bridge.' + v.mmsi, role: 'bridge', vesselId: v.id, name: tx('جسر ' + v.name, v.name + ' bridge') }); }
        const ds = S.get('dataSources', 'ais'); S.update('dataSources', 'ais', { lastReceivedAt: t, accepted: ds.accepted + 1 });
        audit(u, ex ? 'vessel.update' : 'vessel.create', 'vessel', v.id, tx((ex ? 'تعديل' : 'إضافة') + ' سجل السفينة ' + v.name, 'Vessel record ' + (ex ? 'updated' : 'added') + ': ' + v.name));
        releaseHeld(v.id, u); computeAffected(); touch(); return vessel(v.id);
      },
      deleteVessel(u, { id }) { needOfficer(u); const v = vessel(id); if (!v) throw new ValidationError('id'); S.remove('vessels', id); S.remove('users', 'B-' + id); audit(u, 'vessel.delete', 'vessel', id, tx('حذف سجل السفينة ' + v.name, 'Vessel record deleted: ' + v.name)); computeAffected(); touch(); return { ok: true }; },
      updatePort(u, a) {
        needOfficer(u); const p = port(a.id); if (!p) throw new ValidationError('port');
        const patch = { updatedAt: now(), updatedBy: u.username };
        if (a.status) { if (!['open', 'restricted', 'closed'].includes(a.status)) throw new ValidationError('status'); patch.status = a.status; }
        if (a.congestionPct != null && a.congestionPct !== '') { const c = +a.congestionPct; if (!(c >= 0 && c <= 100)) throw new ValidationError('congestion'); patch.congestionPct = c; }
        if (a.availableBerths != null && a.availableBerths !== '') { const b = +a.availableBerths; if (!(b >= 0 && b <= p.capacityBerths)) throw new ValidationError('berths'); patch.availableBerths = b; }
        if (a.conditions) patch.conditions = bil(a.conditions, 300); if (a.restrictions) patch.restrictions = bil(a.restrictions, 300);
        if (a.untilH != null && a.untilH !== '') patch.statusUntil = now() + clamp(+a.untilH, 1, 240) * H; else if (a.status === 'open') patch.statusUntil = null;
        S.update('ports', p.id, patch); audit(u, 'port.update', 'port', p.id, tx('تحديث حالة ' + p.name.ar + ': ' + ({ open: 'يعمل', restricted: 'مقيّد', closed: 'مغلق' })[patch.status || p.status], p.name.en + ' updated: ' + (patch.status || p.status)), JSON.stringify(patch));
        analyse('port update'); touch(); return port(p.id);
      },
      editWeather(u, a) {
        needOfficer(u); const f = S.get('weatherForecasts', 'F:' + a.areaId); if (!f) throw new ValidationError('area');
        const from = clamp(+a.fromH || 0, 0, 48), to = clamp(a.toH === '' || a.toH == null ? from : +a.toH, from, 48);
        const vals = {}; for (const k of Object.keys(FIELD_RANGE)) if (a.values && a.values[k] !== '' && a.values[k] != null) { const v = +a.values[k]; if (isNaN(v) || v < FIELD_RANGE[k][0] || v > FIELD_RANGE[k][1]) throw new ValidationError(k + ' out of range'); vals[k] = v; }
        if (!Object.keys(vals).length) throw new ValidationError('values');
        const series = f.series.map(s => s.h >= from && s.h <= to ? Object.assign({}, s, vals) : s);
        S.update('weatherForecasts', f.id, { series, source: 'edited', label: 'Sample Weather Data (edited)' });
        if (from === 0) { const o = S.get('weatherObservations', 'O:' + a.areaId); S.update('weatherObservations', o.id, Object.assign({}, vals, { recordedAt: now(), source: 'edited' })); }
        audit(u, 'weather.edit', 'weather', a.areaId, tx('تحديث مؤشرات الأرصاد لـ' + area(a.areaId).name.ar + ' (الساعات ' + from + '–' + to + ')', 'Weather indicators updated for ' + area(a.areaId).name.en + ' (hours ' + from + '–' + to + ')'), JSON.stringify(vals));
        analyse('weather edit'); touch(); return { ok: true };
      },
      importWeather(u, payload) { needOfficer(u); const res = validateWeather(payload); applyWeather(u, res, 'test_api'); touch(); return { accepted: res.accepted.length, rejected: res.rejected, warnings: res.warnings }; },
      addRisk(u, a) {
        needOfficer(u); if (!RTYPE[a.type]) throw new ValidationError('type'); if (!['low', 'medium', 'high', 'critical'].includes(a.level)) throw new ValidationError('level');
        const lon = +a.lon, lat = +a.lat, rad = clamp(+a.radiusNm || 10, 1, 150); if (!(lon >= 32 && lon <= 60 && lat >= 12 && lat <= 31)) throw new ValidationError('position');
        const t = now(), start = t + clamp(+a.startH || 0, -24, 48) * H, end = start + clamp(+a.durationH || 12, 1, 240) * H;
        const title = bil(a.title, 160); if (!title.ar || !title.en) throw new ValidationError('title');
        const r = { id: 'R:M:' + uid('M'), key: 'M', source: 'manual', type: a.type, level: a.level, title, areaName: title, center: [lon, lat], radiusNm: rad, poly: C.circlePoly([lon, lat], rad, 20), start, end, durationH: Math.round((end - start) / H),
          indicators: [{ name: 'manual', text: bil(a.indicators && (a.indicators.ar || a.indicators.en) ? a.indicators : tx('مُدخل يدويًا', 'Entered manually'), 300), level: a.level }], explanation: tx('خطر مُدخل من ضابط الميناء في بيئة الاختبار.', 'Risk entered by the port officer in the test environment.'), actions: ACTIONS[a.type] || ACTIONS.other, confidence: confidenceOf(.8, 'manual'), createdAt: t, createdBy: u.username };
        S.insert('maritimeRisks', r); audit(u, 'risk.create', 'risk', r.id, tx('إضافة خطر: ' + title.ar, 'Risk added: ' + title.en)); computeAffected();
        audit(SYS, 'risk.affected', 'risk', r.id, tx('تحديد السفن المتأثرة بالخطر الجديد: ' + (S.get('maritimeRisks', r.id).affectedCount || 0), 'Vessels affected by the new risk: ' + (S.get('maritimeRisks', r.id).affectedCount || 0)));
        touch(); return S.get('maritimeRisks', r.id);
      },
      deleteRisk(u, { id }) { needOfficer(u); const r = S.get('maritimeRisks', id); if (!r || r.source === 'rules' || r.source === 'port') throw new ValidationError('only manual or record risks can be deleted'); S.remove('maritimeRisks', id); audit(u, 'risk.delete', 'risk', id, tx('حذف الخطر: ' + r.title.ar, 'Risk deleted: ' + r.title.en)); computeAffected(); touch(); return { ok: true }; },
      createAlert(u, a) {
        needOfficer(u); const r = a.riskId ? S.get('maritimeRisks', a.riskId) : null; if (a.riskId && !r) throw new ValidationError('risk');
        const title = bil(a.title, 200), body = bil(a.body), instr = bil(a.instructions); if (!title.ar || !title.en) throw new ValidationError('title'); if (!body.ar || !body.en) throw new ValidationError('body');
        let poly, areaName; if (r && !a.customArea) { poly = r.poly; areaName = r.areaName; } else { const lon = +a.lon, lat = +a.lat, rad = clamp(+a.radiusNm || 20, 1, 150); if (!(lon >= 32 && lon <= 60 && lat >= 12 && lat <= 31)) throw new ValidationError('area'); poly = C.circlePoly([lon, lat], rad, 20); areaName = bil(a.areaName && (a.areaName.ar || a.areaName.en) ? a.areaName : tx('منطقة محددة', 'Defined area'), 160); }
        const targets = Array.isArray(a.targets) ? [...new Set(a.targets.filter(id => vessel(id)))] : []; if (!targets.length) throw new ValidationError('targets');
        const t = now(), from = a.validFrom ? +a.validFrom : t, to = a.validTo ? +a.validTo : (r ? r.end : t + 24 * H); if (!(to > from)) throw new ValidationError('validity');
        const wc = warningClass(poly);
        const al = { id: uid('AL'), number: num('MRS-TA', 'al'), wwnws: wc, riskId: r ? r.id : null, riskSnapshot: r ? { title: r.title, type: r.type, level: r.level, start: r.start, end: r.end, explanation: r.explanation } : null, title, body, instructions: instr, poly, areaName,
          priority: ['routine', 'important', 'urgent'].includes(a.priority) ? a.priority : 'important', severity: ['low', 'medium', 'high', 'critical'].includes(a.severity) ? a.severity : (r ? r.level : 'medium'), validFrom: from, validTo: to, targets,
          status: 'draft', history: [{ s: 'draft', at: t, by: u.username }], createdAt: t, createdBy: u.username, approvedBy: null, approvedAt: null, dispatchedAt: null, label: 'Test Maritime Alert' };
        S.insert('alerts', al); genRecs(al); audit(u, 'alert.create', 'alert', al.id, tx('إنشاء إنذار ' + al.number + ' لـ' + targets.length + ' سفن: ' + title.ar, 'Alert ' + al.number + ' created for ' + targets.length + ' vessels: ' + title.en)); touch(); return al;
      },
      editAlert(u, a) {
        needOfficer(u); const al = S.get('alerts', a.id); if (!al || !['draft', 'pending_approval'].includes(al.status)) throw new ValidationError('state');
        const patch = {}; for (const k of ['title', 'body', 'instructions']) if (a[k]) patch[k] = bil(a[k]); if (a.priority) patch.priority = a.priority; if (a.severity) patch.severity = a.severity;
        if (Array.isArray(a.targets)) { const tg = a.targets.filter(id => vessel(id)); if (!tg.length) throw new ValidationError('targets'); patch.targets = tg; }
        if (a.validTo) patch.validTo = +a.validTo;
        S.update('alerts', al.id, patch); audit(u, 'alert.edit', 'alert', al.id, tx('تعديل الإنذار ' + al.number, 'Alert ' + al.number + ' edited')); touch(); return { ok: true };
      },
      submitAlert(u, { id }) { needOfficer(u); const al = S.get('alerts', id); if (!al || al.status !== 'draft') throw new ValidationError('state'); setAlert(al, 'pending_approval', u); audit(u, 'alert.submit', 'alert', id, tx('إرسال الإنذار ' + al.number + ' للمراجعة', 'Alert ' + al.number + ' submitted for review')); touch(); return { ok: true }; },
      approveAlert(u, a) {
        needOfficer(u); const al = S.get('alerts', a.id); if (!al || al.status !== 'pending_approval') throw new ValidationError('state'); needDisc(a);
        if (!a.reject && al.wwnws && !al.wwnws.directAlertAllowed) throw new ValidationError(al.wwnws.inKingdom ? 'outside_territorial_sea' : 'outside_kingdom_waters');
        if (a.reject) { setAlert(al, 'draft', u, a.note || 'returned'); audit(u, 'alert.return', 'alert', al.id, tx('إعادة الإنذار ' + al.number + ' للتعديل', 'Alert ' + al.number + ' returned for changes')); touch(); return { ok: true }; }
        setAlert(al, 'approved', u, a.note, { approvedBy: u.username, approvedAt: now(), verification: C.sha256(JSON.stringify([al.number, al.title, al.body, al.instructions, al.targets, al.validFrom, al.validTo])).slice(0, 16).toUpperCase() });
        audit(u, 'alert.approve', 'alert', al.id, tx('اعتماد الإنذار ' + al.number + ' في بيئة الاختبار مع الإقرار بالمسؤولية', 'Alert ' + al.number + ' approved in the test environment with responsibility statement'));
        if (!S.all('alternativeRoutes').some(x => x.alertId === al.id)) genRecs(al);
        for (const x of S.all('alternativeRoutes').filter(x => x.alertId === al.id && x.status === 'proposed')) S.update('alternativeRoutes', x.id, { status: 'approved', approvedBy: u.username, approvedAt: now() });
        audit(u, 'recommendation.approve', 'alert', al.id, tx('اعتماد توصيات السفن للإنذار ' + al.number + ' وتحويلها إلى تعليمات تشغيلية', 'Vessel recommendations for alert ' + al.number + ' approved as operational instructions'));
        touch(); return { ok: true };
      },
      prepareDispatch(u, { id }) {
        needOfficer(u); const al = S.get('alerts', id); if (!al || al.status !== 'approved') throw new ValidationError('state');
        const t = now();
        let held = 0;
        for (const vid of al.targets) { const v = vessel(vid); if (!v) continue; const ts = C.inSaudiTerritorialSea(v.pos); if (!ts) held++;
          S.insert('deliveryRecords', { id: uid('DR'), alertId: al.id, vesselId: vid, mmsi: v.mmsi, channel: v.channel === 'bridge' ? 'test_bridge_screen' : v.channel === 'vhf' ? 'test_vhf_broadcast' : v.channel === 'ais' ? 'test_ais_message' : 'none', status: ts ? 'queued' : 'held_outside_ts', distCoastNm: r1(C.distToSaudiCoastNm(v.pos)), holdReason: ts ? null : tx('السفينة خارج المياه الإقليمية (' + r1(C.distToSaudiCoastNm(v.pos)) + ' ميل من الساحل > ١٢): لا يُرسل الإنذار المباشر حتى تدخلها؛ تُغطى بالتحذير الساحلي/NAVAREA عبر NAVTEX/EGC.', 'Vessel is outside territorial waters (' + r1(C.distToSaudiCoastNm(v.pos)) + ' nm from coast > 12): the direct alert is held until it enters; covered by coastal/NAVAREA warnings via NAVTEX/EGC.'), queuedAt: t, dispatchedAt: null, receivedAt: null, ackAt: null, ackBy: null, failReason: null, history: [{ s: ts ? 'queued' : 'held_outside_ts', at: t }] }); }
        setAlert(al, 'ready_for_dispatch', u, al.targets.length + ' delivery records' + (held ? ', ' + held + ' held outside territorial waters' : ''));
        audit(u, 'alert.prepare', 'alert', id, tx('تجهيز الإنذار ' + al.number + ' للإرسال: ' + al.targets.length + ' سجلات تسليم', 'Alert ' + al.number + ' prepared for dispatch: ' + al.targets.length + ' delivery records')); touch(); return { ok: true };
      },
      dispatchAlert(u, { id }) {
        needOfficer(u); const al = S.get('alerts', id); if (!al || al.status !== 'ready_for_dispatch') throw new ValidationError('state'); const t = now(); let ok = 0, fail = 0;
        for (const d of S.all('deliveryRecords').filter(x => x.alertId === id && x.status === 'queued')) {
          if (d.channel === 'none') { fail++; S.update('deliveryRecords', d.id, { status: 'failed', failReason: tx('لا توجد قناة اتصال مسجلة لهذه السفينة في بيانات الاختبار', 'No communication channel registered for this vessel in the test data'), history: d.history.concat([{ s: 'failed', at: t }]) }); }
          else { ok++; S.update('deliveryRecords', d.id, { status: 'dispatched', dispatchedAt: t, history: d.history.concat([{ s: 'dispatched', at: t }]) }); }
        }
        setAlert(al, 'dispatched_test', u, ok + ' dispatched, ' + fail + ' failed', { dispatchedAt: t });
        audit(u, 'alert.dispatch', 'alert', id, tx('إرسال الإنذار ' + al.number + ' داخل بيئة الاختبار: ' + ok + ' سفن، تعذر ' + fail, 'Alert ' + al.number + ' dispatched in the test environment: ' + ok + ' vessels, ' + fail + ' failed')); touch(); return { ok, fail };
      },
      cancelAlert(u, { id, note }) { needOfficer(u); const al = S.get('alerts', id); if (!al || ['expired', 'cancelled'].includes(al.status)) throw new ValidationError('state'); setAlert(al, 'cancelled', u, note); audit(u, 'alert.cancel', 'alert', id, tx('إلغاء الإنذار ' + al.number, 'Alert ' + al.number + ' cancelled')); touch(); return { ok: true }; },
      proposeRoute(u, { vesselId, riskId }) { needOfficer(u); const v = vessel(vesselId), r = S.get('maritimeRisks', riskId); if (!v || !r) throw new ValidationError('vessel/risk'); if (v.status !== 'underway') throw new ValidationError('vessel not underway'); const row = proposeRoute(v, r, null, u); touch(); return row; },
      markReceived(u, { ids }) {
        if (!u || u.role !== 'bridge') throw new PermissionError('bridge'); const t = now(); const touched = new Set();
        for (const d of S.all('deliveryRecords').filter(x => (ids || []).includes(x.id) && x.vesselId === u.vesselId && x.status === 'dispatched')) { S.update('deliveryRecords', d.id, { status: 'received', receivedAt: t, history: d.history.concat([{ s: 'received', at: t }]) }); touched.add(d.alertId); audit(u, 'alert.received', 'delivery', d.id, tx('عُرض الإنذار على شاشة جسر ' + vessel(d.vesselId).name, 'Alert shown on the ' + vessel(d.vesselId).name + ' bridge screen')); }
        touched.forEach(aggregateAlert); if (touched.size) touch(); return { ok: true };
      },
      acknowledge(u, { id, officer, action, reason }) {
        if (!u || u.role !== 'bridge') throw new PermissionError('bridge'); const d = S.get('deliveryRecords', id); if (!d || d.vesselId !== u.vesselId) throw new PermissionError('own');
        if (!officer || str(officer, 80).length < 3) throw new ValidationError('officer'); if (d.ackAt) return { ok: true };
        const t = now(), rec = S.all('alternativeRoutes').find(x => x.alertId === d.alertId && x.vesselId === d.vesselId);
        const act = action === 'accepted' && rec ? 'accepted' : action === 'rejected' && rec ? 'rejected' : 'acknowledged';
        if (act === 'rejected' && (!reason || str(reason, 300).length < 3)) throw new ValidationError('reason');
        const v = vessel(d.vesselId), al = S.get('alerts', d.alertId);
        S.update('deliveryRecords', d.id, { status: act === 'rejected' ? 'rejected' : 'acknowledged', action: act, rejectReason: act === 'rejected' ? str(reason, 300) : null, actionLabel: act === 'acknowledged' ? tx('تأكيد الاستلام فقط', 'Acknowledged only') : rec.recommended.label, receivedAt: d.receivedAt || t, ackAt: t, ackBy: str(officer, 80), history: d.history.concat([{ s: act, at: t, by: str(officer, 80) }]) });
        if (rec) S.update('alternativeRoutes', rec.id, { vesselResponse: act, vesselResponseAt: t, vesselReason: act === 'rejected' ? str(reason, 300) : null });
        audit(u, act === 'rejected' ? 'recommendation.reject' : act === 'accepted' ? 'recommendation.accept' : 'alert.ack', 'delivery', d.id,
          tx((act === 'rejected' ? 'رفض توصية' : act === 'accepted' ? 'قبول توصية' : 'تأكيد استلام') + ' الإنذار ' + al.number + ' – ' + v.name + ' (' + str(officer, 80) + ')' + (act === 'rejected' ? ' – السبب: ' + str(reason, 300) : ''), (act === 'rejected' ? 'Recommendation rejected' : act === 'accepted' ? 'Recommendation accepted' : 'Acknowledged') + ' for alert ' + al.number + ' – ' + v.name + ' (' + str(officer, 80) + ')' + (act === 'rejected' ? ' – reason: ' + str(reason, 300) : '')), null, d.status, act === 'rejected' ? 'rejected' : 'acknowledged');
        aggregateAlert(al.id); touch(); return { ok: true, action: act };
      },
      chooseRecommendation(u, { id, kind, portId }) {
        needOfficer(u); const x = S.get('alternativeRoutes', id); if (!x || !x.options) throw new ValidationError('id');
        const al = x.alertId && S.get('alerts', x.alertId); if (al && !['draft', 'pending_approval'].includes(al.status)) throw new ValidationError('state');
        const o = x.options.find(q => q.kind === kind && (kind !== 'divert' || q.portId === portId)); if (!o) throw new ValidationError('option'); if (!o.safe) throw new ValidationError('unsafe_option');
        const v = vessel(x.vesselId), patch = { recommended: { kind: o.kind, portId: o.portId || null, label: o.label }, status: 'modified', options: x.options.map(q => Object.assign({}, q, { recommended: q === o })) };
        if (kind === 'divert') Object.assign(patch, { kind: 'divert', alternative: { nodes: x._nodes[portId], nm: o.nm, hours: o.hours, portId, coords: [v.pos].concat(C.nodesToCoords(x._nodes[portId])) } });
        else if (kind === 'continue') Object.assign(patch, { kind: 'continue', alternative: null, checks: [] });
        else if (kind === 'delay') Object.assign(patch, { kind: 'delay', alternative: { nodes: x.current.nodes, nm: o.nm, hours: o.hours, waitHours: o.waitH, coords: x.current.coords } });
        else Object.assign(patch, { kind: x._base.kind, alternative: x._base.alternative, checks: x._base.checks });
        patch.reason = tx('عدّل ضابط الميناء التوصية إلى: ' + o.label.ar, 'The port officer changed the recommendation to: ' + o.label.en);
        S.update('alternativeRoutes', id, patch);
        audit(u, 'recommendation.modify', 'alternativeRoute', id, tx('تعديل توصية ' + v.name + ' إلى: ' + o.label.ar, 'Recommendation for ' + v.name + ' changed to: ' + o.label.en), null, x.recommended.kind, o.kind);
        touch(); return S.get('alternativeRoutes', id);
      },
      simulateEnterTerritorialWaters(u, { vesselId }) {
        needOfficer(u); const v = vessel(vesselId); if (!v) throw new ValidationError('id'); if (C.inSaudiTerritorialSea(v.pos)) return { ok: true, already: true };
        const dest = (C.PORTS.find(p => p.id === v.destId) || {}).p; if (!dest) throw new ValidationError('destination');
        let pos = v.pos; for (let k = 1; k <= 40; k++) { const q = [v.pos[0] + (dest[0] - v.pos[0]) * k / 40, v.pos[1] + (dest[1] - v.pos[1]) * k / 40]; pos = q; if (C.distToSaudiCoastNm(q) <= C.TERRITORIAL_SEA_NM - 2) break; }
        const before = v.distCoastNm; S.update('vessels', v.id, Object.assign(planVesselRoute(Object.assign({}, v, { pos })), { pos, recordedAt: now() })); geo(S.get('vessels', v.id)); S.update('vessels', v.id, { distCoastNm: S.get('vessels', v.id).distCoastNm, inTerritorialSea: true });
        audit(u, 'vessel.enter_ts', 'vessel', v.id, tx('محاكاة: دخلت ' + v.name + ' المياه الإقليمية (من ' + before + ' إلى ' + S.get('vessels', v.id).distCoastNm + ' ميل من الساحل)', 'Simulation: ' + v.name + ' entered territorial waters (' + before + ' → ' + S.get('vessels', v.id).distCoastNm + ' nm from coast)'), null, 'outside_ts', 'inside_ts');
        releaseHeld(v.id, u); computeAffected(); touch(); return { ok: true };
      },
      createBulletin(u, a) {
        needOfficer(u); const types = ['weather_bulletin', 'wind_wave_warning', 'port_closure', 'nav_restriction']; if (!types.includes(a.type)) throw new ValidationError('type');
        const r = a.riskId ? S.get('maritimeRisks', a.riskId) : null; const title = bil(a.title, 200), body = bil(a.body); if (!title.ar || !title.en || !body.ar || !body.en) throw new ValidationError('title');
        let poly, areaName; if (r) { poly = r.poly; areaName = r.areaName; } else if (a.areaId && area(a.areaId)) { poly = area(a.areaId).poly; areaName = area(a.areaId).name; } else if (a.portId && port(a.portId)) { poly = C.circlePoly(port(a.portId).p, 12, 16); areaName = port(a.portId).name; } else throw new ValidationError('area');
        const wc = warningClass(poly), auto = wc.level;
        const t = now(), b = { id: uid('BL'), number: num('MRS-TB', 'bl'), type: a.type, scope: normScope(a.scope) || auto, suggestedScope: auto, wwnws: wc, riskId: r ? r.id : null, portId: a.portId || null, title, body, poly, areaName,
          validFrom: a.validFrom ? +a.validFrom : t, validTo: a.validTo ? +a.validTo : (r ? r.end : t + 24 * H), status: 'draft', history: [{ s: 'draft', at: t, by: u.username }], createdAt: t, createdBy: u.username, label: 'Test Bulletin' };
        b.checks = [];
        if (b.type === 'weather_bulletin' && b.validTo - b.validFrom < 24 * H) b.checks.push(tx('فترة صلاحية التوقعات أقل من ٢٤ ساعة (' + WWMIWS_REF + '، 4.2.2.2)', 'Forecast valid period is less than 24 h (' + WWMIWS_REF + ', 4.2.2.2)'));
        if (b.scope !== 'LOCAL' && /[^\x20-\x7E\n]/.test(b.body.en)) b.checks.push(tx('النص الإنجليزي يحتوي أحرفًا غير لاتينية؛ الخدمات الدولية (NAVTEX/EGC) بالإنجليزية فقط', 'English text contains non-Latin characters; international services (NAVTEX/EGC) are English only'));
        if (b.scope === 'SUBAREA') b.scope = auto; b.warning = Object.assign(warningDefaults(r, b.scope, b), a.warning || {}); b.recipients = bulletinRecipients(b); b.draftEn = warningDraft(b);
        S.insert('bulletins', b); audit(u, 'bulletin.create', 'bulletin', b.id, tx('إنشاء نشرة ' + b.number + ': ' + title.ar, 'Bulletin ' + b.number + ' created: ' + title.en)); touch(); return b;
      },
      editBulletin(u, a) {
        needOfficer(u); const b = S.get('bulletins', a.id); if (!b || !['draft', 'under_review'].includes(b.status)) throw new ValidationError('state');
        const patch = {}; if (a.title) patch.title = bil(a.title, 200); if (a.body) patch.body = bil(a.body);
        if (a.scope && normScope(a.scope) && normScope(a.scope) !== 'SUBAREA' && normScope(a.scope) !== b.scope) { patch.scope = normScope(a.scope); }
        for (const k of ['hazard', 'impact', 'precautions', 'source', 'authority']) if (a.warning && a.warning[k] != null) patch.warning = Object.assign({}, b.warning, patch.warning, { [k]: str(a.warning[k], 600) });
        if (a.draftEn != null) patch.draftEn = str(a.draftEn, 3000);
        const nb = Object.assign({}, b, patch); if (patch.scope || patch.warning) { nb.recipients = bulletinRecipients(nb); patch.recipients = nb.recipients; if (a.draftEn == null) patch.draftEn = warningDraft(nb); }
        S.update('bulletins', b.id, patch); audit(u, 'bulletin.edit', 'bulletin', b.id, tx('تعديل النشرة ' + b.number, 'Bulletin ' + b.number + ' edited')); touch(); return S.get('bulletins', b.id);
      },
      submitBulletin(u, { id }) { needOfficer(u); const b = S.get('bulletins', id); if (!b || b.status !== 'draft') throw new ValidationError('state'); setBulletin(b, 'under_review', u); audit(u, 'bulletin.submit', 'bulletin', id, tx('إرسال النشرة ' + b.number + ' للمراجعة', 'Bulletin ' + b.number + ' submitted for review')); touch(); return { ok: true }; },
      approveBulletin(u, { id, reject, note }) {
        needOfficer(u); const b = S.get('bulletins', id); if (!b || b.status !== 'under_review') throw new ValidationError('state');
        if (reject) { setBulletin(b, 'draft', u, note || 'returned'); audit(u, 'bulletin.return', 'bulletin', id, tx('إعادة النشرة ' + b.number + ' للتعديل', 'Bulletin ' + b.number + ' returned for changes')); }
        else { setBulletin(b, 'approved', u, note); audit(u, 'bulletin.approve', 'bulletin', id, tx('اعتماد النشرة ' + b.number, 'Bulletin ' + b.number + ' approved')); }
        touch(); return { ok: true };
      },
      readyBulletin(u, a) { const b = S.get('bulletins', a.id); if (b && b.status === 'draft') api.submitBulletin(u, a); return api.approveBulletin(u, a); },
      sendBulletin(u, { id }) {
        needOfficer(u); let b = S.get('bulletins', id); if (!b || b.status !== 'approved') throw new ValidationError('state'); const t = now();
        const recipients = (b.recipients || []).map(r => Object.assign({}, r, { status: 'sent', sentAt: t, endpoint: 'proposed://' + r.kind + '/' + r.targetId + '/test' }));
        let n = 0;
        if (b.scope === 'LOCAL' || b.scope === 'COASTAL') for (const v of S.all('vessels').filter(v => C.pointInPoly(v.pos, b.poly) && C.inSaudiTerritorialSea(v.pos) && v.channel === 'bridge')) { S.insert('bulletinDeliveries', { id: uid('BD'), bulletinId: id, vesselId: v.id, status: 'sent', sentAt: t, readAt: null }); n++; }
        setBulletin(b, 'sent', u, recipients.length + ' parties, ' + n + ' ships', { recipients, sentAt: t, shipNotices: n });
        for (const r of recipients) S.insert('integrationEvents', { id: uid('IE'), at: t, integration: 'bulletin_' + r.kind, direction: 'out', status: 'test_only', messageId: id, endpoint: r.endpoint, by: u.username });
        audit(u, 'bulletin.send', 'bulletin', id, tx('تسجيل إحالة النشرة ' + b.number + ' إلى ' + recipients.map(r => r.name.ar).join('، ') + (n ? ' وإشعار ' + n + ' سفن داخل المياه الإقليمية' : '') + ' – بيئة اختبار، لم تُبث رسميًا', 'Bulletin ' + b.number + ' routed to ' + recipients.map(r => r.name.en).join(', ') + (n ? ' and ' + n + ' ships in territorial waters notified' : '') + ' – test environment, not officially broadcast'));
        touch(); return { recipients: recipients.length, ships: n };
      },
      confirmBulletinRecipient(u, { id, recipientId, by, ref, note }) {
        needOfficer(u); const b = S.get('bulletins', id); if (!b || !['sent', 'recipient_ack'].includes(b.status)) throw new ValidationError('state');
        if (!by || str(by, 80).length < 2) throw new ValidationError('officer'); const t = now();
        const recipients = b.recipients.map(r => r.id === recipientId ? Object.assign({}, r, { status: 'confirmed', confirmedAt: t, confirmedBy: str(by, 80), ref: str(ref, 60) || null, note: str(note, 200) || null }) : r);
        S.update('bulletins', id, { recipients });
        audit(u, 'bulletin.receipt', 'bulletin', id, tx('تسجيل تأكيد استلام النشرة ' + b.number + ' من ' + recipients.find(r => r.id === recipientId).name.ar + ' (' + str(by, 80) + ')', 'Receipt of bulletin ' + b.number + ' recorded from ' + recipients.find(r => r.id === recipientId).name.en + ' (' + str(by, 80) + ')'));
        if (recipients.every(r => r.status === 'confirmed') && b.status === 'sent') setBulletin(S.get('bulletins', id), 'recipient_ack', SYS, 'all recipients acknowledged'), audit(SYS, 'bulletin.all_ack', 'bulletin', id, tx('أكدت كل الجهات استلام النشرة ' + b.number, 'All recipients acknowledged bulletin ' + b.number));
        touch(); return { ok: true };
      },
      recordOfficialIssue(u, { id, ref, confirmedBy, authorityId }) {
        // Official issuance is recorded only on confirmation from the authorized entity for this level (port for LOCAL, NAVTEX station for COASTAL, NAVAREA IX coordinator for NAVAREA)
        needOfficer(u); const b = S.get('bulletins', id); if (!b || b.status !== 'recipient_ack') throw new ValidationError('not_acknowledged');
        const need = b.scope === 'NAVAREA' ? 'coordinator' : b.scope === 'COASTAL' ? 'navtex' : 'port', auth = b.recipients.find(r => r.id === authorityId && r.kind === need && r.status === 'confirmed');
        if (!auth) throw new ValidationError('authority_required'); if (!ref || str(ref, 80).length < 3) throw new ValidationError('reference_required'); if (!confirmedBy || str(confirmedBy, 80).length < 2) throw new ValidationError('officer');
        setBulletin(b, 'issued_official', u, str(ref, 80), { officialRef: str(ref, 80), officialAt: now(), officialBy: { authority: auth.name, person: str(confirmedBy, 80) } });
        audit(u, 'bulletin.official', 'bulletin', id, tx('تسجيل صدور النشرة ' + b.number + ' رسميًا بتأكيد ' + auth.name.ar + ' (' + str(confirmedBy, 80) + ') – المرجع ' + str(ref, 80), 'Official issuance of bulletin ' + b.number + ' recorded on confirmation by ' + auth.name.en + ' (' + str(confirmedBy, 80) + ') – ref ' + str(ref, 80)));
        touch(); return { ok: true };
      },
      markBulletinRead(u, { id }) { if (!u || u.role !== 'bridge') throw new PermissionError('bridge'); const d = S.get('bulletinDeliveries', id); if (!d || d.vesselId !== u.vesselId) throw new PermissionError('own'); if (!d.readAt) { S.update('bulletinDeliveries', id, { status: 'read', readAt: now() }); audit(u, 'bulletin.read', 'bulletin', d.bulletinId, tx('اطلعت ' + vessel(d.vesselId).name + ' على الإشعار الملاحي', vessel(d.vesselId).name + ' read the navigational notice')); touch(); } return { ok: true }; },
      issueBulletin(u, a) { const b = S.get('bulletins', a.id); if (b && b.status === 'draft') api.submitBulletin(u, a); if (S.get('bulletins', a.id).status === 'under_review') api.approveBulletin(u, a); return api.sendBulletin(u, a); },
      cancelBulletin(u, { id }) { needOfficer(u); const b = S.get('bulletins', id); if (!b || b.status === 'cancelled') throw new ValidationError('state'); S.update('bulletins', id, { status: 'cancelled', history: b.history.concat([{ s: 'cancelled', at: now(), by: u.username }]) }); audit(u, 'bulletin.cancel', 'bulletin', id, tx('إلغاء النشرة ' + b.number, 'Bulletin ' + b.number + ' cancelled')); touch(); return { ok: true }; },
      saveNavtex(u, a) {
        needOfficer(u); const t = now(); const ex = a.id && S.get('navtexMessages', a.id);
        const m = Object.assign(ex ? Object.assign({}, ex) : { id: uid('NX'), number: num('NX-TEST', 'nx'), createdAt: t, createdBy: u.username, history: [], dispatches: [] }, {
          bulletinId: a.bulletinId || (ex && ex.bulletinId) || null, subject: SUBJECT[a.subject] ? a.subject : null, scope: normScope(a.scope), targetId: C.STATIONS.some(s => s.id === a.targetId) ? a.targetId : null,
          areaText: str(a.areaText, 200), position: a.lon != null && a.lat != null && a.lon !== '' && a.lat !== '' ? [+a.lon, +a.lat] : null, textEn: str(a.textEn, 2000), textAr: str(a.textAr, 2000), validFrom: a.validFrom ? +a.validFrom : null, validTo: a.validTo ? +a.validTo : null, serial: clamp(+a.serial || 1, 1, 999), preparedAt: t });
        const f = formatNavtex(m); m.errors = f.errors; m.formatted = f.text; m.status = f.errors.length ? 'invalid' : 'formatted';
        m.history = m.history.concat([{ s: m.status, at: t, by: u.username, note: f.errors.join('; ') || null }]);
        if (ex) S.update('navtexMessages', m.id, m); else S.insert('navtexMessages', m);
        audit(u, 'navtex.prepare', 'navtex', m.id, tx('تجهيز رسالة ' + m.number + ' بصيغة NAVTEX للاختبار: ' + (f.errors.length ? 'حقول ناقصة أو غير صحيحة (' + f.errors.length + ')' : 'صالحة'), 'NAVTEX-format test message ' + m.number + ' prepared: ' + (f.errors.length ? f.errors.length + ' validation errors' : 'valid')));
        touch(); return S.get('navtexMessages', m.id);
      },
      exportNavtex(u, { id }) { needOfficer(u); const m = S.get('navtexMessages', id); if (!m) throw new ValidationError('id'); S.update('navtexMessages', id, { exportedAt: now(), history: m.history.concat([{ s: 'exported', at: now(), by: u.username }]) }); audit(u, 'navtex.export', 'navtex', id, tx('تصدير رسالة الاختبار ' + m.number, 'Test message ' + m.number + ' exported')); touch(); return { ok: true }; },
      dispatchNavtexTest(u, { id }) {
        needOfficer(u); const m = S.get('navtexMessages', id); if (!m) throw new ValidationError('id'); if (m.status === 'invalid') throw new ValidationError('message has validation errors');
        const t = now(), st = C.STATIONS.find(s => s.id === m.targetId);
        const rec = { at: t, endpoint: m.scope === 'NAVAREA' ? 'proposed://navarea-ix/coordinator/test' : 'proposed://navtex-station/' + (st ? st.id : '?') + '/test', target: st ? tx(st.ar, st.en) : null, targetRole: st ? st.role : null, payloadBytes: m.formatted.length,
          response: { status: 'accepted_by_test_endpoint', note: tx('استجابة بيئة الاختبار: تم التحقق من بنية الرسالة. لم تُرسل إلى أي جهة أو محطة.', 'Test environment response: message structure validated. Not sent to any authority or station.') } };
        S.update('navtexMessages', m.id, { status: 'test_dispatched', dispatches: m.dispatches.concat([rec]), history: m.history.concat([{ s: 'test_dispatched', at: t, by: u.username }]) });
        S.insert('integrationEvents', { id: uid('IE'), at: t, integration: m.scope === 'NAVAREA' ? 'navarea_ix' : 'navtex', direction: 'out', status: 'test_only', messageId: m.id, endpoint: rec.endpoint, by: u.username });
        audit(u, 'navtex.test_dispatch', 'navtex', m.id, tx('تمرير ' + m.number + ' إلى نقطة تكامل مقترحة (' + (m.scope === 'NAVAREA' ? 'منسق NAVAREA IX' : 'محطة NAVTEX') + ') في بيئة الاختبار – لم يُرسل فعليًا', m.number + ' passed to a proposed integration endpoint (' + (m.scope === 'NAVAREA' ? 'NAVAREA IX coordinator' : 'NAVTEX station') + ') in the test environment – not actually sent'));
        touch(); return rec;
      },
      tick() {
        const t = now(); let ch = false;
        for (const a of S.all('alerts')) if (!['expired', 'cancelled'].includes(a.status) && a.validTo <= t) { setAlert(a, 'expired', SYS); audit(SYS, 'alert.expire', 'alert', a.id, tx('انتهاء صلاحية الإنذار ' + a.number, 'Alert ' + a.number + ' expired')); ch = true; }
        for (const b of S.all('bulletins')) if (['sent', 'recipient_ack', 'issued_official'].includes(b.status) && b.validTo <= t) { S.update('bulletins', b.id, { status: 'expired' }); ch = true; }
        if (ch) touch();
      },
      classifyArea: (u, { poly }) => warningClass(poly),
      marineForecast: (u, { areaId, hours }) => { needOfficer(u); return marineForecast(areaId, hours); },
      runAllocation(u, { portId }) { needOfficer(u); const out = runAllocationFor(u, portId); touch(); return out; },
      approveAllocation(u, { id, reject, note }) {
        needOfficer(u); const a = S.get('allocations', id); if (!a || a.status !== 'proposed') throw new ValidationError('state');
        if (reject) { setAllocation(a, 'rejected', u, note); audit(u, 'allocation.reject', 'allocation', id, tx('رفض تحويل ' + vessel(a.vesselId).name, 'Allocation for ' + vessel(a.vesselId).name + ' rejected')); }
        else { const p = port(a.toPort); if (portOcc(p) + 100 / p.capacityBerths > MAX_ALLOC_OCC + .5) throw new ValidationError('capacity'); setAllocation(a, 'approved', u, note, { approvedAt: now() }); audit(u, 'allocation.approve', 'allocation', id, tx('اعتماد تحويل ' + vessel(a.vesselId).name + ' إلى ' + p.name.ar, 'Diversion of ' + vessel(a.vesselId).name + ' to ' + p.name.en + ' approved')); }
        analyse('allocation'); touch(); return { ok: true };
      },
      modifyAllocation(u, { id, toPort }) {
        needOfficer(u); const a = S.get('allocations', id); if (!a || !['proposed', 'no_capacity'].includes(a.status)) throw new ValidationError('state');
        const c = a.calc.find(x => x.portId === toPort); if (!c || !c.eligible) throw new ValidationError('port_not_eligible'); const p = port(toPort);
        if (portOcc(p) + 100 / p.capacityBerths > MAX_ALLOC_OCC + .5) throw new ValidationError('capacity');
        setAllocation(a, 'modified', u, 'manual', { toPort, approvedAt: now() }); audit(u, 'allocation.modify', 'allocation', id, tx('تعديل يدوي: تحويل ' + vessel(a.vesselId).name + ' إلى ' + p.name.ar, 'Manual change: ' + vessel(a.vesselId).name + ' to ' + p.name.en));
        analyse('allocation'); touch(); return { ok: true };
      },
      recalculate(u) {
        needOfficer(u); analyse('manual recalculation');
        for (const al of S.all('alerts').filter(a => ['draft', 'pending_approval'].includes(a.status))) { for (const x of S.all('alternativeRoutes').filter(x => x.alertId === al.id).slice()) S.remove('alternativeRoutes', x.id); genRecs(al); }
        audit(u, 'recommendation.recalculate', 'analysis', null, tx('إعادة حساب المخاطر والتوصيات', 'Risks and recommendations recalculated')); touch(); return { ok: true };
      },
      runScenario(u, { n }) {
        needOfficer(u); const OFFU = u, res = { n: +n };
        const topBy = pred => S.all('maritimeRisks').filter(pred).sort((a, b) => rank(b.level) - rank(a.level))[0];
        const targetsOf = r => S.all('affectedVessels').filter(a => a.riskId === r.id && a.relation !== 'crossing').map(a => a.vesselId);
        const mkAlert = (r, targets) => api.createAlert(OFFU, { riskId: r.id, targets, priority: 'urgent', title: tx(RTYPE[r.type].ar + ' – ' + r.areaName.ar, RTYPE[r.type].en + ' – ' + r.areaName.en), body: r.explanation, instructions: r.actions });
        if (+n === 1) { api.editWeather(OFFU, { areaId: 'LTH', fromH: 6, toH: 22, values: { windKn: 38, waveM: 4.2, visNm: 1.5 } }); const r = topBy(x => x.areaId === 'LTH'); const al = mkAlert(r, targetsOf(r).length ? targetsOf(r) : ['V5', 'V17']); api.submitAlert(OFFU, { id: al.id }); res.alertId = al.id; res.go = 'alerts'; }
        else if (+n === 2) { api.updatePort(OFFU, { id: 'JED', status: 'closed', untilH: 24, restrictions: tx('مغلق بسبب الطقس (محاكاة)', 'Closed due to weather (simulation)') }); runAllocationFor(OFFU, 'JED'); res.go = 'distribute'; }
        else if (+n === 3) { api.updatePort(OFFU, { id: 'DMM', congestionPct: 93 }); runAllocationFor(OFFU, 'DMM'); res.go = 'distribute'; }
        else if (+n === 4) { const r = topBy(x => x.areaId === 'JED'); const out = S.all('vessels').find(v => v.channel === 'bridge' && v.status === 'underway' && !C.inSaudiTerritorialSea(v.pos) && targetsOf(r).includes(v.id)); const al = mkAlert(r, [out.id]); api.submitAlert(OFFU, { id: al.id }); api.approveAlert(OFFU, { id: al.id, disclaimer: true }); api.prepareDispatch(OFFU, { id: al.id }); api.dispatchAlert(OFFU, { id: al.id }); res.alertId = al.id; res.vesselId = out.id; res.go = 'alerts'; }
        else if (+n === 5) { const r = topBy(x => x.areaId === 'JED'); const b = api.createBulletin(OFFU, { type: 'wind_wave_warning', riskId: r.id, scope: 'NAVAREA', title: r.title, body: r.explanation }); api.submitBulletin(OFFU, { id: b.id }); res.bulletinId = b.id; res.go = 'bulletins'; }
        else throw new ValidationError('scenario');
        audit(u, 'scenario.run', 'scenario', String(n), tx('تشغيل سيناريو العرض ' + n, 'Demo scenario ' + n + ' run')); touch(); return res;
      },
      ingestWeather(payload) { const res = validateWeather(payload); applyWeather({ username: 'integration:ncm-test', role: 'integration' }, res, 'test_api'); touch(); return { accepted: res.accepted.length, rejected: res.rejected, warnings: res.warnings }; },
      validateWeather,
      onChange(f) { listeners.push(f); },
      seed, store: S, DISCLAIMER
    };
    if (!S.get('meta', 'meta') || !S.get('settings', 'rules')) seed();
    return api;
  }
  return { createService, MemoryStore, DISCLAIMER, DEFAULT_RULES, SEA_AREAS, CONSTRAINTS };
});
