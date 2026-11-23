/* ✏️ Edit a device in a window, on any page (OT Needs Attention, the drawings' camera / cabinet popups …): picture, the
   fields of the record incl. the camera's network settings; PUT /api/servers/:id (changed fields only).
   IT admins / editors edit any record; OT editors (and OT admins) the OT devices; others see it read-only.
   DeviceEdit.open(id, { hot: ['hostname', …], why: { icon, title, fix, where }, onSaved(record) }) */
const DeviceEdit = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const F = [['hostname', 'Name'], ['ip_address', 'IP address'], ['mac', 'MAC address'], ['serial_no', 'Serial number'], ['brand_model', 'Model'], ['os', 'Firmware'],
    ['status', 'Status'], ['role', 'Area / role'], ['switch_port', 'Connected to (switch + port)'], ['location', 'Location'], ['x-mask', 'Subnet mask'], ['x-gw', 'Gateway'], ['x-dns', 'DNS (comma separated)'],
    ['x-http', 'HTTP'], ['x-https', 'HTTPS'], ['remark', 'Note']];
  let cur = null, opts = {}, ports = null;
  const exOf = (r) => { try { return JSON.parse(r.extra || '{}') || {}; } catch { return {}; } };
  const valOf = (r, k) => { if (!k.startsWith('x-')) return r[k] == null ? '' : String(r[k]); const v = exOf(r)[k.slice(2)]; return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v); };
  const canEdit = (r) => { const u = window.CURRENT_USER || {};
    return (u.team === 'IT' && ['admin', 'editor'].includes(u.role)) || (u.team === 'OT' && u.role === 'editor' && r.it_ot === 'OT')
      || (u.team === 'NET' && u.role === 'editor' && /switch|router|firewall|gateway|wireless|wlc|access\s*point|network/i.test(r.category || '')); };
  // Free switch ports of the map for "Connected to" (loaded once).
  async function loadPorts() {
    if (ports) return ports;
    try { const d = (window.NM && NM.data && NM.data()) || await apiGet('/api/netmap?view=ot'); const byId = new Map(d.devices.map(x => [x.id, x]));
      ports = d.ports.filter(p => !p.peer_host && byId.has(p.device_id) && /switch/i.test(byId.get(p.device_id).role || '')).map(p => `${byId.get(p.device_id).hostname} ${p.port}`); }
    catch { ports = []; }
    return ports;
  }
  function shell() {
    if ($('dve-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="dve-ov" style="z-index:3200"><div class="modal" style="max-width:680px">
      <div class="modal-header"><span class="modal-title" id="dve-t">Device</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('dve-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="dve-b"></div><div class="modal-footer" id="dve-f"></div></div></div><datalist id="dve-ports"></datalist>`);
  }
  async function open(id, o = {}) {
    opts = o; shell();
    $('dve-ov').classList.add('open'); $('dve-b').innerHTML = '<p class="text-muted">Loading…</p>'; $('dve-f').innerHTML = '';
    let r; try { r = await apiGet('/api/servers/' + id); } catch { $('dve-b').innerHTML = '<p class="text-muted">Not available.</p>'; return; }
    cur = r; const can = canEdit(r), hot = new Set(o.hot || []), g = o.why;
    const locked = !!r.fields_locked, roF = (k) => !can || (locked && (k === 'serial_no' || k === 'brand_model'));
    const input = (k) => {
      const v = valOf(r, k), ro = roF(k) ? ' disabled' : '';
      if (k === 'status') return `<select class="form-control" id="dve-f-${k}"${ro}>${[...new Set(['Active', 'Broken', 'Stock', v].filter(Boolean))].map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
      if (k === 'x-http' || k === 'x-https') return `<select class="form-control" id="dve-f-${k}"${ro}>${['', 'Enable', 'Disable'].concat(/^(enable|disable)?$/i.test(v) ? [] : [v]).map(x => `<option value="${esc(x)}"${x.toLowerCase() === v.toLowerCase() ? ' selected' : ''}>${x || '—'}</option>`).join('')}</select>`;
      return `<input class="form-control" id="dve-f-${k}" value="${esc(v)}"${k === 'switch_port' ? ' list="dve-ports" placeholder="e.g. SR-04/CCTV-ASW-04 GE 1/0/5"' : ''}${ro}>`;
    };
    $('dve-t').innerHTML = `${r.it_ot === 'OT' ? '<span class="si-ot">OT</span> ' : ''}${esc(r.hostname || '#' + r.id)} <span class="text-muted text-sm">${esc(r.category || '')}</span>`;
    $('dve-b').innerHTML = `<div class="ota-ed">
      <img class="ota-img" src="/api/servers/${r.id}/photo" alt="" onerror="this.remove()">
      ${g ? `<div class="ota-why ${esc(g.where || '')}">${g.icon || '⚠'} <b>${esc(g.title)}</b>${g.fix ? ' — ' + esc(g.fix) : ''}</div>` : ''}
      ${!can ? '<p class="text-muted text-sm" style="margin:0 0 6px">Read only — editors can change it.</p>' : locked ? '<p class="text-muted text-sm" style="margin:0 0 6px">🔒 Serial and model are locked (an IT admin unlocks them in Server Inventory).</p>' : ''}
      <div class="ota-grid">${F.map(([k, l]) => `<div class="form-group${hot.has(k) ? ' ota-hot' : ''}${k === 'remark' || k === 'switch_port' ? ' ota-wide' : ''}"><label class="form-label">${l}</label>${input(k)}</div>`).join('')}</div>
      ${g && g.where === 'device' && can ? '<p class="text-muted text-sm" style="margin:6px 0 0">🛠 Change it on the device first, then save the new value here (or upload the camera list again).</p>' : ''}</div>`;
    $('dve-f').innerHTML = `<a class="btn btn-ghost btn-sm" href="/server-inventory.html?view=${r.id}" target="_blank" rel="noopener">📦 Full record</a><span style="flex:1"></span>
      <button class="btn btn-ghost" onclick="document.getElementById('dve-ov').classList.remove('open')">${can ? 'Cancel' : 'Close'}</button>${can ? '<button class="btn btn-primary" id="dve-save">💾 Save</button>' : ''}`;
    if (can) {
      $('dve-save').onclick = save;
      const first = [...hot][0]; if (first && $('dve-f-' + first)) setTimeout(() => $('dve-f-' + first).focus(), 50);
      loadPorts().then(l => { $('dve-ports').innerHTML = l.slice(0, 3000).map(x => `<option value="${esc(x)}">`).join(''); });
    }
  }
  async function save() {
    const r = cur, body = {}, extra = {};
    for (const [k] of F) { const el = $('dve-f-' + k); if (!el || el.disabled) continue; const v = el.value.trim();
      if (v === valOf(r, k).trim()) continue; if (k.startsWith('x-')) extra[k.slice(2)] = v; else body[k] = v; }
    if (Object.keys(extra).length) body.extra = extra;
    if (!Object.keys(body).length) { $('dve-ov').classList.remove('open'); return showToast('Nothing changed'); }
    const btn = $('dve-save'); btn.disabled = true;
    try {
      const saved = await apiPut('/api/servers/' + r.id, body);
      $('dve-ov').classList.remove('open'); showToast(`${saved.hostname || r.hostname || 'Device'} saved`);
      ports = null; if (opts.onSaved) await opts.onSaved(saved);
    } catch (e) { btn.disabled = false; let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch { if (e.message) m = e.message; } showToast(m, 'error'); }
  }
  return { open, canEdit };
})();
