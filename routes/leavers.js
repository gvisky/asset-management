/* Leavers — return checklist per person (HR and IT).

   Who: people of your countries with a Leaving Date from 120 days ago to 60 days ahead, or marked
   "to be delete" / "pending delete" in User Inventory.
   What to get back / switch off (one row each in leaver_items, remembered):
     asset:<id>    every asset they hold — done automatically when it is returned (e-signed return) or
                   given to someone else; the date counts for the 7-day recovery KPI
     device:<id>   their Intune / Entra devices — tick when wiped / retired
     m365          a Microsoft 365 licence (from the uploaded Active users report) — tick when removed,
                   done automatically when the next report shows no licence
     ad            their AD account — done automatically when they are not in the latest AD list
   Recovery = assets returned within 7 days after the leaving date ÷ assets due (leaving date + 7 days
   already passed). Typical recovery without a process is around 65–75 %; target 95 %.

   GET  /api/leavers                      list with items
   POST /api/leavers/:personId/item       { item, done, note }   IT team
   (recovery() is used by the KPI page) */

const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { countrySql, inScope } = require('../lib/scope');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && (req.user.team === 'IT' || req.user.team === 'HR') ? next()
  : res.status(403).json({ error: 'Leavers is for HR and IT members' })));

const RECOVERY_DAYS = 7;
const localPart = (e) => String(e || '').split('@')[0].trim().toLowerCase();
const plusDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** Build (and remember) the checklist of the given people; returns them with their items. */
async function checklists(people) {
  if (!people.length) return [];
  const adLast = (await get("SELECT value FROM app_meta WHERE key = 'ad_last_import'") || {}).value || null;
  const assets = await all(`SELECT id, asset_s4, asset_code, asset_type, brand_model, serial_no, user_name, ad_name, status, country
      FROM assets WHERE deleted_at IS NULL AND (TRIM(COALESCE(user_name, '')) <> '' OR TRIM(COALESCE(ad_name, '')) <> '')`);
  const byAd = new Map(), byName = new Map();
  for (const a of assets) {
    const k = String(a.ad_name || '').trim().toLowerCase(); if (k) { if (!byAd.has(k)) byAd.set(k, []); byAd.get(k).push(a); }
    const n = String(a.user_name || '').trim().toLowerCase(); if (n) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(a); }
  }
  const ids = people.map(p => p.id);
  const ph = ids.map(() => '?').join(',');
  const devices = await all(`SELECT id, name, os, model, serial_no, person_id FROM devices WHERE person_id IN (${ph})`, ids).catch(() => []);
  const items = await all(`SELECT * FROM leaver_items WHERE person_id IN (${ph})`, ids);
  const returns = await all(`SELECT asset_id, person_id, MAX(signed_at) AS at, MAX(id) AS doc_id FROM asset_docs WHERE kind = 'return' AND person_id IN (${ph}) GROUP BY asset_id, person_id`, ids);
  const m365 = new Map((await all('SELECT upn, licensed, products FROM m365_users')).map(r => [r.upn, r]));
  const stmts = [];
  const out = [];
  for (const p of people) {
    const mine = new Map();
    for (const a of [...(byAd.get(localPart(p.email)) || []), ...(byName.get(String(p.display_name || '').trim().toLowerCase()) || [])]) mine.set(a.id, a);
    const have = new Map(items.filter(i => i.person_id === p.id).map(i => [i.item, i]));
    const due = p.leaving_date || today();
    const list = [];
    const add = (item, label, auto) => {
      let row = have.get(item);
      if (!row) { row = { person_id: p.id, item, label, due_date: due, done_at: null, done_by: '', note: '' };
        stmts.push({ sql: 'INSERT OR IGNORE INTO leaver_items (person_id, item, label, due_date) VALUES (?, ?, ?, ?)', args: [p.id, item, label, due] }); }
      if (auto && !row.done_at) { row.done_at = auto.at; row.done_by = auto.by; row.note = auto.note || row.note;
        stmts.push({ sql: 'UPDATE leaver_items SET done_at = ?, done_by = ?, note = ? WHERE person_id = ? AND item = ? AND done_at IS NULL', args: [auto.at, auto.by, row.note, p.id, item] }); }
      list.push({ ...row, label: row.label || label });
      have.delete(item);
    };
    // Assets held now, and assets on the list that are no longer held (returned / reassigned).
    for (const a of mine.values()) add(`asset:${a.id}`, `${a.asset_type || 'Asset'} ${a.brand_model || ''} · ${a.asset_s4 || a.asset_code || '#' + a.id} · SN ${a.serial_no || '—'}`.replace(/\s+/g, ' ').trim(), null);
    for (const [item, row] of [...have]) {
      if (!item.startsWith('asset:')) continue;
      const aid = Number(item.slice(6));
      const ret = returns.find(r => r.asset_id === aid && r.person_id === p.id);
      add(item, row.label, ret ? { at: String(ret.at).slice(0, 19), by: 'e-signed return', note: `PDF #${ret.doc_id}` }
        : { at: new Date().toISOString().slice(0, 19).replace('T', ' '), by: 'system', note: 'no longer assigned to them' });
    }
    for (const d of devices.filter(x => x.person_id === p.id)) add(`device:${d.id}`, `Intune / Entra: ${d.name || ''} · ${d.model || d.os || ''} — wipe / retire`.trim(), null);
    const lic = m365.get(String(p.email || '').toLowerCase());
    if (lic && lic.licensed) add('m365', `Microsoft 365 licence: ${lic.products || 'licensed'} — remove`, null);
    else if (have.has('m365') || (lic && !lic.licensed)) add('m365', 'Microsoft 365 licence — remove', { at: new Date().toISOString().slice(0, 19).replace('T', ' '), by: 'system', note: 'no licence in the latest report' });
    const goneFromAd = adLast && p.ad_seen_at && p.ad_seen_at < adLast;
    if (p.ad_sam || p.ad_seen_at) add('ad', `AD account ${p.ad_sam || localPart(p.email)} — disable`, goneFromAd ? { at: adLast, by: 'system', note: 'not in the latest AD list' } : null);
    for (const [item, row] of have) list.push(row);            // manual extras kept
    out.push({ ...p, items: list });
  }
  if (stmts.length) await batch(stmts, 100);
  return out;
}

