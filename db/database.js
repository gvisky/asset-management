// Dual-mode database layer.
//
//  • LOCAL  (default): uses Node's built-in SQLite (node:sqlite) on a local file.
//                      Great for development and single-machine use.
//  • CLOUD  (when TURSO_DATABASE_URL is set): uses Turso (libSQL) — a free,
//                      shared cloud database so many users in different locations
//                      see the same live data. No credit card required.
//
// All access goes through the async get() / all() / run() / script() helpers,
// so the rest of the app is identical regardless of which backend is active.

const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./auth-utils');

const TURSO_URL   = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const USE_TURSO   = !!TURSO_URL;

let backend = null;   // { get, all, run, script }
let ready   = null;   // Promise that resolves once schema + seed are done

// ── Public async API ──────────────────────────────────────────────────────
async function init() {
  if (ready) return ready;
  ready = setup();
  return ready;
}
async function get(sql, args = [])  { await init(); return backend.get(sql, args); }
async function all(sql, args = [])  { await init(); return backend.all(sql, args); }
async function run(sql, args = [])  { await init(); return backend.run(sql, args); }
async function script(sql)          { await init(); return backend.script(sql); }

// ── Backend setup ───────────────────────────────────────────────────────────
async function setup() {
  if (USE_TURSO) {
    const { createClient } = require('@libsql/client/web');
    const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
    backend = {
      async get(sql, args = []) { const r = await client.execute({ sql, args }); return r.rows[0]; },
      async all(sql, args = []) { const r = await client.execute({ sql, args }); return r.rows; },
      async run(sql, args = []) {
        const r = await client.execute({ sql, args });
        return {
          changes: Number(r.rowsAffected || 0),
          lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
        };
      },
      async script(sql) { await client.executeMultiple(sql); },
    };
    console.log('[db] Using Turso cloud database (shared)');
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'assets.db');
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    backend = {
      async get(sql, args = []) { return db.prepare(sql).get(...args); },
      async all(sql, args = []) { return db.prepare(sql).all(...args); },
      async run(sql, args = []) {
        const r = db.prepare(sql).run(...args);
        return {
          changes: r.changes,
          lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
        };
      },
      async script(sql) { db.exec(sql); },
    };
    console.log('[db] Using local SQLite file:', DB_PATH);
  }

  // Seed/setup uses backend directly (not the public helpers) to avoid
  // re-entering init() before it has resolved.
  await initSchema();
  await migrate();
  await seedUsers();
  await ensureRegionalUsers();
  await ensureTeams();
  await seedAssets();
  await seedPersonnel();
  await seedServers();
}

