/* CCTV camera list (NVR / Wisenet export, e.g. Export_17112026_Image.xlsx) → Server Inventory cameras, on their CCTV switch.

   Camera name "K5-12" = camera 12 of CCTV KABIN 5, "HK8-1R" = HARICI KABIN 8, "K11-…" = IT KABIN 11 (SR-19/CCTV-ASW-12),
   "K1-…" = office building (MR-01 CCTV switches). Each camera group gets the CCTV switch of that cabinet (IT can change it);
   cameras are matched to existing records by MAC, then serial, then name. The file has no switch port: the camera is recorded
   on the switch ("Connected to" = the switch) until a port is known. Pure functions. */

const t = (v, n = 120) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const hex = (s) => String(s || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
const macOf = (s) => { const h = hex(s); return h.length === 12 ? h.match(/../g).join(':') : ''; };

const HEAD = { model: /^model$/i, name: /^camera\s*name$|^name$/i, status: /^status$/i, mac: /^mac/i, serial: /^s\/?n$|^serial/i, fw: /^f\/?w|firmware/i,
  ip: /^ip\s*address$|^ip$/i, mask: /^subnet/i, gw: /^gateway$/i, dns1: /^dns\s*1$/i, dns2: /^dns\s*2$/i, http: /^http$/i, https: /^https$/i, image: /^image$/i, time: /system\s*time/i };

/** Sheet rows (array of arrays, header first) → cameras; `line` = 1-based sheet row (for the picture of that row). */
function readRows(aoa) {
  const hi = aoa.findIndex(r => r.some(c => HEAD.name.test(String(c).trim())) && r.some(c => HEAD.mac.test(String(c).trim())));
  if (hi < 0) return { rows: [], error: 'No header with Camera Name and MAC Address found' };
  const head = aoa[hi].map(c => String(c).trim()), col = {};
  for (const [k, re] of Object.entries(HEAD)) col[k] = head.findIndex(h => re.test(h));
  const rows = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    const g = (k) => (col[k] >= 0 ? t(r[col[k]]) : '');
    const name = g('name'); if (!name) return;
    rows.push({ line: hi + i + 2, name, model: g('model'), status: g('status'), mac: macOf(g('mac')), serial: g('serial'), fw: g('fw'),
      ip: /^\d+\.\d+\.\d+\.\d+$/.test(g('ip')) ? g('ip') : '', mask: g('mask'), gw: g('gw'), dns1: g('dns1'), dns2: g('dns2'), http: g('http'), https: g('https') });
  });
  return { rows };
}

/** "K5-12" → { group: 'K5', kind: 'CCTV', n: 5 }, "HK8-1R" → { group: 'HK8', kind: 'HARICI', n: 8 }; other names → their own group. */
function groupOf(name) {
  const m = String(name).toUpperCase().match(/^(HK|K)\s*0*(\d+)\s*-/);
  if (!m) return { group: String(name).toUpperCase(), kind: '', n: null };
  return { group: m[1] + Number(m[2]), kind: m[1] === 'HK' ? 'HARICI' : 'CCTV', n: Number(m[2]) };
}

// Wisenet model → product line for the category / brand.
const maker = (model) => (/^(XN|XND|XNO|XNP|XNV|QN|PN|TN|LN)/i.test(model) ? 'Hanwha Vision' : '');

