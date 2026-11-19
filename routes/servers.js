const express = require('express');
const router = express.Router();
const { get, all, run, audit, notify } = require('../db/database');
const { requireAuth, requireRole, requireITAdmin } = require('../middleware/auth');

const { normCountry } = require('../lib/countries');
const { knownCountries } = require('../lib/country-list');
const { scopeList, inScope, countrySql, singleScope, resolveScopedCountry } = require('../lib/scope');
const HISTORY_OWNER = process.env.HISTORY_OWNER || 'viet';

// Identity fields that only IT may edit; editing one locks the record until an IT admin unlocks it.
const PROTECTED_FIELDS = { serial_no: 'Serial', brand_model: 'Brand/Model', asset_code: 'Asset Code' };

router.use(requireAuth);
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) {
    return res.status(403).json({ error: 'No access to Asset Inventory' });
  }
  next();
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const countryFilter = (req) => countrySql(req, 'country');

// ── GET /api/servers — list ───────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const { search = '', status = '', location = '', role = '', category = '', producer = '', page = 1, limit = 50 } = req.query;
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  const cf = countryFilter(req);
  if (cf.clause) { conditions.push(cf.clause); params.push(...cf.params); }

  if (search) {
    conditions.push(`(hostname LIKE ? OR brand_model LIKE ? OR serial_no LIKE ? OR
      asset_code LIKE ? OR ip_address LIKE ? OR os LIKE ? OR role LIKE ? OR producer LIKE ? OR category LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like, like, like);
  }
  if (status)   { conditions.push('status = ?');   params.push(status); }
  if (location) { conditions.push('location = ?'); params.push(location); }
  if (role)     { conditions.push('role = ?');     params.push(role); }
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (producer) { conditions.push('producer = ?'); params.push(producer); }

  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);
  const totalRow = await get(`SELECT COUNT(*) as cnt FROM servers ${where}`, params);
  const rows = await all(`SELECT * FROM servers ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]);
  res.json({ total: Number(totalRow.cnt), page: Number(page), limit: Number(limit), data: rows });
}));

// ── GET /api/servers/stats ─────────────────────────────────────────────────────
router.get('/stats', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const live = ['deleted_at IS NULL']; const lp = [];
  if (cf.clause) { live.push(cf.clause); lp.push(...cf.params); }
  const where = 'WHERE ' + live.join(' AND ');
  const total = Number((await get(`SELECT COUNT(*) as cnt FROM servers ${where}`, lp)).cnt);
  const byStatus = (await all(`SELECT status, COUNT(*) as cnt FROM servers ${where} GROUP BY status`, lp))
    .reduce((a, r) => { a[r.status] = Number(r.cnt); return a; }, {});
  const warCond = [...live, "warranty_expiry <> ''", "date(warranty_expiry) <= date('now','+90 days')"];
  const warrantyExpiring = Number((await get(`SELECT COUNT(*) as cnt FROM servers WHERE ${warCond.join(' AND ')}`, lp)).cnt);
  res.json({ total, byStatus, warrantyExpiring, scope: singleScope(req) });
}));

// ── GET /api/servers/filters ────────────────────────────────────────────────────
router.get('/filters', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const extra = cf.clause ? ` AND ${cf.clause}` : '';
  const roles = (await all(`SELECT DISTINCT role AS v FROM servers WHERE deleted_at IS NULL AND role <> ''${extra} ORDER BY role COLLATE NOCASE`, cf.params)).map(r => r.v);
  const categories = (await all(`SELECT DISTINCT category AS v FROM servers WHERE deleted_at IS NULL AND category <> ''${extra} ORDER BY category COLLATE NOCASE`, cf.params)).map(r => r.v);
  const producers = (await all(`SELECT DISTINCT producer AS v FROM servers WHERE deleted_at IS NULL AND producer <> ''${extra} ORDER BY producer COLLATE NOCASE`, cf.params)).map(r => r.v);
  const countries = scopeList(req) || await knownCountries();
  res.json({ roles, categories, producers, countries });
}));