// On first boot with empty servers, load db/servers-seed.json if present.
async function seedServers() {
  const { c } = await backend.get('SELECT COUNT(*) AS c FROM servers');
  if (Number(c) > 0) return;
  const seedPath = path.join(__dirname, 'servers-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[seed] servers-seed.json parse failed:', e.message); return; }
  for (const r of rows) {
    await backend.run(
      `INSERT INTO servers (country, location, hostname, brand_model, serial_no, asset_code,
         role, status, purchase_date, vendor, cost, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.country || 'Vietnam', r.location || '', r.hostname || '', r.brand_model || '',
       r.serial_no || '', r.asset_code || '', r.role || '', r.status || 'Active',
       r.purchase_date || '', r.vendor || '', r.cost || '', r.remark || '']
    );
  }
  console.log(`[seed] Loaded ${rows.length} servers`);
}

async function initSchema() {
  await backend.script(`
    CREATE TABLE IF NOT EXISTS assets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      location        TEXT    NOT NULL DEFAULT '',
      country         TEXT    NOT NULL DEFAULT 'Vietnam',
      department      TEXT    DEFAULT '',
      computer_no     TEXT    DEFAULT '',
      brand_model     TEXT    DEFAULT '',
      date_assigned   TEXT    DEFAULT '',
      serial_no       TEXT    DEFAULT '',
      mk              TEXT    DEFAULT '',
      asset_code      TEXT    DEFAULT '',
      user_name       TEXT    DEFAULT '',
      ad_name         TEXT    DEFAULT '',
      history_usage   TEXT    DEFAULT '',
      remark          TEXT    DEFAULT '',
      status          TEXT    NOT NULL DEFAULT 'Active'
                              CHECK(status IN ('Active','Broken','Stock')),
      created_at      TEXT    DEFAULT (datetime('now')),
      updated_at      TEXT    DEFAULT (datetime('now'))
    );

    CREATE TRIGGER IF NOT EXISTS assets_updated_at
    AFTER UPDATE ON assets
    BEGIN
      UPDATE assets SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      full_name     TEXT    DEFAULT '',
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'viewer'
                            CHECK(role IN ('admin','editor','viewer')),
      country       TEXT    DEFAULT NULL,   -- NULL = sees all countries; else limited to that country
      team          TEXT    DEFAULT NULL,   -- 'IT' or 'HR' (for the User Inventory page)
      asset_access  INTEGER NOT NULL DEFAULT 1,  -- 0 = cannot see Asset Inventory (e.g. HR-only users)
      created_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS personnel (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      country       TEXT    NOT NULL DEFAULT 'Vietnam',
      display_name  TEXT    DEFAULT '',
      email         TEXT    DEFAULT '',
      user_type     TEXT    DEFAULT '',     -- HR sets: 'Hayat Member' / 'No Hayat Member'
      status        TEXT    NOT NULL DEFAULT 'Active',  -- IT sets: to be delete / pending delete / deleted
      company_name  TEXT    DEFAULT '',
      position      TEXT    DEFAULT '',
      leaving_date  TEXT    DEFAULT '',
      status_changed_at TEXT DEFAULT NULL,  -- when status last changed (for 1-month auto-transition)
      touched       INTEGER NOT NULL DEFAULT 0,  -- 1 once HR/IT edits it (import won't overwrite)
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      audience   TEXT    NOT NULL DEFAULT 'all',   -- 'all' | 'IT' | 'HR'
      country    TEXT    DEFAULT NULL,             -- NULL = all countries
      scope      TEXT    NOT NULL DEFAULT 'system',-- 'asset' | 'personnel' | 'system'
      level      TEXT    NOT NULL DEFAULT 'info',  -- 'info' | 'warning'
      message    TEXT    NOT NULL,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER,
      username    TEXT,
      action      TEXT,
      asset_id    INTEGER,
      details     TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
  `);
}

// Add new columns to existing databases without losing data.
async function migrate() {
  const cols = (await backend.all('PRAGMA table_info(assets)')).map(c => c.name);
  if (!cols.includes('deleted_at')) await backend.run('ALTER TABLE assets ADD COLUMN deleted_at TEXT DEFAULT NULL');
  if (!cols.includes('deleted_by')) await backend.run('ALTER TABLE assets ADD COLUMN deleted_by TEXT DEFAULT NULL');
  // Country dimension — existing rows become 'Vietnam'.
  if (!cols.includes('country'))    await backend.run("ALTER TABLE assets ADD COLUMN country TEXT NOT NULL DEFAULT 'Vietnam'");

  const ucols = (await backend.all('PRAGMA table_info(users)')).map(c => c.name);
  if (!ucols.includes('country'))      await backend.run('ALTER TABLE users ADD COLUMN country TEXT DEFAULT NULL');
  if (!ucols.includes('team'))         await backend.run('ALTER TABLE users ADD COLUMN team TEXT DEFAULT NULL');
  if (!ucols.includes('asset_access')) await backend.run('ALTER TABLE users ADD COLUMN asset_access INTEGER NOT NULL DEFAULT 1');

  await backend.script(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);`);
  await backend.script(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, audience TEXT NOT NULL DEFAULT 'all',
      country TEXT DEFAULT NULL, scope TEXT NOT NULL DEFAULT 'system', level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));`);

  // Software licenses + their seat assignments.
  await backend.script(`CREATE TABLE IF NOT EXISTS licenses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL DEFAULT '',
      vendor       TEXT    DEFAULT '',
      type         TEXT    NOT NULL DEFAULT 'subscription',  -- subscription | perpetual
      total_seats  INTEGER NOT NULL DEFAULT 0,
      license_key  TEXT    DEFAULT '',
      notes        TEXT    DEFAULT '',
      purchase_date TEXT   DEFAULT '',
      renewal_date TEXT    DEFAULT '',
      cost         TEXT    DEFAULT '',
      country      TEXT    NOT NULL DEFAULT 'Global',        -- 'Global' or a country
      created_at   TEXT    DEFAULT (datetime('now')));`);
  await backend.script(`CREATE TABLE IF NOT EXISTS license_assignments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id    INTEGER NOT NULL,
      assignee_type TEXT    NOT NULL DEFAULT 'user',          -- user | asset | person
      assignee_ref  TEXT    NOT NULL DEFAULT '',
      assigned_by   TEXT    DEFAULT '',
      assigned_at   TEXT    DEFAULT (datetime('now')),
      released_at   TEXT    DEFAULT NULL);`);

  // Maintenance & repair log (one row per repair/service/upgrade). Links to an
  // asset OR a server via (asset_type, asset_id).
  await backend.script(`CREATE TABLE IF NOT EXISTS maintenance_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id    INTEGER NOT NULL,
      asset_type  TEXT    NOT NULL DEFAULT 'asset',   -- asset | server
      country     TEXT    DEFAULT '',
      type        TEXT    NOT NULL DEFAULT 'repair',   -- repair | service | upgrade
      description TEXT    NOT NULL DEFAULT '',
      vendor      TEXT    DEFAULT '',
      cost        TEXT    DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'open',      -- open | in_progress | done
      reported_by TEXT    DEFAULT '',
      reported_at TEXT    DEFAULT (datetime('now')),
      resolved_at TEXT    DEFAULT NULL);`);
  // Add asset_type to already-deployed maintenance tables.
  const mcols = (await backend.all('PRAGMA table_info(maintenance_log)')).map(c => c.name);
  if (!mcols.includes('asset_type')) await backend.run("ALTER TABLE maintenance_log ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'asset'");

  // Department on licenses (additive).
  const lcols = (await backend.all('PRAGMA table_info(licenses)')).map(c => c.name);
  if (!lcols.includes('department')) await backend.run("ALTER TABLE licenses ADD COLUMN department TEXT DEFAULT ''");

  // Server Asset Inventory — parallel to assets, with server-specific fields.
  await backend.script(`
    CREATE TABLE IF NOT EXISTS servers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      country         TEXT    NOT NULL DEFAULT 'Vietnam',
      location        TEXT    DEFAULT '',
      hostname        TEXT    DEFAULT '',
      brand_model     TEXT    DEFAULT '',
      serial_no       TEXT    DEFAULT '',
      asset_code      TEXT    DEFAULT '',
      ip_address      TEXT    DEFAULT '',
      os              TEXT    DEFAULT '',
      cpu             TEXT    DEFAULT '',
      ram             TEXT    DEFAULT '',
      storage         TEXT    DEFAULT '',
      role            TEXT    DEFAULT '',
      status          TEXT    NOT NULL DEFAULT 'Active'
                              CHECK(status IN ('Active','Broken','Stock')),
      purchase_date   TEXT    DEFAULT '',
      warranty_expiry TEXT    DEFAULT '',
      vendor          TEXT    DEFAULT '',
      cost            TEXT    DEFAULT '',
      po_number       TEXT    DEFAULT '',
      history_usage   TEXT    DEFAULT '',
      remark          TEXT    DEFAULT '',
      created_at      TEXT    DEFAULT (datetime('now')),
      updated_at      TEXT    DEFAULT (datetime('now')),
      deleted_at      TEXT    DEFAULT NULL,
      deleted_by      TEXT    DEFAULT NULL
    );
    CREATE TRIGGER IF NOT EXISTS servers_updated_at
    AFTER UPDATE ON servers
    BEGIN
      UPDATE servers SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  `);

  const pcols = (await backend.all('PRAGMA table_info(personnel)')).map(c => c.name);
  if (!pcols.includes('touched')) await backend.run('ALTER TABLE personnel ADD COLUMN touched INTEGER NOT NULL DEFAULT 0');

  // Rename asset status 'Retired' -> 'Stock'. SQLite can't alter a CHECK
  // constraint in place, so rebuild the table (existing rows are remapped).
  // Guarded on the stored table definition, so it runs at most once.
  const assetsDef = await backend.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'");
  if (assetsDef && /'Retired'/.test(assetsDef.sql)) {
    const current = (await backend.all('PRAGMA table_info(assets)')).map(c => c.name);
    const target = ['id','location','country','department','computer_no','brand_model',
      'date_assigned','serial_no','mk','asset_code','user_name','ad_name','history_usage',
      'remark','status','created_at','updated_at','deleted_at','deleted_by'];
    const common = target.filter(c => current.includes(c));
    const colList = common.join(', ');
    const selectList = common
      .map(c => c === 'status'
        ? "CASE WHEN status='Retired' THEN 'Stock' ELSE status END AS status"
        : c)
      .join(', ');
    await backend.script(`
      PRAGMA foreign_keys=OFF;
      DROP TRIGGER IF EXISTS assets_updated_at;
      CREATE TABLE assets_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        location        TEXT    NOT NULL DEFAULT '',
        country         TEXT    NOT NULL DEFAULT 'Vietnam',
        department      TEXT    DEFAULT '',
        computer_no     TEXT    DEFAULT '',
        brand_model     TEXT    DEFAULT '',
        date_assigned   TEXT    DEFAULT '',
        serial_no       TEXT    DEFAULT '',
        mk              TEXT    DEFAULT '',
        asset_code      TEXT    DEFAULT '',
        user_name       TEXT    DEFAULT '',
        ad_name         TEXT    DEFAULT '',
        history_usage   TEXT    DEFAULT '',
        remark          TEXT    DEFAULT '',
        status          TEXT    NOT NULL DEFAULT 'Active'
                                CHECK(status IN ('Active','Broken','Stock')),
        created_at      TEXT    DEFAULT (datetime('now')),
        updated_at      TEXT    DEFAULT (datetime('now')),
        deleted_at      TEXT    DEFAULT NULL,
        deleted_by      TEXT    DEFAULT NULL
      );
      INSERT INTO assets_new (${colList}) SELECT ${selectList} FROM assets;
      DROP TABLE assets;
      ALTER TABLE assets_new RENAME TO assets;
      CREATE TRIGGER IF NOT EXISTS assets_updated_at
      AFTER UPDATE ON assets
      BEGIN
        UPDATE assets SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
      PRAGMA foreign_keys=ON;
    `);
    console.log('[db] Migrated asset status: Retired -> Stock');
  }

  // Warranty & purchase fields on assets (additive). Re-read columns because
  // the Retired->Stock rebuild above may have just recreated the table.
  const acols = (await backend.all('PRAGMA table_info(assets)')).map(c => c.name);
  if (!acols.includes('purchase_date'))   await backend.run("ALTER TABLE assets ADD COLUMN purchase_date TEXT DEFAULT ''");
  if (!acols.includes('warranty_expiry')) await backend.run("ALTER TABLE assets ADD COLUMN warranty_expiry TEXT DEFAULT ''");
  if (!acols.includes('vendor'))          await backend.run("ALTER TABLE assets ADD COLUMN vendor TEXT DEFAULT ''");
  if (!acols.includes('cost'))            await backend.run("ALTER TABLE assets ADD COLUMN cost TEXT DEFAULT ''");
  if (!acols.includes('po_number'))       await backend.run("ALTER TABLE assets ADD COLUMN po_number TEXT DEFAULT ''");
}

// Create a notification for a given audience/country/scope.
async function notify({ audience = 'all', country = null, scope = 'system', level = 'info', message }) {
  try {
    await run('INSERT INTO notifications (audience, country, scope, level, message) VALUES (?, ?, ?, ?, ?)',
              [audience, country, scope, level, message]);
  } catch (e) { console.error('notify failed:', e.message); }
}

async function getMeta(key) {
  const r = await get('SELECT value FROM app_meta WHERE key = ?', [key]);
  return r ? r.value : null;
}
async function setMeta(key, value) {
  await run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [key, String(value)]);
}

// Assign IT/HR teams and ensure the new HR user (Ha Tran) exists. Idempotent.
async function ensureTeams() {
  const IT = ['viet', 'hiep', 'quocviet'];
  const HR = ['somrutai', 'izzati'];
  for (const u of IT) await backend.run("UPDATE users SET team = 'IT' WHERE username = ? AND (team IS NULL OR team = '')", [u]);
  for (const u of HR) await backend.run("UPDATE users SET team = 'HR' WHERE username = ? AND (team IS NULL OR team = '')", [u]);

  // Ha Tran — new HR member for Vietnam (no Asset Inventory access).
  const exists = await backend.get('SELECT id FROM users WHERE username = ?', ['hatran']);
  if (!exists) {
    await backend.run(
      'INSERT INTO users (username, full_name, password_hash, role, country, team, asset_access) VALUES (?, ?, ?, ?, ?, ?, 0)',
      ['hatran', 'Ha Tran', hashPassword('hatran123'), 'editor', 'Vietnam', 'HR']
    );
    console.log('[seed] Created HR member hatran -> Vietnam (no asset access)');
  }
  // HR-only members do not get Asset Inventory access.
  await backend.run("UPDATE users SET asset_access = 0 WHERE username = 'hatran'");
}

// On first boot with empty personnel, load db/personnel-seed.json if present.
async function seedPersonnel() {
  const { c } = await backend.get('SELECT COUNT(*) AS c FROM personnel');
  if (Number(c) > 0) {
    // Backfill the import timestamp for databases seeded before this field existed.
    await backend.run("INSERT INTO app_meta (key, value) VALUES ('personnel_last_import', datetime('now')) ON CONFLICT(key) DO NOTHING");
    return;
  }
  const seedPath = path.join(__dirname, 'personnel-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[seed] personnel-seed.json parse failed:', e.message); return; }
  for (const r of rows) {
    await backend.run(
      `INSERT INTO personnel (country, display_name, email, user_type, status, company_name, position, leaving_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.country || 'Vietnam', r.display_name || '', r.email || '', r.user_type || '',
       r.status || 'Active', r.company_name || '', r.position || '', r.leaving_date || '']
    );
  }
  // Record the initial import time (only if not already set) for the IT reminder.
  await backend.run(
    "INSERT INTO app_meta (key, value) VALUES ('personnel_last_import', datetime('now')) ON CONFLICT(key) DO NOTHING"
  );
  console.log(`[seed] Loaded ${rows.length} personnel records`);
}

