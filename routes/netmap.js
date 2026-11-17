/* Network map — devices of a site (firewalls, routers, switches, WLC, servers …), every port and what it
   connects to (device + port, cable, access / trunk, VLAN, port-channel, patch panel), VLAN list, change log.
   Filled from the implementation document (the page reads the .docx in the browser and sends the tables),
   then kept up to date by hand: change any port, move / swap ports, add devices.
   A port that points at another device of the site is mirrored on that device's port (both ends agree).

   Read: logged-in users with Asset Inventory access.  Change: admins and editors.  Import / delete: admins.
     GET    /api/netmap?site=                 { sites, devices, ports, vlans }
     POST   /api/netmap/import                { site, devices[], ports[], vlans[], replace }
     POST   /api/netmap/device                add            PUT /api/netmap/device/:id   edit / position
     DELETE /api/netmap/device/:id           PUT /api/netmap/positions { items: [{ id, x, y }] }
     PUT    /api/netmap/port                  { device_id, port, peer_host, peer_port, cable, mode, vlan, grp, patch, note }
     POST   /api/netmap/port/move             { device_id, from, to }   swap two ports of a device
     GET    /api/netmap/log?site=&device=     change history */

const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access !== 0 ? next() : res.status(403).json({ error: 'No access' })));
const canEdit = (req) => ['admin', 'editor'].includes(req.user.role);
const isAdmin = (req) => req.user.role === 'admin';
const str = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n);
const FIELDS = ['peer_host', 'peer_port', 'cable', 'mode', 'vlan', 'grp', 'patch', 'note'];
// Order ports naturally: "GE 1/0/2" before "GE 1/0/10"; named ports (IDRAC, MGMT …) first.
const portSort = (p) => { const n = String(p).match(/(\d+)(?:\/(\d+))?(?:\/(\d+))?\s*$/); if (!n) return 0; return (Number(n[1]) || 0) * 1e6 + (Number(n[2]) || 0) * 1e3 + (Number(n[3]) || 0) + (/^(T|TE|XE|E 1\/4[89])/i.test(p) ? 5e8 : 1e3); };
const desc = (p) => (p && (p.peer_host || p.peer_port || p.patch) ? `${p.peer_host || ''} ${p.peer_port || ''}${p.patch ? ' [' + p.patch + ']' : ''}${p.vlan ? ' vlan ' + p.vlan : ''}${p.mode ? ' ' + p.mode : ''}`.trim() : '(free)');

