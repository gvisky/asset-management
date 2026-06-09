/* Budget Tracking page — IT admin only. Dependency-free tables + SVG charts. */

const USD = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const USD2 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escB = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function varClass(v) { return v < 0 ? 'neg' : v > 0 ? 'pos' : ''; }
function fmtVar(v) { return (v < 0 ? '−' : '') + USD(Math.abs(v)); }

// ── SVG helpers ───────────────────────────────────────────────────────────────
const COLORS = { budget: '#3b82f6', actual: '#f59e0b', cum: '#10b981', grid: '#e5e7eb', text: '#64748b' };

// Grouped vertical bars: budget vs actual per label.
function barChartBudgetActual(data) {
  if (!data.length) return '<p class="text-muted text-sm">No data.</p>';
  const W = Math.max(360, data.length * 120), H = 240, padL = 56, padB = 54, padT = 14, padR = 10;
  const max = Math.max(1, ...data.map(d => Math.max(d.budget, d.actual)));
  const plotH = H - padB - padT, plotW = W - padL - padR;
  const groupW = plotW / data.length, barW = Math.min(34, groupW / 3);
  const y = (v) => padT + plotH - (v / max) * plotH;
  let bars = '', labels = '', ticks = '';
  for (let i = 0; i <= 4; i++) {
    const val = (max / 4) * i, yy = y(val);
    ticks += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${COLORS.grid}"/>`
      + `<text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="${COLORS.text}">${USD(val)}</text>`;
  }
  data.forEach((d, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const x1 = cx - barW - 2, x2 = cx + 2;
    bars += `<rect x="${x1}" y="${y(d.budget)}" width="${barW}" height="${padT + plotH - y(d.budget)}" fill="${COLORS.budget}"><title>Budget ${USD2(d.budget)}</title></rect>`;
    bars += `<rect x="${x2}" y="${y(d.actual)}" width="${barW}" height="${padT + plotH - y(d.actual)}" fill="${COLORS.actual}"><title>Actual ${USD2(d.actual)}</title></rect>`;
    labels += `<text x="${cx}" y="${H - padB + 16}" text-anchor="middle" font-size="11" fill="#0f172a">${escB(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${ticks}${bars}${labels}</svg>`
    + legend([['Budget', COLORS.budget], ['Actual', COLORS.actual]]);
}

// Line chart: monthly actual (bars faint) + cumulative actual line + budget line.
function lineChartTimeseries(ts) {
  if (!ts.length) return '<p class="text-muted text-sm">No period data.</p>';
  const W = Math.max(520, ts.length * 46), H = 260, padL = 60, padB = 56, padT = 14, padR = 14;
  const plotH = H - padB - padT, plotW = W - padL - padR;
  const maxCum = Math.max(1, ...ts.map(d => d.cumulativeActual));
  const x = (i) => padL + (ts.length === 1 ? plotW / 2 : (plotW * i) / (ts.length - 1));
  const y = (v) => padT + plotH - (v / maxCum) * plotH;
  let ticks = '', monthBars = '', labels = '';
  const maxMonth = Math.max(1, ...ts.map(d => d.actual));
  for (let i = 0; i <= 4; i++) {
    const val = (maxCum / 4) * i, yy = y(val);
    ticks += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${COLORS.grid}"/>`
      + `<text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="${COLORS.text}">${USD(val)}</text>`;
  }
  const bw = Math.min(22, plotW / ts.length / 1.6);
  ts.forEach((d, i) => {
    const h = (d.actual / maxCum) * plotH;
    monthBars += `<rect x="${x(i) - bw / 2}" y="${padT + plotH - h}" width="${bw}" height="${h}" fill="${COLORS.actual}" opacity="0.45"><title>${d.period} actual ${USD2(d.actual)}</title></rect>`;
    if (i % Math.ceil(ts.length / 12) === 0 || ts.length <= 14)
      labels += `<text x="${x(i)}" y="${H - padB + 16}" text-anchor="middle" font-size="9" fill="#0f172a" transform="rotate(35 ${x(i)} ${H - padB + 16})">${escB(d.period)}</text>`;
  });
  const cumPts = ts.map((d, i) => `${x(i)},${y(d.cumulativeActual)}`).join(' ');
  const cumDots = ts.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.cumulativeActual)}" r="2.5" fill="${COLORS.cum}"><title>${d.period} cumulative ${USD2(d.cumulativeActual)}</title></circle>`).join('');
  const cumLine = `<polyline points="${cumPts}" fill="none" stroke="${COLORS.cum}" stroke-width="2.5"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${ticks}${monthBars}${cumLine}${cumDots}</svg>`
    + legend([['Monthly Actual', COLORS.actual], ['Cumulative Actual', COLORS.cum]]);
}

