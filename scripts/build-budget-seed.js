// Build db/budget-seed.json from the corporate Budget-Actual report.
// Source: "Abroad_January_April'26 Budget-Actual Report_Tech&Tech_Sec.xlsx",
// sheet "Data_Ocak-Nisan" (flat transactional rows). Filters Vietnam / Thailand
// / Malaysia, January–April 2026 (the report scope), translates the Turkish
// columns to English, and buckets the version (B=Budget, A=Actual).
// Run: node scripts/build-budget-seed.js  [optional path to .xlsx]
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SRC = process.argv[2] ||
  "C:\\Users\\vietnguyen\\Downloads\\Abroad_January_April'26 Budget-Actual Report_Tech&Tech_Sec.xlsx";
const OUT = path.join(__dirname, '..', 'db', 'budget-seed.json');
const SHEET = 'Data_Ocak-Nisan';

// Column indexes in Data_Ocak-Nisan (header on row index 1).
const C = {
  company: 1, doc_no: 5, fiscal_year: 6, period: 8, version_type: 9,
  cost_element: 12, dept: 21, amount_usd: 24, description: 26,
  project_category: 28, program: 29, project: 30, sub_project: 31, project_no: 32,
};
const CATEGORY = { A: 'Actual', B: 'Budget', E: 'Additional Budget', T: 'Transfer' };
const JAN_APR_2026 = new Set(["2026'01", "2026'02", "2026'03", "2026'04"]);

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

function run() {
  if (!fs.existsSync(SRC)) { console.error('Source not found:', SRC); process.exit(1); }
  const wb = XLSX.readFile(SRC);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: '' }).slice(2);
  const out = [];
  for (const r of rows) {
    const country = countryOf(r[C.company]);
    if (!country) continue;
    const period = String(r[C.period]).trim();
    if (!JAN_APR_2026.has(period)) continue;            // report scope: Jan–Apr 2026
    const vt = String(r[C.version_type]).trim().toUpperCase();
    if (vt !== 'A' && vt !== 'B') continue;
    const p = normPeriod(period);
    const dept = String(r[C.dept]).trim();
    out.push({
      country,
      company: String(r[C.company]).trim(),
      budget_owner: dept,                                // Müdürlük (Technology / Pmo)
      department: dept,
      version_type: vt,
      category: CATEGORY[vt] || vt,
      fiscal_year: Number(r[C.fiscal_year]) || p.year,
      period: p.period,
      period_month: p.month,
      project_no: String(r[C.project_no]).trim(),
      project_name: String(r[C.project] || r[C.sub_project] || r[C.program]).trim(),
      project_category: String(r[C.project_category]).trim(),
      cost_element: String(r[C.cost_element]).trim(),
      amount_usd: Math.round((Number(r[C.amount_usd]) || 0) * 100) / 100,
      doc_no: String(r[C.doc_no]).trim(),
      description: String(r[C.description]).trim(),
    });
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  const t = {};
  for (const x of out) { t[x.country] = t[x.country] || { Budget: 0, Actual: 0 }; t[x.country][x.category === 'Budget' ? 'Budget' : 'Actual'] += x.amount_usd; }
  console.log('rows:', out.length);
  Object.keys(t).forEach(c => console.log(' ', c, 'Budget', Math.round(t[c].Budget), 'Actual', Math.round(t[c].Actual)));
}
run();
