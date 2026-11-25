/* MARSA exports — dependency-free XLSX (stored zip) and PDF (canvas-rendered pages, so Arabic shaping is done by the browser). */
(function (root) {
  // ---------- ZIP (store) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = s => new TextEncoder().encode(s);
  function zip(files) { // [{name, data:Uint8Array}]
    const parts = [], central = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc(f.name), c = crc32(f.data), n = f.data.length;
      const lh = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0)]);
      parts.push(lh, name, f.data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += lh.length + name.length + n;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
    return new Blob(parts.concat(central, [end]));
  }
  // ---------- XLSX ----------
  const x = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function xlsx(sheets, rtl) {
    const files = [];
    const sheetXml = sh => {
      const widths = sh.rows[0].map((_, ci) => Math.min(60, Math.max(10, ...sh.rows.slice(0, 200).map(r => String(r[ci] == null ? '' : r[ci]).length + 2))));
      let rows = '';
      sh.rows.forEach((r, ri) => {
        rows += '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
          const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
          return typeof v === 'number' && isFinite(v) ? '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
        }).join('') + '</row>';
      });
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"' + (rtl ? ' rightToLeft="1"' : '') + '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>' + rows + '</sheetData></worksheet>';
    };
    files.push({ name: '[Content_Types].xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>') });
    files.push({ name: '_rels/.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    files.push({ name: 'xl/workbook.xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + x(s.name.slice(0, 31).replace(/[\\/?*\[\]:]/g, ' ')) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>') });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') });
    files.push({ name: 'xl/styles.xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B2545"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>') });
    sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc(sheetXml(s)) }));
    return zip(files);
  }

  // ---------- PDF (pages rendered to canvas → JPEG → PDF) ----------
  const FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';
  function layoutDoc(blocks, o) {
    const land = !!o.landscape, Wpt = land ? 842 : 595, Hpt = land ? 595 : 842, S = 2, W = Wpt * S, H = Hpt * S, M = 36 * S, rtl = o.rtl;
    const pages = []; let cv, ctx, y;
    const newPage = () => {
      cv = document.createElement('canvas'); cv.width = W; cv.height = H; ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0b2545'; ctx.fillRect(0, 0, W, 54 * S);
      ctx.fillStyle = '#2ec4b6'; ctx.fillRect(0, 54 * S, W, 3 * S);
      ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.font = '600 ' + 15 * S + 'px ' + FONT; ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillText(o.title, rtl ? W - M : M, 27 * S);
      ctx.font = 11 * S + 'px ' + FONT; ctx.textAlign = rtl ? 'left' : 'right'; ctx.fillText(o.brand, rtl ? M : W - M, 27 * S);
      pages.push(cv); y = 76 * S;
    };
    const wrap = (text, maxW, font) => {
      ctx.font = font; const words = String(text == null ? '' : text).split(/\s+/); const lines = []; let cur = '';
      for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
      if (cur || !lines.length) lines.push(cur);
      // hard-break very long tokens
      return lines.flatMap(l => { if (ctx.measureText(l).width <= maxW) return [l]; const out = []; let c = ''; for (const ch of l) { if (ctx.measureText(c + ch).width > maxW) { out.push(c); c = ch; } else c += ch; } out.push(c); return out; });
    };
    newPage();
    const X0 = rtl ? W - M : M, CW = W - 2 * M;
    for (const b of blocks) {
      if (b.type === 'h') { if (y + 30 * S > H - 40 * S) newPage(); ctx.fillStyle = '#0b2545'; ctx.font = '600 ' + 13 * S + 'px ' + FONT; ctx.textAlign = rtl ? 'right' : 'left'; ctx.fillText(b.text, X0, y + 8 * S); y += 24 * S; }
      else if (b.type === 'p' || b.type === 'note' || b.type === 'mono') {
        const font = (b.type === 'mono' ? 10 * S + 'px ui-monospace, Menlo, Consolas, monospace' : (b.type === 'note' ? 9.5 : 10.5) * S + 'px ' + FONT);
        const lh = (b.type === 'note' ? 13 : 15) * S;
        const texts = b.type === 'mono' ? String(b.text).split('\n') : [b.text];
        for (const tline of texts) {
          const lines = b.type === 'mono' ? [tline] : wrap(tline, CW, font);
          for (const l of lines) { if (y + lh > H - 40 * S) newPage(); ctx.font = font; ctx.fillStyle = b.type === 'note' ? '#5b6b7d' : '#16202c'; ctx.textAlign = b.type === 'mono' ? 'left' : (rtl ? 'right' : 'left'); ctx.direction = b.type === 'mono' ? 'ltr' : (rtl ? 'rtl' : 'ltr'); ctx.fillText(l, b.type === 'mono' ? M : X0, y + lh / 2); y += lh; }
        }
        ctx.direction = rtl ? 'rtl' : 'ltr'; y += 6 * S;
      } else if (b.type === 'kv') {
        const colW = CW / 2, lh = 17 * S;
        b.items.forEach((it, i) => {
          if (i % 2 === 0 && y + lh > H - 40 * S) newPage();
          const cx = rtl ? X0 - (i % 2) * colW : X0 + (i % 2) * colW;
          ctx.textAlign = rtl ? 'right' : 'left'; ctx.font = '600 ' + 9.5 * S + 'px ' + FONT; ctx.fillStyle = '#5b6b7d'; ctx.fillText(it[0], cx, y + lh / 2);
          const kw = ctx.measureText(it[0]).width + 8 * S; ctx.font = 10.5 * S + 'px ' + FONT; ctx.fillStyle = '#16202c'; ctx.fillText(String(it[1]), rtl ? cx - kw : cx + kw, y + lh / 2);
          if (i % 2 === 1 || i === b.items.length - 1) y += lh;
        });
        y += 8 * S;
      } else if (b.type === 'table') {
        const ws = b.weights || b.columns.map(() => 1), tw = ws.reduce((a, c) => a + c, 0), cols = ws.map(w => w / tw * CW), pad = 5 * S, lh = 12.5 * S, font = 9 * S + 'px ' + FONT, hfont = '600 ' + 9 * S + 'px ' + FONT;
        const drawRow = (cells, header, zebra) => {
          const lines = cells.map((c, i) => wrap(c, cols[i] - 2 * pad, header ? hfont : font));
          const rh = Math.max(...lines.map(l => l.length)) * lh + 2 * pad;
          if (y + rh > H - 40 * S) { newPage(); if (!header) drawRow(b.columns, true); }
          if (header) { ctx.fillStyle = '#e6eef6'; ctx.fillRect(M, y, CW, rh); } else if (zebra) { ctx.fillStyle = '#f7f9fb'; ctx.fillRect(M, y, CW, rh); }
          let cx = rtl ? W - M : M;
          lines.forEach((ls, i) => {
            ctx.font = header ? hfont : font; ctx.fillStyle = header ? '#0b2545' : '#16202c'; ctx.textAlign = rtl ? 'right' : 'left';
            ls.forEach((l, j) => ctx.fillText(l, rtl ? cx - pad : cx + pad, y + pad + lh * j + lh / 2));
            cx += rtl ? -cols[i] : cols[i];
          });
          ctx.strokeStyle = '#d5dee8'; ctx.lineWidth = S * .6; ctx.beginPath(); ctx.moveTo(M, y + rh); ctx.lineTo(W - M, y + rh); ctx.stroke();
          y += rh;
        };
        drawRow(b.columns, true);
        b.rows.forEach((r, i) => drawRow(r.map(v => v == null ? '' : String(v)), false, i % 2));
        y += 10 * S;
      }
    }
    pages.forEach((p, i) => { const c = p.getContext('2d'); c.direction = rtl ? 'rtl' : 'ltr'; c.font = 8.5 * S + 'px ' + FONT; c.fillStyle = '#5b6b7d'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.footer + '   ·   ' + (i + 1) + ' / ' + pages.length, W / 2, H - 20 * S); });
    return { pages, Wpt, Hpt };
  }
  function pdfFromCanvases({ pages, Wpt, Hpt }) {
    const chunks = [], offs = []; let len = 0;
    const push = d => { const b = typeof d === 'string' ? enc(d) : d; chunks.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; push(n + ' 0 obj\n'); if (Array.isArray(body)) body.forEach(push); else push(body); push('\nendobj\n'); };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = pages.length, kids = [];
    for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>');
    pages.forEach((cv, i) => {
      const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1], bin = atob(b64), img = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) img[j] = bin.charCodeAt(j);
      const p = 3 + i * 3, c = p + 1, im = p + 2, cs = 'q ' + Wpt + ' 0 0 ' + Hpt + ' 0 0 cm /Im0 Do Q';
      obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + Wpt + ' ' + Hpt + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + c + ' 0 R >>');
      obj(c, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
      obj(im, ['<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.length + ' >>\nstream\n', img, '\nendstream']);
    });
    const total = 3 + n * 3, xref = len;
    let xr = 'xref\n0 ' + total + '\n0000000000 65535 f \n'; for (let i = 1; i < total; i++) xr += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    push(xr + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(chunks, { type: 'application/pdf' });
  }
  async function pdf(blocks, o) { try { await document.fonts.ready; } catch (e) { /* ignore */ } return pdfFromCanvases(layoutDoc(blocks, o)); }

  // ---------- Save ----------
  let dl = null, dlTried = false;
  async function save(filename, blob) {
    if (!dlTried) { dlTried = true; try { if (root.claude && root.claude.use) dl = await root.claude.use('downloads'); } catch (e) { dl = null; } }
    if (dl) { await dl.save({ filename, data: blob }); return 'saved'; }
    if (root.MARSA_SERVER || !root.claude) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return 'saved'; }
    const e = new Error('unavailable'); e.code = 'unavailable'; throw e;
  }
  root.MarsaExport = { xlsx, pdf, save, zip };
})(typeof self !== 'undefined' ? self : this);
