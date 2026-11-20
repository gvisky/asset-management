const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit, notify } = require('../db/database');
const OTImport = require('../lib/ot-import');
const { requireAuth, requireRole, requireITAdmin, isITAdmin } = require('../middleware/auth');

const { normCountry } = require('../lib/countries');
const { knownCountries } = require('../lib/country-list');
const { scopeList, inScope, countrySql, singleScope, resolveScopedCountry } = require('../lib/scope');
const HISTORY_OWNER = process.env.HISTORY_OWNER || 'viet';

// Identity fields that only IT may edit; editing one locks the record until an IT admin unlocks it.
const PROTECTED_FIELDS = { serial_no: 'Serial', brand_model: 'Brand/Model', asset_code: 'Asset Code' };

router.use(requireAuth);
// OT team (Operation Technology): only the OT devices (it_ot = 'OT') — list, filters, one record; OT editors may also edit
// an OT record (never an IT one, never delete).
const isOT = (req) => !!req.user && req.user.team === 'OT';
router.use((req, res, next) => {
  if (isOT(req)) {
    if (req.method === 'GET' && !/^\/(stats|usage|needs-info)\b/.test(req.path)) return next();
    if (req.user.role === 'editor' && ((req.method === 'PUT' && /^\/\d+$/.test(req.path)) || (req.method === 'POST' && (req.path === '/' || req.path === '/port-links')))) return next();
    return res.status(403).json({ error: 'OT: the OT devices only (editors can add and edit them)' });
  }
  if (req.user && req.user.asset_access === 0) {
    return res.status(403).json({ error: 'No access to Asset Inventory' });
  }
  next();
});
// IT / OT filter: ?it_ot=IT|OT (OT users always OT). IT = everything not marked OT.
function itOtClause(req) {
  const v = isOT(req) ? 'OT' : String(req.query.it_ot || '').toUpperCase();
  return v === 'OT' ? "COALESCE(it_ot, '') = 'OT'" : v === 'IT' ? "COALESCE(it_ot, '') <> 'OT'" : '';
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const countryFilter = (req) => countrySql(req, 'country');

// ── GET /api/servers — list ───────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const { search = '', status = '', location = '', role = '', category = '', producer = '', page = 1, limit = 50 } = req.query;
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  const cf = countryFilter(req);
  if (cf.clause) { conditions.push(cf.clause); params.push(...cf.params); }

  const io = itOtClause(req); if (io) conditions.push(io);
  if (search) {
    conditions.push(`(hostname LIKE ? OR brand_model LIKE ? OR serial_no LIKE ? OR
      asset_code LIKE ? OR ip_address LIKE ? OR os LIKE ? OR role LIKE ? OR producer LIKE ? OR category LIKE ?
      OR mac LIKE ? OR REPLACE(REPLACE(mac, ':', ''), '-', '') LIKE ? OR vlan = ? OR ot_system LIKE ? OR switch_port LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like, like, like, like, `%${String(search).replace(/[^0-9a-f]/gi, '')}%`, search, like, like);
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
  const io = itOtClause(req);
  const extra = (cf.clause ? ` AND ${cf.clause}` : '') + (io ? ` AND ${io}` : '');
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
  const servers = await all(`SELECT id, hostname, brand_model, category, serial_no, status, location, country, ip_address FROM servers WHERE deleted_at IS NULL AND COALESCE(it_ot, '') <> 'OT'${cf.clause ? ' AND ' + cf.clause : ''}`, cf.params);
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
  if (req.user && req.user.role === 'viewer') return res.status(403).json({ error: 'Not for viewers' });
  const cf = countryFilter(req);
  const rows = await all(`SELECT id, hostname, brand_model, category, serial_no, ip_address, location, status, country FROM servers
      WHERE deleted_at IS NULL AND status <> 'Broken' AND COALESCE(it_ot, '') <> 'OT'${cf.clause ? ' AND ' + cf.clause : ''} ORDER BY category, brand_model, id`, cf.params);
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
  if (!row || (isOT(req) && row.it_ot !== 'OT')) return res.status(404).json({ error: 'Server not found' });
  if (!inScope(req, row.country)) return res.status(403).json({ error: 'Not in your region' });
  res.json(row);
}));

function resolveCountry(req, requested) {
  return resolveScopedCountry(req, normCountry(requested), 'Vietnam');
}

const FIELDS = ['location', 'hostname', 'brand_model', 'producer', 'category', 'serial_no', 'asset_code', 'ip_address',
  'os', 'cpu', 'ram', 'storage', 'role', 'status', 'purchase_date', 'warranty_expiry',
  'vendor', 'cost', 'po_number', 'remark', 'it_ot', 'mac', 'vlan', 'ot_system', 'switch_port'];

// ── POST /api/servers/ot-import — OT device list (CMDB .xlsx, read in the browser) ─────────────────
// body { site, aoa: [[…header], […row] …], overrides: { "<file switch name>": net device id | 0 }, dry,
//        apply: { servers: true, ports: true } }  → plan (lib/ot-import.js); without dry: adds / fills Server Inventory
// records (IT/OT = OT; only empty fields of existing records) and fills EMPTY switch ports of the network map. IT admins.
router.post('/ot-import', requireITAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const aoa = Array.isArray(b.aoa) ? b.aoa.slice(0, 3000).map(r => (Array.isArray(r) ? r.slice(0, 40).map(c => String(c == null ? '' : c).slice(0, 200)) : [])) : [];
  const { rows, error } = OTImport.readRows(aoa);
  if (error) return res.status(400).json({ error });
  const sites = await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY n DESC');
  const site = String(b.site || (sites[0] && sites[0].site) || '').slice(0, 80);
  const devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  const ports = await all('SELECT p.*, d.hostname FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site]);
  const servers = await all('SELECT * FROM servers WHERE deleted_at IS NULL');
  const p = OTImport.plan(rows, { devices, ports, servers }, b.overrides && typeof b.overrides === 'object' ? b.overrides : {});
  const switches = devices.filter(d => /switch/i.test(d.role || '') && d.state !== 'retired').map(d => ({ id: d.id, hostname: d.hostname, location: d.location })).sort((x, y) => x.hostname.localeCompare(y.hostname));
  if (b.dry) return res.json({ site, sites: sites.map(x => x.site), switches, ...p });
  const doServers = !b.apply || b.apply.servers !== false, doPorts = !b.apply || b.apply.ports !== false;
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const done = { added: 0, updated: 0, ports: 0 };
  if (doServers) {
    const stmts = [];
    for (const r of p.rows) {
      if (r.action === 'add') {
        const f = { ...r.fields, it_ot: 'OT', status: 'Active', remark: 'From the OT device list (CMDB)' };
        const cols = Object.keys(f);
        stmts.push({ sql: `INSERT INTO servers (${cols.join(', ')}, history_usage) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
          args: [...cols.map(c => f[c]), `${ts}: added from the OT device list by ${req.user.username}`] });
        done.added++;
      } else if (r.action === 'update') {
        const cols = Object.keys(r.fill);
        const line = `${ts}: filled ${cols.join(', ')} from the OT device list by ${req.user.username}`;
        stmts.push({ sql: `UPDATE servers SET ${cols.map(c => c + ' = ?').join(', ')}, history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END WHERE id = ?`,
          args: [...cols.map(c => r.fill[c]), line, line, r.server_id] });
        done.updated++;
      }
    }
    if (stmts.length) await batch(stmts);
  }
  if (doPorts && p.fills.length) {
    const stmts = [];
    for (const f of p.fills) {
      // Only while the port is still empty (nobody changed it since the preview).
      stmts.push({ sql: `UPDATE net_ports SET peer_host = ?, vlan = ?, mode = ?, note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ? AND COALESCE(peer_host, '') = ''`,
        args: [f.peer_host, f.vlan, f.mode, f.note, req.user.username, f.port_id] });
      stmts.push({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)',
        args: [site, f.hostname, f.port, '(free)', `${f.peer_host}${f.vlan ? ' vlan ' + f.vlan : ''} ACCESS (OT device list)`, req.user.username] });
    }
    await batch(stmts); done.ports = p.fills.length;
  }
  await audit(req.user, 'CREATE', null, `OT device list: ${done.added} OT device(s) added, ${done.updated} filled in Server Inventory; ${done.ports} switch port(s) filled on the network map "${site}"`);
  res.json({ ok: true, ...done });
}));

