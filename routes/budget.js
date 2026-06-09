/* Budget Tracking (IT admin only).
   Aggregates the `budget` table for Vietnam / Thailand / Malaysia.
   version_type: A=Actual, B=Budget, E=Additional Budget, T=Transfer.
   Forecast = E + T (additional budget / transfers); Variance = Budget − Actual. */
const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { all, get, run } = require('../db/database');
const { requireAuth, requireITAdmin } = require('../middleware/auth');
const { parseBudgetFromBuffer, COLUMNS } = require('../lib/budget-parse');

router.use(requireAuth);
router.use(requireITAdmin);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// SUM expressions per bucket.
const SUM = {
  budget:   "SUM(CASE WHEN version_type='B' THEN amount_usd ELSE 0 END)",
  actual:   "SUM(CASE WHEN version_type='A' THEN amount_usd ELSE 0 END)",
  forecast: "SUM(CASE WHEN version_type IN ('E','T') THEN amount_usd ELSE 0 END)",
};

function shape(row) {
  const budget = round2(row.budget), actual = round2(row.actual), forecast = round2(row.forecast || 0);
  const variance = round2(budget - actual);
  const utilization = budget ? round2((actual / budget) * 100) : 0;
  return { budget, actual, forecast, variance, utilization };
}

// ── GET /api/budget?country=&year= — everything the page needs in one call ────
router.get('/', wrap(async (req, res) => {
  const country = COUNTRIES.includes(req.query.country) ? req.query.country : '';
  const year = /^\d{4}$/.test(req.query.year || '') ? Number(req.query.year) : null;

  // Filters: summary spans all countries (per-country rows); breakdowns honor country.
  const yearCond = year ? ' AND fiscal_year = ?' : '';
  const yp = year ? [year] : [];
  const scopeCond = (country ? ' AND country = ?' : '') + yearCond;
  const sp = (country ? [country] : []).concat(yp);

  // Meta: available years.
  const years = (await all('SELECT DISTINCT fiscal_year AS y FROM budget WHERE fiscal_year IS NOT NULL ORDER BY y'))
    .map(r => r.y).filter(Boolean);

  // Overall Summary — one row per country (year-filtered).
  const summaryRows = await all(
    `SELECT country, ${SUM.budget} AS budget, ${SUM.actual} AS actual, ${SUM.forecast} AS forecast
       FROM budget WHERE 1=1 ${yearCond} GROUP BY country`, yp);
  const byCountry = {}; summaryRows.forEach(r => byCountry[r.country] = r);
  const summary = COUNTRIES.map(c => Object.assign({ country: c }, shape(byCountry[c] || {})));
  const grand = shape(summaryRows.reduce((a, r) => ({
    budget: (a.budget || 0) + r.budget, actual: (a.actual || 0) + r.actual, forecast: (a.forecast || 0) + (r.forecast || 0),
  }), {}));

  // Departmental breakdown (by budget owner) and Project Category breakdown.
  const byDepartment = (await all(
    `SELECT budget_owner AS label, ${SUM.budget} AS budget, ${SUM.actual} AS actual, ${SUM.forecast} AS forecast
       FROM budget WHERE 1=1 ${scopeCond} GROUP BY budget_owner ORDER BY budget DESC`, sp))
    .map(r => Object.assign({ label: r.label || '(none)' }, shape(r)));

  const byCategory = (await all(
    `SELECT project_category AS label, ${SUM.budget} AS budget, ${SUM.actual} AS actual, ${SUM.forecast} AS forecast
       FROM budget WHERE 1=1 ${scopeCond} GROUP BY project_category ORDER BY budget DESC`, sp))
    .map(r => Object.assign({ label: r.label || '(uncategorized)' }, shape(r)));

  // Time series — monthly burn rate (ordered by period), with cumulative actual.
  const tsRows = await all(
    `SELECT period, ${SUM.budget} AS budget, ${SUM.actual} AS actual
       FROM budget WHERE period <> '' ${scopeCond} GROUP BY period ORDER BY period`, sp);
  let cum = 0;
  const timeseries = tsRows.map(r => {
    const actual = round2(r.actual); cum = round2(cum + actual);
    return { period: r.period, budget: round2(r.budget), actual, cumulativeActual: cum };
  });

  // Key Insights — top over/under budget by project (fallback to cost element).
  const grouped = await all(
    `SELECT
        CASE WHEN project_name <> '' THEN project_name
             WHEN project_no <> '' THEN project_no
             ELSE cost_element END AS label,
        country,
        ${SUM.budget} AS budget, ${SUM.actual} AS actual
       FROM budget WHERE 1=1 ${scopeCond}
       GROUP BY label, country HAVING label <> ''`, sp);
  const withVar = grouped.map(r => {
    const budget = round2(r.budget), actual = round2(r.actual);
    return { label: r.label, country: r.country, budget, actual, variance: round2(budget - actual) };
  });
  // Over budget = actual exceeds budget (negative variance), most overspent first.
  const over = withVar.filter(r => r.variance < 0).sort((a, b) => a.variance - b.variance).slice(0, 3);
  // Under budget = largest unspent budget (positive variance), only where a budget exists.
  const under = withVar.filter(r => r.budget > 0 && r.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 3);

  res.json({
    meta: { countries: COUNTRIES, years, selected: { country, year } },
    summary, grand, byDepartment, byCategory, timeseries,
    insights: { over, under },
  });
}));

