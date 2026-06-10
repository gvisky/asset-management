/* Budget Tracking page (IT admin only). All filtering/aggregation is client-side
   over the ~91 line items returned by /api/budget. Dependency-free SVG charts. */

let ALL_ITEMS = [];
let GL_MAP = {};         // Turkish GL (MÇ No) -> Local GL
const selections = {};   // field -> selected value ('' = all)

const FILTERS = [
  { id: 'f-country', field: 'country', label: 'All 3 countries' },
  { id: 'f-oc', field: 'oc', label: 'All (CapEx + OpEx)' },
  { id: 'f-wbs', field: 'wbs', label: 'All WBS' },
  { id: 'f-proj_group', field: 'proj_group', label: 'All' },
  { id: 'f-proj_category', field: 'proj_category', label: 'All' },
  { id: 'f-program', field: 'program', label: 'All' },
  { id: 'f-project', field: 'project', label: 'All' },
  { id: 'f-sub_project', field: 'sub_project', label: 'All' },
  { id: 'f-pyp_name', field: 'pyp_name', label: 'All' },
];

const USD = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const USD2 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escB = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const varClass = (v) => v < 0 ? 'neg' : v > 0 ? 'pos' : '';
const fmtVar = (v) => (v < 0 ? '−' : '') + USD(Math.abs(v));
const pct = (a, b) => b ? (a / b * 100) : 0;
const COLORS = { budget: '#3b82f6', actual: '#f59e0b', grid: '#e5e7eb', text: '#64748b' };
const MONTH_LBL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── SVG charts ────────────────────────────────────────────────────────────────
function legend(items) {
  return '<div style="display:flex;gap:16px;margin-top:8px;font-size:12px;color:#475569">'
    + items.map(([t, c]) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></span>${t}</span>`).join('') + '</div>';
}
function groupedBars(data, opts) {
  opts = opts || {};
  if (!data.length || data.every(d => !d.budget && !d.actual)) return '<p class="text-muted text-sm">No data.</p>';
  const W = Math.max(360, data.length * (opts.groupGap || 90)), H = 240, padL = 60, padB = 50, padT = 14, padR = 10;
  const max = Math.max(1, ...data.map(d => Math.max(d.budget, d.actual)));
  const plotH = H - padB - padT, plotW = W - padL - padR, groupW = plotW / data.length;
  const barW = Math.min(opts.barW || 30, groupW / 3);
  const y = (v) => padT + plotH - (Math.max(0, v) / max) * plotH;
  let ticks = '', bars = '', labels = '';
  for (let i = 0; i <= 4; i++) { const val = max / 4 * i, yy = y(val); ticks += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${COLORS.grid}"/><text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="${COLORS.text}">${USD(val)}</text>`; }
  data.forEach((d, i) => {
    const cx = padL + groupW * i + groupW / 2;
    bars += `<rect x="${cx - barW - 2}" y="${y(d.budget)}" width="${barW}" height="${padT + plotH - y(d.budget)}" fill="${COLORS.budget}"><title>Budget ${USD2(d.budget)}</title></rect>`;
    bars += `<rect x="${cx + 2}" y="${y(d.actual)}" width="${barW}" height="${padT + plotH - y(d.actual)}" fill="${COLORS.actual}"><title>Actual ${USD2(d.actual)}</title></rect>`;
    labels += `<text x="${cx}" y="${H - padB + 15}" text-anchor="middle" font-size="10.5" fill="#0f172a">${escB(d.label)}</text>`;
  });
  return `<div class="bdg-scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${ticks}${bars}${labels}</svg></div>` + legend([['Budget', COLORS.budget], ['Actual', COLORS.actual]]);
}

// ── Browser-side parser (mirrors lib/budget-parse.js) ─────────────────────────
const B_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const B_DIM = { 'sirket tanimi': 'company', 'mudurluk': 'department', 'proje grubu': 'proj_group', 'proje kategorisi': 'proj_category', 'program servis adi': 'program', 'proje servis adi': 'project', 'alt proje servis adi': 'sub_project', 'pyp tanim': 'pyp_name', 'o c': 'oc', 'mc no': 'gl_tr_no', 'mc tanimi': 'gl_tr_name', 'pyp no': 'wbs', 'proje no': 'proje_no', 'proje tanimi': 'proje_name' };
function bNorm(s) {
  return String(s == null ? '' : s).replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's').replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u').replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function bCountryOf(c) { const v = String(c).toUpperCase(); if (v.includes('VIETNAM')) return 'Vietnam'; if (v.includes('THAILAND')) return 'Thailand'; if (v.includes('MALAYSIA')) return 'Malaysia'; return null; }
