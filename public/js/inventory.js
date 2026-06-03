/* Asset Inventory page logic */

let currentPage = 1;
const PAGE_SIZE = 25;
let deleteTargetId = null;
let viewAsset = null;
let editMode = false;
let incompleteMode = false;   // "Needs Attention — Missing Info" filter toggle
let adIssueMode = false;      // "Needs Attention — Missing AD & Asset" filter toggle
// Cost-center linkage maps (Department ⇄ Cost Center ⇄ ECC CC ⇄ Description are 1:1).
let CC_BY_CODE = {};   // cost_center code → { code, descr, ecc }
let CC_BY_DESC = {};   // cost_center description (=department) → { code, descr, ecc }

// ── History Usage modal — records locked by a User Name / AD Name change ───────
async function openHistory() {
  document.getElementById('history-overlay').classList.add('open');
  await loadHistory();
}
async function loadHistory() {
  const box = document.getElementById('history-body');
  const itAdmin = isITAdmin();
  try {
    const rows = await apiGet('/api/assets/user-locked');
    if (!rows.length) {
      box.innerHTML = `<div class="empty-state"><p>✅ No locked records — no User Name / AD Name changes pending review.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Asset</th><th>User Name / AD Name</th><th>History Usage (change)</th><th style="white-space:nowrap">Unlock</th></tr></thead>
      <tbody>${rows.map(a => {
        const label = (a.asset_code || a.asset_s4 || a.brand_model || ('#' + a.id));
        const act = itAdmin
          ? `<button class="btn btn-ghost btn-sm" onclick="unlockUser(${a.id})" title="Unlock User Name / AD Name (IT admin)">🔓 Unlock</button>`
          : '<span class="text-muted text-sm">🔒 IT admin</span>';
        return `<tr>
          <td><strong>${esc(label)}</strong><br><span class="text-muted text-sm">${esc(a.country)} · ${esc(a.location)}</span></td>
          <td>${esc(a.user_name) || '—'}<br><span class="text-muted text-sm">${esc(a.ad_name) || '—'}</span></td>
          <td><div style="max-height:120px;overflow:auto;white-space:pre-line;font-size:12.5px">${esc(a.history_usage)}</div></td>
          <td style="text-align:center">${act}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  } catch (e) {
    box.innerHTML = '<div class="text-muted text-sm">Could not load locked records.</div>';
  }
}
async function unlockUser(id) {
  try {
    await apiPost(`/api/assets/${id}/user-unlock`, {});
    showToast('Record unlocked');
    loadHistory();      // refresh so the unlocked row drops off
    loadAssets(currentPage);
  } catch (e) {
    showToast('Only an IT admin can unlock', 'error');
    loadHistory();
  }
}

// Summary cards at the top of the Asset Inventory page.
async function loadSummary() {
  try {
    const s = await apiGet('/api/assets/stats');
    renderSummaryCards('summary-grid', [
      ['Total Assets', s.total, '#dbeafe', '#1a56db'],
      ['Active', s.byStatus.Active || 0, '#dcfce7', '#16a34a'],
      ['Broken', s.byStatus.Broken || 0, '#fee2e2', '#dc2626'],
      ['Stock', s.byStatus.Stock || 0, '#fef3c7', '#d97706'],
      ['Needs Info', s.incompleteCount || 0, '#fde68a', '#92400e'],
    ]);
  } catch (e) { /* ignore */ }
}

// Populate the Brand Model and Department dropdowns with distinct values.
async function loadFilters() {
  try {
    const { brands, departments, countries, costCenters, assetTypes } = await apiGet('/api/assets/filters');
    const brandSel   = document.getElementById('filter-brand');
    const deptSel     = document.getElementById('filter-department');
    const countrySel = document.getElementById('filter-country');
    const ccSel       = document.getElementById('filter-cost-center');
    const atSel       = document.getElementById('filter-asset-type');
    const atList      = document.getElementById('asset-type-options');
    brandSel.innerHTML = '<option value="">All Models</option>' +
      brands.map(b => `<option value="${b.replace(/"/g,'&quot;')}">${b}</option>`).join('');
    deptSel.innerHTML = '<option value="">All Departments</option>' +
      (departments || []).map(d => `<option value="${d.replace(/"/g,'&quot;')}">${d}</option>`).join('');
    countrySel.innerHTML = '<option value="">All Countries</option>' +
      (countries || []).map(c => `<option value="${c}">${c}</option>`).join('');
    if (ccSel) ccSel.innerHTML = '<option value="">All Cost Centers</option>' +
      (costCenters || []).map(cc => {
        const lbl = cc.descr ? `${cc.code} — ${cc.descr} (${cc.count})` : `${cc.code} (${cc.count})`;
        return `<option value="${String(cc.code).replace(/"/g,'&quot;')}">${lbl}</option>`;
      }).join('');
    if (atSel) atSel.innerHTML = '<option value="">All Asset Types</option>' +
      (assetTypes || []).map(t => `<option value="${String(t.type).replace(/"/g,'&quot;')}">${t.type} (${t.count})</option>`).join('');
    if (atList) atList.innerHTML = (assetTypes || []).map(t => `<option value="${String(t.type).replace(/"/g,'&quot;')}"></option>`).join('');

    // Build the cost-center linkage maps for the edit form.
    CC_BY_CODE = {}; CC_BY_DESC = {};
    (costCenters || []).forEach(cc => {
      if (cc.code) CC_BY_CODE[String(cc.code).trim().toLowerCase()] = cc;
      if (cc.descr) CC_BY_DESC[String(cc.descr).trim().toLowerCase()] = cc;
    });

    // Regional managers (scoped to one country) don't need the country filter
    // and their add/edit form is locked to their country.
    const myCountry = window.CURRENT_USER && window.CURRENT_USER.country;
    if (myCountry) {
      countrySel.style.display = 'none';
      const fc = document.getElementById('f-country');
      if (fc) { fc.value = myCountry; fc.disabled = true; }
    }
  } catch (err) {
    console.error('Failed to load filter options', err);
  }
}

// ── Fetch & render table ──────────────────────────────────────────────────────
async function loadAssets(page = 1) {
  currentPage = page;
  const search     = document.getElementById('search-input').value.trim();
  const country    = document.getElementById('filter-country').value;
  const location   = document.getElementById('filter-location').value;
  const status     = document.getElementById('filter-status').value;
  const brand      = document.getElementById('filter-brand').value;
  const department = document.getElementById('filter-department').value;
  const costCenter = (document.getElementById('filter-cost-center') || {}).value || '';
  const assetType  = (document.getElementById('filter-asset-type') || {}).value || '';

  const params = new URLSearchParams({ page, limit: PAGE_SIZE });
  if (search)        params.set('search',     search);
  if (country)       params.set('country',    country);
  if (location)      params.set('location',   location);
  if (status)        params.set('status',     status);
  if (brand)         params.set('brand',      brand);
  if (department)    params.set('department', department);
  if (costCenter)    params.set('cost_center', costCenter);
  if (assetType)     params.set('asset_type', assetType);
  if (incompleteMode) params.set('incomplete', '1');
  if (adIssueMode)   params.set('ad_issue', '1');

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
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state">
      <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
      <p>No assets found.</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((a, i) => `
    <tr class="${(a.fields_locked || a.user_locked) ? 'row-locked' : ''}">
      <td class="text-muted text-sm">${a.id}</td>
      <td>${a.fields_locked ? '<span title="Locked — Serial/Brand/Asset Code frozen">🔒</span> ' : ''}${a.asset_s4
          ? `<code style="font-size:12px;color:var(--brand)" title="SAP S/4 asset code (main)">${a.asset_s4}</code><br><span class="text-muted" style="font-size:10.5px">ECC ${a.asset_code || '—'}</span>`
          : `<code style="font-size:12px;color:var(--brand)">${a.asset_code || '—'}</code>`}</td>
      <td>${a.asset_type ? `<span class="badge badge-office" style="font-size:10px">${esc(a.asset_type)}</span><br>` : ''}${a.brand_model || '—'}</td>
      <td class="text-muted text-sm">${a.computer_no || '—'}</td>
      <td><span class="badge badge-factory">${a.country || '—'}</span></td>
      <td>${locationBadge(a.location)}</td>
      <td class="truncate" title="${esc(a.department)}${a.cost_center_desc ? ' · ' + esc(a.cost_center_desc) : ''}">${a.department || '—'}${a.cost_center ? `<br><span class="text-muted" style="font-size:10.5px">CC ${esc(a.cost_center)}</span>` : ''}</td>
      <td>${a.user_locked ? '<span title="Locked — User/AD changed; IT admin unlocks via History Usage">🔒</span> ' : ''}${a.user_name || '—'}</td>
      <td class="text-muted text-sm">${a.ad_name || '<span style="color:var(--broken)">—</span>'}</td>
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
      ['Asset S4 (main)', a.asset_s4],
      ['Asset Code (ECC)', a.asset_code],
      ['Cost Center',   a.cost_center ? `${a.cost_center}${a.cost_center_desc ? ' — ' + a.cost_center_desc : ''}` : ''],
      ['ECC CC',        a.ecc_cc],
      ['Asset Description', a.asset_description],
      ['Asset Type',    a.asset_type],
      ['Brand / Model', a.brand_model],
      ['Country',       a.country],
      ['Location',      locationBadge(a.location)],
      ['Status',        statusBadge(a.status)],
      ['Department',    a.department],
      ['Computer No',   a.computer_no],
      ['Serial #',      a.serial_no],
      ['M&K',           a.mk],
      ['User Name',     a.user_name],
      ['AD Name',       a.ad_name],
      ['Date Assigned', a.date_assigned],
      ['Purchase Date', a.purchase_date],
      ['Warranty',      warrantyBadge(a.warranty_expiry) || a.warranty_expiry],
      ['Vendor',        a.vendor],
      ['Cost',          a.cost],
      ['PO Number',     a.po_number],
      ['History Usage', a.history_usage],
      ['Remark',        a.remark],
    ];

    document.getElementById('view-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fields.map(([label, val]) => `
          <div>
            <div class="form-label" style="margin-bottom:3px">${label}</div>
            <div style="font-size:13.5px;white-space:pre-line">${val || '<span class="text-muted">—</span>'}</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <strong style="font-size:13.5px">🔧 Maintenance &amp; Repairs</strong>
          <span class="text-muted text-sm" id="maint-count"></span>
        </div>
        <div class="maint-edit" style="margin-bottom:12px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select class="form-control" id="maint-type" style="max-width:120px">
              <option value="repair">Repair</option>
              <option value="service">Service</option>
              <option value="upgrade">Upgrade</option>
            </select>
            <input class="form-control" id="maint-desc" placeholder="What happened / what was done" style="flex:1;min-width:160px">
            <input class="form-control" id="maint-vendor" placeholder="Vendor" style="max-width:120px">
            <input class="form-control" id="maint-cost" placeholder="Cost" style="max-width:90px">
            <button class="btn btn-primary btn-sm" onclick="onAddRepair()">Add</button>
          </div>
        </div>
        <div id="maint-list" class="text-muted text-sm">Loading…</div>
      </div>
    `;
    document.getElementById('view-overlay').classList.add('open');
    loadMaintenance(id);
  } catch (err) {
    showToast('Failed to load asset', 'error');
  }
}

// ── Maintenance history (inside the asset detail modal) ─────────────────────────
const MAINT_BADGE = { open: 'badge-broken', in_progress: 'badge-retired', done: 'badge-active' };
const maintLabel = (s) => ({ open: 'Open', in_progress: 'In progress', done: 'Done' }[s] || s);
const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadMaintenance(assetId) {
  const box = document.getElementById('maint-list');
  if (!box) return;
  try {
    const rows = await apiGet(`/api/maintenance/by/asset/${assetId}`);
    const cnt = document.getElementById('maint-count');
    if (cnt) cnt.textContent = rows.length ? `${rows.length} record(s)` : '';
    if (!rows.length) { box.innerHTML = '<span class="text-muted text-sm">No maintenance recorded.</span>'; return; }
    box.innerHTML = rows.map(m => `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:13px"><strong>${maintLabel(m.status)}</strong> · ${escHtml(m.type)} — ${escHtml(m.description)}</div>
          <div class="text-muted text-sm">${escHtml(m.reported_at)}${m.vendor ? ' · ' + escHtml(m.vendor) : ''}${m.cost ? ' · ' + escHtml(m.cost) : ''}${m.reported_by ? ' · by ' + escHtml(m.reported_by) : ''}</div>
        </div>
        <span class="badge ${MAINT_BADGE[m.status] || ''}">${maintLabel(m.status)}</span>
        <select class="form-control maint-edit" style="max-width:130px;padding:4px 8px" onchange="onRepairStatus(${m.id}, this.value)">
          ${['open','in_progress','done'].map(s => `<option value="${s}" ${s === m.status ? 'selected' : ''}>${maintLabel(s)}</option>`).join('')}
        </select>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = '<span class="text-muted text-sm">Failed to load maintenance.</span>';
  }
}

async function onAddRepair() {
  if (!viewAsset) return;
  const description = document.getElementById('maint-desc').value.trim();
  if (!description) { showToast('Enter a description', 'error'); return; }
  try {
    await apiPost('/api/maintenance', {
      asset_id:    viewAsset.id,
      type:        document.getElementById('maint-type').value,
      description,
      vendor:      document.getElementById('maint-vendor').value.trim(),
      cost:        document.getElementById('maint-cost').value.trim(),
    });
    showToast('Maintenance logged');
    document.getElementById('maint-desc').value = '';
    document.getElementById('maint-vendor').value = '';
    document.getElementById('maint-cost').value = '';
    loadMaintenance(viewAsset.id);
  } catch (e) { showToast('Failed to log maintenance', 'error'); }
}

async function onRepairStatus(id, status) {
  try {
    await apiPut(`/api/maintenance/${id}`, { status });
    showToast('Updated');
    loadMaintenance(viewAsset.id);
  } catch (e) { showToast('Update failed', 'error'); }
}

// ── Edit ──────────────────────────────────────────────────────────────────────
// History Usage is an append-only audit log: read-only for everyone except admin.
const HISTORY_OWNER = 'viet';   // only this account may edit the history log
function applyHistoryLock() {
  const hu = document.getElementById('f-history_usage');
  if (!hu) return;
  const canEdit = window.CURRENT_USER && window.CURRENT_USER.username === HISTORY_OWNER;
  hu.readOnly = !canEdit;
  hu.title = canEdit ? '' : 'Recorded automatically — locked.';
  hu.style.background = canEdit ? '' : '#f3f4f6';
}

async function onEdit(id) {
  try {
    const a = await apiGet(`${API}/${id}`);
    setFormData(a);
    applyHistoryLock();
    applyFieldLock(a);
    editMode = true;
    // Show the "Print Delivery Form" button (edit mode only — needs a saved asset).
    const pb = document.getElementById('modal-print');
    if (pb) { pb.style.display = ''; pb.dataset.id = id; }
    openModal('Edit Asset');
  } catch (err) {
    showToast('Failed to load asset', 'error');
  }
}

// Serial / Brand-Model / Asset Code are protected: only IT can edit them, and once
// edited the record locks until an IT admin unlocks. Gate the form accordingly.
const PROTECTED_FIELDS = ['serial_no', 'brand_model', 'asset_code'];
function applyFieldLock(a) {
  const banner = document.getElementById('lock-banner');
  const unlockBtn = document.getElementById('modal-unlock');
  const it = isIT();
  const itAdmin = isITAdmin();
  const isNew = !a || !a.id;
  const locked = !isNew && !!a.fields_locked;

  PROTECTED_FIELDS.forEach((f) => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    let ro = false, title = '';
    if (isNew) { ro = false; }                       // creating a new asset — fields open
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
    if (locked && itAdmin) { unlockBtn.style.display = ''; unlockBtn.dataset.id = a.id; }
    else { unlockBtn.style.display = 'none'; delete unlockBtn.dataset.id; }
  }

  // Holder lock — User Name / AD Name freeze after a reassignment; unlocked by an
  // IT admin via the 🕓 History Usage button (not from this form).
  const userLocked = !isNew && !!a.user_locked;
  ['user_name', 'ad_name'].forEach((f) => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.readOnly = userLocked;
    el.style.background = userLocked ? '#f3f4f6' : '';
    el.title = userLocked ? 'Locked — User Name / AD Name changed. An IT admin unlocks via 🕓 History Usage.' : '';
  });
  if (banner && userLocked) {
    const note = '🔒 <span><strong>User Name / AD Name are locked</strong> (holder changed). '
      + (itAdmin ? 'Unlock via the 🕓 History Usage button.' : 'An IT admin can unlock via 🕓 History Usage.') + '</span>';
    if (banner.style.display === 'none') {
      banner.className = 'lock-banner'; banner.style.display = ''; banner.innerHTML = note;
    } else {
      banner.innerHTML += '<br>' + note;
    }
  }
}

