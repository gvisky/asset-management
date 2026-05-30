/* Assignments & Handovers page logic */

const hEsc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadReclaim() {
  const tbody = document.getElementById('reclaim-tbody');
  try {
    const rows = await apiGet('/api/assignments/reclaim');
    const badge = document.getElementById('reclaim-count');
    if (badge) {
      badge.textContent = `${rows.length}`;
      badge.style.display = rows.length ? '' : 'none';
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nothing to reclaim — no assets held by leaving personnel.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${hEsc(r.person)}</strong><div class="text-muted text-sm">${hEsc(r.email)}</div></td>
        <td class="text-muted text-sm">${hEsc(r.leaving_date)}</td>
        <td><a href="/inventory.html?search=${encodeURIComponent(r.asset_code || r.brand_model || '')}" style="color:var(--brand)">${hEsc(r.asset_code || r.brand_model || ('#' + r.asset_id))}</a></td>
        <td class="text-muted text-sm">${hEsc(r.location || '')} · ${hEsc(r.country)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load.</td></tr>';
  }
}

async function loadAssignments() {
  const tbody = document.getElementById('asg-tbody');
  const view = document.getElementById('filter-status').value;
  try {
    // "current" = live holders from the asset table; otherwise the handover log.
    const url = view === 'current' ? '/api/assignments/current'
              : '/api/assignments' + (view ? `?status=${view}` : '');
    const rows = await apiGet(url);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${view === 'current' ? 'No assets are currently assigned to anyone.' : 'No handover records.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const label = r.asset_code || r.brand_model || `#${r.asset_id}`;
      const link = `<a href="/inventory.html?search=${encodeURIComponent(r.asset_code || r.brand_model || '')}" style="color:var(--brand)">${hEsc(label)}</a>`;
      if (view === 'current') {
        return `
        <tr>
          <td>${link}</td>
          <td>${hEsc(r.assignee_name)}${r.assignee_ad ? `<div class="text-muted text-sm">${hEsc(r.assignee_ad)}</div>` : ''}</td>
          <td class="text-muted text-sm">${hEsc(r.location || '')}</td>
          <td class="text-muted text-sm">${hEsc(r.assigned_at || r.date_assigned || '')}${r.assignment_id ? '' : '<div class="text-muted text-sm">(from inventory)</div>'}</td>
          <td class="text-muted text-sm">${hEsc(r.assigned_by || '')}</td>
          <td>${statusBadge(r.status)}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="onReturnAsset(${r.asset_id})">Check-in</button></td>
        </tr>`;
      }
      const isOpen = r.status === 'assigned';
      return `
      <tr>
        <td>${link}</td>
        <td>${hEsc(r.assignee_name)}${r.assignee_ad ? `<div class="text-muted text-sm">${hEsc(r.assignee_ad)}</div>` : ''}</td>
        <td class="text-muted text-sm">${hEsc(r.location || '')}</td>
        <td class="text-muted text-sm">${hEsc(r.assigned_at)}</td>
        <td class="text-muted text-sm">${hEsc(r.assigned_by)}</td>
        <td><span class="badge ${isOpen ? 'badge-active' : 'badge-retired'}">${isOpen ? 'Holding' : 'Returned'}</span></td>
        <td>${isOpen
          ? `<button class="btn btn-ghost btn-sm" onclick="onReturn(${r.id})">Check-in</button>`
          : '<span class="text-muted text-sm">—</span>'}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load.</td></tr>';
  }
}

async function onReturn(id) {
  if (!confirm('Check this asset back in (moves it to Stock)?')) return;
  try {
    await apiPost(`/api/assignments/${id}/return`, {});
    showToast('Checked in');
    loadAssignments();
    loadReclaim();
  } catch (e) { showToast('Check-in failed', 'error'); }
}

async function onReturnAsset(assetId) {
  if (!confirm('Check this asset back in (clears the user, moves it to Stock)?')) return;
  try {
    await apiPost(`/api/assignments/asset/${assetId}/return`, {});
    showToast('Checked in');
    loadAssignments();
    loadReclaim();
  } catch (e) { showToast('Check-in failed', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadReclaim();
  loadAssignments();
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'asset');
  document.getElementById('filter-status').addEventListener('change', loadAssignments);
});
