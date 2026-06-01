/**
 * Restore a backup JSON (made by `npm run backup`) into the configured database.
 * Overwrites each table with the backed-up rows. USE WITH CARE.
 *
 *   Restore into LIVE (Turso):  set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, then:
 *     node db/restore.js backups/backup-XXXX.json
 *   Restore into local file DB: omit the Turso env vars.
 */
const fs = require('fs');
const db = require('./database');

const file = process.argv[2];
if (!file) { console.error('Usage: node db/restore.js <backup-file.json>'); process.exit(1); }

(async () => {
  await db.init();                       // ensures tables exist
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tables = data.tables || {};
  console.log('Restoring from', file, '(source was', (data.source || '?') + ')');

  for (const [t, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows) || !rows.length) { console.log(`  ${t}: (empty, skipped)`); continue; }
    await db.run(`DELETE FROM ${t}`);
    const cols = Object.keys(rows[0]);
    const ph = cols.map(() => '?').join(', ');
    for (const r of rows) {
      await db.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${ph})`, cols.map(c => r[c]));
    }
    console.log(`  ${t}: restored ${rows.length} rows`);
  }
  console.log('✅ Restore complete.');
  process.exit(0);
})().catch(e => { console.error('Restore failed:', e.message); process.exit(1); });
