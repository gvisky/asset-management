/* PDF report = the Dashboard only: title, key numbers, and one chart card per summary table
   (horizontal bars, columns or a doughnut with its legend). Same dashboard spec as lib/report-excel.js.
   DejaVu Sans (assets/fonts) so Vietnamese / Thai-Latin names print correctly. */

const PDFDocument = require('pdfkit');
const path = require('path');

const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_B = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
const BRAND = '#1a56db';
const PALETTE = ['#1a56db', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569', '#0d9488', '#a16207'];
const KPI_COLORS = { blue: '#1a56db', green: '#16a34a', amber: '#d97706', red: '#dc2626', purple: '#7c3aed', grey: '#475569', teal: '#0891b2' };
const INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(v == null ? '' : v));

function buildPdfReport({ dashboard: d, meta }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true,
      info: { Title: d.title, Author: 'Hayat Communication Tools' } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', FONT);
    doc.registerFont('B', FONT_B);

    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 14;

    // Title band
    doc.rect(L, 28, W, 40).fill(BRAND);
    doc.font('B').fontSize(18).fillColor('#ffffff').text(d.title, L + 14, 39, { width: W - 28, height: 24, lineBreak: false, ellipsis: true });
    doc.font('R').fontSize(8.5).fillColor(MUTED)
      .text([d.subtitle, `Generated ${meta.generated}`, meta.by && `by ${meta.by}`, meta.scope].filter(Boolean).join('  ·  '), L, 74, { width: W });
    let y = 92;

    // Key numbers
    const kpis = d.kpis || [];
    if (kpis.length) {
      const hasSplit = kpis.some(k => (k.split || []).length);
      const per = Math.min(6, kpis.length), gap = 8, kw = (W - gap * (per - 1)) / per, kh = hasSplit ? 64 : 50;
      kpis.forEach((k, i) => {
        const col = i % per, x = L + col * (kw + gap);
        if (i && col === 0) y += kh + gap;
        const color = KPI_COLORS[k.color] || BRAND;
        doc.roundedRect(x, y, kw, kh, 4).fill('#f1f5f9');
        doc.rect(x, y, kw, 3).fill(color);
        doc.font('B').fontSize(7.5).fillColor(MUTED).text(String(k.label).toUpperCase(), x + 9, y + 9, { width: kw - 18, lineBreak: false, ellipsis: true });
        doc.font('B').fontSize(18).fillColor(color).text(fmt(k.value), x + 9, y + 22, { width: kw - 18, lineBreak: false, ellipsis: true });
        // Per country chips: VN 601  TH 56  MY 48  CHI 1
        let cx = x + 9;
        for (const sp of (k.split || [])) {
          const t1 = sp.code + ' ', t2 = fmt(sp.n);
          doc.font('R').fontSize(7.5); const w1 = doc.widthOfString(t1);
          doc.font('B').fontSize(7.5); const w2 = doc.widthOfString(t2);
          if (cx + w1 + w2 + 8 > x + kw - 4) break;
          doc.roundedRect(cx, y + 47, w1 + w2 + 8, 11, 2).fill('#e2e8f0');
          doc.font('R').fontSize(7.5).fillColor(MUTED).text(t1, cx + 4, y + 49, { lineBreak: false });
          doc.font('B').fontSize(7.5).fillColor(sp.n ? INK : '#94a3b8').text(t2, cx + 4 + w1, y + 49, { lineBreak: false });
          cx += w1 + w2 + 12;
        }
      });
      y += kh + 14;
    }

    // Chart cards: two per row
    const gap = 14, cw = (W - gap) / 2;
    const tables = (d.tables || []).filter(t => t.chart !== 'none' || t.rows.length);
    let col = 0, rowH = 0;
    for (const t of tables) {
      if (t.kind === 'matrix') {
        if (col === 1) { y += rowH + gap; col = 0; rowH = 0; }
        const h = matrixHeight(t);
        if (y + h > bottom()) { doc.addPage(); y = doc.page.margins.top; }
        drawMatrix(doc, t, L, y, W, h);
        y += h + gap;
        continue;
      }
      const h = cardHeight(t);
      if (col === 1 && y + h > bottom()) { y += rowH + gap; col = 0; rowH = 0; }   // doesn't fit beside → next row
      if (col === 0 && y + h > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      const x = L + col * (cw + gap);
      drawCard(doc, t, x, y, cw, h);
      rowH = Math.max(rowH, h);
      if (col === 1) { y += rowH + gap; col = 0; rowH = 0; } else col = 1;
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const mb = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;            // writing in the margin must not start a new page
      doc.font('R').fontSize(7.5).fillColor(MUTED)
        .text(`${d.title} · Hayat Communication Tools · page ${i + 1} of ${range.count}`, L, doc.page.height - 26, { width: W, align: 'right', lineBreak: false });
      doc.page.margins.bottom = mb;
    }
    doc.end();
  });
}

