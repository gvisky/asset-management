/* Dashboard page logic */

const COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
const COUNTRY_SHORT = { Vietnam: 'VN', Thailand: 'TH', Malaysia: 'MY' };
const STATUSES = [
  { key: 'Active', color: '#16a34a' },
  { key: 'Broken', color: '#dc2626' },
  { key: 'Stock',  color: '#d97706' },
];
let dashScope = '';          // '' = all countries, else one country
let allBreakdown = null;     // unfiltered country × type × status rows (for "Assets by Country")

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const invLink = (params) => '/inventory.html?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

// Sum breakdown rows into { total, Active, Broken, Stock } per key (country / asset type).
function tally(rows, keyFn) {
  const out = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (!out.has(k)) out.set(k, { total: 0, Active: 0, Broken: 0, Stock: 0 });
    const t = out.get(k);
    t.total += r.cnt;
    if (r.status in t) t[r.status] += r.cnt;
  });
  return out;
}

// Stacked status bar (Active / Broken / Stock) — tooltip per segment.
function statusBar(t) {
  if (!t.total) return '<div class="sbar sbar-empty"></div>';
  return '<div class="sbar">' + STATUSES.filter(s => t[s.key]).map(s => {
    const pct = (t[s.key] / t.total) * 100;
    return `<span style="width:${pct}%;background:${s.color}" title="${s.key}: ${fmt(t[s.key])} (${pct.toFixed(0)}%)"></span>`;
  }).join('') + '</div>';
}

function renderScopeSwitch(scopedTo) {
  const el = document.getElementById('dash-scope');
  if (!el) return;
  if (scopedTo) { el.innerHTML = `<span class="seg-fixed">${escHtml(scopedTo)}</span>`; return; }
  el.innerHTML = [['', 'All countries'], ...COUNTRIES.map(c => [c, c])].map(([v, label]) =>
    `<button type="button" role="tab" class="seg-btn${v === dashScope ? ' active' : ''}" data-country="${v}" aria-selected="${v === dashScope}">${label}</button>`).join('');
  el.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
    dashScope = btn.dataset.country;
    loadStats();
  }));
}