const bNum = (v) => Math.round((Number(v) || 0) * 100) / 100;
const bSum = (a) => Math.round(a.reduce((s, x) => s + (Number(x) || 0), 0) * 100) / 100;
function bMapColumns(h) {
  const dim = {}, m2025 = Array(12).fill(-1), m2026b = Array(12).fill(-1), m2026af = Array(12).fill(-1);
  let y2025col = -1;
  h.forEach((c, i) => {
    const n = bNorm(c); if (B_DIM[n] && dim[B_DIM[n]] === undefined) dim[B_DIM[n]] = i;
    if ((n === '2025 a usd' || n === '2025 actual') && y2025col < 0) y2025col = i;
    let m;
    if ((m = n.match(/^a ([a-z]{3}) 25/)) && B_MONTHS[m[1]] !== undefined) m2025[B_MONTHS[m[1]]] = i;
    else if ((m = n.match(/^b ([a-z]{3}) 26/)) && B_MONTHS[m[1]] !== undefined) m2026b[B_MONTHS[m[1]]] = i;
    else if ((m = n.match(/^a ([a-z]{3}) 26/)) && B_MONTHS[m[1]] !== undefined) m2026af[B_MONTHS[m[1]]] = i;
    else if ((m = n.match(/^f ([a-z]{3}) 26/)) && B_MONTHS[m[1]] !== undefined) m2026af[B_MONTHS[m[1]]] = i;
  });
  if (dim.company === undefined || dim.proj_group === undefined || !m2026b.some(i => i >= 0)) return null;
  return { dim, m2025, m2026b, m2026af, y2025col };
}
function bRowsToLines(rows) {
  let map = null, hr = -1;
  for (let h = 0; h < Math.min(6, rows.length); h++) { map = bMapColumns(rows[h] || []); if (map) { hr = h; break; } }
  if (!map) return null;
  const { dim, m2026b, m2026af, y2025col } = map, at = (r, i) => (i >= 0 ? r[i] : ''), ser = (r, idx) => idx.map(i => bNum(at(r, i)));
  const has2025 = map.m2025.some(i => i >= 0);
  const out = [];
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i]; const country = bCountryOf(at(r, dim.company)); if (!country) continue;
    const b2026 = ser(r, m2026b), af = ser(r, m2026af);
    out.push({
      country, company: String(at(r, dim.company)).trim(), department: String(at(r, dim.department)).trim(),
      proj_group: String(at(r, dim.proj_group)).trim(), proj_category: String(at(r, dim.proj_category)).trim(),
      program: String(at(r, dim.program)).trim(), project: String(at(r, dim.project)).trim(),
      sub_project: String(at(r, dim.sub_project)).trim(), pyp_name: String(at(r, dim.pyp_name)).trim(),
      oc: String(at(r, dim.oc)).trim().toUpperCase(), gl_tr_no: String(at(r, dim.gl_tr_no)).trim(),
      gl_tr_name: String(at(r, dim.gl_tr_name)).trim(), wbs: String(at(r, dim.wbs)).trim(),
      proje_no: String(at(r, dim.proje_no)).trim(), proje_name: String(at(r, dim.proje_name)).trim(),
      y2025_actual: has2025 ? bSum(ser(r, map.m2025)) : bNum(at(r, y2025col)), y2026_budget: bSum(b2026),
      ja_budget: bSum(b2026.slice(0, 4)), ja_actual: bSum(af.slice(0, 4)),
      m2026_budget: b2026, m2026_af: af,
    });
  }
  return out;
}
function parseBudgetFile(arrayBuffer) {
  const meta = XLSX.read(arrayBuffer, { type: 'array', bookSheets: true });
  const names = meta.SheetNames || [];
  const likely = (n) => /sheet1|data|ocak|nisan|rapor/i.test(n);
  const ordered = names.slice().sort((a, b) => (likely(b) ? 1 : 0) - (likely(a) ? 1 : 0));
  for (const name of ordered) {
    let rows;
    try { const wb = XLSX.read(arrayBuffer, { type: 'array', sheets: [name] }); rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }); }
    catch (e) { continue; }
    const lines = bRowsToLines(rows); if (lines && lines.length) return lines;
  }
  throw new Error('Could not find the budget sheet (need Şirket Tanımı, Proje Grubu and monthly B_*-26 columns).');
}
function fileToArrayBuffer(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsArrayBuffer(file); }); }

