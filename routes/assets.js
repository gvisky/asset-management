const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify, getMeta, setMeta } = require('../db/database');
const XLSX = require('xlsx');
const { requireAuth, requireRole, requireGlobalAdmin, requireITAdmin, isITAdmin } = require('../middleware/auth');
const { buildDeliveryForm } = require('../lib/delivery-form');
const { ASSET_COLUMNS, normalizeAssetType } = require('../lib/asset-columns');

// Identity fields that only IT may edit; editing one locks the record until an
// IT admin unlocks it. Same set is used on the Server Inventory.
const PROTECTED_FIELDS = { serial_no: 'Serial', brand_model: 'Brand/Model', asset_code: 'Asset Code' };

// Holder fields — changing either (a reassignment) locks the record (user_locked).
// Any member may make the change; only an IT admin can unlock (via History Usage).
const HOLDER_FIELDS = { user_name: 'User Name', ad_name: 'AD Name' };

// Asset types that never need the "missing info" identifiers (no serial /
// computer no / AD name), so they're never flagged in Needs Attention.
const NO_FLAG_TYPES = ['camera', 'data center', 'ip phone', 'license', 'live stream', 'screen'];
const NOT_FLAGGED_SQL =
  `(asset_type IS NULL OR asset_type = '' OR LOWER(asset_type) NOT IN (${NO_FLAG_TYPES.map(() => '?').join(',')}))`;

const VALID_COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];

// Only this account may edit the History Usage audit log (configurable via env).
const HISTORY_OWNER = process.env.HISTORY_OWNER || 'viet';

// Every asset route requires a logged-in user.
router.use(requireAuth);

// Block users who don't have Asset Inventory access (e.g. HR-only members).
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) {
    return res.status(403).json({ error: 'No access to Asset Inventory' });
  }
  next();
});

// Small wrapper so async handler errors become 500s instead of hanging.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// The country a user is restricted to (null = sees all countries).
const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;

// Build a country filter: scoped users are forced to their country; global users
// may optionally filter via ?country=. Returns { clause, params }.
function countryFilter(req) {
  const scope = scopeOf(req);
  if (scope) return { clause: 'country = ?', params: [scope] };
  if (req.query.country) return { clause: 'country = ?', params: [req.query.country] };
  return { clause: null, params: [] };
}

