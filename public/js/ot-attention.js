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
    try { D = await apiGet('/api/servers/ot-attention');
      const h = (location.hash.match(/^#g-(\w+)/) || [])[1]; if (h) open.add(h);   // from a card on Needs Attention
      render(); if (h && $('g-' + h)) setTimeout(() => $('g-' + h).scrollIntoView({ behavior: 'smooth' }), 50); }
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
          ${isOpen ? `<div class="card-body"><p class="text-sm" style="margin:0 0 8px">${esc(g.fix)}${g.key === 'port' && D.canMac ? ' <button class="btn btn-ghost btn-sm" id="ota-camsw">📷 Set the switch from the camera name</button> <button class="btn btn-ghost btn-sm" id="ota-mac">🔎 Find the ports from the switch MAC tables</button>' : ''}</p>
            <table class="nm-vt"><thead><tr><th>Device</th><th>Detail</th><th></th></tr></thead><tbody>
            ${rows.slice(0, 500).map(r => `<tr><td><a href="#" class="ota-open" data-id="${r.id}" data-k="${g.key}"><b>${esc(r.hostname)}</b></a></td><td class="text-sm">${esc(r.detail)}</td>
              <td style="white-space:nowrap">${D.canEdit ? `<button class="btn btn-ghost btn-sm ota-open" data-id="${r.id}" data-k="${g.key}">✏️ Fix</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">No match.</td></tr>'}</tbody></table></div>` : ''}</div>`; }).join('')}`;
    if ($('ota-camsw')) $('ota-camsw').onclick = () => CamSwitches.open(async () => { D = await apiGet('/api/servers/ot-attention'); render(); });
    if ($('ota-mac')) $('ota-mac').onclick = () => MacPorts.open(async () => { D = await apiGet('/api/servers/ot-attention'); render(); });
    $('ota-root').querySelectorAll('.ota-open').forEach(a => { a.onclick = (e) => { e.preventDefault(); edit(Number(a.dataset.id), a.dataset.k); }; });
    $('ota-root').querySelectorAll('.ota-h').forEach(h => { h.onclick = () => { const k = h.dataset.t; open.has(k) ? open.delete(k) : open.add(k); render(); }; });
    $('ota-root').querySelectorAll('.ota-card').forEach(c => { c.onclick = () => { open.add(c.dataset.k); render(); setTimeout(() => $('g-' + c.dataset.k).scrollIntoView({ behavior: 'smooth' }), 30); return false; }; });
    if ($('ota-q')) $('ota-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; render(); $('ota-q').focus(); $('ota-q').setSelectionRange(p, p); };
  }

  // ── Edit a device right here (public/js/device-edit.js; OT editors own the OT devices) ──
  // Which fields each check is about: they are highlighted and the first one gets the focus.
  const FOCUS = { dup_name: ['hostname'], dup_ip: ['ip_address'], dup_mac: ['mac'], old_fw: ['os'], http: ['x-http', 'x-https'], net: ['x-mask', 'x-gw'],
    dns: ['x-dns'], broken: ['status'], missing: ['ip_address', 'mac', 'serial_no'], port: ['switch_port'] };
  function edit(id, key) {
    const g = D.groups.find(x => x.key === key);
    DeviceEdit.open(id, { hot: FOCUS[key] || [], why: g && { icon: ICON[g.key], title: g.title, fix: g.fix, where: g.where },
      onSaved: async () => { const y = window.scrollY; D = await apiGet('/api/servers/ot-attention'); render(); window.scrollTo(0, y); } });
  }
  document.addEventListener('DOMContentLoaded', load);
})();
