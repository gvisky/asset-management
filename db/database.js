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
  await seedAssets();
}

async function initSchema() {
  await backend.script(`
    CREATE TABLE IF NOT EXISTS assets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      location        TEXT    NOT NULL DEFAULT '',
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
                              CHECK(status IN ('Active','Broken','Retired')),
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
      created_at    TEXT    DEFAULT (datetime('now'))
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

// Add soft-delete columns to existing databases without losing data.
async function migrate() {
  const cols = (await backend.all('PRAGMA table_info(assets)')).map(c => c.name);
  if (!cols.includes('deleted_at')) await backend.run('ALTER TABLE assets ADD COLUMN deleted_at TEXT DEFAULT NULL');
  if (!cols.includes('deleted_by')) await backend.run('ALTER TABLE assets ADD COLUMN deleted_by TEXT DEFAULT NULL');
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

module.exports = { init, get, all, run, script, audit, USE_TURSO };
