/* User Inventory (personnel offboarding tracker) — HR & IT inline editing. */

let currentPage = 1;
const PAGE_SIZE = 50;
let canEditUserType = false;   // HR
let canEditStatus = false;     // IT

const USER_TYPES = ['', 'Hayat Member', 'No Hayat Member'];
const STATUSES   = ['Active', 'to be delete', 'pending delete', 'deleted'];

function statusPill(s) {
  const map = {
    'Active': 'badge-active', 'to be delete': 'badge-retired',
    'pending delete': 'badge-broken', 'deleted': 'badge-broken',
  };
  return `<span class="badge ${map[s] || ''}">${s}</span>`;
}

function esc(v) { return String(v == null ? '' : v).replace(/"/g, '&quot;'); }

function optionList(values, selected) {
  return values.map(v =>
    `<option value="${esc(v)}"${v === (selected || '') ? ' selected' : ''}>${v === '' ? '—' : v}</option>`
  ).join('');
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
    canEditUserType = !!result.can.editUserType;
    canEditStatus   = !!result.can.editStatus;
    renderHint();
    renderTable(result.data);
    renderPagination(result.total, result.page, result.limit);
    document.getElementById('total-label').textContent = `${result.total} people`;
  } catch (err) {
    const msg = (() => { try { return JSON.parse(err.message).error; } catch { return 'Failed to load'; } })();
    document.getElementById('people-tbody').innerHTML =
      `<tr><td colspan="8" class="empty-state">${msg}</td></tr>`;
  }
}

function renderHint() {
  const el = document.getElementById('role-hint');
  if (canEditUserType) el.textContent = 'You are HR — you can set User Type and Leaving Date for your region.';
  else if (canEditStatus) el.textContent = 'You are IT — you can set the account Status (to be delete / deleted). "to be delete" auto-moves to "pending delete" after 1 month.';
  else el.textContent = '';
}

function renderTable(rows) {
  const tbody = document.getElementById('people-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No people found.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(p => {
    const utDisabled = canEditUserType ? '' : 'disabled';
    const stDisabled = canEditStatus ? '' : 'disabled';
    // Leaving date editable by HR only once a User Type is set.
    const ldDisabled = (canEditUserType && p.user_type) ? '' : 'disabled';
    return `
      <tr>
        <td><strong>${esc(p.display_name) || '—'}</strong></td>
        <td class="text-muted text-sm">${esc(p.email) || '—'}</td>
        <td><span class="badge badge-factory">${p.country}</span></td>
        <td>
          ${canEditUserType
            ? `<select class="form-control" style="min-width:150px;padding:5px 8px" onchange="savePerson(${p.id}, 'user_type', this.value)">${optionList(USER_TYPES, p.user_type)}</select>`
            : (p.user_type ? p.user_type : '<span class="text-muted">—</span>')}
        </td>
        <td>
          ${canEditStatus
            ? `<select class="form-control" style="min-width:140px;padding:5px 8px" onchange="savePerson(${p.id}, 'status', this.value)">${optionList(STATUSES, p.status)}</select>`
            : statusPill(p.status)}
        </td>
        <td class="text-muted text-sm">${esc(p.company_name) || '—'}</td>
        <td class="text-muted text-sm">${esc(p.position) || '—'}</td>
        <td>
          <input type="date" class="form-control" style="min-width:140px;padding:5px 8px"
                 value="${esc(p.leaving_date)}" ${ldDisabled}
                 onchange="savePerson(${p.id}, 'leaving_date', this.value)"
                 title="${ldDisabled && canEditUserType ? 'Set User Type first' : ''}">
        </td>
      </tr>`;
  }).join('');
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

  loadCountries().then(() => loadPeople());
  loadMeta();
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'personnel');

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