const ROW_H = 17;
function cardHeight(t) {
  const n = Math.max(1, t.rows.length);
  if (t.chart === 'doughnut') return 36 + Math.max(150, n * 15 + 10);
  if (t.chart === 'column') return 36 + 170;
  return 36 + n * ROW_H + (t.headers.length > 2 ? 18 : 6);
}

function drawCard(doc, t, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.font('B').fontSize(10.5).fillColor(INK).text(t.title, x + 12, y + 10, { width: w - 24, lineBreak: false, ellipsis: true });
  const top = y + 32, inner = w - 24;
  if (!t.rows.length) { doc.font('R').fontSize(9).fillColor(MUTED).text('No data', x + 12, top); return; }
  if (t.chart === 'doughnut') return doughnut(doc, t, x + 12, top, inner, h - 40);
  if (t.chart === 'column') return columns(doc, t, x + 12, top, inner, h - 44);
  return bars(doc, t, x + 12, top, inner);
}

// Horizontal bars: label · bar(s) · value. Several value columns → grouped thin bars + legend.
function bars(doc, t, x, y, w) {
  const nS = t.headers.length - 1;
  const labW = Math.min(170, w * 0.38), valW = 60, barW = w - labW - valW - 8;
  // "Others" (the rest summed) doesn't set the scale — it would shrink every other bar; its bar is capped.
  const scaled = t.rows.length > 1 ? t.rows.filter(r => r[0] !== 'Others') : t.rows;
  const max = Math.max(1, ...scaled.flatMap(r => r.slice(1).map(Number).filter(Number.isFinite)));
  t.rows.forEach((r, i) => {
    const ry = y + i * ROW_H;
    doc.font('R').fontSize(8.5).fillColor(INK).text(String(r[0]), x, ry + 3, { width: labW - 6, height: 11, lineBreak: false, ellipsis: true });
    const bh = nS > 1 ? Math.max(4, (ROW_H - 6) / nS) : ROW_H - 6;
    for (let k = 0; k < nS; k++) {
      const v = Number(r[k + 1]) || 0;
      const bw = Math.min(barW, Math.max(v > 0 ? 2 : 0, (v / max) * barW));
      doc.rect(x + labW, ry + 3 + k * bh, barW, bh - (nS > 1 ? 1 : 0)).fill('#f1f5f9');
      if (bw) doc.rect(x + labW, ry + 3 + k * bh, bw, bh - (nS > 1 ? 1 : 0)).fill(PALETTE[k % PALETTE.length]);
    }
    doc.font('B').fontSize(8.5).fillColor(INK).text(r.slice(1).map(fmt).join(' / '), x + labW + barW + 6, ry + 3, { width: valW, lineBreak: false });
  });
  if (nS > 1) legend(doc, t.headers.slice(1), x, y + t.rows.length * ROW_H + 4);
}

