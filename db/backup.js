/**
 * Full database backup → a timestamped JSON file in ../backups/.
 *
 *   Back up the LIVE (Turso) data:
 *     set TURSO_DATABASE_URL=...   (PowerShell: $env:TURSO_DATABASE_URL="...")
 *     set TURSO_AUTH_TOKEN=...
 *     npm run backup
 *
 *   Back up the local file DB:  just `npm run backup` (no env vars).
 *
 * The JSON snapshot can be re-imported later (every table is dumped as rows).
 */
const fs = require('fs');
const path = require('path');
const db = require('./database');

const TABLES = ['users', 'assets', 'servers', 'personnel', 'licenses',
  'license_assignments', 'maintenance_log', 'notifications', 'audit_log', 'app_meta'];

(async () => {
  await db.init();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = { exported_at: new Date().toISOString(), source: process.env.TURSO_DATABASE_URL ? 'turso' : 'local', tables: {} };
  const counts = {};
  for (const t of TABLES) {
    try { out.tables[t] = await db.all(`SELECT * FROM ${t}`); counts[t] = out.tables[t].length; }
    catch (e) { out.tables[t] = []; counts[t] = `(skipped: ${e.message})`; }
  }
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('✅ Backup written:', file);
  console.log('   Source:', out.source);
  console.log('   Rows:', JSON.stringify(counts));
  process.exit(0);
})().catch(e => { console.error('Backup failed:', e.message); process.exit(1); });
