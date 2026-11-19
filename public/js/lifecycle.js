/* ♻ Stock & disposal — Asset Inventory.
   Reuse board: Stock assets move Returned → Wiped → Checked (grade A / B / C, photo) → Ready to reuse; a handover takes them out.
   Disposal: sold / recycled / donated / scrapped / lost — with data-wipe confirmation, buyer, certificate; the asset goes to the
   Recycle Bin and the record stays for the Finance / SAP write-off list. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const COLS = [['', 'In Stock — not checked'], ['returned', 'Returned'], ['wiped', 'Wiped'], ['checked', 'Checked'], ['ready', 'Ready to reuse']];
  const NEXT = { '': 'returned', returned: 'wiped', wiped: 'checked', checked: 'ready' };
  const LABEL = Object.fromEntries(COLS);
  const HELP = { returned: 'Back with IT', wiped: 'Data erased / reset (Intune wipe or re-image)', checked: 'Physical check + condition grade', ready: 'Can be given out today' };
  let tab = 'reuse', R = null, D = null, q = '', type = '', year = '';
  const user = () => window.CURRENT_USER || {};
  const itAdmin = () => user().team === 'IT' && user().role === 'admin';
  const days = (s) => { if (!s) return ''; const t = Date.parse(String(s).replace(' ', 'T') + 'Z'); if (isNaN(t)) return ''; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d + ' d'; };

  function shell() {
    if ($('lc-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="lc-ov"><div class="modal" style="max-width:1250px;width:97vw">
      <div class="modal-header"><span class="modal-title">♻ Stock &amp; disposal</span><span class="nm-tabs small" id="lc-tabs" style="margin-left:14px"></span><span style="flex:1"></span>
        <button class="modal-close" aria-label="Close" onclick="document.getElementById('lc-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="lc-b" style="max-height:78vh;overflow:auto"></div></div></div>`);
  }
  function tabs() {
    $('lc-tabs').innerHTML = [['reuse', '🔄 Return → ready to reuse'], ['disp', '🗑 Disposals & write-off']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('');
    $('lc-tabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
  }
  const title = (a) => `${esc(a.brand_model || a.asset_type || 'Asset')}`;
  function card(a) {
    const nx = NEXT[a.reuse_state || ''];
    return `<div class="lc-card" data-id="${a.id}">
      <div class="lc-t"><a href="/inventory.html?view=${a.id}" onclick="event.preventDefault();typeof onView==='function'?onView(${a.id}):location.href=this.href">${title(a)}</a>${a.reuse_grade ? ` <span class="lc-g g${a.reuse_grade}">${a.reuse_grade}</span>` : ''}</div>
      <div class="lc-s">${esc([a.asset_type, a.asset_s4 || a.asset_code, a.serial_no && 'SN ' + a.serial_no].filter(Boolean).join(' · '))}</div>
      <div class="lc-s">${esc(a.country)}${a.returned_by ? ` · from ${esc(a.returned_by)}` : ''}${a.reuse_at && a.reuse_state ? ` · ${days(a.reuse_at)} in step` : ''}</div>
      ${a.reuse_note ? `<div class="lc-n">${esc(a.reuse_note)}</div>` : ''}
      ${R.canEdit ? `<div class="lc-b">${nx ? `<button class="btn btn-ghost btn-sm" data-next="${nx}">→ ${esc(LABEL[nx])}</button>` : ''}${R.canDispose ? `<button class="btn btn-ghost btn-sm" data-disp title="Dispose / write off">🗑</button>` : ''}</div>` : ''}</div>`;
  }
  function drawReuse() {
    const types = [...new Set(R.rows.map(a => a.asset_type).filter(Boolean))].sort();
    const rows = R.rows.filter(a => (!type || a.asset_type === type) && (!q || [a.brand_model, a.asset_s4, a.asset_code, a.serial_no, a.computer_no, a.returned_by].join(' ').toLowerCase().includes(q)));
    const ready = R.rows.filter(a => a.reuse_state === 'ready'); const byType = {}; ready.forEach(a => { const t = a.asset_type || 'Other'; byType[t] = (byType[t] || 0) + 1; });
    $('lc-b').innerHTML = `
      <div class="us-bar2"><input class="form-control" id="lc-q" placeholder="Search model, code, serial, person…" value="${esc(q)}" style="max-width:260px">
        <select class="filter-select" id="lc-type"><option value="">All types</option>${types.map(t => `<option ${t === type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <span class="text-sm"><b>Ready today:</b> ${ready.length ? Object.entries(byType).map(([t, n]) => `${n} ${esc(t)}`).join(' · ') : 'nothing yet'}</span></div>
      <p class="text-muted text-sm" style="margin:4px 0 10px">A signed ↩ Return to Stock puts the asset in <b>Returned</b>; a ✍ Hand over takes it out. Steps: ${COLS.slice(1).map(([k, l]) => `<b>${l}</b> — ${HELP[k]}`).join(' · ')}.</p>
      <div class="lc-board">${COLS.map(([k, l]) => { const list = rows.filter(a => (a.reuse_state || '') === k);
        return `<div class="lc-col ${k || 'none'}"><div class="lc-h">${l} <span>${list.length}</span></div>${list.slice(0, 80).map(card).join('') || '<div class="lc-empty">—</div>'}${list.length > 80 ? `<div class="lc-empty">+${list.length - 80} more — search to narrow</div>` : ''}</div>`; }).join('')}</div>`;
    $('lc-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; drawReuse(); $('lc-q').focus(); $('lc-q').setSelectionRange(p, p); };
    $('lc-type').onchange = (e) => { type = e.target.value; drawReuse(); };
    $('lc-b').querySelectorAll('[data-next]').forEach(b => b.onclick = () => { const a = R.rows.find(x => x.id === +b.closest('.lc-card').dataset.id); step(a, b.dataset.next, reload); });
    $('lc-b').querySelectorAll('[data-disp]').forEach(b => b.onclick = () => { const a = R.rows.find(x => x.id === +b.closest('.lc-card').dataset.id); dispose(a, reload); });
  }
  function drawDisp() {
    const years = [...new Set(D.rows.map(r => String(r.disposed_on).slice(0, 4)))].sort().reverse();
    const rows = D.rows.filter(r => !year || String(r.disposed_on).startsWith(year));
    const open = rows.filter(r => !r.sap_done && !r.restored).length;
    $('lc-b').innerHTML = `
      <div class="us-bar2"><select class="filter-select" id="lc-yr"><option value="">All years</option>${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <span class="text-sm">${rows.length} disposal${rows.length === 1 ? '' : 's'}${open ? ` · <b style="color:#b45309">${open} not yet written off in SAP</b>` : ''}</span><span style="flex:1"></span>
        <a class="btn btn-primary btn-sm" href="/api/lifecycle/disposals.xlsx${year ? '?year=' + year : ''}" download>📊 Write-off list for Finance (.xlsx)</a></div>
      <p class="text-muted text-sm" style="margin:4px 0 10px">To dispose of an asset open it (or a card in 🔄) and press 🗑 Dispose. The asset moves to the Recycle Bin; this record keeps its codes, cost, book value at disposal, method, buyer, data wipe and certificate. Tick <b>SAP</b> when Finance has written it off.</p>
      <table class="nm-vt"><thead><tr><th>Date</th><th>Asset</th><th>Codes</th><th>Cost / book value</th><th>Method</th><th>Data</th><th>Buyer / price</th><th>Cert.</th><th>SAP</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.restored ? 'lc-rest' : ''}"><td>${esc(r.disposed_on)}</td><td><b>${esc(r.brand_model || r.asset_type)}</b><div class="text-muted text-sm">${esc([r.asset_type, r.serial_no && 'SN ' + r.serial_no, r.country].filter(Boolean).join(' · '))}${r.restored ? ' · <b>restored from the Recycle Bin</b>' : ''}</div></td>
        <td class="text-sm">${esc(r.asset_s4)}${r.asset_code ? '<br>ECC ' + esc(r.asset_code) : ''}${r.cost_center ? '<br>CC ' + esc(r.cost_center) : ''}</td>
        <td class="text-sm">${esc(r.cost)}${r.book_value ? `<br>book ${esc(r.book_value)}` : ''}</td><td class="text-sm">${esc(r.method)}${r.reason ? `<div class="text-muted">${esc(r.reason)}</div>` : ''}</td>
        <td class="text-sm">${esc(r.wiped)}${r.wipe_method ? ' · ' + esc(r.wipe_method) : ''}</td><td class="text-sm">${esc(r.buyer)}${r.price ? ' · ' + esc(r.price) : ''}</td>
        <td>${r.cert_name ? `<a href="/api/lifecycle/disposals/${r.id}/cert" target="_blank" rel="noopener" title="${esc(r.cert_name)}">📎</a>` : ''}</td>
        <td>${r.restored ? '' : D.canEdit ? `<input type="checkbox" data-sap="${r.id}" ${r.sap_done ? 'checked' : ''} title="${r.sap_done ? esc(r.sap_by + ' ' + String(r.sap_at).slice(0, 10)) : 'Written off in SAP?'}">` : r.sap_done ? '✔' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty-state">No disposals yet.</td></tr>'}</tbody></table>`;
    $('lc-yr').onchange = (e) => { year = e.target.value; drawDisp(); };
    $('lc-b').querySelectorAll('[data-sap]').forEach(c => c.onchange = async () => { try { await apiPost(`/api/lifecycle/disposals/${c.dataset.sap}/sap`, { done: c.checked }); D = await apiGet('/api/lifecycle/disposals'); drawDisp(); } catch (e) { showToast(e.message, 'error'); c.checked = !c.checked; } });
  }
  async function draw() {
    tabs(); $('lc-b').innerHTML = '<p class="text-muted">Loading…</p>';
    try { if (tab === 'reuse') { R = await apiGet('/api/lifecycle/reuse'); drawReuse(); } else { D = await apiGet('/api/lifecycle/disposals'); drawDisp(); } }
    catch { $('lc-b').innerHTML = '<p class="text-muted">Could not load.</p>'; }
  }
  async function reload() { if ($('lc-ov') && $('lc-ov').classList.contains('open')) await draw(); if (typeof loadAssets === 'function') loadAssets(typeof currentPage !== 'undefined' ? currentPage : 1); }
  function open(which) { shell(); if (which) tab = which; $('lc-ov').classList.add('open'); draw(); }

  // Small form dialog shared by "next step" and "dispose".
  function dialog(titleHtml, body, okLabel, onOk) {
    if (!$('lc-dlg')) document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="lc-dlg" style="z-index:2600"><div class="modal" style="max-width:560px">
      <div class="modal-header"><span class="modal-title" id="lc-dt"></span><button class="modal-close" aria-label="Close" onclick="document.getElementById('lc-dlg').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="lc-db"></div><div class="modal-footer"><button class="btn btn-ghost" onclick="document.getElementById('lc-dlg').classList.remove('open')">Cancel</button><button class="btn btn-primary" id="lc-ok"></button></div></div></div>`);
    $('lc-dt').innerHTML = titleHtml; $('lc-db').innerHTML = body; $('lc-ok').textContent = okLabel; $('lc-ok').disabled = false;
    $('lc-ok').onclick = async () => { $('lc-ok').disabled = true; try { if (await onOk() !== false) $('lc-dlg').classList.remove('open'); } catch (e) { showToast(e.message || 'Failed', 'error'); } $('lc-ok').disabled = false; };
    $('lc-dlg').classList.add('open');
  }
  const fileB64 = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = bad; r.readAsDataURL(f); });
  // Phone photos are big: shrink to 1600 px JPEG.
  async function photoB64(f) {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(f); });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { mime: 'image/jpeg', b64: c.toDataURL('image/jpeg', 0.8).split(',')[1] };
  }

  function step(a, next, done) {
    const needGrade = next === 'checked' || next === 'ready';
    dialog(`♻ ${esc(a.brand_model || 'Asset')} → ${esc(LABEL[next])}`, `
      <p class="text-muted text-sm" style="margin-top:0">${esc(HELP[next])}.</p>
      ${needGrade ? `<div class="form-label">Condition</div><div class="lc-grades">${[['A', 'Like new'], ['B', 'Normal wear'], ['C', 'Worn / small defect']].map(([g, l]) => `<label><input type="radio" name="lc-gr" value="${g}" ${a.reuse_grade === g ? 'checked' : ''}> <b>${g}</b> ${l}</label>`).join('')}</div>` : ''}
      <div class="form-label" style="margin-top:10px">Note</div><input class="form-control" id="lc-note" value="${esc(a.reuse_note || '')}" placeholder="${next === 'wiped' ? 'e.g. Intune wipe, Windows reset' : 'e.g. scratch on lid, new charger'}">
      ${needGrade ? `<div class="form-label" style="margin-top:10px">Photo (optional)</div><input type="file" id="lc-ph" accept="image/*" capture="environment">` : ''}`,
      `Move to ${LABEL[next]}`, async () => {
        const g = document.querySelector('input[name=lc-gr]:checked');
        if (needGrade && !g) { showToast('Choose the condition A / B / C', 'error'); return false; }
        const f = $('lc-ph') && $('lc-ph').files[0];
        await apiPost(`/api/lifecycle/reuse/${a.id}`, { state: next, grade: g ? g.value : undefined, note: $('lc-note').value, photo: f ? await photoB64(f) : undefined });
        showToast(`Moved to ${LABEL[next]}`); if (done) done();
      });
  }

  function dispose(a, done) {
    const data = /laptop|desktop|tablet|mobile|phone|server|hand terminal/i.test(a.asset_type || '');
    dialog(`🗑 Dispose / write off — ${esc(a.brand_model || 'asset')}`, `
      <p class="text-sm" style="margin-top:0">${esc([a.asset_type, a.asset_s4 || a.asset_code, a.serial_no && 'SN ' + a.serial_no, a.country].filter(Boolean).join(' · '))}</p>
      <div class="lc-form">
        <label>How<select class="form-control" id="ld-m">${['Sold', 'Recycled (e-waste)', 'Donated', 'Scrapped', 'Returned to vendor / leasing', 'Lost / stolen'].map(m => `<option>${m}</option>`).join('')}</select></label>
        <label>Date<input class="form-control" type="date" id="ld-d" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="full">Reason<input class="form-control" id="ld-r" placeholder="e.g. end of life (2018), broken mainboard, replaced"></label>
        <label>Company data${data ? ' <b style="color:#b91c1c">*</b>' : ''}<select class="form-control" id="ld-w"><option value="">—</option><option value="yes">Wiped</option><option value="no data">Holds no data</option><option value="no">Not wiped</option></select></label>
        <label>Wipe method<input class="form-control" id="ld-wm" placeholder="Intune wipe, disk erase, drill…"></label>
        <label>Buyer / recycler<input class="form-control" id="ld-b"></label>
        <label>Sale price<input class="form-control" id="ld-p" placeholder="e.g. 1,500,000 VND"></label>
        <label class="full">Certificate (PDF / photo — recycler, buyer receipt, data-wipe)<input type="file" id="ld-c" accept="application/pdf,image/*"></label>
      </div>
      <p class="text-muted text-sm">The asset moves to the Recycle Bin (an admin can restore it). Cost and book value at disposal are recorded for Finance's write-off list.${data ? ' Devices that can hold company data must be wiped first (or confirmed to hold none).' : ''}</p>`,
      'Dispose', async () => {
        const f = $('ld-c').files[0];
        if (f && f.size > 5 * 1024 * 1024) { showToast('Certificate larger than 5 MB', 'error'); return false; }
        const body = { method: $('ld-m').value, date: $('ld-d').value, reason: $('ld-r').value, wiped: $('ld-w').value, wipe_method: $('ld-wm').value, buyer: $('ld-b').value, price: $('ld-p').value,
          cert: f ? { name: f.name, mime: f.type, b64: await fileB64(f) } : undefined };
        if (!confirm(`Dispose of this asset (${body.method}) and move it to the Recycle Bin?`)) return false;
        await apiPost(`/api/lifecycle/dispose/${a.id}`, body);
        showToast('Disposed — recorded for the write-off list'); if ($('view-overlay')) $('view-overlay').classList.remove('open'); if (done) done();
      });
  }

  // Block in the asset detail (Stock → its reuse step; IT admin → Dispose).
  function assetBox(a) {
    const canEdit = ['admin', 'editor'].includes(user().role);
    const st = a.reuse_state || '', nx = NEXT[st];
    const inFlow = a.status === 'Stock';
    if (!inFlow && !itAdmin()) return '';
    return `<div class="lc-box"><strong style="font-size:13.5px">♻ Stock &amp; disposal</strong>
      ${inFlow ? `<span class="lc-pill ${st || 'none'}">${esc(LABEL[st])}${a.reuse_grade ? ' · grade ' + esc(a.reuse_grade) : ''}</span>${a.reuse_note ? ` <span class="text-muted text-sm">${esc(a.reuse_note)}</span>` : ''}` : ''}
      <span style="flex:1"></span>
      ${inFlow && canEdit && nx ? `<button class="btn btn-ghost btn-sm" id="lc-next">→ ${esc(LABEL[nx])}</button>` : ''}
      ${itAdmin() ? `<button class="btn btn-ghost btn-sm" id="lc-disp">🗑 Dispose / write off</button>` : ''}</div>`;
  }
  function wireBox(a, refresh) {
    const nx = NEXT[a.reuse_state || ''];
    if ($('lc-next')) $('lc-next').onclick = () => step(a, nx, () => { refresh && refresh(); reload(); });
    if ($('lc-disp')) $('lc-disp').onclick = () => dispose(a, reload);
  }
  window.Lifecycle = { open, step, dispose, assetBox, wireBox };
})();
