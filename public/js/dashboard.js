/* Dashboard page logic */

async function loadStats() {
  try {
    const stats = await apiGet('/api/assets/stats');

    document.getElementById('s-total').textContent   = stats.total;
    document.getElementById('s-active').textContent  = stats.byStatus.Active  || 0;
    document.getElementById('s-broken').textContent  = stats.byStatus.Broken  || 0;
    document.getElementById('s-stock').textContent   = stats.byStatus.Stock  || 0;
    document.getElementById('s-factory').textContent = stats.byLocation.Factory || 0;
    document.getElementById('s-office').textContent  = stats.byLocation.Office  || 0;
    const warrEl = document.getElementById('s-warranty');
    const repEl  = document.getElementById('s-repairs');
    if (warrEl) warrEl.textContent = stats.warrantyExpiring || 0;
    if (repEl)  repEl.textContent  = stats.openRepairs || 0;

    // Licenses metric comes from its own endpoint (separate module).
    const licEl = document.getElementById('s-licenses');
    if (licEl) {
      apiGet('/api/licenses/stats')
        .then(ls => { licEl.textContent = ls.expiring || 0; })
        .catch(() => { licEl.textContent = '0'; });
    }

    // By-country cards (Vietnam / Thailand / Malaysia) — appended to the stat grid.
    renderCountryCards(stats.byCountry || {});

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

// Load the User Inventory (personnel) summary cards for the dashboard.
async function loadPersonnelSummary() {
  try {
    const s = await apiGet('/api/personnel/summary');
    const grid = document.getElementById('personnel-grid');
    const cards = [
      ['Total People',   s.total,                      '#e0e7ff', '#4338ca', 'all'],
      ['Hayat: No',      s.noHayat || 0,               '#fee2e2', '#dc2626', 'No Hayat Member'],
      ['Leaving set',    s.leaving || 0,               '#fef3c7', '#d97706', ''],
      ['To Be Delete',   s.byStatus['to be delete'] || 0,   '#fef9c3', '#ca8a04', 'to be delete'],
      ['Pending Delete', s.byStatus['pending delete'] || 0, '#ffedd5', '#ea580c', 'pending delete'],
      ['Deleted',        s.byStatus['deleted'] || 0,        '#fee2e2', '#b91c1c', 'deleted'],
    ];
    grid.innerHTML = cards.map(([label, val, bg, fg, statusFilter]) => {
      const href = statusFilter === 'No Hayat Member'
        ? `/user-inventory.html?user_type=${encodeURIComponent(statusFilter)}`
        : statusFilter ? `/user-inventory.html?status=${encodeURIComponent(statusFilter)}`
        : `/user-inventory.html`;
      return `<a class="stat-card" href="${href}">
        <div class="stat-icon" style="background:${bg}">
          <svg width="22" height="22" fill="none" stroke="${fg}" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <div><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div>
      </a>`;
    }).join('');
    document.getElementById('personnel-section').style.display = '';
  } catch (e) {
    // user without personnel access — leave the section hidden
  }
}

// Render one clickable card per country, appended to the stat grid.
function renderCountryCards(byCountry) {
  const grid = document.getElementById('stat-grid');
  if (!grid) return;
  // Remove any previously-rendered country cards (avoid duplicates on reload).
  grid.querySelectorAll('.country-card').forEach(el => el.remove());

  const colors = {
    Vietnam:  ['#fef2f2', '#dc2626'],
    Thailand: ['#eff6ff', '#2563eb'],
    Malaysia: ['#fefce8', '#ca8a04'],
  };
  // Always show the three countries (0 if none), unless the user is scoped to one.
  const scoped = window.CURRENT_USER && window.CURRENT_USER.country;
  const list = scoped ? [scoped] : ['Vietnam', 'Thailand', 'Malaysia'];

  list.forEach(country => {
    const [bg, fg] = colors[country] || ['#f3f4f6', '#374151'];
    const a = document.createElement('a');
    a.className = 'stat-card country-card';
    a.href = `/inventory.html?country=${encodeURIComponent(country)}`;
    a.innerHTML = `
      <div class="stat-icon" style="background:${bg}">
        <svg width="22" height="22" fill="none" stroke="${fg}" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <div><div class="stat-label">${country}</div><div class="stat-value">${byCountry[country] || 0}</div></div>`;
    grid.appendChild(a);
  });
}

// ── Missing-info alerts table ─────────────────────────────────────────────────
async function loadAlerts() {
  const tbody = document.getElementById('alert-tbody');
  try {
    const rows = await apiGet('/api/assets/incomplete');

    const badge = document.getElementById('alert-count');
    if (rows.length) {
      badge.textContent = `${rows.length} to fix`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">
        <svg width="36" height="36" fill="none" stroke="#22c55e" stroke-width="1.5" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>All assets have their key info. 🎉</p>
      </div></td></tr>`;
      return;
    }

    const miss = (v) => (v === null || v === undefined || String(v).trim() === '');

    tbody.innerHTML = rows.map(a => {
      const tags = [];
      if (miss(a.serial_no))   tags.push('Serial');
      if (miss(a.asset_code))  tags.push('Code');
      if (miss(a.computer_no)) tags.push('PC No');
      const tagHtml = tags.map(t =>
        `<span class="badge badge-broken" style="margin:1px;font-size:10.5px;padding:2px 6px">${t}</span>`).join('');
      const label = a.brand_model || a.user_name || a.department || `Asset #${a.id}`;
      return `
        <tr>
          <td style="min-width:120px">
            <div class="truncate" title="${(label).replace(/"/g,'&quot;')}" style="max-width:140px">${label}</div>
            <span class="text-muted text-sm">#${a.id} · ${a.location}</span>
          </td>
          <td>${tagHtml}</td>
          <td><a class="btn btn-primary btn-sm" href="/inventory.html?edit=${a.id}" title="Fill in missing info">Fill</a></td>
        </tr>`;
    }).join('');
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load alerts</td></tr>`;
  }
}

// ── Save handler (modal save on dashboard page) ───────────────────────────────
let _saveMode = 'add';

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadAlerts();                         // missing-info table (asset data quality)
  loadPersonnelSummary();               // User Inventory summary cards
  loadAlertBox('alert-box', '');        // consolidated notifications (all scopes)

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
