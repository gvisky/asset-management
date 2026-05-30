/* Software & Licenses page logic */

const LIC = '/api/licenses';
let manageId = null;
const lEsc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function seatsBar(used, total) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : (used > 0 ? 100 : 0);
  const over = total > 0 && used > total;
  const color = over ? 'var(--broken)' : (pct >= 90 ? 'var(--retired)' : 'var(--active)');
  return `<div style="min-width:110px">
    <div class="text-sm" style="margin-bottom:3px;${over ? 'color:var(--broken);font-weight:600' : ''}">${used} / ${total || '∞'}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
  </div>`;
}

function renewalBadge(d) {
  if (!d) return '<span class="text-muted">—</span>';
  const days = Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000);
  if (isNaN(days)) return lEsc(d);
  if (days < 0)   return `<span class="badge badge-broken">Expired ${lEsc(d)}</span>`;
  if (days <= 30) return `<span class="badge badge-retired">${lEsc(d)} (${days}d)</span>`;
  return `<span class="badge badge-active">${lEsc(d)}</span>`;
}

async function loadLicenses() {
  const tbody = document.getElementById('lic-tbody');
  try {
    const rows = await apiGet(LIC);
    document.getElementById('total-label').textContent = rows.length ? `${rows.length} license(s)` : '';
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No licenses yet.</td></tr>'; return; }
    tbody.innerHTML = rows.map(l => `
      <tr>
        <td><strong>${lEsc(l.name)}</strong></td>
        <td class="text-muted text-sm">${lEsc(l.vendor) || '—'}</td>
        <td class="text-muted text-sm">${lEsc(l.type)}</td>
        <td>${seatsBar(l.seats_used, l.total_seats)}</td>
        <td>${renewalBadge(l.renewal_date)}</td>
        <td>${l.country === 'Global' ? '<span class="badge badge-office">Global</span>' : `<span class="badge badge-factory">${lEsc(l.country)}</span>`}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="onManage(${l.id})" title="Manage seats">Seats</button>
            <button class="btn btn-ghost btn-sm" onclick="onEdit(${l.id})" title="Edit">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="onDelete(${l.id}, '${lEsc(l.name).replace(/'/g, "\\'")}')" title="Delete">✕</button>
          </div>
        </td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load.</td></tr>';
  }
}

const LF = ['name','vendor','type','total_seats','license_key','notes','purchase_date','renewal_date','cost','country'];
function readForm() {
  const o = {};
  LF.forEach(f => o[f] = document.getElementById('l-' + f).value);
  return o;
}
function fillForm(l) {
  document.getElementById('l-id').value = l ? l.id : '';
  LF.forEach(f => document.getElementById('l-' + f).value = l ? (l[f] ?? '') : (f === 'type' ? 'subscription' : f === 'country' ? 'Global' : f === 'total_seats' ? 0 : ''));
}

function openModal(title) { document.getElementById('modal-title').textContent = title; document.getElementById('modal-overlay').classList.add('open'); }
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

function onAdd() { fillForm(null); openModal('Add License'); }
async function onEdit(id) {
  try { const l = await apiGet(`${LIC}/${id}`); fillForm(l); openModal('Edit License'); }
  catch (e) { showToast('Failed to load', 'error'); }
}
async function onSave() {
  const data = readForm();
  if (!data.name.trim()) { showToast('Name is required', 'error'); return; }
  const id = document.getElementById('l-id').value;
  try {
    if (id) await apiPut(`${LIC}/${id}`, data); else await apiPost(LIC, data);
    showToast('Saved'); closeModal(); loadLicenses();
  } catch (e) { showToast('Save failed', 'error'); }
}
async function onDelete(id, name) {
  if (!confirm(`Delete license "${name}"? Seat assignments will be removed.`)) return;
  try { await apiDelete(`${LIC}/${id}`); showToast('Deleted'); loadLicenses(); }
  catch (e) { showToast('Delete failed (admin only)', 'error'); }
}

// ── Manage seats ────────────────────────────────────────────────────────────
async function onManage(id) {
  manageId = id;
  document.getElementById('seat-overlay').classList.add('open');
  await loadSeats();
}
async function loadSeats() {
  const box = document.getElementById('seat-list');
  try {
    const l = await apiGet(`${LIC}/${manageId}`);
    document.getElementById('seat-title').textContent = `${l.name} — ${l.seats_used}/${l.total_seats || '∞'} seats`;
    if (!l.assignments.length) { box.innerHTML = '<span class="text-muted text-sm">No seats assigned.</span>'; return; }
    box.innerHTML = l.assignments.map(a => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1"><strong>${lEsc(a.assignee_ref)}</strong>
          <span class="text-muted text-sm">· ${lEsc(a.assignee_type)} · ${lEsc(a.assigned_at)}</span></div>
        <button class="btn btn-ghost btn-sm maint-edit" onclick="onRelease(${a.id})">Release</button>
      </div>`).join('');
  } catch (e) { box.innerHTML = '<span class="text-muted text-sm">Failed to load.</span>'; }
}
async function onAssignSeat() {
  const ref = document.getElementById('seat-ref').value.trim();
  if (!ref) { showToast('Enter an assignee', 'error'); return; }
  try {
    const r = await apiPost(`${LIC}/${manageId}/assign`, { assignee_ref: ref, assignee_type: document.getElementById('seat-type').value });
    if (r.over) showToast('Assigned — note: over seat limit', 'error'); else showToast('Seat assigned');
    document.getElementById('seat-ref').value = '';
    loadSeats(); loadLicenses();
  } catch (e) { showToast('Assign failed', 'error'); }
}
async function onRelease(assignmentId) {
  try { await apiPost(`${LIC}/release/${assignmentId}`, {}); showToast('Released'); loadSeats(); loadLicenses(); }
  catch (e) { showToast('Release failed', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadLicenses();
  document.getElementById('btn-add').addEventListener('click', onAdd);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', onSave);
  document.getElementById('seat-close').addEventListener('click', () => document.getElementById('seat-overlay').classList.remove('open'));
});