// ── GET /api/servers/needs-info — Needs Attention for Server Inventory ───────────
// Network devices / servers need Serial, Hostname, IP and Location (access points: Serial); also the
// same serial twice and a serial that differs from the implementation document (network map).
// Country-scoped; Broken devices are skipped. { rows: [{ server…, issues: [], doc_note }], counts, models }
// ── GET /api/servers/usage — used / stock per model, from the network mapping ─────────────────
// Used = the record is a device of the network map (linked, or the same serial) that is not retired.
// Stock = not in the mapping (and not broken). Flags: "Active but not in the mapping", "Stock but in the mapping".
router.get('/usage', wrap(async (req, res) => {
  const nm = require('./netmap'), { familyOf, normSn } = nm.util;
  const cf = countryFilter(req);
  const servers = await all(`SELECT id, hostname, brand_model, category, serial_no, status, location, country, ip_address FROM servers WHERE deleted_at IS NULL${cf.clause ? ' AND ' + cf.clause : ''}`, cf.params);
  const devs = await all("SELECT id, site, hostname, role, model, serial, service_tag, location, server_id, COALESCE(state, '') AS state FROM net_devices");
  const key = (sn) => normSn(sn).replace(/^0+/, '').replace(/^S(?=[A-Z]{3}\d)/, '');
  const bySn = new Map(); for (const d of devs) for (const sn of [d.serial, d.service_tag]) if (key(sn)) bySn.set(key(sn), d);
  const byLink = new Map(devs.filter(d => d.server_id).map(d => [d.server_id, d]));
  // Same device written two ways: "K7-AP6_OUTDOOR" = "K7-AP6-OUTDOOR".
  const HK = (h) => String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byHost = new Map(devs.map(d => [HK(d.hostname), d]));
  // Names cabled on a switch port in the port sheets (APs, printers … that are not map devices themselves).
  const ports = await all("SELECT p.peer_host, p.port, d.hostname AS sw FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE p.peer_host <> ''");
  const onPort = new Map(); for (const pt of ports) if (!onPort.has(HK(pt.peer_host))) onPort.set(HK(pt.peer_host), pt);
  const fam = new Map(), rows = [];
  for (const s of servers) {
    let d = byLink.get(s.id) || bySn.get(key(s.serial_no)) || null, how = d ? 'serial' : '';
    if (!d && HK(s.hostname).length > 3 && byHost.has(HK(s.hostname))) { d = byHost.get(HK(s.hostname)); how = 'hostname'; }
    const pt = !d && HK(s.hostname).length > 3 ? onPort.get(HK(s.hostname)) : null;
    const used = (!!d && d.state !== 'retired') || !!pt;
    const f = familyOf(s.brand_model) || s.category || s.brand_model || 'Other';
    const state = s.status === 'Broken' ? 'broken' : used ? 'used' : 'stock';
    const snDiff = how === 'hostname' && key(d.serial) && key(s.serial_no) && key(d.serial) !== key(s.serial_no) ? `serial differs: map ${d.serial}, record ${s.serial_no}` : '';
    const flag = used && s.status === 'Stock' ? 'Stock but in the mapping' : !used && s.status === 'Active' ? (d ? 'Active but retired in the map' : 'Active but not in the mapping') : snDiff;
    rows.push({ id: s.id, family: f, hostname: s.hostname, brand_model: s.brand_model, serial_no: s.serial_no, status: s.status, location: s.location, country: s.country,
      state, flag, map: d ? { hostname: d.hostname, site: d.site, location: d.location, role: d.role, retired: d.state === 'retired', how }
        : pt ? { hostname: pt.peer_host, location: `cabled on ${pt.sw} ${pt.port}`, how: 'port' } : null });
    if (!fam.has(f)) fam.set(f, { family: f, total: 0, used: 0, stock: 0, broken: 0, flags: 0 });
    const x = fam.get(f); x.total++; x[state]++; if (flag) x.flags++;
  }
  // Quantity in the implementation document (equipment list) and map devices with no inventory record.
  let doc = null; try { const site = await get('SELECT site FROM net_devices GROUP BY site ORDER BY COUNT(*) DESC LIMIT 1'); if (site) doc = await nm.inventoryCheck(site.site); } catch { doc = null; }
  if (doc) for (const m of doc.models) { const x = fam.get(m.family); if (x) x.doc_qty = m.doc_qty; }
  const matched = new Set(rows.filter(r => r.map).map(r => HK(r.map.hostname)));
  const missing = devs.filter(d => d.state !== 'retired' && !matched.has(HK(d.hostname)) && familyOf(`${d.model} ${d.hostname}`) && !['Printer'].includes(d.role))
    .map(d => ({ hostname: d.hostname, model: d.model, serial: d.serial || d.service_tag, family: familyOf(`${d.model} ${d.hostname}`) }));
  const families = [...fam.values()].sort((a, b) => b.total - a.total);
  res.json({ families, rows, missing, totals: { total: rows.length, used: rows.filter(r => r.state === 'used').length, stock: rows.filter(r => r.state === 'stock').length, broken: rows.filter(r => r.state === 'broken').length, flags: rows.filter(r => r.flag).length } });
}));

