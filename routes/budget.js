/* Budget Tracking (IT admin only) — budget 2026.xlsx → Sheet1 line items for
   Vietnam / Thailand / Malaysia. The dataset is small (~91 rows), so GET /
   returns everything and the page does the filtering, cascading and charts. */
const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { all, run } = require('../db/database');
const { requireAuth, requireITAdmin } = require('../middleware/auth');
const { parseBudgetFromBuffer, COLUMNS } = require('../lib/budget-parse');

router.use(requireAuth);
router.use(requireITAdmin);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v) => String(v == null ? '' : v).slice(0, 300);
function arr12(v) {
  const a = Array.isArray(v) ? v : [];
  return Array.from({ length: 12 }, (_, i) => round2(a[i]));
}

// Whitelist/coerce client-supplied rows (browser-parsed) to the known schema.
function sanitizeRows(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !COUNTRIES.includes(r.country)) continue;
    out.push({
      country: r.country, company: str(r.company), department: str(r.department),
      proj_group: str(r.proj_group), proj_category: str(r.proj_category), program: str(r.program),
      project: str(r.project), sub_project: str(r.sub_project), pyp_name: str(r.pyp_name),
      oc: str(r.oc).toUpperCase(), gl_tr_no: str(r.gl_tr_no), gl_tr_name: str(r.gl_tr_name),
      wbs: str(r.wbs), proje_no: str(r.proje_no), proje_name: str(r.proje_name),
      y2025_actual: round2(r.y2025_actual), y2026_budget: round2(r.y2026_budget),
      ja_budget: round2(r.ja_budget), ja_actual: round2(r.ja_actual),
      m2026_budget: arr12(r.m2026_budget), m2026_af: arr12(r.m2026_af),
    });
  }
  return out;
}

function rowToItem(r) {
  let mb = [], ma = [];
  try { mb = JSON.parse(r.m2026_budget || '[]'); } catch (e) {}
  try { ma = JSON.parse(r.m2026_af || '[]'); } catch (e) {}
  return {
    id: r.id, country: r.country, company: r.company, department: r.department,
    proj_group: r.proj_group, proj_category: r.proj_category, program: r.program,
    project: r.project, sub_project: r.sub_project, pyp_name: r.pyp_name,
    oc: r.oc, gl_tr_no: r.gl_tr_no, gl_tr_name: r.gl_tr_name, wbs: r.wbs,
    proje_no: r.proje_no, proje_name: r.proje_name,
    y2025_actual: r.y2025_actual, y2026_budget: r.y2026_budget,
    ja_budget: r.ja_budget, ja_actual: r.ja_actual,
    m2026_budget: arr12(mb), m2026_af: arr12(ma),
  };
}

// ── GET /api/budget — all line items + filter metadata ────────────────────────
router.get('/', wrap(async (req, res) => {
  const rows = await all('SELECT * FROM budget_line ORDER BY country, proj_group, proj_category, gl_tr_no');
  const items = rows.map(rowToItem);
  const glMap = {};
  (await all('SELECT gl_tr_no, local_gl FROM gl_map')).forEach(r => { glMap[r.gl_tr_no] = r.local_gl || ''; });
  res.json({ items, count: items.length, glMap, meta: { countries: COUNTRIES, ocs: ['CAPEX', 'OPEX'] } });
}));

// ── POST /api/budget/import — replace from browser-parsed rows (or .xlsx) ─────
router.post('/import', wrap(async (req, res) => {
  let rows;
  if (Array.isArray(req.body && req.body.rows)) {
    rows = sanitizeRows(req.body.rows);
  } else if (req.body && req.body.xlsx_base64) {
    try { rows = sanitizeRows(parseBudgetFromBuffer(Buffer.from(req.body.xlsx_base64, 'base64'))); }
    catch (e) { return res.status(400).json({ error: e.message || 'Could not read the Excel file' }); }
  } else {
    return res.status(400).json({ error: 'No file provided' });
  }
  if (!rows.length) return res.status(400).json({ error: 'No matching rows found (Vietnam/Thailand/Malaysia).' });

  await run('DELETE FROM budget_line');
  const ph = COLUMNS.map(() => '?').join(',');
  for (const r of rows) {
    const vals = COLUMNS.map(c => (c === 'm2026_budget' || c === 'm2026_af') ? JSON.stringify(r[c]) : (r[c] == null ? '' : r[c]));
    await run(`INSERT INTO budget_line (${COLUMNS.join(',')}) VALUES (${ph})`, vals);
  }
  await run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['budget_seed_v3', `imported=${rows.length}`]);

  const byCountry = {};
  rows.forEach(r => { byCountry[r.country] = (byCountry[r.country] || 0) + 1; });
  res.json({ inserted: rows.length, byCountry });
}));

// ── GET /api/budget/export.xlsx ───────────────────────────────────────────────
router.get('/export.xlsx', wrap(async (req, res) => {
  const rows = (await all('SELECT * FROM budget_line ORDER BY country, proj_group, gl_tr_no')).map(rowToItem);
  const sheet = rows.map(r => ({
    Country: r.country, Department: r.department, 'O/C': r.oc,
    'Proje Grubu': r.proj_group, 'Proje Kategorisi': r.proj_category, 'Program/Servis': r.program,
    'Proje/Servis': r.project, 'Alt Proje/Servis': r.sub_project, 'PYP': r.pyp_name,
    'Turkish GL': r.gl_tr_no, 'GL Name': r.gl_tr_name, 'Local GL': '', WBS: r.wbs,
    '2025 Actual': r.y2025_actual, '2026 Budget': r.y2026_budget,
    'Jan-Apr Budget': r.ja_budget, 'Jan-Apr Actual': r.ja_actual,
    'Variance': round2(r.ja_budget - r.ja_actual),
    'Used %': r.ja_budget ? round2(r.ja_actual / r.ja_budget * 100) : 0,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Budget');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Budget_Tracking.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}));

module.exports = router;
