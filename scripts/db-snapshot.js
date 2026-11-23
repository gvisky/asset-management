// Full copy of the database into a new SQLite file — every table, index and row.
//
// Source = the database this app is configured for:
//   • Turso (cloud)  when TURSO_DATABASE_URL + TURSO_AUTH_TOKEN are set
//   • local SQLite   otherwise (DB_PATH, default db/assets.db)
//
// Uses:
//   • Nightly backup on the server:     node scripts/db-snapshot.js /app/backups/assets-2026-11-23.db
//   • Move from Turso to the server:    node scripts/db-snapshot.js /data/assets.db --force
//     (then remove TURSO_* from deploy/.env and restart — the app uses the local file)
//
// (db/backup.js only covers the first 10 tables; this copies all of them.)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--'));
const force = args.includes('--force');
if (!out) { console.error('Usage: node scripts/db-snapshot.js <target.db> [--force]'); process.exit(1); }

(async () => {
  const db = require('../db/database');
  await db.init();
  const src = process.env.TURSO_DATABASE_URL ? 'Turso' : `local file ${process.env.DB_PATH || 'db/assets.db'}`;

  const target = path.resolve(out);
  if (process.env.DB_PATH && path.resolve(process.env.DB_PATH) === target && !process.env.TURSO_DATABASE_URL) {
    console.error('Target is the same file as the source.'); process.exit(1);
  }
  for (const f of [target, target + '-wal', target + '-shm']) {
    if (fs.existsSync(f)) {
      if (!force) { console.error(`${target} already exists — add --force to replace it.`); process.exit(1); }
      fs.unlinkSync(f);
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.part';
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const dst = new DatabaseSync(tmp);

  const objs = await db.all(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`);
  const tables = objs.filter(o => o.type === 'table');
  console.log(`Copying ${tables.length} tables from ${src} → ${target}`);

  const toVal = (v) => (v instanceof ArrayBuffer ? Buffer.from(v) : ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : typeof v === 'bigint' ? Number(v) : v);
  let totalRows = 0;
  for (const t of tables) {
    dst.exec(t.sql);
    const cols = (await db.all(`PRAGMA table_info("${t.name}")`)).map(c => c.name);
    if (!cols.length) continue;
    const ins = dst.prepare(`INSERT INTO "${t.name}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    // Page through big tables (audit log, activity …) so Turso responses stay small.
    const PAGE = 2000;
    let n = 0;
    for (let off = 0; ; off += PAGE) {
      const rows = await db.all(`SELECT * FROM "${t.name}" LIMIT ${PAGE} OFFSET ${off}`);
      if (!rows.length) break;
      dst.exec('BEGIN');
      for (const r of rows) ins.run(...cols.map(c => toVal(r[c])));
      dst.exec('COMMIT');
      n += rows.length;
      if (rows.length < PAGE) break;
    }
    totalRows += n;
    console.log(`  ${t.name.padEnd(28)} ${n}`);
  }
  for (const o of objs.filter(o => o.type !== 'table')) {
    try { dst.exec(o.sql); } catch (e) { console.warn(`  (skipped ${o.type} ${o.name}: ${e.message})`); }
  }
  dst.exec('PRAGMA journal_mode = DELETE');
  dst.close();
  fs.renameSync(tmp, target);
  console.log(`Done: ${tables.length} tables, ${totalRows} rows → ${target} (${(fs.statSync(target).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
})().catch(e => { console.error('Snapshot failed:', e.message || e); process.exit(1); });
