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
    compliant: v('f-compliant'), asset: v('f-asset'),
    stale: extra === 'stale' ? '1' : '', user: extra === 'nouser' ? 'none' : '', enabled: extra === 'disabled' ? '0' : '',
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
    if (!r.data.length) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><p>No devices. An IT admin can import the Intune / Entra exports.</p></div></td></tr>';
    } else {
      tbody.innerHTML = r.data.map(d => `
        <tr>
          <td><strong>${dEsc(d.name || '—')}</strong>${d.account_enabled === 0 ? ' <span class="badge badge-broken" title="Disabled in Entra">disabled</span>' : ''}
            <br><span class="text-muted text-sm">${dEsc([d.manufacturer, d.model].filter(Boolean).join(' · ') || '—')}</span></td>
          <td class="text-sm">${dEsc(d.country || 'Unknown')}</td>
          <td class="text-sm">${d.user_upn
            ? `${d.person_id ? `<a href="/user-inventory.html?search=${encodeURIComponent(d.user_upn)}" title="Open in User Inventory">${dEsc(d.user_name || d.user_upn)}</a>` : dEsc(d.user_name || d.user_upn)}
               <br><span class="text-muted">${dEsc(d.user_upn)}</span>`
            : '<span class="text-muted">no user</span>'}</td>
          <td class="text-sm">${dEsc(d.os || '—')}<br><span class="text-muted">${dEsc(d.os_version || '')}</span></td>
          <td class="text-sm">${dEsc(d.serial_no || '—')}</td>
          <td class="text-sm">${d.in_intune ? dEsc(d.managed_by || 'Intune') : '<span class="text-muted">Entra only</span>'}
            ${d.ownership ? `<br><span class="text-muted">${dEsc(d.ownership)}</span>` : ''}</td>
          <td>${compliantCell(d.is_compliant)}</td>
          <td>${signInCell(d.last_sign_in)}</td>
          <td class="text-sm">${d.asset_id
            ? `<a href="/inventory.html?edit=${d.asset_id}" title="Open the asset">${dEsc(d.asset_s4 || d.asset_code || d.asset_computer_no || '#' + d.asset_id)}</a>`
            : '<span class="text-muted">—</span>'}</td>
        </tr>`).join('');
    }
    renderDevPagination(r.total, r.page, r.limit);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Could not load devices.</td></tr>';
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
      { label: 'No user', color: '#6b7280', value: s.noUser, sub: 'no primary user / owner', act: () => setExtra('nouser') },
      { label: 'Linked to an asset', color: '#7c3aed', value: s.linkedAsset, sub: 'by Computer No / Serial', act: () => setSel('f-asset', 'linked') },
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
    if (!document.getElementById('f-os').dataset.filled) {
      fill('f-os', s.byOs.filter(x => x.os).map(x => ({ v: x.os, t: `${x.os} (${dFmt(x.count)})` })), 'OS', 'All OS');
      document.getElementById('f-os').dataset.filled = '1';
    }
    if (!document.getElementById('f-country').dataset.filled) {
      const items = s.byCountry.map(x => ({ v: x.country || '__none', t: `${x.country || 'Unknown'} (${dFmt(x.count)})` }));
      fill('f-country', items, 'Country', 'All countries');
      document.getElementById('f-country').dataset.filled = '1';
      if (mySingleCountry()) document.getElementById('f-country').style.display = 'none';
    }
    document.getElementById('last-import').textContent = s.lastImport
      ? `Last import: ${s.lastImport} UTC` : 'No import yet — an IT admin can upload the Intune / Entra exports.';
    document.getElementById('btn-import').style.display = s.canImport ? '' : 'none';
    document.getElementById('btn-fill').style.display = s.canImport ? '' : 'none';
  } catch (e) { /* ignore */ }
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
  if (p.get('search')) document.getElementById('search-input').value = p.get('search');
  refresh();
  setupImport();
  setupFill();
  if (typeof loadAlertButton === 'function') loadAlertButton('alert-btn-slot', '');
  let t;
  document.getElementById('search-input').addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 320); });
  ['f-country', 'f-os', 'f-source', 'f-compliant', 'f-asset', 'f-extra'].forEach(id =>
    document.getElementById(id).addEventListener('change', refresh));
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    ['f-country', 'f-os', 'f-source', 'f-compliant', 'f-asset', 'f-extra'].forEach(id => { document.getElementById(id).value = ''; });
    refresh();
  });
});
