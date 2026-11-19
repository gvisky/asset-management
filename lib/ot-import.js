/* OT device list (CMDB, e.g. CMDB_OEE.xlsx) → Server Inventory (IT/OT = OT) and the Network map ports.

   The file says for each device the switch it hangs off ("ConnectedDevice") and the port ("PortCount"), but its switch names
   are loose ("ASW-11" is the IT-KABIN11 switch SR-19/DATA-ASW-17, "SR03/data.ASW-08" is SR-01/DATA-ASW-08 …). So:
     1. a device whose MAC is already written on a port of the map is THERE (verified);
     2. each switch name of the file gets a proposal: ≥ 3 of its devices verified on one switch with the same port number,
        else a "Kn-IT rack" note → IT-KABINn, else "HK12" → HARICI KABIN12, else the access switch "…ASW-NN"; IT can change it;
     3. the other devices go to that switch + port: an empty port is filled, a port to a network device means "behind it",
        a port that already holds something else is listed as a difference (never overwritten).
   Pure functions: the route gives the rows of the file and the site's devices / ports / servers. */

const hex = (s) => String(s == null ? '' : s).replace(/[^0-9a-f]/gi, '').toUpperCase();
const macOf = (s) => { const h = hex(s); return h.length === 12 ? h.match(/../g).join(':') : ''; };
const t = (v, n = 120) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const key = (s) => String(s || '').toUpperCase().replace(/^VN_/, '').replace(/[^A-Z0-9]/g, '');
const portNo = (p) => { const m = String(p).match(/(\d+)\s*$/); return m ? Number(m[1]) : null; };
const uplink = (p) => /^(T|TE|XE|TWE)\b/i.test(String(p).trim());
const OT_SYSTEMS = /^(ACS|PMS|OEE|MMS|MES|PME|SCADA|BMS|CCTV)$/i;
const BAD_SERIAL = /^(n\/?a|x+|-|0|none|null)$/i;

// Column of the file by its header (any order, any case).
const HEAD = {
  country: /^country$/i, building: /^building$/i, cabinet: /^cabinet$/i, manufacturer: /^manufacturer$/i, device: /^device$/i, model: /^model$/i,
  serial: /^serial\s*number$|^serial$/i, itot: /^it\s*\/?\s*ot$/i, name: /^name$|^hostname$/i, ip: /^ip\s*address$|^ip$/i, mac: /^mac/i,
  vlan: /^vlan$/i, sw: /^connected\s*device$|^switch$/i, port: /^port\s*count$|^port$/i, otsys: /^ot\s*system$/i,
};
/** rows of the sheet (array of arrays, header first) → device rows. */
function readRows(aoa) {
  const hi = aoa.findIndex(r => r.some(c => HEAD.name.test(String(c).trim())) && r.some(c => HEAD.mac.test(String(c).trim())));
  if (hi < 0) return { rows: [], error: 'No header with Name and Mac found' };
  const head = aoa[hi].map(c => String(c).trim());
  const col = {}; for (const [k, re] of Object.entries(HEAD)) col[k] = head.findIndex(h => re.test(h));
  const otCol = col.otsys;
  const rows = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    const g = (k) => (col[k] >= 0 ? t(r[col[k]]) : '');
    const name = g('name');
    if (!name) return;
    if (/x\.x\.x\.x/i.test(g('ip')) || /rezervation|reservation/i.test(name)) return;   // the template's example line
    // After the "OT system" column some lines carry "K9-IT rack": that is where the switch is.
    const extra = otCol >= 0 ? r.slice(otCol).map(x => t(x)).filter(Boolean) : [];
    rows.push({
      line: hi + i + 2, name, ip: /^\d+\.\d+\.\d+\.\d+$/.test(g('ip')) ? g('ip') : '', mac: macOf(g('mac')), macRaw: g('mac'),
      manufacturer: g('manufacturer'), device: g('device'), model: g('model'), serial: BAD_SERIAL.test(g('serial')) ? '' : g('serial'),
      vlan: g('vlan').replace(/\.0$/, ''), sw: g('sw'), port: /^\d+$/.test(g('port')) ? Number(g('port')) : null, country: g('country'),
      building: g('building'), cabinet: g('cabinet'), itot: g('itot'),
      otSystem: extra.find(x => OT_SYSTEMS.test(x)) || '', rackNote: extra.find(x => /\bK\d+\b.*rack|rack.*\bK\d+\b/i.test(x)) || '',
    });
  });
  return { rows };
}