function legend(items) {
  return '<div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:#475569">'
    + items.map(([t, c]) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></span>${t}</span>`).join('')
    + '</div>';
}

// Inline mini bar comparing budget (track) vs actual (fill) for a breakdown row.
function miniBar(budget, actual) {
  const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : (actual > 0 ? 100 : 0);
  const over = budget > 0 && actual > budget;
  const color = over ? '#dc2626' : '#3b82f6';
  return `<div class="bdg-bar-wrap"><div class="bdg-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>`;
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderSummary(summary, grand) {
  const tb = document.getElementById('summary-tbody');
  tb.innerHTML = summary.map(s => `
    <tr>
      <td><strong>${escB(s.country)}</strong></td>
      <td class="num">${USD2(s.budget)}</td>
      <td class="num">${USD2(s.actual)}</td>
      <td class="num">${USD2(s.forecast)}</td>
      <td class="num ${varClass(s.variance)}">${fmtVar(s.variance)}</td>
      <td class="num">${s.utilization.toFixed(1)}%</td>
    </tr>`).join('')
    + `<tr style="border-top:2px solid #cbd5e1;font-weight:700">
        <td>Total</td><td class="num">${USD2(grand.budget)}</td><td class="num">${USD2(grand.actual)}</td>
        <td class="num">${USD2(grand.forecast)}</td><td class="num ${varClass(grand.variance)}">${fmtVar(grand.variance)}</td>
        <td class="num">${grand.utilization.toFixed(1)}%</td></tr>`;
  document.getElementById('chart-summary').innerHTML = barChartBudgetActual(
    summary.map(s => ({ label: s.country, budget: s.budget, actual: s.actual })));
}

function renderBreakdown(tbodyId, rows) {
  const tb = document.getElementById(tbodyId);
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="4" class="text-muted">No data.</td></tr>'; return; }
  tb.innerHTML = rows.map(r => `
    <tr>
      <td>${escB(r.label)}<div style="margin-top:4px">${miniBar(r.budget, r.actual)}</div></td>
      <td class="num">${USD(r.budget)}</td>
      <td class="num">${USD(r.actual)}</td>
      <td class="num ${varClass(r.variance)}">${fmtVar(r.variance)}</td>
    </tr>`).join('');
}

function renderInsights(elId, rows, kind) {
  const el = document.getElementById(elId);
  if (!rows.length) { el.innerHTML = '<p class="text-muted text-sm">None.</p>'; return; }
  el.innerHTML = rows.map((r, i) => `
    <div class="bdg-row" style="flex-direction:column;align-items:stretch;border-bottom:1px solid #f1f5f9;padding-bottom:8px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <strong>${i + 1}. ${escB(r.label)}</strong>
        <span class="${kind === 'over' ? 'neg' : 'pos'}" style="font-weight:700">${fmtVar(r.variance)}</span>
      </div>
      <div class="text-muted text-sm">${escB(r.country)} · Budget ${USD(r.budget)} · Actual ${USD(r.actual)}</div>
    </div>`).join('');
}

// ── Data load ─────────────────────────────────────────────────────────────────
async function loadBudget() {
  const country = document.getElementById('f-country').value;
  const year = document.getElementById('f-year').value;
  const qs = new URLSearchParams();
  if (country) qs.set('country', country);
  if (year) qs.set('year', year);
  const d = await apiGet('/api/budget?' + qs.toString());
  renderAll(d);

  const ex = new URLSearchParams(); if (year) ex.set('year', year);
  document.getElementById('export-btn').href = '/api/budget/export.xlsx?' + ex.toString() + (year ? '&' : '') + 't=' + Date.now();
}

function populateFilters(meta) {
  const cy = document.getElementById('f-country');
  cy.innerHTML = '<option value="">All 3 countries</option>';
  meta.countries.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; cy.appendChild(o); });
  const yr = document.getElementById('f-year');
  yr.innerHTML = '<option value="">All years</option>';
  meta.years.forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y; yr.appendChild(o); });
}

