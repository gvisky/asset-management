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
  await mapCostCenters();
  await backfillPersonnelDept();
  await clearNonVnPersonnelDept();
  await applyRealInventory();
  await applyScreenFill();
  await applyHtComputerNoFill();
  await applyPtSerialFill();
  await applyTlTabletFill();
  await seedBudget();
}

// Seed/refresh budget_line from budget-seed.json. Version-keyed: bumping
// META_KEY replaces the prior dataset wherever the seed file is present (local).
// Environments without the seed file (financial data kept out of Git) are left
// untouched.
const BUDGET_COLS = ['country', 'company', 'department', 'proj_group', 'proj_category', 'program', 'project',
  'sub_project', 'pyp_name', 'oc', 'gl_tr_no', 'gl_tr_name', 'wbs', 'proje_no', 'proje_name',
  'y2025_actual', 'y2026_budget', 'ja_budget', 'ja_actual', 'm2026_budget', 'm2026_af'];
async function seedBudget() {
  const META_KEY = 'budget_seed_v3';   // v3 = Sheet1 line-item format
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const seedPath = path.join(__dirname, 'budget-seed.json');
  if (!fs.existsSync(seedPath)) return;   // nothing to load here
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[seed] budget-seed.json parse failed:', e.message); return; }

  await backend.run('DELETE FROM budget_line');
  const ph = BUDGET_COLS.map(() => '?').join(',');
  let n = 0;
  for (const r of recs) {
    const vals = BUDGET_COLS.map(c => {
      const v = r[c];
      if (c === 'm2026_budget' || c === 'm2026_af') return JSON.stringify(Array.isArray(v) ? v : []);
      return v == null ? '' : v;
    });
    await backend.run(`INSERT INTO budget_line (${BUDGET_COLS.join(',')}) VALUES (${ph})`, vals);
    n++;
  }
  await backend.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [META_KEY, `inserted=${n}`]);
  console.log(`[seed] budget_line: ${n} rows (v3)`);
}

// One-time fill from tl.xlsx (tl-fill-seed.json). Each row is a Tablet asset.
// These already carry their serials from the main seed, but were seeded before
// the asset_type column existed, so on older deploys their asset_type is blank
// and they don't appear under the Tablet filter. Set asset_type='Tablet' where
// blank; only fill Serial # if it is somehow blank/placeholder (never overwrite,
// and the DB/seed serials — with leading zeros — are authoritative over the
// file's number-truncated ones).
async function applyTlTabletFill() {
  const META_KEY = 'tl_tablet_fill_v1';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const seedPath = path.join(__dirname, 'tl-fill-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[map] tl-fill-seed.json parse failed:', e.message); return; }

  let updated = 0, typed = 0;
  for (const r of recs) {
    const code = (r.asset_code || '').trim();
    const sn = (r.serial_no || '').trim();
    if (!code) continue;
    const a = await backend.get(
      `SELECT id, serial_no, asset_type FROM assets WHERE deleted_at IS NULL
         AND (LOWER(asset_code) = LOWER(?) OR LOWER(asset_s4) = LOWER(?))
       ORDER BY id ASC LIMIT 1`, [code, code]);
    if (!a) continue;
    const sets = [], vals = [];
    if (isBlankish(a.asset_type)) { sets.push("asset_type = 'Tablet'"); typed++; }
    if (sn && isBlankish(a.serial_no)) { sets.push('serial_no = ?'); vals.push(sn); }
    if (!sets.length) continue;
    await backend.run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, [...vals, a.id]);
    updated++;
  }

  await backend.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, `updated=${updated},typed=${typed}`]);
  console.log(`[map] TL tablet fill: ${updated} updated (${typed} got asset_type=Tablet)`);
}

// One-time fill from PT.xlsx (pt-fill-seed.json). Each row is a Printer asset.
// Match by Asset Code and fill Serial # where blank/placeholder — never
// overwrites a real serial.
async function applyPtSerialFill() {
  const META_KEY = 'pt_serial_fill_v1';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const seedPath = path.join(__dirname, 'pt-fill-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[map] pt-fill-seed.json parse failed:', e.message); return; }

  let updated = 0;
  for (const r of recs) {
    const code = (r.asset_code || '').trim();
    const sn = (r.serial_no || '').trim();
    if (!code || !sn) continue;
    const a = await backend.get(
      `SELECT id, serial_no FROM assets WHERE deleted_at IS NULL
         AND (LOWER(asset_code) = LOWER(?) OR LOWER(asset_s4) = LOWER(?))
       ORDER BY (asset_type = 'Printer') DESC, id ASC LIMIT 1`, [code, code]);
    if (!a) continue;
    if (!isBlankish(a.serial_no)) continue; // never overwrite a real serial
    await backend.run('UPDATE assets SET serial_no = ? WHERE id = ?', [sn, a.id]);
    updated++;
  }

  await backend.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, `updated=${updated}`]);
  console.log(`[map] PT serial fill: ${updated} printers updated`);
}

