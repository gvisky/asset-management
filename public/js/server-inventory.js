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
  'purchase_date', 'warranty_expiry', 'vendor', 'cost', 'po_number', 'history_usage', 'remark', 'it_ot', 'mac', 'vlan', 'ot_system', 'switch_port'];

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
  const itot = document.getElementById('filter-itot').value;
  if (itot) qs.set('it_ot', itot);
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
      <td>${s.it_ot === 'OT' ? '<span class="si-ot" title="OT device (Operation Technology)">OT</span> ' : ''}<strong>${sEsc(s.hostname) || '—'}</strong>${s.hostname && /\//.test(s.hostname) ? ` <a href="/network-map.html?host=${encodeURIComponent(s.hostname)}" title="Open on the network map" onclick="event.stopPropagation()">🗺</a>` : ''}</td>
      <td>${sEsc(s.brand_model) || '—'} ${DeviceSpecs.btn(s.brand_model, s.category)}</td>
      <td class="text-muted text-sm">${sEsc(s.producer) || '—'}</td>
      <td>${s.category ? `<span class="badge badge-office">${sEsc(s.category)}</span>` : '—'}</td>
      <td class="text-muted text-sm">${sEsc(s.ip_address) || '—'}</td>
      <td class="si-sn">${sEsc(s.serial_no) || '<span class="text-muted">—</span>'}</td>
      <td><span class="badge badge-factory">${sEsc(s.country) || '—'}</span></td>
      <td class="text-muted text-sm">${sEsc(s.location) || '—'}</td>
      <td>${statusBadge(s.status)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="onView(${s.id})" title="View"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="btn btn-ghost btn-sm si-ed-e" onclick="onEdit(${s.id})" title="Edit"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn btn-danger btn-sm si-ed" onclick="onDelete(${s.id}, '${sAttr(s.hostname || s.asset_code)}')" title="Delete"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
        </div>
      </td>
    </tr>`;
}
// Phone: tap anywhere on a device row (not on a button / link) to open its view.
document.addEventListener('click', (e) => {
  if (!window.matchMedia('(max-width: 768px)').matches) return;
  const tr = e.target.closest('#servers-tbody tr:not(.sg-grp)');
  if (!tr || e.target.closest('button, a, input, select')) return;
  const v = tr.querySelector('button[title="View"]'); if (v) v.click();
});
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
      if (open) html += cabinetRows(cat, list);
    }
    html += single.map(s => rowHtml(s, false)).join('');
  }
  tbody.innerHTML = html;
}
// ── Cabinet (Kabin) sub-groups inside an open category ──────────────────────
// Same switch, same area: the cabinet comes from the location ("HARICI KABIN3 (U5)",
// "CCTV KABIN 5", "IT KABIN 7"), else the switch it is cabled to ("HK3_CCTV_01 Gi1/0/5"),
// else the device name (HK3-5 → HARICI KABIN 3, K5-12 → CCTV KABIN 5, K7-A5 → IT KABIN 7,
// K11 → IT KABIN 11, K1 → office MR-01) — the same rules as the camera list import.
const sOpenCabs = new Set();
const sFold = (v) => String(v || '').toUpperCase().replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
function cabinetOf(s) {
  const L = sFold(s.location), sw = sFold(String(s.switch_port || '').split(/\s+/)[0]), h = sFold(s.hostname);
  let m;
  for (const t of [L, sw]) {
    if ((m = t.match(/HARICI\s*-?\s*KAB[Iİ]N\s*0*(\d+)/))) return 'HARICI KABIN ' + +m[1];
    if ((m = t.match(/CCTV\s*-?\s*KAB[Iİ]N\s*0*(\d+)/))) return 'CCTV KABIN ' + +m[1];
    if ((m = t.match(/IT\s*-?\s*KAB[Iİ]N\s*0*(\d+)/))) return 'IT KABIN ' + +m[1];
    if ((m = t.match(/\bKAB[Iİ]N\s*0*(\d+)/))) return 'KABIN ' + +m[1];
  }
  if ((m = sw.match(/^HK0*(\d+)[_-]/))) return 'HARICI KABIN ' + +m[1];
  if ((m = sw.match(/^K0*(\d+)[_-]CCTV/))) return 'CCTV KABIN ' + +m[1];
  if ((m = h.match(/^HK0*(\d+)(?:\b|[-_])/))) return 'HARICI KABIN ' + +m[1];
  if ((m = h.match(/^K0*(\d+)[-_](A?)/))) {
    const n = +m[1];
    if (n === 1) return 'Office (MR-01)';
    if (n === 11 || m[2]) return 'IT KABIN ' + n;
    return 'CCTV KABIN ' + n;
  }
  if ((m = sw.match(/^(MR-\d+)/))) return 'Office (' + m[1] + ')';
  const loc = String(s.location || '').trim();
  return loc || '(no cabinet)';
}
const cabRank = (c) => /^CCTV KABIN/.test(c) ? 0 : /^HARICI KABIN/.test(c) ? 1 : /^IT KABIN/.test(c) ? 2 : /^KABIN/.test(c) ? 3 : /^Office/.test(c) ? 4 : c === '(no cabinet)' ? 9 : 5;
const natCmp = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
function cabinetRows(cat, list) {
  const by = new Map();
  list.forEach(s => { const c = cabinetOf(s); if (!by.has(c)) by.set(c, []); by.get(c).push(s); });
  const sortDev = (a, b) => natCmp(a.hostname, b.hostname) || natCmp(a.ip_address, b.ip_address);
  if (by.size < 2) return list.slice().sort(sortDev).map(s => rowHtml(s, true)).join('');
  const cabs = [...by.keys()].sort((a, b) => cabRank(a) - cabRank(b) || natCmp(a, b));
  return cabs.map(c => {
    const devs = by.get(c).sort(sortDev), key = cat + '|' + c, open = sOpenCabs.has(key);
    const sws = [...devs.reduce((m, s) => { const w = String(s.switch_port || '').split(/\s+/)[0]; if (w) m.set(w, (m.get(w) || 0) + 1); return m; }, new Map())].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const st = devs.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m; }, {});
    return `<tr class="sg-grp sg-cab" onclick="toggleSCab(${jsArg(key)})"><td colspan="12">
        <span class="lg-caret">${open ? '▾' : '▸'}</span> <b>${sEsc(c)}</b> <span class="sg-cnt sg-cnt-cab">${devs.length}</span>
        ${sws.length ? `<span class="sg-sw" title="Switch">🔌 ${sws.slice(0, 2).map(sEsc).join(', ')}${sws.length > 2 ? ' …' : ''}</span>` : ''}
        <span class="sg-st">${Object.entries(st).map(([k, n]) => `${statusBadge(k)} ${n}`).join(' ')}</span></td></tr>`
      + (open ? devs.map(s => rowHtml(s, true)).join('') : '');
  }).join('');
}
function toggleSCab(key) { sOpenCabs.has(key) ? sOpenCabs.delete(key) : sOpenCabs.add(key); renderTable(sRows); }
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
      ...(s.it_ot === 'OT' || s.mac || s.switch_port ? [['IT / OT', s.it_ot === 'OT' ? 'OT — Operation Technology' : 'IT'], ['MAC address', s.mac], ['VLAN', s.vlan], ['OT system', s.ot_system], ['Connected to', s.switch_port]] : []),
      ['Network map', s.hostname ? `<a href="/network-map.html?host=${encodeURIComponent(s.hostname)}">🗺 Open ${sEsc(s.hostname)} on the network map</a>` : ''],
    ];
    document.getElementById('view-body').innerHTML = `
      <img class="si-photo" src="/api/servers/${s.id}/photo" alt="" onerror="this.remove()">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fields.map(([l, v]) => `<div><div class="form-label" style="margin-bottom:3px">${l}</div><div style="font-size:13.5px;white-space:pre-line">${v || '<span class="text-muted">—</span>'}</div></div>`).join('')}
      </div>
      <div class="si-maint" style="margin-top:22px;border-top:1px solid var(--border);padding-top:16px">
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
    if ((window.CURRENT_USER || {}).team !== 'OT') loadMaintenance(id);
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
function onAdd() { sFillForm(null); applyFieldLock(null); const ot = (window.CURRENT_USER || {}).team === 'OT'; if (ot) { const c = document.getElementById('f-it_ot'); if (c) c.value = 'OT'; } sOpenModal(ot ? 'Add OT device' : 'Add Server'); }
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
  const me = window.CURRENT_USER || {};
  const it = isIT() || (me.team === 'OT' && s && s.it_ot === 'OT');   // OT editors own the OT devices
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

// OT / IT / All tabs (IT team; the OT team only has its OT devices): they set the IT / OT filter. Last choice remembered.
const SI_IO_KEY = 'si-io';
function setIoTab(io) {
  document.getElementById('filter-itot').value = io;
  document.querySelectorAll('.si-tabs button[data-io]').forEach(b => b.classList.toggle('on', b.dataset.io === io));
}
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(SI_IO_KEY);
  setIoTab(saved === 'OT' || saved === 'IT' || saved === '' ? saved : 'IT');
  document.querySelectorAll('.si-tabs button[data-io]').forEach(b => b.addEventListener('click', () => {
    setIoTab(b.dataset.io); localStorage.setItem(SI_IO_KEY, b.dataset.io); loadServers(1); }));
  document.getElementById('filter-itot').addEventListener('change', (e) => { setIoTab(e.target.value); localStorage.setItem(SI_IO_KEY, e.target.value); });
  notOT().then(ok => { if (!ok) return;
    ['OT', 'IT'].forEach(io => apiGet(`${SAPI}?it_ot=${io}&limit=1`).then(r => { const c = document.getElementById('io-cnt-' + io); if (c && r.total) c.textContent = r.total; }).catch(() => {})); });
  loadFilters().then(loadServers);
  notOT().then(ok => { if (ok) loadSummary(); });

  let debounce;
  document.getElementById('search-input').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => loadServers(1), 320); });
  ['filter-country', 'filter-status', 'filter-category', 'filter-producer', 'filter-itot'].forEach(id => document.getElementById(id).addEventListener('change', () => loadServers(1)));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    ['filter-country', 'filter-status', 'filter-category', 'filter-producer'].forEach(id => document.getElementById(id).value = '');   // the OT / IT / All tab stays
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
  if (window.CURRENT_USER.team === 'IT' && window.CURRENT_USER.role === 'admin') { document.getElementById('btn-otimport').style.display = ''; document.getElementById('btn-portlinks').style.display = ''; document.getElementById('btn-macports').style.display = ''; document.getElementById('btn-camsw').style.display = ''; document.getElementById('btn-cctvimport').style.display = ''; }
  // OT team: read-only list of the OT devices.
  if (window.CURRENT_USER.team === 'OT' && window.CURRENT_USER.role === 'editor') { document.getElementById('btn-portlinks').style.display = ''; document.getElementById('btn-macports').style.display = ''; document.getElementById('btn-camsw').style.display = ''; }
  if (window.CURRENT_USER.team === 'OT') { document.querySelector('.topbar-title').textContent = 'OT devices'; const s = document.querySelector('.si-tabs [data-io=OT]'); if (s) s.textContent = '🏭 OT devices'; setIoTab('OT'); }
  const v = Number(new URLSearchParams(location.search).get('view')); if (v) onView(v);
  const ed = Number(new URLSearchParams(location.search).get('edit')); if (ed) onEdit(ed); /* from ⚠️ OT Needs Attention */ }, 150); });
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

