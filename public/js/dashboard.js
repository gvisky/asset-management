/* Dashboard page logic */

async function loadStats() {
  try {
    const stats = await apiGet('/api/assets/stats');

    document.getElementById('s-total').textContent   = stats.total;
    document.getElementById('s-active').textContent  = stats.byStatus.Active  || 0;
    document.getElementById('s-broken').textContent  = stats.byStatus.Broken  || 0;
    document.getElementById('s-retired').textContent = stats.byStatus.Retired || 0;
    document.getElementById('s-factory').textContent = stats.byLocation.Factory || 0;
    document.getElementById('s-office').textContent  = stats.byLocation.Office  || 0;

    // Brand bars
    const brandEl = document.getElementById('brand-bars');
    const maxCount = stats.byBrand[0]?.cnt || 1;
    brandEl.innerHTML = stats.byBrand.map(b => `
      <a class="bar-item" href="/inventory.html?search=${encodeURIComponent(b.brand_model || '')}" title="View ${b.brand_model || 'these'} assets">
        <div class="bar-label">
          <span>${b.brand_model || 'Unknown'}</span>
          <span><strong>${b.cnt}</strong></span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.round(b.cnt / maxCount * 100)}%"></div>
        </div>
      </a>
    `).join('') || '<div class="text-muted text-sm">No data</div>';

    // Status breakdown bars
    const statusColors = { Active: '#22c55e', Broken: '#ef4444', Retired: '#f59e0b' };
    const statusEl = document.getElementById('status-chart');
    const total = stats.total || 1;
    statusEl.innerHTML = ['Active','Broken','Retired'].map(s => {
      const cnt = stats.byStatus[s] || 0;
      const pct = Math.round(cnt / total * 100);
      return `
        <a class="bar-item" href="/inventory.html?status=${s}" title="View ${s} assets">
          <div class="bar-label">
            <span>${statusBadge(s)}</span>
            <span><strong>${cnt}</strong> <span class="text-muted">(${pct}%)</span></span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct}%;background:${statusColors[s]}"></div>
          </div>
        </a>
      `;
    }).join('');

    // Recent assets table
    const tbody = document.getElementById('recent-tbody');
    if (!stats.recentlyAdded.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No assets yet. <a href="#" id="add-first">Add your first asset →</a></div></td></tr>`;
      return;
    }
    tbody.innerHTML = stats.recentlyAdded.map(a => `
      <tr>
        <td><code style="font-size:12px">${a.asset_code || '—'}</code></td>
        <td>${a.brand_model || '—'}</td>
        <td>${locationBadge(a.location)}</td>
        <td class="truncate" title="${a.department || ''}">${a.department || '—'}</td>
        <td>${a.user_name || '—'}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>
    `).join('');

  } catch (err) {
    console.error(err);
    showToast('Failed to load dashboard stats', 'error');
  }
}

// ── Save handler (modal save on dashboard page) ───────────────────────────────
let _saveMode = 'add';

document.addEventListener('DOMContentLoaded', () => {
  loadStats();

  const saveBtn = document.getElementById('modal-save');
  if (!saveBtn) return;

  // "Add Asset" buttons open the modal in add mode
  document.querySelectorAll('#btn-add-top, #nav-add').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      _saveMode = 'add';
      clearForm();
      openModal('Add Asset');
    });
  });

  saveBtn.addEventListener('click', async () => {
    const data = getFormData();
    if (!data.location) { showToast('Please select a location', 'error'); return; }
    try {
      if (_saveMode === 'add') {
        await apiPost(API, data);
        showToast('Asset added successfully');
      }
      closeModal();
      loadStats();
    } catch (err) {
      showToast('Error saving asset', 'error');
    }
  });
});
