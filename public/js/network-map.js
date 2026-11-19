/* Network map — topology of a site, each device's front panel and every port's connection (routes/netmap.js).
   Layout idea from Cisco Modeling Labs / Packet Tracer: devices as Cisco-style icons in layers (ISP → firewall →
   core → distribution → access / servers), links coloured by medium; click a device for its front panel, click a port
   to see or change what it connects to, move / swap a cable to another port. Every change is logged (Port changes). */

const NM = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
  const $ = (id) => document.getElementById(id);
  let D = { site: '', sites: [], devices: [], ports: [], vlans: [], can: {} };
  let mode = 'map';   // map = layers (+ focus) · logical / physical / system = document-style views (netmap-views.js)
  let focus = true, depth = 1, fpos = new Map();   // focus: show only the selected device and what is cabled to it
  let byHost = new Map(), byId = new Map(), portsOf = new Map(), sel = null, view = { x: 0, y: 0, w: 1600, h: 900 }, q = '', portFilter = 'all';
  const CABLES = ['', 'CAT6', 'CAT5e', 'SFP+ SR', 'SFP+ LR', 'SFP LX', 'SFP SX', 'DAC', 'Fiber', 'Console', 'Other'];
  const ROLES = ['ISP / external', 'Firewall', 'Router', 'Core switch', 'Wireless controller', 'Distribution switch', 'Server switch', 'Access switch', 'HCI server', 'Backup storage', 'Server', 'Access point', 'Printer', 'Other'];
  const TIER = { 'ISP / external': 0, Firewall: 1, Router: 1, 'Core switch': 2, 'Wireless controller': 2, 'Distribution switch': 3, 'Server switch': 3, 'HCI server': 4, 'Backup storage': 4, Server: 4, 'Access switch': 5, 'Access point': 6, Printer: 6, Other: 6, 'Retired (not in use)': 9 };
  const RETIRED = 'Retired (not in use)';
  const live = (d) => d && d.state !== 'retired';   // retired: still in its rack, not in the topology
  // One colour per group (list, topology halo, racks) so a group is easy to pick out.
  const GCOL = { 'ISP / external': '#64748b', Firewall: '#dc2626', Router: '#0284c7', 'Core switch': '#1e3a8a', 'Wireless controller': '#7c3aed', 'Distribution switch': '#2563eb',
    'Server switch': '#0e7490', 'HCI server': '#0f766e', 'Backup storage': '#475569', Server: '#334155', 'Access switch': '#16a34a', 'Access point': '#d97706', Printer: '#db2777', Other: '#6b7280', 'Retired (not in use)': '#94a3b8' };
  const gcol = (r) => GCOL[r] || '#6b7280';
  const groupOf = (d) => (live(d) ? d.role || 'Other' : RETIRED);
  let grp = null;                                                     // group shown (clicked in the list)
  let orient = localStorage.getItem('nm-orient') === 'h' ? 'h' : 'v';  // layers top → bottom (v) or left → right (h)
  let hpos = new Map(), hfix = new Map();                             // horizontal layout (computed, not saved; hand moves kept for this visit)
  const TIER_NAME = ['ISP', 'Firewalls & routers', 'Core & wireless controllers', 'Distribution & server switches', 'Servers & storage', 'Access switches', 'Access points, printers & others'];
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const isFiber = (c) => /sfp|sr|lr|lx|sx|fib|dac/i.test(c || '');
  const known = (h) => byHost.has(h);
  // A network device — on the map, or (OT view) one OT does not see such as an AP or another switch.
  const isNet = (h) => byHost.has(h) || !!(h && D && D.net_hosts && D.net_hosts.includes(h));
  // OT editor: may change a port that is free or goes to an end device.
  const otPortOk = (p) => !!(D.can.port && !isNet(p.peer_host));

  // ── Data ──────────────────────────────────────────────────────────────────
  // OT view (Operation Technology): only the Kabin switches and what is cabled to them, read-only. The OT team always
  // gets it; the IT team can switch between the IT and OT views to check what OT sees.
  let otMode = localStorage.getItem('nm-view') === 'ot';
  async function load(site) {
    const qs = new URLSearchParams(); if (site != null) qs.set('site', site); if (otMode) qs.set('view', 'ot');
    D = await apiGet('/api/netmap' + (qs.toString() ? '?' + qs : ''));
    applyView();
    byHost = new Map(D.devices.map(d => [d.hostname, d])); byId = new Map(D.devices.map(d => [d.id, d]));
    portsOf = new Map(); for (const p of D.ports) { if (!portsOf.has(p.device_id)) portsOf.set(p.device_id, []); portsOf.get(p.device_id).push(p); }
    for (const l of portsOf.values()) l.sort((a, b) => natural(a.port, b.port));
    $('nm-site').innerHTML = (D.sites.length ? D.sites : [{ site: D.site || '', devices: 0 }]).map(s => `<option value="${esc(s.site)}"${s.site === D.site ? ' selected' : ''}>${esc(s.site || '(no site yet)')} · ${s.devices} devices</option>`).join('');
    $('nm-import').style.display = D.can.admin ? '' : 'none';
    $('nm-import-x').style.display = D.can.admin ? '' : 'none';
    $('nm-add').style.display = D.can.edit && D.site ? '' : 'none';
    $('nm-sub').textContent = D.devices.length ? `${D.view === 'ot' ? '· OT view ' : ''}· ${D.devices.length} devices · ${D.ports.length} ports · ${links().length} links` : '· ports & links';
    if (sel && !byId.has(sel)) sel = null;
    autoPlace(false); renderList(); renderTopo(); renderDevice();
    if (!D.devices.length) $('nm-svg').innerHTML = `<text x="800" y="420" text-anchor="middle" font-size="22" fill="#64748b">${D.can.admin ? 'No devices yet — ⬆ Import the implementation document (.docx) or + add devices' : 'No devices yet'}</text>`;
  }

  function applyView() {
    const ot = D.view === 'ot', team = D.team || {};
    document.querySelectorAll('.nm-tools .nm-tabs button[data-v="rack"]').forEach(b => { b.style.display = ot ? 'none' : ''; });
    if (ot && !$('nm-view-rack').hidden) tab('topo');
    [...$('nm-mode').options].forEach(o => { o.hidden = ot && (o.value === 'physical' || o.value === 'system'); });
    if (ot && (mode === 'physical' || mode === 'system')) { mode = 'map'; $('nm-mode').value = 'map'; }
    $('nm-ot').innerHTML = team.isIT ? `<span class="nm-tabs small" title="OT view = what the OT team sees: Kabin switches and what is connected to them"><button class="${ot ? '' : 'on'}" data-o="it">IT view</button><button class="${ot ? 'on' : ''}" data-o="ot">OT view</button></span>`
      : ot ? '<span class="nm-otbadge" title="Kabin switches (IT / CCTV Kabin) and the devices connected to them">OT view</span>' : '';
    $('nm-ot').querySelectorAll('button[data-o]').forEach(b => { b.onclick = () => { otMode = b.dataset.o === 'ot'; localStorage.setItem('nm-view', otMode ? 'ot' : 'it'); sel = null; load(D.site).then(fit); }; });
    document.body.classList.toggle('nm-is-ot', ot);
  }

  // Links between two devices of the site (each pair of ports once).
  function links() {
    const seen = new Set(), out = [];
    for (const p of D.ports) {
      if (!p.peer_host || !known(p.peer_host) || !live(byId.get(p.device_id)) || !live(byHost.get(p.peer_host))) continue;
      const a = byId.get(p.device_id).hostname, k = [a + '|' + p.port, p.peer_host + '|' + p.peer_port].sort().join('~');
      if (seen.has(k)) continue; seen.add(k);
      out.push({ a, ap: p.port, b: p.peer_host, bp: p.peer_port, cable: p.cable, grp: p.grp });
    }
    return out;
  }

  // ── Device list (left) ────────────────────────────────────────────────────
  function stats(d) {
    const ps = portsOf.get(d.id) || [];
    return { total: ps.length, dev: ps.filter(p => isNet(p.peer_host)).length, end: ps.filter(p => !isNet(p.peer_host) && (p.peer_host || p.patch || p.vlan || p.mode)).length };
  }
  function renderList() {
    const qq = q.toLowerCase();
    const match = (d) => !qq || `${d.hostname} ${d.alias} ${d.model} ${d.mgmt_ip} ${d.mac || ''} ${d.mac ? d.mac.replace(/:/g, '') : ''} ${d.serial} ${d.location} ${d.role}`.toLowerCase().includes(qq)
      || (portsOf.get(d.id) || []).some(p => `${p.port} ${p.peer_host} ${p.peer_port} ${p.patch} vlan${p.vlan}`.toLowerCase().includes(qq));
    const groups = new Map();
    for (const d of D.devices.filter(match)) { const r = groupOf(d); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(d); }
    $('nm-list').innerHTML = [...groups.entries()].sort((a, b) => (TIER[a[0]] ?? 9) - (TIER[b[0]] ?? 9)).map(([r, list]) => `
      <div class="nm-grp${grp === r ? ' on' : ''}" style="--gc:${gcol(r)}"><div class="nm-grp-h" onclick="NM.group(${jsArg(r)})" title="Show this group on the map (click again to show all)">${icon(r, 0, 0, 18, true)} ${esc(r)} <span>${grp === r ? '✕ ' : ''}${list.length}</span></div>
      ${list.sort((a, b) => natural(a.hostname, b.hostname)).map(d => { const s = stats(d); return `<div class="nm-item${sel === d.id ? ' on' : ''}" onclick="NM.select(${d.id}, true)">
        <b>${esc(d.hostname)}</b>${D.view === 'it' && d.ot_on ? ' <span class="nm-otb" title="Shown to the OT team">OT</span>' : ''}${d.ot_context ? ' <span class="nm-otb ctx" title="Uplink switch, shown so the Kabins connect on the map: only its ports to Kabin switches">uplink</span>' : ''}<div class="text-muted text-sm">${esc(d.alias || d.model || '')}</div>
        <div class="nm-mini">${s.dev ? `<i class="m-dev">${s.dev}</i>` : ''}${s.end ? `<i class="m-end">${s.end}</i>` : ''}<i class="m-tot">${s.total}</i></div></div>`; }).join('')}</div>`).join('')
      || '<p class="text-muted" style="padding:12px">No devices.</p>';
  }

  // ── Icons (Cisco-style) ───────────────────────────────────────────────────
  function icon(role, x, y, s = 44, inline = false) {
    const wrap = (inner) => (inline ? `<svg class="nm-ico" width="${s}" height="${s}" viewBox="-22 -22 44 44">${inner}</svg>` : `<g transform="translate(${x},${y}) scale(${s / 44})">${inner}</g>`);
    const arrows = '<path d="M-11 -4h9m0 0l-3-3m3 3l-3 3M11 4H2m0 0l3-3M2 4l3 3" stroke="#fff" stroke-width="2" fill="none"/>';
    switch (role) {
      case 'ISP / external': return wrap('<path d="M-16 8a8 8 0 0 1 2-15a10 10 0 0 1 18-3a8 8 0 0 1 12 9a6 6 0 0 1-2 9z" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5"/>');
      case 'Firewall': return wrap('<rect x="-18" y="-14" width="36" height="28" rx="3" fill="#b91c1c"/><path d="M-18 -5h36M-18 4h36M-6 -14v9M8 -14v9M0 -5v9M-12 4v10M12 4v10" stroke="#fecaca" stroke-width="1.5"/>');
      case 'Router': return wrap('<ellipse cx="0" cy="3" rx="19" ry="9" fill="#0b5ea8"/><ellipse cx="0" cy="-3" rx="19" ry="9" fill="#1a73c9" stroke="#0b5ea8"/><path d="M-9 -6l5 3m13 0l-5-3M-9 0l5-3M9 0l-5-3" stroke="#fff" stroke-width="2"/>');
      case 'Core switch': case 'Distribution switch': return wrap(`<rect x="-19" y="-13" width="38" height="26" rx="3" fill="${role === 'Core switch' ? '#1e3a8a' : '#1d4ed8'}"/>${arrows}<circle cx="0" cy="0" r="4" fill="none" stroke="#93c5fd" stroke-width="1.5"/>`);
      case 'Server switch': case 'Access switch': return wrap(`<rect x="-19" y="-11" width="38" height="22" rx="3" fill="${role === 'Server switch' ? '#0e7490' : '#2563eb'}"/>${arrows}`);
      case 'Wireless controller': return wrap('<rect x="-19" y="-12" width="38" height="24" rx="3" fill="#7c3aed"/><path d="M-8 2a11 11 0 0 1 16 0M-4 6a5 5 0 0 1 8 0" stroke="#fff" stroke-width="2" fill="none"/><circle cx="0" cy="9" r="1.6" fill="#fff"/>');
      case 'HCI server': case 'Server': return wrap(`<rect x="-12" y="-17" width="24" height="34" rx="3" fill="${role === 'HCI server' ? '#0f766e' : '#334155'}"/><path d="M-7 -10h14M-7 -4h14M-7 2h14" stroke="#e2e8f0" stroke-width="2"/><circle cx="5" cy="10" r="2" fill="#4ade80"/>`);
      case 'Backup storage': return wrap('<ellipse cx="0" cy="-11" rx="15" ry="5" fill="#64748b"/><path d="M-15 -11v22a15 5 0 0 0 30 0v-22" fill="#475569"/><ellipse cx="0" cy="-11" rx="15" ry="5" fill="#94a3b8"/><path d="M-15 0a15 5 0 0 0 30 0" stroke="#cbd5e1" fill="none"/>');
      case 'Access point': return wrap('<circle r="13" fill="#f8fafc" stroke="#64748b" stroke-width="2"/><circle r="3" fill="#22c55e"/>');
      case 'Printer': return wrap('<rect x="-15" y="-6" width="30" height="16" rx="3" fill="#475569"/><rect x="-9" y="-15" width="18" height="10" fill="#e2e8f0" stroke="#64748b"/><rect x="-9" y="6" width="18" height="9" fill="#fff" stroke="#64748b"/>');
      case RETIRED: return wrap('<rect x="-16" y="-12" width="32" height="24" rx="4" fill="#cbd5e1"/><path d="M-9 -7l18 14M9 -7l-18 14" stroke="#64748b" stroke-width="2.5"/>');
      default: return wrap('<rect x="-16" y="-12" width="32" height="24" rx="4" fill="#64748b"/>');
    }
  }

  // ── Topology (centre) ─────────────────────────────────────────────────────
  function autoPlace(force) {
    const tiers = new Map();
    for (const d of D.devices.filter(live)) { const t = TIER[d.role] ?? 6; if (!tiers.has(t)) tiers.set(t, []); tiers.get(t).push(d); }
    // Layers top → bottom; at most 8 devices per row (big layers wrap), 150 px apart.
    const PER = 8, GAP = 150, W = PER * GAP;
    let y = 60;
    for (const t of [...tiers.keys()].sort((a, b) => a - b)) {
      const list = tiers.get(t).sort((a, b) => natural(a.hostname, b.hostname));
      const rows = Math.ceil(list.length / PER);
      list.forEach((d, i) => { if (force || d.x == null || d.y == null) { const r = Math.floor(i / PER), c = i % PER, n = Math.min(PER, list.length - r * PER);
        d.x = W / 2 + (c - (n - 1) / 2) * GAP; d.y = y + r * 110; d._auto = true; } });
      y += rows * 110 + 40;
    }
  }
  // Horizontal: the same layers as columns, left → right; big layers wrap into more columns. Inside a column the devices
  // follow the order of what they are cabled to in the column before (fewer crossing lines).
  function autoPlaceH() {
    hpos = new Map();
    const tiers = new Map();
    for (const d of D.devices.filter(live)) { const t = TIER[d.role] ?? 6; if (!tiers.has(t)) tiers.set(t, []); tiers.get(t).push(d); }
    // Rows per column chosen so the whole drawing has the shape of the canvas (wide screen → fewer rows, more columns).
    const svgEl = $('nm-svg'), aspect = (svgEl.clientWidth || 1100) / (svgEl.clientHeight || 640);
    const size = (h) => { let w = 0; for (const l of tiers.values()) w += (Math.ceil(l.length / h) - 1) * 150 + 215; return { w, h: (h - 1) * 74 + 120 }; };
    let H = 6, best = 1e9; for (let h = 4; h <= 40; h++) { const z = size(h), err = Math.abs(Math.log((z.w / z.h) / aspect)); if (err < best - 1e-9) { best = err; H = h; } }
    const adj = new Map(); for (const l of links()) { (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push(l.b); (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push(l.a); }
    const GX = 175, GY = 74; let x = 80; const bands = [];
    for (const t of [...tiers.keys()].sort((a, b) => a - b)) {
      const list = tiers.get(t);
      const key = (d) => { const ys = (adj.get(d.hostname) || []).map(h => hpos.get((byHost.get(h) || {}).id)).filter(Boolean).map(p => p.y); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e9; };
      list.sort((a, b) => key(a) - key(b) || (TIER[a.role] ?? 6) - (TIER[b.role] ?? 6) || natural(a.hostname, b.hostname));
      const cols = Math.ceil(list.length / H), per = Math.ceil(list.length / cols);
      list.forEach((d, i) => { const c = Math.floor(i / per), r = i % per, n = Math.min(per, list.length - c * per); hpos.set(d.id, { x: x + c * 150, y: 60 + (r - (n - 1) / 2) * GY + (H - 1) * GY / 2 }); });
      bands.push({ t, x0: x - 75, x1: x + (cols - 1) * 150 + 75 });
      x += (cols - 1) * 150 + GX + 40;
    }
    for (const [id, P] of hfix) if (hpos.has(id)) hpos.set(id, P);   // moved by hand in this visit
    hpos.bands = bands; hpos.h = (H - 1) * GY + 120;
  }
  // Focus: the selected device in the middle, devices one layer up ("in front", towards ISP / core) above,
  // one layer down ("behind", towards access / servers) below, same layer left and right. depth 2 = their neighbours too.
  const focusOn = () => mode === 'map' && focus && sel && byId.has(sel);
  function neighbours() {
    const adj = new Map();
    for (const l of links()) { (adj.get(l.a) || adj.set(l.a, new Set()).get(l.a)).add(l.b); (adj.get(l.b) || adj.set(l.b, new Set()).get(l.b)).add(l.a); }
    const start = byId.get(sel).hostname, dist = new Map([[start, 0]]);
    let frontier = [start];
    for (let k = 1; k <= depth; k++) { const next = []; for (const h of frontier) for (const n of adj.get(h) || []) if (!dist.has(n)) { dist.set(n, k); next.push(n); } frontier = next; }
    return dist;
  }
  function focusLayout() {
    if (keepPos) { fpos = keepPos; return neighbours(); }
    fpos = new Map();
    const dist = neighbours(), me = byId.get(sel), t0 = TIER[me.role] ?? 6;
    fpos.set(me.id, { x: 0, y: 0 });
    const rows = new Map();   // "k:side" → devices; side -1 above, 0 same layer, 1 below
    for (const [h, k] of dist) { if (!k) continue; const d = byHost.get(h), t = TIER[d.role] ?? 6, side = t < t0 ? -1 : t > t0 ? 1 : 0;
      const key = `${k}:${side}`; if (!rows.has(key)) rows.set(key, []); rows.get(key).push(d); }
    for (const [key, list] of rows) {
      const [k, side] = key.split(':').map(Number);
      list.sort((a, b) => (TIER[a.role] ?? 6) - (TIER[b.role] ?? 6) || natural(a.hostname, b.hostname));
      // Same layer: two columns, left and right, stacked so no line passes behind another device.
      if (side === 0) { const left = list.filter((_, i) => i % 2), right = list.filter((_, i) => !(i % 2));
        for (const [col, sign] of [[right, 1], [left, -1]]) col.forEach((d, j) => fpos.set(d.id, { x: sign * 230 * k, y: (j - (col.length - 1) / 2) * 95 })); }
      else { const per = 9, GAP = 165; list.forEach((d, i) => { const r = Math.floor(i / per), c = i % per, n = Math.min(per, list.length - r * per);
        fpos.set(d.id, { x: (c - (n - 1) / 2) * GAP, y: side * (175 * k + r * 105), side }); }); }
    }
    // Horizontal: in front on the left, behind on the right.
    if (orient === 'h') for (const [id, p] of fpos) fpos.set(id, { x: p.y * 1.45, y: p.x * 0.52, side: p.side });
    return dist;
  }
  let keepPos = null, hdrag = false;
  function renderTopoKeep(keep) { keepPos = keep; renderTopo(); keepPos = null; }
  const pos = (d) => (focusOn() ? fpos.get(d.id) : orient === 'h' ? hpos.get(d.id) || d : d);
  function fit() {
    if (mode !== 'map' && lastBounds) { view = { ...lastBounds }; return apply(); }
    if (focusOn()) {
      const ps = [...fpos.values()], xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      const x0 = Math.min(...xs) - 130, x1 = Math.max(...xs) + 130, y0 = Math.min(...ys) - 80, y1 = Math.max(...ys) + 90;
      const w = Math.max(x1 - x0, orient === 'h' ? 1100 : 900), h = Math.max(y1 - y0, 480);
      view = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }; return apply();
    }
    if (!D.devices.length) { view = { x: 0, y: 0, w: 1600, h: 900 }; return apply(); }
    const vis = D.devices.filter(live), xs = vis.map(d => pos(d).x), ys = vis.map(d => pos(d).y);
    if (!vis.length) { view = { x: 0, y: 0, w: 1600, h: 900 }; return apply(); }
    const x0 = Math.min(...xs) - 90, x1 = Math.max(...xs) + 90, y0 = orient === 'h' ? Math.min(-6, Math.min(...ys) - 70) : Math.min(...ys) - 70, y1 = Math.max(...ys) + 80;
    view = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; apply();
  }
  const apply = () => $('nm-svg').setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  let lastBounds = null;
  function renderTopo(fitIt) {
    if (mode !== 'map' && self.NMViews) {
      NMViews.svg(mode).then(r => { $('nm-svg').innerHTML = r.svg; lastBounds = r.bounds; if (fitIt) { view = { ...r.bounds }; apply(); } markGroup();
        const fb = $('nm-focus'); if (fb) fb.innerHTML = grp ? `<span class="nm-gchip" style="--gc:${gcol(grp)}">${esc(grp)} <a href="#" onclick="NM.group(null);return false">✕</a></span>` : ''; });
      return;
    }
    if (orient === 'h' && !keepPos && !hdrag) autoPlaceH();
    const F = focusOn(), dist = F ? focusLayout() : null;
    const showing = (h) => !F || dist.has(h);
    const inG = (h) => !grp || groupOf(byHost.get(h)) === grp;
    // Focus: only the links that lead out from the selected device (step 1 → step 2), not between neighbours.
    const L = links().filter(l => showing(l.a) && showing(l.b) && (!F || Math.abs(dist.get(l.a) - dist.get(l.b)) === 1));
    const pairs = new Map();
    for (const l of L) { const k = [l.a, l.b].sort().join('~'); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(l); }
    const hl = sel ? byId.get(sel).hostname : null;
    let g = '';
    for (const [k, ls] of pairs) {
      const [a, b] = k.split('~'), A = pos(byHost.get(a)), B = pos(byHost.get(b));
      const fib = ls.some(l => isFiber(l.cable)), pc = ls.some(l => l.grp), on = hl && (a === hl || b === hl);
      g += `<g class="nm-link${on ? ' on' : ''}${grp && !inG(a) && !inG(b) ? ' dim' : ''}" data-k="${esc(k)}"><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="hit"/>
        <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${fib ? '#f59e0b' : '#3b82f6'}" stroke-width="${pc || ls.length > 1 ? 4 : 2}" ${pc ? 'stroke-dasharray="10 4"' : ''}/>
        ${ls.length > 1 ? `<text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 - 4}" class="nm-lcnt">×${ls.length}</text>` : ''}</g>`;
    }
    for (const d of D.devices.filter(d => showing(d.hostname) && (live(d) || d.id === sel))) {
      const s = stats(d), P = pos(d);
      g += `<g class="nm-node${sel === d.id ? ' on' : ''}${F && dist.get(d.hostname) === 2 ? ' far' : ''}${grp ? (inG(d.hostname) ? ' ing' : ' dim') : ''}" data-id="${d.id}" transform="translate(${P.x},${P.y})" style="--gc:${gcol(groupOf(d))}">
        <circle r="30" class="nm-halo"/><circle r="27" class="nm-gring"/>${icon(d.role, 0, 0, 46)}
        <text y="38" class="nm-host">${esc(d.hostname)}</text>
        ${d.alias ? `<text y="51" class="nm-alias">${esc(d.alias.length > 24 ? d.alias.slice(0, 23) + '…' : d.alias)}</text>` : ''}
        ${s.end ? `<g transform="translate(20,-22)"><rect x="-1" y="-9" width="${String(s.end).length * 7 + 8}" height="14" rx="7" fill="#0891b2"/><text x="3" y="2" class="nm-badge">${s.end}</text></g>` : ''}</g>`;
    }
    if (F && orient === 'h') {
      const xs = [...fpos.values()].filter(p => p.side).map(p => p.x).concat([0]), y0 = Math.min(...[...fpos.values()].map(p => p.y)) - 60;
      if (Math.min(...xs) < 0) g = `<text x="${Math.min(...xs)}" y="${y0}" class="nm-zone">◀ in front (towards firewall / core)</text>` + g;
      if (Math.max(...xs) > 0) g = `<text x="${Math.max(...xs)}" y="${y0}" class="nm-zone">behind (towards access / servers) ▶</text>` + g;
    } else if (F) {   // labels: in front / behind
      const ys = [...fpos.values()].filter(p => p.side).map(p => p.y).concat([0]);
      if (Math.min(...ys) < 0) g = `<text x="0" y="${Math.min(...ys) - 48}" class="nm-zone">▲ in front (towards firewall / core)</text>` + g;
      if (Math.max(...ys) > 0) g = `<text x="0" y="${Math.max(...ys) + 72}" class="nm-zone">▼ behind (towards access / servers)</text>` + g;
    } else if (orient === 'h' && hpos.bands) {   // column headings
      g = hpos.bands.map(b => `<rect x="${b.x0}" y="0" width="${b.x1 - b.x0}" height="${hpos.h}" rx="10" class="nm-band"/><text x="${(b.x0 + b.x1) / 2}" y="18" class="nm-band-t">${esc(TIER_NAME[b.t] || '')}</text>`).join('') + g;
    }
    $('nm-svg').innerHTML = g;
    const fb = $('nm-focus');
    if (fb) fb.innerHTML = F ? `<b>${esc(byId.get(sel).hostname)}</b> + ${dist.size - 1} cabled device${dist.size === 2 ? '' : 's'}
        <span class="nm-tabs small"><button class="${depth === 1 ? 'on' : ''}" onclick="NM.depth(1)">1 step</button><button class="${depth === 2 ? 'on' : ''}" onclick="NM.depth(2)">2 steps</button></span>
        <button class="btn btn-ghost btn-sm" onclick="NM.showAll()">Show all</button>`
      : sel ? `<button class="btn btn-ghost btn-sm" onclick="NM.focusMode()">◎ Only ${esc(byId.get(sel).hostname)} and its links</button>` : '';
    if (fb && grp) fb.innerHTML += ` <span class="nm-gchip" style="--gc:${gcol(grp)}">${esc(grp)} · ${D.devices.filter(d => groupOf(d) === grp).length} <a href="#" onclick="NM.group(null);return false" title="Show all groups">✕</a></span>`;
  }
  // Group shown (list header click): its devices coloured, the others faded — on the map, the views and the racks.
  function setGroup(r) {
    grp = r && grp !== r ? r : null; focus = grp ? false : focus;
    renderList(); renderTopo(); if (grp) fit();
    if (typeof NMRacks !== 'undefined' && !$('nm-view-rack').hidden) NMRacks.mark();
  }
  // Views (logical / physical / system) are drawn elsewhere: fade the others after drawing.
  function markGroup() {
    if (!grp) return;
    document.querySelectorAll('#nm-svg .nm-node').forEach(n => { const d = byId.get(Number(n.dataset.id)); if (!d) return; n.classList.toggle('dim', groupOf(d) !== grp); n.classList.toggle('ing', groupOf(d) === grp); n.style.setProperty('--gc', gcol(groupOf(d))); });
    document.querySelectorAll('#nm-svg .nm-link').forEach(l => { const [a, b] = (l.dataset.k || '').split('~'); l.classList.toggle('dim', ![a, b].some(h => byHost.get(h) && groupOf(byHost.get(h)) === grp)); });
  }

  // Pan / zoom / drag
  function svgPoint(ev) { const r = $('nm-svg').getBoundingClientRect(); return { x: view.x + (ev.clientX - r.left) / r.width * view.w, y: view.y + (ev.clientY - r.top) / r.height * view.h }; }
  function bindCanvas() {
    const svg = $('nm-svg');
    let drag = null;
    svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = svgPoint(e), f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      view = { x: p.x - (p.x - view.x) * f, y: p.y - (p.y - view.y) * f, w: view.w * f, h: view.h * f }; apply(); }, { passive: false });
    svg.addEventListener('pointerdown', (e) => {
      const node = e.target.closest('.nm-node'), p = svgPoint(e);
      if (node && mode !== 'map') { drag = { kind: 'click', id: Number(node.dataset.id) }; svg.setPointerCapture(e.pointerId); return; }
      if (node) { const d = byId.get(Number(node.dataset.id)), P = pos(d); drag = { kind: 'node', d, P, dx: p.x - P.x, dy: p.y - P.y, moved: false }; }
      else drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, v: { ...view }, moved: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return hover(e);
      if (drag.kind === 'click') return;
      if (drag.kind === 'node') { const p = svgPoint(e); drag.P.x = Math.round(p.x - drag.dx); drag.P.y = Math.round(p.y - drag.dy); drag.moved = true;
        if (focusOn()) { const keep = new Map(fpos); renderTopoKeep(keep); } else { hdrag = true; renderTopo(); hdrag = false; } }
      else { const r = svg.getBoundingClientRect(); view.x = drag.v.x - (e.clientX - drag.sx) / r.width * view.w; view.y = drag.v.y - (e.clientY - drag.sy) / r.height * view.h; drag.moved = Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3; apply(); }
    });
    svg.addEventListener('pointerup', async (e) => {
      const d = drag; drag = null; if (!d) return;
      if (d.kind === 'click') { select(d.id); return; }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (!d.moved && under && under.closest('.nm-edge')) { NMViews.edge(true); return; }
      if (d.kind === 'node') {
        if (d.moved) { if (orient === 'h') { const P = hpos.get(d.d.id); if (P) hfix.set(d.d.id, { x: P.x, y: P.y }); } else if (D.can.edit && !focusOn()) { try { await apiPut('/api/netmap/device/' + d.d.id, { x: d.d.x, y: d.d.y }); } catch {} } }
        else select(d.d.id);
      } else if (!d.moved) {
        const l = (under && under.closest('.nm-link')) || e.target.closest('.nm-link');
        if (l) { const [a] = l.dataset.k.split('~'); select(byHost.get(a).id, false, l.dataset.k); }
      }
    });
    svg.addEventListener('pointerleave', () => { $('nm-tip').hidden = true; });
  }
  function hover(e) {
    const tip = $('nm-tip'), l = e.target.closest('.nm-link'), n = e.target.closest('.nm-node');
    if (!l && !n) { tip.hidden = true; return; }
    let html = '';
    if (l) { const [a, b] = l.dataset.k.split('~'); html = `<b>${esc(a)} ⇄ ${esc(b)}</b>` + links().filter(x => [x.a, x.b].sort().join('~') === l.dataset.k).map(x => `<div>${esc(x.a === a ? x.ap : x.bp)} ⇄ ${esc(x.a === a ? x.bp : x.ap)} · ${esc(x.cable || '?')}${x.grp ? ' · Po' + esc(x.grp) : ''}</div>`).join(''); }
    else { const d = byId.get(Number(n.dataset.id)), s = stats(d); html = `<b>${esc(d.hostname)}</b><div>${esc(d.model)}</div><div>${esc(d.mgmt_ip)} · ${esc(d.location)}</div>${d.mac ? `<div>MAC ${esc(d.mac)}</div>` : ''}<div>${s.dev} to devices · ${s.end} to users / patch · ${s.total - s.dev - s.end} free</div>`; }
    const r = $('nm-view-topo').getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 260) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px';
  }

  // ── Device panel (front panel + ports) ────────────────────────────────────
  function select(id, center, linkKey) {
    const prev = sel; sel = id; renderList(); renderTopo(); renderDevice(linkKey);
    if (focusOn()) { if (prev !== id) fit(); }
    else if (center && mode === 'map') { const P = pos(byId.get(id)); view.x = P.x - view.w / 2; view.y = P.y - view.h / 2; apply(); }
    if (typeof NMRacks !== 'undefined' && !$('nm-view-rack').hidden) NMRacks.mark(true);
    // The page does not scroll: the topology stays where it is (the device panel is below it).
  }
  const portClass = (p) => (isNet(p.peer_host) ? 'pt-dev' : (p.peer_host || p.patch || p.vlan || p.mode) ? 'pt-end' : 'pt-free');
  const portTip = (p) => `${p.port}${known(p.peer_host) ? ` → ${p.peer_host} ${p.peer_port}` : p.peer_host ? ` → ${p.peer_host} ${p.peer_port}` : ''}${p.patch ? ` · patch ${p.patch}` : ''}${p.cable ? ' · ' + p.cable : ''}${p.mode ? ' · ' + p.mode : ''}${p.vlan ? ' · VLAN ' + p.vlan : ''}${p.grp ? ' · Po' + p.grp : ''}${p.note ? ' · ' + p.note : ''}` || 'free';
  function faceplate(d, hlPorts) {
    const ps = portsOf.get(d.id) || [];
    const groups = new Map();
    for (const p of ps) { const m = String(p.port).match(/^(.*?)(\d+)$/); const k = m && !/^(CARD|PORT ?\d|INTERG)/i.test(p.port) ? m[1] : '•'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    const btn = (p) => `<button class="pt ${portClass(p)}${hlPorts.has(p.port) ? ' hl' : ''}" title="${esc(portTip(p))}" onclick="NM.openPort(${d.id}, ${jsArg(p.port)})">${esc((String(p.port).match(/(\d+)$/) || [, p.port])[1])}</button>`;
    return [...groups.entries()].sort((a, b) => (a[0] === '•') - (b[0] === '•') || b[1].length - a[1].length).map(([k, list]) => {
      if (k === '•' || list.length < 6) return `<div class="fp-row"><span class="fp-lbl">${esc(k === '•' ? 'Other' : k.trim())}</span><div class="fp-chips">${list.map(p => `<button class="pt pt-chip ${portClass(p)}${hlPorts.has(p.port) ? ' hl' : ''}" title="${esc(portTip(p))}" onclick="NM.openPort(${d.id}, ${jsArg(p.port)})">${esc(p.port)}</button>`).join('')}</div></div>`;
      const top = list.filter((_, i) => i % 2 === 0), bot = list.filter((_, i) => i % 2 === 1);
      return `<div class="fp-row"><span class="fp-lbl">${esc(k.trim())}</span><div class="fp-grid"><div>${top.map(btn).join('')}</div><div>${bot.map(btn).join('')}</div></div></div>`;
    }).join('');
  }
  const ipList = (d) => { let l = []; try { l = JSON.parse(d.ips || '[]'); } catch {} return l.length || d.services ? `<div class="nm-ips">${l.map(x => `<span><i>${esc(x.name)}</i> ${esc(x.ip)}</span>`).join('')}${d.services ? `<span><i>services</i> ${esc(d.services)}</span>` : ''}</div>` : ''; };
  function renderDevice(linkKey) {
    const box = $('nm-dev');
    if (!sel) { box.innerHTML = '<div class="empty-state" style="padding:22px">Click a device (in the list or on the map) to see its front panel and ports.</div>'; return; }
    const d = byId.get(sel), ps = portsOf.get(d.id) || [], s = stats(d);
    const hl = new Set();
    if (linkKey) for (const l of links()) if ([l.a, l.b].sort().join('~') === linkKey) hl.add(l.a === d.hostname ? l.ap : l.bp);
    const shown = ps.filter(p => (portFilter === 'all' || (portFilter === 'dev' && isNet(p.peer_host)) || (portFilter === 'end' && portClass(p) === 'pt-end') || (portFilter === 'free' && portClass(p) === 'pt-free')));
    box.innerHTML = `<div class="nm-dh">${icon(d.role, 0, 0, 40, true)}
        <div><div class="nm-dt">${esc(d.hostname)} ${DeviceSpecs.btn(d.model, d.role)}${live(d) ? '' : ' <span class="nm-retired">Retired — not in use</span>'}</div>
          <div class="text-muted text-sm">${esc([d.alias, d.role, d.model].filter(Boolean).join(' · '))}</div>
          <div class="text-sm">${d.mgmt_ip ? `IP <b>${esc(d.mgmt_ip)}</b> · ` : ''}${d.mac ? `MAC <b>${esc(d.mac)}</b> · ` : ''}${esc(d.location || '')}${d.serial ? ` · S/N ${esc(d.serial)}` : ''}${d.service_tag && d.service_tag !== d.serial ? ` · tag ${esc(d.service_tag)}` : ''}</div>
          ${ipList(d)}${D.view === 'ot' ? (d.ot_context ? '<div class="text-sm text-muted">Uplink switch — only its ports to the Kabin switches are shown.</div>' : '')
            : `<div class="text-sm"><a href="#" onclick="NM.showInRack();return false">🗄 Show where it is in the racks</a>${d.ot_on ? ' · <span class="nm-otb" title="The OT team sees this switch and everything connected to it">visible to OT</span>' : ''}</div>${d.server_id ? `<div class="text-sm"><a href="/server-inventory.html?view=${d.server_id}">📦 Server Inventory record #${d.server_id}</a></div>` : ''}`}</div>
        <span style="flex:1"></span>
        ${D.can.edit ? `<button class="btn btn-ghost btn-sm" onclick="NM.editDevice(${d.id})">✏️ Device</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="NM.showLog(${jsArg(d.hostname)})">🕓 Changes</button></div>
      <div class="nm-stats"><span class="st-dev">${s.dev} to network devices</span><span class="st-end">${s.end} to users / patch panel</span><span class="st-free">${s.total - s.dev - s.end} free</span><span>${s.total} ports</span></div>
      ${(self.NMFaces && ps.length && NMFaces.render(d, ps, hl)) || `<div class="fp">${ps.length ? faceplate(d, hl) : '<span class="text-muted">No ports yet.</span>'}</div>`}
      <div class="nm-pt-bar"><span class="nm-tabs small">${[['all', 'All'], ['dev', 'To devices'], ['end', 'Users / patch'], ['free', 'Free']].map(([k, l]) => `<button class="${portFilter === k ? 'on' : ''}" onclick="NM.filter('${k}')">${l}</button>`).join('')}</span>
        ${D.can.edit ? `<button class="btn btn-ghost btn-sm" onclick="NM.addPort(${d.id})">+ Port</button>` : ''}</div>
      <div class="table-wrap nm-ptbl"><table><thead><tr><th>Port</th><th>Connected to</th><th>Far port</th><th>Cable</th><th>Mode</th><th>VLAN</th><th>Po</th><th>Patch</th><th>Note</th></tr></thead><tbody>
        ${shown.map(p => `<tr class="${hl.has(p.port) ? 'hl' : ''}" onclick="NM.openPort(${d.id}, ${jsArg(p.port)})"><td><span class="dot ${portClass(p)}"></span><b>${esc(p.port)}</b></td>
          <td>${known(p.peer_host) ? `<a href="#" onclick="event.stopPropagation();NM.select(${byHost.get(p.peer_host).id}, true);return false">${esc(p.peer_host)}</a>` : esc(p.peer_host)}</td><td>${esc(p.peer_port)}</td>
          <td>${esc(p.cable)}</td><td>${esc(p.mode)}</td><td>${esc(p.vlan)}</td><td>${esc(p.grp)}</td><td>${p.patch && /^[DT]\d+$/i.test(p.patch) ? `<a href="#" onclick="event.stopPropagation();NM.outlet(${jsArg(p.patch)});return false">${esc(p.patch)}</a>` : esc(p.patch)}</td><td class="text-sm">${esc(p.note)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">No ports here.</td></tr>'}
      </tbody></table></div>`;
  }

  // ── Port editor ───────────────────────────────────────────────────────────
  let cur = null;
  function openPort(devId, port) {
    const d = byId.get(devId), p = (portsOf.get(devId) || []).find(x => x.port === port) || { port, peer_host: '', peer_port: '', cable: '', mode: '', vlan: '', grp: '', patch: '', note: '' };
    cur = { d, p };
    const ot = !D.can.edit && otPortOk(p) && !d.ot_context, canSave = D.can.edit || ot;
    const ro = !canSave ? 'disabled' : '';
    $('nm-port-t').textContent = `${d.hostname} · ${port}`;
    const hosts = ot ? [] : D.devices.filter(x => x.id !== d.id).map(x => x.hostname).sort(natural);
    $('nm-port-b').innerHTML = `<div class="nm-pnow"><span class="dot ${portClass(p)}"></span> ${esc(portTip(p))}</div>
      <div class="qe-grid">
        <div class="form-group"><label class="form-label">Connected to (device)</label><input class="form-control" id="pp-host" list="pp-hosts" value="${esc(p.peer_host)}" ${ro} placeholder="network device, or PC / printer / AP name"><datalist id="pp-hosts">${hosts.map(h => `<option value="${esc(h)}">`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">Its port</label><input class="form-control" id="pp-port" list="pp-ports" value="${esc(p.peer_port)}" ${ro}><datalist id="pp-ports"></datalist></div>
        <div class="form-group"><label class="form-label">Cable</label><select class="form-control" id="pp-cable" ${ro}>${CABLES.concat(CABLES.includes(p.cable) ? [] : [p.cable]).map(c => `<option${c === p.cable ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Switchport mode</label><select class="form-control" id="pp-mode" ${ro}>${['', 'ACCESS', 'TRUNK'].concat(['', 'ACCESS', 'TRUNK'].includes(p.mode) ? [] : [p.mode]).map(c => `<option${c === p.mode ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">VLAN</label><input class="form-control" id="pp-vlan" list="pp-vlans" value="${esc(p.vlan)}" ${ro}><datalist id="pp-vlans">${D.vlans.map(v => `<option value="${esc(v.vlan)}">${esc(v.name)}</option>`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">Port-channel / group</label><input class="form-control" id="pp-grp" value="${esc(p.grp)}" ${ot ? 'disabled' : ro}></div>
        <div class="form-group"><label class="form-label">Patch panel port</label><input class="form-control" id="pp-patch" value="${esc(p.patch)}" ${ro} placeholder="e.g. D01"></div>
        <div class="form-group"><label class="form-label">Note</label><input class="form-control" id="pp-note" value="${esc(p.note)}" ${ro}></div>
      </div>
      <div id="pp-warn" class="text-sm"></div>
      ${D.can.port && !canSave ? `<p class="text-sm" style="color:#9a3412;margin:6px 0 0">🔒 ${isNet(p.peer_host) ? `Cabled to the network device <b>${esc(p.peer_host)}</b> — only IT can change this port.` : 'Only IT can change this port.'}</p>` : ''}
      ${ot ? '<p class="text-muted text-sm" style="margin:6px 0 0">You can set the end device on this port (camera, access control, PC …), its VLAN, patch point and note. Ports to network devices are for IT.</p>' : ''}
      ${self.NMFaces ? `<details class="nm-trace-box" open><summary>🔎 Cable path</summary>${NMFaces.trace(d, p)}</details>` : ''}
      ${D.can.edit ? `<div class="nm-move"><label class="form-label">⇄ Move this cable to another port of ${esc(d.hostname)} (the two ports swap)</label>
        <div style="display:flex;gap:8px"><select class="form-control" id="pp-to">${(portsOf.get(d.id) || []).filter(x => x.port !== port).map(x => `<option value="${esc(x.port)}">${esc(x.port)} — ${portClass(x) === 'pt-free' ? 'free' : esc(x.peer_host || x.patch || 'in use')}</option>`).join('')}</select>
        <button class="btn btn-ghost" onclick="NM.movePort()">Move</button></div></div>` : ''}
      ${p.updated_by ? `<p class="text-muted text-sm" style="margin:8px 0 0">Last change ${esc(String(p.updated_at || '').slice(0, 16))} UTC by ${esc(p.updated_by)}</p>` : ''}`;
    $('nm-port-f').innerHTML = canSave ? `<button class="btn btn-ghost" style="margin-right:auto" onclick="NM.disconnect()">Disconnect</button><button class="btn btn-ghost" onclick="NM.closePort()">Cancel</button><button class="btn btn-primary" onclick="NM.savePort()">Save</button>`
      : '<button class="btn btn-ghost" onclick="NM.closePort()">Close</button>';
    const fill = () => {
      const h = $('pp-host').value.trim(), pd = byHost.get(h);
      $('pp-ports').innerHTML = pd ? (portsOf.get(pd.id) || []).map(x => `<option value="${esc(x.port)}">${portClass(x) === 'pt-free' ? 'free' : '→ ' + esc(x.peer_host || x.patch || 'in use')}</option>`).join('') : '';
      const pp = pd && (portsOf.get(pd.id) || []).find(x => x.port === $('pp-port').value.trim());
      $('pp-warn').innerHTML = pp && pp.peer_host && !(pp.peer_host === d.hostname && pp.peer_port === port)
        ? `⚠ ${esc(h)} ${esc(pp.port)} is now connected to <b>${esc(pp.peer_host)} ${esc(pp.peer_port)}</b> — saving moves it here.` : pd ? `✓ ${esc(h)} will show this connection on its own port too.` : '';
    };
    ['pp-host', 'pp-port'].forEach(id => $(id).addEventListener('input', fill)); fill();
    $('nm-port-ov').classList.add('open');
  }
  const closePort = () => $('nm-port-ov').classList.remove('open');
  async function savePort(clear) {
    const h = $('pp-host').value.trim();
    const v = clear ? { peer_host: '', peer_port: '', cable: '' } : { peer_host: byHost.has(h.toUpperCase()) ? h.toUpperCase() : h, peer_port: $('pp-port').value.trim(), cable: $('pp-cable').value };
    const body = { device_id: cur.d.id, port: cur.p.port, ...v, mode: clear ? cur.p.mode : $('pp-mode').value, vlan: clear ? cur.p.vlan : $('pp-vlan').value.trim(), grp: clear ? '' : $('pp-grp').value.trim(),
      patch: clear ? cur.p.patch : $('pp-patch').value.trim(), note: clear ? cur.p.note : $('pp-note').value.trim() };
    if (body.peer_host && !body.peer_port && byHost.has(body.peer_host)) { showToast('Choose the port of ' + body.peer_host, 'error'); return; }
    try { await apiPut('/api/netmap/port', body); closePort(); showToast(clear ? 'Disconnected' : 'Port saved'); await load(D.site); select(cur.d.id); }
    catch (e) { showToast(errText(e, 'Could not save'), 'error'); }
  }
  async function movePort() {
    const to = $('pp-to').value; if (!to) return;
    if (!confirm(`Move the cable of ${cur.d.hostname} ${cur.p.port} to ${to}? (${to}'s cable comes to ${cur.p.port})`)) return;
    try { await apiPost('/api/netmap/port/move', { device_id: cur.d.id, from: cur.p.port, to }); closePort(); showToast('Moved'); await load(D.site); select(cur.d.id); }
    catch (e) { showToast(errText(e, 'Could not move'), 'error'); }
  }
  function addPort(devId) { const name = prompt('Port name (e.g. GE 1/0/49, TE 1/1/2, MGMT):'); if (name && name.trim()) openPort(devId, name.trim()); }

  // ── Device add / edit ─────────────────────────────────────────────────────
  function editDevice(id) {
    const d = id ? byId.get(id) : { hostname: '', alias: '', role: 'Access switch', model: '', serial: '', mgmt_ip: '', location: '', notes: '' };
    $('nm-dev-t').textContent = id ? `Device — ${d.hostname}` : 'Add device';
    const f = (k, l, ph = '') => `<div class="form-group"><label class="form-label">${l}</label><input class="form-control" id="nd-${k}" value="${esc(d[k] || '')}" placeholder="${ph}" ${k === 'hostname' && id ? 'readonly style="background:#f3f4f6"' : ''}></div>`;
    $('nm-dev-b').innerHTML = `<div class="qe-grid">${f('hostname', 'Hostname *', 'e.g. MR-01/ASW-06')}${f('alias', 'Name / description')}
      <div class="form-group"><label class="form-label">Role</label><select class="form-control" id="nd-role">${ROLES.map(r => `<option${r === d.role ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      ${f('model', 'Model', 'e.g. C9200L-48P-4X-E')}${f('mgmt_ip', 'Management IP')}${f('mac', 'MAC address', 'e.g. 68:9E:0B:8A:E3:78')}${f('location', 'Location / rack', 'e.g. MAIN RACK - 01 (U38)')}${f('serial', 'Serial')}${f('notes', 'Notes')}
      ${id ? `<div class="form-group"><label class="form-label">OT team can see it?</label><select class="form-control" id="nd-ot">
        <option value=""${d.ot == null ? ' selected' : ''}>Automatic — ${d.ot_auto ? 'yes (Kabin / CCTV / card-reader switch)' : 'no'}</option><option value="1"${d.ot === 1 ? ' selected' : ''}>Yes — always show to OT</option><option value="0"${d.ot === 0 ? ' selected' : ''}>No — never show to OT</option></select></div>` : ''}
      ${id ? `<div class="form-group"><label class="form-label">In use?</label><select class="form-control" id="nd-state"><option value="">In use</option><option value="retired"${d.state === 'retired' ? ' selected' : ''}>Retired — stays in the rack, hidden from the topology</option></select></div>` : ''}
      ${id ? '' : `<div class="form-group"><label class="form-label">Ports: name before the number</label><input class="form-control" id="nd-prefix" placeholder="e.g. GE 1/0/"></div>
        <div class="form-group"><label class="form-label">How many</label><input class="form-control" id="nd-count" type="number" min="0" max="96" placeholder="48"></div>`}</div>`;
    $('nm-dev-f').innerHTML = `${id && D.can.admin ? `<button class="btn btn-danger" style="margin-right:auto" onclick="NM.deleteDevice(${id})">Delete</button>` : ''}
      <button class="btn btn-ghost" onclick="document.getElementById('nm-dev-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" onclick="NM.saveDevice(${id || 0})">Save</button>`;
    $('nm-dev-ov').classList.add('open');
  }
  async function saveDevice(id) {
    const v = (k) => ($('nd-' + k) ? $('nd-' + k).value.trim() : '');
    const body = { site: D.site, hostname: v('hostname'), alias: v('alias'), role: v('role'), model: v('model'), serial: v('serial'), mgmt_ip: v('mgmt_ip'), mac: v('mac'), location: v('location'), notes: v('notes'), port_prefix: v('prefix'), port_count: v('count') };
    if (id && $('nd-state')) body.state = $('nd-state').value;
    if (id && $('nd-ot')) body.ot = $('nd-ot').value === '' ? null : Number($('nd-ot').value);
    try {
      const r = id ? await apiPut('/api/netmap/device/' + id, body) : await apiPost('/api/netmap/device', body);
      $('nm-dev-ov').classList.remove('open'); showToast('Saved'); await load(D.site); select(r.id);
    } catch (e) { showToast(errText(e, 'Could not save'), 'error'); }
  }
  async function deleteDevice(id) {
    if (!confirm(`Delete ${byId.get(id).hostname} and all its ports from the map?`)) return;
    try { await apiDelete('/api/netmap/device/' + id); $('nm-dev-ov').classList.remove('open'); sel = null; await load(D.site); } catch (e) { showToast(errText(e, 'Could not delete'), 'error'); }
  }

  // ── VLANs / change log ────────────────────────────────────────────────────
  function renderVlans() {
    const use = new Map(); for (const p of D.ports) for (const v of String(p.vlan || '').split(/[,\s]+/).filter(Boolean)) use.set(v, (use.get(v) || 0) + 1);
    // VLANs set on ports but missing from the list (e.g. 134 PXE boot) are shown too.
    const listed = new Set(D.vlans.map(v => v.vlan));
    const extra = [...use.keys()].filter(v => /^\d+$/.test(v) && !listed.has(v)).sort((a, b) => a - b).map(v => ({ vlan: v, unlisted: true }));
    const inNet = (ip, net) => { const m = String(net || '').match(/^(\d+\.\d+\.\d+)\.\d+\/(\d+)$/); return m && Number(m[2]) >= 24 && String(ip || '').split('/')[0].startsWith(m[1] + '.'); };
    $('nm-view-vlan').innerHTML = D.vlans.length || extra.length ? `<table class="nm-vt"><thead><tr><th>VLAN</th><th>Name</th><th>Description</th><th>Network</th><th>Gateway</th><th>DHCP range</th><th>Ports set to it</th><th>Devices in it</th></tr></thead><tbody>
      ${[...D.vlans, ...extra].map(v => { const devs = v.network ? D.devices.filter(d => inNet(d.mgmt_ip, v.network)) : [];
        return `<tr${v.unlisted ? ' class="nm-vl-x"' : ''}><td><b>${esc(v.vlan)}</b></td><td>${v.unlisted ? '<i>not in the VLAN list</i>' : esc(v.name)}</td><td class="text-sm">${esc(v.description && v.description !== v.name ? v.description : '')}</td><td>${esc(v.network || '')}</td><td>${esc(v.gateway || '')}</td><td>${esc(v.dhcp || '')}</td>
        <td>${use.get(v.vlan) || ''}${use.get(v.vlan) ? ` <a href="#" onclick="NM.search('vlan${esc(v.vlan)}');return false">show</a>` : ''}</td>
        <td class="text-sm">${devs.length ? `${devs.length} <span class="text-muted">${esc(devs.slice(0, 3).map(d => d.hostname).join(', '))}${devs.length > 3 ? ' …' : ''}</span>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '<p class="text-muted" style="padding:14px">No VLANs (they come from the VLAN – IP table of the document).</p>';
  }
  async function showLog(device) {
    $('nm-view-log').innerHTML = '<p class="text-muted" style="padding:14px">Loading…</p>';   // before tab(): tab() loads only an empty view
    tab('log');
    const rows = await apiGet(`/api/netmap/log?site=${encodeURIComponent(D.site)}${device ? '&device=' + encodeURIComponent(device) : ''}`);
    $('nm-view-log').innerHTML = `<div style="padding:8px 12px" class="text-sm">${device ? `Changes of <b>${esc(device)}</b> · <a href="#" onclick="NM.showLog();return false">all devices</a>` : 'Latest 300 changes of this site'}</div>
      <table class="nm-vt"><thead><tr><th>When (UTC)</th><th>Who</th><th>Device</th><th>Port</th><th>Before</th><th>After</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(String(r.at).slice(0, 16))}</td><td>${esc(r.by_user)}</td><td>${esc(r.device)}</td><td><b>${esc(r.port)}</b></td><td class="text-muted">${esc(r.before)}</td><td>${esc(r.after)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">No changes yet.</td></tr>'}</tbody></table>`;
  }
  function tab(v) {
    document.querySelectorAll('.nm-tools .nm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    ['topo', 'rack', 'draw', 'vlan', 'log'].forEach(k => { $('nm-view-' + k).hidden = k !== v; });
    document.querySelector('.nm-legend').style.display = v === 'topo' ? '' : 'none'; $('nm-fit').style.display = v === 'topo' ? '' : 'none'; $('nm-auto').style.display = $('nm-orient').style.display = v === 'topo' && mode === 'map' ? '' : 'none'; $('nm-focus').style.display = v === 'topo' ? '' : 'none';
    if (v === 'rack' || v === 'draw') NMRacks.show(v);
    if (v === 'vlan') renderVlans();
    if (v === 'log' && !$('nm-view-log').innerHTML.trim()) showLog();
  }

  // ── Import / export ───────────────────────────────────────────────────────
  async function importDoc(file) {
    showToast('Reading the document…');
    let r;
    try { r = await NetmapDoc.read(file); } catch (e) { console.error(e); showToast('Could not read this .docx', 'error'); return; }
    if (!r.devices.length) { showToast('No switch-port tables found in this document', 'error'); return; }
    const site = prompt(`Found ${r.counts.devices} devices, ${r.counts.ports} ports (${r.counts.links} cabled to a device or user point) and ${r.counts.vlans} VLANs.\n\nSite name for this map:`, D.site || 'Vietnam factory');
    if (site == null) return;
    const replace = D.sites.some(s => s.site === site.trim()) ? confirm(`"${site}" already has a map. OK = replace it with the document, Cancel = add / update only.\n\nReplace resets the ports to the document: if you imported the Factory Info workbook, import it again afterwards (devices it added stay).`) : true;
    try { const x = await apiPost('/api/netmap/import', { site: site.trim(), devices: r.devices, ports: r.ports, vlans: r.vlans, patches: r.patches, equipment: r.equipment, replace });
      showToast(`Imported ${x.devices} devices, ${x.ports} ports, ${x.vlans} VLANs, ${x.patches} patch-panel ports`); await load(x.site); autoPlace(true); renderTopo(); fit();
      if (D.can.edit) savePositions(D.devices);
    } catch (e) { showToast(errText(e, 'Import failed'), 'error'); }
  }
  // ── Factory Info workbook (.xlsx): preview every change, apply the ticked ones ──
  let WB = null;
  async function importWorkbook(file) {
    showToast('Reading the workbook…');
    let wb;
    try { wb = await NetmapXlsx.read(file); } catch (e) { console.error(e); showToast('Could not read this .xlsx', 'error'); return; }
    if (!wb.counts.blocks && !wb.counts.equipment && !wb.counts.vms) { showToast('No port sheets, equipment list or VM list found in this workbook', 'error'); return; }
    const site = prompt(`Found ${wb.counts.blocks} port tables (${wb.counts.ports} ports), ${wb.counts.equipment} equipment rows, ${wb.counts.aps} access points, ${wb.counts.vlans} VLANs, ${wb.counts.racks} racks / cabinets, ${wb.counts.vms} VM servers, ${wb.counts.printers} printers.\n\nCompare with the map of site:`, D.site || 'Vietnam factory');
    if (site == null || !site.trim()) return;
    try { const plan = await apiPost('/api/netmap/workbook/plan', { site: site.trim(), wb }); WB = { wb, site: site.trim(), plan }; wbShow(); }
    catch (e) { showToast(errText(e, 'Could not compare'), 'error'); }
  }
  function wbShow() {
    const { plan, wb } = WB, total = plan.groups.reduce((t, g) => t + g.changes.length, 0);
    $('nm-wb-t').textContent = `Factory Info workbook → ${WB.site}`;
    const row = (c) => `<label class="wb-r${c.warn ? ' warn' : ''}"><input type="checkbox" data-id="${esc(c.id)}"${c.on ? ' checked' : ''}>
        <span class="wb-t">${esc(c.title)}</span><span class="wb-ft">${c.from ? `<s>${esc(c.from)}</s> → ` : ''}${esc(c.to || '')}</span>${c.warn ? `<span class="wb-w">⚠ ${esc(c.warn)}</span>` : ''}</label>`;
    const body = (g) => {
      if (g.key !== 'port') return g.changes.map(row).join('');
      const by = new Map(); for (const c of g.changes) { if (!by.has(c.dev)) by.set(c.dev, []); by.get(c.dev).push(c); }
      return [...by.entries()].map(([dev, l]) => `<details class="wb-dev"${l.some(c => c.warn) ? ' open' : ''}><summary><input type="checkbox" class="wb-sub" ${l.every(c => c.on) ? 'checked' : ''}> <b>${esc(dev)}</b> <span class="text-muted">${l.length} port${l.length > 1 ? 's' : ''}${l.some(c => c.warn) ? ' · ⚠ links move' : ''}</span></summary>${l.map(row).join('')}</details>`).join('');
    };
    $('nm-wb-b').innerHTML = total ? `<p class="text-sm" style="margin:0 0 10px">Read from <b>${esc(wb.file || 'the workbook')}</b> in your browser (the file is not uploaded). Ticked = will be applied.
        Blank cells never clear what the map has. <span class="wb-w">⚠</span> = check first (a different value is already there, or the workbook contradicts itself) — not ticked unless it is clearly newer.</p>
      ${plan.groups.map(g => `<details class="wb-g"${['dev', 'retire', 'rack'].includes(g.key) ? ' open' : ''} data-g="${g.key}"><summary><input type="checkbox" class="wb-all"> <b>${esc(g.title)}</b> <span class="wb-n"></span></summary><div class="wb-rows">${body(g)}</div></details>`).join('')}`
      : '<p class="ic-ok">✓ The map, Server Inventory and the virtual-server list already match the workbook.</p>';
    const count = () => {
      document.querySelectorAll('#nm-wb-b .wb-g').forEach(g => { const all = g.querySelectorAll('.wb-r input'), on = [...all].filter(i => i.checked).length;
        g.querySelector('.wb-n').textContent = `${on} / ${all.length} ticked`; const a = g.querySelector('.wb-all'); a.checked = on === all.length; a.indeterminate = on > 0 && on < all.length; });
      document.querySelectorAll('#nm-wb-b .wb-dev').forEach(d => { const all = d.querySelectorAll('.wb-r input'), on = [...all].filter(i => i.checked).length; const a = d.querySelector('.wb-sub'); a.checked = on === all.length; a.indeterminate = on > 0 && on < all.length; });
      const n = document.querySelectorAll('#nm-wb-b .wb-r input:checked').length; const b = $('wb-apply'); if (b) { b.textContent = `Apply ${n} change${n === 1 ? '' : 's'}`; b.disabled = !n; }
    };
    $('nm-wb-b').querySelectorAll('.wb-all').forEach(a => { a.onclick = (e) => e.stopPropagation(); a.onchange = () => { a.closest('.wb-g').querySelectorAll('.wb-r input').forEach(i => { i.checked = a.checked; }); count(); }; });
    $('nm-wb-b').querySelectorAll('.wb-sub').forEach(a => { a.onclick = (e) => e.stopPropagation(); a.onchange = () => { a.closest('.wb-dev').querySelectorAll('.wb-r input').forEach(i => { i.checked = a.checked; }); count(); }; });
    $('nm-wb-b').querySelectorAll('.wb-r input').forEach(i => { i.onchange = count; });
    $('nm-wb-f').innerHTML = `<span class="text-muted text-sm" style="margin-right:auto">${total} difference${total === 1 ? '' : 's'} found</span><button class="btn btn-ghost" onclick="document.getElementById('nm-wb-ov').classList.remove('open')">Close</button>${total ? '<button class="btn btn-primary" id="wb-apply">Apply</button>' : ''}`;
    if ($('wb-apply')) $('wb-apply').onclick = wbApply;
    count(); $('nm-wb-ov').classList.add('open');
  }
  async function wbApply() {
    const ids = [...document.querySelectorAll('#nm-wb-b .wb-r input:checked')].map(i => i.dataset.id);
    if (!ids.length || !confirm(`Apply ${ids.length} change${ids.length === 1 ? '' : 's'} to "${WB.site}"? Every change is written to the Port changes log.`)) return;
    const b = $('wb-apply'); b.disabled = true; b.textContent = 'Applying…';
    try {
      const r = await apiPost('/api/netmap/workbook/apply', { site: WB.site, wb: WB.wb, ids });
      const c = r.counts || {}, names = { devices: 'device changes', ports: 'ports', vlans: 'VLANs', rack_items: 'rack items', inventory: 'Server Inventory changes', linked: 'devices linked to Server Inventory', vms: 'virtual servers' };
      showToast('Applied: ' + Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${names[k] || k}`).join(', '));
      if (self.NMViews) NMViews.resetRacks(); if (typeof NMRacks !== 'undefined') await NMRacks.reload().catch(() => {});
      await load(WB.site); autoPlace(false); renderTopo(); fit();
      const plan = await apiPost('/api/netmap/workbook/plan', { site: WB.site, wb: WB.wb }); WB.plan = plan; wbShow();
    } catch (e) { showToast(errText(e, 'Could not apply'), 'error'); b.disabled = false; b.textContent = 'Apply'; }
  }
  const savePositions = (list) => apiPut('/api/netmap/positions', { items: list.map(d => ({ id: d.id, x: d.x, y: d.y })) }).catch(() => {});
  function exportCsv() {
    const rows = [['Site', 'Device', 'Name', 'Role', 'Model', 'IP', 'Location', 'Port', 'Connected to', 'Far port', 'Cable', 'Mode', 'VLAN', 'Port-channel', 'Patch', 'Note']];
    for (const d of [...D.devices].sort((a, b) => natural(a.hostname, b.hostname))) for (const p of portsOf.get(d.id) || [])
      rows.push([D.site, d.hostname, d.alias, d.role, d.model, d.mgmt_ip, d.location, p.port, p.peer_host, p.peer_port, p.cable, p.mode, p.vlan, p.grp, p.patch, p.note]);
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `network-map-${(D.site || 'site').replace(/\W+/g, '_')}.csv`; a.click();
  }

  function init() {
    bindCanvas();
    $('nm-site').onchange = (e) => { sel = null; load(e.target.value).then(fit); };
    $('nm-q').addEventListener('input', (e) => { q = e.target.value.trim(); renderList(); });
    $('nm-fit').onclick = fit;
    $('nm-mode').onchange = (e) => { mode = e.target.value; $('nm-auto').style.display = $('nm-orient').style.display = mode === 'map' ? '' : 'none'; document.querySelector('.nm-legend').style.display = mode === 'map' ? '' : 'none'; renderTopo(true); };
    $('nm-auto').onclick = async () => { focus = false; if (orient === 'h') { hfix.clear(); renderTopo(); fit(); return; } autoPlace(true); renderTopo(); fit(); if (D.can.edit && confirm('Save this layout for everyone?')) savePositions(D.devices); };
    const ob = $('nm-orient'), showO = () => { ob.textContent = orient === 'h' ? '↕ Vertical' : '↔ Horizontal'; ob.title = orient === 'h' ? 'Layers top → bottom (saved positions)' : 'Layers left → right — uses the width of the screen'; };
    showO(); ob.onclick = () => { orient = orient === 'h' ? 'v' : 'h'; localStorage.setItem('nm-orient', orient); showO(); renderTopo(); fit(); };
    $('nm-import').onclick = () => $('nm-file').click();
    $('nm-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importDoc(f); };
    $('nm-import-x').onclick = () => $('nm-xfile').click();
    $('nm-xfile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importWorkbook(f); };
    $('nm-export').onclick = exportCsv;
    $('nm-add').onclick = () => editDevice(0);
    document.querySelectorAll('.nm-tools .nm-tabs button').forEach(b => { b.onclick = () => tab(b.dataset.v); });
    const want = new URLSearchParams(location.search).get('host');
    load().then(() => { const d = want && byHost.get(want.toUpperCase()); if (d) select(d.id); else fit(); }).catch(() => { $('nm-svg').innerHTML = '<text x="800" y="420" text-anchor="middle" fill="#b91c1c">Could not load</text>'; });
  }
  document.addEventListener('DOMContentLoaded', init);
  return { data: () => D, known, portTip, icon, links, selected: () => sel, redraw: (f) => { renderTopo(f); }, setMode: (m) => { mode = m; renderTopo(true); }, tier: (r) => TIER[r] ?? 6, select, openPort, closePort, savePort: () => savePort(false), disconnect: () => savePort(true), movePort, addPort, editDevice, saveDevice, deleteDevice, showLog,
    filter: (f) => { portFilter = f; renderDevice(); }, isNet,
    outlet: (o) => { const pp = (D.patches || []).find(x => String(x.outlet).toUpperCase() === String(o).toUpperCase()); if (pp && self.NMFaces) NMFaces.panel(pp.panel); else showToast('Outlet ' + o + ' is not in the patch-panel list', 'error'); },
    depth: (n) => { depth = n; renderTopo(); fit(); }, group: setGroup, groupShown: () => grp, groupOf, gcol, tab: (v) => tab(v),
    showInRack: () => { tab('rack'); }, showAll: () => { focus = false; renderTopo(); fit(); }, focusMode: () => { focus = true; renderTopo(); fit(); }, search: (s) => { $('nm-q').value = s; q = s; renderList(); } };
})();