router.get('/', wrap(async (req, res) => {
  const sites = (await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY site')).map(r => ({ site: r.site, devices: r.n }));
  const site = req.query.site != null ? str(req.query.site, 80) : (sites[0] ? sites[0].site : '');
  const devices = await all('SELECT * FROM net_devices WHERE site = ? ORDER BY hostname', [site]);
  const ports = devices.length ? await all(`SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ? ORDER BY p.device_id, p.sort, p.port`, [site]) : [];
  const vlans = await all('SELECT * FROM net_vlans WHERE site = ? ORDER BY CAST(vlan AS INTEGER)', [site]);
  res.json({ site, sites, devices, ports, vlans, can: { edit: canEdit(req), admin: isAdmin(req) } });
}));

router.post('/import', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80) || 'Main site';
  const devices = Array.isArray(req.body.devices) ? req.body.devices.slice(0, 2000) : [];
  const ports = Array.isArray(req.body.ports) ? req.body.ports.slice(0, 20000) : [];
  const vlans = Array.isArray(req.body.vlans) ? req.body.vlans.slice(0, 4096) : [];
  if (!devices.length) return res.status(400).json({ error: 'No devices found in the file' });
  const stmts = [];
  if (req.body.replace) {
    stmts.push({ sql: 'DELETE FROM net_ports WHERE device_id IN (SELECT id FROM net_devices WHERE site = ?)', args: [site] });
    stmts.push({ sql: 'DELETE FROM net_devices WHERE site = ?', args: [site] });
    stmts.push({ sql: 'DELETE FROM net_vlans WHERE site = ?', args: [site] });
  }
  for (const d of devices) {
    const h = str(d.hostname, 80); if (!h) continue;
    const ips = Array.isArray(d.ips) ? JSON.stringify(d.ips.slice(0, 40).map(x => ({ name: str(x.name, 40), ip: str(x.ip, 60) }))) : '';
    stmts.push({ sql: `INSERT INTO net_devices (site, hostname, alias, role, model, serial, mgmt_ip, location, ips, services, service_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(site, hostname) DO UPDATE SET alias = excluded.alias, role = excluded.role, model = excluded.model, serial = excluded.serial,
          mgmt_ip = excluded.mgmt_ip, location = excluded.location, ips = excluded.ips, services = excluded.services, service_tag = excluded.service_tag, updated_at = datetime('now')`,
      args: [site, h, str(d.alias), str(d.role, 40), str(d.model), str(d.serial, 60), str(d.mgmt_ip, 60), str(d.location), ips, str(d.services, 120), str(d.service_tag, 40)] });
  }
  for (const v of vlans) {
    if (!str(v.vlan, 10)) continue;
    stmts.push({ sql: `INSERT INTO net_vlans (site, vlan, name, network, gateway) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(site, vlan) DO UPDATE SET name = excluded.name, network = excluded.network, gateway = excluded.gateway`, args: [site, str(v.vlan, 10), str(v.name), str(v.network, 60), str(v.gateway, 60)] });
  }
  await batch(stmts);
  const ids = new Map((await all('SELECT id, hostname FROM net_devices WHERE site = ?', [site])).map(r => [r.hostname, r.id]));
  const pst = [];
  for (const p of ports) {
    const id = ids.get(str(p.device, 80)), port = str(p.port, 40); if (!id || !port) continue;
    pst.push({ sql: `INSERT INTO net_ports (device_id, port, sort, peer_host, peer_port, cable, mode, vlan, grp, patch, note, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, port) DO UPDATE SET peer_host = excluded.peer_host, peer_port = excluded.peer_port, cable = excluded.cable, mode = excluded.mode,
          vlan = excluded.vlan, grp = excluded.grp, patch = excluded.patch, sort = excluded.sort, updated_at = datetime('now')`,
      args: [id, port, Number(p.sort) || portSort(port), str(p.peer_host, 80), str(p.peer_port, 40), str(p.cable, 30), str(p.mode, 20), str(p.vlan, 60), str(p.grp, 20), str(p.patch, 40), str(p.note, 200), req.user.username] });
  }
  await batch(pst);
  await audit(req.user, 'NETMAP', null, `Network map "${site}": imported ${ids.size} devices, ${pst.length} ports, ${vlans.length} VLANs${req.body.replace ? ' (replaced)' : ''}`);
  res.json({ ok: true, site, devices: ids.size, ports: pst.length, vlans: vlans.length });
}));