// ── GET /api/assets — list (excludes soft-deleted) with search & filter ───────
router.get('/', wrap(async (req, res) => {
  const { search = '', status = '', location = '', brand = '', department = '',
          cost_center = '', asset_type = '', incomplete = '', ad_issue = '', page = 1, limit = 50 } = req.query;

  const conditions = ['deleted_at IS NULL'];
  const params = [];

  const cf = countryFilter(req);
  if (cf.clause) { conditions.push(cf.clause); params.push(...cf.params); }

  if (search) {
    conditions.push(`(
      department   LIKE ? OR computer_no  LIKE ? OR brand_model LIKE ? OR
      serial_no    LIKE ? OR asset_code   LIKE ? OR user_name   LIKE ? OR
      ad_name      LIKE ? OR asset_s4     LIKE ? OR cost_center LIKE ? OR
      asset_description LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }
  if (status)     { conditions.push('status = ?');      params.push(status); }
  if (location)   { conditions.push('location = ?');    params.push(location); }
  if (brand)      { conditions.push('brand_model = ?'); params.push(brand); }
  if (department) { conditions.push('department = ?');  params.push(department); }
  if (cost_center){ conditions.push('cost_center = ?'); params.push(cost_center); }
  if (asset_type) { conditions.push('asset_type = ?');  params.push(asset_type); }
  if (incomplete) {
    // Must mirror GET /incomplete exactly: missing key field, Active-without-AD, or duplicate serial.
    const dupCountry = cf.clause ? ` AND ${cf.clause}` : '';
    conditions.push(`(
      serial_no   IS NULL OR serial_no   = '' OR
      asset_code  IS NULL OR asset_code  = '' OR
      computer_no IS NULL OR computer_no = '' OR
      (status = 'Active' AND (ad_name IS NULL OR ad_name = '')) OR
      serial_no IN (SELECT serial_no FROM assets WHERE deleted_at IS NULL AND serial_no <> ''${dupCountry} GROUP BY serial_no HAVING COUNT(*) > 1)
    )`);
    if (cf.clause) params.push(...cf.params);
    conditions.push(NOT_FLAGGED_SQL); params.push(...NO_FLAG_TYPES);
    conditions.push("status = 'Active'");   // Broken/Stock are not flagged for missing info
  }
  if (ad_issue) {
    // AD-link problems, editable in place: an AD Name that matches no user, OR an
    // Active asset missing its AD Name (exempt types excluded).
    conditions.push(`(
      (ad_name <> '' AND NOT EXISTS (SELECT 1 FROM personnel p WHERE instr(p.email,'@') > 0
          AND LOWER(substr(p.email, 1, instr(p.email,'@') - 1)) = LOWER(assets.ad_name)))
      OR
      (status = 'Active' AND (ad_name IS NULL OR ad_name = '') AND ${NOT_FLAGGED_SQL})
    )`);
    params.push(...NO_FLAG_TYPES);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);

  // When filtering by AD issues, tag each row with the reason so the table can
  // highlight exactly what's wrong (no extra params — the subquery has none).
  const adReasonSel = ad_issue ? `, CASE
      WHEN ad_name <> '' AND NOT EXISTS (SELECT 1 FROM personnel p WHERE instr(p.email,'@') > 0
          AND LOWER(substr(p.email, 1, instr(p.email,'@') - 1)) = LOWER(assets.ad_name)) THEN 'unmatched'
      WHEN (ad_name IS NULL OR ad_name = '') THEN 'missing'
      ELSE '' END AS ad_issue_reason` : '';

  const totalRow = await get(`SELECT COUNT(*) as cnt FROM assets ${where}`, params);
  const rows = await all(
    `SELECT *${adReasonSel} FROM assets ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );

  res.json({ total: Number(totalRow.cnt), page: Number(page), limit: Number(limit), data: rows });
}));

// ── GET /api/assets/stats — dashboard metrics (excludes soft-deleted) ─────────
router.get('/stats', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const liveCond = ['deleted_at IS NULL'];
  const lp = [];
  if (cf.clause) { liveCond.push(cf.clause); lp.push(...cf.params); }
  const live = 'WHERE ' + liveCond.join(' AND ');

  const total = Number((await get(`SELECT COUNT(*) as cnt FROM assets ${live}`, lp)).cnt);

  const byStatus = (await all(`SELECT status, COUNT(*) as cnt FROM assets ${live} GROUP BY status`, lp))
    .reduce((acc, r) => { acc[r.status] = Number(r.cnt); return acc; }, {});

  const byLocation = (await all(`SELECT location, COUNT(*) as cnt FROM assets ${live} GROUP BY location`, lp))
    .reduce((acc, r) => { acc[r.location] = Number(r.cnt); return acc; }, {});

  const byCountry = (await all(`SELECT country, COUNT(*) as cnt FROM assets ${live} GROUP BY country ORDER BY cnt DESC`, lp))
    .reduce((acc, r) => { acc[r.country] = Number(r.cnt); return acc; }, {});

  const byBrand = await all(
    `SELECT brand_model, COUNT(*) as cnt FROM assets ${live} GROUP BY brand_model ORDER BY cnt DESC LIMIT 8`, lp
  );

  const recentlyAdded = await all(`SELECT * FROM assets ${live} ORDER BY id DESC LIMIT 5`, lp);

  // Deleted + incomplete counts respect the same country scope.
  const delCond = ['deleted_at IS NOT NULL']; const dp = [];
  if (cf.clause) { delCond.push(cf.clause); dp.push(...cf.params); }
  const deletedCount = Number((await get(`SELECT COUNT(*) as cnt FROM assets WHERE ${delCond.join(' AND ')}`, dp)).cnt);

  const incCond = [...liveCond, `(
      serial_no   IS NULL OR serial_no   = '' OR
      asset_code  IS NULL OR asset_code  = '' OR
      computer_no IS NULL OR computer_no = '' OR
      (status = 'Active' AND (ad_name IS NULL OR ad_name = ''))
    )`, NOT_FLAGGED_SQL, "status = 'Active'"];
  const incompleteCount = Number((await get(`SELECT COUNT(*) as cnt FROM assets WHERE ${incCond.join(' AND ')}`, [...lp, ...NO_FLAG_TYPES])).cnt);

  // Warranty expiring/expired within 90 days (live assets that have a date set).
  const warCond = [...liveCond, "warranty_expiry <> ''", "date(warranty_expiry) <= date('now','+90 days')"];
  const warrantyExpiring = Number((await get(`SELECT COUNT(*) as cnt FROM assets WHERE ${warCond.join(' AND ')}`, lp)).cnt);

  // Open maintenance/repairs (respect the same country scope via maintenance_log.country).
  const repCond = ["status <> 'done'"]; const rp = [];
  if (cf.clause) { repCond.push(cf.clause); rp.push(...cf.params); }
  const openRepairs = Number((await get(`SELECT COUNT(*) as cnt FROM maintenance_log WHERE ${repCond.join(' AND ')}`, rp)).cnt);

  res.json({ total, byStatus, byLocation, byCountry, byBrand, recentlyAdded, deletedCount, incompleteCount,
             warrantyExpiring, openRepairs, scope: scopeOf(req) });
}));

