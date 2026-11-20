/* Server Inventory ↔ access-switch ports (Server Inventory → 🔌 Switch ports).

   For every Server Inventory record (IT and OT) find the access-switch port it is cabled to, from the network map:
     1. the record is a device of the map (net_devices.server_id) and an access-switch port points at that device (APs …);
     2. its MAC is written on the port (peer / note, any spelling);
     3. its IP is written on the port;
     4. its hostname is the name on the port.
   And list what is cabled to an access switch but has no Server Inventory record yet (printers, kiosks, TVs, Matrix
   readers …), with a guess IT / OT — IP phones, PXE / spare ports and people's desk points are left out. Pure functions. */

const hex = (s) => String(s == null ? '' : s).replace(/[^0-9a-f]/gi, '').toUpperCase();
const key = (s) => String(s || '').toUpperCase().replace(/^VN_/, '').replace(/[^A-Z0-9]/g, '');
const uplink = (p) => /^(T|TE|XE|TWE)\b/i.test(String(p).trim());
const MAC_RE = /([0-9a-f]{2}[:\-.]?){5}[0-9a-f]{2}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/gi;
const MAC_ONE = new RegExp('^(?:' + MAC_RE.source + ')$', 'i');
const IP_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
const OT_VLANS = new Set(['124', '125', '131', '133']);
// Infrastructure records (they ARE the network, not plugged into an access port).
const INFRA = /switch|firewall|router|gateway$|controller|vx-?rail|data domain|poweredge|isp|server|storage/i;
// Not devices to add: phones (people's desk points), PXE / spare / test ports, mesh lists.
const SKIP = /phone|\b78[0-9]{2}\b|\bSEP[0-9A-F]{6,}|pxe|gpupdate|spare|test|^\s*$/i;

function portSort(p) { const m = String(p).match(/(\d+)\s*$/); return m ? Number(m[1]) : 0; }
const label = (d, p) => `${d.hostname} ${p.port}`;