async function deviceOf(id) { return get('SELECT * FROM net_devices WHERE id = ?', [Number(id)]); }
router.post('/device', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const site = str(req.body.site, 80), h = str(req.body.hostname, 80);
  if (!h) return res.status(400).json({ error: 'Hostname is required' });
  if (await get('SELECT id FROM net_devices WHERE site = ? AND hostname = ?', [site, h])) return res.status(409).json({ error: 'This hostname already exists' });
  await run('INSERT INTO net_devices (site, hostname, alias, role, model, serial, mgmt_ip, location, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [site, h, str(req.body.alias), str(req.body.role, 40), str(req.body.model), str(req.body.serial, 60), str(req.body.mgmt_ip, 60), str(req.body.location), str(req.body.notes, 500)]);
  const d = await get('SELECT * FROM net_devices WHERE site = ? AND hostname = ?', [site, h]);
  // Port list from a count: "GE 1/0/" × 48 etc.
  const n = Math.min(96, Number(req.body.port_count) || 0), prefix = str(req.body.port_prefix, 20);
  if (n && prefix) await batch(Array.from({ length: n }, (_, i) => ({ sql: 'INSERT OR IGNORE INTO net_ports (device_id, port, sort) VALUES (?, ?, ?)', args: [d.id, `${prefix}${i + 1}`, i + 1] })));
  await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [site, h, '', '', 'device added', req.user.username]);
  res.json(d);
}));
router.put('/device/:id', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const d = await deviceOf(req.params.id); if (!d) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if ('x' in b || 'y' in b) await run('UPDATE net_devices SET x = ?, y = ? WHERE id = ?', [b.x == null ? null : Number(b.x), b.y == null ? null : Number(b.y), d.id]);
  if ('alias' in b) {
    await run(`UPDATE net_devices SET alias = ?, role = ?, model = ?, serial = ?, mgmt_ip = ?, location = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [str(b.alias), str(b.role, 40), str(b.model), str(b.serial, 60), str(b.mgmt_ip, 60), str(b.location), str(b.notes, 500), d.id]);
    await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [d.site, d.hostname, '', '', 'device details edited', req.user.username]);
  }
  res.json(await deviceOf(d.id));
}));
// Save the positions of many devices at once (auto layout / after import).
router.put('/positions', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 2000);
  await batch(items.map(i => ({ sql: 'UPDATE net_devices SET x = ?, y = ? WHERE id = ?', args: [Number(i.x) || 0, Number(i.y) || 0, Number(i.id)] })));
  res.json({ ok: true, saved: items.length });
}));
router.delete('/device/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const d = await deviceOf(req.params.id); if (!d) return res.status(404).json({ error: 'Not found' });
  await batch([{ sql: 'DELETE FROM net_ports WHERE device_id = ?', args: [d.id] }, { sql: 'DELETE FROM net_devices WHERE id = ?', args: [d.id] },
    { sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [d.site, d.hostname, '', '', 'device deleted', req.user.username] }]);
  await audit(req.user, 'NETMAP', null, `Network map "${d.site}": deleted device ${d.hostname}`);
  res.json({ ok: true });
}));

// Write one port; when it points at a device of the site, make that device's port point back; when it used to
// point at another device's port that still points here, clear that one.
async function setPort(dev, port, values, user) {
  const before = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, port]);
  const v = Object.fromEntries(FIELDS.map(k => [k, str(values[k], k === 'note' ? 200 : 80)]));
  await run(`INSERT INTO net_ports (device_id, port, sort, ${FIELDS.join(', ')}, updated_by) VALUES (?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)
      ON CONFLICT(device_id, port) DO UPDATE SET ${FIELDS.map(k => `${k} = excluded.${k}`).join(', ')}, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    [dev.id, port, portSort(port), ...FIELDS.map(k => v[k]), user]);
  if (desc(before) !== desc(v)) await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [dev.site, dev.hostname, port, desc(before), desc(v), user]);
  return { before, v };
}
async function mirror(dev, port, before, v, user) {
  const peerOf = async (host) => (host ? get('SELECT * FROM net_devices WHERE site = ? AND hostname = ?', [dev.site, host]) : null);
  // Old peer: if it pointed back here, free it.
  if (before && before.peer_host && (before.peer_host !== v.peer_host || before.peer_port !== v.peer_port)) {
    const op = await peerOf(before.peer_host);
    if (op && before.peer_port) {
      const back = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [op.id, before.peer_port]);
      if (back && back.peer_host === dev.hostname && back.peer_port === port) await setPort(op, before.peer_port, { ...back, peer_host: '', peer_port: '', cable: '' }, user);
    }
  }
  // New peer: point back (keep its own VLAN / mode / patch).
  const np = await peerOf(v.peer_host);
  if (np && v.peer_port) {
    const cur = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [np.id, v.peer_port]) || {};
    if (cur.peer_host !== dev.hostname || cur.peer_port !== port || cur.cable !== v.cable) {
      // The new peer port was connected elsewhere: free that other end first.
      if (cur.peer_host && (cur.peer_host !== dev.hostname || cur.peer_port !== port)) {
        const other = await peerOf(cur.peer_host);
        if (other && cur.peer_port) { const ob = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [other.id, cur.peer_port]);
          if (ob && ob.peer_host === np.hostname && ob.peer_port === v.peer_port) await setPort(other, cur.peer_port, { ...ob, peer_host: '', peer_port: '', cable: '' }, user); }
      }
      await setPort(np, v.peer_port, { ...cur, peer_host: dev.hostname, peer_port: port, cable: v.cable, grp: cur.grp || v.grp }, user);
    }
  }
}
router.put('/port', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const dev = await deviceOf(req.body.device_id), port = str(req.body.port, 40);
  if (!dev || !port) return res.status(400).json({ error: 'Device and port are required' });
  if (req.body.peer_host === dev.hostname && req.body.peer_port === port) return res.status(400).json({ error: 'A port cannot connect to itself' });
  const { before, v } = await setPort(dev, port, req.body, req.user.username);
  await mirror(dev, port, before, v, req.user.username);
  await audit(req.user, 'NETMAP', null, `Network map "${dev.site}": ${dev.hostname} ${port}: ${desc(before)} → ${desc(v)}`);
  res.json({ ok: true });
}));
// Swap the cabling of two ports of one device (move a cable to another port).
router.post('/port/move', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const dev = await deviceOf(req.body.device_id), from = str(req.body.from, 40), to = str(req.body.to, 40);
  if (!dev || !from || !to || from === to) return res.status(400).json({ error: 'Choose two different ports' });
  const a = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, from]) || {};
  const b = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, to]) || {};
  const pick = (p) => Object.fromEntries(FIELDS.map(k => [k, p[k] || '']));
  const A = pick(a), B = pick(b), u = req.user.username;
  // Write both, then fix the far ends to point at the new port numbers.
  const r1 = await setPort(dev, to, A, u);
  const r2 = await setPort(dev, from, B, u);
  for (const [port, v, oldPort] of [[to, A, from], [from, B, to]]) {
    if (!v.peer_host || !v.peer_port) continue;
    const np = await get('SELECT * FROM net_devices WHERE site = ? AND hostname = ?', [dev.site, v.peer_host]);
    if (!np) continue;
    const cur = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [np.id, v.peer_port]);
    if (cur && cur.peer_host === dev.hostname && cur.peer_port === oldPort) await setPort(np, v.peer_port, { ...cur, peer_port: port }, u);
  }
  void r1; void r2;
  await audit(req.user, 'NETMAP', null, `Network map "${dev.site}": ${dev.hostname} moved ${from} ⇄ ${to}`);
  res.json({ ok: true });
}));

