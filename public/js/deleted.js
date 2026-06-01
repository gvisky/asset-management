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

    const isGlobalAdmin = window.CURRENT_USER && window.CURRENT_USER.role === 'admin' && !window.CURRENT_USER.country;
    tbody.innerHTML = rows.map(a => {
      const label = (a.asset_code || a.brand_model || '').replace(/'/g, "\\'");
      const purgeBtn = isGlobalAdmin
        ? `<button class="btn btn-danger btn-sm" onclick="purgeAsset(${a.id}, '${label}')" title="Delete permanently">🗑 Delete</button>`
        : '';
      return `
      <tr>
        <td><code style="font-size:12px;color:var(--brand)">${a.asset_code || '—'}</code></td>
        <td>${a.brand_model || '—'}</td>
        <td>${locationBadge(a.location)}</td>
        <td class="truncate" title="${(a.department || '').replace(/"/g,'&quot;')}">${a.department || '—'}</td>
        <td>${a.user_name || '—'}</td>
        <td><span class="badge badge-broken">${a.deleted_by || 'unknown'}</span></td>
        <td class="text-muted text-sm" style="white-space:nowrap">${a.deleted_at || '—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary btn-sm" onclick="restoreAsset(${a.id}, '${label}')">↩ Restore</button>
            ${purgeBtn}
          </div>
        </td>
      </tr>`;
    }).join('');
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

async function purgeAsset(id, label) {
  if (!confirm(`Permanently delete "${label}"? This CANNOT be undone.`)) return;
  try {
    await apiDelete(`/api/assets/${id}/purge`);
    showToast('Permanently deleted');
    loadDeleted();
  } catch (err) {
    showToast('Delete failed (IT admin only)', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Guard + load once CURRENT_USER is known (so the IT-admin Delete button renders).
  setTimeout(() => {
    if (window.CURRENT_USER && window.CURRENT_USER.role !== 'admin') { window.location.href = '/'; return; }
    loadDeleted();
  }, 400);
});
