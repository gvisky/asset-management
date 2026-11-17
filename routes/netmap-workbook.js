/* Network map ← "Factory Info" workbook (.xlsx, read in the browser by public/js/netmap-xlsx.js).
   Compares what the workbook says with the network map, Server Inventory and the virtual-server list, and lists
   every change for the admin to tick; only the ticked ones are applied.
     POST /api/netmap/workbook/plan   { site, wb }        → { groups: [{ key, title, changes: [{ id, title, from, to, warn, on }] }] }
     POST /api/netmap/workbook/apply  { site, wb, ids[] } → { ok, counts }
   Rules
   · A blank cell never clears what the map already has (the workbook leaves many patch-port numbers empty).
   · The NW EQUIPMENT LIST location wins over the port sheet when they name different racks (PA-440: K11-MR4 → MR-04).
   · New WAN firewalls (equipment list remark "… WAN Firewall …") retire the old ones (alias "WAN FIREWALL NODE …").
   · Server Inventory: empty fields are filled (ticked); a different value is shown as a conflict (not ticked).
   · Port links are written on both ends (the far device's port points back), like a change made by hand. */

const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { str, portSort, desc, FIELDS, normSn, parseLoc, placeDevices, modelCode, CAT } = require('./netmap').util;

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access !== 0 && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })));

// ── Names ────────────────────────────────────────────────────────────────────
const U = (s) => String(s == null ? '' : s).trim().toUpperCase();
const K = (s) => U(s).replace(/\bDATA-/g, '').replace(/[^A-Z0-9]/g, '');            // "MR-01/DATA-ASW-01" → MR01ASW01
const tail = (s) => String(s || '').split('/').pop();
const same = (a, b) => U(a).replace(/\s+/g, '') === U(b).replace(/\s+/g, '');
const ipOnly = (s) => String(s || '').split('/')[0].trim();
const snKey = (s) => normSn(s).replace(/^0+/, '');
const snSame = (a, b) => { a = snKey(a); b = snKey(b); return !!a && !!b && (a === b || (a.length > 6 && b.length > 6 && ('S' + a === b || a === 'S' + b))); };
const isMac = (s) => /^([0-9A-F]{2}[:.-]){5}[0-9A-F]{2}$|^[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}$/i.test(String(s || '').trim());
const isOutlet = (s) => /^[DT]\d{1,3}$/i.test(String(s || '').trim());
const isPanel = (s) => /(^|\/)(DATA-|CCTV-)?PP-?\d+\b/i.test(String(s || '')) || /PATCH ?PANEL/i.test(String(s || ''));
const AP_LABEL = /^[A-Z]{1,3}\d{0,2}-AP\d+/i;
// Port names: "GE 1/0/1", "GigabitEthernet1/0/1", "G 1/0/1" and "Gi1/0/1" are the same port; so are "PORT 1" and "P1".
const pk = (p) => U(p).replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/\d+/g, (n) => String(Number(n)));
const digits = (p) => (U(p).replace(/\(.*?\)/g, '').match(/\d+(?:\/\d+)*$/) || [''])[0].replace(/\d+/g, (n) => String(Number(n)));
// Same port = same kind (GE / T / E / P …, long and short names alike) and the same numbers.
const kind = (p) => { const l = (U(p).replace(/\(.*?\)/g, '').match(/^[A-Z]*/) || [''])[0];
  return /^(GIGABITETHERNET|GI|G|GE)$/.test(l) ? 'GE' : /^(TENGIGABITETHERNET|TE|T|XE)$/.test(l) ? 'T' : /^(ETHERNET|ETH|E)$/.test(l) ? 'E' : /^(PORT|P)$/.test(l) ? 'P' : l; };
function portMatch(names, want) {
  if (!want) return '';
  const k = pk(want); let hit = names.find(n => pk(n) === k); if (hit) return hit;
  const d = digits(want), kd = kind(want);
  if (d) { const l = names.filter(n => digits(n) === d && kind(n) === kd); if (l.length === 1) return l[0]; }
  const word = U(want).replace(/^PORT\s*/, '').replace(/\s+/g, ''); hit = names.find(n => U(n).replace(/^PORT\s*/, '').replace(/\s+/g, '') === word);
  return hit || '';
}
const cleanPort = (p) => String(p || '').trim().replace(/^GigabitEthernet\s*/i, 'GE ').replace(/^TenGigabitEthernet\s*/i, 'TE ').replace(/^(GE|TE|T|E)\s*(\d)/i, (m, a, b) => `${a.toUpperCase()} ${b}`);
const roleGuess = (host, model, extra = '') => {
  const t = `${host} ${model} ${extra}`;
  return /PA[- ]?440|FIREWALL|SOPHOS|XG ?210|-FW/i.test(t) ? 'Firewall' : /VIETTEL|VNPT|FPT|-LL-|LEASE|ISP/i.test(t) ? 'ISP / external' : /AIR-AP|-AP\d/i.test(t) ? 'Access point'
    : /VOICE|ISR|-RT-/i.test(t) ? 'Router' : /WLC|CT55/i.test(t) ? 'Wireless controller' : /CSW|CORE/i.test(t) ? 'Core switch' : /DSW|DIST/i.test(t) ? 'Distribution switch'
    : /VXRAIL|E560/i.test(t) ? 'HCI server' : /DD-?6300|DATA ?DOMAIN/i.test(t) ? 'Backup storage' : /ASW|SW_|SWITCH|C9200|3560/i.test(t) ? 'Access switch' : 'Other';
};
const niceModel = (m) => (/^PA ?-?440$/i.test(String(m).trim()) ? 'Palo Alto PA-440' : String(m || '').trim());

// ── Current state ────────────────────────────────────────────────────────────
async function load(site) {
  const devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  const ports = devices.length ? await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site]) : [];
  const servers = await all('SELECT * FROM servers WHERE deleted_at IS NULL');
  const vlans = await all('SELECT * FROM net_vlans WHERE site = ?', [site]);
  const vms = await all('SELECT * FROM virtual_servers');
  return { devices, ports, servers, vlans, vms };
}

