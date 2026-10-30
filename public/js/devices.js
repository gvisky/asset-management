/* Devices page — Intune + Entra devices linked to people (User Inventory) and
   assets (Asset Inventory). IT admins import the exports and can fill empty
   asset fields from the matching devices. */

const DEV_PAGE = 50;
let devPage = 1;
const dEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dFmt = (n) => Number(n || 0).toLocaleString('en-US');

function devFilters() {
  const v = (id) => document.getElementById(id).value;
  const extra = v('f-extra');
  return {
    search: v('search-input').trim(), country: v('f-country'), os: v('f-os'), source: v('f-source'),
    view: v('f-view') === 'pending' ? 'pending' : '', fresh: v('f-view') === 'fresh' ? '1' : '',
    compliant: v('f-compliant'), asset: v('f-asset'),
    stale: extra === 'stale' ? '1' : '', enabled: extra === 'disabled' ? '0' : '',
    user: extra === 'nouser' ? 'none' : extra === 'user_notin' ? 'notin' : '',
    ownership: extra === 'corp_unlinked' ? 'Corporate' : '',
    ...(extra === 'corp_unlinked' ? { asset: 'unlinked' } : {}),
  };
}
const devQuery = (extra = {}) => new URLSearchParams(Object.entries({ ...devFilters(), ...extra }).filter(([, x]) => x)).toString();

// "2026-10-21T02:32:10Z" → "2026-10-21", flagged when older than 90 days.
function signInCell(v) {
  if (!v) return '<span class="text-muted">never</span>';
  const d = new Date(v);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const txt = String(v).slice(0, 10);
  return days > 90 ? `<span class="badge badge-retired" title="${days} days ago">${txt}</span>` : `<span class="text-sm">${txt}</span>`;
}
function compliantCell(v) {
  if (v === 1) return '<span class="badge badge-active">Yes</span>';
  if (v === 0) return '<span class="badge badge-broken">No</span>';
  return '<span class="text-muted">—</span>';
}

