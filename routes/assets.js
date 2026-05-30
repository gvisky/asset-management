const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

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
          incomplete = '', page = 1, limit = 50 } = req.query;

  const conditions = ['deleted_at IS NULL'];
  const params = [];

  const cf = countryFilter(req);
  if (cf.clause) { conditions.push(cf.clause); params.push(...cf.params); }

  if (search) {
    conditions.push(`(
      department   LIKE ? OR computer_no  LIKE ? OR brand_model LIKE ? OR
      serial_no    LIKE ? OR asset_code   LIKE ? OR user_name   LIKE ? OR
      ad_name      LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status)     { conditions.push('status = ?');      params.push(status); }
  if (location)   { conditions.push('location = ?');    params.push(location); }
  if (brand)      { conditions.push('brand_model = ?'); params.push(brand); }
  if (department) { conditions.push('department = ?');  params.push(department); }
  if (incomplete) {
    conditions.push(`(
      serial_no   IS NULL OR serial_no   = '' OR
      asset_code  IS NULL OR asset_code  = '' OR
      computer_no IS NULL OR computer_no = ''
    )`);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);

  const totalRow = await get(`SELECT COUNT(*) as cnt FROM assets ${where}`, params);
  const rows = await all(
    `SELECT * FROM assets ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
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
      computer_no IS NULL OR computer_no = ''
    )`];
  const incompleteCount = Number((await get(`SELECT COUNT(*) as cnt FROM assets WHERE ${incCond.join(' AND ')}`, lp)).cnt);

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

// ── GET /api/assets/filters — distinct values for the filter dropdowns ────────
router.get('/filters', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const extra = cf.clause ? ` AND ${cf.clause}` : '';
  const brands = (await all(
    `SELECT DISTINCT brand_model AS v FROM assets WHERE deleted_at IS NULL AND brand_model <> ''${extra} ORDER BY brand_model COLLATE NOCASE`,
    cf.params
  )).map(r => r.v);
  const departments = (await all(
    `SELECT DISTINCT department AS v FROM assets WHERE deleted_at IS NULL AND department <> ''${extra} ORDER BY department COLLATE NOCASE`,
    cf.params
  )).map(r => r.v);
  // Global users get the full country list; scoped users get only their own.
  const countries = scopeOf(req) ? [scopeOf(req)] : VALID_COUNTRIES;
  res.json({ brands, departments, countries });
}));

// ── GET /api/assets/incomplete — assets missing key identifiers ───────────────
router.get('/incomplete', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const cond = ['deleted_at IS NULL', `(
      serial_no   IS NULL OR serial_no   = '' OR
      asset_code  IS NULL OR asset_code  = '' OR
      computer_no IS NULL OR computer_no = ''
    )`];
  if (cf.clause) cond.push(cf.clause);
  const rows = await all(
    `SELECT * FROM assets WHERE ${cond.join(' AND ')} ORDER BY country, location, id`, cf.params);
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

// ── GET /api/assets/:id — single asset ───────────────────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Asset not found' });
  const scope = scopeOf(req);
  if (scope && row.country !== scope) return res.status(403).json({ error: 'Not in your region' });
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
    purchase_date = '', warranty_expiry = '', vendor = '', cost = '', po_number = ''
  } = req.body;

  const finalCountry = resolveCountry(req, country);

  const result = await run(`
    INSERT INTO assets
      (location, country, department, computer_no, brand_model, date_assigned,
       serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status,
       purchase_date, warranty_expiry, vendor, cost, po_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [location, finalCountry, department, computer_no, brand_model, date_assigned,
     serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status,
     purchase_date, warranty_expiry, vendor, cost, po_number]);

  const created = await get('SELECT * FROM assets WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'CREATE', created.id, `Created asset "${created.asset_code || created.brand_model || 'untitled'}" (${finalCountry})`);
  res.status(201).json(created);
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
    purchase_date, warranty_expiry, vendor, cost, po_number
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
  };
  const incoming = { location, country: finalCountry, department, computer_no, brand_model, date_assigned,
    serial_no, mk, asset_code, user_name, ad_name, status, remark, purchase_date, warranty_expiry, vendor, cost, po_number };
  const norm = (v) => String(v == null ? '' : v).trim();
  const changes = [];
  for (const [k, lbl] of Object.entries(TRACK)) {
    if (incoming[k] === undefined) continue;              // field not submitted → unchanged
    const before = norm(existing[k]); const after = norm(incoming[k]);
    if (before !== after) changes.push(`${lbl}: "${before || '∅'}"→"${after || '∅'}"`);
  }
  let newHistory = (canEditHistory && history_usage !== undefined) ? history_usage : existing.history_usage;
  if (changes.length) {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `${ts} UTC: edited ${changes.join('; ')} by ${req.user.username}`;
    newHistory = newHistory ? `${newHistory}\n${line}` : line;
  }

  await run(`
    UPDATE assets SET
      location = ?, country = ?, department = ?, computer_no = ?, brand_model = ?,
      date_assigned = ?, serial_no = ?, mk = ?, asset_code = ?,
      user_name = ?, ad_name = ?, history_usage = ?, remark = ?, status = ?,
      purchase_date = ?, warranty_expiry = ?, vendor = ?, cost = ?, po_number = ?
    WHERE id = ? AND deleted_at IS NULL`,
    [location, finalCountry, department, computer_no, brand_model, date_assigned,
     serial_no, mk, asset_code, user_name, ad_name, newHistory, remark, status,
     purchase_date, warranty_expiry, vendor, cost, po_number,
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

module.exports = router;
