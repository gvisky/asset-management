const express = require('express');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

// Every asset route requires a logged-in user.
router.use(requireAuth);

// Small wrapper so async handler errors become 500s instead of hanging.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── GET /api/assets — list (excludes soft-deleted) with search & filter ───────
router.get('/', wrap(async (req, res) => {
  const { search = '', status = '', location = '', page = 1, limit = 50 } = req.query;

  const conditions = ['deleted_at IS NULL'];
  const params = [];

  if (search) {
    conditions.push(`(
      department   LIKE ? OR computer_no  LIKE ? OR brand_model LIKE ? OR
      serial_no    LIKE ? OR asset_code   LIKE ? OR user_name   LIKE ? OR
      ad_name      LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status)   { conditions.push('status = ?');   params.push(status); }
  if (location) { conditions.push('location = ?'); params.push(location); }

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
  const live = 'WHERE deleted_at IS NULL';

  const total = Number((await get(`SELECT COUNT(*) as cnt FROM assets ${live}`)).cnt);

  const byStatus = (await all(`SELECT status, COUNT(*) as cnt FROM assets ${live} GROUP BY status`))
    .reduce((acc, r) => { acc[r.status] = Number(r.cnt); return acc; }, {});

  const byLocation = (await all(`SELECT location, COUNT(*) as cnt FROM assets ${live} GROUP BY location`))
    .reduce((acc, r) => { acc[r.location] = Number(r.cnt); return acc; }, {});

  const byBrand = await all(
    `SELECT brand_model, COUNT(*) as cnt FROM assets ${live} GROUP BY brand_model ORDER BY cnt DESC LIMIT 8`
  );

  const recentlyAdded = await all(`SELECT * FROM assets ${live} ORDER BY id DESC LIMIT 5`);
  const deletedCount = Number((await get('SELECT COUNT(*) as cnt FROM assets WHERE deleted_at IS NOT NULL')).cnt);

  res.json({ total, byStatus, byLocation, byBrand, recentlyAdded, deletedCount });
}));

// ── GET /api/assets/deleted — recycle bin (admin only) ────────────────────────
router.get('/deleted', requireRole('admin'), wrap(async (req, res) => {
  const rows = await all('SELECT * FROM assets WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  res.json(rows);
}));

// ── GET /api/assets/:id — single asset ───────────────────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Asset not found' });
  res.json(row);
}));

// ── POST /api/assets — create (admin/editor only) ─────────────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const {
    location = '', department = '', computer_no = '', brand_model = '',
    date_assigned = '', serial_no = '', mk = '', asset_code = '',
    user_name = '', ad_name = '', history_usage = '', remark = '',
    status = 'Active'
  } = req.body;

  const result = await run(`
    INSERT INTO assets
      (location, department, computer_no, brand_model, date_assigned,
       serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [location, department, computer_no, brand_model, date_assigned,
     serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status]);

  const created = await get('SELECT * FROM assets WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'CREATE', created.id, `Created asset "${created.asset_code || created.brand_model || 'untitled'}"`);
  res.status(201).json(created);
}));

// ── PUT /api/assets/:id — update (admin/editor only) ──────────────────────────
router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const {
    location, department, computer_no, brand_model, date_assigned,
    serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status
  } = req.body;

  const result = await run(`
    UPDATE assets SET
      location = ?, department = ?, computer_no = ?, brand_model = ?,
      date_assigned = ?, serial_no = ?, mk = ?, asset_code = ?,
      user_name = ?, ad_name = ?, history_usage = ?, remark = ?, status = ?
    WHERE id = ? AND deleted_at IS NULL`,
    [location, department, computer_no, brand_model, date_assigned,
     serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status,
     req.params.id]);

  if (result.changes === 0) return res.status(404).json({ error: 'Asset not found' });
  const updated = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  await audit(req.user, 'UPDATE', updated.id, `Updated asset "${updated.asset_code || updated.brand_model || 'untitled'}"`);
  res.json(updated);
}));

// ── DELETE /api/assets/:id — SOFT delete (admin/editor only) ──────────────────
router.delete('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Asset not found' });

  await run("UPDATE assets SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?",
            [req.user.username, req.params.id]);

  await audit(req.user, 'DELETE', Number(req.params.id),
              `Deleted asset "${existing.asset_code || existing.brand_model || 'untitled'}"`);
  res.json({ message: 'Moved to recycle bin' });
}));

// ── POST /api/assets/:id/restore — restore from recycle bin (admin only) ──────
router.post('/:id/restore', requireRole('admin'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NOT NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Deleted asset not found' });

  await run('UPDATE assets SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', [req.params.id]);

  await audit(req.user, 'RESTORE', Number(req.params.id),
              `Restored asset "${existing.asset_code || existing.brand_model || 'untitled'}" (deleted by ${existing.deleted_by})`);
  res.json({ message: 'Asset restored' });
}));

module.exports = router;
