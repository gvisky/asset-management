/* Maintenance & Repairs page logic */

const MBADGE = { open: 'badge-broken', in_progress: 'badge-retired', done: 'badge-active' };
const mLabel = (s) => ({ open: 'Open', in_progress: 'In progress', done: 'Done' }[s] || s);
const mEsc   = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadCountries() {
  try {
    const { countries } = await apiGet('/api/assets/filters');
    const sel = document.getElementById('filter-country');
    sel.innerHTML = '<option value="">All Countries</option>' +
      countries.map(c => `<option>${mEsc(c)}</option>`).join('');
  } catch (e) { /* non-fatal */ }
}

async function loadMaint() {
  const tbody = document.getElementById('maint-tbody');
  const status  = document.getElementById('filter-status').value;
  const country = document.getElementById('filter-country').value;
  const type    = document.getElementById('filter-type').value;
  const qs = new URLSearchParams();
  if (status)  qs.set('status', status);
  if (country) qs.set('country', country);
  if (type)    qs.set('asset_type', type);

  try {
    const rows = await apiGet('/api/maintenance' + (qs.toString() ? `?${qs}` : ''));
    document.getElementById('total-label').textContent =
      rows.length ? `${rows.length} record(s)` : '';

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No maintenance records.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(m => {
      const isServer = m.asset_type === 'server';
      const label = m.item_label || `#${m.asset_id}`;
      const href = (isServer ? '/server-inventory.html' : '/inventory.html') + `?search=${encodeURIComponent(label)}`;
      const typeBadge = `<span class="badge ${isServer ? 'badge-office' : 'badge-factory'}">${isServer ? 'Server' : 'Asset'}</span>`;
      return `
      <tr>
        <td>${typeBadge} <a href="${href}" style="color:var(--brand)">${mEsc(label)}</a>
            <div class="text-muted text-sm">${mEsc(m.location || '')}</div></td>
        <td>${mEsc(m.type)}</td>
        <td>${mEsc(m.description)}</td>
        <td class="text-muted text-sm">${mEsc(m.vendor) || '—'}</td>
        <td class="text-muted text-sm">${mEsc(m.cost) || '—'}</td>
        <td class="text-muted text-sm">${mEsc(m.reported_at)}<div class="text-muted text-sm">${mEsc(m.reported_by)}</div></td>
        <td><span class="badge ${MBADGE[m.status] || ''}">${mLabel(m.status)}</span></td>
        <td>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="form-control maint-edit" style="max-width:130px;padding:4px 8px" onchange="onStatus(${m.id}, this.value)">
              ${['open','in_progress','done'].map(s => `<option value="${s}" ${s === m.status ? 'selected' : ''}>${mLabel(s)}</option>`).join('')}
            </select>
            <button class="btn btn-danger btn-sm" onclick="onDelete(${m.id})" title="Delete">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load.</td></tr>';
  }
}

async function onStatus(id, status) {
  try { await apiPut(`/api/maintenance/${id}`, { status }); showToast('Updated'); loadMaint(); }
  catch (e) { showToast('Update failed', 'error'); }
}

async function onDelete(id) {
  if (!confirm('Delete this maintenance record?')) return;
  try { await apiDelete(`/api/maintenance/${id}`); showToast('Deleted'); loadMaint(); }
  catch (e) { showToast('Delete failed (admin only)', 'error'); }
}

// ── Log Maintenance modal (pick an asset or server, then record) ───────────────
function openAdd() {
  ['m-search', 'm-desc', 'm-vendor', 'm-cost'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('m-item').innerHTML = '<option value="">Type in “Find item” above…</option>';
  document.getElementById('add-overlay').classList.add('open');
  searchItems();
}
function closeAdd() { document.getElementById('add-overlay').classList.remove('open'); }

async function searchItems() {
  const type = document.getElementById('m-type').value;
  const q = document.getElementById('m-search').value.trim();
  const base = type === 'server' ? '/api/servers' : '/api/assets';
  try {
    const res = await apiGet(`${base}?limit=25${q ? '&search=' + encodeURIComponent(q) : ''}`);
    const items = res.data || [];
    const sel = document.getElementById('m-item');
    sel.innerHTML = '<option value="">Select…</option>' + items.map(it => {
      const label = type === 'server' ? (it.hostname || it.asset_code || ('#' + it.id))
                                       : (it.asset_code || it.brand_model || ('#' + it.id));
      const sub = it.brand_model && it.brand_model !== label ? ' — ' + it.brand_model : '';
      return `<option value="${it.id}">${mEsc(label + sub)}</option>`;
    }).join('');
  } catch (e) { /* non-fatal */ }
}

async function onAddSave() {
  const asset_type = document.getElementById('m-type').value;
  const asset_id = document.getElementById('m-item').value;
  const description = document.getElementById('m-desc').value.trim();
  if (!asset_id) { showToast('Pick an item', 'error'); return; }
  if (!description) { showToast('Enter a description', 'error'); return; }
  try {
    await apiPost('/api/maintenance', {
      asset_type, asset_id: Number(asset_id),
      type: document.getElementById('m-mtype').value,
      status: document.getElementById('m-status').value,
      description,
      vendor: document.getElementById('m-vendor').value.trim(),
      cost: document.getElementById('m-cost').value.trim(),
    });
    showToast('Maintenance logged');
    closeAdd();
    loadMaint();
  } catch (e) { showToast('Failed to log maintenance', 'error'); }
}

// ── Broken & Stock devices + spare parts ─────────────────────────────────────
const COND = { total: ['Total broken', 'badge-broken'], parts: ['Usable parts', 'badge-active'], none_left: ['No usable part left', 'badge-retired'], unchecked: ['Parts not checked', 'badge-retired'] };
const PSTATE = { ok: ['✓', '#16a34a', 'usable'], bad: ['✗', '#dc2626', 'broken'], used: ['↪', '#6b7280', 'used as spare'], '': ['?', '#9ca3af', 'not checked'] };
let bsData = null;
const bsF = { search: '', status: '', type: '', country: '', cond: '' };
function yrs(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); if (!m) return '';
  const y = (Date.now() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / (365.25 * 86400000);
  return y >= 0 ? `${y.toFixed(1)} yrs` : '';
}
async function loadBroken() {
  try {
    bsData = await apiGet('/api/maintenance/devices');
    renderBroken();
  } catch (e) { document.getElementById('bs-tbody').innerHTML = '<tr><td colspan="9" class="empty-state">Could not load.</td></tr>'; }
  loadSpares();
}
function renderBroken() {
  const { data, parts, summary } = bsData;
  document.getElementById('bs-total').textContent = `· ${data.length} device${data.length === 1 ? '' : 's'}`;
  // Summary chart — all Broken & Stock devices, whatever the filters (click a bar to filter the list).
  const bars = (title, kind, obj, label = (k) => k) => {
    const entries = Object.entries(obj).filter(([k]) => k !== '').sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (!entries.length) return '';
    const max = Math.max(1, ...entries.map(e => e[1]));
    return `<div><div class="cs-title">${title}</div>${entries.map(([k, n]) => `<a href="#" class="cs-row" data-kind="${kind}" data-v="${htmlEsc(k)}" title="${htmlEsc(label(k))}: ${n} — click to list">
      <span class="cs-label">${htmlEsc(label(k))}</span><span class="cs-track"><span class="cs-bar" style="width:${Math.max(2, (n / max) * 100)}%"></span></span><span class="cs-val">${n}</span></a>`).join('')}</div>`;
  };
  const statusType = {};
  data.forEach(a => { const k = `${a.status}|${a.asset_type || 'Type not set'}`; statusType[k] = (statusType[k] || 0) + 1; });
  const sum = document.getElementById('bs-summary');
  sum.innerHTML = bars('By status &amp; type', 'st', statusType, k => k.replace('|', ' · '))
    + bars('Broken laptops — condition', 'cond', summary.laptopCondition, k => (COND[k] || [k])[0])
    + bars('By country', 'country', summary.byCountry);
  sum.querySelectorAll('.cs-row').forEach(el => el.addEventListener('click', (e) => {
    e.preventDefault();
    Object.assign(bsF, { search: '', status: '', type: '', country: '', cond: '' });
    const v = el.dataset.v;
    if (el.dataset.kind === 'st') { const [st, t] = v.split('|'); bsF.status = st; bsF.type = t === 'Type not set' ? '__none' : t; }
    else if (el.dataset.kind === 'cond') bsF.cond = v;
    else bsF.country = v === 'Unknown' ? '' : v;
    syncBsFilters(); renderBroken();
  }));
  // Filter options from the data.
  const fill = (id, values, all) => { const sel = document.getElementById(id); sel.innerHTML = `<option value="">${all}</option>` + values.map(v => `<option value="${htmlEsc(v[0])}">${htmlEsc(v[1])}</option>`).join(''); sel.value = bsF[id.slice(3)] || ''; };
  fill('bs-type', [...new Set(data.map(a => a.asset_type || ''))].sort().map(t => [t || '__none', t || 'Type not set']), 'All asset types');
  fill('bs-country', [...new Set(data.map(a => a.country).filter(Boolean))].sort().map(c => [c, c]), 'All countries');
  syncBsFilters();

  const q = bsF.search.toLowerCase();
  const rows = data.filter(a => (!bsF.status || a.status === bsF.status)
    && (!bsF.type || (bsF.type === '__none' ? !a.asset_type : a.asset_type === bsF.type))
    && (!bsF.country || a.country === bsF.country) && (!bsF.cond || a.condition === bsF.cond)
    && (!q || [a.asset_code, a.asset_s4, a.brand_model, a.serial_no, a.computer_no, a.user_name, a.ad_name, a.department].some(v => String(v || '').toLowerCase().includes(q))));
  const tbody = document.getElementById('bs-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No devices match.</td></tr>'; return; }
  tbody.innerHTML = rows.map(a => {
    let cond = '<span class="text-muted">—</span>';
    if (a.condition) {
      const [txt, cls] = COND[a.condition];
      const chips = a.condition === 'total' ? '' : `<div class="pc-chips">${parts.map(([k, name]) => { const [ic, col, word] = PSTATE[a.parts[k] || '']; return `<span class="pc-chip" style="color:${col}" title="${name}: ${word}">${ic} ${name}</span>`; }).join('')}</div>`;
      cond = `<span class="badge ${cls}">${txt}</span>${chips}${a.parts.note ? `<div class="text-muted text-sm">${htmlEsc(a.parts.note)}</div>` : ''}`;
    }
    const code = a.asset_s4 || a.asset_code;
    return `<tr>
      <td><a href="/inventory.html?edit=${a.id}">${code ? htmlEsc(code) : '#' + a.id}</a><div class="text-muted text-sm">${htmlEsc(a.asset_type || 'Type not set')}</div></td>
      <td>${htmlEsc(a.brand_model) || '—'}</td>
      <td class="text-sm">${htmlEsc(a.serial_no) || '—'}<div class="text-muted">${htmlEsc(a.computer_no)}</div></td>
      <td class="text-sm">${htmlEsc(a.country)}${a.location ? ` · ${htmlEsc(a.location)}` : ''}</td>
      <td class="text-sm">${htmlEsc(a.user_name) || '—'}</td>
      <td class="text-sm">${yrs(a.purchase_date) || '—'}</td>
      <td>${statusBadge(a.status)}${a.open_repair ? '<div class="text-sm" style="color:#d97706">🔧 open repair</div>' : ''}</td>
      <td style="min-width:220px">${cond}</td>
      <td style="white-space:nowrap">${a.condition && canEdit() ? `<button class="btn btn-ghost btn-sm" onclick="openPartsCheck(${a.id})">Check parts</button>` : ''}</td>
    </tr>`;
  }).join('');
}
function syncBsFilters() { for (const k of ['search', 'status', 'type', 'country', 'cond']) { const el = document.getElementById('bs-' + k); if (el) el.value = bsF[k]; } }

// Parts check of one broken laptop.
let pcId = null;
function openPartsCheck(id) {
  const a = bsData.data.find(x => x.id === id); if (!a) return;
  pcId = id;
  document.getElementById('pc-title').textContent = `Parts check — ${a.asset_s4 || a.asset_code || '#' + a.id} · ${a.brand_model || ''}`;
  const opt = (k, v, label) => `<label class="pc-opt"><input type="radio" name="pc-${k}" value="${v}"${(a.parts[k] || '') === v ? ' checked' : ''}> ${label}</label>`;
  document.getElementById('pc-body').innerHTML = `
    <label class="pc-total"><input type="checkbox" id="pc-total"${a.parts.total ? ' checked' : ''}> <b>Total broken</b> — no part can be used</label>
    <table class="pc-table" id="pc-parts"><tbody>${bsData.parts.map(([k, name]) => `<tr><td><b>${name}</b></td><td>
      ${opt(k, 'ok', '✓ Usable')}${opt(k, 'bad', '✗ Broken')}${opt(k, 'used', '↪ Used as spare')}${opt(k, '', 'Not checked')}</td></tr>`).join('')}</tbody></table>
    <div class="form-group" style="margin-top:10px"><label class="form-label">Note</label><input class="form-control" id="pc-note" maxlength="300" value="${htmlEsc(a.parts.note || '')}" placeholder="e.g. water damage, screen cracked"></div>
    ${a.parts.checked_by ? `<p class="text-muted text-sm">Last check by ${htmlEsc(a.parts.checked_by)} · ${htmlEsc(a.parts.checked_at)} UTC</p>` : ''}`;
  const tot = document.getElementById('pc-total');
  const sync = () => { document.getElementById('pc-parts').style.opacity = tot.checked ? .4 : 1; document.querySelectorAll('#pc-parts input').forEach(i => { i.disabled = tot.checked; }); };
  tot.addEventListener('change', sync); sync();
  document.getElementById('pc-overlay').classList.add('open');
}
async function savePartsCheck() {
  const body = { total: document.getElementById('pc-total').checked, note: document.getElementById('pc-note').value, parts: {} };
  bsData.parts.forEach(([k]) => { const c = document.querySelector(`input[name="pc-${k}"]:checked`); body.parts[k] = c ? c.value : ''; });
  try {
    await apiPut(`/api/maintenance/devices/${pcId}/parts`, body);
    document.getElementById('pc-overlay').classList.remove('open');
    showToast('Parts check saved'); loadBroken();
  } catch (err) { let m = 'Could not save'; try { m = JSON.parse(err.message).error || m; } catch {} showToast(m, 'error'); }
}

// Spare parts list; "Use" marks one part of one laptop as taken.
async function loadSpares() {
  try {
    const r = await apiGet('/api/maintenance/spare-parts');
    const total = r.byPart.reduce((n, p) => n + p.available, 0);
    document.getElementById('sp-total').textContent = `· ${total} usable part${total === 1 ? '' : 's'}`;
    document.getElementById('sp-parts').innerHTML = r.byPart.map(p => `<div class="sp-part"><div class="sp-num">${p.available}</div><div class="text-muted text-sm">${p.partName}</div></div>`).join('');
    const tbody = document.getElementById('sp-tbody');
    tbody.innerHTML = r.groups.length ? r.groups.map(g => `<tr>
        <td><b>${htmlEsc(g.partName)}</b></td><td>${htmlEsc(g.model)}</td>
        <td><b style="color:${g.available ? '#16a34a' : 'var(--muted)'}">${g.available}</b></td><td class="text-muted">${g.used || '—'}</td>
        <td class="text-sm">${g.sources.map(src => `<span class="sp-src${src.state === 'used' ? ' sp-used' : ''}">
          <a href="/inventory.html?edit=${src.id}">${htmlEsc(src.code || '#' + src.id)}</a> <span class="text-muted">${htmlEsc(src.country)}</span>
          ${src.state === 'ok' && canEdit() ? `<button class="btn btn-ghost btn-sm" style="padding:1px 6px;font-size:11px" onclick="useSpare(${src.id}, ${jsArg(g.part)}, ${jsArg(g.partName)})">Use</button>` : src.state === 'used' ? '<span class="text-muted">used</span>' : ''}</span>`).join('')}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-state">No usable parts recorded yet — use “Check parts” on a broken laptop.</td></tr>';
  } catch (e) { document.getElementById('sp-tbody').innerHTML = '<tr><td colspan="5" class="empty-state">Could not load.</td></tr>'; }
}
async function useSpare(id, part, partName) {
  const a = bsData && bsData.data.find(x => x.id === id);
  if (!a || !confirm(`Mark the ${partName} of ${a.asset_s4 || a.asset_code || '#' + id} as used for a repair?`)) return;
  const parts = {}; bsData.parts.forEach(([k]) => { parts[k] = a.parts[k] || ''; }); parts[part] = 'used';
  try { await apiPut(`/api/maintenance/devices/${id}/parts`, { total: false, note: a.parts.note || '', parts }); showToast(`${partName} marked as used`); loadBroken(); }
  catch (err) { let m = 'Could not save'; try { m = JSON.parse(err.message).error || m; } catch {} showToast(m, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCountries();
  loadMaint();
  loadBroken();
  document.getElementById('bs-search').addEventListener('input', (e) => { bsF.search = e.target.value; renderBroken(); });
  ['status', 'type', 'country', 'cond'].forEach(k => document.getElementById('bs-' + k).addEventListener('change', (e) => { bsF[k] = e.target.value; renderBroken(); }));
  document.getElementById('bs-reset').addEventListener('click', () => { Object.assign(bsF, { search: '', status: '', type: '', country: '', cond: '' }); renderBroken(); });
  document.getElementById('pc-save').addEventListener('click', savePartsCheck);
  ['pc-close', 'pc-cancel'].forEach(id => document.getElementById(id).addEventListener('click', () => document.getElementById('pc-overlay').classList.remove('open')));
  document.getElementById('filter-status').addEventListener('change', loadMaint);
  document.getElementById('filter-country').addEventListener('change', loadMaint);
  document.getElementById('filter-type').addEventListener('change', loadMaint);

  // Log Maintenance modal
  document.getElementById('btn-add').addEventListener('click', openAdd);
  document.getElementById('add-close').addEventListener('click', closeAdd);
  document.getElementById('add-cancel').addEventListener('click', closeAdd);
  document.getElementById('add-save').addEventListener('click', onAddSave);
  document.getElementById('m-type').addEventListener('change', searchItems);
  let d;
  document.getElementById('m-search').addEventListener('input', () => { clearTimeout(d); d = setTimeout(searchItems, 300); });
});
