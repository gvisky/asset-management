/* Opened by scanning an asset's QR label with the phone's normal camera: /scan.html?a=<id>.
   Shows the asset and what can be done: mark it found in an open stocktake, hand over / return, open it. */

const scEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let scAsset = null;

async function loadScan() {
  const id = Number(new URLSearchParams(location.search).get('a'));
  const box = document.getElementById('sc-main');
  if (!id) { box.innerHTML = '<div class="card"><div class="card-body">No asset in this link. <a href="/stocktake.html">Open Stocktake →</a></div></div>'; return; }
  let r;
  try { r = await apiGet('/api/stocktake/asset/' + id); }
  catch (e) { let m = 'Asset not found'; try { m = JSON.parse(e.message).error || m; } catch {} box.innerHTML = `<div class="card"><div class="card-body">${scEsc(m)}</div></div>`; return; }
  const a = scAsset = r.asset;
  const ed = canEdit();
  box.innerHTML = `<div class="card sc-card"><div class="card-body">
    <div class="text-muted text-sm">${scEsc(a.asset_type || 'Asset')} · ${scEsc(a.country)}${a.location ? ' · ' + scEsc(a.location) : ''}</div>
    <h2 style="margin:4px 0 6px">${scEsc(a.asset_s4 || a.asset_code || '#' + a.id)}</h2>
    <div>${statusBadge(a.status)}</div>
    <dl class="sc-dl"><dt>Model</dt><dd>${scEsc(a.brand_model || '—')}</dd><dt>Serial</dt><dd><b>${scEsc(a.serial_no || '—')}</b></dd>
      <dt>Computer No</dt><dd>${scEsc(a.computer_no || '—')}</dd><dt>Holder</dt><dd>${scEsc(a.user_name || a.ad_name || '—')}</dd>
      <dt>Department</dt><dd>${scEsc(a.department || '—')}</dd><dt>Purchased</dt><dd>${scEsc(a.purchase_date || '—')}</dd></dl>
    <div class="sc-actions">
      ${ed ? r.openStocktakes.map(t => `<button class="btn btn-primary" onclick="markFound(${t.id}, this)">✔ Found — ${scEsc(t.name)}</button>`).join('') : ''}
      ${ed && (a.user_name || a.ad_name) ? '<button class="btn btn-ghost" onclick="custodyReturn(scAsset, loadScan)">↩ Return</button>' : ''}
      ${ed && a.status !== 'Broken' ? '<button class="btn btn-ghost" onclick="custodyHandover(scAsset, loadScan)">✍ Hand over</button>' : ''}
      <a class="btn btn-ghost" href="/inventory.html?search=${encodeURIComponent(a.asset_s4 || a.asset_code || a.serial_no || '')}">Open in Asset Inventory →</a>
    </div>
    <div id="sc-docs" style="margin-top:12px"></div></div></div>`;
  custodyDocsHtml(a.id).then(h => { const el = document.getElementById('sc-docs'); if (el) el.innerHTML = '<div class="form-label">Signed records</div>' + h; });
}

async function markFound(tid, btn) {
  btn.disabled = true;
  try {
    const r = await apiPost(`/api/stocktake/${tid}/scan`, { code: String(scAsset.id) });
    const word = { found: '✅ Found', elsewhere: '📍 Found — but registered at another site', unknown: '❓ Unknown' }[r.result] || r.result;
    showToast(r.already ? 'Already scanned in this stocktake' : word);
    btn.textContent = r.already ? '✔ Already scanned' : word;
  } catch (e) { btn.disabled = false; let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
}

// Wait for the signed-in user (auth.js) so the buttons match the account's rights.
function whenUser(fn, n = 0) { if (window.CURRENT_USER || n > 40) fn(); else setTimeout(() => whenUser(fn, n + 1), 100); }
document.addEventListener('DOMContentLoaded', () => whenUser(loadScan));
