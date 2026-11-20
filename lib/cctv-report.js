/* OT CCTV report (e.g. Report_CCTV_2026_final_.xlsx): next to the camera export it has
     CAMERA LIST     camera → area ("K2-HALL 1 -WETWIPE-SAMPLE")
     SWITCH LIST     the real CCTV switches: host name, model, IP, MAC, S/N, status (per cabinet K1…K11, HK1…HK12)
     SERVER DETAIL   the recording servers (NVR): name, IP, channels, cameras, recording days, model
   The map's CCTV switches came from the rack labels ("SR-02/CCTV-ASW-03(9200)"); this report gives their real name, model and IP.
   The first switch of a cabinet is that map switch (updated: model, ports, IP, name as alias); more switches of a cabinet, the
   core / distribution ones and new switches are added. Passwords written in the remarks are removed and never stored. Pure. */

const t = (v, n = 160) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const hex = (s) => String(s || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
const macOf = (s) => { const h = hex(s); return h.length === 12 ? h.match(/../g).join(':') : ''; };
// "User:<name>/pass:<secret> Port17+18 trunk …" → "Port17+18 trunk …"
const noSecrets = (s) => t(s, 300).replace(/\b(user(name)?|login)\s*[:=]\s*\S+/gi, '').replace(/\b(pass(word)?|pwd)\s*[:=]\s*\S+/gi, '').replace(/^[\s/,;·-]+|[\s/,;·-]+$/g, '').replace(/\s{2,}/g, ' ');

/** Port layout of a switch model (port names as on the map). */
function portsOf(model) {
  const m = String(model || '').toUpperCase();
  const ge = (n, from = 1) => Array.from({ length: n }, (_, i) => `GE 1/0/${from + i}`);
  const te = (n, pre = 'T 1/1/') => Array.from({ length: n }, (_, i) => `${pre}${i + 1}`);
  if (/9200L?-48/.test(m) || /9300L?-48/.test(m)) return [...ge(48), ...te(4)];
  if (/9200L?-24/.test(m) || /9300L?-24/.test(m)) return [...ge(24), ...te(4)];
  if (/3560CX-12/.test(m)) return ge(14);
  if (/3560CX-8/.test(m)) return ge(10);
  if (/C1000-16|C1300-16/.test(m)) return ge(18);
  if (/C1000-24|C1300-24|CBS2[25]0-24/.test(m)) return ge(28);
  if (/C1000-8|C1300-8/.test(m)) return ge(10);
  if (/3850-24XS/.test(m)) return te(24, 'TE 1/0/');
  if (/3850-48/.test(m)) return [...ge(48), ...te(4)];
  return null;   // unknown model: keep the ports as they are
}
const roleOf = (host, model) => (/_CS$|CORE/i.test(host) || /9300/.test(model) ? 'Core switch' : /DIST|DSW|3850/i.test(host + ' ' + model) ? 'Distribution switch' : 'Access switch');

function headerRow(aoa, re) { return aoa.findIndex(r => r.some(c => re.test(String(c).trim()))); }

function readSwitches(aoa) {
  const hi = headerRow(aoa, /^host\s*name$/i); if (hi < 0) return [];
  const h = aoa[hi].map(c => String(c).trim().toLowerCase());
  const col = (re) => h.findIndex(x => re.test(x));
  const c = { loc: col(/^location/), host: col(/^host\s*name/), model: col(/^model/), ip: col(/ip/), mac: col(/^mac/), sn: col(/^s\/?n|serial/), st: col(/status/), rem: col(/^remark/) };
  let loc = '';
  const out = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    const host = t(r[c.host], 60);
    if (t(r[c.loc])) loc = t(r[c.loc], 40);
    if (!host || !/[A-Z0-9]/i.test(host)) return;
    out.push({ line: hi + i + 2, loc, hostname: host.toUpperCase(), model: t(r[c.model], 60).toUpperCase(), ip: (t(r[c.ip]).match(/\d+\.\d+\.\d+\.\d+/) || [''])[0],
      mac: macOf(r[c.mac]), serial: t(r[c.sn], 40), status: t(r[c.st], 60), remark: noSecrets(r[c.rem]), secret: /pass(word)?\s*[:=]/i.test(String(r[c.rem] || '')) });
  });
  return out;
}

