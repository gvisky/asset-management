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
const OTA = require('../lib/ot-activity');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
// Asset users, and the OT team (Operation Technology) — OT only reads, and only its OT view.
const isOT = (req) => !!req.user && req.user.team === 'OT';
router.use((req, res, next) => (req.user && (req.user.asset_access !== 0 || isOT(req)) ? next() : res.status(403).json({ error: 'No access' })));
const canEdit = (req) => ['admin', 'editor'].includes(req.user.role) && !isOT(req);
const isAdmin = (req) => req.user.role === 'admin' && !isOT(req);
// OT view: the Kabin switches (IT-KABIN, HARICI KABIN, CCTV …, card readers) and everything cabled to them. A device's "ot"
// column overrides the rule (1 = show, 0 = hide). IT can preview it with ?view=ot.
const otView = (req) => isOT(req) || req.query.view === 'ot';
// OT editors may change the ports of their switches that go to end devices (cameras, access control, PCs …) or are free —
// never a port cabled to a network device, and never cable one to a network device.
const otPortEdit = (req) => isOT(req) && req.user.role === 'editor';
// IT end devices on a port — OT may not change them: an access point / printer / phone / PC by its name, or a Server Inventory
// record that is not OT (by "Connected to", name or MAC on the port).
const IT_NAME = /(^|[^A-Z0-9])(K\d+|HK\d+|DA)-?AP\d|ACCESS\s*POINT|\bAP\d+\b|PRINTER|\bPRINT\b|PHONE|\bSEP[0-9A-F]{6,}|LAPTOP|DESKTOP|\bPC\b|\bTV\b|WLC/i;
async function itPortCheck(site) {
  const recs = await all("SELECT hostname, mac, switch_port, it_ot FROM servers WHERE deleted_at IS NULL");
  const itRecs = recs.filter(r => r.it_ot !== 'OT'), otRecs = recs.filter(r => r.it_ot === 'OT');
  const hx = (v) => String(v || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  const k = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const itName = new Set(itRecs.map(r => k(r.hostname)).filter(x => x.length >= 4)), otName = new Set(otRecs.map(r => k(r.hostname)).filter(x => x.length >= 3));
  const itMac = itRecs.map(r => hx(r.mac)).filter(m => m.length === 12), itSp = new Set(itRecs.map(r => String(r.switch_port || '').trim()).filter(Boolean));
  const otMac = otRecs.map(r => hx(r.mac)).filter(m => m.length === 12), otSp = new Set(otRecs.map(r => String(r.switch_port || '').trim()).filter(Boolean));
  // Returns why the port / name is IT's, or ''.
  return {
    port: (devHost, p) => {
      if (!p) return '';
      const peer = String(p.peer_host || ''), text = `${peer} ${p.peer_port || ''} ${p.note || ''}`;
      if (peer && otName.has(k(peer))) return '';
      if (itSp.has(`${devHost} ${p.port}`)) return 'an IT device of the Server Inventory is connected here';
      if (peer && itName.has(k(peer))) return `${peer} is an IT device in the Server Inventory`;
      if (itMac.some(m => hx(text).includes(m))) return 'the MAC on this port is an IT device';
      if (IT_NAME.test(`${peer} ${p.peer_port || ''}`)) return `${peer || p.peer_port} is an IT device (access point / printer / phone / PC)`;
      return '';
    },
    name: (n) => (!n ? '' : otName.has(k(n)) ? '' : itName.has(k(n)) ? `${n} is an IT device in the Server Inventory` : IT_NAME.test(n) ? `${n} looks like an IT device (access point / printer / phone / PC)` : ''),
    // Why the port is OT's (an OT device of the Server Inventory on it), or ''.
    ot: (devHost, p) => {
      if (!p) return '';
      const peer = String(p.peer_host || ''), text = `${peer} ${p.peer_port || ''} ${p.note || ''}`;
      if (otSp.has(`${devHost} ${p.port}`)) return 'an OT device of the Server Inventory is connected here';
      if (peer && otName.has(k(peer))) return `${peer} is an OT device in the Server Inventory`;
      if (otMac.some(m => hx(text).includes(m))) return 'the MAC on this port is an OT device';
      return '';
    },
  };
}
// Owner of a switch port: OT (blue) or IT (green), '' = free. Set by IT (net_ports.ot 1 / 0), else automatic: a network device
// is IT's; an OT / IT device of the Server Inventory (port, name or MAC) decides; any other end device belongs to the switch's
// side (OT switch → OT). Returns { owner, why }.
function portOwner(dev, p, itc, hosts) {
  if (p.ot === 1) return { owner: 'OT', why: 'set to OT by IT' };
  if (p.ot === 0) return { owner: 'IT', why: 'set to IT by IT' };
  if (p.peer_host && hosts.has(p.peer_host)) return { owner: 'IT', why: `cabled to the network device ${p.peer_host}` };
  if (itc.ot(dev.hostname, p) && !itc.port(dev.hostname, p).startsWith('an IT device of the Server Inventory')) return { owner: 'OT', why: itc.ot(dev.hostname, p) };
  const it = itc.port(dev.hostname, p); if (it) return { owner: 'IT', why: it };
  if (!(p.peer_host || p.patch || p.vlan || p.mode || p.note)) return { owner: '', why: 'free' };
  return otOn(dev) ? { owner: 'OT', why: 'end device on an OT switch' } : { owner: 'IT', why: 'end device on an IT switch' };
}
async function withOwners(site, devices, ports) {
  const itc = await itPortCheck(site), byId = new Map(devices.map(d => [d.id, d]));
  const hosts = new Set((await all('SELECT hostname FROM net_devices WHERE site = ?', [site])).map(r => r.hostname));
  return ports.map(p => { const d = byId.get(p.device_id); if (!d) return p; const o = portOwner(d, p, itc, hosts); return { ...p, owner: o.owner, owner_why: o.why }; });
}
const otAuto = (d) => /switch/i.test(d.role || '') && (/KABIN/i.test(d.location || '') || /CCTV|CAMERA|CARD.?READER|ACCESS.?CONTROL|SECURITY/i.test(`${d.hostname} ${d.alias || ''}`));
const otOn = (d) => (d.ot === 1 ? true : d.ot === 0 ? false : otAuto(d));
// Only the OT team's part of a site: OT switches with all their ports, plus the core / distribution switches they uplink to
// (only the ports that lead to an OT switch), so the topology still shows how the Kabins hang together.
function otSlice(devices, ports) {
  const vis = devices.filter(d => d.state !== 'retired' && otOn(d));
  const visIds = new Set(vis.map(d => d.id)), visHosts = new Set(vis.map(d => d.hostname));
  const byHost = new Map(devices.map(d => [d.hostname, d]));
  const ctx = new Map();
  for (const p of ports) if (visIds.has(p.device_id) && p.peer_host && !visHosts.has(p.peer_host)) {
    const d = byHost.get(p.peer_host);
    if (d && d.state !== 'retired' && /core|distribution/i.test(d.role || '')) ctx.set(d.id, d);
  }
  const outPorts = ports.filter(p => visIds.has(p.device_id) || (ctx.has(p.device_id) && visHosts.has(p.peer_host)));
  // Network devices behind the visible ports that OT does not see (APs, other switches): their ports stay "to network devices".
  const shown = new Set([...visHosts, ...[...ctx.values()].map(d => d.hostname)]);
  const netHosts = [...new Set(outPorts.map(p => p.peer_host).filter(h => h && byHost.has(h) && !shown.has(h)))];
  const strip = (d, context) => ({ id: d.id, site: d.site, hostname: d.hostname, alias: d.alias, role: d.role, model: d.model, serial: context ? '' : d.serial,
    mgmt_ip: d.mgmt_ip, mac: context ? '' : d.mac, location: d.location, notes: context ? '' : d.notes, x: d.x, y: d.y, state: d.state, ips: context ? '' : d.ips, ot_context: context ? 1 : 0 });
  return { devices: [...vis.map(d => strip(d, false)), ...[...ctx.values()].map(d => strip(d, true))], ports: outPorts, netHosts };
}
const str = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n);
// MAC address in one spelling: 68:9e:0b:8a:e3:78, 689E.0B8A.E378, 68-9E-… → 68:9E:0B:8A:E3:78 (anything else kept as typed).
const macNorm = (v) => { const h = String(v || '').replace(/[^0-9a-f]/gi, ''); return h.length === 12 && /^[\s0-9a-f:.-]+$/i.test(String(v).trim()) ? h.toUpperCase().match(/../g).join(':') : str(v, 40); };
const FIELDS = ['peer_host', 'peer_port', 'cable', 'mode', 'vlan', 'grp', 'patch', 'note'];
// Order ports naturally: "GE 1/0/2" before "GE 1/0/10"; named ports (IDRAC, MGMT …) first.
const portSort = (p) => { const n = String(p).match(/(\d+)(?:\/(\d+))?(?:\/(\d+))?\s*$/); if (!n) return 0; return (Number(n[1]) || 0) * 1e6 + (Number(n[2]) || 0) * 1e3 + (Number(n[3]) || 0) + (/^(T|TE|XE|E 1\/4[89])/i.test(p) ? 5e8 : 1e3); };
const desc = (p) => (p && (p.peer_host || p.peer_port || p.patch) ? `${p.peer_host || ''} ${p.peer_port || ''}${p.patch ? ' [' + p.patch + ']' : ''}${p.vlan ? ' vlan ' + p.vlan : ''}${p.mode ? ' ' + p.mode : ''}`.trim() : '(free)');