// KPI tiles: Total / Active / Broken / Stock — each split by country (all-countries view)
// or shown as a share of the country total (single-country view).
function renderKpis(stats, scopedTo) {
  const grid = document.getElementById('kpi-grid');
  const byCountry = tally(allBreakdown || stats.breakdown, r => r.country);
  const scope = scopedTo || dashScope;
  const tiles = [
    { label: 'Total Assets', key: 'total', color: '#1a56db', status: '' },
    ...STATUSES.map(s => ({ label: s.key, key: s.key, color: s.color, status: s.key })),
  ];
  const total = stats.total || 0;
  grid.innerHTML = tiles.map(t => {
    const value = t.key === 'total' ? total : (stats.byStatus[t.key] || 0);
    let sub;
    if (scope) {
      sub = t.key === 'total' ? escHtml(scope)
        : `${total ? ((value / total) * 100).toFixed(1) : '0.0'}% of ${escHtml(scope)}`;
    } else {
      sub = COUNTRIES.map(c => {
        const ct = byCountry.get(c) || { total: 0, Active: 0, Broken: 0, Stock: 0 };
        return `<a class="kpi-split" href="${invLink({ country: c, status: t.status })}" title="${c}">${COUNTRY_SHORT[c]} <b>${fmt(ct[t.key])}</b></a>`;
      }).join('');
    }
    return `<div class="kpi" style="--kpi-color:${t.color}">
      <a class="kpi-main" href="${invLink({ country: scope, status: t.status })}">
        <div class="kpi-label"><span class="kpi-dot"></span>${t.label}</div>
        <div class="kpi-value">${fmt(value)}</div>
      </a>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  }).join('');
}

function breakdownTable(firstCol, entries, linkFor, totalRow) {
  const head = `<thead><tr><th>${firstCol}</th><th class="num">Total</th>${STATUSES.map(s => `<th class="num">${s.key}</th>`).join('')}<th style="width:32%">Status mix</th></tr></thead>`;
  const row = ([name, t], cls = '') => `<tr class="${cls}">
      <td>${linkFor ? `<a href="${linkFor(name)}">${escHtml(name)}</a>` : escHtml(name)}</td>
      <td class="num"><b>${fmt(t.total)}</b></td>
      ${STATUSES.map(s => `<td class="num${t[s.key] ? '' : ' zero'}">${fmt(t[s.key])}</td>`).join('')}
      <td>${statusBar(t)}</td>
    </tr>`;
  return head + '<tbody>' + (entries.length ? entries.map(e => row(e)).join('') : '<tr><td colspan="6" class="empty-state">No assets.</td></tr>')
    + (totalRow ? row(totalRow, 'total-row') : '') + '</tbody>';
}

function renderBreakdowns(stats, scopedTo) {
  // By country — always all countries the user can see.
  const rowsAll = allBreakdown || stats.breakdown;
  const byCountry = tally(rowsAll, r => r.country);
  const countryList = scopedTo ? [scopedTo] : COUNTRIES;
  const cEntries = countryList.map(c => [c, byCountry.get(c) || { total: 0, Active: 0, Broken: 0, Stock: 0 }]);
  const grand = tally(rowsAll, () => 'Total').get('Total') || { total: 0, Active: 0, Broken: 0, Stock: 0 };
  document.getElementById('bd-country').innerHTML =
    breakdownTable('Country', cEntries, c => invLink({ country: c }), countryList.length > 1 ? ['Total', grand] : null);

  // By asset type — follows the selected country.
  const byType = tally(stats.breakdown, r => r.asset_type || 'Not set');
  const tEntries = [...byType.entries()].sort((x, y) => {
    if (x[0] === 'Not set') return 1;
    if (y[0] === 'Not set') return -1;
    return y[1].total - x[1].total;
  });
  const scope = scopedTo || dashScope;
  document.getElementById('bd-type-scope').textContent = scope ? `· ${scope}` : '· all countries';
  document.getElementById('bd-type').innerHTML = breakdownTable('Asset Type', tEntries,
    t => t === 'Not set' ? '' : invLink({ asset_type: t, country: scope }));
}

function renderLegends() {
  const html = STATUSES.map(s => `<span><i style="background:${s.color}"></i>${s.key}</span>`).join('');
  document.querySelectorAll('.status-legend').forEach(el => { el.innerHTML = html; });
}

async function loadStats() {
  try {
    const stats = await apiGet('/api/assets/stats' + (dashScope ? '?country=' + encodeURIComponent(dashScope) : ''));
    const scopedTo = stats.scope || '';
    if (!dashScope) allBreakdown = stats.breakdown;
    else if (!allBreakdown) allBreakdown = (await apiGet('/api/assets/stats')).breakdown;

    renderScopeSwitch(scopedTo);
    renderKpis(stats, scopedTo);
    renderBreakdowns(stats, scopedTo);
    renderLegends();

    document.getElementById('s-factory').textContent = fmt(stats.byLocation.Factory);
    document.getElementById('s-office').textContent  = fmt(stats.byLocation.Office);
    const warrEl = document.getElementById('s-warranty');
    const repEl  = document.getElementById('s-repairs');
    if (warrEl) warrEl.textContent = stats.warrantyExpiring || 0;
    if (repEl)  repEl.textContent  = stats.openRepairs || 0;

    // Licenses metric comes from its own endpoint (separate module).
    const licEl = document.getElementById('s-licenses');
    if (licEl) {
      apiGet('/api/licenses/stats')
        .then(ls => { licEl.textContent = ls.expiring || 0; })
        .catch(() => { licEl.textContent = '0'; });
    }

    // Server count from the server-inventory module.
    const srvEl = document.getElementById('s-servers');
    if (srvEl) {
      apiGet('/api/servers/stats')
        .then(ss => { srvEl.textContent = ss.total || 0; })
        .catch(() => { srvEl.textContent = '0'; });
    }

    // Top Models — by selected Asset Type, split by country (loaded separately).
    loadTopModels();

    // Recent assets table
    const tbody = document.getElementById('recent-tbody');
    if (!stats.recentlyAdded.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No assets yet. <a href="#" id="add-first">Add your first asset →</a></div></td></tr>`;
      return;
    }
    tbody.innerHTML = stats.recentlyAdded.map(a => `
      <tr>
        <td><code style="font-size:12px">${a.asset_code || '—'}</code></td>
        <td>${a.brand_model || '—'}</td>
        <td>${locationBadge(a.location)}</td>
        <td class="truncate" title="${a.department || ''}">${a.department || '—'}</td>
        <td>${a.user_name || '—'}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>
    `).join('');

  } catch (err) {
    console.error(err);
    showToast('Failed to load dashboard stats', 'error');
  }
}

