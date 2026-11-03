/* System Health — live status of routers, switches, servers and internal web apps.

   The website runs in the cloud and cannot reach the office network, so a small
   collector program inside each site (see /collector) checks the systems every minute
   (SNMP / ping / HTTP) and PUSHES the results here with its own secret key:

     POST /api/health/ingest          Authorization: Bearer hc_…   (collector)
     GET  /api/health                 status for the System Health page (team IT)
     POST /api/health/collectors      create a collector key (IT admin; the key is shown once)
     POST /api/health/collectors/:id/revoke · DELETE /api/health/collectors/:id   (IT admin)

   Only the latest status per check is stored (+ a short list of status changes). */

const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit, notify } = require('../db/database');
const { getUserFromRequest, isITAdmin } = require('../middleware/auth');
const { newToken, hashToken } = require('../db/auth-utils');
const { inScope } = require('../lib/scope');
const { normCountry } = require('../lib/countries');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const STATUSES = ['up', 'warn', 'down', 'unknown'];
const STALE_SECONDS = 180;          // no report for 3 min → shown as "no data"
const MAX_CHECKS = 200;
const MAX_DETAIL = 20000;           // bytes of JSON per check
const KEEP_EVENTS = 3000;
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

// ── Collector push (no user session — the collector key is the login) ─────────
router.post('/ingest', wrap(async (req, res) => {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return res.status(401).json({ error: 'Missing collector key' });
  const col = await get('SELECT * FROM health_collectors WHERE token_hash = ?', [hashToken(m[1])]);
  if (!col || col.revoked) return res.status(401).json({ error: 'Unknown or revoked collector key' });

  const b = req.body || {};
  const checks = Array.isArray(b.checks) ? b.checks.slice(0, MAX_CHECKS) : [];
  const existing = new Map((await all('SELECT check_key, name, status FROM health_checks WHERE collector_id = ?', [col.id]))
    .map(r => [r.check_key, r]));
  const now = (await get("SELECT datetime('now') AS n")).n;
  const stmts = [], changes = [];
  for (const c of checks) {
    const key = str(c.key, 100);
    if (!key) continue;
    const status = STATUSES.includes(c.status) ? c.status : 'unknown';
    let detail = '';
    try { detail = c.detail ? JSON.stringify(c.detail) : ''; } catch { detail = ''; }
    if (detail.length > MAX_DETAIL) detail = '';
    const latency = Number.isFinite(Number(c.latency_ms)) ? Math.round(Number(c.latency_ms)) : null;
    const row = [str(c.name) || key, str(c.kind, 20), str(c.target), status, str(c.summary, 300), latency, detail];
    const old = existing.get(key);
    if (old) {
      stmts.push({ sql: `UPDATE health_checks SET name = ?, kind = ?, target = ?, status = ?, summary = ?, latency_ms = ?, detail = ?,
                           status_since = CASE WHEN status = ? THEN status_since ELSE ? END, last_seen_at = ?
                         WHERE collector_id = ? AND check_key = ?`,
                   args: [...row, status, now, now, col.id, key] });
      if (old.status !== status) changes.push({ key, name: row[0], from: old.status, to: status, summary: row[4] });
    } else {
      stmts.push({ sql: `INSERT INTO health_checks (collector_id, check_key, name, kind, target, status, summary, latency_ms, detail,
                           status_since, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT (collector_id, check_key) DO NOTHING`,
                   args: [col.id, key, ...row, now, now] });
      changes.push({ key, name: row[0], from: 'new', to: status, summary: row[4] });
    }
  }
  for (const ch of changes) {
    stmts.push({ sql: 'INSERT INTO health_events (collector_id, check_key, name, from_status, to_status, summary) VALUES (?, ?, ?, ?, ?, ?)',
                 args: [col.id, ch.key, ch.name, ch.from, ch.to, ch.summary] });
  }
  const ip = str(String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0], 60);
  stmts.push({ sql: 'UPDATE health_collectors SET last_seen_at = ?, last_ip = ?, version = ?, offline_notified = 0 WHERE id = ?',
               args: [now, ip, str(b.version, 40), col.id] });
  if (col.offline_notified) {
    await notify({ audience: 'IT', country: col.country || null, scope: 'system', level: 'info',
      message: `🟢 System Health collector "${col.name}"${col.site ? ` (${col.site})` : ''} is reporting again` });
  }
  await batch(stmts, 100);

  // Tell IT when something goes down / gets a warning, and when it is fully back up
  // (status changes only — not every minute; "unknown" changes are not announced).
  const where = [col.site, col.country].filter(Boolean).join(', ');
  const bad = (st) => st === 'down' || st === 'warn';
  for (const ch of changes) {
    let icon, what;
    if (ch.to === 'down') { icon = '🔴'; what = 'DOWN'; }
    else if (ch.to === 'warn' && ch.from !== 'down') { icon = '🟠'; what = 'showing a warning'; }
    else if (ch.to === 'up' && bad(ch.from)) { icon = '🟢'; what = 'back up'; }
    else continue;
    await notify({ audience: 'IT', country: col.country || null, scope: 'system', level: icon === '🟢' ? 'info' : 'warning',
      message: `${icon} ${ch.name}${where ? ` (${where})` : ''} is ${what}${ch.summary ? ` — ${ch.summary}` : ''}` });
  }
  if (changes.length && Math.random() < 0.05) {
    await run(`DELETE FROM health_events WHERE id <= (SELECT id FROM health_events ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_EVENTS})`);
  }
  res.json({ ok: true, received: checks.length, changes: changes.length, interval: 60 });
}));

