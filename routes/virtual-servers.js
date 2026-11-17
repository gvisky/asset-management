/* Virtual servers — the VMs and hypervisor hosts of a site (Server Inventory → Virtual servers tab).
   Filled from the "VM SERVER" sheet of the Factory Info workbook (Network map → ⬆ Import Factory Info), kept up to date by hand.
     GET    /api/virtual-servers?search=&kind=&it_ot=   list (your countries)
     POST   /api/virtual-servers                        add          (admins / editors)
     PUT    /api/virtual-servers/:id                    edit         (admins / editors)
     DELETE /api/virtual-servers/:id                    delete       (admins)
     GET    /api/virtual-servers/backups?client=&days=  backup jobs (NetBackup OpsCenter "Daily Backups" report), clients not linked to a server
     POST   /api/virtual-servers/backups                { country, report, rows[] } import the jobs of a report e-mail (admins / editors) */

const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { inScope, countrySql } = require('../lib/scope');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access !== 0 ? next() : res.status(403).json({ error: 'No access to Asset Inventory' })));
const str = (v, n = 160) => String(v == null ? '' : v).trim().slice(0, n);
const COLS = ['country', 'hostname', 'ref_key', 'status', 'kind', 'ip', 'infra_ip', 'farm', 'system_type', 'it_ot', 'platform', 'os', 'os_version', 'domain', 'sap',
  'usage', 'description', 'impact', 'backup', 'host_model', 'serial', 'cpu', 'memory', 'location', 'notes', 'backup_client'];
const clean = (b) => Object.fromEntries(COLS.filter(k => k in b).map(k => [k, str(b[k], ['description', 'impact', 'notes'].includes(k) ? 600 : 160)]));

