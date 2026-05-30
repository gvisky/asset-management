const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) {
    return res.status(403).json({ error: 'No access to Asset Inventory' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;
const label = (a) => a && (a.asset_code || a.brand_model || `#${a.id}`) || 'asset';

// ── GET /api/assignments — list (filter by status / asset / country) ──────────
router.get('/', wrap(async (req, res) => {
  const { status = '', asset_id = '' } = req.query;
  const cond = ['1=1']; const params = [];
  const scope = scopeOf(req);
  if (scope)                  { cond.push('asg.country = ?'); params.push(scope); }
  else if (req.query.country) { cond.push('asg.country = ?'); params.push(req.query.country); }
  if (status)   { cond.push('asg.status = ?');   params.push(status); }
  if (asset_id) { cond.push('asg.asset_id = ?'); params.push(asset_id); }

  const rows = await all(
    `SELECT asg.*, a.asset_code, a.brand_model, a.location
       FROM asset_assignments asg
       LEFT JOIN assets a ON a.id = asg.asset_id
      WHERE ${cond.join(' AND ')}
      ORDER BY (asg.status = 'returned') ASC, asg.assigned_at DESC`,
    params);
  res.json(rows);
}));

// ── GET /api/assignments/reclaim — gear still held by leaving personnel ────────
router.get('/reclaim', wrap(async (req, res) => {
  const scope = scopeOf(req);
  const cond = ["p.leaving_date <> ''", 'a.deleted_at IS NULL'];
  const params = [];
  if (scope) { cond.push('p.country = ?', 'a.country = ?'); params.push(scope, scope); }
  else if (req.query.country) { cond.push('p.country = ?', 'a.country = ?'); params.push(req.query.country, req.query.country); }

  const rows = await all(
    `SELECT a.id AS asset_id, a.asset_code, a.brand_model, a.location, a.country,
            a.user_name, a.ad_name, a.status,
            p.display_name AS person, p.email, p.leaving_date, p.status AS person_status
       FROM personnel p
       JOIN assets a
         ON a.user_name = p.display_name COLLATE NOCASE
         OR a.ad_name   = p.display_name COLLATE NOCASE
      WHERE ${cond.join(' AND ')}
      ORDER BY p.leaving_date ASC, a.id ASC`,
    params);
  res.json(rows);
}));

// ── GET /api/assignments/asset/:assetId — handover history for one asset ──────
router.get('/asset/:assetId', wrap(async (req, res) => {
  const rows = await all(
    'SELECT * FROM asset_assignments WHERE asset_id = ? ORDER BY assigned_at DESC',
    [req.params.assetId]);
  res.json(rows);
}));

// ── POST /api/assignments — check out an asset to a person (admin/editor) ─────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const { asset_id, assignee_name = '', assignee_email = '', assignee_ad = '',
          location = '', due_return_at = '', condition_out = '', handover_note = '' } = req.body;

  const asset = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [asset_id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  const scope = scopeOf(req);
  if (scope && asset.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  if (!assignee_name.trim()) return res.status(400).json({ error: 'Assignee name is required' });

  // Default to the asset's current location if none was supplied.
  const loc = (location || asset.location || '').trim();

  // Close any still-open assignment for this asset first (single active holder).
  await run("UPDATE asset_assignments SET status = 'returned', returned_at = datetime('now'), returned_by = ? WHERE asset_id = ? AND status = 'assigned'",
    [req.user.username, asset_id]);

  const result = await run(
    `INSERT INTO asset_assignments
       (asset_id, country, location, assignee_name, assignee_email, assignee_ad, assigned_by,
        due_return_at, condition_out, handover_note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned')`,
    [asset_id, asset.country, loc, assignee_name.trim(), assignee_email.trim(), assignee_ad.trim(),
     req.user.username, due_return_at, condition_out, handover_note]);

  // Reflect the current holder AND location on the asset, and append the
  // handover to the asset's usage history (merging the two views).
  const today = new Date().toISOString().slice(0, 10);
  const usageLine = `${today}: → ${assignee_name.trim()}${loc ? ' @ ' + loc : ''}`;
  const newHistory = asset.history_usage ? `${asset.history_usage}\n${usageLine}` : usageLine;
  await run("UPDATE assets SET user_name = ?, ad_name = ?, location = ?, history_usage = ?, date_assigned = date('now'), status = 'Active' WHERE id = ?",
    [assignee_name.trim(), assignee_ad.trim() || asset.ad_name, loc || asset.location, newHistory, asset_id]);

  const created = await get('SELECT * FROM asset_assignments WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'ASSIGN', Number(asset_id), `Assigned "${label(asset)}" to ${assignee_name.trim()}${loc ? ' @ ' + loc : ''}`);
  await notify({ audience: 'all', country: asset.country, scope: 'asset', level: 'info',
    message: `${req.user.full_name} assigned "${label(asset)}" [${asset.country}] to ${assignee_name.trim()}${loc ? ' @ ' + loc : ''}.` });
  res.status(201).json(created);
}));

// ── POST /api/assignments/:id/return — check an asset back in (admin/editor) ──
router.post('/:id/return', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const asg = await get('SELECT * FROM asset_assignments WHERE id = ?', [req.params.id]);
  if (!asg) return res.status(404).json({ error: 'Assignment not found' });
  const scope = scopeOf(req);
  if (scope && asg.country !== scope) return res.status(403).json({ error: 'Not in your region' });
  if (asg.status === 'returned') return res.status(400).json({ error: 'Already returned' });

  const { condition_in = '', to_stock = true } = req.body;
  await run("UPDATE asset_assignments SET status = 'returned', returned_at = datetime('now'), returned_by = ?, condition_in = ? WHERE id = ?",
    [req.user.username, condition_in, req.params.id]);

  // Clear the holder; optionally move the asset into Stock. Append the return
  // to the asset's usage history too.
  const asset = await get('SELECT * FROM assets WHERE id = ?', [asg.asset_id]);
  const newStatus = to_stock ? 'Stock' : null;
  const today = new Date().toISOString().slice(0, 10);
  const usageLine = `${today}: ↩ returned from ${asg.assignee_name}${newStatus ? ' (→ ' + newStatus + ')' : ''}`;
  const newHistory = asset && asset.history_usage ? `${asset.history_usage}\n${usageLine}` : usageLine;
  if (newStatus) {
    await run("UPDATE assets SET user_name = '', date_assigned = '', history_usage = ?, status = ? WHERE id = ?", [newHistory, newStatus, asg.asset_id]);
  } else {
    await run("UPDATE assets SET user_name = '', date_assigned = '', history_usage = ? WHERE id = ?", [newHistory, asg.asset_id]);
  }

  await audit(req.user, 'RETURN', asg.asset_id, `Checked in "${label(asset || {})}" from ${asg.assignee_name}`);
  res.json({ message: 'Checked in', assignment_id: Number(req.params.id) });
}));

module.exports = router;