// One-time fill from HT.xlsx (ht-fill-seed.json). Every row in that file is a
// "Hand terminals" asset. Match each row by Asset Code, fill Computer No (MAC
// address) where blank, and set asset_type = 'Hand terminals' where blank — so
// the records show up under the Hand Terminal filter (with their MAC) on every
// environment, even where the cost-center import created them without a type.
function isBlankish(v) {
  const s = (v == null ? '' : String(v)).trim().toLowerCase();
  return s === '' || s === 'none' || s === 'null' || s === 'n/a' || s === 'na' || s === '-' || s === '—';
}

async function applyHtComputerNoFill() {
  const META_KEY = 'ht_computer_no_fill_v3';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const seedPath = path.join(__dirname, 'ht-fill-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[map] ht-fill-seed.json parse failed:', e.message); return; }

  let updated = 0, typed = 0;
  for (const r of recs) {
    const code = (r.asset_code || '').trim();
    const cn = (r.computer_no || '').trim();
    if (!code) continue;
    const a = await backend.get(
      `SELECT id, computer_no, asset_type FROM assets WHERE deleted_at IS NULL
         AND (LOWER(asset_code) = LOWER(?) OR LOWER(asset_s4) = LOWER(?))
       ORDER BY id ASC LIMIT 1`, [code, code]);
    if (!a) continue;
    const sets = [], vals = [];
    // Fill MAC when the stored value is empty OR a placeholder like "None"/"none"/"null".
    if (cn && isBlankish(a.computer_no)) { sets.push('computer_no = ?'); vals.push(cn); }
    if (isBlankish(a.asset_type)) { sets.push("asset_type = 'Hand terminals'"); typed++; }
    if (!sets.length) continue;
    await backend.run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, [...vals, a.id]);
    updated++;
  }

  // Clean up display: turn any leftover placeholder Computer No on Hand terminals
  // into a true blank so the UI shows "—" instead of the literal "None"/"null".
  const cleaned = await backend.run(
    `UPDATE assets SET computer_no = '' WHERE asset_type = 'Hand terminals' AND deleted_at IS NULL
       AND LOWER(TRIM(computer_no)) IN ('none','null','n/a','na','-','—')`);

  await backend.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, `updated=${updated},typed=${typed}`]);
  console.log(`[map] HT fill v3: ${updated} updated (${typed} typed), placeholder Computer No cleaned`);
}

// One-time fill from screen.xlsx (screen-fill-seed.json): match each monitor by
// Asset Code (preferring the 'Screen'-typed record) and fill Serial # (only when
// blank — never overwrite) and set Location = 'Office'.
async function applyScreenFill() {
  const META_KEY = 'screen_fill_v1';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const seedPath = path.join(__dirname, 'screen-fill-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[map] screen-fill-seed.json parse failed:', e.message); return; }

  let updated = 0;
  for (const r of recs) {
    const code = (r.asset_code || '').trim();
    if (!code) continue;
    const a = await backend.get(
      `SELECT id, serial_no FROM assets WHERE deleted_at IS NULL
         AND (LOWER(asset_code) = LOWER(?) OR LOWER(asset_s4) = LOWER(?))
       ORDER BY (asset_type = 'Screen') DESC, id ASC LIMIT 1`, [code, code]);
    if (!a) continue;
    const serial = (r.serial_no || '').trim();
    const newSerial = (a.serial_no && a.serial_no.trim()) ? a.serial_no : serial; // never overwrite
    await backend.run('UPDATE assets SET serial_no = ?, location = ? WHERE id = ?', [newSerial, 'Office', a.id]);
    updated++;
  }

  await backend.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, `updated=${updated}`]);
  console.log(`[map] Screen fill: ${updated} screens set Location=Office + serial`);
}

