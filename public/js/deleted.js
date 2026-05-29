/* Recycle Bin (admin only) — list soft-deleted assets and restore them. */

async function loadDeleted() {
  try {
    const rows = await apiGet('/api/assets/deleted');
    const tbody = document.getElementById('deleted-tbody');
    document.getElementById('deleted-count').textContent =
      rows.length ? `${rows.length} deleted record${rows.length !== 1 ? 's' : ''}` : '';

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        <p>Recycle bin is empty.</p>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(a => `
      <tr>
        <td><code style="font-size:12px;color:var(--brand)">${a.asset_code || '—'}</code></td>
        <td>${a.brand_model || '—'}</td>
        <td>${locationBadge(a.location)}</td>
        <td class="truncate" title="${(a.department || '').replace(/"/g,'&quot;')}">${a.department || '—'}</td>
        <td>${a.user_name || '—'}</td>
        <td><span class="badge badge-broken">${a.deleted_by || 'unknown'}</span></td>
        <td class="text-muted text-sm" style="white-space:nowrap">${a.deleted_at || '—'}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="restoreAsset(${a.id}, '${(a.asset_code || a.brand_model || '').replace(/'/g,"\\'")}')">
            ↩ Restore
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load recycle bin', 'error');
  }
}

async function restoreAsset(id, label) {
  if (!confirm(`Restore "${label}" back to the inventory?`)) return;
  try {
    await apiPost(`/api/assets/${id}/restore`, {});
    showToast('Asset restored');
    loadDeleted();
  } catch (err) {
    showToast('Restore failed', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Guard: only admins. auth.js sets CURRENT_USER shortly after load.
  setTimeout(() => {
    if (window.CURRENT_USER && window.CURRENT_USER.role !== 'admin') window.location.href = '/';
  }, 400);
  loadDeleted();
});