// Render every section from a full /api/budget payload.
function renderAll(d) {
  renderSummary(d.summary, d.grand);
  renderBreakdown('dept-tbody', d.byDepartment);
  renderBreakdown('cat-tbody', d.byCategory);
  document.getElementById('chart-timeseries').innerHTML = lineChartTimeseries(d.timeseries);
  renderInsights('insights-over', d.insights.over, 'over');
  renderInsights('insights-under', d.insights.under, 'under');
}

// ── Client-side Budget report parser (mirrors lib/budget-parse.js) ────────────
// Parsing in the browser avoids uploading the full (38 MB) workbook and keeps
// the server off the huge source sheet — only the filtered rows are sent.
const BUDGET_CATEGORY = { A: 'Actual', B: 'Budget', E: 'Additional Budget', T: 'Transfer' };
const BUDGET_PERIODS = new Set(['2026-01', '2026-02', '2026-03', '2026-04']);
const BUDGET_HEADER_MAP = {
  'sirket tanimi': 'company', 'mali yil': 'fiscal_year', 'donem': 'period', 'but vrs': 'version_type',
  'tutar usd': 'amount_usd', 'mudurluk': 'department', 'proje kategorisi': 'project_category',
  'proje servis adi': 'project', 'alt proje servis adi': 'sub_project', 'program servis adi': 'program',
  'proje no': 'project_no', 'mc tanimi': 'cost_element', 'belge no': 'doc_no', 'aciklama': 'description',
};
const BUDGET_REQUIRED = ['company', 'period', 'version_type', 'amount_usd'];
function bNorm(s) {
  return String(s == null ? '' : s)
    .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function bCountryOf(c) {
  const v = String(c).toUpperCase();
  if (v.includes('VIETNAM')) return 'Vietnam';
  if (v.includes('THAILAND')) return 'Thailand';
  if (v.includes('MALAYSIA')) return 'Malaysia';
  return null;
}
function bNormPeriod(v) {
  const m = String(v).match(/(\d{4})\D*(\d{1,2})/);
  if (!m) return { period: String(v).trim(), year: null, month: null };
  return { period: m[1] + '-' + String(Number(m[2])).padStart(2, '0'), year: Number(m[1]), month: Number(m[2]) };
}
function bFindHeader(rows) {
  for (let h = 0; h < Math.min(6, rows.length); h++) {
    const idx = {}; (rows[h] || []).forEach((c, i) => { const f = BUDGET_HEADER_MAP[bNorm(c)]; if (f && idx[f] === undefined) idx[f] = i; });
    if (BUDGET_REQUIRED.every(f => idx[f] !== undefined)) return { headerRow: h, map: idx };
  }
  return null;
}
function parseBudgetFile(arrayBuffer) {
  const meta = XLSX.read(arrayBuffer, { type: 'array', bookSheets: true });
  const names = meta.SheetNames || [];
  const dataish = (n) => /data|ocak|nisan/i.test(n);
  const ordered = names.slice().sort((a, b) => (dataish(b) ? 1 : 0) - (dataish(a) ? 1 : 0));
  for (const name of ordered) {
    let rows;
    try { const wb = XLSX.read(arrayBuffer, { type: 'array', sheets: [name] }); rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }); }
    catch (e) { continue; }
    const hdr = bFindHeader(rows); if (!hdr) continue;
    const map = hdr.map, get = (r, f) => (map[f] !== undefined ? r[map[f]] : '');
    const out = [];
    for (let i = hdr.headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      const country = bCountryOf(get(r, 'company')); if (!country) continue;
      const p = bNormPeriod(get(r, 'period')); if (!BUDGET_PERIODS.has(p.period)) continue;
      const vt = String(get(r, 'version_type')).trim().toUpperCase(); if (vt !== 'A' && vt !== 'B') continue;
      const dept = String(get(r, 'department')).trim();
      out.push({
        country, company: String(get(r, 'company')).trim(), budget_owner: dept, department: dept,
        version_type: vt, category: BUDGET_CATEGORY[vt] || vt,
        fiscal_year: Number(get(r, 'fiscal_year')) || p.year, period: p.period, period_month: p.month,
        project_no: String(get(r, 'project_no')).trim(),
        project_name: String(get(r, 'project') || get(r, 'sub_project') || get(r, 'program')).trim(),
        project_category: String(get(r, 'project_category')).trim(),
        cost_element: String(get(r, 'cost_element')).trim(),
        amount_usd: Math.round((Number(get(r, 'amount_usd')) || 0) * 100) / 100,
        doc_no: String(get(r, 'doc_no')).trim(), description: String(get(r, 'description')).trim(),
      });
    }
    return out;
  }
  throw new Error('Could not find the budget data sheet (need columns: Şirket Tanımı, Dönem, Büt. Vrs, Tutar USD).');
}
function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsArrayBuffer(file);
  });
}