// ── Cost-center linkage in the edit form ──────────────────────────────────────
// Department, Cost Center, ECC CC and Cost Center Description are 1:1 related, so
// changing one fills the others. Programmatic setFormData() won't trigger these.
function setF(id, val) { const el = document.getElementById(id); if (el) el.value = val == null ? '' : val; }
function ensureDeptOption(value) {
  const sel = document.getElementById('f-department');
  if (!sel || sel.tagName !== 'SELECT' || !value) return;
  if (![...sel.options].some(o => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = value;
    sel.insertBefore(opt, sel.lastElementChild);   // before the "New…" option
  }
}
function linkFromDepartment() {
  const dept = (document.getElementById('f-department') || {}).value || '';
  const cc = CC_BY_DESC[dept.trim().toLowerCase()];
  if (!cc) return;                                  // unmapped dept → leave others as-is
  setF('f-cost_center', cc.code);
  setF('f-ecc_cc', cc.ecc);
  setF('f-cost_center_desc', cc.descr);
}
function linkFromCostCenter() {
  const code = (document.getElementById('f-cost_center') || {}).value || '';
  const cc = CC_BY_CODE[code.trim().toLowerCase()];
  if (!cc) return;
  setF('f-ecc_cc', cc.ecc);
  setF('f-cost_center_desc', cc.descr);
  ensureDeptOption(cc.descr);
  setF('f-department', cc.descr);
}

// Refresh the model (brand) filter options to match the selected Asset Type.
async function refreshBrandOptions() {
  const sel = document.getElementById('filter-brand');
  if (!sel) return;
  const at = (document.getElementById('filter-asset-type') || {}).value || '';
  const country = (document.getElementById('filter-country') || {}).value || '';
  const cur = sel.value;
  const params = new URLSearchParams();
  if (at) params.set('asset_type', at);
  if (country) params.set('country', country);
  try {
    const { brands } = await apiGet('/api/assets/filters?' + params.toString());
    sel.innerHTML = '<option value="">All Models</option>' +
      (brands || []).map(b => `<option value="${b.replace(/"/g, '&quot;')}">${b}</option>`).join('');
    sel.value = (cur && (brands || []).includes(cur)) ? cur : '';   // keep selection if still valid
  } catch (e) { /* leave as-is */ }
}

// Download the pre-filled Delivery-Acceptance form (.xlsx) for printing & signature.
function printDeliveryForm(id) {
  if (!id) return;
  const a = document.createElement('a');
  a.href = `${API}/${id}/delivery-form`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Downloading delivery form…');
}

// Lock the history field when opening the Add modal too (runs after app.js).
document.addEventListener('DOMContentLoaded', () => {
  ['btn-add-top', 'nav-add'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => setTimeout(applyHistoryLock, 0));
  });
});

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
  const brand = p.get('brand') || '';
  const department = p.get('department') || '';
  const country = p.get('country') || '';
  const costCenter = p.get('cost_center') || '';
  const assetType = p.get('asset_type') || '';
  if (status)     document.getElementById('filter-status').value = status;
  if (location)   document.getElementById('filter-location').value = location;
  if (search)     document.getElementById('search-input').value = search;
  if (brand)      document.getElementById('filter-brand').value = brand;
  if (department) document.getElementById('filter-department').value = department;
  if (country)    document.getElementById('filter-country').value = country;
  if (costCenter) { const el = document.getElementById('filter-cost-center'); if (el) el.value = costCenter; }
  if (assetType)  { const el = document.getElementById('filter-asset-type'); if (el) el.value = assetType; }
  if (p.get('incomplete')) { incompleteMode = true; setIncompleteButton(true); }
  if (p.get('ad_issue'))   { adIssueMode = true; setAdIssueButton(true); }
}

