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
  'producer', 'category', 'serial_no', 'ip_address', 'role', 'os', 'cpu', 'ram', 'storage',
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
    const { categories, producers, countries } = await apiGet(`${SAPI}/filters`);
    document.getElementById('filter-country').innerHTML =
      '<option value="">All Countries</option>' + countries.map(c => `<option>${sEsc(c)}</option>`).join('');
    document.getElementById('filter-producer').innerHTML =
      '<option value="">All Producers</option>' + (producers || []).map(p => `<option>${sEsc(p)}</option>`).join('');
    document.getElementById('filter-category').innerHTML =
      '<option value="">All Categories</option>' + (categories || []).map(c => `<option>${sEsc(c)}</option>`).join('');
  } catch (e) { /* non-fatal */ }
}

async function loadServers(page = 1) {
  sCurrentPage = page;
  const qs = new URLSearchParams();
  qs.set('page', 1); qs.set('limit', 5000);   // all at once: the list is grouped by category
  const s = document.getElementById('search-input').value.trim();
  const c = document.getElementById('filter-country').value;
  const st = document.getElementById('filter-status').value;
  const cat = document.getElementById('filter-category').value;
  const prod = document.getElementById('filter-producer').value;
  if (s) qs.set('search', s);
  if (c) qs.set('country', c);
  if (st) qs.set('status', st);
  if (cat) qs.set('category', cat);
  if (prod) qs.set('producer', prod);
  try {
    const result = await apiGet(`${SAPI}?${qs}`);
    renderTable(result.data);
    document.getElementById('pagination').innerHTML = '';
    document.getElementById('page-info').textContent = `${result.total} device${result.total === 1 ? '' : 's'} · categories with more than 4 devices are grouped — click to open`;
    document.getElementById('total-label').textContent = `${result.total} server(s)`;
  } catch (e) {
    document.getElementById('servers-tbody').innerHTML = '<tr><td colspan="12" class="empty-state">Failed to load.</td></tr>';
  }
}

