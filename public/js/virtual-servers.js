/* Server Inventory → ☁ Virtual servers tab (routes/virtual-servers.js): the VMs and the hypervisor hosts they run on,
   from the VM SERVER sheet of the Factory Info workbook (Network map → ⬆ Import Factory Info), editable here. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
  const $ = (id) => document.getElementById(id);
  let rows = [], can = {}, q = '', kind = '', itot = '', loaded = false;
  const FIELDS = [['hostname', 'Hostname *'], ['kind', 'Virtual / Physical'], ['status', 'Status'], ['ip', 'IP address'], ['infra_ip', 'Infra IP'], ['farm', 'VM farm / cluster'],
    ['it_ot', 'IT / OT'], ['system_type', 'System type (PRD / TST)'], ['platform', 'Platform'], ['os', 'OS'], ['os_version', 'OS / firmware version'], ['domain', 'Domain'],
    ['sap', 'SAP / non-SAP'], ['usage', 'Used for'], ['backup', 'Backup policy'], ['host_model', 'Host model (physical)'], ['serial', 'Serial / service tag (physical)'],
    ['cpu', 'CPU'], ['memory', 'Memory'], ['location', 'Location'], ['ref_key', 'Reference key'], ['description', 'Description', 'wide'], ['impact', 'If it stops', 'wide'], ['notes', 'Notes', 'wide']];

  async function load() {
    const p = new URLSearchParams(); if (q) p.set('search', q); if (kind) p.set('kind', kind); if (itot) p.set('it_ot', itot);
    const r = await apiGet('/api/virtual-servers?' + p); rows = r.rows; can = r.can; loaded = true; render();
  }
  function render() {
    const box = $('si-vm');
    const nV = rows.filter(r => r.kind !== 'Physical').length, nP = rows.length - nV;
    const hosts = rows.filter(r => r.kind === 'Physical');
    box.innerHTML = `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px">
        <div class="search-box" style="min-width:240px;flex:1"><input type="text" id="vm-q" placeholder="Search hostname, IP, OS, purpose…" value="${esc(q)}"></div>
        <select class="filter-select" id="vm-kind"><option value="">Virtual + physical</option><option${kind === 'Virtual' ? ' selected' : ''}>Virtual</option><option${kind === 'Physical' ? ' selected' : ''}>Physical</option></select>
        <select class="filter-select" id="vm-itot"><option value="">IT + OT</option><option${itot === 'IT' ? ' selected' : ''}>IT</option><option${itot === 'OT' ? ' selected' : ''}>OT</option></select>
        <span class="text-muted text-sm">${nV} virtual · ${nP} physical host${nP === 1 ? '' : 's'}</span>
        ${can.edit ? '<button class="btn btn-primary btn-sm" id="vm-add">+ Add</button>' : ''}</div>
      ${hosts.length ? `<div class="text-sm" style="padding:8px 20px;border-bottom:1px solid var(--border)">Hosts: ${hosts.map(h => `<b>${esc(h.hostname)}</b>${h.server_id ? ` <a href="/server-inventory.html?view=${h.server_id}" title="Server Inventory record">(${esc(h.server_hostname || h.host_model || '#' + h.server_id)})</a>` : h.host_model ? ` <span class="text-muted">${esc(h.host_model)}</span>` : ''}`).join(' · ')}</div>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Hostname</th><th>Kind</th><th>IP</th><th>OS</th><th>Used for</th><th>Farm</th><th>Description</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.hostname)}</b>${r.status && r.status !== 'Active' ? ` <span class="text-muted text-sm">${esc(r.status)}</span>` : ''}<div class="text-muted text-sm">${esc(r.domain || '')}</div></td>
        <td><span class="vm-kind${r.kind === 'Physical' ? ' phys' : ''}">${esc(r.kind || 'Virtual')}</span>${r.it_ot === 'OT' ? ' <span class="vm-ot">OT</span>' : ''}</td>
        <td>${esc(r.ip || r.infra_ip || '')}</td><td class="text-sm">${esc([r.os, r.os_version].filter(Boolean).join(' · '))}</td><td>${esc(r.usage || '')}</td><td class="text-sm">${esc(r.farm || '')}</td>
        <td class="vm-desc">${esc(r.description || r.impact || '')}${r.notes ? `<div class="text-muted">${esc(r.notes)}</div>` : ''}</td>
        <td style="white-space:nowrap">${can.edit ? `<button class="btn btn-ghost btn-sm" data-edit="${r.id}">Edit</button>` : `<button class="btn btn-ghost btn-sm" data-edit="${r.id}">View</button>`}</td></tr>`).join('')
        || `<tr><td colspan="8" class="empty-state">No virtual servers yet${can.admin ? ' — import them from the Factory Info workbook: <a href="/network-map.html">Network map</a> → ⬆ Import Factory Info (.xlsx)' : ''}.</td></tr>`}
      </tbody></table></div></div>`;
    let t; $('vm-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load().then(() => { const i = $('vm-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
    $('vm-kind').onchange = (e) => { kind = e.target.value; load(); };
    $('vm-itot').onchange = (e) => { itot = e.target.value; load(); };
    if ($('vm-add')) $('vm-add').onclick = () => edit(null);
    box.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => edit(rows.find(r => r.id === Number(b.dataset.edit))); });
    const c = $('vm-cnt'); if (c) c.textContent = rows.length && !q && !kind && !itot ? rows.length : c.textContent;
  }

  function edit(r) {
    let ov = $('vm-ov');
    if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'vm-ov';
      ov.innerHTML = '<div class="modal" style="max-width:760px"><div class="modal-header"><span class="modal-title" id="vm-t"></span><button class="modal-close" aria-label="Close" onclick="document.getElementById(\'vm-ov\').classList.remove(\'open\')">✕</button></div><div class="modal-body" id="vm-b"></div><div class="modal-footer" id="vm-f"></div></div>';
      document.body.appendChild(ov); }
    const x = r || { kind: 'Virtual', status: 'Active', it_ot: 'IT', country: 'Vietnam' }, ro = can.edit ? '' : 'disabled';
    $('vm-t').textContent = r ? `Virtual server — ${r.hostname}` : 'Add virtual server';
    $('vm-b').innerHTML = `<div class="qe-grid">${FIELDS.map(([k, l, w]) => `<div class="form-group${w ? ' span-2' : ''}"><label class="form-label">${l}</label>${w ? `<textarea class="form-control" id="vmf-${k}" rows="2" ${ro}>${esc(x[k] || '')}</textarea>` : `<input class="form-control" id="vmf-${k}" value="${esc(x[k] || '')}" ${ro}>`}</div>`).join('')}</div>
      ${r && r.updated_at ? `<p class="text-muted text-sm" style="margin:6px 0 0">Last change ${esc(String(r.updated_at).slice(0, 16))} UTC</p>` : ''}`;
    $('vm-f').innerHTML = `${r && can.admin ? `<button class="btn btn-danger" style="margin-right:auto" id="vm-del">Delete</button>` : ''}<button class="btn btn-ghost" onclick="document.getElementById('vm-ov').classList.remove('open')">${can.edit ? 'Cancel' : 'Close'}</button>${can.edit ? '<button class="btn btn-primary" id="vm-save">Save</button>' : ''}`;
    if ($('vm-save')) $('vm-save').onclick = async () => {
      const body = Object.fromEntries(FIELDS.map(([k]) => [k, $('vmf-' + k).value.trim()]));
      try { r ? await apiPut('/api/virtual-servers/' + r.id, body) : await apiPost('/api/virtual-servers', { ...body, country: x.country }); ov.classList.remove('open'); showToast('Saved'); load(); }
      catch (e) { showToast(errText(e, 'Could not save'), 'error'); }
    };
    if ($('vm-del')) $('vm-del').onclick = async () => { if (!confirm(`Delete ${r.hostname}?`)) return; try { await apiDelete('/api/virtual-servers/' + r.id); ov.classList.remove('open'); load(); } catch (e) { showToast(errText(e, 'Could not delete'), 'error'); } };
    ov.classList.add('open');
  }

  function tab(t) {
    document.querySelectorAll('.si-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    $('si-vm').hidden = t !== 'vm'; $('si-phys').hidden = t === 'vm';
    if (t === 'vm' && !loaded) load().catch(() => { $('si-vm').innerHTML = '<div class="card"><div class="card-body text-muted">Could not load the virtual servers.</div></div>'; });
    const u = new URL(location.href); if (t === 'vm') u.searchParams.set('tab', 'vm'); else u.searchParams.delete('tab'); history.replaceState(null, '', u);
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.si-tabs button').forEach(b => { b.onclick = () => tab(b.dataset.t); });
    if (new URLSearchParams(location.search).get('tab') === 'vm') tab('vm');
    apiGet('/api/virtual-servers').then(r => { const c = $('vm-cnt'); if (c && r.rows.length) c.textContent = r.rows.length; }).catch(() => {});
  });
})();