// Load the User Inventory (personnel) summary cards for the dashboard.
async function loadPersonnelSummary() {
  try {
    const s = await apiGet('/api/personnel/summary');
    const grid = document.getElementById('personnel-grid');
    const cards = [
      ['Total People',   s.total,                      '#e0e7ff', '#4338ca', 'all'],
      ['Hayat: No',      s.noHayat || 0,               '#fee2e2', '#dc2626', 'No Hayat Member'],
      ['Leaving set',    s.leaving || 0,               '#fef3c7', '#d97706', ''],
      ['To Be Delete',   s.byStatus['to be delete'] || 0,   '#fef9c3', '#ca8a04', 'to be delete'],
      ['Confirmed Delete', s.byStatus['pending delete'] || 0, '#ffedd5', '#ea580c', 'pending delete'],
      ['Deleted',        s.byStatus['deleted'] || 0,        '#fee2e2', '#b91c1c', 'deleted'],
    ];
    grid.innerHTML = cards.map(([label, val, bg, fg, statusFilter]) => {
      const href = statusFilter === 'No Hayat Member'
        ? `/user-inventory.html?user_type=${encodeURIComponent(statusFilter)}`
        : statusFilter ? `/user-inventory.html?status=${encodeURIComponent(statusFilter)}`
        : `/user-inventory.html`;
      return `<a class="stat-card stat-mini" href="${href}">
        <div class="stat-icon" style="background:${bg}">
          <svg width="22" height="22" fill="none" stroke="${fg}" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <div><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div>
      </a>`;
    }).join('');
    document.getElementById('personnel-section').style.display = '';
  } catch (e) {
    // user without personnel access — leave the section hidden
  }
}