// One-time reconciliation from the "Real Inventory list" (real-inventory-seed.json).
// Matches each row to an asset by ECC code → serial → S4 and overwrites the
// file's fields (file wins where it has a value; blanks are left alone). Rows
// that match nothing (Malaysia/Thailand laptops) are inserted. Missing users are
// added, and Vietnam users' department/cost-center are synced from their asset.
async function applyRealInventory() {
  const META_KEY = 'real_inventory_v1';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const seedPath = path.join(__dirname, 'real-inventory-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[map] real-inventory-seed.json parse failed:', e.message); return; }

  const FIELDS = ['asset_code', 'asset_s4', 'serial_no', 'computer_no', 'ad_name', 'user_name', 'brand_model',
    'asset_type', 'cost_center', 'cost_center_desc', 'ecc_cc', 'asset_description', 'mk', 'country', 'location',
    'department', 'status', 'date_assigned', 'purchase_date', 'warranty_expiry', 'vendor', 'cost', 'po_number', 'remark'];
  const VALID_STATUS = ['Active', 'Broken', 'Stock'];
  const VALID_COUNTRY = ['Vietnam', 'Thailand', 'Malaysia'];

  let updated = 0, inserted = 0, usersAdded = 0;
  for (const r of recs) {
    let a = null;
    if (r.asset_code) a = await backend.get('SELECT * FROM assets WHERE LOWER(asset_code) = LOWER(?) AND deleted_at IS NULL', [r.asset_code]);
    if (!a && r.serial_no) a = await backend.get('SELECT * FROM assets WHERE LOWER(serial_no) = LOWER(?) AND deleted_at IS NULL', [r.serial_no]);
    if (!a && r.asset_s4) a = await backend.get('SELECT * FROM assets WHERE asset_s4 = ? AND deleted_at IS NULL', [r.asset_s4]);

    if (a) {
      const sets = [], vals = [];
      for (const f of FIELDS) {
        const v = r[f];
        if (v === undefined || v === null || v === '') continue;     // never blank existing data
        if (f === 'status' && !VALID_STATUS.includes(v)) continue;
        if (f === 'country' && !VALID_COUNTRY.includes(v)) continue;
        sets.push(`${f} = ?`); vals.push(v);
      }
      if (sets.length) { await backend.run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, [...vals, a.id]); updated++; }
    } else {
      if (r.serial_no) {
        const dup = await backend.get('SELECT id FROM assets WHERE LOWER(serial_no) = LOWER(?) AND deleted_at IS NULL', [r.serial_no]);
        if (dup) continue;
      }
      const status = VALID_STATUS.includes(r.status) ? r.status : 'Active';
      const country = VALID_COUNTRY.includes(r.country) ? r.country : 'Vietnam';
      await backend.run(
        `INSERT INTO assets (asset_code, asset_s4, serial_no, computer_no, ad_name, user_name, brand_model,
            asset_type, cost_center, cost_center_desc, ecc_cc, asset_description, mk, country, location,
            department, status, date_assigned, purchase_date, warranty_expiry, vendor, cost, po_number, remark, history_usage)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.asset_code, r.asset_s4, r.serial_no, r.computer_no, r.ad_name, r.user_name, r.brand_model,
         r.asset_type, r.cost_center, r.cost_center_desc, r.ecc_cc, r.asset_description, r.mk, country, r.location,
         r.department, status, r.date_assigned, r.purchase_date, r.warranty_expiry, r.vendor, r.cost, r.po_number, r.remark,
         'Imported from Real Inventory list']);
      inserted++;
    }
  }

  // Add any users (by AD Name) not already in the User Inventory. Email local-part
  // is kept equal to the AD Name so the asset↔user link works.
  const seenAd = new Set();
  for (const r of recs) {
    const ad = (r.ad_name || '').trim().toLowerCase();
    if (!ad || seenAd.has(ad)) continue;
    seenAd.add(ad);
    const found = await backend.get(
      "SELECT id FROM personnel WHERE instr(email,'@') > 0 AND LOWER(substr(email,1,instr(email,'@')-1)) = ?", [ad]);
    if (found) continue;
    const country = VALID_COUNTRY.includes(r.country) ? r.country : 'Vietnam';
    const fileLp = (r.email && r.email.includes('@')) ? r.email.split('@')[0].toLowerCase() : '';
    const email = (fileLp === ad) ? r.email : `${r.ad_name}@hayat.com.tr`;
    await backend.run(
      "INSERT INTO personnel (country, display_name, email, status, touched) VALUES (?, ?, ?, 'Active', 1)",
      [country, r.user_name || r.ad_name, email]);
    usersAdded++;
  }

  // Sync Vietnam users' Department / Cost Center from their linked asset.
  const subA = (col) => `(SELECT a.${col} FROM assets a WHERE a.deleted_at IS NULL AND a.${col} <> ''
        AND instr(personnel.email,'@') > 0 AND LOWER(a.ad_name) = LOWER(substr(personnel.email,1,instr(personnel.email,'@')-1))
        ORDER BY a.id LIMIT 1)`;
  await backend.run(
    `UPDATE personnel SET department = COALESCE(${subA('department')}, department),
        cost_center = COALESCE(${subA('cost_center')}, cost_center) WHERE country = 'Vietnam'`);

  await backend.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, `updated=${updated},inserted=${inserted},usersAdded=${usersAdded}`]);
  console.log(`[map] Real Inventory reconciliation: ${updated} assets updated, ${inserted} added, ${usersAdded} users added`);
}

// Thailand & Malaysia use a different (not-yet-defined) Cost Center / Department
// scheme, so don't carry the Vietnam values for them — blank them once.
async function clearNonVnPersonnelDept() {
  const META_KEY = 'personnel_nonvn_blank_v1';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const res = await backend.run(
    "UPDATE personnel SET department = '', cost_center = '' WHERE country IN ('Thailand','Malaysia')");
  await backend.run(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, String(res.changes || 0)]);
  console.log(`[map] Cleared VN dept/cost-center for ${res.changes || 0} TH/MY people`);
}

// Seed each person's Department / Cost Center from their linked assets (matched
// by AD Name = email local-part). One-time; runs after the cost-center mapping.
async function backfillPersonnelDept() {
  const META_KEY = 'personnel_dept_backfill_v1';
  if (await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY])) return;
  const sub = (col) =>
    `(SELECT a.${col} FROM assets a
        WHERE a.deleted_at IS NULL AND a.${col} <> '' AND instr(personnel.email,'@') > 0
          AND LOWER(a.ad_name) = LOWER(substr(personnel.email, 1, instr(personnel.email,'@') - 1))
        ORDER BY a.id LIMIT 1)`;
  const res = await backend.run(
    `UPDATE personnel SET
        department  = COALESCE(${sub('department')}, department),
        cost_center = COALESCE(${sub('cost_center')}, cost_center)
      WHERE instr(email,'@') > 0 AND (department IS NULL OR department = '')`);
  await backend.run(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, String(res.changes || 0)]);
  console.log(`[map] Personnel department/cost-center backfilled for ${res.changes || 0} people`);
}

// Mapping of the Accounting team's cost-center / SAP data onto assets.
// Links on asset_code == "Asset code ECC" and fills Cost Center, ECC CC, Asset S4,
// Asset Description, Cost Center Description, Department (= Cost Center Description),
// plus Purchase Date and Cost. Assets in the file that don't yet exist are created.
// Runs after assets are seeded; guarded by app_meta so it applies once per version.
// Bump META_KEY to re-run after a new accounting file is dropped in.
async function mapCostCenters() {
  const META_KEY = 'cost_center_mapped_v3';
  const done = await backend.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY]);
  if (done) return;
  const seedPath = path.join(__dirname, 'cost-center-seed.json');
  if (!fs.existsSync(seedPath)) return;
  let recs;
  try { recs = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { console.error('[map] cost-center-seed.json parse failed:', e.message); return; }

  let updated = 0, inserted = 0;
  for (const r of recs) {
    const code = (r.asset_code_ecc || '').toString().trim();
    if (!code) continue;
    const dept = r.cost_center_desc || '';   // Department is overwritten from the cost-center description

    const existing = await backend.get(
      'SELECT id FROM assets WHERE LOWER(asset_code) = LOWER(?) AND deleted_at IS NULL', [code]);
    if (existing) {
      // Update every asset sharing this code (some legacy rows duplicate an asset_code).
      const res = await backend.run(
        `UPDATE assets SET
           cost_center = ?, ecc_cc = ?, asset_s4 = ?, asset_description = ?, cost_center_desc = ?,
           department    = CASE WHEN ? <> '' THEN ? ELSE department END,
           purchase_date = CASE WHEN ? <> '' THEN ? ELSE purchase_date END,
           cost          = CASE WHEN ? <> '' THEN ? ELSE cost END
         WHERE LOWER(asset_code) = LOWER(?) AND deleted_at IS NULL`,
        [r.cost_center || '', r.ecc_cc || '', r.asset_s4 || '', r.asset_description || '', r.cost_center_desc || '',
         dept, dept, r.purchase_date || '', r.purchase_date || '', r.cost || '', r.cost || '', code]);
      if (res.changes) updated += res.changes;
    } else {
      // New asset from the accounting file. Skip if it was already inserted (by Asset S4).
      const byS4 = r.asset_s4
        ? await backend.get('SELECT id FROM assets WHERE asset_s4 = ? AND deleted_at IS NULL', [r.asset_s4])
        : null;
      if (byS4) continue;
      await backend.run(
        `INSERT INTO assets
           (country, status, department, brand_model, asset_code, history_usage,
            purchase_date, cost, cost_center, ecc_cc, asset_s4, asset_description, cost_center_desc)
         VALUES ('Vietnam', 'Active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dept, r.asset_description || '', code, 'Imported from Accounting cost-center file',
         r.purchase_date || '', r.cost || '', r.cost_center || '', r.ecc_cc || '',
         r.asset_s4 || '', r.asset_description || '', dept]);
      inserted++;
    }
  }
  await backend.run(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [META_KEY, `updated=${updated},inserted=${inserted}`]);
  console.log(`[map] Cost-center / SAP mapping: updated ${updated}, inserted ${inserted} assets`);
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
      `INSERT INTO servers (country, location, hostname, brand_model, producer, category, serial_no, asset_code,
         role, status, purchase_date, vendor, cost, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.country || 'Vietnam', r.location || '', r.hostname || '', r.brand_model || '',
       r.producer || '', r.category || '', r.serial_no || '', r.asset_code || '', r.role || '', r.status || 'Active',
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

    -- Budget tracking (IT admin only): one row per budget line item for
    -- Vietnam / Thailand / Malaysia (from budget 2026.xlsx → Sheet1), with the
    -- category hierarchy, GL/WBS codes, yearly totals and monthly 2026
    -- Budget / Actual+Forecast series (stored as JSON arrays).
    CREATE TABLE IF NOT EXISTS budget_line (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      country          TEXT    NOT NULL DEFAULT '',
      company          TEXT    DEFAULT '',
      department       TEXT    DEFAULT '',
      proj_group       TEXT    DEFAULT '',   -- F  (main category)
      proj_category    TEXT    DEFAULT '',   -- G
      program          TEXT    DEFAULT '',   -- H
      project          TEXT    DEFAULT '',   -- I
      sub_project      TEXT    DEFAULT '',   -- J
      pyp_name         TEXT    DEFAULT '',   -- T
      oc               TEXT    DEFAULT '',   -- K  CAPEX / OPEX
      gl_tr_no         TEXT    DEFAULT '',   -- L  Turkish GL (MÇ No)
      gl_tr_name       TEXT    DEFAULT '',   -- M
      wbs              TEXT    DEFAULT '',   -- S  PYP No
      proje_no         TEXT    DEFAULT '',
      proje_name       TEXT    DEFAULT '',
      y2025_actual     REAL    NOT NULL DEFAULT 0,   -- AG
      y2026_budget     REAL    NOT NULL DEFAULT 0,   -- AT
      ja_budget        REAL    NOT NULL DEFAULT 0,   -- AU (Jan–Apr 2026 budget)
      ja_actual        REAL    NOT NULL DEFAULT 0,   -- AV (Jan–Apr 2026 actual)
      m2026_budget     TEXT    DEFAULT '[]',         -- JSON[12]
      m2026_af         TEXT    DEFAULT '[]'          -- JSON[12] actual(Jan-Apr)+forecast
    );
    CREATE INDEX IF NOT EXISTS idx_budget_line_country ON budget_line(country);

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
      producer        TEXT    DEFAULT '',
      category        TEXT    DEFAULT '',
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

  // Producer + Category on servers (additive) for easy device-type checking.
  const scols = (await backend.all('PRAGMA table_info(servers)')).map(c => c.name);
  if (!scols.includes('producer')) await backend.run("ALTER TABLE servers ADD COLUMN producer TEXT DEFAULT ''");
  if (!scols.includes('category')) await backend.run("ALTER TABLE servers ADD COLUMN category TEXT DEFAULT ''");
  // fields_locked = 1 once an IT member has edited a protected field (Serial / Brand-Model / Asset Code).
  if (!scols.includes('fields_locked')) await backend.run("ALTER TABLE servers ADD COLUMN fields_locked INTEGER NOT NULL DEFAULT 0");
  // Backfill producer/category onto already-imported servers from the seed (by serial). Runs once.
  const backfilled = await backend.get("SELECT value FROM app_meta WHERE key = 'servers_pc_backfill'");
  if (!backfilled) {
    const seedPath = path.join(__dirname, 'servers-seed.json');
    if (fs.existsSync(seedPath)) {
      try {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        for (const s of seed) {
          if (!s.serial_no) continue;
          await backend.run(
            "UPDATE servers SET producer = ?, category = ? WHERE serial_no = ? AND (producer IS NULL OR producer = '')",
            [s.producer || '', s.category || '', s.serial_no]);
        }
      } catch (e) { console.error('[seed] server backfill failed:', e.message); }
    }
    await backend.run("INSERT INTO app_meta (key, value) VALUES ('servers_pc_backfill', '1') ON CONFLICT(key) DO NOTHING");
  }

  const pcols = (await backend.all('PRAGMA table_info(personnel)')).map(c => c.name);
  if (!pcols.includes('touched')) await backend.run('ALTER TABLE personnel ADD COLUMN touched INTEGER NOT NULL DEFAULT 0');
  // Department & Cost Center on the person (editable by HR/IT; seeded from their assets).
  if (!pcols.includes('department'))  await backend.run("ALTER TABLE personnel ADD COLUMN department TEXT DEFAULT ''");
  if (!pcols.includes('cost_center')) await backend.run("ALTER TABLE personnel ADD COLUMN cost_center TEXT DEFAULT ''");

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
  // sap_confirmed = 1 once IT has sent the change to accounting for SAP update.
  if (!acols.includes('sap_confirmed'))   await backend.run("ALTER TABLE assets ADD COLUMN sap_confirmed INTEGER NOT NULL DEFAULT 0");
  // fields_locked = 1 once an IT member has edited a protected field (Serial / Brand-Model / Asset Code).
  if (!acols.includes('fields_locked'))   await backend.run("ALTER TABLE assets ADD COLUMN fields_locked INTEGER NOT NULL DEFAULT 0");
  // Accounting / SAP mapping (from Mapped_Asset_Cost_Center): linked via asset_code = "Asset code ECC".
  if (!acols.includes('cost_center'))       await backend.run("ALTER TABLE assets ADD COLUMN cost_center TEXT DEFAULT ''");
  if (!acols.includes('ecc_cc'))            await backend.run("ALTER TABLE assets ADD COLUMN ecc_cc TEXT DEFAULT ''");
  if (!acols.includes('asset_s4'))          await backend.run("ALTER TABLE assets ADD COLUMN asset_s4 TEXT DEFAULT ''");
  if (!acols.includes('asset_description')) await backend.run("ALTER TABLE assets ADD COLUMN asset_description TEXT DEFAULT ''");
  if (!acols.includes('cost_center_desc'))  await backend.run("ALTER TABLE assets ADD COLUMN cost_center_desc TEXT DEFAULT ''");
  // Asset Type (Laptop, Screen, IP phone, …) — for grouping/filtering the inventory.
  if (!acols.includes('asset_type'))        await backend.run("ALTER TABLE assets ADD COLUMN asset_type TEXT DEFAULT ''");
  // user_locked = 1 once any member changed User Name / AD Name (a holder change);
  // surfaced via the History Usage button. Only an IT admin can unlock.
  if (!acols.includes('user_locked'))       await backend.run("ALTER TABLE assets ADD COLUMN user_locked INTEGER NOT NULL DEFAULT 0");
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
  // Yen — Vietnam HR member (User Inventory only), same as Ha Tran.
  const yenExists = await backend.get('SELECT id FROM users WHERE username = ?', ['yen']);
  if (!yenExists) {
    await backend.run(
      'INSERT INTO users (username, full_name, password_hash, role, country, team, asset_access) VALUES (?, ?, ?, ?, ?, ?, 0)',
      ['yen', 'Yen', hashPassword('yen123'), 'editor', 'Vietnam', 'HR']
    );
    console.log('[seed] Created HR member yen -> Vietnam (no asset access)');
  }
  // HR-only members do not get Asset Inventory access.
  await backend.run("UPDATE users SET asset_access = 0 WHERE username IN ('hatran', 'yen')");
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