function readServers(aoa) {
  const hi = headerRow(aoa, /^device\s*name$/i); if (hi < 0) return [];
  const h = aoa[hi].map(c => String(c).trim().toLowerCase());
  const col = (re) => h.findIndex(x => re.test(x));
  const c = { name: col(/^device\s*name/), ip: col(/^ip$/), ch: col(/key\s*ch|channel/), act: col(/^active/), spare: col(/^spare/), cams: col(/qty\s*cam|camera/), time: col(/time\s*record/), model: col(/^model/), st: col(/cam\s*status/), note: col(/^note/) };
  return aoa.slice(hi + 1).map((r, i) => ({ line: hi + i + 2, name: t(r[c.name], 60).toUpperCase(), ip: t(r[c.ip], 40), channels: t(r[c.ch], 10), active: t(r[c.act], 10), spare: t(r[c.spare], 10),
    cameras: t(r[c.cams], 10), record: t(r[c.time], 40), model: t(r[c.model], 60), camStatus: t(r[c.st], 120), note: t(r[c.note], 120) }))
    .filter(s => s.name && /\d+\.\d+\.\d+\.\d+/.test(s.ip));
}

/** CAMERA LIST: camera name → area (the location written once per group, e.g. "K2-HALL 1 -WETWIPE-SAMPLE" → "HALL 1 - WETWIPE - SAMPLE"). */
function readAreas(aoa) {
  const hi = headerRow(aoa, /^camera\s*name$/i); if (hi < 0) return {};
  const h = aoa[hi].map(c => String(c).trim().toLowerCase());
  const cl = h.findIndex(x => /^location/.test(x)), cn = h.findIndex(x => /^camera\s*name/.test(x));
  const out = {}; let area = '';
  for (const r of aoa.slice(hi + 1)) {
    if (cl >= 0 && t(r[cl])) area = t(r[cl], 120).replace(/^(HK|K)\d+\s*-\s*/i, '').replace(/\s*-\s*/g, ' - ').replace(/\s*->\s*/g, ' → ').trim();
    const n = t(r[cn], 40); if (n) out[n.toUpperCase()] = area;
  }
  return out;
}

/** Cabinet of a switch-list location: "K2" → { kind: 'CCTV', n: 2 }, "HK10-03" → HARICI 10, "K3-03 UPDATE" → CCTV 3, "CB36-BP05" → hall 2 (K3). */
function cabinetOf(sw) {
  const s = `${sw.loc} ${sw.hostname}`.toUpperCase();
  let m = s.match(/\bHK\s*0*(\d+)/); if (m) return { kind: 'HARICI', n: Number(m[1]) };
  m = s.match(/\bK\s*0*(\d+)(?!\d)/); if (m) return { kind: 'CCTV', n: Number(m[1]) };
  if (/CB36|BP05/.test(s)) return { kind: 'CCTV', n: 3 };   // production line CB36 / BP05 — Hall 2
  return null;
}

