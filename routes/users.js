const express = require('express');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { hashPassword } = require('../db/auth-utils');
const { requireGlobalAdmin } = require('../middleware/auth');
const { pagesFor } = require('../lib/access');
const { isOwner } = require('../lib/owner');   // the app owner's login is protected

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const { normCountry: canonCountry } = require('../lib/countries');

// User management is GLOBAL-admin only. Regional admins cannot manage users.
router.use(requireGlobalAdmin);

// Normalise the countries a user manages: '' / [] → null (= global, all countries);
// otherwise a comma-separated list, e.g. "Vietnam,Thailand". Accepts an array or a string.
function normCountry(c) {
  const list = (Array.isArray(c) ? c : String(c || '').split(','))
    .map(canonCountry).filter(Boolean);
  const uniq = [...new Set(list)];
  return uniq.length ? uniq.join(',') : null;
}
// Team: 'IT' / 'HR' / 'OT' (Operation Technology — Network map OT view only, no Asset Inventory) / null (none).
function normTeam(t) { return (t === 'IT' || t === 'HR' || t === 'OT' || t === 'NET') ? t : null; }
const noAssets = (t) => t === 'OT' || t === 'NET';   // OT / Network team: never the Asset Inventory
// Asset Inventory access flag (0 = User-Inventory-only, e.g. HR-only members).
function normAccess(v) { return (v === 0 || v === '0' || v === false || v === 'false') ? 0 : 1; }

// How many GLOBAL admins exist (role admin with no country) — must never hit 0.
async function globalAdminCount() {
  const r = await get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND (country IS NULL OR country = '')");
  return Number(r.c);
}

// ── GET /api/users — list all users ───────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const rows = await all('SELECT id, username, full_name, role, country, team, asset_access, mfa_enabled, created_at FROM users ORDER BY id');
  res.json(rows.map(r => ({ ...r, owner: isOwner(r.username) })));
}));

// ── Two-step login policy: required for everyone (default) or optional ──────────
const { mfaRequired, setMfaRequired } = require('../lib/mfa-policy');
router.get('/mfa-policy', wrap(async (req, res) => {
  const r = await get('SELECT COUNT(*) AS n, SUM(CASE WHEN mfa_enabled = 1 THEN 1 ELSE 0 END) AS on_ FROM users');
  res.json({ required: await mfaRequired(), users: Number(r.n) || 0, enabled: Number(r.on_) || 0 });
}));
router.put('/mfa-policy', wrap(async (req, res) => {
  const on = !!(req.body && req.body.required);
  await setMfaRequired(on);
  await audit(req.user, 'MFA', null, on ? 'Two-step login REQUIRED for everyone' : 'Two-step login made optional');
  res.json({ required: on });
}));

// ── POST /api/users — create a user ───────────────────────────────────────
router.post('/', wrap(async (req, res) => {
  const { username, full_name = '', password, role = 'viewer', country = '', team = '', asset_access } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (password.length < 6)    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const exists = await get('SELECT id FROM users WHERE username = ?', [username.trim()]);
  if (exists) return res.status(409).json({ error: 'Username already exists' });

  const result = await run(
    'INSERT INTO users (username, full_name, password_hash, role, country, team, asset_access) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [username.trim(), full_name.trim(), hashPassword(password), role, normCountry(country), normTeam(team), noAssets(normTeam(team)) ? 0 : normAccess(asset_access)]
  );
  await audit(req.user, 'USER', null, `Created login "${username.trim()}" — ${role}${normTeam(team) ? `, team ${normTeam(team)}` : ''}, ${normCountry(country) || 'all countries'}`);
  res.status(201).json(await get('SELECT id, username, full_name, role, country, team, asset_access FROM users WHERE id = ?', [result.lastInsertRowid]));
}));

// ── PUT /api/users/:id — update role / region / name / (optional) password ─
router.put('/:id', wrap(async (req, res) => {
  const { full_name, password } = req.body;
  let { role, country } = req.body;
  const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // App owner: only the owner may change this login, and only the name and password — it stays a global IT admin.
  if (isOwner(user.username)) {
    if (!isOwner(req.user.username)) return res.status(403).json({ error: `"${user.username}" is the app owner's login — only the owner can change it.` });
    role = 'admin'; country = ''; req.body.team = 'IT'; req.body.asset_access = 1;
  }

  if (role && !['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const teamNext = ('team' in req.body) ? normTeam(req.body.team) : (user.team || null);
  // OT members: viewer, editor or OT admin (role admin + team OT = OT editor + activity log / restore; never an IT admin).
  const newRole = role || user.role;
  const newCountry = (country !== undefined) ? normCountry(country) : (user.country || null);
  const wasGlobalAdmin = user.role === 'admin' && !user.country;
  const willBeGlobalAdmin = newRole === 'admin' && !newCountry;

  // Never allow the last global admin to lose global-admin status.
  if (wasGlobalAdmin && !willBeGlobalAdmin && (await globalAdminCount()) <= 1) {
    return res.status(400).json({ error: 'Cannot change the last global administrator' });
  }

  const newTeam   = ('team' in req.body) ? normTeam(req.body.team) : (user.team || null);
  // OT members only read the Network map (OT view): never Asset Inventory, never more than viewer.
  const newAccess = noAssets(newTeam) ? 0 : ('asset_access' in req.body) ? normAccess(req.body.asset_access) : user.asset_access;
  await run('UPDATE users SET full_name = ?, role = ?, country = ?, team = ?, asset_access = ? WHERE id = ?',
            [full_name !== undefined ? full_name : user.full_name, newRole, newCountry, newTeam, newAccess, req.params.id]);

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), req.params.id]);
  }
  const changed = [
    newRole !== user.role && `role ${user.role} → ${newRole}`,
    (newCountry || '') !== (user.country || '') && `countries ${user.country || 'all'} → ${newCountry || 'all'}`,
    (newTeam || '') !== (user.team || '') && `team ${user.team || 'none'} → ${newTeam || 'none'}`,
    Number(newAccess) !== Number(user.asset_access) && `Asset Inventory access ${newAccess ? 'on' : 'off'}`,
    full_name !== undefined && full_name !== user.full_name && 'name',
    password && 'password reset',
  ].filter(Boolean);
  await audit(req.user, 'USER', null, `Updated login "${user.username}"${changed.length ? ': ' + changed.join(', ') : ' (no change)'}`);

  res.json(await get('SELECT id, username, full_name, role, country, team, asset_access FROM users WHERE id = ?', [req.params.id]));
}));

