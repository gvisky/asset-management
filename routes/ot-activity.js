/* 🕓 OT activity (/ot-activity.html): who changed which OT device / OT switch port, with the change; restore one.
   Reads the write-once change log (audit_log rows with ot = 1 — lib/changelog.js); ids are change-log ids.
   GET  /api/ot-activity?q=&kind=&user=&days=&team=   OT admins, IT admins / editors
   POST /api/ot-activity/:id/restore                    OT admins and IT admins (puts the row back as it was before) */
const express = require('express');
const router = express.Router();
const { get, all, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const OTA = require('../lib/ot-activity');

router.use(requireAuth);
const canSee = (u) => !!u.ot_admin || (u.team === 'IT' && ['admin', 'editor'].includes(u.role));
const canRestore = (u) => !!u.ot_admin || (u.team === 'IT' && u.role === 'admin');
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use((req, res, next) => (canSee(req.user) ? next() : res.status(403).json({ error: 'OT admins and IT only' })));

router.get('/', wrap(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const where = ["ot = 1", "created_at >= datetime('now', ?)"], args = [`-${days} days`];
  if (req.query.kind) { where.push('kind = ?'); args.push(String(req.query.kind)); }
  if (req.query.user) { where.push('username = ?'); args.push(String(req.query.user)); }
  if (req.query.team) { where.push('by_team = ?'); args.push(String(req.query.team)); }
  if (req.query.q) { where.push('(label LIKE ? OR summary LIKE ? OR username LIKE ?)'); const l = `%${String(req.query.q).slice(0, 80)}%`; args.push(l, l, l); }
  const rows = (await all(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`, args)).map(OTA.entry);
  const out = [];
  for (const e of rows) {
    out.push({ id: e.id, at: e.at, by_user: e.by_user, by_team: e.by_team, kind: e.kind, ref_type: e.ref_type, ref_id: e.ref_id, label: e.label, summary: e.summary,
      restored_at: e.restored_at, restored_by: e.restored_by, restore_of: e.restore_of,
      changed_since: e.restored_at || e.kind === 'restore' ? false : await OTA.changedSince(e).catch(() => false) });
  }
  const users = (await all(`SELECT DISTINCT username FROM audit_log WHERE ot = 1 AND created_at >= datetime('now', ?) ORDER BY username`, [`-${days} days`])).map(r => r.username);
  res.json({ rows: out, users, canRestore: canRestore(req.user) });
}));

router.get('/:id', wrap(async (req, res) => {
  const e = OTA.entry(await get('SELECT * FROM audit_log WHERE id = ? AND ot = 1', [Number(req.params.id)]));
  if (!e) return res.status(404).json({ error: 'Not found' });
  res.json({ ...e, before: e.before ? JSON.parse(e.before) : null, after: e.after ? JSON.parse(e.after) : null, changed_since: await OTA.changedSince(e).catch(() => false) });
}));

router.post('/:id/restore', wrap(async (req, res) => {
  if (!canRestore(req.user)) return res.status(403).json({ error: 'OT admins and IT admins only' });
  const e = OTA.entry(await get('SELECT * FROM audit_log WHERE id = ? AND ot = 1', [Number(req.params.id)]));
  if (!e) return res.status(404).json({ error: 'Not found' });
  if (e.restored_at) return res.status(400).json({ error: `Already restored ${String(e.restored_at).slice(0, 16)} UTC by ${e.restored_by}` });
  if (e.kind === 'restore') return res.status(400).json({ error: 'This is a restore — restore the change it undid instead' });
  try { await OTA.restore(e, req.user); } catch (err) { return res.status(400).json({ error: err.message || 'Could not restore' }); }
  // The restore itself is logged once (kind 'restore', restore_of = this change).
  res.json({ ok: true });
}));

module.exports = router;
