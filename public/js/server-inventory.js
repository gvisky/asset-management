/* Server Asset Inventory page logic */

const SAPI = '/api/servers';
const HISTORY_OWNER = 'viet';
let sCurrentPage = 1;
let sDeleteId = null;
let viewServer = null;

const sEsc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sAttr = (s) => String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

const SFIELDS = ['country', 'location', 'status', 'hostname', 'asset_code', 'brand_model',
  'serial_no', 'ip_address', 'role', 'os', 'cpu', 'ram', 'storage',
  'purchase_date', 'warranty_expiry', 'vendor', 'cost', 'po_number', 'history_usage', 'remark'];

function sReadForm() {
  const o = {};
  SFIELDS.forEach(f => { const el = document.getElementById('f-' + f); if (el) o[f] = el.value.trim(); });
  return o;
}
function sFillForm(s) {
  document.getElementById('f-id').value = s ? s.id : '';
  SFIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.value = s ? (s[f] ?? '') : (f === 'status' ? 'Active' : '');
  });
  const hu = document.getElementById('f-history_usage');
  if (hu) {
    const canEdit = window.CURRENT_USER && window.CURRENT_USER.username === HISTORY_OWNER;
    hu.readOnly = !canEdit;
    hu.style.background = canEdit ? '' : '#f3f4f6';
    hu.title = canEdit ? '' : 'Recorded automatically — locked.';
  }
}

function sOpenModal(title) { document.getElementById('modal-title').textContent = title; document.getElementById('modal-overlay').classList.add('open'); }
function sCloseModal() { document.getElementById('modal-overlay').classList.remove('open'); }

async function loadFilters() {
  try {
    const { roles, countries } = await apiGet(`${SAPI}/filters`);
    document.getElementById('filter-country').innerHTML =
      '<option value="">All Countries</option>' + countries.map(c => `<option>${sEsc(c)}</option>`).join('');
    document.getElementById('filter-role').innerHTML =
      '<option value="">All Roles</option>' + roles.map(r => `<option>${sEsc(r)}</option>`).join('');
  } catch (e) { /* non-fatal */ }
}

async function loadServers(page = 1) {
  sCurrentPage = page;
  const qs = new URLSearchParams();
  qs.set('page', page); qs.set('limit', 25);
  const s = document.getElementById('search-input').value.trim();
  const c = document.getElementById('filter-country').value;
  const st = document.getElementById('filter-status').value;
  const r = document.getElementById('filter-role').value;
  if (s) qs.set('search', s);
  if (c) qs.set('country', c);
  if (st) qs.set('status', st);
  if (r) qs.set('role', r);
  try {
    const result = await apiGet(`${SAPI}?${qs}`);
    renderTable(result.data);
    renderPagination(result.total, result.page, result.limit);
    document.getElementById('total-label').textContent = `${result.total} server(s)`;
  } catch (e) {
    document.getElementById('servers-tbody').innerHTML = '<tr><td colspan="11" class="empty-state">Failed to load.</td></tr>';
  }
}