function wireBudgetImport() {
  const card = document.getElementById('import-budget-card');
  if (card) card.style.display = '';
  const btn = document.getElementById('budget-import-btn');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    const input = document.getElementById('budget-import-file');
    const status = document.getElementById('budget-import-status');
    const file = input.files && input.files[0];
    if (!file) { showToast('Choose the Budget report .xlsx first', 'error'); return; }
    if (typeof XLSX === 'undefined') { showToast('Spreadsheet parser not loaded — hard-refresh the page', 'error'); return; }
    if (!confirm('Upload this file and REPLACE the current budget data?')) return;
    btn.disabled = true; status.textContent = 'Reading & parsing in your browser…';
    try {
      const buf = await fileToArrayBuffer(file);
      const rows = parseBudgetFile(buf);
      if (!rows.length) throw new Error('No matching rows (Vietnam/Thailand/Malaysia, Jan–Apr 2026, Budget/Actual).');
      status.textContent = `Parsed ${rows.length} rows — saving…`;
      const r = await fetch('/api/budget/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const text = await r.text();
      const d = text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error(d.error || ('Import failed (HTTP ' + r.status + ')'));
      const by = Object.entries(d.byCountry || {}).map(([k, v]) => `${k} ${v}`).join(', ');
      status.textContent = `✅ Imported ${d.inserted} rows (${by}).`;
      showToast(`Budget imported: ${d.inserted} rows`);
      input.value = '';
      // Reset filters to defaults and reload everything.
      document.getElementById('f-country').value = '';
      document.getElementById('f-year').value = '';
      const fresh = await apiGet('/api/budget');
      populateFilters(fresh.meta);
      renderAll(fresh);
      document.getElementById('export-btn').href = '/api/budget/export.xlsx?t=' + Date.now();
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

async function initBudget() {
  const gate = document.getElementById('gate-card'), gateMsg = document.getElementById('gate-msg');
  const body = document.getElementById('budget-body');
  const u = window.CURRENT_USER || (typeof ensureAuth === 'function' ? await ensureAuth() : null);
  if (!u) return;
  if (!(u.team === 'IT' && u.role === 'admin')) {
    gate.style.display = ''; gateMsg.textContent = '🔒 Budget Tracking is available to IT administrators only.';
    return;
  }
  try {
    // First call also gives meta (countries/years).
    const d = await apiGet('/api/budget');
    populateFilters(d.meta);
    body.style.display = '';
    renderAll(d);
    document.getElementById('export-btn').href = '/api/budget/export.xlsx?t=' + Date.now();
    wireBudgetImport();
    document.getElementById('f-country').addEventListener('change', () => loadBudget().catch(err => showToast(err.message, 'error')));
    document.getElementById('f-year').addEventListener('change', () => loadBudget().catch(err => showToast(err.message, 'error')));
  } catch (e) {
    gate.style.display = ''; gateMsg.textContent = 'Could not load budget data: ' + e.message;
  }
}

document.addEventListener('DOMContentLoaded', () => { initBudget(); });
