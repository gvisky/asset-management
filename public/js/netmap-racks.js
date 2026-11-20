/* Network map → Racks and Drawings tabs (routes/netmap.js /racks, /rack-item, /drawings).
   Racks: front view of every rack (server room MR-01…04, 42 U) and factory cabinet (IT-KABIN, 12 U), drawn from
   where the devices are (location "MAIN RACK - 03 (U29)"), plus patch panels, cable managers and PDUs. Click a
   device to open its ports; drag an item to another U or rack (editors). Drawings: the document's pictures. */

const NMRacks = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
  const $ = (id) => document.getElementById(id);
  const UH = 15, RW = 250, GAP = 34, TOP = 34;
  let R = { racks: [], items: [] }, drawings = [], showDrawing = false;

  const D = () => NM.data();
  const dev = (id) => D().devices.find(d => d.id === id);
  async function load() {
    const site = D().site;
    const v = D().view === 'ot' ? '&view=ot' : '';   // OT view: factory cabinets only, no server-room racks / pictures
    [R, drawings] = await Promise.all([apiGet('/api/netmap/racks?site=' + encodeURIComponent(site) + v).catch(() => ({ racks: [], items: [] })), apiGet('/api/netmap/drawings?site=' + encodeURIComponent(site) + v).catch(() => [])]);
  }

  // Face of one rack item (x, y = top-left, w, h in px).
  function face(it, x, y, w, h) {
    const d = it.device_id ? dev(it.device_id) : null;
    const role = d ? d.role : '';
    let body = '';
    const ports = (n, c, x0, y0, pw = 6) => Array.from({ length: n }, (_, i) => `<rect x="${x0 + i * (pw + 1.6)}" y="${y0}" width="${pw}" height="4.5" rx=".6" fill="${c}"/>`).join('');
    if (it.kind === 'patch') body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d4d4d8" stroke="#52525b"/>${Array.from({ length: Math.max(1, it.height) }, (_, r) => ports(24, '#27272a', x + 24, y + 5 + r * UH, 6.2)).join('')}`;
    else if (it.kind === 'cable') body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#3f3f46" stroke="#18181b"/>${Array.from({ length: 16 }, (_, i) => `<rect x="${x + 18 + i * 13}" y="${y + 3}" width="8" height="${h - 6}" rx="2" fill="#27272a"/>`).join('')}`;
    else if (it.kind === 'pdu') body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#18181b" stroke="#000"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${x + 40 + i * 22}" y="${y + 3}" width="13" height="${h - 6}" rx="2" fill="#3f3f46" stroke="#71717a"/>`).join('')}<text x="${x + 6}" y="${y + h - 4}" class="rk-small" fill="#a1a1aa">PDU</text>`;
    else if (it.kind === 'blank') body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#52525b" stroke="#27272a"/>`;
    else if (/HCI|Server|Backup/.test(role) || /R740|VXRAIL|DD/i.test(d ? d.model : '')) {
      body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#27272a" stroke="#09090b"/>` + Array.from({ length: h > UH ? 12 : 10 }, (_, i) => `<rect x="${x + w - 12 - (i + 1) * 15}" y="${y + 2}" width="13" height="${h - 4}" rx="1" fill="#3f3f46" stroke="#71717a" stroke-width=".6"/>`).join('');
    } else if (/Firewall/.test(role)) body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#7f1d1d" stroke="#450a0a"/>${ports(8, '#111', x + 120, y + h / 2 - 2, 8)}`;
    else if (d) { const sfp = /SFP|N3K|3548|3524/i.test(d.model);
      body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${sfp ? '#1e293b' : '#e4e4e7'}" stroke="#18181b"/>${ports(24, sfp ? '#94a3b8' : '#27272a', x + 30, y + 2.5)}${ports(24, sfp ? '#94a3b8' : '#27272a', x + 30, y + h - 7)}`; }
    else body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#71717a" stroke="#27272a"/>`;
    const lbl = d ? d.hostname + (d.state === 'retired' ? ' (retired)' : '') : it.label;
    const tag = lbl ? `<rect x="${x + w / 2 - Math.min(w - 20, lbl.length * 6.4 + 10) / 2}" y="${y + h / 2 - 6.5}" width="${Math.min(w - 20, lbl.length * 6.4 + 10)}" height="13" rx="2" fill="#000" opacity=".85"/>
      <text x="${x + w / 2}" y="${y + h / 2 + 3.6}" class="rk-lbl">${esc(lbl)}</text>` : '';
    // The device chosen in the list / map is outlined and blinks; a group shown in the list keeps its colour, the rest fades.
    const isSel = d && d.id === NM.selected(), g = NM.groupShown && NM.groupShown();
    const gcls = g ? (d && NM.groupOf(d) === g ? ' grp-on' : ' grp-dim') : '';
    const mark = isSel ? `<rect x="${x - 4}" y="${y - 3}" width="${w + 8}" height="${h + 6}" rx="3" class="rk-sel"/>` : d && g && NM.groupOf(d) === g ? `<rect x="${x - 3}" y="${y - 2}" width="${w + 6}" height="${h + 4}" rx="3" class="rk-grp" style="stroke:${NM.gcol(g)}"/>` : '';
    return `<g class="rk-item${it.device_id ? ' dev' : ''}${isSel ? ' sel' : ''}${gcls}" data-id="${it.id}">${mark}<title>${esc(lbl || it.kind)} · U${it.u}${it.height > 1 ? '–' + (it.u + it.height - 1) : ''}${d ? ' · ' + d.model : ''}</title>${body}${tag}</g>`;
  }
  function rackSvg(r, x0, y0) {
    const H = r.units * UH, items = R.items.filter(i => i.rack_id === r.id);
    const used = items.reduce((t, i) => t + i.height, 0);
    const has = NM.selected() && items.some(i => i.device_id === NM.selected());
    let s = `<g class="rk${has ? ' rk-has' : ''}" data-rack="${r.id}">${has ? `<rect x="${x0 - 8}" y="${y0 - 30}" width="${RW + 16}" height="${H + 58}" rx="8" class="rk-hl"/>` : ''}<text x="${x0 + RW / 2}" y="${y0 - 12}" class="rk-name">${esc(r.name)}</text>
      <text x="${x0 + RW / 2}" y="${y0 - 1}" class="rk-use">${used} / ${r.units} U used</text>
      <rect x="${x0}" y="${y0 + 4}" width="${RW}" height="${H + 16}" rx="4" fill="#3f3f46" stroke="#18181b" stroke-width="2"/>
      <rect x="${x0 + 26}" y="${y0 + 12}" width="${RW - 52}" height="${H}" fill="#f4f4f5"/>`;
    for (let u = 1; u <= r.units; u++) { const y = y0 + 12 + (r.units - u) * UH; s += `<text x="${x0 + 13}" y="${y + 11}" class="rk-u">${u}</text><line x1="${x0 + 26}" x2="${x0 + RW - 26}" y1="${y + UH}" y2="${y + UH}" stroke="#e4e4e7"/>`; }
    for (const it of items) s += face(it, x0 + 26, y0 + 12 + (r.units - (it.u + it.height - 1)) * UH, RW - 52, it.height * UH);
    return s + '</g>';
  }
  function render() {
    const box = $('nm-view-rack');
    if (!R.racks.length) {
      box.innerHTML = `<div class="empty-state" style="padding:30px">No racks yet.${D().can.admin ? ` <button class="btn btn-primary btn-sm" onclick="NMRacks.build(false)">⚙ Build racks from the device locations</button>` : ''}</div>`; return;
    }
    const main = R.racks.filter(r => r.kind !== 'cabinet'), cab = R.racks.filter(r => r.kind === 'cabinet');
    const W1 = main.length * (RW + GAP) + GAP, H1 = main.length ? Math.max(...main.map(r => r.units)) * UH + 70 : -22;   // no server room (OT view): cabinets at the top
    const per = Math.max(4, Math.floor(W1 / (RW + GAP)) || 4), rowsC = Math.ceil(cab.length / per), H2 = rowsC * (12 * UH + 80);
    const W = Math.max(W1, per * (RW + GAP) + GAP);
    let svg = main.length ? `<text x="${GAP}" y="20" class="rk-area">SERVER ROOM</text>` : '';
    main.forEach((r, i) => { svg += rackSvg(r, GAP + i * (RW + GAP), TOP + 20); });
    if (cab.length) { svg += `<text x="${GAP}" y="${H1 + 40}" class="rk-area">FACTORY CABINETS</text>`;
      cab.forEach((r, i) => { const c = i % per, row = Math.floor(i / per); svg += rackSvg(r, GAP + c * (RW + GAP), H1 + 70 + row * (12 * UH + 80)); }); }
    const unplaced = D().can.edit ? D().devices.filter(d => !R.items.some(i => i.device_id === d.id) && !['Access point', 'Printer'].includes(d.role) && d.state !== 'retired') : [];
    const rackDraw = drawings.filter(d => /rack/i.test(d.category + ' ' + d.name));
    box.innerHTML = `<div class="rk-bar">${D().can.edit ? `<button class="btn btn-ghost btn-sm" onclick="NMRacks.addItem()">+ Item (patch panel, PDU …)</button><button class="btn btn-ghost btn-sm" onclick="NMRacks.addRack()">+ Rack / cabinet</button>` : ''}
        ${D().can.admin ? `<button class="btn btn-ghost btn-sm" onclick="NMRacks.build(false)" title="Place devices that are not in a rack yet">⚙ Place new devices</button>` : ''}
        ${D().can.admin && cctvCount() ? `<button class="btn btn-ghost btn-sm" onclick="NMRacks.addCctv()" title="The CCTV switches are only labels in the racks: add them to the map as devices with ports, linked to their rack slot">📹 ${cctvFix() && cctvCount() === cctvFix() ? `Correct ${cctvFix()} CCTV switch${cctvFix() > 1 ? 'es' : ''} (ports / model)` : `Add ${cctvCount() - cctvFix()} CCTV switch${cctvCount() - cctvFix() > 1 ? 'es' : ''} to the map${cctvFix() ? ` · correct ${cctvFix()}` : ''}`}</button>` : ''}
        ${rackDraw.length ? `<label class="text-sm"><input type="checkbox" ${showDrawing ? 'checked' : ''} onchange="NMRacks.toggleDrawing(this.checked)"> 📄 Show the document's rack drawing</label>` : ''}
        <span class="text-muted text-sm">Click a device to see its ports${D().can.edit ? ' · click a patch panel / PDU to edit it' : ''}</span><span id="rk-where" class="rk-where"></span>
        ${unplaced.length ? `<span class="text-sm" style="margin-left:auto">Not in a rack: ${unplaced.slice(0, 6).map(d => `<a href="#" onclick="NMRacks.addItem(${d.id});return false">${esc(d.hostname)}</a>`).join(', ')}${unplaced.length > 6 ? ` +${unplaced.length - 6}` : ''}</span>` : ''}</div>
      ${showDrawing ? `<div class="rk-draw">${rackDraw.map(d => `<figure><img src="/api/netmap/drawing/${d.id}" alt="${esc(d.name)}"><figcaption>${esc(d.name)}</figcaption></figure>`).join('')}</div>` : ''}
      <div class="rk-wrap"><svg id="rk-svg" class="rk-svg" viewBox="0 0 ${W} ${H1 + 70 + H2}" style="width:100%;max-width:${W}px">${svg}</svg></div>`;
    bind();
    mark(false, true);
  }
  // Show the chosen device: its rack is framed, the item outlined, and scrolled into view.
  function mark(rerender, onlyScroll) {
    if (rerender !== false && !onlyScroll) { if (!R.racks.length) return; render(); return; }
    const sel = document.querySelector('#rk-svg .rk-item.sel');
    const info = $('rk-where');
    const d = NM.selected() && D().devices.find(x => x.id === NM.selected());
    if (info) {
      const it = d && R.items.find(i => i.device_id === d.id), rk = it && R.racks.find(r => r.id === it.rack_id);
      info.innerHTML = d ? (rk ? `📍 <b>${esc(d.hostname)}</b> is in <b>${esc(rk.name)}</b> U${it.u}${it.height > 1 ? '–' + (it.u + it.height - 1) : ''}${rk.area ? ' · ' + esc(rk.area) : ''}`
        : `📍 <b>${esc(d.hostname)}</b> is not in a rack${d.location ? ` (location: ${esc(d.location)})` : ''}${D().can.edit ? ` — <a href="#" onclick="NMRacks.addItem(${d.id});return false">place it</a>` : ''}`) : '';
    }
    if (sel) sel.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
  // Click only — moving items by dragging is switched off (an item's rack / U can still be changed in its edit form).
  function bind() {
    const svg = $('rk-svg'); if (!svg) return;
    svg.addEventListener('click', (e) => {
      const g = e.target.closest('.rk-item'); if (!g) return;
      const it = R.items.find(i => i.id === Number(g.dataset.id)); if (!it) return;
      if (it.device_id) { if (dev(it.device_id)) NM.select(it.device_id); else showToast((it.label || 'This device') + ' is not on the map', 'error'); }
      else if (it.kind === 'patch' && self.NMFaces && NMFaces.panelName(it.label) && NMFaces.panel(it.label)) { /* patch panel window */ }
      else if (D().can.edit) editItem(it.id);
    });
  }

  // Add / edit an item
  function itemForm(it) {
    const racks = R.racks, devs = D().devices.slice().sort((a, b) => a.hostname.localeCompare(b.hostname));
    $('nm-dev-t').textContent = it.id ? 'Rack item' : 'Add to a rack';
    $('nm-dev-b').innerHTML = `<div class="qe-grid">
      <div class="form-group"><label class="form-label">Rack</label><select class="form-control" id="ri-rack">${racks.map(r => `<option value="${r.id}"${r.id === it.rack_id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Kind</label><select class="form-control" id="ri-kind">${[['device', 'Network device / server'], ['patch', 'Patch panel'], ['cable', 'Cable manager'], ['pdu', 'PDU'], ['ups', 'UPS'], ['shelf', 'Shelf'], ['blank', 'Blank panel'], ['other', 'Other']].map(([k, l]) => `<option value="${k}"${k === it.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Device</label><select class="form-control" id="ri-dev"><option value="">—</option>${devs.map(d => `<option value="${d.id}"${d.id === it.device_id ? ' selected' : ''}>${esc(d.hostname)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Label</label><input class="form-control" id="ri-label" value="${esc(it.label || '')}" placeholder="e.g. MR01/PP03"></div>
      <div class="form-group"><label class="form-label">Bottom U</label><input class="form-control" id="ri-u" type="number" min="1" max="52" value="${it.u || 1}"></div>
      <div class="form-group"><label class="form-label">Height (U)</label><input class="form-control" id="ri-h" type="number" min="1" max="10" value="${it.height || 1}"></div></div>`;
    $('nm-dev-f').innerHTML = `${it.id ? `<button class="btn btn-danger" style="margin-right:auto" onclick="NMRacks.delItem(${it.id})">Remove</button>` : ''}
      <button class="btn btn-ghost" onclick="document.getElementById('nm-dev-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" onclick="NMRacks.saveItem(${it.id || 0})">Save</button>`;
    $('ri-dev').onchange = (e) => { if (e.target.value) $('ri-kind').value = 'device'; };
    $('nm-dev-ov').classList.add('open');
  }
  const editItem = (id) => itemForm(R.items.find(i => i.id === id));
  function addItem(deviceId) { if (!R.racks.length) { showToast('Build the racks first', 'error'); return; } itemForm({ rack_id: R.racks[0].id, kind: deviceId ? 'device' : 'patch', device_id: deviceId || null, u: 1, height: 1 }); }
  async function saveItem(id) {
    const body = { rack_id: Number($('ri-rack').value), kind: $('ri-kind').value, device_id: Number($('ri-dev').value) || null, label: $('ri-label').value.trim(), u: Number($('ri-u').value), height: Number($('ri-h').value) };
    try { id ? await apiPut('/api/netmap/rack-item/' + id, body) : await apiPost('/api/netmap/rack-item', body); $('nm-dev-ov').classList.remove('open'); await load(); render(); }
    catch (e) { showToast(errText(e, 'Could not save'), 'error'); }
  }
  async function delItem(id) { try { await apiDelete('/api/netmap/rack-item/' + id); $('nm-dev-ov').classList.remove('open'); await load(); render(); } catch (e) { showToast(errText(e, 'Could not remove'), 'error'); } }
  async function addRack() {
    const name = prompt('Name of the rack / cabinet (e.g. MR-05 or IT-KABIN13):'); if (!name) return;
    const cab = /KABIN|CAB/i.test(name);
    try { await apiPost('/api/netmap/rack', { site: D().site, name: name.trim(), kind: cab ? 'cabinet' : 'rack', units: cab ? 12 : 42, area: cab ? 'Factory' : 'Server room' }); await load(); render(); } catch (e) { showToast(errText(e, 'Could not add'), 'error'); }
  }
  async function build(replace) {
    try { const r = await apiPost('/api/netmap/racks/build', { site: D().site, replace }); showToast(`${r.items} items placed`); await load(); render(); } catch (e) { showToast(errText(e, 'Could not build'), 'error'); }
  }

  // ── Drawings ────────────────────────────────────────────────────────────
  const CATS = ['Racks', 'Topology', 'Floor plan', 'Fiber', 'Other'];
  function renderDrawings() {
    const box = $('nm-view-draw'), can = D().can;
    box.innerHTML = `<div class="rk-bar">${can.admin ? `<select class="form-control" id="dw-cat" style="width:auto">${CATS.map(c => `<option>${c}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('dw-file').click()" title="PNG / JPG / SVG pictures, or a drawing package (.json) with its pins">⬆ Upload pictures</button><input type="file" id="dw-file" accept="image/png,image/jpeg,image/svg+xml,image/webp,.json" multiple hidden>` : ''}
        <span class="text-muted text-sm">Rack, topology and floor-plan pictures of the implementation document. Click a picture to open it large; editors add 📍 pins for cabinets, APs and devices.</span></div>
      ${CATS.map(c => { const l = drawings.filter(d => (d.category || 'Other') === c); return l.length ? `<h4 class="dw-h">${c}</h4><div class="dw-grid">${l.map(d => `<div class="dw-card">
          <a href="#" onclick="NMRacks.openDrawing(${d.id});return false"><img loading="lazy" src="/api/netmap/drawing/${d.id}" alt=""></a>
          <div class="dw-name">${esc(d.name)}${(() => { try { const n = JSON.parse(d.pins || '[]').length; return n ? ` <span class="dw-pins">📍 ${n}</span>` : ''; } catch { return ''; } })()}</div><div class="text-muted text-sm">${Math.round(d.size / 1024)} KB · ${esc(String(d.uploaded_at).slice(0, 10))}${can.admin ? ` · <a href="#" onclick="NMRacks.delDrawing(${d.id});return false">delete</a>` : ''}</div></div>`).join('')}</div>` : ''; }).join('') || '<p class="text-muted" style="padding:14px">No drawings yet.</p>'}`;
    const f = $('dw-file');
    if (f) f.onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const file of files) {
        // Drawing package (.json: name, category, mime, data_b64, pins) — e.g. a floor plan made from the CAD file, pins included.
        if (/\.json$/i.test(file.name)) {
          try { const pk = JSON.parse(await file.text()); if (!pk.data_b64) throw new Error('no picture');
            await apiPost('/api/netmap/drawings', { site: D().site, name: pk.name || file.name.replace(/\.json$/i, ''), category: pk.category || $('dw-cat').value, mime: pk.mime || 'image/png', data_b64: pk.data_b64, pins: pk.pins || [], links: pk.links || [] }); }
          catch (err) { showToast(`${file.name}: ${errText(err, 'not a drawing package')}`, 'error'); }
          continue;
        }
        const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(file); });
        try { await apiPost('/api/netmap/drawings', { site: D().site, name: file.name.replace(/\.[^.]+$/, ''), category: $('dw-cat').value, mime: file.type || 'image/png', data_b64: b64 }); }
        catch (err) { showToast(`${file.name}: ${errText(err, 'upload failed')}`, 'error'); }
      }
      await load(); renderDrawings(); showToast(`${files.length} picture${files.length > 1 ? 's' : ''} uploaded`);
    };
  }
  // Rack items that are CCTV switches but not devices of the map yet.
  const CCTV = /^\s*[A-Z]{2}-\d+\/CCTV-(ASW|DSW)-\d+\s*(\(\w+\))?\s*$/i;
  const want = (d) => (/9200/.test(d.model) ? 52 : /3560/.test(d.model) ? 14 : null);
  const cctvFix = () => D().devices.filter(d => d.source === 'racks' && /CCTV-ASW/i.test(d.hostname) && (!/C9200L-48P|3560CX-12PD/.test(d.model) || D().ports.filter(p => p.device_id === d.id).length !== want(d))).length;
  const cctvCount = () => R.items.filter(i => !i.device_id && CCTV.test(i.label || '')).length + cctvFix();
  async function addCctv() {
    try {
      const r = await apiPost('/api/netmap/cctv-switches', { site: D().site, dry: true });
      if (!r.rows.length) return showToast('No CCTV switch labels left in the racks');
      const list = r.rows.map(x => x.action === 'fix' ? `✎ ${x.hostname} — ${x.model}: ${x.ports} ports (+${x.add}${x.remove ? ' −' + x.remove : ''}${x.rename ? `, ${x.rename} renamed (they hold data)` : ''}${x.keep ? `, ${x.keep} extra kept: they hold data` : ''})`
        : `+ ${x.hostname} — ${x.model}, ${x.ports ? x.ports + ' ports' : 'no ports'} · ${x.location}`).join('\n');
      const nA = r.rows.filter(x => x.action === 'add').length, nF = r.rows.length - nA;
      if (!confirm(`${nA ? `Add ${nA} CCTV switch${nA > 1 ? 'es' : ''}` : ''}${nA && nF ? ' and ' : ''}${nF ? `correct ${nF}` : ''}?\n\n${list}\n\nC9200L-48P-4X-E: 48 ports + 4 uplinks (T 1/1/1–4); WS-C3560CX-12PD-S: 12 ports + 2 uplinks (GE 1/0/13–14). Linked to their rack slot and shown to the OT team.`)) return;
      const a = await apiPost('/api/netmap/cctv-switches', { site: D().site });
      showToast(`${a.added} CCTV switch${a.added === 1 ? '' : 'es'} added${a.fixed ? `, ${a.fixed} corrected` : ''}`);
      await NM.reload(); await load(); render();
    } catch (e) { showToast(errText(e, 'Could not add'), 'error'); }
  }
  function openDrawing(id) { if (window.NMPlans && NMPlans.open(id, drawings)) return; window.open('/api/netmap/drawing/' + id, '_blank'); }
  async function delDrawing(id) { if (!confirm('Delete this picture?')) return; await apiDelete('/api/netmap/drawing/' + id); await load(); renderDrawings(); }

  return { async show(v) { await load(); v === 'draw' ? renderDrawings() : render(); }, build, addItem, saveItem, delItem, addRack, openDrawing, delDrawing, addCctv,
    toggleDrawing: (on) => { showDrawing = on; render(); }, mark: () => mark(true), racksFor: (deviceId) => R.items.find(i => i.device_id === deviceId), drawings: () => drawings, reload: load };
})();
