/* Activity log — every user action ends up in the Audit Log (Users & Audit page).

   - Routes that already write a clear audit entry ("Updated asset …", "LOGIN" …) keep it; the entry gets the IP.
   - Any other change (POST / PUT / PATCH / DELETE on /api) that wrote nothing is recorded as
     ACTION "<area>: <what was called>" — so nothing a user changes goes unrecorded.
   - Excel / file downloads → EXPORT.  Opening a page → VIEW (once per user and page per 10 minutes).
   - Not recorded: the System Health collector's minute-by-minute push, reading / ticking alerts. */

const { auditCtx, audit, run } = require('../db/database');
const { getUserFromRequest } = require('../middleware/auth');

const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '')
  .split(',')[0].trim().replace(/^::ffff:/, '').slice(0, 60);

const AREA = {
  assets: 'Asset Inventory', servers: 'Server Inventory', users: 'Users', personnel: 'User Inventory',
  maintenance: 'Maintenance', licenses: 'Licenses', reports: 'Reports', budget: 'Budget Tracking',
  notifications: 'Alerts', countries: 'Countries', devices: 'Devices', health: 'System Health', auth: 'Account',
  custody: 'Handover / return', stocktake: 'Stocktake', m365: 'Microsoft 365 licences', leavers: 'Leavers', kpi: 'KPIs',
};
const PAGE = {
  '/': 'Dashboard', '/index.html': 'Dashboard', '/inventory.html': 'Asset Inventory', '/user-inventory.html': 'User Inventory',
  '/server-inventory.html': 'Server Inventory', '/devices.html': 'Devices', '/system-health.html': 'System Health',
  '/maintenance.html': 'Maintenance & Repairs', '/licenses.html': 'Licenses', '/reports.html': 'Reports',
  '/budget.html': 'Budget Tracking', '/alerts.html': 'Needs Attention', '/deleted.html': 'Recycle Bin',
  '/users.html': 'Users & Audit', '/custody-form.html': 'Custody form',
  '/stocktake.html': 'Stocktake', '/scan.html': 'Scanned asset label', '/labels.html': 'QR labels', '/kpi.html': 'KPIs', '/leavers.html': 'Leavers',
};
const VERB = { POST: 'add / run', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
// Calls that are not a user's action, or are recorded by their route already.
const SKIP = [/^\/api\/health\/ingest/, /^\/api\/notifications/, /^\/api\/auth\/(login|logout|me)/, /^\/api\/version/];

const lastView = new Map();         // "user|page" → time of the last VIEW entry
const VIEW_GAP_MS = 10 * 60 * 1000;

async function record(req, res, ctx) {
  const p = ctx.path;
  const status = res.statusCode;
  if (SKIP.some(re => re.test(p)) || status >= 500) return;
  const isApi = p.startsWith('/api/');
  const m = req.method;
  let action = '', details = '';
  if (isApi && VERB[m]) {
    if (ctx.audited) return;                       // the route wrote its own entry
    const parts = p.split('/').filter(Boolean);    // api, area, …
    action = status >= 400 ? 'REFUSED' : 'ACTION';
    details = `${AREA[parts[1]] || parts[1]}: ${VERB[m]} ${'/' + parts.slice(1).join('/')}${status >= 400 ? ` — refused (${status})` : ''}`;
  } else if (m === 'GET' && status < 400 && (/\.xlsx$|\/export|\.pdf$/i.test(p) || /^\/api\/reports\/.+\.html$/i.test(p))) {
    const parts = p.split('/').filter(Boolean);
    action = 'EXPORT';
    details = `${AREA[parts[1]] || parts[1] || 'File'}: downloaded ${parts.slice(2).join('/') || p}`;
  } else if (!isApi && m === 'GET' && status < 400 && PAGE[p]) {
    action = 'VIEW';
    details = `Opened ${PAGE[p]}`;
  } else return;

  const user = req.user || await getUserFromRequest(req).catch(() => null);
  if (!user) return;
  if (action === 'VIEW') {
    const k = `${user.id}|${p}`, now = Date.now();
    if (now - (lastView.get(k) || 0) < VIEW_GAP_MS) return;
    lastView.set(k, now);
    if (lastView.size > 5000) lastView.clear();
  }
  await auditCtx.run({ ip: ctx.ip, audited: false }, () => audit(user, action, null, details));
  // Page visits are kept for a year; changes, logins and exports are kept for good.
  if (Math.random() < 0.002) run("DELETE FROM audit_log WHERE action = 'VIEW' AND created_at < datetime('now', '-365 days')").catch(() => {});
}

function activityLog(req, res, next) {
  const ctx = { ip: clientIp(req), audited: false, path: String(req.originalUrl || req.url || '').split('?')[0] };
  res.on('finish', () => { record(req, res, ctx).catch(e => console.error('[activity]', e.message)); });
  auditCtx.run(ctx, next);
}

module.exports = { activityLog, clientIp };