router.get('/log', wrap(async (req, res) => {
  const site = str(req.query.site, 80), dev = str(req.query.device, 80);
  res.json(await all(`SELECT * FROM net_port_log WHERE site = ?${dev ? ' AND device = ?' : ''} ORDER BY id DESC LIMIT 300`, dev ? [site, dev] : [site]));
}));

// ── Server Inventory ← Network map (the implementation document) ───────────────
// Matches each network device to a Server Inventory record by serial / service tag (ignoring a leading "S"
// some barcode exports add) and proposes the missing hostname, IP, location and IP list; devices with no record
// can be added.  GET = preview, POST { site, items: [{ net_id, server_id | 0, fields }] } = apply (admins).
const CAT = { Firewall: 'Firewall', Router: 'Voice Gateway', 'Core switch': 'Switch', 'Distribution switch': 'Switch', 'Server switch': 'Switch', 'Access switch': 'Switch',
  'Wireless controller': 'Wireless Controller', 'HCI server': 'Dell Vx-rails', 'Backup storage': 'Dell Data Domain', Server: 'Server', 'ISP / external': 'ISP Router', 'Access point': 'Access Point' };
const normSn = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const snEqRaw = (a, b) => { a = normSn(a); b = normSn(b); return !!a && !!b && (a === b || (a.length > 6 && b.length > 6 && (('S' + a) === b || a === ('S' + b)))); };
const snEq = snEqRaw;
const ipsText = (ips) => { try { return JSON.parse(ips || '[]').map(x => `${x.name}: ${x.ip}`).join('\n'); } catch { return ''; } };
// Model code of a device ("CISCO N3K-C3524P-XL" → N3KC3524PXL, "FIREWALL SOPHOS XG210" → XG210) to compare with Server Inventory models.
const modelCode = (m) => { const t = String(m || '').toUpperCase().split(/\s+/).filter(w => /\d/.test(w)).sort((a, b) => b.length - a.length)[0] || ''; return t.replace(/[^A-Z0-9]/g, ''); };
const sameModel = (a, b) => { const c = modelCode(a); return c.length >= 4 && String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(c); };
async function syncPlan(site, choose = {}) {
  const devs = await all('SELECT * FROM net_devices WHERE site = ? ORDER BY hostname', [site]);
  const servers = await all('SELECT id, hostname, brand_model, serial_no, ip_address, location, role, category, country, net_info FROM servers WHERE deleted_at IS NULL');
  const used = new Set(), out = [], how = new Map();
  // 1) the record you picked, 2) linked before, 3) same serial / service tag, 4) same model (serial differs → check).
  const first = new Map();
  for (const d of devs) {
    const c = choose[d.id];
    let s = c != null ? (Number(c) ? servers.find(x => x.id === Number(c)) : null) : (d.server_id && servers.find(x => x.id === d.server_id)) || servers.find(x => !used.has(x.id) && (snEq(x.serial_no, d.serial) || snEq(x.serial_no, d.service_tag)));
    if (s) { used.add(s.id); first.set(d.id, s); how.set(d.id, c != null ? 'picked' : 'serial'); }
    else if (c != null) first.set(d.id, null);
  }
  for (const d of devs) {
    if (first.has(d.id)) continue;
    const s = servers.find(x => !used.has(x.id) && sameModel(d.model, x.brand_model));
    if (s) { used.add(s.id); first.set(d.id, s); how.set(d.id, 'model'); } else first.set(d.id, null);
  }
  for (const d of devs) {
    const s = first.get(d.id);
    const candidates = servers.filter(x => sameModel(d.model, x.brand_model)).map(x => ({ id: x.id, label: `#${x.id} ${x.brand_model} · S/N ${x.serial_no || '—'}${x.hostname ? ' · ' + x.hostname : ''}` }));
    let ipl = []; try { ipl = JSON.parse(d.ips || '[]'); } catch {}
    const want = { hostname: d.hostname, ip_address: (d.mgmt_ip || '').split('/')[0] || ((ipl.find(x => /idrac|mgmt|ip address/i.test(x.name)) || {}).ip || '').split('/')[0], location: d.location, role: d.alias || d.role, net_info: [ipsText(d.ips), d.services ? `Services: ${d.services}` : ''].filter(Boolean).join('\n') };
    const fields = {};
    if (s) { for (const [k, v] of Object.entries(want)) if (v && String(s[k] || '').trim() !== String(v).trim()) fields[k] = { from: s[k] || '', to: v }; }
    else for (const [k, v] of Object.entries({ ...want, brand_model: d.model, serial_no: d.serial || d.service_tag, category: CAT[d.role] || 'Network device' })) if (v) fields[k] = { from: '', to: v };
    out.push({ net_id: d.id, hostname: d.hostname, role: d.role, model: d.model, serial: d.serial || d.service_tag, server: s ? { id: s.id, brand_model: s.brand_model, serial_no: s.serial_no, hostname: s.hostname } : null,
      action: s ? (Object.keys(fields).length ? 'update' : 'same') : 'add', fields, how: how.get(d.id) || '', candidates,
      warn: s && how.get(d.id) === 'model' ? ((d.serial || d.service_tag) ? `Matched by model — the document's serial ${d.serial || d.service_tag} differs from this record's ${s.serial_no || '(none)'}. Pick the right record.`
        : `Matched by model only (no serial in the document) — check the label on the device and pick the right record.`) : '' });
  }
  return out;
}
router.get('/inventory-sync', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  let choose = {}; try { choose = JSON.parse(req.query.choose || '{}'); } catch {}
  res.json({ site: str(req.query.site, 80), items: await syncPlan(str(req.query.site, 80), choose) });
}));
router.post('/inventory-sync', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80), pick = new Set((req.body.net_ids || []).map(Number));
  const plan = (await syncPlan(site, req.body.choose || {})).filter(p => pick.has(p.net_id) && p.action !== 'same');
  const ALLOWED = ['hostname', 'ip_address', 'location', 'role', 'net_info', 'brand_model', 'serial_no', 'category'];
  let updated = 0, added = 0;
  // New records take the country most of the matched devices have.
  const cs = plan.filter(p => p.server).map(p => p.server.id); const cc = cs.length ? await get(`SELECT country, COUNT(*) n FROM servers WHERE id IN (${cs.map(() => '?').join(',')}) GROUP BY country ORDER BY n DESC LIMIT 1`, cs) : null;
  const country = (cc && cc.country) || 'Vietnam';
  for (const p of plan) {
    const f = Object.fromEntries(Object.entries(p.fields).filter(([k]) => ALLOWED.includes(k)).map(([k, v]) => [k, String(v.to).slice(0, 2000)]));
    if (p.server) {
      if (!Object.keys(f).length) continue;
      await run(`UPDATE servers SET ${Object.keys(f).map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, [...Object.values(f), p.server.id]);
      await run('UPDATE net_devices SET server_id = ? WHERE id = ?', [p.server.id, p.net_id]); updated++;
    } else {
      const producer = /cisco|nexus|n3k|c9200|isr|air-/i.test(f.brand_model || '') ? 'Cisco' : /dell|vxrail|poweredge|data domain/i.test(f.brand_model || '') ? 'Dell' : /sophos/i.test(f.brand_model || '') ? 'Sophos' : '';
      await run(`INSERT INTO servers (country, hostname, brand_model, producer, category, serial_no, ip_address, location, role, net_info, status, remark)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)`, [country, f.hostname || p.hostname, f.brand_model || '', producer, f.category || 'Network device', f.serial_no || '', f.ip_address || '', f.location || '', f.role || '', f.net_info || '', `Added from the network map (${site})`]);
      const s = await get('SELECT id FROM servers WHERE hostname = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', [f.hostname || p.hostname]);
      if (s) await run('UPDATE net_devices SET server_id = ? WHERE id = ?', [s.id, p.net_id]); added++;
    }
  }
  await audit(req.user, 'UPDATE', null, `Server Inventory updated from the network map "${site}": ${updated} updated, ${added} added`);
  res.json({ ok: true, updated, added });
}));

module.exports = router;
