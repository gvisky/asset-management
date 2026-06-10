// Build db/gl-map-seed.json from GL.xlsx (MÇ No -> Local GL).
// Run: node scripts/build-gl-map-seed.js  [optional path to .xlsx]
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SRC = process.argv[2] ||
  "C:\\Users\\vietnguyen\\OneDrive - HAYAT HOLDING\\Desktop\\Code\\Asset control\\GL.xlsx";
const OUT = path.join(__dirname, '..', 'db', 'gl-map-seed.json');

if (!fs.existsSync(SRC)) { console.error('Source not found:', SRC); process.exit(1); }
const rows = XLSX.utils.sheet_to_json(XLSX.readFile(SRC).Sheets['Sheet1'], { header: 1, defval: '' })
  .slice(1).filter(r => String(r[0]).trim() !== '');
const map = {};
for (const r of rows) { const k = String(r[0]).trim(); const v = String(r[1]).trim(); if (k) map[k] = v; }
const out = Object.keys(map).sort().map(k => ({ gl_tr_no: k, local_gl: map[k] }));
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('GL mappings:', out.length);
