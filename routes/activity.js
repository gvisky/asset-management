/* 📜 Audit log & activities — ONE timeline of every log the app keeps, grouped by area (global admins).

   Sources (tables) and how they are used here:
     audit_log      the master log: sign-ins, every change, export, import, page visit (lib/activity.js + audit())
     health_events  monitoring status changes (system, no user)                         — only here
     qr_scans       every QR label / stocktake scan                                       — only here
     net_port_log   Network map device / port history. Device-level lines (added, edited, OT view) are only here;
                    port-level lines DUPLICATE the audit 'NETMAP' entry → shown only with ?detail=1
     ot_activity    OT device / OT port changes with before → after for restore. DUPLICATES the audit entries
                    (UPDATE / NETMAP) → shown only with ?detail=1 (restore stays on the OT activity page)
   Not merged (kept where they are): history_usage on each asset / server (the record's own trail, also in the audit
   log), notifications (messages to people, made from the same events), asset_confirmations (audited as CONFIRM_*).

     GET /api/activity?area=a,b&user=&q=&from=&to=&views=1&detail=1&page=&limit=   → { rows, total, areas, users }
     GET /api/activity/export.csv?…  (same filters, max 50 000 rows) */
const express = require('express');
const router = express.Router();
const { get, all } = require('../db/database');
const { requireGlobalAdmin } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireGlobalAdmin);

// Area of an audit entry, from its action (and the details for the generic CREATE / UPDATE / DELETE).
const AREA_SQL = `CASE
  WHEN src = 'health' THEN 'Monitoring'
  WHEN src = 'scan' THEN 'Stocktake & labels'
  WHEN src = 'portlog' THEN 'Network map'
  WHEN src = 'ot' THEN 'OT'
  WHEN action IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'MFA', 'PASSWORD') THEN 'Sign-in & security'
  WHEN action = 'USER' THEN 'Users & access'
  WHEN action = 'VIEW' THEN 'Page visits'
  WHEN action = 'EXPORT' THEN 'Exports'
  WHEN action = 'NETMAP' THEN 'Network map'
  WHEN action IN ('PERSONNEL', 'CONFIRM_ASSET', 'CONFIRM_LINK', 'CONFIRM_REFUSED', 'LEAVER') THEN 'People'
  WHEN action = 'LICENSE' THEN 'Licenses'
  WHEN action = 'MAINTENANCE' THEN 'Maintenance'
  WHEN action IN ('STOCKTAKE', 'PRINT', 'PHOTO') THEN 'Stocktake & labels'
  WHEN action LIKE 'BUDGET%' THEN 'Budget'
  WHEN action = 'HEALTH' THEN 'Monitoring'
  WHEN action IN ('RESTORE', 'PURGE') THEN 'Recycle bin'
  WHEN action = 'IMPORT' THEN 'Imports'
  WHEN action IN ('CREATE', 'UPDATE', 'DELETE', 'UNLOCK') AND (LOWER(text) LIKE '%server%' OR LOWER(text) LIKE '%network device%') THEN 'Servers & network'
  WHEN action IN ('CREATE', 'UPDATE', 'DELETE', 'UNLOCK', 'CATALOG', 'WARRANTY', 'DISPOSE', 'REUSE', 'RETURN', 'HANDOVER') THEN 'Assets'
  WHEN action IN ('ACTION', 'REFUSED') THEN 'Other changes'
  ELSE 'Other changes' END`;

function source(q) {
  const parts = [
    `SELECT 'audit' AS src, id, created_at AS at, COALESCE(username, '') AS who, COALESCE(action, '') AS action, COALESCE(details, '') AS text, COALESCE(ip, '') AS ip, asset_id FROM audit_log${q.views === '1' ? '' : " WHERE action <> 'VIEW'"}`,
    `SELECT 'health', id, created_at, 'system', 'STATUS', COALESCE(name, '') || ': ' || COALESCE(from_status, '?') || ' → ' || COALESCE(to_status, '?') || CASE WHEN COALESCE(summary, '') <> '' THEN ' — ' || summary ELSE '' END, '', NULL FROM health_events`,
    `SELECT 'scan', id, scanned_at, COALESCE(scanned_by, ''), 'SCAN', 'Scanned ' || COALESCE(code, '') || ' (' || COALESCE(source, '') || CASE WHEN COALESCE(result, '') <> '' THEN ', ' || result ELSE '' END || ')', COALESCE(ip, ''), asset_id FROM qr_scans`,
    `SELECT 'portlog', id, at, COALESCE(by_user, ''), 'NETMAP_LOG', COALESCE(site, '') || ': ' || COALESCE(device, '') || CASE WHEN COALESCE(port, '') <> '' THEN ' ' || port ELSE '' END || ' — ' || CASE WHEN COALESCE(before, '') <> '' THEN before || ' → ' ELSE '' END || COALESCE(after, ''), '', NULL FROM net_port_log${q.detail === '1' ? '' : " WHERE COALESCE(port, '') = '' AND COALESCE(after, '') <> 'device deleted'"}`,
  ];
  if (q.detail === '1') parts.push(`SELECT 'ot', id, at, COALESCE(by_user, ''), 'OT_CHANGE', COALESCE(label, '') || ': ' || COALESCE(summary, ''), '', NULL FROM ot_activity`);
  return `(SELECT *, ${AREA_SQL} AS area FROM (${parts.join(' UNION ALL ')}))`;
}

function where(q) {
  const cond = [], params = [];
  const areas = String(q.area || '').split(',').map(s => s.trim()).filter(Boolean);
  if (areas.length) { cond.push(`area IN (${areas.map(() => '?').join(', ')})`); params.push(...areas); }
  if (q.user) { cond.push('who = ?'); params.push(String(q.user)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { cond.push('at >= ?'); params.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { cond.push("at < datetime(?, '+1 day')"); params.push(q.to); }
  if (q.q) { const like = `%${String(q.q).trim().toLowerCase()}%`; cond.push('(LOWER(who) LIKE ? OR LOWER(text) LIKE ? OR LOWER(ip) LIKE ? OR LOWER(action) LIKE ?)'); params.push(like, like, like, like); }
  return { w: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

router.get('/', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const src = source(req.query);
  const { w, params } = where(req.query);
  const total = Number((await get(`SELECT COUNT(*) AS c FROM ${src} ${w}`, params)).c);
  const rows = await all(`SELECT * FROM ${src} ${w} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  // Counts per area for the area chips (with the other filters except the area itself).
  const { w: w2, params: p2 } = where({ ...req.query, area: '' });
  const areas = await all(`SELECT area, COUNT(*) AS n FROM ${src} ${w2} GROUP BY area ORDER BY n DESC`, p2);
  const users = await all(`SELECT who, COUNT(*) AS n FROM ${src} GROUP BY who ORDER BY who COLLATE NOCASE`);
  res.json({ rows, total, page, limit, areas, users });
}));

router.get('/export.csv', wrap(async (req, res) => {
  const src = source(req.query);
  const { w, params } = where(req.query);
  const rows = await all(`SELECT * FROM ${src} ${w} ORDER BY at DESC, id DESC LIMIT 50000`, params);
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + ['When (UTC),User,Area,Action,Details,IP,Source'].concat(rows.map(r => [r.at, r.who, r.area, r.action, r.text, r.ip, r.src].map(q).join(','))).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-and-activities-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}));

module.exports = router;
