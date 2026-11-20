/* CCTV switches on the network map → their uplinks, so the CCTV network is one tree on the topology:
     CCTV_CS (core, MR-01)  ←  CCTV_DIST_01 / _02 (MR-02)  ←  first CCTV switch of each cabinet (K2_CCTV_01, HK4_CCTV_01 …)
     CCTV_01 / _02 (MR-01)  →  CCTV_CS
     more switches of a cabinet (K2_CCTV_02, HK10_CCTV_03, CB36-BP05 …)  →  that cabinet's first CCTV switch
   The OT report gives no port-to-port list, so each link is written on the lower switch's first free uplink port (the SFP
   ports: T 1/1/x, GE 13–14 of a 3560CX-12, GE 17–18 of a C1000 / C1300-16, GE 25–28 of a CBS220-24) with a note that the
   port on the other side is still to check. The cabinet's fibre route (Site drawing) is named in the note. Links already
   on the map are kept. Pure: plan(devices, ports, fibre) → rows. */

function rackOfLocation(loc) {
  const L = String(loc || '').toUpperCase();
  let m = L.match(/MAIN RACK\s*-?\s*0?(\d+)/); if (m) return `MR-0${m[1]}`;
  m = L.match(/CCTV\s*-?\s*KABIN\s*0*(\d+)/); if (m) return `CCTV-KABIN${Number(m[1])}`;
  m = L.match(/HARICI\s*-?\s*KABIN\s*0*(\d+)/); if (m) return `HARICI-KABIN${Number(m[1])}`;
  m = L.match(/IT\s*-?\s*KABIN\s*0*(\d+)/); if (m) return `IT-KABIN${Number(m[1])}`;
  if (/K1\b|OFFICE BUILDING/.test(L)) return 'MR-01';   // CCTV core of the office building, next to the MR-01 CCTV switches
  return '';
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const isCctv = (d) => /switch/i.test(d.role || '') && d.state !== 'retired' && /CCTV/i.test(`${d.hostname} ${d.alias || ''}`);
// Name in the OT report: the alias of a map switch (SR-02/CCTV-ASW-03 = K2_CCTV_01), else its host name.
const nameOf = (d) => (/^[A-Z0-9]+_CCTV_|^CCTV_/i.test(d.alias || '') ? d.alias : d.hostname);

/** Uplink (SFP) ports of a switch, best first. */
function uplinks(model, ports) {
  const m = String(model || '').toUpperCase(), names = ports.map(p => p.port), n = (k) => names.filter(x => new RegExp(`^GE 1/0/(${k})$`).test(x));
  let l = names.filter(x => /^T 1\/1\//.test(x));
  if (!l.length && /3560CX-12/.test(m)) l = n('13|14');
  if (!l.length && /3560CX-8/.test(m)) l = n('9|10');
  if (!l.length && /C1000-16|C1300-16/.test(m)) l = n('17|18');
  if (!l.length && /C1000-8|C1300-8/.test(m)) l = n('9|10');
  if (!l.length && /-24/.test(m) && /C1000|C1300|CBS2[25]0/.test(m)) l = n('25|26|27|28');
  if (!l.length && /3850-24XS/.test(m)) l = names.filter(x => /^TE 1\/0\//.test(x)).slice(-2).reverse();
  return l.sort(natural);
}

function plan(devices, ports, fibre = []) {
  const sw = devices.filter(isCctv), byHost = new Map(devices.map(d => [d.hostname, d]));
  const portsOf = (d) => ports.filter(p => p.device_id === d.id);
  const linked = (a, b) => ports.some(p => (p.device_id === a.id && p.peer_host === b.hostname) || (p.device_id === b.id && p.peer_host === a.hostname));
  const core = sw.filter(d => /core/i.test(d.role)).sort((a, b) => natural(nameOf(a), nameOf(b)))[0];
  const dist = sw.filter(d => /distribution/i.test(d.role)).sort((a, b) => natural(nameOf(a), nameOf(b)));
  const up = new Set([core, ...dist].filter(Boolean).map(d => d.id));
  // Already has an uplink to the core / a distribution switch (e.g. K2_CCTV_01 T 1/1/1 → CCTV-DSW-01).
  const hasUp = (d) => [core, ...dist].filter(Boolean).some(u => u.id !== d.id && linked(d, u));
  const rows = [];
  const add = (d, target, why, onTarget) => {
    if (!target || target.id === d.id) return;
    if (linked(d, target)) return;
    // Core ← distribution: the link is written on the core's free uplinks (the 3850-24XS ports are all SFP).
    const [dev, peer] = onTarget ? [target, d] : [d, target];
    const used = new Set(rows.filter(r => r.device_id === dev.id).map(r => r.port));
    const port = uplinks(dev.model, portsOf(dev)).map(x => portsOf(dev).find(p => p.port === x))
      .find(p => p && !p.peer_host && !p.note && !p.patch && !used.has(p.port));
    rows.push({ device_id: dev.id, hostname: dev.hostname, name: nameOf(dev), port: port ? port.port : '', port_id: port ? port.id : null,
      peer: peer.hostname, peer_name: nameOf(peer), why, error: port ? '' : `no free uplink port on ${dev.hostname}` });
  };
  for (const d of dist) if (core) add(d, core, 'distribution → core', true);
  const groups = new Map();
  for (const d of sw) {
    if (up.has(d.id)) continue;
    const cab = rackOfLocation(d.location);
    if (/^MR-/.test(cab) || !cab) { if (core && !hasUp(d)) add(d, core, cab ? `${cab}, next to the CCTV core` : 'no cabinet in its location'); continue; }
    if (!groups.has(cab)) groups.set(cab, []); groups.get(cab).push(d);
  }
  const dist1 = dist[0] || core;
  for (const [cab, list] of [...groups].sort((a, b) => natural(a[0], b[0]))) {
    // First switch of the cabinet: the one named _01, else the one from the rack labels (CCTV-ASW-nn), else the first by name.
    list.sort((a, b) => (/_01$/.test(nameOf(b)) - /_01$/.test(nameOf(a))) || (/CCTV-ASW/i.test(b.hostname) - /CCTV-ASW/i.test(a.hostname)) || natural(nameOf(a), nameOf(b)));
    const [first, ...more] = list;
    const route = fibre.find(l => String(l.b).toUpperCase() === cab) || fibre.find(l => String(l.a).toUpperCase() === cab);
    const via = route ? `fibre ${[route.name, route.cores].filter(Boolean).join(' ')} from ${String(route.b).toUpperCase() === cab ? route.a : route.b}` : 'no fibre route on the Site drawing';
    if (dist1 && !hasUp(first)) add(first, dist1, `first CCTV switch of ${cab} → CCTV distribution (${via})`);
    for (const d of more) add(d, first, `more CCTV switches of ${cab} → ${nameOf(first)}`);
  }
  return rows.map(r => ({ ...r, note: `Uplink to ${r.peer_name}${r.peer_name !== r.peer ? ' (' + r.peer + ')' : ''} — added from the OT CCTV report, check the port on ${r.peer_name}` }));
}

module.exports = { plan, uplinks, rackOfLocation, nameOf, isCctv };