function plan(ctx) {
  const byId = new Map(ctx.devices.map(d => [d.id, d])), byHost = new Map(ctx.devices.map(d => [d.hostname, d]));
  const access = new Set(ctx.devices.filter(d => /access switch/i.test(d.role || '') && d.state !== 'retired').map(d => d.id));
  const ports = ctx.ports.filter(p => access.has(p.device_id) && !uplink(p.port) && (p.peer_host || p.note || p.peer_port));
  const info = ports.map(p => {
    const text = `${p.peer_host || ''} ${p.peer_port || ''} ${p.note || ''}`;
    return { p, d: byId.get(p.device_id), text, hexText: hex(text), macs: (text.match(MAC_RE) || []).map(hex).filter(m => m.length === 12),
      ips: [...text.matchAll(IP_RE)].map(m => m[1]), peerDev: p.peer_host ? byHost.get(p.peer_host) : null };
  });
  const devByServer = new Map(ctx.devices.filter(d => d.server_id).map(d => [d.server_id, d]));
  const devBySerial = new Map(ctx.devices.filter(d => hex(d.serial).length >= 6).map(d => [hex(d.serial), d]));
  const NET_ROLE = /switch|firewall|router|controller|server|storage|isp|external/i;
  const used = new Set();
  const links = [], unmatched = [];
  for (const s of ctx.servers) {
    let hit = null, how = '';
    // Several ports can carry the same name (two "MAIN OFFICE -D1-VEGA"): keep the port the record already has, else a free one.
    const cur0 = String(s.switch_port || '').trim();
    const pick = (list) => list.find(i => cur0.startsWith(label(i.d, i.p))) || list.find(i => !used.has(i.p.id)) || list[0] || null;
    const nd = devByServer.get(s.id) || (s.hostname && byHost.get(s.hostname)) || (hex(s.serial_no).length >= 6 && devBySerial.get(hex(s.serial_no))) || null;
    // Switches, routers, servers … are the network itself (their cables are uplinks), not devices on an access port.
    if ((nd && NET_ROLE.test(nd.role || '')) || (!nd && INFRA.test(s.category || '') && !/access point/i.test(s.category || ''))) continue;
    if (nd) { hit = info.find(i => i.peerDev && i.peerDev.id === nd.id); if (hit) how = `${nd.hostname} on the map is cabled to this port`; }
    const mac = hex(s.mac);
    if (!hit && mac.length === 12) { hit = info.find(i => i.macs.includes(mac) || i.hexText.includes(mac)); if (hit) how = 'its MAC is on the port'; }
    const ip = String(s.ip_address || '').split('/')[0].trim();
    if (!hit && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) { hit = info.find(i => i.ips.includes(ip)); if (hit) how = 'its IP is on the port'; }
    const k = key(s.hostname);
    if (!hit && k.length >= 4) { hit = pick(info.filter(i => i.p.peer_host && !i.peerDev && key(i.p.peer_host) === k)); if (hit) how = 'same name on the port'; }
    // "K10-AP4" on the port, "K10-AP4-OUTDOOR" in the inventory.
    if (!hit && k.length >= 5) { hit = info.find(i => { const pk = key(i.p.peer_host); return i.p.peer_host && !i.peerDev && pk.length >= 5 && /AP\d/.test(pk) && (k.startsWith(pk) || pk.startsWith(k)); }); if (hit) how = 'same AP name on the port'; }
    // Set before (e.g. by the OT device list: the devices behind a hub / Moxa on that port) and the port exists → keep it.
    if (!hit && cur0) { hit = info.find(i => cur0 === label(i.d, i.p) || cur0.startsWith(label(i.d, i.p) + ' ')); if (hit) how = 'set before (behind the device on this port)'; }
    if (hit) {
      used.add(hit.p.id);
      const to = label(hit.d, hit.p);
      const cur = String(s.switch_port || '').trim();
      links.push({ server_id: s.id, hostname: s.hostname || s.brand_model || '#' + s.id, category: s.category, it_ot: s.it_ot || '', from: cur, to, how,
        location: hit.d.location || '', change: !(cur === to || cur.startsWith(to + ' ')) });
    } else {
      unmatched.push({ server_id: s.id, hostname: s.hostname || s.brand_model || '#' + s.id, category: s.category, it_ot: s.it_ot || '', ip: s.ip_address || '', mac: s.mac || '', switch_port: s.switch_port || '' });
    }
  }
  // Ports with an end device that no record matched → candidates to add.
  const recMacs = new Set(ctx.servers.map(s => hex(s.mac)).filter(m => m.length === 12));
  const missing = [];
  for (const i of info) {
    if (used.has(i.p.id) || i.peerDev) continue;
    if (i.macs.some(m => recMacs.has(m))) continue;
    const noteBits = String(i.p.note || '').split(/\s*·\s*/).map(x => x.trim()).filter(x => x && !MAC_ONE.test(x) && !/^\d+\.\d+\.\d+\.\d+$/.test(x) && !/^(OT System|OT device list|Matrix Devices?)$/i.test(x));
    const name = (i.p.peer_host || noteBits[0] || '').replace(MAC_RE, '').replace(/:\s*(?=\s|$)/g, ' ').replace(/\s+/g, ' ').slice(0, 80).trim();
    if (!name || SKIP.test(`${name} ${i.p.note}`) || /^[A-ZÀ-Ỹ][\wÀ-ỹ.]+(\s[A-ZÀ-Ỹ][\wÀ-ỹ.]+)*[_\-\s]\d{4}$/i.test(name) || /^[\wÀ-ỹ]+-(HR|HSE|Purchase|IT|FIN|Sale|Sales)$/i.test(name)) continue;
    if (/\bK?\d*-?AP\d+/i.test(name)) continue;   // an access point: it belongs on the map as a device, not here
    const t = `${name} ${i.p.note} ${/CARD.?READER/i.test(i.d.hostname) ? 'MATRIX' : ''}`.toUpperCase();
    const ot = OT_VLANS.has(String(i.p.vlan || '').trim()) || /MATRIX|MAXTRIX|VEGA|DCCE|MOXA|KIOS|RETMES|PLC|PMS|MES\b|ECU|EMG|GATEWAY|AMS01|MGATE|EGX|HD67044/.test(t);
    const cat = /PRINT|ZT4|RICOH|HP4|HP\s?PRINTER|LASERJET/.test(t) ? 'Printer' : /VEGA|DCCE|MATRIX|MAXTRIX|COSEC/.test(t) ? 'Access control' : /KIOS|RETMES/.test(t) ? 'Kiosk / panel PC'
      : /\bTV\b|TELEVISION/.test(t) ? 'Display (mini PC)' : /MOXA|EDR-|EDS-/.test(t) ? 'Industrial switch / router' : /GATEWAY|EMG|MGATE|EGX|HD67044/.test(t) ? 'OT gateway'
      : /ECU/.test(t) ? 'Controller' : ot ? 'OT device' : 'Endpoint';
    missing.push({ port_id: i.p.id, switch: i.d.hostname, port: i.p.port, location: i.d.location || '', name, vlan: i.p.vlan || '', mac: i.macs[0] ? i.macs[0].match(/../g).join(':') : '',
      ip: i.ips[0] || '', note: i.p.note || '', it_ot: ot ? 'OT' : 'IT', category: cat });
  }
  const sortBy = (a, b) => a.switch.localeCompare(b.switch) || portSort(a.port) - portSort(b.port);
  return { links: links.sort((a, b) => a.to.localeCompare(b.to, undefined, { numeric: true })), unmatched, missing: missing.sort(sortBy),
    counts: { links: links.length, change: links.filter(l => l.change).length, unmatched: unmatched.length, missing: missing.length, ports: ports.length } };
}

module.exports = { plan };