// Idempotently ensure the regional managers exist (runs on every start).
// Somrutai → Thailand, Izzati → Malaysia. Both are editors limited to their country.
async function ensureRegionalUsers() {
  const managers = [
    { username: 'somrutai', full_name: 'Somrutai', role: 'editor', country: 'Thailand', password: 'somrutai123' },
    { username: 'izzati',   full_name: 'Izzati',   role: 'editor', country: 'Malaysia', password: 'izzati123' },
  ];
  for (const m of managers) {
    const exists = await backend.get('SELECT id FROM users WHERE username = ?', [m.username]);
    if (!exists) {
      await backend.run(
        'INSERT INTO users (username, full_name, password_hash, role, country) VALUES (?, ?, ?, ?, ?)',
        [m.username, m.full_name, hashPassword(m.password), m.role, m.country]
      );
      console.log(`[seed] Created regional manager ${m.username} -> ${m.country}`);
    }
  }
}

// Seed the team's accounts on first run (only if no users exist).
async function seedUsers() {
  const { c } = await backend.get('SELECT COUNT(*) AS c FROM users');
  if (Number(c) > 0) return;

  const team = [
    { username: 'viet',     full_name: 'Viet',      role: 'admin',  password: process.env.ADMIN_PASS || 'viet123' },
    { username: 'hiep',     full_name: 'Hiep',      role: 'editor', password: 'hiep123' },
    { username: 'quocviet', full_name: 'Quoc Viet', role: 'editor', password: 'quocviet123' },
  ];
  for (const u of team) {
    await backend.run(
      'INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)',
      [u.username, u.full_name, hashPassword(u.password), u.role]
    );
  }
  console.log('\n  [seed] Created users: viet(admin), hiep(editor), quocviet(editor)\n');
}

