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
    Active:  'badge-active',
    Broken:  'badge-broken',
    Retired: 'badge-retired',
  };
  const dot = { Active: '●', Broken: '●', Retired: '●' };
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
  'history_usage','remark'
];

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
});

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
