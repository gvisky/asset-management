const express = require('express');
const router = express.Router();
const { get, all, run } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.use(requireAuth);

// Build the visibility filter for the current user:
//  - audience 'all', or matching the user's team (IT/HR)
//  - country NULL (global), or matching a region-scoped user's country
function visibility(req) {
  const conds = ["(audience = 'all'"];
  const params = [];
  if (req.user.team) { conds[0] += ' OR audience = ?'; params.push(req.user.team); }
  conds[0] += ')';
  if (req.user.country) {
    conds.push('(country IS NULL OR country = ?)');
    params.push(req.user.country);
  }
  return { clause: conds.join(' AND '), params };
}

// ── GET /api/notifications?scope=asset|personnel ──────────────────────────────
router.get('/', wrap(async (req, res) => {
  const v = visibility(req);
  const conds = [v.clause];
  const params = [...v.params];
  if (req.query.scope) { conds.push('scope = ?'); params.push(req.query.scope); }

  const where = 'WHERE ' + conds.join(' AND ');
  const rows = await all(`SELECT * FROM notifications ${where} ORDER BY id DESC LIMIT 30`, params);
  const unread = Number((await get(`SELECT COUNT(*) AS c FROM notifications ${where} AND read = 0`, params)).c);
  res.json({ unread, data: rows });
}));

// ── POST /api/notifications/read-all?scope= ───────────────────────────────────
router.post('/read-all', wrap(async (req, res) => {
  const v = visibility(req);
  const conds = [v.clause];
  const params = [...v.params];
  if (req.body && req.body.scope) { conds.push('scope = ?'); params.push(req.body.scope); }
  await run(`UPDATE notifications SET read = 1 WHERE ${conds.join(' AND ')}`, params);
  res.json({ message: 'ok' });
}));

module.exports = router;
