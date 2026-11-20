/* 🕓 OT Activity (/ot-activity.html, routes/ot-activity.js): every change to the OT devices and the OT switch ports — who,
   when, what changed — and ↩ Restore to put one back as it was (OT admins, IT admins). */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return (e && e.message) || f; } };
  const KIND = { device_add: '✚ Device added', device_edit: '✏️ Device edited', device_delete: '🗑 Device deleted', port: '🔌 Port changed', port_owner: '🎨 Port owner', restore: '↩ Restored' };
  const F = { days: '30', kind: '', user: '', team: '', q: '' };
  let D = null, t = null;

  async function load() {
    const qs = new URLSearchParams(Object.entries(F).filter(([, v]) => v));
    try { D = await apiGet('/api/ot-activity?' + qs); render(); }
    catch (e) { $('oac-root').innerHTML = `<p class="text-muted">${esc(errText(e, 'Could not load'))}</p>`; }
  }
  const when = (s) => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
  function render() {
    $('oac-sub').textContent = `· ${D.rows.length} change${D.rows.length === 1 ? '' : 's'}${D.rows.length === 500 ? ' (latest 500)' : ''}`;
    const sel = (id, opts, v) => `<select class="filter-select" id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const first = !$('oac-q');
    if (first) $('oac-root').innerHTML = `<div class="us-bar2" style="margin:0 0 12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="form-control" id="oac-q" placeholder="Search device, port, change, person…" style="max-width:280px">
        ${sel('oac-days', [['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last year']], F.days)}
        ${sel('oac-kind', [['', 'All changes'], ...Object.entries(KIND)], F.kind)}
        ${sel('oac-team', [['', 'OT team and IT'], ['OT', 'OT team'], ['IT', 'IT']], F.team)}
        <span id="oac-users"></span>
        <span class="text-muted text-sm">${D.canRestore ? '↩ Restore puts the device / port back as it was before that change (the restore is logged too).' : ''}</span></div><div id="oac-list"></div>`;
    $('oac-users').innerHTML = sel('oac-user', [['', 'Everyone'], ...D.users.map(u => [u, u])], F.user);
    $('oac-list').innerHTML = `<div class="card"><div class="table-wrap"><table class="nm-vt"><thead><tr><th>When</th><th>Who</th><th>Change</th><th>Device / port</th><th>What changed</th><th></th></tr></thead><tbody>
      ${D.rows.map(r => `<tr class="${r.restored_at ? 'oac-done' : ''}"><td class="text-sm" style="white-space:nowrap">${esc(when(r.at))}</td>
        <td style="white-space:nowrap">${esc(r.by_user)} ${r.by_team ? `<span class="oac-tm ${esc(r.by_team)}">${esc(r.by_team)}</span>` : ''}</td>
        <td><span class="oac-k ${esc(r.kind)}">${esc(KIND[r.kind] || r.kind)}</span></td>
        <td>${r.ref_type === 'server' ? `<a href="/server-inventory.html?view=${r.ref_id}" target="_blank" rel="noopener"><b>${esc(r.label)}</b></a>` : `<b>${esc(r.label)}</b>`}</td>
        <td class="text-sm">${esc(r.summary)}${r.restored_at ? `<div class="text-muted">↩ restored ${esc(when(r.restored_at))} by ${esc(r.restored_by)}</div>` : ''}${r.changed_since ? '<div style="color:#b45309">⚠ changed again since</div>' : ''}</td>
        <td style="white-space:nowrap">${D.canRestore && !r.restored_at && r.kind !== 'restore' ? `<button class="btn btn-ghost btn-sm oac-r" data-id="${r.id}">↩ Restore</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty-state">No changes in this period.</td></tr>'}</tbody></table></div></div>`;
    if (first) {
      $('oac-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value.trim(); load(); }, 300); };
      [['oac-days', 'days'], ['oac-kind', 'kind'], ['oac-team', 'team']].forEach(([id, k]) => { $(id).onchange = (e) => { F[k] = e.target.value; load(); }; });
    }
    $('oac-user').onchange = (e) => { F.user = e.target.value; load(); };
    $('oac-list').querySelectorAll('.oac-r').forEach(b => { b.onclick = () => restore(Number(b.dataset.id)); });
  }
  async function restore(id) {
    const r = D.rows.find(x => x.id === id);
    const what = r.kind === 'device_add' ? `This removes ${r.label} again (it goes to the deleted devices; you can restore that too).`
      : r.kind === 'device_delete' ? `${r.label} comes back with everything it had.` : `${r.label} goes back to how it was before:\n${r.summary}`;
    if (!confirm(`Restore — ${KIND[r.kind] || r.kind} by ${r.by_user}, ${when(r.at)}?\n\n${what}${r.changed_since ? '\n\n⚠ It was changed again after this — those later changes are undone too.' : ''}`)) return;
    try { await apiPost(`/api/ot-activity/${id}/restore`, {}); showToast(`${r.label} restored`); load(); }
    catch (e) { showToast(errText(e, 'Could not restore'), 'error'); }
  }
  document.addEventListener('DOMContentLoaded', load);
})();
