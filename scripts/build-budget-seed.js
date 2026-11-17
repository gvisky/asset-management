// Load corporate budget workbooks into the database configured for this
// machine (local SQLite, or Turso when TURSO_DATABASE_URL is set). Same parser
// and replace rules as the Budget page import (public/js/budget-core.js +
// routes/budget.js importRows). Financial data never goes into Git.
//
// Run:  node scripts/build-budget-seed.js [--dry-run] <file.xlsx> [more.xlsx …]
//   e.g. "2027_BUDGET_10.11.2026 - Vietnam.xlsx" (approved budget) and
//        "DT_…_B-F_RAPOR … - Vietnam.xlsx" (monthly budget vs actual report).
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const core = require('../public/js/budget-core');
const { importRows, importFinance } = require('../routes/budget');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter(a => a !== '--dry-run');
if (!files.length) { console.error('Usage: node scripts/build-budget-seed.js [--dry-run] <file.xlsx> [...]'); process.exit(1); }

(async () => {
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error('Not found:', f); continue; }
    const name = path.basename(f).replace(/^[0-9a-f]{8}-/, '');
    const r = core.parseWithXLSX(XLSX, fs.readFileSync(f), 'buffer', name);
    const { sheets } = r;
    const d = r.source === 'finance'
      ? await importFinance(r.finance, name, { id: null, username: 'script' }, dryRun)    // Finance control (.xlsb)
      : await importRows(r.items, name, { id: null, username: 'script' }, dryRun);
    console.log(`${name} · sheet ${sheets.join(', ')}${dryRun ? ' · DRY RUN' : ''}`);
    d.plan.forEach(p => console.log(`  ${p.country} ${p.year} [${p.kind}] ${p.action}${p.reason ? ' (' + p.reason + ')' : ''}: ` +
      `${p.lines} lines · budget $${Math.round(p.budget).toLocaleString('en-US')} · A+F $${Math.round(p.actual).toLocaleString('en-US')}`));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