// Models (brand_model) that are locked from deletion (JSON list in app_meta).
async function getLockedModels() {
  try { const a = JSON.parse(await getMeta('locked_models') || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

// ── GET /api/assets/top-models — models + per-country quantity for an Asset Type
// (Dashboard "Top Models" box). Country-scoped. ───────────────────────────────
router.get('/top-models', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const base = ['deleted_at IS NULL']; const bp = [];
  if (cf.clause) { base.push(cf.clause); bp.push(...cf.params); }
  const baseWhere = 'WHERE ' + base.join(' AND ');

  const assetTypes = (await all(
    `SELECT asset_type AS type, COUNT(*) AS cnt FROM assets ${baseWhere} AND asset_type <> ''
       GROUP BY asset_type ORDER BY cnt DESC`, bp)).map(r => ({ type: r.type, count: Number(r.cnt) }));

  const names = assetTypes.map(t => t.type);
  let selected = (req.query.asset_type || '').trim();
  if (!selected || !names.includes(selected)) selected = names.includes('Laptop') ? 'Laptop' : (names[0] || '');

  const countries = scopeOf(req) ? [scopeOf(req)] : VALID_COUNTRIES;
  const rows = selected ? await all(
    `SELECT brand_model, country, COUNT(*) AS cnt FROM assets WHERE ${base.join(' AND ')} AND asset_type = ?
       GROUP BY brand_model, country`, [...bp, selected]) : [];
  const map = {};
  for (const r of rows) {
    const bm = r.brand_model || 'Unknown';
    (map[bm] = map[bm] || { brand_model: bm, total: 0, byCountry: {} });
    map[bm].byCountry[r.country] = Number(r.cnt);
    map[bm].total += Number(r.cnt);
  }
  const models = Object.values(map).sort((a, b) => b.total - a.total);
  res.json({ assetTypes, selected, countries, models, lockedModels: await getLockedModels(), canLock: isITAdmin(req.user) });
}));

// ── GET / POST /api/assets/locked-models — delete-lock per Model ──────────────
router.get('/locked-models', wrap(async (req, res) => res.json({ lockedModels: await getLockedModels() })));
router.post('/locked-models', requireITAdmin, wrap(async (req, res) => {
  const model = ((req.body && req.body.brand_model) || '').trim();
  if (!model) return res.status(400).json({ error: 'brand_model is required' });
  const locked = !!(req.body && req.body.locked);
  let set = (await getLockedModels()).filter(m => m.toLowerCase() !== model.toLowerCase());
  if (locked) set.push(model);
  await setMeta('locked_models', JSON.stringify(set));
  await audit(req.user, 'LOCK', null, `${locked ? 'Locked' : 'Unlocked'} model "${model}" from deletion`);
  res.json({ lockedModels: set });
}));

// ── GET /api/assets/filters — distinct values for the filter dropdowns ────────
router.get('/filters', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const extra = cf.clause ? ` AND ${cf.clause}` : '';
  // Brands can be narrowed to a single asset type (so the model dropdown follows
  // the selected Asset Type filter).
  const at = (req.query.asset_type || '').trim();
  const brandExtra = extra + (at ? ' AND asset_type = ?' : '');
  const brandParams = at ? [...cf.params, at] : cf.params;
  const brands = (await all(
    `SELECT DISTINCT brand_model AS v FROM assets WHERE deleted_at IS NULL AND brand_model <> ''${brandExtra} ORDER BY brand_model COLLATE NOCASE`,
    brandParams
  )).map(r => r.v);
  const departments = (await all(
    `SELECT DISTINCT department AS v FROM assets WHERE deleted_at IS NULL AND department <> ''${extra} ORDER BY department COLLATE NOCASE`,
    cf.params
  )).map(r => r.v);
  // Cost centers (grouped) with their description and asset count.
  const costCenters = (await all(
    `SELECT cost_center AS code, MAX(cost_center_desc) AS descr, MAX(ecc_cc) AS ecc, COUNT(*) AS cnt
       FROM assets WHERE deleted_at IS NULL AND cost_center <> ''${extra}
       GROUP BY cost_center ORDER BY cost_center COLLATE NOCASE`, cf.params
  )).map(r => ({ code: r.code, descr: r.descr || '', ecc: r.ecc || '', count: Number(r.cnt) }));
  // Asset types (grouped) with their count.
  const assetTypes = (await all(
    `SELECT asset_type AS v, COUNT(*) AS cnt FROM assets WHERE deleted_at IS NULL AND asset_type <> ''${extra}
       GROUP BY asset_type ORDER BY asset_type COLLATE NOCASE`, cf.params
  )).map(r => ({ type: r.v, count: Number(r.cnt) }));
  // Global users get the full country list; scoped users get only their own.
  const countries = scopeOf(req) ? [scopeOf(req)] : VALID_COUNTRIES;
  res.json({ brands, departments, countries, costCenters, assetTypes });
}));

