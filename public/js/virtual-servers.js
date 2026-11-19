/* Server Inventory → ☁ Virtual servers tab (routes/virtual-servers.js): the VMs and the hypervisor hosts they run on,
   from the VM SERVER sheet of the Factory Info workbook (Network map → ⬆ Import Factory Info), editable here. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
  const $ = (id) => document.getElementById(id);
  let rows = [], can = {}, q = '', kind = '', itot = '', vst = '', loaded = false, newest = '';
  // Status of a server: in use, switched off, being worked on, or removed (kept for the record).
  const STATUSES = ['Active', 'Powered off', 'Maintenance', 'Decommissioned'];
  const stCls = (v) => ({ Active: 'act', 'Powered off': 'off', Maintenance: 'mnt', Decommissioned: 'dec' }[v] || 'off');
  const FIELDS = [['hostname', 'Hostname *'], ['kind', 'Virtual / Physical'], ['status', 'Status'], ['ip', 'IP address'], ['infra_ip', 'Infra IP'], ['farm', 'VM farm / cluster'],
    ['it_ot', 'IT / OT'], ['system_type', 'System type (PRD / TST)'], ['platform', 'Platform'], ['os', 'OS'], ['os_version', 'OS / firmware version'], ['domain', 'Domain'],
    ['sap', 'SAP / non-SAP'], ['usage', 'Used for'], ['backup', 'Backup policy'], ['host_model', 'Host model (physical)'], ['serial', 'Serial / service tag (physical)'],
    ['cpu', 'CPU'], ['memory', 'Memory'], ['location', 'Location'], ['ref_key', 'Reference key'], ['description', 'Description', 'wide'], ['impact', 'If it stops', 'wide'], ['notes', 'Notes', 'wide'], ['backup_client', 'Name in the backup reports (if not the hostname)']];

  async function load() {
    const p = new URLSearchParams(); if (q) p.set('search', q); if (kind) p.set('kind', kind); if (itot) p.set('it_ot', itot); if (vst) p.set('status', vst);
    const r = await apiGet('/api/virtual-servers?' + p); rows = r.rows; can = r.can; newest = r.newest_backup || ''; loaded = true; render();
  }
  function render() {
    const box = $('si-vm');
    const nV = rows.filter(r => r.kind !== 'Physical').length, nP = rows.length - nV;
    const hosts = rows.filter(r => r.kind === 'Physical');
    box.innerHTML = `<div class="card"><div class="card-header" style="flex-wrap:wrap;gap:10px">
        <div class="search-box" style="min-width:240px;flex:1"><input type="text" id="vm-q" placeholder="Search hostname, IP, OS, purpose…" value="${esc(q)}"></div>
        <select class="filter-select" id="vm-kind"><option value="">Virtual + physical</option><option${kind === 'Virtual' ? ' selected' : ''}>Virtual</option><option${kind === 'Physical' ? ' selected' : ''}>Physical</option></select>
        <select class="filter-select" id="vm-st"><option value="">All statuses</option>${STATUSES.map(v => `<option${vst === v ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <select class="filter-select" id="vm-itot"><option value="">IT + OT</option><option${itot === 'IT' ? ' selected' : ''}>IT</option><option${itot === 'OT' ? ' selected' : ''}>OT</option></select>
        <span class="text-muted text-sm">${nV} virtual · ${nP} physical host${nP === 1 ? '' : 's'}</span>
        <button class="btn btn-ghost btn-sm" id="vm-bk" title="Backup jobs from the NetBackup daily reports">🗄 Backups</button>
        ${can.edit ? '<button class="btn btn-ghost btn-sm" id="vm-bk-imp" title="Import a \'Daily Backups\' report e-mail (.msg saved from Outlook, or .eml / .txt)">⬆ Import backup report</button><input type="file" id="vm-bk-file" accept=".msg,.eml,.txt,.htm,.html" multiple hidden>' : ''}
        ${can.edit ? '<button class="btn btn-primary btn-sm" id="vm-add">+ Add</button>' : ''}</div>
      ${hosts.length ? `<div class="text-sm" style="padding:8px 20px;border-bottom:1px solid var(--border)">Hosts: ${hosts.map(h => `<b>${esc(h.hostname)}</b>${h.server_id ? ` <a href="/server-inventory.html?view=${h.server_id}" title="Server Inventory record">(${esc(h.server_hostname || h.host_model || '#' + h.server_id)})</a>` : h.host_model ? ` <span class="text-muted">${esc(h.host_model)}</span>` : ''}`).join(' · ')}</div>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Hostname</th><th>Status</th><th>Kind</th><th>IP</th><th>OS</th><th>Used for</th><th>Farm</th><th>Last backup</th><th>Description</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.hostname)}</b><div class="text-muted text-sm">${esc(r.domain || '')}</div></td>
        <td><span class="vm-st ${stCls(r.status || 'Active')}">${esc(r.status || 'Active')}</span></td>
        <td><span class="vm-kind${r.kind === 'Physical' ? ' phys' : ''}">${esc(r.kind || 'Virtual')}</span>${r.it_ot === 'OT' ? ' <span class="vm-ot">OT</span>' : ''}</td>
        <td>${esc(r.ip || r.infra_ip || '')}</td><td class="text-sm">${esc([r.os, r.os_version].filter(Boolean).join(' · '))}</td><td>${esc(r.usage || '')}</td><td class="text-sm">${esc(r.farm || '')}</td>
        <td>${bkCell(r)}</td>
        <td class="vm-desc" title="${esc(r.description || r.impact || '')}"><div class="vm-desc-in">${esc(r.description || r.impact || '')}</div>${r.notes ? `<div class="text-muted">${esc(r.notes)}</div>` : ''}</td>
        <td style="white-space:nowrap">${can.edit ? `<button class="btn btn-ghost btn-sm" data-edit="${r.id}">Edit</button>` : `<button class="btn btn-ghost btn-sm" data-edit="${r.id}">View</button>`}</td></tr>`).join('')
        || `<tr><td colspan="10" class="empty-state">No virtual servers yet${can.admin ? ' — import them from the Factory Info workbook: <a href="/network-map.html">Network map</a> → ⬆ Import Factory Info (.xlsx)' : ''}.</td></tr>`}
      </tbody></table></div></div>`;
    let t; $('vm-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load().then(() => { const i = $('vm-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
    $('vm-kind').onchange = (e) => { kind = e.target.value; load(); };
    $('vm-itot').onchange = (e) => { itot = e.target.value; load(); };
    $('vm-st').onchange = (e) => { vst = e.target.value; load(); };
    if ($('vm-add')) $('vm-add').onclick = () => edit(null);
    $('vm-bk').onclick = () => backups();
    if ($('vm-bk-imp')) { $('vm-bk-imp').onclick = () => $('vm-bk-file').click(); $('vm-bk-file').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importReports(f); }; }
    box.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => edit(rows.find(r => r.id === Number(b.dataset.edit))); });
    const c = $('vm-cnt'); if (c) c.textContent = rows.length && !q && !kind && !itot ? rows.length : c.textContent;
  }

  // ── Backups (NetBackup OpsCenter "Daily Backups" report) ──────────────────
  const fmt = (t) => { if (!t) return ''; const d = new Date(t.replace(' ', 'T')); return isNaN(d) ? t : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const daysBetween = (a, b) => (a && b ? (new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 864e5 : null);
  const ok = (j) => !(Number(j.status_code) > 1 || /fail/i.test(j.status || ''));
  function bkCell(r) {
    const L = r.last_backup;
    if (!L) return r.kind === 'Physical' || ['Decommissioned', 'Powered off'].includes(r.status) ? '<span class="text-muted text-sm">—</span>' : `<span class="bk-chip none" title="This server is not in any imported backup report">Not in the backup reports</span>`;
    const age = daysBetween(L.started_at, newest), imgAge = r.last_image ? daysBetween(r.last_image, newest) : null;
    return `<span class="bk-chip ${ok(L) ? (age > 2 ? 'old' : 'ok') : 'fail'}" title="${esc(L.policy)} · ${esc(L.status)} (code ${L.status_code ?? '?'})">${ok(L) ? '✓' : '✗'} ${esc(fmt(L.started_at))}</span>
      <div class="text-sm text-muted">${r.last_image ? `VM image ${esc(fmt(r.last_image))}${imgAge > 7 ? ' ⚠' : ''}` : 'no VM image backup'}${r.backup_fails ? ` · <b style="color:#b91c1c">${r.backup_fails} failed (7 d)</b>` : ''}</div>`;
  }
  // Read the report: Outlook .msg (a compound file — read with the CFB reader that comes with SheetJS), .eml or text.
  async function lib() { if (window.XLSX) return window.XLSX; await new Promise((ok2, bad) => { const sc = document.createElement('script'); sc.src = '/vendor/xlsx.full.min.js'; sc.onload = ok2; sc.onerror = bad; document.head.appendChild(sc); }); return window.XLSX; }
  async function reportText(file) {
    if (/\.msg$/i.test(file.name)) {
      const X = await lib(), cfb = X.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const part = (id) => { const i = cfb.FullPaths.findIndex(p => p.toUpperCase().endsWith('__SUBSTG1.0_' + id) && !/__(ATTACH|RECIP)/i.test(p)); return i < 0 ? '' : new TextDecoder('utf-16le').decode(new Uint8Array(cfb.FileIndex[i].content)); };
      return { subject: part('0037001F'), text: part('1000001F') };
    }
    let t = await file.text();
    if (/<html|<table/i.test(t)) t = t.replace(/<\/(td|th)>/gi, '\t').replace(/<\/tr>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    return { subject: (t.match(/^Subject:\s*(.+)$/mi) || [, ''])[1], text: t };
  }
  function parseJobs(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const c = line.split('\t').map(x => x.trim());
      if (c.length < 7 || !/^\d+$/.test(c[0]) || !/\d{4}/.test(c[4] || '')) continue;
      rows.push({ job_id: c[0], client: c[1], policy: c[2], status: c[3], started: c[4], ended: c[5], status_code: c[6] });
    }
    const gen = (text.match(/Report generated on\s+([^\t\r\n]+)/i) || [, ''])[1].trim();
    return { rows, generated: gen };
  }
  async function importReports(files) {
    let total = 0, added = 0, failed = 0; const un = new Set();
    for (const f of files) {
      try {
        const { subject, text } = await reportText(f), { rows: jobs, generated } = parseJobs(text);
        if (!jobs.length) { showToast(`${f.name}: no backup jobs found`, 'error'); continue; }
        const r = await apiPost('/api/virtual-servers/backups', { country: 'Vietnam', report: `${subject || f.name}${generated ? ' — ' + generated : ''}`, rows: jobs });
        total += r.jobs; added += r.added; failed += r.failed; r.unmatched.forEach(c => un.add(c));
      } catch (e) { showToast(`${f.name}: ${errText(e, 'could not import')}`, 'error'); }
    }
    if (total) showToast(`Backup report: ${total} jobs (${added} new), ${failed} failed${un.size ? ` · ${un.size} client(s) to link` : ''}`);
    await load(); if (un.size) backups();
  }
  async function backups(client) {
    let ov = $('bk-ov');
    if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'bk-ov';
      ov.innerHTML = '<div class="modal" style="max-width:1100px;width:96vw"><div class="modal-header"><span class="modal-title">🗄 Backup jobs — virtual servers</span><button class="modal-close" aria-label="Close" onclick="document.getElementById(\'bk-ov\').classList.remove(\'open\')">✕</button></div><div class="modal-body" id="bk-b" style="max-height:72vh;overflow:auto"></div></div>';
      document.body.appendChild(ov); }
    ov.classList.add('open'); $('bk-b').innerHTML = '<p class="text-muted">Loading…</p>';
    const days = Number(($('bk-days') || {}).value) || 14;
    const d = await apiGet(`/api/virtual-servers/backups?days=${days}${client ? '&client=' + encodeURIComponent(client) : ''}`);
    const vmOpts = rows.filter(r => r.kind !== 'Physical').map(r => `<option value="${r.id}">${esc(r.hostname)}</option>`).join('');
    const byDay = new Map(); for (const j of d.rows) { const k = j.started_at.slice(0, 10); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(j); }
    const clients = [...new Set(d.rows.map(j => j.vm || j.client))].sort();
    const dur = (j) => { const m = Math.round((new Date(j.ended_at.replace(' ', 'T')) - new Date(j.started_at.replace(' ', 'T'))) / 60000); return isNaN(m) ? '' : m < 1 ? '< 1 min' : m + ' min'; };
    $('bk-b').innerHTML = `
      ${d.unmatched.length ? `<div class="bk-un"><b>Not linked to a virtual server</b> — pick the server it is (saved as its name in the backup reports)${can.edit ? ', or add it' : ''}:
        ${d.unmatched.map(u => `<div class="bk-un-r"><code>${esc(u.client)}</code> <span class="text-muted text-sm">${u.jobs} job${u.jobs > 1 ? 's' : ''}, last ${esc(fmt(u.last))}</span>
          ${can.edit ? `<select class="form-control" data-link="${esc(u.client)}" style="width:auto;display:inline-block;padding:3px 8px"><option value="">Link to…</option>${vmOpts}</select>
          <button class="btn btn-ghost btn-sm" data-addvm="${esc(u.client)}">+ Add as a virtual server</button>` : ''}</div>`).join('')}</div>` : ''}
      <div class="bk-bar"><label class="text-sm">Show <select id="bk-days" class="form-control" style="width:auto;display:inline-block;padding:3px 8px">${[1, 7, 14, 30, 90, 365].map(n => `<option value="${n}"${n === d.days ? ' selected' : ''}>${n === 1 ? 'last day' : 'last ' + n + ' days'}</option>`).join('')}</select></label>
        <select id="bk-client" class="form-control" style="width:auto;padding:3px 8px"><option value="">All servers</option>${clients.map(c => `<option${c === client ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <span class="text-sm">${d.rows.length} jobs · <b style="color:#15803d">${d.rows.filter(ok).length} successful</b>${d.rows.some(j => !ok(j)) ? ` · <b style="color:#b91c1c">${d.rows.filter(j => !ok(j)).length} failed</b>` : ''}</span>
        <span class="text-muted text-sm" style="margin-left:auto">Times as written in the report.</span></div>
      ${d.rows.length ? `<table class="nm-vt bk-t"><thead><tr><th>Job</th><th>Server</th><th>Policy</th><th>Status</th><th>Start</th><th>End</th><th>Took</th><th>Code</th></tr></thead><tbody>
        ${[...byDay.entries()].map(([day, l]) => `<tr class="bk-day"><td colspan="8">${esc(new Date(day + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }))} · ${l.length} jobs${l.some(j => !ok(j)) ? ` · <b style="color:#b91c1c">${l.filter(j => !ok(j)).length} failed</b>` : ''}</td></tr>`
          + l.map(j => `<tr class="${ok(j) ? '' : 'bk-fail'}"><td>${esc(j.job_id)}</td><td><b>${esc(j.vm || j.client)}</b>${j.vm && j.vm !== j.client ? `<div class="text-muted text-sm">${esc(j.client)}</div>` : ''}</td><td class="text-sm">${esc(j.policy)}</td>
            <td>${ok(j) ? '✓ ' : '✗ '}${esc(j.status)}</td><td class="text-sm">${esc(j.started_at.slice(5, 16))}</td><td class="text-sm">${esc(j.ended_at.slice(5, 16))}</td><td class="text-sm">${dur(j)}</td><td>${j.status_code ?? ''}</td></tr>`).join('')).join('')}</tbody></table>`
        : '<p class="text-muted">No backup jobs yet — import a "Daily Backups Hayat Vietnam" report e-mail (⬆ Import backup report).</p>'}
      ${d.reports.length ? `<p class="text-muted text-sm" style="margin-top:12px">Reports imported: ${d.reports.map(r => `${esc(r.report || '—')} (${r.jobs} jobs)`).join(' · ')}</p>` : ''}`;
    $('bk-days').onchange = () => backups($('bk-client').value);
    $('bk-client').onchange = (e) => backups(e.target.value);
    $('bk-b').querySelectorAll('[data-link]').forEach(sel => { sel.onchange = async () => {
      const vm = rows.find(r => r.id === Number(sel.value)); if (!vm) return;
      const names = [...new Set([...(vm.backup_client || '').split(/[,;]/).map(x => x.trim()).filter(Boolean), sel.dataset.link])].join(', ');
      try { await apiPut('/api/virtual-servers/' + vm.id, { backup_client: names }); showToast(`${sel.dataset.link} → ${vm.hostname}`); await load(); backups(client); } catch (e) { showToast(errText(e, 'Could not link'), 'error'); } }; });
    $('bk-b').querySelectorAll('[data-addvm]').forEach(b => { b.onclick = async () => {
      try { await apiPost('/api/virtual-servers', { hostname: b.dataset.addvm, kind: 'Virtual', status: 'Active', country: 'Vietnam', notes: 'Added from a backup report' }); showToast(`${b.dataset.addvm} added`); await load(); backups(client); }
      catch (e) { showToast(errText(e, 'Could not add'), 'error'); } }; });
  }

  function edit(r) {
    let ov = $('vm-ov');
    if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'vm-ov';
      ov.innerHTML = '<div class="modal" style="max-width:760px"><div class="modal-header"><span class="modal-title" id="vm-t"></span><button class="modal-close" aria-label="Close" onclick="document.getElementById(\'vm-ov\').classList.remove(\'open\')">✕</button></div><div class="modal-body" id="vm-b"></div><div class="modal-footer" id="vm-f"></div></div>';
      document.body.appendChild(ov); }
    const x = r || { kind: 'Virtual', status: 'Active', it_ot: 'IT', country: 'Vietnam' }, ro = can.edit ? '' : 'disabled';
    $('vm-t').textContent = r ? `Virtual server — ${r.hostname}` : 'Add virtual server';
    $('vm-b').innerHTML = `<div class="qe-grid">${FIELDS.map(([k, l, w]) => `<div class="form-group${w ? ' span-2' : ''}"><label class="form-label">${l}</label>${k === 'status' ? `<select class="form-control" id="vmf-status" ${ro}>${[...new Set([...STATUSES, x.status || 'Active'])].map(v => `<option${(x.status || 'Active') === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>` : w ? `<textarea class="form-control" id="vmf-${k}" rows="2" ${ro}>${esc(x[k] || '')}</textarea>` : `<input class="form-control" id="vmf-${k}" value="${esc(x[k] || '')}" ${ro}>`}</div>`).join('')}</div>
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
    const up = new URLSearchParams(location.search);
    if (up.get('tab') === 'vm') { if (up.get('search')) q = up.get('search'); tab('vm'); }
    // Count of virtual servers on the tab — once the user is known (the OT team has no virtual servers).
    const vt = setInterval(() => { if (!window.CURRENT_USER) return; clearInterval(vt); if (window.CURRENT_USER.team === 'OT') return;
      apiGet('/api/virtual-servers').then(r => { const c = $('vm-cnt'); if (c && r.rows.length) c.textContent = r.rows.length; }).catch(() => {}); }, 60);
  });
})();
