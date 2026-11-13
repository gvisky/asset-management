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

function esc(v) { return htmlEsc(v); }

// Show script errors on screen (so a screenshot tells IT what went wrong).
window.addEventListener('error', (e) => {
  const m = `Page error: ${e.message || e}${e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : ''}`;
  console.error(m);
  if (typeof showToast === 'function') showToast(m, 'error'); else alert(m);
});
window.addEventListener('unhandledrejection', (e) => {
  const m = `Page error: ${(e.reason && e.reason.message) || e.reason}`;
  console.error(m);
  if (typeof showToast === 'function') showToast(String(m).slice(0, 200), 'error');
});

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
      (countries || []).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    // Scoped users (one country) don't need the country filter.
    if (mySingleCountry()) sel.style.display = 'none';
  } catch (e) { console.error(e); }
}

async function loadPeople(page = 1) {
  currentPage = page;
  const search    = document.getElementById('search-input').value.trim();
  const country   = document.getElementById('filter-country').value;
  const status    = document.getElementById('filter-status').value;
  const user_type = document.getElementById('filter-usertype').value;

  const params = new URLSearchParams({ page, limit: PAGE_SIZE, sort: (document.getElementById('sort-by') || {}).value || 'updated' });
  if (search)    params.set('search', search);
  if (country)   params.set('country', country);
  if (status === '__azure_missing') params.set('azure', 'missing');
  else if (status === '__ad_missing') params.set('ad', 'missing');
  else if (status === '__ad_stale') params.set('ad', 'stale');
  else if (status === '__ad_never') params.set('ad', 'never');
  else if (status === '__ad_resource') params.set('ad', 'resource');
  else if (status === '__ad_inactive') params.set('ad', 'inactive');
  else if (status === '__ad_attention') params.set('ad', 'attention');
  else if (status) params.set('status', status);
  if (user_type) params.set('user_type', user_type);

  try {
    const result = await apiGet(`/api/personnel?${params}`);
    canEditUsers = !!(result.can && result.can.edit);
    renderHint();
    lastAzureImport = result.last_import || null;
    lastAdImport = result.ad_last_import || null;
    adCountries = result.ad_countries || [];
    document.getElementById('btn-dirsync-upload').style.display = result.can && result.can.adUpload ? '' : 'none';
    peopleBaseline = result.baseline || null;
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

let lastAzureImport = null;
let lastAdImport = null, adCountries = [];

// Email with the AD account (the part before @) highlighted, when the person is in the AD list.
function emailHtml(p) {
  const e = String(p.email || '');
  if (!e) return '—';
  const at = e.indexOf('@');
  if (!p.ad_seen_at || at < 0) return esc(e);
  return `<b style="color:var(--text, #111827)" title="AD account">${esc(e.slice(0, at))}</b>${esc(e.slice(at))}`;
}
const managerLine = (p) => (p.ad_manager ? `<div class="text-muted" style="font-size:11.5px">↑ ${esc(p.ad_manager)}</div>` : '');
// Last seen, three sources side by side: AD logon · Intune check-in · Entra sign-in (latest over the person's
// devices). Days since each — amber after 30, red after 90. Resource accounts (shared mailboxes) show nothing.
function logonCell(p) {
  if (p.ad_resource) return '<span class="text-muted" title="Resource account — no logon check">—</span>';
  const line = (label, t, opts = {}) => {
    if (opts.never) return `<div class="lg-row"><span class="lg-src">${label}</span><span class="text-muted">never</span></div>`;
    if (!t) return `<div class="lg-row"><span class="lg-src">${label}</span><span class="text-muted">—</span></div>`;
    const d = new Date(String(t).replace(' ', 'T') + (opts.utc ? 'Z' : ''));
    if (isNaN(d)) return '';
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    const color = days > 90 ? '#dc2626' : days > 30 ? '#d97706' : 'inherit';
    const when = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    return `<div class="lg-row" title="${label}: ${when} (${days} day${days === 1 ? '' : 's'} ago)"><span class="lg-src">${label}</span>`
      + `<span style="color:${color};${days > 90 ? 'font-weight:600' : ''}">${days === 0 ? 'today' : days + ' d'}</span></div>`;
  };
  const ad = p.ad_seen_at ? line('AD', p.ad_last_logon, { never: !!p.ad_never_logon || !p.ad_last_logon }) : line('AD', '');
  return `<div class="lg-cell">${ad}${line('Intune', p.intune_last, { utc: true })}${line('Entra', p.entra_last, { utc: true })}</div>`;
}
let peopleBaseline = null;   // first big import — rows from it get no New / Edited badge

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
        ? `<button class="btn btn-ghost btn-sm" onclick="viewAssets(${jsArg(adName)}, ${jsArg(p.display_name)})">${cnt} asset${cnt !== 1 ? 's' : ''}</button>`
        : `<span class="badge badge-active">${cnt}</span>`;
    }
    // My devices: status of the confirmation, and 📨 for IT admins to make the message.
    const conf = p.devices_confirmed_at
      ? `<div class="text-sm" style="color:${p.devices_not_have ? '#b91c1c' : '#15803d'}" title="Confirmed by the user on My devices">${p.devices_not_have ? `⚠ ${p.devices_not_have} not with them` : '✅ confirmed'} ${esc(String(p.devices_confirmed_at).slice(0, 10))}</div>`
      : p.confirm_sent_at ? `<div class="text-sm text-muted" title="Link made, not confirmed yet">📨 sent ${esc(String(p.confirm_sent_at).slice(0, 10))}</div>` : '';
    if (canEditUsers && p.email) assetsCell += ` <button class="btn btn-ghost btn-sm" title="My devices: message for ${esc(p.display_name)} to check and confirm their devices" onclick="openConfirm(${p.id})">📨</button>`;
    assetsCell += conf;
    // In User Inventory but missing from the latest Azure user export → left / disabled / renamed?
    const notInAzure = lastAzureImport && p.azure_seen_at && p.azure_seen_at < lastAzureImport
      ? ' <span class="badge badge-retired" title="Not in the latest Azure user export (left, disabled or renamed?)">not in Azure</span>' : '';
    // In a country the AD list covers, but not in the latest AD upload.
    const notInAd = lastAdImport && adCountries.includes(p.country) && (!p.ad_seen_at || p.ad_seen_at < lastAdImport) && p.status !== 'deleted'
      ? ' <span class="badge badge-retired" title="Not in the latest AD user list (left, disabled or renamed?)">not in AD</span>' : '';
    const resBadge = p.ad_resource ? ' <span class="badge badge-office" title="AD resource account: shared mailbox / email group">Resource</span>' : '';
    const dept = p.department || '';
    const cc   = p.cost_center || '';
    const editBtn = canEditUsers ? `<button class="btn btn-ghost btn-sm" title="Edit Department / Cost Center"
        onclick="openEditUser(${p.id}, ${jsArg(p.display_name)}, ${jsArg(p.country)}, ${jsArg(dept)}, ${jsArg(cc)})">✏️</button> ` : '';
    return `
      <tr>
        <td class="name-cell"><strong>${esc(p.display_name) || '—'}</strong>${resBadge}${notInAzure}${notInAd}
          <div class="text-muted text-sm">${emailHtml(p)}</div>${managerLine(p)}</td>
        <td class="when-cell">${logonCell(p)}</td>
        <td class="assets-cell">${assetsCell}</td>
        <td class="text-sm wrap-cell">${editBtn}${dept ? esc(dept) : '<span class="text-muted">—</span>'}</td>
        <td class="text-muted text-sm">${cc ? esc(cc) : '—'}</td>
        <td><span class="badge badge-factory">${esc(p.country)}</span></td>
        <td>
          ${canEditUsers
            ? `<select class="form-control" style="width:132px;padding:5px 6px" onchange="savePerson(${p.id}, 'user_type', this.value)">${optionList(USER_TYPES, p.user_type)}</select>`
            : (p.user_type ? p.user_type : '<span class="text-muted">—</span>')}
        </td>
        <td>
          ${canEditUsers
            ? `<select class="form-control" style="width:132px;padding:5px 6px" onchange="savePerson(${p.id}, 'status', this.value)">${optionList(STATUSES, p.status, STATUS_LABELS)}</select>`
            : statusPill(p.status)}
        </td>
        <td class="text-muted text-sm wrap-cell">${esc(p.company_name) || '—'}</td>
        <td class="text-muted text-sm wrap-cell">${esc(p.position) || '—'}</td>
        <td>
          ${canEditUsers
            ? `<input type="date" class="form-control" style="width:128px;padding:5px 6px" value="${esc(p.leaving_date)}" ${ldDisabled} onchange="savePerson(${p.id}, 'leaving_date', this.value)" title="${ldDisabled ? 'Set User Type first' : ''}">`
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
    const rows = s.breakdown || [];
    const order = kpiCountryOrder(s.byCountry || {});
    const show = (country, status, userType) => {
      document.getElementById('filter-country').value = country || '';
      document.getElementById('filter-status').value = status || '';
      document.getElementById('filter-usertype').value = userType || '';
      document.getElementById('search-input').value = '';
      loadPeople(1);
      document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const tile = (label, color, test, status, userType) => {
      const counts = rows.filter(test).reduce((m, r) => { m[r.country] = (m[r.country] || 0) + r.cnt; return m; }, {});
      return { label, color, value: Object.values(counts).reduce((a, b) => a + b, 0), onClick: () => show('', status, userType),
        splits: order.map(c => ({ country: c, count: counts[c] || 0, onClick: () => show(c, status, userType) })) };
    };
    renderPeopleCheck(s.attention, show);
    renderKpiTiles('summary-grid', [
      tile('Total People', '#4338ca', () => true),
      tile('Hayat: No', '#dc2626', r => r.user_type === 'No Hayat Member', '', 'No Hayat Member'),
      tile('To Be Delete', '#ca8a04', r => r.status === 'to be delete', 'to be delete'),
      tile('Confirmed Delete', '#ea580c', r => r.status === 'pending delete', 'pending delete'),
      tile('Deleted', '#b91c1c', r => r.status === 'deleted', 'deleted'),
    ]);
  } catch (e) { /* ignore */ }
}

// "Needs check" chart: people to look at, whatever the list filters — by reason and by country.
// (One series → one colour, count beside each bar; click a bar to list those people.)
function renderPeopleCheck(a, show) {
  const card = document.getElementById('people-check');
  if (!card) return;
  if (!a || !a.adLoaded || !a.total) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('pc-total').textContent = `· ${a.total} people`;
  const bars = (entries, attr) => {
    const max = Math.max(1, ...entries.map(e => e[1]));
    return entries.filter(e => e[1]).map(([label, n, v]) => `<a href="#" class="cs-row" data-${attr}="${esc(v)}" title="${esc(label)}: ${n} — click to list">
        <span class="cs-label">${esc(label)}</span><span class="cs-track"><span class="cs-bar" style="width:${Math.max(2, (n / max) * 100)}%"></span></span>
        <span class="cs-val">${n}</span></a>`).join('') || '<span class="text-muted text-sm">Nothing to check.</span>';
  };
  const reasons = document.getElementById('pc-by-reason'), countries = document.getElementById('pc-by-country');
  reasons.innerHTML = bars([
    ['No activity anywhere 90+ days (AD, Intune, Entra)', a.inactive, '__ad_inactive'],
    ['No AD logon for 90+ days', a.stale, '__ad_stale'],
    ['Not in latest AD list', a.missing, '__ad_missing'],
    ['AD: never logged on', a.never, '__ad_never'],
  ].sort((x, y) => y[1] - x[1]), 'status');
  countries.innerHTML = bars(Object.entries(a.byCountry).sort((x, y) => y[1] - x[1]).map(([c, n]) => [c, n, c]), 'country');
  reasons.querySelectorAll('.cs-row').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); show('', el.dataset.status, ''); }));
  countries.querySelectorAll('.cs-row').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); show(el.dataset.country === 'Unknown' ? '' : el.dataset.country, '__ad_attention', ''); }));
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
  // Filters passed in the URL (e.g. from the Dashboard tiles): ?status= ?user_type= ?country=
  const urlP = new URLSearchParams(window.location.search);
  if (urlP.get('status'))    document.getElementById('filter-status').value = urlP.get('status');
  if (urlP.get('search'))    document.getElementById('search-input').value = urlP.get('search');
  if (urlP.get('user_type')) document.getElementById('filter-usertype').value = urlP.get('user_type');
  loadPeople();
  loadCountries().then(() => {
    const c = urlP.get('country');
    if (c) { document.getElementById('filter-country').value = c; loadPeople(1); }
  });
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
  if (typeof loadAlertButton === 'function') loadAlertButton('alert-btn-slot', 'personnel');
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
      showToast(`Imported: +${result.added} new, ${result.updated} updated, ${result.preserved} kept (edited)${result.notInExport ? `; ${result.notInExport} not in this export` : ''}`);
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
  document.getElementById('sort-by').addEventListener('change', () => loadPeople(1));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-country').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-usertype').value = '';
    document.getElementById('sort-by').value = 'updated';
    loadPeople(1);
  });
});

// ── Upload AD user list (IT admin): preview → tick / untick → apply ───────────
const adH = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function adLogonText(r) {
  if (r.never) return '<span class="text-muted">never</span>';
  if (!r.lastLogon) return '—';
  const d = new Date(r.lastLogon.replace(' ', 'T'));
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const t = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  return days > 90 ? `<span style="color:#dc2626">${t}</span>` : t;
}
// Button: onclick="openAdUpload()" in the page — works even if the setup below hasn't run yet.
const adOpenFallback = function () {
  try {
    if (!adUploadReady) setupAdUpload();
    if (window.openAdUpload === adOpenFallback) throw new Error('the upload window could not be prepared');
    window.openAdUpload();
  } catch (e) {
    alert('The AD upload window could not open: ' + (e && e.message ? e.message : e) + '\nPlease reload the page with Ctrl+F5 and try again.');
  }
};
window.openAdUpload = adOpenFallback;
let adUploadReady = false;
function setupAdUpload() {
  if (adUploadReady) return;
  adUploadReady = true;
  const input = document.getElementById('dirsync-file');
  const ov = document.getElementById('dirsync-overlay');
  if (!ov) throw new Error('the upload window is missing from the page (old copy of the page?)');
  const body = document.getElementById('dirsync-body');
  const apply = document.getElementById('dirsync-apply');
  const foot = document.getElementById('dirsync-foot');
  let fileB64 = null;
  const close = () => { ov.classList.remove('open'); fileB64 = null; };

  // The button opens the window first, with a visible file picker in it (no hidden input to rely on).
  const pickerHtml = `<p style="margin-top:0">Choose the user list exported from Active Directory (<b>.xlsx</b> or <b>.csv</b>) with the columns
      <i>SAM Account Name, Display Name, Manager, OU Name, Last Logon Time</i>.</p>
    <input type="file" id="dirsync-file-pick" accept=".xlsx,.xls,.csv" class="form-control">
    <p class="text-muted text-sm">You'll see a preview first — nothing is saved until you click <b>Apply to User Inventory</b>.</p>`;
  const showError = (m) => { body.innerHTML = pickerHtml + `<p style="color:#dc2626;font-weight:600">${adH(m)}</p>`; wirePicker(); };
  async function handleFile(f) {
    if (!f) return;
    apply.disabled = true; foot.textContent = '';
    body.innerHTML = `⏳ Reading <b>${adH(f.name)}</b> and comparing with User Inventory…`;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      fileB64 = btoa(bin);
      showPreview(await apiPost('/api/personnel/ad-import', { file: fileB64 }));
    } catch (err) {
      console.error('[AD upload]', err);
      let m = err && err.message ? err.message : String(err);
      try { m = JSON.parse(m).error || m; } catch { /* not JSON */ }
      if (/<html|<!doctype/i.test(m)) m = 'The server or the network blocked the upload (got a web page instead of an answer). Try again, or tell IT.';
      showError(`Could not load the preview: ${String(m).slice(0, 300)}`);
    }
  }
  function wirePicker() {
    const pick = document.getElementById('dirsync-file-pick');
    if (pick) pick.addEventListener('change', () => handleFile(pick.files && pick.files[0]));
  }
  window.openAdUpload = () => {
    fileB64 = null; apply.disabled = true; foot.textContent = '';
    body.innerHTML = pickerHtml; wirePicker();
    ov.classList.add('open');
  };
  input.addEventListener('change', () => { ov.classList.add('open'); handleFile(input.files && input.files[0]); });

  function section(title, open, inner) {
    return `<details ${open ? 'open' : ''} style="margin:10px 0;border:1px solid var(--border);border-radius:8px;padding:8px 12px">
      <summary style="cursor:pointer;font-weight:600">${title}</summary><div style="margin-top:8px">${inner}</div></details>`;
  }
  const tbl = (head, rows) => `<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  function showPreview(r) {
    const people = r.fresh.filter(x => !x.shared && !x.resource), shared = r.fresh.filter(x => x.shared && !x.resource);
    const resNew = r.fresh.filter(x => x.resource);
    const freshRow = (x, checked, cls) => `<tr><td><input type="checkbox" class="${cls}" data-sam="${adH(x.sam)}" ${checked ? 'checked' : ''}></td>
      <td><b>${adH(x.sam)}</b></td><td>${adH(x.name)}</td><td>${adH(x.country || '—')}</td><td class="text-sm">${adH(x.manager || '—')}</td><td class="text-sm">${adLogonText(x)}</td></tr>`;
    body.innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:8px">
        ${[['AD accounts', r.accounts, '#1a56db'], ['Matched', r.matched, '#16a34a'], ['New people', people.length, '#0891b2'],
           ['Doubles to merge', r.merges.length, '#d97706'], ['Not in AD', r.notInAd.length, '#dc2626']]
          .map(([l, v, c]) => `<div class="kpi" style="--kpi-color:${c}"><div class="kpi-main"><div class="kpi-label"><span class="kpi-dot"></span>${l}</div><div class="kpi-value">${v}</div></div></div>`).join('')}
      </div>
      <p class="text-sm text-muted" style="margin:4px 0 8px">Countries in this file: <b>${adH(r.countries.join(', '))}</b> ·
        ${r.users} user accounts · ${r.resources} resource accounts (shared mailboxes / groups, marked <b>Resource</b>) ·
        ${r.staleUsers} with no logon for 90+ days · ${r.neverUsers} never logged on.
        Matched people get their AD account, manager and last logon; nothing else of theirs is changed.</p>
      ${section(`➕ New people to add (${people.length}) — untick anyone you don't want`, true, people.length
        ? tbl(['Add', 'AD account', 'Name', 'Country', 'Manager', 'Last logon'], people.map(x => freshRow(x, true, 'dirsync-add')))
          + '<p class="text-muted text-sm">Email is set to account@ the usual company domain; HR fills User Type.</p>' : '<span class="text-muted">None.</span>')}
      ${section(`🗂 Looks like shared / function accounts (${shared.length}) — not added unless ticked`, false, shared.length
        ? tbl(['Add', 'AD account', 'Name', 'Country', 'Manager', 'Last logon'], shared.map(x => freshRow(x, false, 'dirsync-shared'))) : '<span class="text-muted">None.</span>')}
      ${section(`🔀 Doubles to merge (${r.merges.length}) — the second row is merged into the first, then removed`, true, r.merges.length
        ? tbl(['Merge', 'Keep (in AD)', 'Double (removed)'], r.merges.map(m => `<tr><td><input type="checkbox" class="dirsync-merge" data-id="${m.drop.id}" ${m.careful ? '' : 'checked'}>${m.careful ? '<div class="text-sm" style="color:#d97706">check first</div>' : ''}</td>
            <td><b>${adH(m.keep.name)}</b><div class="text-muted text-sm">${adH(m.keep.email)} · AD ${adH(m.sam)}</div></td>
            <td>${adH(m.drop.name)}<div class="text-muted text-sm">${adH(m.drop.email)} · ${adH(m.drop.status)}${m.drop.user_type ? ' · ' + adH(m.drop.user_type) : ''}</div></td></tr>`))
          + '<p class="text-muted text-sm">User Type, Leaving Date, Department, Cost Center, Company and Position from the double fill blanks on the kept row.</p>' : '<span class="text-muted">None found.</span>')}
      ${r.matchedByName.length ? section(`🔗 Matched by name (${r.matchedByName.length}) — AD account differs from the email`, false,
        tbl(['AD account', 'AD name', 'User Inventory'], r.matchedByName.map(m => `<tr><td><b>${adH(m.ad.sam)}</b></td><td>${adH(m.ad.name)}</td><td>${adH(m.person.name)}<div class="text-muted text-sm">${adH(m.person.email)}</div></td></tr>`))) : ''}
      ${r.countryDiffs.length ? section(`🌍 Country differs (${r.countryDiffs.length}) — not changed, check by hand`, false,
        tbl(['Person', 'User Inventory', 'AD OU'], r.countryDiffs.map(d => `<tr><td>${adH(d.name)} <span class="text-muted text-sm">(${adH(d.sam)})</span></td><td>${adH(d.inventory)}</td><td>${adH(d.ad)}</td></tr>`))) : ''}
      ${section(`⚠ In User Inventory but not in AD (${r.notInAd.length}) — left, disabled or renamed? Not changed; marked "not in AD"`, false, r.notInAd.length
        ? tbl(['Name', 'Email', 'Country', 'Status'], r.notInAd.map(p => `<tr><td>${adH(p.name)}</td><td class="text-sm">${adH(p.email)}</td><td>${adH(p.country)}</td><td class="text-sm">${adH(p.status)}</td></tr>`)) : '<span class="text-muted">None.</span>')}
      ${section(`📭 New resource accounts to add (${resNew.length}) — shared mailboxes / email groups, marked Resource`, false, resNew.length
        ? tbl(['Add', 'AD account', 'Name', 'Country', 'Manager', 'Last logon'], resNew.map(x => freshRow(x, true, 'dirsync-add'))) : '<span class="text-muted">None — all resource accounts are already in User Inventory.</span>')}`;
    const count = () => {
      const add = body.querySelectorAll('.dirsync-add:checked, .dirsync-shared:checked').length;
      const mer = body.querySelectorAll('.dirsync-merge:checked').length;
      foot.textContent = `Will update ${r.matched} matched · add ${add} · merge ${mer}`;
    };
    body.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', count));
    count();
    apply.disabled = false;
  }

  apply.addEventListener('click', async () => {
    if (!fileB64) return;
    const skipAdd = [...body.querySelectorAll('.dirsync-add:not(:checked)')].map(c => c.dataset.sam);
    const addShared = [...body.querySelectorAll('.dirsync-shared:checked')].map(c => c.dataset.sam);
    const skipMerge = [...body.querySelectorAll('.dirsync-merge:not(:checked)')].map(c => Number(c.dataset.id));
    apply.disabled = true; apply.textContent = 'Applying…';
    try {
      const r = await apiPost('/api/personnel/ad-import', { file: fileB64, apply: true, skipAdd, addShared, skipMerge });
      showToast(`AD list applied: ${r.matched} updated, ${r.added} added, ${r.merged} merged`);
      close();
      loadPeople(1); if (typeof loadSummary === 'function') loadSummary();
    } catch (err) {
      let m = 'Could not apply'; try { m = JSON.parse(err.message).error || m; } catch {}
      showToast(m, 'error'); apply.disabled = false;
    }
    apply.textContent = 'Apply to User Inventory';
  });
  document.getElementById('dirsync-close').addEventListener('click', close);
  document.getElementById('dirsync-cancel').addEventListener('click', close);
}
const adSetupSafe = () => { try { setupAdUpload(); } catch (e) { console.error('[AD upload setup]', e); } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adSetupSafe); else adSetupSafe();

// ── My devices: personal link + ready message for the person to confirm their devices (routes/confirm.js) ──
function mdcOverlay() {
  let ov = document.getElementById('mdc-ov');
  if (ov) return ov;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="mdc-ov"><div class="modal" style="max-width:720px">
    <div class="modal-header"><span class="modal-title" id="mdc-t">My devices</span><button class="modal-close" onclick="document.getElementById('mdc-ov').classList.remove('open')" aria-label="Close">✕</button></div>
    <div class="modal-body" id="mdc-b"></div>
    <div class="modal-footer" id="mdc-f"></div></div></div>`);
  return document.getElementById('mdc-ov');
}
const mdcDate = (s) => (s ? esc(String(s).slice(0, 16)) + ' UTC' : '');
async function openConfirm(id) {
  const ov = mdcOverlay(); ov.classList.add('open');
  const b = document.getElementById('mdc-b'), f = document.getElementById('mdc-f');
  b.innerHTML = '<p class="text-muted">Loading…</p>'; f.innerHTML = '';
  let d;
  try { d = await apiGet('/api/confirm/person/' + id); } catch (e) { b.innerHTML = '<p class="text-muted">Could not load.</p>'; return; }
  document.getElementById('mdc-t').textContent = `📨 My devices — ${d.person.display_name}`;
  const st = (l) => {
    if (l.confirmed_at) return `✅ confirmed ${mdcDate(l.confirmed_at)}`;
    if (l.revoked) return 'replaced by a newer link';
    if (l.expires_at < d.now) return 'expired';
    if (l.attempts >= 5 && !l.verified_at) return `🔒 locked (${l.attempts} wrong emails)`;
    return [l.verified_at ? `email checked ${mdcDate(l.verified_at)}` : l.opened_at ? `opened ${mdcDate(l.opened_at)}` : 'not opened yet',
      l.attempts ? `${l.attempts} wrong email${l.attempts > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  };
  const res = (c) => (!c ? '<span class="text-muted">not confirmed</span>'
    : c.result === 'have' ? `<span style="color:#15803d">✓ has it</span> <span class="text-muted text-sm">${mdcDate(c.confirmed_at)}</span>`
    : `<span style="color:#b91c1c">✗ not with them</span> <span class="text-muted text-sm">${mdcDate(c.confirmed_at)}${c.note ? ' · “' + esc(c.note) + '”' : ''}</span>`);
  b.innerHTML = `<div class="text-sm text-muted" style="margin-bottom:8px">${esc(d.person.email)} · ${esc(d.person.country)} — the link only opens the list when this email is typed.</div>
    <h4 style="margin:6px 0">Devices registered (AD Name = ${esc(String(d.person.email).split('@')[0])}): ${d.assets.length}</h4>
    ${d.assets.length ? `<div class="table-wrap"><table><thead><tr><th>Asset</th><th>Device</th><th>Serial</th><th>Last answer</th></tr></thead><tbody>${d.assets.map(a => `<tr>
      <td><b>${esc(a.code || '#' + a.id)}</b></td><td>${esc([a.type, a.model].filter(Boolean).join(' · '))}</td><td class="text-sm">${esc(a.serial || '—')}</td><td>${res(a.confirmation)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="text-muted text-sm">No asset has this AD Name — the person will be asked to confirm they hold no company device.</p>'}
    ${d.gone.length ? `<p class="text-sm text-muted">Confirmed earlier, no longer registered to them: ${d.gone.map(g => esc(g.asset_label)).join('; ')}</p>` : ''}
    <h4 style="margin:12px 0 4px">Links sent</h4>
    ${d.links.length ? `<ul class="mdc-st">${d.links.map(l => `<li>${mdcDate(l.created_at)} by ${esc(l.created_by)} — ${st(l)}</li>`).join('')}</ul>` : '<p class="text-muted text-sm">None yet.</p>'}
    <div id="mdc-msg"></div>`;
  f.innerHTML = `<span class="text-muted text-sm" style="margin-right:auto">A new link replaces the old one · valid 14 days</span>
    <button class="btn btn-primary" id="mdc-new">📨 Make link &amp; message</button>`;
  document.getElementById('mdc-new').onclick = () => makeConfirmLink(id);
}

async function makeConfirmLink(id) {
  const btn = document.getElementById('mdc-new'); btn.disabled = true;
  let r;
  try { r = await apiPost(`/api/confirm/person/${id}/link`, {}); }
  catch (e) { let m = 'Could not make the link'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); btn.disabled = false; return; }
  const first = String(r.name || '').trim();   // full name: name order differs by country
  const until = String(r.expires_at).slice(0, 10);
  const list = r.assets.length ? r.assets.map(a => `${[a.type, a.model].filter(Boolean).join(' ')} — ${a.code || ''}${a.serial ? ' · SN ' + a.serial : ''}`) : [];
  const subject = 'Please confirm your company devices';
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
<p>Dear ${esc(first || r.name)},</p>
<p>IT keeps a record of the company devices registered to you${list.length ? ` (<b>${list.length}</b> device${list.length > 1 ? 's' : ''})` : ''}. Please take one minute to check the list and confirm.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:6px;background:#1a56db">
<a href="${esc(r.url)}" style="display:inline-block;padding:11px 22px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;background:#1a56db">✅ Check &amp; confirm my devices</a></td></tr></table>
<p style="font-size:13px;color:#475569">The page will ask for your work email (the address this message was sent to) to make sure it is you. The link is personal — please do not forward it — and works until <b>${esc(until)}</b>.</p>
<p>Thank you,<br>${esc(r.sender)} — IT</p></div>`;
  const text = `Dear ${first || r.name},\n\nIT keeps a record of the company devices registered to you${list.length ? ` (${list.length})` : ''}. Please take one minute to check the list and confirm:\n\n${r.url}\n\nThe page will ask for your work email (the address this message was sent to) to make sure it is you. The link is personal — please do not forward it — and works until ${until}.\n\nThank you,\n${r.sender} — IT`;
  document.getElementById('mdc-msg').innerHTML = `<h4 style="margin:14px 0 6px">Message to send to <b>${esc(r.email)}</b> <span class="text-muted text-sm">· subject: ${esc(subject)}</span></h4>
    <div class="mdc-msg">${html}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-primary btn-sm" id="mdc-copy">📋 Copy message</button>
      <a class="btn btn-ghost btn-sm" href="mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}">✉️ Open in Outlook (plain text)</a>
      <button class="btn btn-ghost btn-sm" id="mdc-link">🔗 Copy link only</button></div>
    <p class="text-muted text-sm" style="margin-top:6px">Paste into a new Outlook email to <b>${esc(r.email)}</b> — the button stays a button. Send it only to this address: the page checks the email.</p>`;
  document.getElementById('mdc-copy').onclick = async () => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); showToast('Message copied — paste it into the email'); }
    catch { try { await navigator.clipboard.writeText(text); showToast('Copied as plain text'); } catch { showToast('Copy failed — select the message and copy it', 'error'); } }
  };
  document.getElementById('mdc-link').onclick = async () => { try { await navigator.clipboard.writeText(r.url); showToast('Link copied'); } catch { showToast('Copy failed', 'error'); } };
  btn.textContent = '📨 Make a new link'; btn.disabled = false;
  document.getElementById('mdc-msg').scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadPeople(currentPage || 1);
}