// A collector that goes quiet usually means that office lost its internet (or the PC is off).
// Checked every minute while the server is running; IT is told once, and again when it's back.
async function watchCollectors() {
  try {
    const quiet = await all(`SELECT id, name, site, country, last_seen_at FROM health_collectors
       WHERE revoked = 0 AND offline_notified = 0 AND last_seen_at IS NOT NULL
         AND (julianday('now') - julianday(last_seen_at)) * 86400 > ?`, [STALE_SECONDS]);
    for (const c of quiet) {
      await run('UPDATE health_collectors SET offline_notified = 1 WHERE id = ?', [c.id]);
      await notify({ audience: 'IT', country: c.country || null, scope: 'system', level: 'warning',
        message: `🔴 System Health collector "${c.name}"${c.site ? ` (${c.site})` : ''} stopped reporting (last report ${c.last_seen_at} UTC) — internet down at that office, or the PC is off?` });
    }
  } catch (e) { console.error('[health] watch failed:', e.message); }
}
setInterval(watchCollectors, 60000).unref();

// ── Everything below needs a logged-in IT user ────────────────────────────────
router.use(wrap(async (req, res, next) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.team !== 'IT') return res.status(403).json({ error: 'System Health is for the IT team' });
  req.user = user;
  next();
}));
const itAdminOnly = (req, res, next) => (isITAdmin(req.user) ? next()
  : res.status(403).json({ error: 'Only an IT admin can manage collectors' }));

// GET /api/health — collectors + latest checks + recent status changes.
router.get('/', wrap(async (req, res) => {
  const collectors = (await all(`SELECT id, name, site, country, created_by, created_at, last_seen_at, last_ip, version, revoked,
        CAST((julianday('now') - julianday(last_seen_at)) * 86400 AS INTEGER) AS age_s
      FROM health_collectors ORDER BY country, site, name`))
    .filter(c => !c.country || inScope(req, c.country));
  const ids = new Set(collectors.map(c => c.id));
  const checks = (await all(`SELECT *, CAST((julianday('now') - julianday(last_seen_at)) * 86400 AS INTEGER) AS age_s
      FROM health_checks ORDER BY name`))
    .filter(c => ids.has(c.collector_id))
    .map(c => {
      let detail = null;
      try { detail = c.detail ? JSON.parse(c.detail) : null; } catch { detail = null; }
      const stale = c.age_s == null || c.age_s > STALE_SECONDS;
      return { ...c, detail, stale, shown_status: stale ? 'stale' : c.status };
    });
  const events = (await all('SELECT * FROM health_events ORDER BY id DESC LIMIT 60')).filter(e => ids.has(e.collector_id));
  res.json({
    collectors: collectors.map(c => ({ ...c, online: !c.revoked && c.age_s != null && c.age_s <= STALE_SECONDS })),
    checks, events, staleSeconds: STALE_SECONDS, canManage: isITAdmin(req.user),
  });
}));

// POST /api/health/collectors — { name, site, country } → { key } (shown once).
router.post('/collectors', itAdminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  if (!name) return res.status(400).json({ error: 'Give the collector a name (e.g. "HCM office PC")' });
  const country = normCountry(str(b.country, 60)) || '';
  const key = 'hc_' + newToken();
  const r = await run('INSERT INTO health_collectors (name, site, country, token_hash, created_by) VALUES (?, ?, ?, ?, ?)',
    [name, str(b.site, 80), country, hashToken(key), req.user.username]);
  await audit(req.user, 'HEALTH', null, `Created System Health collector "${name}"${country ? ` (${country})` : ''}`);
  res.status(201).json({ id: r.lastInsertRowid, name, key });
}));

router.post('/collectors/:id/revoke', itAdminOnly, wrap(async (req, res) => {
  const c = await get('SELECT * FROM health_collectors WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Collector not found' });
  await run('UPDATE health_collectors SET revoked = 1 WHERE id = ?', [c.id]);
  await audit(req.user, 'HEALTH', null, `Revoked System Health collector "${c.name}"`);
  res.json({ ok: true });
}));

router.delete('/collectors/:id', itAdminOnly, wrap(async (req, res) => {
  const c = await get('SELECT * FROM health_collectors WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Collector not found' });
  await batch([
    { sql: 'DELETE FROM health_checks WHERE collector_id = ?', args: [c.id] },
    { sql: 'DELETE FROM health_events WHERE collector_id = ?', args: [c.id] },
    { sql: 'DELETE FROM health_collectors WHERE id = ?', args: [c.id] },
  ]);
  await audit(req.user, 'HEALTH', null, `Deleted System Health collector "${c.name}" and its checks`);
  res.json({ ok: true });
}));

module.exports = router;