function category(r) {
  const s = `${r.manufacturer} ${r.device} ${r.model} ${r.name}`.toUpperCase();
  if (/FACE ?ID|CAMERA/.test(s) && /MATRIX/.test(s)) return 'Access control camera';
  if (/MATRIX|COSEC|COGNIFACE/.test(s)) return 'Access control';
  if (/MGATE|GATEWAY|EGX|EMG-|HD67044|ADF/.test(s)) return 'OT gateway';
  if (/EDR-|EDS-|MOXA.*(SW|SWITCH|HUB)|MOXA_/.test(s)) return 'Industrial switch / router';
  if (/LOGIX|SIMATIC|S7-|1756|1769|PLC/.test(s)) return 'PLC';
  if (/KIOSK|RETMES|KONZEK|PANEL PC/.test(s)) return 'Kiosk / panel PC';
  if (/RASPBERRY|TELEVISION|MINI PC/.test(s)) return 'Display (mini PC)';
  if (/SENSEOR|AMS01|MEASUREMENT|SENSOR/.test(s)) return 'Sensor';
  if (/ECU/.test(s)) return 'Controller';
  return 'OT device';
}

/**
 * plan(rows, ctx, overrides)
 *   ctx = { devices: net_devices of the site, ports: net_ports of the site (with hostname), servers: Server Inventory rows }
 *   overrides = { [file switch name]: device id | 0 (none) }
 */
