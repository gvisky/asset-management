/* Stocktake — physical audit with QR labels (routes/stocktake.js). Works on a phone. */

const stEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stErr = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
let stCur = null, stData = null, stStop = null, stTab = 'missing';
const stSel = new Set();            // assets ticked for label printing
let stOpen = new Set();             // model groups opened (all closed until you open one)

function stSiteLabel(t) { return t.country + (t.site ? ' · ' + t.site : ''); }
// Filters of a stocktake (status / asset type / department) as text.
function stFilter(t) { return [t.status_filter, t.asset_type, t.department].filter(Boolean).map(stEsc).join(' · '); }
const stIsAdmin = () => !!(window.CURRENT_USER && window.CURRENT_USER.role === 'admin');

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
          <div class="text-muted text-sm">${stEsc(stSiteLabel(t))}${stFilter(t) ? ' · <b>' + stFilter(t) + '</b>' : ''} · started ${stEsc(String(t.created_at).slice(0, 10))} by ${stEsc(t.created_by)}</div></div>
        <div class="st-prog"><div class="mb"><i style="width:${pct}%"></i></div><span class="text-sm">${t.result
          ? `${t.result.found} found · <b style="color:#dc2626">${t.result.missing} missing</b> · ${t.result.elsewhere} elsewhere · ${t.result.unknown} unknown`
          : `${t.scans} scanned of ${t.expected}`}</span></div></a>`; }).join('')
      : '<div class="empty-state"><p>No stocktake yet. Start one for a country or a Vietnam site, print QR labels, then scan.</p></div>'}</div></div>`;
}

async function openTake(id) {
  if (stCur !== id) { stSel.clear(); stOpen = new Set(); }
  stCur = id;
  try { stData = await apiGet('/api/stocktake/' + id); } catch (e) { showToast(stErr(e, 'Could not open'), 'error'); return; }
  renderTake();
}