// ── GET /api/assets/incomplete — missing key identifiers OR duplicate serial ──
router.get('/incomplete', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const base = cf.clause ? ` AND ${cf.clause}` : '';

  // Serial numbers that appear on more than one live asset (in scope).
  const dups = (await all(
    `SELECT serial_no FROM assets WHERE deleted_at IS NULL AND serial_no <> ''${base}
     GROUP BY serial_no HAVING COUNT(*) > 1`, cf.params)).map(r => String(r.serial_no));
  const dupSet = new Set(dups);

  // Only Active assets are flagged — Broken/Stock are never shown in Needs Attention.
  const cond = ['deleted_at IS NULL', "status = 'Active'", `(
      serial_no IS NULL OR serial_no='' OR
      asset_code IS NULL OR asset_code='' OR
      computer_no IS NULL OR computer_no='' OR
      (ad_name IS NULL OR ad_name='')
    )`];
  if (cf.clause) cond.push(cf.clause);
  cond.push(NOT_FLAGGED_SQL);
  const incomplete = await all(`SELECT * FROM assets WHERE ${cond.join(' AND ')}`, [...cf.params, ...NO_FLAG_TYPES]);

  // Active assets that share a duplicated serial number (exempt types excluded).
  let dupRows = [];
  if (dups.length) {
    const ph = dups.map(() => '?').join(',');
    const dcond = ['deleted_at IS NULL', "status = 'Active'", `serial_no IN (${ph})`];
    if (cf.clause) dcond.push(cf.clause);
    dcond.push(NOT_FLAGGED_SQL);
    dupRows = await all(`SELECT * FROM assets WHERE ${dcond.join(' AND ')}`, [...dups, ...cf.params, ...NO_FLAG_TYPES]);
  }

  // Map each duplicated serial → the assets that carry it.
  const holders = new Map();   // serial → [{id, asset_code, computer_no}]
  for (const r of dupRows) {
    const key = String(r.serial_no);
    if (!holders.has(key)) holders.set(key, []);
    holders.get(key).push({ id: r.id, asset_code: r.asset_code, computer_no: r.computer_no });
  }

  // Merge unique by id, tagging which have a duplicate serial + who else shares it.
  const byId = new Map();
  const tag = (r) => {
    const isDup = dupSet.has(String(r.serial_no));
    const others = isDup ? holders.get(String(r.serial_no)).filter(h => h.id !== r.id) : [];
    return { ...r, dup_serial: isDup, dup_with: others };
  };
  for (const r of incomplete) byId.set(r.id, tag(r));
  for (const r of dupRows) if (!byId.has(r.id)) byId.set(r.id, tag(r));
  const rows = [...byId.values()].sort((a, b) =>
    String(a.country || '').localeCompare(String(b.country || '')) || a.id - b.id);
  res.json(rows);
}));

// ── GET /api/assets/deleted — recycle bin (admin only) ────────────────────────
router.get('/deleted', requireRole('admin'), wrap(async (req, res) => {
  const cf = countryFilter(req);
  const cond = ['deleted_at IS NOT NULL'];
  if (cf.clause) cond.push(cf.clause);
  const rows = await all(`SELECT * FROM assets WHERE ${cond.join(' AND ')} ORDER BY deleted_at DESC`, cf.params);
  res.json(rows);
}));

// ── GET /api/assets/by-user/:adname — assets linked to a person by AD Name ────
router.get('/by-user/:adname', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const cond = ['deleted_at IS NULL', 'LOWER(ad_name) = LOWER(?)'];
  const params = [req.params.adname];
  if (cf.clause) { cond.push(cf.clause); params.push(...cf.params); }
  const rows = await all(`SELECT * FROM assets WHERE ${cond.join(' AND ')} ORDER BY id DESC`, params);
  res.json(rows);
}));

// ── GET /api/assets/user-locked — records locked by a User Name / AD Name change
// (a reassignment), surfaced by the 🕓 History Usage button. Country-scoped. ──
router.get('/user-locked', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const cond = ['deleted_at IS NULL', 'user_locked = 1'];
  if (cf.clause) cond.push(cf.clause);
  const rows = await all(
    `SELECT * FROM assets WHERE ${cond.join(' AND ')} ORDER BY updated_at DESC, id DESC`, cf.params);
  res.json(rows);
}));