function columns(doc, t, x, y, w, h) {
  const nS = t.headers.length - 1, n = t.rows.length;
  const max = Math.max(1, ...t.rows.flatMap(r => r.slice(1).map(Number).filter(Number.isFinite)));
  const plotH = h - 34, slot = w / n, bw = Math.min(28, (slot * 0.7) / nS);
  doc.moveTo(x, y + plotH).lineTo(x + w, y + plotH).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
  t.rows.forEach((r, i) => {
    const cx = x + i * slot + (slot - bw * nS) / 2;
    for (let k = 0; k < nS; k++) {
      const v = Number(r[k + 1]) || 0, bh = (v / max) * (plotH - 14);
      doc.rect(cx + k * bw, y + plotH - bh, bw - 1, bh).fill(PALETTE[k % PALETTE.length]);
      doc.font('B').fontSize(7).fillColor(INK).text(fmt(v), cx + k * bw - 6, y + plotH - bh - 10, { width: bw + 12, align: 'center', lineBreak: false });
    }
    doc.font('R').fontSize(7.5).fillColor(INK).text(String(r[0]), x + i * slot, y + plotH + 4, { width: slot, align: 'center', height: 20, ellipsis: true });
  });
  if (nS > 1) legend(doc, t.headers.slice(1), x, y + plotH + 24);
}