function plan(rows, ctx, overrides = {}) {
  const devById = new Map(ctx.devices.map(d => [d.id, d]));
  const devByHost = new Map(ctx.devices.map(d => [d.hostname, d]));
  const live = ctx.devices.filter(d => d.state !== 'retired');
  const switches = live.filter(d => /switch/i.test(d.role || ''));
  const portText = new Map(ctx.ports.map(p => [p.id, hex(`${p.peer_host} ${p.peer_port} ${p.note}`)]));
  const portOf = (devId, n) => ctx.ports.find(p => p.device_id === devId && !uplink(p.port) && portNo(p.port) === n);
  const issues = [];

  // 1. Verified on the map by MAC.
  for (const r of rows) {
    r.cat = category(r);
    if (!r.mac) continue;
    const hits = ctx.ports.filter(p => portText.get(p.id).includes(hex(r.mac)));
    if (!hits.length) continue;
    const same = hits.find(p => portNo(p.port) === r.port) || hits[0];
    const d = devById.get(same.device_id);
    r.found = { device_id: d.id, hostname: d.hostname, port: same.port, location: d.location };
  }

  // 2. One switch per file switch name.
  const labels = new Map();
  for (const r of rows) { const k = r.sw.toUpperCase().replace(/\s+/g, ''); if (!labels.has(k)) labels.set(k, { label: r.sw, rows: [] }); labels.get(k).rows.push(r); }
  const labelOut = [];
  for (const [k, L] of labels) {
    let pick = null, how = '';
    const votes = new Map();
    for (const r of L.rows) if (r.found && portNo(r.found.port) === r.port) votes.set(r.found.device_id, (votes.get(r.found.device_id) || 0) + 1);
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    const rack = L.rows.map(r => (r.rackNote.match(/\bK\s*0*(\d+)\b/i) || [])[1]).find(Boolean);
    const hk = (L.label.match(/HK\s*0*(\d+)/i) || [])[1];
    const num = (L.label.match(/ASW-?\s*0*(\d+)\s*$/i) || [])[1];
    if (best && best[1] >= 3) { pick = devById.get(best[0]); how = `${best[1]} of its devices are already on this switch, same port numbers`; }
    else if (rack) { pick = switches.find(d => new RegExp(`IT-?KABIN\\s*0*${rack}\\b`, 'i').test(d.location || '')); how = `the file says K${rack}-IT rack`; }
    else if (hk) { pick = switches.find(d => new RegExp(`HARICI\\s*-?KABIN\\s*0*${hk}\\b`, 'i').test(d.location || '')); how = `HK${hk} = HARICI KABIN${hk}`; }
    if (!pick && num) { pick = switches.find(d => /access switch/i.test(d.role || '') && new RegExp(`ASW-0*${num}$`, 'i').test(d.hostname)); if (pick) how = `switch name ends ASW-${num.padStart(2, '0')}`; }
    if (!pick && best) { pick = devById.get(best[0]); how = `${best[1]} of its devices are already on this switch`; }
    if (Object.prototype.hasOwnProperty.call(overrides, L.label)) { const o = Number(overrides[L.label]); pick = o ? devById.get(o) || null : null; how = 'chosen by you'; }
    L.dev = pick || null;
    labelOut.push({ label: L.label, rows: L.rows.length, device_id: pick ? pick.id : 0, hostname: pick ? pick.hostname : '', location: pick ? pick.location : '', how: pick ? how : (L.label ? 'not recognised' : 'no switch in the file') });
  }

  // 3. Ports: rows not yet on the map, grouped per switch port.
  const groups = new Map();
  for (const r of rows) {
    const L = labels.get(r.sw.toUpperCase().replace(/\s+/g, ''));
    if (r.found) { r.where = r.found; r.map = 'on the map';
      // The file often names the upstream switch port (ASW-01 port 1 → the card-reader switch behind it): that is consistent.
      const up = r.port != null && L.dev && portOf(L.dev.id, r.port);
      const behindOk = up && up.peer_host === r.found.hostname;
      if (r.port != null && L.dev && !behindOk && (L.dev.id !== r.found.device_id || portNo(r.found.port) !== r.port))
        issues.push({ kind: 'port', name: r.name, text: `File: ${r.sw} port ${r.port} — the map has its MAC on ${r.found.hostname} ${r.found.port}` });
      continue; }
    if (!L.dev || r.port == null) { r.map = L.dev ? 'no port in the file' : 'switch unknown'; r.where = L.dev ? { device_id: L.dev.id, hostname: L.dev.hostname, port: '', location: L.dev.location } : null; continue; }
    const p = portOf(L.dev.id, r.port);
    if (!p) { r.map = `no port ${r.port} on ${L.dev.hostname}`; r.where = { device_id: L.dev.id, hostname: L.dev.hostname, port: '', location: L.dev.location }; continue; }
    const gk = p.id; if (!groups.has(gk)) groups.set(gk, { port: p, dev: L.dev, rows: [] }); groups.get(gk).rows.push(r);
  }
  const fileMacs = new Set(rows.map(r => hex(r.mac)).filter(Boolean));
  const fills = [], differs = [];
  for (const g of groups.values()) {
    const p = g.port, peer = String(p.peer_host || '').trim(), rs = g.rows;
    const here = rows.filter(r => r.found && ctx.ports.find(x => x.device_id === r.found.device_id && x.port === r.found.port) === p);   // already on this port (by MAC)
    const at = { device_id: g.dev.id, hostname: g.dev.hostname, port: p.port, location: g.dev.location };
    rs.forEach(r => { r.where = at; });
    const peerDev = peer && devByHost.get(peer);
    if (peerDev) { rs.forEach(r => { r.map = `behind ${peer}`; r.where = { ...at, via: peer, location: peerDev.location || at.location }; }); continue; }
    const otherMacs = (`${p.peer_port} ${p.note}`.match(/([0-9a-f]{2}[:\-.]?){5}[0-9a-f]{2}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/gi) || []).map(hex).filter(m => m.length === 12 && !fileMacs.has(m));
    // Same device by name — or a port this import filled before (a hub port names its devices in the note).
    const noteKey = key(`${peer} ${p.note}`);
    const peerMatch = (peer && rs.some(r => { const a = key(r.name), b = key(peer); return a && b && (a.includes(b) || b.includes(a)); }))
      || (/OT device list/i.test(p.note || '') && rs.every(r => noteKey.includes(key(r.name))));
    if (peerMatch) { rs.forEach(r => { r.map = 'on the map (same name)'; }); continue; }
    if (peer || otherMacs.length) {
      rs.forEach(r => { r.map = 'port holds something else'; });
      differs.push({ port_id: p.id, hostname: g.dev.hostname, port: p.port, now: [peer, p.peer_port, p.note].filter(Boolean).join(' · '), file: rs.map(r => `${r.name}${r.mac ? ' (' + r.mac + ')' : ''}`).join(', ') });
      continue;
    }
    // Empty port: one device → its name; several → the switch / hub among them, or "<maker> HUB (n)".
    const all = [...here, ...rs];
    const main = all.length > 1 ? all.find(r => /MOXA|HUB|_SW\b|SWITCH/i.test(r.name) || /EDR-|EDS-/i.test(r.model)) : all[0];
    const makers = [...new Set(rs.map(r => r.manufacturer).filter(Boolean))];
    const peerHost = main ? main.name : `${makers.length === 1 ? makers[0] + ' ' : ''}HUB (${all.length} devices)`.slice(0, 80);
    const behind = all.filter(r => r !== main).map(r => r.name);
    const vlans = [...new Set(rs.map(r => r.vlan).filter(Boolean))];
    const bits = [main && main.mac && !hex(p.note).includes(hex(main.mac)) && `MAC ${main.mac}`, main && main.ip && `IP ${main.ip}`, main && [main.manufacturer, main.model].filter(Boolean).join(' '),
      behind.length && `behind it: ${behind.join(', ')}`, [...new Set(rs.map(r => r.otSystem).filter(Boolean))].join('/'), 'OT device list'].filter(Boolean);
    const note = [p.note, bits.join(' · ')].filter(Boolean).join(' · ').slice(0, 300);
    rs.forEach(r => { r.map = rs.length > 1 && r !== main ? `added behind ${peerHost}` : 'added to the port'; });
    fills.push({ port_id: p.id, device_id: g.dev.id, hostname: g.dev.hostname, port: p.port, peer_host: peerHost, vlan: p.vlan || (vlans.length === 1 ? vlans[0] : ''),
      mode: p.mode || 'ACCESS', note, devices: rs.length });
  }

  // 4. Server Inventory: match by MAC, serial, then name; new devices are added.
  const sMac = new Map(), sSn = new Map(), sName = new Map();
  for (const s of ctx.servers) {
    if (s.mac) sMac.set(hex(s.mac), s);
    if (s.serial_no && !BAD_SERIAL.test(s.serial_no)) sSn.set(hex(s.serial_no), s);
    if (s.hostname) sName.set(key(s.hostname), s);
  }
  const snCount = new Map(); rows.forEach(r => { if (r.serial) snCount.set(hex(r.serial), (snCount.get(hex(r.serial)) || 0) + 1); });
  for (const [sn, n] of snCount) if (n > 1) issues.push({ kind: 'serial', name: rows.filter(r => hex(r.serial) === sn).map(r => r.name).join(', '), text: `Serial ${rows.find(r => hex(r.serial) === sn).serial} is on ${n} devices in the file — only the first keeps it` });
  const macCount = new Map(); rows.forEach(r => { if (r.mac) macCount.set(r.mac, (macCount.get(r.mac) || 0) + 1); });
  for (const [m, n] of macCount) if (n > 1) issues.push({ kind: 'mac', name: rows.filter(r => r.mac === m).map(r => r.name).join(', '), text: `MAC ${m} is on ${n} devices in the file` });
  rows.filter(r => r.macRaw && !r.mac && !/^n\/?a$/i.test(r.macRaw)).forEach(r => issues.push({ kind: 'mac', name: r.name, text: `MAC "${r.macRaw}" is not a valid MAC` }));
  const seenSn = new Set();
  const server = rows.map(r => {
    const sn = r.serial && hex(r.serial);
    const dupSn = sn && seenSn.has(sn); if (sn) seenSn.add(sn);
    const ex = (r.mac && sMac.get(hex(r.mac))) || (sn && !dupSn && sSn.get(sn)) || sName.get(key(r.name)) || null;
    const where = r.where || null;
    const fields = {
      hostname: r.name, producer: r.manufacturer, brand_model: [r.manufacturer, r.model || r.device].filter(Boolean).join(' ').slice(0, 120), category: r.cat,
      serial_no: dupSn ? '' : r.serial, ip_address: r.ip, mac: r.mac || '', vlan: r.vlan, ot_system: r.otSystem, country: r.country || 'Vietnam',
      location: (where && where.location) || [r.building, r.cabinet].filter(Boolean).join(' · '),
      switch_port: where ? `${where.hostname}${where.port ? ' ' + where.port : r.port != null ? ' port ' + r.port : ''}${where.via ? ' → via ' + where.via : ''}` : [r.sw, r.port != null ? 'port ' + r.port : ''].filter(Boolean).join(' '),
    };
    let fill = null;
    if (ex) { fill = {}; for (const [k, v] of Object.entries(fields)) if (v && !String(ex[k] || '').trim() && k !== 'country') fill[k] = v; if (ex.it_ot !== 'OT') fill.it_ot = 'OT'; }
    return { line: r.line, name: r.name, cat: r.cat, ip: r.ip, mac: r.mac, map: r.map || '', where: fields.switch_port, server_id: ex ? ex.id : 0, action: ex ? (Object.keys(fill).length ? 'update' : 'same') : 'add', fields, fill };
  });
  return { labels: labelOut, rows: server, fills, differs, issues,
    counts: { rows: rows.length, add: server.filter(s => s.action === 'add').length, update: server.filter(s => s.action === 'update').length, same: server.filter(s => s.action === 'same').length,
      onMap: rows.filter(r => r.found || /same name/.test(r.map || '')).length, fillPorts: fills.length, differ: differs.length, behind: rows.filter(r => /^behind/.test(r.map || '')).length } };
}

module.exports = { readRows, plan, category, macOf };