// One asset line (click = label preview; checkbox = pick for printing; ✏️ = quick edit on this page).
const stReal = (v) => (v && String(v).trim() !== '0' ? String(v).trim() : '');
function stAge(d) {
  const t = Date.parse(d); if (!stReal(d) || isNaN(t)) return '';
  const y = (Date.now() - t) / (365.25 * 864e5);
  return y < 1 ? `${Math.max(0, Math.round(y * 12))} mo` : `${y.toFixed(1)} y`;
}
const stBrokenLaptop = (a) => a.status === 'Broken' && String(a.asset_type || '').trim().toLowerCase() === 'laptop';
// Parts column of a broken laptop: one chip per part (✓ usable · ✗ broken · ↪ used as spare · ? not checked).
const ST_PARTS = [['screen', 'Screen', 'Scr'], ['mainboard', 'Mainboard', 'MB'], ['ram', 'RAM', 'RAM'], ['keyboard', 'Keyboard', 'KB'], ['battery', 'Battery', 'Bat'], ['storage', 'SSD / Storage', 'SSD'], ['charger', 'Charger', 'Chg']];
const ST_PMARK = { ok: ['✓', 'usable', 'pt-ok'], bad: ['✗', 'broken', 'pt-bad'], used: ['↪', 'used as spare', 'pt-used'], '': ['?', 'not checked', 'pt-unk'] };
function stPartsCell(a) {
  const p = a.partsState; if (!p) return '';
  if (p.total) return '<span class="pchip pt-bad" title="Total broken — no part can be used">✗ Total broken</span>';
  return ST_PARTS.map(([k, name, s]) => { const m = ST_PMARK[p[k] || ''] || ST_PMARK['']; return `<span class="pchip ${m[2]}" title="${name}: ${m[1]}">${m[0]} ${s}</span>`; }).join('');
}
function assetRow(a, extra = '') {
  const id = a.asset_id || a.id;
  const holder = a.status === 'Broken' ? '' : stReal(a.user_name) || stReal(a.ad_name);
  const bought = stReal(a.purchase_date) ? `Bought ${stEsc(String(a.purchase_date).slice(0, 10))} · ${stAge(a.purchase_date)}` : '<span class="sg-miss">no purchase date</span>';
  const warr = stReal(a.warranty_expiry) ? (Date.parse(a.warranty_expiry) < Date.now() ? '<span class="sg-miss">warranty ended</span>' : `warranty to ${stEsc(String(a.warranty_expiry).slice(0, 10))}`) : '';
  return `<div class="sg-row${stSel.has(id) ? ' sel' : ''}" onclick="LabelPrint.preview(${id}, stPaper())" title="Click to preview its QR label">
    <input type="checkbox" ${stSel.has(id) ? 'checked' : ''} onclick="event.stopPropagation();stPick(${id}, this.checked)">
    <span><b>${stEsc(a.asset_s4 || a.asset_code || '#' + id)}</b><div class="text-muted text-sm">${[stEsc(a.asset_type || ''), a.asset_s4 && stReal(a.asset_code) ? 'ECC ' + stEsc(a.asset_code) : ''].filter(Boolean).join(' · ')}</div></span>
    <span class="text-sm">SN ${stEsc(stReal(a.serial_no) || '—')}<div class="text-muted">${stEsc(stReal(a.computer_no))}</div></span>
    <span class="text-sm">${stEsc(a.country || '')}${stReal(a.location) ? ' · ' + stEsc(a.location) : ''}<div class="text-muted">${holder ? '👤 ' + stEsc(holder) : ''}${stReal(a.department) ? (holder ? ' · ' : '') + stEsc(a.department) : ''}</div></span>
    <span class="text-sm sg-more">${bought}${warr ? ' · ' + warr : ''}<div class="text-muted">${a.condition ? '🔩 <b>' + stEsc(a.condition) + '</b>' + (stReal(a.remark) ? ' · ' : '') : ''}${stEsc(stReal(a.remark)).slice(0, 90)}</div></span>
    <span class="sg-parts">${stPartsCell(a)}</span>
    <span>${statusBadge(a.status)}</span>
    <span class="sg-x" onclick="event.stopPropagation()">${extra}${canEdit() ? ` <button class="btn btn-ghost btn-sm" onclick="QuickEdit.open(${id}, stReload)" title="${stBrokenLaptop(a) ? 'Update its spare parts' : 'Edit this asset here'}">${stBrokenLaptop(a) ? '🔩 Parts' : '✏️ Edit'}</button>` : ''}</span></div>`;
}
// After a quick edit: reload the lists (keeps the tab, open groups and ticks).
async function stReload() { if (!stCur) return; try { stData = await apiGet('/api/stocktake/' + stCur); renderBody(); } catch {} }
// A list grouped by model (biggest first), with a select-all box per model.
function groupedList(items, extraFn) {
  const m = new Map();
  for (const a of items) { const k = a.brand_model || '(model not set)'; if (!m.has(k)) m.set(k, []); m.get(k).push(a); }
  const gs = [...m.entries()].sort((x, y) => (x[0] === '(model not set)') - (y[0] === '(model not set)') || y[1].length - x[1].length || x[0].localeCompare(y[0]));
  return gs.map(([model, list]) => {
    const ids = list.map(a => a.asset_id || a.id), n = ids.filter(i => stSel.has(i)).length, open = stOpen.has(model);
    return `<div class="sg"><div class="sg-head" onclick="stToggle(${jsArg(model)})">
        <input type="checkbox" ${n === ids.length ? 'checked' : ''} ${n && n < ids.length ? 'data-half="1"' : ''} onclick="event.stopPropagation();stPickGroup(${jsArg(ids.join(','))}, this.checked)" title="Select all of this model">
        <span class="lg-caret">${open ? '▾' : '▸'}</span><b>${stEsc(model)}</b> <span class="text-muted text-sm">${stEsc([...new Set(list.map(a => a.asset_type).filter(Boolean))].join(', '))}</span><span class="lg-n">${n ? `<b>${n}</b> / ` : ''}${list.length}</span></div>
      ${open ? list.map(a => assetRow(a, extraFn ? extraFn(a) : '')).join('') : ''}</div>`;
  }).join('');
}
function stExpandAll() {
  const ms = [...new Set(stTabItems().map(a => a.brand_model || '(model not set)'))];
  stOpen = ms.every(m => stOpen.has(m)) ? new Set() : new Set(ms); renderBody();
}
function stToggle(model) { if (stOpen.has(model)) stOpen.delete(model); else stOpen.add(model); renderBody(); }
function stPick(id, on) { on ? stSel.add(id) : stSel.delete(id); renderBody(); }
function stPickGroup(ids, on) { for (const id of String(ids).split(',').map(Number)) on ? stSel.add(id) : stSel.delete(id); renderBody(); }
function stTabItems() { const d = stData; return stTab === 'missing' ? d.missing : stTab === 'found' ? d.found : stTab === 'elsewhere' ? d.elsewhere : stTab === 'outside' ? (d.outside || []) : []; }
function stPickAll(on) { for (const a of stTabItems()) on ? stSel.add(a.asset_id || a.id) : stSel.delete(a.asset_id || a.id); renderBody(); }
// Paper: tall 6.5 × 14 cm by default for a Broken stocktake (spare parts on the label), else the A4 sheet.
function stPaper() { const el = document.getElementById('st-paper'); return el ? el.value : 'sheet'; }

