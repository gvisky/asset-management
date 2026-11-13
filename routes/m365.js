/* Microsoft 365 licence reclaim list.

   Source: the Microsoft 365 admin centre "Active users" usage report (Reports → Usage → Active users →
   Export), the same data as Graph getOffice365ActiveUserDetail: per user the assigned products and the
   last activity date of each service (Exchange, OneDrive, SharePoint, Teams …). Columns are found by
   name pattern, so small wording changes don't break the upload. Later this can come from Graph directly.

   Reclaim list = users with a paid licence and no activity in any service for N days (default 60), or
   never active, plus leavers (leaving date passed / marked for delete in User Inventory) still licensed.

   POST /api/m365/upload    { file_base64, filename }  global IT admin — replaces the stored report
   GET  /api/m365/reclaim?days=60                       your countries */

const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { get, all, run, batch, audit } = require('../db/database');
const { requireAuth, isITAdmin } = require('../middleware/auth');
const { scopeList, inScope } = require('../lib/scope');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0 ? res.status(403).json({ error: 'No access' }) : next()));

const day = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;   // M/D/YYYY (admin centre)
  return '';
};
const yes = (v) => /^(true|yes|1)$/i.test(String(v == null ? '' : v).trim());

router.post('/upload', wrap(async (req, res) => {
  if (!isITAdmin(req.user) || scopeList(req)) return res.status(403).json({ error: 'Only a global IT admin can upload the Microsoft 365 report (it covers every country)' });
  const b64 = String((req.body || {}).file_base64 || '');
  if (!b64) return res.status(400).json({ error: 'No file' });
  let rows;
  try {
    const wb = XLSX.read(Buffer.from(b64, 'base64'), { type: 'buffer', raw: false, cellDates: false });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
  } catch { return res.status(400).json({ error: 'Could not read the file (CSV or Excel export of "Active users")' }); }
  if (!rows.length) return res.status(400).json({ error: 'The file is empty' });
  const heads = Object.keys(rows[0]);
  const find = (re) => heads.find(h => re.test(String(h).trim()));
  const H = { upn: find(/user\s*principal\s*name|^upn$/i), name: find(/display\s*name/i), deleted: find(/^is\s*deleted/i),
    products: find(/assigned\s*products/i), refresh: find(/report\s*refresh\s*date/i) };
  if (!H.upn) return res.status(400).json({ error: 'No "User Principal Name" column — export Reports → Usage → Active users from the Microsoft 365 admin centre' });
  const actCols = heads.map(h => ({ h, m: String(h).match(/^(.+?)\s*last\s*activity\s*date/i) })).filter(x => x.m).map(x => ({ h: x.h, svc: x.m[1].trim() }));
  const licCols = heads.filter(h => /^has\s+.+\s+licen[cs]e$/i.test(String(h).trim()));
  if (!actCols.length) return res.status(400).json({ error: 'No "… Last Activity Date" columns found in this file' });

  const out = [];
  let concealed = 0;
  for (const r of rows) {
    const upn = String(r[H.upn] || '').trim().toLowerCase();
    if (!upn) continue;
    if (/^[0-9a-f]{32}$/i.test(upn)) concealed++;
    const activity = {};
    for (const c of actCols) { const d = day(r[c.h]); if (d) activity[c.svc] = d; }
    const last = Object.values(activity).sort().pop() || '';
    const products = H.products ? String(r[H.products] || '').trim() : '';
    const licensed = products ? 1 : (licCols.some(h => yes(r[h])) ? 1 : 0);
    out.push([upn, String(H.name ? r[H.name] : '').trim(), products, licensed, last, JSON.stringify(activity),
      H.deleted && yes(r[H.deleted]) ? 1 : 0, H.refresh ? day(r[H.refresh]) : '']);
  }
  if (concealed > out.length / 2) {
    return res.status(400).json({ error: 'User names are hidden in this report. In the Microsoft 365 admin centre: Settings → Org settings → Reports → untick "Display concealed user, group, and site names", then export again.' });
  }
  const stmts = [{ sql: 'DELETE FROM m365_users', args: [] },
    ...out.map(v => ({ sql: 'INSERT OR REPLACE INTO m365_users (upn, display_name, products, licensed, last_activity, activity, is_deleted, report_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: v }))];
  await batch(stmts, 200);
  await audit(req.user, 'IMPORT', null, `Uploaded Microsoft 365 Active users report: ${out.length} users (${out.filter(v => v[3]).length} licensed)`);
  res.json({ ok: true, users: out.length, licensed: out.filter(v => v[3]).length, services: actCols.map(c => c.svc) });
}));

/** Reclaim list for the user's countries (page and Reports → Licence reclaim). */
async function computeReclaim(req, daysIn) {
  const days = Math.min(365, Math.max(7, Number(daysIn) || 60));
  const meta = await get('SELECT COUNT(*) AS n, MAX(report_date) AS report_date, MAX(uploaded_at) AS uploaded_at, SUM(licensed) AS licensed FROM m365_users');
  if (!Number(meta.n)) return { empty: true, days, list: [], byProduct: {}, canUpload: isITAdmin(req.user) && !scopeList(req) };
  const asOf = meta.report_date || String(meta.uploaded_at || '').slice(0, 10);
  const cutoff = new Date(Date.parse(asOf) - days * 86400000).toISOString().slice(0, 10);
  const rows = await all(`SELECT m.*, p.id AS person_id, p.display_name AS person_name, p.country, p.department, p.status AS person_status,
        p.leaving_date, p.ad_resource
      FROM m365_users m LEFT JOIN personnel p ON LOWER(p.email) = m.upn
      WHERE m.licensed = 1 AND m.is_deleted = 0`);
  const today = new Date().toISOString().slice(0, 10);
  const list = [];
  for (const r of rows) {
    const country = r.country || '';
    if (country ? !inScope(req, country) : !!scopeList(req)) continue;
    const leaver = !!((r.leaving_date && r.leaving_date <= today) || ['to be delete', 'pending delete', 'deleted'].includes(r.person_status));
    const inactive = !r.last_activity || r.last_activity < cutoff;
    if (!leaver && !inactive) continue;
    const daysIdle = r.last_activity ? Math.floor((Date.parse(asOf) - Date.parse(r.last_activity)) / 86400000) : null;
    list.push({ upn: r.upn, name: r.person_name || r.display_name, country: country || '(not in User Inventory)', department: r.department || '',
      products: r.products, last_activity: r.last_activity, days_idle: daysIdle, never: !r.last_activity,
      leaver, leaving_date: r.leaving_date || '', person_status: r.person_status || '', resource: r.ad_resource === 1,
      reason: leaver ? 'Leaver still licensed' : (r.last_activity ? `No activity ${daysIdle} days` : 'Never active'),
      activity: (() => { try { return JSON.parse(r.activity || '{}'); } catch { return {}; } })() });
  }
  list.sort((a, b) => (b.leaver - a.leaver) || ((b.days_idle == null ? 1e9 : b.days_idle) - (a.days_idle == null ? 1e9 : a.days_idle)));
  // Licences that could be freed, per product (a user can hold several).
  const byProduct = {};
  for (const r of list) for (const p of String(r.products || '').split(/\s*\+\s*|\s*,\s*/).filter(Boolean)) byProduct[p] = (byProduct[p] || 0) + 1;
  return { days, asOf, uploaded_at: meta.uploaded_at, licensed: Number(meta.licensed || 0), users: Number(meta.n),
    list, byProduct, canUpload: isITAdmin(req.user) && !scopeList(req) };
}
router.get('/reclaim', wrap(async (req, res) => res.json(await computeReclaim(req, req.query.days))));

module.exports = router;
module.exports.computeReclaim = computeReclaim;