// Server Inventory records that know their switch port ("Connected to"), shown on that port. OT: only OT records;
// users without Asset Inventory access (other than OT) get none.
async function records(req, otOnly) {
  if (req.user.asset_access === 0 && !isOT(req)) return [];
  return all(`SELECT id, hostname, category, switch_port, it_ot FROM servers WHERE deleted_at IS NULL AND COALESCE(switch_port, '') <> ''${otOnly || isOT(req) ? " AND it_ot = 'OT'" : ''}`);
}
router.get('/', wrap(async (req, res) => {
  const sites = (await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY site')).map(r => ({ site: r.site, devices: r.n }));
  const site = req.query.site != null ? str(req.query.site, 80) : (sites[0] ? sites[0].site : '');
  let devices = await all('SELECT * FROM net_devices WHERE site = ? ORDER BY hostname', [site]);
  let ports = devices.length ? await all(`SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ? ORDER BY p.device_id, p.sort, p.port`, [site]) : [];
  let vlans = await all('SELECT * FROM net_vlans WHERE site = ? ORDER BY CAST(vlan AS INTEGER)', [site]);
  let patches = await all('SELECT panel, port, outlet, note FROM net_patch_ports WHERE site = ? ORDER BY panel, port', [site]);
  const team = { isOT: isOT(req), isIT: req.user.team === 'IT' };
  if (otView(req)) {
    // Read-only slice for the OT team (or IT previewing it): no racks, drawings, patch panels or other devices.
    const sl = otSlice(devices, ports);
    const used = new Set(); sl.ports.forEach(p => String(p.vlan || '').split(/[,\s]+/).filter(Boolean).forEach(v => used.add(v)));
    const otSites = [];
    for (const s2 of sites) { const n = s2.site === site ? sl.devices.filter(d => !d.ot_context).length
      : (await all('SELECT * FROM net_devices WHERE site = ?', [s2.site])).filter(d => d.state !== 'retired' && otOn(d)).length; if (n) otSites.push({ site: s2.site, devices: n }); }
    const otRecords = await records(req, true);
    const fullDev = new Map(devices.map(d => [d.id, d]));
    const owned = await withOwners(site, sl.ports.map(p => fullDev.get(p.device_id)).filter(Boolean).filter((d, i, a) => a.indexOf(d) === i), sl.ports);
    const itPorts = owned.filter(p => p.owner === 'IT').map(p => ({ id: p.id, why: p.owner_why }));
    return res.json({ site, sites: otSites, records: otRecords, it_ports: itPorts, devices: sl.devices, ports: owned, net_hosts: sl.netHosts, vlans: vlans.filter(v => used.has(String(v.vlan))), patches: [], view: 'ot',
      can: { edit: false, admin: false, port: otPortEdit(req) }, team });
  }
  ports = await withOwners(site, devices, ports);
  devices = devices.map(d => ({ ...d, ot_on: otOn(d) ? 1 : 0, ot_auto: otAuto(d) ? 1 : 0 }));
  res.json({ site, sites, devices, ports, vlans, patches, records: await records(req, false), view: 'it', can: { edit: canEdit(req), admin: isAdmin(req) }, team });
}));

router.post('/import', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80) || 'Main site';
  const devices = Array.isArray(req.body.devices) ? req.body.devices.slice(0, 2000) : [];
  const ports = Array.isArray(req.body.ports) ? req.body.ports.slice(0, 20000) : [];
  const vlans = Array.isArray(req.body.vlans) ? req.body.vlans.slice(0, 4096) : [];
  const patches = Array.isArray(req.body.patches) ? req.body.patches.slice(0, 5000) : [];
  const equipment = Array.isArray(req.body.equipment) ? req.body.equipment.slice(0, 500) : [];
  if (!devices.length) return res.status(400).json({ error: 'No devices found in the file' });
  const stmts = [];
  if (req.body.replace) {
    // Replace = the ports and VLANs come again from the document; devices that are still in it keep their id,
    // so rack places, map positions and Server Inventory links stay. Devices no longer in it are removed.
    const keep = devices.map(d => str(d.hostname, 80)).filter(Boolean);
    stmts.push({ sql: "DELETE FROM net_ports WHERE device_id IN (SELECT id FROM net_devices WHERE site = ? AND COALESCE(source, '') <> 'workbook')", args: [site] });
    // Devices added from the Factory Info workbook (Palo Alto, APs, printers …) are not in the document: they stay.
    stmts.push({ sql: `DELETE FROM net_rack_items WHERE device_id IN (SELECT id FROM net_devices WHERE site = ? AND COALESCE(source, '') <> 'workbook' AND hostname NOT IN (${keep.map(() => '?').join(',') || "''"}))`, args: [site, ...keep] });
    stmts.push({ sql: `DELETE FROM net_devices WHERE site = ? AND COALESCE(source, '') <> 'workbook' AND hostname NOT IN (${keep.map(() => '?').join(',') || "''"})`, args: [site, ...keep] });
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
  if (equipment.length) {
    stmts.push({ sql: 'DELETE FROM net_equipment WHERE site = ?', args: [site] });
    for (const e of equipment) stmts.push({ sql: 'INSERT INTO net_equipment (site, part, description, qty) VALUES (?, ?, ?, ?)', args: [site, str(e.part, 120), str(e.desc, 600), Math.max(0, Number(e.qty) || 0)] });
  }
  if (patches.length) stmts.push({ sql: 'DELETE FROM net_patch_ports WHERE site = ?', args: [site] });
  for (const x of patches) {
    const panel = str(x.panel, 40), port = Number(x.port); if (!panel || !port) continue;
    stmts.push({ sql: 'INSERT OR REPLACE INTO net_patch_ports (site, panel, port, outlet) VALUES (?, ?, ?, ?)', args: [site, panel, port, str(x.outlet, 20)] });
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
  // Devices already in Server Inventory under the same hostname are linked to it.
  await run(`UPDATE net_devices SET server_id = (SELECT s.id FROM servers s WHERE s.deleted_at IS NULL AND UPPER(s.hostname) = UPPER(net_devices.hostname) LIMIT 1)
      WHERE site = ? AND server_id IS NULL`, [site]);
  await audit(req.user, 'NETMAP', null, `Network map "${site}": imported ${ids.size} devices, ${pst.length} ports, ${vlans.length} VLANs${req.body.replace ? ' (replaced)' : ''}`);
  res.json({ ok: true, site, devices: ids.size, ports: pst.length, vlans: vlans.length, patches: patches.length });
}));