function renderTable(rows) {
  const tbody = document.getElementById('servers-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No servers found.</td></tr>'; return; }
  tbody.innerHTML = rows.map(s => `
    <tr>
      <td class="text-muted text-sm">${s.id}</td>
      <td><code style="font-size:12px;color:var(--brand)">${sEsc(s.asset_code) || '—'}</code></td>
      <td><strong>${sEsc(s.hostname) || '—'}</strong></td>
      <td>${sEsc(s.brand_model) || '—'}</td>
      <td class="text-muted text-sm">${sEsc(s.ip_address) || '—'}</td>
      <td class="text-muted text-sm">${sEsc(s.os) || '—'}</td>
      <td>${sEsc(s.role) || '—'}</td>
      <td><span class="badge badge-factory">${sEsc(s.country) || '—'}</span></td>
      <td class="text-muted text-sm">${sEsc(s.location) || '—'}</td>
      <td>${statusBadge(s.status)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="onView(${s.id})" title="View"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="btn btn-ghost btn-sm" onclick="onEdit(${s.id})" title="Edit"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn btn-danger btn-sm" onclick="onDelete(${s.id}, '${sAttr(s.hostname || s.asset_code)}')" title="Delete"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
        </div>
      </td>
    </tr>`).join('');
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const info = document.getElementById('page-info');
  if (info) info.textContent = total ? `Showing ${Math.min((page - 1) * limit + 1, total)}–${Math.min(page * limit, total)} of ${total}` : '';
  const el = document.getElementById('pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  let html = `<button class="page-btn" ${page > 1 ? '' : 'disabled'} onclick="loadServers(${page - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
      html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="loadServers(${i})">${i}</button>`;
    } else if (Math.abs(i - page) === 3) { html += '<span class="page-info">…</span>'; }
  }
  html += `<button class="page-btn" ${page < totalPages ? '' : 'disabled'} onclick="loadServers(${page + 1})">›</button>`;
  el.innerHTML = html;
}

// ── View ───────────────────────────────────────────────────────────────────────
async function onView(id) {
  try {
    const s = await apiGet(`${SAPI}/${id}`);
    viewServer = s;
    const fields = [
      ['Asset Code', s.asset_code], ['Hostname', s.hostname], ['Brand / Model', s.brand_model],
      ['Country', s.country], ['Location', s.location], ['Status', statusBadge(s.status)],
      ['IP Address', s.ip_address], ['OS', s.os], ['Role', s.role],
      ['CPU', s.cpu], ['RAM', s.ram], ['Storage', s.storage], ['Serial #', s.serial_no],
      ['Purchase Date', s.purchase_date], ['Warranty', warrantyBadge(s.warranty_expiry) || s.warranty_expiry],
      ['Vendor', s.vendor], ['Cost', s.cost], ['PO Number', s.po_number],
      ['History Usage', s.history_usage], ['Remark', s.remark],
    ];
    document.getElementById('view-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fields.map(([l, v]) => `<div><div class="form-label" style="margin-bottom:3px">${l}</div><div style="font-size:13.5px;white-space:pre-line">${v || '<span class="text-muted">—</span>'}</div></div>`).join('')}
      </div>
      <div style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <strong style="font-size:13.5px">🔧 Maintenance &amp; Repairs</strong>
          <span class="text-muted text-sm" id="maint-count"></span>
        </div>
        <div class="maint-edit" style="margin-bottom:12px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select class="form-control" id="maint-type" style="max-width:120px"><option value="repair">Repair</option><option value="service">Service</option><option value="upgrade">Upgrade</option></select>
            <input class="form-control" id="maint-desc" placeholder="What happened / what was done" style="flex:1;min-width:160px">
            <input class="form-control" id="maint-vendor" placeholder="Vendor" style="max-width:120px">
            <input class="form-control" id="maint-cost" placeholder="Cost" style="max-width:90px">
            <button class="btn btn-primary btn-sm" onclick="onAddRepair()">Add</button>
          </div>
        </div>
        <div id="maint-list" class="text-muted text-sm">Loading…</div>
      </div>`;
    document.getElementById('view-overlay').classList.add('open');
    loadMaintenance(id);
  } catch (e) { showToast('Failed to load server', 'error'); }
}

// Maintenance (server-scoped: asset_type='server')
const MAINT_BADGE = { open: 'badge-broken', in_progress: 'badge-retired', done: 'badge-active' };
const maintLabel = (s) => ({ open: 'Open', in_progress: 'In progress', done: 'Done' }[s] || s);
async function loadMaintenance(serverId) {
  const box = document.getElementById('maint-list');
  if (!box) return;
  try {
    const rows = await apiGet(`/api/maintenance/by/server/${serverId}`);
    const cnt = document.getElementById('maint-count');
    if (cnt) cnt.textContent = rows.length ? `${rows.length} record(s)` : '';
    if (!rows.length) { box.innerHTML = '<span class="text-muted text-sm">No maintenance recorded.</span>'; return; }
    box.innerHTML = rows.map(m => `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:13px"><strong>${maintLabel(m.status)}</strong> · ${sEsc(m.type)} — ${sEsc(m.description)}</div>
          <div class="text-muted text-sm">${sEsc(m.reported_at)}${m.vendor ? ' · ' + sEsc(m.vendor) : ''}${m.cost ? ' · ' + sEsc(m.cost) : ''}${m.reported_by ? ' · by ' + sEsc(m.reported_by) : ''}</div>
        </div>
        <span class="badge ${MAINT_BADGE[m.status] || ''}">${maintLabel(m.status)}</span>
        <select class="form-control maint-edit" style="max-width:130px;padding:4px 8px" onchange="onRepairStatus(${m.id}, this.value)">
          ${['open','in_progress','done'].map(x => `<option value="${x}" ${x === m.status ? 'selected' : ''}>${maintLabel(x)}</option>`).join('')}
        </select>
      </div>`).join('');
  } catch (e) { box.innerHTML = '<span class="text-muted text-sm">Failed to load.</span>'; }
}
async function onAddRepair() {
  if (!viewServer) return;
  const description = document.getElementById('maint-desc').value.trim();
  if (!description) { showToast('Enter a description', 'error'); return; }
  try {
    await apiPost('/api/maintenance', {
      asset_type: 'server', asset_id: viewServer.id,
      type: document.getElementById('maint-type').value, description,
      vendor: document.getElementById('maint-vendor').value.trim(),
      cost: document.getElementById('maint-cost').value.trim(),
    });
    showToast('Maintenance logged');
    ['maint-desc', 'maint-vendor', 'maint-cost'].forEach(id => document.getElementById(id).value = '');
    loadMaintenance(viewServer.id);
  } catch (e) { showToast('Failed to log maintenance', 'error'); }
}
async function onRepairStatus(id, status) {
  try { await apiPut(`/api/maintenance/${id}`, { status }); showToast('Updated'); loadMaintenance(viewServer.id); }
  catch (e) { showToast('Update failed', 'error'); }
}