// ── POST /api/servers/port-links — which access-switch port each device is on (lib/port-links.js) ──────────────────
// body { site, dry } → plan; { site, link: [server ids], add: [{ port_id, name, it_ot, category }] } → apply (IT admins):
// writes "Connected to" (switch_port, + location when empty) and adds the devices cabled to an access switch that have no record.
const PortLinks = require('../lib/port-links');
// IT admins: everything. OT editors: only the OT devices, on the switches the OT team sees; what they add is OT.
const canPortLinks = (req) => isITAdmin(req.user) || (isOT(req) && req.user.role === 'editor');
router.post('/port-links', wrap(async (req, res) => {
  if (!canPortLinks(req)) return res.status(403).json({ error: 'IT admins and OT editors only' });
  const b = req.body || {};
  const sites = await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY n DESC');
  const site = String(b.site || (sites[0] && sites[0].site) || '').slice(0, 80);
  const ot = isOT(req);
  const allDevices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  let ports = await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site]);
  if (ot) { const otIds = new Set(allDevices.filter(d => d.state !== 'retired' && require('./netmap').otOn(d)).map(d => d.id)); ports = ports.filter(p => otIds.has(p.device_id)); }
  const devices = allDevices;
  const cf = countryFilter(req);
  const servers = await all(`SELECT * FROM servers WHERE deleted_at IS NULL${ot ? " AND it_ot = 'OT'" : ''}${cf.clause ? ' AND ' + cf.clause : ''}`, cf.params);
  const p = PortLinks.plan({ devices, ports, servers });
  // OT editors: only what looks like OT (VLANs 124 / 125 / 131 / 133, Matrix, Moxa, kiosks, gateways …) — printers / PCs stay IT's.
  if (ot) { p.missing = p.missing.filter(m => m.it_ot === 'OT'); p.counts.missing = p.missing.length; }
  if (b.dry) return res.json({ site, sites: sites.map(x => x.site), ...p });
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const HIST = `history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END`;
  const want = new Set((Array.isArray(b.link) ? b.link : []).map(Number));
  const stmts = []; let linked = 0, added = 0;
  for (const l of p.links) {
    if (!want.has(l.server_id) || !l.change) continue;
    const line = `${ts}: Connected to "${l.from || '∅'}"→"${l.to}" (network map: ${l.how}) by ${req.user.username}`;
    stmts.push({ sql: `UPDATE servers SET switch_port = ?, location = CASE WHEN COALESCE(location, '') = '' THEN ? ELSE location END, ${HIST} WHERE id = ?`, args: [l.to, l.location, line, line, l.server_id] });
    linked++;
  }
  const byPort = new Map(p.missing.map(m => [m.port_id, m]));
  const country = /thai/i.test(site) ? 'Thailand' : /malay/i.test(site) ? 'Malaysia' : 'Vietnam';
  for (const a of (Array.isArray(b.add) ? b.add : []).slice(0, 500)) {
    const m = byPort.get(Number(a.port_id)); if (!m) continue;
    const name = String(a.name || m.name).trim().slice(0, 80) || m.name;
    const itot = a.it_ot === 'OT' || ot ? 'OT' : '';
    stmts.push({ sql: `INSERT INTO servers (country, location, hostname, category, ip_address, mac, vlan, switch_port, it_ot, status, remark, history_usage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      args: [country, m.location, name, String(a.category || m.category).slice(0, 60), m.ip, m.mac, m.vlan, `${m.switch} ${m.port}`, itot,
        `From the network map (${m.switch} ${m.port})${m.note ? ': ' + m.note : ''}`.slice(0, 500), `${ts}: added from the network map (access-switch port) by ${req.user.username}`] });
    added++;
  }
  if (stmts.length) await batch(stmts);
  await audit(req.user, 'UPDATE', null, `Switch ports: ${linked} device(s) linked to their access-switch port, ${added} device(s) added from the network map "${site}"`);
  res.json({ ok: true, linked, added });
}));


// ── POST /api/servers — create (admin/editor) ─────────────────────────────────
router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const v = {};
  FIELDS.forEach(f => v[f] = req.body[f] != null ? req.body[f] : '');
  if (isOT(req)) v.it_ot = 'OT';   // a device added by the OT team is an OT device
  if (!v.status) v.status = 'Active';
  const finalCountry = resolveCountry(req, req.body.country);
  const ts0 = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const history_usage = req.body.history_usage || `${ts0} UTC: created by ${req.user.username}${isOT(req) ? ' (OT team)' : ''}`;

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
  if (isOT(req)) {
    if (existing.it_ot !== 'OT') return res.status(404).json({ error: 'Server not found' });
    req.body.it_ot = 'OT';   // an OT editor cannot move a device to IT
  }

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
    if (req.user.team !== 'IT' && !(isOT(req) && existing.it_ot === 'OT')) {
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
