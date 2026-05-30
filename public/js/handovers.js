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
  const status = document.getElementById('filter-status').value;
  try {
    const rows = await apiGet('/api/assignments' + (status ? `?status=${status}` : ''));
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No assignments.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const label = r.asset_code || r.brand_model || `#${r.asset_id}`;
      const isOpen = r.status === 'assigned';
      return `
      <tr>
        <td><a href="/inventory.html?search=${encodeURIComponent(r.asset_code || r.brand_model || '')}" style="color:var(--brand)">${hEsc(label)}</a></td>
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

document.addEventListener('DOMContentLoaded', () => {
  loadReclaim();
  loadAssignments();
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'asset');
  document.getElementById('filter-status').addEventListener('change', loadAssignments);
});