async function deviceOf(id) { return get('SELECT * FROM net_devices WHERE id = ?', [Number(id)]); }
router.post('/device', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const site = str(req.body.site, 80), h = str(req.body.hostname, 80);
  if (!h) return res.status(400).json({ error: 'Hostname is required' });
  if (await get('SELECT id FROM net_devices WHERE site = ? AND hostname = ?', [site, h])) return res.status(409).json({ error: 'This hostname already exists' });
  await run('INSERT INTO net_devices (site, hostname, alias, role, model, serial, mgmt_ip, mac, location, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [site, h, str(req.body.alias), str(req.body.role, 40), str(req.body.model), str(req.body.serial, 60), str(req.body.mgmt_ip, 60), macNorm(req.body.mac), str(req.body.location), str(req.body.notes, 500)]);
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
  if ('ot' in b) {
    const ot = b.ot === 1 || b.ot === '1' ? 1 : b.ot === 0 || b.ot === '0' ? 0 : null;
    if (ot !== d.ot) { await run('UPDATE net_devices SET ot = ? WHERE id = ?', [ot, d.id]);
      await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [d.site, d.hostname, '', `OT view: ${d.ot == null ? 'auto' : d.ot ? 'shown' : 'hidden'}`, `OT view: ${ot == null ? 'auto' : ot ? 'shown' : 'hidden'}`, req.user.username]); }
  }
  if ('state' in b) {
    const st = b.state === 'retired' ? 'retired' : '';
    await run("UPDATE net_devices SET state = ?, updated_at = datetime('now') WHERE id = ?", [st, d.id]);
    if (st !== (d.state || '')) await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [d.site, d.hostname, '', d.state || 'in use', st || 'in use', req.user.username]);
  }
  if ('alias' in b) {
    await run(`UPDATE net_devices SET alias = ?, role = ?, model = ?, serial = ?, mgmt_ip = ?, mac = ?, location = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [str(b.alias), str(b.role, 40), str(b.model), str(b.serial, 60), str(b.mgmt_ip, 60), 'mac' in b ? macNorm(b.mac) : (d.mac || ''), str(b.location), str(b.notes, 500), d.id]);
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
// meta (optional): OT activity log entry details ({ kind, restore_of, prefix, force, withOt: also set the owner column }).
async function setPort(dev, port, values, user, meta = {}) {
  const before = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, port]);
  const v = Object.fromEntries(FIELDS.map(k => [k, str(values[k], k === 'note' ? 200 : 80)]));
  await run(`INSERT INTO net_ports (device_id, port, sort, ${FIELDS.join(', ')}, updated_by) VALUES (?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)
      ON CONFLICT(device_id, port) DO UPDATE SET ${FIELDS.map(k => `${k} = excluded.${k}`).join(', ')}, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    [dev.id, port, portSort(port), ...FIELDS.map(k => v[k]), user]);
  if (meta.withOt) await run('UPDATE net_ports SET ot = ? WHERE device_id = ? AND port = ?', [values.ot === 1 || values.ot === 0 ? values.ot : null, dev.id, port]);
  if (desc(before) !== desc(v)) await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [dev.site, dev.hostname, port, desc(before), desc(v), user]);
  await OTA.logPort(user, dev, before, await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, port]), { ...meta, port });
  return { before, v };
}
// OT activity → restore a port as it was (and its far end, like a normal edit).
async function restorePort(dev, port, values, user, meta) {
  const u = typeof user === 'object' ? user.username : user;
  const { before, v } = await setPort(dev, port, values, u, { ...meta, withOt: true });
  await mirror(dev, port, before, v, u);
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
  if (!canEdit(req) && !otPortEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const dev = await deviceOf(req.body.device_id), port = str(req.body.port, 40);
  if (!dev || !port) return res.status(400).json({ error: 'Device and port are required' });
  if (!canEdit(req)) {
    // OT editor: only an OT switch, only end-device / free ports, port-channel unchanged.
    if (dev.state === 'retired' || !otOn(dev)) return res.status(403).json({ error: 'This device is not in the OT view' });
    const hosts = new Set((await all('SELECT hostname FROM net_devices WHERE site = ?', [dev.site])).map(r => r.hostname));
    const cur = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, port]);
    if (cur && cur.peer_host && hosts.has(cur.peer_host)) return res.status(403).json({ error: `${port} is cabled to the network device ${cur.peer_host} — only IT can change it.` });
    if (hosts.has(str(req.body.peer_host, 80))) return res.status(403).json({ error: 'Connecting a network device is for IT — use a camera / access-control / end-device name.' });
    const it = await itPortCheck(dev.site), o = cur ? portOwner(dev, cur, it, hosts) : { owner: '' };
    if (o.owner === 'IT') return res.status(403).json({ error: `${port}: ${o.why} — only IT can change it.` });
    const whyNew = cur && cur.ot === 1 ? '' : it.name(str(req.body.peer_host, 80));
    if (whyNew) return res.status(403).json({ error: `${whyNew} — only IT can connect it.` });
    req.body.grp = cur ? cur.grp : '';
  }
  if (req.body.peer_host === dev.hostname && req.body.peer_port === port) return res.status(400).json({ error: 'A port cannot connect to itself' });
  const { before, v } = await setPort(dev, port, req.body, req.user.username);
  await mirror(dev, port, before, v, req.user.username);
  await audit(req.user, 'NETMAP', null, `Network map "${dev.site}": ${dev.hostname} ${port}: ${desc(before)} → ${desc(v)}`);
  res.json({ ok: true });
}));
// IT team: set a port's owner — OT (blue: the OT team may change it), IT (green) or automatic. PUT { device_id, port, ot: 1 | 0 | null }.
router.put('/port/owner', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'IT admins and editors only' });
  const dev = await deviceOf(req.body.device_id), port = str(req.body.port, 40);
  if (!dev || !port) return res.status(400).json({ error: 'Device and port are required' });
  const ot = req.body.ot === 1 || req.body.ot === '1' ? 1 : req.body.ot === 0 || req.body.ot === '0' ? 0 : null;
  const cur = await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, port]);
  if (!cur) await run('INSERT INTO net_ports (device_id, port, sort, ot, updated_by) VALUES (?, ?, ?, ?, ?)', [dev.id, port, portSort(port), ot, req.user.username]);
  else await run("UPDATE net_ports SET ot = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?", [ot, req.user.username, cur.id]);
  await OTA.logPort(req.user, dev, cur || null, await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [dev.id, port]), { kind: 'port_owner', port, force: true });
  const lbl = (v) => (v === 1 ? 'OT' : v === 0 ? 'IT' : 'automatic');
  await run('INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', [dev.site, dev.hostname, port, `owner ${lbl(cur ? cur.ot : null)}`, `owner ${lbl(ot)}`, req.user.username]);
  await audit(req.user, 'NETMAP', null, `Network map "${dev.site}": ${dev.hostname} ${port} owner → ${lbl(ot)}`);
  res.json({ ok: true, ot });
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
  if (otView(req)) {
    const hosts = (await all('SELECT * FROM net_devices WHERE site = ?', [site])).filter(d => d.state !== 'retired' && otOn(d)).map(d => d.hostname).filter(h => !dev || h === dev);
    if (!hosts.length) return res.json([]);
    return res.json(await all(`SELECT * FROM net_port_log WHERE site = ? AND device IN (${hosts.map(() => '?').join(',')}) AND port <> '' ORDER BY id DESC LIMIT 300`, [site, ...hosts]));
  }
  res.json(await all(`SELECT * FROM net_port_log WHERE site = ?${dev ? ' AND device = ?' : ''} ORDER BY id DESC LIMIT 300`, dev ? [site, dev] : [site]));
}));
// Everything below (Server Inventory sync, racks, drawing uploads) is not part of the OT view — except looking at the drawings.
router.use((req, res, next) => (isOT(req) && !(req.method === 'GET' && /^\/(drawings?|racks)(\/|$)/.test(req.path)) && !(req.method === 'PUT' && /^\/drawing\/\d+\/camera-pin$/.test(req.path)) ? res.status(403).json({ error: 'Not part of the OT view' }) : next()));
// OT view: only the factory cabinets (IT / CCTV / HARICI KABIN), never the server-room racks or their pictures.
const otRack = (r) => r.kind === 'cabinet' || /KABIN/i.test(r.name || '');
const otDrawing = (d) => !/server\s*room|system\s*room|main\s*rack/i.test(`${d.name || ''} ${d.category || ''}`);

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

