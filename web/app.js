/* MARSA web app v3 — two interfaces: Port Officer (operations) and Ship Bridge (alerts on board). */
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
  const fISO = ts => ts ? fD(ts) + ' ' + new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' }).format(ts) : '—';
  const H = 3600e3;
  const rel = ts => { if (!ts) return '—'; const s = Math.round((S().now - ts) / 1000), a = Math.abs(s); const v = a < 60 ? a + T(' ث', 's') : a < 3600 ? Math.round(a / 60) + T(' د', 'm') : a < 86400 ? N(a / 3600, a < 36000 ? 1 : 0) + T(' س', 'h') : Math.round(a / 86400) + T(' يوم', 'd'); return s >= 0 ? T('منذ ' + v, v + ' ago') : T('بعد ' + v, 'in ' + v); };
  const B = (cls, txt) => '<span class="b b-' + cls + '">' + esc(txt) + '</span>';
  const SIM = () => '<span class="sim" title="' + esc(T('بيانات تجريبية – ليست اتصالًا حيًا', 'Demo data – not a live connection')) + '">' + T('تجريبي', 'SIM') + '</span>';
  const ll = p => p ? N(Math.abs(p[1]), 2) + '°' + (p[1] >= 0 ? 'N' : 'S') + ' ' + N(Math.abs(p[0]), 2) + '°' + (p[0] >= 0 ? 'E' : 'W') : '—';
  const dir = d => T(['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'], ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[Math.round(((d % 360) + 360) % 360 / 45) % 8];

  // ---------- Vocabulary ----------
  const LV = { normal: ['عادي', 'Normal'], low: ['منخفض', 'Low'], moderate: ['متوسط', 'Medium'], medium: ['متوسط', 'Medium'], high: ['مرتفع', 'High'], critical: ['حرج', 'Critical'] };
  const lv = l => T(...(LV[l] || [l, l]));
  const lvB = l => B('lv-' + (l === 'medium' ? 'moderate' : l), lv(l));
  const RANK = l => ['normal', 'low', 'moderate', 'high', 'critical'].indexOf(l === 'medium' ? 'moderate' : l);
  const CAUSE = { waves: ['أمواج عالية', 'High waves'], wind: ['رياح شديدة', 'Strong winds'], visibility: ['انخفاض الرؤية', 'Reduced visibility'] };
  const WCAT = { severe_weather: ['طقس شديد', 'Severe weather'], dangerous_winds: ['رياح خطرة', 'Dangerous winds'], high_waves: ['أمواج عالية', 'High waves'], reduced_visibility: ['انخفاض الرؤية', 'Reduced visibility'], navigation_hazard: ['خطر ملاحي', 'Navigation hazard'], port_closure: ['إغلاق ميناء', 'Port closure'], port_restriction: ['قيود في الميناء', 'Port restriction'], congestion: ['ازدحام', 'Congestion'], other: ['نشرة / إشعار', 'Notice'] };
  const wcat = c => T(...(WCAT[c] || [c, c]));
  // local alert status (as the officer sees it)
  const AST = { draft: ['تم إنشاؤه', 'Created'], returned: ['تم إنشاؤه', 'Created'], pending_approval: ['بانتظار الإرسال', 'Pending send'], approved: ['بانتظار الإرسال', 'Pending send'], distributed: ['تم الإرسال', 'Sent'], cancelled: ['ملغى', 'Cancelled'], rejected: ['ملغى', 'Cancelled'], expired: ['منتهي', 'Expired'] };
  const ASTC = { draft: 'muted', returned: 'muted', pending_approval: 'warn', approved: 'warn', distributed: 'ok', cancelled: 'muted', rejected: 'muted', expired: 'muted' };
  const astB = s => B(ASTC[s] || 'muted', T(...(AST[s] || [s, s])));
  // per-vessel delivery status
  const DST = { sent: ['تم الإرسال', 'Sent'], delivered: ['وصل للسفينة', 'Delivered'], received: ['تم الاستلام', 'Received'], acknowledged: ['أكد الطاقم', 'Confirmed'], accepted: ['أكد الطاقم', 'Confirmed'], rejected: ['أكد الطاقم', 'Confirmed'], alt_action: ['أكد الطاقم', 'Confirmed'], unacknowledged: ['لم يؤكد – مُصعّد', 'Not confirmed – escalated'], failed: ['تعذر الإرسال', 'Delivery failed'], cancelled: ['ملغى', 'Cancelled'] };
  const DSTC = { sent: 'info', delivered: 'info', received: 'warn', acknowledged: 'ok', accepted: 'ok', rejected: 'ok', alt_action: 'ok', unacknowledged: 'crit', failed: 'crit', cancelled: 'muted' };
  const dstB = d => B(DSTC[d.status] || 'muted', T(...(DST[d.status] || [d.status, d.status])));
  const CH = { marsa_app: ['تطبيق جسر السفينة', 'Ship Bridge app'], ais_srm: ['رسالة سلامة AIS (تجريبي)', 'AIS safety message (sandbox)'], none: ['لا توجد قناة', 'No channel'] };
  // navigational notice pipeline
  const NST = { drafting: ['قيد الإنشاء', 'Drafting'], ready: ['جاهزة للإرسال', 'Ready to send'], sent_port: ['أرسلت إلى الميناء', 'Sent to port'], sent_karachi: ['أرسلت إلى محطة كراتشي', 'Sent to Karachi'], acknowledged: ['تم تأكيد الاستلام', 'Receipt confirmed'], awaiting_official: ['بانتظار الإصدار الرسمي', 'Awaiting official issuance'], published: ['صدرت رسميًا', 'Officially issued'], cancelled: ['ملغاة', 'Cancelled'], sent: ['أُرسلت', 'Sent'] };
  const nst = s => T(...(NST[s] || [s, s]));
  const NSTC = { drafting: 'muted', ready: 'warn', sent: 'info', awaiting_official: 'info', published: 'ok', cancelled: 'muted' };
  const SCOPE = { LOCAL: ['محلي (موانئ)', 'Local (ports)'], COASTAL: ['ساحلي (موانئ ومحطاتها)', 'Coastal (ports & stations)'], INTERNATIONAL: ['إقليمي/دولي (كراتشي)', 'Regional/international (Karachi)'] };
  const OPT = { reroute: ['مسار بديل يتجنب منطقة الخطر', 'Alternative route avoiding the hazard'], wait: ['الانتظار في منطقة آمنة', 'Wait in a safe area'], alt_port: ['التوجه إلى ميناء بديل', 'Proceed to an alternative port'], none: ['لا يوجد خيار آمن مؤكد', 'No verified safe option'] };
  const opt = k => T(...(OPT[k] || [k, k]));
  const VST = { underway: ['مبحرة', 'Underway'], anchored: ['راسية بالمخطاف', 'At anchor'], moored: ['على الرصيف', 'Moored'], holding: ['في منطقة انتظار', 'Waiting area'], out_of_area: ['خارج التغطية', 'Out of area'] };
  const vst = s => T(...(VST[s] || [s, s]));
  const VTYPE = { container: ['حاويات', 'Container'], tanker: ['ناقلة', 'Tanker'], bulk: ['بضائع سائبة', 'Bulk'], general: ['بضائع عامة', 'General cargo'], roro: ['دحرجة', 'Ro-Ro'], lng: ['غاز مسال', 'LNG'] };
  const vtype = s => T(...(VTYPE[s] || [s, s]));

  const LOGO = '<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#0b2545"/><path d="M20 7v22M13 12h14M10 22c1.5 6 6 9 10 9s8.5-3 10-9" stroke="#2ec4b6" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="20" cy="9" r="2.6" fill="#fff"/><path d="M7 30c3 0 3-2 6.5-2S17 30 20 30s3.5-2 6.5-2 3.5 2 6.5 2" stroke="#7fb3d5" stroke-width="1.6" fill="none"/></svg>';
  const SHIP_ICON = '<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M14 62h68l-8 16H22z" fill="#2ec4b6"/><path d="M26 62V44h44v18" fill="none" stroke="#fff" stroke-width="4"/><path d="M36 44V32h24v12" fill="none" stroke="#fff" stroke-width="4"/><path d="M42 32v-8h12v8" fill="#fff"/><circle cx="38" cy="53" r="2.6" fill="#fff"/><circle cx="48" cy="53" r="2.6" fill="#fff"/><circle cx="58" cy="53" r="2.6" fill="#fff"/><path d="M8 86c6 0 6-4 13-4s7 4 13.5 4 7-4 13.5-4 7 4 13.5 4 7-4 13.5-4 6.5 4 12.5 4" stroke="#7fb3d5" stroke-width="3" fill="none"/></svg>';
  const OFFICER_ICON = '<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 10 18 22v22c0 20 13 34 30 40 17-6 30-20 30-40V22z" fill="none" stroke="#2ec4b6" stroke-width="4"/><circle cx="48" cy="42" r="14" fill="none" stroke="#fff" stroke-width="3.5"/><path d="M48 28v28M34 42h28" stroke="#fff" stroke-width="2.4"/><path d="M48 42l9-6" stroke="#2ec4b6" stroke-width="3.5" stroke-linecap="round"/><path d="M30 70c5-6 11-8 18-8s13 2 18 8" stroke="#7fb3d5" stroke-width="3" fill="none"/></svg>';
  const ic = d => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  const I_HOME = 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10', I_SOUND = 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14', I_BELL = 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z';

  // ---------- Client: in-browser service, or the MARSA Node server ----------
  function localClient() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('marsa.db.v4') || 'null'); } catch (e) { saved = null; }
    const store = new MarsaService.MemoryStore(saved || undefined);
    let svc;
    try { svc = MarsaService.createService({ store }); svc.snapshot(store.get('users', 'U3')); } catch (e) { store.clear(); svc = MarsaService.createService({ store }); }
    let user = null, subs = [], lastSaved = 0, dirty = false;
    svc.onChange(() => { dirty = true; });
    const persist = () => { if (!dirty || Date.now() - lastSaved < 3000) return; try { localStorage.setItem('marsa.db.v4', JSON.stringify(store.dump())); lastSaved = Date.now(); dirty = false; } catch (e) { /* storage unavailable: keep in memory */ } };
    const fresh = () => user && store.get('users', user.id);
    const emit = () => { const u = fresh(); if (u) { const s = svc.snapshot(u); subs.forEach(f => f(s)); } };
    setInterval(() => { try { svc.tick(); } catch (e) { console.error(e); } emit(); persist(); }, 1000);
    return {
      mode: 'local',
      async enter(userId) { const r = store.get('users', userId); if (!r || !r.active) throw new Error('NO_USER'); user = r; return svc.snapshot(r); },
      leave() { user = null; },
      async bridges() { return store.all('users').filter(u => u.bridge && u.active).map(u => { const v = store.get('vessels', u.vesselId); return v && { userId: u.id, id: v.id, name: v.name, mmsi: v.mmsi, type: v.type, status: v.status, destId: v.destId, pos: v.pos }; }).filter(Boolean); },
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
      async enter(userId) { const j = await req('/api/demo-login', { userId }); token = j.token; clearInterval(timer); timer = setInterval(poll, 1500); return j.snapshot; },
      leave() { if (token) req('/api/logout', {}).catch(() => {}); token = null; clearInterval(timer); },
      async bridges() { return (await req('/api/bridges')).vessels; },
      async call(m, a) { const j = await req('/api/rpc/' + m, a || {}); poll(); return j.result; },
      subscribe(f) { subs.push(f); }
    };
  }
  const client = window.MARSA_SERVER ? serverClient() : localClient();

  // ---------- State ----------
  const state = { snap: null, view: 'home', tab: 'map', selVessel: null, selAlert: null, selNotice: null, selRec: null, maps: {}, seenDeliv: null, alarmQueue: [], sentDelivered: new Set(), sentReceived: new Set(), verify: null };
  try { const l = localStorage.getItem('marsa.lang'); if (l === 'en' || l === 'ar') I.lang = l; } catch (e) { /* ignore */ }
  const S = () => state.snap;
  const me = () => S().me;
  const port = id => S().ports.find(p => p.id === id);
  const pname = id => L((port(id) || {}).name) || id || '—';
  const vessel = id => S().vessels.find(v => v.id === id);
  const vname = id => (vessel(id) || {}).name || id;
  const warning = id => S().warnings.find(w => w.id === id);

  function toast(msg, kind) { const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg; ($('#toasts') || document.body).appendChild(el); setTimeout(() => el.classList.add('out'), 3600); setTimeout(() => el.remove(), 4100); }
  const ERR = { disclaimer_required: ['يجب الإقرار ببيان المسؤولية أولًا', 'Please acknowledge the responsibility statement first'], officialRef: ['أدخل رقم الإصدار الرسمي', 'Enter the official issuance reference'], state: ['لا يمكن تنفيذ الإجراء في الحالة الحالية', 'Not allowed in the current state'], officer: ['أدخل اسم الضابط', 'Enter the officer name'], reason: ['اكتب السبب', 'Enter the reason'], title: ['العنوان بالعربية والإنجليزية مطلوب', 'Title in Arabic and English is required'], window: ['نافذة زمنية غير صحيحة', 'Invalid time window'] };
  async function act(m, a, okMsg) {
    try { const r = await client.call(m, a); if (okMsg !== false) toast(okMsg || T('تم', 'Done'), 'ok'); return r || true; }
    catch (e) { const msg = String(e.message || e), k = msg.split(':')[1]; toast(msg.startsWith('FORBIDDEN') ? T('لا تملك صلاحية لهذا الإجراء', 'Not permitted') : ERR[k] ? T(...ERR[k]) : T('خطأ: ', 'Error: ') + msg, 'bad'); return null; }
  }
  function modal(html, cls) { closeModal(); const w = document.createElement('div'); w.className = 'modal-wrap'; w.innerHTML = '<div class="modal ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>'; w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-x]')) closeModal(); }); document.body.appendChild(w); const f = w.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea'); if (f) f.focus(); return w.querySelector('.modal'); }
  function closeModal() { $$('.modal-wrap').forEach(x => x.remove()); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('.modal-wrap')) closeModal(); });
  const val = (root, n) => { const el = root.querySelector('[name="' + n + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : null; };
  const discBlock = () => '<div class="discbox"><div class="disc compact"><b>' + T('بيان المسؤولية', 'Responsibility statement') + '</b><p>' + esc(L(S().disclaimer)) + '</p></div><label class="chk"><input type="checkbox" name="disc"><span>' + T('اطلعت على بيان المسؤولية وأعتمد هذا الإجراء بصفتي الضابط المخول', 'I have read the statement and authorise this action as the responsible officer') + '</span></label></div>';
  const discOk = f => { if (f.querySelector('[name=disc]').checked) return true; toast(T(...ERR.disclaimer_required), 'bad'); return false; };
  const prevHtml = new WeakMap();
  function fill(sel, html) { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) return; if (prevHtml.get(el) !== html) { el.innerHTML = html; prevHtml.set(el, html); } }
  const tbl = (cols, rows, cls) => '<div class="scroll"><table class="tbl stack ' + (cls || '') + '"><thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  const tr = (cells, attrs) => '<tr' + (attrs || '') + '>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
  const empty = txt => '<p class="muted empty">' + esc(txt) + '</p>';

  // ---------- Sound: bell alarm (Web Audio), testable ----------
  // The bell is rendered once into a WAV file and played with an <audio> element: on phones (iOS in particular)
  // media playback is allowed after one tap and is not muted by the silent switch the way Web Audio is.
  const Sound = (() => {
    let on = true; try { on = localStorage.getItem('marsa.sound') !== '0'; } catch (e) { /* ignore */ }
    const RING_S = 5, BELL_F = 440, GAP = .62, SR = 22050;
    let audio = null, unlocked = false, repeatT = null, ctx = null;
    function bellWav() {
      const n = Math.floor(RING_S * SR), buf = new Float32Array(n), parts = [[1, 1, 3.2], [1.004, .7, 3.0], [.5, .45, 3.6], [2.0, .5, 2.2], [2.76, .35, 1.6], [3.0, .2, 1.2], [5.4, .12, .7]];
      for (let k = 0; k * GAP < RING_S - 1; k++) {
        const t0 = Math.floor(k * GAP * SR);
        for (const [m, a, d] of parts) {
          const w = 2 * Math.PI * BELL_F * m / SR, len = Math.min(n - t0, Math.floor(d * SR)), att = Math.floor(.006 * SR), dec = Math.log(1e-4) / (len - att);
          for (let i = 0; i < len; i++) buf[t0 + i] += a * (i < att ? i / att : Math.exp(dec * (i - att))) * Math.sin(w * i);
        }
      }
      let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
      const g = .97 / (peak || 1), dv = new DataView(new ArrayBuffer(44 + n * 2)), str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
      str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) { const v = Math.tanh(buf[i] * g * 1.4) / Math.tanh(1.4); dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true); }
      return URL.createObjectURL(new Blob([dv.buffer], { type: 'audio/wav' }));
    }
    try { audio = new Audio(bellWav()); audio.preload = 'auto'; audio.setAttribute('playsinline', ''); } catch (e) { audio = null; }
    function unlock() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (unlocked || !audio) return;
      audio.muted = true;
      const p = audio.play(); if (p && p.then) p.then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; unlocked = true; update && update(); }).catch(() => { audio.muted = false; });
    }
    function ring(force) {
      if (!on && !force) return; unlock();
      if (audio) { try { audio.muted = false; audio.volume = 1; audio.currentTime = 0; const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* blocked */ } }
    }
    return {
      get on() { return on; }, get unlocked() { return unlocked || !audio; }, ring, unlock,
      toggle() { on = !on; try { localStorage.setItem('marsa.sound', on ? '1' : '0'); } catch (e) { /* ignore */ } if (on) ring(true); else { this.stopRepeat(); if (audio) audio.pause(); } },
      repeat() { clearInterval(repeatT); repeatT = setInterval(() => ring(), 12000); },
      stopRepeat() { clearInterval(repeatT); if (audio) audio.pause(); }
    };
  })();
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true });

  // ---------- Global click actions ----------
  const A = {};
  document.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; const f = A[b.dataset.a]; if (f) { e.preventDefault(); f(b.dataset, b); } });
  A.home = () => goHome();
  A.lang = () => { I.lang = I.lang === 'ar' ? 'en' : 'ar'; try { localStorage.setItem('marsa.lang', I.lang); } catch (e) { /* ignore */ } applyLang(); if (state.view === 'home') renderHome(); else renderView(); };
  A.sound = () => { Sound.toggle(); fill('#soundbtn', soundBtnInner()); update(); };
  const soundBtnInner = () => ic(I_SOUND) + '<span>' + (Sound.on ? T('الصوت مفعّل', 'Sound on') : T('الصوت متوقف', 'Sound off')) + '</span>';
  function applyLang() { document.documentElement.lang = I.lang; document.documentElement.dir = I.lang === 'ar' ? 'rtl' : 'ltr'; document.title = T('مَرسى · MARSA', 'MARSA · مَرسى'); for (const k in state.maps) state.maps[k].setLang(I.lang); }

  // ---------- Home: two icons ----------
  function goHome() {
    client.leave(); state.snap = null; state.view = 'home'; state.seenDeliv = null; state.alarmQueue = []; Sound.stopRepeat();
    for (const k in state.maps) state.maps[k].destroy(); state.maps = {};
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    renderHome();
  }
  function renderHome() {
    applyLang();
    document.getElementById('app').innerHTML = '<div class="home"><header class="home-top">' + LOGO + '<div><b>' + T('مَرسى', 'MARSA') + '</b><span>' + T('منصة الإنذار البحري والتنبؤ بالمخاطر للسواحل السعودية', 'Maritime alerting and risk prediction for Saudi coasts') + '</span></div><div class="grow"></div><button class="btn ghost light sm" data-a="lang">' + T('English', 'العربية') + '</button></header>' +
      '<main class="home-main"><h1>' + T('اختر الواجهة', 'Choose an interface') + '</h1><div class="home-cards">' +
      '<button class="hcard" data-a="enterBridge">' + SHIP_ICON + '<b>' + T('جسر السفينة', 'Ship Bridge') + '</b><span>' + T('استقبال إنذارات مَرسى صوتيًا ومرئيًا، وعرض الخطر والمسار البديل', 'Receive MARSA alerts with sound and visuals, see the hazard and the alternative route') + '</span></button>' +
      '<button class="hcard" data-a="enterOfficer">' + OFFICER_ICON + '<b>' + T('ضابط الميناء', 'Port Officer') + '</b><span>' + T('تتبع السفن، التنبؤ بالمخاطر ٤٨ ساعة، الإنذارات المحلية، النشرات الملاحية، والمسارات البديلة', 'Vessel tracking, 48 h risk prediction, local alerts, navigational notices and alternative routes') + '</span></button>' +
      '</div><p class="home-note">' + T('نموذج أولي تفاعلي. بيانات الأرصاد ومواقع السفن وقنوات الإرسال تجريبية وموسومة، ولا يوجد ربط فعلي مع المركز الوطني للأرصاد أو محطة كراتشي أو السفن.', 'Interactive prototype. Met data, vessel positions and delivery channels are labelled demo data; there is no live link with NCM, the Karachi station or ships.') + '</p></main></div><div id="toasts"></div>';
  }
  A.enterOfficer = async () => { try { const s = await client.enter('U3'); state.view = 'officer'; state.tab = 'map'; onSnap(s, true); } catch (e) { toast(String(e.message || e), 'bad'); } };
  A.enterBridge = async () => {
    const list = (await client.bridges()).filter(v => v.status !== 'out_of_area');
    const jed = list.filter(v => v.destId === 'JED').concat(list.filter(v => v.destId !== 'JED'));
    const m = modal('<h3>' + T('اختر السفينة', 'Choose the vessel') + '</h3><p class="muted sm">' + T('في النموذج التجريبي يمكنك فتح جسر أي سفينة لاختبار استقبال الإنذارات.', 'In the prototype you can open any vessel\'s bridge to test alert reception.') + '</p><input class="vsearch" placeholder="' + T('بحث بالاسم أو MMSI', 'Search name or MMSI') + '"><ul class="vpick">' +
      jed.map(v => '<li data-n="' + esc((v.name + ' ' + v.mmsi).toLowerCase()) + '"><button data-a="pickBridge" data-id="' + v.userId + '"><b>' + esc(v.name) + '</b><span>MMSI ' + esc(v.mmsi) + ' · ' + vtype(v.type) + ' · ' + vst(v.status) + '</span></button></li>').join('') + '</ul>', 'wide');
    $('.vsearch', m).oninput = e => { const q = e.target.value.toLowerCase(); $$('.vpick li', m).forEach(li => { li.hidden = q && !li.dataset.n.includes(q); }); };
  };
  A.pickBridge = async d => { closeModal(); try { const s = await client.enter(d.id); state.view = 'bridge'; onSnap(s, true); Sound.unlock(); } catch (e) { toast(String(e.message || e), 'bad'); } };

  // ---------- Shells ----------
  function header(title, sub, extra) {
    return '<header class="top v3">' + '<button class="btn ghost light sm homebtn" data-a="home">' + ic(I_HOME) + '<span>' + T('الرئيسية', 'Home') + '</span></button>' + LOGO + '<div class="ttl"><b>' + esc(title) + '</b><span>' + sub + '</span></div><div class="grow"></div><div class="clock" id="clock"></div>' + (extra || '') +
      '<button class="btn ghost light sm" id="soundbtn" data-a="sound">' + soundBtnInner() + '</button><button class="btn ghost light sm" data-a="lang">' + T('English', 'العربية') + '</button></header>';
  }
  const TABS = () => [['map', 'خريطة تتبع السفن', 'Vessel tracking'], ['predict', 'التنبؤ بالمخاطر ٤٨ ساعة', '48 h risk prediction'], ['alerts', 'الإنذارات المحلية', 'Local alerts'], ['notices', 'النشرات والإشعارات الملاحية', 'Notices & warnings'], ['routes', 'المسارات البديلة', 'Alternative routes']];
  function renderView() {
    applyLang();
    for (const k in state.maps) state.maps[k].destroy(); state.maps = {};
    if (state.view === 'officer') {
      document.getElementById('app').innerHTML = header(T('ضابط الميناء', 'Port Officer'), esc(L(me().name)) + ' · ' + esc(pname(me().portId)), '<button class="btn sm" data-a="scenarios">' + T('سيناريو تجريبي', 'Demo scenario') + '</button><button class="btn ghost light sm" data-a="report">' + T('تقرير PDF', 'PDF report') + '</button><button class="iconbtn bellbtn light" data-a="notes" title="' + T('الإشعارات', 'Notifications') + '">' + ic(I_BELL) + '<i id="ncount"></i></button>') +
        '<nav class="tabs v3" role="tablist">' + TABS().map(([k, ar, en]) => '<button role="tab" class="' + (state.tab === k ? 'on' : '') + '" data-a="tab" data-id="' + k + '">' + T(ar, en) + '<i data-c="' + k + '"></i></button>').join('') + '</nav><main id="main" class="v3main"></main><div id="toasts"></div>';
      $('#main').innerHTML = OFF[state.tab].mount(); if (OFF[state.tab].bind) OFF[state.tab].bind($('#main'));
      const on = $('.tabs.v3 button.on'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    } else {
      const v = S().vessels[0] || {};
      document.getElementById('app').innerHTML = header(T('جسر السفينة', 'Ship Bridge') + ' · ' + (v.name || ''), 'MMSI ' + esc(v.mmsi || '—') + ' · ' + vtype(v.type), '<button class="btn sm" data-a="testAlarm">' + T('اختبار الإنذار', 'Test alarm') + '</button>') + '<main id="main" class="v3main bridge">' + BR.mount() + '</main><div id="toasts"></div>';
      BR.bind($('#main'));
    }
    update();
  }
  A.tab = d => { state.tab = d.id; renderView(); };
  function update() {
    const s = S(); if (!s) return;
    fill('#clock', '<b>' + fTs(s.now) + '</b><span>' + fD(s.now) + ' · ' + T('توقيت السعودية', 'KSA') + '</span>');
    if (state.view === 'officer') {
      const unread = s.notifications.filter(n => !n.readBy.includes(me().id)).length; fill('#ncount', unread ? String(unread) : '');
      const cnt = { predict: s.predictions.filter(p => p.category === 'vessel_exposure' && RANK(p.severity) >= 3).length, alerts: s.warnings.filter(w => w.level === 'LOCAL' && ['draft', 'pending_approval', 'returned'].includes(w.status)).length, notices: (s.navnotices || []).filter(n => ['drafting', 'ready', 'awaiting_official'].includes(n.status)).length, routes: s.recs.filter(r => r.status === 'pending').length };
      $$('.tabs.v3 i[data-c]').forEach(el => { const n = cnt[el.dataset.c]; el.textContent = n ? String(n) : ''; });
      OFF[state.tab].upd($('#main'));
    } else BR.upd($('#main'));
  }

  // ---------- Map helpers ----------
  const atRisk = () => { const m = {}; for (const p of S().predictions) if (p.category === 'vessel_exposure' && RANK(p.severity) >= 3) m[p.vesselId] = p; return m; };
  function alertZones(onlyLive) {
    return S().warnings.filter(w => w.level === 'LOCAL' && (onlyLive ? w.status === 'distributed' : ['distributed', 'pending_approval', 'draft', 'returned'].includes(w.status)))
      .map(w => ({ poly: w.poly, cls: 'local' + (w.status === 'distributed' ? '' : ' pend'), label: { ar: w.number + ' · ' + w.title.ar, en: w.number + ' · ' + w.title.en }, tag: { ar: w.number, en: w.number }, sel: 'warning:' + w.id }));
  }
  function mapData(extra = {}) {
    const s = S(), risk = atRisk();
    return Object.assign({ ports: s.ports.map(p => Object.assign({}, p, { status: p.effectiveStatus })), stations: [], hazards: s.hazards.filter(h => h.status === 'active' && !h.warningId), zones: alertZones(false),
      vessels: s.vessels.map(v => Object.assign({}, v, { affected: !!risk[v.id] || s.deliveries.some(d => d.vesselId === v.id && !['acknowledged', 'cancelled'].includes(d.status)), mine: state.view === 'bridge' })), routes: [] }, extra);
  }
  function ensureMap(key, el, opts) {
    let m = state.maps[key];
    if (m && m.el !== el) { m.destroy(); m = null; }
    if (!m) { m = new SeaMap(el, Object.assign({ lang: I.lang, onSelect: (t, id) => onMapSelect(t, id), layers: { stations: false, navarea: false } }, opts)); state.maps[key] = m; }
    return m;
  }
  function onMapSelect(type, id) {
    if (type === 'vessel' && state.view === 'officer') { state.selVessel = id; if (state.tab !== 'map') { state.tab = 'map'; renderView(); } else update(); }
    if (type === 'warning' && state.view === 'officer') { state.selAlert = id; if (state.tab !== 'alerts') { state.tab = 'alerts'; renderView(); } else update(); }
  }
  const OPT_COLORS = ['#1f8ef1', '#7b61ff', '#2ec4b6'];
  function recRoutes(r, onlyId) {
    const out = [{ kind: 'current', start: r.current.coords[0], nodes: r.current.nodes, label: T('المسار الأصلي', 'Original route'), color: '#8a96a8' }];
    r.options.forEach((o, i) => {
      if (onlyId && o.id !== onlyId) return;
      const k = o.kind === 'wait' && o.holdNode ? o.nodes.indexOf(o.holdNode) : -1;
      if (k >= 0) { // to the waiting area (solid), then the onward leg after the hazard ends (faint)
        out.push({ kind: 'rec', start: o.coords[0], nodes: o.nodes.slice(0, k + 1), color: OPT_COLORS[i % 3], label: T('إلى منطقة الانتظار', 'To the waiting area'), endLabel: true, sel: 'option:' + o.id });
        if (o.nodes.length > k + 1) out.push({ kind: 'alt', start: null, nodes: o.nodes.slice(k), color: OPT_COLORS[i % 3], dim: true, label: T('يُستكمل بعد انتهاء الخطر وإعادة التقييم', 'Continues after the hazard ends and reassessment') });
      } else out.push({ kind: 'rec', start: o.coords[0], nodes: o.nodes, color: OPT_COLORS[i % 3], label: opt(o.kind), endLabel: true, sel: 'option:' + o.id });
    });
    return out;
  }

  // ---------- Port Officer: tabs ----------
  const OFF = {};
  const banner = txt => '<p class="srcnote">' + SIM() + ' ' + esc(txt) + '</p>';

  // 1) Vessel tracking
  OFF.map = {
    mount: () => '<div class="split"><div class="panel mapp"><div class="mapbox tall" id="omap"></div><div class="maplegend"><span class="lg ves"></span>' + T('سفينة', 'Vessel') + ' <span class="lg ves risk"></span>' + T('معرضة للخطر', 'At risk') + ' <span class="lg z local"></span>' + T('منطقة إنذار مَرسى', 'MARSA alert area') + ' <span class="lg port"></span>' + T('ميناء', 'Port') + '</div></div><aside class="panel side-list"><input class="vsearch" id="vq" placeholder="' + T('بحث بالاسم أو MMSI', 'Search name or MMSI') + '"><div id="vdet"></div><div id="vlist"></div></aside></div>' + banner(T('مواقع السفن من محاكي AIS وتتحدث كل ثانية. الربط الفعلي يتطلب مزود AIS معتمدًا.', 'Positions come from an AIS simulator and update every second. A live link needs an authorised AIS provider.')),
    bind: m => { ensureMap('omap', $('#omap', m), { fit: [33.5, 15, 52, 29.5] }); $('#vq', m).oninput = () => update(); },
    upd: () => {
      const s = S(), risk = atRisk(), sel = state.selVessel && vessel(state.selVessel), q = ($('#vq') || {}).value ? $('#vq').value.toLowerCase() : '';
      const routes = sel && sel.routeNodes && sel.routeNodes.length && sel.status === 'underway' ? [{ kind: 'current', start: sel.pos, nodes: sel.routeNodes.slice(sel.nextIdx), color: '#1f8ef1', label: T('المسار المخطط', 'Planned route') }] : [];
      state.maps.omap && state.maps.omap.setData(mapData({ routes }));
      const list = s.vessels.filter(v => v.status !== 'out_of_area' && (!q || (v.name + ' ' + v.mmsi).toLowerCase().includes(q))).sort((a, b) => (risk[b.id] ? RANK(risk[b.id].severity) : 0) - (risk[a.id] ? RANK(risk[a.id].severity) : 0));
      fill('#vlist', '<h3>' + T('السفن', 'Vessels') + ' (' + list.length + ')</h3><ul class="vlist">' + list.map(v => '<li><button class="' + (v.id === state.selVessel ? 'on' : '') + (risk[v.id] ? ' risk' : '') + '" data-a="selVessel" data-id="' + v.id + '"><b>' + esc(v.name) + '</b><span>' + vst(v.status) + (v.status === 'underway' ? ' · ' + N(v.speedKn, 1) + ' kn → ' + esc(pname(v.destId)) : '') + '</span>' + (risk[v.id] ? lvB(risk[v.id].severity) : '') + '</button></li>').join('') + '</ul>');
      if (!sel) { fill('#vdet', '<p class="muted sm">' + T('اضغط على سفينة في الخريطة أو القائمة لعرض بياناتها.', 'Tap a vessel on the map or list to see its data.') + '</p>'); return; }
      const rk = risk[sel.id], dl = s.deliveries.filter(d => d.vesselId === sel.id).slice(-1)[0];
      fill('#vdet', '<div class="vcard"><div class="row between"><h3>' + esc(sel.name) + '</h3><button class="iconbtn sm" data-a="selVessel" data-id="" aria-label="close">✕</button></div><div class="kv"><span>MMSI</span><b><code>' + esc(sel.mmsi) + '</code></b><span>' + T('النوع', 'Type') + '</span><b>' + vtype(sel.type) + ' · ' + esc(sel.flag) + '</b><span>' + T('الموقع', 'Position') + '</span><b>' + ll(sel.pos) + '</b><span>' + T('الاتجاه', 'Heading') + '</span><b>' + N(sel.cog) + '° (' + dir(sel.cog) + ')</b><span>' + T('السرعة', 'Speed') + '</span><b>' + (sel.status === 'underway' ? N(sel.speedKn, 1) : '0') + T(' عقدة', ' kn') + '</b><span>' + T('المسار', 'Route') + '</span><b>' + esc(pname(sel.originId)) + ' ← ' + esc(pname(sel.destId)) + '</b><span>' + T('الوصول المتوقع', 'ETA') + '</span><b>' + (sel.etaH != null ? fT(s.now + sel.etaH * H) : '—') + '</b><span>' + T('آخر إشارة', 'Last signal') + '</span><b>' + rel(sel.lastAis) + ' ' + SIM() + '</b></div>' +
        (rk ? '<div class="riskbox lv-' + rk.severity + '"><b>' + T('خطر متوقع: ', 'Predicted risk: ') + T(...CAUSE[rk.cause]) + ' · ' + lv(rk.severity) + '</b><p>' + esc(L(rk.explanation)) + '</p><p class="sm">' + T('الوقت المتوقع: ', 'Expected: ') + fT(rk.start) + ' (' + rel(rk.start) + ')</p></div>' : '<p class="okline">' + T('لا يوجد خطر متوقع على مسارها خلال ٤٨ ساعة.', 'No risk predicted on its route within 48 h.') + '</p>') +
        (dl ? '<p class="sm">' + T('آخر إنذار: ', 'Last alert: ') + esc((warning(dl.warningId) || {}).number || '') + ' ' + dstB(dl) + '</p>' : '') + '<button class="btn sm ghost" data-a="openBridgeFor" data-id="' + sel.id + '">' + T('فتح جسر هذه السفينة (اختبار الاستلام)', 'Open this vessel\'s bridge (test reception)') + '</button></div>');
    }
  };
  A.selVessel = d => { state.selVessel = d.id || null; update(); if (d.id && state.maps.omap) { const v = vessel(d.id); if (v && v.pos) state.maps.omap.fitPoints([v.pos], 1.2); } };
  A.openBridgeFor = d => { if (!confirm(T('سيتم الانتقال إلى جسر السفينة. يمكنك العودة لاحقًا من زر «الرئيسية».', 'You will switch to the Ship Bridge. Return later with the Home button.'))) return; client.leave(); A.pickBridge({ id: 'B-' + d.id }); };

  // 2) 48 h prediction
  OFF.predict = {
    mount: () => '<div class="panel"><div class="row between"><h2>' + T('السفن المتوقع تعرضها للخطر خلال ٤٨ ساعة', 'Vessels expected to be at risk within 48 h') + '</h2>' + B('warn', T('نموذج تنبؤ أولي قائم على القواعد', 'Rule-based prototype model')) + '</div><p class="muted sm">' + T('يقاطع النظام موقع كل سفينة ومسارها ساعة بساعة مع توقعات الرياح والأمواج والرؤية وحدود التشغيل. لا يعرض احتمالات مصطنعة؛ الثقة مشتقة من مدى التوقع.', 'The system intersects each vessel\'s hourly position along its route with wind, wave and visibility forecasts and operating limits. No artificial probabilities; confidence derives from forecast lead time.') + '</p><div id="plist"></div></div>' +
      '<div class="grid2"><div class="panel mapp"><div class="mapbox mid" id="pmap"></div></div><div class="panel"><h2>' + T('الموانئ السعودية خلال ٤٨ ساعة', 'Saudi ports over 48 h') + '</h2><div id="pheat"></div><div id="psrc"></div></div></div>',
    bind: m => ensureMap('pmap', $('#pmap', m), { fit: [34, 15, 51, 29] }),
    upd: () => {
      const s = S(), ex = s.predictions.filter(p => p.category === 'vessel_exposure').sort((a, b) => RANK(b.severity) - RANK(a.severity) || a.start - b.start);
      const covered = p => s.deliveries.some(d => d.vesselId === p.vesselId && d.status !== 'cancelled') || s.warnings.some(w => w.level === 'LOCAL' && ['pending_approval', 'draft', 'returned', 'distributed'].includes(w.status) && p.position && C.pointInPoly(p.position, w.poly));
      fill('#plist', ex.length ? tbl([T('السفينة', 'Vessel'), T('نوع الخطر', 'Risk type'), T('الموقع', 'Location'), T('الوقت المتوقع', 'Expected time'), T('الخطورة', 'Severity'), T('التوصية', 'Recommendation'), ''],
        ex.map(p => tr(['<b>' + esc(vname(p.vesselId)) + '</b>', T(...CAUSE[p.cause]) + '<div class="sm muted">' + esc(p.peak) + '</div>', esc(L(p.area)) + '<div class="sm muted">' + ll(p.position) + '</div>', fT(p.start) + '<div class="sm muted">' + rel(p.start) + '</div>', lvB(p.severity) + '<div class="sm muted">' + T('ثقة ', 'conf. ') + N(p.confidence.value * 100) + '%</div>', '<span class="sm">' + esc(L(p.action)) + '</span>',
          RANK(p.severity) >= 3 ? (covered(p) ? B('ok', T('مشمولة بإنذار', 'Covered by alert')) : '<button class="btn sm" data-a="alertFromPred" data-id="' + p.id + '">' + T('إنشاء إنذار', 'Create alert') + '</button>') : '']))) : empty(T('لا توجد مخاطر متوقعة على السفن خلال ٤٨ ساعة. شغّل «سيناريو تجريبي» لرؤية التنبؤ أثناء حالة طقس شديد.', 'No risks predicted for vessels within 48 h. Run a “Demo scenario” to see predictions during severe weather.')));
      if (state.maps.pmap) state.maps.pmap.setData(mapData({ zones: alertZones(false).concat(ex.filter(p => RANK(p.severity) >= 3).map(p => ({ poly: p.poly, cls: 'pred', label: { ar: vname(p.vesselId) + ' · ' + lv(p.severity), en: vname(p.vesselId) + ' · ' + lv(p.severity) } }))) }));
      const tl = s.timelines || {};
      fill('#pheat', '<div class="scroll"><table class="heat"><thead><tr><th></th>' + Array.from({ length: 49 }, (_, h) => '<th>' + (h % 12 === 0 ? '+' + h : '') + '</th>').join('') + '</tr></thead><tbody>' + s.ports.filter(p => p.saudi).map(p => '<tr><th>' + esc(L(p.name)) + '</th>' + (tl[p.id] || []).map(x => '<td class="lv-' + x.level + '" title="' + esc(fT(x.t) + ' · ' + lv(x.level) + ' · ' + x.waveM + 'm / ' + x.gustKn + 'kn') + '"></td>').join('') + '</tr>').join('') + '</tbody></table></div><div class="maplegend">' + ['normal', 'low', 'moderate', 'high', 'critical'].map(l => '<span class="lg cell lv-' + l + '"></span>' + lv(l)).join(' ') + '</div>');
      const f = s.forecasts.find(x => x.id === 'P:JED') || s.forecasts[0];
      fill('#psrc', banner(T('المصدر: ', 'Source: ') + L(f && f.provider) + ' · ' + T('آخر تحديث ', 'updated ') + rel(f && f.issuedAt) + ' · ' + T('لا يوجد ربط فعلي مع المركز الوطني للأرصاد؛ البيانات تجريبية.', 'No live link with NCM; data is simulated.')));
    }
  };
  A.alertFromPred = d => { const p = S().predictions.find(x => x.id === d.id); if (p) alertEditor({ fromPred: p }); };

  // 3) Local alerts
  const TPL = {
    high_waves: [['أمواج عالية متوقعة في {p}', 'High waves expected in {p}'], ['تتوقع منصة مَرسى أمواجًا عالية في المنطقة المحددة خلال الفترة المذكورة.', 'MARSA expects high waves in the marked area during the stated period.'], ['خفض السرعة، تأمين الحمولة، وتجنب المنطقة أو الانتظار في منطقة آمنة.', 'Reduce speed, secure cargo, and avoid the area or wait in a safe area.']],
    dangerous_winds: [['رياح شديدة متوقعة في {p}', 'Strong winds expected in {p}'], ['تتوقع منصة مَرسى رياحًا شديدة وهبات قوية في المنطقة المحددة.', 'MARSA expects strong winds and gusts in the marked area.'], ['مراقبة الانجراف، تأمين المعدات على السطح، وتجنب الاقتراب من الساحل.', 'Watch for drift, secure deck equipment, and keep clear of the coast.']],
    reduced_visibility: [['انخفاض الرؤية في {p}', 'Reduced visibility in {p}'], ['يتوقع انخفاض الرؤية بشكل كبير في المنطقة المحددة.', 'Visibility is expected to drop significantly in the marked area.'], ['تشغيل إشارات الضباب، خفض السرعة، وتعزيز المراقبة بالرادار.', 'Use fog signals, reduce speed, and increase radar watch.']],
    navigation_hazard: [['خطر ملاحي في {p}', 'Navigation hazard in {p}'], ['أُبلغ عن خطر ملاحي في المنطقة المحددة.', 'A navigation hazard has been reported in the marked area.'], ['تجنب المنطقة واتباع المسار البديل المقترح.', 'Avoid the area and follow the suggested alternative route.']]
  };
  function alertEditor({ fromPred } = {}) {
    const s = S(), centers = s.ports.filter(p => p.saudi).map(p => ['P:' + p.id, L(p.name), p.p]).concat(s.forecasts.filter(f => f.kind === 'area').map(f => [f.id, L(f.name), f.p]));
    if (fromPred) centers.unshift(['POS', T('موقع الخطر المتوقع لـ', 'Predicted risk location of ') + vname(fromPred.vesselId) + ' (' + ll(fromPred.position) + ')', fromPred.position]);
    const cat = fromPred ? ({ waves: 'high_waves', wind: 'dangerous_winds', visibility: 'reduced_visibility' })[fromPred.cause] : 'high_waves';
    const m = modal('<h3>' + T('إنذار محلي جديد', 'New local alert') + '</h3><p class="muted sm">' + T('الإنذار المحلي يصدر من مَرسى للسفن في المنطقة المحددة، وهو مستقل عن إنذارات NAVTEX.', 'A local alert is issued by MARSA to vessels in the marked area and is independent of NAVTEX warnings.') + '</p><form class="form" id="af"><div class="grid2f">' +
      '<label>' + T('نوع الخطر', 'Hazard type') + '<select name="category">' + Object.keys(TPL).map(k => '<option value="' + k + '"' + (k === cat ? ' selected' : '') + '>' + wcat(k) + '</option>').join('') + '</select></label>' +
      '<label>' + T('الخطورة', 'Severity') + '<select name="severity">' + ['low', 'moderate', 'high', 'critical'].map(l => '<option value="' + l + '"' + ((fromPred ? fromPred.severity : 'high') === l ? ' selected' : '') + '>' + lv(l) + '</option>').join('') + '</select></label>' +
      '<label>' + T('مركز منطقة الخطر', 'Hazard area centre') + '<select name="center">' + centers.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') + '</select></label><label>' + T('نصف القطر (ميل بحري)', 'Radius (nm)') + '<input name="radius" type="number" min="3" max="150" value="' + (fromPred ? 30 : 40) + '"></label>' +
      '<label>' + T('يبدأ بعد (ساعات)', 'Starts in (h)') + '<input name="from" type="number" min="0" max="48" step="0.5" value="' + (fromPred ? Math.max(0, Math.floor((fromPred.start - s.now) / H) - 1) : 0) + '"></label><label>' + T('المدة (ساعات)', 'Duration (h)') + '<input name="dur" type="number" min="1" max="96" value="12"></label></div>' +
      '<div class="bil"><label>' + T('العنوان (عربي)', 'Title (Arabic)') + '<input name="tar" dir="rtl" required></label><label>' + T('العنوان (إنجليزي)', 'Title (English)') + '<input name="ten" dir="ltr" required></label><label>' + T('الوصف (عربي)', 'Description (Arabic)') + '<textarea name="bar" dir="rtl" required></textarea></label><label>' + T('الوصف (إنجليزي)', 'Description (English)') + '<textarea name="ben" dir="ltr" required></textarea></label><label>' + T('التعليمات (عربي)', 'Instructions (Arabic)') + '<textarea name="aar" dir="rtl"></textarea></label><label>' + T('التعليمات (إنجليزي)', 'Instructions (English)') + '<textarea name="aen" dir="ltr"></textarea></label></div>' +
      '<div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('إنشاء الإنذار', 'Create alert') + '</button></div></form>', 'wide');
    const f = $('#af', m);
    const tpl = () => { const t = TPL[f.category.value], c = centers.find(x => x[0] === f.center.value), ob = c[0].startsWith('P:') ? port(c[0].slice(2)).name : c[0] === 'POS' ? { ar: 'مسار السفينة ' + vname(fromPred.vesselId), en: 'the track of ' + vname(fromPred.vesselId) } : S().forecasts.find(x => x.id === c[0]).name;
      f.tar.value = t[0][0].replace('{p}', ob.ar); f.ten.value = t[0][1].replace('{p}', ob.en); f.bar.value = t[1][0] + (fromPred ? ' ' + fromPred.explanation.ar : ''); f.ben.value = t[1][1] + (fromPred ? ' ' + fromPred.explanation.en : ''); f.aar.value = t[2][0]; f.aen.value = t[2][1]; };
    f.category.onchange = tpl; f.center.onchange = tpl; tpl();
    f.onsubmit = async e => {
      e.preventDefault(); const c = centers.find(x => x[0] === val(f, 'center')), rad = Number(val(f, 'radius')), now = S().now, startAt = now + Number(val(f, 'from')) * H;
      const near = S().ports.filter(p => p.saudi).reduce((b, p) => C.gcNm(p.p, c[2]) < C.gcNm(b.p, c[2]) ? p : b);
      const r = await act('createWarning', { level: 'LOCAL', category: val(f, 'category'), severity: val(f, 'severity'), portId: near.id, poly: C.circlePoly(c[2], rad, 24), zone: { ar: c[1] + ' (' + rad + ' ميل)', en: c[1] + ' (' + rad + ' nm)' }, startAt, expiryAt: startAt + Number(val(f, 'dur')) * H,
        title: { ar: val(f, 'tar'), en: val(f, 'ten') }, body: { ar: val(f, 'bar'), en: val(f, 'ben') }, action: { ar: val(f, 'aar'), en: val(f, 'aen') } }, T('أُنشئ الإنذار – راجعه ثم أرسله', 'Alert created – review then send'));
      if (r) { await client.call('submitWarning', { id: r.id }).catch(() => null); closeModal(); state.selAlert = r.id; state.tab = 'alerts'; renderView(); }
    };
  }
  OFF.alerts = {
    mount: () => '<div class="split"><aside class="panel side-list"><div class="row between"><h3>' + T('الإنذارات المحلية', 'Local alerts') + '</h3><button class="btn sm" data-a="newAlert">' + T('إنذار جديد', 'New alert') + '</button></div><div id="alist"></div></aside><div><div class="panel" id="adet"></div><div class="panel mapp"><div class="mapbox mid" id="amap"></div></div></div></div>',
    bind: m => ensureMap('amap', $('#amap', m), { fit: [34, 15, 51, 29] }),
    upd: () => {
      const s = S(), list = s.warnings.filter(w => w.level === 'LOCAL').slice().reverse();
      if (!state.selAlert || !list.some(w => w.id === state.selAlert)) state.selAlert = list[0] ? list[0].id : null;
      fill('#alist', list.length ? '<ul class="vlist">' + list.map(w => { const dl = s.deliveries.filter(d => d.warningId === w.id); return '<li><button class="' + (w.id === state.selAlert ? 'on' : '') + '" data-a="selAlert" data-id="' + w.id + '"><b>' + esc(w.number) + ' · ' + esc(L(w.title)) + '</b><span>' + astB(w.status) + ' ' + lvB(w.severity) + (dl.length ? ' · ' + N(dl.filter(d => d.ackAt).length) + '/' + N(dl.length) + T(' أكدت', ' confirmed') : '') + '</span></button></li>'; }).join('') + '</ul>' : empty(T('لا توجد إنذارات. أنشئ إنذارًا أو شغّل السيناريو التجريبي.', 'No alerts. Create one or run the demo scenario.')));
      const w = state.selAlert && warning(state.selAlert);
      if (state.maps.amap) state.maps.amap.setData(mapData({ zones: w ? [{ poly: w.poly, cls: 'local' + (w.status === 'distributed' ? '' : ' pend'), label: w.title, tag: { ar: w.number, en: w.number } }] : [] }));
      if (w && state.maps.amap && $('#amap').dataset.fit !== w.id) { $('#amap').dataset.fit = w.id; state.maps.amap.fitPoints(w.poly, 1.2); }
      if (!w) { fill('#adet', ''); return; }
      const dl = s.deliveries.filter(d => d.warningId === w.id);
      const flow = ['created', 'pending', 'sent'].map((k, i) => { const done = i === 0 || (i === 1 && ['pending_approval', 'approved', 'distributed'].includes(w.status)) || (i === 2 && w.status === 'distributed'); return '<div class="fstep' + (done ? ' done' : '') + '"><b>' + T(...[['تم إنشاؤه', 'Created'], ['بانتظار الإرسال', 'Pending send'], ['تم الإرسال', 'Sent']][i]) + '</b></div>'; }).join('<span class="arr"></span>');
      fill('#adet', '<div class="row between"><h2>' + esc(w.number) + '</h2><div class="row">' + astB(w.status) + ' ' + lvB(w.severity) + (w.simulated ? ' ' + SIM() : '') + '</div></div><div class="flow">' + flow + '</div>' +
        '<div class="kv"><span>' + T('العنوان', 'Title') + '</span><b>' + esc(L(w.title)) + '</b><span>' + T('نوع الخطر', 'Hazard') + '</span><b>' + wcat(w.category) + '</b><span>' + T('المنطقة', 'Area') + '</span><b>' + esc(L(w.zone)) + '</b><span>' + T('الوقت', 'Time') + '</span><b>' + fT(w.startAt) + ' – ' + fT(w.expiryAt) + '</b><span>' + T('الوصف', 'Description') + '</span><b>' + esc(L(w.body)) + '</b><span>' + T('التعليمات', 'Instructions') + '</span><b>' + esc(L(w.action)) + '</b><span>' + T('المصدر', 'Source') + '</span><b class="sm">' + esc(L(w.source)) + '</b>' + (w.issueAt ? '<span>' + T('وقت الإرسال', 'Sent at') + '</span><b>' + fT(w.issueAt) + ' · ' + esc(w.approvedBy || '') + '</b>' : '') + '</div>' +
        '<div class="row">' + (['draft', 'returned'].includes(w.status) ? '<button class="btn" data-a="submitAlert" data-id="' + w.id + '">' + T('تجهيز للإرسال', 'Prepare for sending') + '</button>' : '') + (w.status === 'pending_approval' ? '<button class="btn big" data-a="sendAlert" data-id="' + w.id + '">' + T('إرسال الإنذار للسفن', 'Send alert to vessels') + '</button>' : '') + (!['cancelled', 'rejected', 'expired'].includes(w.status) ? '<button class="btn ghost danger sm" data-a="cancelAlert" data-id="' + w.id + '">' + T('إلغاء الإنذار', 'Cancel alert') + '</button>' : '') + '</div>' +
        (w.status === 'distributed' && !dl.length ? '<p class="note bad">' + T('لم يصل الإنذار لأي سفينة: لا توجد سفن داخل منطقة الإنذار أو متجهة إليها. وسّع نصف القطر أو اختر مركزًا على مسار السفن (مثل ميناء جدة)، أو أنشئ الإنذار من تبويب «التنبؤ» لسفينة محددة.', 'The alert reached no vessels: none are inside or approaching the area. Widen the radius, centre it on a shipping lane (e.g. Jeddah), or create it from the “Prediction” tab for a specific vessel.') + '</p>' : '') + (dl.length ? '<h3>' + T('حالة الإرسال للسفن', 'Delivery to vessels') + '</h3>' + tbl([T('السفينة', 'Vessel'), 'MMSI', T('القناة', 'Channel'), T('الحالة', 'Status'), T('وقت الإرسال', 'Sent'), T('وقت الاستلام', 'Received'), T('التأكيد', 'Confirmed by'), ''],
          dl.map(d => tr(['<b>' + esc(vname(d.vesselId)) + '</b><div class="sm muted">' + (d.why === 'inside' ? T('داخل المنطقة', 'In area') : T('متجهة للمنطقة', 'Approaching')) + '</div>', '<code>' + esc(d.mmsi) + '</code>', T(...CH[d.channel]), dstB(d) + (d.failReason ? '<div class="sm bad">' + esc(L(d.failReason)) + '</div>' : ''), fTs(d.sentAt), d.receivedAt || d.ackAt ? fTs(d.receivedAt || d.ackAt) : d.channel === 'ais_srm' ? '<span class="sm muted">' + T('القناة لا تؤكد', 'No confirmation') + '</span>' : '—', d.ackAt ? esc(d.ackBy) + (d.manual ? ' (' + esc(d.manual.via) + ')' : '') + '<div class="sm muted">' + fTs(d.ackAt) + '</div>' : '—',
            '<div class="row nowrap">' + (['unacknowledged', 'failed'].includes(d.status) || (d.channel === 'ais_srm' && !d.ackAt) ? '<button class="btn sm ghost" data-a="resend" data-id="' + d.id + '">' + T('إعادة إرسال', 'Resend') + '</button><button class="btn sm ghost" data-a="manualAck" data-id="' + d.id + '">' + T('تأكيد عبر VHF', 'Confirm via VHF') + '</button>' : !d.ackAt && d.channel === 'marsa_app' ? '<button class="btn sm ghost" data-a="openBridgeFor" data-id="' + d.vesselId + '">' + T('اختبار الاستلام', 'Test reception') + '</button>' : '') + '</div>']))) : w.status === 'pending_approval' ? '<p class="muted sm">' + T('عند الإرسال تحدد مَرسى السفن داخل المنطقة والمتجهة إليها جغرافيًا، وترسل الإنذار عبر قنوات الاتصال المتاحة، وتقترح مسارات بديلة للسفن المتأثرة.', 'On sending, MARSA geographically identifies vessels inside and approaching the area, sends the alert through available channels, and proposes alternative routes for affected vessels.') + '</p>' : ''));
    }
  };
  A.newAlert = () => alertEditor();
  A.selAlert = d => { state.selAlert = d.id; update(); };
  A.submitAlert = d => act('submitWarning', { id: d.id }, T('الإنذار جاهز للإرسال', 'Alert ready to send'));
  A.sendAlert = d => {
    const w = warning(d.id);
    const m = modal('<h3>' + T('إرسال الإنذار ', 'Send alert ') + esc(w.number) + '</h3><p><b>' + esc(L(w.title)) + '</b></p><p class="sm">' + esc(L(w.zone)) + ' · ' + fT(w.startAt) + ' – ' + fT(w.expiryAt) + '</p><p class="note">' + T('سيُرسل الإنذار إلى السفن داخل المنطقة والمتجهة إليها عبر تطبيق جسر السفينة، وعبر رسائل السلامة AIS (تجريبي) للسفن التي لا تستخدم التطبيق. ستُرفق المسارات البديلة التي تتوفر لها بيانات كافية، وما عداها يحتاج اعتمادك من تبويب «المسارات البديلة».', 'The alert will be sent to vessels inside and approaching the area via the Ship Bridge app, and via AIS safety messages (sandbox) for vessels without the app. Alternative routes with sufficient data are attached; others need your approval in the “Alternative routes” tab.') + '</p><form id="sf" class="form">' + discBlock() + '<div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('إرسال الآن', 'Send now') + '</button></div></form>');
    $('#sf', m).onsubmit = async e => { e.preventDefault(); if (!discOk(e.target)) return; if (await act('decideLocalWarning', { id: w.id, decision: 'approve', disclaimer: true }, false)) { closeModal(); setTimeout(() => { const n = S().deliveries.filter(d => d.warningId === w.id).length; toast(n ? T('أُرسل الإنذار إلى ' + n + ' سفن', 'Alert sent to ' + n + ' vessels') : T('أُرسل الإنذار لكن لا توجد سفن داخل المنطقة أو متجهة إليها', 'Alert sent, but no vessels are inside or approaching the area'), n ? 'ok' : 'bad'); }, 600); } };
  };
  A.cancelAlert = async d => { const note = prompt(T('سبب الإلغاء', 'Reason for cancellation')); if (note == null) return; const w = warning(d.id); if (w.status === 'pending_approval') await act('decideLocalWarning', { id: w.id, decision: 'reject', disclaimer: true, note }, T('أُلغي الإنذار', 'Alert cancelled')); else await act('cancelWarning', { id: w.id, note }, T('أُلغي الإنذار وأُبلغت السفن', 'Alert cancelled and vessels informed')); };
  A.resend = d => act('resendDelivery', { id: d.id }, T('أُعيد الإرسال', 'Re-sent'));
  A.manualAck = d => {
    const dl = S().deliveries.find(x => x.id === d.id);
    const m = modal('<h3>' + T('تأكيد استلام عبر VHF: ', 'Confirm via VHF: ') + esc(vname(dl.vesselId)) + '</h3><form class="form" id="mf"><div class="grid2f"><label>' + T('القناة', 'Channel') + '<select name="via"><option>VHF</option><option value="phone">' + T('هاتف', 'Phone') + '</option><option value="agent">' + T('الوكيل الملاحي', 'Agent') + '</option></select></label><label>' + T('اسم الضابط على السفينة', 'Officer on board') + '<input name="officer" required minlength="3"></label></div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('تسجيل', 'Record') + '</button></div></form>');
    $('#mf', m).onsubmit = async e => { e.preventDefault(); if (await act('recordManualAck', { id: dl.id, via: val(e.target, 'via'), officer: val(e.target, 'officer') }, T('سُجل التأكيد', 'Recorded'))) closeModal(); };
  };

  // 4) Notices & warnings
  const PIPE = ['drafting', 'ready', 'sent_port', 'sent_karachi', 'acknowledged', 'awaiting_official', 'published'];
  function pipeHtml(n) {
    const hasK = n.recipients.some(r => r.to === 'KHI') || (n.status !== 'sent' && n.status !== 'awaiting_official' && n.status !== 'published' && n.suggested.some(r => r.to === 'KHI'));
    return '<div class="flow wrap">' + PIPE.filter(s => s !== 'sent_karachi' || hasK).map((s, i) => { const done = n.history.some(h => h.s === s) || (s === 'drafting'), on = n.status === s || (n.status === 'sent' && s === (hasK ? 'sent_karachi' : 'sent_port')); const t0 = (n.history.filter(h => h.s === s).slice(-1)[0] || {}).at; return (i ? '<span class="arr"></span>' : '') + '<div class="fstep' + (on ? ' on' : done ? ' done' : '') + '"><b>' + nst(s) + '</b><span>' + (t0 ? fH(t0) : '') + '</span></div>'; }).join('') + '</div>';
  }
  OFF.notices = {
    mount: () => '<div class="grid3s"><div class="panel src"><h3>' + T('المصدر ١: المركز الوطني للأرصاد', 'Source 1: National Center for Meteorology') + '</h3><div id="srcncm"></div></div><div class="panel src"><h3>' + T('المصدر ٢: محطة كراتشي (NAVTEX / NAVAREA IX)', 'Source 2: Karachi station (NAVTEX / NAVAREA IX)') + '</h3><div id="srckhi"></div></div><div class="panel src"><h3>' + T('التوجيه الآلي', 'Automatic routing') + '</h3><div id="srcauto"></div></div></div>' +
      '<p class="note">' + T('مَرسى تحلل وتجهز وتوجّه النشرات والإشعارات. إصدار وبث الإنذارات الملاحية الرسمية للسفن تتولاه الموانئ ومحطة كراتشي عبر قنواتها المعتمدة. مَرسى ليست محطة NAVTEX ولا تبث رسائل NAVTEX.', 'MARSA analyses, prepares and routes notices. Official navigational warnings are issued and broadcast to ships by the ports and the Karachi station through their authorised channels. MARSA is not a NAVTEX station and does not broadcast NAVTEX messages.') + '</p>' +
      '<div class="split"><aside class="panel side-list"><div class="row between"><h3>' + T('النشرات والإشعارات', 'Notices & warnings') + '</h3><div class="row"><button class="btn sm ghost" data-a="periodic">' + T('نشرة دورية', 'Periodic bulletin') + '</button><button class="btn sm" data-a="newNotice">' + T('إشعار جديد', 'New notice') + '</button></div></div><div id="nlist"></div></aside><div class="panel" id="ndet"></div></div>',
    upd: () => {
      const s = S(), ncm = s.integrations.find(i => i.id === 'ncm') || {}, khi = s.integrations.find(i => i.id === 'karachi') || {};
      const warns = s.forecasts.filter(f => f.series.slice(0, 25).some(x => x.warning)).map(f => { const x = f.series.find(y => y.warning); return '<li><b>' + esc(L(x.warning)) + '</b><span class="sm muted">' + esc(L(f.name)) + ' · ' + fT(x.t) + '</span></li>'; });
      fill('#srcncm', '<p class="sm">' + B('muted', T('وضع تجريبي', 'Sandbox')) + ' ' + T('آخر استقبال: ', 'Last data: ') + rel(ncm.lastSync) + '</p><p class="sm muted">' + T('يستقبل التوقعات الساعية (رياح، هبات، أمواج، رؤية، أمطار) والتحذيرات الجوية، ثم يحدد المناطق البحرية المتأثرة.', 'Receives hourly forecasts (wind, gusts, waves, visibility, rain) and met warnings, then identifies affected sea areas.') + '</p>' + (warns.length ? '<ul class="mini plain">' + [...new Set(warns)].slice(0, 3).join('') + '</ul>' : '<p class="okline sm">' + T('لا توجد تحذيرات جوية حالية.', 'No current met warnings.') + '</p>'));
      fill('#srckhi', '<p class="sm">' + B('muted', T('قناة تكامل تجريبية', 'Sandbox channel')) + ' ' + T('آخر إرسال: ', 'Last dispatch: ') + rel(khi.lastSync) + '</p><p class="sm muted">' + T('تُوجَّه إليها النشرات ذات النطاق الإقليمي أو الدولي. تأكيد الاستلام في النموذج محاكاة موسومة، ولا يوجد ربط فعلي مع المحطة.', 'Notices with a regional or international scope are routed here. Receipt confirmation in the prototype is a labelled simulation; there is no live link with the station.') + '</p>');
      fill('#srcauto', '<label class="switch"><input type="checkbox" data-a="autoRoute"' + (s.settings.autoRoute ? ' checked' : '') + '><span>' + (s.settings.autoRoute ? T('مفعّل', 'On') : T('متوقف', 'Off')) + '</span></label><p class="sm muted">' + T('عند التفعيل: كل نشرة تجهزها مَرسى من بيانات الأرصاد تُوجَّه فورًا إلى الموانئ المعنية وإلى محطة كراتشي حسب نطاقها، بتفويضك المسجل.', 'When on: every notice MARSA prepares from met data is routed immediately to the concerned ports and to Karachi by scope, under your recorded authorisation.') + '</p>');
      const list = (s.navnotices || []).slice().reverse();
      if (!state.selNotice || !list.some(n => n.id === state.selNotice)) state.selNotice = list[0] ? list[0].id : null;
      fill('#nlist', list.length ? '<ul class="vlist">' + list.map(n => '<li><button class="' + (n.id === state.selNotice ? 'on' : '') + '" data-a="selNotice" data-id="' + n.id + '"><b>' + esc(n.number) + ' · ' + esc(L(n.title)) + '</b><span>' + B(NSTC[n.status] || 'info', nst(n.status)) + ' · ' + T(...SCOPE[n.scope]) + '</span></button></li>').join('') + '</ul>' : empty(T('لا توجد نشرات بعد. تنشأ آليًا عند وصول تحذير جوي من الأرصاد، أو أنشئ واحدة يدويًا.', 'No notices yet. They are created automatically when a met warning arrives, or create one manually.')));
      const n = state.selNotice && s.navnotices.find(x => x.id === state.selNotice);
      if (!n) { fill('#ndet', ''); return; }
      fill('#ndet', '<div class="row between"><h2>' + esc(n.number) + '</h2><div class="row">' + B(NSTC[n.status] || 'info', nst(n.status)) + (n.simulated ? ' ' + SIM() : '') + '</div></div>' + pipeHtml(n) +
        '<div class="kv"><span>' + T('العنوان', 'Title') + '</span><b>' + esc(L(n.title)) + '</b><span>' + T('النوع', 'Kind') + '</span><b>' + (n.kind === 'periodic' ? T('نشرة دورية', 'Periodic bulletin') : T('إشعار / تحذير ملاحي', 'Navigational notice / warning')) + ' · ' + wcat(n.category) + '</b><span>' + T('المنطقة', 'Area') + '</span><b>' + esc(L(n.zone)) + '</b><span>' + T('نطاق التوزيع', 'Distribution scope') + '</span><b>' + T(...SCOPE[n.scope]) + '</b><span>' + T('السريان', 'Validity') + '</span><b>' + fT(n.startAt) + ' – ' + fT(n.expiryAt) + '</b><span>' + T('المحتوى', 'Content') + '</span><b>' + esc(L(n.body)) + '</b><span>' + T('المصدر', 'Source') + '</span><b class="sm">' + esc(L(n.source)) + '</b>' + (n.officialRef ? '<span>' + T('الإصدار الرسمي', 'Official issuance') + '</span><b>' + esc(n.officialRef) + (n.officialBy ? ' · ' + esc(n.officialBy) : '') + '</b>' : '') + '</div>' +
        '<h3>' + (n.recipients.length ? T('الجهات المستقبلة', 'Recipients') : T('الجهات المقترحة حسب النطاق', 'Suggested recipients by scope')) + '</h3>' +
        (n.recipients.length ? tbl([T('الجهة', 'Recipient'), T('الحالة', 'Status'), T('وقت الإرسال', 'Sent'), T('تأكيد الاستلام', 'Receipt')], n.recipients.map(r => tr([esc(L(r.name)), r.ackAt ? B('ok', T('تم تأكيد الاستلام', 'Receipt confirmed')) : B('info', r.kind === 'karachi' ? T('أرسلت إلى محطة كراتشي', 'Sent to Karachi') : T('أرسلت إلى الميناء', 'Sent to port')), fTs(r.sentAt), r.ackAt ? fTs(r.ackAt) + ' <code class="sm">' + esc(r.ackRef) + '</code> ' + SIM() : '…']))) : '<ul class="chips">' + n.suggested.map(r => '<li>' + esc(L(r.name)) + '</li>').join('') + '</ul>') +
        '<details><summary>' + T('النص المنظم المرسل', 'Structured message text') + '</summary><pre class="msg">' + esc(n.messageText) + '</pre></details>' +
        '<div class="row">' + (n.status === 'drafting' ? '<button class="btn" data-a="noticeReady" data-id="' + n.id + '">' + T('جاهزة للإرسال', 'Mark ready') + '</button>' : '') + (['drafting', 'ready'].includes(n.status) ? '<button class="btn big" data-a="routeNotice" data-id="' + n.id + '">' + T('إرسال إلى الجهات', 'Send to recipients') + '</button><button class="btn ghost sm" data-a="editNotice" data-id="' + n.id + '">' + T('تعديل', 'Edit') + '</button>' : '') + (['awaiting_official', 'sent'].includes(n.status) ? '<button class="btn" data-a="officialIssue" data-id="' + n.id + '">' + T('تسجيل الإصدار الرسمي', 'Record official issuance') + '</button>' : '') + (!['cancelled', 'published'].includes(n.status) ? '<button class="btn ghost danger sm" data-a="cancelNotice" data-id="' + n.id + '">' + T('إلغاء', 'Cancel') + '</button>' : '') + '</div>');
    }
  };
  A.selNotice = d => { state.selNotice = d.id; update(); };
  A.autoRoute = (d, el) => act('setAutoRoute', { on: el.checked }, el.checked ? T('التوجيه الآلي مفعّل', 'Automatic routing on') : T('التوجيه الآلي متوقف', 'Automatic routing off'));
  A.noticeReady = d => act('markNoticeReady', { id: d.id }, T('النشرة جاهزة للإرسال', 'Ready to send'));
  A.periodic = async () => { const r = await act('createPeriodicNotice', {}, T('جُهزت النشرة الدورية من بيانات الأرصاد', 'Periodic bulletin prepared from met data')); if (r) { state.selNotice = r.id; update(); } };
  A.routeNotice = d => {
    const n = S().navnotices.find(x => x.id === d.id), sugg = new Set(n.suggested.map(r => r.to));
    const opts = S().ports.filter(p => p.saudi).map(p => ['PORT:' + p.id, L(p.name)]).concat([['KHI', T('محطة كراتشي – منسق NAVAREA IX', 'Karachi station – NAVAREA IX coordinator')]]);
    const m = modal('<h3>' + T('إرسال ', 'Send ') + esc(n.number) + '</h3><p class="sm">' + T('الجهات المحددة مسبقًا مقترحة حسب نطاق النشرة (', 'Pre-selected recipients follow the notice scope (') + T(...SCOPE[n.scope]) + '). ' + T('يمكنك التعديل.', 'You can adjust.') + '</p><form class="form" id="rf"><div class="chklist">' + opts.map(([k, l]) => '<label class="chk"><input type="checkbox" name="r" value="' + k + '"' + (sugg.has(k) ? ' checked' : '') + '>' + esc(l) + '</label>').join('') + '</div><p class="muted sm">' + T('القنوات تجريبية: سيُسجَّل الإرسال، وتأكيد الاستلام محاكاة موسومة.', 'Channels are sandbox: dispatch is recorded and receipt confirmation is a labelled simulation.') + '</p>' + discBlock() + '<div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('إرسال', 'Send') + '</button></div></form>');
    $('#rf', m).onsubmit = async e => { e.preventDefault(); if (!discOk(e.target)) return; const rc = $$('[name=r]:checked', e.target).map(x => x.value); if (!rc.length) { toast(T('اختر جهة واحدة على الأقل', 'Pick at least one recipient'), 'bad'); return; } if (await act('routeNotice', { id: n.id, recipients: rc, disclaimer: true }, T('أُرسلت النشرة', 'Notice sent'))) closeModal(); };
  };
  A.officialIssue = d => {
    const n = S().navnotices.find(x => x.id === d.id);
    const m = modal('<h3>' + T('تسجيل الإصدار الرسمي – ', 'Record official issuance – ') + esc(n.number) + '</h3><p class="sm muted">' + T('يُسجَّل هنا رقم التحذير الذي أصدرته الجهة المخولة (الميناء أو محطة كراتشي) بعد بثه عبر قنواتها.', 'Record the warning number issued by the authorised body (port or Karachi station) after its broadcast.') + '</p><form class="form" id="of"><label>' + T('الجهة المصدرة', 'Issued by') + '<select name="issuer">' + n.recipients.map(r => '<option>' + esc(L(r.name)) + '</option>').join('') + '</select></label><label>' + T('رقم الإصدار الرسمي', 'Official reference') + '<input name="ref" required placeholder="NAVAREA IX 0123/26"></label><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('تسجيل', 'Record') + '</button></div></form>');
    $('#of', m).onsubmit = async e => { e.preventDefault(); if (await act('recordOfficialIssue', { id: n.id, ref: val(e.target, 'ref'), issuer: val(e.target, 'issuer') }, T('سُجل الإصدار الرسمي', 'Official issuance recorded'))) closeModal(); };
  };
  A.cancelNotice = async d => { const note = prompt(T('سبب الإلغاء', 'Reason')); if (note == null) return; await act('cancelNotice', { id: d.id, note }, T('أُلغيت', 'Cancelled')); };
  function noticeEditor(n) {
    const s = S(), centers = s.forecasts.map(f => [f.id, L(f.name), f.p, f.name]);
    const m = modal('<h3>' + (n ? T('تعديل ', 'Edit ') + esc(n.number) : T('إشعار ملاحي جديد', 'New navigational notice')) + '</h3><form class="form" id="nf">' + (n ? '' : '<div class="grid2f"><label>' + T('النوع', 'Type') + '<select name="category">' + Object.keys(WCAT).map(k => '<option value="' + k + '">' + wcat(k) + '</option>').join('') + '</select></label><label>' + T('الخطورة', 'Severity') + '<select name="severity">' + ['low', 'moderate', 'high', 'critical'].map(l => '<option value="' + l + '"' + (l === 'high' ? ' selected' : '') + '>' + lv(l) + '</option>').join('') + '</select></label><label>' + T('المنطقة البحرية', 'Sea area') + '<select name="center">' + centers.map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') + '</select></label><label>' + T('نصف القطر (ميل بحري) – يحدد نطاق التوزيع', 'Radius (nm) – sets the distribution scope') + '<input name="radius" type="number" min="5" max="400" value="80"></label><label>' + T('المدة (ساعات)', 'Duration (h)') + '<input name="dur" type="number" min="1" max="240" value="24"></label></div>') +
      '<div class="bil"><label>' + T('العنوان (عربي)', 'Title (Arabic)') + '<input name="tar" dir="rtl" required value="' + esc(n ? n.title.ar : '') + '"></label><label>' + T('العنوان (إنجليزي)', 'Title (English)') + '<input name="ten" dir="ltr" required value="' + esc(n ? n.title.en : '') + '"></label><label>' + T('النص (عربي)', 'Text (Arabic)') + '<textarea name="bar" dir="rtl" required>' + esc(n ? n.body.ar : '') + '</textarea></label><label>' + T('النص (إنجليزي)', 'Text (English)') + '<textarea name="ben" dir="ltr" required>' + esc(n ? n.body.en : '') + '</textarea></label></div><div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('حفظ', 'Save') + '</button></div></form>', 'wide');
    $('#nf', m).onsubmit = async e => {
      e.preventDefault(); const f = e.target, title = { ar: val(f, 'tar'), en: val(f, 'ten') }, body = { ar: val(f, 'bar'), en: val(f, 'ben') };
      if (n) { if (await act('editNotice', { id: n.id, title, body }, T('حُفظ', 'Saved'))) closeModal(); return; }
      const c = centers.find(x => x[0] === val(f, 'center')), rad = Number(val(f, 'radius')), now = S().now;
      const r = await act('createNotice', { category: val(f, 'category'), severity: val(f, 'severity'), poly: C.circlePoly(c[2], rad, 24), zone: { ar: c[3].ar + ' (' + rad + ' ميل)', en: c[3].en + ' (' + rad + ' nm)' }, startAt: now, expiryAt: now + Number(val(f, 'dur')) * H, title, body, action: { ar: '', en: '' } }, T('أُنشئت النشرة', 'Notice created'));
      if (r) { closeModal(); state.selNotice = r.id; update(); }
    };
  }
  A.newNotice = () => noticeEditor(null);
  A.editNotice = d => noticeEditor(S().navnotices.find(x => x.id === d.id));

  // 5) Alternative routes
  function routeInfo(r, o) {
    if (!o) return '<p class="bad">' + T('لا يوجد خيار تتوفر له بيانات كافية للتحقق من سلامته. يلزم تقييم الضابط والتواصل مع السفينة.', 'No option has enough data to verify its safety. Officer assessment and contact with the vessel are needed.') + '</p>';
    const RF = { hazard_cross: ['يمر قرب منطقة خطر', 'Passes near a hazard zone'], met: ['أحوال جوية متوقعة على المسار', 'Forecast weather along the route'], dest_occ: ['ازدحام في ميناء الوجهة', 'Congestion at destination'], uncertain_duration: ['مدة الانتظار تعتمد على انتهاء الحالة', 'Waiting time depends on the event ending'], leaving_area: ['السفينة داخل منطقة الخطر وتحتاج للخروج منها', 'Vessel must first exit the hazard area'], alt_port_weather: ['الميناء البديل يتأثر بالأحوال', 'Alternative port is weather-affected'], long_haul: ['مسافة إضافية طويلة', 'Long extra distance'], draft_margin: ['هامش غاطس محدود', 'Limited draft margin'], dest_closed: ['الوجهة مغلقة', 'Destination closed'] };
    const risks = o.risk.factors.filter(f => f.pts > 0).map(f => T(...(RF[f.k] || [f.k, f.k])));
    return '<div class="kv"><span>' + T('الخيار', 'Option') + '</span><b>' + opt(o.kind) + (o.holdName ? ' – ' + esc(L(o.holdName)) : '') + ' → ' + esc(pname(o.destId)) + '</b><span>' + T('المسافة', 'Distance') + '</span><b>' + N(o.nm) + T(' ميل بحري', ' nm') + ' (' + (o.extraNm >= 0 ? '+' : '') + N(o.extraNm) + ')</b><span>' + T('الوقت المتوقع', 'Expected time') + '</span><b>' + N(o.hours, 1) + T(' ساعة', ' h') + ' (' + (o.extraHours >= 0 ? '+' : '') + N(o.extraHours, 1) + ')' + (o.waitHours ? T(' منها انتظار ', ' incl. waiting ') + N(o.waitHours, 1) + T(' س', ' h') : '') + '</b><span>' + T('مستوى الخطر', 'Risk level') + '</span><b>' + lvB(o.risk.level) + '</b><span>' + T('سبب الاختيار', 'Why this option') + '</span><b>' + esc(L(r.rationale)) + '</b><span>' + T('مخاطر محتملة على المسار', 'Possible risks on route') + '</span><b>' + (risks.length ? risks.map(esc).join('، ') : T('لا توجد مخاطر معروفة', 'None known')) + '</b></div>';
  }
  OFF.routes = {
    mount: () => '<div class="split"><aside class="panel side-list"><h3>' + T('السفن المتأثرة بإنذارات مَرسى', 'Vessels affected by MARSA alerts') + '</h3><div id="rlist"></div></aside><div><div class="panel mapp"><div class="mapbox mid" id="rmap"></div><div class="maplegend"><span class="lg z local"></span>' + T('منطقة الخطر', 'Hazard area') + ' <span class="lg ln cur"></span>' + T('المسار الأصلي', 'Original route') + ' <span class="lg ln alt"></span>' + T('المسار البديل', 'Alternative route') + '</div></div><div class="panel" id="rdet"></div></div></div>',
    bind: m => ensureMap('rmap', $('#rmap', m), { fit: [34, 15, 51, 29] }),
    upd: () => {
      const s = S(), list = s.recs.filter(r => r.status !== 'superseded').slice().reverse();
      if (!state.selRec || !list.some(r => r.id === state.selRec)) state.selRec = list[0] ? list[0].id : null;
      const stB = r => r.status === 'released' ? B('ok', r.autoReleased ? T('أُرسل مع الإنذار', 'Sent with alert') : T('معتمد ومرسل', 'Approved & sent')) : r.status === 'pending' ? B('warn', T('يحتاج اعتمادك', 'Needs your approval')) : B('muted', r.status === 'rejected' ? T('مرفوض', 'Rejected') : T('منتهٍ', 'Expired'));
      fill('#rlist', list.length ? '<ul class="vlist">' + list.map(r => '<li><button class="' + (r.id === state.selRec ? 'on' : '') + '" data-a="selRec" data-id="' + r.id + '"><b>' + esc(vname(r.vesselId)) + '</b><span>' + opt(r.action) + '</span><span>' + stB(r) + (r.response ? ' ' + B('ok', r.response.kind === 'reviewed' ? T('اطلع الطاقم', 'Crew reviewed') : r.response.kind === 'accepted' ? T('اعتمده الطاقم', 'Crew adopted') : T('رد الطاقم', 'Crew responded')) : '') + '</span></button></li>').join('') + '</ul>' : empty(T('تظهر هنا المسارات البديلة عند إرسال إنذار محلي من مَرسى لسفن في مسار الخطر.', 'Alternative routes appear here when MARSA sends a local alert to vessels in the hazard path.')));
      const r = state.selRec && s.recs.find(x => x.id === state.selRec);
      const w = r && (warning(r.warningId) || s.hazards.find(h => r.hazardIds.includes(h.id)));
      if (state.maps.rmap) state.maps.rmap.setData(mapData({ zones: w ? [{ poly: w.poly, cls: 'local', label: w.title }] : [], hazards: s.hazards.filter(h => r && r.hazardIds.includes(h.id) && !h.warningId), routes: r ? recRoutes(r, r.optionId) : [], vessels: r ? s.vessels.filter(v => v.id === r.vesselId).map(v => Object.assign({}, v, { affected: true })) : [] }));
      if (r && state.maps.rmap && $('#rmap').dataset.fit !== r.id) { $('#rmap').dataset.fit = r.id; const o = r.options.find(x => x.id === r.optionId); state.maps.rmap.fitPoints(r.current.coords.slice(0, 6).concat(o ? o.coords.slice(0, 8) : []), 1); }
      if (!r) { fill('#rdet', ''); return; }
      const o = r.options.find(x => x.id === r.optionId);
      fill('#rdet', '<div class="row between"><h2>' + esc(vname(r.vesselId)) + ' · ' + esc(r.number) + '</h2>' + stB(r) + '</div><p class="sm">' + T('مرتبط بالإنذار ', 'Linked to alert ') + '<b>' + esc((warning(r.warningId) || {}).number || T('منطقة خطر نشطة', 'active hazard zone')) + '</b> · ' + T('المسار الأصلي ', 'Original route ') + N(r.current.nm) + T(' ميل', ' nm') + ' / ' + N(r.current.hours, 1) + T(' ساعة', ' h') + '</p>' + routeInfo(r, o) +
        (r.options.length > 1 ? '<h3>' + T('خيارات أخرى', 'Other options') + '</h3>' + tbl([T('الخيار', 'Option'), T('المسافة', 'Distance'), T('الوقت', 'Time'), T('الخطر', 'Risk')], r.options.filter(x => x.id !== r.optionId).map(x => tr([opt(x.kind) + ' → ' + esc(pname(x.destId)), N(x.nm) + ' nm', N(x.hours, 1) + ' h', lvB(x.risk.level)]))) : '') +
        (r.status === 'pending' ? '<p class="note">' + T('لم يُرسل هذا المسار تلقائيًا لأن مستوى خطره مرتفع أو البيانات غير كافية للتحقق من سلامته. يُعرض كتوصية تحتاج اعتمادك.', 'Not sent automatically because its risk is high or data is insufficient to verify safety. It is shown as a recommendation needing your approval.') + '</p><div class="row"><button class="btn" data-a="approveRoute" data-id="' + r.id + '">' + T('اعتماد وإرسال للسفينة', 'Approve & send to vessel') + '</button><button class="btn ghost sm" data-a="rejectRoute" data-id="' + r.id + '">' + T('رفض', 'Reject') + '</button></div>' : '') +
        (r.response ? '<p class="okline">' + T('رد الطاقم: ', 'Crew response: ') + esc(r.response.by) + ' · ' + fT(r.response.at) + (r.response.reason ? ' · ' + esc(r.response.reason) : '') + '</p>' : ''));
    }
  };
  A.selRec = d => { state.selRec = d.id; update(); };
  A.approveRoute = d => {
    const m = modal('<h3>' + T('اعتماد المسار البديل', 'Approve the alternative route') + '</h3><form class="form" id="pf">' + discBlock() + '<div class="row end"><button type="button" class="btn ghost" data-x>' + T('إلغاء', 'Cancel') + '</button><button class="btn">' + T('اعتماد وإرسال', 'Approve & send') + '</button></div></form>');
    $('#pf', m).onsubmit = async e => { e.preventDefault(); if (!discOk(e.target)) return; if (await act('decideRoute', { id: d.id, decision: 'approve', disclaimer: true }, T('أُرسل المسار للسفينة', 'Route sent to the vessel'))) closeModal(); };
  };
  A.rejectRoute = async d => { const note = prompt(T('سبب الرفض', 'Reason')); if (note == null) return; await act('decideRoute', { id: d.id, decision: 'reject', disclaimer: true, note }, T('رُفض', 'Rejected')); };

  // Officer extras: scenarios, notifications, report
  A.scenarios = () => {
    const m = modal('<h3>' + T('سيناريو تجريبي', 'Demo scenario') + '</h3><div class="scen-list"><button class="scen" data-s="jed_storm"><b>' + T('طقس شديد يقترب من جدة خلال ٦ ساعات', 'Severe weather approaching Jeddah within 6 hours') + '</b><span>' + T('تصل بيانات أرصاد تجريبية ← تنبؤ بالسفن المعرضة ← إنذار محلي جاهز للإرسال ← نشرة ملاحية جاهزة للتوجيه', 'Demo met data arrives → vessels at risk predicted → local alert ready to send → navigational notice ready to route') + '</span></button><button class="scen" data-s="bab"><b>' + T('خطر أمني في باب المندب', 'Security hazard at Bab el-Mandeb') + '</b><span>' + T('نشرة بنطاق دولي تُوجَّه إلى محطة كراتشي + مسارات بديلة', 'International-scope notice routed to Karachi + alternative routes') + '</span></button></div><div class="row between"><button class="btn ghost danger" data-s="reset">' + T('إعادة ضبط البيانات التجريبية', 'Reset demo data') + '</button><button class="btn ghost" data-x>' + T('إغلاق', 'Close') + '</button></div>');
    m.addEventListener('click', async e => { const b = e.target.closest('[data-s]'); if (!b) return; closeModal(); if (b.dataset.s === 'reset') { if (confirm(T('ستُحذف كل البيانات التجريبية. متابعة؟', 'All demo data will be cleared. Continue?'))) await act('resetDemo'); } else { const r = await act('runScenario', { id: b.dataset.s }, T('بدأ السيناريو', 'Scenario started')); if (r) { state.tab = b.dataset.s === 'bab' ? 'notices' : 'predict'; renderView(); } } });
  };
  A.notes = () => {
    const list = S().notifications.slice().reverse().slice(0, 40);
    modal('<h3>' + T('الإشعارات', 'Notifications') + '</h3>' + (list.length ? '<ul class="nlist">' + list.map(n => '<li class="' + n.level + (n.readBy.includes(me().id) ? ' read' : '') + '"><div><b>' + esc(L(n.title)) + '</b><p class="sm">' + esc(L(n.body)) + '</p><span class="sm muted">' + fT(n.createdAt) + '</span></div></li>').join('') + '</ul>' : empty(T('لا توجد إشعارات.', 'No notifications.'))) + '<div class="row end"><button class="btn ghost" data-x>' + T('إغلاق', 'Close') + '</button></div>', 'wide');
    client.call('markRead', { all: true }).catch(() => {});
  };
  A.report = async () => {
    const s = S(), sc = s.scenario, at = sc ? sc.startedAt : 0, w = s.warnings.filter(x => x.level === 'LOCAL' && x.createdAt >= at), dl = s.deliveries.filter(d => d.sentAt >= at), nn = (s.navnotices || []).filter(n => n.createdAt >= at), rs = s.recs.filter(r => r.createdAt >= at && r.status !== 'superseded');
    const vf = await client.call('verifyAudit', {}).catch(() => null);
    const num = 'RPT-' + fD(s.now).replace(/-/g, '') + '-' + C.sha256(String(s.now)).slice(0, 4).toUpperCase();
    const blocks = [{ type: 'kv', items: [[T('رقم التقرير', 'Report no.'), num], [T('تاريخ الإصدار', 'Issued'), fISO(s.now)], [T('أصدره', 'By'), L(me().name)], [T('الإنذارات المحلية', 'Local alerts'), w.length], [T('السفن المبلغة', 'Vessels alerted'), dl.length], [T('أكدت الاستلام', 'Confirmed'), dl.filter(d => d.ackAt).length], [T('تعذر الإرسال', 'Failed'), dl.filter(d => d.status === 'failed').length], [T('النشرات', 'Notices'), nn.length], [T('المسارات البديلة', 'Alternative routes'), rs.length], [T('سلامة سجل التدقيق', 'Audit chain'), vf ? (vf.ok ? T('سليم', 'intact') + ' ' + vf.head : T('مكسور', 'broken')) : '—']] },
      { type: 'h', text: T('السفن المتوقع تعرضها للخطر', 'Vessels predicted at risk') }, { type: 'table', columns: [T('السفينة', 'Vessel'), T('الخطر', 'Risk'), T('المنطقة', 'Area'), T('الوقت', 'Time'), T('الخطورة', 'Severity')], rows: s.predictions.filter(p => p.category === 'vessel_exposure').map(p => [vname(p.vesselId), T(...CAUSE[p.cause]), L(p.area), fISO(p.start), lv(p.severity)]) },
      { type: 'h', text: T('الإنذارات المحلية', 'Local alerts') }, { type: 'table', columns: [T('الرقم', 'No.'), T('العنوان', 'Title'), T('الحالة', 'Status'), T('أُرسل', 'Sent')], weights: [1.3, 3.5, 1.3, 1.5], rows: w.map(x => [x.number, L(x.title), T(...(AST[x.status] || [x.status, x.status])), fISO(x.issueAt)]) },
      { type: 'h', text: T('الإرسال والاستلام', 'Delivery and receipt') }, { type: 'table', columns: [T('السفينة', 'Vessel'), 'MMSI', T('القناة', 'Channel'), T('الحالة', 'Status'), T('أُرسل', 'Sent'), T('التأكيد', 'Confirmed')], rows: dl.map(d => [vname(d.vesselId), d.mmsi, T(...CH[d.channel]), T(...(DST[d.status] || [d.status, d.status])), fH(d.sentAt), d.ackAt ? fH(d.ackAt) + ' ' + (d.ackBy || '') : '—']) },
      { type: 'h', text: T('النشرات والإشعارات الملاحية', 'Navigational notices') }, { type: 'table', columns: [T('الرقم', 'No.'), T('العنوان', 'Title'), T('الجهات', 'Recipients'), T('الحالة', 'Status'), T('الإصدار الرسمي', 'Official ref')], weights: [1.2, 3, 2.4, 1.6, 1.4], rows: nn.map(n => [n.number, L(n.title), n.recipients.map(r => L(r.name)).join('، '), nst(n.status), n.officialRef || '—']) },
      { type: 'h', text: T('المسارات البديلة', 'Alternative routes') }, { type: 'table', columns: [T('السفينة', 'Vessel'), T('الخيار', 'Option'), T('الحالة', 'Status'), T('رد الطاقم', 'Crew response')], rows: rs.map(r => [vname(r.vesselId), opt(r.action), r.status, r.response ? r.response.kind + ' – ' + r.response.by : '—']) },
      { type: 'h', text: T('بيان المسؤولية', 'Responsibility statement') }, { type: 'note', text: L(s.disclaimer) }, { type: 'note', text: T('البيانات الموسومة «تجريبي» صادرة من بيئة عرض وليست اتصالًا حيًا.', 'Data labelled SIM comes from a demo environment, not a live connection.') }];
    toast(T('جارٍ إعداد PDF…', 'Preparing PDF…'));
    try { const blob = await X.pdf(blocks, { title: T('تقرير عمليات مَرسى', 'MARSA operations report'), brand: T('مَرسى · MARSA', 'MARSA · مَرسى'), footer: 'MARSA · ' + num, rtl: I.lang === 'ar' }); await X.save(num + '.pdf', blob); toast(T('تم التنزيل', 'Downloaded'), 'ok'); } catch (e) { toast(T('التنزيل غير متاح هنا', 'Download unavailable here'), 'bad'); }
  };

  // ---------- Ship Bridge ----------
  const BR = {
    mount: () => '<div id="sndhint"></div><div id="bstatus"></div><div class="grid2b"><div class="panel"><h2>' + T('المسار البديل المقترح', 'Suggested alternative route') + '</h2><div id="broute"></div></div><div class="panel"><h2>' + T('بيانات السفينة', 'Vessel data') + '</h2><div id="bvessel"></div></div></div><div class="panel"><h2>' + T('سجل الإنذارات', 'Alert log') + '</h2><div id="blog"></div></div>',
    bind: () => {},
    upd: () => {
      const s = S(), v = s.vessels[0]; if (!v) return;
      fill('#sndhint', Sound.on && !Sound.unlocked ? '<button class="sndhint" data-a="enableSound">' + ic(I_SOUND) + T('اضغط هنا لتفعيل صوت الإنذار على هذا الجهاز', 'Tap here to enable the alarm sound on this device') + '</button>' : !Sound.on ? '<button class="sndhint off" data-a="sound">' + T('صوت الإنذار متوقف – اضغط للتشغيل', 'Alarm sound is off – tap to turn on') + '</button>' : '');
      const dls = s.deliveries.slice().sort((a, b) => b.sentAt - a.sentAt), open = dls.filter(d => !d.ackAt && !['cancelled', 'failed'].includes(d.status));
      // mark received when displayed
      const unseen = dls.filter(d => !d.receivedAt && d.channel === 'marsa_app' && !state.sentReceived.has(d.id)).map(d => d.id);
      if (unseen.length && document.visibilityState === 'visible') { unseen.forEach(id => state.sentReceived.add(id)); client.call('deliveryEvent', { ids: unseen, event: 'received' }).catch(() => unseen.forEach(id => state.sentReceived.delete(id))); }
      fill('#bstatus', open.length ? open.map(d => { const w = warning(d.warningId) || {}; return '<div class="bigalert lv-critical"><div class="ba-head"><span class="ba-icon">!</span><div><b>' + esc(L(w.title)) + '</b><span>' + T('إنذار من مَرسى', 'MARSA alert') + ' · ' + esc(w.number) + ' · ' + lv(w.severity) + '</span></div></div><div class="ba-body"><p>' + esc(L(w.body)) + '</p><p><b>' + T('التعليمات: ', 'Instructions: ') + '</b>' + esc(L(w.action)) + '</p><p class="sm">' + T('الموقع: ', 'Area: ') + esc(L(w.zone)) + ' · ' + T('الوقت المتوقع: ', 'Expected: ') + fT(w.startAt) + ' – ' + fT(w.expiryAt) + '</p></div><button class="btn big light" data-a="ackAlert" data-id="' + d.id + '">' + T('تأكيد استلام الإنذار', 'Confirm receipt') + '</button></div>'; }).join('')
        : '<div class="calmline">' + T('لا توجد إنذارات بانتظار التأكيد. ستظهر هنا أي إنذارات جديدة من مَرسى مع تنبيه صوتي.', 'No alerts awaiting confirmation. New MARSA alerts will appear here with a sound alarm.') + '</div>');
      const r = s.recs.filter(x => x.released).slice(-1)[0];
      if (r) {
        const o = r.options.find(x => x.id === r.optionId), w = warning(r.warningId);
        if (!$('#bmap')) fill('#broute', '<div class="newroute" id="rnote"></div><div class="mapbox mid" id="bmap"></div><div class="maplegend"><span class="lg z local"></span>' + T('منطقة الخطر', 'Hazard area') + ' <span class="lg ln cur"></span>' + T('المسار الحالي', 'Current route') + ' <span class="lg ln alt"></span>' + T('المسار المقترح', 'Suggested route') + '</div><div id="rinfo"></div>');
        fill('#rnote', !r.response ? '<b>' + T('يوجد مسار بديل مقترح لسفينتك', 'An alternative route is suggested for your vessel') + '</b>' : '');
        const mp = ensureMap('bmap', $('#bmap'), {}); mp.setData(mapData({ zones: w ? [{ poly: w.poly, cls: 'local', label: w.title }] : [], routes: recRoutes(r, r.optionId) }));
        if ($('#bmap').dataset.fit !== r.id) { $('#bmap').dataset.fit = r.id; mp.fitPoints(r.current.coords.slice(0, 6).concat(o ? o.coords.slice(0, 8) : []).concat(w ? w.poly : []), 1); }
        fill('#rinfo', (o ? '<div class="kv"><span>' + T('التوصية', 'Recommendation') + '</span><b>' + opt(o.kind) + (o.holdName ? ' – ' + esc(L(o.holdName)) : '') + '</b><span>' + T('المسافة', 'Distance') + '</span><b>' + N(o.nm) + T(' ميل بحري', ' nm') + ' (' + (o.extraNm >= 0 ? '+' : '') + N(o.extraNm) + ')</b><span>' + T('الوقت المتوقع', 'Expected time') + '</span><b>' + N(o.hours, 1) + T(' ساعة', ' h') + ' (' + (o.extraHours >= 0 ? '+' : '') + N(o.extraHours, 1) + ')</b><span>' + T('السبب', 'Reason') + '</span><b>' + esc(L(r.rationale)) + '</b></div>' : '') + '<p class="muted sm">' + T('توصية استشارية. القرار الملاحي للربان، ومَرسى لا تتحكم بأنظمة السفينة.', 'Advisory recommendation. Navigation decisions rest with the master; MARSA does not control ship systems.') + '</p>' +
          (r.response && r.response.kind !== 'reviewed' ? '<p class="okline">' + T('تم الرد: ', 'Responded: ') + esc(r.response.by) + ' · ' + fT(r.response.at) + '</p>' : '<div class="row">' + (!r.response ? '<button class="btn" data-a="routeReviewed" data-id="' + r.id + '">' + T('تأكيد الاطلاع على المسار', 'Confirm route reviewed') + '</button>' : '<span class="okline sm">' + T('تم تأكيد الاطلاع', 'Reviewed') + '</span>') + '<button class="btn ghost sm" data-a="routeAdopt" data-id="' + r.id + '">' + T('اعتماده في خطة الرحلة', 'Adopt in voyage plan') + '</button><button class="btn ghost sm" data-a="routeDecline" data-id="' + r.id + '">' + T('عدم الاتباع مع ذكر السبب', 'Decline with reason') + '</button></div>'));
      } else fill('#broute', '<p class="muted">' + T('لا يوجد مسار بديل مقترح حاليًا.', 'No alternative route suggested at the moment.') + '</p>');
      fill('#bvessel', '<div class="kv"><span>MMSI</span><b><code>' + esc(v.mmsi) + '</code></b><span>' + T('الموقع', 'Position') + '</span><b>' + ll(v.pos) + ' ' + SIM() + '</b><span>' + T('الاتجاه / السرعة', 'Heading / speed') + '</span><b>' + N(v.cog) + '° / ' + (v.status === 'underway' ? N(v.speedKn, 1) : 0) + T(' عقدة', ' kn') + '</b><span>' + T('الحالة', 'Status') + '</span><b>' + vst(v.status) + '</b><span>' + T('الوجهة', 'Destination') + '</span><b>' + esc(pname(v.destId)) + (v.etaH != null ? ' · ' + fT(s.now + v.etaH * H) : '') + '</b></div>');
      fill('#blog', dls.length ? tbl([T('الإنذار', 'Alert'), T('النوع', 'Type'), T('وقت الاستلام', 'Received'), T('الخطورة', 'Severity'), T('حالة التأكيد', 'Confirmation'), T('مسار بديل', 'Alt. route')], dls.map(d => { const w = warning(d.warningId) || {}, rr = s.recs.find(x => x.warningId === d.warningId && x.released); return tr(['<b>' + esc(w.number) + '</b><div class="sm">' + esc(L(w.title)) + '</div>', wcat(w.category), fT(d.receivedAt || d.deliveredAt || d.sentAt), lvB(w.severity), d.ackAt ? B('ok', T('مؤكد ', 'Confirmed ') + fH(d.ackAt)) : w.status === 'cancelled' ? B('muted', T('ملغى', 'Cancelled')) : B('crit', T('بانتظار التأكيد', 'Awaiting')), rr ? opt(rr.action) : '—']); })) : empty(T('لا توجد إنذارات سابقة.', 'No previous alerts.')));
      // alarm popup for new alerts
      const ids = new Set(dls.map(d => d.id));
      if (state.seenDeliv === null) { state.seenDeliv = ids; if (open.length) showAlarm(open[0]); }
      else { const fresh = dls.filter(d => !state.seenDeliv.has(d.id)); fresh.forEach(d => state.seenDeliv.add(d.id)); if (fresh.length) showAlarm(fresh[0]); }
      const newRoute = s.recs.filter(x => x.released && !x.response);
      if (newRoute.length && !state.routeSeen) { state.routeSeen = new Set(); }
      for (const x of newRoute) if (state.routeSeen && !state.routeSeen.has(x.id)) { state.routeSeen.add(x.id); if (!$('.alarm')) toast(T('وصل مسار بديل مقترح – راجعه أدناه', 'Alternative route received – review below'), 'ok'); }
      if (!open.length) Sound.stopRepeat();
    }
  };
  function showAlarm(d, test) {
    const w = test ? { number: 'TEST', severity: 'critical', title: { ar: 'اختبار الإنذار', en: 'Alarm test' }, body: { ar: 'هذا اختبار لنظام الإنذار الصوتي والمرئي في جسر السفينة.', en: 'This is a test of the Ship Bridge audio-visual alarm.' }, action: { ar: 'لا يلزم أي إجراء.', en: 'No action required.' }, zone: { ar: '—', en: '—' }, startAt: S().now, expiryAt: S().now, source: { ar: 'مَرسى', en: 'MARSA' } } : warning(d.warningId);
    if (!w) return;
    $$('.alarm-wrap').forEach(x => x.remove());
    const el = document.createElement('div'); el.className = 'alarm-wrap';
    el.innerHTML = '<div class="alarm lv-critical" role="alertdialog" aria-modal="true"><div class="al-head"><span class="al-icon">!</span><div><b>' + (test ? T('اختبار', 'TEST') : T('إنذار من مَرسى', 'MARSA ALERT')) + '</b><span>' + T('الخطورة: ', 'Severity: ') + lv(w.severity) + ' · ' + esc(w.number) + '</span></div></div><h2>' + esc(L(w.title)) + '</h2><p>' + esc(L(w.body)) + '</p>' +
      '<div class="kv"><span>' + T('الموقع', 'Location') + '</span><b>' + esc(L(w.zone)) + '</b><span>' + T('الوقت المتوقع', 'Expected time') + '</span><b>' + fT(w.startAt) + ' – ' + fT(w.expiryAt) + '</b><span>' + T('التعليمات', 'Instructions') + '</span><b>' + esc(L(w.action)) + '</b><span>' + T('صدر', 'Issued') + '</span><b>' + fT(w.issueAt || S().now) + ' · ' + T('منصة مَرسى – ضابط الميناء', 'MARSA – Port Officer') + '</b></div>' +
      (test ? '<button class="btn big light" data-a="closeAlarm">' + T('إغلاق الاختبار', 'Close test') + '</button>' : '<label class="offname">' + T('اسم الضابط المناوب', 'Officer of the watch') + '<input id="alof" value="' + esc(T('ضابط المناوبة', 'Officer of the watch')) + '"></label><button class="btn big light" data-a="ackFromAlarm" data-id="' + d.id + '">' + T('تأكيد استلام الإنذار', 'Confirm receipt') + '</button><button class="btn ghost light sm" data-a="closeAlarm">' + T('عرض لاحقًا', 'Later') + '</button>') + '</div>';
    document.body.appendChild(el);
    Sound.ring(); if (!test) Sound.repeat();
  }
  A.enableSound = () => { Sound.unlock(); setTimeout(() => { Sound.ring(true); update(); }, 150); toast(T('تم تفعيل صوت الإنذار', 'Alarm sound enabled'), 'ok'); };
  A.testAlarm = () => { Sound.unlock(); showAlarm(null, true); };
  A.closeAlarm = () => { $$('.alarm-wrap').forEach(x => x.remove()); Sound.stopRepeat(); };
  A.ackFromAlarm = async d => { const name = ($('#alof') || {}).value || T('ضابط المناوبة', 'Officer of the watch'); if (await act('acknowledge', { id: d.id, officer: name }, T('أُرسل تأكيد الاستلام إلى مَرسى', 'Receipt confirmation sent to MARSA'))) A.closeAlarm(); };
  A.ackAlert = d => { const dl = S().deliveries.find(x => x.id === d.id); showAlarm(dl); };
  const respond = (id, response, reason) => act('respondRecommendation', { id, response, reason, officer: T('ضابط المناوبة', 'Officer of the watch') }, T('أُرسل الرد إلى مَرسى', 'Response sent to MARSA'));
  A.routeReviewed = d => respond(d.id, 'reviewed');
  A.routeAdopt = d => { if (confirm(T('اعتماد المسار البديل في خطة الرحلة؟ القرار للربان.', 'Adopt the alternative route in the voyage plan? The master decides.'))) respond(d.id, 'accepted'); };
  A.routeDecline = d => { const r = prompt(T('سبب عدم الاتباع', 'Reason for declining')); if (r) respond(d.id, 'rejected', r); };

  // ---------- Boot ----------
  function captainDelivered(s) {
    if (s.me.role !== 'captain') return;
    const ids = s.deliveries.filter(d => d.channel === 'marsa_app' && !d.deliveredAt && !state.sentDelivered.has(d.id)).map(d => d.id);
    if (!ids.length) return; ids.forEach(id => state.sentDelivered.add(id));
    client.call('deliveryEvent', { ids, event: 'delivered' }).catch(() => ids.forEach(id => state.sentDelivered.delete(id)));
  }
  function onSnap(s, first) {
    if (state.view === 'home') return;
    state.snap = s;
    if (first) { state.seenDeliv = null; state.routeSeen = null; renderView(); } else update();
    captainDelivered(s);
  }
  client.subscribe(s => { if (state.snap) onSnap(s); });
  (async () => {
    if (window.claude && window.claude.use) { window.claude.use('downloads').catch(() => null); }
    renderHome();
  })();
})();