// ── Backups ───────────────────────────────────────────────────────────────────
// A job's client is the server's hostname, or the name the backup software gives an appliance VM. Those three appliances
// are matched by default; any other name can be linked in the Backups window (it is saved as the server's backup_client).
const KEY = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const APPLIANCE = { VXRAILMANAGER: 'VNHCMCESXMGMT', VMWAREVCENTERSERVERAPPLIANCE: 'VNHCMCESXVCSA', VMWAREVREALIZELOGINSIGHT: 'VNHCMCESXLOG' };
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
// "Nov 17, 2026 8:38:49 AM" → "2026-11-17 08:38:49" (time as written in the report)
function when(t) {
  const m = String(t || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) { let h = Number(m[4]) % 12; if (/PM/i.test(m[7] || '')) h += 12; if (!m[7]) h = Number(m[4]);
    const p = (n) => String(n).padStart(2, '0'); return `${m[3]}-${p(MON[m[1].toUpperCase()] || 1)}-${p(m[2])} ${p(h)}:${m[5]}:${m[6] || '00'}`; }
  return /^\d{4}-\d{2}-\d{2}/.test(String(t || '')) ? String(t).slice(0, 19).replace('T', ' ') : '';
}
async function matcher(country) {
  const vms = await all('SELECT id, hostname, backup_client FROM virtual_servers WHERE country = ?', [country]);
  const by = new Map();
  for (const v of vms) { by.set(KEY(v.hostname), v.id); if (v.backup_client) for (const n of v.backup_client.split(/[,;]/)) if (KEY(n)) by.set(KEY(n), v.id); }
  return (client) => by.get(KEY(client)) || (APPLIANCE[KEY(client)] && by.get(APPLIANCE[KEY(client)])) || null;
}
async function relink(country) {
  const find = await matcher(country);
  const jobs = await all('SELECT id, client, vm_id FROM vm_backups WHERE country = ?', [country]);
  const st = jobs.map(j => ({ j, v: find(j.client) })).filter(x => (x.v || null) !== (x.j.vm_id || null)).map(x => ({ sql: 'UPDATE vm_backups SET vm_id = ? WHERE id = ?', args: [x.v, x.j.id] }));
  if (st.length) await batch(st);
}
router.get('/backups', wrap(async (req, res) => {
  const cf = countrySql(req, 'b.country'), where = [], args = [];
  if (cf.clause) { where.push(cf.clause); args.push(...cf.params); }
  const days = Math.min(400, Math.max(1, Number(req.query.days) || 14));
  where.push("b.started_at >= datetime((SELECT MAX(started_at) FROM vm_backups), ?)"); args.push(`-${days} days`);
  if (req.query.client) { where.push('(b.client = ? OR v.hostname = ?)'); args.push(str(req.query.client, 80), str(req.query.client, 80)); }
  const rows = await all(`SELECT b.*, v.hostname AS vm FROM vm_backups b LEFT JOIN virtual_servers v ON v.id = b.vm_id WHERE ${where.join(' AND ')} ORDER BY b.started_at DESC, b.job_id DESC LIMIT 3000`, args);
  const cu = countrySql(req, 'country');
  const unmatched = await all(`SELECT client, COUNT(*) AS jobs, MAX(started_at) AS last FROM vm_backups WHERE vm_id IS NULL${cu.clause ? ' AND ' + cu.clause : ''} GROUP BY client ORDER BY client`, cu.params);
  const reports = await all(`SELECT report, MIN(started_at) AS first, MAX(started_at) AS last, COUNT(*) AS jobs, MAX(imported_at) AS imported_at FROM vm_backups${cu.clause ? ' WHERE ' + cu.clause : ''} GROUP BY report ORDER BY last DESC LIMIT 30`, cu.params);
  res.json({ days, rows, unmatched, reports, can: { edit: ['admin', 'editor'].includes(req.user.role) } });
}));
router.post('/backups', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const country = str(req.body.country, 40) || 'Vietnam';
  if (!inScope(req, country)) return res.status(403).json({ error: 'Not in your region' });
  const rows = (Array.isArray(req.body.rows) ? req.body.rows : []).slice(0, 20000);
  if (!rows.length) return res.status(400).json({ error: 'No backup jobs found in this report' });
  const find = await matcher(country), report = str(req.body.report, 160), before = (await get('SELECT COUNT(*) AS n FROM vm_backups WHERE country = ?', [country])).n;
  const st = [];
  for (const r of rows) {
    const job = str(r.job_id, 30), client = str(r.client, 120); if (!job || !client) continue;
    st.push({ sql: `INSERT INTO vm_backups (country, job_id, client, policy, status, status_code, started_at, ended_at, vm_id, report, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(country, job_id) DO UPDATE SET client = excluded.client, policy = excluded.policy, status = excluded.status, status_code = excluded.status_code,
          started_at = excluded.started_at, ended_at = excluded.ended_at, vm_id = excluded.vm_id`,
      args: [country, job, client, str(r.policy, 120), str(r.status, 40), /^\d+$/.test(String(r.status_code)) ? Number(r.status_code) : null, when(r.started), when(r.ended), find(client), report, req.user.username] });
  }
  await batch(st);
  const after = (await get('SELECT COUNT(*) AS n FROM vm_backups WHERE country = ?', [country])).n;
  const clients = [...new Set(rows.map(r => str(r.client, 120)))], unmatched = clients.filter(c => !find(c));
  const failed = rows.filter(r => Number(r.status_code) > 1 || /fail/i.test(r.status)).length;
  await audit(req.user, 'IMPORT', null, `Virtual servers: backup report "${report}" — ${st.length} jobs (${after - before} new), ${failed} failed, ${unmatched.length} client(s) not linked`);
  res.json({ ok: true, jobs: st.length, added: after - before, failed, clients: clients.length, unmatched });
}));