// Header (with the camera) is drawn once per stocktake; counts and lists are redrawn after each scan.
function renderTake() {
  const d = stData, t = d.stocktake, open = t.status === 'open' && canEdit();
  if (!document.getElementById('st-head') || Number(document.getElementById('st-head').dataset.id) !== t.id || document.getElementById('st-head').dataset.status !== t.status) {
    stopCam();
    document.getElementById('st-main').innerHTML = `
    <div class="st-head card" id="st-head" data-id="${t.id}" data-status="${stEsc(t.status)}">
      <div class="st-h1"><a href="#" onclick="loadList(); return false">← Stocktakes</a> · <b>${stEsc(t.name)}</b>
        <span class="badge ${t.status === 'open' ? 'badge-active' : 'badge-retired'}">${t.status}</span></div>
      <div class="text-muted text-sm">${stEsc(stSiteLabel(t))}${stFilter(t) ? ' · only <b>' + stFilter(t) + '</b>' : ''} · started ${stEsc(String(t.created_at).slice(0, 16))} UTC by ${stEsc(t.created_by)}${t.closed_at ? ` · closed ${stEsc(String(t.closed_at).slice(0, 16))} UTC` : ''}</div>
      <div class="st-big" id="st-big"></div>
      ${open ? `<div class="st-actions">
        <button class="btn btn-primary" id="st-cam-btn" onclick="toggleCam()">📷 Scan with camera</button>
        <form class="st-manual" onsubmit="manualScan(event)"><input class="form-control" id="st-code" placeholder="…or type asset code / serial / PC name" autocomplete="off"><button class="btn btn-ghost">Add</button></form>
        <button class="btn btn-ghost" onclick="LabelsPanel.toggle({ country: ${jsArg(t.country)}, site: ${jsArg(t.site || '')}, paper: ${jsArg(t.status_filter === 'Broken' ? 'tall' : 'sheet')} })">🏷 All QR labels</button>
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
  const tabs = [['missing', t.status === 'open' ? '❌ Not scanned yet' : '❌ Missing', d.missing.length], ['elsewhere', '📍 Found elsewhere', d.elsewhere.length],
    ...((d.outside || []).length ? [['outside', '🔸 Here, not in this list', d.outside.length]] : []), ['unknown', '❓ Unknown', d.unknown.length], ['found', '✅ Found', d.found.length]];
  const photoBtn = (s) => (stIsAdmin() && open ? ` <button class="btn btn-ghost btn-sm" onclick="photoFor(${s.asset_id})" title="Take / add a photo">📷${s.photos ? ' ' + s.photos : ''}</button>` : (s.photos ? ` <span title="photos">📷 ${s.photos}</span>` : ''));
  const timeBy = (x) => `<span class="text-muted text-sm">${stEsc(String(x.scanned_at).slice(11, 16))} · ${stEsc(x.scanned_by)}</span>`;
  let list = '';
  if (stTab === 'missing') list = groupedList(d.missing);
  if (stTab === 'found') list = groupedList(d.found, (x) => timeBy(x) + photoBtn(x));
  if (stTab === 'outside') list = groupedList(d.outside || [], (x) => `<span class="text-muted text-sm">${stEsc(x.department || '')}</span>${photoBtn(x)}`);
  if (stTab === 'elsewhere') list = groupedList(d.elsewhere, (x) => (open ? `<button class="btn btn-ghost btn-sm" onclick="moveHere(${x.asset_id})">Move here (${stEsc(stSiteLabel(t))})</button>` : ''));
  if (stTab === 'unknown') list = d.unknown.map(x => `<div class="sg-row sg-unk"><span></span><span><b>${stEsc(x.code)}</b></span>
     <span class="text-muted text-sm">${stEsc(String(x.scanned_at).slice(0, 16))} · ${stEsc(x.scanned_by)}${x.note ? ' · ' + stEsc(x.note) : ''}</span><span></span><span class="sg-more"></span><span class="sg-parts"></span><span></span>
     <span class="sg-x"><a class="btn btn-ghost btn-sm" href="/inventory.html?search=${encodeURIComponent(x.code)}">Look up / add →</a></span></div>`).join('');
  const prevPaper = stPaper(), defPaper = document.getElementById('st-paper') ? prevPaper : (t.status_filter === 'Broken' ? 'tall' : 'sheet');
  document.getElementById('st-body').innerHTML = `<div class="st-tabs">${tabs.map(([k, l, n]) => `<button class="st-tab${stTab === k ? ' on' : ''}" onclick="stTab='${k}';stOpen=new Set();renderBody()">${l} <b>${n}</b></button>`).join('')}</div>
      ${stTab !== 'unknown' ? `<div class="sg-bar">
        <button class="btn btn-ghost btn-sm" onclick="stPickAll(true)">Select all in this list</button>
        <button class="btn btn-ghost btn-sm" onclick="stPickAll(false)">Clear</button>
        <button class="btn btn-ghost btn-sm" onclick="stExpandAll()">Expand / collapse all</button>
        <span class="text-muted text-sm">${stSel.size ? `${stSel.size} selected` : 'Tick assets (or a whole model) to print their QR labels · click an asset to preview'}</span>
        ${stTabItems().some(a => a.partsState) ? '<span class="text-muted text-sm">Parts: <span class="pchip pt-ok">✓ usable</span><span class="pchip pt-bad">✗ broken</span><span class="pchip pt-used">↪ used as spare</span><span class="pchip pt-unk">? not checked</span></span>' : ''}
        <span style="flex:1"></span>
        <select class="form-control" id="st-paper" style="width:auto">${Object.entries(LabelPrint.PAPERS).map(([k, v]) => `<option value="${k}"${k === defPaper ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" ${stSel.size ? '' : 'disabled'} onclick="LabelPrint.print([...stSel], stPaper())">🖨 Print labels (${stSel.size})</button></div>` : ''}
      <div class="sg-list">${list || '<div class="empty-state" style="padding:24px">Nothing here</div>'}</div>`;
  document.querySelectorAll('.sg-head input[data-half]').forEach(i => { i.indeterminate = true; });
}

const RESULT = { found: ['✅ Found', '#16a34a'], elsewhere: ['📍 Found elsewhere', '#d97706'], outside: ['🔸 Here, but not in this list', '#0891b2'], unknown: ['❓ Unknown code', '#dc2626'] };
async function doScan(code) {
  try {
    const r = await apiPost(`/api/stocktake/${stCur}/scan`, { code });
    const [label, color] = RESULT[r.result] || ['?', '#64748b'];
    const a = r.asset;
    const txt = r.already ? `Already scanned (${label.replace(/^\S+ /, '')})` : label;
    const box = document.getElementById('st-last');
    if (box) box.innerHTML = `<div class="st-res" style="border-color:${r.already ? '#94a3b8' : color}"><b style="color:${r.already ? '#64748b' : color}">${txt}</b> ·
      ${a ? `${stEsc(a.asset_s4 || a.asset_code || '#' + a.id)} · ${stEsc(a.brand_model || '')} · SN ${stEsc(a.serial_no || '—')} · ${stEsc(a.country)}${a.location ? ' · ' + stEsc(a.location) : ''}` : stEsc(code)}
      ${r.scans ? `<span class="text-muted text-sm"> · scanned ${r.scans}× in total</span>` : ''}
      ${a && r.askPhoto ? `<div class="st-photo-ask">📷 Save a photo of this asset? <button class="btn btn-primary btn-sm" onclick="photoFor(${a.id})">Take photo</button>
        <button class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()">Skip</button></div>` : ''}</div>`;
    const fl = document.getElementById('st-flash');
    if (fl) { fl.style.background = r.already ? '#94a3b8' : color; fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); }
    if (navigator.vibrate) navigator.vibrate(r.result === 'found' && !r.already ? 60 : [60, 60, 60]);
    if (!r.already) { stData = await apiGet('/api/stocktake/' + stCur); renderBody(); }
  } catch (e) { showToast(stErr(e, 'Scan failed'), 'error'); }
}
// Admin: photo of the scanned asset, saved on the asset (and linked to this stocktake).
async function photoFor(assetId) {
  const ok = await takeAssetPhoto(assetId, stCur, stData && stData.stocktake ? 'stocktake: ' + stData.stocktake.name : '');
  if (ok) { const ask = document.querySelector('.st-photo-ask'); if (ask) ask.innerHTML = '📷 Photo saved ✓'; stData = await apiGet('/api/stocktake/' + stCur); renderBody(); }
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
  const v = (id) => document.getElementById(id).value;
  const body = { country: v('nt-country'), site: v('nt-site'), name: v('nt-name'), status: v('nt-status'), asset_type: v('nt-type'), department: v('nt-dept') };
  try { const r = await apiPost('/api/stocktake', body); document.getElementById('nt-overlay').classList.remove('open'); showToast(`Started — ${r.expected} assets to find`); openTake(r.id); }
  catch (e) { showToast(stErr(e, 'Could not start'), 'error'); }
}
// Fill the status / type / department lists for the chosen country / site, with how many assets each has.
let ntOpts = null;
async function loadNtOptions() {
  const c = document.getElementById('nt-country').value, site = document.getElementById('nt-site').value;
  const fill = (id, list, all) => { const el = document.getElementById(id), cur = el.value;
    el.innerHTML = `<option value="">${all}</option>` + list.map(o => `<option value="${stEsc(o.v)}">${stEsc(o.v)} (${o.n})</option>`).join('');
    if ([...el.options].some(o => o.value === cur)) el.value = cur; };
  if (!c) { ntOpts = null; ['nt-status', 'nt-type', 'nt-dept'].forEach(id => fill(id, [], 'All')); ntCount(); return; }
  try { ntOpts = await apiGet(`/api/stocktake/options?country=${encodeURIComponent(c)}${site ? '&site=' + encodeURIComponent(site) : ''}`); } catch { ntOpts = null; }
  if (!ntOpts) return;
  fill('nt-status', ntOpts.statuses.filter(o => ['Active', 'Broken', 'Stock'].includes(o.v)), 'All statuses');
  fill('nt-type', ntOpts.types, 'All asset types');
  fill('nt-dept', ntOpts.departments, 'All departments');
  ntCount();
}
function ntCount() {
  const el = document.getElementById('nt-count');
  if (!ntOpts) { el.textContent = ''; return; }
  const f = ['nt-status', 'nt-type', 'nt-dept'].filter(id => document.getElementById(id).value).length;
  el.textContent = f ? 'The count is shown when you press Start (filters combined).' : `${ntOpts.total} assets registered here.`;
}

document.addEventListener('DOMContentLoaded', () => {
  const syncSite = () => { const vn = document.getElementById('nt-country').value === 'Vietnam'; document.getElementById('nt-site-wrap').style.display = vn ? '' : 'none'; if (!vn) document.getElementById('nt-site').value = ''; loadNtOptions(); };
  document.getElementById('btn-new').addEventListener('click', () => { document.getElementById('nt-overlay').classList.add('open'); setTimeout(syncSite, 300); });
  document.getElementById('nt-country').addEventListener('change', syncSite);
  document.getElementById('nt-site').addEventListener('change', loadNtOptions);
  ['nt-status', 'nt-type', 'nt-dept'].forEach(id => document.getElementById(id).addEventListener('change', ntCount));
  ['nt-close', 'nt-cancel'].forEach(id => document.getElementById(id).addEventListener('click', () => document.getElementById('nt-overlay').classList.remove('open')));
  document.getElementById('nt-save').addEventListener('click', newTake);
  const id = Number(location.hash.slice(1));
  const start = (n = 0) => { if (!window.CURRENT_USER && n < 40) return setTimeout(() => start(n + 1), 100);
    if (!canEdit()) document.getElementById('btn-new').style.display = 'none';
    (id ? openTake(id) : loadList()).catch(() => loadList()); };
  start();
});
window.addEventListener('pagehide', stopCam);
