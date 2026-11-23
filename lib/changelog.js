/* Write-once change log. Every change is written ONCE, as one row of audit_log, with the structured parts that the
   Network map port history (site / device / port / before → after text) and the OT activity page (before / after rows
   as JSON, for restore) need. Readers: routes/activity.js (all), routes/netmap.js GET /log, routes/ot-activity.js,
   routes/ot-reports.js. net_port_log and ot_activity are no longer written (old rows were copied — legacy column).

   log(user, e)        e = { action, details, asset_id, kind, ref_type, ref_id, label, summary, site, device, port,
                              before_text, after_text, before, after (objects → JSON), ot (bool), restore_of }
   PORT_LOG_SQL        for batch(): args (site, device, port, before, after, username) — a Network map line
   portLog(user, site, device, port, before, after) */
const { run, auditCtx } = require('../db/database');

const teams = new Map();
async function teamOf(user) {
  if (user && typeof user === 'object') return user.team || '';
  const { get } = require('../db/database');
  if (!teams.has(user)) { const u = await get('SELECT team FROM users WHERE username = ?', [user]).catch(() => null); teams.set(user, (u && u.team) || ''); }
  return teams.get(user);
}
const nameOf = (user) => (user && typeof user === 'object' ? user.username : String(user || 'system'));
const idOf = (user) => (user && typeof user === 'object' ? user.id || null : null);
const s = (v, n) => String(v == null ? '' : v).slice(0, n);

async function log(user, e) {
  const ctx = auditCtx.getStore();
  if (ctx) ctx.audited = true;
  try {
    await run(`INSERT INTO audit_log (user_id, username, by_team, action, asset_id, details, ip, kind, ref_type, ref_id, label, summary, site, device, port,
        before_text, after_text, before_json, after_json, ot, restore_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [idOf(user), nameOf(user), await teamOf(user), e.action || 'UPDATE', e.asset_id || null, s(e.details, 2000), (ctx && ctx.ip) || '',
        s(e.kind, 40), s(e.ref_type, 20), e.ref_id == null ? null : e.ref_id, s(e.label, 120), s(e.summary, 1000), s(e.site, 80), s(e.device, 80), s(e.port, 40),
        s(e.before_text, 300), s(e.after_text, 300), e.before ? JSON.stringify(e.before) : '', e.after ? JSON.stringify(e.after) : '', e.ot ? 1 : 0, e.restore_of || null]);
  } catch (err) { console.error('change log failed:', err.message); }
}

// One Network map line (device added / edited / placed in a rack, a port set by an import …) — also usable in batch().
const PORT_LOG_SQL = `INSERT INTO audit_log (site, device, port, before_text, after_text, username, action, ref_type, details)
  SELECT s, d, p, b, a, u, 'NETMAP', CASE WHEN p = '' THEN 'device' ELSE 'port' END,
    'Network map "' || s || '": ' || d || CASE WHEN p <> '' THEN ' ' || p ELSE '' END || ': ' || CASE WHEN b <> '' THEN b || ' → ' ELSE '' END || a
  FROM (SELECT ? AS s, ? AS d, COALESCE(?, '') AS p, COALESCE(?, '') AS b, COALESCE(?, '') AS a, ? AS u)`;
const portLog = (user, site, device, port, before, after) => run(module.exports.PORT_LOG_SQL, [site, device, port || '', before || '', after || '', nameOf(user)]);

// Using the SQL inside a request marks it as logged, so lib/activity.js does not add a generic "ACTION" line as well.
const markLogged = () => { const ctx = auditCtx.getStore(); if (ctx) ctx.audited = true; };
module.exports = {
  log, portLog, nameOf, teamOf,
  get PORT_LOG_SQL() { markLogged(); return PORT_LOG_SQL; },
};
