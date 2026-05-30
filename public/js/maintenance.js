/* Maintenance & Repairs page logic */

const MBADGE = { open: 'badge-broken', in_progress: 'badge-retired', done: 'badge-active' };
const mLabel = (s) => ({ open: 'Open', in_progress: 'In progress', done: 'Done' }[s] || s);
const mEsc   = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadCountries() {
  try {
    const { countries } = await apiGet('/api/assets/filters');
    const sel = document.getElementById('filter-country');
    sel.innerHTML = '<option value="">All Countries</option>' +
      countries.map(c => `<option>${mEsc(c)}</option>`).join('');
  } catch (e) { /* non-fatal */ }
}

async function loadMaint() {
  const tbody = document.getElementById('maint-tbody');
  const status  = document.getElementById('filter-status').value;
  const country = document.getElementById('filter-country').value;
  const type    = document.getElementById('filter-type').value;
  const qs = new URLSearchParams();
  if (status)  qs.set('status', status);
  if (country) qs.set('country', country);
  if (type)    qs.set('asset_type', type);

  try {
    const rows = await apiGet('/api/maintenance' + (qs.toString() ? `?${qs}` : ''));
    document.getElementById('total-label').textContent =
      rows.length ? `${rows.length} record(s)` : '';

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No maintenance records.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(m => {
      const isServer = m.asset_type === 'server';
      const label = m.item_label || `#${m.asset_id}`;
      const href = (isServer ? '/server-inventory.html' : '/inventory.html') + `?search=${encodeURIComponent(label)}`;
      const typeBadge = `<span class="badge ${isServer ? 'badge-office' : 'badge-factory'}">${isServer ? 'Server' : 'Asset'}</span>`;
      return `
      <tr>
        <td>${typeBadge} <a href="${href}" style="color:var(--brand)">${mEsc(label)}</a>
            <div class="text-muted text-sm">${mEsc(m.location || '')}</div></td>
        <td>${mEsc(m.type)}</td>
        <td>${mEsc(m.description)}</td>
        <td class="text-muted text-sm">${mEsc(m.vendor) || '—'}</td>
        <td class="text-muted text-sm">${mEsc(m.cost) || '—'}</td>
        <td class="text-muted text-sm">${mEsc(m.reported_at)}<div class="text-muted text-sm">${mEsc(m.reported_by)}</div></td>
        <td><span class="badge ${MBADGE[m.status] || ''}">${mLabel(m.status)}</span></td>
        <td>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="form-control maint-edit" style="max-width:130px;padding:4px 8px" onchange="onStatus(${m.id}, this.value)">
              ${['open','in_progress','done'].map(s => `<option value="${s}" ${s === m.status ? 'selected' : ''}>${mLabel(s)}</option>`).join('')}
            </select>
            <button class="btn btn-danger btn-sm" onclick="onDelete(${m.id})" title="Delete">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load.</td></tr>';
  }
}

async function onStatus(id, status) {
  try { await apiPut(`/api/maintenance/${id}`, { status }); showToast('Updated'); loadMaint(); }
  catch (e) { showToast('Update failed', 'error'); }
}

async function onDelete(id) {
  if (!confirm('Delete this maintenance record?')) return;
  try { await apiDelete(`/api/maintenance/${id}`); showToast('Deleted'); loadMaint(); }
  catch (e) { showToast('Delete failed (admin only)', 'error'); }
}

// ── Log Maintenance modal (pick an asset or server, then record) ───────────────
function openAdd() {
  ['m-search', 'm-desc', 'm-vendor', 'm-cost'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('m-item').innerHTML = '<option value="">Type in “Find item” above…</option>';
  document.getElementById('add-overlay').classList.add('open');
  searchItems();
}
function closeAdd() { document.getElementById('add-overlay').classList.remove('open'); }

async function searchItems() {
  const type = document.getElementById('m-type').value;
  const q = document.getElementById('m-search').value.trim();
  const base = type === 'server' ? '/api/servers' : '/api/assets';
  try {
    const res = await apiGet(`${base}?limit=25${q ? '&search=' + encodeURIComponent(q) : ''}`);
    const items = res.data || [];
    const sel = document.getElementById('m-item');
    sel.innerHTML = '<option value="">Select…</option>' + items.map(it => {
      const label = type === 'server' ? (it.hostname || it.asset_code || ('#' + it.id))
                                       : (it.asset_code || it.brand_model || ('#' + it.id));
      const sub = it.brand_model && it.brand_model !== label ? ' — ' + it.brand_model : '';
      return `<option value="${it.id}">${mEsc(label + sub)}</option>`;
    }).join('');
  } catch (e) { /* non-fatal */ }
}

async function onAddSave() {
  const asset_type = document.getElementById('m-type').value;
  const asset_id = document.getElementById('m-item').value;
  const description = document.getElementById('m-desc').value.trim();
  if (!asset_id) { showToast('Pick an item', 'error'); return; }
  if (!description) { showToast('Enter a description', 'error'); return; }
  try {
    await apiPost('/api/maintenance', {
      asset_type, asset_id: Number(asset_id),
      type: document.getElementById('m-mtype').value,
      status: document.getElementById('m-status').value,
      description,
      vendor: document.getElementById('m-vendor').value.trim(),
      cost: document.getElementById('m-cost').value.trim(),
    });
    showToast('Maintenance logged');
    closeAdd();
    loadMaint();
  } catch (e) { showToast('Failed to log maintenance', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCountries();
  loadMaint();
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'asset');
  document.getElementById('filter-status').addEventListener('change', loadMaint);
  document.getElementById('filter-country').addEventListener('change', loadMaint);
  document.getElementById('filter-type').addEventListener('change', loadMaint);

  // Log Maintenance modal
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('add-close').addEventListener('click', closeAdd);
  document.getElementById('add-cancel').addEventListener('click', closeAdd);
  document.getElementById('add-save').addEventListener('click', onAddSave);
  document.getElementById('m-type').addEventListener('change', searchItems);
  let d;
  document.getElementById('m-search').addEventListener('input', () => { clearTimeout(d); d = setTimeout(searchItems, 300); });
});
