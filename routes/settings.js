/* Settings (docs/UX-REDESIGN.md, phase 2): one page for the configuration that used to be spread over several pages.
   Each section keeps using its own API and permission (2-step policy: /api/users/mfa-policy · depreciation years:
   /api/kpi/depreciation-years · collectors: /api/health). This route only adds the "System" facts.

     GET /api/settings/system   (admins) → { commit, started, database, node, uptime_s, users, sessions } */
const express = require('express');
const router = express.Router();
const { get } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })));

router.get('/system', wrap(async (req, res) => {
  const users = await get('SELECT COUNT(*) AS n FROM users');
  const sessions = await get('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', [Date.now()]);
  res.json({
    commit: (process.env.RENDER_GIT_COMMIT || process.env.APP_COMMIT || '').slice(0, 7) || 'local',
    started: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptime_s: Math.round(process.uptime()),
    database: process.env.TURSO_DATABASE_URL ? 'Turso (cloud)' : `Local SQLite file (${process.env.DB_PATH || 'db/assets.db'})`,
    node: process.version,
    users: Number(users && users.n) || 0,
    sessions: Number(sessions && sessions.n) || 0,
    imports: { enabled: ['1', 'true'].includes(process.env.IMPORTS_ENABLED), undo: ['1', 'true'].includes(process.env.UNDO_IMPORT_ENABLED) },
  });
}));

module.exports = router;