// ── Filtering ─────────────────────────────────────────────────────────────────
function distinctFor(field) {
  const items = ALL_ITEMS.filter(it => FILTERS.every(f => f.field === field || !selections[f.field] || it[f.field] === selections[f.field]));
  return [...new Set(items.map(it => String(it[field] || '')).filter(v => v !== ''))].sort((a, b) => a.localeCompare(b));
}
function reconcile() {
  let changed = true, guard = 0;
  while (changed && guard++ < 12) { changed = false; for (const f of FILTERS) { if (selections[f.field] && !distinctFor(f.field).includes(selections[f.field])) { selections[f.field] = ''; changed = true; } } }
}
function rebuildSelects() {
  for (const f of FILTERS) {
    const sel = document.getElementById(f.id); if (!sel) continue;
    const opts = distinctFor(f.field);
    sel.innerHTML = `<option value="">${f.label}</option>` + opts.map(o => `<option${o === selections[f.field] ? ' selected' : ''}>${escB(o)}</option>`).join('');
    sel.value = selections[f.field] || '';
  }
}
function filteredItems() { return ALL_ITEMS.filter(it => FILTERS.every(f => !selections[f.field] || it[f.field] === selections[f.field])); }

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  const items = filteredItems();
  document.getElementById('filter-count').textContent = `${items.length} of ${ALL_ITEMS.length} line items match the current filter.`;
  document.getElementById('line-count').textContent = `${items.length} line items`;

  // Summary by country
  const countries = ['Vietnam', 'Thailand', 'Malaysia'].filter(c => items.some(it => it.country === c));
  const tot = { y25: 0, y26: 0, jb: 0, ja: 0 };
  const rowsHtml = countries.map(c => {
    const ci = items.filter(it => it.country === c);
    const y25 = sumf(ci, 'y2025_actual'), y26 = sumf(ci, 'y2026_budget'), jb = sumf(ci, 'ja_budget'), ja = sumf(ci, 'ja_actual');
    tot.y25 += y25; tot.y26 += y26; tot.jb += jb; tot.ja += ja;
    const v = jb - ja;
    return `<tr><td><strong>${c}</strong></td><td class="num">${USD2(y25)}</td><td class="num">${USD2(y26)}</td><td class="num">${USD2(jb)}</td><td class="num">${USD2(ja)}</td><td class="num ${varClass(v)}">${fmtVar(v)}</td><td class="num">${pct(ja, jb).toFixed(1)}%</td></tr>`;
  }).join('');
  const tv = tot.jb - tot.ja;
  document.getElementById('summary-tbody').innerHTML = rowsHtml + `<tr style="border-top:2px solid #cbd5e1;font-weight:700"><td>Total</td><td class="num">${USD2(tot.y25)}</td><td class="num">${USD2(tot.y26)}</td><td class="num">${USD2(tot.jb)}</td><td class="num">${USD2(tot.ja)}</td><td class="num ${varClass(tv)}">${fmtVar(tv)}</td><td class="num">${pct(tot.ja, tot.jb).toFixed(1)}%</td></tr>`;
  document.getElementById('chart-summary').innerHTML = groupedBars(countries.map(c => { const ci = items.filter(it => it.country === c); return { label: c, budget: sumf(ci, 'ja_budget'), actual: sumf(ci, 'ja_actual') }; }));

  // Monthly burn (2026 budget vs actual)
  const mb = Array(12).fill(0), ma = Array(12).fill(0);
  items.forEach(it => { for (let i = 0; i < 12; i++) { mb[i] += Number(it.m2026_budget[i]) || 0; ma[i] += Number(it.m2026_af[i]) || 0; } });
  document.getElementById('chart-monthly').innerHTML = groupedBars(MONTH_LBL.map((m, i) => ({ label: m, budget: round2(mb[i]), actual: round2(ma[i]) })), { groupGap: 64, barW: 18 });

  // GL tables
  const byGL = {};
  items.forEach(it => { const k = it.gl_tr_no || '(none)'; (byGL[k] = byGL[k] || { alts: new Set(), jb: 0, ja: 0 }); if (it.pyp_name) byGL[k].alts.add(it.pyp_name); byGL[k].jb += it.ja_budget; byGL[k].ja += it.ja_actual; });
  const glKeys = Object.keys(byGL).sort();
  document.getElementById('gl-tr-tbody').innerHTML = glKeys.length ? glKeys.map(k => {
    const lg = GL_MAP[k];
    return `<tr><td><code>${escB(k)}</code></td><td>${lg ? '<code>' + escB(lg) + '</code>' : '<span class="text-muted">— to map —</span>'}</td><td class="text-sm">${escB([...byGL[k].alts].join(', ')) || '—'}</td><td class="num">${USD(byGL[k].jb)}</td><td class="num">${USD(byGL[k].ja)}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="text-muted">No data.</td></tr>';

  // Line items
  document.getElementById('line-tbody').innerHTML = items.length ? items.map(it => {
    const p = it.ja_budget ? (it.ja_actual / it.ja_budget * 100) : 0;
    return `<tr>
      <td>${escB(it.country)}</td><td>${escB(it.oc)}</td>
      <td>${escB(it.proj_group)}</td><td>${escB(it.proj_category)}</td><td>${escB(it.program)}</td><td>${escB(it.project)}</td><td>${escB(it.sub_project)}</td><td>${escB(it.pyp_name)}</td>
      <td><code>${escB(it.gl_tr_no)}</code></td><td><code>${escB(it.wbs)}</code></td>
      <td class="num">${USD(it.y2025_actual)}</td><td class="num">${USD(it.y2026_budget)}</td>
      <td class="num">${USD(it.ja_budget)}</td><td class="num">${USD(it.ja_actual)}</td>
      <td class="num ${p > 100 ? 'neg' : ''}">${p.toFixed(0)}%</td></tr>`;
  }).join('') : '<tr><td colspan="15" class="text-muted">No line items match.</td></tr>';
}
function sumf(arr, f) { return round2(arr.reduce((s, x) => s + (Number(x[f]) || 0), 0)); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function onFilterChange(field, value) { selections[field] = value; reconcile(); rebuildSelects(); render(); }

// ── Import ────────────────────────────────────────────────────────────────────
function wireBudgetImport() {
  const card = document.getElementById('import-budget-card'); if (card) card.style.display = '';
  const btn = document.getElementById('budget-import-btn'); if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    const input = document.getElementById('budget-import-file'), status = document.getElementById('budget-import-status');
    const file = input.files && input.files[0];
    if (!file) { showToast('Choose the budget .xlsx first', 'error'); return; }
    if (typeof XLSX === 'undefined') { showToast('Parser not loaded — hard-refresh', 'error'); return; }
    if (!confirm('Upload this file and REPLACE the current budget data?')) return;
    btn.disabled = true; status.textContent = 'Reading & parsing in your browser…';
    try {
      const rows = parseBudgetFile(await fileToArrayBuffer(file));
      if (!rows.length) throw new Error('No matching rows (Vietnam/Thailand/Malaysia).');
      status.textContent = `Parsed ${rows.length} line items — saving…`;
      const r = await fetch('/api/budget/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
      const text = await r.text(); const d = text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error(d.error || ('Import failed (HTTP ' + r.status + ')'));
      const by = Object.entries(d.byCountry || {}).map(([k, v]) => `${k} ${v}`).join(', ');
      status.textContent = `✅ Imported ${d.inserted} line items (${by}).`;
      showToast(`Budget imported: ${d.inserted} line items`);
      input.value = '';
      await loadData();
    } catch (e) { status.textContent = '❌ ' + e.message; showToast(e.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

async function loadData() {
  const d = await apiGet('/api/budget');
  ALL_ITEMS = d.items || [];
  GL_MAP = d.glMap || {};
  for (const f of FILTERS) selections[f.field] = '';
  rebuildSelects();
  render();
}

async function initBudget() {
  const gate = document.getElementById('gate-card'), gateMsg = document.getElementById('gate-msg'), body = document.getElementById('budget-body');
  const u = window.CURRENT_USER || (typeof ensureAuth === 'function' ? await ensureAuth() : null);
  if (!u) return;
  if (!(u.team === 'IT' && u.role === 'admin')) { gate.style.display = ''; gateMsg.textContent = '🔒 Budget Tracking is available to IT administrators only.'; return; }
  try {
    body.style.display = '';
    await loadData();
    FILTERS.forEach(f => { const sel = document.getElementById(f.id); if (sel) sel.addEventListener('change', () => onFilterChange(f.field, sel.value)); });
    document.getElementById('reset-filters').addEventListener('click', () => { for (const f of FILTERS) selections[f.field] = ''; rebuildSelects(); render(); });
    wireBudgetImport();
  } catch (e) { gate.style.display = ''; gateMsg.textContent = 'Could not load budget data: ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => { initBudget(); });