// On first boot with an empty assets table, load db/seed-data.json if present.
async function seedAssets() {
  const { c } = await backend.get('SELECT COUNT(*) AS c FROM assets');
  if (Number(c) > 0) return;

  const seedPath = path.join(__dirname, 'seed-data.json');
  if (!fs.existsSync(seedPath)) return;

  let rows;
  try { rows = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[seed] Could not parse seed-data.json:', e.message); return; }

  for (const r of rows) {
    await backend.run(`
      INSERT INTO assets
        (location, department, computer_no, brand_model, date_assigned,
         serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.location || '', r.department || '', r.computer_no || '', r.brand_model || '',
       r.date_assigned || '', r.serial_no || '', r.mk || '', r.asset_code || '',
       r.user_name || '', r.ad_name || '', r.history_usage || '', r.remark || '',
       r.status || 'Active']
    );
  }
  console.log(`[seed] Loaded ${rows.length} assets from seed-data.json`);
}

// Write an audit entry. Safe to await on every mutation.
async function audit(user, action, assetId, details) {
  try {
    await run(
      'INSERT INTO audit_log (user_id, username, action, asset_id, details) VALUES (?, ?, ?, ?, ?)',
      [user ? user.id : null, user ? user.username : 'system', action, assetId || null, details || '']
    );
  } catch (e) {
    console.error('audit failed:', e.message);
  }
}

module.exports = { init, get, all, run, script, audit, notify, getMeta, setMeta, USE_TURSO };
