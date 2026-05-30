const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALID_COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
const HISTORY_OWNER = process.env.HISTORY_OWNER || 'viet';

router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) {
    return res.status(403).json({ error: 'No access to Asset Inventory' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;

function countryFilter(req) {
  const scope = scopeOf(req);
  if (scope) return { clause: 'country = ?', params: [scope] };
  if (req.query.country) return { clause: 'country = ?', params: [req.query.country] };
  return { clause: null, params: [] };
}

// ── GET /api/servers — list ───────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const { search = '', status = '', location = '', role = '', page = 1, limit = 50 } = req.query;
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  const cf = countryFilter(req);
  if (cf.clause) { conditions.push(cf.clause); params.push(...cf.params); }

  if (search) {
    conditions.push(`(hostname LIKE ? OR brand_model LIKE ? OR serial_no LIKE ? OR
      asset_code LIKE ? OR ip_address LIKE ? OR os LIKE ? OR role LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status)   { conditions.push('status = ?');   params.push(status); }
  if (location) { conditions.push('location = ?'); params.push(location); }
  if (role)     { conditions.push('role = ?');     params.push(role); }

  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);
  const totalRow = await get(`SELECT COUNT(*) as cnt FROM servers ${where}`, params);
  const rows = await all(`SELECT * FROM servers ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]);
  res.json({ total: Number(totalRow.cnt), page: Number(page), limit: Number(limit), data: rows });
}));

// ── GET /api/servers/stats ─────────────────────────────────────────────────────
router.get('/stats', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const live = ['deleted_at IS NULL']; const lp = [];
  if (cf.clause) { live.push(cf.clause); lp.push(...cf.params); }
  const where = 'WHERE ' + live.join(' AND ');
  const total = Number((await get(`SELECT COUNT(*) as cnt FROM servers ${where}`, lp)).cnt);
  const byStatus = (await all(`SELECT status, COUNT(*) as cnt FROM servers ${where} GROUP BY status`, lp))
    .reduce((a, r) => { a[r.status] = Number(r.cnt); return a; }, {});
  const warCond = [...live, "warranty_expiry <> ''", "date(warranty_expiry) <= date('now','+90 days')"];
  const warrantyExpiring = Number((await get(`SELECT COUNT(*) as cnt FROM servers WHERE ${warCond.join(' AND ')}`, lp)).cnt);
  res.json({ total, byStatus, warrantyExpiring, scope: scopeOf(req) });
}));

// ── GET /api/servers/filters ────────────────────────────────────────────────────
router.get('/filters', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const extra = cf.clause ? ` AND ${cf.clause}` : '';
  const roles = (await all(`SELECT DISTINCT role AS v FROM servers WHERE deleted_at IS NULL AND role <> ''${extra} ORDER BY role COLLATE NOCASE`, cf.params)).map(r => r.v);
  const countries = scopeOf(req) ? [scopeOf(req)] : VALID_COUNTRIES;
  res.json({ roles, countries });
}));

// ── GET /api/servers/:id ─────────────────────────────────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Server not found' });
  const scope = scopeOf(req);
  if (scope && row.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  res.json(row);
}));

function resolveCountry(req, requested) {
  const scope = scopeOf(req);
  if (scope) return scope;
  if (requested && VALID_COUNTRIES.includes(requested)) return requested;
  return 'Vietnam';
}

const FIELDS = ['location', 'hostname', 'brand_model', 'serial_no', 'asset_code', 'ip_address',
  'os', 'cpu', 'ram', 'storage', 'role', 'status', 'purchase_date', 'warranty_expiry',
  'vendor', 'cost', 'po_number', 'remark'];

// ── POST /api/servers — create (admin/editor) ─────────────────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const v = {};
  FIELDS.forEach(f => v[f] = req.body[f] != null ? req.body[f] : '');
  if (!v.status) v.status = 'Active';
  const finalCountry = resolveCountry(req, req.body.country);
  const history_usage = req.body.history_usage || '';

  const cols = ['country', ...FIELDS, 'history_usage'];
  const vals = [finalCountry, ...FIELDS.map(f => v[f]), history_usage];
  const result = await run(
    `INSERT INTO servers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  const created = await get('SELECT * FROM servers WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'CREATE', created.id, `Created server "${created.hostname || created.asset_code || 'untitled'}" (${finalCountry})`);
  res.status(201).json(created);
}));

// ── PUT /api/servers/:id — update (admin/editor); history is owner-only ───────
router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });
  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  const finalCountry = scope ? scope : resolveCountry(req, req.body.country !== undefined ? req.body.country : existing.country);
  const incoming = { country: finalCountry };
  FIELDS.forEach(f => { if (req.body[f] !== undefined) incoming[f] = req.body[f]; });

  // Edit log baked into history_usage (owner-only direct edit).
  const LABELS = { location: 'Location', country: 'Country', hostname: 'Hostname', brand_model: 'Brand/Model',
    serial_no: 'Serial', asset_code: 'Asset Code', ip_address: 'IP', os: 'OS', cpu: 'CPU', ram: 'RAM',
    storage: 'Storage', role: 'Role', status: 'Status', purchase_date: 'Purchase Date',
    warranty_expiry: 'Warranty', vendor: 'Vendor', cost: 'Cost', po_number: 'PO Number', remark: 'Remark' };
  const norm = (x) => String(x == null ? '' : x).trim();
  const changes = [];
  for (const [k, lbl] of Object.entries(LABELS)) {
    if (incoming[k] === undefined) continue;
    if (norm(existing[k]) !== norm(incoming[k])) changes.push(`${lbl}: "${norm(existing[k]) || '∅'}"→"${norm(incoming[k]) || '∅'}"`);
  }
  const canEditHistory = req.user.username === HISTORY_OWNER;
  let newHistory = (canEditHistory && req.body.history_usage !== undefined) ? req.body.history_usage : existing.history_usage;
  if (changes.length) {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `${ts} UTC: edited ${changes.join('; ')} by ${req.user.username}`;
    newHistory = newHistory ? `${newHistory}\n${line}` : line;
  }

  const setFields = ['country', ...FIELDS, 'history_usage'];
  const setVals = [finalCountry, ...FIELDS.map(f => (req.body[f] !== undefined ? req.body[f] : existing[f])), newHistory];
  await run(
    `UPDATE servers SET ${setFields.map(c => c + ' = ?').join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    [...setVals, req.params.id]);
  const updated = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  await audit(req.user, 'UPDATE', updated.id, `Updated server "${updated.hostname || updated.asset_code || 'untitled'}"`);
  res.json(updated);
}));

// ── DELETE /api/servers/:id — soft delete (admin/editor) ──────────────────────
router.delete('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });
  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  await run("UPDATE servers SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?", [req.user.username, req.params.id]);
  const label = existing.hostname || existing.asset_code || 'untitled';
  await audit(req.user, 'DELETE', Number(req.params.id), `Deleted server "${label}"`);
  await notify({ audience: 'all', country: existing.country, scope: 'asset', level: 'warning',
    message: `${req.user.full_name} deleted server "${label}" [${existing.country}].` });
  res.json({ message: 'Deleted' });
}));

module.exports = router;