// ── Racks ───────────────────────────────────────────────────────────────────────
//   GET  /api/netmap/racks?site=          { racks, items }
//   POST /api/netmap/racks/build          { site, replace }  racks + items from the devices' locations ("MAIN RACK - 03 (U29)", "IT-KABIN5")
//   POST /api/netmap/rack · PUT/DELETE /api/netmap/rack/:id · POST /api/netmap/rack-item · PUT/DELETE /api/netmap/rack-item/:id
const HEIGHT = (m) => (/R740|DD-?6300|DATA DOMAIN/i.test(m) ? 2 : 1);
function parseLoc(loc) {
  const L = String(loc || '').toUpperCase();
  let m = L.match(/MAIN RACK\s*-?\s*0?(\d+)/);
  const name = m ? `MR-0${m[1]}` : (L.match(/(?:IT[- ]?|HARICI[- ]?)KABIN\s*\d+/) || [''])[0].replace(/\s+/g, '-').replace('HARICI-', 'HARICI-');
  const u = L.match(/\(\s*U?(\d+)(?:\s*-\s*U?(\d+))?\s*\)/);
  return { rack: name, cabinet: !m && !!name, lo: u ? Math.min(Number(u[1]), Number(u[2] || u[1])) : null, hi: u ? Math.max(Number(u[1]), Number(u[2] || u[1])) : null };
}
router.get('/racks', wrap(async (req, res) => {
  const site = str(req.query.site, 80);
  let racks = await all('SELECT * FROM net_racks WHERE site = ? ORDER BY sort, name', [site]);
  let items = racks.length ? await all(`SELECT i.* FROM net_rack_items i JOIN net_racks r ON r.id = i.rack_id WHERE r.site = ? ORDER BY i.rack_id, i.u DESC`, [site]) : [];
  if (otView(req)) { racks = racks.filter(otRack); const ids = new Set(racks.map(r => r.id)); items = items.filter(i => ids.has(i.rack_id)); }
  res.json({ racks, items });
}));
// ── CCTV switches: in the racks only as labels ("SR-02/CCTV-ASW-03(9200)", "MR-02/CCTV-DSW-01") → real devices of the map
// with ports, linked to their rack slot. POST { site, dry } (admins). Same models and port layout as the Server Inventory / IT switches:
// Cisco C9200L-48P-4X-E = GE 1/0/1–48 + T 1/1/1–4 uplinks; WS-C3560CX-12PD-S = GE 1/0/1–12 + GE 1/0/13–14 uplinks (like the
// card-reader switches); distribution switches no ports (add them by hand). CCTV switches added before with other ports are corrected:
// missing ports added, model set, extra ports removed only when nothing is written on them.
const CCTV_LABEL = /^\s*([A-Z]{2}-\d+\/CCTV-(ASW|DSW)-\d+)\s*(?:\((\w+)\))?\s*$/i;
const CCTV_MODEL = { '9200': 'CISCO C9200L-48P-4X-E', '3560': 'WS-C3560CX-12PD-S' };
function cctvPorts(model) {
  if (/9200/.test(model)) return [...Array.from({ length: 48 }, (_, i) => `GE 1/0/${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `T 1/1/${i + 1}`)];
  if (/3560/.test(model)) return Array.from({ length: 14 }, (_, i) => `GE 1/0/${i + 1}`);
  return [];
}
router.post('/cctv-switches', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80);
  const items = await all(`SELECT i.*, r.name AS rack, r.kind AS rack_kind FROM net_rack_items i JOIN net_racks r ON r.id = i.rack_id
    WHERE r.site = ? AND i.device_id IS NULL ORDER BY r.sort, r.name, i.u DESC`, [site]);
  const devs = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  const have = new Set(devs.map(d => d.hostname.toUpperCase()));
  const servers = await all("SELECT id, hostname, serial_no FROM servers WHERE deleted_at IS NULL AND COALESCE(hostname, '') <> ''");
  const plan = [];
  for (const it of items) {
    const m = String(it.label || '').match(CCTV_LABEL); if (!m) continue;
    const hostname = m[1].toUpperCase(), dsw = /DSW/i.test(m[2]), fam = String(m[3] || '').toUpperCase();
    if (have.has(hostname) || plan.some(x => x.hostname === hostname)) continue;
    const mr = String(it.rack).match(/^MR-0?(\d+)$/i);
    const location = `${mr ? `MAIN RACK - 0${mr[1]}` : String(it.rack).replace(/^HARICI-/i, 'HARICI ')} (U${it.u}${it.height > 1 ? '-' + (it.u + it.height - 1) : ''})`;
    // No model in the label (MR-01/CCTV-ASW-01): a 48-port Catalyst 9200 like the other main-rack switches.
    const model = dsw ? 'CISCO' : CCTV_MODEL[fam] || CCTV_MODEL['9200'];
    const sv = servers.find(x => x.hostname.toUpperCase() === hostname);
    plan.push({ action: 'add', item_id: it.id, hostname, role: dsw ? 'Distribution switch' : 'Access switch', model, location, ports: dsw ? [] : cctvPorts(model), server_id: sv ? sv.id : null, alias: `CCTV ${dsw ? 'distribution' : 'access'} switch` });
  }
  // CCTV access switches added from the racks before (other port layout / model).
  const ports = await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site]);
  for (const d of devs.filter(x => x.source === 'racks' && /CCTV-ASW/i.test(x.hostname))) {
    // A real model (from the OT CCTV report, or typed: C9200L-24P-4X-E, C1000-16P …) is kept with its own port layout;
    // only the rack-label guesses ("CISCO C9200", "CISCO 3560CX") are set to the default model.
    const real = require('../lib/cctv-report').portsOf(d.model);
    const fam = /3560/.test(d.model) ? '3560' : '9200', model = real && /-/.test(d.model) ? d.model : CCTV_MODEL[fam], want = real && /-/.test(d.model) ? real : cctvPorts(model);
    const mine = ports.filter(p => p.device_id === d.id), names = new Set(mine.map(p => p.port));
    let add = want.filter(p => !names.has(p));
    const extra = mine.filter(p => !want.includes(p.port));
    const used = (p) => !!(p.peer_host || p.peer_port || p.note || p.vlan || p.patch || p.mode || p.cable);
    // A used port with the old name ("TE 1/1/1") is renamed to its right name ("T 1/1/1") when that one is still missing.
    const rename = [];
    for (const p of extra.filter(used)) { const to = p.port.replace(/^(TE|TEN|TWE)\s*/i, 'T '); if (add.includes(to)) { rename.push({ id: p.id, from: p.port, to }); add = add.filter(x => x !== to); } }
    const removable = extra.filter(p => !used(p));
    const keep = extra.filter(used).length - rename.length;
    if (!add.length && !removable.length && !rename.length && d.model === model) continue;
    plan.push({ action: 'fix', device_id: d.id, hostname: d.hostname, model, add, rename, remove: removable.map(p => p.id), keep, ports: want });
  }
  if (req.body.dry) return res.json({ site, rows: plan.map(p => ({ action: p.action, hostname: p.hostname, model: p.model, location: p.location || '', ports: p.ports.length,
    add: p.add ? p.add.length : p.ports.length, remove: p.remove ? p.remove.length : 0, rename: p.rename ? p.rename.length : 0, keep: p.keep || 0 })) });
  const stmts = [];
  for (const p of plan) {
    if (p.action === 'fix') {
      stmts.push({ sql: "UPDATE net_devices SET model = ?, updated_at = datetime('now') WHERE id = ?", args: [p.model, p.device_id] });
      p.add.forEach(pt => stmts.push({ sql: 'INSERT OR IGNORE INTO net_ports (device_id, port, sort) VALUES (?, ?, ?)', args: [p.device_id, pt, portSort(pt)] }));
      p.remove.forEach(id => stmts.push({ sql: "DELETE FROM net_ports WHERE id = ? AND COALESCE(peer_host, '') = '' AND COALESCE(note, '') = ''", args: [id] }));
      p.rename.forEach(r => { stmts.push({ sql: 'UPDATE net_ports SET port = ?, sort = ? WHERE id = ?', args: [r.to, portSort(r.to), r.id] });
        stmts.push({ sql: `UPDATE net_ports SET peer_port = ? WHERE peer_host = ? AND peer_port = ? AND device_id IN (SELECT id FROM net_devices WHERE site = ?)`, args: [r.to, p.hostname, r.from, site] }); });
      stmts.push({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [site, p.hostname, '', '', `ports set to ${p.model} (${p.ports.length})`, req.user.username] });
      continue;
    }
    stmts.push({ sql: `INSERT OR IGNORE INTO net_devices (site, hostname, alias, role, model, location, notes, source, server_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'racks', ?)`,
      args: [site, p.hostname, p.alias, p.role, p.model, p.location, 'Added from the rack layout (CCTV)', p.server_id] });
    p.ports.forEach(pt => stmts.push({ sql: `INSERT OR IGNORE INTO net_ports (device_id, port, sort) SELECT id, ?, ? FROM net_devices WHERE site = ? AND hostname = ?`, args: [pt, portSort(pt), site, p.hostname] }));
    stmts.push({ sql: `UPDATE net_rack_items SET device_id = (SELECT id FROM net_devices WHERE site = ? AND hostname = ?) WHERE id = ? AND device_id IS NULL`, args: [site, p.hostname, p.item_id] });
    stmts.push({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [site, p.hostname, '', '', 'device added (CCTV switch from the rack layout)', req.user.username] });
  }
  if (stmts.length) await batch(stmts);
  const added = plan.filter(p => p.action === 'add').length, fixed = plan.filter(p => p.action === 'fix').length;
  await audit(req.user, 'NETMAP', null, `Network map "${site}": ${added} CCTV switch(es) added from the rack layout, ${fixed} corrected`);
  res.json({ ok: true, added, fixed });
}));
// ── CCTV switches not in a rack yet (added from the OT CCTV report: K2_CCTV_02, HKn_CCTV_02, CB36-BP05 …) → their cabinet, in a
// free U next to the cabinet's CCTV switch (below first, then above; U1 = PDU and the top ODF are kept). POST { site, dry } (admins).
const { rackOfLocation, plan: cctvLinkPlan } = require('../lib/cctv-links');
router.post('/racks/place-cctv', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80);
  const devs = await all(`SELECT d.* FROM net_devices d WHERE d.site = ? AND d.role LIKE '%switch%' AND (d.hostname LIKE '%CCTV%' OR d.alias LIKE '%CCTV%')
    AND COALESCE(d.state, '') <> 'retired' AND NOT EXISTS (SELECT 1 FROM net_rack_items i WHERE i.device_id = d.id)`, [site]);
  const racks = new Map((await all('SELECT * FROM net_racks WHERE site = ?', [site])).map(r => [r.name.toUpperCase(), r]));
  const items = await all('SELECT i.*, d.hostname, d.alias FROM net_rack_items i JOIN net_racks r ON r.id = i.rack_id LEFT JOIN net_devices d ON d.id = i.device_id WHERE r.site = ?', [site]);
  const rows = [], taken = new Map();
  for (const d of devs.sort((a, b) => a.hostname.localeCompare(b.hostname))) {
    const rn = rackOfLocation(d.location), r = rn && racks.get(rn.toUpperCase());
    if (!r) { rows.push({ device_id: d.id, hostname: d.hostname, location: d.location, rack: rn || '', u: null, why: rn ? `no rack ${rn} in the Racks list` : 'location does not name a rack' }); continue; }
    const mine = items.filter(i => i.rack_id === r.id);
    if (!taken.has(r.id)) { const occ = new Set(); mine.forEach(i => { for (let u = i.u; u < i.u + i.height; u++) occ.add(u); }); taken.set(r.id, occ); }
    const occ = taken.get(r.id), h = 1;
    // Next to the cabinet's CCTV switch: below it first, then above (never U1 or the top U, where the PDU / ODF are).
    const anchor = mine.filter(i => i.device_id && /CCTV/i.test(`${i.hostname} ${i.alias} ${i.label}`)).sort((a, b) => b.u - a.u)[0];
    const start = anchor ? anchor.u : Math.ceil(r.units / 2), order = [];
    for (let k = 1; k < r.units; k++) { if (start - k >= 2) order.push(start - k); if (start + k <= r.units - 1) order.push(start + k); }
    const u = order.find(x => !occ.has(x));
    if (!u) { rows.push({ device_id: d.id, hostname: d.hostname, location: d.location, rack: r.name, u: null, why: `${r.name} is full` }); continue; }
    occ.add(u);
    const mr = r.name.match(/^MR-0?(\d+)$/i);
    rows.push({ device_id: d.id, hostname: d.hostname, rack_id: r.id, rack: r.name, u, next: anchor ? (anchor.hostname || anchor.label) : '',
      location: `${mr ? `MAIN RACK - 0${mr[1]}` : r.name.replace(/^HARICI-/i, 'HARICI ')} (U${u})` });
  }
  if (req.body.dry) return res.json({ site, rows });
  const stmts = [];
  for (const x of rows.filter(x => x.u)) {
    stmts.push({ sql: 'INSERT INTO net_rack_items (rack_id, device_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, ?, 1, 0)', args: [x.rack_id, x.device_id, 'device', x.hostname, x.u] });
    stmts.push({ sql: "UPDATE net_devices SET location = ?, updated_at = datetime('now') WHERE id = ?", args: [x.location, x.device_id] });
    stmts.push({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [site, x.hostname, '', '', `placed in ${x.rack} U${x.u}`, req.user.username] });
  }
  if (stmts.length) await batch(stmts);
  await audit(req.user, 'NETMAP', null, `Network map "${site}": ${rows.filter(x => x.u).length} CCTV switch(es) placed in their racks`);
  res.json({ ok: true, placed: rows.filter(x => x.u).length, rows });
}));
// ── CCTV uplinks: every CCTV switch linked to the one above it (cabinet's first switch → CCTV distribution → CCTV core, more
// switches of a cabinet → its first one) so the CCTV network is one tree on the topology. POST { site, dry } (admins).
router.post('/cctv-links', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80);
  const devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  const ports = await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site]);
  const fibre = (await all("SELECT links FROM net_drawings WHERE site = ? AND COALESCE(links, '') <> ''", [site]))
    .flatMap(r => { try { const l = JSON.parse(r.links); return Array.isArray(l) ? l : []; } catch { return []; } });
  const rows = cctvLinkPlan(devices, ports, fibre);
  if (req.body.dry) return res.json({ site, rows });
  const ok = rows.filter(r => r.port_id), stmts = [], snap = await OTA.snapOTPorts(site);
  for (const r of ok) {
    // A new link goes on a free port; a moved one (HK chain) only if the port still points where it did.
    stmts.push({ sql: `UPDATE net_ports SET peer_host = ?, peer_port = '', cable = 'SFP', mode = 'trunk', note = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ? AND COALESCE(peer_host, '') = ?`,
      args: [r.peer, r.note.slice(0, 300), req.user.username, r.port_id, r.from || ''] });
    stmts.push({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [site, r.hostname, r.port, r.from ? `${r.from} trunk` : '(free)', `${r.peer} trunk (CCTV uplink)`, req.user.username] });
  }
  if (stmts.length) await batch(stmts);
  await OTA.logPortsBulk(req.user, site, snap, 'CCTV uplinks');
  await audit(req.user, 'NETMAP', null, `Network map "${site}": ${ok.length} CCTV uplink(s) linked`);
  res.json({ ok: true, linked: ok.length, rows });
}));
router.post('/racks/build', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const site = str(req.body.site, 80);
  if (req.body.replace) await batch([{ sql: 'DELETE FROM net_rack_items WHERE rack_id IN (SELECT id FROM net_racks WHERE site = ?)', args: [site] }, { sql: 'DELETE FROM net_racks WHERE site = ?', args: [site] }]);
  const n = await placeDevices(site);
  await audit(req.user, 'NETMAP', null, `Network map "${site}": racks built from device locations (${n} items)`);
  res.json({ ok: true, items: n });
}));
// Put every device that is not in a rack yet where its location says; empty cabinets / MR-01 / MR-02 get their
// patch panels, cable managers and PDU like the drawing. Returns the number of items added.
async function placeDevices(site) {
  const devs = await all("SELECT id, hostname, model, location, role FROM net_devices WHERE site = ? AND role NOT IN ('Access point', 'Printer')", [site]);
  const racks = new Map((await all('SELECT * FROM net_racks WHERE site = ?', [site])).map(r => [r.name, r]));
  const ensure = async (name, cabinet) => {
    if (racks.has(name)) return racks.get(name);
    const n = cabinet ? Number((name.match(/\d+/) || [0])[0]) + 100 : Number((name.match(/\d+/) || [0])[0]);
    await run('INSERT OR IGNORE INTO net_racks (site, name, kind, units, sort, area) VALUES (?, ?, ?, ?, ?, ?)', [site, name, cabinet ? 'cabinet' : 'rack', cabinet ? 12 : 42, n, cabinet ? 'Factory' : 'Server room']);
    const r = await get('SELECT * FROM net_racks WHERE site = ? AND name = ?', [site, name]); racks.set(name, r); return r;
  };
  for (const n of ['MR-01', 'MR-02', 'MR-03', 'MR-04']) await ensure(n, false);   // the server room always has 4 racks (MR-02: patch panels)
  const placed = new Set((await all('SELECT device_id FROM net_rack_items WHERE device_id IS NOT NULL')).map(r => r.device_id));
  const stmts = [];
  // ISP lease-line routers have no location in the port tables; the rack drawing shows them at the top of MR-03.
  let ispU = 38;
  const used = new Map();
  for (const d of devs) {
    if (placed.has(d.id)) continue;
    let p = parseLoc(d.location);
    if (!p.rack && /ISP/i.test(d.role)) { p = { rack: 'MR-03', cabinet: false, lo: ispU, hi: ispU }; ispU -= 3; }
    if (!p.rack) continue;
    const r = await ensure(p.rack, p.cabinet);
    const h = p.lo && p.hi > p.lo ? p.hi - p.lo + 1 : HEIGHT(d.model);
    let u = p.lo || (p.cabinet ? 8 : null);
    if (!u) continue;
    // Two devices given the same U (copied rows in a sheet): the second goes to the next free U above.
    if (!used.has(r.id)) used.set(r.id, (await all('SELECT u, height FROM net_rack_items WHERE rack_id = ?', [r.id])).map(x => [x.u, x.u + x.height - 1]));
    const occ = used.get(r.id), clash = (a) => occ.some(([lo, hi]) => a <= hi && lo <= a + h - 1);
    for (let k = 0; k < r.units && clash(u); k++) { if (u + h <= r.units) u++; else break; }
    occ.push([u, u + h - 1]);
    stmts.push({ sql: 'INSERT INTO net_rack_items (rack_id, device_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, ?, ?, 1)', args: [r.id, d.id, 'device', d.hostname, u, h] });
  }
  // Cabinets as in the drawing: patch panels + cable managers on top, the switch, the PDU at the bottom.
  for (const r of racks.values()) {
    if (r.kind !== 'cabinet') continue;
    if ((await get('SELECT COUNT(*) AS n FROM net_rack_items WHERE rack_id = ? AND kind <> ?', [r.id, 'device'])).n) continue;
    for (const [kind, label, u] of [['patch', 'Patch panel 24', 12], ['cable', 'Cable manager', 11], ['patch', 'Patch panel 24', 10], ['cable', 'Cable manager', 9], ['pdu', 'PDU', 1]])
      stmts.push({ sql: 'INSERT INTO net_rack_items (rack_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, 1, 1)', args: [r.id, kind, label, u] });
  }
  // MR-01: data patch panels PP01–PP05 above the access switches; MR-02: voice patch panels PP06–PP10.
  const mr1 = racks.get('MR-01'), mr2 = racks.get('MR-02');
  if (mr1 && !(await get("SELECT COUNT(*) AS n FROM net_rack_items WHERE rack_id = ? AND kind = 'patch'", [mr1.id])).n) {
    const sw = (await all("SELECT u FROM net_rack_items WHERE rack_id = ? AND kind = 'device' ORDER BY u DESC", [mr1.id])).map(x => x.u);
    const tops = sw.length ? sw : [38, 32, 26, 20, 14];
    tops.slice(0, 5).forEach((u, i) => { stmts.push({ sql: 'INSERT INTO net_rack_items (rack_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, 2, 1)', args: [mr1.id, 'patch', `MR01/PP0${i + 1} (D)`, u + 1] });
      stmts.push({ sql: 'INSERT INTO net_rack_items (rack_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, 1, 1)', args: [mr1.id, 'cable', 'Cable manager', u - 1] }); });
  }
  if (mr2 && !(await get("SELECT COUNT(*) AS n FROM net_rack_items WHERE rack_id = ?", [mr2.id])).n) {
    [6, 7, 8, 9, 10].forEach((n, i) => stmts.push({ sql: 'INSERT INTO net_rack_items (rack_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, 2, 1)', args: [mr2.id, 'patch', `MR01/PP${String(n).padStart(2, '0')} (T)`, 40 - i * 3] }));
  }
  await batch(stmts);
  return stmts.length;
}
router.post('/rack', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const site = str(req.body.site, 80), name = str(req.body.name, 40); if (!name) return res.status(400).json({ error: 'Name is required' });
  await run('INSERT INTO net_racks (site, name, kind, units, sort, area) VALUES (?, ?, ?, ?, ?, ?)', [site, name, req.body.kind === 'cabinet' ? 'cabinet' : 'rack', Math.min(52, Math.max(4, Number(req.body.units) || 42)), Number(req.body.sort) || 50, str(req.body.area, 60)]);
  res.json(await get('SELECT * FROM net_racks WHERE site = ? AND name = ?', [site, name]));
}));
router.put('/rack/:id', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  await run('UPDATE net_racks SET name = ?, units = ?, area = ?, notes = ? WHERE id = ?', [str(req.body.name, 40), Math.min(52, Math.max(4, Number(req.body.units) || 42)), str(req.body.area, 60), str(req.body.notes, 300), Number(req.params.id)]);
  res.json({ ok: true });
}));
router.delete('/rack/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  await batch([{ sql: 'DELETE FROM net_rack_items WHERE rack_id = ?', args: [Number(req.params.id)] }, { sql: 'DELETE FROM net_racks WHERE id = ?', args: [Number(req.params.id)] }]);
  res.json({ ok: true });
}));
const KINDS = ['device', 'patch', 'cable', 'pdu', 'blank', 'shelf', 'ups', 'other'];
router.post('/rack-item', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const b = req.body;
  await run('INSERT INTO net_rack_items (rack_id, device_id, kind, label, u, height) VALUES (?, ?, ?, ?, ?, ?)',
    [Number(b.rack_id), b.device_id ? Number(b.device_id) : null, KINDS.includes(b.kind) ? b.kind : 'other', str(b.label, 60), Math.max(1, Number(b.u) || 1), Math.min(10, Math.max(1, Number(b.height) || 1))]);
  res.json({ ok: true });
}));
router.put('/rack-item/:id', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const it = await get('SELECT * FROM net_rack_items WHERE id = ?', [Number(req.params.id)]); if (!it) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  await run('UPDATE net_rack_items SET rack_id = ?, u = ?, height = ?, label = ?, kind = ?, auto = 0 WHERE id = ?',
    [Number(b.rack_id || it.rack_id), Math.max(1, Number(b.u || it.u)), Math.min(10, Math.max(1, Number(b.height || it.height))), b.label != null ? str(b.label, 60) : it.label, KINDS.includes(b.kind) ? b.kind : it.kind, it.id]);
  res.json({ ok: true });
}));
router.delete('/rack-item/:id', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  await run('DELETE FROM net_rack_items WHERE id = ?', [Number(req.params.id)]); res.json({ ok: true });
}));

// ── Drawings (pictures of the document: racks, topology, floor plans) ─────────
router.get('/drawings', wrap(async (req, res) => {
  const rows = await all('SELECT id, site, name, category, mime, size, pins, links, uploaded_by, uploaded_at FROM net_drawings WHERE site = ? ORDER BY category, name', [str(req.query.site, 80)]);
  res.json(otView(req) ? rows.filter(otDrawing) : rows);
}));
router.get('/drawing/:id', wrap(async (req, res) => {
  const d = await get('SELECT name, category, mime, data_b64 FROM net_drawings WHERE id = ?', [Number(req.params.id)]);
  if (!d || (isOT(req) && !otDrawing(d))) return res.status(404).end();
  res.setHeader('Content-Type', d.mime || 'image/png'); res.setHeader('Cache-Control', 'private, max-age=600');
  res.send(Buffer.from(d.data_b64 || '', 'base64'));
}));
const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const cleanPins = (l) => JSON.stringify((Array.isArray(l) ? l : []).slice(0, 500).map(p => ({ x: pct(p.x), y: pct(p.y), label: str(p.label, 60), kind: str(p.kind, 20), ref: str(p.ref, 80) })));
// Cables between pins (fibre between cabinets), with the route they follow on the picture.
const cleanLinks = (l) => JSON.stringify((Array.isArray(l) ? l : []).slice(0, 300).map(k => ({ a: str(k.a, 80), b: str(k.b, 80), name: str(k.name, 60), cores: str(k.cores, 30), len: Number(k.len) > 0 ? Math.round(Number(k.len)) : null,
  path: (Array.isArray(k.path) ? k.path : []).slice(0, 400).map(p => [pct(p[0]), pct(p[1])]) })).filter(k => k.a && k.b));
router.post('/drawings', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  const mime = str(req.body.mime, 40);
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(mime)) return res.status(400).json({ error: 'PNG, JPG, SVG or WebP only' });
  const data = String(req.body.data_b64 || ''); if (data.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'Picture too large (max ≈15 MB)' });
  const site = str(req.body.site, 80), name = str(req.body.name, 100) || 'Drawing';
  // A drawing package (from a CAD export) brings its pins and cables along.
  const pins = Array.isArray(req.body.pins) ? cleanPins(req.body.pins) : '', links = Array.isArray(req.body.links) ? cleanLinks(req.body.links) : '';
  // A package with the name of a drawing already there replaces it (same id, so nothing else changes).
  const same = Array.isArray(req.body.pins) ? await get('SELECT id FROM net_drawings WHERE site = ? AND name = ?', [site, name]) : null;
  if (same) await run('UPDATE net_drawings SET category = ?, mime = ?, size = ?, data_b64 = ?, pins = ?, links = ?, uploaded_by = ?, uploaded_at = datetime(\'now\') WHERE id = ?', [str(req.body.category, 40), mime, Math.round(data.length * 0.75), data, pins, links, req.user.username, same.id]);
  else await run('INSERT INTO net_drawings (site, name, category, mime, size, data_b64, pins, links, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [site, name, str(req.body.category, 40), mime, Math.round(data.length * 0.75), data, pins, links, req.user.username]);
  await audit(req.user, 'NETMAP', null, `Network map "${site}": drawing "${name}" ${same ? 'replaced' : 'uploaded'}`);
  res.json({ ok: true, replaced: !!same });
}));
router.put('/drawing/:id', wrap(async (req, res) => {
  if (!canEdit(req)) return res.status(403).json({ error: 'Admins and editors only' });
  const b = req.body;
  if ('pins' in b) await run('UPDATE net_drawings SET pins = ? WHERE id = ?', [cleanPins(b.pins), Number(req.params.id)]);
  if ('links' in b) await run('UPDATE net_drawings SET links = ? WHERE id = ?', [cleanLinks(b.links), Number(req.params.id)]);
  if ('name' in b) await run('UPDATE net_drawings SET name = ?, category = ? WHERE id = ?', [str(b.name, 100), str(b.category, 40), Number(req.params.id)]);
  res.json({ ok: true });
}));
// Correct the camera a camera pin stands for (the CAD name and the camera list are not always updated together).
// PUT { i, old, label, ref } — IT editors and OT editors (camera pins only, on drawings OT sees).
router.put('/drawing/:id/camera-pin', wrap(async (req, res) => {
  if (!canEdit(req) && !otPortEdit(req)) return res.status(403).json({ error: 'Editors only' });
  const d = await get('SELECT id, name, category, pins FROM net_drawings WHERE id = ?', [Number(req.params.id)]);
  if (!d || (isOT(req) && !otDrawing(d))) return res.status(404).json({ error: 'Drawing not found' });
  let pins = []; try { pins = JSON.parse(d.pins || '[]'); } catch { pins = []; }
  const i = Number(req.body.i), p = pins[i];
  if (!p || p.kind !== 'camera') return res.status(400).json({ error: 'Not a camera pin' });
  if (str(req.body.old, 60) !== String(p.ref || p.label)) return res.status(409).json({ error: 'The pin was changed meanwhile — reload the drawing' });
  const label = str(req.body.label, 60).toUpperCase(), ref = str(req.body.ref, 80) || label;
  if (!label) return res.status(400).json({ error: 'Camera name required' });
  const before = p.ref || p.label; pins[i] = { ...p, label, ref };
  await run('UPDATE net_drawings SET pins = ? WHERE id = ?', [cleanPins(pins), d.id]);
  await audit(req.user, 'NETMAP', null, `Drawing "${d.name}": camera pin ${before} → ${ref}`);
  res.json({ ok: true, pin: pins[i] });
}));
router.delete('/drawing/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admins only' });
  await run('DELETE FROM net_drawings WHERE id = ?', [Number(req.params.id)]); res.json({ ok: true });
}));

// ── Server Inventory check against the document ─────────────────────────────────
// Per model family: quantity in the equipment list (section 2), devices in the port tables (network map),
// records in Server Inventory (active / stock). Per record: no serial, serial twice, serial not in the
// document, not linked to the network map. Per document device: serial not found in Server Inventory.
const FAMILIES = [[/CT5520/i, 'Cisco 5520 WLC'], [/AP2802/i, 'Cisco AP 2802E (indoor)'], [/AP1572/i, 'Cisco AP 1572EAC (outdoor)'], [/3548P/i, 'Cisco Nexus N3K-C3548P-XL'],
  [/3524P/i, 'Cisco Nexus N3K-C3524P-XL'], [/C9200L-48P/i, 'Cisco C9200L-48P-4X-E'], [/3560CX-12PD/i, 'Cisco WS-C3560CX-12PD-S'], [/ISR\s*4331/i, 'Cisco ISR 4331'],
  [/R740/i, 'Dell PowerEdge R740 / R740xd'], [/DD-?6300|DATA DOMAIN/i, 'Dell Data Domain DD6300'], [/E560|VXRAIL|hội tụ/i, 'Dell VxRail E560'], [/XG\s*-?\s*210|SOPHOS/i, 'Sophos XG 210'], [/PA[- ]?440/i, 'Palo Alto PA-440'],
  [/VNPT|VIETTEL|LEASE/i, 'ISP lease-line router']];
const familyOf = (t) => (FAMILIES.find(([re]) => re.test(String(t || ''))) || [, ''])[1];
router.get('/inventory-check', wrap(async (req, res) => res.json(await inventoryCheck(str(req.query.site, 80)))));
async function inventoryCheck(site) {
  const equip = await all('SELECT part, description, qty FROM net_equipment WHERE site = ?', [site]);
  const devs = await all('SELECT id, hostname, model, serial, service_tag, server_id, role FROM net_devices WHERE site = ?', [site]);
  const servers = await all("SELECT id, hostname, brand_model, category, serial_no, status, location, ip_address FROM servers WHERE deleted_at IS NULL");
  const fam = new Map();
  const F = (name) => { if (!fam.has(name)) fam.set(name, { family: name, doc_qty: null, map: 0, inv: 0, active: 0, stock: 0, other: 0 }); return fam.get(name); };
  for (const e of equip) { const f = familyOf(`${e.part} ${e.description}`); if (f) { const x = F(f); x.doc_qty = (x.doc_qty || 0) + e.qty; } }
  for (const d of devs) { const f = familyOf(d.model + ' ' + d.hostname); if (f) F(f).map++; }
  for (const s of servers) { const f = familyOf(s.brand_model); if (!f) continue; const x = F(f); x.inv++; if (s.status === 'Active') x.active++; else if (s.status === 'Stock') x.stock++; else x.other++; }
  const models = [...fam.values()].map(x => {
    const want = x.doc_qty != null ? x.doc_qty : x.map;
    return { ...x, expected: want, diff: x.inv - want, status: x.doc_qty == null && !x.map ? (x.inv ? 'added' : '') : x.inv === want ? 'ok' : x.inv < want ? 'missing' : 'extra' };
  }).sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || a.family.localeCompare(b.family));
  // Per record
  const docSerials = new Map(); for (const d of devs) for (const sn of [d.serial, d.service_tag]) if (normSn(sn)) docSerials.set(normSn(sn), d);
  const findDoc = (sn) => { const n = normSn(sn); if (!n) return null; return docSerials.get(n) || docSerials.get(n.replace(/^S/, '')) || docSerials.get('S' + n) || null; };
  const cnt = new Map(); for (const s of servers) { const n = normSn(s.serial_no); if (n) cnt.set(n, (cnt.get(n) || 0) + 1); }
  const famWithMap = new Set(devs.map(d => familyOf(d.model + ' ' + d.hostname)).filter(Boolean));
  const issues = [];
  for (const s of servers) {
    const f = familyOf(s.brand_model); if (!f) continue;
    const p = [];
    if (!normSn(s.serial_no)) p.push('No serial number');
    else if (cnt.get(normSn(s.serial_no)) > 1) p.push('Serial used on another record too');
    const linked = devs.find(d => d.server_id === s.id) || devs.find(d => s.hostname && d.hostname.toUpperCase() === String(s.hostname).toUpperCase());
    if (famWithMap.has(f)) {
      if (linked) { if (normSn(s.serial_no) && !findDoc(s.serial_no)) p.push(linked.serial || linked.service_tag ? `Is ${linked.hostname} in the document, but the document's serial there is ${linked.serial || linked.service_tag} — check the label on the device`
        : `Is ${linked.hostname} in the document, which has no serial for it — confirm with the label on the device`); }
      else if (findDoc(s.serial_no)) p.push(`Serial is ${findDoc(s.serial_no).hostname} in the document, but the record is not linked — run 🔄 Update from network map`);
      else p.push('Not in the document\'s port tables — a spare, installed somewhere else, or its serial needs checking');
    }
    if (p.length) issues.push({ id: s.id, family: f, brand_model: s.brand_model, serial_no: s.serial_no, hostname: s.hostname, status: s.status, location: s.location, problems: p });
  }
  const invSerials = new Set(servers.map(s => normSn(s.serial_no)).filter(Boolean));
  const docOnly = devs.filter(d => familyOf(d.model + ' ' + d.hostname) && (d.serial || d.service_tag) && ![d.serial, d.service_tag].some(sn => { const n = normSn(sn); return n && (invSerials.has(n) || invSerials.has('S' + n)); }))
    .map(d => ({ hostname: d.hostname, model: d.model, serial: d.serial || d.service_tag, linked: d.server_id || null }));
  return { site, has_equipment: equip.length > 0, models, issues, doc_only: docOnly };
}
router.inventoryCheck = inventoryCheck;
router.otOn = otOn;   // which switches the OT team sees (Server Inventory → 🔌 Switch ports for OT editors)
router.util = { familyOf, macNorm, str, portSort, desc, FIELDS, normSn, snEq, parseLoc, placeDevices, modelCode, sameModel, CAT, isAdmin, canEdit };

router.withOwners = withOwners;
router.restorePort = restorePort;   // OT activity → restore   // switch port owner OT / IT (OT reports)
module.exports = router;