router.get('/needs-info', wrap(async (req, res) => {
  const cf = countryFilter(req);
  const rows = await all(`SELECT id, hostname, brand_model, category, serial_no, ip_address, location, status, country FROM servers
      WHERE deleted_at IS NULL AND status <> 'Broken'${cf.clause ? ' AND ' + cf.clause : ''} ORDER BY category, brand_model, id`, cf.params);
  let doc = null;
  try { const site = await get('SELECT site FROM net_devices GROUP BY site ORDER BY COUNT(*) DESC LIMIT 1'); if (site) doc = await require('./netmap').inventoryCheck(site.site); } catch { doc = null; }
  const sn = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cnt = new Map(); rows.forEach(s => { const n = sn(s.serial_no); if (n) cnt.set(n, (cnt.get(n) || 0) + 1); });
  const docIssue = new Map((doc ? doc.issues : []).map(i => [i.id, i.problems.find(p => /document's serial there is|which has no serial/.test(p))]).filter(([, p]) => p));
  const out = [];
  for (const s of rows) {
    const t = [], ap = /access point/i.test(s.category || '');
    if (!sn(s.serial_no)) t.push('Serial');
    if (!ap) { if (!String(s.hostname || '').trim()) t.push('Hostname'); if (!String(s.ip_address || '').trim()) t.push('IP'); if (!String(s.location || '').trim()) t.push('Location'); }
    if (sn(s.serial_no) && cnt.get(sn(s.serial_no)) > 1) t.push('Dup Serial');
    if (docIssue.has(s.id)) t.push('Serial ≠ document');
    if (t.length) out.push({ ...s, issues: t, doc_note: docIssue.get(s.id) || '' });
  }
  const counts = {}; out.forEach(r => r.issues.forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
  const byCountry = {}; out.forEach(r => { byCountry[r.country] = (byCountry[r.country] || 0) + 1; });
  res.json({ total: out.length, counts, byCountry, rows: out, models: doc ? doc.models.filter(m => m.status === 'missing' || m.status === 'extra') : [], has_doc: !!doc });
}));

// ── GET /api/servers/:id ─────────────────────────────────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Server not found' });
  if (!inScope(req, row.country)) return res.status(403).json({ error: 'Not in your region' });
  res.json(row);
}));

function resolveCountry(req, requested) {
  return resolveScopedCountry(req, normCountry(requested), 'Vietnam');
}

const FIELDS = ['location', 'hostname', 'brand_model', 'producer', 'category', 'serial_no', 'asset_code', 'ip_address',
  'os', 'cpu', 'ram', 'storage', 'role', 'status', 'purchase_date', 'warranty_expiry',
  'vendor', 'cost', 'po_number', 'remark'];

// ── POST /api/servers — create (admin/editor) ─────────────────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const v = {};
  FIELDS.forEach(f => v[f] = req.body[f] != null ? req.body[f] : '');
  if (!v.status) v.status = 'Active';
  const finalCountry = resolveCountry(req, req.body.country);
  const history_usage = req.body.history_usage || '';

  const cols = ['country', ...FIELDS, 'history_usage'];
  const vals = [finalCountry, ...FIELDS.map(f => v[f]), history_usage];
  const result = await run(
    `INSERT INTO servers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  const created = await get('SELECT * FROM servers WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'CREATE', created.id, `Created server "${created.hostname || created.asset_code || 'untitled'}" (${finalCountry})`);
  res.status(201).json(created);
}));

// ── PUT /api/servers/:id — update (admin/editor); history is owner-only ───────
router.put('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });
  if (!inScope(req, existing.country)) return res.status(403).json({ error: 'Not in your region' });

  const finalCountry = resolveCountry(req, req.body.country !== undefined ? req.body.country : existing.country);
  const incoming = { country: finalCountry };
  FIELDS.forEach(f => { if (req.body[f] !== undefined) incoming[f] = req.body[f]; });

  // Edit log baked into history_usage (owner-only direct edit).
  const LABELS = { location: 'Location', country: 'Country', hostname: 'Hostname', brand_model: 'Brand/Model',
    serial_no: 'Serial', asset_code: 'Asset Code', ip_address: 'IP', os: 'OS', cpu: 'CPU', ram: 'RAM',
    storage: 'Storage', role: 'Role', status: 'Status', purchase_date: 'Purchase Date',
    warranty_expiry: 'Warranty', vendor: 'Vendor', cost: 'Cost', po_number: 'PO Number', remark: 'Remark' };
  const norm = (x) => String(x == null ? '' : x).trim();
  const changes = [];
  for (const [k, lbl] of Object.entries(LABELS)) {
    if (incoming[k] === undefined) continue;
    if (norm(existing[k]) !== norm(incoming[k])) changes.push(`${lbl}: "${norm(existing[k]) || '∅'}"→"${norm(incoming[k]) || '∅'}"`);
  }
  // ── Protected-field lock (Serial / Brand-Model / Asset Code) ───────────────
  const protectedChanged = Object.keys(PROTECTED_FIELDS).filter(
    (k) => incoming[k] !== undefined && norm(existing[k]) !== norm(incoming[k]));
  if (protectedChanged.length) {
    if (existing.fields_locked) {
      return res.status(403).json({ error: 'Serial, Brand/Model and Asset Code are locked. An IT admin must unlock this record first.' });
    }
    if (req.user.team !== 'IT') {
      return res.status(403).json({ error: 'Only IT members can edit Serial, Brand/Model or Asset Code.' });
    }
  }

  const canEditHistory = req.user.username === HISTORY_OWNER;
  let newHistory = (canEditHistory && req.body.history_usage !== undefined) ? req.body.history_usage : existing.history_usage;
  if (changes.length) {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const line = `${ts} UTC: edited ${changes.join('; ')} by ${req.user.username}`;
    newHistory = newHistory ? `${newHistory}\n${line}` : line;
  }

  // Editing a protected field locks the record and records the action.
  let lockNow = existing.fields_locked;
  if (protectedChanged.length) {
    lockNow = 1;
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const lockLine = `${ts} UTC: 🔒 locked ${protectedChanged.map((k) => PROTECTED_FIELDS[k]).join(', ')} after edit by ${req.user.username}`;
    newHistory = newHistory ? `${newHistory}\n${lockLine}` : lockLine;
  }

  const setFields = ['country', ...FIELDS, 'history_usage', 'fields_locked'];
  const setVals = [finalCountry, ...FIELDS.map(f => (req.body[f] !== undefined ? req.body[f] : existing[f])), newHistory, lockNow];
  await run(
    `UPDATE servers SET ${setFields.map(c => c + ' = ?').join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    [...setVals, req.params.id]);
  const updated = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  await audit(req.user, 'UPDATE', updated.id, `Updated server "${updated.hostname || updated.asset_code || 'untitled'}"`);
  res.json(updated);
}));