// Categories with more than 4 devices (Switch, Access Point …) are grouped (closed until clicked).
const sOpenGroups = new Set();
function rowHtml(s, inGroup) {
  return `
    <tr class="${s.fields_locked ? 'row-locked' : ''}${inGroup ? ' sg-in' : ''}">
      <td class="text-muted text-sm">${s.id}</td>
      <td>${s.fields_locked ? '<span title="Locked — Serial/Brand/Asset Code frozen">🔒</span> ' : ''}<code style="font-size:12px;color:var(--brand)">${sEsc(s.asset_code) || '—'}</code></td>
      <td><strong>${sEsc(s.hostname) || '—'}</strong>${s.hostname && /\//.test(s.hostname) ? ` <a href="/network-map.html?host=${encodeURIComponent(s.hostname)}" title="Open on the network map" onclick="event.stopPropagation()">🗺</a>` : ''}</td>
      <td>${sEsc(s.brand_model) || '—'} ${DeviceSpecs.btn(s.brand_model, s.category)}</td>
      <td class="text-muted text-sm">${sEsc(s.producer) || '—'}</td>
      <td>${s.category ? `<span class="badge badge-office">${sEsc(s.category)}</span>` : '—'}</td>
      <td class="text-muted text-sm">${sEsc(s.ip_address) || '—'}</td>
      <td class="text-muted text-sm">${sEsc(s.os) || '—'}</td>
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
    </tr>`;
}
let sRows = [];
function renderTable(rows) {
  sRows = rows;
  const tbody = document.getElementById('servers-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No servers found.</td></tr>'; return; }
  const by = new Map();
  for (const s of rows) { const k = s.category || 'Uncategorised'; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  const groups = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  let html = '';
  // Only models with more than 4 devices are grouped (e.g. 22 × C9200L); a model with 1–4 devices (2 × Nexus) stays as rows.
  const modelCount = rows.reduce((m, s) => m.set(s.brand_model || '—', (m.get(s.brand_model || '—') || 0) + 1), new Map());
  for (const [cat, all] of groups) {
    const list = all.filter(s => modelCount.get(s.brand_model || '—') > 4), single = all.filter(s => modelCount.get(s.brand_model || '—') <= 4);
    if (list.length) {
      const open = sOpenGroups.has(cat);
      const models = [...list.reduce((m, s) => m.set(s.brand_model || '—', (m.get(s.brand_model || '—') || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
      const st = list.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m; }, {});
      html += `<tr class="sg-grp" onclick="toggleSGroup(${jsArg(cat)})"><td colspan="12">
        <span class="lg-caret">${open ? '▾' : '▸'}</span> <b>${sEsc(cat)}</b> <span class="sg-cnt">${list.length}</span>
        <span class="sg-models">${models.map(([m, n]) => `<span class="sg-model">${sEsc(m)} <b>×${n}</b> ${DeviceSpecs.btn(m, cat)}</span>`).join('')}</span>
        <span class="sg-st">${Object.entries(st).map(([k, n]) => `${statusBadge(k)} ${n}`).join(' ')}</span></td></tr>`;
      if (open) html += list.map(s => rowHtml(s, true)).join('');
    }
    html += single.map(s => rowHtml(s, false)).join('');
  }
  tbody.innerHTML = html;
}
function toggleSGroup(cat) { sOpenGroups.has(cat) ? sOpenGroups.delete(cat) : sOpenGroups.add(cat); renderTable(sRows); }

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
      ['Producer', s.producer], ['Category', s.category],
      ['Country', s.country], ['Location', s.location], ['Status', statusBadge(s.status)],
      ['IP Address', s.ip_address], ['OS', s.os], ['Role', s.role],
      ['CPU', s.cpu], ['RAM', s.ram], ['Storage', s.storage], ['Serial #', s.serial_no],
      ['Purchase Date', s.purchase_date], ['Warranty', warrantyBadge(s.warranty_expiry) || s.warranty_expiry],
      ['Vendor', s.vendor], ['Cost', s.cost], ['PO Number', s.po_number],
      ['History Usage', s.history_usage], ['Remark', s.remark],
      ['Network IPs / services', sEsc(s.net_info || '')],
      ['Network map', s.hostname ? `<a href="/network-map.html?host=${encodeURIComponent(s.hostname)}">🗺 Open ${sEsc(s.hostname)} on the network map</a>` : ''],
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
function onAdd() { sFillForm(null); applyFieldLock(null); sOpenModal('Add Server'); }
async function onEdit(id) {
  try { const s = await apiGet(`${SAPI}/${id}`); sFillForm(s); applyFieldLock(s); sOpenModal('Edit Server'); }
  catch (e) { showToast('Failed to load server', 'error'); }
}

// Serial / Brand-Model / Asset Code are protected: only IT can edit them, and once
// edited the record locks until an IT admin unlocks. Gate the form accordingly.
const SPROTECTED_FIELDS = ['serial_no', 'brand_model', 'asset_code'];
function applyFieldLock(s) {
  const banner = document.getElementById('lock-banner');
  const unlockBtn = document.getElementById('modal-unlock');
  const it = isIT();
  const itAdmin = isITAdmin();
  const isNew = !s || !s.id;
  const locked = !isNew && !!s.fields_locked;

  SPROTECTED_FIELDS.forEach((f) => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    let ro = false, title = '';
    if (isNew) { ro = false; }
    else if (!it) { ro = true; title = 'Only IT members can edit this field.'; }
    else if (locked) { ro = true; title = 'Locked — an IT admin must unlock before editing.'; }
    el.readOnly = ro;
    el.style.background = ro ? '#f3f4f6' : '';
    el.title = title;
  });

  if (banner) {
    if (locked) {
      banner.className = 'lock-banner';
      banner.style.display = '';
      banner.innerHTML = '🔒 <span><strong>Serial, Brand/Model and Asset Code are locked.</strong> '
        + (itAdmin ? 'Use “🔓 Unlock fields” below to edit them.' : 'Ask an IT admin to unlock.') + '</span>';
    } else if (it && !isNew) {
      banner.className = 'lock-banner is-open';
      banner.style.display = '';
      banner.innerHTML = itAdmin
        ? '🔓 <span>Editing Serial, Brand/Model or Asset Code will <strong>lock this record</strong> — this applies to you too. As an IT admin you can unlock it again afterwards.</span>'
        : '🔓 <span>Editing Serial, Brand/Model or Asset Code will <strong>lock this record</strong> (an IT admin can unlock it later).</span>';
    } else {
      banner.style.display = 'none';
    }
  }
  if (unlockBtn) {
    if (locked && itAdmin) { unlockBtn.style.display = ''; unlockBtn.dataset.id = s.id; }
    else { unlockBtn.style.display = 'none'; delete unlockBtn.dataset.id; }
  }
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
  ['filter-country', 'filter-status', 'filter-category', 'filter-producer'].forEach(id => document.getElementById(id).addEventListener('change', () => loadServers(1)));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    ['filter-country', 'filter-status', 'filter-category', 'filter-producer'].forEach(id => document.getElementById(id).value = '');
    loadServers(1);
  });

  document.getElementById('btn-add').addEventListener('click', onAdd);
  document.getElementById('modal-save').addEventListener('click', onSave);
  const unlockBtn = document.getElementById('modal-unlock');
  if (unlockBtn) unlockBtn.addEventListener('click', async () => {
    const id = unlockBtn.dataset.id;
    if (!id) return;
    try {
      await apiPost(`${SAPI}/${id}/unlock`, {});
      showToast('Fields unlocked');
      const s = await apiGet(`${SAPI}/${id}`);
      sFillForm(s); applyFieldLock(s);
      loadServers(sCurrentPage);
    } catch (e) {
      showToast('Unlock failed — IT admin only', 'error');
    }
  });
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

// ── Update from the network map (implementation document) — admins ──
// The button shows for admins once the page knows who you are.
document.addEventListener('DOMContentLoaded', () => { const t = setInterval(() => { if (!window.CURRENT_USER) return; clearInterval(t); if (window.CURRENT_USER.role === 'admin') document.getElementById('btn-netsync').style.display = '';
  const v = Number(new URLSearchParams(location.search).get('view')); if (v) onView(v); }, 150); });
let nsChoose = {};
async function openNetSync(keepSite) {
  let sites = [];
  try { sites = (await apiGet('/api/netmap')).sites; } catch {}
  if (!sites.length) { showToast('No network map yet — import the implementation document on the Network map page first', 'error'); return; }
  const site = keepSite || (sites.length === 1 ? sites[0].site : (prompt('Which site? ' + sites.map(s => s.site).join(', '), sites[0].site) || ''));
  if (!site) return;
  if (!keepSite) nsChoose = {};
  const d = await apiGet('/api/netmap/inventory-sync?site=' + encodeURIComponent(site) + '&choose=' + encodeURIComponent(JSON.stringify(nsChoose)));
  let ov = document.getElementById('ns-ov');
  if (!ov) { document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="ns-ov"><div class="modal" style="max-width:980px">
      <div class="modal-header"><span class="modal-title" id="ns-t"></span><button class="modal-close" onclick="document.getElementById('ns-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="ns-b" style="max-height:70vh;overflow:auto"></div><div class="modal-footer" id="ns-f"></div></div></div>`); ov = document.getElementById('ns-ov'); }
  const LBL = { hostname: 'Hostname', ip_address: 'IP', location: 'Location', role: 'Role / name', net_info: 'IP list', brand_model: 'Model', serial_no: 'Serial', category: 'Category' };
  const todo = d.items.filter(i => i.action !== 'same');
  document.getElementById('ns-t').textContent = `Update Server Inventory from the network map — ${site}`;
  document.getElementById('ns-b').innerHTML = `<p class="text-sm" style="margin-top:0">Matched by serial / service tag. <b>${d.items.filter(i => i.action === 'update').length}</b> to update ·
      <b>${d.items.filter(i => i.action === 'add').length}</b> not in Server Inventory (add) · <b style="color:#b45309">${d.items.filter(i => i.warn).length}</b> matched by model only (check ⚠) · ${d.items.filter(i => i.action === 'same').length} already up to date. Untick what you don't want.</p>
    <table class="ns-tbl"><thead><tr><th><input type="checkbox" id="ns-all" checked></th><th>Device (network map)</th><th>Server Inventory</th><th>Changes</th></tr></thead><tbody>
    ${todo.map(i => `<tr class="ns-${i.action}"><td><input type="checkbox" class="ns-ck" value="${i.net_id}" ${i.warn ? '' : 'checked'} title="${i.warn ? 'Not ticked: matched by model only — tick after checking the record' : ''}"></td>
      <td><b>${sEsc(i.hostname)}</b><div class="text-muted text-sm">${sEsc(i.role)} · ${sEsc(i.model)}${i.serial ? ' · S/N ' + sEsc(i.serial) : ''}</div></td>
      <td><select class="form-control ns-pick" data-net="${i.net_id}" style="min-width:230px;font-size:12.5px;padding:4px 6px">
          <option value="0"${i.server ? '' : ' selected'}>➕ Add as a new record</option>
          ${i.candidates.map(c => `<option value="${c.id}"${i.server && i.server.id === c.id ? ' selected' : ''}>${sEsc(c.label)}</option>`).join('')}</select>
        ${i.warn ? `<div class="ns-warn">⚠ ${sEsc(i.warn)}</div>` : i.how === 'serial' ? '<div class="text-sm" style="color:#15803d">✓ same serial</div>' : ''}</td>
      <td class="text-sm">${Object.entries(i.fields).map(([k, v]) => `<div><b>${LBL[k] || k}</b>: ${v.from ? `<s class="text-muted">${sEsc(v.from)}</s> → ` : ''}${sEsc(v.to).replace(/\n/g, '<br>')}</div>`).join('')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">Everything is already up to date.</td></tr>'}</tbody></table>`;
  document.getElementById('ns-f').innerHTML = `<button class="btn btn-ghost" onclick="document.getElementById('ns-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" id="ns-go" ${todo.length ? '' : 'disabled'}>Apply ticked</button>`;
  document.querySelectorAll('.ns-pick').forEach(sel => { sel.onchange = () => { nsChoose[sel.dataset.net] = Number(sel.value); openNetSync(site); }; });
  const all = document.getElementById('ns-all'); if (all) all.onchange = () => document.querySelectorAll('.ns-ck').forEach(c => { c.checked = all.checked; });
  document.getElementById('ns-go').onclick = async () => {
    const ids = [...document.querySelectorAll('.ns-ck:checked')].map(c => Number(c.value));
    try { const r = await apiPost('/api/netmap/inventory-sync', { site, net_ids: ids, choose: nsChoose }); showToast(`${r.updated} updated · ${r.added} added`); ov.classList.remove('open'); loadServers(1); loadSummary && loadSummary(); }
    catch (e) { showToast('Could not update', 'error'); }
  };
  ov.classList.add('open');
}

// ── ⚠️ Needs Attention — Missing Info (like Asset Inventory) ──
// Network devices / servers need Serial, Hostname, IP and Location; access points need a Serial.
// Also: the same serial on two records, and a serial that differs from the implementation document
// (network map). The quantity per model is compared with the document's equipment list too.
const NA_ISSUES = ['Serial', 'Hostname', 'IP', 'Location', 'Dup Serial', 'Serial ≠ document'];
const NA_FIELD = { Serial: 'serial_no', Hostname: 'hostname', IP: 'ip_address', Location: 'location', 'Serial ≠ document': 'serial_no' };
let naData = null, naFilter = '';
const isAP = (s) => /access point/i.test(s.category || '');
async function naLoad() {
  const all = ((await apiGet(`${SAPI}?limit=5000`)).data || []).filter(s => s.status !== 'Broken');
  let doc = null;
  try { const sites = (await apiGet('/api/netmap')).sites; if (sites.length) doc = await apiGet('/api/netmap/inventory-check?site=' + encodeURIComponent(sites[0].site)); } catch {}
  const sn = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cnt = new Map(); all.forEach(s => { const n = sn(s.serial_no); if (n) cnt.set(n, (cnt.get(n) || 0) + 1); });
  const docIssue = new Map((doc ? doc.issues : []).map(i => [i.id, i.problems.find(p => /document's serial there is|which has no serial/.test(p))]).filter(([, p]) => p));
  const rows = all.map(s => {
    const t = [];
    if (!sn(s.serial_no)) t.push('Serial');
    if (!isAP(s)) { if (!String(s.hostname || '').trim()) t.push('Hostname'); if (!String(s.ip_address || '').trim()) t.push('IP'); if (!String(s.location || '').trim()) t.push('Location'); }
    if (sn(s.serial_no) && cnt.get(sn(s.serial_no)) > 1) t.push('Dup Serial');
    if (docIssue.has(s.id)) t.push('Serial ≠ document');
    return { s, t, docNote: docIssue.get(s.id) || '' };
  }).filter(r => r.t.length);
  naData = { rows, models: doc ? doc.models.filter(m => m.status === 'missing' || m.status === 'extra') : [] };
  const c = document.getElementById('na-cnt'); if (c) c.textContent = rows.length ? rows.length : '';
  return naData;
}
async function openMissing() {
  let ov = document.getElementById('na-ov');
  if (!ov) { document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="na-ov"><div class="modal" style="max-width:1100px">
      <div class="modal-header"><span class="modal-title">⚠️ Needs Attention — Missing Info</span><button class="modal-close" onclick="document.getElementById('na-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="na-b" style="max-height:76vh;overflow:auto"><p class="text-muted">Loading…</p></div></div></div>`); ov = document.getElementById('na-ov'); }
  ov.classList.add('open');
  await naLoad(); naRender();
}
function naRender() {
  const d = naData, canEdit = window.CURRENT_USER && ['admin', 'editor'].includes(window.CURRENT_USER.role), it = window.CURRENT_USER && window.CURRENT_USER.team === 'IT';
  const count = (k) => d.rows.filter(r => r.t.includes(k)).length;
  const rows = d.rows.filter(r => !naFilter || r.t.includes(naFilter));
  const input = (r, k) => { const f = NA_FIELD[k]; if (!f || !canEdit || (f === 'serial_no' && !it)) return '';
    return `<label class="na-in"><span>${k === 'Serial ≠ document' ? 'Serial' : k}</span><input class="form-control" data-f="${f}" value="${sEsc(r.s[f] || '')}" placeholder="${k === 'IP' ? '10.84.x.x' : k === 'Location' ? 'e.g. MAIN RACK - 03 (U29)' : ''}"></label>`; };
  document.getElementById('na-b').innerHTML = `
    ${d.models.length ? `<div class="na-q">📦 Quantity differs from the implementation document: ${d.models.map(m => `<b>${sEsc(m.family)}</b> ${m.status === 'missing' ? `${-m.diff} missing` : `${m.diff} more`} (document ${m.expected}, inventory ${m.inv})`).join(' · ')}</div>`
      : '<div class="na-q ok">📦 Every model matches the quantity in the implementation document (new devices added after it, like the Palo Alto PA-440, count as fine).</div>'}
    <div class="na-chips"><button class="${naFilter ? '' : 'on'}" onclick="naFilter='';naRender()">All <b>${d.rows.length}</b></button>${NA_ISSUES.map(k => count(k) ? `<button class="${naFilter === k ? 'on' : ''}" onclick="naFilter=${jsArg(k)};naRender()">${k} <b>${count(k)}</b></button>` : '').join('')}</div>
    ${rows.length ? `<table class="ic-tbl"><thead><tr><th>Device</th><th>Missing / to check</th><th>Fill in</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-id="${r.s.id}"><td><b>${sEsc(r.s.hostname || '—')}</b><div class="text-muted text-sm">#${r.s.id} · ${sEsc(r.s.brand_model)} · ${sEsc(r.s.category || '')}</div><div class="text-sm">S/N ${sEsc(r.s.serial_no || '—')} · ${statusBadge(r.s.status)}</div></td>
        <td>${r.t.map(k => `<span class="na-tag">${k}</span>`).join(' ')}${r.docNote ? `<div class="text-sm" style="color:#b45309;margin-top:4px">${sEsc(r.docNote)}</div>` : ''}</td>
        <td class="na-fill">${[...new Set(r.t)].map(k => input(r, k)).join('')}</td>
        <td style="white-space:nowrap">${canEdit && r.t.some(k => NA_FIELD[k]) ? `<button class="btn btn-primary btn-sm" onclick="naSave(${r.s.id})">Save</button> ` : ''}<button class="btn btn-ghost btn-sm" onclick="onView(${r.s.id})">👁</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="ic-ok">✓ Every device has its key info. 🎉</p>'}
    <p class="text-muted text-sm" style="margin-top:10px">Network devices and servers need Serial, Hostname, IP and Location; access points a Serial. Serial can be changed by IT members only. Broken devices are not listed.</p>`;
}
async function naSave(id) {
  const tr = document.querySelector(`#na-b tr[data-id="${id}"]`), body = {};
  tr.querySelectorAll('input[data-f]').forEach(i => { body[i.dataset.f] = i.value.trim(); });
  try { await apiPut(`${SAPI}/${id}`, body); showToast('Saved'); await naLoad(); naRender(); loadServers(1); }
  catch (e) { let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
}
document.addEventListener('DOMContentLoaded', () => { setTimeout(() => naLoad().catch(() => {}), 800); });
