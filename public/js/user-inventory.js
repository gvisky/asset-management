/* User Inventory (personnel offboarding tracker) — HR & IT inline editing. */

let currentPage = 1;
const PAGE_SIZE = 50;
let canEditUsers = false;   // only IT admin may edit User Inventory records

const USER_TYPES = ['', 'Hayat Member', 'No Hayat Member'];
const STATUSES   = ['Active', 'to be delete', 'pending delete', 'deleted'];
// Display labels for stored status values (value kept stable for the backend).
const STATUS_LABELS = { 'pending delete': 'Confirmed Delete' };
function statusLabel(s) { return STATUS_LABELS[s] || s; }

function statusPill(s) {
  const map = {
    'Active': 'badge-active', 'to be delete': 'badge-retired',
    'pending delete': 'badge-broken', 'deleted': 'badge-broken',
  };
  return `<span class="badge ${map[s] || ''}">${statusLabel(s)}</span>`;
}

function esc(v) { return String(v == null ? '' : v).replace(/"/g, '&quot;'); }

function optionList(values, selected, labels) {
  return values.map(v =>
    `<option value="${esc(v)}"${v === (selected || '') ? ' selected' : ''}>${v === '' ? '—' : ((labels && labels[v]) || v)}</option>`
  ).join('');
}

// ── Cost-center map (Department ⇄ Cost Center, 1:1) — country-scoped ───────────
// Thailand/Malaysia use a different scheme, so they get their own (currently
// none → blank). Vietnam returns its 38 cost centers.
let CC_LIST = [];                 // [{ code, descr }] for the loaded country
let CC_BY_CODE = {}, CC_BY_DESC = {};
async function loadCostCenters(country) {
  try {
    const q = country ? '?country=' + encodeURIComponent(country) : '';
    CC_LIST = await apiGet('/api/personnel/cost-centers' + q) || [];
  } catch (e) { CC_LIST = []; }
  CC_BY_CODE = {}; CC_BY_DESC = {};
  CC_LIST.forEach(cc => {
    if (cc.code)  CC_BY_CODE[String(cc.code).trim().toLowerCase()] = cc;
    if (cc.descr) CC_BY_DESC[String(cc.descr).trim().toLowerCase()] = cc;
  });
}
function fillSelect(sel, values, current, blankLabel) {
  const opts = ['<option value="">' + (blankLabel || '—') + '</option>'];
  const has = values.some(v => v === current);
  if (current && !has) opts.push(`<option value="${esc(current)}">${esc(current)} (current)</option>`);
  values.forEach(v => opts.push(`<option value="${esc(v)}">${esc(v)}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = current || '';
}
// Set a <select> to a value, adding the option first if it isn't there yet.
function selVal(sel, v) {
  if (!sel) return;
  if (v && ![...sel.options].some(o => o.value === v)) {
    const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
  }
  sel.value = v || '';
}
// Wire a Department⇄Cost Center pair so changing one updates the other.
function linkDeptCc(deptId, ccId) {
  const d = document.getElementById(deptId), c = document.getElementById(ccId);
  if (!d || !c) return;
  d.addEventListener('change', () => {
    const m = CC_BY_DESC[(d.value || '').trim().toLowerCase()];
    if (m) selVal(c, m.code);
  });
  c.addEventListener('change', () => {
    const m = CC_BY_CODE[(c.value || '').trim().toLowerCase()];
    if (m) selVal(d, m.descr);
  });
}
// Fill a Department + Cost Center pair of selects from the current CC_LIST.
function fillDeptCc(deptSel, ccSel, dept, cc, country) {
  const blank = (country && country !== 'Vietnam') ? '— (set up TH/MY scheme first) —' : '— none —';
  fillSelect(deptSel, CC_LIST.map(c => c.descr).filter(Boolean), dept, blank);
  fillSelect(ccSel, CC_LIST.map(c => c.code), cc, blank);
}
async function openEditUser(id, name, country, dept, cc) {
  document.getElementById('eu-id').value = id;
  document.getElementById('edituser-title').textContent = `Edit ${name} (${country}) — Department / Cost Center`;
  await loadCostCenters(country);   // only this person's country's scheme
  fillDeptCc(document.getElementById('eu-department'), document.getElementById('eu-cost_center'), dept, cc, country);
  document.getElementById('edituser-overlay').classList.add('open');
}
async function saveEditUser() {
  const id = document.getElementById('eu-id').value;
  const department  = document.getElementById('eu-department').value;
  const cost_center = document.getElementById('eu-cost_center').value;
  try {
    await apiPut(`/api/personnel/${id}`, { department, cost_center });
    showToast('Saved');
    document.getElementById('edituser-overlay').classList.remove('open');
    loadPeople(currentPage);
  } catch (err) {
    const msg = (() => { try { return JSON.parse(err.message).error; } catch { return 'Save failed'; } })();
    showToast(msg, 'error');
  }
}

// ── Add User (IT admin only) ──────────────────────────────────────────────────
async function openAddUser() {
  ['au-display_name', 'au-email', 'au-company_name', 'au-position'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('au-country').value = 'Vietnam';
  document.getElementById('au-user_type').value = '';
  document.getElementById('au-status').value = 'Active';
  await loadCostCenters('Vietnam');
  fillDeptCc(document.getElementById('au-department'), document.getElementById('au-cost_center'), '', '', 'Vietnam');
  document.getElementById('adduser-overlay').classList.add('open');
}
async function onAddUserCountry() {
  const country = document.getElementById('au-country').value;
  await loadCostCenters(country);
  fillDeptCc(document.getElementById('au-department'), document.getElementById('au-cost_center'), '', '', country);
}
async function saveAddUser() {
  const body = {
    display_name: document.getElementById('au-display_name').value.trim(),
    email:        document.getElementById('au-email').value.trim(),
    country:      document.getElementById('au-country').value,
    user_type:    document.getElementById('au-user_type').value,
    status:       document.getElementById('au-status').value,
    company_name: document.getElementById('au-company_name').value.trim(),
    position:     document.getElementById('au-position').value.trim(),
    department:   document.getElementById('au-department').value,
    cost_center:  document.getElementById('au-cost_center').value,
  };
  if (!body.display_name || !body.email) { showToast('Display name and email are required', 'error'); return; }
  try {
    await apiPost('/api/personnel', body);
    showToast('User added');
    document.getElementById('adduser-overlay').classList.remove('open');
    loadPeople(1);
  } catch (err) {
    const msg = (() => { try { return JSON.parse(err.message).error; } catch { return 'Could not add user'; } })();
    showToast(msg, 'error');
  }
}

async function loadCountries() {
  try {
    const { countries } = await apiGet('/api/personnel/filters');
    const sel = document.getElementById('filter-country');
    sel.innerHTML = '<option value="">All Countries</option>' +
      (countries || []).map(c => `<option value="${c}">${c}</option>`).join('');
    // Scoped users (one country) don't need the country filter.
    if (window.CURRENT_USER && window.CURRENT_USER.country) sel.style.display = 'none';
  } catch (e) { console.error(e); }
}

async function loadPeople(page = 1) {
  currentPage = page;
  const search    = document.getElementById('search-input').value.trim();
  const country   = document.getElementById('filter-country').value;
  const status    = document.getElementById('filter-status').value;
  const user_type = document.getElementById('filter-usertype').value;

  const params = new URLSearchParams({ page, limit: PAGE_SIZE });
  if (search)    params.set('search', search);
  if (country)   params.set('country', country);
  if (status)    params.set('status', status);
  if (user_type) params.set('user_type', user_type);

  try {
    const result = await apiGet(`/api/personnel?${params}`);
    canEditUsers = !!(result.can && result.can.edit);
    renderHint();
    renderTable(result.data);
    renderPagination(result.total, result.page, result.limit);
    document.getElementById('total-label').textContent = `${result.total} people`;
  } catch (err) {
    const msg = (() => { try { return JSON.parse(err.message).error; } catch { return 'Failed to load'; } })();
    document.getElementById('people-tbody').innerHTML =
      `<tr><td colspan="11" class="empty-state">${msg}</td></tr>`;
  }
}

function renderHint() {
  const el = document.getElementById('role-hint');
  if (canEditUsers) el.textContent = 'You are an IT admin — you can edit User Type, Status, Leaving Date, Department and Cost Center. Status is set manually.';
  else el.textContent = 'View only — only an IT admin can edit User Inventory records.';
}

function renderTable(rows) {
  const tbody = document.getElementById('people-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No people found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(p => {
    // Leaving date editable only once a User Type is set.
    const ldDisabled = (canEditUsers && p.user_type) ? '' : 'disabled';
    const adName = String(p.email || '').split('@')[0];
    const canSeeAssets = window.CURRENT_USER && window.CURRENT_USER.asset_access !== 0;
    const cnt = Number(p.asset_count || 0);
    let assetsCell = '<span class="text-muted">—</span>';
    if (cnt > 0) {
      assetsCell = canSeeAssets
        ? `<button class="btn btn-ghost btn-sm" onclick="viewAssets('${adName.replace(/'/g, "\\'")}','${esc(p.display_name)}')">${cnt} asset${cnt !== 1 ? 's' : ''}</button>`
        : `<span class="badge badge-active">${cnt}</span>`;
    }
    const dept = p.department || '';
    const cc   = p.cost_center || '';
    const editBtn = canEditUsers ? `<button class="btn btn-ghost btn-sm" title="Edit Department / Cost Center"
        onclick="openEditUser(${p.id}, '${esc(p.display_name)}', '${esc(p.country)}', '${esc(dept)}', '${esc(cc)}')">✏️</button> ` : '';
    return `
      <tr>
        <td><strong>${esc(p.display_name) || '—'}</strong></td>
        <td class="text-muted text-sm">${esc(p.email) || '—'}</td>
        <td>${assetsCell}</td>
        <td class="text-sm">${editBtn}${dept ? esc(dept) : '<span class="text-muted">—</span>'}</td>
        <td class="text-muted text-sm">${cc ? esc(cc) : '—'}</td>
        <td><span class="badge badge-factory">${p.country}</span></td>
        <td>
          ${canEditUsers
            ? `<select class="form-control" style="min-width:150px;padding:5px 8px" onchange="savePerson(${p.id}, 'user_type', this.value)">${optionList(USER_TYPES, p.user_type)}</select>`
            : (p.user_type ? p.user_type : '<span class="text-muted">—</span>')}
        </td>
        <td>
          ${canEditUsers
            ? `<select class="form-control" style="min-width:140px;padding:5px 8px" onchange="savePerson(${p.id}, 'status', this.value)">${optionList(STATUSES, p.status, STATUS_LABELS)}</select>`
            : statusPill(p.status)}
        </td>
        <td class="text-muted text-sm">${esc(p.company_name) || '—'}</td>
        <td class="text-muted text-sm">${esc(p.position) || '—'}</td>
        <td>
          ${canEditUsers
            ? `<input type="date" class="form-control" style="min-width:140px;padding:5px 8px" value="${esc(p.leaving_date)}" ${ldDisabled} onchange="savePerson(${p.id}, 'leaving_date', this.value)" title="${ldDisabled ? 'Set User Type first' : ''}">`
            : (p.leaving_date ? esc(p.leaving_date) : '<span class="text-muted">—</span>')}
        </td>
      </tr>`;
  }).join('');
}

