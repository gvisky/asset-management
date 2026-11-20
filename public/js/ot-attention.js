/* ⚠️ OT Needs Attention (/ot-attention.html, GET /api/servers/ot-attention): what to check and fix on the OT devices —
   duplicate names / IPs / MACs, old firmware, HTTP without HTTPS, different network settings, factory DNS, status, missing data,
   unknown switch port. ✏️ Fix opens the device in a form right on this page (name, IP, MAC, serial, firmware, status, switch port,
   network settings …); fixes on the device say what to change there, then the record is updated here or by the camera list. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const ICON = { dup_name: '🔁', dup_ip: '🔁', dup_mac: '🔁', old_fw: '⬆️', http: '🔓', net: '🌐', dns: '🧭', broken: '🔴', missing: '✏️', port: '🔌' };
  let D = null, open = new Set(['dup_name', 'dup_ip', 'dup_mac', 'broken']), q = '';
  async function load() {
    try { D = await apiGet('/api/servers/ot-attention'); render(); }
    catch (e) { $('ota-root').innerHTML = `<p class="text-muted">${esc(e.message || 'Could not load')}</p>`; }
  }
  function render() {
    const n = D.groups.reduce((s, g) => s + g.rows.length, 0);
    $('ota-sub').textContent = `· ${D.total} OT devices · ${n} thing${n === 1 ? '' : 's'} to check`;
    const match = (r) => !q || `${r.hostname} ${r.detail}`.toLowerCase().includes(q);
    $('ota-root').innerHTML = `
      <div class="ota-cards">${D.groups.map(g => `<a href="#g-${g.key}" class="ota-card ${g.where}" data-k="${g.key}"><span>${ICON[g.key] || '⚠'}</span><b>${g.rows.length}</b><small>${esc(g.title)}</small></a>`).join('') || '<p class="text-muted">Nothing to fix — all OT devices look fine. 🎉</p>'}</div>
      ${D.groups.length ? `<div class="us-bar2" style="margin:12px 0"><input class="form-control" id="ota-q" placeholder="Search device, IP, detail…" value="${esc(q)}" style="max-width:280px">
        <span class="text-muted text-sm">🛠 = fix on the device itself (then upload the camera list again) · ✏️ = fix in the record</span></div>` : ''}
      ${D.groups.map(g => { const rows = g.rows.filter(match); const isOpen = open.has(g.key) || !!q;
        return `<div class="card ota-g" id="g-${g.key}"><div class="card-header ota-h" data-t="${g.key}"><span class="lg-caret">${isOpen ? '▾' : '▸'}</span> ${ICON[g.key] || '⚠'} <b>${esc(g.title)}</b>
          <span class="sg-cnt">${rows.length}</span><span class="ota-w ${g.where}">${g.where === 'device' ? '🛠 on the device' : '✏️ in the record'}</span></div>
          ${isOpen ? `<div class="card-body"><p class="text-sm" style="margin:0 0 8px">${esc(g.fix)}</p>
            <table class="nm-vt"><thead><tr><th>Device</th><th>Detail</th><th></th></tr></thead><tbody>
            ${rows.slice(0, 500).map(r => `<tr><td><a href="#" class="ota-open" data-id="${r.id}" data-k="${g.key}"><b>${esc(r.hostname)}</b></a></td><td class="text-sm">${esc(r.detail)}</td>
              <td style="white-space:nowrap">${D.canEdit ? `<button class="btn btn-ghost btn-sm ota-open" data-id="${r.id}" data-k="${g.key}">✏️ Fix</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">No match.</td></tr>'}</tbody></table></div>` : ''}</div>`; }).join('')}`;
    $('ota-root').querySelectorAll('.ota-open').forEach(a => { a.onclick = (e) => { e.preventDefault(); edit(Number(a.dataset.id), a.dataset.k); }; });
    $('ota-root').querySelectorAll('.ota-h').forEach(h => { h.onclick = () => { const k = h.dataset.t; open.has(k) ? open.delete(k) : open.add(k); render(); }; });
    $('ota-root').querySelectorAll('.ota-card').forEach(c => { c.onclick = () => { open.add(c.dataset.k); render(); setTimeout(() => $('g-' + c.dataset.k).scrollIntoView({ behavior: 'smooth' }), 30); return false; }; });
    if ($('ota-q')) $('ota-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; render(); $('ota-q').focus(); $('ota-q').setSelectionRange(p, p); };
  }

  // ── Edit a device right here (PUT /api/servers/:id; OT editors own the OT devices) ──
  // Which fields each check is about: they are highlighted and the first one gets the focus.
  const FOCUS = { dup_name: ['hostname'], dup_ip: ['ip_address'], dup_mac: ['mac'], old_fw: ['os'], http: ['x-http', 'x-https'], net: ['x-mask', 'x-gw'],
    dns: ['x-dns'], broken: ['status'], missing: ['ip_address', 'mac', 'serial_no'], port: ['switch_port'] };
  const F = [['hostname', 'Name'], ['ip_address', 'IP address'], ['mac', 'MAC address'], ['serial_no', 'Serial number'], ['brand_model', 'Model'], ['os', 'Firmware'],
    ['status', 'Status'], ['switch_port', 'Connected to (switch + port)'], ['location', 'Location'], ['x-mask', 'Subnet mask'], ['x-gw', 'Gateway'], ['x-dns', 'DNS (comma separated)'],
    ['x-http', 'HTTP'], ['x-https', 'HTTPS'], ['remark', 'Note']];
  let cur = null, ports = null;
  const exOf = (r) => { try { return JSON.parse(r.extra || '{}') || {}; } catch { return {}; } };
  const valOf = (r, k) => { if (!k.startsWith('x-')) return r[k] == null ? '' : String(r[k]); const v = exOf(r)[k.slice(2)]; return Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v); };
  // Free switch ports of the map for "Connected to" (loaded once).
  async function loadPorts() {
    if (ports) return ports;
    try { const d = await apiGet('/api/netmap?view=ot'); const byId = new Map(d.devices.map(x => [x.id, x]));
      ports = d.ports.filter(p => !p.peer_host && byId.has(p.device_id) && /switch/i.test(byId.get(p.device_id).role || '')).map(p => `${byId.get(p.device_id).hostname} ${p.port}`); }
    catch { ports = []; }
    return ports;
  }
  async function edit(id, key) {
    if (!$('ota-ov')) document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="ota-ov"><div class="modal" style="max-width:680px">
      <div class="modal-header"><span class="modal-title" id="ota-t">Device</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('ota-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="ota-b"></div><div class="modal-footer" id="ota-f"></div></div></div><datalist id="ota-ports"></datalist>`);
    $('ota-ov').classList.add('open'); $('ota-b').innerHTML = '<p class="text-muted">Loading…</p>'; $('ota-f').innerHTML = '';
    let r; try { r = await apiGet('/api/servers/' + id); } catch { $('ota-b').innerHTML = '<p class="text-muted">Not available.</p>'; return; }
    cur = r; const can = D.canEdit, hot = new Set(FOCUS[key] || []), g = D.groups.find(x => x.key === key);
    const locked = !!r.fields_locked, roF = (k) => !can || (locked && (k === 'serial_no' || k === 'brand_model'));
    const input = (k) => {
      const v = valOf(r, k), ro = roF(k) ? ' disabled' : '';
      if (k === 'status') return `<select class="form-control" id="ota-f-${k}"${ro}>${[...new Set(['Active', 'Broken', 'Stock', v].filter(Boolean))].map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      if (k === 'x-http' || k === 'x-https') return `<select class="form-control" id="ota-f-${k}"${ro}>${['', 'Enable', 'Disable'].concat(/^(enable|disable)?$/i.test(v) ? [] : [v]).map(o => `<option value="${esc(o)}"${o.toLowerCase() === v.toLowerCase() ? ' selected' : ''}>${o || '—'}</option>`).join('')}</select>`;
      return `<input class="form-control" id="ota-f-${k}" value="${esc(v)}"${k === 'switch_port' ? ' list="ota-ports" placeholder="e.g. SR-04/CCTV-ASW-04 GE 1/0/5"' : ''}${ro}>`;
    };
    $('ota-t').innerHTML = `${r.it_ot === 'OT' ? '<span class="si-ot">OT</span> ' : ''}${esc(r.hostname || '#' + r.id)} <span class="text-muted text-sm">${esc(r.category || '')}</span>`;
    $('ota-b').innerHTML = `<div class="ota-ed">
      <img class="ota-img" src="/api/servers/${r.id}/photo" alt="" onerror="this.remove()">
      ${g ? `<div class="ota-why ${g.where}">${ICON[g.key] || '⚠'} <b>${esc(g.title)}</b> — ${esc(g.fix)}</div>` : ''}
      ${locked && can ? '<p class="text-muted text-sm" style="margin:0 0 6px">🔒 Serial and model are locked (an IT admin unlocks them in Server Inventory).</p>' : ''}
      <div class="ota-grid">${F.map(([k, l]) => `<div class="form-group${hot.has(k) ? ' ota-hot' : ''}${k === 'remark' || k === 'switch_port' ? ' ota-wide' : ''}"><label class="form-label">${l}</label>${input(k)}</div>`).join('')}</div>
      ${g && g.where === 'device' && can ? '<p class="text-muted text-sm" style="margin:6px 0 0">🛠 Change it on the device first, then save the new value here (or upload the camera list again).</p>' : ''}</div>`;
    $('ota-f').innerHTML = `<a class="btn btn-ghost btn-sm" href="/server-inventory.html?view=${r.id}" target="_blank" rel="noopener">📦 Full record</a><span style="flex:1"></span>
      <button class="btn btn-ghost" onclick="document.getElementById('ota-ov').classList.remove('open')">${can ? 'Cancel' : 'Close'}</button>${can ? '<button class="btn btn-primary" id="ota-save">💾 Save</button>' : ''}`;
    if (can) {
      $('ota-save').onclick = save;
      const first = [...hot][0]; if (first && $('ota-f-' + first)) setTimeout(() => $('ota-f-' + first).focus(), 50);
      loadPorts().then(l => { $('ota-ports').innerHTML = l.slice(0, 3000).map(x => `<option value="${esc(x)}">`).join(''); });
    }
  }
  async function save() {
    const r = cur, body = {}, extra = {};
    for (const [k] of F) { const el = $('ota-f-' + k); if (!el || el.disabled) continue; const v = el.value.trim();
      if (v === valOf(r, k).trim()) continue; if (k.startsWith('x-')) extra[k.slice(2)] = v; else body[k] = v; }
    if (Object.keys(extra).length) body.extra = extra;
    if (!Object.keys(body).length) { $('ota-ov').classList.remove('open'); return showToast('Nothing changed'); }
    const btn = $('ota-save'); btn.disabled = true;
    try {
      await apiPut('/api/servers/' + r.id, body);
      $('ota-ov').classList.remove('open'); showToast(`${r.hostname || 'Device'} saved`);
      const y = window.scrollY; D = await apiGet('/api/servers/ot-attention'); render(); window.scrollTo(0, y);
    } catch (e) { btn.disabled = false; let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch { if (e.message) m = e.message; } showToast(m, 'error'); }
  }
  document.addEventListener('DOMContentLoaded', load);
})();
