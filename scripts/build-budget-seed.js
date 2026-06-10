// Build db/budget-seed.json from budget 2026.xlsx → Sheet1 using the shared
// parser (lib/budget-parse.js) — same logic the in-app import uses.
// Run: node scripts/build-budget-seed.js  [optional path to .xlsx]
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { parseBudgetWorkbook } = require('../lib/budget-parse');

const SRC = process.argv[2] ||
  "C:\\Users\\vietnguyen\\OneDrive - HAYAT HOLDING\\Desktop\\Code\\Asset control\\budget 2026.xlsx";
const OUT = path.join(__dirname, '..', 'db', 'budget-seed.json');

if (!fs.existsSync(SRC)) { console.error('Source not found:', SRC); process.exit(1); }
const lines = parseBudgetWorkbook(XLSX.readFile(SRC));
fs.writeFileSync(OUT, JSON.stringify(lines));
const t = {};
for (const x of lines) {
  t[x.country] = t[x.country] || { lines: 0, b2026: 0, jaB: 0, jaA: 0 };
  t[x.country].lines++; t[x.country].b2026 += x.y2026_budget; t[x.country].jaB += x.ja_budget; t[x.country].jaA += x.ja_actual;
}
console.log('line items:', lines.length);
Object.keys(t).forEach(c => console.log(' ', c, 'lines', t[c].lines, '| 2026 Budget', Math.round(t[c].b2026), '| Jan-Apr B', Math.round(t[c].jaB), 'A', Math.round(t[c].jaA)));
