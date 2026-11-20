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
const OTA = require('../lib/ot-activity');
const PROTECTED_FIELDS = { serial_no: 'Serial', brand_model: 'Brand/Model', asset_code: 'Asset Code' };

router.use(requireAuth);
// OT team (Operation Technology): only the OT devices (it_ot = 'OT') — list, filters, one record; OT editors may also edit
// an OT record (never an IT one, never delete).
const isOT = (req) => !!req.user && req.user.team === 'OT';
router.use((req, res, next) => {
  if (isOT(req)) {
    if (req.method === 'GET' && !/^\/(stats|usage|needs-info)\b/.test(req.path)) return next();
    if (req.user.ot_admin && req.method === 'DELETE' && /^\/\d+$/.test(req.path)) return next();   // OT admin: delete an OT device (restorable)
    if (req.user.role === 'editor' && ((req.method === 'PUT' && /^\/\d+$/.test(req.path)) || (req.method === 'POST' && (req.path === '/' || req.path === '/port-links' || req.path === '/mac-ports' || req.path === '/camera-switches')))) return next();
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
// ── GET /api/servers/ot-attention — Needs Attention for the OT devices (OT team, IT): what to check and fix ────────────────────
// Each group: { key, title, fix, where: 'record' | 'device', rows: [{ id, hostname, detail }] }. "device" = fixed on the device
// itself (firmware, HTTPS, DNS, network settings) — then upload the camera list again to refresh.
router.get('/ot-attention', wrap(async (req, res) => {
  if (!(isOT(req) || req.user.team === 'IT')) return res.status(403).json({ error: 'OT team and IT only' });
  res.json(await otAttention(req));
}));
async function otAttention(req) {
  const cf = countryFilter(req);
  const rows = await all(`SELECT id, hostname, category, ip_address, mac, serial_no, os, status, switch_port, extra, location FROM servers
    WHERE deleted_at IS NULL AND it_ot = 'OT'${cf.clause ? ' AND ' + cf.clause : ''} ORDER BY hostname`, cf.params);
  const ex = (r) => { try { return JSON.parse(r.extra || '{}') || {}; } catch { return {}; } };
  const name = (r) => r.hostname || `#${r.id}`;
  const groups = [];
  const add = (key, title, fix, where, list) => { if (list.length) groups.push({ key, title, fix, where, rows: list }); };
  const dupBy = (f) => { const m = new Map(); rows.forEach(r => { const v = String(f(r) || '').trim().toUpperCase(); if (v) m.set(v, [...(m.get(v) || []), r]); }); return [...m.values()].filter(l => l.length > 1); };
  add('dup_name', 'Same name on two or more devices', 'Rename one of them (on the NVR / device and here).', 'record',
    dupBy(r => r.hostname).flatMap(l => l.map(r => ({ id: r.id, hostname: name(r), detail: `${l.length}× "${r.hostname}" · ${r.ip_address || 'no IP'}` }))));
  add('dup_ip', 'Same IP address on two or more devices', 'One of them has a wrong IP — correct the device or the record.', 'record',
    dupBy(r => r.ip_address).flatMap(l => l.map(r => ({ id: r.id, hostname: name(r), detail: `${r.ip_address} (${l.length}×)` }))));
  add('dup_mac', 'Same MAC address on two or more records', 'Usually the same device recorded twice — keep one.', 'record',
    dupBy(r => String(r.mac || '').replace(/[^0-9a-f]/gi, '')).flatMap(l => l.map(r => ({ id: r.id, hostname: name(r), detail: `${r.mac} (${l.length}×)` }))));
  add('old_fw', 'Old firmware (1.x, 2019–2020)', 'Update the firmware on the device (Wisenet Device Manager / web page), then upload the camera list again.', 'device',
    rows.filter(r => /^FW\s*1\./i.test(r.os || '')).map(r => ({ id: r.id, hostname: name(r), detail: r.os })));
  add('http', 'Web page on HTTP without HTTPS', 'Turn on HTTPS (and turn off plain HTTP) on the device.', 'device',
    rows.filter(r => { const e = ex(r); return /enable/i.test(e.http || '') && /disable/i.test(e.https || ''); }).map(r => ({ id: r.id, hostname: name(r), detail: `${r.ip_address} · HTTP on, HTTPS off` })));
  const cams = rows.filter(r => ex(r).mask || ex(r).gw), key = (r) => `${ex(r).mask} / ${ex(r).gw}`;
  const cnt = new Map(); cams.forEach(r => cnt.set(key(r), (cnt.get(key(r)) || 0) + 1));
  const top = [...cnt].sort((a, b) => b[1] - a[1])[0];
  if (cnt.size > 1) add('net', `Network settings differ (most use mask / gateway ${top[0]})`, 'Set the same subnet mask and gateway on all cameras of the CCTV network.', 'device',
    cams.filter(r => key(r) !== top[0]).map(r => ({ id: r.id, hostname: name(r), detail: `${r.ip_address} · mask / gateway ${key(r)}` })));
  add('dns', 'Factory DNS (168.126.63.x, Korea Telecom)', 'Set your own DNS server on the device (or none if it needs no DNS).', 'device',
    rows.filter(r => (ex(r).dns || []).some(d => /^168\.126\.63\./.test(d))).map(r => ({ id: r.id, hostname: name(r), detail: (ex(r).dns || []).join(' / ') })));
  add('broken', 'Status not OK', 'Check the device; set it back to Active when it works.', 'record',
    rows.filter(r => r.status && r.status !== 'Active' && r.status !== 'Stock').map(r => ({ id: r.id, hostname: name(r), detail: r.status })));
  add('missing', 'Missing IP, MAC or serial', 'Fill in what is missing (✏️).', 'record',
    rows.filter(r => !r.ip_address || !r.mac || !r.serial_no).map(r => ({ id: r.id, hostname: name(r), detail: ['IP', 'MAC', 'serial'].filter((_, i) => ![r.ip_address, r.mac, r.serial_no][i]).join(', ') + ' missing' })));
  add('port', 'Switch port not known', 'Set the port it is plugged into: in "Connected to" (✏️) or on the switch port in the Network map.', 'record',
    rows.filter(r => !/\S+\s+\S*\d+\/\d+/.test(r.switch_port || '')).map(r => ({ id: r.id, hostname: name(r), detail: r.switch_port ? `on ${r.switch_port}, port unknown` : 'not connected to a switch' })));
  return { total: rows.length, groups, canMac: (isOT(req) && req.user.role === 'editor') || isITAdmin(req.user), canEdit: (isOT(req) && req.user.role === 'editor') || (req.user.team === 'IT' && ['admin', 'editor'].includes(req.user.role)) };
}

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
  const otSnap = await OTA.snapOT(), portSnap = await OTA.snapOTPorts(site);   // OT activity log
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
  await OTA.logOTBulk(req.user, otSnap, 'OT device list');
  await OTA.logPortsBulk(req.user, site, portSnap, 'OT device list');
  res.json({ ok: true, ...done });
}));

