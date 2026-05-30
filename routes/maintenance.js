const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const TYPES    = ['repair', 'service', 'upgrade'];
const STATUSES = ['open', 'in_progress', 'done'];
const KINDS    = ['asset', 'server'];

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

// Fetch the linked record (asset or server) and a short label for messages.
async function source(kind, id) {
  if (kind === 'server') {
    const s = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [id]);
    return s && { row: s, label: s.asset_code || s.hostname || s.brand_model || `#${s.id}`, country: s.country };
  }
  const a = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [id]);
  return a && { row: a, label: a.asset_code || a.brand_model || `#${a.id}`, country: a.country };
}

// ── GET /api/maintenance — list repairs across assets AND servers ─────────────
router.get('/', wrap(async (req, res) => {
  const { status = '', asset_type = '' } = req.query;
  const cond = ['1=1']; const params = [];

  const scope = scopeOf(req);
  if (scope)                 { cond.push('m.country = ?'); params.push(scope); }
  else if (req.query.country){ cond.push('m.country = ?'); params.push(req.query.country); }

  if (status)     { cond.push('m.status = ?');     params.push(status); }
  if (asset_type) { cond.push('m.asset_type = ?'); params.push(asset_type); }

  const rows = await all(
    `SELECT m.*,
            a.asset_code AS a_code, a.brand_model AS a_model, a.location AS a_loc,
            s.asset_code AS s_code, s.hostname AS s_host, s.brand_model AS s_model, s.location AS s_loc
       FROM maintenance_log m
       LEFT JOIN assets  a ON m.asset_type = 'asset'  AND a.id = m.asset_id
       LEFT JOIN servers s ON m.asset_type = 'server' AND s.id = m.asset_id
      WHERE ${cond.join(' AND ')}
      ORDER BY (m.status = 'done') ASC, m.reported_at DESC`,
    params);

  res.json(rows.map(m => ({
    ...m,
    item_label: m.asset_type === 'server' ? (m.s_code || m.s_host || m.s_model) : (m.a_code || m.a_model),
    item_sub:   m.asset_type === 'server' ? (m.s_host && m.s_model ? m.s_model : '') : '',
    location:   m.asset_type === 'server' ? m.s_loc : m.a_loc,
  })));
}));

// ── GET /api/maintenance/by/:type/:id — history for one asset/server ──────────
router.get('/by/:type/:id', wrap(async (req, res) => {
  const type = KINDS.includes(req.params.type) ? req.params.type : 'asset';
  const rows = await all(
    'SELECT * FROM maintenance_log WHERE asset_type = ? AND asset_id = ? ORDER BY reported_at DESC',
    [type, req.params.id]);
  res.json(rows);
}));

// ── POST /api/maintenance — log a repair on an asset or server (admin/editor) ─
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const { asset_id, asset_type = 'asset', type = 'repair', description = '',
          vendor = '', cost = '', status = 'open' } = req.body;

  if (!KINDS.includes(asset_type))   return res.status(400).json({ error: 'Invalid item type' });
  const src = await source(asset_type, asset_id);
  if (!src) return res.status(404).json({ error: 'Item not found' });

  const scope = scopeOf(req);
  if (scope && src.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  if (!TYPES.includes(type))      return res.status(400).json({ error: 'Invalid type' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (!description.trim())        return res.status(400).json({ error: 'Description is required' });

  const resolved = status === 'done' ? "datetime('now')" : 'NULL';
  const result = await run(
    `INSERT INTO maintenance_log
       (asset_id, asset_type, country, type, description, vendor, cost, status, reported_by, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${resolved})`,
    [asset_id, asset_type, src.country, type, description.trim(), vendor, cost, status, req.user.username]);

  const created = await get('SELECT * FROM maintenance_log WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'MAINTENANCE', Number(asset_id),
    `Logged ${type} on ${asset_type} "${src.label}": ${description.trim()}`);
  await notify({ audience: 'all', country: src.country, scope: 'asset', level: 'info',
    message: `${req.user.full_name} logged a ${type} for ${asset_type} "${src.label}" [${src.country}].` });
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
