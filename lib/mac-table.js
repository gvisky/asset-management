/* Switch MAC address tables → which port each device is on (cameras and other Server Inventory devices, by MAC).
   Input: the text of `show mac address-table` (IOS / IOS-XE: "  11  e430.2229.ea0f  DYNAMIC  Gi1/0/5"; Cisco C1000 /
   C1300 / CBS: "11  e4:30:22:29:ea:0f  gi1/0/5  dynamic" …), one or more switches in one text — a new block starts at a
   prompt line ("K2_CCTV_01#show mac address-table"). Ports that carry many MACs are uplinks / trunks and are left out.
   Pure: parse(text) → blocks, plan(blocks, ctx) → rows. */

const MAC_RE = /\b([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})\b/i;
const IF_RE = /\b(gi(?:gabit)?(?:ethernet)?|ge|fa(?:st)?(?:ethernet)?|te(?:n)?(?:gigabit)?(?:ethernet)?|tw(?:o)?(?:gigabit)?(?:ethernet)?|fi(?:ve)?(?:gigabit)?(?:ethernet)?|xe|eth)\s*(\d+(?:\/\d+){0,2})\b/i;
const hex = (s) => String(s || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
const macFmt = (h) => h.match(/../g).join(':');
const UPLINK_MACS = 4;   // a port with more MACs than this is an uplink / trunk

/** Text → [{ switch: name from the prompt or '', entries: [{ mac, vlan, iface: { kind: 'G' | 'T', nums: [..] }, raw }] }]. */
function parse(text) {
  const blocks = []; let cur = null;
  const start = (name) => { cur = { switch: name, entries: [] }; blocks.push(cur); };
  for (const line of String(text || '').split(/\r?\n/)) {
    const pm = line.match(/^\s*([A-Za-z0-9][\w./-]*)\s*[#>]\s*(sh(ow)?\s+mac|$)/i);
    if (pm && !MAC_RE.test(line)) { start(pm[1]); continue; }
    const m = line.match(MAC_RE), i = line.replace(MAC_RE, ' ').match(IF_RE);
    if (!m || !i || /\b(cpu|router|static\s+cpu|drop)\b/i.test(line) || /\b(po|port-channel|vlan|vl)\s*\d/i.test(line.replace(i[0], ''))) continue;
    if (!cur) start('');
    const h = hex(m[1]); if (h.length !== 12 || /^(0{12}|F{12})$/.test(h) || /^01005E|^3333/.test(h)) continue;
    const vlan = (line.match(/^\s*(\d{1,4})\s/) || [])[1] || '';
    const kind = /^(te|tw|fi|xe)/i.test(i[1]) ? 'T' : 'G';
    cur.entries.push({ mac: h, vlan, iface: { kind, nums: i[2].split('/').map(Number) }, raw: `${i[1]}${i[2]}` });
  }
  return blocks.filter(b => b.entries.length);
}

/** The map port of a switch for an interface of the table: same last number (and same 1/0 when given), GE vs T class. */
function portFor(ports, iface) {
  const nums = (p) => (String(p).match(/\d+/g) || []).map(Number);
  const cls = (p) => (/^(T|TE|XE)\b/i.test(p) || /^(T|TE) /i.test(p) ? 'T' : 'G');
  const cand = ports.filter(p => cls(p.port) === iface.kind);
  const n = iface.nums, last = n[n.length - 1];
  return cand.find(p => nums(p.port).join('/') === n.join('/'))
    || cand.find(p => { const q = nums(p.port); return q[q.length - 1] === last && (n.length < 3 || q.slice(-2)[0] === n.slice(-2)[0]); })
    || null;
}

/** ctx: { devices (map switches), ports (their ports), servers (records with mac / hostname / switch_port) }, choose: { blockIndex: device id }. */
function plan(blocks, ctx, choose = {}) {
  const k = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sws = ctx.devices.filter(d => /switch/i.test(d.role || '') && d.state !== 'retired');
  const byMac = new Map(); for (const s of ctx.servers) { const h = hex(s.mac); if (h.length === 12) byMac.set(h, s); }
  const out = { switches: [], rows: [], unknown: [] };
  const seen = new Map();   // mac → best hit
  blocks.forEach((b, bi) => {
    const want = choose[bi] != null ? sws.find(d => d.id === Number(choose[bi])) : sws.find(d => [d.hostname, d.alias].some(n => n && k(n) === k(b.switch)));
    const ports = want ? ctx.ports.filter(p => p.device_id === want.id) : [];
    const perIf = new Map(); for (const e of b.entries) perIf.set(e.raw.toLowerCase(), (perIf.get(e.raw.toLowerCase()) || 0) + 1);
    const info = { index: bi, name: b.switch, device_id: want ? want.id : null, hostname: want ? want.hostname : '', entries: b.entries.length, uplinks: [...perIf].filter(([, n]) => n > UPLINK_MACS).map(([i]) => i), matched: 0 };
    out.switches.push(info);
    if (!want) return;
    for (const e of b.entries) {
      if (perIf.get(e.raw.toLowerCase()) > UPLINK_MACS) continue;
      const p = portFor(ports, e.iface);
      if (!p) continue;
      const hit = { mac: e.mac, vlan: e.vlan, sw: want, port: p, n: perIf.get(e.raw.toLowerCase()) };
      const prev = seen.get(e.mac); if (!prev || hit.n < prev.n) seen.set(e.mac, hit);
    }
  });
  const portTaken = new Map();
  for (const [mac, h] of seen) {
    const s = byMac.get(mac);
    const where = `${h.sw.hostname} ${h.port.port}`;
    if (!s) { out.unknown.push({ mac: macFmt(mac), switch: h.sw.hostname, port: h.port.port, vlan: h.vlan, peer_host: h.port.peer_host || '' }); continue; }
    const name = s.hostname || '#' + s.id;
    // The port is already cabled to something else (another device / a network device): show it, do not overwrite.
    const other = h.port.peer_host && k(h.port.peer_host) !== k(name) ? h.port.peer_host : '';
    const same = String(s.switch_port || '').trim() === where || String(s.switch_port || '').startsWith(where + ' ');
    const r = { server_id: s.id, hostname: name, category: s.category || '', it_ot: s.it_ot || '', mac: macFmt(mac), switch_id: h.sw.id, switch: h.sw.hostname, port: h.port.port, port_id: h.port.id,
      vlan: h.vlan, before: s.switch_port || '', action: same && !other && k(h.port.peer_host) === k(name) ? 'same' : other ? 'busy' : 'set', other };
    if (portTaken.has(h.port.id)) { r.action = 'shared'; r.other = portTaken.get(h.port.id); } else portTaken.set(h.port.id, name);
    out.rows.push(r);
    const sw = out.switches.find(x => x.device_id === h.sw.id); if (sw) sw.matched++;
  }
  out.rows.sort((a, b) => a.switch.localeCompare(b.switch, undefined, { numeric: true }) || a.port.localeCompare(b.port, undefined, { numeric: true }));
  return out;
}

module.exports = { parse, plan, portFor, hex };