// ── POST /api/servers/cctv-import — CCTV camera list (lib/cctv-import.js; the browser reads the .xlsx and its pictures) ──────
// body { aoa, overrides: { "<group K5 / HK8 …>": CCTV switch id | 0 }, it_ot: 'OT' | 'IT', dry } → plan; without dry: adds the
// cameras / fills empty fields of existing ones, returns { ids: { "<mac or name>": server id } } for the pictures. IT admins.
const CctvImport = require('../lib/cctv-import');
const CctvReport = require('../lib/cctv-report');
router.post('/cctv-import', requireITAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const aoa = Array.isArray(b.aoa) ? b.aoa.slice(0, 3000).map(r => (Array.isArray(r) ? r.slice(0, 60).map(c => String(c == null ? '' : c).slice(0, 300)) : [])) : [];
  const { rows, error } = CctvImport.readRows(aoa);
  if (error) return res.status(400).json({ error });
  const sites = await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY n DESC');
  const site = String(b.site || (sites[0] && sites[0].site) || '').slice(0, 80);
  const devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  const servers = await all('SELECT * FROM servers WHERE deleted_at IS NULL');
  // The OT report's other sheets (CAMERA LIST areas, SWITCH LIST, SERVER DETAIL) — lib/cctv-report.js.
  const sheet = (x) => (Array.isArray(x) ? x.slice(0, 1000).map(r => (Array.isArray(r) ? r.slice(0, 30).map(c => String(c == null ? '' : c).slice(0, 400)) : [])) : []);
  const rep = b.report && typeof b.report === 'object' ? { switches: sheet(b.report.switches), servers: sheet(b.report.servers), cameras: sheet(b.report.cameras) } : null;
  const ports = rep ? await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site]) : [];
  const R = rep ? CctvReport.plan(rep, { devices, ports }) : null;
  const p = CctvImport.plan(rows, { devices, servers }, b.overrides && typeof b.overrides === 'object' ? b.overrides : {}, R ? R.areas : {});
  if (R) { p.report = { switches: R.switches, servers: R.servers }; p.issues = [...R.issues, ...p.issues]; }
  const itot = b.it_ot === 'IT' ? '' : 'OT';
  if (b.dry) return res.json({ site, switches: devices.filter(d => /switch/i.test(d.role || '') && d.state !== 'retired').map(d => ({ id: d.id, hostname: d.hostname, location: d.location }))
    .sort((x, y) => (/CCTV/.test(y.hostname) - /CCTV/.test(x.hostname)) || x.hostname.localeCompare(y.hostname)), ...p });
  const otSnap = await OTA.snapOT(), portSnap = await OTA.snapOTPorts(site);   // OT activity log
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const country = /thai/i.test(site) ? 'Thailand' : /malay/i.test(site) ? 'Malaysia' : 'Vietnam';
  const ids = {}; let added = 0, updated = 0;
  for (const c of p.cameras) {   // one by one: the new ids are needed for the pictures
    if (c.action === 'add') {
      const f = { ...c.fields, it_ot: itot, country };
      const cols = Object.keys(f);
      const r = await run(`INSERT INTO servers (${cols.join(', ')}, history_usage) VALUES (${cols.map(() => '?').join(', ')}, ?)`, [...cols.map(k => f[k]), `${ts}: added from the CCTV camera list by ${req.user.username}`]);
      ids[c.key] = Number(r.lastInsertRowid); added++;
    } else {
      ids[c.key] = c.server_id;
      if (c.action === 'update') {
        const cols = Object.keys(c.fill), line = `${ts}: filled ${cols.join(', ')} from the CCTV camera list by ${req.user.username}`;
        await run(`UPDATE servers SET ${cols.map(k => k + ' = ?').join(', ')}, history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END WHERE id = ?`,
          [...cols.map(k => c.fill[k]), line, line, c.server_id]); updated++;
      }
    }
  }
  // Cameras no longer in the list → Stock (only those ticked).
  const goneIds = new Set((Array.isArray(b.gone) ? b.gone : []).map(Number));
  let goneDone = 0;
  for (const g of p.gone.filter(x => goneIds.has(x.id))) {
    const line = `${ts}: not in the CCTV camera list any more → Stock by ${req.user.username}`;
    await run(`UPDATE servers SET status = 'Stock', history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END WHERE id = ?`, [line, line, g.id]); goneDone++;
  }
  // OT report: CCTV switches (map + Server Inventory) and recording servers.
  const done = { switchesUpdated: 0, switchesAdded: 0, nvr: 0 };
  if (p.report && b.apply && b.apply.switches) {
    const NM = require('./netmap'), sort = NM.util.portSort;
    for (const sw of p.report.switches) {
      if (sw.action === 'same') continue;
      const notes = `${sw.hostname}${sw.status ? ' · ' + sw.status : ''}${sw.remark ? ' · ' + sw.remark : ''} (OT CCTV report)`.slice(0, 500);
      let devId = sw.device_id;
      if (sw.action === 'update') {
        await run(`UPDATE net_devices SET alias = ?, model = COALESCE(NULLIF(?, ''), model), mgmt_ip = COALESCE(NULLIF(?, ''), mgmt_ip), mac = COALESCE(NULLIF(?, ''), mac),
            serial = COALESCE(NULLIF(?, ''), serial), notes = ?, updated_at = datetime('now') WHERE id = ?`, [sw.hostname, sw.model, sw.ip, sw.mac, sw.serial, notes, devId]);
        for (const pt of sw.add) await run('INSERT OR IGNORE INTO net_ports (device_id, port, sort) VALUES (?, ?, ?)', [devId, pt, sort(pt)]);
        for (const id of sw.remove) await run("DELETE FROM net_ports WHERE id = ? AND COALESCE(peer_host, '') = '' AND COALESCE(note, '') = ''", [id]);
        await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [site, sw.map, '', '', `OT CCTV report: ${sw.changes.join('; ')}`, req.user.username]);
        done.switchesUpdated++;
      } else {
        if (await get('SELECT id FROM net_devices WHERE site = ? AND hostname = ?', [site, sw.hostname])) continue;
        const r = await run(`INSERT INTO net_devices (site, hostname, alias, role, model, mgmt_ip, mac, serial, location, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cctv report')`,
          [site, sw.hostname, 'CCTV switch', sw.role, sw.model, sw.ip, sw.mac, sw.serial, sw.location, notes]);
        devId = Number(r.lastInsertRowid);
        for (const pt of sw.ports) await run('INSERT OR IGNORE INTO net_ports (device_id, port, sort) VALUES (?, ?, ?)', [devId, pt, sort(pt)]);
        await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [site, sw.hostname, '', '', 'device added (OT CCTV report)', req.user.username]);
        done.switchesAdded++;
      }
      // Its Server Inventory record (OT), found by serial / MAC / name, else added; linked to the map device.
      const hx = (v) => String(v || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
      const recs = await all("SELECT id, hostname, serial_no, mac FROM servers WHERE deleted_at IS NULL AND (category = 'Switch' OR it_ot = 'OT')");
      const rec = recs.find(x => sw.serial && hx(x.serial_no) === hx(sw.serial)) || recs.find(x => sw.mac && hx(x.mac) === hx(sw.mac)) || recs.find(x => String(x.hostname || '').toUpperCase() === sw.hostname);
      const loc = (await get('SELECT location FROM net_devices WHERE id = ?', [devId]) || {}).location || '';
      let sid = rec && rec.id;
      if (rec) await run(`UPDATE servers SET hostname = COALESCE(NULLIF(hostname, ''), ?), brand_model = ?, producer = 'Cisco', category = 'Switch', ip_address = COALESCE(NULLIF(?, ''), ip_address),
          mac = COALESCE(NULLIF(?, ''), mac), serial_no = COALESCE(NULLIF(serial_no, ''), ?), it_ot = 'OT', location = COALESCE(NULLIF(location, ''), ?) WHERE id = ?`,
        [sw.hostname, 'Cisco ' + sw.model, sw.ip, sw.mac, sw.serial, loc, rec.id]);
      else { const r = await run(`INSERT INTO servers (country, hostname, brand_model, producer, category, ip_address, mac, serial_no, location, status, it_ot, remark, history_usage)
          VALUES (?, ?, ?, 'Cisco', 'Switch', ?, ?, ?, ?, 'Active', 'OT', ?, ?)`, [country, sw.hostname, 'Cisco ' + sw.model, sw.ip, sw.mac, sw.serial, loc, 'CCTV switch (OT CCTV report)', `${ts}: added from the OT CCTV report by ${req.user.username}`]);
        sid = Number(r.lastInsertRowid); }
      await run('UPDATE net_devices SET server_id = ? WHERE id = ? AND server_id IS NULL', [sid, devId]);
    }
  }
  if (p.report && b.apply && b.apply.servers) {
    for (const s of p.report.servers) {
      const role = `NVR · ${s.channels} channels (${s.active} active, ${s.spare} spare) · ${s.cameras} cameras · recording ${s.record}`.slice(0, 200);
      const model = /R540/i.test(s.model) ? 'Dell PowerEdge R540' : s.model;
      const ex = await get('SELECT id FROM servers WHERE deleted_at IS NULL AND UPPER(hostname) = ?', [s.name]);
      if (ex) await run(`UPDATE servers SET ip_address = ?, role = ?, brand_model = COALESCE(NULLIF(brand_model, ''), ?), category = COALESCE(NULLIF(category, ''), 'CCTV recording server'), it_ot = 'OT' WHERE id = ?`, [s.ip, role, model, ex.id]);
      else await run(`INSERT INTO servers (country, hostname, brand_model, producer, category, ip_address, role, location, status, it_ot, remark, history_usage) VALUES (?, ?, ?, 'Dell', 'CCTV recording server', ?, ?, ?, 'Active', 'OT', ?, ?)`,
        [country, s.name, model, s.ip, role, /^MR0?4/i.test(s.name) ? 'MAIN RACK - 04' : '', [s.camStatus, s.note].filter(Boolean).join(' · '), `${ts}: added from the OT CCTV report by ${req.user.username}`]);
      done.nvr++;
    }
  }
  await audit(req.user, 'CREATE', null, `CCTV camera list: ${added} camera(s) added, ${updated} filled, ${goneDone} set to Stock${p.report ? `; OT report: ${done.switchesUpdated} switch(es) updated, ${done.switchesAdded} added, ${done.nvr} recording server(s)` : ''}`);
  await OTA.logOTBulk(req.user, otSnap, 'CCTV import');
  await OTA.logPortsBulk(req.user, site, portSnap, 'CCTV import');
  res.json({ ok: true, added, updated, ids, gone: goneDone, ...done });
}));

