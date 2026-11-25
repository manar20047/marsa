/* MARSA interactive sea map — dependency-free SVG (Web Mercator), pan/zoom/pinch, layer toggles. */
(function (root) {
  const C = root.MarsaCore;
  const B = { lonMin: 8, lonMax: 80, latMin: -37, latMax: 34.5 };
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
  const U = 100; // world units per degree (keeps SVG font sizes well above browser minimums)
  const X = lon => (lon - B.lonMin) * U, Y = lat => (mercY(B.latMax) - mercY(lat)) * U;
  const WW = X(B.lonMax), WH = Y(B.latMin);
  const P = p => [X(p[0]), Y(p[1])];
  const d3 = v => v.toFixed(1);
  const pathOf = (coords, close) => coords.map((p, i) => (i ? 'L' : 'M') + P(p).map(d3).join(' ')).join('') + (close ? 'Z' : '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Off-map legs are drawn to an exit point at the map edge instead of the virtual anchor.
  const EXIT = { EUROPE: { CPT: [8.3, -30.5], PSD: [31.2, 34.6] }, ASIA: { ASIA_GATE: [80.2, 5.2] } };
  function routeCoords(start, nodes) {
    const out = start ? [start] : [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (C.VIRTUAL[n]) { const prev = nodes[i - 1]; out.push((EXIT[n] && EXIT[n][prev]) || C.NODES[n]); }
      else out.push(C.NODES[n]);
    }
    return out;
  }
  const RISKC = { low: 'var(--ok)', medium: 'var(--warn)', high: 'var(--hi)', critical: 'var(--crit)' };

  class SeaMap {
    constructor(el, opts = {}) {
      this.el = el; this.opts = opts; this.lang = opts.lang || 'ar';
      this.layers = Object.assign({ ports: true, vessels: true, hazards: true, lanes: true, current: true, alt: true, cov: false, navarea: true, met: false, stations: true }, opts.layers || {});
      this.data = {}; this.sel = null;
      el.classList.add('seamap');
      el.innerHTML = '<svg role="img" aria-label="' + esc(opts.label || 'Sea map') + '"><rect class="sea" x="' + (-40 * U) + '" y="' + (-40 * U) + '" width="' + (WW + 80 * U) + '" height="' + (WH + 80 * U) + '"/><g class="static"></g><g class="dyn"></g></svg>' +
        '<div class="mapctl"><button type="button" data-z="in" aria-label="+">+</button><button type="button" data-z="out" aria-label="−">−</button><button type="button" data-z="fit" aria-label="fit">⤢</button></div>';
      this.svg = el.querySelector('svg'); this.gS = el.querySelector('.static'); this.gD = el.querySelector('.dyn');
      this.drawStatic();
      this.fit(opts.fit || [30, 4, 76, 31.5]);
      this.bind();
      this.ro = new ResizeObserver(() => this.onResize()); this.ro.observe(el);
    }
    drawStatic() {
      let s = '';
      for (let lon = 10; lon <= 80; lon += 10) s += '<path class="grid" d="M' + d3(X(lon)) + ' 0V' + d3(WH) + '"/>';
      for (let lat = -30; lat <= 30; lat += 10) s += '<path class="grid" d="M0 ' + d3(Y(lat)) + 'H' + d3(WW) + '"/>';
      for (const k in C.LAND) s += '<path class="land" d="' + pathOf(C.LAND[k], true) + '"/>';
      this.gS.innerHTML = s;
    }
    fit(bb) {
      const x0 = X(bb[0]), x1 = X(bb[2]), y0 = Y(bb[3]), y1 = Y(bb[1]);
      const cw = this.el.clientWidth || 800, ch = this.el.clientHeight || 500, ar = ch / cw;
      let w = x1 - x0, h = y1 - y0;
      if (h / w > ar) w = h / ar; else h = w * ar;
      this.vb = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }; this.home = bb;
      this.apply();
    }
    fitPoints(pts, pad = 2) {
      if (!pts.length) return;
      let a = 180, b = 90, c = -180, d = -90;
      for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
      this.fit([Math.max(B.lonMin, a - pad), Math.max(B.latMin, b - pad), Math.min(B.lonMax, c + pad), Math.min(B.latMax, d + pad)]);
    }
    onResize() { const cw = this.el.clientWidth, ch = this.el.clientHeight; if (!cw || !ch) return; const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2; this.vb.h = this.vb.w * ch / cw; this.vb.y = cy - this.vb.h / 2; this.vb.x = cx - this.vb.w / 2; this.apply(); }
    apply() {
      const v = this.vb; v.w = Math.min(Math.max(v.w, 1.2 * U), WW * 1.4);
      this.svg.setAttribute('viewBox', [v.x, v.y, v.w, v.h].map(d3).join(' '));
      this.k = v.w / (this.el.clientWidth || 800); this.svg.style.setProperty('--k', this.k);
      this.render();
    }
    zoom(f, cx, cy) {
      const v = this.vb; if (cx == null) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; }
      const nw = Math.min(Math.max(v.w * f, 1.2 * U), WW * 1.4), r = nw / v.w;
      v.x = cx - (cx - v.x) * r; v.y = cy - (cy - v.y) * r; v.w = nw; v.h *= r; this.apply();
    }
    toWorld(ev) { const r = this.svg.getBoundingClientRect(); return [this.vb.x + (ev.clientX - r.left) / r.width * this.vb.w, this.vb.y + (ev.clientY - r.top) / r.height * this.vb.h]; }
    bind() {
      const pts = new Map(); let moved = 0, last = null, pinch = null;
      this.el.querySelector('.mapctl').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.z === 'in') this.zoom(0.7); else if (b.dataset.z === 'out') this.zoom(1.4); else this.fit(this.home); });
      this.svg.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = this.toWorld(e); this.zoom(e.deltaY > 0 ? 1.18 : 0.85, x, y); }, { passive: false });
      this.svg.addEventListener('pointerdown', e => { this.svg.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; last = [e.clientX, e.clientY]; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
      this.svg.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const r = this.svg.getBoundingClientRect(); const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; this.zoom(pinch / d, this.vb.x + (mx - r.left) / r.width * this.vb.w, this.vb.y + (my - r.top) / r.height * this.vb.h); pinch = d; moved += 10; return; }
        const dx = e.clientX - last[0], dy = e.clientY - last[1]; moved += Math.abs(dx) + Math.abs(dy); last = [e.clientX, e.clientY];
        if (moved > 3) { const r = this.svg.getBoundingClientRect(); this.vb.x -= dx / r.width * this.vb.w; this.vb.y -= dy / r.height * this.vb.h; this.svg.setAttribute('viewBox', [this.vb.x, this.vb.y, this.vb.w, this.vb.h].map(d3).join(' ')); }
      });
      const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (moved <= 3 && e.type === 'pointerup') { const t = document.elementFromPoint(e.clientX, e.clientY); const s = t && t.closest('[data-sel]'); if (s && this.opts.onSelect) { const v = s.getAttribute('data-sel'), i = v.indexOf(':'); this.opts.onSelect(v.slice(0, i), v.slice(i + 1)); } } };
      this.svg.addEventListener('pointerup', up); this.svg.addEventListener('pointercancel', up);
    }
    setLang(l) { this.lang = l; this.render(); }
    setData(d) { this.data = d; this.render(); }
    setLayers(l) { Object.assign(this.layers, l); this.render(); }
    nm(o) { return o ? (o[this.lang] || o.en || o.ar || '') : ''; }
    render() {
      if (!this.gD) return;
      const k = this.k, L = this.layers, d = this.data, lang = this.lang, s = [];
      const fs = 11.5 * k;
      if (L.navarea) for (const a of C.NAVAREAS.filter(a => a.id === 'IX')) s.push('<path class="navarea" d="' + pathOf(a.poly, true) + '"/><text class="nalabel" x="' + d3(X(61)) + '" y="' + d3(Y(25.9)) + '" font-size="' + d3(fs * 0.9) + '">NAVAREA IX</text>');
      if (L.lanes) { let p = ''; for (const [a, b, o = {}] of C.EDGES) if (!o.offmap) p += 'M' + P(C.NODES[a]).map(d3).join(' ') + 'L' + P(C.NODES[b]).map(d3).join(' '); s.push('<path class="lane" d="' + p + '"/>'); }
      for (const l of C.SEA_LABELS) { const [x, y] = P(l.p); s.push('<text class="sealabel' + (l.small ? ' sm' : '') + '" x="' + d3(x) + '" y="' + d3(y) + '" font-size="' + d3(fs * (l.small ? 0.85 : 1.15)) + '"' + (l.rot ? ' transform="rotate(' + l.rot + ' ' + d3(x) + ' ' + d3(y) + ')"' : '') + '>' + esc(lang === 'ar' ? l.ar : l.en) + '</text>'); }
      s.push('<text class="offmap" x="' + d3(X(9)) + '" y="' + d3(Y(-29.2)) + '" font-size="' + d3(fs * .85) + '">' + (lang === 'ar' ? '← إلى أوروبا عبر الأطلسي' : '← to Europe via Atlantic') + '</text>');
      s.push('<text class="offmap" x="' + d3(X(31.4)) + '" y="' + d3(Y(33.7)) + '" font-size="' + d3(fs * .85) + '">' + (lang === 'ar' ? '↑ إلى أوروبا عبر المتوسط' : '↑ to Europe via Med') + '</text>');
      s.push('<text class="offmap end" x="' + d3(X(79.6)) + '" y="' + d3(Y(6.6)) + '" font-size="' + d3(fs * .85) + '">' + (lang === 'ar' ? 'إلى شرق آسيا →' : 'to East Asia →') + '</text>');
      if (L.cov && d.stations) for (const st of d.stations) if (st.rangeNm) s.push('<path class="cov' + (st.channel === 'sandbox' ? ' on' : '') + '" d="' + pathOf(C.circlePoly(st.p, st.rangeNm, 48), true) + '"/>');
      if (L.met && d.met) for (const m of d.met) { const [x, y] = P(m.p); s.push('<g class="met ' + (m.level || 'ok') + '"><circle cx="' + d3(x) + '" cy="' + d3(y) + '" r="' + d3(13 * k) + '"/><text x="' + d3(x) + '" y="' + d3(y + 3.6 * k) + '" font-size="' + d3(fs * .85) + '">' + m.waveM + 'm</text></g>'); }
      if (L.zones !== false && d.zones) for (const z of d.zones) { s.push('<path' + (z.sel ? ' data-sel="' + esc(z.sel) + '"' : '') + ' class="zone z-' + esc(z.cls) + (this.sel === z.sel ? ' sel' : '') + '" d="' + pathOf(z.poly, true) + '"><title>' + esc(this.nm(z.label)) + '</title></path>'); if (z.tag) { let a = 0, b = -90; for (const q of z.poly) { a += q[0]; if (q[1] > b) b = q[1]; } const [x, y] = P([a / z.poly.length, b]); s.push('<text class="ztag z-' + esc(z.cls) + '" x="' + d3(x) + '" y="' + d3(y - 4 * k) + '" font-size="' + d3(fs * .82) + '" text-anchor="middle">' + esc(this.nm(z.tag)) + '</text>'); } }
      if (L.hazards && d.hazards) for (const h of d.hazards) s.push('<path data-sel="hazard:' + esc(h.id) + '" class="hz ' + esc(h.type) + (this.sel === 'hazard:' + h.id ? ' sel' : '') + '" d="' + pathOf(h.poly, true) + '"><title>' + esc(this.nm(h.title)) + '</title></path>');
      const routes = d.routes || [];
      for (const r of routes) {
        if ((r.kind === 'current' && !L.current) || (r.kind !== 'current' && !L.alt)) continue;
        const coords = r.coords || routeCoords(r.start, r.nodes);
        s.push('<path class="route ' + r.kind + (r.dim ? ' dim' : '') + '" style="--rc:' + (r.color || '') + '" d="' + pathOf(coords) + '"' + (r.sel ? ' data-sel="' + esc(r.sel) + '"' : '') + '><title>' + esc(r.label || '') + '</title></path>');
        if (r.endLabel) { const e = coords[coords.length - 1]; const [x, y] = P(e); s.push('<circle class="rend" cx="' + d3(x) + '" cy="' + d3(y) + '" r="' + d3(3.5 * k) + '" style="--rc:' + (r.color || '') + '"/>'); }
      }
      if (L.ports && d.ports) for (const p of d.ports) {
        if (p.virtual) continue; const [x, y] = P(p.p); const r = (p.saudi ? 5.2 : 4) * k;
        s.push('<g data-sel="port:' + p.id + '" class="port ' + p.status + (p.saudi ? ' sa' : '') + (p.weatherFlag ? ' wx' : '') + (this.sel === 'port:' + p.id ? ' sel' : '') + '"><rect x="' + d3(x - r) + '" y="' + d3(y - r) + '" width="' + d3(2 * r) + '" height="' + d3(2 * r) + '" rx="' + d3(r * .35) + '"/><title>' + esc(this.nm(p.name)) + '</title></g>');
        if ((p.saudi && (k < 4.5 || ['JED', 'DMM', 'JZN', 'YNB'].includes(p.id))) || k < 2.6) s.push('<text class="plabel" x="' + d3(x + (lang === 'ar' ? -r * 1.6 : r * 1.6)) + '" y="' + d3(y + 3.6 * k) + '" font-size="' + d3(fs * (p.saudi ? .95 : .85)) + '" text-anchor="' + (lang === 'ar' ? 'end' : 'start') + '">' + esc(this.nm(p.name)) + '</text>');
      }
      if (L.stations && d.stations) for (const st of d.stations) {
        const [x, y] = P(st.p), r = 5 * k;
        s.push('<g data-sel="station:' + st.id + '" class="stn ' + st.connStatus + (st.role === 'COORDINATOR' ? ' coord' : '') + '"><path d="M' + d3(x) + ' ' + d3(y - r * 1.3) + 'L' + d3(x + r) + ' ' + d3(y + r * .8) + 'L' + d3(x - r) + ' ' + d3(y + r * .8) + 'Z"/><title>' + esc(this.nm(st.name)) + '</title></g>');
        if (st.role === 'COORDINATOR' && st.navarea === 'IX') s.push('<text class="slabel" x="' + d3(x) + '" y="' + d3(y + r * 3.2) + '" font-size="' + d3(fs * .9) + '" text-anchor="middle">' + (lang === 'ar' ? 'محطة كراتشي' : 'Karachi') + '</text>');
      }
      if (L.vessels && d.vessels) for (const v of d.vessels) {
        if (v.status === 'arrived' || v.status === 'out_of_area' || !v.pos) continue;
        const [x, y] = P(v.pos), sc = k * (v.mine ? 1.45 : 1.05);
        s.push('<g data-sel="vessel:' + v.id + '" class="ves' + (v.affected ? ' aff' : '') + (v.mine ? ' mine' : '') + (v.status === 'holding' ? ' hold' : '') + (v.status === 'anchored' || v.status === 'moored' ? ' still' : '') + (this.sel === 'vessel:' + v.id ? ' sel' : '') + '" transform="translate(' + d3(x) + ' ' + d3(y) + ') rotate(' + (v.cog || 0) + ') scale(' + d3(sc) + ')"><path d="M0 -8 L4.6 6 L0 3.4 L-4.6 6 Z"/><title>' + esc(v.name) + '</title></g>');
        if (v.mine || this.sel === 'vessel:' + v.id || k < 3) s.push('<text class="vlabel" x="' + d3(x + 8 * k) + '" y="' + d3(y - 7 * k) + '" font-size="' + d3(fs * .9) + '">' + esc(v.name) + '</text>');
      }
      this.gD.innerHTML = s.join('');
    }
    select(sel) { this.sel = sel; this.render(); }
    destroy() { this.ro.disconnect(); }
  }
  root.SeaMap = SeaMap; root.SeaMap.routeCoords = routeCoords; root.SeaMap.RISKC = RISKC;
})(typeof self !== 'undefined' ? self : this);
