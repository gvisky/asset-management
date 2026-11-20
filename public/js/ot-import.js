/* Server Inventory → ⬆ OT device list (CMDB .xlsx): preview, choose the switch for each switch name of the file, then add the
   OT devices to the Server Inventory and fill their EMPTY switch ports on the network map (routes/servers.js /ot-import). */

const OTDeviceImport = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  let aoa = null, P = null, overrides = {}, fileName = '';

  function shell() {
    if ($('oi-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="oi-ov"><div class="modal" style="max-width:1200px;width:97vw">
      <div class="modal-header"><span class="modal-title">⬆ OT device list → Server Inventory &amp; network map</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('oi-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="oi-b" style="max-height:76vh;overflow:auto"></div>
      <div class="modal-footer" id="oi-f"></div></div></div>`);
  }
  async function needXlsx() {
    if (window.XLSX) return;
    await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }
  function start() {
    $('oi-b').innerHTML = `<p>Upload the OT device list (CMDB, e.g. <b>CMDB_OEE.xlsx</b>): columns Manufacturer, Device, Model, Serial Number, Name, IPAddress, Mac, Vlan, ConnectedDevice, PortCount, OT system.</p>
      <p class="text-muted text-sm">Nothing changes before you press Apply. Devices whose MAC is already on a switch port of the map are recognised there; the others go to the switch the file names (you can change it) — only <b>empty</b> ports are filled, everything else is listed for you to check. Existing Server Inventory records only get their empty fields filled.</p>
      <input type="file" id="oi-file" accept=".xlsx,.xls,.csv">`;
    $('oi-f').innerHTML = '<button class="btn btn-ghost" onclick="document.getElementById(\'oi-ov\').classList.remove(\'open\')">Close</button>';
    $('oi-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await needXlsx(); fileName = f.name;
        const wb = /\.csv$/i.test(f.name) ? XLSX.read(await f.text(), { type: 'string', raw: true }) : XLSX.read(await f.arrayBuffer());
        // The sheet with a Name + Mac header.
        const sheet = wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false })).find(a => a.some(r => r.some(c => /^name$/i.test(String(c).trim())) && r.some(c => /^mac/i.test(String(c).trim()))));
        if (!sheet) { showToast('No sheet with Name and Mac columns', 'error'); return; }
        aoa = sheet; overrides = {}; await preview();
      } catch (err) { showToast(err.message || 'Could not read the file', 'error'); }
    };
  }
  async function preview() {
    $('oi-b').innerHTML = '<p class="text-muted">Checking against the map and the Server Inventory…</p>';
    try { P = await apiPost('/api/servers/ot-import', { aoa, overrides, dry: true, site: P && P.site }); render(); }
    catch (e) { $('oi-b').innerHTML = `<p style="color:#b91c1c">${esc(e.message || 'Could not check the file')}</p>`; }
  }
  const kind = (m) => /^on the map/.test(m) ? 'map' : /^added|^behind/.test(m) ? 'add' : /something else|unknown|no port/.test(m) ? 'diff' : '';
  function render() {
    const C = P.counts;
    $('oi-b').innerHTML = `
      <div class="us-sum"><div><b>${C.rows}</b><span>devices in ${esc(fileName)}</span></div><div class="u"><b>${C.add}</b><span>new in Server Inventory</span></div>
        <div><b>${C.update}</b><span>existing — empty fields filled</span></div><div class="s"><b>${C.onMap}</b><span>already on the map</span></div>
        <div class="u"><b>${C.fillPorts}</b><span>empty switch ports to fill</span></div><div class="f"><b>${C.differ}</b><span>ports that differ (not changed)</span></div></div>
      <h4 style="margin:14px 0 6px">① Switch for each switch name of the file</h4>
      <p class="text-muted text-sm" style="margin:0 0 6px">The file's names don't match the map's (e.g. "ASW-11" is the IT-KABIN11 switch). Check them — change one and the preview updates.</p>
      <table class="nm-vt oi-t"><thead><tr><th>In the file</th><th>Devices</th><th>Switch on the map</th><th>Why</th></tr></thead><tbody>
      ${P.labels.map(l => `<tr><td><b>${esc(l.label || '(empty)')}</b></td><td>${l.rows}</td><td>${l.label ? `<select data-l="${esc(l.label)}"><option value="0">— none —</option>${P.switches.map(s => `<option value="${s.id}"${s.id === l.device_id ? ' selected' : ''}>${esc(s.hostname)}${s.location ? ' · ' + esc(s.location) : ''}</option>`).join('')}</select>` : '<span class="text-muted">—</span>'}</td><td class="text-sm text-muted">${esc(l.how)}</td></tr>`).join('')}</tbody></table>
      <h4 style="margin:16px 0 6px">② Empty switch ports that will be filled (${P.fills.length})</h4>
      ${P.fills.length ? `<table class="nm-vt oi-t"><thead><tr><th>Switch</th><th>Port</th><th>Connected to</th><th>VLAN</th><th>Note</th></tr></thead><tbody>
        ${P.fills.map(f => `<tr><td>${esc(f.hostname)}</td><td><b>${esc(f.port)}</b></td><td>${esc(f.peer_host)}</td><td>${esc(f.vlan)}</td><td class="text-sm">${esc(f.note)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">None.</p>'}
      <h4 style="margin:16px 0 6px">③ Ports where the map and the file differ — not changed, please check (${P.differs.length})</h4>
      ${P.differs.length ? `<table class="nm-vt oi-t"><thead><tr><th>Switch</th><th>Port</th><th>The map has</th><th>The file says</th></tr></thead><tbody>
        ${P.differs.map(d => `<tr><td>${esc(d.hostname)}</td><td><b>${esc(d.port)}</b></td><td class="text-sm">${esc(d.now)}</td><td class="text-sm">${esc(d.file)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">None.</p>'}
      ${P.issues.length ? `<h4 style="margin:16px 0 6px">④ To check in the file (${P.issues.length})</h4>${P.issues.map(i => `<div class="text-sm" style="padding:2px 0">⚠ ${esc(i.text)}${i.kind === 'port' ? ` — <b>${esc(i.name)}</b>` : ''}</div>`).join('')}` : ''}
      <h4 style="margin:16px 0 6px">Devices (${P.rows.length})</h4>
      <table class="nm-vt oi-t"><thead><tr><th>Name</th><th>Category</th><th>IP</th><th>MAC</th><th>Connected to</th><th>Map</th><th>Server Inventory</th></tr></thead><tbody>
      ${P.rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="text-sm">${esc(r.cat)}</td><td class="text-sm">${esc(r.ip)}</td><td class="si-sn">${esc(r.mac)}</td><td class="text-sm">${esc(r.where)}</td>
        <td><span class="oi-k ${kind(r.map)}">${esc(r.map)}</span></td><td>${r.action === 'add' ? '<span class="oi-k add">new</span>' : r.action === 'update' ? `<span class="oi-k" title="${esc(Object.keys(r.fill).join(', '))}">fill #${r.server_id}</span>` : `<span class="oi-k">#${r.server_id} same</span>`}</td></tr>`).join('')}</tbody></table>`;
    $('oi-b').querySelectorAll('select[data-l]').forEach(s => { s.onchange = () => { overrides[s.dataset.l] = Number(s.value); preview(); }; });
    $('oi-f').innerHTML = `<label class="text-sm" style="margin-right:auto"><input type="checkbox" id="oi-s" checked> Server Inventory: add ${C.add}, fill ${C.update}</label>
      <label class="text-sm"><input type="checkbox" id="oi-p" checked> Network map: fill ${C.fillPorts} empty port${C.fillPorts === 1 ? '' : 's'}</label>
      <button class="btn btn-ghost" onclick="OTDeviceImport.restart()">Another file</button><button class="btn btn-primary" id="oi-go">Apply</button>`;
    $('oi-go').onclick = apply;
  }
  async function apply() {
    const sv = $('oi-s').checked, pt = $('oi-p').checked;
    if (!sv && !pt) return showToast('Nothing ticked', 'error');
    $('oi-go').disabled = true;
    try {
      const r = await apiPost('/api/servers/ot-import', { aoa, overrides, site: P.site, apply: { servers: sv, ports: pt } });
      showToast(`${r.added} OT device${r.added === 1 ? '' : 's'} added, ${r.updated} filled · ${r.ports} switch port${r.ports === 1 ? '' : 's'} filled`);
      $('oi-ov').classList.remove('open');
      if (typeof setIoTab === 'function') setIoTab('OT');
      if (typeof loadFilters === 'function') await loadFilters(); if (typeof loadServers === 'function') loadServers(1);
    } catch (e) { showToast(e.message || 'Could not apply', 'error'); $('oi-go').disabled = false; }
  }
  function open() { shell(); $('oi-ov').classList.add('open'); P = null; start(); }
  return { open, restart: start };
})();
