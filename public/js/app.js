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
  'location','status','department','computer_no','brand_model',
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
});
