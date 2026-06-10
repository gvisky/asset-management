/* Shared parser for the corporate budget workbook (budget 2026.xlsx → "Sheet1").
   One row per budget line item for Vietnam / Thailand / Malaysia, with the
   category hierarchy, GL/WBS codes, and monthly 2025-Actual / 2026-Budget /
   2026-Actual+Forecast series. Used by scripts/build-budget-seed.js and the
   in-app import so a local seed and an upload produce identical rows. */
const XLSX = require('xlsx');

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function norm(s) {
  return String(s == null ? '' : s)
    .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
    .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
    .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Normalized header → dimension field.
const DIM = {
  'sirket tanimi': 'company', 'mudurluk': 'department',
  'proje grubu': 'proj_group', 'proje kategorisi': 'proj_category',
  'program servis adi': 'program', 'proje servis adi': 'project', 'alt proje servis adi': 'sub_project',
  'pyp tanim': 'pyp_name', 'o c': 'oc', 'mc no': 'gl_tr_no', 'mc tanimi': 'gl_tr_name',
  'pyp no': 'wbs', 'proje no': 'proje_no', 'proje tanimi': 'proje_name',
};

function countryOf(c) {
  const v = String(c).toUpperCase();
  if (v.includes('VIETNAM')) return 'Vietnam';
  if (v.includes('THAILAND')) return 'Thailand';
  if (v.includes('MALAYSIA')) return 'Malaysia';
  return null;
}
const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const sum = (a) => Math.round(a.reduce((s, x) => s + (Number(x) || 0), 0) * 100) / 100;

// Build the column maps from a header row. Returns null if it isn't the sheet.
function mapColumns(headerRow) {
  const dim = {};
  const m2025 = new Array(12).fill(-1), m2026b = new Array(12).fill(-1), m2026af = new Array(12).fill(-1);
  headerRow.forEach((h, i) => {
    const n = norm(h);
    if (DIM[n] && dim[DIM[n]] === undefined) dim[DIM[n]] = i;
    let m;
    if ((m = n.match(/^a ([a-z]{3}) 25/)) && MONTHS[m[1]] !== undefined) m2025[MONTHS[m[1]]] = i;       // 2025 Actual
    else if ((m = n.match(/^b ([a-z]{3}) 26/)) && MONTHS[m[1]] !== undefined) m2026b[MONTHS[m[1]]] = i;  // 2026 Budget
    else if ((m = n.match(/^a ([a-z]{3}) 26/)) && MONTHS[m[1]] !== undefined) m2026af[MONTHS[m[1]]] = i; // 2026 Actual
    else if ((m = n.match(/^f ([a-z]{3}) 26/)) && MONTHS[m[1]] !== undefined) m2026af[MONTHS[m[1]]] = i; // 2026 Forecast
  });
  // Require the monthly 2026-budget columns so we match the line-item sheet
  // (Sheet1) and not a transactional sheet that happens to share dimensions.
  if (dim.company === undefined || dim.proj_group === undefined || !m2026b.some(i => i >= 0)) return null;
  return { dim, m2025, m2026b, m2026af };
}

// Turn a header:1 matrix into line-item rows (or null if not the data sheet).
function rowsToLines(rows) {
  let map = null, headerRow = -1;
  for (let h = 0; h < Math.min(6, rows.length); h++) { map = mapColumns(rows[h] || []); if (map) { headerRow = h; break; } }
  if (!map) return null;
  const { dim, m2025, m2026b, m2026af } = map;
  const at = (r, i) => (i >= 0 ? r[i] : '');
  const series = (r, idxs) => idxs.map(i => num(at(r, i)));
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const country = countryOf(at(r, dim.company));
    if (!country) continue;
    const a2025 = series(r, m2025), b2026 = series(r, m2026b), af2026 = series(r, m2026af);
    const ja_budget = sum(b2026.slice(0, 4));   // Jan–Apr 2026 budget
    const ja_actual = sum(af2026.slice(0, 4));  // Jan–Apr 2026 actual
    out.push({
      country,
      company: String(at(r, dim.company)).trim(),
      department: String(at(r, dim.department)).trim(),
      proj_group: String(at(r, dim.proj_group)).trim(),
      proj_category: String(at(r, dim.proj_category)).trim(),
      program: String(at(r, dim.program)).trim(),
      project: String(at(r, dim.project)).trim(),
      sub_project: String(at(r, dim.sub_project)).trim(),
      pyp_name: String(at(r, dim.pyp_name)).trim(),
      oc: String(at(r, dim.oc)).trim().toUpperCase(),
      gl_tr_no: String(at(r, dim.gl_tr_no)).trim(),
      gl_tr_name: String(at(r, dim.gl_tr_name)).trim(),
      wbs: String(at(r, dim.wbs)).trim(),
      proje_no: String(at(r, dim.proje_no)).trim(),
      proje_name: String(at(r, dim.proje_name)).trim(),
      y2025_actual: sum(a2025),
      y2026_budget: sum(b2026),
      ja_budget, ja_actual,
      m2026_budget: b2026,
      m2026_af: af2026,
    });
  }
  return out;
}

const NEED = 'Could not find the budget sheet (need columns: Şirket Tanımı, Proje Grubu, and monthly B_*-26 / A_*-26).';

function parseBudgetWorkbook(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const lines = rowsToLines(rows);
    if (lines && lines.length) return lines;
  }
  throw new Error(NEED);
}

// Parse from a Buffer reading sheets one at a time (memory-safe for big files
// with a huge extra source sheet). Tries likely sheet names first.
function parseBudgetFromBuffer(buf) {
  const meta = XLSX.read(buf, { type: 'buffer', bookSheets: true });
  const names = meta.SheetNames || [];
  const likely = (n) => /sheet1|data|ocak|nisan|rapor/i.test(n);
  const ordered = [...names].sort((a, b) => (likely(b) ? 1 : 0) - (likely(a) ? 1 : 0));
  for (const name of ordered) {
    let rows;
    try { const wb = XLSX.read(buf, { type: 'buffer', sheets: [name] }); rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }); }
    catch (e) { continue; }
    const lines = rowsToLines(rows);
    if (lines && lines.length) return lines;
  }
  throw new Error(NEED);
}

// DB columns (monthly arrays are stored as JSON text).
const COLUMNS = ['country', 'company', 'department', 'proj_group', 'proj_category', 'program', 'project',
  'sub_project', 'pyp_name', 'oc', 'gl_tr_no', 'gl_tr_name', 'wbs', 'proje_no', 'proje_name',
  'y2025_actual', 'y2026_budget', 'ja_budget', 'ja_actual', 'm2026_budget', 'm2026_af'];

module.exports = { parseBudgetWorkbook, parseBudgetFromBuffer, COLUMNS };