// ── Pictures of devices: POST /api/servers/photos { items: [{ server_id, mime, b64 }], source } (IT admins; ≤ 300 KB each,
//    replaces the device's picture) · GET /api/servers/:id/photo (anyone who may see the record).
router.post('/photos', requireITAdmin, wrap(async (req, res) => {
  const items = (Array.isArray(req.body && req.body.items) ? req.body.items : []).slice(0, 100);
  const stmts = [];
  for (const it of items) {
    const id = Number(it.server_id), mime = String(it.mime || ''), b64 = String(it.b64 || '');
    if (!id || !/^image\/(jpeg|png|webp)$/.test(mime) || !b64 || b64.length > 400 * 1024) continue;
    stmts.push({ sql: `INSERT INTO server_photos (server_id, mime, data_b64, size, source, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET mime = excluded.mime, data_b64 = excluded.data_b64, size = excluded.size, source = excluded.source, uploaded_by = excluded.uploaded_by, uploaded_at = datetime('now')`,
      args: [id, mime, b64, Math.round(b64.length * 0.75), String(req.body.source || '').slice(0, 40), req.user.username] });
  }
  if (stmts.length) await batch(stmts);
  res.json({ ok: true, saved: stmts.length });
}));
router.get('/:id/photo', wrap(async (req, res) => {
  const s = await get('SELECT country, it_ot FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!s || (isOT(req) && s.it_ot !== 'OT') || !inScope(req, s.country)) return res.status(404).end();
  const p = await get('SELECT mime, data_b64 FROM server_photos WHERE server_id = ?', [req.params.id]);
  if (!p || !p.data_b64) return res.status(404).end();
  res.set('Content-Type', p.mime).set('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(p.data_b64, 'base64'));
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
  const otSnap = await OTA.snapOT();   // OT activity log
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
  await OTA.logOTBulk(req.user, otSnap, 'Switch ports');
  res.json({ ok: true, linked, added });
}));


// ── POST /api/servers/camera-switches — cameras with no switch (or one not on the map) → the CCTV switch their name says
// (K5-12 → CCTV KABIN 5, HK8-1R → HARICI KABIN 8, K1 → MR-01, K11 → IT KABIN 11), like the camera list import does.
// body { dry, apply: [server ids] }. Cameras already on a port of a switch are kept. IT admins and OT editors.
router.post('/camera-switches', wrap(async (req, res) => {
  if (!canPortLinks(req)) return res.status(403).json({ error: 'IT admins and OT editors only' });
  const b = req.body || {}, ot = isOT(req);
  const sites = await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY n DESC');
  const site = String(b.site || (sites[0] && sites[0].site) || '').slice(0, 80);
  let devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  if (ot) { const NM = require('./netmap'); devices = devices.filter(d => d.state !== 'retired' && NM.otOn(d)); }
  const cf = countryFilter(req);
  const servers = await all(`SELECT id, hostname, category, switch_port, location, it_ot FROM servers WHERE deleted_at IS NULL AND category LIKE '%camera%'${ot ? " AND it_ot = 'OT'" : ''}${cf.clause ? ' AND ' + cf.clause : ''}`, cf.params);
  const rows = CctvImport.switchPlan(servers, devices);
  if (b.dry) return res.json({ site, rows });
  const want = new Set((Array.isArray(b.apply) ? b.apply : []).map(Number));
  const otSnap = await OTA.snapOT();   // OT activity log
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const HIST = `history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END`;
  const stmts = [];
  for (const r of rows.filter(x => x.action === 'set' && want.has(x.server_id))) {
    const line = `${ts}: Connected to "${r.from || '∅'}"→"${r.to}" (switch of ${r.how}, from the camera name) by ${req.user.username}`;
    stmts.push({ sql: `UPDATE servers SET switch_port = ?, location = CASE WHEN COALESCE(location, '') = '' THEN ? ELSE location END, ${HIST} WHERE id = ? AND COALESCE(switch_port, '') = ?`,
      args: [r.to, r.location, line, line, r.server_id, r.from] });
  }
  if (stmts.length) await batch(stmts);
  await OTA.logOTBulk(req.user, otSnap, 'Camera switches');
  await audit(req.user, 'UPDATE', null, `Camera switches: ${stmts.length} camera(s) set to the CCTV switch of their cabinet`);
  res.json({ ok: true, set: stmts.length });
}));

// ── POST /api/servers/mac-ports — switch MAC address tables (`show mac address-table`, pasted / .txt) → the port of each
// camera / device by its MAC (lib/mac-table.js). body { site, text, choose: { blockIndex: switch id }, dry, apply: [server ids] }.
// Sets the record's "Connected to" and, on a free port (or one already naming it), the port's device + MAC on the map.
// IT admins and OT editors (OT: OT records and OT switches only).
const MacTable = require('../lib/mac-table');
router.post('/mac-ports', wrap(async (req, res) => {
  if (!canPortLinks(req)) return res.status(403).json({ error: 'IT admins and OT editors only' });
  const b = req.body || {};
  const text = String(b.text || '').slice(0, 3e6);
  const blocks = MacTable.parse(text);
  if (!blocks.length) return res.status(400).json({ error: 'No MAC address lines found — paste the output of "show mac address-table" (with the switch prompt line, e.g. K2_CCTV_01#show mac address-table).' });
  const sites = await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY n DESC');
  const site = String(b.site || (sites[0] && sites[0].site) || '').slice(0, 80);
  const ot = isOT(req), NM = require('./netmap');
  let devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  if (ot) devices = devices.filter(d => d.state !== 'retired' && NM.otOn(d));
  const ids = new Set(devices.map(d => d.id));
  const ports = (await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site])).filter(p => ids.has(p.device_id));
  const cf = countryFilter(req);
  const servers = await all(`SELECT id, hostname, category, mac, switch_port, it_ot FROM servers WHERE deleted_at IS NULL${ot ? " AND it_ot = 'OT'" : ''}${cf.clause ? ' AND ' + cf.clause : ''}`, cf.params);
  const p = MacTable.plan(blocks, { devices, ports, servers }, b.choose && typeof b.choose === 'object' ? b.choose : {});
  const switches = devices.filter(d => /switch/i.test(d.role || '') && d.state !== 'retired').map(d => ({ id: d.id, hostname: d.hostname, alias: d.alias || '' }))
    .sort((x, y) => x.hostname.localeCompare(y.hostname, undefined, { numeric: true }));
  if (b.dry) return res.json({ site, switches_all: switches, ...p });
  const otSnap = await OTA.snapOT(), portSnap = await OTA.snapOTPorts(site);   // OT activity log
  const want = new Set((Array.isArray(b.apply) ? b.apply : []).map(Number));
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const HIST = `history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END`;
  const stmts = []; let records = 0, mapped = 0;
  for (const r of p.rows) {
    if (!want.has(r.server_id) || r.action === 'same') continue;
    const to = `${r.switch} ${r.port}`;
    if (r.before !== to) {
      const line = `${ts}: Connected to "${r.before || '∅'}"→"${to}" (MAC ${r.mac} in the switch MAC table) by ${req.user.username}`;
      stmts.push({ sql: `UPDATE servers SET switch_port = ?, vlan = CASE WHEN COALESCE(vlan, '') = '' THEN ? ELSE vlan END, ${HIST} WHERE id = ?`, args: [to, r.vlan, line, line, r.server_id] });
      records++;
    }
    // The port on the map: only a free one, or one already naming this device (never another device's port).
    if (r.action === 'set') {
      stmts.push({ sql: `UPDATE net_ports SET peer_host = ?, peer_port = ?, vlan = CASE WHEN COALESCE(vlan, '') = '' THEN ? ELSE vlan END, mode = CASE WHEN COALESCE(mode, '') = '' THEN 'ACCESS' ELSE mode END,
          updated_at = datetime('now'), updated_by = ? WHERE id = ? AND (COALESCE(peer_host, '') = '' OR UPPER(peer_host) = UPPER(?))`,
        args: [r.hostname, r.mac, r.vlan, req.user.username, r.port_id, r.hostname] });
      stmts.push({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [site, r.switch, r.port, '(free)', `${r.hostname} ${r.mac} (MAC table)`, req.user.username] });
      mapped++;
    }
  }
  if (stmts.length) await batch(stmts);
  await audit(req.user, 'UPDATE', null, `MAC tables: ${records} device(s) set to their switch port, ${mapped} port(s) filled on the network map "${site}"`);
  await OTA.logOTBulk(req.user, otSnap, 'MAC tables');
  await OTA.logPortsBulk(req.user, site, portSnap, 'MAC tables');
  res.json({ ok: true, records, mapped });
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
  await OTA.logServer(req.user, null, created);
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

  // Network settings of a camera / OT device (from the camera list): mask, gateway, DNS, HTTP / HTTPS — merged into extra.
  let newExtra = existing.extra;
  if (req.body.extra && typeof req.body.extra === 'object' && !Array.isArray(req.body.extra)) {
    let ex = {}; try { ex = JSON.parse(existing.extra || '{}') || {}; } catch { ex = {}; }
    const NET = { mask: 'Mask', gw: 'Gateway', dns: 'DNS', http: 'HTTP', https: 'HTTPS' };
    for (const [k, lbl] of Object.entries(NET)) {
      if (req.body.extra[k] === undefined) continue;
      let v = req.body.extra[k];
      v = k === 'dns' ? (Array.isArray(v) ? v : String(v || '').split(/[\s,;/]+/)).map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 4) : String(v == null ? '' : v).trim().slice(0, 40);
      const before = Array.isArray(ex[k]) ? ex[k].join(' / ') : norm(ex[k]), after = Array.isArray(v) ? v.join(' / ') : v;
      if (before !== after) { changes.push(`${lbl}: "${before || '∅'}"→"${after || '∅'}"`); if (after) ex[k] = v; else delete ex[k]; }
    }
    newExtra = JSON.stringify(ex);
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

  const setFields = ['country', ...FIELDS, 'history_usage', 'fields_locked', 'extra'];
  const setVals = [finalCountry, ...FIELDS.map(f => (req.body[f] !== undefined ? req.body[f] : existing[f])), newHistory, lockNow, newExtra];
  await run(
    `UPDATE servers SET ${setFields.map(c => c + ' = ?').join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    [...setVals, req.params.id]);
  const updated = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  await OTA.logServer(req.user, existing, updated);
  await audit(req.user, 'UPDATE', updated.id, `Updated server "${updated.hostname || updated.asset_code || 'untitled'}"`);
  res.json(updated);
}));

// ── DELETE /api/servers/:id — soft delete (admin/editor) ──────────────────────
router.delete('/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const existing = await get('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Server not found' });
  if (!inScope(req, existing.country)) return res.status(403).json({ error: 'Not in your region' });
  if (isOT(req) && !(req.user.ot_admin && existing.it_ot === 'OT')) return res.status(403).json({ error: 'Only an OT admin can delete OT devices' });
  await run("UPDATE servers SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?", [req.user.username, req.params.id]);
  await OTA.logServer(req.user, existing, await get('SELECT * FROM servers WHERE id = ?', [req.params.id]));
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

router.otAttention = otAttention;   // OT reports (routes/ot-reports.js)
module.exports = router;