async function loadDevices(page = devPage) {
  devPage = page;
  const tbody = document.getElementById('dev-tbody');
  try {
    const r = await apiGet(`/api/devices?${devQuery({ page, limit: DEV_PAGE })}`);
    document.getElementById('total-label').textContent = `${dFmt(r.total)} devices`;
    r.data.forEach(d => devRows.set(d.id, d));
    devBaseline = r.baseline || null;
    if (!r.data.length) {
      const view = document.getElementById('f-view').value;
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><p>${
        view === 'pending' ? '✅ Nothing to add — every device here is in Asset Inventory and its user is in User Inventory. Choose “All devices” to see them all.'
        : view === 'fresh' ? 'No new devices since the first import.'
        : 'No devices. An IT admin can import the Intune / Entra exports.'}</p></div></td></tr>`;
    } else {
      tbody.innerHTML = r.data.map(d => `
        <tr>
          <td><input type="checkbox" class="dev-sel" data-id="${d.id}"${selected.has(d.id) ? ' checked' : ''}></td>
          <td><strong>${dEsc(d.name || '—')}</strong>${devBaseline && d.first_seen_at && d.first_seen_at > devBaseline ? ' <span class="badge badge-active" style="font-size:10px" title="First seen in an import after the first big import">New</span>' : ''}${d.account_enabled === 0 ? ' <span class="badge badge-broken" title="Disabled in Entra">disabled</span>' : ''}
            <br><span class="text-muted text-sm">${dEsc([d.manufacturer, d.model].filter(Boolean).join(' · ') || '—')}</span></td>
          <td class="text-sm">${dEsc(d.country || 'Unknown')}</td>
          <td class="text-sm">${d.user_upn
            ? `${d.person_id ? `<a href="/user-inventory.html?search=${encodeURIComponent(d.user_upn)}" title="Open in User Inventory">${dEsc(d.user_name || d.user_upn)}</a>` : dEsc(d.user_name || d.user_upn)}
               <br><span class="text-muted">${dEsc(d.user_upn)}</span>`
            : '<span class="text-muted">no user</span>'}
            ${d.user_upn && !d.person_id && isITAdmin() ? `<br><button class="btn btn-ghost btn-sm add-person" data-id="${d.id}" title="Add this user to User Inventory">➕ Add to User Inventory</button>` : ''}</td>
          <td class="text-sm">${dEsc(d.os || '—')}<br><span class="text-muted">${dEsc(d.os_version || '')}</span></td>
          <td class="text-sm">${dEsc(d.serial_no || '—')}</td>
          <td class="text-sm">${d.in_intune ? dEsc(d.managed_by || 'Intune') : '<span class="text-muted">Entra only</span>'}
            ${d.ownership ? `<br><span class="text-muted">${dEsc(d.ownership)}</span>` : ''}</td>
          <td>${compliantCell(d.is_compliant)}</td>
          <td>${signInCell(d.last_sign_in)}</td>
          <td class="text-sm">${d.asset_id
            ? `<a href="/inventory.html?edit=${d.asset_id}" title="Open the asset">${dEsc(d.asset_s4 || d.asset_code || d.asset_computer_no || '#' + d.asset_id)}</a>`
            : (canEdit() ? `<button class="btn btn-ghost btn-sm add-asset" data-id="${d.id}" title="Add this device to Asset Inventory">➕ Add</button>` : '<span class="text-muted">—</span>')}</td>
        </tr>`).join('');
      tbody.querySelectorAll('.dev-sel').forEach(cb => cb.addEventListener('change', () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selected.add(id); else selected.delete(id);
        renderBulkBar();
      }));
      tbody.querySelectorAll('.add-asset').forEach(b => b.addEventListener('click', () => openAddAssets([Number(b.dataset.id)])));
      tbody.querySelectorAll('.add-person').forEach(b => b.addEventListener('click', () => openAddPeople([Number(b.dataset.id)])));
    }
    document.getElementById('sel-page').checked = r.data.length > 0 && r.data.every(d => selected.has(d.id));
    renderDevPagination(r.total, r.page, r.limit);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Could not load devices.</td></tr>';
  }
}

function renderDevPagination(total, page, limit) {
  const pages = Math.ceil(total / limit);
  const from = total ? (page - 1) * limit + 1 : 0, to = Math.min(page * limit, total);
  document.getElementById('page-info').textContent = total ? `Showing ${dFmt(from)}–${dFmt(to)} of ${dFmt(total)}` : '';
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  const btn = (p, label, dis, act) => `<button class="page-btn${act ? ' active' : ''}" ${dis ? 'disabled' : ''} data-p="${p}">${label}</button>`;
  let html = btn(page - 1, '‹', page <= 1);
  const lo = Math.max(1, page - 2), hi = Math.min(pages, page + 2);
  if (lo > 1) html += btn(1, '1') + (lo > 2 ? '<span class="text-muted">…</span>' : '');
  for (let p = lo; p <= hi; p++) html += btn(p, p, false, p === page);
  if (hi < pages) html += (hi < pages - 1 ? '<span class="text-muted">…</span>' : '') + btn(pages, pages);
  html += btn(page + 1, '›', page >= pages);
  el.innerHTML = html;
  el.querySelectorAll('.page-btn').forEach(b => b.addEventListener('click', () => loadDevices(Number(b.dataset.p))));
}

// Tiles follow the same filters as the table; clicking one applies its filter.
async function loadDevStats() {
  try {
    const s = await apiGet(`/api/devices/stats?${devQuery()}`);
    const pct = (n) => (s.total ? `${((n / s.total) * 100).toFixed(0)}% of ${dFmt(s.total)}` : '—');
    const tiles = [
      { label: 'Devices', color: '#1a56db', value: s.total, sub: `<b>${dFmt(s.intune)}</b> managed in Intune`, act: () => setExtra('', '') },
      { label: 'Compliant', color: '#16a34a', value: s.compliant, sub: pct(s.compliant), act: () => setSel('f-compliant', '1') },
      { label: 'Not compliant', color: '#dc2626', value: s.notCompliant, sub: pct(s.notCompliant), act: () => setSel('f-compliant', '0') },
      { label: `No sign-in ${s.staleDays}+ days`, color: '#d97706', value: s.stale, sub: 'possibly unused / lost', act: () => setExtra('stale') },
      { label: 'Company devices not in Asset Inventory', color: '#7c3aed', value: s.corpNotInAssets, sub: `${dFmt(s.linkedAsset)} devices already linked to an asset`, act: () => setExtra('corp_unlinked') },
      { label: 'Users not in User Inventory', color: '#6b7280', value: s.ownersNotInPeople, sub: `${dFmt(s.noUser)} devices have no user`, act: () => setExtra('user_notin') },
    ];
    const grid = document.getElementById('dev-tiles');
    grid.innerHTML = tiles.map((t, i) => `<div class="kpi" style="--kpi-color:${t.color}">
        <a class="kpi-main" href="#" data-i="${i}"><div class="kpi-label"><span class="kpi-dot"></span>${dEsc(t.label)}</div>
        <div class="kpi-value">${dFmt(t.value)}</div></a>
        <div class="kpi-sub kpi-note">${t.sub}</div></div>`).join('');
    grid.querySelectorAll('.kpi-main').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); tiles[Number(a.dataset.i)].act(); }));

    // OS / country dropdowns from the data (keep the current choice).
    const fill = (id, items, label, allText) => {
      const sel = document.getElementById(id), cur = sel.value;
      sel.innerHTML = `<option value="">${allText}</option>` + items.map(x => `<option value="${dEsc(x.v)}">${dEsc(x.t)}</option>`).join('');
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    };
    // Dropdown options come from ALL devices (not the current view), so a country stays
    // pickable even when nothing is left to add there.
    const needOpts = !document.getElementById('f-os').dataset.filled || !document.getElementById('f-country').dataset.filled;
    const full = needOpts ? await apiGet('/api/devices/stats') : null;
    if (!document.getElementById('f-os').dataset.filled) {
      fill('f-os', full.byOs.filter(x => x.os).map(x => ({ v: x.os, t: `${x.os} (${dFmt(x.count)})` })), 'OS', 'All OS');
      document.getElementById('f-os').dataset.filled = '1';
    }
    if (!document.getElementById('f-country').dataset.filled) {
      const items = full.byCountry.map(x => ({ v: x.country || '__none', t: `${x.country || 'Unknown'} (${dFmt(x.count)})` }));
      fill('f-country', items, 'Country', 'All countries');
      document.getElementById('f-country').dataset.filled = '1';
      if (mySingleCountry()) document.getElementById('f-country').style.display = 'none';
    }
    document.getElementById('last-import').textContent = s.lastImport
      ? `Last import: ${s.lastImport} UTC` : 'No import yet — an IT admin can upload the Intune / Entra exports.';
    document.getElementById('btn-import').style.display = s.canImport ? '' : 'none';
    document.getElementById('btn-fill').style.display = s.canImport ? '' : 'none';
    const addAll = document.getElementById('btn-addall');
    addAll.style.display = canEdit() && s.addableAll ? '' : 'none';
    addAll.textContent = `➕ Add all to Asset Inventory (${dFmt(s.addableAll)})`;
    addAll.dataset.all = s.addableAll; addAll.dataset.corp = s.addableCorporate;
  } catch (e) { /* ignore */ }
}

// ── Selection + adding to Asset Inventory / User Inventory ──────────────────
const selected = new Set();
let devBaseline = null;      // first big import — devices first seen later are "New"
const devRows = new Map();   // id → last loaded row (for the bulk actions)
function renderBulkBar() {
  const bar = document.getElementById('bulk-bar');
  bar.hidden = !selected.size;
  document.getElementById('bulk-count').textContent = `${dFmt(selected.size)} selected`;
  document.getElementById('bulk-assets').style.display = canEdit() ? '' : 'none';
  document.getElementById('bulk-people').style.display = isITAdmin() ? '' : 'none';
}

const ASSET_TYPES = ['Laptop', 'Desktop', 'Mobile phone', 'Tablet', 'Hand terminals', 'IP phone', 'Screen', 'Printer'];
const SITE_C = 'Vietnam', CORE_C = ['Vietnam', 'Thailand', 'Malaysia'];
const opt = (v, cur, label) => `<option value="${dEsc(v)}"${v === cur ? ' selected' : ''}>${dEsc(label == null ? v : label)}</option>`;

// Mirrors lib/device-to-asset.js assetMissing().
function assetMissing(a) {
  const m = [], e = (v) => !String(v || '').trim();
  if (e(a.asset_code)) m.push('Asset code');
  if (e(a.asset_s4)) m.push('Asset S/4');
  if (a.country === SITE_C && e(a.location)) m.push('Location');
  if (CORE_C.includes(a.country) && e(a.department)) m.push('Department');
  if (e(a.serial_no)) m.push('Serial');
  if (e(a.asset_type)) m.push('Asset type');
  if (e(a.country)) m.push('Country');
  if (['laptop', 'desktop'].includes(String(a.asset_type).toLowerCase())) {
    if (e(a.computer_no)) m.push('PC No');
    if (e(a.ad_name)) m.push('AD Name');
  }
  m.push('Purchase date');
  return m;
}

async function openAddAssets(ids) {
  const overlay = document.getElementById('addasset-overlay');
  const body = document.getElementById('addasset-body');
  const go = document.getElementById('addasset-go');
  overlay.classList.add('open'); body.innerHTML = 'Loading…'; go.disabled = true;
  try {
    const [{ proposals, existing }, { countries }, filters] = await Promise.all([
      apiGet(`/api/devices/proposals?ids=${ids.join(',')}`), getCountries(), apiGet('/api/assets/filters')]);
    const depts = filters.departments || [];
    if (!proposals.length) {
      body.innerHTML = `<p>${existing.length ? `All selected devices are already in Asset Inventory.` : 'Nothing to add.'}</p>`;
      document.getElementById('addasset-note').textContent = '';
      return;
    }
    body.innerHTML = `
      <p class="text-sm" style="margin-top:0">Filled from Intune / Entra: <b>Computer No, Serial, Brand / Model, Asset Type, Country, User Name, AD Name</b>.
        Brand / Model marked ★ is taken from your existing assets with the same model. The exports have <b>no</b> Asset code, Asset S/4,
        Location (Office / Factory), Department / Cost center or Purchase date — fill them here or later (they will show in <b>Needs Attention</b>).
        ${existing.length ? `<br>${existing.length} selected device(s) are already in Asset Inventory and are skipped.` : ''}</p>
      <datalist id="dept-list">${depts.map(d => `<option value="${dEsc(d)}">`).join('')}</datalist>
      <div class="apply-all">
        <b style="align-self:center">Apply to all:</b>
        <label>Asset type<select class="form-control" id="all-type"><option value="">—</option>${ASSET_TYPES.map(t => opt(t, '')).join('')}</select></label>
        <label>Location (Vietnam)<select class="form-control" id="all-location"><option value="">—</option>${opt('Office', '')}${opt('Factory', '')}</select></label>
        <label>Department<input class="form-control" id="all-dept" list="dept-list" placeholder="—"></label>
        <label>Status<select class="form-control" id="all-status"><option value="">—</option>${['Active', 'Stock', 'Broken'].map(x => opt(x, '')).join('')}</select></label>
        <button type="button" class="btn btn-ghost btn-sm" id="all-apply">Apply</button>
      </div>
      <div class="table-wrap" style="max-height:56vh;overflow:auto"><table class="add-table">
        <thead><tr><th><input type="checkbox" id="add-all-cb" checked></th><th>Device</th><th style="min-width:150px">Still missing</th><th>Asset type</th><th>Brand / Model</th><th>Computer No</th><th>Serial</th>
          <th>Country</th><th>Location</th><th>Department</th><th>User Name</th><th>AD Name</th><th>Asset code</th><th>Asset S/4</th><th>Status</th></tr></thead>
        <tbody>${proposals.map(p => {
          const personal = p.ownership === 'Personal';
          return `<tr data-device="${p.device_id}" class="${personal ? 'excluded' : ''}">
            <td><input type="checkbox" class="inc"${personal ? '' : ' checked'}></td>
            <td class="text-sm"><b>${dEsc(p.computer_no || '—')}</b>${personal ? '<br><span class="badge badge-retired" title="Personal (BYOD) device — usually not a company asset">Personal</span>' : (p.ownership ? `<br><span class="text-muted">${dEsc(p.ownership)}</span>` : '')}</td>
            <td class="missing"></td>
            <td><select class="form-control" data-f="asset_type"><option value="">—</option>${[...new Set([...ASSET_TYPES, p.asset_type].filter(Boolean))].map(t => opt(t, p.asset_type)).join('')}</select></td>
            <td><input class="form-control w-lg" data-f="brand_model" value="${dEsc(p.brand_model)}" title="${p.learned_name ? 'From your existing assets with this model' : 'From Intune (manufacturer + model)'}">${p.learned_name ? ' <span title="From your existing assets">★</span>' : ''}</td>
            <td><input class="form-control" data-f="computer_no" value="${dEsc(p.computer_no)}"></td>
            <td><input class="form-control" data-f="serial_no" value="${dEsc(p.serial_no)}"></td>
            <td><select class="form-control" data-f="country"><option value="">—</option>${countries.map(c => opt(c, p.country)).join('')}</select></td>
            <td><select class="form-control" data-f="location"><option value="">—</option>${opt('Office', p.location)}${opt('Factory', p.location)}</select></td>
            <td><input class="form-control w-lg" data-f="department" list="dept-list" value="${dEsc(p.department)}"></td>
            <td><input class="form-control w-lg" data-f="user_name" value="${dEsc(p.user_name)}"></td>
            <td><input class="form-control" data-f="ad_name" value="${dEsc(p.ad_name)}"></td>
            <td><input class="form-control" data-f="asset_code" value=""></td>
            <td><input class="form-control" data-f="asset_s4" value=""></td>
            <td><select class="form-control" data-f="status">${['Active', 'Stock', 'Broken'].map(x => opt(x, p.status)).join('')}</select></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;

    const rows = () => [...body.querySelectorAll('tbody tr')];
    const read = (tr) => { const o = { device_id: Number(tr.dataset.device) }; tr.querySelectorAll('[data-f]').forEach(el => { o[el.dataset.f] = el.value.trim(); }); return o; };
    const refreshRow = (tr) => {
      const a = read(tr);
      const loc = tr.querySelector('[data-f="location"]');
      loc.disabled = a.country !== SITE_C; if (loc.disabled) loc.value = '';
      tr.querySelector('.missing').innerHTML = assetMissing(read(tr)).map(m => `<span class="miss-tag">${m}</span>`).join('');
      tr.classList.toggle('excluded', !tr.querySelector('.inc').checked);
    };
    const refreshNote = () => {
      const n = rows().filter(tr => tr.querySelector('.inc').checked).length;
      go.disabled = !n; go.textContent = `Add ${n} asset${n === 1 ? '' : 's'}`;
      document.getElementById('addasset-note').textContent = 'Personal (BYOD) devices are unticked by default.';
    };
    rows().forEach(tr => { refreshRow(tr); tr.addEventListener('input', () => { refreshRow(tr); refreshNote(); }); tr.addEventListener('change', () => { refreshRow(tr); refreshNote(); }); });
    document.getElementById('add-all-cb').addEventListener('change', (e) => { rows().forEach(tr => { tr.querySelector('.inc').checked = e.target.checked; refreshRow(tr); }); refreshNote(); });
    document.getElementById('all-apply').addEventListener('click', () => {
      const v = (id) => document.getElementById(id).value.trim();
      rows().filter(tr => tr.querySelector('.inc').checked).forEach(tr => {
        if (v('all-type')) tr.querySelector('[data-f="asset_type"]').value = v('all-type');
        if (v('all-location') && tr.querySelector('[data-f="country"]').value === SITE_C) tr.querySelector('[data-f="location"]').value = v('all-location');
        if (v('all-dept')) tr.querySelector('[data-f="department"]').value = v('all-dept');
        if (v('all-status')) tr.querySelector('[data-f="status"]').value = v('all-status');
        refreshRow(tr);
      });
    });
    refreshNote();
    go.onclick = async () => {
      const items = rows().filter(tr => tr.querySelector('.inc').checked).map(read);
      if (items.some(i => !i.country)) { showToast('Pick a country for every device', 'error'); return; }
      go.disabled = true;
      try {
        const r = await apiPost('/api/devices/to-assets', { items });
        const sk = r.skipped.length ? ` · ${r.skipped.length} skipped (${[...new Set(r.skipped.map(x => x.reason))].join('; ')})` : '';
        showToast(`Added ${r.created.length} asset(s) to Asset Inventory${sk}`, r.created.length ? 'success' : 'error');
        overlay.classList.remove('open');
        items.forEach(i => selected.delete(i.device_id)); renderBulkBar(); refresh();
      } catch (err) { let m = 'Could not add'; try { m = JSON.parse(err.message).error || m; } catch {} showToast(m, 'error'); go.disabled = false; }
    };
  } catch (e) { body.innerHTML = 'Could not load the selected devices.'; }
}

function personMissing(p) {
  const m = [];
  if (!p.country) m.push('Country');
  m.push('User Type (HR)');
  if (p.country === SITE_C) m.push('Department / Cost center');
  if (!p.company_name) m.push('Company');
  if (!p.position) m.push('Position');
  return m;
}

async function openAddPeople(ids) {
  const overlay = document.getElementById('addpeople-overlay');
  const body = document.getElementById('addpeople-body');
  const go = document.getElementById('addpeople-go');
  overlay.classList.add('open'); body.innerHTML = 'Loading…'; go.disabled = true;
  try {
    const [{ owners }, { countries }] = await Promise.all([apiGet(`/api/devices/owners?ids=${ids.join(',')}`), getCountries()]);
    if (!owners.length) { body.innerHTML = '<p>The users of the selected devices are already in User Inventory (or the devices have no user).</p>'; return; }
    body.innerHTML = `
      <p class="text-sm" style="margin-top:0">These device users are not in User Inventory — usually because they are not in the Azure users export
        (external / guest accounts, or no country / company in Azure). From the device we know the <b>email</b> and <b>name</b>.
        Pick the <b>Country</b>; User Type, Leaving Date and Department / Cost center are set later in User Inventory.</p>
      <div class="table-wrap" style="max-height:56vh;overflow:auto"><table class="add-table">
        <thead><tr><th><input type="checkbox" id="addp-all" checked></th><th>Display name</th><th>Email</th><th>Country *</th><th>Company</th><th>Position</th><th>Devices</th><th>Still missing</th></tr></thead>
        <tbody>${owners.map(o => `<tr data-email="${dEsc(o.email)}">
          <td><input type="checkbox" class="inc" checked></td>
          <td><input class="form-control w-lg" data-f="display_name" value="${dEsc(o.display_name)}"></td>
          <td class="text-sm">${dEsc(o.email)}</td>
          <td><select class="form-control" data-f="country"><option value="">— pick —</option>${countries.map(c => opt(c, o.country)).join('')}</select></td>
          <td><input class="form-control w-lg" data-f="company_name" value=""></td>
          <td><input class="form-control" data-f="position" value=""></td>
          <td class="text-sm">${o.devices.map(dEsc).join('<br>')}</td>
          <td class="missing"></td></tr>`).join('')}</tbody></table></div>`;
    const rows = () => [...body.querySelectorAll('tbody tr')];
    const read = (tr) => { const o = { email: tr.dataset.email }; tr.querySelectorAll('[data-f]').forEach(el => { o[el.dataset.f] = el.value.trim(); }); return o; };
    const refreshRow = (tr) => {
      tr.querySelector('.missing').innerHTML = personMissing(read(tr)).map(m => `<span class="miss-tag">${m}</span>`).join('');
      tr.classList.toggle('excluded', !tr.querySelector('.inc').checked);
    };
    const refreshNote = () => { const n = rows().filter(tr => tr.querySelector('.inc').checked).length; go.disabled = !n; go.textContent = `Add ${n} user${n === 1 ? '' : 's'}`; };
    rows().forEach(tr => { refreshRow(tr); ['input', 'change'].forEach(ev => tr.addEventListener(ev, () => { refreshRow(tr); refreshNote(); })); });
    document.getElementById('addp-all').addEventListener('change', (e) => { rows().forEach(tr => { tr.querySelector('.inc').checked = e.target.checked; refreshRow(tr); }); refreshNote(); });
    refreshNote();
    go.onclick = async () => {
      const items = rows().filter(tr => tr.querySelector('.inc').checked).map(read);
      if (items.some(i => !i.country)) { showToast('Pick a country for every user', 'error'); return; }
      go.disabled = true;
      try {
        const r = await apiPost('/api/devices/to-people', { items });
        const sk = r.skipped.length ? ` · ${r.skipped.length} skipped (${[...new Set(r.skipped.map(x => x.reason))].join('; ')})` : '';
        showToast(`Added ${r.created.length} user(s) to User Inventory${sk}`, r.created.length ? 'success' : 'error');
        overlay.classList.remove('open');
        ids.forEach(id => selected.delete(id)); renderBulkBar(); refresh();
      } catch (err) { let m = 'Could not add'; try { m = JSON.parse(err.message).error || m; } catch {} showToast(m, 'error'); go.disabled = false; }
    };
  } catch (e) { body.innerHTML = 'Could not load the selected devices.'; }
}

// ── Add ALL devices of a known country (within the current filters), in chunks ──
function setupAddAll() {
  const overlay = document.getElementById('addall-overlay');
  const body = document.getElementById('addall-body');
  const go = document.getElementById('addall-go');
  let running = false;
  const close = () => { if (!running) overlay.classList.remove('open'); };
  document.getElementById('addall-close').addEventListener('click', close);
  document.getElementById('addall-cancel').addEventListener('click', close);
  document.getElementById('btn-addall').addEventListener('click', () => {
    const btn = document.getElementById('btn-addall');
    const all = Number(btn.dataset.all || 0), corp = Number(btn.dataset.corp || 0);
    const f = devFilters();
    const scope = [f.country && f.country !== '__none' ? f.country : 'all countries', f.os, f.search && `“${f.search}”`].filter(Boolean).join(' · ');
    body.innerHTML = `
      <p style="margin-top:0">Adds every device that has a <b>country</b> and is <b>not yet in Asset Inventory</b> (current filters: ${dEsc(scope)}).
        Devices with no country (Unknown) are not included — pick their country with ➕ Add.</p>
      <p class="text-sm">Filled automatically: Computer No, Serial, Brand / Model (★ learned from your assets), Asset Type, Country, User Name, AD Name, Status Active.
        <b>Asset code, Asset S/4, Location (Office/Factory) and Department</b> stay empty — they will appear in <b>Needs Attention</b>.
        Devices that already match an asset (same Computer No / Serial) are only linked, not added again.</p>
      <label class="text-sm" style="display:flex;gap:8px;align-items:center;margin:10px 0">
        <input type="checkbox" id="addall-personal" checked> Include personal (BYOD) devices
        <span class="text-muted">— <span id="addall-count"></span></span></label>
      <div id="addall-progress" class="text-sm"></div>`;
    const cb = document.getElementById('addall-personal');
    const upd = () => { const n = cb.checked ? all : corp; document.getElementById('addall-count').textContent = `${dFmt(n)} devices`; go.textContent = `Add ${dFmt(n)} devices`; go.disabled = !n; };
    cb.addEventListener('change', upd); upd();
    overlay.classList.add('open');
  });
  go.addEventListener('click', async () => {
    const prog = document.getElementById('addall-progress');
    const include_personal = document.getElementById('addall-personal').checked;
    const total = Number(include_personal ? document.getElementById('btn-addall').dataset.all : document.getElementById('btn-addall').dataset.corp) || 1;
    running = true; go.disabled = true;
    let created = 0, linked = 0, rounds = 0;
    try {
      for (;;) {
        const r = await apiPost('/api/devices/to-assets-all', { ...devFilters(), include_personal, limit: 500 });
        created += r.created; linked += r.linked; rounds++;
        const done = Math.min(total, created + linked);
        prog.innerHTML = `<div style="background:#eef0f4;border-radius:6px;height:10px;overflow:hidden;margin:6px 0">
            <div style="width:${Math.round((done / total) * 100)}%;height:100%;background:#1a56db"></div></div>
          ${dFmt(created)} added, ${dFmt(linked)} linked to existing assets · ${dFmt(r.remaining)} remaining`;
        if (!r.remaining) break;
        if (!r.processed || (r.created + r.linked) === 0 || rounds > 100) { prog.innerHTML += '<br>⚠ Stopped: some devices could not be added — try again or add them one by one.'; break; }
      }
      showToast(`Added ${dFmt(created)} devices to Asset Inventory`);
    } catch (err) {
      let m = 'Could not add'; try { m = JSON.parse(err.message).error || m; } catch {}
      prog.innerHTML += `<br>❌ ${dEsc(m)} — ${dFmt(created)} added so far; click Add again to continue.`;
      go.disabled = false;
    }
    running = false;
    refresh();
  });
}

function setupAdd() {
  document.getElementById('sel-page').addEventListener('change', (e) => {
    document.querySelectorAll('#dev-tbody .dev-sel').forEach(cb => {
      cb.checked = e.target.checked;
      const id = Number(cb.dataset.id);
      if (cb.checked) selected.add(id); else selected.delete(id);
    });
    renderBulkBar();
  });
  document.getElementById('bulk-assets').addEventListener('click', () => openAddAssets([...selected]));
  document.getElementById('bulk-people').addEventListener('click', () => openAddPeople([...selected]));
  document.getElementById('bulk-clear').addEventListener('click', () => {
    selected.clear(); document.querySelectorAll('#dev-tbody .dev-sel').forEach(cb => { cb.checked = false; });
    document.getElementById('sel-page').checked = false; renderBulkBar();
  });
  for (const k of ['addasset', 'addpeople']) {
    const close = () => document.getElementById(`${k}-overlay`).classList.remove('open');
    document.getElementById(`${k}-close`).addEventListener('click', close);
    document.getElementById(`${k}-cancel`).addEventListener('click', close);
  }
}

function setSel(id, v) { document.getElementById(id).value = v; refresh(); }
function setExtra(v) { document.getElementById('f-extra').value = v; refresh(); }
function refresh() { loadDevices(1); loadDevStats(); }

// ── Import: read the chosen CSVs as text and send them together ──────────────
function setupImport() {
  const overlay = document.getElementById('import-overlay');
  const input = document.getElementById('import-files');
  const go = document.getElementById('import-go');
  const result = document.getElementById('import-result');
  const close = () => overlay.classList.remove('open');
  document.getElementById('btn-import').addEventListener('click', () => { result.innerHTML = ''; overlay.classList.add('open'); });
  document.getElementById('import-close').addEventListener('click', close);
  document.getElementById('import-cancel').addEventListener('click', close);
  input.addEventListener('change', () => {
    const files = [...input.files];
    document.getElementById('import-picked').innerHTML = files.map(f => `📄 ${dEsc(f.name)} <span class="text-muted">(${(f.size / 1048576).toFixed(1)} MB)</span>`).join('<br>');
    go.disabled = !files.length || files.length > 3;
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    result.innerHTML = '⏳ Importing… (can take a minute for large files)';
    try {
      const texts = await Promise.all([...input.files].map(f => f.text()));
      const r = await apiPost('/api/devices/import', { files: texts });
      result.innerHTML = `✅ Done (${dEsc(r.files.join(', '))}).<br>`
        + (r.files.includes('azure') ? `People: <b>${dFmt(r.added)}</b> new, ${dFmt(r.updated)} refreshed, ${dFmt(r.preserved)} kept (edited); skipped ${dFmt(r.skippedGuests)} guests + ${dFmt(r.skippedNoCountry)} service accounts. ${r.notInExport ? `<b>${dFmt(r.notInExport)}</b> people in User Inventory are not in this export.` : ''}<br>` : '')
        + (r.files.includes('intune') || r.files.includes('entra') ? `Devices: <b>${dFmt(r.devices)}</b> (${dFmt(r.linkedIntuneEntra)} Intune ⇄ Entra matched), ${dFmt(r.linkedPeople)} linked to a person, ${dFmt(r.linkedAssets)} linked to an asset.` : '');
      showToast('Import finished');
      document.getElementById('f-os').dataset.filled = ''; document.getElementById('f-country').dataset.filled = '';
      refresh();
    } catch (err) {
      let msg = 'Import failed';
      try { msg = JSON.parse(err.message).error || msg; } catch {}
      result.innerHTML = `❌ ${dEsc(msg)}`;
    }
    go.disabled = false;
  });
}

// ── Fill empty asset fields from the linked devices (preview, then apply) ─────
function setupFill() {
  const overlay = document.getElementById('fill-overlay');
  const body = document.getElementById('fill-body');
  const go = document.getElementById('fill-go');
  const close = () => overlay.classList.remove('open');
  const LABEL = { serial_no: 'Serial', computer_no: 'Computer No', ad_name: 'AD Name', user_name: 'User Name' };
  const show = (r) => {
    if (!r.assets) { body.innerHTML = '<p>Nothing to fill — linked assets already have these fields.</p>'; go.disabled = true; return; }
    body.innerHTML = `<p class="text-sm" style="margin-top:0">${r.applied ? '✅ Filled' : 'Will fill'} <b>${dFmt(r.assets)}</b> assets — only fields that are <b>empty</b> on the asset are filled; nothing is overwritten. Each change is written to the asset's History Usage.</p>
      <p class="text-sm">${Object.entries(r.fields).filter(([, n]) => n).map(([k, n]) => `${LABEL[k]}: <b>${dFmt(n)}</b>`).join(' · ')}</p>
      <div class="table-wrap" style="max-height:360px;overflow-y:auto"><table>
        <thead><tr><th>Asset</th><th>Country</th><th>Device</th><th>Will set</th></tr></thead>
        <tbody>${r.sample.map(c => `<tr><td><a href="/inventory.html?edit=${c.id}">${dEsc(c.label)}</a></td><td class="text-sm">${dEsc(c.country)}</td>
          <td class="text-sm">${dEsc(c.device)}</td>
          <td class="text-sm">${Object.entries(c.set).map(([k, v]) => `${LABEL[k]}: <b>${dEsc(v)}</b>`).join('<br>')}</td></tr>`).join('')}</tbody>
      </table></div>${r.assets > r.sample.length ? `<p class="text-muted text-sm">Showing the first ${r.sample.length}.</p>` : ''}`;
    go.disabled = r.applied;
  };
  document.getElementById('btn-fill').addEventListener('click', async () => {
    overlay.classList.add('open'); body.innerHTML = 'Loading…'; go.disabled = true;
    try { show(await apiGet('/api/devices/asset-fill')); } catch (e) { body.innerHTML = 'Could not load.'; }
  });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { show(await apiPost('/api/devices/asset-fill', {})); showToast('Assets filled from Intune'); }
    catch (err) { let m = 'Could not fill'; try { m = JSON.parse(err.message).error || m; } catch {} showToast(m, 'error'); go.disabled = false; }
  });
  document.getElementById('fill-close').addEventListener('click', close);
  document.getElementById('fill-cancel').addEventListener('click', close);
}

document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(window.location.search);
  if (p.get('search')) {
    // Opened from User Inventory (a person's devices) → show all their devices, added or not.
    document.getElementById('search-input').value = p.get('search');
    document.getElementById('f-view').value = '';
  }
  refresh();
  setupImport();
  setupFill();
  setupAdd();
  setupAddAll();
  if (typeof loadAlertButton === 'function') loadAlertButton('alert-btn-slot', '');
  let t;
  document.getElementById('search-input').addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 320); });
  ['f-view', 'f-country', 'f-os', 'f-source', 'f-compliant', 'f-asset', 'f-extra'].forEach(id =>
    document.getElementById(id).addEventListener('change', refresh));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    ['f-country', 'f-os', 'f-source', 'f-compliant', 'f-asset', 'f-extra'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('f-view').value = 'pending';
    refresh();
  });
});
