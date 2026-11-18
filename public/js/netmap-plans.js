/* Network map → floor plans: a drawing (fiber layout, AP layout of an area …) shown large, with pins on it.
   Pins: 🗄 cabinet / rack (opens it in the Racks tab), 📶 access point, 🔷 network device (opens its ports),
   📝 note. Editors click the picture to add a pin, drag a pin to move it, click a pin to change / remove it.
   Pins are stored on the drawing (net_drawings.pins, x / y in % of the picture). */

const NMPlans = self.NMPlans = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KIND = { cabinet: ['🗄', '#0e7490', 'Cabinet / rack'], ap: ['📶', '#dc2626', 'Access point'], device: ['🔷', '#1d4ed8', 'Network device'], note: ['📝', '#7c3aed', 'Note'] };
  let cur = null, pins = [], dirty = false, zoom = 1, editing = false, cables = localStorage.getItem('pl-cables') !== '0', focusI = null, racks = null;
  const PAL = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#be123c', '#7c3aed'];
  const D = () => NM.data();

  function ui() {
    if (document.getElementById('pl-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="pl-ov" id="pl-ov" hidden><div class="pl-top">
        <b id="pl-t"></b><span class="text-sm" id="pl-sum" style="opacity:.8"></span><span style="flex:1"></span>
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
  function open(id, drawings) {
    const d = (drawings || []).find(x => x.id === id); if (!d) return false;
    ui(); cur = d; zoom = 1; dirty = false; editing = false; focusI = null; info(null);
    if (!racks) apiGet('/api/netmap/racks?site=' + encodeURIComponent(D().site)).then(r => { racks = r; }).catch(() => { racks = { racks: [], items: [] }; });
    try { pins = JSON.parse(d.pins || '[]'); } catch { pins = []; }
    document.getElementById('pl-t').textContent = d.name;
    document.getElementById('pl-img').src = '/api/netmap/drawing/' + d.id;
    document.getElementById('pl-img').onload = () => { fitWidth(); render(); };
    document.getElementById('pl-ov').hidden = false;
    tools(); render();
    return true;
  }
  function tools() {
    const can = D().can.edit;
    document.getElementById('pl-edit-tools').innerHTML = can ? (editing
      ? `<span class="text-sm">Click the picture to add a pin · drag to move</span><button class="btn btn-primary btn-sm" onclick="NMPlans.save()">💾 Save pins</button><button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.edit(false)">Done</button>`
      : `<button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.edit(true)">📍 Edit pins</button>`) : '';
  }
  function fitWidth() { const sc = document.getElementById('pl-scroll'), img = document.getElementById('pl-img'); if (!img.naturalWidth) return; zoom = Math.min(1, (sc.clientWidth - 20) / img.naturalWidth) || 1; applyZoom(); }
  function applyZoom() { const img = document.getElementById('pl-img'); img.style.width = Math.round(img.naturalWidth * zoom) + 'px'; }
  // ── Cables: AP "K7-A5" = AP 5 of cabinet 7 → IT KABIN 7 (HK12-A1 → HARICI KABIN 12); otherwise the switch port the
  //    AP is cabled to in the map, and the cabinet that switch is in.
  const U = (s) => String(s || '').toUpperCase();
  const cabNo = (p) => { const m = U(p.ref || p.label).match(/(HARICI|IT|CCTV)?[\s-]*KABIN[\s-]*(\d+)/); return m ? { kind: m[1] || '', n: m[2] } : null; };
  function cabinetOf(p) {
    const m = U(p.label).match(/^(HK|K)(\d+)-A/) || U(p.ref).match(/^(HK|K)(\d+)-AP/);
    const cabs = pins.map((c, j) => ({ c, j })).filter(x => x.c.kind === 'cabinet');
    if (m) { const want = m[1] === 'HK' ? 'HARICI' : 'IT';
      const hit = cabs.find(x => { const c = cabNo(x.c); return c && c.n === String(Number(m[2])) && (c.kind || 'IT') === want; }) || cabs.find(x => { const c = cabNo(x.c); return c && c.n === String(Number(m[2])); });
      if (hit) return hit.j; }
    const sw = switchPort(p); if (!sw) return null;
    const loc = U(sw.dev.location);
    const hit = cabs.find(x => { const c = cabNo(x.c); return c && new RegExp(`KABIN[\\s-]*0?${c.n}\\b`).test(loc); });
    return hit ? hit.j : null;
  }
  function deviceOf(p) { const h = U(p.ref || p.label); return D().devices.find(x => x.hostname === h) || null; }
  function switchPort(p) {
    const d = deviceOf(p); if (!d) return null;
    const port = (D().ports || []).find(x => x.peer_host === d.hostname && x.device_id !== d.id); if (!port) return null;
    const dev = D().devices.find(x => x.id === port.device_id); return dev ? { dev, port } : null;
  }
  function links() { const out = []; pins.forEach((p, i) => { if (p.kind !== 'ap') return; const j = cabinetOf(p); if (j != null) out.push({ a: i, c: j }); }); return out; }
  const colOf = (j) => PAL[(Number((cabNo(pins[j]) || {}).n) || j) % PAL.length];
  function render() {
    const box = document.getElementById('pl-pins'); if (!box) return;
    const L = links(), on = new Set();
    if (focusI != null) { on.add(focusI); for (const l of L) if (l.a === focusI || l.c === focusI) { on.add(l.a); on.add(l.c); } }
    document.getElementById('pl-lines').innerHTML = cables ? L.map(l => { const a = pins[l.a], c = pins[l.c], hot = focusI != null && (l.a === focusI || l.c === focusI);
      return `<path d="M${a.x} ${a.y} H${c.x} V${c.y}" class="pl-cable${hot ? ' hot' : focusI != null ? ' dim' : ''}" style="stroke:${colOf(l.c)}"/>`; }).join('') : '';
    box.innerHTML = pins.map((p, i) => { const k = KIND[p.kind] || KIND.note;
      return `<div class="pl-pin${focusI != null ? (on.has(i) ? ' on' : ' dim') : ''}" data-i="${i}" style="left:${p.x}%;top:${p.y}%;--c:${p.kind === 'cabinet' && cables ? colOf(i) : k[1]}" title="${esc(k[2] + ': ' + p.label + (p.ref ? ' → ' + p.ref : ''))}"><span class="pl-dot">${k[0]}</span><span class="pl-lbl">${esc(p.label)}</span></div>`; }).join('');
    const cnt = Object.keys(KIND).map(k => [k, pins.filter(p => p.kind === k).length]).filter(([, n]) => n);
    document.getElementById('pl-sum').textContent = cnt.length ? ' · ' + cnt.map(([k, n]) => `${n} ${KIND[k][2].toLowerCase()}${n > 1 ? 's' : ''}`).join(' · ') : ' · no pins yet';
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
      body = `${row('Rack', rk ? rk.name : name)}${row('Area', rk && rk.area)}${row('Notes', rk && rk.notes)}
        ${items.length ? `<div class="pl-i-h">In the cabinet</div>${items.map(x => { const d = x.device_id && D().devices.find(z => z.id === x.device_id);
          return `<div class="pl-i-it">${d ? `<a href="#" onclick="NMPlans.dev(${d.id});return false">${esc(d.hostname)}</a> <span class="text-muted">${esc(d.mgmt_ip || '')}</span>` : esc(x.label || x.kind)} <span class="text-muted">U${x.u}${x.height > 1 ? '–' + (x.u + x.height - 1) : ''}</span></div>`; }).join('')}` : `<p class="text-muted text-sm">${racks ? 'This cabinet is not in the Racks list.' : 'Loading the rack…'}</p>`}
        ${aps.length ? `<div class="pl-i-h">Access points cabled here (${aps.length})</div><div class="pl-i-chips">${aps.map(a => `<a href="#" onclick="NMPlans.pin(${a});return false">${esc(pins[a].label)}</a>`).join('')}</div>` : ''}
        <div class="pl-i-b"><button class="btn btn-ghost btn-sm" onclick="NMPlans.rack(${i})">🗄 Open in Racks</button></div>`;
    } else {
      const d = deviceOf(p), sw = switchPort(p), cj = L.find(l => l.a === i);
      body = `${d ? `${row('Device', d.hostname)}${row('Model', d.model)}${row('IP', d.mgmt_ip)}${row('MAC', d.mac)}${row('Serial', d.serial)}${row('Location', d.location)}${d.state === 'retired' ? row('State', 'Retired') : ''}`
          : `<p class="text-muted text-sm">${esc(p.ref || p.label)} is not a device of the map${p.ref ? '' : ' (no link set on this pin)'}.</p>`}
        ${sw ? `<div class="pl-i-h">Cabled to</div>${row('Switch', sw.dev.hostname)}${row('Port', sw.port.port)}${row('VLAN', sw.port.vlan)}${row('Patch / note', [sw.port.patch, sw.port.note].filter(Boolean).join(' · '))}${row('Switch location', sw.dev.location)}` : ''}
        ${cj ? `<div class="pl-i-h">Cabinet</div><div class="pl-i-chips"><a href="#" onclick="NMPlans.pin(${cj.c});return false" style="border-color:${colOf(cj.c)}">${esc(pins[cj.c].label)}</a></div>` : ''}
        ${d ? `<div class="pl-i-b"><button class="btn btn-ghost btn-sm" onclick="NMPlans.dev(${d.id})">🔷 Ports in the map</button></div>` : ''}`;
    }
    box.innerHTML = `<div class="pl-i-t"><span>${k[0]}</span><b>${esc(p.label)}</b><span class="text-muted text-sm">${esc(k[2])}</span><span style="flex:1"></span><button class="modal-close" aria-label="Close" onclick="NMPlans.unfocus()">✕</button></div>${body}`;
    box.hidden = false;
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
      document.getElementById('pn-kind').value = D().devices.some(d => d.hostname === v) ? 'device' : /KABIN|RACK|^MR-0\d$/.test(v) ? 'cabinet' : /AP\d|-AP/.test(v) ? 'ap' : document.getElementById('pn-kind').value; });
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
  return { open, close, save, pin: show, unfocus: () => { focusI = null; info(null); render(); },
    dev: (id) => { close(); NM.select(id, true); }, rack: (i) => go(pins[i]), edit: (on) => { editing = on; tools(); document.getElementById('pl-stage').classList.toggle('editing', on); }, zoomBy: (f) => { zoom = Math.max(0.15, Math.min(4, zoom * f)); applyZoom(); } };
})();