// ── Top Models box — models + per-country quantity for a chosen Asset Type ────
// Each model has a 🔒 lock-delete checkbox at the front (IT admin only).
let _tmInited = false;
const TM_SHOW = 6;          // rows shown before "Show all"
let _tmExpanded = false;
async function loadTopModels(assetType) {
  const body = document.getElementById('tm-body');
  const sel = document.getElementById('tm-type');
  if (!body || !sel) return;
  try {
    const q = assetType !== undefined ? assetType : sel.value;
    const d = await apiGet('/api/assets/top-models' + (q ? '?asset_type=' + encodeURIComponent(q) : ''));

    sel.innerHTML = (d.assetTypes || []).map(t =>
      `<option value="${String(t.type).replace(/"/g, '&quot;')}"${t.type === d.selected ? ' selected' : ''}>${t.type} (${t.count})</option>`).join('')
      || '<option value="">No types</option>';
    sel.value = d.selected || '';

    const lockedSet = new Set((d.lockedModels || []).map(m => String(m).toLowerCase()));
    const canLock = !!d.canLock;
    const countries = d.countries || [];
    if (!d.models.length) { body.innerHTML = '<div class="text-muted text-sm">No models for this type.</div>'; return; }
    body.innerHTML = `
      ${canLock ? '<div class="text-muted text-sm" style="margin-bottom:6px">🔒 Tick a model to lock its assets from deletion (editors can edit but not delete).</div>' : ''}
      <div class="table-wrap"><table>
        <thead><tr>${canLock ? '<th title="Lock from deletion">🔒</th>' : ''}<th>Model</th>${countries.map(c => `<th style="text-align:right">${c}</th>`).join('')}<th style="text-align:right">Total</th></tr></thead>
        <tbody>${d.models.map((m, i) => {
          const locked = lockedSet.has(String(m.brand_model).toLowerCase());
          const lockCell = canLock
            ? `<td style="text-align:center"><input type="checkbox" class="tm-lock-cb" data-model="${escAttr(m.brand_model)}" ${locked ? 'checked' : ''} title="Lock '${escAttr(m.brand_model)}' from deletion"></td>`
            : '';
          const hidden = !_tmExpanded && i >= TM_SHOW;
          return `<tr class="${i >= TM_SHOW ? 'tm-more' : ''}" style="${locked ? 'background:#fff7ed;' : ''}${hidden ? 'display:none' : ''}">
            ${lockCell}
            <td>${locked ? '🔒 ' : ''}<a href="/inventory.html?asset_type=${encodeURIComponent(d.selected)}&brand=${encodeURIComponent(m.brand_model)}" title="View these assets">${escD(m.brand_model)}</a></td>
            ${countries.map(c => `<td style="text-align:right">${m.byCountry[c] || 0}</td>`).join('')}
            <td style="text-align:right"><strong>${m.total}</strong></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      ${d.models.length > TM_SHOW ? `<button type="button" class="btn btn-ghost btn-sm" id="tm-toggle" style="margin-top:10px">${_tmExpanded ? 'Show less' : `Show all ${d.models.length} models`}</button>` : ''}`;

    const toggle = document.getElementById('tm-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      _tmExpanded = !_tmExpanded;
      body.querySelectorAll('tr.tm-more').forEach(tr => { tr.style.display = _tmExpanded ? '' : 'none'; });
      toggle.textContent = _tmExpanded ? 'Show less' : `Show all ${d.models.length} models`;
    });

    // Wire each model lock checkbox.
    body.querySelectorAll('.tm-lock-cb').forEach(cb => cb.addEventListener('change', async () => {
      const model = cb.dataset.model;
      try {
        await apiPost('/api/assets/locked-models', { brand_model: model, locked: cb.checked });
        showToast(cb.checked ? `Locked "${model}" from deletion` : `Unlocked "${model}"`);
        loadTopModels(sel.value);
      } catch (e) { showToast('Only an IT admin can lock models', 'error'); cb.checked = !cb.checked; }
    }));
  } catch (e) {
    body.innerHTML = '<div class="text-muted text-sm">Could not load models.</div>';
  }

  if (!_tmInited) { _tmInited = true; sel.addEventListener('change', () => { _tmExpanded = false; loadTopModels(sel.value); }); }
}
function escD(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ── Missing-info alerts table ─────────────────────────────────────────────────
async function loadAlerts() {
  const tbody = document.getElementById('alert-tbody');
  try {
    const rows = await apiGet('/api/assets/incomplete');

    const badge = document.getElementById('alert-count');
    if (rows.length) {
      badge.textContent = `${rows.length} to fix`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty-state">
        <svg width="36" height="36" fill="none" stroke="#22c55e" stroke-width="1.5" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>All assets have their key info. 🎉</p>
      </div></td></tr>`;
      return;
    }

    const miss = (v) => (v === null || v === undefined || String(v).trim() === '');

    tbody.innerHTML = rows.map(a => {
      const tags = [];
      if (miss(a.serial_no))   tags.push('Serial');
      if (miss(a.asset_code))  tags.push('Code');
      if (miss(a.computer_no)) tags.push('PC No');
      if (a.status === 'Active' && miss(a.ad_name)) tags.push('AD Name');
      let tagHtml = tags.map(t =>
        `<span class="badge badge-broken" style="margin:1px;font-size:10.5px;padding:2px 6px">${t}</span>`).join('');
      if (a.dup_serial) {
        const others = (a.dup_with || []).map(o => o.asset_code || `#${o.id}`).join(', ');
        const title = others ? `Same serial "${a.serial_no}" as: ${others}` : `Duplicate serial "${a.serial_no}"`;
        tagHtml += `<span class="badge" title="${title.replace(/"/g,'&quot;')}" style="margin:1px;font-size:10.5px;padding:2px 6px;background:#fde68a;color:#92400e">Dup Serial: ${a.serial_no || '?'}</span>`;
      }
      const label = a.brand_model || a.user_name || a.department || `Asset #${a.id}`;
      return `
        <tr>
          <td style="min-width:120px">
            <div class="truncate" title="${(label).replace(/"/g,'&quot;')}" style="max-width:140px">${label}</div>
            <span class="text-muted text-sm">#${a.id} · ${a.location}</span>
          </td>
          <td>${tagHtml}</td>
          <td><a class="btn btn-primary btn-sm" href="/inventory.html?edit=${a.id}" title="Fill in missing info">Fill</a></td>
        </tr>`;
    }).join('');
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load alerts</td></tr>`;
  }
}

// ── Save handler (modal save on dashboard page) ───────────────────────────────
let _saveMode = 'add';

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadAlerts();                         // missing-info table (asset data quality)
  loadPersonnelSummary();               // User Inventory summary cards
  loadAlertBox('alert-box', '');        // consolidated notifications (all scopes)

  const saveBtn = document.getElementById('modal-save');
  if (!saveBtn) return;

  // "Add Asset" buttons open the modal in add mode
  document.querySelectorAll('#btn-add-top, #nav-add').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      _saveMode = 'add';
      clearForm();
      openModal('Add Asset');
    });
  });

  saveBtn.addEventListener('click', async () => {
    const data = getFormData();
    if (!data.location) { showToast('Please select a location', 'error'); return; }
    try {
      if (_saveMode === 'add') {
        await apiPost(API, data);
        showToast('Asset added successfully');
      }
      closeModal();
      loadStats();
    } catch (err) {
      showToast('Error saving asset', 'error');
    }
  });
});