// ── POST /api/assets/:id/user-unlock — IT admin clears the holder (User/AD) lock
router.post('/:id/user-unlock', requireITAdmin, wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  if (!existing.user_locked) return res.json({ message: 'already unlocked', user_locked: 0 });

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `${ts} UTC: 🔓 unlocked User Name / AD Name by ${req.user.username}`;
  const newHistory = existing.history_usage ? `${existing.history_usage}\n${line}` : line;
  await run('UPDATE assets SET user_locked = 0, history_usage = ? WHERE id = ?', [newHistory, req.params.id]);
  await audit(req.user, 'UNLOCK', Number(req.params.id),
    `Unlocked User Name / AD Name for "${existing.asset_code || existing.brand_model || 'untitled'}"`);
  res.json({ message: 'unlocked', user_locked: 0 });
}));

// ── POST /api/assets/:id/unlock — IT admin re-opens the protected fields ──────
router.post('/:id/unlock', requireITAdmin, wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  if (!existing.fields_locked) return res.json({ message: 'already unlocked', fields_locked: 0 });

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `${ts} UTC: 🔓 unlocked Serial/Brand-Model/Asset Code by ${req.user.username}`;
  const newHistory = existing.history_usage ? `${existing.history_usage}\n${line}` : line;
  await run('UPDATE assets SET fields_locked = 0, history_usage = ? WHERE id = ?', [newHistory, req.params.id]);
  await audit(req.user, 'UNLOCK', Number(req.params.id),
    `Unlocked protected fields for "${existing.asset_code || existing.brand_model || 'untitled'}"`);
  res.json({ message: 'unlocked', fields_locked: 0 });
}));

// ── GET /api/assets/:id/delivery-form — export the signed Delivery-Acceptance
// form (.xlsx) pre-filled with this asset, for printing & user signature. ─────
router.get('/:id/delivery-form', wrap(async (req, res) => {
  const a = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Asset not found' });
  const scope = scopeOf(req);
  if (scope && a.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  const today = new Date().toISOString().slice(0, 10);
  const buf = buildDeliveryForm({
    brand_model: a.brand_model,
    asset_code:  a.asset_s4 || a.asset_code,   // Asset S4 is the main code after mapping
    serial_no:   a.serial_no,
    date_print:  today,
    department:  a.department,
    it_member:   req.user.full_name || req.user.username,
    user_name:   a.user_name || a.ad_name || '',
  });

  await audit(req.user, 'PRINT', a.id, `Printed delivery form for "${a.asset_code || a.brand_model || 'untitled'}"`);

  const safe = String(a.asset_code || a.brand_model || a.id).replace(/[^\w.-]+/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Delivery-Form-${safe}.xlsx"`);
  res.send(buf);
}));

// ── GET /api/assets/:id — single asset ───────────────────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Asset not found' });
  const scope = scopeOf(req);
  if (scope && row.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  // Flag if this asset's model is delete/edit-locked (freezes Asset Type / Brand-Model / Serial).
  const lockedModels = await getLockedModels();
  row.model_locked = row.brand_model && lockedModels.some(m => m.toLowerCase() === String(row.brand_model).toLowerCase()) ? 1 : 0;
  res.json(row);
}));

// Resolve the country to store for a create/update, honouring the user's scope.
function resolveCountry(req, requested) {
  const scope = scopeOf(req);
  if (scope) return scope;                                   // scoped users can only use their own
  if (requested && VALID_COUNTRIES.includes(requested)) return requested;
  return 'Vietnam';                                          // sensible default for global users
}

