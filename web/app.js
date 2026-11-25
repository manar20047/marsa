/* MARSA web app v4 — Port Officer and Ship Bridge on a shared TEST DATA environment. */
(function () {
  'use strict';
  const C = window.MarsaCore, I = window.I18N, X = window.MarsaExport;
  const T = (ar, en) => I.lang === 'ar' ? ar : en;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = o => o ? (o[I.lang] || o.en || o.ar || '') : '';
  const N = (v, d = 0) => v == null || isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const loc = () => I.lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';
  const fT = ts => ts ? new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' }).format(ts) : '—';
  const fH = ts => ts ? new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' }).format(ts) : '—';
  const fTs = ts => ts ? new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' }).format(ts) : '—';
  const fD = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(ts);
  const H = 3600e3;
  const rel = ts => { if (!ts) return '—'; const s = Math.round((S().now - ts) / 1000), a = Math.abs(s); const v = a < 60 ? a + T(' ث', 's') : a < 3600 ? Math.round(a / 60) + T(' د', 'm') : a < 86400 ? N(a / 3600, a < 36000 ? 1 : 0) + T(' س', 'h') : N(a / 86400, 1) + T(' يوم', 'd'); return s >= 0 ? T('منذ ' + v, v + ' ago') : T('بعد ' + v, 'in ' + v); };
  const B = (cls, txt) => '<span class="b b-' + cls + '">' + esc(txt) + '</span>';
  const TAG = txt => '<span class="tdtag">' + esc(txt) + '</span>';
  const ll = p => p ? N(Math.abs(p[1]), 2) + '°' + (p[1] >= 0 ? 'N' : 'S') + ' ' + N(Math.abs(p[0]), 2) + '°' + (p[0] >= 0 ? 'E' : 'W') : '—';
  const dirTxt = d => d == null ? '' : T(['ش', 'ش ق', 'ق', 'ج ق', 'ج', 'ج غ', 'غ', 'ش غ'], ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[Math.round(((d % 360) + 360) % 360 / 45) % 8];
  const toLocalInput = ts => new Date(ts - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  // ---------- Vocabulary ----------
  const LV = { none: ['لا يوجد', 'None'], low: ['منخفض', 'Low'], medium: ['متوسط', 'Medium'], high: ['مرتفع', 'High'], critical: ['حرج', 'Critical'] };
  const lv = l => T(...(LV[l] || [l, l]));
  const lvB = l => B('lv-' + (l === 'medium' ? 'moderate' : l), lv(l));
  const RANK = l => ['none', 'low', 'medium', 'high', 'critical'].indexOf(l);
  const RTYPE = { strong_winds: ['رياح شديدة', 'Strong winds'], high_waves: ['أمواج عالية', 'High waves'], reduced_visibility: ['انخفاض الرؤية', 'Reduced visibility'], strong_currents: ['تيارات قوية', 'Strong currents'], navigation_hazard: ['خطر ملاحي', 'Navigation hazard'], operational: ['قيود تشغيلية', 'Operational restriction'], port_closure: ['إغلاق ميناء', 'Port closure'], port_restriction: ['قيود على ميناء', 'Port restriction'], security: ['تهديد أمني', 'Security threat'], other: ['خطر آخر', 'Other hazard'] };
  const rtype = k => T(...(RTYPE[k] || [k, k]));
  const RSRC = { rules: ['محسوب من قواعد التحليل', 'Computed by analysis rules'], record: ['سجل خطر في بيانات الاختبار', 'Risk record in test data'], manual: ['مُدخل يدويًا', 'Entered manually'], port: ['من حالة الميناء', 'From port status'] };
  const REL = { inside: ['داخل المنطقة الآن', 'Inside now'], entering: ['يدخل المنطقة خلال ٤٨ ساعة', 'Enters within 48 h'], crossing: ['مساره يتقاطع (خارج فترة الخطر)', 'Route crosses (outside risk window)'] };
  const AST = { draft: ['مسودة', 'Draft'], pending_approval: ['بانتظار الاعتماد', 'Pending Approval'], approved: ['معتمد', 'Approved'], ready_for_dispatch: ['جاهز للإرسال', 'Ready for Dispatch'], dispatched_test: ['أُرسل في بيئة الاختبار', 'Dispatched in Test Environment'], received: ['تم الاستلام', 'Received'], acknowledged: ['تم التأكيد', 'Acknowledged'], expired: ['منتهي', 'Expired'], cancelled: ['ملغى', 'Cancelled'] };
  const ASTC = { draft: 'muted', pending_approval: 'warn', approved: 'info', ready_for_dispatch: 'info', dispatched_test: 'info', received: 'warn', acknowledged: 'ok', expired: 'muted', cancelled: 'muted' };
  const astB = s => B(ASTC[s] || 'muted', T(...(AST[s] || [s, s])));
  const FLOW = ['draft', 'pending_approval', 'approved', 'ready_for_dispatch', 'dispatched_test', 'received', 'acknowledged', 'expired'];
  const DST = { queued: ['بانتظار الإرسال', 'Queued'], dispatched: ['أُرسل (اختبار)', 'Dispatched (test)'], received: ['تم الاستلام', 'Received'], acknowledged: ['تم التأكيد', 'Acknowledged'], failed: ['تعذر الإرسال', 'Failed'], held_outside_ts: ['محجوز – خارج المياه الإقليمية', 'Held – outside territorial waters'] };
  const DSTC = { held_outside_ts: 'warn', queued: 'muted', dispatched: 'info', received: 'warn', acknowledged: 'ok', failed: 'crit' };
  const dstB = d => B(DSTC[d.status] || 'muted', T(...(DST[d.status] || [d.status, d.status])));
  const CH = { test_bridge_screen: ['شاشة جسر السفينة (اختبار)', 'Ship Bridge screen (test)'], test_vhf_broadcast: ['بث VHF محلي (اختبار – بلا تأكيد آلي)', 'Local VHF broadcast (test – no automatic confirmation)'], test_ais_message: ['رسالة AIS (اختبار – بلا تأكيد)', 'AIS message (test – no confirmation)'], none: ['لا توجد قناة', 'No channel'] };
  const BTYPE = { weather_bulletin: ['نشرة جوية بحرية', 'Marine weather bulletin'], wind_wave_warning: ['تحذير رياح وأمواج', 'Wind & wave warning'], port_closure: ['إغلاق تشغيلي لميناء', 'Port operational closure'], nav_restriction: ['قيد ملاحي', 'Navigational restriction'] };
  const SCOPE = { LOCAL: ['تحذير محلي (Local)', 'Local warning'], COASTAL: ['تحذير ساحلي (Coastal)', 'Coastal warning'], SUBAREA: ['تحذير منطقة فرعية (Sub-area)', 'Sub-area warning'], NAVAREA: ['تحذير NAVAREA', 'NAVAREA warning'], INTERNATIONAL: ['تحذير NAVAREA', 'NAVAREA warning'] };
  const PRIO = { routine: ['اعتيادي', 'Routine'], important: ['مهم', 'Important'], urgent: ['عاجل', 'Urgent'] };
  const VST = { underway: ['مبحرة', 'Underway'], anchored: ['راسية', 'At anchor'], moored: ['على الرصيف', 'Moored'] };
  const VTYPE = { container: ['حاويات', 'Container'], tanker: ['ناقلة', 'Tanker'], bulk: ['بضائع سائبة', 'Bulk'], general: ['بضائع عامة', 'General cargo'], roro: ['دحرجة', 'Ro-Ro'], lng: ['غاز مسال', 'LNG'] };
  const vtype = s => T(...(VTYPE[s] || [s, s]));
  const PST = { open: ['يعمل', 'Open'], restricted: ['مقيّد', 'Restricted'], closed: ['مغلق', 'Closed'] };
  const pstB = s => B({ open: 'ok', restricted: 'warn', closed: 'crit' }[s], T(...PST[s]));
  const SUBJ = { A: ['A – تحذير ملاحي', 'A – Navigational warning'], B: ['B – تحذير أرصاد', 'B – Meteorological warning'], E: ['E – توقعات أرصاد', 'E – Meteorological forecast'], L: ['L – تحذير ملاحي إضافي', 'L – Additional navigational warning'] };
  const IND = { windKn: ['سرعة الرياح', 'Wind'], waveM: ['ارتفاع الموج', 'Wave height'], visNm: ['الرؤية', 'Visibility'], currentKn: ['التيار', 'Current'] };

  const LOGO = '<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#0b2545"/><path d="M20 7v22M13 12h14M10 22c1.5 6 6 9 10 9s8.5-3 10-9" stroke="#2ec4b6" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="20" cy="9" r="2.6" fill="#fff"/><path d="M7 30c3 0 3-2 6.5-2S17 30 20 30s3.5-2 6.5-2 3.5 2 6.5 2" stroke="#7fb3d5" stroke-width="1.6" fill="none"/></svg>';
  const SHIP_ICON = '<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M14 62h68l-8 16H22z" fill="#2ec4b6"/><path d="M26 62V44h44v18" fill="none" stroke="#fff" stroke-width="4"/><path d="M36 44V32h24v12" fill="none" stroke="#fff" stroke-width="4"/><path d="M42 32v-8h12v8" fill="#fff"/><circle cx="38" cy="53" r="2.6" fill="#fff"/><circle cx="48" cy="53" r="2.6" fill="#fff"/><circle cx="58" cy="53" r="2.6" fill="#fff"/><path d="M8 86c6 0 6-4 13-4s7 4 13.5 4 7-4 13.5-4 7 4 13.5 4 7-4 13.5-4 6.5 4 12.5 4" stroke="#7fb3d5" stroke-width="3" fill="none"/></svg>';
  const OFFICER_ICON = '<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 10 18 22v22c0 20 13 34 30 40 17-6 30-20 30-40V22z" fill="none" stroke="#2ec4b6" stroke-width="4"/><circle cx="48" cy="42" r="14" fill="none" stroke="#fff" stroke-width="3.5"/><path d="M48 28v28M34 42h28" stroke="#fff" stroke-width="2.4"/><path d="M48 42l9-6" stroke="#2ec4b6" stroke-width="3.5" stroke-linecap="round"/><path d="M30 70c5-6 11-8 18-8s13 2 18 8" stroke="#7fb3d5" stroke-width="3" fill="none"/></svg>';
  const ic = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  const I_HOME = 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10', I_SOUND = 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14';
  const NAVI = { map: 'M9 3 3 5.5V21l6-2.5 6 2.5 6-2.5V3l-6 2.5zm0 0v15.5m6-13V21', risks: 'M3 17l5-6 4 3 5-7 4 4M3 21h18', alerts: 'M12 2 2 20h20zM12 9v5m0 3v.5', bulletins: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5', routes: 'M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm14-12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 15V9a4 4 0 0 1 4-4h6m4 4v6a4 4 0 0 1-4 4H9', data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', integrations: 'M8 7h8M8 17h8M4 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0zm12 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM4 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zm12 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM6 9v6m12-6v6', audit: 'M4 4h16v4H4zm1 4v12h14V8M9 12h6' };

  // ---------- Client ----------
  function localClient() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('marsa.db.v5') || 'null'); } catch (e) { saved = null; }
    const store = new MarsaService.MemoryStore(saved || undefined);
    let svc;
    try { svc = MarsaService.createService({ store }); svc.snapshot(store.get('users', 'OFFICER')); } catch (e) { store.clear(); svc = MarsaService.createService({ store }); }
    let user = null, subs = [], lastSaved = 0, dirty = false;
    svc.onChange(() => { dirty = true; });
    const persist = () => { if (!dirty || Date.now() - lastSaved < 2000) return; try { localStorage.setItem('marsa.db.v5', JSON.stringify(store.dump())); lastSaved = Date.now(); dirty = false; } catch (e) { /* keep in memory */ } };
    const fresh = () => user && store.get('users', user.id);
    const emit = () => { const u = fresh(); if (u) { const s = svc.snapshot(u); subs.forEach(f => f(s)); } };
    setInterval(() => { try { svc.tick(); } catch (e) { console.error(e); } emit(); persist(); }, 1000);
    return {
      mode: 'local',
      async enter(id) { const r = store.get('users', id); if (!r) throw new Error('NO_USER'); user = r; svc.recordLogin(r); return svc.snapshot(r); },
      leave() { user = null; },
      async bridges() { return store.all('vessels').map(v => ({ userId: 'B-' + v.id, id: v.id, name: v.name, mmsi: v.mmsi, type: v.type, status: v.status, destId: v.destId, channel: v.channel })); },
      async call(m, a) { if (typeof svc[m] !== 'function') throw new Error('UNKNOWN'); const res = svc[m](fresh(), a || {}); emit(); return res; },
      subscribe(f) { subs.push(f); }
    };
  }
  function serverClient() {
    let token = null, subs = [], timer = null;
    const req = async (path, body) => { const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP_' + r.status); return j; };
    const poll = async () => { try { const s = await req('/api/snapshot'); subs.forEach(f => f(s)); } catch (e) { /* keep last state */ } };
    return {
      mode: 'server',
      async enter(id) { const j = await req('/api/demo-login', { userId: id }); token = j.token; clearInterval(timer); timer = setInterval(poll, 1500); return j.snapshot; },
      leave() { if (token) req('/api/logout', {}).catch(() => {}); token = null; clearInterval(timer); },
      async bridges() { return (await req('/api/bridges')).vessels; },
      async call(m, a) { const j = await req('/api/rpc/' + m, a || {}); poll(); return j.result; },
      subscribe(f) { subs.push(f); }
    };
  }
  const client = window.MARSA_SERVER ? serverClient() : localClient();

  // ---------- State ----------
  const state = { snap: null, view: 'home', sec: 'map', sel: {}, f: { region: '', vtype: '', risk: '' }, maps: {}, seenDeliv: null, sentReceived: new Set(), verify: null, dataTab: 'vessels', intTab: 'ncm' };
  try { const l = localStorage.getItem('marsa.lang'); if (l === 'en' || l === 'ar') I.lang = l; } catch (e) { /* ignore */ }
  const S = () => state.snap;
  const port = id => S().ports.find(p => p.id === id);
  const pname = id => { const p = port(id); if (p) return L(p.name); const c = C.PORTS.find(x => x.id === id); return c ? T(c.ar, c.en) : id || '—'; };
  const vessel = id => S().vessels.find(v => v.id === id);
  const vname = id => (vessel(id) || {}).name || id;
  const risk = id => (S().maritimeRisks || []).find(r => r.id === id);
  const alertById = id => S().alerts.find(a => a.id === id);
  const src = id => (S().dataSources || []).find(d => d.id === id) || {};

  function toast(msg, kind) { const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg; ($('#toasts') || document.body).appendChild(el); setTimeout(() => el.classList.add('out'), 3800); setTimeout(() => el.remove(), 4300); }
  const ERR = { disclaimer_required: ['يجب الإقرار ببيان المسؤولية أولًا', 'Please acknowledge the responsibility statement first'], state: ['لا يمكن تنفيذ الإجراء في الحالة الحالية', 'Not allowed in the current state'], officer: ['أدخل اسم الضابط', 'Enter the officer name'], title: ['العنوان والنص بالعربية والإنجليزية مطلوبان', 'Title and text in Arabic and English are required'], body: ['النص بالعربية والإنجليزية مطلوب', 'Text in Arabic and English is required'], targets: ['اختر سفينة واحدة على الأقل', 'Select at least one vessel'], position: ['الإحداثيات خارج نطاق السواحل السعودية', 'Coordinates outside the Saudi coastal range'], validity: ['فترة الصلاحية غير صحيحة', 'Invalid validity period'], outside_territorial_sea: ['منطقة الإنذار لا تصل إلى المياه الإقليمية السعودية (١٢ ميلًا): لا يُرسل مباشرة، ويُنشر تحذيرًا ساحليًا عبر NAVTEX/EGC من الجهة المختصة', 'Alert area does not reach Saudi territorial waters (12 nm): no direct alert; promulgate as a coastal warning via NAVTEX/EGC by the competent authority'], outside_kingdom_waters: ['المنطقة خارج المناطق البحرية للمملكة: يلزم تحذير NAVAREA عبر منسق المنطقة التاسعة', 'Area outside the Kingdom\'s maritime areas: a NAVAREA warning via the NAVAREA IX coordinator is required'] };
  async function act(m, a, okMsg) {
    try { const r = await client.call(m, a); if (okMsg !== false) toast(okMsg || T('تم', 'Done'), 'ok'); return r || true; }
    catch (e) { const msg = String(e.message || e), k = msg.split(':')[1]; toast(msg.startsWith('FORBIDDEN') ? T('غير مسموح', 'Not permitted') : ERR[k] ? T(...ERR[k]) : T('خطأ: ', 'Error: ') + msg.replace('INVALID:', ''), 'bad'); return null; }
  }
  function modal(html, cls) { closeModal(); const w = document.createElement('div'); w.className = 'modal-wrap'; w.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>'; w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-x]')) closeModal(); }); document.body.appendChild(w); return w.querySelector('.modal'); }
  function closeModal() { $$('.modal-wrap').forEach(x => x.remove()); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('.modal-wrap')) closeModal(); });
  const val = (root, n) => { const el = root.querySelector('[name="' + n + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : null; };
  const discBlock = () => '<div class="discbox"><div class="disc compact"><b>' + T('بيان المسؤولية', 'Responsibility statement') + '</b><p>' + esc(L(S().disclaimer)) + '</p></div><label class="chk"><input type="checkbox" name="disc"><span>' + T('اطلعت على بيان المسؤولية وأعتمد هذا الإجراء في بيئة الاختبار', 'I have read the statement and approve this action in the test environment') + '</span></label></div>';
  const discOk = f => { if (f.querySelector('[name=disc]').checked) return true; toast(T(...ERR.disclaimer_required), 'bad'); return false; };
  const prevHtml = new WeakMap();
  function fill(sel, html) { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) return; if (prevHtml.get(el) !== html) { el.innerHTML = html; prevHtml.set(el, html); } }
  const tbl = (cols, rows, cls) => '<div class="scroll"><table class="tbl stack ' + (cls || '') + '"><thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  const tr = (cells, attrs) => '<tr' + (attrs || '') + '>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
  const empty = txt => '<p class="muted empty">' + esc(txt) + '</p>';
  const field = (label, inner) => '<label>' + label + inner + '</label>';
  const opts = (list, sel) => list.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
  async function download(name, text, type) { try { await X.save(name, new Blob([text], { type: type || 'text/plain;charset=utf-8' })); toast(T('تم التصدير: ', 'Exported: ') + name, 'ok'); } catch (e) { toast(T('التنزيل غير متاح هنا', 'Download unavailable here'), 'bad'); } }

  // ---------- Sound (bell rendered to WAV; unlocked on first tap) ----------
  const Sound = (() => {
    let on = true; try { on = localStorage.getItem('marsa.sound') !== '0'; } catch (e) { /* ignore */ }
    const RING_S = 5, BELL_F = 440, GAP = .62, SR = 22050;
    let audio = null, unlocked = false, repeatT = null;
    function bellWav() {
      const n = Math.floor(RING_S * SR), buf = new Float32Array(n), parts = [[1, 1, 3.2], [1.004, .7, 3.0], [.5, .45, 3.6], [2.0, .5, 2.2], [2.76, .35, 1.6], [3.0, .2, 1.2], [5.4, .12, .7]];
      for (let k = 0; k * GAP < RING_S - 1; k++) { const t0 = Math.floor(k * GAP * SR); for (const [m, a, d] of parts) { const w = 2 * Math.PI * BELL_F * m / SR, len = Math.min(n - t0, Math.floor(d * SR)), att = Math.floor(.006 * SR), dec = Math.log(1e-4) / (len - att); for (let i = 0; i < len; i++) buf[t0 + i] += a * (i < att ? i / att : Math.exp(dec * (i - att))) * Math.sin(w * i); } }
      let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
      const g = .97 / (peak || 1), dv = new DataView(new ArrayBuffer(44 + n * 2)), st = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
      st(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); st(8, 'WAVE'); st(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); st(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) { const v = Math.tanh(buf[i] * g * 1.4) / Math.tanh(1.4); dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true); }
      return URL.createObjectURL(new Blob([dv.buffer], { type: 'audio/wav' }));
    }
    try { audio = new Audio(bellWav()); audio.preload = 'auto'; audio.setAttribute('playsinline', ''); } catch (e) { audio = null; }
    function unlock() { if (unlocked || !audio) return; audio.muted = true; const p = audio.play(); if (p && p.then) p.then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; unlocked = true; if (state.view === 'bridge') update(); }).catch(() => { audio.muted = false; }); }
    function ring(force) { if (!on && !force) return; unlock(); if (audio) { try { audio.muted = false; audio.volume = 1; audio.currentTime = 0; const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* blocked */ } } }
    return {
      get on() { return on; }, get unlocked() { return unlocked || !audio; }, ring, unlock,
      toggle() { on = !on; try { localStorage.setItem('marsa.sound', on ? '1' : '0'); } catch (e) { /* ignore */ } if (on) ring(true); else this.stopRepeat(); },
      repeat() { clearInterval(repeatT); repeatT = setInterval(() => ring(), 12000); },
      stopRepeat() { clearInterval(repeatT); if (audio) audio.pause(); }
    };
  })();
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true });

  // ---------- Actions ----------
  const A = {};
  document.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; const f = A[b.dataset.a]; if (f) { e.preventDefault(); f(b.dataset, b); } });
  document.addEventListener('change', e => { const el = e.target.closest('[data-f]'); if (!el || !S()) return; state.f[el.dataset.f] = el.value; update(); });
  A.home = () => goHome();
  A.lang = () => { I.lang = I.lang === 'ar' ? 'en' : 'ar'; try { localStorage.setItem('marsa.lang', I.lang); } catch (e) { /* ignore */ } applyLang(); if (state.view === 'home') renderHome(); else renderView(); };
  A.sound = () => { Sound.toggle(); renderView(); };
  function applyLang() { document.documentElement.lang = I.lang; document.documentElement.dir = I.lang === 'ar' ? 'rtl' : 'ltr'; document.title = 'MARSA · مَرسى'; for (const k in state.maps) state.maps[k].setLang(I.lang); }
  const envBadge = () => '<span class="envbadge" title="' + esc(T('البيانات المعروضة بيانات اختبار تجريبية وليست بيانات حية أو رسمية', 'Data shown is test data, not live or official data')) + '"><span class="f">TEST DATA ENVIRONMENT</span><span class="s">TEST DATA</span></span>';

  // ---------- Home ----------
  function goHome() { client.leave(); state.snap = null; state.view = 'home'; state.seenDeliv = null; Sound.stopRepeat(); for (const k in state.maps) state.maps[k].destroy(); state.maps = {}; renderHome(); }
  function renderHome() {
    applyLang();
    document.getElementById('app').innerHTML = '<div class="home"><header class="home-top">' + LOGO + '<div><b>MARSA · ' + T('مَرسى', 'Marsa') + '</b><span>' + T('نظام تجريبي لإدارة المخاطر والإنذارات البحرية في السواحل السعودية', 'Prototype for maritime risk and alert management on Saudi coasts') + '</span></div><div class="grow"></div>' + envBadge() + '<button class="btn ghost light sm" data-a="lang">' + T('English', 'العربية') + '</button></header>' +
      '<main class="home-main"><h1>' + T('اختر الواجهة', 'Choose an interface') + '</h1><div class="home-cards">' +
      '<button class="hcard" data-a="enterBridge">' + SHIP_ICON + '<b>' + T('جسر السفينة', 'Ship Bridge') + '</b><span>' + T('استقبال إنذارات مَرسى وتفاصيل الخطر والمسار البديل وتأكيد الاستلام', 'Receive MARSA alerts, hazard details and alternative routes, and confirm receipt') + '</span></button>' +
      '<button class="hcard" data-a="enterOfficer">' + OFFICER_ICON + '<b>' + T('ضابط الميناء', 'Port Officer') + '</b><span>' + T('حركة السفن، تحليل المخاطر ٤٨ ساعة، الإنذارات، النشرات، حالة الموانئ والمسارات البديلة', 'Vessel traffic, 48 h risk analysis, alerts, bulletins, port status and alternative routes') + '</span></button>' +
      '</div></main></div><div id="toasts"></div>';
  }
  A.enterOfficer = async () => { try { const s = await client.enter('OFFICER'); state.view = 'officer'; state.snap = s; renderView(); } catch (e) { toast(String(e.message || e), 'bad'); } };
  A.enterBridge = async () => {
    const list = await client.bridges();
    const m = modal('<h3>' + T('اختر السفينة', 'Choose the vessel') + '</h3><input class="vsearch" placeholder="' + T('بحث بالاسم أو MMSI', 'Search name or MMSI') + '"><ul class="vpick">' +
      list.map(v => '<li data-n="' + esc((v.name + ' ' + v.mmsi).toLowerCase()) + '"><button data-a="pickBridge" data-id="' + esc(v.userId) + '"><b>' + esc(v.name) + '</b><span>MMSI ' + esc(v.mmsi) + ' · ' + vtype(v.type) + ' → ' + esc(C.PORTS.find(p => p.id === v.destId) ? T(C.PORTS.find(p => p.id === v.destId).ar, C.PORTS.find(p => p.id === v.destId).en) : v.destId) + '</span></button></li>').join('') + '</ul>', 'wide');
    $('.vsearch', m).oninput = e => { const q = e.target.value.toLowerCase(); $$('.vpick li', m).forEach(li => { li.hidden = !!q && !li.dataset.n.includes(q); }); };
  };
  A.pickBridge = async d => { closeModal(); try { const s = await client.enter(d.id); state.view = 'bridge'; state.snap = s; state.seenDeliv = null; renderView(); } catch (e) { toast(String(e.message || e), 'bad'); } };

  // ---------- Shell ----------
  const SECS = () => [['map', 'الخريطة وحركة السفن', 'Map & vessel traffic'], ['risks', 'تحليل المخاطر ٤٨ ساعة', '48 h risk analysis'], ['alerts', 'الإنذارات', 'Alerts'], ['bulletins', 'النشرات وNAVTEX', 'Bulletins & NAVTEX'], ['routes', 'المسارات البديلة', 'Alternative routes'], ['data', 'بيانات الاختبار', 'Test data'], ['integrations', 'التكاملات المقترحة', 'Proposed integrations'], ['audit', 'سجل العمليات', 'Operations log']];
  function header(title, sub, extra) {
    return '<header class="top v3"><button class="btn ghost light sm homebtn" data-a="home">' + ic(I_HOME) + '<span>' + T('الرئيسية', 'Home') + '</span></button>' + LOGO + '<div class="ttl"><b>' + esc(title) + '</b><span>' + sub + '</span></div><div class="grow"></div>' + envBadge() + '<div class="clock" id="clock"></div>' + (extra || '') + '<button class="btn ghost light sm" data-a="lang">' + T('English', 'العربية') + '</button></header>';
  }
  function renderView() {
    applyLang(); for (const k in state.maps) state.maps[k].destroy(); state.maps = {};
    if (state.view === 'officer') {
      document.getElementById('app').innerHTML = header(T('ضابط الميناء', 'Port Officer'), T('بيئة بيانات اختبار مشتركة', 'Shared test-data environment')) +
        '<div class="olay"><nav class="oside">' + SECS().map(([k, ar, en]) => '<button class="' + (state.sec === k ? 'on' : '') + '" data-a="sec" data-id="' + k + '">' + ic(NAVI[k]) + '<span>' + T(ar, en) + '</span><i data-c="' + k + '"></i></button>').join('') + '</nav><main id="main" class="omain"></main></div><div id="toasts"></div>';
      $('#main').innerHTML = OFF[state.sec].mount(); if (OFF[state.sec].bind) OFF[state.sec].bind($('#main'));
    } else {
      const v = S().vessels[0] || {};
      document.getElementById('app').innerHTML = header(T('جسر السفينة', 'Ship Bridge') + ' · ' + (v.name || ''), 'MMSI ' + esc(v.mmsi || '—') + ' · ' + esc(v.imo || ''), '<button class="btn ghost light sm" id="soundbtn" data-a="sound">' + ic(I_SOUND) + '<span>' + (Sound.on ? T('الصوت مفعّل', 'Sound on') : T('الصوت متوقف', 'Sound off')) + '</span></button><button class="btn sm" data-a="testAlarm">' + T('اختبار الإنذار', 'Test alarm') + '</button>') + '<main id="main" class="v3main bridge">' + BR.mount() + '</main><div id="toasts"></div>';
    }
    update();
  }
  A.sec = d => { state.sec = d.id; renderView(); };
  function update() {
    const s = S(); if (!s) return;
    fill('#clock', '<b>' + fTs(s.now) + '</b><span>' + fD(s.now) + ' · ' + T('توقيت السعودية', 'KSA') + '</span>');
    if (state.view === 'officer') {
      const cnt = { risks: s.maritimeRisks.filter(r => RANK(r.level) >= 3 && r.end > s.now).length, alerts: s.alerts.filter(a => ['draft', 'pending_approval', 'approved', 'ready_for_dispatch'].includes(a.status)).length, routes: s.alternativeRoutes.length };
      $$('.oside i[data-c]').forEach(el => { const n = cnt[el.dataset.c]; el.textContent = n ? String(n) : ''; });
      OFF[state.sec].upd($('#main'));
    } else BR.upd($('#main'));
  }

  // ---------- Map helpers ----------
  function ensureMap(key, el, opts) {
    let m = state.maps[key]; if (m && m.el !== el) { m.destroy(); m = null; }
    if (!m) { m = new SeaMap(el, Object.assign({ lang: I.lang, onSelect: (t, id) => onMapSelect(t, id), layers: { stations: false, navarea: false, lanes: true } }, opts)); state.maps[key] = m; }
    return m;
  }
  function onMapSelect(type, id) {
    if (state.view !== 'officer') return;
    if (type === 'vessel') { state.sel.vessel = id; if (state.sec !== 'map') { state.sec = 'map'; renderView(); } else update(); }
    if (type === 'risk') { state.sel.risk = id; if (state.sec !== 'risks') { state.sec = 'risks'; renderView(); } else update(); }
  }
  const riskZones = list => list.map(r => ({ poly: r.poly, cls: 'rk-' + r.level, label: r.title, sel: 'risk:' + r.id }));
  const constraintZones = () => (S().constraints || []).map(k => ({ poly: k.poly, cls: k.kind === 'restricted' ? 'nc-restricted' : 'nc-shallow', label: k.name }));
  const affectedSet = () => new Set((S().affectedVessels || []).filter(a => a.relation !== 'crossing' && RANK((risk(a.riskId) || {}).level) >= 3).map(a => a.vesselId));
  const mapV = (v, extra) => Object.assign({ status: v.status === 'underway' ? 'underway' : 'anchored' }, v, { speedKn: v.sog }, extra || {});
  function baseMap(extra = {}) {
    const s = S(), aff = affectedSet();
    return Object.assign({ ports: s.ports.map(p => Object.assign({ saudi: true }, p)), stations: [], hazards: [], zones: [], vessels: s.vessels.map(v => mapV(v, { affected: aff.has(v.id) })), routes: [] }, extra);
  }
  const ALT_C = '#1f8ef1', CUR_C = '#8a96a8';
  function altRoutes(ar) {
    const out = [{ kind: 'current', start: ar.current.coords[0], nodes: ar.current.nodes, color: CUR_C, label: T('المسار الحالي', 'Current route') }];
    const a = ar.alternative; if (!a) return out;
    if (ar.kind === 'wait' && a.holdNode) { const k = a.nodes.indexOf(a.holdNode); out.push({ kind: 'rec', start: a.coords[0], nodes: a.nodes.slice(0, k + 1), color: ALT_C, endLabel: true, label: L(a.holdName) }); out.push({ kind: 'alt', start: null, nodes: a.nodes.slice(k), color: ALT_C, dim: true, label: T('بعد انتهاء الخطر', 'After the risk ends') }); }
    else if (ar.kind === 'wait' && a.holdCoords) out.push({ kind: 'rec', coords: a.holdCoords, color: ALT_C, endLabel: true, label: L(a.holdName) });
    else out.push({ kind: 'rec', start: a.coords[0], nodes: a.nodes, color: ALT_C, endLabel: true, label: T('المسار البديل', 'Alternative route') });
    return out;
  }
  function altZones(ar) { const z = [{ poly: ar.riskPoly, cls: 'rk-critical', label: ar.avoided.title }]; if (ar.alternative && ar.alternative.holdPoint) z.push({ poly: C.circlePoly(ar.alternative.holdPoint, 4, 12), cls: 'hold', label: ar.alternative.holdName, tag: { ar: 'انتظار', en: 'Hold' } }); return z; }

  // ---------- Port Officer sections ----------
  const OFF = {};
  const srcLine = (id) => { const d = src(id); return '<span class="srcline">' + TAG(d.label || id) + ' ' + T('آخر تحديث: ', 'Updated: ') + fT(d.lastReceivedAt) + ' (' + rel(d.lastReceivedAt) + ')</span>'; };
  const sechead = (title, sub, right) => { const src = sub && sub.indexOf('<span class="srcline">') >= 0 ? sub.slice(sub.indexOf('<span class="srcline">')) : ''; return '<div class="pagehead"><div><h1>' + esc(title) + '</h1>' + (src ? '<p class="muted">' + src + '</p>' : '') + '</div><div class="row">' + (right || '') + '</div></div>'; };

  // 1) Map
  OFF.map = {
    mount: () => sechead(T('الخريطة وحركة السفن', 'Map & vessel traffic'), srcLine('ais') + ' ' + srcLine('ncm')) + '<div id="ovr"></div>' +
      '<div class="panel filters row"><label class="sm">' + T('المنطقة', 'Region') + '<select data-f="region">' + opts([['', T('الكل', 'All')], ['RS', T('البحر الأحمر', 'Red Sea')], ['AG', T('الخليج العربي', 'Arabian Gulf')]], state.f.region) + '</select></label><label class="sm">' + T('نوع السفينة', 'Vessel type') + '<select data-f="vtype">' + opts([['', T('الكل', 'All')]].concat(Object.keys(VTYPE).map(k => [k, vtype(k)])), state.f.vtype) + '</select></label><label class="sm">' + T('مستوى الخطر', 'Risk level') + '<select data-f="risk">' + opts([['', T('الكل', 'All')], ['medium', T('متوسط فأعلى', 'Medium+')], ['high', T('مرتفع فأعلى', 'High+')], ['critical', T('حرج', 'Critical')]], state.f.risk) + '</select></label></div>' +
      '<div class="split"><div class="panel mapp"><div class="mapbox tall" id="omap"></div><div class="maplegend"><span class="lg ves"></span>' + T('سفينة (Test AIS Data)', 'Vessel (Test AIS Data)') + ' <span class="lg ves risk"></span>' + T('متأثرة بخطر مرتفع/حرج', 'Affected by high/critical risk') + ' <span class="lg z rk-high"></span>' + T('منطقة خطر', 'Risk area') + ' <span class="lg z nc"></span>' + T('قيود ملاحية (اختبار)', 'Navigational constraints (test)') + ' <span class="lg ln alt"></span>' + T('مسار بديل', 'Alternative route') + '</div></div><aside class="panel side-list" id="vside"></aside></div>',
    bind: m => ensureMap('omap', $('#omap', m), { fit: [33.5, 15, 52, 29.5] }),
    upd: () => {
      const s = S(), f = state.f, aff = affectedSet();
      { const act2 = s.maritimeRisks.filter(r => r.end > s.now), top = act2.slice().sort((a, b) => RANK(b.level) - RANK(a.level) || (b.affectedCount || 0) - (a.affectedCount || 0))[0];
        const covered = top && s.alerts.some(a => a.riskId === top.id && !['cancelled', 'expired'].includes(a.status));
        const pend = s.alerts.filter(a => ['draft', 'pending_approval', 'approved', 'ready_for_dispatch'].includes(a.status)).length, dl = s.deliveryRecords.filter(d => ['dispatched', 'received', 'acknowledged'].includes(d.status));
        fill('#ovr', (top && RANK(top.level) >= 3 ? '<div class="topalert lv-' + top.level + '"><div><b>' + esc(L(top.title)) + '</b><span>' + lv(top.level) + ' · ' + fT(top.start) + ' – ' + fT(top.end) + ' · ' + N(top.affectedCount || 0) + T(' سفن متأثرة', ' vessels affected') + ((top.affectedPorts || []).length ? ' · ' + T('الموانئ: ', 'Ports: ') + top.affectedPorts.map(pname).join(T('، ', ', ')) : '') + '</span></div>' + (covered ? '<button class="btn light" data-a="goAlerts">' + T('متابعة الإنذار', 'Follow the alert') + '</button>' : '<button class="btn light" data-a="alertForm" data-r="' + esc(top.id) + '">' + T('إرسال إنذار للسفن', 'Alert the vessels') + '</button>') + '</div>' : '') +
          '<div class="tiles"><div class="crit"><b>' + act2.filter(r => RANK(r.level) >= 3).length + '</b><span>' + T('مخاطر مرتفعة أو حرجة', 'High or critical risks') + '</span></div><div class="warn"><b>' + aff.size + '</b><span>' + T('سفن مهددة', 'Vessels at risk') + '</span></div><div><b>' + pend + '</b><span>' + T('إنذارات بانتظار الإجراء', 'Alerts awaiting action') + '</span></div><div class="ok"><b>' + dl.filter(d => d.ackAt).length + ' / ' + dl.length + '</b><span>' + T('سفن أكدت الاستلام', 'Vessels confirmed') + '</span></div></div>'); }
      const inRegion = p => !f.region || (f.region === 'RS' ? p[0] < 45 : p[0] >= 45);
      const vs = s.vessels.filter(v => inRegion(v.pos) && (!f.vtype || v.type === f.vtype) && (!f.risk || s.affectedVessels.some(a => a.vesselId === v.id && a.relation !== 'crossing' && RANK((risk(a.riskId) || {}).level) >= RANK(f.risk))));
      const rs = s.maritimeRisks.filter(r => r.end > s.now && inRegion(r.center) && (!f.risk || RANK(r.level) >= RANK(f.risk)));
      const sel = state.sel.vessel && vessel(state.sel.vessel);
      const routes = [];
      if (sel && sel.routeNodes.length) routes.push({ kind: 'current', start: sel.pos, nodes: sel.routeNodes, color: '#0b2545', label: T('المسار الحالي', 'Current route') });
      for (const ar of s.alternativeRoutes.filter(x => !sel || x.vesselId === sel.id)) if (ar.alternative && ar.alternative.nodes.length && ar.kind === 'reroute') routes.push({ kind: 'rec', start: ar.alternative.coords[0], nodes: ar.alternative.nodes, color: ALT_C, label: T('بديل: ', 'Alt: ') + vname(ar.vesselId) });
      if (state.maps.omap) state.maps.omap.setData(baseMap({ vessels: vs.map(v => mapV(v, { affected: aff.has(v.id) })), zones: constraintZones().concat(riskZones(rs)), routes }));
      if (!sel) {
        fill('#vside', '<h3>' + T('السفن', 'Vessels') + ' (' + vs.length + ')</h3><ul class="vlist">' + vs.map(v => '<li><button class="' + (aff.has(v.id) ? 'risk' : '') + '" data-a="selVessel" data-id="' + v.id + '"><b>' + esc(v.name) + '</b><span>' + vtype(v.type) + ' · ' + T(...VST[v.status]) + (v.status === 'underway' ? ' · ' + N(v.sog, 1) + ' kn → ' + esc(pname(v.destId)) : '') + '</span></button></li>').join('') + '</ul>');
        return;
      }
      const av = s.affectedVessels.filter(a => a.vesselId === sel.id).map(a => ({ a, r: risk(a.riskId) })).filter(x => x.r);
      const dl = s.deliveryRecords.filter(d => d.vesselId === sel.id);
      fill('#vside', '<button class="btn ghost sm" data-a="selVessel" data-id="">' + T('→ كل السفن', '← All vessels') + '</button><div class="vcard"><h3>' + esc(sel.name) + '</h3><div class="kv">' +
        [['IMO', '<code>' + esc(sel.imo) + '</code>'], ['MMSI', '<code>' + esc(sel.mmsi) + '</code>'], [T('النوع', 'Type'), vtype(sel.type)], [T('الحالة', 'Status'), T(...VST[sel.status])], [T('الموقع', 'Position'), ll(sel.pos)], [T('البعد عن الساحل السعودي', 'Distance to Saudi coast'), N(sel.distCoastNm, 1) + ' nm ' + (sel.inTerritorialSea ? B('ok', T('داخل المياه الإقليمية', 'Inside territorial waters')) : B('muted', T('خارج المياه الإقليمية', 'Outside territorial waters')))], [T('السرعة', 'Speed'), N(sel.sog, 1) + ' kn'], [T('الاتجاه', 'Course'), N(sel.cog) + '° ' + dirTxt(sel.cog)], [T('الغاطس', 'Draft'), N(sel.draft, 1) + ' m'], [T('المغادرة', 'Departure'), esc(pname(sel.originId))], [T('الوجهة', 'Destination'), esc(pname(sel.destId))], [T('المسافة المتبقية', 'Remaining'), N(sel.routeNm) + ' nm'], [T('الوصول المتوقع', 'ETA'), sel.etaAt ? fT(sel.etaAt) : '—'], [T('قناة الإنذار', 'Alert channel'), T(...(CH[{ bridge: 'test_bridge_screen', vhf: 'test_vhf_broadcast', ais: 'test_ais_message', none: 'none' }[sel.channel]]))], [T('سجل الموقع', 'Position record'), TAG('Test AIS Data') + ' ' + fT(sel.recordedAt)]].map(([k, v]) => '<span>' + k + '</span><b>' + v + '</b>').join('') + '</div>' +
        (av.length ? '<h4>' + T('المخاطر المرتبطة', 'Related risks') + '</h4><ul class="mini plain">' + av.map(({ a, r }) => '<li>' + lvB(r.level) + ' <b>' + esc(L(r.title)) + '</b><div class="sm">' + T(...REL[a.relation]) + ' – ' + esc(L(a.reason)) + '</div>' + (sel.status === 'underway' && a.relation !== 'crossing' ? '<button class="btn sm ghost" data-a="propose" data-v="' + sel.id + '" data-r="' + esc(r.id) + '">' + T('اقتراح مسار بديل', 'Propose alternative route') + '</button>' : '') + '</li>').join('') + '</ul>' : '<p class="okline sm">' + T('لا توجد مخاطر على مسارها خلال ٤٨ ساعة حسب بيانات الاختبار.', 'No risk on its route within 48 h in the test data.') + '</p>') +
        (dl.length ? '<h4>' + T('الإنذارات', 'Alerts') + '</h4><ul class="mini plain">' + dl.map(d => '<li>' + esc((alertById(d.alertId) || {}).number || '') + ' ' + dstB(d) + '</li>').join('') + '</ul>' : '') +
        '<div class="row"><button class="btn sm ghost" data-a="vesselForm" data-id="' + sel.id + '">' + T('تعديل السجل', 'Edit record') + '</button></div></div>');
    }
  };
  A.selVessel = d => { state.sel.vessel = d.id || null; update(); const v = d.id && vessel(d.id); if (v && state.maps.omap) state.maps.omap.fitPoints([v.pos].concat(v.routeNodes.slice(0, 3).map(n => C.NODES[n])), 1); };
  A.propose = async d => { const r = await act('proposeRoute', { vesselId: d.v, riskId: d.r }, T('تم اقتراح مسار بديل', 'Alternative route proposed')); if (r) { state.sel.route = r.id; state.sec = 'routes'; renderView(); } };

  // 2) Risk analysis
  OFF.risks = {
    mount: () => sechead(T('تحليل المخاطر خلال ٤٨ ساعة', 'Risk analysis – next 48 h'), T('محرك قواعد واضحة وقابلة للتعديل يحلل بيانات الأرصاد التجريبية وحالة الموانئ وسجلات المخاطر. ليس نموذج ذكاء اصطناعي مدرّبًا ولا تُدّعى له دقة مثبتة.', 'Explicit, editable rules analyse the sample weather data, port status and risk records. Not a trained AI model; no proven accuracy is claimed.') + '<br>' + srcLine('ncm'), '<button class="btn sm ghost" data-a="secData" data-t="rules">' + T('تعديل القواعد', 'Edit rules') + '</button><button class="btn sm" data-a="riskForm">' + T('إضافة خطر', 'Add risk') + '</button>') +
      '<div class="split"><aside class="panel side-list" id="rlist"></aside><div><div class="panel" id="rdet"></div><div class="panel mapp"><div class="mapbox mid" id="rmap"></div></div></div></div>',
    bind: m => ensureMap('rmap', $('#rmap', m), { fit: [33.5, 15, 52, 29.5] }),
    upd: () => {
      const s = S(), list = s.maritimeRisks.slice().sort((a, b) => RANK(b.level) - RANK(a.level) || a.start - b.start);
      if (!state.sel.risk || !risk(state.sel.risk)) state.sel.risk = list[0] && list[0].id;
      fill('#rlist', '<h3>' + T('المخاطر', 'Risks') + ' (' + list.length + ')</h3><ul class="vlist">' + list.map(r => '<li><button class="' + (r.id === state.sel.risk ? 'on' : '') + '" data-a="selRisk" data-id="' + esc(r.id) + '"><b>' + esc(L(r.title)) + '</b><span>' + lvB(r.level) + ' ' + fT(r.start) + ' · ' + N(r.durationH) + T(' س', ' h') + ' · ' + N(r.affectedCount || 0) + T(' سفن', ' vessels') + ((r.affectedPorts || []).length ? ' · ' + T('الموانئ: ', 'Ports: ') + r.affectedPorts.map(pname).join(T('، ', ', ')) : '') + '</span></button></li>').join('') + '</ul>');
      const r = risk(state.sel.risk);
      if (state.maps.rmap) { state.maps.rmap.setData(baseMap({ zones: constraintZones().concat(riskZones(r ? [r] : [])), vessels: s.vessels.map(v => mapV(v, { affected: !!r && s.affectedVessels.some(a => a.riskId === r.id && a.vesselId === v.id && a.relation !== 'crossing') })) })); if (r && $('#rmap').dataset.fit !== r.id) { $('#rmap').dataset.fit = r.id; state.maps.rmap.fitPoints(r.poly, 1.6); } }
      if (!r) { fill('#rdet', empty(T('لا توجد مخاطر حسب القواعد الحالية.', 'No risks under the current rules.'))); return; }
      const order = ['inside', 'entering', 'crossing'];
      const av = s.affectedVessels.filter(a => a.riskId === r.id).sort((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation));
      fill('#rdet', '<div class="row between"><h2>' + esc(L(r.title)) + '</h2>' + lvB(r.level) + '</div><div class="kv">' +
        [[T('نوع الخطر', 'Type'), rtype(r.type)], [T('المصدر', 'Source'), T(...RSRC[r.source]) + (r.source === 'rules' ? ' ' + TAG('Sample Weather Data') : r.source === 'record' ? ' ' + TAG('Test record') : '')], [T('الموقع', 'Location'), esc(L(r.areaName)) + ' · ' + ll(r.center) + ' · ' + T('نصف قطر ', 'radius ') + N(r.radiusNm) + ' nm'], [T('البداية المتوقعة', 'Expected start'), fT(r.start) + ' (' + rel(r.start) + ')'], [T('الانتهاء المتوقع', 'Expected end'), fT(r.end)], [T('المدة', 'Duration'), N(r.durationH) + T(' ساعة', ' h')], [T('السفن المتأثرة', 'Affected vessels'), N(r.affectedCount || 0)], [T('الموانئ المتأثرة', 'Affected ports'), (r.affectedPorts || []).length ? r.affectedPorts.map(pname).join(T('، ', ', ')) : '—']].concat(r.reliability != null ? [[T('موثوقية بيانات الاختبار', 'Test data reliability'), N(r.reliability * 100) + '%']] : []).map(([k, v]) => '<span>' + k + '</span><b>' + v + '</b>').join('') + '</div>' +
        '<h4>' + T('المؤشرات التي أدت إلى التصنيف', 'Indicators behind the rating') + '</h4>' + (r.indicators[0] && r.indicators[0].value != null ? tbl([T('المؤشر', 'Indicator'), T('القيمة', 'Value'), T('الحد', 'Threshold'), T('المستوى', 'Level'), T('الوقت', 'Time')], r.indicators.map(x => tr([esc(L(x.label)), N(x.value, 1) + ' ' + x.unit + (x.beaufort ? '<div class="sm muted">' + T('بوفورت ', 'Beaufort ') + x.beaufort + '</div>' : ''), esc(x.threshold), lvB(x.level), fT(x.at)]))) : '<ul class="sm">' + r.indicators.map(x => '<li>' + esc(L(x.text)) + '</li>').join('') + '</ul>') +
        '<p class="expl">' + esc(L(r.explanation)) + '</p>' + (r.wmoWindWarning ? '<p class="note sm warn"><b>' + esc(L(r.wmoWindWarning.label)) + '</b></p>' : '') + (r.type === 'navigation_hazard' ? '<p class="note sm warn">' + T('SOLAS V/4: يُبلّغ المعنيون بالخطر فورًا ويُحال إلى الحكومات المعنية (منسق NAVAREA IX) عند الحاجة لنشر أوسع.', 'SOLAS V/4: those concerned are informed promptly and the danger is passed to interested Governments (NAVAREA IX coordinator) where wider promulgation is needed.') + '</p>' : '') +
        '<h4>' + T('السفن المتأثرة', 'Affected vessels') + '</h4>' + (av.length ? tbl([T('السفينة', 'Vessel'), T('العلاقة', 'Relation'), T('السبب', 'Reason'), T('الوصول للمنطقة', 'Reaches area'), ''], av.map(a => tr(['<b>' + esc(vname(a.vesselId)) + '</b>', T(...REL[a.relation]), '<span class="sm">' + esc(L(a.reason)) + '</span>', a.relation === 'inside' ? T('الآن', 'Now') : fT(a.etaToZone), a.relation !== 'crossing' && (vessel(a.vesselId) || {}).status === 'underway' ? '<button class="btn sm ghost" data-a="propose" data-v="' + a.vesselId + '" data-r="' + esc(r.id) + '">' + T('مسار بديل', 'Alt. route') + '</button>' : '']))) : empty(T('لا توجد سفن داخل المنطقة أو متجهة إليها.', 'No vessels inside or heading into the area.'))) +
        '<div class="row"><button class="btn" data-a="alertForm" data-r="' + esc(r.id) + '">' + T('إنشاء إنذار من هذا الخطر', 'Create alert from this risk') + '</button><button class="btn ghost" data-a="bulletinForm" data-r="' + esc(r.id) + '">' + T('إنشاء نشرة', 'Create bulletin') + '</button>' + (['manual', 'record'].includes(r.source) ? '<button class="btn ghost danger sm" data-a="delRisk" data-id="' + esc(r.id) + '">' + T('حذف الخطر', 'Delete risk') + '</button>' : '') + '</div>');
    }
  };
  A.selRisk = d => { state.sel.risk = d.id; update(); };
  A.delRisk = async d => { if (confirm(T('حذف هذا الخطر من بيانات الاختبار؟', 'Delete this risk from the test data?'))) { await act('deleteRisk', { id: d.id }, T('حُذف', 'Deleted')); state.sel.risk = null; } };
  A.secData = d => { state.sec = 'data'; state.dataTab = d.t || 'vessels'; renderView(); };
  A.riskForm = () => {
    const m = modal('<h3>' + T('إضافة خطر', 'Add risk') + '</h3><form class="form" id="rf"><div class="grid2f">' + field(T('النوع', 'Type'), '<select name="type">' + opts(['navigation_hazard', 'operational', 'security', 'strong_winds', 'high_waves', 'reduced_visibility', 'strong_currents', 'other'].map(k => [k, rtype(k)])) + '</select>') + field(T('المستوى', 'Level'), '<select name="level">' + opts(['low', 'medium', 'high', 'critical'].map(k => [k, lv(k)]), 'high') + '</select>') +
      field(T('خط العرض', 'Latitude'), '<input name="lat" type="number" step="0.01" value="21.8" required>') + field(T('خط الطول', 'Longitude'), '<input name="lon" type="number" step="0.01" value="38.5" required>') + field(T('نصف القطر (ميل)', 'Radius (nm)'), '<input name="radiusNm" type="number" value="15">') + field(T('يبدأ بعد (ساعات)', 'Starts in (h)'), '<input name="startH" type="number" value="0">') + field(T('المدة (ساعات)', 'Duration (h)'), '<input name="durationH" type="number" value="12">') + '</div>' +
      '<div class="bil">' + field(T('العنوان (عربي)', 'Title (Arabic)'), '<input name="tar" dir="rtl" required>') + field(T('العنوان (إنجليزي)', 'Title (English)'), '<input name="ten" dir="ltr" required>') + field(T('المؤشرات (عربي)', 'Indicators (Arabic)'), '<input name="iar" dir="rtl">') + field(T('المؤشرات (إنجليزي)', 'Indicators (English)'), '<input name="ien" dir="ltr">') + '</div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('إضافة', 'Add') + '</button></div></form>', 'wide');
    $('#rf', m).onsubmit = async e => { e.preventDefault(); const f = e.target; const r = await act('addRisk', { type: val(f, 'type'), level: val(f, 'level'), lat: val(f, 'lat'), lon: val(f, 'lon'), radiusNm: val(f, 'radiusNm'), startH: val(f, 'startH'), durationH: val(f, 'durationH'), title: { ar: val(f, 'tar'), en: val(f, 'ten') }, indicators: { ar: val(f, 'iar'), en: val(f, 'ien') } }, T('أُضيف الخطر وحُددت السفن المتأثرة', 'Risk added; affected vessels identified')); if (r) { closeModal(); state.sel.risk = r.id; state.sec = 'risks'; renderView(); } };
  };

  // 3) Alerts
  OFF.alerts = {
    mount: () => sechead(T('إدارة الإنذارات', 'Alert management'), T('إنذارات اختبار (Test Maritime Alerts): تُنشأ وتُراجع وتُعتمد وتُرسل داخل بيئة الاختبار إلى شاشات جسر السفن المستهدفة فقط.', 'Test Maritime Alerts: created, reviewed, approved and dispatched inside the test environment to the targeted vessels\' bridge screens only.'), '<button class="btn sm" data-a="alertForm">' + T('إنذار جديد', 'New alert') + '</button>') + '<div class="split"><aside class="panel side-list" id="alist"></aside><div class="panel" id="adet"></div></div>',
    upd: () => {
      const s = S(), list = s.alerts.slice().reverse();
      if (!state.sel.alert || !alertById(state.sel.alert)) state.sel.alert = list[0] && list[0].id;
      fill('#alist', list.length ? '<ul class="vlist">' + list.map(a => { const d = s.deliveryRecords.filter(x => x.alertId === a.id); return '<li><button class="' + (a.id === state.sel.alert ? 'on' : '') + '" data-a="selAlert" data-id="' + a.id + '"><b>' + esc(a.number) + ' · ' + esc(L(a.title)) + '</b><span>' + astB(a.status) + ' ' + lvB(a.severity) + (d.length ? ' · ' + N(d.filter(x => x.ackAt).length) + '/' + N(d.length) + T(' أكدت', ' ack') : '') + '</span></button></li>'; }).join('') + '</ul>' : empty(T('لا توجد إنذارات. أنشئ إنذارًا من «تحليل المخاطر» أو من زر «إنذار جديد».', 'No alerts. Create one from “Risk analysis” or with “New alert”.')));
      const a = alertById(state.sel.alert); if (!a) { fill('#adet', ''); return; }
      const d = s.deliveryRecords.filter(x => x.alertId === a.id);
      const idx = FLOW.indexOf(a.status);
      const flow = '<div class="flow wrap">' + FLOW.map((st, i) => { const hist = a.history.filter(h => h.s === st).slice(-1)[0]; return (i ? '<span class="arr"></span>' : '') + '<div class="fstep' + (a.status === st ? ' on' : hist || (idx > i && a.status !== 'cancelled') ? ' done' : '') + '"><b>' + T(...AST[st]) + '</b><span>' + (hist ? fH(hist.at) : '') + '</span></div>'; }).join('') + '</div>';
      const btn = (act2, label, cls) => '<button class="btn ' + (cls || '') + '" data-a="' + act2 + '" data-id="' + a.id + '">' + label + '</button>';
      const actions = { draft: btn('alertEdit', T('تعديل', 'Edit'), 'ghost sm') + btn('alertSubmit', T('إرسال للمراجعة', 'Submit for review')), pending_approval: btn('alertApprove', T('مراجعة واعتماد', 'Review & approve')), approved: btn('alertPrepare', T('تجهيز للإرسال', 'Prepare for dispatch')), ready_for_dispatch: btn('alertDispatch', T('إرسال داخل بيئة الاختبار', 'Dispatch in test environment')) }[a.status] || '';
      fill('#adet', '<div class="row between"><h2>' + esc(a.number) + '</h2><div class="row">' + astB(a.status) + ' ' + lvB(a.severity) + ' ' + B('muted', T(...PRIO[a.priority])) + ' ' + TAG(a.label) + '</div></div>' + flow +
        '<div class="kv">' + [[T('العنوان', 'Title'), esc(a.title.ar) + '<br><span dir="ltr">' + esc(a.title.en) + '</span>'], [T('النص', 'Text'), esc(L(a.body))], [T('التعليمات', 'Instructions'), esc(L(a.instructions)) || '—'], [T('الخطر المرتبط', 'Linked risk'), a.riskSnapshot ? esc(L(a.riskSnapshot.title)) + ' ' + lvB(a.riskSnapshot.level) : T('منطقة محددة يدويًا', 'Manually defined area')], [T('المنطقة', 'Area'), esc(L(a.areaName))], [T('الصلاحية', 'Validity'), fT(a.validFrom) + ' – ' + fT(a.validTo)]].concat(a.wwnws ? [[T('مستوى التحذير (WWNWS)', 'Warning level (WWNWS)'), '<b>' + esc(L(a.wwnws.name)) + '</b> · ' + esc(L(a.wwnws.means)) + ' ' + (a.wwnws.reachesTerritorialSea ? B('ok', T('تصل للمياه الإقليمية', 'Reaches territorial waters')) : B('crit', T('لا تصل للمياه الإقليمية', 'Does not reach territorial waters'))) + '<div class="sm muted">' + esc(L(a.wwnws.note)) + '</div>']] : []).concat([[T('السفن المستهدفة', 'Target vessels'), a.targets.map(id => esc(vname(id))).join(T('، ', ', '))], [T('الاعتماد', 'Approval'), a.approvedBy ? esc(a.approvedBy) + ' · ' + fT(a.approvedAt) + ' · <code>' + esc(a.verification) + '</code>' : '—']]).map(([k, v]) => '<span>' + k + '</span><b>' + v + '</b>').join('') + '</div>' +
        '<div class="row">' + actions + (!['expired', 'cancelled', 'acknowledged'].includes(a.status) ? btn('alertCancel', T('إلغاء الإنذار', 'Cancel alert'), 'ghost danger sm') : '') + '</div>' +
        (d.length ? '<h3>' + T('سجلات التسليم', 'Delivery records') + '</h3>' + tbl([T('السفينة', 'Vessel'), 'MMSI', T('القناة', 'Channel'), T('الحالة', 'Status'), T('أُرسل', 'Dispatched'), T('استُلم', 'Received'), T('أُكد', 'Acknowledged'), ''],
          d.map(x => tr(['<b>' + esc(vname(x.vesselId)) + '</b>', '<code>' + esc(x.mmsi) + '</code>', T(...CH[x.channel]), dstB(x) + (x.failReason ? '<div class="sm bad">' + esc(L(x.failReason)) + '</div>' : '') + (x.holdReason && x.status === 'held_outside_ts' ? '<div class="sm muted">' + esc(L(x.holdReason)) + '</div>' : ''), fTs(x.dispatchedAt), fTs(x.receivedAt), x.ackAt ? fTs(x.ackAt) + '<div class="sm">' + esc(x.ackBy) + '</div>' : '—', x.channel === 'test_bridge_screen' && ['dispatched', 'received'].includes(x.status) ? '<button class="btn sm ghost" data-a="openBridge" data-id="' + x.vesselId + '">' + T('فتح شاشة السفينة', 'Open ship screen') + '</button>' : '']))) : '') +
        '<h4>' + T('سجل الحالة', 'Status history') + '</h4><ul class="events">' + a.history.slice().reverse().map(h => '<li><time>' + fTs(h.at) + '</time><span>' + T(...(AST[h.s] || [h.s, h.s])) + ' · ' + esc(h.by) + '</span>' + (h.note ? '<i>' + esc(h.note) + '</i>' : '') + '</li>').join('') + '</ul>');
    }
  };
  A.goAlerts = () => { state.sec = 'alerts'; renderView(); };
  A.selAlert = d => { state.sel.alert = d.id; update(); };
  A.openBridge = d => { if (confirm(T('الانتقال إلى شاشة جسر هذه السفينة؟ ارجع بزر «الرئيسية».', 'Switch to this vessel\'s bridge screen? Return with “Home”.'))) { client.leave(); A.pickBridge({ id: 'B-' + d.id }); } };
  function alertEditor(riskId, al) {
    const s = S(), r = riskId ? risk(riskId) : al && al.riskId ? risk(al.riskId) : null;
    const sugg = r ? s.affectedVessels.filter(a => a.riskId === r.id && a.relation !== 'crossing').map(a => a.vesselId) : [];
    const chosen = new Set(al ? al.targets : sugg);
    const ty = r && RTYPE[r.type] ? RTYPE[r.type] : RTYPE.other;
    const tpl = r ? { tar: ty[0] + ' – ' + r.areaName.ar, ten: ty[1] + ' – ' + r.areaName.en, bar: r.explanation.ar, ben: r.explanation.en, iar: 'خفض السرعة، تجنب المنطقة أو الانتظار خارجها، ومتابعة التحديثات.', ien: 'Reduce speed, avoid the area or wait outside it, and monitor updates.' } : { tar: '', ten: '', bar: '', ben: '', iar: '', ien: '' };
    const m = modal('<h3>' + (al ? T('تعديل ', 'Edit ') + esc(al.number) : T('إنذار جديد', 'New alert')) + '</h3><form class="form" id="af">' +
      (al ? '' : field(T('ربط بخطر', 'Link to risk'), '<select name="riskId">' + opts([['', T('بدون – منطقة يدوية', 'None – manual area')]].concat(s.maritimeRisks.filter(x => x.end > s.now).map(x => [x.id, L(x.title) + ' (' + lv(x.level) + ')'])), r ? r.id : '') + '</select>') +
        '<div class="grid3" id="manualArea"' + (r ? ' hidden' : '') + '>' + field(T('خط العرض', 'Latitude'), '<input name="lat" type="number" step="0.01" value="21.5">') + field(T('خط الطول', 'Longitude'), '<input name="lon" type="number" step="0.01" value="38.9">') + field(T('نصف القطر (ميل)', 'Radius (nm)'), '<input name="radiusNm" type="number" value="25">') + '</div>') +
      '<div class="grid3">' + field(T('الأولوية', 'Priority'), '<select name="priority">' + opts(Object.keys(PRIO).map(k => [k, T(...PRIO[k])]), al ? al.priority : 'urgent') + '</select>') + field(T('الخطورة', 'Severity'), '<select name="severity">' + opts(['low', 'medium', 'high', 'critical'].map(k => [k, lv(k)]), al ? al.severity : r ? r.level : 'high') + '</select>') + field(T('صالح حتى', 'Valid until'), '<input name="validTo" type="datetime-local" value="' + toLocalInput(al ? al.validTo : r ? r.end : s.now + 24 * H) + '">') + '</div>' +
      '<div class="bil">' + field(T('العنوان (عربي)', 'Title (Arabic)'), '<input name="tar" dir="rtl" required value="' + esc(al ? al.title.ar : tpl.tar) + '">') + field(T('العنوان (إنجليزي)', 'Title (English)'), '<input name="ten" dir="ltr" required value="' + esc(al ? al.title.en : tpl.ten) + '">') + field(T('النص (عربي)', 'Text (Arabic)'), '<textarea name="bar" dir="rtl" required>' + esc(al ? al.body.ar : tpl.bar) + '</textarea>') + field(T('النص (إنجليزي)', 'Text (English)'), '<textarea name="ben" dir="ltr" required>' + esc(al ? al.body.en : tpl.ben) + '</textarea>') + field(T('التعليمات (عربي)', 'Instructions (Arabic)'), '<textarea name="iar" dir="rtl">' + esc(al ? al.instructions.ar : tpl.iar) + '</textarea>') + field(T('التعليمات (إنجليزي)', 'Instructions (English)'), '<textarea name="ien" dir="ltr">' + esc(al ? al.instructions.en : tpl.ien) + '</textarea>') + '</div>' +
      '<fieldset><legend>' + T('السفن المستهدفة', 'Target vessels') + (sugg.length ? ' – ' + T('محددة مسبقًا: السفن المتأثرة', 'pre-selected: affected vessels') : '') + '</legend><div class="chklist">' + s.vessels.map(v => '<label class="chk"><input type="checkbox" name="t" value="' + v.id + '"' + (chosen.has(v.id) ? ' checked' : '') + '>' + esc(v.name) + (sugg.includes(v.id) ? ' ' + B('warn', T('متأثرة', 'affected')) : '') + '</label>').join('') + '</div></fieldset>' +
      '<div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button type="button" class="btn ghost" id="afDraft">' + T('حفظ كمسودة', 'Save as draft') + '</button><button class="btn">' + (al ? T('حفظ', 'Save') : T('إرسال للاعتماد', 'Send for approval')) + '</button></div></form>', 'wide');
    const f = $('#af', m);
    $('#afDraft', m).onclick = () => { f.dataset.draft = '1'; f.requestSubmit(); };
    const rs = f.querySelector('[name=riskId]'); if (rs) rs.onchange = () => { closeModal(); alertEditor(rs.value || null); };
    f.onsubmit = async e => {
      e.preventDefault(); const targets = $$('[name=t]:checked', f).map(x => x.value), body = { title: { ar: val(f, 'tar'), en: val(f, 'ten') }, body: { ar: val(f, 'bar'), en: val(f, 'ben') }, instructions: { ar: val(f, 'iar'), en: val(f, 'ien') }, priority: val(f, 'priority'), severity: val(f, 'severity'), validTo: new Date(val(f, 'validTo')).getTime(), targets };
      if (al) { if (await act('editAlert', Object.assign({ id: al.id }, body), T('حُفظ', 'Saved'))) closeModal(); return; }
      const res = await act('createAlert', Object.assign(body, { riskId: val(f, 'riskId') || null, lat: val(f, 'lat'), lon: val(f, 'lon'), radiusNm: val(f, 'radiusNm') }), false);
      if (res && f.dataset.draft !== '1') await act('submitAlert', { id: res.id }, T('أُرسل الإنذار للاعتماد', 'Alert sent for approval')); else if (res) toast(T('حُفظ كمسودة', 'Saved as draft'), 'ok');
      if (res) { closeModal(); state.sel.alert = res.id; state.sec = 'alerts'; renderView(); }
    };
  }
  A.alertForm = d => alertEditor(d.r || null);
  A.alertEdit = d => alertEditor(null, alertById(d.id));
  A.alertSubmit = d => act('submitAlert', { id: d.id }, T('أُرسل للمراجعة', 'Submitted for review'));
  A.alertApprove = d => {
    const a = alertById(d.id);
    const m = modal('<h3>' + T('مراجعة واعتماد ', 'Review & approve ') + esc(a.number) + '</h3><p><b>' + esc(L(a.title)) + '</b></p><p class="sm">' + esc(L(a.body)) + '</p><p class="sm">' + T('السفن: ', 'Vessels: ') + a.targets.map(id => esc(vname(id))).join(T('، ', ', ')) + '</p>' + (a.wwnws ? '<p class="note sm ' + (a.wwnws.directAlertAllowed ? 'ok' : 'bad') + '"><b>' + esc(L(a.wwnws.name)) + ':</b> ' + esc(L(a.wwnws.note)) + '</p>' : '') + '<form class="form" id="pf">' + discBlock() + '<div class="row end"><button type="button" class="btn ghost" data-r="1">' + T('إعادة للتعديل', 'Return for changes') + '</button><button class="btn">' + T('اعتماد وإرسال للسفن', 'Approve & send to vessels') + '</button></div></form>');
    const f = $('#pf', m);
    f.querySelector('[data-r]').onclick = async () => { if (!discOk(f)) return; if (await act('approveAlert', { id: a.id, disclaimer: true, reject: true }, T('أُعيد للتعديل', 'Returned'))) closeModal(); };
    f.onsubmit = async e => { e.preventDefault(); if (!discOk(f)) return; if (!(await act('approveAlert', { id: a.id, disclaimer: true }, false))) return; closeModal(); if (await act('prepareDispatch', { id: a.id }, false)) A.alertDispatch({ id: a.id }); };
  };
  A.alertPrepare = d => act('prepareDispatch', { id: d.id }, T('جُهّز للإرسال', 'Prepared for dispatch'));
  A.alertDispatch = async d => { const r = await act('dispatchAlert', { id: d.id }, false); if (r) toast(T('أُرسل داخل بيئة الاختبار إلى ' + r.ok + ' سفن' + (r.fail ? '، وتعذر ' + r.fail : ''), 'Dispatched in the test environment to ' + r.ok + ' vessels' + (r.fail ? ', ' + r.fail + ' failed' : '')), 'ok'); };
  A.alertCancel = async d => { const n = prompt(T('سبب الإلغاء', 'Reason')); if (n != null) await act('cancelAlert', { id: d.id, note: n }, T('أُلغي', 'Cancelled')); };

  // 4) Bulletins & NAVTEX
  const BST = { draft: ['muted', 'مسودة', 'Draft'], issued_test: ['ok', 'صادرة (اختبار)', 'Issued (test)'], cancelled: ['muted', 'ملغاة', 'Cancelled'], expired: ['muted', 'منتهية', 'Expired'] };
  const NST = { invalid: ['crit', 'حقول غير صالحة', 'Validation errors'], formatted: ['info', 'منسّقة', 'Formatted'], test_dispatched: ['ok', 'مُررت لنقطة اختبار', 'Passed to test endpoint'] };
  OFF.bulletins = {
    mount: () => sechead(T('النشرات والإشعارات الملاحية', 'Bulletins & navigational notices'), T('نشرات اختبار (Test Bulletin) مع أداة لإعداد رسالة بصيغة NAVTEX للاختبار والتكامل المستقبلي. لا تبث مَرسى أي رسالة رسميًا ولا ترسلها إلى محطة كراتشي.', 'Test Bulletins with a tool to prepare NAVTEX-format messages for testing and future integration. MARSA does not broadcast any message officially or send it to the Karachi station.'), '<button class="btn sm ghost" data-a="navtexForm">' + T('رسالة NAVTEX جديدة', 'New NAVTEX message') + '</button><button class="btn sm" data-a="bulletinForm">' + T('نشرة جديدة', 'New bulletin') + '</button>') +
      '<div class="panel"><h3>' + T('النشرات', 'Bulletins') + '</h3><div id="bcomp"></div><div id="blist"></div></div><div class="panel"><h3>' + T('رسائل NAVTEX التجريبية', 'Test NAVTEX messages') + '</h3><div id="nlist"></div></div>',
    upd: () => {
      const s = S();
      const wb = s.bulletins.filter(b => b.type === 'weather_bulletin' && b.history.some(h => h.s === 'issued_test' && h.at > s.now - 24 * H)).length;
      fill('#bcomp', '<p class="sm ' + (wb >= 2 ? 'okline' : 'bad') + '">' + T('نشرات الطقس خلال ٢٤ ساعة: ', 'Weather bulletins in 24 h: ') + wb + ' / 2</p>');
      fill('#blist', s.bulletins.length ? tbl([T('الرقم', 'No.'), T('النوع', 'Type'), T('العنوان', 'Title'), T('النطاق', 'Scope'), T('المنطقة', 'Area'), T('الصلاحية', 'Validity'), T('الحالة', 'Status'), ''], s.bulletins.slice().reverse().map(b => tr(['<b>' + esc(b.number) + '</b>', T(...BTYPE[b.type]), esc(L(b.title)), T(...SCOPE[b.scope]) + (b.scope !== b.suggestedScope ? '<div class="sm muted">' + T('المقترح: ', 'suggested: ') + T(...SCOPE[b.suggestedScope]) + '</div>' : '') + '<div class="sm muted">' + (b.wwnws && b.scope === b.wwnws.level ? esc(L(b.wwnws.means)) : esc(L((s.wwnws.levels[b.scope] || s.wwnws.levels.NAVAREA).means))) + '</div>' + (b.checks && b.checks.length ? b.checks.map(c => '<div class="sm bad">! ' + esc(L(c)) + '</div>').join('') : ''), esc(L(b.areaName)), fT(b.validFrom) + ' – ' + fT(b.validTo), B(BST[b.status][0], T(BST[b.status][1], BST[b.status][2])),
        '<div class="row nowrap">' + (b.status === 'draft' ? '<button class="btn sm" data-a="bIssue" data-id="' + b.id + '">' + T('إصدار', 'Issue') + '</button>' : '') + (b.scope === 'LOCAL' ? '<span class="sm muted">' + T('VHF/قنوات محلية – لا NAVTEX', 'VHF/local – no NAVTEX') + '</span>' : '<button class="btn sm ghost" data-a="navtexForm" data-b="' + b.id + '">NAVTEX</button>') + (!['cancelled', 'expired'].includes(b.status) ? '<button class="btn sm ghost danger" data-a="bCancel" data-id="' + b.id + '">' + T('إلغاء', 'Cancel') + '</button>' : '') + '</div>']))) : empty(T('لا توجد نشرات بعد.', 'No bulletins yet.')));
      fill('#nlist', s.navtexMessages.length ? s.navtexMessages.slice().reverse().map(m => { const st = s.stations.find(x => x.id === m.targetId), ns = NST[m.status] || ['muted', m.status, m.status]; return '<div class="nxcard"><div class="row between"><b>' + esc(m.number) + '</b><span>' + B(ns[0], T(ns[1], ns[2])) + ' ' + TAG('TEST') + '</span></div><div class="kv sm"><span>' + T('النوع', 'Subject') + '</span><b>' + (m.subject ? T(...SUBJ[m.subject]) : '—') + '</b><span>' + T('النطاق', 'Scope') + '</span><b>' + (m.scope ? T(...SCOPE[m.scope]) : '—') + '</b><span>' + T('الجهة', 'Addressee') + '</span><b>' + (st ? esc(L(st.name)) + ' · ' + (st.role === 'COORDINATOR' ? T('مركز تنسيق', 'Coordinator') : T('محطة بث NAVTEX', 'NAVTEX station')) : '—') + '</b></div>' +
        (m.errors.length ? '<ul class="errs">' + m.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '') + '<pre class="msg" dir="ltr">' + esc(m.formatted) + '</pre>' + (m.dispatches.length ? '<ul class="mini plain sm">' + m.dispatches.map(x => '<li>' + fTs(x.at) + ' · <code>' + esc(x.endpoint) + '</code> → ' + esc(x.response.status) + ' – ' + esc(L(x.response.note)) + '</li>').join('') + '</ul>' : '') +
        '<div class="row"><button class="btn sm ghost" data-a="navtexForm" data-id="' + m.id + '">' + T('تعديل', 'Edit') + '</button><button class="btn sm ghost" data-a="nxTxt" data-id="' + m.id + '">' + T('تصدير TXT', 'Export TXT') + '</button><button class="btn sm ghost" data-a="nxJson" data-id="' + m.id + '">' + T('تصدير JSON', 'Export JSON') + '</button>' + (m.status !== 'invalid' ? '<button class="btn sm" data-a="nxDispatch" data-id="' + m.id + '">' + T('تمرير لنقطة تكامل اختبارية', 'Pass to test integration endpoint') + '</button>' : '') + '</div></div>'; }).join('') : empty(T('لا توجد رسائل بعد.', 'No messages yet.')));
    }
  };
  A.bIssue = d => act('issueBulletin', { id: d.id }, T('صدرت النشرة داخل بيئة الاختبار', 'Bulletin issued in the test environment'));
  A.bCancel = d => act('cancelBulletin', { id: d.id }, T('أُلغيت', 'Cancelled'));
  A.bulletinForm = d => {
    const s = S(), r = d.r ? risk(d.r) : null, type = r ? (['port_closure', 'port_restriction'].includes(r.type) ? 'port_closure' : ['navigation_hazard', 'operational', 'security'].includes(r.type) ? 'nav_restriction' : 'wind_wave_warning') : 'weather_bulletin';
    const m = modal('<h3>' + T('نشرة جديدة', 'New bulletin') + '</h3><form class="form" id="bf"><div class="grid2f">' + field(T('النوع', 'Type'), '<select name="type">' + opts(Object.keys(BTYPE).map(k => [k, T(...BTYPE[k])]), type) + '</select>') + field(T('النطاق', 'Scope'), '<select name="scope">' + opts([['', T('تلقائي حسب امتداد المنطقة', 'Automatic by area extent')]].concat(Object.keys(SCOPE).map(k => [k, T(...SCOPE[k])]))) + '</select>') +
      field(T('الخطر المرتبط', 'Linked risk'), '<select name="riskId">' + opts([['', T('بدون', 'None')]].concat(s.maritimeRisks.map(x => [x.id, L(x.title)])), r ? r.id : '') + '</select>') + field(T('أو منطقة بحرية', 'or sea area'), '<select name="areaId">' + opts([['', '—']].concat(s.seaAreas.map(a => [a.id, L(a.name)]))) + '</select>') + field(T('أو ميناء', 'or port'), '<select name="portId">' + opts([['', '—']].concat(s.ports.map(p => [p.id, L(p.name)]))) + '</select>') + field(T('صالحة حتى', 'Valid until'), '<input name="validTo" type="datetime-local" value="' + toLocalInput(r ? r.end : s.now + 24 * H) + '">') + '</div>' +
      '<div class="bil">' + field(T('العنوان (عربي)', 'Title (Arabic)'), '<input name="tar" dir="rtl" required value="' + esc(r ? r.title.ar : '') + '">') + field(T('العنوان (إنجليزي)', 'Title (English)'), '<input name="ten" dir="ltr" required value="' + esc(r ? r.title.en : '') + '">') + field(T('النص (عربي)', 'Text (Arabic)'), '<textarea name="bar" dir="rtl" required>' + esc(r ? r.explanation.ar : '') + '</textarea>') + field(T('النص (إنجليزي)', 'Text (English)'), '<textarea name="ben" dir="ltr" required>' + esc(r ? r.explanation.en : '') + '</textarea>') + '</div><div class="row"><button type="button" class="btn sm ghost" id="genfc">' + T('توليد نص توقعات بحرية بصيغة WWMIWS للمنطقة المختارة', 'Generate WWMIWS-format marine forecast for the selected area') + '</button></div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('إنشاء', 'Create') + '</button></div></form>', 'wide');
    $('#genfc', m).onclick = async () => { const f = $('#bf', m), aid = val(f, 'areaId'); if (!aid) { toast(T('اختر منطقة بحرية أولًا', 'Select a sea area first'), 'bad'); return; } const r = await act('marineForecast', { areaId: aid, hours: 24 }, false); if (!r) return; f.querySelector('[name=type]').value = 'weather_bulletin'; f.querySelector('[name=riskId]').value = ''; f.querySelector('[name=bar]').value = r.text.ar; f.querySelector('[name=ben]').value = r.text.en; f.querySelector('[name=validTo]').value = toLocalInput(r.validTo); const an = S().seaAreas.find(x => x.id === aid).name; f.querySelector('[name=tar]').value = 'توقعات بحرية – ' + an.ar; f.querySelector('[name=ten]').value = 'Marine forecast – ' + an.en; };
    $('#bf', m).onsubmit = async e => { e.preventDefault(); const f = e.target; if (await act('createBulletin', { type: val(f, 'type'), scope: val(f, 'scope') || null, riskId: val(f, 'riskId') || null, areaId: val(f, 'areaId') || null, portId: val(f, 'portId') || null, validTo: new Date(val(f, 'validTo')).getTime(), title: { ar: val(f, 'tar'), en: val(f, 'ten') }, body: { ar: val(f, 'bar'), en: val(f, 'ben') } }, T('أُنشئت النشرة', 'Bulletin created'))) { closeModal(); state.sec = 'bulletins'; renderView(); } };
  };
  A.navtexForm = d => {
    const s = S(), ex = d.id ? s.navtexMessages.find(x => x.id === d.id) : null, b = d.b ? s.bulletins.find(x => x.id === d.b) : ex && ex.bulletinId ? s.bulletins.find(x => x.id === ex.bulletinId) : null;
    const scope = ex ? ex.scope : b ? (b.scope === 'LOCAL' ? 'COASTAL' : b.scope) : 'COASTAL', subj = ex ? ex.subject : b ? (b.type === 'nav_restriction' || b.type === 'port_closure' ? 'A' : b.type === 'weather_bulletin' ? 'E' : 'B') : 'B';
    const cen = ex && ex.position ? ex.position : b ? b.poly.reduce((a, p) => [a[0] + p[0] / b.poly.length, a[1] + p[1] / b.poly.length], [0, 0]) : null;
    const m = modal('<h3>' + T('إعداد رسالة بصيغة NAVTEX (اختبار)', 'Prepare NAVTEX-format message (test)') + '</h3><form class="form" id="nf"><div class="grid2f">' +
      field(T('نوع الرسالة (مؤشر الموضوع)', 'Message type (subject indicator)'), '<select name="subject">' + opts(Object.keys(SUBJ).map(k => [k, T(...SUBJ[k])]), subj) + '</select>') + field(T('النطاق', 'Scope'), '<select name="scope">' + opts(['COASTAL', 'NAVAREA', 'SUBAREA', 'LOCAL'].map(k => [k, T(...SCOPE[k])]), scope === 'INTERNATIONAL' ? 'NAVAREA' : scope) + '</select>') +
      field(T('الجهة المرسل إليها', 'Addressee'), '<select name="targetId">' + opts(s.stations.filter(st => st.role === 'COORDINATOR').map(st => [st.id, T('مركز تنسيق: ', 'Coordinator: ') + L(st.name)]).concat(s.stations.filter(st => st.role !== 'COORDINATOR').map(st => [st.id, T('محطة NAVTEX: ', 'NAVTEX station: ') + L(st.name) + (st.b1 ? ' (' + st.b1 + ')' : '')])), ex ? ex.targetId : scope === 'NAVAREA' || scope === 'INTERNATIONAL' ? 'KHI_NAV' : 'H_JED') + '</select>') + field(T('الرقم التسلسلي (اختبار)', 'Serial (test)'), '<input name="serial" type="number" min="1" max="999" value="' + (ex ? ex.serial : s.navtexMessages.length + 1) + '">') +
      field(T('وصف المنطقة (إنجليزي)', 'Area description (English)'), '<input name="areaText" dir="ltr" value="' + esc(ex ? ex.areaText : b ? b.areaName.en : '') + '">') + '<div class="grid2f">' + field(T('خط العرض', 'Lat'), '<input name="lat" type="number" step="0.01" value="' + (cen ? cen[1].toFixed(2) : '') + '">') + field(T('خط الطول', 'Lon'), '<input name="lon" type="number" step="0.01" value="' + (cen ? cen[0].toFixed(2) : '') + '">') + '</div>' +
      field(T('بداية الصلاحية', 'Valid from'), '<input name="validFrom" type="datetime-local" value="' + toLocalInput(ex && ex.validFrom || (b ? b.validFrom : s.now)) + '">') + field(T('نهاية الصلاحية', 'Valid to'), '<input name="validTo" type="datetime-local" value="' + toLocalInput(ex && ex.validTo || (b ? b.validTo : s.now + 24 * H)) + '">') + '</div>' +
      field(T('نص الرسالة (إنجليزي – يُحوّل لأحرف كبيرة)', 'Message text (English – converted to upper case)'), '<textarea name="textEn" dir="ltr" rows="4">' + esc(ex ? ex.textEn : b ? b.body.en : '') + '</textarea>') + field(T('ترجمة عربية للمرجع', 'Arabic reference translation'), '<textarea name="textAr" dir="rtl" rows="3">' + esc(ex ? ex.textAr : b ? b.body.ar : '') + '</textarea>') +
      '<div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('تحقق وتنسيق', 'Validate & format') + '</button></div></form>', 'wide');
    const f = $('#nf', m);
    f.querySelector('[name=scope]').onchange = e => { f.querySelector('[name=targetId]').value = e.target.value === 'NAVAREA' ? 'KHI_NAV' : 'H_JED'; if (e.target.value === 'LOCAL') toast(T('التحذيرات المحلية لا تُبث على NAVTEX الدولي (A.706(17) 10.2.1.3)؛ تُنشر عبر VHF والقنوات المحلية', 'Local warnings are not broadcast on international NAVTEX (A.706(17) 10.2.1.3); use VHF and local channels'), 'bad'); };
    f.onsubmit = async e => {
      e.preventDefault(); const vf = val(f, 'validFrom'), vt = val(f, 'validTo');
      const r = await act('saveNavtex', { id: ex ? ex.id : null, bulletinId: b ? b.id : null, subject: val(f, 'subject'), scope: val(f, 'scope'), targetId: val(f, 'targetId'), serial: val(f, 'serial'), areaText: val(f, 'areaText'), lat: val(f, 'lat'), lon: val(f, 'lon'), validFrom: vf ? new Date(vf).getTime() : null, validTo: vt ? new Date(vt).getTime() : null, textEn: val(f, 'textEn'), textAr: val(f, 'textAr') }, false);
      if (r) { toast(r.errors.length ? T('حُفظت مع أخطاء تحقق: ', 'Saved with validation errors: ') + r.errors.length : T('الرسالة صالحة ومنسّقة', 'Message valid and formatted'), r.errors.length ? 'bad' : 'ok'); closeModal(); state.sec = 'bulletins'; renderView(); }
    };
  };
  A.nxTxt = async d => { const m = S().navtexMessages.find(x => x.id === d.id); await download(m.number + '.txt', m.formatted); client.call('exportNavtex', { id: m.id }).catch(() => {}); };
  A.nxJson = async d => { const m = S().navtexMessages.find(x => x.id === d.id), st = S().stations.find(x => x.id === m.targetId); await download(m.number + '.json', JSON.stringify({ schema: 'marsa.navwarning.test/v1', environment: 'TEST', number: m.number, subjectIndicator: m.subject, scope: m.scope, addressee: st ? { id: st.id, role: st.role, name: st.name.en, b1: st.b1 || null } : null, area: m.areaText, position: m.position ? { lat: m.position[1], lon: m.position[0] } : null, validFrom: m.validFrom ? new Date(m.validFrom).toISOString() : null, validTo: m.validTo ? new Date(m.validTo).toISOString() : null, textEn: m.textEn, textAr: m.textAr, formatted: m.formatted, validationErrors: m.errors, transmitted: false }, null, 2), 'application/json'); client.call('exportNavtex', { id: m.id }).catch(() => {}); };
  A.nxDispatch = d => act('dispatchNavtexTest', { id: d.id }, T('مُررت إلى نقطة تكامل اختبارية – لم تُرسل فعليًا', 'Passed to a test integration endpoint – not actually sent'));

  // 5) Alternative routes
  OFF.routes = {
    mount: () => sechead(T('المسارات البديلة', 'Alternative routes'), T('محرك تجريبي يراعي موقع السفينة ووجهتها وغاطسها ونوعها ومناطق الخطر والأحوال البحرية والقيود الملاحية في بيانات الاختبار. صلاحية المسارات غير متحققة.', 'Prototype engine considering vessel position, destination, draft, type, risk areas, sea conditions and the navigational constraints in the test data. Route validity is not verified.')) + '<div class="split"><aside class="panel side-list" id="alist2"></aside><div><div class="panel mapp"><div class="mapbox mid" id="amap"></div><div class="maplegend"><span class="lg z rk-critical"></span>' + T('منطقة الخطر', 'Risk area') + ' <span class="lg ln cur"></span>' + T('المسار الحالي', 'Current route') + ' <span class="lg ln alt"></span>' + T('المسار البديل', 'Alternative route') + ' <span class="lg z nc"></span>' + T('قيود ملاحية (اختبار)', 'Constraints (test)') + '</div></div><div class="panel" id="adet2"></div></div></div>',
    bind: m => ensureMap('amap', $('#amap', m), { fit: [33.5, 15, 52, 29.5] }),
    upd: () => {
      const s = S(), list = s.alternativeRoutes.slice().reverse();
      if (!state.sel.route || !list.some(x => x.id === state.sel.route)) state.sel.route = list[0] && list[0].id;
      fill('#alist2', list.length ? '<ul class="vlist">' + list.map(x => '<li><button class="' + (x.id === state.sel.route ? 'on' : '') + '" data-a="selRoute" data-id="' + x.id + '"><b>' + esc(vname(x.vesselId)) + '</b><span>' + ({ reroute: T('تحويل المسار', 'Reroute'), wait: T('انتظار خارج المنطقة', 'Wait outside area'), none: T('لا يوجد بديل', 'No alternative') })[x.kind] + ' · ' + esc(x.number) + (x.alertId ? ' · ' + esc((alertById(x.alertId) || {}).number || '') : '') + '</span></button></li>').join('') + '</ul>' : empty(T('تُقترح المسارات عند اعتماد إنذار أو من «تحليل المخاطر» لأي سفينة متأثرة.', 'Routes are proposed when an alert is approved, or from “Risk analysis” for any affected vessel.')));
      const x = list.find(r => r.id === state.sel.route);
      if (state.maps.amap) { state.maps.amap.setData(baseMap({ zones: constraintZones().concat(x ? altZones(x) : []), routes: x ? altRoutes(x) : [], vessels: x ? s.vessels.filter(v => v.id === x.vesselId).map(v => mapV(v, { affected: true })) : [] })); if (x && $('#amap').dataset.fit !== x.id) { $('#amap').dataset.fit = x.id; state.maps.amap.fitPoints(x.current.coords.slice(0, 6).concat(x.alternative ? x.alternative.coords.slice(0, 8) : []).concat(x.riskPoly), 1); } }
      if (!x) { fill('#adet2', ''); return; }
      fill('#adet2', routeDetail(x));
    }
  };
  function routeDetail(x) {
    const a = x.alternative, c = x.current;
    return '<div class="row between"><h2>' + esc(vname(x.vesselId)) + ' · ' + esc(x.number) + '</h2>' + B('warn', T('صلاحية غير متحققة', 'Validity not verified')) + '</div>' +
      (a ? tbl(['', T('المسار الحالي', 'Current route'), T('المسار البديل', 'Alternative')], [tr([T('المسافة', 'Distance'), N(c.nm) + ' nm', N(a.nm) + ' nm (' + (a.nm - c.nm >= 0 ? '+' : '') + N(a.nm - c.nm) + ')']), tr([T('الزمن التقديري', 'Estimated time'), N(c.hours, 1) + T(' س', ' h'), N(a.hours, 1) + T(' س', ' h') + (a.waitHours ? ' (' + T('منها انتظار ', 'incl. wait ') + N(a.waitHours, 1) + ')' : '')]), tr([T('الخطر', 'Risk'), esc(L(x.avoided.title)) + ' ' + lvB(x.avoided.level), T('يتجنبه', 'Avoided')])]) : '') +
      '<div class="kv"><span>' + T('الخطر الذي يتم تجنبه', 'Risk avoided') + '</span><b>' + esc(L(x.avoided.title)) + ' · ' + fT(x.avoided.start) + ' – ' + fT(x.avoided.end) + '</b><span>' + T('سبب الاختيار', 'Reason') + '</span><b>' + esc(L(x.reason)) + '</b>' + (a && a.holdName ? '<span>' + T('نقطة الانتظار', 'Holding point') + '</span><b>' + esc(L(a.holdName)) + '</b>' : '') + '</div>' +
      (x.checks.length ? '<h4>' + T('الفحوصات على بيانات الاختبار', 'Checks against test data') + '</h4><ul class="checks">' + x.checks.map(k => '<li class="' + (k.ok ? 'ok' : 'warn') + '">' + (k.ok ? '✓' : '!') + ' ' + esc(L(k.text)) + '</li>').join('') + '</ul>' : '') +
      '<p class="note bad sm">' + esc(L(x.validationNote)) + '</p>';
  }
  A.selRoute = d => { state.sel.route = d.id; update(); };

  // 6) Test data management
  OFF.data = {
    mount: () => sechead(T('بيانات الاختبار', 'Test data'), T('سجلات منظمة قابلة للتعديل والإضافة والحذف. أي تعديل يعيد تشغيل التحليل ويُسجل في سجل العمليات.', 'Structured records you can edit, add and delete. Any change re-runs the analysis and is written to the operations log.'), '<button class="btn sm ghost danger" data-a="resetData">' + T('إعادة تهيئة بيانات الاختبار', 'Reset test data') + '</button>') +
      '<div class="tabs">' + [['vessels', 'السفن', 'Vessels'], ['ports', 'الموانئ', 'Ports'], ['weather', 'الأرصاد', 'Weather'], ['constraints', 'القيود الملاحية', 'Constraints'], ['rules', 'قواعد التحليل', 'Analysis rules']].map(([k, ar, en]) => '<button class="' + (state.dataTab === k ? 'on' : '') + '" data-a="dataTab" data-id="' + k + '">' + T(ar, en) + '</button>').join('') + '</div><div class="panel" id="dbody"></div>',
    upd: () => {
      const s = S(), t = state.dataTab;
      if (t === 'vessels') fill('#dbody', '<div class="row between"><span>' + srcLine('ais') + ' ' + TAG('Test Vessel Records') + '</span><button class="btn sm" data-a="vesselForm">' + T('إضافة سفينة', 'Add vessel') + '</button></div>' + tbl([T('الاسم', 'Name'), 'IMO', T('النوع', 'Type'), T('الموقع', 'Position'), T('السرعة', 'Speed'), T('الاتجاه', 'Course'), T('الغاطس', 'Draft'), T('المغادرة', 'From'), T('الوجهة', 'To'), 'ETA', T('الحالة', 'Status'), ''],
        s.vessels.map(v => tr(['<b>' + esc(v.name) + '</b>', '<code class="sm">' + esc(v.imo) + '</code>', vtype(v.type), ll(v.pos), N(v.sog, 1), N(v.cog) + '°', N(v.draft, 1), esc(pname(v.originId)), esc(pname(v.destId)), v.etaAt ? fT(v.etaAt) : '—', T(...VST[v.status]), '<div class="row nowrap"><button class="btn sm ghost" data-a="vesselForm" data-id="' + v.id + '">' + T('تعديل', 'Edit') + '</button><button class="btn sm ghost danger" data-a="delVessel" data-id="' + v.id + '">' + T('حذف', 'Delete') + '</button></div>']))));
      else if (t === 'ports') fill('#dbody', srcLine('ports') + tbl([T('الميناء', 'Port'), T('الحالة', 'Status'), T('الازدحام', 'Congestion'), T('الأرصفة المتاحة / الطاقة', 'Free berths / capacity'), T('الغاطس الأقصى', 'Max draft'), T('الظروف التشغيلية', 'Operating conditions'), T('قيود الدخول والخروج', 'Entry/exit restrictions'), ''],
        s.ports.map(p => tr(['<b>' + esc(L(p.name)) + '</b>', pstB(p.status) + (p.statusUntil ? '<div class="sm muted">' + T('حتى ', 'until ') + fT(p.statusUntil) + '</div>' : ''), N(p.congestionPct) + '%', N(p.availableBerths) + ' / ' + N(p.capacityBerths), N(p.maxDraftM, 1) + ' m', esc(L(p.conditions)), esc(L(p.restrictions)) || '—', '<button class="btn sm ghost" data-a="portForm" data-id="' + p.id + '">' + T('تحديث', 'Update') + '</button>']))));
      else if (t === 'weather') {
        const rows = s.seaAreas.map(a => { const o = s.weatherObservations.find(x => x.areaId === a.id) || {}; return tr(['<b>' + esc(L(a.name)) + '</b><div class="sm muted">' + ll(a.p) + '</div>', N(o.windKn, 1) + ' kn ' + dirTxt(o.windDir), N(o.waveM, 1) + ' m ' + dirTxt(o.waveDir), N(o.currentKn, 1) + ' kn ' + dirTxt(o.currentDir), N(o.visNm, 1) + ' nm', N(o.tempC, 1) + '°C', fT(o.recordedAt) + ' ' + TAG(o.label || 'Sample Weather Data'), N((o.reliability || 0) * 100) + '%', '<div class="row nowrap"><button class="btn sm ghost" data-a="wxView" data-id="' + a.id + '">' + T('توقعات ٤٨ س', '48 h forecast') + '</button><button class="btn sm ghost" data-a="wxEdit" data-id="' + a.id + '">' + T('تعديل', 'Edit') + '</button></div>']); });
        fill('#dbody', srcLine('ncm') + '<p class="muted sm">' + T('أنظمة جوية مضمّنة في بيانات الاختبار: ', 'Weather systems embedded in the test data: ') + s.sampleSystems.map(x => esc(L(x.name))).join(T('؛ ', '; ')) + '</p>' + tbl([T('المنطقة', 'Area'), T('الرياح', 'Wind'), T('الأمواج', 'Waves'), T('التيار', 'Current'), T('الرؤية', 'Visibility'), T('الحرارة', 'Temp.'), T('وقت التسجيل', 'Recorded'), T('الموثوقية', 'Reliability'), ''], rows));
      } else if (t === 'constraints') fill('#dbody', '' + tbl([T('القيد', 'Constraint'), T('النوع', 'Kind'), T('العمق الأدنى', 'Min depth'), T('الحدود', 'Bounds')], s.constraints.map(k => tr([esc(L(k.name)), k.kind === 'restricted' ? T('منطقة محظورة', 'Restricted area') : T('منطقة ضحلة', 'Shallow area'), k.minDepthM ? N(k.minDepthM) + ' m ' + TAG('test') : '—', ll(k.poly[0]) + ' – ' + ll(k.poly[2])]))));
      else if (t === 'rules') {
        if ($('#rulesForm')) return; const R = s.rules;
        fill('#dbody', '<form class="form" id="rulesForm"><p class="muted sm">' + T('حدود المستويات (منخفض، متوسط، مرتفع، حرج). للرؤية: كلما قلت القيمة زاد الخطر.', 'Level thresholds (low, medium, high, critical). For visibility, lower is worse.') + '</p>' + ['windKn', 'waveM', 'visNm', 'currentKn'].map(k => '<fieldset><legend>' + T(...IND[k]) + ' (' + ({ windKn: 'kn', waveM: 'm', visNm: 'nm', currentKn: 'kn' })[k] + ')</legend><div class="grid4">' + ['low', 'medium', 'high', 'critical'].map((l, i) => field(lv(l), '<input name="' + k + i + '" type="number" step="0.05" value="' + R[k][i] + '">')).join('') + '</div></fieldset>').join('') +
          '<div class="grid3">' + field(T('أدنى مستوى يُسجل كخطر', 'Minimum level recorded as a risk'), '<select name="minLevel">' + opts(['low', 'medium', 'high'].map(l => [l, lv(l)]), R.minLevel) + '</select>') + field(T('عقوبة المرور بأحوال متوسطة في المسارات ٪', 'Medium sea-condition route penalty %'), '<input name="seaPenaltyPct" type="number" value="' + R.seaPenaltyPct + '">') + field(T('هامش العمق تحت القاع (م)', 'Under-keel clearance (m)'), '<input name="ukcM" type="number" step="0.1" value="' + R.ukcM + '">') + '</div><div class="row end"><button class="btn">' + T('حفظ وإعادة التحليل', 'Save & re-analyse') + '</button></div></form>');
        $('#rulesForm').onsubmit = async e => { e.preventDefault(); const f = e.target, a = { minLevel: val(f, 'minLevel'), seaPenaltyPct: val(f, 'seaPenaltyPct'), ukcM: val(f, 'ukcM') }; for (const k of ['windKn', 'waveM', 'visNm', 'currentKn']) a[k] = [0, 1, 2, 3].map(i => val(f, k + i)); await act('updateRules', a, T('حُفظت القواعد وأعيد التحليل', 'Rules saved; analysis re-run')); };
      }
    }
  };
  A.dataTab = d => { state.dataTab = d.id; renderView(); };
  A.resetData = async () => { if (confirm(T('ستُعاد كل بيانات الاختبار إلى حالتها الأولى وتُحذف الإنذارات والنشرات. متابعة؟', 'All test data will return to its initial state and alerts and bulletins will be removed. Continue?'))) { await act('resetTestData', {}, T('أعيدت تهيئة بيانات الاختبار', 'Test data reset')); state.sel = {}; renderView(); } };
  A.delVessel = async d => { if (confirm(T('حذف سجل هذه السفينة؟', 'Delete this vessel record?'))) await act('deleteVessel', { id: d.id }, T('حُذف', 'Deleted')); };
  A.vesselForm = d => {
    const v = d.id ? vessel(d.id) : null, ports = C.PORTS.filter(p => !p.virtual).map(p => [p.id, T(p.ar, p.en)]);
    const m = modal('<h3>' + (v ? T('تعديل ', 'Edit ') + esc(v.name) : T('إضافة سفينة (سجل اختبار)', 'Add vessel (test record)')) + '</h3><form class="form" id="vf"><div class="grid3">' + field(T('الاسم', 'Name'), '<input name="name" required value="' + esc(v ? v.name : '') + '">') + field(T('النوع', 'Type'), '<select name="type">' + opts(Object.keys(VTYPE).map(k => [k, vtype(k)]), v ? v.type : 'general') + '</select>') + field(T('الحالة', 'Status'), '<select name="status">' + opts(Object.keys(VST).map(k => [k, T(...VST[k])]), v ? v.status : 'underway') + '</select>') +
      field(T('خط العرض', 'Latitude'), '<input name="lat" type="number" step="0.001" required value="' + (v ? v.pos[1].toFixed(3) : '22.5') + '">') + field(T('خط الطول', 'Longitude'), '<input name="lon" type="number" step="0.001" required value="' + (v ? v.pos[0].toFixed(3) : '38.3') + '">') + field(T('السرعة (عقدة)', 'Speed (kn)'), '<input name="sog" type="number" step="0.1" value="' + (v ? v.sog : 12) + '">') + field(T('الاتجاه (°)', 'Course (°)'), '<input name="cog" type="number" value="' + (v ? v.cog : 180) + '">') + field(T('الغاطس (م)', 'Draft (m)'), '<input name="draft" type="number" step="0.1" value="' + (v ? v.draft : 9) + '">') + field(T('قناة الإنذار', 'Alert channel'), '<select name="channel">' + opts([['bridge', T('شاشة جسر السفينة', 'Bridge screen')], ['vhf', T('بث VHF محلي (بلا تأكيد)', 'Local VHF broadcast (no confirmation)')], ['ais', T('رسالة AIS (بلا تأكيد)', 'AIS message (no confirmation)')], ['none', T('لا توجد', 'None')]], v ? v.channel : 'bridge') + '</select>') +
      field(T('ميناء المغادرة', 'Departure port'), '<select name="originId">' + opts([['', '—']].concat(ports), v ? v.originId : '') + '</select>') + field(T('الوجهة', 'Destination'), '<select name="destId">' + opts(ports, v ? v.destId : 'JED') + '</select>') + '</div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('حفظ', 'Save') + '</button></div></form>', 'wide');
    $('#vf', m).onsubmit = async e => { e.preventDefault(); const f = e.target; if (await act('upsertVessel', { id: v ? v.id : null, name: val(f, 'name'), type: val(f, 'type'), status: val(f, 'status'), lat: val(f, 'lat'), lon: val(f, 'lon'), sog: val(f, 'sog'), cog: val(f, 'cog'), draft: val(f, 'draft'), channel: val(f, 'channel'), originId: val(f, 'originId'), destId: val(f, 'destId') }, T('حُفظ السجل وأعيد حساب التأثر', 'Record saved; exposure recomputed'))) closeModal(); };
  };
  A.portForm = d => {
    const p = port(d.id);
    const m = modal('<h3>' + T('تحديث حالة ', 'Update ') + esc(L(p.name)) + '</h3><form class="form" id="pf"><div class="grid3">' + field(T('حالة التشغيل', 'Operating status'), '<select name="status">' + opts(Object.keys(PST).map(k => [k, T(...PST[k])]), p.status) + '</select>') + field(T('لمدة (ساعات)', 'For (hours)'), '<input name="untilH" type="number" min="1" max="240" placeholder="24">') + field(T('الازدحام ٪', 'Congestion %'), '<input name="congestionPct" type="number" min="0" max="100" value="' + p.congestionPct + '">') + field(T('الأرصفة المتاحة', 'Free berths'), '<input name="availableBerths" type="number" min="0" max="' + p.capacityBerths + '" value="' + p.availableBerths + '">') + '</div>' +
      '<div class="bil">' + field(T('الظروف التشغيلية (عربي)', 'Conditions (Arabic)'), '<input name="car" dir="rtl" value="' + esc(p.conditions.ar) + '">') + field(T('الظروف التشغيلية (إنجليزي)', 'Conditions (English)'), '<input name="cen" dir="ltr" value="' + esc(p.conditions.en) + '">') + field(T('قيود الدخول والخروج (عربي)', 'Entry/exit restrictions (Arabic)'), '<input name="rar" dir="rtl" value="' + esc(p.restrictions.ar) + '">') + field(T('قيود الدخول والخروج (إنجليزي)', 'Entry/exit restrictions (English)'), '<input name="ren" dir="ltr" value="' + esc(p.restrictions.en) + '">') + '</div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('حفظ', 'Save') + '</button></div></form>', 'wide');
    $('#pf', m).onsubmit = async e => { e.preventDefault(); const f = e.target; if (await act('updatePort', { id: p.id, status: val(f, 'status'), untilH: val(f, 'untilH'), congestionPct: val(f, 'congestionPct'), availableBerths: val(f, 'availableBerths'), conditions: { ar: val(f, 'car'), en: val(f, 'cen') }, restrictions: { ar: val(f, 'rar'), en: val(f, 'ren') } }, T('حُدّثت حالة الميناء وأعيد التحليل', 'Port updated; analysis re-run'))) closeModal(); };
  };
  A.wxView = d => {
    const s = S(), f = s.weatherForecasts.find(x => x.areaId === d.id), a = s.seaAreas.find(x => x.id === d.id);
    modal('<h3>' + T('توقعات ٤٨ ساعة – ', '48 h forecast – ') + esc(L(a.name)) + '</h3><p class="sm">' + TAG(f.label) + ' ' + T('صدرت: ', 'Issued: ') + fT(f.issuedAt) + '</p>' + tbl([T('الوقت', 'Time'), T('الرياح', 'Wind'), T('الأمواج', 'Waves'), T('التيار', 'Current'), T('الرؤية', 'Vis.'), T('الحرارة', 'Temp.'), T('الموثوقية', 'Reliab.')], f.series.filter(x => x.h % 3 === 0).map(x => tr(['+' + x.h + ' · ' + fH(x.validAt), N(x.windKn, 1) + ' ' + dirTxt(x.windDir), N(x.waveM, 1) + ' ' + dirTxt(x.waveDir), N(x.currentKn, 1), N(x.visNm, 1), N(x.tempC, 1), N(x.reliability * 100) + '%']))) + '<div class="row end"><button class="btn ghost" data-x>' + T('إغلاق', 'Close') + '</button></div>', 'wide');
  };
  A.wxEdit = d => {
    const a = S().seaAreas.find(x => x.id === d.id), o = S().weatherObservations.find(x => x.areaId === d.id);
    const m = modal('<h3>' + T('تعديل بيانات الطقس – ', 'Edit weather data – ') + esc(L(a.name)) + '</h3><form class="form" id="wf"><div class="grid3">' + field(T('من الساعة', 'From hour'), '<input name="fromH" type="number" min="0" max="48" value="0">') + field(T('إلى الساعة', 'To hour'), '<input name="toH" type="number" min="0" max="48" value="12">') + '</div><div class="grid3">' +
      [['windKn', T('الرياح (kn)', 'Wind (kn)')], ['windDir', T('اتجاه الرياح°', 'Wind dir°')], ['waveM', T('الموج (m)', 'Wave (m)')], ['waveDir', T('اتجاه الموج°', 'Wave dir°')], ['currentKn', T('التيار (kn)', 'Current (kn)')], ['currentDir', T('اتجاه التيار°', 'Current dir°')], ['visNm', T('الرؤية (nm)', 'Visibility (nm)')], ['tempC', T('الحرارة °C', 'Temp °C')]].map(([k, l]) => field(l, '<input name="' + k + '" type="number" step="0.1" placeholder="' + (o[k] != null ? o[k] : '') + '">')).join('') + '</div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('تطبيق وإعادة التحليل', 'Apply & re-analyse') + '</button></div></form>', 'wide');
    $('#wf', m).onsubmit = async e => { e.preventDefault(); const f = e.target, values = {}; for (const k of ['windKn', 'windDir', 'waveM', 'waveDir', 'currentKn', 'currentDir', 'visNm', 'tempC']) values[k] = val(f, k); if (await act('editWeather', { areaId: a.id, fromH: val(f, 'fromH'), toH: val(f, 'toH'), values }, T('حُدّثت المؤشرات وأعيد التحليل', 'Indicators updated; analysis re-run'))) closeModal(); };
  };

  // 7) Proposed integrations
  const NCM_SAMPLE = () => JSON.stringify({ source: 'TEST', records: [{ areaId: 'JED', recordedAt: new Date(S().now - 5 * 60e3).toISOString(), reliability: 0.85, observation: { windKn: 24, windDir: 310, waveM: 2.2, waveDir: 315, currentKn: 1.2, currentDir: 150, visNm: 4, tempC: 27 }, forecast: [{ h: 3, windKn: 29, waveM: 3.0 }, { h: 6, windKn: 33, waveM: 3.8 }] }, { areaId: 'XXX', recordedAt: 'not-a-date', observation: { windKn: 500 } }] }, null, 2);
  OFF.integrations = {
    mount: () => sechead(T('التكاملات المقترحة (Proposed Integration)', 'Proposed integrations'), T('بنية جاهزة للتكامل المستقبلي. لا يوجد اتصال فعلي مع أي جهة؛ كل التبادلات هنا داخل بيئة الاختبار.', 'Architecture ready for future integration. There is no actual connection with any party; all exchanges here are inside the test environment.')) +
      '<div class="tabs">' + [['ncm', 'المركز الوطني للأرصاد', 'National Center for Meteorology'], ['navarea', 'الامتثال الدولي وNAVAREA/NAVTEX', 'Compliance & NAVAREA/NAVTEX'], ['ship', 'شاشة السفينة والميناء', 'Ship & port screens']].map(([k, ar, en]) => '<button class="' + (state.intTab === k ? 'on' : '') + '" data-a="intTab" data-id="' + k + '">' + T(ar, en) + '</button>').join('') + '</div><div id="ibody"></div>',
    upd: () => {
      const s = S(), t = state.intTab;
      if (t === 'ncm') {
        const d = src('ncm'), age = (s.now - d.lastReceivedAt) / H;
        if (!$('#ncmImport')) fill('#ibody', '<div class="grid2"><div class="panel"><h3>' + T('حالة مصدر البيانات', 'Data source status') + '</h3><div id="ncmStatus"></div></div><div class="panel"><h3>' + T('نموذج البيانات الموحد', 'Unified data model') + '</h3><pre class="msg sm" dir="ltr">{\n  "source": "NCM | TEST",\n  "records": [{\n    "areaId": "JED",\n    "recordedAt": "ISO-8601",\n    "reliability": 0.0–1.0,\n    "observation": { "windKn", "windDir", "gustKn", "waveM",\n      "waveDir", "currentKn", "currentDir", "visNm", "tempC" },\n    "forecast": [{ "h": 0–48, ...same fields }]\n  }]\n}</pre><p class="sm"><code>POST /api/integrations/ncm/weather</code> ' + T('(على الخادم، بمفتاح تكامل)', '(on the server, with an integration key)') + '</p></div></div>' +
          '<div class="panel" id="ncmImport"><h3>' + T('واجهة API تجريبية: استقبال بيانات اختبار', 'Test API: receive test data') + '</h3><textarea id="ncmJson" dir="ltr" rows="12" class="mono">' + esc(NCM_SAMPLE()) + '</textarea><div class="row"><button class="btn" data-a="ncmImport">' + T('تحقق واستقبال', 'Validate & receive') + '</button><button class="btn ghost sm" data-a="ncmSample">' + T('إعادة المثال', 'Reset example') + '</button></div><div id="ncmResult"></div></div><div class="panel"><h3>' + T('سجل الاستقبال', 'Receive log') + '</h3><div id="ncmLog"></div></div>');
        fill('#ncmStatus', '<div class="kv"><span>' + T('الحالة', 'Status') + '</span><b>' + B('muted', 'Proposed Integration – ' + T('غير مفعّل', 'not active')) + '</b><span>' + T('مصدر البيانات الحالي', 'Current data') + '</span><b>' + TAG(d.label) + '</b><span>' + T('آخر استقبال', 'Last received') + '</span><b>' + fT(d.lastReceivedAt) + ' (' + rel(d.lastReceivedAt) + ')</b><span>' + T('حداثة البيانات', 'Freshness') + '</span><b>' + (age > 6 ? B('warn', T('قديمة', 'Stale')) : B('ok', T('حديثة', 'Fresh'))) + '</b><span>' + T('سجلات مقبولة / مرفوضة', 'Accepted / rejected') + '</span><b>' + N(d.accepted) + ' / ' + N(d.rejected) + '</b></div>');
        const ev = s.integrationEvents.filter(e => e.integration === 'ncm').slice().reverse();
        fill('#ncmLog', ev.length ? tbl([T('الوقت', 'Time'), T('النتيجة', 'Result'), T('مقبول', 'Accepted'), T('مرفوض', 'Rejected'), T('الأخطاء', 'Errors')], ev.map(e => tr([fTs(e.at), B(e.status === 'accepted' ? 'ok' : e.status === 'partial' ? 'warn' : 'crit', e.status), N(e.accepted), N(e.rejected), '<span class="sm">' + esc((e.errors || []).map(x => (x.areaId || '#' + x.index) + ': ' + x.errors.join(', ')).join(' | ')) + '</span>']))) : empty(T('لم تُستقبل دفعات بعد عبر واجهة الاختبار.', 'No batches received via the test interface yet.')));
      } else if (t === 'navarea') {
        const W = s.wwnws.levels;
        const comp = '<div class="panel"><h3>' + T('مستويات التحذيرات الملاحية – IMO A.706(17) المعدّل (WWNWS)', 'Navigational warning levels – IMO A.706(17) as amended (WWNWS)') + '</h3>' + tbl([T('نوع التحذير', 'Warning type'), T('النطاق', 'Coverage'), T('وسيلة النشر', 'Dissemination'), T('في مَرسى', 'In MARSA')], ['NAVAREA', 'SUBAREA', 'COASTAL', 'LOCAL'].map(k => tr(['<b>' + esc(L(W[k].name)) + '</b>', esc(L(W[k].area)), esc(L(W[k].means)), { NAVAREA: T('رسالة اختبار موجهة لمنسق NAVAREA IX فقط', 'Test message addressed to the NAVAREA IX coordinator only'), SUBAREA: T('لا يوجد منسق منطقة فرعية في بيانات الاختبار', 'No Sub-area coordinator in the test data'), COASTAL: T('رسالة NAVTEX اختبارية لمحطة سعودية، أو EGC خارج التغطية', 'Test NAVTEX message to a Saudi station, or EGC outside coverage'), LOCAL: T('إنذار مباشر للسفن داخل المياه الإقليمية عبر شاشة الجسر/VHF؛ أداة NAVTEX ترفض النطاق المحلي', 'Direct alert to vessels inside territorial waters via bridge screen/VHF; the NAVTEX tool rejects local scope') }[k]]))) +
          '</div>';
        fill('#ibody', comp + '<div class="grid2"><div class="panel"><h3>' + T('الجهات المعنية (للتحقق الرسمي)', 'Parties (to be officially verified)') + '</h3>' + tbl([T('الجهة', 'Party'), T('الدور', 'Role'), 'B1'], s.stations.map(st => tr([esc(L(st.name)), st.role === 'COORDINATOR' ? T('مركز تنسيق NAVAREA – يصدر تحذيرات NAVAREA', 'NAVAREA coordinator – issues NAVAREA warnings') : T('محطة بث NAVTEX ساحلية', 'Coastal NAVTEX transmitting station'), esc(st.b1 || '—')]))) + '</div>' +
          '<div class="panel"><h3>' + T('نموذج بيانات الإنذار', 'Warning data model') + '</h3><pre class="msg sm" dir="ltr">{\n  "schema": "marsa.navwarning.test/v1",\n  "subjectIndicator": "A | B | E | L",\n  "scope": "COASTAL | NAVAREA | SUBAREA (LOCAL rejected)",\n  "addressee": { "id", "role": "COORDINATOR | NAVTEX", "b1" },\n  "area", "position": { "lat", "lon" },\n  "validFrom", "validTo", "textEn", "textAr",\n  "formatted": "ZCZC ... NNNN",\n  "validationErrors": [], "transmitted": false\n}</pre></div></div>' +
          '<div class="panel"><h3>' + T('سجل التجهيز والإرسال في بيئة الاختبار', 'Preparation and test-dispatch log') + '</h3>' + (s.navtexMessages.length ? tbl([T('الرسالة', 'Message'), T('الحالة', 'Status'), T('الجهة', 'Addressee'), T('آخر حدث', 'Last event'), T('الاستجابة', 'Response')], s.navtexMessages.slice().reverse().map(m => { const st = s.stations.find(x => x.id === m.targetId), dsp = m.dispatches.slice(-1)[0], h = m.history.slice(-1)[0]; return tr([esc(m.number), esc(m.status), st ? esc(L(st.name)) : '—', esc(h.s) + ' · ' + fTs(h.at), dsp ? '<code class="sm">' + esc(dsp.endpoint) + '</code> → ' + esc(dsp.response.status) : '—']); })) : empty(T('لا توجد رسائل بعد.', 'No messages yet.'))) + '<p class="sm"><button class="btn sm ghost" data-a="secGo" data-id="bulletins">' + T('فتح أداة إعداد الرسائل', 'Open the message tool') + '</button></p></div>');
      } else fill('#ibody', '<div class="panel"><h3>' + T('شاشة جسر السفينة', 'Ship Bridge screen') + '</h3><p>' + T('تستقبل الإنذارات المسجلة في قاعدة بيانات الاختبار عبر قناة «شاشة جسر السفينة (اختبار)». حالة «تم الاستلام» تُسجل عند عرض الإنذار على الشاشة، و«تم التأكيد» عند ضغط الطاقم زر التأكيد، وتظهر فورًا في واجهة ضابط الميناء.', 'Receives the alerts stored in the test database through the “Ship Bridge screen (test)” channel. “Received” is recorded when the alert is shown on screen and “Acknowledged” when the crew presses the confirm button; both appear immediately in the Port Officer interface.') + '</p><p class="sm muted">' + T('السفن بقناة «AIS» لا ترجع تأكيدًا، والسفن بلا قناة تُسجل «تعذر الإرسال».', 'Vessels on the “AIS” channel return no confirmation; vessels with no channel are recorded as “Failed”.') + '</p></div><div class="panel"><h3>' + T('واجهة الميناء', 'Port screen') + '</h3><p>' + T('واجهة ضابط الميناء تدير حركة السفن والمخاطر والإنذارات والنشرات وحالة الموانئ والمسارات البديلة على قاعدة بيانات الاختبار المشتركة نفسها.', 'The Port Officer interface manages vessel traffic, risks, alerts, bulletins, port status and alternative routes on the same shared test database.') + '</p></div>');
    }
  };
  A.intTab = d => { state.intTab = d.id; renderView(); };
  A.secGo = d => { state.sec = d.id; renderView(); };
  A.ncmSample = () => { $('#ncmJson').value = NCM_SAMPLE(); };
  A.ncmImport = async () => {
    let payload; try { payload = JSON.parse($('#ncmJson').value); } catch (e) { fill('#ncmResult', '<p class="note bad">' + T('صيغة JSON غير صالحة: ', 'Invalid JSON: ') + esc(e.message) + '</p>'); return; }
    const r = await act('importWeather', payload, false); if (!r) return;
    fill('#ncmResult', '<p class="note ' + (r.rejected.length ? 'warn' : 'ok') + '">' + T('قُبل ', 'Accepted ') + r.accepted + T(' ورُفض ', ', rejected ') + r.rejected.length + '</p>' + (r.rejected.length ? '<ul class="errs">' + r.rejected.map(x => '<li>' + esc((x.areaId || '#' + x.index) + ': ' + x.errors.join(', ')) + '</li>').join('') + '</ul>' : '') + (r.warnings.length ? '<ul class="sm">' + r.warnings.map(x => '<li>' + esc(x.areaId + ': ' + x.warnings.join(', ')) + '</li>').join('') + '</ul>' : ''));
  };

  // 8) Audit
  OFF.audit = {
    mount: () => sechead(T('سجل العمليات', 'Operations log'), T('سجل تلقائي لكل عملية، متسلسل بالتجزئة SHA-256 بحيث يكشف أي تعديل لاحق.', 'Automatic log of every operation, SHA-256 hash-chained so later edits are detectable.'), '<button class="btn sm ghost" data-a="verify">' + T('التحقق من سلامة السجل', 'Verify log integrity') + '</button><button class="btn sm ghost" data-a="auditCsv">CSV</button>') + '<div id="vres"></div><div class="panel"><div id="alog"></div></div>',
    upd: () => {
      const s = S();
      fill('#vres', state.verify ? '<p class="note ' + (state.verify.ok ? 'ok' : 'bad') + '">' + (state.verify.ok ? T('السجل سليم: ', 'Log intact: ') + N(state.verify.checked) + T(' عملية', ' operations') + ' · <code>' + esc(state.verify.head) + '</code>' : T('انكسر السجل عند العملية ', 'Log broken at #') + state.verify.brokenAt) + '</p>' : '');
      fill('#alog', tbl(['#', T('الوقت', 'Time'), T('المنفذ', 'Actor'), T('العملية', 'Operation'), T('الوصف', 'Summary')], s.auditLogs.slice().reverse().map(a => tr([N(a.seq), fTs(a.ts) + '<div class="sm muted">' + fD(a.ts) + '</div>', esc(a.actor), '<code class="sm">' + esc(a.action) + '</code>', esc(L(a.summary))]))));
    }
  };
  A.verify = async () => { const r = await act('verifyAudit', {}, false); if (r) { state.verify = r; update(); } };
  A.auditCsv = () => { const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; download('marsa-operations-log.csv', '﻿' + [['seq', 'time', 'actor', 'action', 'summary_ar', 'summary_en', 'hash']].concat(S().auditLogs.map(a => [a.seq, new Date(a.ts).toISOString(), a.actor, a.action, a.summary.ar, a.summary.en, a.hash])).map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); };

  // ---------- Ship Bridge ----------
  const BR = {
    mount: () => '<div id="sndhint"></div><div id="bstatus"></div><div class="grid2b"><div class="panel"><h2>' + T('المسار البديل المقترح', 'Suggested alternative route') + '</h2><div id="broute"></div></div><div class="panel"><h2>' + T('بيانات السفينة', 'Vessel data') + '</h2><div id="bvessel"></div></div></div><div class="panel"><h2>' + T('سجل الإنذارات', 'Alert log') + '</h2><div id="blog"></div></div>',
    upd: () => {
      const s = S(), v = s.vessels[0]; if (!v) { fill('#bstatus', empty(T('حُذف سجل هذه السفينة.', 'This vessel record was deleted.'))); return; }
      fill('#sndhint', Sound.on && !Sound.unlocked ? '<button class="sndhint" data-a="enableSound">' + ic(I_SOUND) + T('اضغط هنا لتفعيل صوت الإنذار على هذا الجهاز', 'Tap here to enable the alarm sound on this device') + '</button>' : '');
      const dls = s.deliveryRecords.slice().sort((a, b) => (b.dispatchedAt || 0) - (a.dispatchedAt || 0));
      const open = dls.filter(d => !d.ackAt && ['dispatched', 'received'].includes(d.status) && !['cancelled', 'expired'].includes((alertById(d.alertId) || {}).status));
      const unseen = dls.filter(d => d.status === 'dispatched' && !state.sentReceived.has(d.id)).map(d => d.id);
      if (unseen.length && document.visibilityState === 'visible') { unseen.forEach(id => state.sentReceived.add(id)); client.call('markReceived', { ids: unseen }).catch(() => unseen.forEach(id => state.sentReceived.delete(id))); }
      fill('#bstatus', open.length ? open.map(d => { const a = alertById(d.alertId) || {}; return '<div class="bigalert lv-critical"><div class="ba-head"><span class="ba-icon">!</span><div><b>' + esc(L(a.title)) + '</b><span>' + T('إنذار من مَرسى (اختبار)', 'MARSA alert (test)') + ' · ' + esc(a.number) + ' · ' + lv(a.severity) + '</span></div></div><div class="ba-body"><p>' + esc(L(a.body)) + '</p><p><b>' + T('التعليمات: ', 'Instructions: ') + '</b>' + esc(L(a.instructions)) + '</p><p class="sm">' + T('موقع الخطر: ', 'Hazard location: ') + esc(L(a.areaName)) + ' · ' + T('الوقت المتوقع: ', 'Expected: ') + (a.riskSnapshot ? fT(a.riskSnapshot.start) + ' – ' + fT(a.riskSnapshot.end) : fT(a.validFrom) + ' – ' + fT(a.validTo)) + '</p></div><button class="btn big light" data-a="ackAlert" data-id="' + d.id + '">' + T('تأكيد استلام الإنذار', 'Confirm receipt') + '</button></div>'; }).join('')
        : '<div class="calmline">' + T('لا توجد إنذارات بانتظار التأكيد.', 'No alerts awaiting confirmation.') + '</div>');
      const ar = s.alternativeRoutes.slice(-1)[0];
      if (ar) {
        if (!$('#bmap')) fill('#broute', '<div class="mapbox mid" id="bmap"></div><div class="maplegend"><span class="lg z rk-critical"></span>' + T('منطقة الخطر', 'Hazard area') + ' <span class="lg ln cur"></span>' + T('المسار الحالي', 'Current route') + ' <span class="lg ln alt"></span>' + T('المسار المقترح', 'Suggested route') + '</div><div id="rinfo"></div>');
        const mp = ensureMap('bmap', $('#bmap'), {}); mp.setData(baseMap({ zones: altZones(ar), routes: altRoutes(ar), vessels: s.vessels.map(x => mapV(x, { mine: true })) }));
        if ($('#bmap').dataset.fit !== ar.id) { $('#bmap').dataset.fit = ar.id; mp.fitPoints(ar.current.coords.slice(0, 6).concat(ar.alternative ? ar.alternative.coords.slice(0, 8) : []).concat(ar.riskPoly), 1); }
        fill('#rinfo', routeDetail(ar));
      } else fill('#broute', '<p class="muted">' + T('لا يوجد مسار بديل مقترح.', 'No alternative route suggested.') + '</p>');
      fill('#bvessel', '<div class="kv">' + [['MMSI', '<code>' + esc(v.mmsi) + '</code>'], ['IMO', '<code>' + esc(v.imo) + '</code>'], [T('الموقع', 'Position'), ll(v.pos) + ' ' + TAG('Test AIS Data')], [T('السرعة / الاتجاه', 'Speed / course'), N(v.sog, 1) + ' kn / ' + N(v.cog) + '°'], [T('الغاطس', 'Draft'), N(v.draft, 1) + ' m'], [T('الوجهة', 'Destination'), esc(pname(v.destId)) + (v.etaAt ? ' · ' + fT(v.etaAt) : '')]].map(([k, x]) => '<span>' + k + '</span><b>' + x + '</b>').join('') + '</div>');
      fill('#blog', dls.length ? tbl([T('الإنذار', 'Alert'), T('الخطورة', 'Severity'), T('وقت الاستلام', 'Received'), T('حالة التأكيد', 'Confirmation'), T('مسار بديل', 'Alt. route')], dls.map(d => { const a = alertById(d.alertId) || {}, rr = s.alternativeRoutes.find(x => x.alertId === d.alertId); return tr(['<b>' + esc(a.number) + '</b><div class="sm">' + esc(L(a.title)) + '</div>', lvB(a.severity), fT(d.receivedAt || d.dispatchedAt), d.ackAt ? B('ok', T('مؤكد ', 'Confirmed ') + fH(d.ackAt)) : ['cancelled', 'expired'].includes(a.status) ? B('muted', T(...AST[a.status])) : B('crit', T('بانتظار التأكيد', 'Awaiting')), rr ? ({ reroute: T('تحويل المسار', 'Reroute'), wait: T('انتظار', 'Wait'), none: '—' })[rr.kind] : '—']); })) : empty(T('لا توجد إنذارات سابقة.', 'No previous alerts.')));
      const ids = new Set(dls.map(d => d.id));
      if (state.seenDeliv === null) { state.seenDeliv = ids; if (open.length) showAlarm(open[0]); }
      else { const fresh = dls.filter(d => !state.seenDeliv.has(d.id)); fresh.forEach(d => state.seenDeliv.add(d.id)); const f0 = fresh.find(d => ['dispatched', 'received'].includes(d.status)); if (f0) showAlarm(f0); }
      if (!open.length) Sound.stopRepeat();
    }
  };
  function showAlarm(d, test) {
    const a = test ? { number: 'TEST', severity: 'critical', title: { ar: 'اختبار الإنذار', en: 'Alarm test' }, body: { ar: 'اختبار لنظام الإنذار الصوتي والمرئي.', en: 'Test of the audio-visual alarm.' }, instructions: { ar: 'لا يلزم أي إجراء.', en: 'No action required.' }, areaName: { ar: '—', en: '—' }, validFrom: S().now, validTo: S().now } : alertById(d.alertId);
    if (!a) return;
    $$('.alarm-wrap').forEach(x => x.remove());
    const el = document.createElement('div'); el.className = 'alarm-wrap';
    el.innerHTML = '<div class="alarm lv-critical" role="alertdialog" aria-modal="true"><div class="al-head"><span class="al-icon">!</span><div><b>' + (test ? T('اختبار', 'TEST') : T('إنذار من مَرسى', 'MARSA ALERT')) + '</b><span>' + T('الخطورة: ', 'Severity: ') + lv(a.severity) + ' · ' + esc(a.number) + ' · TEST DATA</span></div></div><h2>' + esc(L(a.title)) + '</h2><p>' + esc(L(a.body)) + '</p>' +
      '<div class="kv"><span>' + T('موقع الخطر', 'Hazard location') + '</span><b>' + esc(L(a.areaName)) + '</b><span>' + T('الوقت المتوقع', 'Expected time') + '</span><b>' + (a.riskSnapshot ? fT(a.riskSnapshot.start) + ' – ' + fT(a.riskSnapshot.end) : fT(a.validFrom) + ' – ' + fT(a.validTo)) + '</b><span>' + T('التعليمات', 'Instructions') + '</span><b>' + esc(L(a.instructions)) + '</b><span>' + T('صدر', 'Issued') + '</span><b>' + fT(a.dispatchedAt || S().now) + ' · ' + T('ضابط الميناء – مَرسى', 'Port Officer – MARSA') + '</b></div>' +
      (test ? '<button class="btn big light" data-a="closeAlarm">' + T('إغلاق الاختبار', 'Close test') + '</button>' : '<label class="offname">' + T('اسم الضابط المناوب', 'Officer of the watch') + '<input id="alof" value="' + esc(T('ضابط المناوبة', 'Officer of the watch')) + '"></label><button class="btn big light" data-a="ackFromAlarm" data-id="' + d.id + '">' + T('تأكيد استلام الإنذار', 'Confirm receipt') + '</button><button class="btn ghost light sm" data-a="closeAlarm">' + T('عرض لاحقًا', 'Later') + '</button>') + '</div>';
    document.body.appendChild(el); Sound.ring(); if (!test) Sound.repeat();
  }
  A.enableSound = () => { Sound.unlock(); setTimeout(() => { Sound.ring(true); update(); }, 150); toast(T('تم تفعيل صوت الإنذار', 'Alarm sound enabled'), 'ok'); };
  A.testAlarm = () => { Sound.unlock(); showAlarm(null, true); };
  A.closeAlarm = () => { $$('.alarm-wrap').forEach(x => x.remove()); Sound.stopRepeat(); };
  A.ackFromAlarm = async d => { const name = ($('#alof') || {}).value || T('ضابط المناوبة', 'Officer of the watch'); if (await act('acknowledge', { id: d.id, officer: name }, T('أُرسل تأكيد الاستلام', 'Receipt confirmed'))) A.closeAlarm(); };
  A.ackAlert = d => showAlarm(S().deliveryRecords.find(x => x.id === d.id));

  // ---------- Boot ----------
  client.subscribe(s => { if (state.view === 'home' || !state.snap) return; state.snap = s; update(); });
  (async () => { if (window.claude && window.claude.use) window.claude.use('downloads').catch(() => null); renderHome(); })();
})();
