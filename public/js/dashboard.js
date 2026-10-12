/* Dashboard page logic */

const COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
const COUNTRY_SHORT = { Vietnam: 'VN', Thailand: 'TH', Malaysia: 'MY' };
const STATUSES = [
  { key: 'Active', color: '#16a34a' },
  { key: 'Broken', color: '#dc2626' },
  { key: 'Stock',  color: '#d97706' },
];
let dashScope = '';          // '' = all countries, else one country
let dashSite = '';           // '' = all sites, else 'Office' / 'Factory' (Vietnam only)
let allBreakdown = null;     // unfiltered country × site × type × status rows (for "Assets by Country")

const SITES = ['Office', 'Factory'];
const EMPTY = () => ({ total: 0, Active: 0, Broken: 0, Stock: 0 });
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const invLink = (params) => '/inventory.html?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

// Sum breakdown rows into { total, Active, Broken, Stock } per key (country / asset type / site).
function tally(rows, keyFn) {
  const out = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (!out.has(k)) out.set(k, EMPTY());
    const t = out.get(k);
    t.total += r.cnt;
    if (r.status in t) t[r.status] += r.cnt;
  });
  return out;
}

// Only Vietnam has Office / Factory sites.
function hasSites(country) { return country === SITE_COUNTRY; }
// Site buckets for one country: Office, Factory, then "Site not set" (only if any).
function siteEntries(country) {
  const bySite = tally((allBreakdown || []).filter(r => r.country === country), r => r.site);
  const list = SITES.map(s => [s, bySite.get(s) || EMPTY()]);
  if (bySite.get('')) list.push(['', bySite.get('')]);
  return list;
}
const siteLabel = (s) => s || 'Site not set';

// Stacked status bar (Active / Broken / Stock) — tooltip per segment.
function statusBar(t) {
  if (!t.total) return '<div class="sbar sbar-empty"></div>';
  return '<div class="sbar">' + STATUSES.filter(s => t[s.key]).map(s => {
    const pct = (t[s.key] / t.total) * 100;
    return `<span style="width:${pct}%;background:${s.color}" title="${s.key}: ${fmt(t[s.key])} (${pct.toFixed(0)}%)"></span>`;
  }).join('') + '</div>';
}

function segButtons(options, current, attr) {
  return options.map(([v, label]) =>
    `<button type="button" role="tab" class="seg-btn${v === current ? ' active' : ''}" data-${attr}="${v}" aria-selected="${v === current}">${label}</button>`).join('');
}

function renderScopeSwitch(scopedTo) {
  const el = document.getElementById('dash-scope');
  const siteEl = document.getElementById('dash-site');
  if (!el) return;
  if (scopedTo) {
    el.innerHTML = `<span class="seg-fixed">${escHtml(scopedTo)}</span>`;
  } else {
    el.innerHTML = segButtons([['', 'All countries'], ...COUNTRIES.map(c => [c, c])], dashScope, 'country');
    el.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
      dashScope = btn.dataset.country;
      dashSite = '';
      loadStats();
    }));
  }
  // Second switch: Office / Factory, for a country that has sites (e.g. Vietnam).
  const country = scopedTo || dashScope;
  if (!siteEl) return;
  if (!country || !hasSites(country)) { siteEl.style.display = 'none'; siteEl.innerHTML = ''; return; }
  siteEl.style.display = '';
  siteEl.innerHTML = segButtons([['', 'All sites'], ...SITES.map(s => [s, s])], dashSite, 'site');
  siteEl.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
    dashSite = btn.dataset.site;
    loadStats();
  }));
}

