// Build db/budget-seed.json from the corporate Budget-Actual report using the
// shared parser (lib/budget-parse.js) — same logic the in-app import uses, so a
// local seed and an uploaded file produce identical rows.
// Run: node scripts/build-budget-seed.js  [optional path to .xlsx]
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { parseBudgetWorkbook } = require('../lib/budget-parse');

const SRC = process.argv[2] ||
  "C:\\Users\\vietnguyen\\Downloads\\Abroad_January_April'26 Budget-Actual Report_Tech&Tech_Sec.xlsx";
const OUT = path.join(__dirname, '..', 'db', 'budget-seed.json');

if (!fs.existsSync(SRC)) { console.error('Source not found:', SRC); process.exit(1); }
const wb = XLSX.readFile(SRC);
const rows = parseBudgetWorkbook(wb);
fs.writeFileSync(OUT, JSON.stringify(rows));
const t = {};
for (const x of rows) { t[x.country] = t[x.country] || { Budget: 0, Actual: 0 }; t[x.country][x.category === 'Budget' ? 'Budget' : 'Actual'] += x.amount_usd; }
console.log('rows:', rows.length);
Object.keys(t).forEach(c => console.log(' ', c, 'Budget', Math.round(t[c].Budget), 'Actual', Math.round(t[c].Actual)));
