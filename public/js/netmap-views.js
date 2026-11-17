/* Network map — topology views drawn like the implementation document (section 5):
   logical   ISP clouds → WAN firewall cluster → core pair (vPC) → distribution / server switches → edge switches,
             servers and WLCs on the left; device IPs; links 10 G green / 1 G blue with port-channel (Po) labels
   physical  racks and factory cabinets as boxes with their devices (rack order), cables by medium:
             CAT6 blue, fiber single-mode (LR / LX) yellow, fiber multi-mode (SR) green
   system    core pair → server switches → VxRail nodes / Data Domain, with the port names at both ends
   NMViews.svg(mode) → SVG content (nodes keep class nm-node / data-id so clicks open the device). */

const NMViews = self.NMViews = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let racks = null, edgeOpen = false;
  const D = () => NM.data();
  const ip = (d) => (d.mgmt_ip || '').split('/')[0] || (() => { try { return (JSON.parse(d.ips || '[]')[0] || {}).ip || ''; } catch { return ''; } })();
  const medium = (c) => (/LR|LX|SMF|single/i.test(c || '') ? 'smf' : /SR|SX|OMF|multi|DAC|SFP/i.test(c || '') ? 'omf' : 'cu');
  const COL = { logical: { smf: '#16a34a', omf: '#16a34a', cu: '#0ea5e9' }, physical: { smf: '#eab308', omf: '#16a34a', cu: '#3b82f6' }, system: { smf: '#16a34a', omf: '#16a34a', cu: '#0ea5e9' } };
  async function loadRacks() { if (!racks) racks = await apiGet('/api/netmap/racks?site=' + encodeURIComponent(D().site)).catch(() => ({ racks: [], items: [] })); return racks; }

  // Pairs ("…-01" / "…-02" with the same prefix) get a box like the document's clusters.
  function pairs(list) {
    const m = new Map();
    for (const d of list) { const k = d.hostname.replace(/-?0?[12]$/, ''); if (!m.has(k)) m.set(k, []); m.get(k).push(d); }
    return [...m.values()].filter(l => l.length === 2);
  }
  const node = (d, x, y, opts = {}) => `<g class="nm-node${opts.on ? ' on' : ''}" data-id="${d.id}" transform="translate(${x},${y})"><circle r="28" class="nm-halo"/>${NM.icon(d.role, 0, 0, opts.s || 42)}
    <text y="36" class="nm-host">${esc(d.hostname)}</text>${opts.ip !== false && ip(d) ? `<text y="49" class="nm-ip">${esc(ip(d))}</text>` : d.alias ? `<text y="49" class="nm-alias">${esc(d.alias.slice(0, 26))}</text>` : ''}</g>`;
  function linkSvg(mode, pos, filter, opts = {}) {
    const groups = new Map();
    for (const l of NM.links()) {
      const a = opts.map ? opts.map(l.a) : l.a, b = opts.map ? opts.map(l.b) : l.b;
      if (a === b || !pos.has(a) || !pos.has(b) || (filter && !filter(l))) continue;
      const k = [a, b].sort().join('~'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l);
    }
    let g = '';
    for (const [k, ls] of groups) {
      const [a, b] = k.split('~'), A = pos.get(a), B = pos.get(b), md = medium(ls[0].cable), col = COL[mode][md];
      const po = [...new Set(ls.map(l => l.grp).filter(Boolean))];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      g += `<g class="nm-link" data-k="${esc([ls[0].a, ls[0].b].sort().join('~'))}"><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="hit"/>
        <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${col}" stroke-width="${Math.min(6, 1.6 + ls.length * 0.9)}"/>
        ${po.length ? `<g transform="translate(${mx},${my})"><rect x="-26" y="-8" width="52" height="15" rx="3" fill="#fff" stroke="${col}"/><text y="3" class="nm-po">Po${esc(po[0])}${po.length > 1 ? '+' : ''}</text></g>` : ls.length > 1 ? `<text x="${mx}" y="${my - 4}" class="nm-lcnt">×${ls.length}</text>` : ''}
        ${opts.ends ? ls.slice(0, 2).map((l, i) => { const [p1, p2, P1, P2] = l.a === a ? [l.ap, l.bp, A, B] : [l.bp, l.ap, A, B]; const t = 0.18 + i * 0.07;
          return `<text x="${P1.x + (P2.x - P1.x) * t}" y="${P1.y + (P2.y - P1.y) * t - 3}" class="nm-pe">${esc(p1)}</text><text x="${P2.x + (P1.x - P2.x) * t}" y="${P2.y + (P1.y - P2.y) * t - 3}" class="nm-pe">${esc(p2)}</text>`; }).join('') : ''}</g>`;
    }
    return g;
  }
  const box = (x, y, w, h, label, cls = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="nm-box ${cls}"/>${label ? `<text x="${x + 10}" y="${y + 16}" class="nm-boxl">${esc(label)}</text>` : ''}`;

  // ── Logical (5.2) ───────────────────────────────────────────────────────
  function logical() {
    const devs = D().devices.filter(d => d.state !== 'retired'), by = (r) => devs.filter(d => d.role === r).sort((a, b) => a.hostname.localeCompare(b.hostname));
    const pos = new Map(), sel = NM.selected();
    let g = '', out = '';
    const row = (list, y, cx, gap = 190) => list.forEach((d, i) => pos.set(d.hostname, { x: cx + (i - (list.length - 1) / 2) * gap, y, d }));
    row(by('ISP / external'), 40, 640, 240);
    // WAN firewalls (Palo Alto PA-440 pair now; the retired VFW nodes are not shown) in the middle, the OT firewall aside.
    const fw = by('Firewall'), isOt = (d) => /OT-FW|AUTOMATION|\bOT\b/i.test(`${d.hostname} ${d.alias}`), wan = fw.filter(d => !isOt(d)), ot = fw.filter(isOt);
    row(wan, 200, 640, 220); row(ot, 200, 1010);
    row(by('Router'), 360, 180, 170);
    row(by('Core switch'), 360, 640, 300);
    const wlc = by('Wireless controller'); wlc.forEach((d, i) => pos.set(d.hostname, { x: 1000 + i * 170, y: 360, d }));
    row([...by('Server switch'), ...by('Distribution switch')], 540, 640, 200);
    const srv = [...by('HCI server'), ...by('Backup storage'), ...by('Server')]; srv.forEach((d, i) => pos.set(d.hostname, { x: 100, y: 600 + i * 95, d }));
    // Edge switches: one box (click to show them all).
    const edge = by('Access switch');
    if (edge.length && !edgeOpen) pos.set('__EDGE__', { x: 640, y: 740, d: null });
    else row(edge, 740, 640, 125);
    for (const p of pairs(wan)) { const A = pos.get(p[0].hostname), B = pos.get(p[1].hostname); out += box(Math.min(A.x, B.x) - 80, A.y - 48, Math.abs(A.x - B.x) + 160, 116, `WAN firewall cluster (HA)${/PA-?440/i.test(p[0].model) ? ' — Palo Alto PA-440' : ''}`); }
    for (const r of ['Core switch', 'Distribution switch', 'Server switch']) for (const p of pairs(by(r))) { const A = pos.get(p[0].hostname), B = pos.get(p[1].hostname); out += box(Math.min(A.x, B.x) - 80, A.y - 46, Math.abs(A.x - B.x) + 160, 112, r === 'Core switch' ? 'Core pair (vPC)' : ''); }
    const map = (h) => (pos.has(h) ? h : (!edgeOpen && edge.some(d => d.hostname === h) ? '__EDGE__' : h));
    g += linkSvg('logical', pos, null, { map });
    for (const [h, p] of pos) {
      if (h === '__EDGE__') { g += `<g class="nm-edge" onclick="NMViews.edge(true)" transform="translate(${p.x},${p.y})"><rect x="-150" y="-30" width="300" height="64" rx="8" fill="#fff" stroke="#1d4ed8" stroke-width="2"/>
          <text y="-6" class="nm-host">EDGE SWITCHES: ${edge.length} PCS</text><text y="10" class="nm-ip">${esc(edge.map(ip).filter(Boolean).slice(0, 1)[0] || '')} …</text><text y="25" class="nm-alias">click to show them</text></g>`; continue; }
      g += node(p.d, p.x, p.y, { on: sel === p.d.id });
    }
    const legend = `<g transform="translate(1080,690)">${box(0, 0, 200, 70, 'Legend')}<line x1="14" y1="36" x2="60" y2="36" stroke="#0ea5e9" stroke-width="3"/><text x="68" y="40" class="nm-alias" text-anchor="start">1 G connection</text>
      <line x1="14" y1="56" x2="60" y2="56" stroke="#16a34a" stroke-width="3"/><text x="68" y="60" class="nm-alias" text-anchor="start">10 G connection</text></g>`;
    return { svg: out + g + legend + (edgeOpen && edge.length ? `<text x="640" y="805" class="nm-zone" style="cursor:pointer" onclick="NMViews.edge(false)">▲ group the edge switches again</text>` : ''), pos };
  }

  // ── Physical (5.3): racks / cabinets as boxes ─────────────────────────────
  function physical() {
    const R = racks || { racks: [], items: [] }, devs = D().devices, pos = new Map(), sel = NM.selected();
    let out = '', g = '';
    const main = R.racks.filter(r => r.kind !== 'cabinet'), cab = R.racks.filter(r => r.kind === 'cabinet');
    const devIn = (r) => R.items.filter(i => i.rack_id === r.id && i.device_id).sort((a, b) => b.u - a.u).map(i => devs.find(d => d.id === i.device_id)).filter(Boolean);
    // Cabinets: a column on the left, like the document.
    cab.forEach((r, i) => { const y = 30 + i * 74, l = devIn(r); out += box(20, y, 250, 62, r.name, 'cab');
      l.forEach((d, j) => pos.set(d.hostname, { x: 145, y: y + 38 + j * 16, d, bar: true })); });
    // Server room racks side by side.
    let x = 380;
    for (const r of main) {
      const l = devIn(r), h = Math.max(140, 50 + l.length * 34);
      out += box(x, 30, 230, h, r.name, 'rack');
      l.forEach((d, j) => pos.set(d.hostname, { x: x + 115, y: 70 + j * 34, d, bar: true }));
      x += 260;
    }
    const unplaced = devs.filter(d => !pos.has(d.hostname) && !['Access point', 'Printer'].includes(d.role) && d.state !== 'retired');
    unplaced.forEach((d, i) => pos.set(d.hostname, { x: 380 + (i % 6) * 170, y: 760 + Math.floor(i / 6) * 40, d, bar: true }));
    if (unplaced.length) out += `<text x="380" y="740" class="nm-boxl">Not in a rack</text>`;
    g += linkSvg('physical', pos, (l) => true);
    for (const [, p] of pos) g += `<g class="nm-node${sel === p.d.id ? ' on' : ''}" data-id="${p.d.id}" transform="translate(${p.x},${p.y})"><rect x="-100" y="-11" width="200" height="22" rx="3" class="nm-bar"/>
        <text y="4" class="nm-bart">${esc(p.d.hostname)}</text></g>`;
    const legend = `<g transform="translate(${Math.max(1000, x - 240)},${60 + Math.max(...main.map(r => devIn(r).length), 3) * 34 + 60})">${box(0, 0, 210, 86, 'Legends')}
      <line x1="14" y1="36" x2="60" y2="36" stroke="#3b82f6" stroke-width="3"/><text x="68" y="40" class="nm-alias" text-anchor="start">CAT6</text>
      <line x1="14" y1="54" x2="60" y2="54" stroke="#eab308" stroke-width="3"/><text x="68" y="58" class="nm-alias" text-anchor="start">Fiber SMF (LR / LX)</text>
      <line x1="14" y1="72" x2="60" y2="72" stroke="#16a34a" stroke-width="3"/><text x="68" y="76" class="nm-alias" text-anchor="start">Fiber OMF (SR)</text></g>`;
    return { svg: out + g + legend, pos, empty: !R.racks.length };
  }

  // ── System (5.1) ──────────────────────────────────────────────────────────
  function system() {
    const devs = D().devices.filter(d => d.state !== 'retired'), by = (r) => devs.filter(d => d.role === r).sort((a, b) => a.hostname.localeCompare(b.hostname));
    const pos = new Map(), sel = NM.selected();
    const row = (list, y, cx, gap) => list.forEach((d, i) => pos.set(d.hostname, { x: cx + (i - (list.length - 1) / 2) * gap, y, d }));
    row(by('Core switch'), 60, 600, 420); row(by('Server switch'), 300, 600, 340);
    row([...by('HCI server'), ...by('Backup storage')], 540, 600, 230);
    const keep = new Set(pos.keys());
    let g = linkSvg('system', pos, (l) => keep.has(l.a) && keep.has(l.b), { ends: true });
    for (const [, p] of pos) g += node(p.d, p.x, p.y, { on: sel === p.d.id });
    return { svg: g, pos };
  }

  async function svg(mode) {
    if (mode === 'physical') await loadRacks();
    const r = mode === 'logical' ? logical() : mode === 'physical' ? physical() : system();
    if (r.empty) return { svg: '<text x="640" y="300" text-anchor="middle" font-size="18" fill="#64748b">No racks yet — build them in the 🗄 Racks tab first.</text>', bounds: { x: 0, y: 0, w: 1280, h: 600 } };
    const ps = [...r.pos.values()]; const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    return { svg: r.svg, bounds: ps.length ? { x: Math.min(0, Math.min(...xs) - 160), y: -10, w: Math.max(1300, Math.max(...xs) + 220) - Math.min(0, Math.min(...xs) - 160), h: Math.max(...ys) + 120 } : { x: 0, y: 0, w: 1300, h: 800 } };
  }
  return { svg, edge: (on) => { edgeOpen = on; NM.redraw(true); }, resetRacks: () => { racks = null; } };
})();
