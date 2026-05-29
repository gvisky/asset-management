/* Asset Inventory page logic */

let currentPage = 1;
const PAGE_SIZE = 25;
let deleteTargetId = null;
let viewAsset = null;
let editMode = false;

// ── Fetch & render table ──────────────────────────────────────────────────────
async function loadAssets(page = 1) {
  currentPage = page;
  const search   = document.getElementById('search-input').value.trim();
  const location = document.getElementById('filter-location').value;
  const status   = document.getElementById('filter-status').value;

  const params = new URLSearchParams({ page, limit: PAGE_SIZE });
  if (search)   params.set('search',   search);
  if (location) params.set('location', location);
  if (status)   params.set('status',   status);

  try {
    const result = await apiGet(`${API}?${params}`);
    renderTable(result.data);
    renderPagination(result.total, result.page, result.limit);
    const lbl = document.getElementById('total-label');
    if (lbl) lbl.textContent = `${result.total} asset${result.total !== 1 ? 's' : ''}`;
  } catch (err) {
    console.error(err);
    showToast('Failed to load assets', 'error');
  }
}

function renderTable(rows) {
  const tbody = document.getElementById('assets-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
      <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
      <p>No assets found.</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((a, i) => `
    <tr>
      <td class="text-muted text-sm">${a.id}</td>
      <td><code style="font-size:12px;color:var(--brand)">${a.asset_code || '—'}</code></td>
      <td>${a.brand_model || '—'}</td>
      <td class="text-muted text-sm">${a.computer_no || '—'}</td>
      <td>${locationBadge(a.location)}</td>
      <td class="truncate" title="${esc(a.department) }">${a.department || '—'}</td>
      <td>${a.user_name || '—'}</td>
      <td class="text-muted text-sm">${a.serial_no || '—'}</td>
      <td>${statusBadge(a.status)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="onView(${a.id})" title="View">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="onEdit(${a.id})" title="Edit">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm" onclick="onDelete(${a.id}, '${esc(a.asset_code || a.brand_model)}')" title="Delete">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function esc(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const info = document.getElementById('page-info');
  const from = Math.min((page - 1) * limit + 1, total);
  const to   = Math.min(page * limit, total);
  if (info) info.textContent = total ? `Showing ${from}–${to} of ${total}` : '';

  const el = document.getElementById('pagination');
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }

  let html = '';
  const prev = page > 1;
  const next = page < totalPages;
  html += `<button class="page-btn" ${prev ? '' : 'disabled'} onclick="loadAssets(${page - 1})">‹</button>`;

  // Show max 7 page buttons
  const range = pagRange(page, totalPages);
  range.forEach(p => {
    if (p === '…') {
      html += `<span class="page-btn" style="cursor:default;border:none">…</span>`;
    } else {
      html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="loadAssets(${p})">${p}</button>`;
    }
  });
  html += `<button class="page-btn" ${next ? '' : 'disabled'} onclick="loadAssets(${page + 1})">›</button>`;
  el.innerHTML = html;
}

function pagRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1,2,3,4,5,'…',total];
  if (current >= total - 3) return [1,'…',total-4,total-3,total-2,total-1,total];
  return [1,'…',current-1,current,current+1,'…',total];
}

// ── View detail ───────────────────────────────────────────────────────────────
async function onView(id) {
  try {
    const a = await apiGet(`${API}/${id}`);
    viewAsset = a;

    const fields = [
      ['Asset Code',    a.asset_code],
      ['Brand / Model', a.brand_model],
      ['Location',      locationBadge(a.location)],
      ['Status',        statusBadge(a.status)],
      ['Department',    a.department],
      ['Computer No',   a.computer_no],
      ['Serial #',      a.serial_no],
      ['M&K',           a.mk],
      ['User Name',     a.user_name],
      ['AD Name',       a.ad_name],
      ['Date Assigned', a.date_assigned],
      ['History Usage', a.history_usage],
      ['Remark',        a.remark],
    ];

    document.getElementById('view-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fields.map(([label, val]) => `
          <div>
            <div class="form-label" style="margin-bottom:3px">${label}</div>
            <div style="font-size:13.5px">${val || '<span class="text-muted">—</span>'}</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('view-overlay').classList.add('open');
  } catch (err) {
    showToast('Failed to load asset', 'error');
  }
}

// ── Edit ──────────────────────────────────────────────────────────────────────
async function onEdit(id) {
  try {
    const a = await apiGet(`${API}/${id}`);
    setFormData(a);
    editMode = true;
    openModal('Edit Asset');
  } catch (err) {
    showToast('Failed to load asset', 'error');
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
function onDelete(id, label) {
  deleteTargetId = id;
  document.getElementById('del-label').textContent = label;
  document.getElementById('del-overlay').classList.add('open');
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Apply filters passed via the URL (e.g. from the dashboard cards):
//   ?status=Broken   ?location=Factory   ?search=Lenovo T490
function applyUrlFilters() {
  const p = new URLSearchParams(window.location.search);
  const status = p.get('status') || '';
  const location = p.get('location') || '';
  const search = p.get('search') || '';
  if (status)   document.getElementById('filter-status').value = status;
  if (location) document.getElementById('filter-location').value = location;
  if (search)   document.getElementById('search-input').value = search;
}

document.addEventListener('DOMContentLoaded', () => {
  applyUrlFilters();
  loadAssets();

  // Search & filter with debounce
  let debounce;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadAssets(1), 320);
  });
  document.getElementById('filter-location').addEventListener('change', () => loadAssets(1));
  document.getElementById('filter-status').addEventListener('change',   () => loadAssets(1));

  // Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-location').value = '';
    document.getElementById('filter-status').value = '';
    loadAssets(1);
  });

  // Add/Edit modal save
  const saveBtn = document.getElementById('modal-save');
  saveBtn.addEventListener('click', async () => {
    const data = getFormData();
    if (!data.location) { showToast('Please select a location', 'error'); return; }
    try {
      const id = document.getElementById('asset-id').value;
      if (editMode && id) {
        await apiPut(`${API}/${id}`, data);
        showToast('Asset updated');
      } else {
        await apiPost(API, data);
        showToast('Asset added');
      }
      closeModal();
      editMode = false;
      loadAssets(currentPage);
    } catch (err) {
      showToast('Error saving asset', 'error');
    }
  });

  // Add asset buttons
  document.querySelectorAll('#btn-add-top, #nav-add').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      editMode = false;
      clearForm();
      openModal('Add Asset');
    });
  });

  // View modal
  document.getElementById('view-close').addEventListener('click', () => document.getElementById('view-overlay').classList.remove('open'));
  document.getElementById('view-close-btn').addEventListener('click', () => document.getElementById('view-overlay').classList.remove('open'));
  document.getElementById('view-edit-btn').addEventListener('click', () => {
    document.getElementById('view-overlay').classList.remove('open');
    if (viewAsset) onEdit(viewAsset.id);
  });

  // Delete modal
  document.getElementById('del-close').addEventListener('click',  () => document.getElementById('del-overlay').classList.remove('open'));
  document.getElementById('del-cancel').addEventListener('click', () => document.getElementById('del-overlay').classList.remove('open'));
  document.getElementById('del-confirm').addEventListener('click', async () => {
    if (!deleteTargetId) return;
    try {
      await apiDelete(`${API}/${deleteTargetId}`);
      showToast('Asset deleted');
      document.getElementById('del-overlay').classList.remove('open');
      deleteTargetId = null;
      loadAssets(currentPage);
    } catch (err) {
      showToast('Error deleting asset', 'error');
    }
  });
});