function doughnut(doc, t, x, y, w, h) {
  const vals = t.rows.map(r => Math.max(0, Number(r[1]) || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const R = Math.min(70, h / 2 - 4), r0 = R * 0.56, cx = x + R + 4, cy = y + R + 4;
  let a = -Math.PI / 2;
  vals.forEach((v, i) => {
    if (!v) return;
    const a2 = a + (v / total) * Math.PI * 2;
    const large = a2 - a > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    if (v === total) {
      doc.circle(cx, cy, R).fill(PALETTE[i % PALETTE.length]);
    } else {
      doc.path(`M ${p(R, a)} A ${R} ${R} 0 ${large} 1 ${p(R, a2)} L ${p(r0, a2)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a)} Z`).fill(PALETTE[i % PALETTE.length]);
    }
    a = a2;
  });
  doc.circle(cx, cy, r0).fill('#ffffff');
  doc.font('B').fontSize(13).fillColor(INK).text(fmt(vals.reduce((s, v) => s + v, 0)), cx - r0, cy - 9, { width: r0 * 2, align: 'center', lineBreak: false });
  doc.font('R').fontSize(7).fillColor(MUTED).text('total', cx - r0, cy + 6, { width: r0 * 2, align: 'center', lineBreak: false });
  // Legend: colour · label · value · %
  const lx = x + R * 2 + 22, lw = w - (lx - x);
  t.rows.forEach((r, i) => {
    const ly = y + 2 + i * 15;
    doc.rect(lx, ly + 2, 8, 8).fill(PALETTE[i % PALETTE.length]);
    doc.font('R').fontSize(8.5).fillColor(INK).text(String(r[0]), lx + 13, ly, { width: lw - 100, height: 11, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(8.5).fillColor(INK).text(fmt(vals[i]), lx + lw - 86, ly, { width: 44, align: 'right', lineBreak: false });
    doc.font('R').fontSize(8).fillColor(MUTED).text(`${Math.round((vals[i] / total) * 100)}%`, lx + lw - 38, ly, { width: 36, align: 'right', lineBreak: false });
  });
}

// Matrix card (full width): label · Total · columns · mix bar — like the app's Dashboard tables.
const MROW = 16;
const matrixHeight = (t) => 58 + Math.max(1, t.rows.length) * MROW + 6;
function drawMatrix(doc, t, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.font('B').fontSize(10.5).fillColor(INK).text(t.title, x + 12, y + 10, { width: w * 0.5, lineBreak: false, ellipsis: true, height: 14 });
  if (t.note) doc.font('R').fontSize(8).fillColor(MUTED).text(t.note, x + 12 + doc.font('B').fontSize(10.5).widthOfString(t.title) + 8, y + 12, { lineBreak: false });
  const vals = t.headers.length - 1;
  const mix = t.mix && t.headers.length > 2;
  // Legend (mix colours), top right
  if (mix) {
    let lx = x + w - 12;
    const items = t.headers.slice(2).map((hd, i) => ({ hd, c: '#' + t.colors[i] })).reverse();
    doc.font('R').fontSize(8);
    for (const it of items) { const tw = doc.widthOfString(it.hd); lx -= tw + 16; if (lx < x + w * 0.45) break;
      doc.rect(lx, y + 13, 8, 8).fill(it.c); doc.fillColor(MUTED).text(it.hd, lx + 11, y + 12, { lineBreak: false }); }
  }
  const labW = Math.min(200, w * 0.24), numW = Math.min(mix ? 64 : 130, (w - labW) * (mix ? 0.6 : 1) / vals);
  const mixX = x + 12 + labW + numW * vals + 14, mixW = x + w - 12 - mixX;
  const hy = y + 32;
  doc.rect(x + 1, hy, w - 2, 16).fill('#f1f5f9');
  doc.font('B').fontSize(7.5).fillColor(MUTED);
  doc.text(String(t.headers[0]).toUpperCase(), x + 12, hy + 5, { width: labW, lineBreak: false, ellipsis: true, height: 10 });
  t.headers.slice(1).forEach((hd, j) => doc.text(String(hd).toUpperCase(), x + 12 + labW + j * numW, hy + 5, { width: numW - 6, align: 'right', lineBreak: false, ellipsis: true, height: 10 }));
  if (mix) doc.text('MIX', mixX, hy + 5, { lineBreak: false });
  t.rows.forEach((r, i) => {
    const sty = (t.styles || [])[i] || '';
    const ry = hy + 18 + i * MROW;
    if (sty === 'total') doc.moveTo(x + 8, ry - 1).lineTo(x + w - 8, ry - 1).lineWidth(0.8).strokeColor('#94a3b8').stroke();
    else if (i) doc.moveTo(x + 8, ry - 1).lineTo(x + w - 8, ry - 1).lineWidth(0.3).strokeColor(LINE).stroke();
    const sub = sty === 'sub', bold = sty === 'total' || !sub;
    doc.font(bold ? 'B' : 'R').fontSize(8.5).fillColor(sub ? MUTED : INK)
      .text((sub ? '└ ' : '') + String(r[0]), x + 12 + (sub ? 12 : 0), ry + 3, { width: labW - (sub ? 12 : 0), lineBreak: false, ellipsis: true, height: 11 });
    r.slice(1).forEach((v, j) => {
      const zero = mix && j > 0 && Number(v) === 0;      // greyed zeros only in count tables (in % tables 0 is a result)
      doc.font(j === 0 || sty === 'total' ? 'B' : 'R').fontSize(8.5).fillColor(zero ? '#cbd5e1' : (sub ? MUTED : INK))
        .text(fmt(v), x + 12 + labW + j * numW, ry + 3, { width: numW - 6, align: 'right', lineBreak: false });
    });
    if (mix) {
      const parts = r.slice(2).map(Number), tot = parts.reduce((a, b) => a + (b || 0), 0);
      const bh = sub ? 5 : 7, by = ry + (MROW - bh) / 2;
      if (!tot) { doc.rect(mixX, by, mixW, bh).fill('#f1f5f9'); return; }
      let bx = mixX;
      parts.forEach((v, k) => { if (!v) return; const bw = (v / tot) * mixW; doc.rect(bx, by, Math.max(bw, 0.8), bh).fill('#' + t.colors[k]); bx += bw; });
    }
  });
}

function legend(doc, names, x, y) {
  let lx = x;
  names.forEach((n, k) => {
    doc.rect(lx, y + 2, 8, 8).fill(PALETTE[k % PALETTE.length]);
    doc.font('R').fontSize(8).fillColor(MUTED).text(n, lx + 12, y + 1, { lineBreak: false });
    lx += 24 + doc.widthOfString(n);
  });
}

module.exports = { buildPdfReport };