// A name index over devices: hostname, the part after "/", alias (with and without NODE / SW), other names.
function index(devs) {
  const map = new Map(), bad = new Set();
  const add = (k, h) => { if (!k || k.length < 3) return; if (map.has(k) && map.get(k) !== h) bad.add(k); else map.set(k, h); };
  for (const d of devs) {
    const names = [d.hostname, tail(d.hostname), d.alias, ...(d.alt || [])].filter(Boolean);
    for (const n of names) { const k = K(n); add(k, d.hostname); add(k.replace(/NODE/g, ''), d.hostname); add(k.replace(/SW(?=\d|$)/g, ''), d.hostname); }
  }
  return (name) => {
    if (!name) return '';
    for (const k of [K(name), K(tail(name)), K(name).replace(/NODE/g, ''), K(tail(name)).replace(/SW(?=\d|$)/g, '')]) if (map.has(k) && !bad.has(k)) return map.get(k);
    return '';
  };
}

// ── The plan ─────────────────────────────────────────────────────────────────
async function plan(site, wb) {
  const S = await load(site);
  const blocks = (wb.blocks || []).slice(0, 300), equipment = (wb.equipment || []).slice(0, 2000), aps = (wb.aps || []).slice(0, 2000);
  const devs = new Map(S.devices.map(d => [d.hostname, { ...d, alt: [] }]));
  const portsOf = new Map(); for (const d of S.devices) portsOf.set(d.hostname, new Map());
  const byId = new Map(S.devices.map(d => [d.id, d.hostname]));
  for (const p of S.ports) portsOf.get(byId.get(p.device_id)).set(p.port, p);
  const groups = { dev: [], retire: [], port: [], ap: [], vlan: [], rack: [], inv: [], vm: [], prn: [] };
  const eqBySn = (sn) => equipment.find(e => snSame(e.serial, sn));
  // The AP list and the equipment list sometimes differ by one character (FGL2443… / FGL2442…): use the one Server Inventory has.
  const inInv = (sn) => S.servers.some(x => snSame(x.serial_no, sn));
  const apSerial = (a) => { if (!a.serial || inInv(a.serial)) return a.serial || ''; const e = equipment.find(x => U(x.location) === U(a.label)); return e && inInv(e.serial) ? e.serial : a.serial; };
  const rackOf = (loc) => { const m = String(loc || '').match(/MR-?0?(\d)\b/i); return m ? `MR-0${m[1]}` : ''; };

  // 1. Devices of the port tables.
  const planned = [];   // { host, b, d (existing or null), want }
  for (const b of blocks) {
    const eq = eqBySn(b.serial) || equipment.find(e => e.name && K(e.name) === K(tail(b.host)));
    let host = U(b.host), loc = str(b.location, 120), warn = '';
    // Broken rack prefix ("MR4-0/…", "MR-0/…") or a rack that differs from the equipment list → the equipment list's rack.
    const eqRack = eq ? rackOf(eq.location) : '', locRack = parseLoc(loc).rack;
    if (eqRack && /^MR-0\d$/.test(eqRack) && !/^(MR|SR)-\d{2}\//.test(host)) {
      host = `${eqRack}/${tail(host)}`;
      if (locRack && locRack !== eqRack) { warn = `Equipment list says ${eqRack} (${eq.location}), the port sheet says ${locRack} — ${eqRack} used.`; loc = loc.replace(/MAIN RACK\s*-?\s*0?\d+/i, `MAIN RACK - ${eqRack.slice(3)}`); }
    }
    const find = index([...devs.values()]);
    const hit = devs.get(host) ? host : find(host) || (b.alias && find(b.alias)) || '';
    const want = { alias: b.alias, model: niceModel(b.model), serial: str(b.serial, 60), mgmt_ip: str(b.ip, 60), location: loc };
    if (eq && eq.remark && /firewall|node/i.test(eq.remark)) want.alias = `${eq.remark}${b.alias ? ` (${b.alias})` : ''}`;
    if (!hit) {
      const nd = { hostname: host, alias: want.alias, role: roleGuess(host, want.model, b.alias), model: want.model, serial: want.serial, mgmt_ip: want.mgmt_ip, location: want.location, alt: [b.alias, eq && eq.name, b.host].filter(Boolean), isNew: true };
      devs.set(host, nd); portsOf.set(host, new Map());
      groups.dev.push({ id: `dev+:${host}`, title: `Add ${host}`, to: [nd.role, nd.model, nd.mgmt_ip, nd.location, nd.serial && 'S/N ' + nd.serial].filter(Boolean).join(' · '), warn, on: true, data: { kind: 'add', dev: nd } });
      planned.push({ host, b });
    } else {
      const d = devs.get(hit); d.alt.push(b.alias, b.host, eq && eq.name);
      for (const f of ['model', 'serial', 'mgmt_ip', 'location', 'alias']) {
        const v = want[f]; if (!v) continue;
        if (f === 'alias' && d.alias) continue;
        if (f === 'model' && modelCode(v) && modelCode(v) === modelCode(d.model)) continue;
        if (f === 'serial' && (same(v, d.service_tag) || snSame(v, d.serial))) continue;
        if (f === 'mgmt_ip' ? ipOnly(v) === ipOnly(d.mgmt_ip) : same(v, d[f])) continue;
        groups.dev.push({ id: `dev:${hit}:${f}`, title: `${hit} — ${f === 'mgmt_ip' ? 'IP' : f === 'serial' ? 'serial' : f}`, from: d[f] || '', to: v, warn: f === 'location' ? warn : '', on: true, data: { kind: 'set', host: hit, field: f, value: v } });
      }
      planned.push({ host: hit, b });
    }
  }
  // Access points of the AP list and printers become devices too (so the switch ports link to them).
  for (const a of aps) {
    const host = U(a.label); if (!AP_LABEL.test(host)) continue;
    const eq = (a.serial && eqBySn(apSerial(a))) || equipment.find(e => U(e.location) === host);
    const want = { role: 'Access point', model: str(a.model), serial: str(apSerial(a), 60), mgmt_ip: eq && /^\d/.test(eq.ip) ? ipOnly(eq.ip) : '', location: str(a.location, 120), alias: str(a.location, 120) };
    if (!devs.has(host)) {
      const nd = { hostname: host, ...want, alt: [], isNew: true }; devs.set(host, nd); portsOf.set(host, new Map([['ETH0', { port: 'ETH0' }]]));
      groups.ap.push({ id: `ap+:${host}`, title: `Add access point ${host}`, to: [want.model, want.mgmt_ip, want.location, want.serial && 'S/N ' + want.serial].filter(Boolean).join(' · '), on: true, data: { kind: 'add', dev: nd } });
    } else {
      const d = devs.get(host);
      for (const f of ['model', 'serial', 'mgmt_ip', 'location']) if (want[f] && !same(want[f], d[f])) groups.ap.push({ id: `dev:${host}:${f}`, title: `${host} — ${f === 'mgmt_ip' ? 'IP' : f}`, from: d[f] || '', to: want[f], on: true, data: { kind: 'set', host, field: f, value: want[f] } });
    }
  }
  for (const p of (wb.printers || []).slice(0, 500)) {
    const host = U(p.share || p.name).replace(/\s+/g, '_'); if (!host) continue;
    const want = { role: 'Printer', model: str(p.model || p.brand), mgmt_ip: ipOnly(p.ip), location: str(p.location, 120), alias: p.name && U(p.name) !== host ? str(p.name) : '',
      notes: str([p.server && `Print server ${p.server}`, p.ref && `Queue ${p.ref}`, p.name && `SAP output device ${p.name}`].filter(Boolean).join(' · '), 300) };
    if (!devs.has(host)) { const nd = { hostname: host, ...want, alt: [p.name, p.ref].filter(Boolean), isNew: true }; devs.set(host, nd); portsOf.set(host, new Map());
      groups.prn.push({ id: `prn+:${host}`, title: `Add printer ${host}`, to: [want.model, want.mgmt_ip, want.location].filter(Boolean).join(' · '), on: true, data: { kind: 'add', dev: nd } }); }
    else { const d = devs.get(host); for (const f of ['model', 'mgmt_ip', 'location', 'notes']) if (want[f] && !same(want[f], d[f])) groups.prn.push({ id: `dev:${host}:${f}`, title: `${host} — ${f === 'mgmt_ip' ? 'IP' : f}`, from: d[f] || '', to: want[f], on: true, data: { kind: 'set', host, field: f, value: want[f] } }); }
  }
  // Far ends written with a rack ("MR-03/VIETTEL-LL-VNTT") that no table describes become devices too.
  { const f0 = index([...devs.values()]);
    for (const { b } of planned) for (const r of b.ports) {
      const dst = U(r.dest); if (!/^(MR|SR)-\d{2}\/[A-Z]/.test(dst) || isPanel(dst) || f0(dst) || devs.has(dst) || /unplug/i.test(r.chmode)) continue;
      const nd = { hostname: dst, alias: '', role: roleGuess(dst, ''), model: '', serial: '', mgmt_ip: '', location: '', alt: [], isNew: true };
      devs.set(dst, nd); portsOf.set(dst, new Map());
      groups.dev.push({ id: `dev+:${dst}`, title: `Add ${dst}`, to: `${nd.role} · far end of ${b.host} ${r.port}`, on: true, data: { kind: 'add', dev: nd } });
    } }
  const find = index([...devs.values()]);

  // 2. Retired: new WAN firewalls replace the old WAN firewall nodes.
  const newWan = [...devs.values()].filter(d => d.isNew && /WAN FIREWALL/i.test(d.alias || ''));
  if (newWan.length) for (const d of devs.values()) {
    if (d.isNew || d.state === 'retired' || !/WAN FIREWALL/i.test(d.alias || '')) continue;
    groups.retire.push({ id: `retire:${d.hostname}`, title: `${d.hostname} (${d.alias}) — retired`, to: `Replaced by ${newWan.map(x => x.hostname).join(' + ')}. Stays in its rack, hidden from the topology.`, on: true, data: { host: d.hostname } });
    const s = d.server_id && S.servers.find(x => x.id === d.server_id);
    if (s && s.status === 'Active') groups.inv.push({ id: `inv:${s.id}:status`, title: `#${s.id} ${s.hostname || s.brand_model} — status`, from: 'Active', to: 'Stock', warn: 'Only if the hardware is no longer used for anything else.', on: false, data: { kind: 'set', id: s.id, field: 'status', value: 'Stock' } });
  }

  // 3. Ports.
  const planPorts = new Map();   // "host|port" → merged values (later rows win)
  // First every port name of every table, so a far end written "PORT 1" finds the device's own "P1".
  for (const { host, b } of planned) { const m = portsOf.get(host); const names = [...m.keys()]; for (const r of b.ports) { const pn = portMatch(names, r.port) || cleanPort(r.port); if (!m.has(pn)) m.set(pn, {}); } }
  // What each device's own table says about each of its ports (to settle the cases where two tables disagree).
  const own = new Map();
  for (const { host, b } of planned) { const names = [...portsOf.get(host).keys()];
    for (const r of b.ports) { const pn = portMatch(names, r.port) || cleanPort(r.port); const peer = r.dest && !isPanel(r.dest) ? find(r.dest) : '';
      own.set(`${host}|${pn}`, { peer, pport: peer ? portMatch([...portsOf.get(peer).keys()], r.dport) : '', unplug: /unplug/i.test(`${r.chmode} ${(r.notes || []).join(' ')}`) }); } }
  const TIER = { 'ISP / external': 0, Firewall: 1, Router: 1, 'Core switch': 2, 'Wireless controller': 2, 'Distribution switch': 3, 'Server switch': 3, 'HCI server': 4, 'Backup storage': 4, Server: 4, 'Access switch': 5, 'Access point': 6 };
  const tier = (h) => TIER[(devs.get(h) || {}).role] ?? 6;
  for (const { host, b } of planned) {
    const names = [...portsOf.get(host).keys()];
    for (const r of b.ports) {
      const pn = portMatch(names, r.port) || cleanPort(r.port);
      const ex = portsOf.get(host).get(pn) || {};
      const v = { peer_host: '', peer_port: '', cable: str(r.cable, 30), mode: U(r.swmode).slice(0, 20), vlan: str(r.vlan, 60), grp: str(r.grp, 20), patch: '', note: '' };
      const notes = [...(r.notes || [])];
      const unplug = /unplug/i.test(`${r.chmode} ${notes.join(' ')}`); let skipLink = false;
      const dst = String(r.dest || '').trim(), dp = String(r.dport || '').trim();
      if (!dst) { if (isOutlet(dp)) v.patch = dp; else if (dp) notes.unshift(dp); }
      else if (isPanel(dst)) { if (isOutlet(dp)) v.patch = dp; }
      else {
        const peer = find(dst);
        if (unplug) notes.unshift(`Unplugged (was ${dst} ${dp})`.trim());
        else if (peer) {
          v.peer_host = peer;
          const pd = devs.get(peer);
          if (pd.role === 'Access point') { v.peer_port = 'ETH0'; if (dp && !/^ETH0$/i.test(dp) && !same(dp, ex.patch)) notes.unshift(dp); }
          else {
            v.peer_port = portMatch([...portsOf.get(peer).keys()], dp) || cleanPort(dp);
            // The far device's own table names this link on another of its ports → use its own port name.
            const named = [...own.entries()].find(([k, o]) => k.startsWith(peer + '|') && o.peer === host && pk(o.pport) === pk(pn));
            if (named) v.peer_port = named[0].slice(peer.length + 1);
            // …or says that port goes somewhere else / is unplugged: the upper layer's table wins (firewall > core > distribution > access).
            const back = own.get(`${peer}|${v.peer_port}`);
            if (back && (back.unplug || (back.peer && back.peer !== host)) && (back.unplug || tier(host) > tier(peer))) {
              notes.unshift(back.unplug ? `Unplugged (was ${dst} ${dp})` : `${peer}'s table: ${v.peer_port} → ${back.peer} ${back.pport}`); v.peer_host = ''; v.peer_port = ''; skipLink = true;
            }
          }
        } else { v.peer_host = U(dst).slice(0, 80); if (isOutlet(dp)) v.patch = dp; else v.peer_port = dp.slice(0, 40); }
      }
      v.note = notes.filter(n => !/^(unplug)$/i.test(n)).join(' · ').replace(/\s+/g, ' ').slice(0, 200);
      if (!v.peer_host) v.cable = '';                                       // no cable to speak of on an unplugged / free port
      const set = {};
      for (const f of FIELDS) {
        if (f === 'peer_host' || f === 'peer_port') continue;
        if (v[f] && !(f === 'cable' ? U(v[f]).replace(/[\s+]/g, '') === U(ex[f]).replace(/[\s+]/g, '') : same(v[f], ex[f]))) set[f] = v[f];
      }
      if (v.peer_host && (U(v.peer_host) !== U(ex.peer_host) || pk(v.peer_port) !== pk(ex.peer_port))) { set.peer_host = v.peer_host; set.peer_port = v.peer_port; if (v.cable) set.cable = v.cable; }
      if ((unplug || skipLink) && ex.peer_host && find(ex.peer_host) === find(dst)) { set.peer_host = ''; set.peer_port = ''; }
      if (!Object.keys(set).length) continue;
      planPorts.set(`${host}|${pn}`, { host, port: pn, ex, set, was: { peer_host: ex.peer_host || '', peer_port: ex.peer_port || '' } });
    }
  }
  for (const { host, port, ex, set, was } of planPorts.values()) {
    const after = { ...ex, ...set };
    const moved = ex.peer_host && 'peer_host' in set && U(ex.peer_host) !== U(set.peer_host);
    groups.port.push({ id: `port:${host}|${port}`, dev: host, title: `${host} ${port}`, from: desc(ex.port ? ex : null), to: desc(after) + (set.note ? ` · ${set.note}` : ''),
      warn: moved ? `Link moves from ${ex.peer_host} ${ex.peer_port || ''} to ${set.peer_host || '(nothing)'}` : '', on: true, data: { host, port, set, was } });
  }
  // AP list: the switch port each AP is cabled to (from the wireless controller).
  for (const a of aps) {
    const host = U(a.label); if (!AP_LABEL.test(host) || !a.switch || !a.port) continue;
    const sw = find(a.switch); if (!sw) continue;
    const pn = portMatch([...portsOf.get(sw).keys()], cleanPort(a.port)) || cleanPort(a.port);
    const now = { ...(portsOf.get(sw).get(pn) || {}), ...((planPorts.get(`${sw}|${pn}`) || {}).set || {}) };
    if (U(now.peer_host) === host && U(now.peer_port) === 'ETH0') continue;
    const elsewhere = [...portsOf.get(sw).keys()].map(p => ({ p, v: { ...(portsOf.get(sw).get(p) || {}), ...((planPorts.get(`${sw}|${p}`) || {}).set || {}) } })).find(x => x.p !== pn && U(x.v.peer_host) === host);
    const busy = now.peer_host && U(now.peer_host) !== host;
    groups.ap.push({ id: `aplink:${host}`, title: `${host} ⇄ ${sw} ${pn}`, from: desc(now.port || now.peer_host ? now : null), to: `${host} ETH0 (AP list)`,
      warn: elsewhere ? `The port sheet has ${host} on ${elsewhere.p} — the AP list (wireless controller) says ${pn}.` : busy ? `${pn} is now ${now.peer_host} ${now.peer_port || ''}.` : '',
      on: !elsewhere && !busy, data: { host: sw, port: pn, set: { peer_host: host, peer_port: 'ETH0', mode: now.mode || 'ACCESS', vlan: now.vlan || '112' } } });
  }

  // 4. VLANs.
  for (const v of (wb.vlans || []).slice(0, 4096)) {
    const id = str(v.vlan, 10); if (!/^\d+$/.test(id)) continue;
    const ex = S.vlans.find(x => x.vlan === id), want = { name: str(v.name || v.description), description: str(v.description, 200), network: str(v.network, 60), gateway: str(v.gateway, 60), dhcp: str(v.dhcp, 60) };
    const diff = Object.entries(want).filter(([k, val]) => val && !same(val, ex && ex[k]));
    if (!diff.length) continue;
    groups.vlan.push({ id: `vlan:${id}`, title: `VLAN ${id} ${want.name}`, from: ex ? diff.map(([k]) => `${k}: ${ex[k] || '—'}`).join(' · ') : '', to: ex ? diff.map(([k, val]) => `${k}: ${val}`).join(' · ') : `new · ${want.network} · gw ${want.gateway}${want.dhcp ? ' · DHCP ' + want.dhcp : ''}`, on: true, data: { vlan: id, ...want } });
  }

  // 5. Racks.
  const racks = (wb.racks || []).slice(0, 200).filter(r => r.items && r.items.length);
  const haveR = await all('SELECT r.name, i.label, i.u, i.height FROM net_rack_items i JOIN net_racks r ON r.id = i.rack_id WHERE r.site = ? AND i.auto = 2', [site]);
  const sig = (l) => l.map(x => `${x.name}|${String(x.label).replace(/^ODF /, '')}|${x.u}|${x.height}`).sort().join('~');
  if (racks.length && sig(haveR) !== sig(racks.flatMap(r => r.items.slice(0, 120).map(i => ({ name: r.name, label: str(i.label, 60), u: Math.max(1, Number(i.u) || 1), height: Math.min(10, Math.max(1, Number(i.height) || 1)) }))))) {
    const n = racks.reduce((t, r) => t + r.items.length, 0);
    groups.rack.push({ id: 'racks', title: `Rebuild ${racks.length} racks / cabinets from RACK LAYOUT (${n} items, real U positions)`,
      to: racks.map(r => `${r.name}${r.area && r.kind === 'cabinet' ? ' · ' + r.area : ''} (${r.items.length})`).join(', '), warn: 'Replaces the items of these racks (devices you moved by hand in them too); other racks stay.', on: true, data: {} });
  }

  // 6. Server Inventory: what the workbook knows per serial number.
  const facts = new Map();
  const fact = (sn) => { const k = snKey(sn); if (!k) return null; const f = facts.get(k) || [...facts.values()].find(x => snSame(x.serial, sn)); if (f) return f; facts.set(k, { serial: String(sn).trim(), lines: [] }); return facts.get(k); };
  for (const { host, b } of planned) { const f = fact(b.serial); if (!f) continue; const d = devs.get(host);
    Object.assign(f, { host, ip: ipOnly(b.ip) || f.ip, location: d.isNew ? d.location : (groups.dev.find(c => c.id === `dev:${host}:location`) || {}).to || d.location, model: niceModel(b.model), role: d.role }); }
  for (const e of equipment) {
    if (/^CP-/i.test(e.model)) continue;                                  // IP phones: not in Server Inventory
    const f = fact(e.serial); if (!f) continue;
    const label = AP_LABEL.test(e.location) ? U(e.location) : '';
    const mac = isMac(e.mac) ? e.mac : isMac(e.name) ? e.name : '';
    if (label) f.host = f.host || label;
    if (/^\d+\.\d+\.\d+\.\d+/.test(e.ip)) f.ip = f.ip || ipOnly(e.ip);
    if (mac && !f.lines.some(l => /^MAC/.test(l))) f.lines.push(`MAC: ${U(mac)}`);
    f.model = f.model || e.model; f.role = f.role || e.role; f.stock = /stock/i.test(e.location); f.kloc = /^K\d+-MR\d/i.test(e.location) ? e.location : f.kloc;
  }
  for (const a of aps) { if (!a.serial) continue; const f = fact(apSerial(a)); const host = U(a.label);
    f.host = host; f.location = f.location || a.location; f.model = f.model || a.model; f.role = 'Access point';
    if (a.mac && !f.lines.some(l => /^MAC/.test(l))) f.lines.push(`MAC: ${U(a.mac)}`);
    if (a.switch) f.lines.push(`Switch port: ${a.switch} ${cleanPort(a.port)}`); }
  for (const f of facts.values()) {
    const s = S.servers.find(x => snSame(x.serial_no, f.serial));
    if (!s) {
      if (!f.host && !f.ip) continue;
      groups.inv.push({ id: `invadd:${snKey(f.serial)}`, title: `Add ${f.host || f.model} to Server Inventory`, to: [f.model, `S/N ${f.serial}`, f.ip, f.location || f.kloc, f.stock ? 'status Stock' : ''].filter(Boolean).join(' · '),
        warn: 'Not in Server Inventory yet.', on: false, data: { kind: 'add', rec: { hostname: f.host || '', brand_model: f.model || '', serial_no: f.serial, ip_address: f.ip || '', location: f.location || f.kloc || '', category: CAT[f.role] || (/AP/i.test(f.model) ? 'Access Point' : 'Network device'), net_info: f.lines.join('\n'), status: f.stock ? 'Stock' : 'Active' } } });
      continue;
    }
    const want = { hostname: f.host || '', ip_address: f.ip || '', location: f.location || (s.location ? '' : f.kloc || '') };
    const hostClash = want.hostname && String(s.hostname || '').trim() && !same(want.hostname, s.hostname);
    for (const [k, v] of Object.entries(want)) {
      if (!v || same(v, s[k])) continue;
      const conflict = !!String(s[k] || '').trim() || hostClash;
      groups.inv.push({ id: `inv:${s.id}:${k}`, title: `#${s.id} ${s.brand_model} · S/N ${s.serial_no} — ${k === 'ip_address' ? 'IP' : k}`, from: s[k] || '', to: v,
        warn: conflict ? (k === 'hostname' ? `The workbook gives this serial to ${v} — check the label on the device.` : hostClash && !String(s[k] || '').trim() ? `Record is ${s.hostname} in Server Inventory — decide the hostname first.` : 'Different value in Server Inventory — check which is right.') : '', on: !conflict, data: { kind: 'set', id: s.id, field: k, value: v } });
    }
    const missing = f.lines.filter(l => !String(s.net_info || '').toUpperCase().includes(U(l)));
    if (missing.length) groups.inv.push({ id: `inv:${s.id}:net_info`, title: `#${s.id} ${s.hostname || s.brand_model} — network info`, from: '', to: missing.join(' · '), on: true, data: { kind: 'append', id: s.id, lines: missing } });
  }

  // 7. Virtual servers.
  for (const v of (wb.vms || []).slice(0, 2000)) {
    const host = U(v.hostname); if (!host) continue;
    const country = str(v.country, 40) || 'Vietnam';
    const ex = S.vms.find(x => U(x.hostname) === host && x.country === country);
    const want = vmRecord(v);
    const diff = Object.entries(want).filter(([k, val]) => val && !same(val, ex && ex[k]));
    if (!diff.length) continue;
    groups.vm.push({ id: `vm:${host}`, title: `${ex ? '' : 'Add '}${host}${want.kind ? ` (${want.kind})` : ''}`, from: ex ? diff.map(([k]) => `${k}: ${ex[k] || '—'}`).join(' · ').slice(0, 300) : '',
      to: ex ? diff.map(([k, val]) => `${k}: ${val}`).join(' · ').slice(0, 300) : [want.ip, want.os, want.usage].filter(Boolean).join(' · '), on: true, data: { country, rec: want } });
  }

  const G = [['dev', 'Network devices (port sheets)'], ['retire', 'Retired devices'], ['port', 'Ports & links'], ['ap', 'Access points (IP AP - MGMT)'], ['vlan', 'VLANs'],
    ['rack', 'Racks (RACK LAYOUT)'], ['inv', 'Server Inventory'], ['vm', 'Virtual servers (VM SERVER)'], ['prn', 'Printers (PRINTER services)']];
  return { site, groups: G.map(([key, title]) => ({ key, title, changes: groups[key] })).filter(g => g.changes.length), devs, racks };
}
function vmRecord(v) {
  const o = { ref_key: v.key, status: /^active$/i.test(v.status) ? 'Active' : str(v.status, 20), kind: /^physical$/i.test(v.kind) ? 'Physical' : 'Virtual', ip: ipOnly(String(v.ip || '').replace(/\]$/, '')), infra_ip: ipOnly(v.infra_ip),
    farm: v.farm, system_type: v.system_type, it_ot: v.it_ot, platform: v.platform, os: v.os, os_version: v.os_version, domain: v.domain, sap: v.sap, usage: v.usage,
    description: v.description, impact: v.impact, backup: v.backup, host_model: v.model, serial: v.serial, cpu: v.cpu, memory: v.memory, location: v.location, notes: v.note };
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, str(x, ['description', 'impact'].includes(k) ? 600 : 160)]).filter(([, x]) => x && !/^(#N\/A|N\/A)$/i.test(x)));
}

router.post('/plan', wrap(async (req, res) => {
  const site = str(req.body.site, 80); if (!site) return res.status(400).json({ error: 'Choose the site' });
  const p = await plan(site, req.body.wb || {});
  res.json({ site, groups: p.groups.map(g => ({ ...g, changes: g.changes.map(({ data, ...c }) => c) })) });
}));

// ── Apply ────────────────────────────────────────────────────────────────────
router.post('/apply', wrap(async (req, res) => {
  const site = str(req.body.site, 80); if (!site) return res.status(400).json({ error: 'Choose the site' });
  const ids = new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(String));
  const P = await plan(site, req.body.wb || {});
  const pick = (key) => ((P.groups.find(g => g.key === key) || {}).changes || []).filter(c => ids.has(c.id));
  const all_ = P.groups.flatMap(g => g.changes).filter(c => ids.has(c.id));
  const counts = {}; const user = req.user.username;
  const logs = [];

  // a) devices: add / set fields
  const st = [];
  for (const c of all_.filter(c => c.data && c.data.kind === 'add' && c.data.dev)) {
    const d = c.data.dev;
    st.push({ sql: `INSERT INTO net_devices (site, hostname, alias, role, model, serial, mgmt_ip, location, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'workbook')
        ON CONFLICT(site, hostname) DO NOTHING`, args: [site, d.hostname, str(d.alias), str(d.role, 40), str(d.model), str(d.serial, 60), str(d.mgmt_ip, 60), str(d.location), str(d.notes, 500)] });
    logs.push([d.hostname, '', '', 'device added (Factory Info workbook)']);
  }
  const DF = ['alias', 'model', 'serial', 'mgmt_ip', 'location', 'notes'];
  for (const c of all_.filter(c => c.data && c.data.kind === 'set' && c.data.host && DF.includes(c.data.field))) {
    st.push({ sql: `UPDATE net_devices SET ${c.data.field} = ?, updated_at = datetime('now') WHERE site = ? AND hostname = ?`, args: [str(c.data.value, 120), site, c.data.host] });
    logs.push([c.data.host, '', c.from || '', `${c.data.field}: ${c.data.value}`]);
  }
  for (const c of pick('retire')) { st.push({ sql: "UPDATE net_devices SET state = 'retired', updated_at = datetime('now') WHERE site = ? AND hostname = ?", args: [site, c.data.host] }); logs.push([c.data.host, '', '', 'retired']); }
  if (st.length) await batch(st);
  counts.devices = st.length;
  // New APs get their one port.
  const apAdds = all_.filter(c => c.id.startsWith('ap+:'));
  if (apAdds.length) await batch(apAdds.map(c => ({ sql: "INSERT OR IGNORE INTO net_ports (device_id, port, sort) SELECT id, 'ETH0', 1 FROM net_devices WHERE site = ? AND hostname = ?", args: [site, c.data.dev.hostname] })));

  // b) ports, in memory with both ends kept in step, then written at once.
  const portCh = [...pick('port'), ...pick('ap').filter(c => c.id.startsWith('aplink:'))];
  if (portCh.length) {
    const devRows = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
    const dev = new Map(devRows.map(d => [d.hostname, d]));
    const mem = new Map(devRows.map(d => [d.hostname, new Map()]));
    const hostOf = new Map(devRows.map(d => [d.id, d.hostname]));
    for (const p of await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site])) mem.get(hostOf.get(p.device_id)).set(p.port, { ...p });
    const dirty = new Map();
    const getP = (h, port) => (mem.get(h) && mem.get(h).get(port)) || null;
    const setP = (h, port, values) => {
      const before = getP(h, port);
      const v = Object.fromEntries(FIELDS.map(k => [k, str(values[k], k === 'note' ? 200 : 80)]));
      const row = { ...(before || {}), port, ...v };
      mem.get(h).set(port, row); dirty.set(`${h}|${port}`, { h, port });
      if (desc(before) !== desc(v)) logs.push([h, port, desc(before), desc(v)]);
      return { before, v };
    };
    const mirror = (h, port, before, v) => {
      if (before && before.peer_host && (before.peer_host !== v.peer_host || before.peer_port !== v.peer_port) && dev.has(before.peer_host) && before.peer_port) {
        const back = getP(before.peer_host, before.peer_port);
        if (back && back.peer_host === h && back.peer_port === port) setP(before.peer_host, before.peer_port, { ...back, peer_host: '', peer_port: '', cable: '' });
      }
      if (v.peer_host && v.peer_port && dev.has(v.peer_host)) {
        const cur = getP(v.peer_host, v.peer_port) || {};
        if (cur.peer_host !== h || cur.peer_port !== port || cur.cable !== v.cable) {
          if (cur.peer_host && (cur.peer_host !== h || cur.peer_port !== port) && dev.has(cur.peer_host) && cur.peer_port) {
            const ob = getP(cur.peer_host, cur.peer_port);
            if (ob && ob.peer_host === v.peer_host && ob.peer_port === v.peer_port) setP(cur.peer_host, cur.peer_port, { ...ob, peer_host: '', peer_port: '', cable: '' });
          }
          setP(v.peer_host, v.peer_port, { ...cur, peer_host: h, peer_port: port, cable: v.cable || cur.cable, grp: cur.grp || v.grp });
        }
      }
    };
    for (const c of portCh) {
      const { host, port, set } = c.data; if (!mem.has(host)) continue;
      if (set.peer_host && !dev.has(set.peer_host) && /^ETH0$/.test(set.peer_port)) set.peer_port = '';   // AP not added
      const cur = getP(host, port) || {};
      // Clearing a link that another change of this run has already moved: leave the new link alone.
      if ('peer_host' in set && !set.peer_host && c.data.was && (cur.peer_host || '') !== c.data.was.peer_host) { delete set.peer_host; delete set.peer_port; }
      if (set.cable && !cur.peer_host && !set.peer_host) delete set.cable;
      const vals = { ...Object.fromEntries(FIELDS.map(k => [k, cur[k] || ''])), ...set };
      const { before, v } = setP(host, port, vals);
      mirror(host, port, before, v);
    }
    // Both ends of a link carry the same cable type (a link re-cabled twice in one run can lose it on one end).
    for (const { h, port } of [...dirty.values()]) {
      const p = getP(h, port); if (!p || !p.peer_host || !dev.has(p.peer_host)) continue;
      const q = getP(p.peer_host, p.peer_port); if (!q || q.peer_host !== h || q.peer_port !== port) continue;
      if (!p.cable && q.cable) { p.cable = q.cable; dirty.set(`${h}|${port}`, { h, port }); }
      else if (p.cable && !q.cable) { q.cable = p.cable; dirty.set(`${p.peer_host}|${p.peer_port}`, { h: p.peer_host, port: p.peer_port }); }
    }
    const w = [];
    for (const { h, port } of dirty.values()) {
      const p = mem.get(h).get(port), id = dev.get(h).id;
      w.push({ sql: `INSERT INTO net_ports (device_id, port, sort, ${FIELDS.join(', ')}, updated_by) VALUES (?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)
          ON CONFLICT(device_id, port) DO UPDATE SET ${FIELDS.map(k => `${k} = excluded.${k}`).join(', ')}, updated_by = excluded.updated_by, updated_at = datetime('now')`,
        args: [id, port, portSort(port), ...FIELDS.map(k => p[k] || ''), user] });
    }
    await batch(w); counts.ports = w.length;
  }

  // c) VLANs
  const vl = pick('vlan');
  if (vl.length) await batch(vl.map(c => ({ sql: `INSERT INTO net_vlans (site, vlan, name, description, network, gateway, dhcp) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site, vlan) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), name), description = COALESCE(NULLIF(excluded.description, ''), description),
        network = COALESCE(NULLIF(excluded.network, ''), network), gateway = COALESCE(NULLIF(excluded.gateway, ''), gateway), dhcp = COALESCE(NULLIF(excluded.dhcp, ''), dhcp)`,
    args: [site, c.data.vlan, c.data.name, c.data.description, c.data.network, c.data.gateway, c.data.dhcp] })));
  counts.vlans = vl.length;

  // d) racks from RACK LAYOUT
  if (pick('rack').length) counts.rack_items = await buildRacks(site, P.racks);

  // e) Server Inventory
  let invN = 0;
  for (const c of pick('inv')) {
    const d = c.data;
    if (d.kind === 'set' && ['hostname', 'ip_address', 'location', 'status'].includes(d.field)) { await run(`UPDATE servers SET ${d.field} = ?, updated_at = datetime('now') WHERE id = ?`, [str(d.value, 200), d.id]); invN++; }
    else if (d.kind === 'append') { const s = await get('SELECT net_info FROM servers WHERE id = ?', [d.id]); await run("UPDATE servers SET net_info = ?, updated_at = datetime('now') WHERE id = ?", [[String((s && s.net_info) || '').trim(), ...d.lines].filter(Boolean).join('\n').slice(0, 2000), d.id]); invN++; }
    else if (d.kind === 'add') { const r = d.rec;
      const producer = /cisco|air-|c9200|n3k|isr/i.test(r.brand_model) ? 'Cisco' : /palo|PA-?440/i.test(r.brand_model) ? 'Palo Alto' : /dell|vxrail/i.test(r.brand_model) ? 'Dell' : '';
      await run(`INSERT INTO servers (country, hostname, brand_model, producer, category, serial_no, ip_address, location, net_info, status, remark) VALUES ('Vietnam', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.hostname, r.brand_model, producer, r.category, r.serial_no, r.ip_address, r.location, r.net_info, r.status === 'Stock' ? 'Stock' : 'Active', `Added from the Factory Info workbook (${site})`]); invN++; }
  }
  counts.inventory = invN;
  // Link network devices to their Server Inventory record by serial (where not linked yet).
  const nd = await all('SELECT id, serial, service_tag FROM net_devices WHERE site = ? AND server_id IS NULL', [site]);
  if (nd.length) { const sv = await all('SELECT id, serial_no FROM servers WHERE deleted_at IS NULL');
    const ln = []; for (const d of nd) { const s = sv.find(x => snSame(x.serial_no, d.serial) || snSame(x.serial_no, d.service_tag)); if (s) ln.push({ sql: 'UPDATE net_devices SET server_id = ? WHERE id = ?', args: [s.id, d.id] }); }
    if (ln.length) await batch(ln); counts.linked = ln.length; }

  // f) virtual servers
  const vms = pick('vm');
  if (vms.length) {
    const COLS = ['ref_key', 'status', 'kind', 'ip', 'infra_ip', 'farm', 'system_type', 'it_ot', 'platform', 'os', 'os_version', 'domain', 'sap', 'usage', 'description', 'impact', 'backup', 'host_model', 'serial', 'cpu', 'memory', 'location', 'notes'];
    await batch(vms.map(c => { const r = c.data.rec; const cols = COLS.filter(k => r[k]);
      return { sql: `INSERT INTO virtual_servers (country, hostname, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})
          ON CONFLICT(country, hostname) DO UPDATE SET ${cols.map(k => `${k} = excluded.${k}`).join(', ')}${cols.length ? ', ' : ''}updated_at = datetime('now')`,
        args: [c.data.country, c.id.slice(3), ...cols.map(k => r[k])] }; }));
    // Physical hosts ↔ Server Inventory (same serial).
    const sv = await all('SELECT id, serial_no FROM servers WHERE deleted_at IS NULL');
    const phys = await all("SELECT id, serial FROM virtual_servers WHERE serial <> '' AND server_id IS NULL");
    const ln = phys.map(v => ({ v, s: sv.find(x => snSame(x.serial_no, v.serial)) })).filter(x => x.s);
    if (ln.length) await batch(ln.map(x => ({ sql: 'UPDATE virtual_servers SET server_id = ? WHERE id = ?', args: [x.s.id, x.v.id] })));
  }
  counts.vms = vms.length;

  if (logs.length) await batch(logs.slice(0, 5000).map(([d, p, b, a]) => ({ sql: 'INSERT INTO net_port_log (site, device, port, before, after, by_user) VALUES (?, ?, ?, ?, ?, ?)', args: [site, d, p, String(b).slice(0, 300), String(a).slice(0, 300), user] })));
  await audit(req.user, 'NETMAP', null, `Network map "${site}": Factory Info workbook applied (${ids.size} changes: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  res.json({ ok: true, counts });
}));

// Racks / cabinets of the layout: items at their real U; a label that names a device of the map becomes that device.
async function buildRacks(site, racks) {
  const devs = await all('SELECT id, hostname, alias, location FROM net_devices WHERE site = ?', [site]);
  const find = index(devs.map(d => ({ ...d, alt: [] })));
  // A label the map does not know ("MR-03/FW-01") → the device whose location is that rack and U.
  const atU = (rack, u) => { const l = devs.filter(d => { const p = parseLoc(d.location); return p.rack === rack && p.lo === u; }); return l.length === 1 ? l[0].hostname : ''; };
  const st = [];
  for (const r of racks) {
    await run(`INSERT INTO net_racks (site, name, kind, units, sort, area, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(site, name) DO UPDATE SET kind = excluded.kind, units = excluded.units, area = COALESCE(NULLIF(excluded.area, ''), area), notes = COALESCE(NULLIF(excluded.notes, ''), notes)`,
      [site, r.name, r.kind === 'cabinet' ? 'cabinet' : 'rack', Math.min(52, Math.max(4, Number(r.units) || 42)), r.kind === 'cabinet' ? 100 + (Number((r.name.match(/\d+/) || [0])[0]) || 0) + (/CCTV/.test(r.name) ? 0.5 : 0) + (/HARICI/.test(r.name) ? 50 : 0) : Number((r.name.match(/\d+/) || [0])[0]) || 0,
        str(r.area, 60), r.sr ? `${r.sr} (RACK LAYOUT)` : '']);
    const rk = await get('SELECT id FROM net_racks WHERE site = ? AND name = ?', [site, r.name]);
    st.push({ sql: 'DELETE FROM net_rack_items WHERE rack_id = ?', args: [rk.id] });
    for (const it of r.items.slice(0, 120)) {
      const label = str(it.label, 60), clean = label.replace(/\((9200|3560|CAT6A PANEL)\)/gi, '').replace(/\s*\(.*\)\s*$/, '').trim();
      const ik = /CABLE MANAGEMENT/i.test(label) ? 'cable' : /PDU/i.test(label) ? 'pdu' : /UPS/i.test(label) ? 'ups' : isPanel(label) || /ODF|^SR-\d+ \(/i.test(label) ? 'patch' : 'device';
      const d = ik === 'device' ? find(clean) || atU(r.name, Number(it.u)) : '';
      const id = d ? devs.find(x => x.hostname === d).id : null;
      st.push({ sql: 'INSERT INTO net_rack_items (rack_id, device_id, kind, label, u, height, auto) VALUES (?, ?, ?, ?, ?, ?, 2)',
        args: [rk.id, id, ik === 'device' && !id ? 'other' : ik, /^SR-\d+ \(/i.test(label) ? `ODF ${label}` : label, Math.max(1, Number(it.u) || 1), Math.min(10, Math.max(1, Number(it.height) || 1))] });
    }
  }
  // A device can only be in one place: drop its older automatic placements elsewhere.
  await batch(st);
  await run(`DELETE FROM net_rack_items WHERE auto = 1 AND device_id IN (SELECT device_id FROM net_rack_items WHERE auto = 2 AND device_id IS NOT NULL)
      AND rack_id IN (SELECT id FROM net_racks WHERE site = ?)`, [site]);
  const extra = await placeDevices(site);
  return st.length + extra;
}

module.exports = router;
