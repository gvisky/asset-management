const express = require('express');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALID_COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
const TYPES = ['subscription', 'perpetual'];

router.use(requireAuth);
// HR-only users (no Asset Inventory access) can't use license management either.
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) return res.status(403).json({ error: 'No access' });
  next();
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;

// Visibility: scoped users see Global + their own country; globals see all
// (optionally filtered by ?country=).
function visFilter(req) {
  const scope = scopeOf(req);
  if (scope) return { clause: "(country = 'Global' OR country = ?)", params: [scope] };
  if (req.query.country) return { clause: 'country = ?', params: [req.query.country] };
  return { clause: null, params: [] };
}

// A user may manage a license if global, or (scoped) only their own country's
// rows — never the shared Global ones.
function canManage(req, lic) {
  const scope = scopeOf(req);
  if (!scope) return true;
  return lic.country === scope;
}

const SEATS = `(SELECT COUNT(*) FROM license_assignments la WHERE la.license_id = l.id AND la.released_at IS NULL)`;
// Current seat holders (active assignments), comma-separated.
const USERS = `(SELECT GROUP_CONCAT(assignee_ref, ', ') FROM license_assignments la WHERE la.license_id = l.id AND la.released_at IS NULL)`;

// ── GET /api/licenses ─────────────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const vf = visFilter(req);
  const where = vf.clause ? `WHERE ${vf.clause}` : '';
  const rows = await all(
    `SELECT l.*, ${SEATS} AS seats_used, ${USERS} AS current_users FROM licenses l ${where} ORDER BY l.name COLLATE NOCASE`,
    vf.params);
  res.json(rows.map(r => ({ ...r, seats_used: Number(r.seats_used), current_users: r.current_users || '' })));
}));

// ── GET /api/licenses/stats — dashboard metrics ───────────────────────────────
router.get('/stats', wrap(async (req, res) => {
  const vf = visFilter(req);
  const base = vf.clause ? `WHERE ${vf.clause}` : '';
  const total = Number((await get(`SELECT COUNT(*) AS c FROM licenses l ${base}`, vf.params)).c);
  const expCond = (vf.clause ? [vf.clause] : []).concat(["renewal_date <> ''", "date(renewal_date) <= date('now','+30 days')"]);
  const expiring = Number((await get(
    `SELECT COUNT(*) AS c FROM licenses l WHERE ${expCond.join(' AND ')}`, vf.params)).c);
  res.json({ total, expiring });
}));

// ── GET /api/licenses/:id — license + active assignments ──────────────────────
router.get('/:id', wrap(async (req, res) => {
  const lic = await get(`SELECT l.*, ${SEATS} AS seats_used FROM licenses l WHERE l.id = ?`, [req.params.id]);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  const scope = scopeOf(req);
  if (scope && lic.country !== 'Global' && lic.country !== scope) {
    return res.status(403).json({ error: 'Not in your region' });
  }
  const assignments = await all(
    'SELECT * FROM license_assignments WHERE license_id = ? AND released_at IS NULL ORDER BY assigned_at DESC',
    [req.params.id]);
  res.json({ ...lic, seats_used: Number(lic.seats_used), assignments });
}));

// Resolve the country to store, honouring scope. Scoped users always store
// their own country; globals may pick a country or 'Global'.
function resolveCountry(req, requested) {
  const scope = scopeOf(req);
  if (scope) return scope;
  if (requested === 'Global' || VALID_COUNTRIES.includes(requested)) return requested;
  return 'Global';
}

