// Build db/budget-seed.json from "budget 2026.xlsx" → sheet "Data (2)".
// Filters the 3 countries, translates Turkish columns to English, normalizes
// the period, and buckets the version type. Run: node scripts/build-budget-seed.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SRC = path.join(__dirname, '..', '..', 'budget 2026.xlsx');
const OUT = path.join(__dirname, '..', 'db', 'budget-seed.json');

const COUNTRY = { HK_VIETNAM: 'Vietnam', HK_THAILAND: 'Thailand', HK_MALAYSIA: 'Malaysia' };
const OWNER = {
  'BİLGİ TEKN.': 'Information Technology',
  'İNSAN KAYN.': 'Human Resources',
  'İD. İŞLER': 'Administrative Affairs',
};
const CATEGORY = { A: 'Actual', B: 'Budget', E: 'Additional Budget', T: 'Transfer' };

// Column indexes in the "Data (2)" sheet (header on row index 1).
const C = {
  owner: 2, company: 5, doc_no: 6, period: 8, fiscal_year: 10, version_type: 11,
  cost_element: 13, pyp: 17, amount_usd: 21, description: 23,
  project_no: 25, project_name: 26, project_group: 27, project_category: 28,
  department: 33,
};

function normPeriod(v) {
  // "2024'01" -> { period: "2024-01", year: 2024, month: 1 }
  const s = String(v).trim();
  const m = s.match(/(\d{4})\D*(\d{1,2})/);
  if (!m) return { period: s, year: null, month: null };
  const year = Number(m[1]), month = Number(m[2]);
  return { period: `${year}-${String(month).padStart(2, '0')}`, year, month };
}

function run() {
  if (!fs.existsSync(SRC)) { console.error('Source not found:', SRC); process.exit(1); }
  const wb = XLSX.readFile(SRC);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Data (2)'], { header: 1, defval: '' }).slice(2);
  const out = [];
  for (const r of rows) {
    const company = String(r[C.company]).trim();
    const country = COUNTRY[company];
    if (!country) continue;
    const vt = String(r[C.version_type]).trim().toUpperCase();
    const p = normPeriod(r[C.period]);
    out.push({
      country,
      company,
      budget_owner: OWNER[String(r[C.owner]).trim()] || String(r[C.owner]).trim(),
      department: String(r[C.department]).trim(),
      version_type: vt,
      category: CATEGORY[vt] || vt,
      fiscal_year: Number(r[C.fiscal_year]) || p.year,
      period: p.period,
      period_month: p.month,
      project_no: String(r[C.project_no]).trim(),
      project_name: String(r[C.project_name]).trim(),
      project_category: String(r[C.project_category]).trim(),
      cost_element: String(r[C.cost_element]).trim(),
      amount_usd: Math.round((Number(r[C.amount_usd]) || 0) * 100) / 100,
      doc_no: String(r[C.doc_no]).trim(),
      description: String(r[C.description]).trim(),
    });
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  // Quick sanity totals
  const t = {};
  for (const x of out) { t[x.country] = t[x.country] || {}; t[x.country][vtKey(x.version_type)] = (t[x.country][vtKey(x.version_type)] || 0) + x.amount_usd; }
  console.log('rows:', out.length);
  console.log('totals:', JSON.stringify(t, null, 1));
}
function vtKey(v) { return v === 'A' ? 'Actual' : v === 'B' ? 'Budget' : v; }
run();