router.get('/', wrap(async (req, res) => {
  const cf = countrySql(req, 'v.country'), where = [], args = [];
  if (cf.clause) { where.push(cf.clause); args.push(...cf.params); }
  const q = str(req.query.search, 80);
  if (q) { where.push('(v.hostname LIKE ? OR v.ip LIKE ? OR v.os LIKE ? OR v.usage LIKE ? OR v.description LIKE ? OR v.farm LIKE ?)'); args.push(...Array(6).fill(`%${q}%`)); }
  if (req.query.kind) { where.push('v.kind = ?'); args.push(str(req.query.kind, 20)); }
  if (req.query.it_ot) { where.push('v.it_ot = ?'); args.push(str(req.query.it_ot, 10)); }
  if (req.query.status) { where.push("COALESCE(NULLIF(v.status, ''), 'Active') = ?"); args.push(str(req.query.status, 30)); }
  const rows = await all(`SELECT v.*, s.hostname AS server_hostname, s.brand_model AS server_model FROM virtual_servers v LEFT JOIN servers s ON s.id = v.server_id AND s.deleted_at IS NULL
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.kind DESC, v.hostname`, args);
  // Last backup job per server, the last image (whole VM) backup, and failed jobs in the 7 days before the newest report.
  if (rows.length) {
    const ids = rows.map(r => r.id), ph = ids.map(() => '?').join(',');
    const last = await all(`SELECT b.vm_id, b.policy, b.status, b.status_code, b.started_at, b.ended_at FROM vm_backups b
        JOIN (SELECT vm_id, MAX(started_at) AS m FROM vm_backups WHERE vm_id IN (${ph}) GROUP BY vm_id) x ON x.vm_id = b.vm_id AND x.m = b.started_at`, ids);
    const img = await all(`SELECT vm_id, MAX(started_at) AS m FROM vm_backups WHERE vm_id IN (${ph}) AND policy LIKE '%\\_VM\\_%' ESCAPE '\\' AND (status_code IS NULL OR status_code <= 1) GROUP BY vm_id`, ids);
    const fails = await all(`SELECT vm_id, COUNT(*) AS n FROM vm_backups WHERE vm_id IN (${ph}) AND (status_code > 1 OR status LIKE '%fail%') AND started_at >= datetime((SELECT MAX(started_at) FROM vm_backups), '-7 days') GROUP BY vm_id`, ids);
    const cnt = await all(`SELECT vm_id, COUNT(*) AS n FROM vm_backups WHERE vm_id IN (${ph}) GROUP BY vm_id`, ids);
    for (const r of rows) { r.last_backup = last.find(x => x.vm_id === r.id) || null; r.last_image = (img.find(x => x.vm_id === r.id) || {}).m || '';
      r.backup_fails = (fails.find(x => x.vm_id === r.id) || {}).n || 0; r.backup_jobs = (cnt.find(x => x.vm_id === r.id) || {}).n || 0; }
  }
  const newest = await get('SELECT MAX(started_at) AS m FROM vm_backups');
  res.json({ rows, newest_backup: (newest && newest.m) || '', can: { edit: ['admin', 'editor'].includes(req.user.role), admin: req.user.role === 'admin' } });
}));

router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const b = clean(req.body || {}); b.country = b.country || 'Vietnam';
  if (!b.hostname) return res.status(400).json({ error: 'Hostname is required' });
  if (!inScope(req, b.country)) return res.status(403).json({ error: 'Not in your region' });
  if (await get('SELECT id FROM virtual_servers WHERE country = ? AND UPPER(hostname) = UPPER(?)', [b.country, b.hostname])) return res.status(409).json({ error: 'This hostname already exists' });
  const cols = Object.keys(b);
  await run(`INSERT INTO virtual_servers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => b[k]));
  await audit(req.user, 'CREATE', null, `Virtual server ${b.hostname} added`);
  await relink(b.country);
  res.json(await get('SELECT * FROM virtual_servers WHERE country = ? AND hostname = ?', [b.country, b.hostname]));
}));

router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const ex = await get('SELECT * FROM virtual_servers WHERE id = ?', [Number(req.params.id)]);
  if (!ex) return res.status(404).json({ error: 'Not found' });
  if (!inScope(req, ex.country)) return res.status(403).json({ error: 'Not in your region' });
  const b = clean(req.body || {}); delete b.country;
  if ('hostname' in b && !b.hostname) return res.status(400).json({ error: 'Hostname is required' });
  const cols = Object.keys(b); if (!cols.length) return res.json(ex);
  await run(`UPDATE virtual_servers SET ${cols.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, [...cols.map(k => b[k]), ex.id]);
  await audit(req.user, 'UPDATE', null, `Virtual server ${ex.hostname} edited (${cols.join(', ')})`);
  if (cols.includes('hostname') || cols.includes('backup_client')) await relink(ex.country);
  res.json(await get('SELECT * FROM virtual_servers WHERE id = ?', [ex.id]));
}));

router.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const ex = await get('SELECT * FROM virtual_servers WHERE id = ?', [Number(req.params.id)]);
  if (!ex) return res.status(404).json({ error: 'Not found' });
  if (!inScope(req, ex.country)) return res.status(403).json({ error: 'Not in your region' });
  await run('DELETE FROM virtual_servers WHERE id = ?', [ex.id]);
  await run('UPDATE vm_backups SET vm_id = NULL WHERE vm_id = ?', [ex.id]);
  await audit(req.user, 'DELETE', null, `Virtual server ${ex.hostname} deleted`);
  res.json({ ok: true });
}));

module.exports = router;