function plan(sheets, ctx) {
  const switches = readSwitches(sheets.switches || []), servers = readServers(sheets.servers || []), areas = readAreas(sheets.cameras || []);
  const devs = ctx.devices.filter(d => d.state !== 'retired');
  const cctvSw = devs.filter(d => /switch/i.test(d.role || '') && /CCTV/i.test(d.hostname));
  const byName = (h) => devs.find(d => d.hostname.toUpperCase() === h || String(d.alias || '').toUpperCase() === h);
  const loc = (d) => String(d.location || '').toUpperCase();
  const mapOfCab = (cab) => !cab ? null : cab.kind === 'HARICI' ? cctvSw.find(d => new RegExp(`HARICI\\s*-?KABIN\\s*0*${cab.n}\\b`).test(loc(d)))
    : cab.n === 11 ? cctvSw.find(d => /IT-?KABIN\s*0*11\b/.test(loc(d))) : cctvSw.find(d => new RegExp(`CCTV-?KABIN\\s*0*${cab.n}\\b`).test(loc(d)));
  const used = new Set(), out = [];
  for (const sw of switches) {
    let d = byName(sw.hostname), how = d ? 'same name on the map' : '';
    const k1 = sw.hostname.match(/^CCTV_(DIST_)?0*(\d+)$/);
    if (!d && k1) { d = devs.find(x => (k1[1] ? new RegExp(`CCTV-DSW-0*${k1[2]}$`) : new RegExp(`^MR-01\\/CCTV-ASW-0*${k1[2]}$`)).test(x.hostname)); if (d) how = k1[1] ? 'CCTV distribution switch' : 'office building (MR-01) CCTV switch'; }
    const cab = cabinetOf(sw);
    if (!d && /_0*1$/.test(sw.hostname) && cab) { d = mapOfCab(cab); if (d) how = `${cab.kind === 'HARICI' ? 'HARICI' : cab.n === 11 ? 'IT' : 'CCTV'} KABIN ${cab.n} — the cabinet's CCTV switch`; }
    if (d && used.has(d.id)) d = null;
    if (d) used.add(d.id);
    const want = portsOf(sw.model);
    const row = { line: sw.line, hostname: sw.hostname, model: sw.model, ip: sw.ip, mac: sw.mac, serial: sw.serial, status: sw.status, remark: sw.remark, secret: sw.secret, loc: sw.loc };
    if (d) {
      const mine = ctx.ports.filter(p => p.device_id === d.id), names = new Set(mine.map(p => p.port));
      const add = want ? want.filter(p => !names.has(p)) : [];
      const extra = want ? mine.filter(p => !want.includes(p.port)) : [];
      const used2 = (p) => !!(p.peer_host || p.peer_port || p.note || p.vlan || p.patch || p.mode || p.cable);
      const changes = [];
      if (sw.model && String(d.model || '').toUpperCase() !== sw.model) changes.push(`model ${d.model || '∅'} → ${sw.model}`);
      if (sw.ip && d.mgmt_ip !== sw.ip) changes.push(`IP ${d.mgmt_ip || '∅'} → ${sw.ip}`);
      if (String(d.alias || '').toUpperCase() !== sw.hostname && d.hostname.toUpperCase() !== sw.hostname) changes.push(`name ${sw.hostname}`);
      if (sw.mac && d.mac !== sw.mac) changes.push('MAC'); if (sw.serial && d.serial !== sw.serial) changes.push('serial');
      if (add.length || extra.some(p => !used2(p))) changes.push(`ports ${mine.length} → ${want.length}`);
      out.push({ ...row, action: changes.length ? 'update' : 'same', device_id: d.id, map: d.hostname, how, changes,
        add, remove: extra.filter(p => !used2(p)).map(p => p.id), keep: extra.filter(used2).length });
    } else {
      // A new switch of the map, in its cabinet (or the office building for K1).
      const cabDev = mapOfCab(cab);
      const location = cabDev ? String(cabDev.location || '').replace(/\s*\(U[\d-]+\)\s*$/, '') : cab && cab.n === 1 ? 'K1 office building' : sw.loc;
      out.push({ ...row, action: 'add', device_id: 0, map: '', how: cabDev ? `added in ${location} (next to ${cabDev.hostname})` : `added (${location || 'location unknown'})`,
        role: roleOf(sw.hostname, sw.model), location, ports: want || [] });
    }
  }
  const srv = servers.map(s => ({ ...s, hostname: s.name }));
  const issues = [];
  if (switches.some(s => s.secret)) issues.push({ kind: 'secret', text: `The SWITCH LIST remarks contain switch login passwords (${switches.filter(s => s.secret).length} lines) — they are left out and not stored. Keep passwords in a password manager, not in shared Excel files.` });
  const sameIp = new Map(); switches.forEach(s => { if (s.ip) sameIp.set(s.ip, [...(sameIp.get(s.ip) || []), s.hostname]); });
  for (const [ip, l] of sameIp) if (l.length > 1) issues.push({ kind: 'ip', text: `Switch IP ${ip} is on ${l.join(', ')}` });
  servers.filter(s => Number(s.spare) > 0 && Number(s.active) + Number(s.spare) > Number(s.channels)).forEach(s => issues.push({ kind: 'nvr', text: `${s.name}: active + spare channels exceed the licence (${s.channels})` }));
  servers.filter(s => s.camStatus).forEach(s => issues.push({ kind: 'nvr', text: `${s.name}: ${s.camStatus}${s.note ? ' · ' + s.note : ''}` }));
  return { switches: out, servers: srv, areas, issues };
}

module.exports = { readSwitches, readServers, readAreas, plan, portsOf, noSecrets };