// ── DELETE /api/servers/:id — soft delete (admin/editor) ──────────────────────
router.delete('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });
  if (!inScope(req, existing.country)) return res.status(403).json({ error: 'Not in your region' });
  await run("UPDATE servers SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?", [req.user.username, req.params.id]);
  const label = existing.hostname || existing.asset_code || 'untitled';
  await audit(req.user, 'DELETE', Number(req.params.id), `Deleted server "${label}"`);
  await notify({ audience: 'all', country: existing.country, scope: 'asset', level: 'warning',
    message: `${req.user.full_name} deleted server "${label}" [${existing.country}].` });
  res.json({ message: 'Deleted' });
}));

// ── POST /api/servers/:id/unlock — IT admin re-opens the protected fields ─────
router.post('/:id/unlock', requireITAdmin, wrap(async (req, res) => {
  const existing = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });
  if (!inScope(req, existing.country)) return res.status(403).json({ error: 'Not in your region' });
  if (!existing.fields_locked) return res.json({ message: 'already unlocked', fields_locked: 0 });

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `${ts} UTC: 🔓 unlocked Serial/Brand-Model/Asset Code by ${req.user.username}`;
  const newHistory = existing.history_usage ? `${existing.history_usage}\n${line}` : line;
  await run('UPDATE servers SET fields_locked = 0, history_usage = ? WHERE id = ?', [newHistory, req.params.id]);
  await audit(req.user, 'UNLOCK', Number(req.params.id),
    `Unlocked protected fields for "${existing.hostname || existing.asset_code || 'untitled'}"`);
  res.json({ message: 'unlocked', fields_locked: 0 });
}));

module.exports = router;