// ── Add / Edit ──────────────────────────────────────────────────────────────────
function onAdd() { sFillForm(null); sOpenModal('Add Server'); }
async function onEdit(id) {
  try { const s = await apiGet(`${SAPI}/${id}`); sFillForm(s); sOpenModal('Edit Server'); }
  catch (e) { showToast('Failed to load server', 'error'); }
}
async function onSave() {
  const data = sReadForm();
  const id = document.getElementById('f-id').value;
  try {
    if (id) await apiPut(`${SAPI}/${id}`, data); else await apiPost(SAPI, data);
    showToast('Saved'); sCloseModal(); loadServers(sCurrentPage);
  } catch (e) { showToast('Save failed', 'error'); }
}
function onDelete(id, label) {
  sDeleteId = id;
  document.getElementById('del-label').textContent = label;
  document.getElementById('del-overlay').classList.add('open');
}

async function loadSummary() {
  try {
    const s = await apiGet(`${SAPI}/stats`);
    renderSummaryCards('summary-grid', [
      ['Total Servers', s.total, '#dbeafe', '#1a56db'],
      ['Active', s.byStatus.Active || 0, '#dcfce7', '#16a34a'],
      ['Broken', s.byStatus.Broken || 0, '#fee2e2', '#dc2626'],
      ['Stock', s.byStatus.Stock || 0, '#fef3c7', '#d97706'],
      ['Warranty ≤90d', s.warrantyExpiring || 0, '#fde68a', '#92400e'],
    ]);
  } catch (e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  loadFilters().then(loadServers);
  loadSummary();

  let debounce;
  document.getElementById('search-input').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => loadServers(1), 320); });
  ['filter-country', 'filter-status', 'filter-role'].forEach(id => document.getElementById(id).addEventListener('change', () => loadServers(1)));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    ['filter-country', 'filter-status', 'filter-role'].forEach(id => document.getElementById(id).value = '');
    loadServers(1);
  });

  document.getElementById('btn-add').addEventListener('click', onAdd);
  document.getElementById('modal-save').addEventListener('click', onSave);
  document.getElementById('modal-close').addEventListener('click', sCloseModal);
  document.getElementById('modal-cancel').addEventListener('click', sCloseModal);
  document.getElementById('view-close').addEventListener('click', () => document.getElementById('view-overlay').classList.remove('open'));
  document.getElementById('view-close-btn').addEventListener('click', () => document.getElementById('view-overlay').classList.remove('open'));
  document.getElementById('view-edit-btn').addEventListener('click', () => { document.getElementById('view-overlay').classList.remove('open'); if (viewServer) onEdit(viewServer.id); });
  document.getElementById('del-close').addEventListener('click', () => document.getElementById('del-overlay').classList.remove('open'));
  document.getElementById('del-cancel').addEventListener('click', () => document.getElementById('del-overlay').classList.remove('open'));
  document.getElementById('del-confirm').addEventListener('click', async () => {
    if (!sDeleteId) return;
    try { await apiDelete(`${SAPI}/${sDeleteId}`); showToast('Deleted'); document.getElementById('del-overlay').classList.remove('open'); loadServers(sCurrentPage); }
    catch (e) { showToast('Delete failed', 'error'); }
  });
});