// ── POST /api/assets — create (admin/editor only) ─────────────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const {
    location = '', country = '', department = '', computer_no = '', brand_model = '',
    date_assigned = '', serial_no = '', mk = '', asset_code = '',
    user_name = '', ad_name = '', history_usage = '', remark = '',
    status = 'Active',
    purchase_date = '', warranty_expiry = '', vendor = '', cost = '', po_number = '',
    cost_center = '', ecc_cc = '', asset_s4 = '', asset_description = '', cost_center_desc = '',
    asset_type = ''
  } = req.body;

  const finalCountry = resolveCountry(req, country);

  // Record creation in the history log so the new asset shows up as a pending SAP update.
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const createLine = `${ts} UTC: created by ${req.user.username}`;
  const hist = history_usage ? `${history_usage}\n${createLine}` : createLine;

  const result = await run(`
    INSERT INTO assets
      (location, country, department, computer_no, brand_model, date_assigned,
       serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status,
       purchase_date, warranty_expiry, vendor, cost, po_number, sap_confirmed,
       cost_center, ecc_cc, asset_s4, asset_description, cost_center_desc, asset_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [location, finalCountry, department, computer_no, brand_model, date_assigned,
     serial_no, mk, asset_code, user_name, ad_name, hist, remark, status,
     purchase_date, warranty_expiry, vendor, cost, po_number,
     cost_center, ecc_cc, asset_s4, asset_description, cost_center_desc, normalizeAssetType(asset_type)]);

  const created = await get('SELECT * FROM assets WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'CREATE', created.id, `Created asset "${created.asset_code || created.brand_model || 'untitled'}" (${finalCountry})`);
  res.status(201).json(created);
}));

// ── POST /api/assets/import — re-upload the edited Asset Inventory report ──────
// IT members upload the .xlsx exported from /api/reports/assets.xlsx (as base64).
// Rows with an ID update that asset; rows without an ID are inserted. History
// Usage and the Locked flag are preserved (never overwritten). Rows missing from
// the file are NOT deleted (use the Recycle Bin to remove assets).
const WRITABLE_COLS = ASSET_COLUMNS.filter(c => c.writable);
router.post('/import', requireITAdmin, wrap(async (req, res) => {
  const b64 = req.body && req.body.xlsx_base64;
  if (!b64) return res.status(400).json({ error: 'No file provided' });

  let rows;
  try {
    const buf = Buffer.from(b64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch (e) { return res.status(400).json({ error: 'Could not read the Excel file' }); }

  const scope = scopeOf(req);
  let updated = 0, inserted = 0, skipped = 0;

  for (const row of rows) {
    // Build a case/space-tolerant header → value lookup so minor header edits
    // (e.g. "Asset type" vs "Asset Type") still map correctly.
    const byHeader = {};
    for (const k of Object.keys(row)) byHeader[k.trim().toLowerCase()] = row[k];
    const idRawCell = byHeader['id'];

    // Pull the writable fields from their column headers.
    const data = {};
    for (const c of WRITABLE_COLS) {
      const key = c.header.trim().toLowerCase();
      if (key in byHeader) data[c.field] = String(byHeader[key] == null ? '' : byHeader[key]).trim();
    }
    if (data.asset_type !== undefined) data.asset_type = normalizeAssetType(data.asset_type);
    // Country: scoped users are locked to their region; otherwise validate.
    let country = scope || data.country;
    if (!VALID_COUNTRIES.includes(country)) country = scope || 'Vietnam';
    data.country = country;

    const idRaw = idRawCell;
    const id = (idRaw === '' || idRaw == null) ? null : Number(idRaw);

    if (id && Number.isFinite(id)) {
      const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!existing) { skipped++; continue; }
      if (scope && existing.country !== scope) { skipped++; continue; }   // outside region
      // status must stay valid; blank/invalid keeps the existing value.
      const status = ['Active', 'Broken', 'Stock'].includes(data.status) ? data.status : existing.status;
      const fields = WRITABLE_COLS.map(c => c.field);
      const vals = fields.map(f => (f === 'status' ? status : (data[f] !== undefined ? data[f] : existing[f])));
      await run(`UPDATE assets SET ${fields.map(f => f + ' = ?').join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        [...vals, id]);
      updated++;
    } else {
      // New row — require at least one non-empty value to avoid blank inserts.
      if (!WRITABLE_COLS.some(c => data[c.field])) { skipped++; continue; }
      if (!['Active', 'Broken', 'Stock'].includes(data.status)) data.status = 'Active';
      const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const hist = `${ts} UTC: created via report import by ${req.user.username}`;
      const fields = WRITABLE_COLS.map(c => c.field);
      const cols = [...fields, 'history_usage'];
      const vals = [...fields.map(f => data[f] || ''), hist];
      await run(`INSERT INTO assets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      inserted++;
    }
  }

  await audit(req.user, 'IMPORT', null, `Imported Asset Inventory report: ${updated} updated, ${inserted} inserted, ${skipped} skipped`);
  res.json({ updated, inserted, skipped, total: rows.length });
}));

// ── PUT /api/assets/:id — update (admin/editor only) ──────────────────────────
router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Asset not found' });

  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  const {
    location, country, department, computer_no, brand_model, date_assigned,
    serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status,
    purchase_date, warranty_expiry, vendor, cost, po_number,
    cost_center, ecc_cc, asset_s4, asset_description, cost_center_desc, asset_type
  } = req.body;

  // Scoped users can't move an asset out of their country.
  const finalCountry = scope ? scope : resolveCountry(req, country !== undefined ? country : existing.country);

  // ── Edit audit trail baked into history_usage ──────────────────────────────
  // Compare tracked fields and append a timestamped change line. The history
  // log itself is protected: only admins may edit it directly; an editor's
  // submitted history_usage is ignored (we keep the stored one and append).
  // Only the owner account may edit the history log directly; everyone else's
  // submitted history_usage is ignored (the stored log is preserved + appended).
  const canEditHistory = req.user.username === HISTORY_OWNER;
  const TRACK = {
    location: 'Location', country: 'Country', department: 'Department', computer_no: 'Computer No',
    brand_model: 'Brand/Model', date_assigned: 'Date Assigned', serial_no: 'Serial', mk: 'M&K',
    asset_code: 'Asset Code', user_name: 'User', ad_name: 'AD Name', status: 'Status', remark: 'Remark',
    purchase_date: 'Purchase Date', warranty_expiry: 'Warranty', vendor: 'Vendor', cost: 'Cost', po_number: 'PO Number',
    cost_center: 'Cost Center', ecc_cc: 'ECC CC', asset_s4: 'Asset S4', asset_description: 'Asset Description', cost_center_desc: 'Cost Center Desc',
    asset_type: 'Asset Type',
  };
  const incoming = { location, country: finalCountry, department, computer_no, brand_model, date_assigned,
    serial_no, mk, asset_code, user_name, ad_name, status, remark, purchase_date, warranty_expiry, vendor, cost, po_number,
    cost_center, ecc_cc, asset_s4, asset_description, cost_center_desc,
    asset_type: asset_type !== undefined ? normalizeAssetType(asset_type) : undefined };
  const norm = (v) => String(v == null ? '' : v).trim();
  const changes = [];
  for (const [k, lbl] of Object.entries(TRACK)) {
    if (incoming[k] === undefined) continue;              // field not submitted → unchanged
    const before = norm(existing[k]); const after = norm(incoming[k]);
    if (before !== after) changes.push(`${lbl}: "${before || '∅'}"→"${after || '∅'}"`);
  }
  // ── Model lock — if this asset's model is locked, NO user (incl. IT admin)
  // may change its Asset Type, Brand/Model or Serial. Unlock the model first.
  if (existing.brand_model) {
    const lockedModels = await getLockedModels();
    if (lockedModels.some(m => m.toLowerCase() === String(existing.brand_model).toLowerCase())) {
      const frozen = { asset_type: 'Asset Type', brand_model: 'Brand/Model', serial_no: 'Serial' };
      const changedFrozen = Object.keys(frozen).filter(k => incoming[k] !== undefined && norm(existing[k]) !== norm(incoming[k]));
      if (changedFrozen.length) {
        return res.status(403).json({ error: `Model "${existing.brand_model}" is locked — Asset Type, Brand/Model and Serial can't be changed. An IT admin must unlock it (Dashboard → Top Models) first.` });
      }
    }
  }

  // ── Protected-field lock (Serial / Brand-Model / Asset Code) ───────────────
  const protectedChanged = Object.keys(PROTECTED_FIELDS).filter(
    (k) => incoming[k] !== undefined && norm(existing[k]) !== norm(incoming[k]));
  if (protectedChanged.length) {
    if (existing.fields_locked) {
      return res.status(403).json({ error: 'Serial, Brand/Model and Asset Code are locked. An IT admin must unlock this record first.' });
    }
    if (req.user.team !== 'IT') {
      return res.status(403).json({ error: 'Only IT members can edit Serial, Brand/Model or Asset Code.' });
    }
  }

  // ── Holder lock (User Name / AD Name) ──────────────────────────────────────
  // A reassignment locks the record; while locked those fields can't change
  // until an IT admin unlocks it (via the History Usage button).
  // Only a real reassignment locks: the field had a value and it changed.
  // (Filling a blank holder for the first time does not lock.)
  const holderChanged = Object.keys(HOLDER_FIELDS).filter(
    (k) => incoming[k] !== undefined && norm(existing[k]) !== '' && norm(existing[k]) !== norm(incoming[k]));
  if (holderChanged.length && existing.user_locked) {
    return res.status(403).json({ error: 'User Name / AD Name are locked (holder change). An IT admin must unlock this record first via 🕓 History Usage.' });
  }

  let newHistory = (canEditHistory && history_usage !== undefined) ? history_usage : existing.history_usage;
  if (changes.length) {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `${ts} UTC: edited ${changes.join('; ')} by ${req.user.username}`;
    newHistory = newHistory ? `${newHistory}\n${line}` : line;
  }

  // Changing User Name / AD Name locks the record and records the action.
  let userLockNow = existing.user_locked;
  if (holderChanged.length) {
    userLockNow = 1;
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const lockLine = `${ts} UTC: 🔒 locked — ${holderChanged.map((k) => HOLDER_FIELDS[k]).join(' & ')} changed by ${req.user.username} (IT admin to unlock)`;
    newHistory = newHistory ? `${newHistory}\n${lockLine}` : lockLine;
  }

  // Editing a protected field locks the record and records the action.
  let lockNow = existing.fields_locked;
  if (protectedChanged.length) {
    lockNow = 1;
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const lockLine = `${ts} UTC: 🔒 locked ${protectedChanged.map((k) => PROTECTED_FIELDS[k]).join(', ')} after edit by ${req.user.username}`;
    newHistory = newHistory ? `${newHistory}\n${lockLine}` : lockLine;
  }

  // A real change means accounting must re-sync SAP → reset the confirmation flag.
  const sapConfirmed = changes.length ? 0 : existing.sap_confirmed;

  // For fields that may be absent from the request body, keep the existing value.
  const keep = (v, cur) => (v !== undefined ? v : cur);
  await run(`
    UPDATE assets SET
      location = ?, country = ?, department = ?, computer_no = ?, brand_model = ?,
      date_assigned = ?, serial_no = ?, mk = ?, asset_code = ?,
      user_name = ?, ad_name = ?, history_usage = ?, remark = ?, status = ?,
      purchase_date = ?, warranty_expiry = ?, vendor = ?, cost = ?, po_number = ?, sap_confirmed = ?, fields_locked = ?,
      cost_center = ?, ecc_cc = ?, asset_s4 = ?, asset_description = ?, cost_center_desc = ?, asset_type = ?, user_locked = ?
    WHERE id = ? AND deleted_at IS NULL`,
    [location, finalCountry, department, computer_no, brand_model, date_assigned,
     serial_no, mk, asset_code, user_name, ad_name, newHistory, remark, status,
     purchase_date, warranty_expiry, vendor, cost, po_number, sapConfirmed, lockNow,
     keep(cost_center, existing.cost_center), keep(ecc_cc, existing.ecc_cc), keep(asset_s4, existing.asset_s4),
     keep(asset_description, existing.asset_description), keep(cost_center_desc, existing.cost_center_desc),
     keep(incoming.asset_type, existing.asset_type), userLockNow,
     req.params.id]);

  const updated = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  await audit(req.user, 'UPDATE', updated.id, `Updated asset "${updated.asset_code || updated.brand_model || 'untitled'}"`);
  res.json(updated);
}));