/** 7-day recovery per country over the last `days` days (for the KPI page). */
async function recovery(req, days = 365) {
  const cs = countrySql(req, 'p.country', '');
  const since = plusDays(today(), -days);
  const rows = await all(`SELECT p.country, i.due_date, i.done_at FROM leaver_items i JOIN personnel p ON p.id = i.person_id
      WHERE i.item LIKE 'asset:%' AND i.due_date >= ?${cs.clause ? ' AND ' + cs.clause : ''}`, [since, ...cs.params]);
  const per = {};
  for (const r of rows) {
    const deadline = plusDays(r.due_date, RECOVERY_DAYS);
    if (deadline > today() && !r.done_at) continue;            // not due yet
    const c = r.country || 'Unknown';
    per[c] = per[c] || { due: 0, onTime: 0, late: 0, open: 0 };
    per[c].due++;
    if (r.done_at && String(r.done_at).slice(0, 10) <= deadline) per[c].onTime++;
    else if (r.done_at) per[c].late++; else per[c].open++;
  }
  return per;
}

router.get('/', wrap(async (req, res) => {
  const cs = countrySql(req, 'country', '');
  const from = plusDays(today(), -120), to = plusDays(today(), 60);
  const people = await all(`SELECT id, display_name, email, country, department, position, status, leaving_date, ad_sam, ad_seen_at
      FROM personnel WHERE ((leaving_date <> '' AND leaving_date BETWEEN ? AND ?) OR status IN ('to be delete', 'pending delete'))
      ${cs.clause ? 'AND ' + cs.clause : ''} ORDER BY leaving_date`, [from, to, ...cs.params]);
  const list = await checklists(people);
  for (const p of list) {
    p.open = p.items.filter(i => !i.done_at).length;
    p.cleared = p.items.length > 0 && p.open === 0;
    p.days_left = p.leaving_date ? Math.round((Date.parse(p.leaving_date) - Date.parse(today())) / 86400000) : null;
  }
  const rec = await recovery(req);
  res.json({ list, recovery: rec, recoveryDays: RECOVERY_DAYS, canEdit: req.user.team === 'IT' && ['admin', 'editor'].includes(req.user.role),
    canReturn: req.user.asset_access !== 0 && ['admin', 'editor'].includes(req.user.role) });
}));

router.post('/:personId/item', wrap(async (req, res) => {
  if (req.user.team !== 'IT' || !['admin', 'editor'].includes(req.user.role)) return res.status(403).json({ error: 'Only IT (admin / editor) can tick the checklist' });
  const p = await get('SELECT id, display_name, country FROM personnel WHERE id = ?', [req.params.personId]);
  if (!p) return res.status(404).json({ error: 'Person not found' });
  if (!inScope(req, p.country)) return res.status(403).json({ error: 'Not in your region' });
  const b = req.body || {};
  const item = String(b.item || '').slice(0, 80);
  if (!item) return res.status(400).json({ error: 'No item' });
  if (item.startsWith('asset:') && b.done) return res.status(400).json({ error: 'Assets are ticked by the e-signed return (or when the asset gets a new holder)' });
  const done = b.done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
  const r = await run('UPDATE leaver_items SET done_at = ?, done_by = ?, note = ? WHERE person_id = ? AND item = ?',
    [done, done ? req.user.username : '', String(b.note || '').slice(0, 200), p.id, item]);
  if (!r.changes) return res.status(404).json({ error: 'Item not found' });
  await audit(req.user, 'LEAVER', null, `${done ? 'Ticked' : 'Unticked'} "${item}" for leaver ${p.display_name}`);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.recovery = recovery;
