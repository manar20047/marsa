/* MARSA prediction engine — transparent, rule-based prototype (no trained model yet).
 * Inputs: hourly forecasts (wind, gusts, waves, visibility) per port point, port operational data, vessel ETAs.
 * Outputs: an hourly risk/capacity/queue timeline per Saudi port and explainable predictions with
 * category, severity, window, confidence (from the provider's forecast confidence), sources and a recommended action. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.MarsaPredict = factory(root.MarsaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const H = 3600e3;
  const LEVELS = ['normal', 'low', 'moderate', 'high', 'critical'];
  const rank = l => LEVELS.indexOf(l);
  const maxL = (a, b) => rank(a) >= rank(b) ? a : b;
  const tx = (ar, en) => ({ ar, en });
  const r1 = v => Math.round(v * 10) / 10;
  const CAPACITY = { normal: 1, low: 0.9, moderate: 0.75, high: 0.5, critical: 0 };

  // Weather level for one forecast hour against a port's thresholds. Returns level + which drivers crossed what.
  function weatherLevel(f, th) {
    const d = [];
    const lv = (v, restrict, close, inverse) => {
      const over = x => inverse ? v < x : v >= x;
      if (over(inverse ? close : close + (close > 10 ? 5 : 0.5))) return 'critical';
      if (over(close)) return 'high';
      if (over(restrict)) return 'moderate';
      if (inverse ? v < restrict * 1.5 : v >= restrict * 0.8) return 'low';
      return 'normal';
    };
    const g = lv(f.gustKn, th.gustRestrict, th.gustClose), w = lv(f.waveM, th.waveRestrict, th.waveClose), v = lv(f.visNm, th.visRestrict, th.visClose, true);
    if (rank(g) >= 2) d.push('gusts'); if (rank(w) >= 2) d.push('waves'); if (rank(v) >= 2) d.push('visibility');
    return { level: [g, w, v].reduce(maxL), byDriver: { gusts: g, waves: w, visibility: v }, drivers: d };
  }

  // Hourly timeline for one port.
  function portTimeline({ port, forecast, vessels, now, horizonH }) {
    const th = port.thresholds || C.DEFAULT_THRESHOLDS;
    const mu0 = (port.availableBerths || 1) / (port.avgBerthHours || 24); // vessels served per hour at full capacity
    let q = vessels.filter(v => v.destId === port.id && v.status === 'anchored').length;
    const arrivals = new Array(horizonH + 1).fill(0), arrivalsBy = Array.from({ length: horizonH + 1 }, () => []);
    for (const v of vessels) {
      if (v.destId !== port.id || v.etaH == null || v.status !== 'underway') continue;
      const h = Math.floor(v.etaH); if (h >= 0 && h <= horizonH) { arrivals[h]++; arrivalsBy[h].push(v.id); }
    }
    const out = [];
    const opsFactor = port.status === 'closed' ? 0 : port.status === 'restricted' ? 0.6 : 1; // current human decision
    for (let h = 0; h <= horizonH; h++) {
      const f = forecast.series[Math.min(h, forecast.series.length - 1)];
      const wl = weatherLevel(f, th);
      const cap = Math.min(CAPACITY[wl.level], h < 1 ? opsFactor : 1);
      const mu = mu0 * cap;
      const waitIfArrive = mu > 0.01 ? Math.min(96, q / mu) : 96;
      q = Math.max(0, q + arrivals[h] - mu);
      let cong = 'normal';
      const ratio = q / Math.max(1, port.availableBerths);
      if (ratio > 0.6) cong = 'high'; else if (ratio > 0.3) cong = 'moderate'; else if (q >= 1) cong = 'low';
      out.push({ h, t: now + h * H, level: wl.level, drivers: wl.drivers, byDriver: wl.byDriver, capacity: cap, queue: r1(q), congestion: cong, arrivals: arrivals[h], arrivingIds: arrivalsBy[h], waitIfArrive: r1(waitIfArrive),
        gustKn: f.gustKn, windKn: f.windKn, waveM: f.waveM, visNm: f.visNm, rainMm: f.rainMm || 0, conf: f.conf });
    }
    // realistic wait: hours until capacity recovers (≥ 50%), then the queue ahead served at that rate
    for (const x of out) {
      let k = x.h; while (k < out.length && out[k].capacity < 0.5) k++;
      const capR = k < out.length ? out[k].capacity : 1;
      x.waitIfArrive = r1(Math.min(96, (k - x.h) + x.queue / Math.max(0.05, mu0 * capR)));
    }
    return out;
  }

  // Group consecutive hours meeting a predicate into windows.
  function windows(tl, pred) {
    const w = []; let cur = null;
    for (const p of tl) {
      if (pred(p)) { if (!cur) { cur = { from: p.h, to: p.h, pts: [] }; w.push(cur); } cur.to = p.h; cur.pts.push(p); }
      else cur = null;
    }
    return w;
  }
  const confOf = pts => { const v = pts.reduce((s, p) => s + (p.conf || 0.6), 0) / pts.length; return { value: Math.round(v * 100) / 100, level: v >= 0.75 ? 'high' : v >= 0.6 ? 'medium' : 'low' }; };

  const DRV = { gusts: tx('هبّات الرياح', 'wind gusts'), waves: tx('ارتفاع الأمواج', 'wave height'), visibility: tx('انخفاض الرؤية', 'reduced visibility') };
  function predictPort({ port, forecast, vessels, now, horizonH }) {
    const tl = portTimeline({ port, forecast, vessels, now, horizonH });
    const preds = [];
    const name = port.name, poly = C.circlePoly(port.p, C.LOCAL_RADIUS_NM, 20);
    const src = [{ kind: 'forecast', id: forecast.id, provider: forecast.provider, issuedAt: forecast.issuedAt, simulated: forecast.simulated }];
    const th = port.thresholds || C.DEFAULT_THRESHOLDS;
    // Weather hazards per driver
    for (const drv of ['gusts', 'waves', 'visibility']) {
      for (const w of windows(tl, p => rank(p.byDriver[drv]) >= 2)) {
        const sev = w.pts.map(p => p.byDriver[drv]).reduce(maxL);
        const peak = drv === 'visibility' ? w.pts.reduce((a, p) => p.visNm < a.visNm ? p : a) : w.pts.reduce((a, p) => (drv === 'gusts' ? p.gustKn > a.gustKn : p.waveM > a.waveM) ? p : a);
        const val = drv === 'gusts' ? peak.gustKn + ' kn' : drv === 'waves' ? peak.waveM + ' m' : peak.visNm + ' nm';
        const lim = drv === 'gusts' ? th.gustClose + ' kn' : drv === 'waves' ? th.waveClose + ' m' : th.visRestrict + ' nm';
        preds.push({ key: port.id + ':' + drv + ':' + w.from, category: drv === 'gusts' ? 'wind' : drv, severity: sev, portId: port.id, area: tx('مياه ' + name.ar, 'Waters off ' + name.en), poly,
          start: now + w.from * H, end: now + (w.to + 1) * H, peakAt: peak.t, peak: val, confidence: confOf(w.pts), sources: src,
          explanation: tx('تتوقع بيانات الأرصاد ' + DRV[drv].ar + ' تصل إلى ' + val + ' (حد الإيقاف ' + lim + ') بعد ' + w.from + ' ساعة، وتستمر ' + (w.to - w.from + 1) + ' ساعة.', 'Forecast ' + DRV[drv].en + ' reaches ' + val + ' (suspension limit ' + lim + ') in ' + w.from + ' h, lasting ' + (w.to - w.from + 1) + ' h.'),
          action: sev === 'critical' || sev === 'high' ? tx('مراجعة توصية الإغلاق أو التقييد، وتجهيز تحذير محلي للسفن القريبة.', 'Review the closure/restriction recommendation and prepare a local warning for nearby vessels.') : tx('متابعة الحالة وإبلاغ السفن القادمة بالتحوط.', 'Monitor and advise inbound vessels to take precautions.') });
      }
    }
    // Operational disruption / potential closure
    for (const w of windows(tl, p => p.capacity < 1 && rank(p.level) >= 2)) {
      const sev = w.pts.map(p => p.level).reduce(maxL), minCap = Math.min(...w.pts.map(p => p.capacity));
      preds.push({ key: port.id + ':disruption:' + w.from, category: 'port_disruption', severity: sev, portId: port.id, area: tx(name.ar, name.en), poly, start: now + w.from * H, end: now + (w.to + 1) * H, peakAt: w.pts.find(p => p.capacity === minCap).t,
        peak: Math.round((1 - minCap) * 100) + '%', capacityMin: minCap, confidence: confOf(w.pts), sources: src,
        explanation: tx('انخفاض متوقع في الطاقة التشغيلية بنسبة ' + Math.round((1 - minCap) * 100) + '٪ بسبب ' + [...new Set(w.pts.flatMap(p => p.drivers))].map(d => DRV[d].ar).join(' و') + '.', 'Expected operational capacity drop of ' + Math.round((1 - minCap) * 100) + '% due to ' + [...new Set(w.pts.flatMap(p => p.drivers))].map(d => DRV[d].en).join(' and ') + '.'),
        action: tx('إعادة جدولة الترصيف وتوجيه السفن القادمة مبكرًا.', 'Reschedule berthing and redirect inbound vessels early.') });
      if (rank(sev) >= 3) preds.push({ key: port.id + ':closure:' + w.from, category: 'closure', severity: sev, portId: port.id, area: tx(name.ar, name.en), poly, start: now + w.pts.find(p => rank(p.level) >= 3).h * H, end: now + (w.to + 1) * H,
        peakAt: w.pts.find(p => p.capacity === minCap).t, peak: sev === 'critical' ? '0%' : '50%', confidence: confOf(w.pts), sources: src,
        explanation: tx('الظروف المتوقعة تتجاوز حد إيقاف الملاحة؛ احتمال إغلاق الميناء أو تعليق الحركة. هذا تنبؤ وليس قرار إغلاق.', 'Forecast conditions exceed the suspension limit; the port may need to close or suspend traffic. This is a prediction, not a closure decision.'),
        action: tx('عرض توصية الإغلاق على مدير عمليات الميناء لاتخاذ القرار.', 'Present the closure recommendation to the port operations manager for decision.') });
    }
    // Congestion and berth shortage
    for (const w of windows(tl, p => rank(p.congestion) >= 2)) {
      const sev = w.pts.map(p => p.congestion).reduce(maxL), maxQ = Math.max(...w.pts.map(p => p.queue));
      preds.push({ key: port.id + ':congestion:' + w.from, category: 'congestion', severity: sev, portId: port.id, area: tx(name.ar, name.en), poly, start: now + w.from * H, end: now + (w.to + 1) * H,
        peakAt: w.pts.find(p => p.queue === maxQ).t, peak: r1(maxQ) + ' ' + 'vessels', confidence: confOf(w.pts), sources: src.concat([{ kind: 'ais', id: 'ETA', provider: 'AIS', simulated: true }, { kind: 'port', id: port.id, provider: 'port operator' }]),
        explanation: tx('طابور انتظار متوقع حتى ' + r1(maxQ) + ' سفن عند المخطاف: الوصول المجدول يفوق الطاقة المتاحة (' + port.availableBerths + ' أرصفة متاحة).', 'Expected anchorage queue of up to ' + r1(maxQ) + ' vessels: scheduled arrivals exceed available capacity (' + port.availableBerths + ' berths available).'),
        action: tx('توزيع السفن على الموانئ البديلة دون تجاوز ٨٨٪ من طاقتها، أو تعديل مواعيد الوصول.', 'Spread vessels to alternative ports without exceeding 88% of their capacity, or adjust arrival times.') });
    }
    // Vessel delays
    for (const p of tl) for (const vid of p.arrivingIds) {
      if (p.waitIfArrive < 3) continue;
      const sev = p.waitIfArrive >= 24 ? 'critical' : p.waitIfArrive >= 12 ? 'high' : 'moderate';
      preds.push({ key: vid + ':delay', category: 'vessel_delay', severity: sev, portId: port.id, vesselId: vid, area: tx(name.ar, name.en), poly, start: p.t, end: p.t + p.waitIfArrive * H, peakAt: p.t, peak: p.waitIfArrive + ' h',
        confidence: confOf([p]), sources: src.concat([{ kind: 'ais', id: vid, provider: 'AIS', simulated: true }]),
        explanation: tx('تصل السفينة بعد ' + p.h + ' ساعة، والانتظار المتوقع قبل الترصيف ' + p.waitIfArrive + ' ساعة.', 'Vessel arrives in ' + p.h + ' h; expected wait before berthing ' + p.waitIfArrive + ' h.'),
        action: tx('اقتراح خفض السرعة لوصول في الوقت المناسب أو ميناء بديل.', 'Suggest slow steaming for just-in-time arrival, or an alternative port.') });
    }
    return { timeline: tl, predictions: preds };
  }

  // Consequences of continuing / restricting / closing during a window (for the port decision).
  function simulateDecision({ port, timeline, from, to, opexSARperHour = 4500 }) {
    const mu0 = (port.availableBerths || 1) / (port.avgBerthHours || 24);
    const run = mode => {
      let q = timeline[0] ? timeline[0].queue : 0, wait = 0, exposed = 0, maxQ = q;
      for (const p of timeline) {
        const inW = p.h >= from && p.h <= to;
        const cap = inW ? (mode === 'close' ? 0 : mode === 'restrict' ? Math.min(0.5, p.capacity) : p.capacity) : p.capacity;
        if (inW && mode !== 'close') exposed += p.arrivals * (mode === 'restrict' ? 0.5 : 1);
        q = Math.max(0, q + p.arrivals - mu0 * cap); wait += q; maxQ = Math.max(maxQ, q);
      }
      const risk = mode === 'close' ? 'low' : mode === 'restrict' ? (exposed > 0 ? 'moderate' : 'low') : (exposed > 0 ? (timeline.slice(from, to + 1).some(p => rank(p.level) >= 4) ? 'critical' : 'high') : 'moderate');
      return { mode, vesselsExposed: r1(exposed), waitHours: Math.round(wait), maxQueue: r1(maxQ), delayCostSAR: Math.round(wait * opexSARperHour), safetyRisk: risk };
    };
    return { continue: run('continue'), restrict: run('restrict'), close: run('close') };
  }

  return { LEVELS, rank, maxL, weatherLevel, portTimeline, predictPort, simulateDecision, CAPACITY };
});
