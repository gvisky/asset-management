const { get, run } = require('../db/database');
const { hashToken } = require('../db/auth-utils');

// Parse a cookie header into an object (avoids adding cookie-parser dependency).
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

// Look up the logged-in user from the session cookie. Returns user or null.
async function getUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies.sid;
  if (!token) return null;

  const session = await get('SELECT * FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  if (!session) return null;

  if (Number(session.expires_at) < Date.now()) {
    await run('DELETE FROM sessions WHERE token_hash = ?', [session.token_hash]);
    return null;
  }

  const user = await get(
    'SELECT id, username, full_name, role, country FROM users WHERE id = ?', [session.user_id]
  );
  return user || null;
}

// Require any authenticated user.
async function requireAuth(req, res, next) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

// Require one of the given roles (e.g. requireRole('admin','editor')).
function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      if (!roles.includes(user.role)) {
        return res.status(403).json({ error: 'You do not have permission for this action' });
      }
      req.user = user;
      next();
    } catch (e) { next(e); }
  };
}

// Require a GLOBAL admin (role 'admin' with no country restriction).
// Regional admins (admin + a country) are NOT allowed past this.
function requireGlobalAdmin(req, res, next) {
  return (async () => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      if (user.role !== 'admin' || user.country) {
        return res.status(403).json({ error: 'Global administrator only' });
      }
      req.user = user;
      next();
    } catch (e) { next(e); }
  })();
}

module.exports = { getUserFromRequest, requireAuth, requireRole, requireGlobalAdmin, parseCookies };
