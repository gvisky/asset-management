/* ── Shared utilities used by both dashboard.js and inventory.js ── */

// Toast notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// Status badge HTML
function statusBadge(status) {
  const map = {
    Active: 'badge-active',
    Broken: 'badge-broken',
    Stock:  'badge-stock',
  };
  const dot = { Active: '●', Broken: '●', Stock: '●' };
  return `<span class="badge ${map[status] || ''}">${dot[status] || ''} ${status}</span>`;
}

// Location badge HTML
function locationBadge(loc) {
  if (loc !== 'Office' && loc !== 'Factory') return '<span class="text-muted">—</span>';
  const cls = loc === 'Factory' ? 'badge-factory' : 'badge-office';
  return `<span class="badge ${cls}">${loc}</span>`;
}

// ── "Last updated" cell: relative time + New / Edited badge (recent changes) ───
// SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; shown in the viewer's local time.
function parseDbTime(v) {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
  return isNaN(d) ? null : d;
}
// baseline: records created/updated before it (the first big import) get no New / Edited badge.
function whenCell(created, updated, baseline) {
  const u = parseDbTime(updated) || parseDbTime(created);
  if (!u) return '<span class="text-muted">—</span>';
  const c = parseDbTime(created);
  const mins = Math.floor((Date.now() - u.getTime()) / 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(u.getHours())}:${pad(u.getMinutes())}`;
  const date = `${u.getFullYear()}-${pad(u.getMonth() + 1)}-${pad(u.getDate())}`;
  const rel = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 24 * 60 && new Date().getDate() === u.getDate()
    ? `today ${time}` : mins < 48 * 60 ? `yesterday ${time}` : date;
  // New = created recently and not edited since; Edited = changed recently.
  const isNew = c && Math.abs(u - c) < 2 * 60000;
  const base = parseDbTime(baseline);
  const recent = mins < 7 * 24 * 60 && !(base && u <= base);
  const badge = recent ? (isNew ? '<br><span class="badge badge-active" style="font-size:10px">New</span>'
                                : '<br><span class="badge badge-office" style="font-size:10px">Edited</span>') : '';
  return `<span class="text-sm" title="${date} ${time}${c ? ' · created ' + String(created).slice(0, 16) + ' UTC' : ''}">${rel}</span>${badge}`;
}

// ── Missing-info rules (mirror routes/assets.js) ──────────────────────────────
// PC No and AD Name are only required for laptops and desktops.
function needsPcAd(assetType) { return ['laptop', 'desktop'].includes(String(assetType || '').trim().toLowerCase()); }
function missingInfoTags(a) {
  const miss = (v) => (v === null || v === undefined || String(v).trim() === '');
  const tags = [];
  if (miss(a.serial_no))  tags.push('Serial');
  if (miss(a.asset_code)) tags.push('Asset code');
  if (needsPcAd(a.asset_type)) {
    if (miss(a.computer_no)) tags.push('PC No');
    if (a.status === 'Active' && miss(a.ad_name)) tags.push('AD Name');
  }
  return tags;
}
// Laptop, Desktop, Phone are listed first wherever asset types are listed.
const TYPE_FIRST = ['laptop', 'desktop', 'mobile phone', 'phone', 'ip phone'];
function typeRank(t) { const i = TYPE_FIRST.indexOf(String(t || '').trim().toLowerCase()); return i < 0 ? TYPE_FIRST.length : i; }

// Office / Factory sites exist only in Vietnam — the asset form's Location field
// is shown (and required) only when the asset's country is Vietnam.
const SITE_COUNTRY = 'Vietnam';
function locationApplies(country) { return !country || country === SITE_COUNTRY; }
function syncLocationField() {
  const loc = document.getElementById('f-location');
  const fc = document.getElementById('f-country');
  if (!loc) return;
  const applies = locationApplies(fc ? fc.value : '');
  const group = loc.closest('.form-group');
  if (group) group.style.display = applies ? '' : 'none';
  loc.required = applies;
  if (!applies) loc.value = '';
}
document.addEventListener('DOMContentLoaded', () => {
  const fc = document.getElementById('f-country');
  if (fc) fc.addEventListener('change', syncLocationField);
});

// ── Modal helpers (shared form fields) ────────────────────────────────────────
const FIELDS = [
  'location','country','status','department','computer_no','brand_model',
  'serial_no','asset_code','user_name','ad_name','mk','date_assigned',
  'history_usage','remark',
  'purchase_date','warranty_expiry','vendor','cost','po_number',
  'cost_center','ecc_cc','asset_s4','asset_description','cost_center_desc','asset_type'
];

// Warranty status badge from an ISO date string ('' → nothing).
function warrantyBadge(dateStr) {
  if (!dateStr) return '';
  const exp = new Date(dateStr + 'T00:00:00');
  if (isNaN(exp)) return '';
  const days = Math.ceil((exp - new Date()) / 86400000);
  if (days < 0)  return `<span class="badge badge-broken">Expired ${dateStr}</span>`;
  if (days <= 90) return `<span class="badge badge-retired">Expires ${dateStr} (${days}d)</span>`;
  return `<span class="badge badge-active">Until ${dateStr}</span>`;
}

function getFormData() {
  const data = {};
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) data[f] = el.value.trim();
  });
  if (!locationApplies(data.country)) data.location = '';
  return data;
}

function setFormData(asset) {
  document.getElementById('asset-id').value = asset.id || '';
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.value = asset[f] !== undefined ? asset[f] : '';
  });
  syncLocationField();
}

function clearForm() {
  document.getElementById('asset-id').value = '';
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.value = (f === 'status') ? 'Active' : (f === 'location') ? '' : '';
  });
  // Country is a select without an empty option — the single-country user's country, else the first option.
  const fc = document.getElementById('f-country');
  if (fc) {
    const mine = typeof mySingleCountry === 'function' ? mySingleCountry() : null;
    fc.value = mine || (fc.options[0] ? fc.options[0].value : '');
  }
  syncLocationField();
}

// ── API helpers ────────────────────────────────────────────────────────────────
const API = '/api/assets';

async function apiGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPut(url, body) {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiDelete(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Modal open/close (used by both pages) ─────────────────────────────────────
function openModal(title) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  clearForm();
}

// Wire modal close buttons if present
document.addEventListener('DOMContentLoaded', () => {
  const mc = document.getElementById('modal-close');
  const cc = document.getElementById('modal-cancel');
  if (mc) mc.addEventListener('click', closeModal);
  if (cc) cc.addEventListener('click', closeModal);

  // Sidebar add-asset link
  const navAdd = document.getElementById('nav-add');
  const btnAdd = document.getElementById('btn-add-top');
  function handleAdd(e) {
    e.preventDefault();
    clearForm();
    openModal('Add Asset');
    // Save handler set in page script; expose globally
    if (typeof onSaveAdd === 'function') onSaveAdd();
  }
  if (navAdd) navAdd.addEventListener('click', handleAdd);
  if (btnAdd) btnAdd.addEventListener('click', handleAdd);

  initMobileNav();
  initResponsiveTables();
  populateDeptOptions();
  wireDeptSelect();
});

// Render a row of small summary cards into a #grid. cards = [[label, value, bg, fg]].
function renderSummaryCards(gridId, cards) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = cards.map(([l, v, bg, fg]) =>
    `<div class="stat-card" style="padding:16px 18px">
       <div class="stat-icon" style="width:38px;height:38px;background:${bg || '#eef2ff'}">
         <svg width="18" height="18" fill="none" stroke="${fg || '#374151'}" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
       </div>
       <div><div class="stat-label">${l}</div><div class="stat-value" style="font-size:22px">${v}</div></div>
     </div>`).join('');
}

// Fill the Department dropdown(s) from existing departments in the DB.
// Works for the asset form's <select id="f-department"> and the licenses
// <datalist id="dept-options"> — whichever is present on the page.
async function populateDeptOptions() {
  const sel = document.getElementById('f-department');
  const dl  = document.getElementById('dept-options');
  if (!sel && !dl) return;
  try {
    const { departments } = await apiGet('/api/assets/filters');
    const depts = departments || [];
    const optEsc = (d) => String(d).replace(/"/g, '&quot;');
    if (dl) dl.innerHTML = depts.map(d => `<option value="${optEsc(d)}"></option>`).join('');
    if (sel && sel.tagName === 'SELECT') {
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Select department —</option>'
        + depts.map(d => `<option value="${optEsc(d)}">${d}</option>`).join('')
        + '<option value="__new__">➕ New department…</option>';
      if (cur && cur !== '__new__') sel.value = cur;
    }
  } catch (e) { /* no access / no data */ }
}

// Let users add a department not yet in the list.
function wireDeptSelect() {
  const sel = document.getElementById('f-department');
  if (!sel || sel.tagName !== 'SELECT' || sel.dataset.wired) return;
  sel.dataset.wired = '1';
  sel.addEventListener('change', () => {
    if (sel.value !== '__new__') return;
    const v = (prompt('New department name:') || '').trim();
    if (v) {
      if (![...sel.options].some(o => o.value === v)) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        sel.insertBefore(opt, sel.lastElementChild);   // before the "New…" option
      }
      sel.value = v;
    } else {
      sel.value = '';
    }
  });
}

// ── Responsive tables: tag each cell with its column header (phone card view) ──
// Adds data-label/"responsive" used only by the <=768px CSS; zero effect on desktop.
function labelizeTable(tbody) {
  const table = tbody.closest('table');
  const thead = table && table.querySelector('thead');
  if (!thead) return;
  const headers = [...thead.querySelectorAll('th')].map(th => th.textContent.trim());
  table.classList.add('responsive');
  tbody.querySelectorAll('tr').forEach(tr => {
    [...tr.children].forEach((td, i) => {
      if (td.hasAttribute('colspan')) return;   // empty/loading rows
      td.setAttribute('data-label', headers[i] || '');
    });
  });
}

function initResponsiveTables() {
  document.querySelectorAll('table > tbody').forEach(tbody => {
    labelizeTable(tbody);
    // Re-tag when rows are (re)rendered by fetch/pagination/filtering.
    // Only watches childList, so the attribute writes above won't re-trigger it.
    new MutationObserver(() => labelizeTable(tbody))
      .observe(tbody, { childList: true });
  });
}

// ── Mobile off-canvas sidebar (hamburger toggle + backdrop) ───────────────────
function initMobileNav() {
  const sidebar = document.querySelector('.sidebar');
  const topbar = document.querySelector('.topbar');
  if (!sidebar || !topbar || document.querySelector('.menu-toggle')) return;

  const toggle = document.createElement('button');
  toggle.className = 'menu-toggle';
  toggle.setAttribute('aria-label', 'Toggle menu');
  toggle.innerHTML =
    '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
    '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  topbar.insertBefore(toggle, topbar.firstChild);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  document.body.appendChild(backdrop);

  const open  = () => { sidebar.classList.add('open');  backdrop.classList.add('show'); };
  const close = () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); };

  toggle.addEventListener('click', () =>
    sidebar.classList.contains('open') ? close() : open());
  backdrop.addEventListener('click', close);
  // Tapping a nav destination should dismiss the menu
  sidebar.querySelectorAll('.nav-link').forEach(link =>
    link.addEventListener('click', close));
  // Reset state if the viewport grows back to desktop
  window.addEventListener('resize', () => { if (window.innerWidth > 768) close(); });
}
