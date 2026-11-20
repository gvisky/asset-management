/* Server Inventory → 🔌 Switch ports: link every device (IT and OT) to the access-switch port it is cabled to (from the
   network map), and add the devices that are on an access-switch port but have no record yet (POST /api/servers/port-links). */

const PortLinksUI = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const CATS = ['Access control', 'Access control camera', 'Printer', 'Kiosk / panel PC', 'Display (mini PC)', 'Industrial switch / router', 'OT gateway', 'PLC', 'Controller', 'Sensor', 'OT device', 'Endpoint', 'Camera'];
  let P = null;

  function shell() {
    if ($('pl-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="pl-ov"><div class="modal" style="max-width:1200px;width:97vw">
      <div class="modal-header"><span class="modal-title">🔌 Devices on the access switches</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('pl-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="pl-b" style="max-height:76vh;overflow:auto"></div><div class="modal-footer" id="pl-f"></div></div></div>
      <datalist id="pl-cats">${CATS.map(c => `<option value="${c}">`).join('')}</datalist>`);
  }
  async function load() {
    $('pl-b').innerHTML = '<p class="text-muted">Reading the network map…</p>'; $('pl-f').innerHTML = '';
    try { P = await apiPost('/api/servers/port-links', { dry: true, site: P && P.site }); render(); }
    catch (e) { $('pl-b').innerHTML = `<p style="color:#b91c1c">${esc(e.message || 'Could not read')}</p>`; }
  }
  function render() {
    const C = P.counts, ch = P.links.filter(l => l.change);
    $('pl-b').innerHTML = `
      <div class="us-sum"><div><b>${C.ports}</b><span>access-switch ports in use</span></div><div class="u"><b>${C.links}</b><span>devices found on a port</span></div>
        <div class="s"><b>${C.change}</b><span>"Connected to" to set / correct</span></div><div class="f"><b>${C.missing}</b><span>on a port, no record yet</span></div>
        <div><b>${C.unmatched}</b><span>records not found on any port</span></div></div>
      ${(window.CURRENT_USER || {}).team === 'OT' ? '<p class="text-sm" style="margin:6px 0 0;color:#9a3412">OT view: only the OT devices and the Kabin switches the OT team sees; devices you add are OT.</p>' : ''}
      <p class="text-muted text-sm" style="margin:6px 0 10px">Found by: the map's device (APs, card-reader switches …) cabled to the port, the MAC or IP written on the port, or the same name. Switches, routers and servers are the network itself and are not listed. Nothing changes before Apply.</p>
      <h4 style="margin:12px 0 6px">① Devices found on a port (${P.links.length}) — tick to write "Connected to"</h4>
      <table class="nm-vt oi-t"><thead><tr><th><input type="checkbox" id="pl-all-l" ${ch.length ? 'checked' : 'disabled'}></th><th>Device</th><th>IT/OT</th><th>Connected to</th><th>Now</th><th>Found by</th></tr></thead><tbody>
      ${P.links.map(l => `<tr><td>${l.change ? `<input type="checkbox" class="pl-l" value="${l.server_id}" checked>` : '✔'}</td><td><a href="/server-inventory.html?view=${l.server_id}" target="_blank" rel="noopener">${esc(l.hostname)}</a> <span class="text-muted text-sm">${esc(l.category || '')}</span></td>
        <td>${l.it_ot === 'OT' ? '<span class="si-ot">OT</span>' : 'IT'}</td><td><b>${esc(l.to)}</b></td><td class="text-sm text-muted">${l.change ? esc(l.from || '—') : 'already set'}</td><td class="text-sm text-muted">${esc(l.how)}</td></tr>`).join('')}</tbody></table>
      <h4 style="margin:16px 0 6px">② On an access-switch port but not in Server Inventory (${P.missing.length}) — tick to add</h4>
      <p class="text-muted text-sm" style="margin:0 0 6px">IP phones, PXE / spare ports and desk points named after people are left out. Check the name, IT / OT and category before adding.</p>
      ${P.missing.length ? `<table class="nm-vt oi-t"><thead><tr><th><input type="checkbox" id="pl-all-m"></th><th>Switch port</th><th>Name</th><th>IT / OT</th><th>Category</th><th>VLAN</th><th>MAC / IP</th><th>On the port</th></tr></thead><tbody>
      ${P.missing.map(m => `<tr data-p="${m.port_id}"><td><input type="checkbox" class="pl-m"></td><td class="text-sm">${esc(m.switch)}<br><b>${esc(m.port)}</b></td>
        <td><input class="form-control" data-f="name" value="${esc(m.name)}" style="min-width:170px"></td>
        <td><select class="form-control" data-f="it_ot"${(window.CURRENT_USER || {}).team === 'OT' ? ' disabled' : ''}><option value="IT"${m.it_ot === 'IT' ? ' selected' : ''}>IT</option><option value="OT"${m.it_ot === 'OT' ? ' selected' : ''}>OT</option></select></td>
        <td><input class="form-control" data-f="category" list="pl-cats" value="${esc(m.category)}" style="min-width:140px"></td><td>${esc(m.vlan)}</td>
        <td class="text-sm">${esc(m.mac)}${m.ip ? '<br>' + esc(m.ip) : ''}</td><td class="text-sm text-muted">${esc(m.note)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">None.</p>'}
      ${P.unmatched.length ? `<h4 style="margin:16px 0 6px">③ Records not found on any access-switch port (${P.unmatched.length})</h4>
      <p class="text-muted text-sm" style="margin:0 0 6px">Spares in stock, or the map / record is missing the name, MAC, IP or serial that would link them.</p>
      <div>${P.unmatched.map(u => `<a class="mc-m" href="/server-inventory.html?view=${u.server_id}" target="_blank" rel="noopener">${u.it_ot === 'OT' ? '<span class="si-ot">OT</span> ' : ''}${esc(u.hostname)}${u.ip ? ' · ' + esc(u.ip) : ''}</a>`).join('')}</div>` : ''}`;
    if ($('pl-all-l')) $('pl-all-l').onchange = (e) => $('pl-b').querySelectorAll('.pl-l').forEach(x => { x.checked = e.target.checked; });
    if ($('pl-all-m')) $('pl-all-m').onchange = (e) => $('pl-b').querySelectorAll('.pl-m').forEach(x => { x.checked = e.target.checked; });
    $('pl-f').innerHTML = '<button class="btn btn-ghost" onclick="document.getElementById(\'pl-ov\').classList.remove(\'open\')">Close</button><button class="btn btn-primary" id="pl-go">Apply</button>';
    $('pl-go').onclick = apply;
  }
  async function apply() {
    const link = [...$('pl-b').querySelectorAll('.pl-l:checked')].map(x => Number(x.value));
    const add = [...$('pl-b').querySelectorAll('tr[data-p]')].filter(tr => tr.querySelector('.pl-m').checked).map(tr => {
      const o = { port_id: Number(tr.dataset.p) }; tr.querySelectorAll('[data-f]').forEach(i => { o[i.dataset.f] = i.value.trim(); }); return o; });
    if (!link.length && !add.length) return showToast('Nothing ticked', 'error');
    if (!confirm(`Write "Connected to" for ${link.length} device${link.length === 1 ? '' : 's'} and add ${add.length} new device${add.length === 1 ? '' : 's'}?`)) return;
    $('pl-go').disabled = true;
    try {
      const r = await apiPost('/api/servers/port-links', { site: P.site, link, add });
      showToast(`${r.linked} linked to their switch port · ${r.added} added`);
      if (typeof loadFilters === 'function') await loadFilters(); if (typeof loadServers === 'function') loadServers(1);
      await load();
    } catch (e) { showToast(e.message || 'Could not apply', 'error'); $('pl-go').disabled = false; }
  }
  function open() { shell(); $('pl-ov').classList.add('open'); P = null; load(); }
  return { open };
})();