// ── DELETE /api/assets/:id — SOFT delete (admin/editor only) ──────────────────
router.delete('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Asset not found' });

  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  // A locked model can't be deleted by anyone (incl. IT admin). To delete, an
  // IT admin must first uncheck the lock in Dashboard → Top Models.
  if (existing.brand_model) {
    const locked = await getLockedModels();
    if (locked.some(m => m.toLowerCase() === String(existing.brand_model).toLowerCase())) {
      const who = isITAdmin(req.user)
        ? 'Uncheck its 🔒 lock in Dashboard → Top Models first.'
        : 'Ask an IT admin to unlock it first.';
      return res.status(403).json({ error: `Model "${existing.brand_model}" is locked from deletion. ${who} You can still edit it.` });
    }
  }

  await run("UPDATE assets SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?",
            [req.user.username, req.params.id]);

  const label = existing.asset_code || existing.brand_model || 'untitled';
  await audit(req.user, 'DELETE', Number(req.params.id), `Deleted asset "${label}"`);
  await notify({ audience: 'all', country: existing.country, scope: 'asset', level: 'warning',
    message: `${req.user.full_name} moved asset "${label}" [${existing.country}] to the recycle bin.` });
  res.json({ message: 'Moved to recycle bin' });
}));

// ── POST /api/assets/:id/restore — restore from recycle bin (admin only) ──────
router.post('/:id/restore', requireRole('admin'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NOT NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Deleted asset not found' });

  // Regional admins can only restore assets in their own country.
  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  await run('UPDATE assets SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', [req.params.id]);

  const rlabel = existing.asset_code || existing.brand_model || 'untitled';
  await audit(req.user, 'RESTORE', Number(req.params.id), `Restored asset "${rlabel}" (deleted by ${existing.deleted_by})`);
  await notify({ audience: 'all', country: existing.country, scope: 'asset', level: 'info',
    message: `${req.user.full_name} restored asset "${rlabel}" [${existing.country}] from the recycle bin.` });
  res.json({ message: 'Asset restored' });
}));

// ── DELETE /api/assets/:id/purge — permanently delete from recycle bin ────────
// IT admin (global admin) only. Removes a soft-deleted asset for good.
router.delete('/:id/purge', requireGlobalAdmin, wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NOT NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Deleted asset not found' });
  await run('DELETE FROM assets WHERE id = ?', [req.params.id]);
  const label = existing.asset_code || existing.brand_model || 'untitled';
  await audit(req.user, 'PURGE', Number(req.params.id), `Permanently deleted asset "${label}"`);
  await notify({ audience: 'all', country: existing.country, scope: 'asset', level: 'warning',
    message: `${req.user.full_name} permanently deleted asset "${label}" [${existing.country}].` });
  res.json({ message: 'Permanently deleted' });
}));

module.exports = router;
