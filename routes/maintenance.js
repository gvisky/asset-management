const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const TYPES    = ['repair', 'service', 'upgrade'];
const STATUSES = ['open', 'in_progress', 'done'];

router.use(requireAuth);

// Same gate as assets: HR-only users have no Asset Inventory access.
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) {
    return res.status(403).json({ error: 'No access to Asset Inventory' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;

// Short asset label for audit/notification messages.
const assetLabel = (a) => a && (a.asset_code || a.brand_model || `#${a.id}`) || 'asset';

// ── GET /api/maintenance — list repairs (optionally by status/asset) ──────────
router.get('/', wrap(async (req, res) => {
  const { status = '', asset_id = '' } = req.query;
  const cond = ['1=1']; const params = [];

  const scope = scopeOf(req);
  if (scope)                 { cond.push('m.country = ?'); params.push(scope); }
  else if (req.query.country){ cond.push('m.country = ?'); params.push(req.query.country); }

  if (status)   { cond.push('m.status = ?');   params.push(status); }
  if (asset_id) { cond.push('m.asset_id = ?'); params.push(asset_id); }

  const rows = await all(
    `SELECT m.*, a.asset_code, a.brand_model, a.location
       FROM maintenance_log m
       LEFT JOIN assets a ON a.id = m.asset_id
      WHERE ${cond.join(' AND ')}
      ORDER BY (m.status = 'done') ASC, m.reported_at DESC`,
    params);
  res.json(rows);
}));

// ── GET /api/maintenance/asset/:assetId — history for one asset ───────────────
router.get('/asset/:assetId', wrap(async (req, res) => {
  const rows = await all(
    `SELECT * FROM maintenance_log WHERE asset_id = ? ORDER BY reported_at DESC`,
    [req.params.assetId]);
  res.json(rows);
}));

// ── POST /api/maintenance — log a repair (admin/editor) ───────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const { asset_id, type = 'repair', description = '', vendor = '', cost = '',
          status = 'open' } = req.body;

  const asset = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [asset_id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const scope = scopeOf(req);
  if (scope && asset.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  if (!TYPES.includes(type))       return res.status(400).json({ error: 'Invalid type' });
  if (!STATUSES.includes(status))  return res.status(400).json({ error: 'Invalid status' });
  if (!description.trim())         return res.status(400).json({ error: 'Description is required' });

  const resolved = status === 'done' ? "datetime('now')" : 'NULL';
  const result = await run(
    `INSERT INTO maintenance_log
       (asset_id, country, type, description, vendor, cost, status, reported_by, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${resolved})`,
    [asset_id, asset.country, type, description.trim(), vendor, cost, status, req.user.username]);

  const created = await get('SELECT * FROM maintenance_log WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'MAINTENANCE', Number(asset_id),
    `Logged ${type} on "${assetLabel(asset)}": ${description.trim()}`);
  await notify({ audience: 'all', country: asset.country, scope: 'asset', level: 'info',
    message: `${req.user.full_name} logged a ${type} for "${assetLabel(asset)}" [${asset.country}].` });
  res.status(201).json(created);
}));

// ── PUT /api/maintenance/:id — update status/details (admin/editor) ───────────
router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM maintenance_log WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Record not found' });

  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  const type        = req.body.type        ?? existing.type;
  const description = req.body.description ?? existing.description;
  const vendor      = req.body.vendor      ?? existing.vendor;
  const cost        = req.body.cost        ?? existing.cost;
  const status      = req.body.status      ?? existing.status;
  if (!TYPES.includes(type))      return res.status(400).json({ error: 'Invalid type' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  // Stamp/clear resolved_at as the record opens or closes.
  const resolvedSql = status === 'done'
    ? "resolved_at = COALESCE(resolved_at, datetime('now'))"
    : 'resolved_at = NULL';

  await run(
    `UPDATE maintenance_log
        SET type = ?, description = ?, vendor = ?, cost = ?, status = ?, ${resolvedSql}
      WHERE id = ?`,
    [type, description, vendor, cost, status, req.params.id]);

  const updated = await get('SELECT * FROM maintenance_log WHERE id = ?', [req.params.id]);
  await audit(req.user, 'MAINTENANCE', existing.asset_id, `Updated maintenance #${existing.id} -> ${status}`);
  res.json(updated);
}));

// ── DELETE /api/maintenance/:id — remove a record (admin only) ────────────────
router.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM maintenance_log WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  const scope = scopeOf(req);
  if (scope && existing.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  await run('DELETE FROM maintenance_log WHERE id = ?', [req.params.id]);
  await audit(req.user, 'MAINTENANCE', existing.asset_id, `Deleted maintenance #${existing.id}`);
  res.json({ message: 'Deleted' });
}));

module.exports = router;
