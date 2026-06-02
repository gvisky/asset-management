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
  const cls = loc === 'Factory' ? 'badge-factory' : 'badge-office';
  return `<span class="badge ${cls}">${loc}</span>`;
}

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
  return data;
}

function setFormData(asset) {
  document.getElementById('asset-id').value = asset.id || '';
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.value = asset[f] !== undefined ? asset[f] : '';
  });
}

function clearForm() {
  document.getElementById('asset-id').value = '';
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    el.value = (f === 'status') ? 'Active' : (f === 'location') ? '' : '';
  });
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
