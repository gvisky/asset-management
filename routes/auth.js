const express = require('express');
const router = express.Router();
const { get, run, audit } = require('../db/database');
const { hashPassword, verifyPassword, newToken, hashToken } = require('../db/auth-utils');
const { requireAuth } = require('../middleware/auth');

const SESSION_DAYS = 7;
const isProd = process.env.NODE_ENV === 'production';
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  const parts = [
    `sid=${token}`, 'HttpOnly', 'Path=/',
    `Max-Age=${Math.floor(maxAge / 1000)}`, 'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure'); // requires HTTPS in production
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ── POST /api/auth/login ──────────────────────────────────────────────────
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await get('SELECT * FROM users WHERE username = ?', [username.trim()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = newToken();
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
            [hashToken(token), user.id, expires]);

  setSessionCookie(res, token);
  await audit(user, 'LOGIN', null, 'User logged in');
  res.json({ id: user.id, username: user.username, full_name: user.full_name, role: user.role });
}));

// ── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', wrap(async (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  if (match) {
    await run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(decodeURIComponent(match[1]))]);
  }
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ message: 'Logged out' });
}));

// ── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ── POST /api/auth/change-password ────────────────────────────────────────
router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const row = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(current_password, row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(new_password), req.user.id]);
  res.json({ message: 'Password updated' });
}));

module.exports = router;
