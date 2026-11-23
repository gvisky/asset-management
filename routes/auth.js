const express = require('express');
const router = express.Router();
const { get, run, audit } = require('../db/database');
const totp = require('../lib/totp');
const QRCode = require('qrcode');
const { mfaRequired } = require('../lib/mfa-policy');
const { hashPassword, verifyPassword, newToken, hashToken } = require('../db/auth-utils');
const { requireAuth, getUserFromRequest } = require('../middleware/auth');

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
    await audit(user ? { id: user.id, username: user.username } : { id: null, username: String(username).trim().slice(0, 60) },
      'LOGIN_FAILED', null, user ? 'Wrong password' : 'Unknown username');
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Two-step login on: no session yet — the browser must send the 6-digit code (or a recovery code).
  if (user.mfa_enabled) {
    const challenge = newToken();
    await run('DELETE FROM mfa_challenges WHERE expires_at < ?', [Date.now()]);
    await run('INSERT INTO mfa_challenges (token_hash, user_id, expires_at, attempts) VALUES (?, ?, ?, 0)',
      [hashToken(challenge), user.id, Date.now() + CHALLENGE_MS]);
    return res.json({ mfa_required: true, challenge });
  }
  await startSession(req, res, user, 'Logged in');
  // Two-step login required for everyone but not set up yet → the browser goes to the setup page.
  res.json({ ...publicUser(user), mfa_setup_required: await mfaRequired() });
}));

const CHALLENGE_MS = 5 * 60 * 1000;   // the code must be entered within 5 minutes
const MAX_TRIES = 5;                  // then the password must be entered again
const ISSUER = 'Hayat Tools';
const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, team: u.team || null });
const recoveryList = (u) => { try { const a = JSON.parse(u.mfa_recovery || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

async function startSession(req, res, user, how) {
  const token = newToken();
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), user.id, expires]);
  setSessionCookie(res, token);
  await audit(user, 'LOGIN', null, `${how} · ${String(req.headers['user-agent'] || '').replace(/\s+/g, ' ').slice(0, 160)}`);
}

// ── POST /api/auth/login/mfa — second step: { challenge, code } ───────────────
// code = 6 digits from the authenticator app, or a one-time recovery code (xxxx-xxxx).
router.post('/login/mfa', wrap(async (req, res) => {
  const { challenge, code } = req.body || {};
  if (!challenge || !code) return res.status(400).json({ error: 'Enter the 6-digit code' });
  const ch = await get('SELECT * FROM mfa_challenges WHERE token_hash = ?', [hashToken(String(challenge))]);
  if (!ch || ch.expires_at < Date.now()) {
    if (ch) await run('DELETE FROM mfa_challenges WHERE token_hash = ?', [ch.token_hash]);
    return res.status(401).json({ error: 'The sign-in expired — enter your password again', restart: true });
  }
  const user = await get('SELECT * FROM users WHERE id = ?', [ch.user_id]);
  if (!user || !user.mfa_enabled) { await run('DELETE FROM mfa_challenges WHERE token_hash = ?', [ch.token_hash]); return res.status(401).json({ error: 'Sign in again', restart: true }); }

  const raw = String(code).trim();
  let how = null;
  if (/^\d{6}$/.test(raw.replace(/\s+/g, ''))) {
    const st = totp.verify(user.mfa_secret, raw, { afterStep: Number(user.mfa_last_step) || 0 });
    if (st != null) { await run('UPDATE users SET mfa_last_step = ? WHERE id = ?', [st, user.id]); how = 'Logged in with authenticator code'; }
  } else {
    const h = totp.hashRecovery(raw), list = recoveryList(user);
    if (list.includes(h)) {
      await run('UPDATE users SET mfa_recovery = ? WHERE id = ?', [JSON.stringify(list.filter(x => x !== h)), user.id]);
      how = `Logged in with a recovery code (${list.length - 1} left)`;
    }
  }
  if (!how) {
    const tries = Number(ch.attempts) + 1;
    await audit(user, 'LOGIN_FAILED', null, `Wrong two-step code (try ${tries} of ${MAX_TRIES})`);
    if (tries >= MAX_TRIES) {
      await run('DELETE FROM mfa_challenges WHERE token_hash = ?', [ch.token_hash]);
      return res.status(429).json({ error: 'Too many wrong codes — enter your password again', restart: true });
    }
    await run('UPDATE mfa_challenges SET attempts = ? WHERE token_hash = ?', [tries, ch.token_hash]);
    return res.status(401).json({ error: `Wrong code — ${MAX_TRIES - tries} tr${MAX_TRIES - tries === 1 ? 'y' : 'ies'} left` });
  }
  await run('DELETE FROM mfa_challenges WHERE token_hash = ?', [ch.token_hash]);
  await startSession(req, res, user, how);
  res.json(publicUser(user));
}));