function plan(rows, ctx, overrides = {}, areas = {}) {
  // The cabinet's first CCTV switch (from the racks / "_01") before switches added next to it ("HK4_CCTV_02").
  const first = (d) => (d.source === 'racks' ? 0 : /_0*1$/.test(`${d.alias || ''}`) ? 1 : 2);
  const cctv = ctx.devices.filter(d => /switch/i.test(d.role || '') && /CCTV/i.test(d.hostname) && d.state !== 'retired').sort((a, b) => first(a) - first(b));
  const issues = [];
  // 1. Groups and their CCTV switch.
  const groups = new Map();
  for (const r of rows) { const g = groupOf(r.name); r.group = g.group; if (!groups.has(g.group)) groups.set(g.group, { ...g, rows: [] }); groups.get(g.group).rows.push(r); }
  const out = [];
  for (const g of [...groups.values()].sort((a, b) => (a.kind || 'Z').localeCompare(b.kind || 'Z') || (a.n || 0) - (b.n || 0))) {
    let sw = null, how = '';
    const loc = (d) => String(d.location || '').toUpperCase();
    if (g.kind === 'CCTV' && g.n === 1) { sw = cctv.find(d => /^MR-01\/CCTV-ASW-0*1$/i.test(d.hostname)) || cctv.find(d => /MAIN RACK - 01/.test(loc(d))); how = 'K1 = office building: main rack MR-01 CCTV switch'; }
    else if (g.kind === 'CCTV') {
      sw = cctv.find(d => new RegExp(`CCTV-?KABIN\\s*0*${g.n}\\b`).test(loc(d)));
      if (sw) how = `CCTV KABIN ${g.n}`;
      else { sw = cctv.find(d => /access/i.test(d.role || '') && new RegExp(`(^|[^A-Z])IT-?KABIN\\s*0*${g.n}\\b`).test(loc(d))); if (sw) how = `IT KABIN ${g.n} (its CCTV switch)`; }
    } else if (g.kind === 'HARICI') { sw = cctv.find(d => new RegExp(`HARICI\\s*-?KABIN\\s*0*${g.n}\\b`).test(loc(d))); if (sw) how = `HARICI KABIN ${g.n}`; }
    if (Object.prototype.hasOwnProperty.call(overrides, g.group)) { const id = Number(overrides[g.group]); sw = id ? ctx.devices.find(d => d.id === id) || null : null; how = 'chosen by you'; }
    g.sw = sw;
    out.push({ group: g.group, cameras: g.rows.length, device_id: sw ? sw.id : 0, hostname: sw ? sw.hostname : '', location: sw ? sw.location : '',
      how: sw ? how : cctv.length ? 'no CCTV switch found for this name — choose one' : 'the CCTV switches are not on the map yet (Racks → 📹)' });
  }
  // 2. Checks of the list itself.
  const dupName = new Map(); rows.forEach(r => dupName.set(r.name.toUpperCase(), (dupName.get(r.name.toUpperCase()) || 0) + 1));
  for (const [n, c] of dupName) if (c > 1) issues.push({ kind: 'name', text: `Camera name ${n} is used by ${c} cameras (${rows.filter(r => r.name.toUpperCase() === n).map(r => r.ip).join(', ')}) — rename one on the NVR` });
  const dupMac = new Map(); rows.forEach(r => { if (r.mac) dupMac.set(r.mac, (dupMac.get(r.mac) || 0) + 1); });
  for (const [m, c] of dupMac) if (c > 1) issues.push({ kind: 'mac', text: `MAC ${m} is on ${c} cameras` });
  rows.filter(r => r.status && !/^ok$/i.test(r.status)).forEach(r => issues.push({ kind: 'status', text: `${r.name}: status "${r.status}"` }));
  // Gaps: a camera of another cabinet sitting in the IP sequence where a missing number of this cabinet would be (renamed?).
  const ipN = (ip) => ip.split('.').map(Number).reduce((s, x) => s * 256 + x, 0);
  const seq = rows.filter(r => r.ip).slice().sort((a, b) => ipN(a.ip) - ipN(b.ip));
  for (let i = 1; i < seq.length - 1; i++) {
    const a = seq[i - 1], r = seq[i], b = seq[i + 1];
    const na = (a.name.match(/-(\d+)/) || [])[1], nb = (b.name.match(/-(\d+)/) || [])[1];
    if (a.group === b.group && r.group !== a.group && na && nb && Number(nb) - Number(na) === 2 && !rows.some(x => x.group === a.group && Number((x.name.match(/-(\d+)/) || [])[1]) === Number(na) + 1))
      issues.push({ kind: 'name', text: `${r.name} (${r.ip}) sits between ${a.name} and ${b.name}, where ${a.group}-${Number(na) + 1} is missing — check its name` });
  }
  const oldFw = rows.filter(r => /^1\./.test(r.fw));
  if (oldFw.length) issues.push({ kind: 'fw', text: `${oldFw.length} camera(s) on old firmware 1.x (2019–2020): ${oldFw.map(r => r.name).join(', ')}` });
  const noHttps = rows.filter(r => /enable/i.test(r.http) && /disable/i.test(r.https));
  if (noHttps.length) issues.push({ kind: 'sec', text: `${noHttps.length} camera(s) answer on HTTP without HTTPS` });
  const gws = [...new Set(rows.map(r => `${r.mask} gw ${r.gw}`))];
  if (gws.length > 1) issues.push({ kind: 'net', text: `Different subnet mask / gateway settings: ${gws.map(g => `${g} (${rows.filter(r => `${r.mask} gw ${r.gw}` === g).length})`).join(' · ')}` });
  // 3. Server Inventory: MAC → serial → name.
  const sMac = new Map(), sSn = new Map(), sName = new Map();
  for (const s of ctx.servers) { if (hex(s.mac).length === 12) sMac.set(hex(s.mac), s); if (hex(s.serial_no).length >= 6) sSn.set(hex(s.serial_no), s); if (s.hostname) sName.set(s.hostname.toUpperCase(), s); }
  const usedIds = new Set();
  const cams = rows.map(r => {
    const g = groups.get(r.group);
    let ex = (r.mac && sMac.get(hex(r.mac))) || (hex(r.serial).length >= 6 && sSn.get(hex(r.serial))) || null;
    if (!ex && dupName.get(r.name.toUpperCase()) === 1) { const n = sName.get(r.name.toUpperCase()); if (n && /camera/i.test(n.category || '') && !n.mac) ex = n; }
    if (ex && usedIds.has(ex.id)) ex = null; if (ex) usedIds.add(ex.id);
    const fields = { hostname: r.name, producer: maker(r.model), brand_model: [maker(r.model), r.model].filter(Boolean).join(' '), category: 'CCTV camera',
      serial_no: r.serial, mac: r.mac, ip_address: r.ip, os: r.fw ? 'FW ' + r.fw : '', location: g.sw ? g.sw.location : '', switch_port: g.sw ? g.sw.hostname : '',
      status: /^ok$/i.test(r.status) || !r.status ? 'Active' : 'Broken', remark: `CCTV camera list ${r.group}`, role: areas[r.name.toUpperCase()] || '',
      // The camera's own settings (for OT Needs Attention): mask / gateway / DNS / web access, as read from the camera.
      extra: JSON.stringify({ mask: r.mask, gw: r.gw, dns: [r.dns1, r.dns2].filter(Boolean), http: r.http, https: r.https, fw: r.fw, read: 'camera list' }) };
    let fill = null;
    if (ex) { fill = {}; for (const [k, v] of Object.entries(fields)) if (v && !String(ex[k] || '').trim() && k !== 'status' && k !== 'remark') fill[k] = v;
      if (ex.extra !== fields.extra) fill.extra = fields.extra;   // settings / firmware: always the latest list
      if (fields.role && ex.role !== fields.role) fill.role = fields.role;   // area from the OT report
      if (r.fw && ex.os !== fields.os && /^FW /.test(ex.os || '')) fill.os = fields.os;
      if (ex.switch_port && g.sw && ex.switch_port !== g.sw.hostname && !String(ex.switch_port).startsWith(g.sw.hostname + ' ')) fill.switch_port = g.sw.hostname; }
    return { line: r.line, key: r.mac || r.name, name: r.name, group: r.group, model: r.model, ip: r.ip, mac: r.mac, serial: r.serial, fw: r.fw,
      switch: g.sw ? g.sw.hostname : '', server_id: ex ? ex.id : 0, action: ex ? (Object.keys(fill).length ? 'update' : 'same') : 'add', fields, fill };
  });
  // Cameras of the Server Inventory that are not in this list (removed / replaced?).
  const inList = new Set(rows.map(r => hex(r.mac)).filter(Boolean));
  const gone = ctx.servers.filter(s => /camera/i.test(s.category || '') && hex(s.mac).length === 12 && !inList.has(hex(s.mac)) && s.status !== 'Stock')
    .map(s => ({ id: s.id, hostname: s.hostname, ip: s.ip_address, mac: s.mac, status: s.status }));
  return { groups: out, cameras: cams, issues, gone,
    counts: { cameras: rows.length, add: cams.filter(c => c.action === 'add').length, update: cams.filter(c => c.action === 'update').length, same: cams.filter(c => c.action === 'same').length,
      noSwitch: cams.filter(c => !c.switch).length, switches: cctv.length } };
}

module.exports = { readRows, plan, groupOf };
