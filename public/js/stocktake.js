/* Stocktake — physical audit with QR labels (routes/stocktake.js). Works on a phone. */

const stEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stErr = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
let stCur = null, stData = null, stStop = null, stTab = 'missing';

function stSiteLabel(t) { return t.country + (t.site ? ' · ' + t.site : ''); }

async function loadList() {
  stCur = null; stopCam();
  const list = await apiGet('/api/stocktake');
  const main = document.getElementById('st-main');
  main.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">📷 Stocktakes</span>
      <span class="text-muted text-sm">scan the QR label of each asset · found / found elsewhere / missing / unknown</span></div>
    <div class="st-list">${list.length ? list.map(t => {
      const done = t.result ? t.result.found + t.result.elsewhere : t.scans;
      const pct = t.expected ? Math.min(100, Math.round(done / t.expected * 100)) : 0;
      return `<a class="st-item" href="#${t.id}" onclick="openTake(${t.id}); return false">
        <div><b>${stEsc(t.name)}</b> <span class="badge ${t.status === 'open' ? 'badge-active' : 'badge-retired'}">${t.status === 'open' ? 'open' : 'closed'}</span>
          <div class="text-muted text-sm">${stEsc(stSiteLabel(t))} · started ${stEsc(String(t.created_at).slice(0, 10))} by ${stEsc(t.created_by)}</div></div>
        <div class="st-prog"><div class="mb"><i style="width:${pct}%"></i></div><span class="text-sm">${t.result
          ? `${t.result.found} found · <b style="color:#dc2626">${t.result.missing} missing</b> · ${t.result.elsewhere} elsewhere · ${t.result.unknown} unknown`
          : `${t.scans} scanned of ${t.expected}`}</span></div></a>`; }).join('')
      : '<div class="empty-state"><p>No stocktake yet. Start one for a country or a Vietnam site, print QR labels, then scan.</p></div>'}</div></div>`;
}

async function openTake(id) {
  stCur = id;
  try { stData = await apiGet('/api/stocktake/' + id); } catch (e) { showToast(stErr(e, 'Could not open'), 'error'); return; }
  renderTake();
}

function assetRow(a, extra = '') {
  return `<tr><td><b>${stEsc(a.asset_s4 || a.asset_code || '#' + (a.asset_id || a.id))}</b><div class="text-muted text-sm">${stEsc(a.asset_type || '')}</div></td>
    <td>${stEsc(a.brand_model || '')}<div class="text-muted text-sm">SN ${stEsc(a.serial_no || '—')} · ${stEsc(a.computer_no || '')}</div></td>
    <td class="text-sm">${stEsc(a.country || '')}${a.location ? ' · ' + stEsc(a.location) : ''}<div class="text-muted">${stEsc(a.user_name || '')}</div></td>
    <td class="text-sm">${stEsc(a.status || '')}</td><td style="white-space:nowrap">${extra}</td></tr>`;
}

// Header (with the camera) is drawn once per stocktake; counts and lists are redrawn after each scan.
function renderTake() {
  const d = stData, t = d.stocktake, open = t.status === 'open' && canEdit();
  if (!document.getElementById('st-head') || Number(document.getElementById('st-head').dataset.id) !== t.id || document.getElementById('st-head').dataset.status !== t.status) {
    stopCam();
    document.getElementById('st-main').innerHTML = `
    <div class="st-head card" id="st-head" data-id="${t.id}" data-status="${stEsc(t.status)}">
      <div class="st-h1"><a href="#" onclick="loadList(); return false">← Stocktakes</a> · <b>${stEsc(t.name)}</b>
        <span class="badge ${t.status === 'open' ? 'badge-active' : 'badge-retired'}">${t.status}</span></div>
      <div class="text-muted text-sm">${stEsc(stSiteLabel(t))} · started ${stEsc(String(t.created_at).slice(0, 16))} UTC by ${stEsc(t.created_by)}${t.closed_at ? ` · closed ${stEsc(String(t.closed_at).slice(0, 16))} UTC` : ''}</div>
      <div class="st-big" id="st-big"></div>
      ${open ? `<div class="st-actions">
        <button class="btn btn-primary" id="st-cam-btn" onclick="toggleCam()">📷 Scan with camera</button>
        <form class="st-manual" onsubmit="manualScan(event)"><input class="form-control" id="st-code" placeholder="…or type asset code / serial / PC name" autocomplete="off"><button class="btn btn-ghost">Add</button></form>
        <a class="btn btn-ghost" href="/labels.html?country=${encodeURIComponent(t.country)}${t.site ? '&site=' + encodeURIComponent(t.site) : ''}" target="_blank" rel="noopener">🏷 Print labels</a>
        <button class="btn btn-ghost" onclick="closeTake()">Close stocktake</button></div>` : ''}
      <div id="st-cam" class="st-cam" hidden><video id="st-video" playsinline muted></video><div id="st-flash" class="st-flash"></div></div>
      <div id="st-last" class="st-last"></div>
    </div>
    <div class="card" id="st-body"></div>`;
  }
  renderBody();
}
function renderBody() {
  const d = stData, t = d.stocktake, open = t.status === 'open' && canEdit();
  const pct = d.expected ? Math.min(100, Math.round(d.found.length / d.expected * 100)) : 0;
  document.getElementById('st-big').innerHTML = `<div class="mb"><i style="width:${pct}%"></i></div><b>${pct}%</b> <span class="text-sm">${d.found.length} of ${d.expected} found · ${d.elsewhere.length} found elsewhere · ${d.unknown.length} unknown · ${d.missing.length} ${t.status === 'open' ? 'not scanned yet' : 'missing'}</span>`;
  const tabs = [['missing', t.status === 'open' ? '❌ Not scanned yet' : '❌ Missing', d.missing.length], ['elsewhere', '📍 Found elsewhere', d.elsewhere.length], ['unknown', '❓ Unknown', d.unknown.length], ['found', '✅ Found', d.found.length]];
  let rows = '';
  if (stTab === 'missing') rows = d.missing.map(a => assetRow(a)).join('');
  if (stTab === 'found') rows = d.found.map(s => assetRow(s, `<span class="text-muted text-sm">${stEsc(String(s.scanned_at).slice(11, 16))} · ${stEsc(s.scanned_by)}</span>`)).join('');
  if (stTab === 'elsewhere') rows = d.elsewhere.map(s => assetRow(s, open ? `<button class="btn btn-ghost btn-sm" onclick="moveHere(${s.asset_id})">Move here (${stEsc(stSiteLabel(t))})</button>` : '')).join('');
  if (stTab === 'unknown') rows = d.unknown.map(s => `<tr><td colspan="4"><b>${stEsc(s.code)}</b> <span class="text-muted text-sm">· ${stEsc(String(s.scanned_at).slice(0, 16))} · ${stEsc(s.scanned_by)}${s.note ? ' · ' + stEsc(s.note) : ''}</span></td>
     <td><a class="btn btn-ghost btn-sm" href="/inventory.html?search=${encodeURIComponent(s.code)}">Look up / add →</a></td></tr>`).join('');
  document.getElementById('st-body').innerHTML = `<div class="st-tabs">${tabs.map(([k, l, n]) => `<button class="st-tab${stTab === k ? ' on' : ''}" onclick="stTab='${k}';renderBody()">${l} <b>${n}</b></button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Asset</th><th>Model / serial</th><th>Registered at</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty-state">Nothing here</td></tr>'}</tbody></table></div>`;
}

const RESULT = { found: ['✅ Found', '#16a34a'], elsewhere: ['📍 Found elsewhere', '#d97706'], unknown: ['❓ Unknown code', '#dc2626'] };
async function doScan(code) {
  try {
    const r = await apiPost(`/api/stocktake/${stCur}/scan`, { code });
    const [label, color] = RESULT[r.result] || ['?', '#64748b'];
    const a = r.asset;
    const txt = r.already ? `Already scanned (${label.replace(/^\S+ /, '')})` : label;
    const box = document.getElementById('st-last');
    if (box) box.innerHTML = `<div class="st-res" style="border-color:${r.already ? '#94a3b8' : color}"><b style="color:${r.already ? '#64748b' : color}">${txt}</b> ·
      ${a ? `${stEsc(a.asset_s4 || a.asset_code || '#' + a.id)} · ${stEsc(a.brand_model || '')} · SN ${stEsc(a.serial_no || '—')} · ${stEsc(a.country)}${a.location ? ' · ' + stEsc(a.location) : ''}` : stEsc(code)}</div>`;
    const fl = document.getElementById('st-flash');
    if (fl) { fl.style.background = r.already ? '#94a3b8' : color; fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); }
    if (navigator.vibrate) navigator.vibrate(r.result === 'found' && !r.already ? 60 : [60, 60, 60]);
    if (!r.already) { stData = await apiGet('/api/stocktake/' + stCur); renderBody(); }
  } catch (e) { showToast(stErr(e, 'Scan failed'), 'error'); }
}
function manualScan(e) { e.preventDefault(); const i = document.getElementById('st-code'); const v = i.value.trim(); if (v) { doScan(v); i.value = ''; } }

// Camera on / off (the header with the video is not redrawn while scanning).
async function toggleCam() {
  const box = document.getElementById('st-cam'), btn = document.getElementById('st-cam-btn');
  if (!box.hidden) { stopCam(); box.hidden = true; btn.textContent = '📷 Scan with camera'; return; }
  box.hidden = false; btn.textContent = '■ Stop camera';
  try { stStop = await startQrScanner(document.getElementById('st-video'), (code) => doScan(code)); }
  catch (e) { box.hidden = true; btn.textContent = '📷 Scan with camera'; showToast((e && e.message) || 'Camera not available — type the code instead', 'error'); }
}
function stopCam() { if (stStop) { try { stStop(); } catch {} } stStop = null; }

async function moveHere(assetId) {
  if (!confirm('Record this asset at this stocktake\'s country / site? (written to its History Usage)')) return;
  try { await apiPost(`/api/stocktake/${stCur}/move/${assetId}`, {}); showToast('Location updated'); openTake(stCur); }
  catch (e) { showToast(stErr(e, 'Could not move'), 'error'); }
}
async function closeTake() {
  const d = stData;
  if (!confirm(`Close this stocktake?\n\n${d.found.length} found · ${d.elsewhere.length} elsewhere · ${d.unknown.length} unknown\n${d.missing.length} not scanned → counted as MISSING (possible ghost assets).`)) return;
  try { await apiPost(`/api/stocktake/${stCur}/close`, {}); stopCam(); showToast('Stocktake closed'); openTake(stCur); }
  catch (e) { showToast(stErr(e, 'Could not close'), 'error'); }
}

async function newTake() {
  const country = document.getElementById('nt-country').value, site = document.getElementById('nt-site').value, name = document.getElementById('nt-name').value;
  try { const r = await apiPost('/api/stocktake', { country, site, name }); document.getElementById('nt-overlay').classList.remove('open'); showToast(`Started — ${r.expected} assets to find`); openTake(r.id); }
  catch (e) { showToast(stErr(e, 'Could not start'), 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  const syncSite = () => { const vn = document.getElementById('nt-country').value === 'Vietnam'; document.getElementById('nt-site-wrap').style.display = vn ? '' : 'none'; if (!vn) document.getElementById('nt-site').value = ''; };
  document.getElementById('btn-new').addEventListener('click', () => { document.getElementById('nt-overlay').classList.add('open'); setTimeout(syncSite, 300); });
  document.getElementById('nt-country').addEventListener('change', syncSite);
  ['nt-close', 'nt-cancel'].forEach(id => document.getElementById(id).addEventListener('click', () => document.getElementById('nt-overlay').classList.remove('open')));
  document.getElementById('nt-save').addEventListener('click', newTake);
  const id = Number(location.hash.slice(1));
  const start = (n = 0) => { if (!window.CURRENT_USER && n < 40) return setTimeout(() => start(n + 1), 100);
    if (!canEdit()) document.getElementById('btn-new').style.display = 'none';
    (id ? openTake(id) : loadList()).catch(() => loadList()); };
  start();
});
window.addEventListener('pagehide', stopCam);