// ── Two-step login settings (each user, for their own account) ─────────────────
// GET  /api/auth/mfa            status
// POST /api/auth/mfa/setup      new secret + QR (not active until confirmed)
// POST /api/auth/mfa/enable     { code } confirm the app works → on + 10 recovery codes (shown once)
// POST /api/auth/mfa/recovery   { password } new set of recovery codes
// POST /api/auth/mfa/disable    { password, code } turn off
router.get('/mfa', requireAuth, wrap(async (req, res) => {
  const u = await get('SELECT mfa_enabled, mfa_recovery FROM users WHERE id = ?', [req.user.id]);
  res.json({ enabled: !!(u && u.mfa_enabled), recovery_left: u ? recoveryList(u).length : 0 });
}));
router.post('/mfa/setup', requireAuth, wrap(async (req, res) => {
  const secret = totp.newSecret();
  await run('UPDATE users SET mfa_pending = ? WHERE id = ?', [secret, req.user.id]);
  const url = totp.otpauthUrl(secret, req.user.username, ISSUER);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  res.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: url, qr });
}));
router.post('/mfa/enable', requireAuth, wrap(async (req, res) => {
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u.mfa_pending) return res.status(400).json({ error: 'Start the setup again' });
  const st = totp.verify(u.mfa_pending, (req.body || {}).code);
  if (st == null) return res.status(400).json({ error: 'That code is not right — check the phone\'s time is automatic and try the newest code' });
  const codes = totp.newRecoveryCodes();
  await run('UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_pending = ?, mfa_last_step = ?, mfa_recovery = ? WHERE id = ?',
    [u.mfa_pending, '', st, JSON.stringify(codes.map(totp.hashRecovery)), u.id]);
  await audit(req.user, 'MFA', null, 'Turned on two-step login (authenticator app)');
  res.json({ enabled: true, recovery_codes: codes });
}));
router.post('/mfa/recovery', requireAuth, wrap(async (req, res) => {
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u.mfa_enabled) return res.status(400).json({ error: 'Two-step login is off' });
  if (!verifyPassword(String((req.body || {}).password || ''), u.password_hash)) return res.status(401).json({ error: 'Password is incorrect' });
  const codes = totp.newRecoveryCodes();
  await run('UPDATE users SET mfa_recovery = ? WHERE id = ?', [JSON.stringify(codes.map(totp.hashRecovery)), u.id]);
  await audit(req.user, 'MFA', null, 'Made new recovery codes (old ones no longer work)');
  res.json({ recovery_codes: codes });
}));
router.post('/mfa/disable', requireAuth, wrap(async (req, res) => {
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const { password, code } = req.body || {};
  if (!verifyPassword(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Password is incorrect' });
  if (u.mfa_enabled && totp.verify(u.mfa_secret, code) == null && !recoveryList(u).includes(totp.hashRecovery(code))) {
    return res.status(401).json({ error: 'Enter a current 6-digit code (or a recovery code)' });
  }
  await run("UPDATE users SET mfa_enabled = 0, mfa_secret = '', mfa_pending = '', mfa_recovery = '[]', mfa_last_step = 0 WHERE id = ?", [u.id]);
  await audit(req.user, 'MFA', null, 'Turned off two-step login');
  res.json({ enabled: false });
}));

// ── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', wrap(async (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
  if (match) {
    const who = await getUserFromRequest(req).catch(() => null);
    if (who) await audit(who, 'LOGOUT', null, 'Logged out');
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
    await audit(req.user, 'PASSWORD', null, 'Password change refused — current password incorrect');
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(new_password), req.user.id]);
  await audit(req.user, 'PASSWORD', null, 'Changed own password');
  res.json({ message: 'Password updated' });
}));

module.exports = router;
