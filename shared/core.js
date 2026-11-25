/* MARSA core — pure geodata + algorithms. Shared by the browser build and the Node server.
 * No I/O here. Everything is deterministic given its inputs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarsaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Geometry ----------
  const R_NM = 3440.065; // Earth radius in nautical miles
  const rad = d => d * Math.PI / 180;
  function gcNm(a, b) { // a,b = [lon,lat]
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function segIntersect(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function segmentHitsPoly(a, b, poly) {
    if (pointInPoly(a, poly) || pointInPoly(b, poly)) return true;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segIntersect(a, b, poly[j], poly[i])) return true;
    return false;
  }
  // Approximate distance (nm) from point to segment using local equirectangular projection.
  function distPointSegNm(p, a, b) {
    const k = Math.cos(rad(p[1]));
    const ax = (a[0] - p[0]) * k * 60, ay = (a[1] - p[1]) * 60, bx = (b[0] - p[0]) * k * 60, by = (b[1] - p[1]) * 60;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  function distPolyToPolyline(poly, line) {
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
      if (segmentHitsPoly(line[i], line[i + 1], poly)) return 0;
      for (const v of poly) best = Math.min(best, distPointSegNm(v, line[i], line[i + 1]));
      for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
        best = Math.min(best, distPointSegNm(line[i], poly[k], poly[j]));
      }
    }
    return best;
  }
  function centroid(poly) {
    let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }
  function circlePoly(center, radiusNm, n = 24) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      out.push([center[0] + (radiusNm / 60) * Math.cos(a) / Math.cos(rad(center[1])), center[1] + (radiusNm / 60) * Math.sin(a)]);
    }
    return out;
  }
  function polylineLength(line) { let s = 0; for (let i = 1; i < line.length; i++) s += gcNm(line[i - 1], line[i]); return s; }
  function pointAlong(line, nm) { // returns {pos, cog, idx}
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      const seg = gcNm(line[i - 1], line[i]);
      if (acc + seg >= nm || i === line.length - 1) {
        const t = seg ? Math.min(1, Math.max(0, (nm - acc) / seg)) : 0;
        const a = line[i - 1], b = line[i];
        const pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        return { pos, cog: bearing(a, b), idx: i };
      }
      acc += seg;
    }
    return { pos: line[line.length - 1], cog: 0, idx: line.length - 1 };
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function fmtCoord(p) { // [lon,lat] -> "12-35.0N 043-20.0E" (S-53 style)
    const f = (v, w, pos, neg) => {
      const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
      return String(d).padStart(w, '0') + '-' + m.toFixed(1).padStart(4, '0') + (v >= 0 ? pos : neg);
    };
    return f(p[1], 2, 'N', 'S') + ' ' + f(p[0], 3, 'E', 'W');
  }

  // ---------- Geodata (simplified coastlines, for display and sanity only — not for navigation) ----------
  const LAND = {
    africa: [[8,33.5],[11.5,33.2],[15.2,32.4],[19,30.3],[20.1,32.2],[23,32.6],[25,31.7],[29,30.9],[31,31.6],[32.3,31.3],[32.33,30.6],[32.55,29.95],[32.6,29.6],[32.75,29.2],[33.2,28.4],[33.6,27.7],[33.85,27.2],[34.3,26.1],[35,24.9],[35.6,23.9],[36.6,22.2],[37.2,21],[37.25,19.6],[38,18.4],[38.6,17.5],[39.4,15.8],[39.7,15.3],[40.3,14.9],[41.2,13.9],[42.4,13],[43.2,12.45],[43.4,12.05],[42.75,11.65],[43.1,11.5],[43.47,11.3],[45.03,10.44],[46.5,10.7],[47.5,11.15],[49,11.3],[50.3,11.6],[51.27,11.83],[51.1,10.6],[51.4,10.45],[50.8,9.2],[50.1,7.8],[49,6],[48,4.4],[46.8,2.8],[45.3,2],[44,1.2],[42.5,-0.4],[41.6,-1.7],[40.2,-2.8],[39.65,-4.05],[39.3,-6.8],[39.5,-8.5],[40,-10.3],[40.6,-14.5],[39.5,-16.6],[36.9,-17.9],[34.85,-19.8],[35.5,-22],[35.5,-23.8],[33.5,-25.3],[32.6,-26],[32.8,-27.5],[32.4,-28.7],[31,-29.85],[30,-31],[28,-32.7],[26,-33.8],[24,-34.1],[22,-34.1],[20,-34.83],[18.5,-34.35],[18.4,-33.9],[17.9,-32.8],[18,-31.5],[16.5,-28.6],[15.2,-26.7],[14.5,-22.9],[13.4,-20.5],[11.8,-17.2],[12.2,-14],[13.55,-12.35],[13.23,-8.8],[12.3,-6.1],[11.8,-4.8],[10,-2.8],[9.3,-1],[9.5,1],[9.8,3],[8.8,4.5],[8,4.4]],
    asia: [[32.3,31.3],[34.2,31.3],[35,33.5],[78,33.5],[78,8.9],[77.55,8.08],[76.3,9.9],[75.2,12.5],[74.3,14.5],[73.8,15.5],[73,18],[72.85,19],[72.6,21],[72.5,22.3],[70.5,21],[69,22.3],[70,22.9],[68.5,23.5],[67.4,24],[67,24.8],[66.6,25.4],[64.6,25.2],[62.3,25.1],[61.6,25.2],[60.5,25.3],[58.8,25.55],[57.77,25.64],[57.2,26.6],[56.9,27.05],[56.28,27.15],[55.7,26.95],[55.3,26.6],[54.8,26.5],[54,26.7],[53.3,26.9],[52.5,27.4],[51.4,27.9],[50.85,28.9],[50.2,29.9],[49.4,30.15],[48.85,30],[48.4,29.95],[48,29.4],[48.4,28.5],[49.1,27.6],[49.6,27],[50.15,26.65],[50.1,26.45],[50.2,25.8],[50.6,25],[50.8,24.75],[50.9,25.6],[51.2,26.15],[51.6,25.3],[51.5,24.6],[52.5,24.2],[54.4,24.45],[55.3,25.25],[56.05,26.1],[56.35,26.4],[56.4,25.8],[56.35,25.1],[56.6,24.4],[58.5,23.6],[59.8,22.5],[58.8,20.5],[58.7,20.3],[57.7,18.9],[56.6,18],[55,17.1],[54,16.9],[53,16.4],[52.2,15.6],[50,15],[49.1,14.5],[47,13.6],[45,12.8],[43.5,12.7],[43.25,13.3],[42.95,14.8],[42.6,16],[42.55,16.9],[41.6,18],[40.8,19.4],[39.6,20.9],[39.15,21.5],[39.05,22.4],[38.7,23.3],[38.0,24.1],[37.2,25],[36.5,26],[35.6,27.3],[35.2,28],[34.85,28.3],[35,29.5],[34.9,29.5],[34.6,28.8],[34.4,28],[34.25,27.73],[33.6,28.3],[32.9,29.4],[32.6,29.95],[32.4,30.6]],
    madagascar: [[49.3,-12],[50.3,-15],[49.5,-18],[48.5,-21.5],[47.2,-25],[45.2,-25.6],[43.7,-23.5],[43.3,-21.5],[44.4,-19.5],[44.2,-16.5],[46.3,-15.8],[47.9,-13.7]],
    socotra: [[53.3,12.6],[54.5,12.7],[54.2,12.3],[53.6,12.3]],
    bahrain: [[50.45,26.25],[50.65,26.25],[50.62,25.8],[50.45,25.9]]
  };
  // Saudi coastline (subset of the simplified outline above: Red Sea and Arabian Gulf coasts). Approximate – not official baselines.
  const SA_COAST = [LAND.asia.slice(80, 95), LAND.asia.slice(43, 51)];
  const TERRITORIAL_SEA_NM = 12; // UNCLOS art. 3; measured here from the simplified coastline, not from official baselines
  function distSegNm(p, a, b) { const k = Math.cos(p[1] * Math.PI / 180), ax = (a[0] - p[0]) * k * 60, ay = (a[1] - p[1]) * 60, bx = (b[0] - p[0]) * k * 60, by = (b[1] - p[1]) * 60, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y); }
  function distToSaudiCoastNm(p) { let m = Infinity; for (const line of SA_COAST) for (let i = 1; i < line.length; i++) m = Math.min(m, distSegNm(p, line[i - 1], line[i])); return m; }
  const inSaudiTerritorialSea = p => distToSaudiCoastNm(p) <= TERRITORIAL_SEA_NM;
  const SEA_LABELS = [
    { ar: 'البحر الأحمر', en: 'Red Sea', p: [37.3, 21.2], rot: -58 },
    { ar: 'خليج عدن', en: 'Gulf of Aden', p: [47.5, 12.2], rot: 8 },
    { ar: 'بحر العرب', en: 'Arabian Sea', p: [63, 17] },
    { ar: 'الخليج العربي', en: 'Arabian Gulf', p: [52.3, 26.3], rot: -28 },
    { ar: 'بحر عُمان', en: 'Gulf of Oman', p: [59.2, 24.4], rot: -20 },
    { ar: 'المحيط الهندي', en: 'Indian Ocean', p: [62, -5] },
    { ar: 'باب المندب', en: 'Bab el-Mandeb', p: [43.6, 11.95], small: true },
    { ar: 'مضيق هرمز', en: 'Strait of Hormuz', p: [57.3, 26.15], small: true }
  ];

  // Sea-lane graph: nodes are open-water waypoints. Edges may carry maxDraft (m) or fixed distances for off-map legs.
  const NODES = {
    PSD: [32.35, 31.55], SCN: [32.365, 30.6], SUZ: [32.58, 29.75], GS1: [33.2, 28.55], RS1: [34.55, 27.35], AQ1: [34.75, 28.3], AQB_A: [34.93, 29.3],
    RS2: [36.1, 25.2], YNB_A: [37.8, 23.95], RS3: [37.75, 22.2], KAP_A: [38.85, 22.45], JED_A: [38.95, 21.45], RS4: [39.1, 19.6], PSU_A: [37.5, 19.65],
    RS5: [40.7, 16.6], JZN_A: [42.25, 16.85], HOLD_RS: [40.4, 17.6], RS6: [42.3, 14.0], BAB: [43.38, 12.6], GA1: [45.3, 12.1], ADN_A: [45.0, 12.62],
    DJI_A: [43.35, 11.72], GA2: [48.5, 12.7], HOLD_GA: [50.0, 13.3], GUA: [52.2, 12.3], AS1: [55.0, 14.6], SLL_A: [54.05, 16.6], HOLD_SLL: [55.2, 16.3],
    AS2: [59.5, 18.5], AS3: [61.0, 21.5], GOO: [58.6, 24.5], HOR: [56.6, 26.5], HOR2: [55.9, 26.4], JEA_A: [54.95, 25.15], AG1: [53.5, 25.8],
    AG2: [51.9, 26.9], DMM_A: [50.45, 26.65], JUB_A: [49.95, 27.15], AG3: [50.4, 27.7], KWT_A: [48.45, 29.2],
    KHI_A: [66.85, 24.6], AS4: [65.0, 22.0], MUM_A: [72.55, 18.9], AS5: [68.0, 17.0], AS6: [72.0, 11.0], IND_S: [76.8, 7.2], ASIA_GATE: [77.9, 5.9],
    SOM1: [53.5, 8.0], SOM2: [48.5, -1.5], SOM3: [45.5, -8.5], MOZ1: [43.0, -14.5], MOZ2: [39.3, -21.0], SAF1: [36.0, -30.5], SAF2: [27.0, -35.2],
    AGU: [20.0, -36.2], CPT: [16.8, -34.6], IOS1: [62.0, -8.0], IOS2: [50.0, -29.0],
    HOLD_JN: [38.55, 22.95], HOLD_JS: [39.75, 20.2], HOLD_DN: [50.35, 27.45],
    EUROPE: [10.5, 34.5], ASIA: [80.5, 4.5] // virtual, off-map anchors (drawn as arrows)
  };
  const VIRTUAL = { EUROPE: true, ASIA: true };
  const EDGES = [
    ['PSD','SCN',{maxDraft:20.1,canal:true}],['SCN','SUZ',{maxDraft:20.1,canal:true}],['SUZ','GS1'],['GS1','RS1'],['RS1','AQ1'],['AQ1','AQB_A'],['RS1','RS2'],
    ['RS2','YNB_A'],['RS2','RS3'],['YNB_A','RS3'],['RS3','KAP_A'],['RS3','JED_A'],['KAP_A','JED_A'],['RS3','RS4'],['JED_A','RS4'],['RS3','PSU_A'],['RS4','PSU_A'],
    ['RS4','RS5'],['RS4','HOLD_RS'],['HOLD_RS','RS5'],['RS5','JZN_A'],['RS5','RS6'],['JZN_A','RS6'],['RS6','BAB'],['BAB','GA1'],['DJI_A','GA1'],['GA1','ADN_A'],
    ['GA1','GA2'],['GA2','HOLD_GA'],['HOLD_GA','GUA'],['GA2','GUA'],['GUA','AS1'],['AS1','SLL_A'],['AS1','HOLD_SLL'],['HOLD_SLL','SLL_A'],['HOLD_SLL','AS2'],['AS1','AS2'],['SLL_A','AS2'],
    ['AS2','AS3'],['AS3','GOO'],['GOO','HOR'],['HOR','HOR2'],['HOR2','JEA_A'],['HOR2','AG1'],['JEA_A','AG1'],['AG1','AG2'],['AG2','DMM_A'],['AG2','AG3'],
    ['DMM_A','JUB_A'],['JUB_A','AG3'],['AG3','KWT_A'],['AS3','AS4'],['GOO','AS4'],['AS4','KHI_A'],['AS2','AS5'],['AS4','AS5'],['AS5','MUM_A'],['AS4','MUM_A'],
    ['AS5','AS6'],['AS6','IND_S'],['IND_S','ASIA_GATE'],['AS1','AS5'],['AS1','AS6'],['MUM_A','AS6'],['GUA','SOM1'],['AS1','SOM1'],['SOM1','SOM2'],['SOM2','SOM3'],
    ['SOM3','MOZ1'],['MOZ1','MOZ2'],['MOZ2','SAF1'],['SAF1','SAF2'],['SAF2','AGU'],['AGU','CPT'],['ASIA_GATE','IOS1'],['AS6','IOS1'],['SOM1','IOS1'],['IOS1','IOS2'],['IOS2','SAF1'],
    ['HOLD_JN','RS3'],['HOLD_JN','KAP_A'],['HOLD_JN','YNB_A'],['HOLD_JS','RS4'],['HOLD_JS','JED_A'],['HOLD_DN','AG3'],['HOLD_DN','JUB_A'],['HOLD_DN','DMM_A'],
    ['CPT','EUROPE',{nm:6100,offmap:true}],['PSD','EUROPE',{nm:3250,offmap:true}],['ASIA_GATE','ASIA',{nm:1600,offmap:true}]
  ];

  // Ports — positions approximate; maxDraft/berths/capacity are illustrative reference values for the prototype.
  const PORTS = [
    { id:'JED', ar:'ميناء جدة الإسلامي', en:'Jeddah Islamic Port', country:'SA', p:[39.16,21.47], node:'JED_A', maxDraft:16, berths:62, region:'RS' },
    { id:'KAP', ar:'ميناء الملك عبدالله', en:'King Abdullah Port', country:'SA', p:[39.09,22.52], node:'KAP_A', maxDraft:17, berths:18, region:'RS' },
    { id:'YNB', ar:'ميناء ينبع التجاري', en:'Yanbu Commercial Port', country:'SA', p:[38.06,24.09], node:'YNB_A', maxDraft:14, berths:12, region:'RS' },
    { id:'JZN', ar:'ميناء جازان', en:'Jazan Port', country:'SA', p:[42.55,16.89], node:'JZN_A', maxDraft:12.5, berths:12, region:'RS' },
    { id:'DMM', ar:'ميناء الملك عبدالعزيز بالدمام', en:'King Abdulaziz Port Dammam', country:'SA', p:[50.2,26.5], node:'DMM_A', maxDraft:14, berths:43, region:'AG' },
    { id:'JUB', ar:'ميناء الجبيل التجاري', en:'Jubail Commercial Port', country:'SA', p:[49.68,27.02], node:'JUB_A', maxDraft:14, berths:16, region:'AG' },
    { id:'RTN', ar:'ميناء رأس تنورة', en:'Ras Tanura Port', country:'SA', p:[50.16,26.64], node:'DMM_A', maxDraft:21, berths:10, region:'AG' },
    { id:'PSD', ar:'بورسعيد', en:'Port Said', country:'EG', p:[32.31,31.26], node:'PSD', maxDraft:20.1, berths:30, region:'RS' },
    { id:'AQB', ar:'العقبة', en:'Aqaba', country:'JO', p:[35.0,29.5], node:'AQB_A', maxDraft:16, berths:20, region:'RS' },
    { id:'PSU', ar:'بورتسودان', en:'Port Sudan', country:'SD', p:[37.22,19.6], node:'PSU_A', maxDraft:13, berths:18, region:'RS' },
    { id:'DJI', ar:'جيبوتي', en:'Djibouti', country:'DJ', p:[43.14,11.6], node:'DJI_A', maxDraft:18, berths:16, region:'GA' },
    { id:'ADN', ar:'عدن', en:'Aden', country:'YE', p:[44.98,12.79], node:'ADN_A', maxDraft:15, berths:10, region:'GA' },
    { id:'SLL', ar:'صلالة', en:'Salalah', country:'OM', p:[54.0,16.95], node:'SLL_A', maxDraft:18, berths:16, region:'AS' },
    { id:'JEA', ar:'جبل علي', en:'Jebel Ali', country:'AE', p:[55.03,25.0], node:'JEA_A', maxDraft:17, berths:67, region:'AG' },
    { id:'KHI', ar:'كراتشي', en:'Karachi', country:'PK', p:[66.98,24.8], node:'KHI_A', maxDraft:13.5, berths:30, region:'AS' },
    { id:'MUM', ar:'مومباي (نافا شيفا)', en:'Mumbai (Nhava Sheva)', country:'IN', p:[72.95,18.95], node:'MUM_A', maxDraft:14.5, berths:35, region:'AS' },
    { id:'KWT', ar:'الشويخ – الكويت', en:'Shuwaikh, Kuwait', country:'KW', p:[47.92,29.35], node:'KWT_A', maxDraft:11, berths:21, region:'AG' },
    { id:'EUROPE', ar:'شمال أوروبا (روتردام)', en:'North Europe (Rotterdam)', country:'EU', p:NODES.EUROPE, node:'EUROPE', maxDraft:24, berths:999, virtual:true },
    { id:'ASIA', ar:'شرق آسيا (سنغافورة)', en:'East Asia (Singapore)', country:'SG', p:NODES.ASIA, node:'ASIA', maxDraft:24, berths:999, virtual:true }
  ];

  // Operational profile of Saudi ports (illustrative values for the prototype; port operators update them in the platform).
  // availableBerths / avgBerthHours give the hourly service rate; thresholds are the platform defaults (27 kn gust = suspension limit cited by port operations).
  const PORT_PROFILES = {
    JED: { cargo: ['container', 'bulk', 'roro', 'general'], availableBerths: 14, avgBerthHours: 26, waiting: ['HOLD_JN', 'HOLD_JS'], terminals: ['North Container Terminal', 'South Container Terminal', 'General Cargo'] },
    KAP: { cargo: ['container', 'roro', 'bulk'], availableBerths: 7, avgBerthHours: 24, waiting: ['HOLD_JN'], terminals: ['Container Terminal', 'Ro-Ro Terminal'] },
    YNB: { cargo: ['bulk', 'general', 'roro', 'tanker'], availableBerths: 6, avgBerthHours: 30, waiting: ['HOLD_JN'], terminals: ['Commercial Berths'] },
    JZN: { cargo: ['bulk', 'general', 'container'], availableBerths: 5, avgBerthHours: 30, waiting: ['HOLD_RS'], terminals: ['Commercial Berths'] },
    DMM: { cargo: ['container', 'bulk', 'general', 'roro'], availableBerths: 16, avgBerthHours: 26, waiting: ['HOLD_DN'], terminals: ['Container Terminal 1', 'Container Terminal 2', 'Bulk Terminal'] },
    JUB: { cargo: ['container', 'bulk', 'general', 'tanker'], availableBerths: 8, avgBerthHours: 28, waiting: ['HOLD_DN'], terminals: ['Commercial Port'] },
    RTN: { cargo: ['tanker', 'lng'], availableBerths: 6, avgBerthHours: 30, waiting: ['HOLD_DN'], terminals: ['Crude Terminal'] }
  };
  const DEFAULT_THRESHOLDS = { gustRestrict: 22, gustClose: 27, waveRestrict: 2.0, waveClose: 3.0, visRestrict: 1.0, visClose: 0.5 };
  const LOCAL_RADIUS_NM = 25; // demo boundary of a port's local warning area
  const WAITING_AREAS = {
    HOLD_JN: { ar: 'منطقة انتظار شمال جدة', en: 'North Jeddah waiting area' }, HOLD_JS: { ar: 'منطقة انتظار جنوب جدة', en: 'South Jeddah waiting area' },
    HOLD_DN: { ar: 'منطقة انتظار شمال الدمام', en: 'North Dammam waiting area' }, HOLD_RS: { ar: 'منطقة انتظار جنوب البحر الأحمر', en: 'Southern Red Sea waiting area' },
    HOLD_GA: { ar: 'منطقة انتظار شرق خليج عدن', en: 'Eastern Gulf of Aden waiting area' }, HOLD_SLL: { ar: 'منطقة انتظار قبالة صلالة', en: 'Waiting area off Salalah' }
  };
  // Warning level classification (support for the officer's decision, never final):
  // LOCAL = inside a Saudi port's local warning area; COASTAL = beyond it but within Saudi NAVTEX coverage; INTERNATIONAL = beyond coastal coverage or multi-NAVAREA.
  function classifyWarningLevel(poly) {
    const c = centroid(poly), ext = polyExtentNm(poly);
    const sa = PORTS.filter(p => p.country === 'SA');
    const inLocal = sa.filter(p => gcNm(p.p, c) <= LOCAL_RADIUS_NM + ext / 2);
    const saNavtex = STATIONS.filter(s => s.role === 'NAVTEX' && s.country === 'SA');
    const inCoastal = saNavtex.some(s => poly.every(v => gcNm(s.p, v) <= s.rangeNm));
    const areas = new Set(); for (const v of poly) { const a = navareaOf(v); if (a) areas.add(a.id); }
    const levels = [];
    if (inLocal.length && ext <= 2.5 * LOCAL_RADIUS_NM) levels.push('LOCAL');
    if (inCoastal && (ext > 2 * LOCAL_RADIUS_NM || !inLocal.length)) levels.push('COASTAL');
    if (!inCoastal || areas.size > 1) levels.push('INTERNATIONAL');
    return { levels, ports: inLocal.map(p => p.id), coastalStations: saNavtex.filter(s => gcNm(s.p, c) <= s.rangeNm).map(s => s.id), navareas: [...areas], extentNm: Math.round(ext) };
  }

  // SHA-256 (pure JS) for verification references and the tamper-evident audit chain.
  function sha256(str) {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8');
    const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(bytes); m[l] = 0x80;
    const bits = l * 8; for (let i = 0; i < 8; i++) m[nb - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 255;
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) { const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      h = [h[0] + a, h[1] + b, h[2] + c, h[3] + d, h[4] + e, h[5] + f, h[6] + g, h[7] + hh].map(x => x | 0);
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  // NAVAREA IX limits per Pakistan Navy Hydrographic Dept self-assessment (WWNWS14, 2022): 30-00N 032-00E, 23-48N 068-05E, 12-00N 063-00E, 12-00N 050-45E; joined along coasts here (approximate).
  const NAVAREAS = [
    { id:'IX', coordinator:'KHI_NAV', ar:'المنطقة الملاحية التاسعة', en:'NAVAREA IX',
      poly:[[32,30],[34.9,29.6],[35.5,31.6],[48.5,31.6],[57,28],[61.6,25.5],[68.08,23.8],[63,12],[50.75,12],[43.5,11.3],[42.2,13.1],[38.5,17.5],[36.2,22.5],[33.5,27.5],[32,30]] },
    { id:'VIII', coordinator:'IND_NAV', ar:'المنطقة الملاحية الثامنة', en:'NAVAREA VIII', poly:[[55,12],[63,12],[68.08,23.8],[78,24],[78,-30],[55,-30]] },
    { id:'VII', coordinator:'ZAF_NAV', ar:'المنطقة الملاحية السابعة', en:'NAVAREA VII', poly:[[8,-6],[55,-6],[55,-40],[8,-40]] }
  ];

  // NAVTEX stations in NAVAREA IX as listed by the NAVAREA IX Coordinator (IHO CPRNW10, 2008).
  // B1 identifiers and ranges must be re-verified against current ALRS Vol.5 / IMO GMDSS Master Plan before any operational use.
  const STATIONS = [
    { id:'KHI_NAV', role:'COORDINATOR', navarea:'IX', ar:'منسق المنطقة الملاحية التاسعة – كراتشي (الإدارة الهيدروغرافية للبحرية الباكستانية)', en:'NAVAREA IX Coordinator – Karachi (Pakistan Navy Hydrographic Dept.)', country:'PK', p:[67.03,24.84], b1:'P', rangeNm:250, channel:'sandbox' },
    { id:'H_JED', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس جدة', en:'Jeddah NAVTEX', country:'SA', p:[39.17,21.55], b1:'H', rangeNm:300, channel:'sandbox' },
    { id:'G_DMM', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس الدمام', en:'Dammam NAVTEX', country:'SA', p:[50.1,26.43], b1:'G', rangeNm:300, channel:'sandbox' },
    { id:'M_MCT', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس مسقط', en:'Muscat NAVTEX', country:'OM', p:[58.5,23.6], b1:'M', rangeNm:300, channel:'unconfigured' },
    { id:'B_BAH', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس البحرين (حمالة)', en:'Bahrain (Hamala) NAVTEX', country:'BH', p:[50.47,26.15], b1:'B', rangeNm:300, channel:'unconfigured' },
    { id:'F_BND', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس بندر عباس', en:'Bandar Abbas NAVTEX', country:'IR', p:[56.28,27.18], b1:'F', rangeNm:300, channel:'unconfigured' },
    { id:'A_BUS', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس بوشهر', en:'Bushehr NAVTEX', country:'IR', p:[50.83,28.97], b1:'A', rangeNm:300, channel:'unconfigured' },
    { id:'V_QUS', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس القصير', en:'Quseir NAVTEX', country:'EG', p:[34.27,26.1], b1:'V', rangeNm:300, channel:'unconfigured' },
    { id:'X_ISM', role:'NAVTEX', navarea:'IX', ar:'محطة نافتكس الإسماعيلية', en:'Ismailia NAVTEX', country:'EG', p:[32.27,30.6], b1:'X', rangeNm:300, channel:'unconfigured' },
    { id:'IND_NAV', role:'COORDINATOR', navarea:'VIII', ar:'منسق المنطقة الملاحية الثامنة – الهند', en:'NAVAREA VIII Coordinator – India', country:'IN', p:[72.9,19.0], b1:null, rangeNm:0, channel:'unconfigured' },
    { id:'ZAF_NAV', role:'COORDINATOR', navarea:'VII', ar:'منسق المنطقة الملاحية السابعة – جنوب أفريقيا', en:'NAVAREA VII Coordinator – South Africa', country:'ZA', p:[18.4,-33.9], b1:null, rangeNm:0, channel:'unconfigured' }
  ];

  // Met areas (forecast zones used by the simulated NCM feed and bulletins)
  const MET_AREAS = [
    { id:'NRS', ar:'شمال البحر الأحمر', en:'Northern Red Sea', p:[35.2,26.8], base:{w:14,g:19,d:330,h:1.1,v:9} },
    { id:'CRS', ar:'وسط البحر الأحمر', en:'Central Red Sea', p:[38.2,21.8], base:{w:13,g:18,d:320,h:1.0,v:8} },
    { id:'SRS', ar:'جنوب البحر الأحمر', en:'Southern Red Sea', p:[41.0,16.0], base:{w:15,g:20,d:160,h:1.2,v:7} },
    { id:'BAB', ar:'مضيق باب المندب', en:'Bab el-Mandeb Strait', p:[43.4,12.6], base:{w:16,g:20,d:150,h:1.3,v:7} },
    { id:'GOA', ar:'خليج عدن', en:'Gulf of Aden', p:[47.5,12.5], base:{w:16,g:21,d:90,h:1.5,v:8} },
    { id:'WAS', ar:'غرب بحر العرب', en:'Western Arabian Sea', p:[57,15.5], base:{w:17,g:22,d:60,h:1.8,v:9} },
    { id:'GOO', ar:'بحر عُمان', en:'Gulf of Oman', p:[58.6,24.4], base:{w:12,g:16,d:300,h:0.9,v:8} },
    { id:'HOR', ar:'مضيق هرمز', en:'Strait of Hormuz', p:[56.5,26.4], base:{w:11,g:15,d:310,h:0.7,v:6} },
    { id:'AGN', ar:'الخليج العربي', en:'Arabian Gulf', p:[51.0,27.4], base:{w:14,g:19,d:320,h:1.0,v:7} }
  ];

  // ---------- Graph & routing ----------
  function buildGraph() {
    const adj = {}; for (const id in NODES) adj[id] = [];
    for (const [a, b, o = {}] of EDGES) {
      const nm = o.nm || gcNm(NODES[a], NODES[b]);
      adj[a].push({ to: b, nm, o }); adj[b].push({ to: a, nm, o });
    }
    return adj;
  }
  const GRAPH = buildGraph();
  function edgeBlocked(a, b, o, ctx) {
    if (o.maxDraft && ctx.draft && ctx.draft > o.maxDraft) return 'draft';
    if (o.offmap) return null;
    for (const hz of ctx.hazards || []) if (segmentHitsPoly(NODES[a], NODES[b], hz.poly)) return 'hazard:' + hz.id;
    return null;
  }
  // Dijkstra. ctx: { hazards:[{id,poly}], draft, avoidNodes:Set }
  function shortestPath(from, to, ctx = {}) {
    const dist = { [from]: 0 }, prev = {}, done = new Set();
    const q = [[0, from]];
    while (q.length) {
      q.sort((x, y) => x[0] - y[0]);
      const [d, u] = q.shift();
      if (done.has(u)) continue; done.add(u);
      if (u === to) break;
      for (const e of GRAPH[u]) {
        if (ctx.avoidNodes && ctx.avoidNodes.has(e.to) && e.to !== to) continue;
        if (VIRTUAL[u] && u !== from) continue; // virtual off-map anchors are endpoints only
        if (edgeBlocked(u, e.to, e.o, ctx)) continue;
        const nd = d + e.nm;
        if (nd < (dist[e.to] ?? Infinity)) { dist[e.to] = nd; prev[e.to] = u; q.push([nd, e.to]); }
      }
    }
    if (dist[to] === undefined) return null;
    const nodes = [to]; while (nodes[0] !== from) nodes.unshift(prev[nodes[0]]);
    return { nodes, nm: dist[to] };
  }
  function nodesToCoords(nodes) { return nodes.map(n => NODES[n]); }
  // Distance along node list, honouring fixed off-map lengths.
  function nodesNm(nodes) {
    let s = 0;
    for (let i = 1; i < nodes.length; i++) {
      const e = GRAPH[nodes[i - 1]].find(x => x.to === nodes[i]);
      s += e ? e.nm : gcNm(NODES[nodes[i - 1]], NODES[nodes[i]]);
    }
    return s;
  }
  // For a vessel at position p heading along nodes (nextIdx = index of next node), remaining route
  function remainingRoute(pos, nodes, nextIdx) {
    const rest = nodes.slice(nextIdx);
    return { nodes: rest, coords: [pos].concat(nodesToCoords(rest)), nm: gcNm(pos, NODES[rest[0]]) + nodesNm(rest) };
  }
  // Display polyline: off-map legs are clipped at the map edge.
  function displayCoords(nodes, startPos) {
    const out = startPos ? [startPos] : [];
    for (const n of nodes) out.push(NODES[n]);
    return out;
  }

  function navareaOf(p) { for (const a of NAVAREAS) if (pointInPoly(p, a.poly)) return a; return null; }
  // Station selection: coordinator of the NAVAREA(s) touched + NAVTEX stations whose coverage includes the hazard centroid.
  function selectStations(poly, scope) {
    const c = centroid(poly);
    const areas = new Set();
    for (const v of poly.concat([c])) { const a = navareaOf(v); if (a) areas.add(a.id); }
    const coordinators = STATIONS.filter(s => s.role === 'COORDINATOR' && areas.has(s.navarea));
    const navtex = STATIONS.filter(s => s.role === 'NAVTEX' && gcNm(s.p, c) <= s.rangeNm).sort((a, b) => gcNm(a.p, c) - gcNm(b.p, c));
    const coord = coordinators.find(s => s.navarea === (navareaOf(c) || {}).id) || coordinators[0] || null;
    // LOCAL (coastal) information goes to the nearest NAVTEX station; REGIONAL/GLOBAL to the NAVAREA coordinator.
    const primary = scope === 'LOCAL' ? (navtex[0] || coord) : (coord || navtex[0] || null);
    let list = [];
    if (scope === 'LOCAL') list = navtex.length ? navtex : (primary ? [primary] : []);
    else list = [primary].concat(scope === 'GLOBAL' ? coordinators : []).concat(navtex).filter(Boolean);
    const uniq = []; for (const s of list) if (s && !uniq.find(u => u.id === s.id)) uniq.push(s);
    return { primary, stations: uniq, areas: [...areas], centroid: c };
  }
  function polyExtentNm(poly) {
    let m = 0; for (let i = 0; i < poly.length; i++) for (let j = i + 1; j < poly.length; j++) m = Math.max(m, gcNm(poly[i], poly[j]));
    return m;
  }
  const CHOKEPOINTS = [ { id:'BAB', p:[43.38,12.6] }, { id:'HOR', p:[56.5,26.5] }, { id:'SUEZ', p:[32.5,30.2] } ];
  function classifyScope(poly) {
    const areas = new Set(); for (const v of poly) { const a = navareaOf(v); if (a) areas.add(a.id); }
    const ext = polyExtentNm(poly);
    const choke = CHOKEPOINTS.some(cp => pointInPoly(cp.p, poly) || gcNm(cp.p, centroid(poly)) < 40);
    if (areas.size > 1) return { scope: 'GLOBAL', why: 'multi_navarea' };
    if (choke) return { scope: 'REGIONAL', why: 'chokepoint' };
    if (ext <= 60) return { scope: 'LOCAL', why: 'small_area' };
    return { scope: 'REGIONAL', why: 'wide_area' };
  }

  // Structured message for the competent station (input to their drafting; numbering is assigned by the station).
  function buildStationMessage({ hazard, scope, station, issuedAt }) {
    const typeTxt = { security: 'MARITIME SECURITY THREAT', weather: 'HAZARDOUS WEATHER/SEA STATE', maritime: 'NAVIGATIONAL HAZARD', closure: 'PORT CLOSURE', operational: 'OPERATIONAL RESTRICTION' }[hazard.type] || 'NAVIGATIONAL HAZARD';
    const area = (hazard.areaEn || '').toUpperCase();
    const coords = hazard.poly.map(fmtCoord);
    const dt = d => { const x = new Date(d); return String(x.getUTCDate()).padStart(2, '0') + String(x.getUTCHours()).padStart(2, '0') + String(x.getUTCMinutes()).padStart(2, '0') + 'Z ' + ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][x.getUTCMonth()] + ' ' + String(x.getUTCFullYear()).slice(2); };
    const lines = [
      'FROM: MARSA MARITIME INFORMATION PLATFORM (KSA) – SANDBOX',
      'TO: ' + station.en.toUpperCase(),
      'SUBJ: INFORMATION FOR PROMULGATION – ' + scope + ' – ' + typeTxt,
      'SERIAL: TO BE ASSIGNED BY RECEIVING STATION',
      '',
      dt(issuedAt),
      area + '.',
      '1. ' + typeTxt + ' REPORTED IN AREA BOUNDED BY:',
      ...coords.map((c, i) => '   ' + String.fromCharCode(65 + i) + '. ' + c),
      '2. ' + (hazard.detailEn || '').toUpperCase(),
      '3. VALID ' + dt(hazard.validFrom) + ' TO ' + dt(hazard.validTo) + '.',
      '4. SOURCE: ' + (hazard.sourceEn || '').toUpperCase() + '.',
      '5. MARINERS ADVISED TO REFER TO OFFICIAL MSI. CANCEL THIS MSG ' + dt(hazard.validTo) + '.'
    ];
    return {
      text: lines.join('\n'),
      payload: {
        schema: 'marsa.msi-input/0.1', scope, hazardType: hazard.type, severity: hazard.severity,
        area: hazard.areaEn, polygon: hazard.poly, validFrom: hazard.validFrom, validTo: hazard.validTo,
        source: hazard.sourceEn, simulated: !!hazard.simulated, recipient: station.id
      }
    };
  }

  // ---------- Cost/time model (assumptions are explicit and configurable) ----------
  const ASSUMPTIONS = {
    fuelPriceUSDperT: 620,       // VLSFO assumption — replace with live bunker price feed
    usdToSar: 3.75,
    opexUSDperDay: { container: 32000, tanker: 28000, bulk: 18000, roro: 22000, lng: 60000 },
    waitFuelFactor: 0.12,        // fraction of sea consumption while drifting/at anchor
    truckSARperKm: 6.5,          // per truck, assumption
    teuPerTruck: 2,
    roadKm: { 'DMM-JED': 1340, 'JUB-JED': 1420, 'DMM-KAP': 1300, 'JZN-JED': 720, 'YNB-JED': 330, 'KAP-JED': 120, 'DMM-JZN': 1650 }
  };
  function voyageCost(v, nm, extraWaitH = 0) {
    const hours = nm / v.speedKn + extraWaitH;
    const seaDays = (nm / v.speedKn) / 24;
    const fuelT = seaDays * v.fuelTPD + (extraWaitH / 24) * v.fuelTPD * ASSUMPTIONS.waitFuelFactor;
    const opex = (hours / 24) * (ASSUMPTIONS.opexUSDperDay[v.type] || 25000);
    const usd = fuelT * ASSUMPTIONS.fuelPriceUSDperT + opex;
    return { hours, fuelT, costSAR: usd * ASSUMPTIONS.usdToSar };
  }
  function roadKm(a, b) { return ASSUMPTIONS.roadKm[a + '-' + b] || ASSUMPTIONS.roadKm[b + '-' + a] || null; }

  // Risk score 0..100 for a polyline given context. Returns {score, level, factors[]}
  function scoreRoute(coords, ctx) {
    const f = []; let s = 0;
    let minHz = Infinity, hzId = null;
    for (const hz of ctx.hazards || []) { const d = distPolyToPolyline(hz.poly, coords); if (d < minHz) { minHz = d; hzId = hz.id; } }
    if (minHz === 0) { s += 100; f.push({ k: 'inside_hazard', ref: hzId, pts: 100 }); }
    else if (minHz < 30) { s += 35; f.push({ k: 'hazard_near', nm: Math.round(minHz), ref: hzId, pts: 35 }); }
    else if (minHz < 90) { s += 18; f.push({ k: 'hazard_near', nm: Math.round(minHz), ref: hzId, pts: 18 }); }
    else if (minHz < 180) { s += 8; f.push({ k: 'hazard_near', nm: Math.round(minHz), ref: hzId, pts: 8 }); }
    let wv = 0, wArea = null, gust = 0;
    for (const m of ctx.met || []) {
      let near = Infinity; for (let i = 0; i < coords.length - 1; i++) near = Math.min(near, distPointSegNm(m.p, coords[i], coords[i + 1]));
      if (near < 50) { if (m.waveM > wv) { wv = m.waveM; wArea = m.areaId; } gust = Math.max(gust, m.gustKn); }
    }
    if (wv >= 3) { s += 25; f.push({ k: 'waves', v: wv, ref: wArea, pts: 25 }); } else if (wv >= 2) { s += 12; f.push({ k: 'waves', v: wv, ref: wArea, pts: 12 }); }
    if (gust >= 27) { s += 15; f.push({ k: 'gusts', v: gust, pts: 15 }); }
    if (ctx.destOcc != null) {
      if (ctx.destOcc >= 85) { s += 15; f.push({ k: 'congestion', v: ctx.destOcc, pts: 15 }); }
      else if (ctx.destOcc >= 70) { s += 7; f.push({ k: 'congestion', v: ctx.destOcc, pts: 7 }); }
    }
    if (ctx.draftMargin != null && ctx.draftMargin < 1.5) { s += 10; f.push({ k: 'draft_margin', v: ctx.draftMargin, pts: 10 }); }
    if (ctx.dataAgeMin != null && ctx.dataAgeMin > 180) { s += 8; f.push({ k: 'stale_data', v: ctx.dataAgeMin, pts: 8 }); }
    if (ctx.longHaul) { s += 6; f.push({ k: 'long_exposure', pts: 6 }); }
    s = Math.min(100, s);
    const level = s >= 75 ? 'critical' : s >= 50 ? 'high' : s >= 25 ? 'medium' : 'low';
    return { score: s, level, factors: f, minHazardNm: minHz === Infinity ? null : Math.round(minHz) };
  }

  return {
    gcNm, pointInPoly, segmentHitsPoly, distPolyToPolyline, centroid, circlePoly, polylineLength, pointAlong, bearing, fmtCoord,
    PORT_PROFILES, DEFAULT_THRESHOLDS, LOCAL_RADIUS_NM, WAITING_AREAS, classifyWarningLevel, sha256,
    LAND, SA_COAST, TERRITORIAL_SEA_NM, distToSaudiCoastNm, inSaudiTerritorialSea, SEA_LABELS, NODES, VIRTUAL, EDGES, GRAPH, PORTS, NAVAREAS, STATIONS, MET_AREAS, CHOKEPOINTS, ASSUMPTIONS,
    shortestPath, nodesToCoords, nodesNm, remainingRoute, displayCoords, navareaOf, selectStations, classifyScope,
    buildStationMessage, voyageCost, roadKm, scoreRoute, polyExtentNm
  };
});
