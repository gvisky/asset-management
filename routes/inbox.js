/* Inbox (docs/UX-REDESIGN.md, phase 2): ONE list of everything to fix, with counts per area.
   It does not hold rules of its own: it asks the existing "needs attention" endpoints, as the signed-in user (same
   cookie → same role, team and countries), and keeps only the counts. Cached a short time per user.

     GET /api/inbox            → { total, areas: [{ key, title, team, href, items: [{ key, label, count, href, hint }] }], at }
     GET /api/inbox?count=1    → { total }   (menu badge)
     GET /api/inbox?fresh=1    → recompute now */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const TTL = 120 * 1000;
const cache = new Map();   // user id → { at, data }

router.use(requireAuth);

async function call(req, path) {
  const port = req.socket && req.socket.localPort ? req.socket.localPort : (process.env.PORT || 3000);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie: req.headers.cookie || '', 'x-inbox': '1' }, signal: ctl.signal });
    if (!r.ok) return null;   // no access to that area → not in this user's inbox
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function build(req) {
  const u = req.user, team = u.team || '';
  const asset = Number(u.asset_access) !== 0, viewer = u.role === 'viewer';
  const it = team === 'IT', hr = team === 'HR', ot = team === 'OT';
  const jobs = {
    incomplete: asset && !viewer ? call(req, '/api/assets/incomplete') : null,
    ad: asset && !viewer ? call(req, '/api/assets?ad_issue=1&limit=1') : null,
    servers: asset && !viewer ? call(req, '/api/servers/needs-info') : null,
    ot: it || ot ? call(req, '/api/servers/ot-attention') : null,
    leavers: it || hr ? call(req, '/api/leavers') : null,
    health: it ? call(req, '/api/health') : null,
  };
  const r = {}; await Promise.all(Object.entries(jobs).map(async ([k, p]) => { r[k] = p ? await p : null; }));
  const areas = [];
  const area = (key, title, teamName, href, items) => { const list = items.filter(i => i.count > 0); if (list.length) areas.push({ key, title, team: teamName, href, items: list }); };

  if (Array.isArray(r.incomplete) || r.ad) {
    const inc = Array.isArray(r.incomplete) ? r.incomplete : [];
    const dup = inc.filter(x => x.dup_serial).length;
    area('assets', 'Assets', 'IT', '/inbox.html#na-missing', [
      { key: 'missing', label: 'Missing serial, asset code, PC no. or AD name', count: inc.length - dup, href: '/inbox.html#na-missing' },
      { key: 'dup', label: 'Same serial on two or more assets', count: dup, href: '/inbox.html#na-missing' },
      { key: 'ad', label: 'AD account and asset do not match', count: r.ad ? Number(r.ad.total) || 0 : 0, href: '/inbox.html#na-ad' },
    ]);
  }
  if (r.servers) {
    area('servers', 'Servers & network', 'IT', '/inbox.html#na-servers', [
      { key: 'servers', label: 'Servers / network devices missing serial, hostname, IP or location', count: Number(r.servers.total) || 0, href: '/inbox.html#na-servers' },
    ]);
  }
  if (r.ot && Array.isArray(r.ot.groups)) {
    area('ot', 'OT', 'OT', '/ot-attention.html', r.ot.groups.map(g => ({ key: g.key, label: g.title, count: (g.rows || []).length, href: '/ot-attention.html#' + g.key, hint: g.fix })));
  }
  if (r.leavers && Array.isArray(r.leavers.list)) {
    const open = r.leavers.list.filter(p => p.open > 0);
    const late = open.filter(p => p.days_left != null && p.days_left < 0);
    area('people', 'People', 'IT / HR', '/leavers.html', [
      { key: 'leavers_late', label: 'Leavers already gone with open checklist items', count: late.length, href: '/leavers.html' },
      { key: 'leavers_open', label: 'Leavers coming up with open checklist items', count: open.length - late.length, href: '/leavers.html' },
    ]);
  }
  if (r.health) {
    const checks = r.health.checks || [], cols = r.health.collectors || [];
    area('health', 'Monitoring', 'IT', '/system-health.html', [
      { key: 'down', label: 'Systems down', count: checks.filter(c => c.shown_status === 'down').length, href: '/system-health.html' },
      { key: 'warn', label: 'Systems with a warning', count: checks.filter(c => c.shown_status === 'warn').length, href: '/system-health.html' },
      { key: 'offline', label: 'Collectors not reporting', count: cols.filter(c => !c.revoked && !c.online).length, href: '/system-health.html' },
    ]);
  }
  const total = areas.reduce((n, a) => n + a.items.reduce((m, i) => m + i.count, 0), 0);
  return { total, areas, at: new Date().toISOString() };
}

router.get('/', wrap(async (req, res) => {
  if (req.headers['x-inbox']) return res.status(400).json({ error: 'nested' });
  const key = req.user.id;
  let c = cache.get(key);
  if (!c || req.query.fresh || Date.now() - c.at > TTL) {
    c = { at: Date.now(), data: await build(req) };
    cache.set(key, c);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(req.query.count ? { total: c.data.total } : c.data);
}));

module.exports = router;