// Visual state of the "Needs Attention" toggle button.
function setIncompleteButton(active) {
  const btn = document.getElementById('btn-incomplete');
  if (!btn) return;
  btn.classList.toggle('btn-primary', active);
  btn.classList.toggle('btn-ghost', !active);
}
function setAdIssueButton(active) {
  const btn = document.getElementById('btn-adaudit');
  if (!btn) return;
  btn.classList.toggle('btn-primary', active);
  btn.classList.toggle('btn-ghost', !active);
}

document.addEventListener('DOMContentLoaded', () => {
  // Load dropdown options first, then apply any URL filters and load the table.
  loadFilters().then(() => {
    applyUrlFilters();
    loadAssets();
    const editId = new URLSearchParams(window.location.search).get('edit');
    if (editId) onEdit(editId);
  });
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'asset');
  loadSummary();

  // Search & filter with debounce
  let debounce;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadAssets(1), 320);
  });
  document.getElementById('filter-country').addEventListener('change',    () => loadAssets(1));
  document.getElementById('filter-location').addEventListener('change',   () => loadAssets(1));
  document.getElementById('filter-status').addEventListener('change',     () => loadAssets(1));
  document.getElementById('filter-brand').addEventListener('change',      () => loadAssets(1));
  document.getElementById('filter-department').addEventListener('change', () => loadAssets(1));
  const ccFilter = document.getElementById('filter-cost-center');
  if (ccFilter) ccFilter.addEventListener('change', () => loadAssets(1));
  const atFilter = document.getElementById('filter-asset-type');
  if (atFilter) atFilter.addEventListener('change', async () => { await refreshBrandOptions(); loadAssets(1); });

  // Edit-form linkage: Department ⇄ Cost Center ⇄ ECC CC ⇄ Cost Center Description.
  const fDept = document.getElementById('f-department');
  if (fDept) fDept.addEventListener('change', linkFromDepartment);
  const fCC = document.getElementById('f-cost_center');
  if (fCC) fCC.addEventListener('change', linkFromCostCenter);

  // "Needs Attention — Missing Info" toggle
  document.getElementById('btn-incomplete').addEventListener('click', () => {
    incompleteMode = !incompleteMode;
    setIncompleteButton(incompleteMode);
    loadAssets(1);
  });

  // "History Usage" — opens pending-SAP modal
  document.getElementById('btn-history').addEventListener('click', openHistory);
  document.getElementById('history-close').addEventListener('click', () =>
    document.getElementById('history-overlay').classList.remove('open'));

  // "Missing AD & Asset" — toggle filter (editable in place)
  document.getElementById('btn-adaudit').addEventListener('click', () => {
    adIssueMode = !adIssueMode;
    setAdIssueButton(adIssueMode);
    loadAssets(1);
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-country').value = '';
    document.getElementById('filter-location').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-brand').value = '';
    document.getElementById('filter-department').value = '';
    const ccr = document.getElementById('filter-cost-center'); if (ccr) ccr.value = '';
    const atr = document.getElementById('filter-asset-type'); if (atr) atr.value = '';
    incompleteMode = false;
    setIncompleteButton(false);
    adIssueMode = false;
    setAdIssueButton(false);
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
      const pb = document.getElementById('modal-print');
      if (pb) pb.style.display = 'none';   // can't print an unsaved asset
      applyFieldLock(null);                // new asset — protected fields open, no lock UI
      openModal('Add Asset');
    });
  });

  // Print Delivery Form (edit modal)
  const printBtn = document.getElementById('modal-print');
  if (printBtn) printBtn.addEventListener('click', () => printDeliveryForm(printBtn.dataset.id));

  // Unlock protected fields (IT admin only)
  const unlockBtn = document.getElementById('modal-unlock');
  if (unlockBtn) unlockBtn.addEventListener('click', async () => {
    const id = unlockBtn.dataset.id;
    if (!id) return;
    try {
      await apiPost(`${API}/${id}/unlock`, {});
      showToast('Fields unlocked');
      const a = await apiGet(`${API}/${id}`);
      setFormData(a); applyHistoryLock(); applyFieldLock(a);
      loadAssets(currentPage);
    } catch (e) {
      showToast('Unlock failed — IT admin only', 'error');
    }
  });

  // View modal
  document.getElementById('view-close').addEventListener('click', () => document.getElementById('view-overlay').classList.remove('open'));
  document.getElementById('view-close-btn').addEventListener('click', () => document.getElementById('view-overlay').classList.remove('open'));
  document.getElementById('view-edit-btn').addEventListener('click', () => {
    document.getElementById('view-overlay').classList.remove('open');
    if (viewAsset) onEdit(viewAsset.id);
  });
  document.getElementById('view-print-btn').addEventListener('click', () => {
    if (viewAsset) printDeliveryForm(viewAsset.id);
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