// ── DELETE /api/users/:id — delete a user ─────────────────────────────────
// ── POST /api/users/:id/mfa-reset — turn off a user's two-step login (lost phone) ──
// The user signs in with the password only and can set up the authenticator again.
router.post('/:id/mfa-reset', wrap(async (req, res) => {
  const u = await get('SELECT id, username, mfa_enabled FROM users WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (isOwner(u.username) && !isOwner(req.user.username)) return res.status(403).json({ error: `"${u.username}" is the app owner's login — only the owner can reset its two-step login.` });
  await run("UPDATE users SET mfa_enabled = 0, mfa_secret = '', mfa_pending = '', mfa_recovery = '[]', mfa_last_step = 0 WHERE id = ?", [u.id]);
  await run('DELETE FROM mfa_challenges WHERE user_id = ?', [u.id]);
  await audit(req.user, 'MFA', null, `Reset two-step login of ${u.username}${u.mfa_enabled ? '' : ' (it was off)'}`);
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (isOwner(user.username)) {
    await audit(req.user, 'USER', null, `Refused: tried to delete the app owner's login "${user.username}"`);
    return res.status(403).json({ error: `"${user.username}" is the app owner's login and cannot be deleted.` });
  }
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (user.role === 'admin' && !user.country && (await globalAdminCount()) <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last global administrator' });
  }

  await run('DELETE FROM users WHERE id = ?', [req.params.id]);
  await audit(req.user, 'USER', null, `Deleted login "${user.username}" (${user.role})`);
  res.json({ message: 'User deleted' });
}));

// ── GET /api/users/audit/log — activity log with filters + paging ─────────
// ?q= (text in user / details / IP) &user= &action= &from=YYYY-MM-DD &to=YYYY-MM-DD &page= &limit= (≤ 500)
function auditWhere(q) {
  const cond = [], params = [];
  if (q.user)   { cond.push('username = ?'); params.push(String(q.user)); }
  if (q.action) {
    const acts = String(q.action).split(',').map(s => s.trim()).filter(Boolean);
    if (acts.length) { cond.push(`action IN (${acts.map(() => '?').join(', ')})`); params.push(...acts); }
  }
  if (q.hideViews === '1') cond.push("action <> 'VIEW'");
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { cond.push('created_at >= ?'); params.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || ''))   { cond.push("created_at < datetime(?, '+1 day')"); params.push(q.to); }
  if (q.q) {
    const like = `%${String(q.q).trim().toLowerCase()}%`;
    cond.push('(LOWER(username) LIKE ? OR LOWER(details) LIKE ? OR LOWER(COALESCE(ip, \'\')) LIKE ? OR LOWER(action) LIKE ?)');
    params.push(like, like, like, like);
  }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}
router.get('/audit/log', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const { where, params } = auditWhere(req.query);
  const total = Number((await get(`SELECT COUNT(*) AS c FROM audit_log ${where}`, params)).c);
  const rows = await all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  // For the filters: who appears in the log, which kinds of entries, and today's logins.
  const users = (await all('SELECT username, COUNT(*) AS n, MAX(created_at) AS last FROM audit_log GROUP BY username ORDER BY username COLLATE NOCASE'));
  const actions = (await all('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC'));
  const lastLogins = await all(`SELECT u.username, u.full_name, u.role, u.team, u.country, u.asset_access,
      (SELECT MAX(created_at) FROM audit_log a WHERE a.username = u.username AND a.action = 'LOGIN') AS last_login,
      (SELECT MAX(created_at) FROM audit_log a WHERE a.username = u.username) AS last_activity,
      (SELECT COUNT(*) FROM audit_log a WHERE a.username = u.username AND a.action = 'LOGIN_FAILED' AND a.created_at >= datetime('now', '-7 days')) AS failed_7d
    FROM users u ORDER BY last_activity IS NULL, last_activity DESC`);
  // Pages each account can open (and where it can change data) — same rules as the server guards.
  for (const u of lastLogins) u.pages = pagesFor(u);
  res.json({ rows, total, page, limit, users, actions, lastLogins });
}));

// ── GET /api/users/audit/export.xlsx — the filtered log as Excel (max 50 000 rows) ─
router.get('/audit/export.xlsx', wrap(async (req, res) => {
  const XLSX = require('xlsx');
  const { where, params } = auditWhere(req.query);
  const rows = (await all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT 50000`, params))
    .map(r => ({ 'When (UTC)': r.created_at, 'User': r.username, 'Action': r.action, 'Details': r.details, 'IP': r.ip || '', 'Asset ID': r.asset_id || '' }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '(no data)': '' }]), 'Audit log');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Cache-Control', 'no-store');
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}));

module.exports = router;