// ── POST /api/licenses — create (admin/editor) ────────────────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const { name = '', vendor = '', type = 'subscription', total_seats = 0,
          license_key = '', notes = '', purchase_date = '', renewal_date = '',
          cost = '', country = 'Global', department = '' } = req.body;
  if (!name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const result = await run(
    `INSERT INTO licenses (name, vendor, type, total_seats, license_key, notes,
       purchase_date, renewal_date, cost, country, department)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name.trim(), vendor, type, Number(total_seats) || 0, license_key, notes,
     purchase_date, renewal_date, cost, resolveCountry(req, country), department]);
  const created = await get('SELECT * FROM licenses WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'LICENSE', null, `Created license "${created.name}"`);
  res.status(201).json(created);
}));

// ── PUT /api/licenses/:id — update (admin/editor) ─────────────────────────────
router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const lic = await get('SELECT * FROM licenses WHERE id = ?', [req.params.id]);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  if (!canManage(req, lic)) return res.status(403).json({ error: 'You cannot edit this license' });

  const b = req.body;
  const type = b.type ?? lic.type;
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const country = scopeOf(req) ? lic.country : resolveCountry(req, b.country ?? lic.country);

  await run(
    `UPDATE licenses SET name = ?, vendor = ?, type = ?, total_seats = ?, license_key = ?,
       notes = ?, purchase_date = ?, renewal_date = ?, cost = ?, country = ?, department = ? WHERE id = ?`,
    [(b.name ?? lic.name).trim() || lic.name, b.vendor ?? lic.vendor, type,
     Number(b.total_seats ?? lic.total_seats) || 0, b.license_key ?? lic.license_key,
     b.notes ?? lic.notes, b.purchase_date ?? lic.purchase_date, b.renewal_date ?? lic.renewal_date,
     b.cost ?? lic.cost, country, b.department ?? lic.department ?? '', req.params.id]);
  const updated = await get('SELECT * FROM licenses WHERE id = ?', [req.params.id]);
  await audit(req.user, 'LICENSE', null, `Updated license "${updated.name}"`);
  res.json(updated);
}));

// ── DELETE /api/licenses/:id — delete (admin) ─────────────────────────────────
router.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const lic = await get('SELECT * FROM licenses WHERE id = ?', [req.params.id]);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  if (!canManage(req, lic)) return res.status(403).json({ error: 'You cannot delete this license' });
  await run('DELETE FROM license_assignments WHERE license_id = ?', [req.params.id]);
  await run('DELETE FROM licenses WHERE id = ?', [req.params.id]);
  await audit(req.user, 'LICENSE', null, `Deleted license "${lic.name}"`);
  res.json({ message: 'Deleted' });
}));

// ── POST /api/licenses/:id/assign — take a seat (admin/editor) ────────────────
router.post('/:id/assign', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const lic = await get('SELECT * FROM licenses WHERE id = ?', [req.params.id]);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  if (!canManage(req, lic)) return res.status(403).json({ error: 'Not in your region' });

  const { assignee_ref = '', assignee_type = 'user' } = req.body;
  if (!assignee_ref.trim()) return res.status(400).json({ error: 'Assignee is required' });

  await run(
    'INSERT INTO license_assignments (license_id, assignee_type, assignee_ref, assigned_by) VALUES (?, ?, ?, ?)',
    [req.params.id, assignee_type, assignee_ref.trim(), req.user.username]);
  await audit(req.user, 'LICENSE', null, `Assigned "${lic.name}" seat to ${assignee_ref.trim()}`);

  const used = Number((await get(
    'SELECT COUNT(*) AS c FROM license_assignments WHERE license_id = ? AND released_at IS NULL', [req.params.id])).c);
  res.status(201).json({ message: 'Seat assigned', seats_used: used, over: used > lic.total_seats });
}));

// ── POST /api/licenses/release/:assignmentId — free a seat (admin/editor) ─────
router.post('/release/:assignmentId', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const asg = await get('SELECT * FROM license_assignments WHERE id = ?', [req.params.assignmentId]);
  if (!asg) return res.status(404).json({ error: 'Assignment not found' });
  const lic = await get('SELECT * FROM licenses WHERE id = ?', [asg.license_id]);
  if (lic && !canManage(req, lic)) return res.status(403).json({ error: 'Not in your region' });
  await run("UPDATE license_assignments SET released_at = datetime('now') WHERE id = ?", [req.params.assignmentId]);
  await audit(req.user, 'LICENSE', null, `Released a seat of "${lic ? lic.name : '?'}" from ${asg.assignee_ref}`);
  res.json({ message: 'Seat released' });
}));

module.exports = router;
