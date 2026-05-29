const express = require('express');
const router = express.Router();
const { get, all, run } = require('../db/database');
const { hashPassword } = require('../db/auth-utils');
const { requireRole } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// All routes here are admin-only.
router.use(requireRole('admin'));

// ── GET /api/users — list all users ───────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const rows = await all('SELECT id, username, full_name, role, created_at FROM users ORDER BY id');
  res.json(rows);
}));

// ── POST /api/users — create a user ───────────────────────────────────────
router.post('/', wrap(async (req, res) => {
  const { username, full_name = '', password, role = 'viewer' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (password.length < 6)    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const exists = await get('SELECT id FROM users WHERE username = ?', [username.trim()]);
  if (exists) return res.status(409).json({ error: 'Username already exists' });

  const result = await run(
    'INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)',
    [username.trim(), full_name.trim(), hashPassword(password), role]
  );
  res.status(201).json({ id: result.lastInsertRowid, username: username.trim(), full_name, role });
}));

// ── PUT /api/users/:id — update role / name / (optional) password ─────────
router.put('/:id', wrap(async (req, res) => {
  const { full_name, role, password } = req.body;
  const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role && !['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Prevent removing the last admin's admin role.
  if (user.role === 'admin' && role && role !== 'admin') {
    const { c } = await get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    if (Number(c) <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
  }

  await run('UPDATE users SET full_name = ?, role = ? WHERE id = ?',
            [full_name !== undefined ? full_name : user.full_name, role || user.role, req.params.id]);

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), req.params.id]);
  }

  res.json(await get('SELECT id, username, full_name, role FROM users WHERE id = ?', [req.params.id]));
}));

// ── DELETE /api/users/:id — delete a user ─────────────────────────────────
router.delete('/:id', wrap(async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (user.role === 'admin') {
    const { c } = await get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    if (Number(c) <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
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
