/* Inventory → 📚 Models & warranty.
   Clean-up: the Brand/Model texts in use grouped into suggested models (same model typed many ways); IT confirms a name and
   asset type per group → assets renamed, empty asset types filled, model added to the catalogue.
   Catalogue: one row per model (maker, type, warranty years, end of support). Warranty: serials to check on the vendor site,
   upload the vendor result, or estimate from purchase date + model warranty years. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const TYPES = ['Laptop', 'Desktop', 'Screen', 'Tablet', 'Mobile phone', 'IP phone', 'Printer', 'Hand terminals', 'Camera', 'License', 'Live Stream', 'Data Center'];
  const VENDOR = { Lenovo: 'https://pcsupport.lenovo.com/warranty-lookup', Dell: 'https://www.dell.com/support/home', HP: 'https://support.hp.com/checkwarranty' };
  let tab = 'clean', data = null, war = null, q = '', onlyEmpty = false, preview = null, est = null;

  function shell() {
    if ($('mc-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="mc-ov"><div class="modal" style="max-width:1150px;width:96vw">
      <div class="modal-header"><span class="modal-title">📚 Models &amp; warranty</span>
        <span class="nm-tabs small" id="mc-tabs" style="margin-left:14px"></span><span style="flex:1"></span>
        <button class="modal-close" aria-label="Close" onclick="document.getElementById('mc-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="mc-b" style="max-height:76vh;overflow:auto"></div></div></div>
      <datalist id="mc-types">${TYPES.map(t => `<option value="${t}">`).join('')}</datalist>`);
  }
  function tabs() {
    $('mc-tabs').innerHTML = [['clean', '🧹 Clean-up'], ['cat', '📚 Catalogue'], ['war', '🛡 Warranty']]
      .map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('');
    $('mc-tabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
  }
  const canEdit = () => data && data.canEdit;

  // Group names by the key of their clean name; the suggestion is the catalogue name or the clean name of the biggest member.
  function clusters() {
    const by = new Map();
    for (const n of data.names) { if (n.vague) continue; const k = n.key || n.name; if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
    return [...by.values()].map(ms => {
      const inCat = ms.find(m => m.model_id);
      const big = ms.slice().sort((a, b) => b.count - a.count)[0];
      const to = inCat ? inCat.clean : big.clean;
      const types = {}; ms.forEach(m => { if (m.guess) types[m.guess] = (types[m.guess] || 0) + m.count; });
      const type = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
      return { members: ms, to, type: type ? type[0] : '', count: ms.reduce((n, m) => n + m.count, 0), emptyType: ms.reduce((n, m) => n + m.emptyType, 0),
        todo: ms.some(m => m.name !== to) || ms.reduce((n, m) => n + m.emptyType, 0) > 0, inCat: !!inCat };
    }).filter(c => c.todo).sort((a, b) => b.count - a.count);
  }

  function drawClean() {
    const cs = clusters().filter(c => (!onlyEmpty || c.emptyType) && (!q || c.to.toLowerCase().includes(q) || c.members.some(m => m.name.toLowerCase().includes(q))));
    const vague = data.names.filter(n => n.vague);
    const T = data.totals;
    $('mc-b').innerHTML = `
      <div class="us-sum"><div><b>${T.assets}</b><span>assets</span></div><div><b>${T.names}</b><span>Brand/Model texts</span></div>
        <div class="s"><b>${clusters().length}</b><span>groups to tidy</span></div><div class="f"><b>${T.emptyType}</b><span>without Asset Type</span></div></div>
      <p class="text-muted text-sm" style="margin:6px 0 10px">Each group is one model typed in different ways. Check the name and type, untick anything that is not the same model, then apply.
        Assets get the clean name (the old text goes to Remark when it carried extra info such as a serial or a person), empty Asset Types are filled and the model is added to the catalogue. Nothing changes until you press <b>Apply</b>.</p>
      <div class="us-bar2"><input class="form-control" id="mc-q" placeholder="Search a model…" value="${esc(q)}" style="max-width:260px">
        <label class="text-sm"><input type="checkbox" id="mc-oe" ${onlyEmpty ? 'checked' : ''}> only groups with empty Asset Type</label>
        <span style="flex:1"></span>${canEdit() ? `<label class="text-sm"><input type="checkbox" id="mc-all"> select all shown</label>
        <button class="btn btn-primary btn-sm" id="mc-apply">Apply selected</button>` : ''}</div>
      <table class="nm-vt mc-t"><thead><tr>${canEdit() ? '<th></th>' : ''}<th style="width:28%">Clean name</th><th style="width:15%">Asset Type</th><th>Texts in use (assets)</th><th>Assets</th><th>No type</th></tr></thead><tbody>
      ${cs.slice(0, 300).map((c, i) => `<tr data-i="${i}">${canEdit() ? `<td><input type="checkbox" class="mc-sel"></td>` : ''}
        <td>${canEdit() ? `<input class="form-control mc-to" value="${esc(c.to)}">` : esc(c.to)}${c.inCat ? ' <span class="mc-badge">in catalogue</span>' : ''}</td>
        <td>${canEdit() ? `<input class="form-control mc-ty" list="mc-types" value="${esc(c.type)}" placeholder="type">` : esc(c.type)}</td>
        <td class="text-sm">${c.members.length > 8 ? `<details><summary>${c.members.length} texts — ${esc(c.members[0].name)}, ${esc(c.members[1].name)}…</summary>` : ''}${c.members.map(m => `<label class="mc-m${m.name === c.to ? ' same' : ''}">${canEdit() ? `<input type="checkbox" class="mc-mem" value="${esc(m.name)}" checked> ` : ''}${esc(m.name || '(empty)')} <b>${m.count}</b></label>`).join('')}${c.members.length > 8 ? '</details>' : ''}</td>
        <td>${c.count}</td><td>${c.emptyType ? `<span class="us-flag">${c.emptyType}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Nothing to tidy here. 🎉</td></tr>'}
      </tbody></table>
      ${cs.length > 300 ? `<p class="text-muted text-sm">Showing 300 of ${cs.length} — search to narrow.</p>` : ''}
      ${vague.length ? `<h4 style="margin:16px 0 6px">Model unknown — only a brand was typed</h4>
        <p class="text-muted text-sm" style="margin:0 0 6px">These can't be merged automatically. Open the list and type the real model (Intune's model or the sticker under the device).</p>
        <div>${vague.map(v => `<a class="mc-m" href="/inventory.html?search=${encodeURIComponent(v.name)}" target="_blank" rel="noopener">${esc(v.name || '(empty Brand/Model)')} <b>${v.count}</b></a>`).join('')}</div>` : ''}`;
    $('mc-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; drawClean(); $('mc-q').focus(); $('mc-q').setSelectionRange(p, p); };
    $('mc-oe').onchange = (e) => { onlyEmpty = e.target.checked; drawClean(); };
    if (!canEdit()) return;
    $('mc-all').onchange = (e) => $('mc-b').querySelectorAll('.mc-sel').forEach(x => { x.checked = e.target.checked; });
    $('mc-apply').onclick = async () => {
      const groups = [];
      $('mc-b').querySelectorAll('tr[data-i]').forEach(tr => {
        if (!tr.querySelector('.mc-sel').checked) return;
        const from = [...tr.querySelectorAll('.mc-mem:checked')].map(x => x.value);
        const to = tr.querySelector('.mc-to').value.trim();
        if (to && from.length) groups.push({ from, to, asset_type: tr.querySelector('.mc-ty').value.trim() });
      });
      if (!groups.length) return showToast('Tick at least one group', 'error');
      const n = groups.reduce((s, g) => s + g.from.length, 0);
      if (!confirm(`Apply ${groups.length} group${groups.length > 1 ? 's' : ''} (${n} Brand/Model text${n > 1 ? 's' : ''})?\nAssets in your countries get the clean name and empty Asset Types are filled.`)) return;
      try { const r = await apiPost('/api/catalog/merge', { groups });
        showToast(`${r.renamed} asset${r.renamed === 1 ? '' : 's'} renamed · ${r.typed} type${r.typed === 1 ? '' : 's'} filled · ${r.models} model${r.models === 1 ? '' : 's'} in the catalogue`);
        await load(); draw(); if (typeof loadAssets === 'function') loadAssets(1);
      } catch (e) { showToast(e.message || 'Failed', 'error'); }
    };
  }

  function drawCat() {
    const cat = data.catalogue.filter(m => !q || m.name.toLowerCase().includes(q));
    const empty = data.catalogue.filter(m => m.asset_type).reduce((n, m) => n + m.emptyType, 0);
    const row = (m) => canEdit() ? `<tr data-id="${m.id || ''}"><td><input class="form-control" data-f="name" value="${esc(m.name)}"></td>
        <td><input class="form-control" data-f="maker" value="${esc(m.maker)}" style="max-width:110px"></td>
        <td><input class="form-control" data-f="asset_type" list="mc-types" value="${esc(m.asset_type)}" style="max-width:140px"></td>
        <td><input class="form-control" data-f="warranty_years" type="number" min="0" max="10" step="0.5" value="${m.warranty_years == null ? '' : m.warranty_years}" style="max-width:80px"></td>
        <td><input class="form-control" data-f="eos_year" type="number" min="1990" max="2100" value="${m.eos_year == null ? '' : m.eos_year}" style="max-width:90px"></td>
        <td>${m.id ? m.assets : ''}</td><td>${m.emptyType ? `<span class="us-flag">${m.emptyType}</span>` : ''}</td>
        <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-save>💾</button>${m.id ? ` <button class="btn btn-ghost btn-sm" data-del title="Remove from the catalogue (assets keep their text)">🗑</button>` : ''}</td></tr>`
      : `<tr><td>${esc(m.name)}</td><td>${esc(m.maker)}</td><td>${esc(m.asset_type)}</td><td>${m.warranty_years == null ? '' : m.warranty_years}</td><td>${m.eos_year || ''}</td><td>${m.assets}</td><td>${m.emptyType || ''}</td><td></td></tr>`;
    const thisYear = new Date().getFullYear();
    const eosSoon = data.catalogue.filter(m => m.eos_year && m.eos_year <= thisYear + 1 && m.assets);
    $('mc-b').innerHTML = `
      <div class="us-bar2"><input class="form-control" id="mc-q" placeholder="Search a model…" value="${esc(q)}" style="max-width:260px">
        <span class="text-muted text-sm">${data.catalogue.length} model${data.catalogue.length === 1 ? '' : 's'} · Warranty years are used to estimate warranty dates · End of support = last year the maker supports the model</span>
        <span style="flex:1"></span>${canEdit() && empty ? `<button class="btn btn-primary btn-sm" id="mc-fill">Fill ${empty} empty Asset Type${empty > 1 ? 's' : ''}</button>` : ''}</div>
      ${eosSoon.length ? `<p class="text-sm" style="margin:4px 0 8px">⚠ End of support this year or next: ${eosSoon.map(m => `<b>${esc(m.name)}</b> (${m.eos_year}, ${m.assets} asset${m.assets > 1 ? 's' : ''})`).join(', ')}</p>` : ''}
      <table class="nm-vt mc-t"><thead><tr><th>Model</th><th>Maker</th><th>Asset Type</th><th>Warranty (years)</th><th>End of support</th><th>Assets</th><th>No type</th><th></th></tr></thead><tbody>
      ${canEdit() ? row({ name: '', maker: '', asset_type: '', warranty_years: null, eos_year: null }) : ''}
      ${cat.map(row).join('')}${!cat.length ? '<tr><td colspan="8" class="empty-state">No models yet — apply groups in 🧹 Clean-up, or add one above.</td></tr>' : ''}</tbody></table>`;
    $('mc-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; drawCat(); $('mc-q').focus(); $('mc-q').setSelectionRange(p, p); };
    if (!canEdit()) return;
    if ($('mc-fill')) $('mc-fill').onclick = async () => { try { const r = await apiPost('/api/catalog/fill-types', {}); showToast(`${r.typed} Asset Type${r.typed === 1 ? '' : 's'} filled`); await load(); draw(); if (typeof loadAssets === 'function') loadAssets(1); } catch (e) { showToast(e.message, 'error'); } };
    $('mc-b').querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
      const tr = b.closest('tr'), body = { id: tr.dataset.id || undefined };
      tr.querySelectorAll('[data-f]').forEach(i => { body[i.dataset.f] = i.value; });
      try { await apiPost('/api/catalog/models', body); showToast('Model saved'); await load(); draw(); } catch (e) { showToast(e.message, 'error'); }
    });
    $('mc-b').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this model from the catalogue? Assets keep their Brand/Model text.')) return;
      try { await apiDelete('/api/catalog/models/' + b.closest('tr').dataset.id); await load(); draw(); } catch (e) { showToast(e.message, 'error'); }
    });
  }

  // ── Warranty ────────────────────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  function toIso(v) {
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) { let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[3]}-${pad(mo)}-${pad(d)}` : ''; }
    const t = Date.parse(s); if (!isNaN(t) && /[a-z]/i.test(s)) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    return '';
  }
  // Find the serial and warranty-end columns in any sheet of the vendor file; several warranty lines per serial → the latest end.
  function readVendor(wb) {
    const rows = [];
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      for (let h = 0; h < Math.min(aoa.length, 15); h++) {
        const hd = aoa[h].map(x => String(x).toLowerCase().trim());
        const sc = hd.findIndex(x => /serial|service tag|^s\/?n$|^sn\b|machine serial/.test(x));
        let ec = hd.findIndex(x => /warranty end \(fill in\)|end date|warranty end|expir|valid until|coverage end|^end$|ends/.test(x));
        if (sc < 0 || ec < 0) continue;
        for (const r of aoa.slice(h + 1)) { const serial = String(r[sc] || '').trim(), end = toIso(r[ec]); if (serial && end) rows.push({ serial, end }); }
        break;
      }
    }
    return rows;
  }
  async function needXlsx() {
    if (window.XLSX) return;
    await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }

  function drawWar() {
    const W = war, edit = W.canEdit;
    $('mc-b').innerHTML = `
      <div class="us-sum"><div><b>${W.total}</b><span>assets</span></div><div class="f"><b>${W.missing}</b><span>without warranty date</span></div>
        <div class="u"><b>${W.vendor}</b><span>from vendor file</span></div><div class="s"><b>${W.estimated}</b><span>estimated</span></div></div>
      <h4 style="margin:14px 0 6px">① Check the serials on the vendor's site</h4>
      <p class="text-muted text-sm" style="margin:0 0 6px">Download the serials without a warranty date, paste or upload them on the maker's warranty page (most accept a list), and download its result.</p>
      <table class="nm-vt"><thead><tr><th>Maker</th><th>No warranty</th><th>With serial</th><th>Serial list</th><th>Check on</th></tr></thead><tbody>
      ${W.makers.slice(0, 25).map(m => `<tr><td><b>${esc(m.maker)}</b></td><td>${m.missing}</td><td>${m.withSerial}</td>
        <td>${m.withSerial ? `<a class="btn btn-ghost btn-sm" href="/api/catalog/warranty/serials?maker=${encodeURIComponent(m.maker)}&format=txt" download>📄 .txt</a> <a class="btn btn-ghost btn-sm" href="/api/catalog/warranty/serials?maker=${encodeURIComponent(m.maker)}" download>📊 .xlsx</a>` : ''}</td>
        <td>${VENDOR[m.maker] ? `<a href="${VENDOR[m.maker]}" target="_blank" rel="noopener">${esc(m.maker)} warranty ↗</a>` : '<span class="text-muted text-sm">maker\'s support site</span>'}</td></tr>`).join('')}</tbody></table>
      ${edit ? `<h4 style="margin:16px 0 6px">② Upload the vendor result</h4>
      <p class="text-muted text-sm" style="margin:0 0 6px">.xlsx or .csv with a serial column and a warranty end / expiry column — or the .xlsx above with the "Warranty End (fill in)" column filled. Several lines per serial → the latest end date is used. Dates like 10/03/2027 are read day first (10 March). Dates typed by hand are kept unless you tick overwrite; estimated dates are always replaced.</p>
      <div class="us-bar2"><input type="file" id="mc-file" accept=".xlsx,.xls,.csv"><label class="text-sm"><input type="checkbox" id="mc-ow"> overwrite dates typed by hand</label></div>
      <div id="mc-prev"></div>
      <h4 style="margin:16px 0 6px">③ Estimate the rest</h4>
      <p class="text-muted text-sm" style="margin:0 0 6px">Warranty end = purchase date + the model's warranty years (📚 Catalogue). Marked <i>estimated</i> on the asset; a vendor file later replaces it.
        ${W.noYears ? `<b>${W.noYears}</b> asset${W.noYears > 1 ? 's have' : ' has'} a purchase date but the model has no warranty years yet.` : ''}</p>
      <div class="us-bar2"><button class="btn btn-ghost btn-sm" id="mc-est" ${W.estimable ? '' : 'disabled'}>Preview estimate for ${W.estimable} asset${W.estimable === 1 ? '' : 's'}</button></div>
      <div id="mc-estp"></div>` : ''}`;
    if (!edit) return;
    $('mc-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        await needXlsx();
        // CSV: keep every cell as typed (serials keep leading zeros, dates are read day-first below); Excel: real date cells.
        const wb = /\.csv$/i.test(f.name) ? XLSX.read(await f.text(), { type: 'string', raw: true }) : XLSX.read(await f.arrayBuffer(), { cellDates: true });
        const rows = readVendor(wb);
        if (!rows.length) { $('mc-prev').innerHTML = '<p class="text-sm">⚠ No serial + warranty end columns found in this file.</p>'; return; }
        preview = { rows, overwrite: $('mc-ow').checked };
        const r = await apiPost('/api/catalog/warranty/apply', { ...preview, dry: true });
        showPreview(r);
      } catch (err) { showToast(err.message || 'Could not read the file', 'error'); }
    };
    $('mc-est').onclick = async () => {
      est = await apiPost('/api/catalog/warranty/estimate', { dry: true });
      $('mc-estp').innerHTML = `<table class="nm-vt"><thead><tr><th>#</th><th>Model</th><th>Purchase</th><th>Years</th><th>Warranty end</th></tr></thead><tbody>
        ${est.rows.slice(0, 50).map(r => `<tr><td>#${r.id}</td><td>${esc(r.model)}</td><td>${r.purchase}</td><td>${r.years}</td><td>${r.to}</td></tr>`).join('')}</tbody></table>
        ${est.count > 50 ? `<p class="text-muted text-sm">…and ${est.count - 50} more.</p>` : ''}
        <button class="btn btn-primary btn-sm" id="mc-estgo">Set ${est.count} estimated warranty date${est.count === 1 ? '' : 's'}</button>`;
      $('mc-estgo').onclick = async () => { const r = await apiPost('/api/catalog/warranty/estimate', {}); showToast(`${r.count} warranty date${r.count === 1 ? '' : 's'} estimated`); war = await apiGet('/api/catalog/warranty'); drawWar(); };
    };
  }
  function showPreview(r) {
    const c = r.counts;
    $('mc-prev').innerHTML = `<p class="text-sm"><b>${c.set}</b> to set · ${c.same} already the same · ${c.kept} kept (typed by hand) · ${c.unknown} serial${c.unknown === 1 ? '' : 's'} not in your assets</p>
      ${r.set.length ? `<table class="nm-vt"><thead><tr><th>#</th><th>Serial</th><th>Model</th><th>Now</th><th>New</th></tr></thead><tbody>
        ${r.set.slice(0, 50).map(x => `<tr><td>#${x.id}</td><td class="si-sn">${esc(x.serial)}</td><td>${esc(x.model)}</td><td>${esc(x.from || '—')}</td><td><b>${x.to}</b></td></tr>`).join('')}</tbody></table>
        ${r.set.length > 50 ? `<p class="text-muted text-sm">…and ${r.set.length - 50} more.</p>` : ''}
        <button class="btn btn-primary btn-sm" id="mc-go">Apply ${c.set} warranty date${c.set === 1 ? '' : 's'}</button>` : ''}`;
    if ($('mc-go')) $('mc-go').onclick = async () => {
      const res = await apiPost('/api/catalog/warranty/apply', { ...preview, overwrite: $('mc-ow').checked });
      showToast(`${res.counts.set} warranty date${res.counts.set === 1 ? '' : 's'} saved`); war = await apiGet('/api/catalog/warranty'); drawWar();
    };
  }

  async function load() { data = await apiGet('/api/catalog/models'); }
  async function draw() {
    tabs();
    if (tab === 'clean') drawClean();
    else if (tab === 'cat') drawCat();
    else { $('mc-b').innerHTML = '<p class="text-muted">Loading…</p>'; war = await apiGet('/api/catalog/warranty'); drawWar(); }
  }
  async function open(which) {
    shell(); if (which) tab = which; $('mc-ov').classList.add('open'); $('mc-b').innerHTML = '<p class="text-muted">Loading…</p>';
    try { await load(); await draw(); } catch { $('mc-b').innerHTML = '<p class="text-muted">Could not load.</p>'; }
  }
  window.ModelCatalog = { open };
})();