// ── ⚠️ Needs Attention — Servers & Network: Missing Info (js/server-attention.js) ──
// The OT team only reads the OT list: no counters, summary or virtual servers for them.
const notOT = () => new Promise(res => { const t = setInterval(() => { if (!window.CURRENT_USER) return; clearInterval(t); res(window.CURRENT_USER.team !== 'OT'); }, 60); });
async function naCount() { if (!(await notOT())) return; const n = await ServerAttention.count(); const c = document.getElementById('na-cnt'); if (c) c.textContent = n || ''; }
function openMissing() {
  let ov = document.getElementById('na-ov');
  if (!ov) { document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="na-ov"><div class="modal" style="max-width:1150px;background:transparent;box-shadow:none">
      <div style="text-align:right;margin-bottom:6px"><button class="btn btn-ghost btn-sm" style="background:#fff" onclick="document.getElementById('na-ov').classList.remove('open')">✕ Close</button></div>
      <div id="na-b" style="max-height:84vh;overflow:auto"></div></div></div>`); ov = document.getElementById('na-ov'); }
  ov.classList.add('open');
  ServerAttention.panel(document.getElementById('na-b'), { maxHeight: 560, onSaved: (d) => { const c = document.getElementById('na-cnt'); if (c) c.textContent = d.total || ''; loadServers(1); } });
}
document.addEventListener('DOMContentLoaded', () => { setTimeout(() => naCount().catch(() => {}), 800); });
