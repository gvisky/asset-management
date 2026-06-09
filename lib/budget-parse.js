/* Shared parser for the corporate Budget-Actual report workbook.
   Used by scripts/build-budget-seed.js and POST /api/budget/import so a local
   seed and an uploaded file produce identical rows.

   Scope: Vietnam / Thailand / Malaysia, January–April 2026, version A=Actual /
   B=Budget. Locates the flat data sheet and maps columns by (Turkish) header
   name, so it tolerates column reordering. */
const XLSX = require('xlsx');

const CATEGORY = { A: 'Actual', B: 'Budget', E: 'Additional Budget', T: 'Transfer' };
const PERIODS = new Set(["2026-01", "2026-02", "2026-03", "2026-04"]);

// Normalize a header/cell: fold Turkish letters, lowercase, keep alnum+spaces.
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Normalized header → field name. First exact match wins.
const HEADER_MAP = {
  'sirket tanimi': 'company',
  'mali yil': 'fiscal_year',
  'donem': 'period',
  'but vrs': 'version_type',
  'tutar usd': 'amount_usd',
  'mudurluk': 'department',
  'proje kategorisi': 'project_category',
  'proje servis adi': 'project',
  'alt proje servis adi': 'sub_project',
  'program servis adi': 'program',
  'proje no': 'project_no',
  'mc tanimi': 'cost_element',
  'belge no': 'doc_no',
  'aciklama': 'description',
};
const REQUIRED = ['company', 'period', 'version_type', 'amount_usd'];

function countryOf(c) {
  const v = String(c).toUpperCase();
  if (v.includes('VIETNAM')) return 'Vietnam';
  if (v.includes('THAILAND')) return 'Thailand';
  if (v.includes('MALAYSIA')) return 'Malaysia';
  return null;
}
function normPeriod(v) {
  const m = String(v).match(/(\d{4})\D*(\d{1,2})/);
  if (!m) return { period: String(v).trim(), year: null, month: null };
  const year = Number(m[1]), month = Number(m[2]);
  return { period: `${year}-${String(month).padStart(2, '0')}`, year, month };
}

// Build a {field: colIndex} map from a header row; returns null if incomplete.
function mapHeader(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const f = HEADER_MAP[norm(h)];
    if (f && idx[f] === undefined) idx[f] = i;
  });
  return REQUIRED.every(f => idx[f] !== undefined) ? idx : null;
}

// Within a header:1 matrix, find the header row (first 6) and its column map.
function findHeader(rows) {
  for (let h = 0; h < Math.min(6, rows.length); h++) {
    const map = mapHeader(rows[h]);
    if (map) return { headerRow: h, map };
  }
  return null;
}

// Map a header:1 matrix (with a known header) to normalized budget rows.
function rowsToBudget(rows, map, headerRow) {
  const get = (r, f) => (map[f] !== undefined ? r[map[f]] : '');
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const country = countryOf(get(r, 'company'));
    if (!country) continue;
    const p = normPeriod(get(r, 'period'));
    if (!PERIODS.has(p.period)) continue;
    const vt = String(get(r, 'version_type')).trim().toUpperCase();
    if (vt !== 'A' && vt !== 'B') continue;
    const dept = String(get(r, 'department')).trim();
    out.push({
      country,
      company: String(get(r, 'company')).trim(),
      budget_owner: dept,
      department: dept,
      version_type: vt,
      category: CATEGORY[vt] || vt,
      fiscal_year: Number(get(r, 'fiscal_year')) || p.year,
      period: p.period,
      period_month: p.month,
      project_no: String(get(r, 'project_no')).trim(),
      project_name: String(get(r, 'project') || get(r, 'sub_project') || get(r, 'program')).trim(),
      project_category: String(get(r, 'project_category')).trim(),
      cost_element: String(get(r, 'cost_element')).trim(),
      amount_usd: Math.round((Number(get(r, 'amount_usd')) || 0) * 100) / 100,
      doc_no: String(get(r, 'doc_no')).trim(),
      description: String(get(r, 'description')).trim(),
    });
  }
  return out;
}

const NEED = 'Could not find the budget data sheet (need columns: Şirket Tanımı, Dönem, Büt. Vrs, Tutar USD).';

// Parse an already-loaded workbook (all sheets in memory). Used by the seed
// builder locally. Scans each sheet for the header row.
function parseBudgetWorkbook(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const h = findHeader(rows);
    if (h) return rowsToBudget(rows, h.map, h.headerRow);
  }
  throw new Error(NEED);
}

// Parse straight from an .xlsx Buffer, reading ONLY the data sheet (so a huge
// source-dump sheet in the same workbook is never materialized — memory-safe
// for uploads). Tries sheets whose name looks like the data sheet first.
function parseBudgetFromBuffer(buf) {
  const meta = XLSX.read(buf, { type: 'buffer', bookSheets: true });
  const names = meta.SheetNames || [];
  const dataish = (n) => /data|ocak|nisan/i.test(n);  // prefer "Data_*"/period sheets; de-prioritize the huge "VERİ" dump
  const ordered = [...names].sort((a, b) => (dataish(b) ? 1 : 0) - (dataish(a) ? 1 : 0));
  for (const name of ordered) {
    let rows;
    try {
      const wb = XLSX.read(buf, { type: 'buffer', sheets: [name] });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    } catch (e) { continue; }
    const h = findHeader(rows);
    if (h) return rowsToBudget(rows, h.map, h.headerRow);
  }
  throw new Error(NEED);
}

const COLUMNS = ['country', 'company', 'budget_owner', 'department', 'version_type', 'category', 'fiscal_year',
  'period', 'period_month', 'project_no', 'project_name', 'project_category', 'cost_element', 'amount_usd', 'doc_no', 'description'];

module.exports = { parseBudgetWorkbook, parseBudgetFromBuffer, COLUMNS, PERIODS };
