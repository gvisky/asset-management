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
  const qs = new URLSearchParams();
  if (status)  qs.set('status', status);
  if (country) qs.set('country', country);

  try {
    const rows = await apiGet('/api/maintenance' + (qs.toString() ? `?${qs}` : ''));
    document.getElementById('total-label').textContent =
      rows.length ? `${rows.length} record(s)` : '';

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No maintenance records.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(m => {
      const label = m.asset_code || m.brand_model || `#${m.asset_id}`;
      return `
      <tr>
        <td><a href="/inventory.html?search=${encodeURIComponent(m.asset_code || m.brand_model || '')}" style="color:var(--brand)">${mEsc(label)}</a>
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

document.addEventListener('DOMContentLoaded', () => {
  loadCountries();
  loadMaint();
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'asset');
  document.getElementById('filter-status').addEventListener('change', loadMaint);
  document.getElementById('filter-country').addEventListener('change', loadMaint);
});