// Show the assets linked to a person (asset.ad_name == email local-part).
async function viewAssets(adName, displayName) {
  const overlay = document.getElementById('assets-overlay');
  const body = document.getElementById('assets-body');
  document.getElementById('assets-title').textContent = `Assets of ${displayName} (AD: ${adName})`;
  body.innerHTML = 'Loading…';
  overlay.classList.add('open');
  try {
    const rows = await apiGet(`/api/assets/by-user/${encodeURIComponent(adName)}`);
    if (!rows.length) { body.innerHTML = '<div class="text-muted text-sm">No assets linked to this AD name.</div>'; return; }
    body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Asset Code</th><th>Brand / Model</th><th>Country</th><th>Location</th><th>Status</th></tr></thead><tbody>${
      rows.map(a => `<tr>
        <td><code style="font-size:12px;color:var(--brand)">${esc(a.asset_code) || '—'}</code></td>
        <td>${esc(a.brand_model) || '—'}</td>
        <td>${esc(a.country)}</td>
        <td>${esc(a.location) || '—'}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {
    body.innerHTML = '<div class="text-muted text-sm">Could not load assets.</div>';
  }
}

async function savePerson(id, field, value) {
  try {
    await apiPut(`/api/personnel/${id}`, { [field]: value });
    showToast('Saved');
    // Reload current page so dependent UI (e.g. leaving-date enabling) refreshes.
    loadPeople(currentPage);
  } catch (err) {
    const msg = (() => { try { return JSON.parse(err.message).error; } catch { return 'Save failed'; } })();
    showToast(msg, 'error');
    loadPeople(currentPage);
  }
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const from = Math.min((page - 1) * limit + 1, total);
  const to = Math.min(page * limit, total);
  document.getElementById('page-info').textContent = total ? `Showing ${from}–${to} of ${total}` : '';
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  let html = `<button class="page-btn" ${page>1?'':'disabled'} onclick="loadPeople(${page-1})">‹</button>`;
  const range = pagRange(page, totalPages);
  range.forEach(p => {
    html += p === '…'
      ? `<span class="page-btn" style="cursor:default;border:none">…</span>`
      : `<button class="page-btn ${p===page?'active':''}" onclick="loadPeople(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" ${page<totalPages?'':'disabled'} onclick="loadPeople(${page+1})">›</button>`;
  el.innerHTML = html;
}
function pagRange(c, t) {
  if (t <= 7) return Array.from({length:t},(_,i)=>i+1);
  if (c <= 4) return [1,2,3,4,5,'…',t];
  if (c >= t-3) return [1,'…',t-4,t-3,t-2,t-1,t];
  return [1,'…',c-1,c,c+1,'…',t];
}

// Summary cards at the top of the User Inventory page.
async function loadSummary() {
  try {
    const s = await apiGet('/api/personnel/summary');
    renderSummaryCards('summary-grid', [
      ['Total People', s.total, '#e0e7ff', '#4338ca'],
      ['Hayat: No', s.noHayat || 0, '#fee2e2', '#dc2626'],
      ['To Be Delete', s.byStatus['to be delete'] || 0, '#fef9c3', '#ca8a04'],
      ['Confirmed Delete', s.byStatus['pending delete'] || 0, '#ffedd5', '#ea580c'],
      ['Deleted', s.byStatus['deleted'] || 0, '#fee2e2', '#b91c1c'],
    ]);
  } catch (e) { /* ignore */ }
}

// Load last-import info; show the upload button (IT) and the monthly reminder.
async function loadMeta() {
  try {
    const m = await apiGet('/api/personnel/meta');
    if (m.canImport) {
      document.getElementById('btn-upload').style.display = '';
    }
    if (m.canImport && m.due) {
      const txt = m.last_import
        ? `Last updated ${m.days_since} day(s) ago. Please download the latest export from Azure and upload it.`
        : `No import on record yet. Download the latest export from Azure and upload it.`;
      document.getElementById('reminder-text').textContent = txt;
      document.getElementById('reminder').style.display = '';
    }
  } catch (e) { /* HR users: meta still returns, no-op */ }
}

// Read a chosen CSV file and send it to the import endpoint.
function handleUpload() {
  const input = document.getElementById('csv-file');
  input.value = '';
  input.click();
}

document.addEventListener('DOMContentLoaded', () => {
  // Page guard: HR or IT only.
  setTimeout(() => {
    const u = window.CURRENT_USER;
    if (u && u.team !== 'HR' && u.team !== 'IT') window.location.href = '/';
  }, 400);

  // Load the table independently of the filter dropdown — a slow/failed
  // /filters call must never leave the page stuck on "Loading…".
  loadPeople();
  loadCountries();
  loadMeta();
  loadSummary();

  // "+ Add User" — IT admin only.
  const setupAdd = (u) => {
    if (!u || !(u.team === 'IT' && u.role === 'admin')) return;
    const btn = document.getElementById('btn-adduser');
    if (btn) btn.style.display = '';
  };
  if (window.CURRENT_USER) setupAdd(window.CURRENT_USER);
  else if (typeof ensureAuth === 'function') ensureAuth().then(setupAdd);
  document.getElementById('btn-adduser').addEventListener('click', openAddUser);
  document.getElementById('adduser-close').addEventListener('click', () => document.getElementById('adduser-overlay').classList.remove('open'));
  document.getElementById('adduser-cancel').addEventListener('click', () => document.getElementById('adduser-overlay').classList.remove('open'));
  document.getElementById('adduser-save').addEventListener('click', saveAddUser);
  document.getElementById('au-country').addEventListener('change', onAddUserCountry);
  linkDeptCc('au-department', 'au-cost_center');
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'personnel');
  document.getElementById('assets-close').addEventListener('click', () => document.getElementById('assets-overlay').classList.remove('open'));

  // Edit User (Department / Cost Center) modal — linked fields.
  document.getElementById('edituser-close').addEventListener('click', () => document.getElementById('edituser-overlay').classList.remove('open'));
  document.getElementById('edituser-cancel').addEventListener('click', () => document.getElementById('edituser-overlay').classList.remove('open'));
  document.getElementById('edituser-save').addEventListener('click', saveEditUser);
  linkDeptCc('eu-department', 'eu-cost_center');

  // Upload buttons (top bar + reminder banner)
  document.getElementById('btn-upload').addEventListener('click', handleUpload);
  document.getElementById('btn-upload-2').addEventListener('click', handleUpload);
  document.getElementById('csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Reading file…');
    const text = await file.text();
    try {
      const result = await apiPost('/api/personnel/import', { csv: text });
      showToast(`Imported: +${result.added} new, ${result.updated} updated (VN ${result.byCountry.Vietnam}, TH ${result.byCountry.Thailand}, MY ${result.byCountry.Malaysia})`);
      document.getElementById('reminder').style.display = 'none';
      loadPeople(1);
    } catch (err) {
      const msg = (() => { try { return JSON.parse(err.message).error; } catch { return 'Import failed'; } })();
      showToast(msg, 'error');
    }
  });

  let debounce;
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(debounce); debounce = setTimeout(() => loadPeople(1), 320);
  });
  document.getElementById('filter-country').addEventListener('change', () => loadPeople(1));
  document.getElementById('filter-status').addEventListener('change', () => loadPeople(1));
  document.getElementById('filter-usertype').addEventListener('change', () => loadPeople(1));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-country').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-usertype').value = '';
    loadPeople(1);
  });
});
