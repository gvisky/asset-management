/* 🔌 Camera ports from the switch MAC tables (POST /api/servers/mac-ports): paste the output of `show mac address-table`
   of one or more switches (or choose the .txt / .log files) → each camera / device found by its MAC on an access port gets
   "Connected to" = switch + port, and the free port on the network map gets its name and MAC. Preview first. */
const MacPorts = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return (e && e.message) || f; } };
  let P = null, text = '', choose = {}, onDone = null;
  const ACT = { set: ['✚', 'set port'], busy: ['⚠', 'port names another device — only "Connected to" is set'], shared: ['⚠', 'two devices on one port (small switch / injector?) — only "Connected to"'], same: ['✔', 'already set'] };

  function shell() {
    if ($('mp-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="mp-ov"><div class="modal" style="max-width:1100px;width:96vw">
      <div class="modal-header"><span class="modal-title">🔌 Camera ports from the switch MAC tables</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('mp-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="mp-b" style="max-height:76vh;overflow:auto"></div><div class="modal-footer" id="mp-f"></div></div></div>`);
  }
  function start() {
    $('mp-b').innerHTML = `<p class="text-sm" style="margin:0 0 8px">On each CCTV / Kabin switch run <code>show mac address-table dynamic</code> and paste the output here — several switches in one go is fine,
      keep the prompt line (<code>K2_CCTV_01#show mac address-table dynamic</code>) so the switch is known. Or choose the saved .txt / .log files.</p>
      <textarea class="form-control" id="mp-t" rows="12" style="font-family:monospace;font-size:12px" placeholder="K2_CCTV_01#show mac address-table dynamic&#10;          Mac Address Table&#10;-------------------------------------------&#10;Vlan    Mac Address       Type        Ports&#10;----    -----------       --------    -----&#10;  11    e430.2229.ea0f    DYNAMIC     Gi1/0/5">${esc(text)}</textarea>
      <div style="margin-top:8px"><input type="file" id="mp-files" multiple accept=".txt,.log,.cfg,text/plain"> <span class="text-muted text-sm">Only MAC addresses and port names are read; nothing else from the output is kept.</span></div>`;
    $('mp-f').innerHTML = `<button class="btn btn-ghost" onclick="document.getElementById('mp-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" id="mp-read">Read</button>`;
    $('mp-files').onchange = async (e) => { const parts = []; for (const f of e.target.files) { const t = await f.text(); parts.push(/[#>]\s*sh/i.test(t) ? t : `${f.name.replace(/\.[^.]+$/, '')}#show mac address-table\n${t}`); } $('mp-t').value = ($('mp-t').value ? $('mp-t').value + '\n' : '') + parts.join('\n'); };
    $('mp-read').onclick = () => { text = $('mp-t').value; choose = {}; read(); };
  }
  async function read() {
    $('mp-b').innerHTML = '<p class="text-muted">Reading…</p>'; $('mp-f').innerHTML = '';
    try { P = await apiPost('/api/servers/mac-ports', { text, choose, dry: true }); render(); }
    catch (e) { showToast(errText(e, 'Could not read'), 'error'); start(); }
  }
  function render() {
    const todo = P.rows.filter(r => r.action !== 'same');
    $('mp-b').innerHTML = `
      <div class="us-sum"><div><b>${P.switches.length}</b><span>switch tables</span></div><div class="u"><b>${P.rows.length}</b><span>devices found by MAC</span></div>
        <div class="s"><b>${P.rows.filter(r => r.action === 'set').length}</b><span>ports to fill</span></div><div><b>${P.rows.filter(r => r.action === 'same').length}</b><span>already right</span></div>
        <div class="f"><b>${P.unknown.length}</b><span>MACs not in Server Inventory</span></div></div>
      <h4 style="margin:12px 0 6px">Switches</h4>
      <table class="nm-vt"><thead><tr><th>In the text</th><th>Switch on the map</th><th>MACs</th><th>Uplinks left out</th><th>Devices found</th></tr></thead><tbody>
      ${P.switches.map(s => `<tr><td><b>${esc(s.name || '(no prompt line)')}</b></td><td><select class="form-control mp-sw" data-i="${s.index}" style="min-width:220px"><option value="">— choose —</option>
        ${P.switches_all.map(d => `<option value="${d.id}"${d.id === s.device_id ? ' selected' : ''}>${esc(d.hostname)}${d.alias ? ' · ' + esc(d.alias) : ''}</option>`).join('')}</select></td>
        <td>${s.entries}</td><td class="text-sm text-muted">${esc(s.uplinks.join(', ') || '—')}</td><td>${s.device_id ? s.matched : '<span style="color:#b45309">choose the switch</span>'}</td></tr>`).join('')}</tbody></table>
      <h4 style="margin:14px 0 6px">Devices on their port (${P.rows.length}) — tick to apply</h4>
      ${P.rows.length ? `<table class="nm-vt oi-t"><thead><tr><th><input type="checkbox" id="mp-all" ${todo.length ? 'checked' : 'disabled'}></th><th>Device</th><th>MAC</th><th>Switch port</th><th>VLAN</th><th>Now</th><th></th></tr></thead><tbody>
      ${P.rows.map(r => `<tr><td>${r.action === 'same' ? '✔' : `<input type="checkbox" class="mp-r" value="${r.server_id}" checked>`}</td>
        <td>${r.it_ot === 'OT' ? '<span class="si-ot">OT</span> ' : ''}<b>${esc(r.hostname)}</b> <span class="text-muted text-sm">${esc(r.category)}</span></td><td class="text-sm">${esc(r.mac)}</td>
        <td><b>${esc(r.switch)} ${esc(r.port)}</b></td><td>${esc(r.vlan)}</td><td class="text-sm text-muted">${esc(r.before || '—')}</td>
        <td class="text-sm" title="${esc(ACT[r.action][1])}">${ACT[r.action][0]} ${esc(ACT[r.action][1])}${r.other ? ': ' + esc(r.other) : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">No Server Inventory device found by MAC — check that the switch is chosen above.</p>'}
      ${P.unknown.length ? `<details style="margin-top:12px"><summary>MACs on access ports that are not in the Server Inventory (${P.unknown.length})</summary>
        <table class="nm-vt"><thead><tr><th>Switch port</th><th>MAC</th><th>VLAN</th><th>Port on the map</th></tr></thead><tbody>
        ${P.unknown.map(u => `<tr><td>${esc(u.switch)} <b>${esc(u.port)}</b></td><td class="text-sm">${esc(u.mac)}</td><td>${esc(u.vlan)}</td><td class="text-sm text-muted">${esc(u.peer_host || 'free')}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
    $('mp-f').innerHTML = `<button class="btn btn-ghost" style="margin-right:auto" id="mp-back">← Change the text</button><button class="btn btn-ghost" onclick="document.getElementById('mp-ov').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" id="mp-go"${todo.length ? '' : ' disabled'}>Apply</button>`;
    $('mp-back').onclick = start;
    $('mp-b').querySelectorAll('.mp-sw').forEach(s => { s.onchange = () => { choose[s.dataset.i] = s.value; read(); }; });
    if ($('mp-all')) $('mp-all').onchange = (e) => $('mp-b').querySelectorAll('.mp-r').forEach(c => { c.checked = e.target.checked; });
    $('mp-go').onclick = apply;
  }
  async function apply() {
    const ids = [...$('mp-b').querySelectorAll('.mp-r:checked')].map(c => Number(c.value));
    if (!ids.length) return showToast('Tick at least one device', 'error');
    $('mp-go').disabled = true;
    try { const a = await apiPost('/api/servers/mac-ports', { text, choose, apply: ids });
      showToast(`${a.records} device${a.records === 1 ? '' : 's'} set to their switch port · ${a.mapped} port${a.mapped === 1 ? '' : 's'} filled on the network map`);
      $('mp-ov').classList.remove('open'); if (onDone) onDone(); }
    catch (e) { $('mp-go').disabled = false; showToast(errText(e, 'Could not apply'), 'error'); }
  }
  return { open(done) { onDone = done || null; shell(); $('mp-ov').classList.add('open'); start(); } };
})();
