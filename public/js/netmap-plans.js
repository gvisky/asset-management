/* Network map → floor plans: a drawing (fiber layout, AP layout of an area …) shown large, with pins on it.
   Pins: 🗄 cabinet / rack (opens it in the Racks tab), 📶 access point, 🔷 network device (opens its ports),
   📝 note. Editors click the picture to add a pin, drag a pin to move it, click a pin to change / remove it.
   Pins are stored on the drawing (net_drawings.pins, x / y in % of the picture). */

const NMPlans = self.NMPlans = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KIND = { cabinet: ['🗄', '#0e7490', 'Cabinet / rack'], ap: ['📶', '#dc2626', 'Access point'], device: ['🔷', '#1d4ed8', 'Network device'], note: ['📝', '#7c3aed', 'Note'] };
  let cur = null, pins = [], dirty = false, zoom = 1, editing = false;
  const D = () => NM.data();

  function ui() {
    if (document.getElementById('pl-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="pl-ov" id="pl-ov" hidden><div class="pl-top">
        <b id="pl-t"></b><span class="text-sm" id="pl-sum" style="opacity:.8"></span><span style="flex:1"></span>
        <span id="pl-edit-tools"></span>
        <button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.zoomBy(1.25)">＋</button><button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.zoomBy(0.8)">－</button>
        <button class="btn btn-ghost btn-sm pl-b" onclick="NMPlans.close()">✕ Close</button></div>
      <div class="pl-scroll" id="pl-scroll"><div class="pl-stage" id="pl-stage"><img id="pl-img" alt=""><div id="pl-pins"></div></div></div></div>`);
    document.getElementById('pl-stage').addEventListener('click', (e) => {
      if (!editing || e.target.closest('.pl-pin')) return;
      const r = document.getElementById('pl-img').getBoundingClientRect();
      addPin(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
    });
  }
  function open(id, drawings) {
    const d = (drawings || []).find(x => x.id === id); if (!d) return false;
    ui(); cur = d; zoom = 1; dirty = false; editing = false;
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
  function render() {
    const box = document.getElementById('pl-pins'); if (!box) return;
    box.innerHTML = pins.map((p, i) => { const k = KIND[p.kind] || KIND.note;
      return `<div class="pl-pin" data-i="${i}" style="left:${p.x}%;top:${p.y}%;--c:${k[1]}" title="${esc(k[2] + ': ' + p.label + (p.ref ? ' → ' + p.ref : ''))}"><span class="pl-dot">${k[0]}</span><span class="pl-lbl">${esc(p.label)}</span></div>`; }).join('');
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
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); const d = drag; drag = null; if (d && !d.moved) (editing ? editPin(i) : go(pins[i])); });
  }
  // Click a pin (not editing): cabinet → its rack, device → its ports.
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
  return { open, close, save, edit: (on) => { editing = on; tools(); document.getElementById('pl-stage').classList.toggle('editing', on); }, zoomBy: (f) => { zoom = Math.max(0.15, Math.min(4, zoom * f)); applyZoom(); } };
})();
