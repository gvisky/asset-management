/* Virtual servers — the VMs and hypervisor hosts of a site (Server Inventory → Virtual servers tab).
   Filled from the "VM SERVER" sheet of the Factory Info workbook (Network map → ⬆ Import Factory Info), kept up to date by hand.
     GET    /api/virtual-servers?search=&kind=&it_ot=   list (your countries)
     POST   /api/virtual-servers                        add          (admins / editors)
     PUT    /api/virtual-servers/:id                    edit         (admins / editors)
     DELETE /api/virtual-servers/:id                    delete       (admins) */

const express = require('express');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { inScope, countrySql } = require('../lib/scope');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access !== 0 ? next() : res.status(403).json({ error: 'No access to Asset Inventory' })));
const str = (v, n = 160) => String(v == null ? '' : v).trim().slice(0, n);
const COLS = ['country', 'hostname', 'ref_key', 'status', 'kind', 'ip', 'infra_ip', 'farm', 'system_type', 'it_ot', 'platform', 'os', 'os_version', 'domain', 'sap',
  'usage', 'description', 'impact', 'backup', 'host_model', 'serial', 'cpu', 'memory', 'location', 'notes'];
const clean = (b) => Object.fromEntries(COLS.filter(k => k in b).map(k => [k, str(b[k], ['description', 'impact', 'notes'].includes(k) ? 600 : 160)]));

router.get('/', wrap(async (req, res) => {
  const cf = countrySql(req, 'v.country'), where = [], args = [];
  if (cf.clause) { where.push(cf.clause); args.push(...cf.params); }
  const q = str(req.query.search, 80);
  if (q) { where.push('(v.hostname LIKE ? OR v.ip LIKE ? OR v.os LIKE ? OR v.usage LIKE ? OR v.description LIKE ? OR v.farm LIKE ?)'); args.push(...Array(6).fill(`%${q}%`)); }
  if (req.query.kind) { where.push('v.kind = ?'); args.push(str(req.query.kind, 20)); }
  if (req.query.it_ot) { where.push('v.it_ot = ?'); args.push(str(req.query.it_ot, 10)); }
  const rows = await all(`SELECT v.*, s.hostname AS server_hostname, s.brand_model AS server_model FROM virtual_servers v LEFT JOIN servers s ON s.id = v.server_id AND s.deleted_at IS NULL
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.kind DESC, v.hostname`, args);
  res.json({ rows, can: { edit: ['admin', 'editor'].includes(req.user.role), admin: req.user.role === 'admin' } });
}));

router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const b = clean(req.body || {}); b.country = b.country || 'Vietnam';
  if (!b.hostname) return res.status(400).json({ error: 'Hostname is required' });
  if (!inScope(req, b.country)) return res.status(403).json({ error: 'Not in your region' });
  if (await get('SELECT id FROM virtual_servers WHERE country = ? AND UPPER(hostname) = UPPER(?)', [b.country, b.hostname])) return res.status(409).json({ error: 'This hostname already exists' });
  const cols = Object.keys(b);
  await run(`INSERT INTO virtual_servers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => b[k]));
  await audit(req.user, 'CREATE', null, `Virtual server ${b.hostname} added`);
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
  res.json(await get('SELECT * FROM virtual_servers WHERE id = ?', [ex.id]));
}));

router.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const ex = await get('SELECT * FROM virtual_servers WHERE id = ?', [Number(req.params.id)]);
  if (!ex) return res.status(404).json({ error: 'Not found' });
  if (!inScope(req, ex.country)) return res.status(403).json({ error: 'Not in your region' });
  await run('DELETE FROM virtual_servers WHERE id = ?', [ex.id]);
  await audit(req.user, 'DELETE', null, `Virtual server ${ex.hostname} deleted`);
  res.json({ ok: true });
}));

module.exports = router;
