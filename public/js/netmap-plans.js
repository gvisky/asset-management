/* Network map → floor plans: a drawing (fiber layout, AP layout of an area …) shown large, with pins on it.
   Pins: 🗄 cabinet / rack (opens it in the Racks tab), 📶 access point, 🔷 network device (opens its ports),
   📝 note. Editors click the picture to add a pin, drag a pin to move it, click a pin to change / remove it.
   Pins are stored on the drawing (net_drawings.pins, x / y in % of the picture). */

const NMPlans = self.NMPlans = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KIND = { cabinet: ['🗄', '#0e7490', 'Cabinet / rack'], ap: ['📶', '#dc2626', 'Access point'], device: ['🔷', '#1d4ed8', 'Network device'], camera: ['📷', '#ea580c', 'Camera'], note: ['📝', '#7c3aed', 'Note'] };
  let cur = null, pins = [], fib = [], dirty = false, zoom = 1, editing = false, cables = localStorage.getItem('pl-cables') !== '0', focusI = null, racks = null;
  const PAL = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#be123c', '#7c3aed'];
  const D = () => NM.data();
  // CCTV bullet camera on its wall bracket (pins and popups of camera pins).
  const CAM_SVG = `<svg class="pl-cam-ico" viewBox="0 0 40 32" width="26" height="21" aria-hidden="true"><g stroke="#475569" stroke-width="1.2" stroke-linejoin="round">
    <circle cx="33" cy="24" r="5.5" fill="#f1f5f9"/><path d="M24 15.5l3 0 6.5 7-2.4 2.4-7.3-6.4z" fill="#e2e8f0"/>
    <path d="M7 6.5l23-3.2 2 1.4v9.2l-1.6 1.6-22.6 2.6z" fill="#fff"/><path d="M5.5 5.6l26-3.6 1.4 1.8-26 3.8z" fill="#e2e8f0"/>
    <ellipse cx="7.6" cy="12" rx="3.4" ry="5.4" fill="#1e293b"/></g>
    <circle cx="7.8" cy="12" r="2.3" fill="#334155" stroke="#94a3b8" stroke-width=".8"/><circle cx="7.3" cy="11.2" r=".7" fill="#e2e8f0"/></svg>`;
  const icoOf = (kind, k) => (kind === 'camera' ? CAM_SVG : k[0]);
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };

  function ui() {
    if (document.getElementById('pl-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="pl-ov" id="pl-ov" hidden><div class="pl-top">
        <b id="pl-t"></b><span class="text-sm" id="pl-sum" style="opacity:.8"></span><span id="pl-nav" class="pl-nav"></span><span style="flex:1"></span>
        <label class="text-sm pl-tg"><input type="checkbox" id="pl-cab"> 🔌 Cables</label>
        <span id="pl-edit-tools"></span>
        <button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.zoomBy(1.25)">＋</button><button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.zoomBy(0.8)">－</button>
        <button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.close()">✕ Close</button></div>
      <div class="pl-scroll" id="pl-scroll"><div class="pl-stage" id="pl-stage"><img id="pl-img" alt=""><svg id="pl-lines" class="pl-lines" viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div id="pl-pins"></div></div></div>
      <div class="pl-info" id="pl-info" hidden></div></div>`);
    document.getElementById('pl-cab').checked = cables;
    document.getElementById('pl-cab').onchange = (e) => { cables = e.target.checked; localStorage.setItem('pl-cables', cables ? '1' : '0'); render(); };
    document.getElementById('pl-stage').addEventListener('click', (e) => {
      if (!editing) { if (!e.target.closest('.pl-pin')) { focusI = null; info(null); render(); } return; }
    if (e.target.closest('.pl-pin')) return;
      const r = document.getElementById('pl-img').getBoundingClientRect();
      addPin(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
    });
  }
  let all = [];
  function open(id, drawings, focusRef) {
    const d = (drawings || all).find(x => x.id === id); if (!d) return false;
    if (drawings) all = drawings;
    if (dirty && cur && cur.id !== id && !confirm('Pins changed but not saved. Open the other drawing anyway?')) return true;
    ui(); cur = d; zoom = 1; dirty = false; editing = false; focusI = null; info(null);
    if (!racks) apiGet('/api/netmap/racks?site=' + encodeURIComponent(D().site) + (D().view === 'ot' ? '&view=ot' : '')).then(r => { racks = r; }).catch(() => { racks = { racks: [], items: [] }; });
    try { pins = JSON.parse(d.pins || '[]'); } catch { pins = []; }
    try { fib = JSON.parse(d.links || '[]'); } catch { fib = []; }
    document.getElementById('pl-t').textContent = d.name;
    document.getElementById('pl-img').src = '/api/netmap/drawing/' + d.id;
    document.getElementById('pl-img').onload = () => { fitWidth(); render();
      if (focusRef) { const j = pinByRef(focusRef); if (j >= 0) { show(j); setTimeout(() => { const el = document.querySelector(`.pl-pin[data-i="${j}"]`); if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }, 50); } } };
    // Buttons to the other drawings of the site (plans first).
    const others = all.filter(x => x.id !== d.id).sort((a, b) => (/plan|fiber/i.test(b.category) - /plan|fiber/i.test(a.category)) || a.name.localeCompare(b.name));
    document.getElementById('pl-nav').innerHTML = others.length ? `<span class="pl-nav-l">Go to:</span>${others.map(x => `<button class="pl-navb" onclick="NMPlans.goto(${x.id})" title="${esc(x.category || '')}">${esc(short(x.name))}</button>`).join('')}` : '';
    document.getElementById('pl-ov').hidden = false;
    tools(); render();
    return true;
  }
  const short = (n) => String(n).replace(/\s*\(CAD[^)]*\)\s*$/, '').replace(/\s+—\s+/, ' — ').slice(0, 42);
  // The same cabinet / AP on other drawings (e.g. IT KABIN 7 on the factory plan and on the site plan).
  function elsewhere(p) {
    const r = U(p.ref || p.label);
    return all.filter(x => x.id !== cur.id).filter(x => { try { return JSON.parse(x.pins || '[]').some(q => U(q.ref || q.label) === r); } catch { return false; } });
  }
  function tools() {
    const can = D().can.edit;
    document.getElementById('pl-edit-tools').innerHTML = can ? (editing
      ? `<span class="text-sm">Click the picture to add a pin · drag to move</span><button class="btn btn-primary btn-sm" onclick="NMPlans.save()">💾 Save pins</button><button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.edit(false)">Done</button>`
      : `<button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.edit(true)">📍 Edit pins</button>`) : '';
  }
  function fitWidth() { const sc = document.getElementById('pl-scroll'), img = document.getElementById('pl-img'); if (!img.naturalWidth) return; zoom = Math.min(1, (sc.clientWidth - 20) / img.naturalWidth) || 1; applyZoom(); }
  function applyZoom() { const img = document.getElementById('pl-img'); img.style.width = Math.round(img.naturalWidth * zoom) + 'px'; if (pins.some(p => p.kind === 'camera')) requestAnimationFrame(render); }
  // ── Cables: AP "K7-A5" = AP 5 of cabinet 7 → IT KABIN 7 (HK12-A1 → HARICI KABIN 12); otherwise the switch port the
  //    AP is cabled to in the map, and the cabinet that switch is in.
  const U = (s) => String(s || '').toUpperCase();
  const cabNo = (p) => { const m = U(p.ref || p.label).match(/(HARICI|IT|CCTV)?[\s-]*KABIN[\s-]*(\d+)/); return m ? { kind: m[1] || '', n: m[2] } : null; };
  function cabinetOf(p) {
    const m = U(p.label).match(/^(HK|K)(\d+)-A/) || U(p.ref).match(/^(HK|K)(\d+)-AP/);
    const cabs = pins.map((c, j) => ({ c, j })).filter(x => x.c.kind === 'cabinet');
    // Several pins can stand for the same place (server room on the ground floor + rack panel upstairs): take the nearest.
    const nearest = (l) => (l.length ? l.reduce((b, x) => (Math.hypot(x.c.x - p.x, x.c.y - p.y) < Math.hypot(b.c.x - p.x, b.c.y - p.y) ? x : b)).j : null);
    const server = cabs.filter(x => U(x.c.ref) === 'SERVER-ROOM');
    if (m) { const want = m[1] === 'HK' ? 'HARICI' : 'IT';
      if (m[1] === 'K' && Number(m[2]) === 1 && server.length) return nearest(server);   // K1 = office building = server room
      let l = cabs.filter(x => { const c = cabNo(x.c); return c && c.n === String(Number(m[2])) && (c.kind || 'IT') === want; });
      if (!l.length) l = cabs.filter(x => { const c = cabNo(x.c); return c && c.n === String(Number(m[2])); });
      if (l.length) return nearest(l); }
    const sw = switchPort(p); if (!sw) return null;
    const loc = U(sw.dev.location);
    if (/MAIN RACK/.test(loc) && server.length) return nearest(server);
    return nearest(cabs.filter(x => { const c = cabNo(x.c); return c && new RegExp(`KABIN[\\s-]*0?${c.n}\\b`).test(loc); }));
  }
  function deviceOf(p) { const h = U(p.ref || p.label); return D().devices.find(x => x.hostname === h) || null; }
  function switchPort(p) {
    const d = deviceOf(p); if (!d) return null;
    const port = (D().ports || []).find(x => x.peer_host === d.hostname && x.device_id !== d.id); if (!port) return null;
    const dev = D().devices.find(x => x.id === port.device_id); return dev ? { dev, port } : null;
  }
  function links() { const out = []; pins.forEach((p, i) => { if (p.kind !== 'ap') return; const j = cabinetOf(p); if (j != null) out.push({ a: i, c: j }); }); return out; }
  const colOf = (j) => PAL[(Number((cabNo(pins[j]) || {}).n) || j) % PAL.length];
  // Fibre between cabinets (drawing links): outdoor ring orange, IT (48C) blue, CCTV (24C) purple.
  const pinByRef = (r) => pins.findIndex(p => U(p.ref || p.label) === U(r));
  const fibCol = (l) => (/HARICI/.test(l.a + l.b) ? '#ea580c' : /CCTV/.test(l.a + l.b) ? '#9333ea' : '#2563eb');
  const fibText = (l) => [l.name, l.cores, l.len ? l.len + ' m' : ''].filter(Boolean).join(' · ');
  const mid = (path) => { let tot = 0; const seg = []; for (let k = 1; k < path.length; k++) { const d = Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]); seg.push(d); tot += d; }
    let h = tot / 2; for (let k = 1; k < path.length; k++) { if (h <= seg[k - 1]) { const t = h / (seg[k - 1] || 1); return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * t, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * t]; } h -= seg[k - 1]; } return path[0]; };
  const swTip = (p) => { const l = cabSwitches(p); return l.length ? `\nSwitches: ${l.map(swName).join(', ')}` : ''; };
  function render() {
    const box = document.getElementById('pl-pins'); if (!box) return;
    const L = links(), on = new Set();
    const fref = focusI != null ? U(pins[focusI].ref || pins[focusI].label) : null;
    const fHot = fib.filter(l => fref && (U(l.a) === fref || U(l.b) === fref));
    if (focusI != null) { on.add(focusI); for (const l of L) if (l.a === focusI || l.c === focusI) { on.add(l.a); on.add(l.c); }
      for (const l of fHot) [l.a, l.b].forEach(r => { const j = pinByRef(r); if (j >= 0) on.add(j); }); }
    document.getElementById('pl-lines').innerHTML = cables ? L.map(l => { const a = pins[l.a], c = pins[l.c], hot = focusI != null && (l.a === focusI || l.c === focusI);
      return `<path d="M${a.x} ${a.y} H${c.x} V${c.y}" class="pl-cable${hot ? ' hot' : focusI != null ? ' dim' : ''}" style="stroke:${colOf(l.c)}"/>`; }).join('')
      + fib.map(l => { const hot = fHot.includes(l); return `<polyline points="${l.path.map(p => p.join(',')).join(' ')}" class="pl-fib${hot ? ' hot' : focusI != null ? ' dim' : ''}" style="stroke:${fibCol(l)}"/>`; }).join('') : '';
    // Labels never cover each other: place them one by one (top to bottom); a label that would overlap one already
    // placed slides down in steps (a thin line keeps it tied to its pin). E.g. the IT + CCTV cabinet pairs.
    const img = document.getElementById('pl-img'), W = img.clientWidth || 1000, H = img.clientHeight || 600;
    const off = pins.map(() => ({ dx: 0, dy: 0 })), placed = [];
    const hit = (r) => placed.some(q => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
    pins.forEach(p => { const px = p.x / 100 * W, py = p.y / 100 * H; placed.push([px - 10, py - 40, px + 10, py - 17]); });   // the pins' icons
    // Many cameras: their names show only when zoomed in (or hovered / red / chosen), so the plan stays readable.
    const camQuiet = pins.filter(p => p.kind === 'camera').length > 60 && zoom < 0.55;
    const quiet = (i) => camQuiet && pins[i].kind === 'camera' && focusI !== i;
    pins.map((p, i) => i).filter(i => !quiet(i)).sort((a, c) => pins[a].y - pins[c].y || pins[a].x - pins[c].x).forEach(i => {
      const p = pins[i], px = p.x / 100 * W, py = p.y / 100 * H, w = String(p.label).length * 6.6 + 14;
      let dy = 0;
      for (let k = 0; k < 10; k++) { const r = [px - w / 2, py - 16 + dy, px + w / 2, py + dy]; if (!hit(r)) { placed.push(r); break; } dy += 17; if (k === 9) placed.push(r); }
      off[i].dy = dy;
    });
    const camBad = camCheck().bad;
    box.innerHTML = pins.map((p, i) => { const k = KIND[p.kind] || KIND.note;
      return `<div class="pl-pin${focusI != null ? (on.has(i) ? ' on' : ' dim') : ''}${off[i].dy ? ' fan' : ''}${camBad.has(i) ? ' bad' : ''}${quiet(i) ? ' quiet' : ''}" data-i="${i}" style="left:${p.x}%;top:${p.y}%;--dy:${off[i].dy}px;--c:${p.kind === 'cabinet' && cables ? colOf(i) : k[1]}" title="${esc(k[2] + ': ' + p.label + (p.ref ? ' → ' + p.ref : '') + (p.kind === 'cabinet' ? swTip(p) : ''))}"><span class="pl-dot">${icoOf(p.kind, k)}</span><span class="pl-lbl">${esc(p.label)}</span></div>`; }).join('');
    const cnt = Object.keys(KIND).map(k => [k, pins.filter(p => p.kind === k).length]).filter(([, n]) => n);
    document.getElementById('pl-sum').textContent = cnt.length ? ' · ' + cnt.map(([k, n]) => `${n} ${KIND[k][2].toLowerCase()}${n > 1 ? 's' : ''}`).join(' · ') : ' · no pins yet';
    // Cameras: pins whose name is not in the camera list (or twice on the drawing) are red; cameras of the list not on it.
    const cc = camCheck();
    if (cc.n) document.getElementById('pl-sum').insertAdjacentHTML('beforeend', `${cc.bad.size ? ` <button class="pl-cbad" onclick="NMPlans.nextBad()" title="Camera pins whose name is not in the camera list (Excel / NVR) or is on the drawing twice — click to go through them">⚠ ${cc.bad.size} camera pin${cc.bad.size > 1 ? 's' : ''} to check</button>` : ''}${cc.missing.length ? ` <button class="pl-cmiss" onclick="NMPlans.missing()" title="Cameras of the camera list that have no pin on this drawing">📷 ${cc.missing.length} not on the drawing</button>` : ''}`);
    // Length labels on the cables of the chosen cabinet (in the pin layer, so the text is not stretched).
    if (cables) box.insertAdjacentHTML('beforeend', fHot.filter(l => l.path.length > 1).map(l => { const m = mid(l.path); return `<div class="pl-flab" style="left:${m[0]}%;top:${m[1]}%;--c:${fibCol(l)}">${esc(fibText(l) || 'fibre')}</div>`; }).join(''));
    box.querySelectorAll('.pl-pin').forEach(el => bindPin(el));
  }
  function bindPin(el) {
    const i = Number(el.dataset.i);
    let drag = null;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = { moved: false }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag || !editing) return;
      const r = document.getElementById('pl-img').getBoundingClientRect();
      pins[i].x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); pins[i].y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
      el.style.left = pins[i].x + '%'; el.style.top = pins[i].y + '%'; drag.moved = true; dirty = true;
    });
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); const d = drag; drag = null; if (d && !d.moved) (editing ? editPin(i) : show(i)); });
  }
  // ── Popup on the plan (click a pin): AP → device, switch port, cabinet; cabinet → rack contents and its APs ──
  function show(i) { focusI = i; render(); info(i); }
  // The switches of a cabinet (by their location / rack items) and everything plugged into them — click a device to edit its port.
  function cabSwitches(p) {
    const c = cabNo(p); if (!c) return [];
    const kind = c.kind || 'IT';
    const re = kind === 'HARICI' ? new RegExp(`HARICI\\s*-?\\s*KABIN\\s*-?0?${c.n}\\b`) : kind === 'CCTV' ? new RegExp(`CCTV\\s*-?\\s*KABIN\\s*-?0?${c.n}\\b`) : new RegExp(`(^|[^A-Z])IT\\s*-?\\s*KABIN\\s*-?0?${c.n}\\b`);
    const name = U(p.ref || p.label).replace(/\s+/g, '-'), rk = racks && racks.racks.find(r => U(r.name) === name);
    const inRack = new Set(rk ? racks.items.filter(x => x.rack_id === rk.id && x.device_id).map(x => x.device_id) : []);
    // First switch of the cabinet first (K2_CCTV_01 before K2_CCTV_02), then by name.
    const nm = (d) => (/_CCTV_|^CCTV_/i.test(d.alias || '') ? d.alias : d.hostname);
    return D().devices.filter(d => /switch/i.test(d.role || '') && d.state !== 'retired' && !d.ot_context && (inRack.has(d.id) || re.test(U(d.location))))
      .sort((a, b) => (/_01$/.test(nm(b)) - /_01$/.test(nm(a))) || String(nm(a)).localeCompare(nm(b), undefined, { numeric: true }));
  }
  const swName = (d) => (/_CCTV_|^CCTV_/i.test(d.alias || '') && d.alias !== d.hostname ? `${d.hostname} · ${d.alias}` : d.hostname);
  // Its uplinks: ports cabled to another switch of the map (e.g. HK10_CCTV_02 GE 1/0/17 → HK10_CCTV_01).
  function uplinksOf(sw) {
    const byH = new Map(D().devices.map(d => [d.hostname, d]));
    return (D().ports || []).filter(p => p.device_id === sw.id && p.peer_host && byH.has(p.peer_host) && /switch/i.test(byH.get(p.peer_host).role || ''))
      .map(p => { const t = byH.get(p.peer_host); return `${p.port} → ${/_CCTV_|^CCTV_/i.test(t.alias || '') ? t.alias : t.hostname}${p.peer_port ? ' ' + p.peer_port : ''}`; });
  }
  function plugged(p) {
    const sws = cabSwitches(p);
    if (!sws.length) return '';
    const can = D().can.edit || D().can.port;
    return sws.map(sw => { const its = NM.endItems(sw);
      const up = uplinksOf(sw);
      return `<div class="pl-i-h">Plugged into ${esc(swName(sw))} (${its.length})</div>${up.length ? `<div class="text-muted text-sm" style="margin:0 0 3px">⬆ Uplink ${up.map(esc).join(' · ')}</div>` : ''}
        ${its.length ? `<div class="pl-i-ends">${its.map(e => `<a href="#" class="pl-i-end${e.ot ? ' ot' : ''}" title="${can ? 'Open / edit port ' : 'Port '}${esc(e.port)}${e.rec ? ' · Server Inventory #' + e.rec : ''}" onclick="${e.port ? `NM.openPort(${sw.id}, ${jsArg(e.port)})` : `NM.openRec(${e.rec})`};return false"><b>${esc(e.pn)}</b> ${e.icon} ${esc(e.name)}</a>`).join('')}</div>`
          : '<p class="text-muted text-sm" style="margin:2px 0">Nothing plugged in yet.</p>'}
        <div class="pl-i-b" style="margin-top:4px"><button class="btn btn-ghost btn-sm" onclick="NMPlans.dev(${sw.id})">🔷 All ports of ${esc(sw.hostname)}</button></div>`; }).join('')
      + (can ? '<p class="text-muted text-sm" style="margin:6px 0 0">Click a device to change its port (name, VLAN, note …) right here.</p>' : '');
  }
  const row = (k, v) => (v ? `<div class="pl-i-r"><span>${k}</span><b>${esc(v)}</b></div>` : '');
  function info(i) {
    const box = document.getElementById('pl-info'); if (!box) return;
    if (i == null) { box.hidden = true; return; }
    const p = pins[i], k = KIND[p.kind] || KIND.note, L = links();
    let body = '';
    if (p.kind === 'cabinet') {
      const name = U(p.ref || p.label).replace(/\s+/g, '-');
      const rk = racks && racks.racks.find(r => U(r.name) === name);
      const items = rk ? racks.items.filter(x => x.rack_id === rk.id).sort((a, b) => b.u - a.u) : [];
      const aps = L.filter(l => l.c === i).map(l => l.a);
      const me = U(p.ref || p.label), mine = fib.filter(l => U(l.a) === me || U(l.b) === me);
      const fibHtml = mine.length ? `<div class="pl-i-h">Fibre cables (${mine.length})</div>${mine.map(l => { const o = U(l.a) === me ? l.b : l.a, j = pinByRef(o);
        return `<div class="pl-i-fib"><span class="pl-i-sw" style="background:${fibCol(l)}"></span>${j >= 0 ? `<a href="#" onclick="NMPlans.pin(${j});return false">${esc(pins[j].label)}</a>` : esc(o)} <span class="text-muted">${esc(fibText(l))}</span></div>`; }).join('')}` : '';
      body = `${row('Rack', rk ? rk.name : name)}${row('Area', rk && rk.area)}${row('Notes', rk && rk.notes)}
        ${fibHtml}
        ${me === 'SERVER-ROOM' ? `<p class="text-sm" style="margin:8px 0 0">Main racks <b>MR-01 … MR-04</b> (office building) — all fibre starts here.</p>` : items.length ? `<div class="pl-i-h">In the cabinet</div>${items.map(x => { const d = x.device_id && D().devices.find(z => z.id === x.device_id);
          return `<div class="pl-i-it">${d ? `<a href="#" onclick="NMPlans.dev(${d.id});return false">${esc(d.hostname)}</a> <span class="text-muted">${esc(d.mgmt_ip || '')}</span>` : esc(x.label || x.kind)} <span class="text-muted">U${x.u}${x.height > 1 ? '–' + (x.u + x.height - 1) : ''}</span></div>`; }).join('')}` : `<p class="text-muted text-sm">${racks ? 'This cabinet is not in the Racks list.' : 'Loading the rack…'}</p>`}
        ${plugged(p)}
        ${aps.length ? `<div class="pl-i-h">Access points cabled here (${aps.length})</div><div class="pl-i-chips">${aps.map(a => `<a href="#" onclick="NMPlans.pin(${a});return false">${esc(pins[a].label)}</a>`).join('')}</div>` : ''}
        <div class="pl-i-b"><button class="btn btn-ghost btn-sm" onclick="NMPlans.rack(${i})">🗄 Open in Racks</button></div>`;
    } else if (p.kind === 'camera') {
      // A camera of the CCTV drawing → its Server Inventory record (picture, IP, switch port), filled in below.
      const rec = camRec(p), why = camCheck().bad.get(i);
      body = (why ? camFix(i, why) : '') + (rec ? `<div id="pl-cam" data-id="${rec.id}"><p class="text-muted text-sm">Loading…</p></div>` : '');
      if (rec) setTimeout(() => camFill(rec), 0);
    } else {
      const d = deviceOf(p), sw = switchPort(p), cj = L.find(l => l.a === i);
      // Check: the cabinet in the AP name vs the cabinet its switch is in.
      const nm = U(p.label).match(/^(HK|K)(\d+)-A/), swCab = sw ? (U(sw.dev.location).match(/KABIN[\s-]*0?(\d+)/) || [])[1] : null;
      const warn = !d ? 'Not a device in the map — not in the AP list / port sheets.' : !sw ? 'No switch port is cabled to it in the map.'
        : nm && nm[1] === 'K' && nm[2] !== '1' && swCab && String(Number(nm[2])) !== swCab ? `The name says cabinet ${Number(nm[2])}, but its switch ${sw.dev.hostname} is in KABIN ${swCab}.` : '';
      body = `${warn && D().can.edit ? `<div class="pl-i-warn">⚠ ${esc(warn)}</div>` : ''}${d ? `${row('Device', d.hostname)}${row('Model', d.model)}${row('IP', d.mgmt_ip)}${row('MAC', d.mac)}${row('Serial', d.serial)}${row('Location', d.location)}${d.state === 'retired' ? row('State', 'Retired') : ''}`
          : `<p class="text-muted text-sm">${esc(p.ref || p.label)} is not a device of the map${p.ref ? '' : ' (no link set on this pin)'}.</p>`}
        ${sw ? `<div class="pl-i-h">Cabled to</div>${row('Switch', sw.dev.hostname)}${row('Port', sw.port.port)}${row('VLAN', sw.port.vlan)}${row('Patch / note', [sw.port.patch, sw.port.note].filter(Boolean).join(' · '))}${row('Switch location', sw.dev.location)}` : ''}
        ${cj ? `<div class="pl-i-h">Cabinet</div><div class="pl-i-chips"><a href="#" onclick="NMPlans.pin(${cj.c});return false" style="border-color:${colOf(cj.c)}">${esc(pins[cj.c].label)}</a></div>` : ''}
        ${d ? `<div class="pl-i-b"><button class="btn btn-ghost btn-sm" onclick="NMPlans.dev(${d.id})">🔷 Ports in the map</button></div>` : ''}`;
    }
    const also = elsewhere(p);
    if (also.length) body += `<div class="pl-i-h">Also on</div><div class="pl-i-b" style="margin-top:2px;flex-wrap:wrap">${also.map(x => `<button class="btn btn-ghost btn-sm" onclick="NMPlans.goto(${x.id}, ${jsArg(p.ref || p.label)})">📄 ${esc(short(x.name))}</button>`).join('')}</div>`;
    box.innerHTML = `<div class="pl-i-t"><span>${icoOf(p.kind, k)}</span><b>${esc(p.label)}</b><span class="text-muted text-sm">${esc(k[2])}</span><span style="flex:1"></span><button class="modal-close" aria-label="Close" onclick="NMPlans.unfocus()">✕</button></div>${body}`;
    box.hidden = false;
  }
  // Camera pins: K1-01 on the drawing = K1-1 in the camera list.
  const camKey = (n) => U(n).replace(/\s+/g, '').replace(/-0+(\d)/, '-$1');
  const camRec = (p) => (D().records || []).find(r => camKey(r.hostname) === camKey(p.ref || p.label));
  // Camera pins to check: no camera of that name in the list, or the same camera twice on the drawing.
  function camCheck() {
    const cams = pins.map((p, i) => [p, i]).filter(([p]) => p.kind === 'camera');
    const bad = new Map(), seen = new Map();
    const noName = (p) => !p.ref && /^NO NAME$/i.test(p.label || '');
    for (const [p, i] of cams) { if (noName(p)) { bad.set(i, 'noname'); continue; } const k = camKey(p.ref || p.label); if (seen.has(k)) { bad.set(i, 'twice'); bad.set(seen.get(k), 'twice'); } else seen.set(k, i); }
    for (const [p, i] of cams) if (!bad.has(i) && !camRec(p)) bad.set(i, 'unknown');
    const camList = (D().records || []).filter(r => /camera/i.test(r.category || ''));
    const missing = cams.length ? camList.filter(r => !seen.has(camKey(r.hostname))).sort((a, b) => String(a.hostname).localeCompare(b.hostname, undefined, { numeric: true })) : [];
    return { n: cams.length, bad, missing };
  }
  const canFixCam = () => !!(D().can.edit || D().can.port);
  // The fix form in a red pin's popup: choose the camera it really is (cameras without a pin first).
  function camFix(i, why) {
    const p = pins[i], cc = camCheck(), name = p.ref || p.label;
    const msg = why === 'noname' ? 'This camera has no name on the drawing.' : why === 'twice' ? `<b>${esc(name)}</b> is on this drawing twice — one of them is another camera.` : `<b>${esc(name)}</b> is not in the camera list (Excel / NVR).`;
    return `<div class="pl-i-warn">⚠ ${msg} The drawing (CAD) and the camera list are not always updated together — ${canFixCam() ? 'choose the camera it really is:' : 'ask an editor to correct it.'}</div>
      ${canFixCam() ? `<div style="display:flex;gap:6px;margin:6px 0"><input class="form-control" id="pl-cfix" list="pl-cfix-l" placeholder="camera name, e.g. ${esc(cc.missing[0] ? cc.missing[0].hostname : 'K2-23')}">
        <datalist id="pl-cfix-l">${[...cc.missing, ...(D().records || []).filter(r => /camera/i.test(r.category || '') && !cc.missing.includes(r))].map(r => `<option value="${esc(r.hostname)}">${cc.missing.includes(r) ? 'not on the drawing' : ''}</option>`).join('')}</datalist>
        <button class="btn btn-primary btn-sm" onclick="NMPlans.fixCam(${i})">Save</button></div>
        ${cc.missing.length ? `<div class="text-muted text-sm">Not on the drawing yet: ${cc.missing.slice(0, 12).map(r => `<a href="#" onclick="document.getElementById('pl-cfix').value=${esc(jsArg(r.hostname))};return false">${esc(r.hostname)}</a>`).join(', ')}${cc.missing.length > 12 ? ' …' : ''}</div>` : ''}
        <p class="text-muted text-sm" style="margin:6px 0 0">If the drawing is right, correct the name in the camera list / on the NVR instead (the pin turns normal by itself).</p>` : ''}`;
  }
  async function fixCam(i) {
    const v = (document.getElementById('pl-cfix').value || '').trim(); if (!v) return showToast('Choose the camera', 'error');
    const rec = (D().records || []).find(r => camKey(r.hostname) === camKey(v));
    if (!rec && !confirm(`${v} is not in the camera list either. Save the pin as ${v} anyway?`)) return;
    try { const r = await apiPut(`/api/netmap/drawing/${cur.id}/camera-pin`, { i, old: pins[i].ref || pins[i].label, label: rec ? rec.hostname : v.toUpperCase(), ref: rec ? rec.hostname : v.toUpperCase() });
      pins[i] = r.pin; cur.pins = JSON.stringify(pins); showToast(`Pin saved as ${r.pin.label}`); render(); show(i); }
    catch (e) { showToast(errText(e, 'Could not save'), 'error'); }
  }
  let badAt = -1;
  function nextBad() { const l = [...camCheck().bad.keys()].sort((a, b) => a - b); if (!l.length) return; badAt = l.find(x => x > badAt) ?? l[0];
    show(badAt); setTimeout(() => { const el = document.querySelector(`.pl-pin[data-i="${badAt}"]`); if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }, 30); }
  function missing() {
    const l = camCheck().missing, box = document.getElementById('pl-info'); focusI = null; render();
    box.innerHTML = `<div class="pl-i-t"><span>📷</span><b>${l.length} camera${l.length > 1 ? 's' : ''} not on this drawing</b><span style="flex:1"></span><button class="modal-close" aria-label="Close" onclick="NMPlans.unfocus()">✕</button></div>
      <p class="text-muted text-sm" style="margin:4px 0 8px">In the camera list but no pin here: new cameras not drawn yet, or a red pin with the wrong name — open a red pin to correct it.</p>
      <div class="pl-i-chips">${l.map(r => `<a href="#" onclick="NM.openRec(${r.id});return false">${esc(r.hostname)}</a>`).join('')}</div>`;
    box.hidden = false;
  }
  async function camFill(rec) {
    const el = document.getElementById('pl-cam'); if (!el || Number(el.dataset.id) !== rec.id) return;
    let s; try { s = await apiGet('/api/servers/' + rec.id); } catch { el.innerHTML = '<p class="text-muted text-sm">Not available.</p>'; return; }
    const sp = String(s.switch_port || '').trim(), m = sp.match(/^(\S+)\s+(.+)$/), sw = D().devices.find(d => d.hostname === (m ? m[1] : sp));
    const can = D().can.edit || D().can.port;
    el.innerHTML = `<img class="nm-rec-img" src="/api/servers/${s.id}/photo" alt="" onerror="this.remove()" style="max-height:170px">
      ${row('Name', s.hostname)}${row('Area', s.role)}${row('Model', s.brand_model)}${row('IP', s.ip_address)}${row('MAC', s.mac)}${row('Status', s.status)}${row('Firmware', s.os)}
      <div class="pl-i-h">Connected to</div>${sw ? row('Switch', `${sw.hostname}${sw.alias ? ' · ' + sw.alias : ''}`) : ''}${row('Port', m ? m[2] : sp ? 'not known yet' : '')}${!sp ? '<p class="text-muted text-sm">No switch yet.</p>' : ''}
      <div class="pl-i-b" style="margin-top:6px;flex-wrap:wrap">${sw && m ? `<button class="btn btn-ghost btn-sm" onclick="NM.openPort(${sw.id}, ${jsArg(m[2])})">🔌 ${can ? 'Edit' : 'Open'} port</button>` : ''}
        ${sw ? `<button class="btn btn-ghost btn-sm" onclick="NMPlans.dev(${sw.id})">🔷 Switch</button>` : ''}<button class="btn btn-ghost btn-sm" onclick="NM.openRec(${s.id})">📦 Record</button></div>`;
  }
  // Leave the plan for the map / racks only when asked (buttons in the popup).
  function go(p) {
    if (p.kind === 'cabinet') { const name = (p.ref || p.label).toUpperCase().replace(/\s+/g, '-'); close(); document.querySelector('[data-v=rack]').click();
      setTimeout(() => { const r = [...document.querySelectorAll('.rk-name')].find(t => t.textContent.toUpperCase() === name || name.includes(t.textContent.toUpperCase())); if (r) { r.scrollIntoView({ behavior: 'smooth', block: 'center' }); r.closest('.rk').classList.add('rk-hl'); setTimeout(() => r.closest('.rk').classList.remove('rk-hl'), 2500); } }, 700); return; }
    const dev = D().devices.find(x => x.hostname === (p.ref || p.label).toUpperCase());
    if (dev) { close(); NM.select(dev.id, true); return; }
    showToast(`${(KIND[p.kind] || KIND.note)[2]}: ${p.label}${p.ref ? ' · ' + p.ref : ''}`);
  }
  function pinForm(p, onOk, onDel) {
    const hosts = D().devices.map(d => d.hostname).sort();
    const racks = [...document.querySelectorAll('.rk-name')].map(t => t.textContent);
    document.getElementById('nm-dev-t').textContent = p.label ? `Pin — ${p.label}` : 'New pin';
    document.getElementById('nm-dev-b').innerHTML = `<div class="qe-grid">
      <div class="form-group"><label class="form-label">Kind</label><select class="form-control" id="pn-kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === p.kind ? ' selected' : ''}>${v[0]} ${v[2]}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Label</label><input class="form-control" id="pn-label" value="${esc(p.label || '')}" placeholder="e.g. IT-KABIN5, K2-AP1"></div>
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Links to (device hostname or rack name — optional)</label><input class="form-control" id="pn-ref" list="pn-refs" value="${esc(p.ref || '')}">
        <datalist id="pn-refs">${[...new Set([...hosts, ...racks, 'IT-KABIN2', 'IT-KABIN3', 'IT-KABIN4', 'IT-KABIN5', 'IT-KABIN6', 'IT-KABIN7', 'IT-KABIN8', 'IT-KABIN9', 'IT-KABIN10', 'IT-KABIN11', 'HARICI-KABIN12'])].map(h => `<option value="${esc(h)}">`).join('')}</datalist></div></div>`;
    document.getElementById('nm-dev-f').innerHTML = `${onDel ? '<button class="btn btn-danger" id="pn-del" style="margin-right:auto">Remove</button>' : ''}<button class="btn btn-ghost" onclick="document.getElementById('nm-dev-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" id="pn-ok">OK</button>`;
    document.getElementById('pn-ok').onclick = () => { onOk({ ...p, kind: document.getElementById('pn-kind').value, label: document.getElementById('pn-label').value.trim(), ref: document.getElementById('pn-ref').value.trim() }); document.getElementById('nm-dev-ov').classList.remove('open'); };
    if (onDel) document.getElementById('pn-del').onclick = () => { onDel(); document.getElementById('nm-dev-ov').classList.remove('open'); };
    const ov = document.getElementById('nm-dev-ov'); ov.classList.add('open'); ov.style.zIndex = 3000;
    // Guess the kind from what is typed.
    document.getElementById('pn-label').addEventListener('input', (e) => { const v = e.target.value.toUpperCase();
      document.getElementById('pn-kind').value = D().devices.some(d => d.hostname === v) ? 'device' : /KABIN|RACK|^MR-0\d$/.test(v) ? 'cabinet' : /AP\d|-AP/.test(v) ? 'ap' : /^(HK|K)\d+-\d+R?$/.test(v) ? 'camera' : document.getElementById('pn-kind').value; });
  }
  function addPin(x, y) { pinForm({ x, y, kind: 'ap', label: '' }, (p) => { if (!p.label) return; pins.push(p); dirty = true; render(); }); }
  function editPin(i) { pinForm(pins[i], (p) => { pins[i] = p; dirty = true; render(); }, () => { pins.splice(i, 1); dirty = true; render(); }); }
  async function save() {
    try { await apiPut('/api/netmap/drawing/' + cur.id, { pins }); cur.pins = JSON.stringify(pins); dirty = false; showToast(`${pins.length} pins saved`); }
    catch { showToast('Could not save the pins', 'error'); }
  }
  function close() {
    if (dirty && !confirm('Pins changed but not saved. Close anyway?')) return;
    document.getElementById('pl-ov').hidden = true; dirty = false;
  }
  return { open, close, save, pin: show, fixCam, nextBad, missing, unfocus: () => { focusI = null; info(null); render(); },
    dev: (id) => { close(); NM.select(id, true); }, rack: (i) => go(pins[i]), edit: (on) => { editing = on; tools(); document.getElementById('pl-stage').classList.toggle('editing', on); }, zoomBy: (f) => { zoom = Math.max(0.15, Math.min(4, zoom * f)); applyZoom(); render(); },
    goto: (id, ref) => open(id, null, ref), refresh: () => { if (focusI != null && !document.getElementById('pl-ov').hidden) info(focusI); } };
})();
