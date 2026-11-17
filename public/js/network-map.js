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
  const ROLES = ['ISP / external', 'Firewall', 'Router', 'Core switch', 'Wireless controller', 'Distribution switch', 'Server switch', 'Access switch', 'HCI server', 'Backup storage', 'Server', 'Access point', 'Other'];
  const TIER = { 'ISP / external': 0, Firewall: 1, Router: 1, 'Core switch': 2, 'Wireless controller': 2, 'Distribution switch': 3, 'Server switch': 3, 'HCI server': 4, 'Backup storage': 4, Server: 4, 'Access switch': 5, 'Access point': 6, Other: 6 };
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const isFiber = (c) => /sfp|sr|lr|lx|sx|fib|dac/i.test(c || '');
  const known = (h) => byHost.has(h);

  // ── Data ──────────────────────────────────────────────────────────────────
  async function load(site) {
    D = await apiGet('/api/netmap' + (site != null ? '?site=' + encodeURIComponent(site) : ''));
    byHost = new Map(D.devices.map(d => [d.hostname, d])); byId = new Map(D.devices.map(d => [d.id, d]));
    portsOf = new Map(); for (const p of D.ports) { if (!portsOf.has(p.device_id)) portsOf.set(p.device_id, []); portsOf.get(p.device_id).push(p); }
    for (const l of portsOf.values()) l.sort((a, b) => natural(a.port, b.port));
    $('nm-site').innerHTML = (D.sites.length ? D.sites : [{ site: D.site || '', devices: 0 }]).map(s => `<option value="${esc(s.site)}"${s.site === D.site ? ' selected' : ''}>${esc(s.site || '(no site yet)')} · ${s.devices} devices</option>`).join('');
    $('nm-import').style.display = D.can.admin ? '' : 'none';
    $('nm-add').style.display = D.can.edit && D.site ? '' : 'none';
    $('nm-sub').textContent = D.devices.length ? `· ${D.devices.length} devices · ${D.ports.length} ports · ${links().length} links` : '· ports & links';
    if (sel && !byId.has(sel)) sel = null;
    autoPlace(false); renderList(); renderTopo(); renderDevice();
    if (!D.devices.length) $('nm-svg').innerHTML = `<text x="800" y="420" text-anchor="middle" font-size="22" fill="#64748b">${D.can.admin ? 'No devices yet — ⬆ Import the implementation document (.docx) or + add devices' : 'No devices yet'}</text>`;
  }

  // Links between two devices of the site (each pair of ports once).
  function links() {
    const seen = new Set(), out = [];
    for (const p of D.ports) {
      if (!p.peer_host || !known(p.peer_host)) continue;
      const a = byId.get(p.device_id).hostname, k = [a + '|' + p.port, p.peer_host + '|' + p.peer_port].sort().join('~');
      if (seen.has(k)) continue; seen.add(k);
      out.push({ a, ap: p.port, b: p.peer_host, bp: p.peer_port, cable: p.cable, grp: p.grp });
    }
    return out;
  }

  // ── Device list (left) ────────────────────────────────────────────────────
  function stats(d) {
    const ps = portsOf.get(d.id) || [];
    return { total: ps.length, dev: ps.filter(p => known(p.peer_host)).length, end: ps.filter(p => !known(p.peer_host) && (p.peer_host || p.patch || p.vlan || p.mode)).length };
  }
  function renderList() {
    const qq = q.toLowerCase();
    const match = (d) => !qq || `${d.hostname} ${d.alias} ${d.model} ${d.mgmt_ip} ${d.location} ${d.role}`.toLowerCase().includes(qq)
      || (portsOf.get(d.id) || []).some(p => `${p.port} ${p.peer_host} ${p.peer_port} ${p.patch} vlan${p.vlan}`.toLowerCase().includes(qq));
    const groups = new Map();
    for (const d of D.devices.filter(match)) { const r = d.role || 'Other'; if (!groups.has(r)) groups.set(r, []); groups.get(r).push(d); }
    $('nm-list').innerHTML = [...groups.entries()].sort((a, b) => (TIER[a[0]] ?? 9) - (TIER[b[0]] ?? 9)).map(([r, list]) => `
      <div class="nm-grp"><div class="nm-grp-h">${icon(r, 0, 0, 18, true)} ${esc(r)} <span>${list.length}</span></div>
      ${list.sort((a, b) => natural(a.hostname, b.hostname)).map(d => { const s = stats(d); return `<div class="nm-item${sel === d.id ? ' on' : ''}" onclick="NM.select(${d.id}, true)">
        <b>${esc(d.hostname)}</b><div class="text-muted text-sm">${esc(d.alias || d.model || '')}</div>
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
      default: return wrap('<rect x="-16" y="-12" width="32" height="24" rx="4" fill="#64748b"/>');
    }
  }

  // ── Topology (centre) ─────────────────────────────────────────────────────
  function autoPlace(force) {
    const tiers = new Map();
    for (const d of D.devices) { const t = TIER[d.role] ?? 6; if (!tiers.has(t)) tiers.set(t, []); tiers.get(t).push(d); }
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
    return dist;
  }
  let keepPos = null;
  function renderTopoKeep(keep) { keepPos = keep; renderTopo(); keepPos = null; }
  const pos = (d) => (focusOn() ? fpos.get(d.id) : d);
  function fit() {
    if (mode !== 'map' && lastBounds) { view = { ...lastBounds }; return apply(); }
    if (focusOn()) {
      const ps = [...fpos.values()], xs = ps.map(p => p.x), ys = ps.map(p => p.y);
      const x0 = Math.min(...xs) - 130, x1 = Math.max(...xs) + 130, y0 = Math.min(...ys) - 80, y1 = Math.max(...ys) + 90;
      const w = Math.max(x1 - x0, 900), h = Math.max(y1 - y0, 480);
      view = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }; return apply();
    }
    if (!D.devices.length) { view = { x: 0, y: 0, w: 1600, h: 900 }; return apply(); }
    const xs = D.devices.map(d => d.x), ys = D.devices.map(d => d.y);
    const x0 = Math.min(...xs) - 90, x1 = Math.max(...xs) + 90, y0 = Math.min(...ys) - 70, y1 = Math.max(...ys) + 80;
    view = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; apply();
  }
  const apply = () => $('nm-svg').setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  let lastBounds = null;
  function renderTopo(fitIt) {
    if (mode !== 'map' && self.NMViews) {
      NMViews.svg(mode).then(r => { $('nm-svg').innerHTML = r.svg; lastBounds = r.bounds; if (fitIt) { view = { ...r.bounds }; apply(); } const fb = $('nm-focus'); if (fb) fb.innerHTML = ''; });
      return;
    }
    const F = focusOn(), dist = F ? focusLayout() : null;
    const showing = (h) => !F || dist.has(h);
    // Focus: only the links that lead out from the selected device (step 1 → step 2), not between neighbours.
    const L = links().filter(l => showing(l.a) && showing(l.b) && (!F || Math.abs(dist.get(l.a) - dist.get(l.b)) === 1));
    const pairs = new Map();
    for (const l of L) { const k = [l.a, l.b].sort().join('~'); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(l); }
    const hl = sel ? byId.get(sel).hostname : null;
    let g = '';
    for (const [k, ls] of pairs) {
      const [a, b] = k.split('~'), A = pos(byHost.get(a)), B = pos(byHost.get(b));
      const fib = ls.some(l => isFiber(l.cable)), pc = ls.some(l => l.grp), on = hl && (a === hl || b === hl);
      g += `<g class="nm-link${on ? ' on' : ''}" data-k="${esc(k)}"><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="hit"/>
        <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${fib ? '#f59e0b' : '#3b82f6'}" stroke-width="${pc || ls.length > 1 ? 4 : 2}" ${pc ? 'stroke-dasharray="10 4"' : ''}/>
        ${ls.length > 1 ? `<text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2 - 4}" class="nm-lcnt">×${ls.length}</text>` : ''}</g>`;
    }
    for (const d of D.devices.filter(d => showing(d.hostname))) {
      const s = stats(d), P = pos(d);
      g += `<g class="nm-node${sel === d.id ? ' on' : ''}${F && dist.get(d.hostname) === 2 ? ' far' : ''}" data-id="${d.id}" transform="translate(${P.x},${P.y})">
        <circle r="30" class="nm-halo"/>${icon(d.role, 0, 0, 46)}
        <text y="38" class="nm-host">${esc(d.hostname)}</text>
        ${d.alias ? `<text y="51" class="nm-alias">${esc(d.alias.length > 24 ? d.alias.slice(0, 23) + '…' : d.alias)}</text>` : ''}
        ${s.end ? `<g transform="translate(20,-22)"><rect x="-1" y="-9" width="${String(s.end).length * 7 + 8}" height="14" rx="7" fill="#0891b2"/><text x="3" y="2" class="nm-badge">${s.end}</text></g>` : ''}</g>`;
    }
    if (F) {   // labels: in front / behind
      const ys = [...fpos.values()].filter(p => p.side).map(p => p.y).concat([0]);
      if (Math.min(...ys) < 0) g = `<text x="0" y="${Math.min(...ys) - 48}" class="nm-zone">▲ in front (towards firewall / core)</text>` + g;
      if (Math.max(...ys) > 0) g = `<text x="0" y="${Math.max(...ys) + 72}" class="nm-zone">▼ behind (towards access / servers)</text>` + g;
    }
    $('nm-svg').innerHTML = g;
    const fb = $('nm-focus');
    if (fb) fb.innerHTML = F ? `<b>${esc(byId.get(sel).hostname)}</b> + ${dist.size - 1} cabled device${dist.size === 2 ? '' : 's'}
        <span class="nm-tabs small"><button class="${depth === 1 ? 'on' : ''}" onclick="NM.depth(1)">1 step</button><button class="${depth === 2 ? 'on' : ''}" onclick="NM.depth(2)">2 steps</button></span>
        <button class="btn btn-ghost btn-sm" onclick="NM.showAll()">Show all</button>`
      : sel ? `<button class="btn btn-ghost btn-sm" onclick="NM.focusMode()">◎ Only ${esc(byId.get(sel).hostname)} and its links</button>` : '';
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
        if (focusOn()) { const keep = new Map(fpos); renderTopoKeep(keep); } else renderTopo(); }
      else { const r = svg.getBoundingClientRect(); view.x = drag.v.x - (e.clientX - drag.sx) / r.width * view.w; view.y = drag.v.y - (e.clientY - drag.sy) / r.height * view.h; drag.moved = Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3; apply(); }
    });
    svg.addEventListener('pointerup', async (e) => {
      const d = drag; drag = null; if (!d) return;
      if (d.kind === 'click') { select(d.id); return; }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (!d.moved && under && under.closest('.nm-edge')) { NMViews.edge(true); return; }
      if (d.kind === 'node') {
        if (d.moved) { if (D.can.edit && !focusOn()) { try { await apiPut('/api/netmap/device/' + d.d.id, { x: d.d.x, y: d.d.y }); } catch {} } }
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
    else { const d = byId.get(Number(n.dataset.id)), s = stats(d); html = `<b>${esc(d.hostname)}</b><div>${esc(d.model)}</div><div>${esc(d.mgmt_ip)} · ${esc(d.location)}</div><div>${s.dev} to devices · ${s.end} to users / patch · ${s.total - s.dev - s.end} free</div>`; }
    const r = $('nm-view-topo').getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 260) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px';
  }

  // ── Device panel (front panel + ports) ────────────────────────────────────
  function select(id, center, linkKey) {
    const prev = sel; sel = id; renderList(); renderTopo(); renderDevice(linkKey);
    if (focusOn()) { if (prev !== id) fit(); }
    else if (center) { const d = byId.get(id); view.x = d.x - view.w / 2; view.y = d.y - view.h / 2; apply(); }
    $('nm-dev').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const portClass = (p) => (known(p.peer_host) ? 'pt-dev' : (p.peer_host || p.patch || p.vlan || p.mode) ? 'pt-end' : 'pt-free');
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
    const shown = ps.filter(p => (portFilter === 'all' || (portFilter === 'dev' && known(p.peer_host)) || (portFilter === 'end' && portClass(p) === 'pt-end') || (portFilter === 'free' && portClass(p) === 'pt-free')));
    box.innerHTML = `<div class="nm-dh">${icon(d.role, 0, 0, 40, true)}
        <div><div class="nm-dt">${esc(d.hostname)} ${DeviceSpecs.btn(d.model, d.role)}</div>
          <div class="text-muted text-sm">${esc([d.alias, d.role, d.model].filter(Boolean).join(' · '))}</div>
          <div class="text-sm">${d.mgmt_ip ? `IP <b>${esc(d.mgmt_ip)}</b> · ` : ''}${esc(d.location || '')}${d.serial ? ` · S/N ${esc(d.serial)}` : ''}${d.service_tag && d.service_tag !== d.serial ? ` · tag ${esc(d.service_tag)}` : ''}</div>
          ${ipList(d)}${d.server_id ? `<div class="text-sm"><a href="/server-inventory.html?view=${d.server_id}">📦 Server Inventory record #${d.server_id}</a></div>` : ''}</div>
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
    const ro = !D.can.edit ? 'disabled' : '';
    $('nm-port-t').textContent = `${d.hostname} · ${port}`;
    const hosts = D.devices.filter(x => x.id !== d.id).map(x => x.hostname).sort(natural);
    $('nm-port-b').innerHTML = `<div class="nm-pnow"><span class="dot ${portClass(p)}"></span> ${esc(portTip(p))}</div>
      <div class="qe-grid">
        <div class="form-group"><label class="form-label">Connected to (device)</label><input class="form-control" id="pp-host" list="pp-hosts" value="${esc(p.peer_host)}" ${ro} placeholder="network device, or PC / printer / AP name"><datalist id="pp-hosts">${hosts.map(h => `<option value="${esc(h)}">`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">Its port</label><input class="form-control" id="pp-port" list="pp-ports" value="${esc(p.peer_port)}" ${ro}><datalist id="pp-ports"></datalist></div>
        <div class="form-group"><label class="form-label">Cable</label><select class="form-control" id="pp-cable" ${ro}>${CABLES.concat(CABLES.includes(p.cable) ? [] : [p.cable]).map(c => `<option${c === p.cable ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Switchport mode</label><select class="form-control" id="pp-mode" ${ro}>${['', 'ACCESS', 'TRUNK'].concat(['', 'ACCESS', 'TRUNK'].includes(p.mode) ? [] : [p.mode]).map(c => `<option${c === p.mode ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">VLAN</label><input class="form-control" id="pp-vlan" list="pp-vlans" value="${esc(p.vlan)}" ${ro}><datalist id="pp-vlans">${D.vlans.map(v => `<option value="${esc(v.vlan)}">${esc(v.name)}</option>`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">Port-channel / group</label><input class="form-control" id="pp-grp" value="${esc(p.grp)}" ${ro}></div>
        <div class="form-group"><label class="form-label">Patch panel port</label><input class="form-control" id="pp-patch" value="${esc(p.patch)}" ${ro} placeholder="e.g. D01"></div>
        <div class="form-group"><label class="form-label">Note</label><input class="form-control" id="pp-note" value="${esc(p.note)}" ${ro}></div>
      </div>
      <div id="pp-warn" class="text-sm"></div>
      ${self.NMFaces ? `<details class="nm-trace-box" open><summary>🔎 Cable path</summary>${NMFaces.trace(d, p)}</details>` : ''}
      ${D.can.edit ? `<div class="nm-move"><label class="form-label">⇄ Move this cable to another port of ${esc(d.hostname)} (the two ports swap)</label>
        <div style="display:flex;gap:8px"><select class="form-control" id="pp-to">${(portsOf.get(d.id) || []).filter(x => x.port !== port).map(x => `<option value="${esc(x.port)}">${esc(x.port)} — ${portClass(x) === 'pt-free' ? 'free' : esc(x.peer_host || x.patch || 'in use')}</option>`).join('')}</select>
        <button class="btn btn-ghost" onclick="NM.movePort()">Move</button></div></div>` : ''}
      ${p.updated_by ? `<p class="text-muted text-sm" style="margin:8px 0 0">Last change ${esc(String(p.updated_at || '').slice(0, 16))} UTC by ${esc(p.updated_by)}</p>` : ''}`;
    $('nm-port-f').innerHTML = D.can.edit ? `<button class="btn btn-ghost" style="margin-right:auto" onclick="NM.disconnect()">Disconnect</button><button class="btn btn-ghost" onclick="NM.closePort()">Cancel</button><button class="btn btn-primary" onclick="NM.savePort()">Save</button>`
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
      ${f('model', 'Model', 'e.g. C9200L-48P-4X-E')}${f('mgmt_ip', 'Management IP')}${f('location', 'Location / rack', 'e.g. MAIN RACK - 01 (U38)')}${f('serial', 'Serial')}${f('notes', 'Notes')}
      ${id ? '' : `<div class="form-group"><label class="form-label">Ports: name before the number</label><input class="form-control" id="nd-prefix" placeholder="e.g. GE 1/0/"></div>
        <div class="form-group"><label class="form-label">How many</label><input class="form-control" id="nd-count" type="number" min="0" max="96" placeholder="48"></div>`}</div>`;
    $('nm-dev-f').innerHTML = `${id && D.can.admin ? `<button class="btn btn-danger" style="margin-right:auto" onclick="NM.deleteDevice(${id})">Delete</button>` : ''}
      <button class="btn btn-ghost" onclick="document.getElementById('nm-dev-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" onclick="NM.saveDevice(${id || 0})">Save</button>`;
    $('nm-dev-ov').classList.add('open');
  }
  async function saveDevice(id) {
    const v = (k) => ($('nd-' + k) ? $('nd-' + k).value.trim() : '');
    const body = { site: D.site, hostname: v('hostname'), alias: v('alias'), role: v('role'), model: v('model'), serial: v('serial'), mgmt_ip: v('mgmt_ip'), location: v('location'), notes: v('notes'), port_prefix: v('prefix'), port_count: v('count') };
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
    $('nm-view-vlan').innerHTML = D.vlans.length ? `<table class="nm-vt"><thead><tr><th>VLAN</th><th>Name</th><th>Network</th><th>Gateway</th><th>Ports set to it</th></tr></thead><tbody>
      ${D.vlans.map(v => `<tr><td><b>${esc(v.vlan)}</b></td><td>${esc(v.name)}</td><td>${esc(v.network)}</td><td>${esc(v.gateway)}</td><td>${use.get(v.vlan) || ''}${use.get(v.vlan) ? ` <a href="#" onclick="NM.search('vlan${esc(v.vlan)}');return false">show</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted" style="padding:14px">No VLANs (they come from the VLAN – IP table of the document).</p>';
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
    document.querySelector('.nm-legend').style.display = v === 'topo' ? '' : 'none'; $('nm-fit').style.display = $('nm-auto').style.display = v === 'topo' ? '' : 'none'; $('nm-focus').style.display = v === 'topo' ? '' : 'none';
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
    const replace = D.sites.some(s => s.site === site.trim()) ? confirm(`"${site}" already has a map. OK = replace it with the document, Cancel = add / update only.`) : true;
    try { const x = await apiPost('/api/netmap/import', { site: site.trim(), devices: r.devices, ports: r.ports, vlans: r.vlans, patches: r.patches, equipment: r.equipment, replace });
      showToast(`Imported ${x.devices} devices, ${x.ports} ports, ${x.vlans} VLANs, ${x.patches} patch-panel ports`); await load(x.site); autoPlace(true); renderTopo(); fit();
      if (D.can.edit) savePositions(D.devices);
    } catch (e) { showToast(errText(e, 'Import failed'), 'error'); }
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
    $('nm-mode').onchange = (e) => { mode = e.target.value; $('nm-auto').style.display = mode === 'map' ? '' : 'none'; document.querySelector('.nm-legend').style.display = mode === 'map' ? '' : 'none'; renderTopo(true); };
    $('nm-auto').onclick = async () => { focus = false; autoPlace(true); renderTopo(); fit(); if (D.can.edit && confirm('Save this layout for everyone?')) savePositions(D.devices); };
    $('nm-import').onclick = () => $('nm-file').click();
    $('nm-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importDoc(f); };
    $('nm-export').onclick = exportCsv;
    $('nm-add').onclick = () => editDevice(0);
    document.querySelectorAll('.nm-tools .nm-tabs button').forEach(b => { b.onclick = () => tab(b.dataset.v); });
    const want = new URLSearchParams(location.search).get('host');
    load().then(() => { const d = want && byHost.get(want.toUpperCase()); if (d) select(d.id); else fit(); }).catch(() => { $('nm-svg').innerHTML = '<text x="800" y="420" text-anchor="middle" fill="#b91c1c">Could not load</text>'; });
  }
  document.addEventListener('DOMContentLoaded', init);
  return { data: () => D, known, portTip, icon, links, selected: () => sel, redraw: (f) => { renderTopo(f); }, setMode: (m) => { mode = m; renderTopo(true); }, tier: (r) => TIER[r] ?? 6, select, openPort, closePort, savePort: () => savePort(false), disconnect: () => savePort(true), movePort, addPort, editDevice, saveDevice, deleteDevice, showLog,
    filter: (f) => { portFilter = f; renderDevice(); },
    outlet: (o) => { const pp = (D.patches || []).find(x => String(x.outlet).toUpperCase() === String(o).toUpperCase()); if (pp && self.NMFaces) NMFaces.panel(pp.panel); else showToast('Outlet ' + o + ' is not in the patch-panel list', 'error'); },
    depth: (n) => { depth = n; renderTopo(); fit(); }, showAll: () => { focus = false; renderTopo(); fit(); }, focusMode: () => { focus = true; renderTopo(); fit(); }, search: (s) => { $('nm-q').value = s; q = s; renderList(); } };
})();