// ── GET /api/budget/export.xlsx — aggregated workbook ─────────────────────────
router.get('/export.xlsx', wrap(async (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || '') ? Number(req.query.year) : null;
  const yearCond = year ? ' AND fiscal_year = ?' : '';
  const yp = year ? [year] : [];

  const summary = await all(
    `SELECT country, ${SUM.budget} AS Budget, ${SUM.actual} AS Actual, ${SUM.forecast} AS Forecast
       FROM budget WHERE 1=1 ${yearCond} GROUP BY country`, yp);
  const summarySheet = summary.map(r => ({
    Country: r.country, 'Budget (USD)': round2(r.Budget), 'Actual (USD)': round2(r.Actual),
    'Forecast (USD)': round2(r.Forecast), 'Variance (USD)': round2(r.Budget - r.Actual),
    'Utilization %': r.Budget ? round2((r.Actual / r.Budget) * 100) : 0,
  }));

  const cat = await all(
    `SELECT country, project_category AS Category, ${SUM.budget} AS Budget, ${SUM.actual} AS Actual
       FROM budget WHERE 1=1 ${yearCond} GROUP BY country, project_category ORDER BY country, Budget DESC`, yp);
  const catSheet = cat.map(r => ({ Country: r.country, Category: r.Category || '(uncategorized)',
    'Budget (USD)': round2(r.Budget), 'Actual (USD)': round2(r.Actual), 'Variance (USD)': round2(r.Budget - r.Actual) }));

  const ts = await all(
    `SELECT country, period AS Period, ${SUM.budget} AS Budget, ${SUM.actual} AS Actual
       FROM budget WHERE period <> '' ${yearCond} GROUP BY country, period ORDER BY country, period`, yp);
  const tsSheet = ts.map(r => ({ Country: r.country, Period: r.Period,
    'Budget (USD)': round2(r.Budget), 'Actual (USD)': round2(r.Actual) }));

  const raw = await all(
    `SELECT country AS Country, fiscal_year AS "Fiscal Year", period AS Period, category AS Type,
            budget_owner AS Department, project_category AS "Project Category",
            project_name AS Project, cost_element AS "Cost Element", amount_usd AS "Amount USD", description AS Description
       FROM budget WHERE 1=1 ${yearCond} ORDER BY country, period`, yp);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catSheet), 'By Category');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tsSheet), 'By Period');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(raw), 'Detail');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Budget_Tracking${year ? '_' + year : ''}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}));

// ── POST /api/budget/import — upload the Budget-Actual report .xlsx ───────────
// Parses the report (Vietnam/Thailand/Malaysia, Jan–Apr 2026) and REPLACES the
// budget table. Keeps the financial data out of Git — loaded only via upload.
router.post('/import', wrap(async (req, res) => {
  const b64 = req.body && req.body.xlsx_base64;
  if (!b64) return res.status(400).json({ error: 'No file provided' });

  let rows;
  try {
    rows = parseBudgetFromBuffer(Buffer.from(b64, 'base64'));
  } catch (e) { return res.status(400).json({ error: e.message || 'Could not read the Excel file' }); }

  if (!rows.length) return res.status(400).json({ error: 'No matching rows found (Vietnam/Thailand/Malaysia, Jan–Apr 2026, Budget/Actual).' });

  await run('DELETE FROM budget');
  const ph = COLUMNS.map(() => '?').join(',');
  for (const r of rows) {
    await run(`INSERT INTO budget (${COLUMNS.join(',')}) VALUES (${ph})`, COLUMNS.map(c => r[c] == null ? '' : r[c]));
  }
  // Mark the seed version done so the boot migration won't overwrite the upload.
  await run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['budget_seed_v2', `imported=${rows.length}`]);

  const byCountry = {};
  rows.forEach(r => { byCountry[r.country] = (byCountry[r.country] || 0) + 1; });
  res.json({ inserted: rows.length, byCountry });
}));

module.exports = router;