// KPI tiles: Total / Active / Broken / Stock.
//   All countries → split by country.  One country with sites → split by site.  Otherwise → share of the total.
function renderKpis(stats, scopedTo) {
  const grid = document.getElementById('kpi-grid');
  const byCountry = tally(allBreakdown || stats.breakdown, r => r.country);
  const scope = scopedTo || dashScope;
  const scopeName = scope + (dashSite ? ' · ' + dashSite : '');
  const sites = scope && !dashSite && hasSites(scope) ? siteEntries(scope) : null;
  const tiles = [
    { label: 'Total Assets', key: 'total', color: '#1a56db', status: '' },
    ...STATUSES.map(s => ({ label: s.key, key: s.key, color: s.color, status: s.key })),
  ];
  const total = stats.total || 0;
  grid.innerHTML = tiles.map(t => {
    const value = t.key === 'total' ? total : (stats.byStatus[t.key] || 0);
    let sub;
    if (!scope) {
      sub = COUNTRIES.map(c => {
        const ct = byCountry.get(c) || EMPTY();
        return `<a class="kpi-split" href="${invLink({ country: c, status: t.status })}" title="${c}">${COUNTRY_SHORT[c]} <b>${fmt(ct[t.key])}</b></a>`;
      }).join('');
    } else if (sites) {
      sub = sites.map(([site, st]) => site
        ? `<a class="kpi-split" href="${invLink({ country: scope, location: site, status: t.status })}" title="${escHtml(scope)} · ${site}">${site} <b>${fmt(st[t.key])}</b></a>`
        : `<span class="kpi-split" title="${escHtml(scope)} · site not set">Not set <b>${fmt(st[t.key])}</b></span>`).join('');
    } else {
      sub = t.key === 'total' ? escHtml(scopeName)
        : `${total ? ((value / total) * 100).toFixed(1) : '0.0'}% of ${escHtml(scopeName)}`;
    }
    return `<div class="kpi" style="--kpi-color:${t.color}">
      <a class="kpi-main" href="${invLink({ country: scope, location: dashSite, status: t.status })}">
        <div class="kpi-label"><span class="kpi-dot"></span>${t.label}</div>
        <div class="kpi-value">${fmt(value)}</div>
      </a>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  }).join('');
}

function breakdownTable(firstCol, entries, totalRow) {
  const head = `<thead><tr><th>${firstCol}</th><th class="num">Total</th>${STATUSES.map(s => `<th class="num">${s.key}</th>`).join('')}<th style="width:32%">Status mix</th></tr></thead>`;
  const row = ({ name, t, href, cls = '' }) => `<tr class="${cls}">
      <td>${href ? `<a href="${href}">${escHtml(name)}</a>` : escHtml(name)}</td>
      <td class="num"><b>${fmt(t.total)}</b></td>
      ${STATUSES.map(s => `<td class="num${t[s.key] ? '' : ' zero'}">${fmt(t[s.key])}</td>`).join('')}
      <td>${statusBar(t)}</td>
    </tr>`;
  return head + '<tbody>' + (entries.length ? entries.map(row).join('') : '<tr><td colspan="6" class="empty-state">No assets.</td></tr>')
    + (totalRow ? row({ ...totalRow, cls: 'total-row' }) : '') + '</tbody>';
}

function renderBreakdowns(stats, scopedTo) {
  // By country — always all countries the user can see; countries with sites get Office / Factory sub-rows.
  const rowsAll = allBreakdown || stats.breakdown;
  const byCountry = tally(rowsAll, r => r.country);
  const countryList = scopedTo ? [scopedTo] : COUNTRIES;
  const cEntries = [];
  countryList.forEach(c => {
    cEntries.push({ name: c, t: byCountry.get(c) || EMPTY(), href: invLink({ country: c }) });
    if (hasSites(c)) siteEntries(c).forEach(([site, t]) => cEntries.push({
      name: siteLabel(site), t, cls: 'sub-row', href: site ? invLink({ country: c, location: site }) : '',
    }));
  });
  const grand = tally(rowsAll, () => 'Total').get('Total') || EMPTY();
  document.getElementById('bd-country').innerHTML =
    breakdownTable('Country / Site', cEntries, countryList.length > 1 ? { name: 'Total', t: grand } : null);

  // By asset type — follows the selected country / site.
  const byType = tally(stats.breakdown, r => r.asset_type || 'Not set');
  const scope = scopedTo || dashScope;
  const tEntries = [...byType.entries()].sort((x, y) => {
    if (x[0] === 'Not set') return 1;
    if (y[0] === 'Not set') return -1;
    return typeRank(x[0]) - typeRank(y[0]) || y[1].total - x[1].total;
  }).map(([name, t]) => ({ name, t, href: name === 'Not set' ? '' : invLink({ asset_type: name, country: scope, location: dashSite }) }));
  document.getElementById('bd-type-scope').textContent = scope ? `· ${scope}${dashSite ? ' · ' + dashSite : ''}` : '· all countries';
  document.getElementById('bd-type').innerHTML = breakdownTable('Asset Type', tEntries);
}

function renderLegends() {
  const html = STATUSES.map(s => `<span><i style="background:${s.color}"></i>${s.key}</span>`).join('');
  document.querySelectorAll('.status-legend').forEach(el => { el.innerHTML = html; });
}

async function loadStats() {
  try {
    const q = new URLSearchParams(Object.entries({ country: dashScope, location: dashSite }).filter(([, v]) => v)).toString();
    const stats = await apiGet('/api/assets/stats' + (q ? '?' + q : ''));
    const scopedTo = stats.scope || '';
    if (!dashScope && !dashSite) allBreakdown = stats.breakdown;
    else if (!allBreakdown) allBreakdown = (await apiGet('/api/assets/stats')).breakdown;

    renderScopeSwitch(scopedTo);
    renderKpis(stats, scopedTo);
    renderBreakdowns(stats, scopedTo);
    renderLegends();

    renderOps(stats, scopedTo);
    renderPersonnel();
    if (naPanel) naPanel.followScope();

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

// Shared tile (same look as the asset KPI tiles). `sub` is ready-made HTML.
function kpiTile({ label, color, value, href, sub }) {
  return `<div class="kpi" style="--kpi-color:${color}">
    <a class="kpi-main" href="${href}">
      <div class="kpi-label"><span class="kpi-dot"></span>${label}</div>
      <div class="kpi-value">${fmt(value)}</div>
    </a>
    <div class="kpi-sub kpi-note">${sub}</div>
  </div>`;
}
const statusNote = (t) => STATUSES.map(s => `<b>${fmt(t[s.key])}</b> ${s.key.toLowerCase()}`).join(' · ');

// ── Location & Operations: VN Office / VN Factory (status split) + warranty, repairs, licenses, servers ──
let _opsExtra = { lic: null, srv: null };
function renderOps(stats, scopedTo) {
  const grid = document.getElementById('ops-grid');
  if (!grid) return;
  const scope = scopedTo || dashScope;
  const showSites = !scope || scope === SITE_COUNTRY;
  const sites = showSites ? siteEntries(SITE_COUNTRY) : [];
  const site = (name) => (sites.find(([s]) => s === name) || [name, EMPTY()])[1];
  const lic = _opsExtra.lic, srv = _opsExtra.srv;
  const tiles = [];
  if (showSites) {
    tiles.push({ label: 'VN Office',  color: '#0284c7', value: site('Office').total,
      href: invLink({ country: SITE_COUNTRY, location: 'Office' }),  sub: statusNote(site('Office')) });
    tiles.push({ label: 'VN Factory', color: '#7c3aed', value: site('Factory').total,
      href: invLink({ country: SITE_COUNTRY, location: 'Factory' }), sub: statusNote(site('Factory')) });
  }
  tiles.push({ label: 'Warranty ≤90d', color: '#d97706', value: stats.warrantyExpiring || 0, href: '/maintenance.html',
    sub: srv ? `assets · servers <b>${fmt(srv.warrantyExpiring)}</b>` : 'assets' });
  tiles.push({ label: 'Open Repairs', color: '#dc2626', value: stats.openRepairs || 0, href: '/maintenance.html',
    sub: 'in maintenance log' });
  tiles.push({ label: 'Licenses ≤30d', color: '#0891b2', value: lic ? lic.expiring : 0, href: '/licenses.html',
    sub: lic ? `of <b>${fmt(lic.total)}</b> licenses` : '' });
  tiles.push({ label: 'Servers', color: '#1a56db', value: srv ? srv.total : 0, href: '/server-inventory.html',
    sub: srv ? (Object.entries(srv.byStatus || {}).map(([k, v]) => `<b>${fmt(v)}</b> ${escHtml(k).toLowerCase()}`).join(' · ') || '—') : '…' });
  grid.innerHTML = tiles.map(kpiTile).join('');

  // Licenses / servers come from their own modules — fetch, then re-render once.
  const want = scope || '';
  if (!lic && !_opsExtra.licPending) {
    _opsExtra.licPending = true;
    apiGet('/api/licenses/stats').then(r => { _opsExtra.lic = r; renderOps(stats, scopedTo); }).catch(() => {});
  }
  if ((!srv || srv._scope !== want) && _opsExtra.srvPending !== want) {
    _opsExtra.srvPending = want;
    apiGet('/api/servers/stats' + (want ? '?country=' + encodeURIComponent(want) : ''))
      .then(r => { r._scope = want; _opsExtra.srv = r; if (want === (scopedTo || dashScope || '')) renderOps(stats, scopedTo); })
      .catch(() => {});
  }
}

// ── User Inventory (personnel) tiles — split by country, follow the country switch ──
let _personnel = null;
async function loadPersonnelSummary() {
  try {
    _personnel = await apiGet('/api/personnel/summary');
    document.getElementById('personnel-section').style.display = '';
    renderPersonnel();
  } catch (e) {
    // user without personnel access — leave the section hidden
  }
}

function renderPersonnel() {
  const grid = document.getElementById('personnel-grid');
  if (!grid || !_personnel) return;
  const rows = _personnel.breakdown || [];
  const scope = (window.CURRENT_USER && window.CURRENT_USER.country) || dashScope;
  const metrics = [
    { label: 'Total People',     color: '#4338ca', test: () => true,                              params: {} },
    { label: 'Hayat: No',        color: '#dc2626', test: r => r.user_type === 'No Hayat Member', params: { user_type: 'No Hayat Member' } },
    { label: 'Leaving set',      color: '#d97706', test: r => r.leaving === 1,                    params: {} },
    { label: 'To Be Delete',     color: '#ca8a04', test: r => r.status === 'to be delete',        params: { status: 'to be delete' } },
    { label: 'Confirmed Delete', color: '#ea580c', test: r => r.status === 'pending delete',      params: { status: 'pending delete' } },
    { label: 'Deleted',          color: '#b91c1c', test: r => r.status === 'deleted',             params: { status: 'deleted' } },
  ];
  const count = (m, country) => rows.filter(r => (!country || r.country === country) && m.test(r)).reduce((n, r) => n + r.cnt, 0);
  const uiLink = (params) => '/user-inventory.html' + (Object.values(params).some(Boolean)
    ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString() : '');
  const totalIn = (country) => count(metrics[0], country);

  grid.innerHTML = metrics.map(m => {
    const value = count(m, scope);
    let sub;
    if (scope) {
      const tot = totalIn(scope);
      sub = m === metrics[0] ? escHtml(scope) : `${tot ? ((value / tot) * 100).toFixed(1) : '0.0'}% of ${escHtml(scope)}`;
    } else {
      sub = COUNTRIES.map(c => `<a class="kpi-split" href="${uiLink({ ...m.params, country: c })}" title="${c}">${COUNTRY_SHORT[c]} <b>${fmt(count(m, c))}</b></a>`).join('');
    }
    return kpiTile({ label: m.label, color: m.color, value, href: uiLink({ ...m.params, country: scope }), sub });
  }).join('');
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
// ── Needs Attention — Missing Info (shared panel, js/needs-attention.js) ──
let naPanel = null;

// ── Save handler (modal save on dashboard page) ───────────────────────────────
let _saveMode = 'add';

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  naPanel = NeedsAttention({ root: document.getElementById('na-root'), mode: 'missing',
    scope: () => dashScope, showOpenLink: true });
  loadPersonnelSummary();               // User Inventory summary cards
  // Consolidated notifications (all scopes) — next to Top Models; keep the box when there are none.
  Promise.resolve(loadAlertBox('alert-box', '')).then(() => {
    const box = document.getElementById('alert-box');
    if (box && !box.innerHTML.trim()) {
      box.innerHTML = '<div class="card"><div class="card-header"><span class="card-title">🔔 Alerts</span></div><div class="card-body"><div class="text-muted text-sm">No alerts.</div></div></div>';
    }
  });

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
    if (locationApplies(data.country) && !data.location) { showToast('Please select a location (Office / Factory)', 'error'); return; }
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
