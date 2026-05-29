const express = require('express');
const router = express.Router();
const { get, all, run } = require('../db/database');
const { hashPassword } = require('../db/auth-utils');
const { requireGlobalAdmin } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const VALID_COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];

// User management is GLOBAL-admin only. Regional admins cannot manage users.
router.use(requireGlobalAdmin);

// Normalise a country value: '' / undefined → null (= global, all countries).
function normCountry(c) {
  if (!c) return null;
  return VALID_COUNTRIES.includes(c) ? c : null;
}

// How many GLOBAL admins exist (role admin with no country) — must never hit 0.
async function globalAdminCount() {
  const r = await get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND (country IS NULL OR country = '')");
  return Number(r.c);
}

// ── GET /api/users — list all users ───────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const rows = await all('SELECT id, username, full_name, role, country, created_at FROM users ORDER BY id');
  res.json(rows);
}));

// ── POST /api/users — create a user ───────────────────────────────────────
router.post('/', wrap(async (req, res) => {
  const { username, full_name = '', password, role = 'viewer', country = '' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (password.length < 6)    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const exists = await get('SELECT id FROM users WHERE username = ?', [username.trim()]);
  if (exists) return res.status(409).json({ error: 'Username already exists' });

  const result = await run(
    'INSERT INTO users (username, full_name, password_hash, role, country) VALUES (?, ?, ?, ?, ?)',
    [username.trim(), full_name.trim(), hashPassword(password), role, normCountry(country)]
  );
  res.status(201).json({ id: result.lastInsertRowid, username: username.trim(), full_name, role, country: normCountry(country) });
}));

// ── PUT /api/users/:id — update role / region / name / (optional) password ─
router.put('/:id', wrap(async (req, res) => {
  const { full_name, role, password, country } = req.body;
  const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role && !['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const newRole = role || user.role;
  const newCountry = (country !== undefined) ? normCountry(country) : (user.country || null);
  const wasGlobalAdmin = user.role === 'admin' && !user.country;
  const willBeGlobalAdmin = newRole === 'admin' && !newCountry;

  // Never allow the last global admin to lose global-admin status.
  if (wasGlobalAdmin && !willBeGlobalAdmin && (await globalAdminCount()) <= 1) {
    return res.status(400).json({ error: 'Cannot change the last global administrator' });
  }

  await run('UPDATE users SET full_name = ?, role = ?, country = ? WHERE id = ?',
            [full_name !== undefined ? full_name : user.full_name, newRole, newCountry, req.params.id]);

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), req.params.id]);
  }

  res.json(await get('SELECT id, username, full_name, role, country FROM users WHERE id = ?', [req.params.id]));
}));

// ── DELETE /api/users/:id — delete a user ─────────────────────────────────
router.delete('/:id', wrap(async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (user.role === 'admin' && !user.country && (await globalAdminCount()) <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last global administrator' });
  }

  await run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'User deleted' });
}));

// ── GET /api/users/audit/log — recent audit entries ───────────────────────
router.get('/audit/log', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
  res.json(rows);
}));

module.exports = router;
