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

  renderSummary(d.summary, d.grand);
  renderBreakdown('dept-tbody', d.byDepartment);
  renderBreakdown('cat-tbody', d.byCategory);
  document.getElementById('chart-timeseries').innerHTML = lineChartTimeseries(d.timeseries);
  renderInsights('insights-over', d.insights.over, 'over');
  renderInsights('insights-under', d.insights.under, 'under');

  const ex = new URLSearchParams(); if (year) ex.set('year', year);
  document.getElementById('export-btn').href = '/api/budget/export.xlsx?' + ex.toString() + (year ? '&' : '') + 't=' + Date.now();
}

function populateFilters(meta) {
  const cy = document.getElementById('f-country');
  meta.countries.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; cy.appendChild(o); });
  const yr = document.getElementById('f-year');
  meta.years.forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y; yr.appendChild(o); });
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
    renderSummary(d.summary, d.grand);
    renderBreakdown('dept-tbody', d.byDepartment);
    renderBreakdown('cat-tbody', d.byCategory);
    document.getElementById('chart-timeseries').innerHTML = lineChartTimeseries(d.timeseries);
    renderInsights('insights-over', d.insights.over, 'over');
    renderInsights('insights-under', d.insights.under, 'under');
    document.getElementById('export-btn').href = '/api/budget/export.xlsx?t=' + Date.now();
    document.getElementById('f-country').addEventListener('change', () => loadBudget().catch(err => showToast(err.message, 'error')));
    document.getElementById('f-year').addEventListener('change', () => loadBudget().catch(err => showToast(err.message, 'error')));
  } catch (e) {
    gate.style.display = ''; gateMsg.textContent = 'Could not load budget data: ' + e.message;
  }
}

document.addEventListener('DOMContentLoaded', () => { initBudget(); });
