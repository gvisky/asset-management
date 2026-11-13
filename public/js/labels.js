/* QR labels — list of assets (grouped by model) → tick → print, or click an asset to preview its label.
   Used by the QR labels page (labels.html) and as a panel that opens on the Stocktake page
   (LabelsPanel.toggle({ country, site, paper }) — loaded only when opened, no page change).
   Papers: A4 sheet 3 × 7 (63.5 × 38.1 mm) · label printer 63.5 × 38.1 mm · tall label 65 × 140 mm (with the
   spare parts of broken laptops). The QR opens /scan.html?a=<id> (no personal data on the label).
   QR images are made only for the labels you preview / print; every print is recorded with its purpose. */

(function () {
  const lbEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PAPERS = { sheet: 'A4 sheet · 3 × 7 (63.5 × 38.1 mm)', single: 'Label printer · 63.5 × 38.1 mm', tall: 'Tall label · 6.5 × 14 cm' };
  let lbAll = [], lbAdmin = false, lbOpen = new Set(), ready = false;
  const lbSel = new Set();
  const $ = (id) => document.getElementById(id);

  // Filters + list (the QR labels page has it in its HTML; the Stocktake panel draws it here).
  const MARKUP = `<div class="card lb-panelcard"><div class="card-header"><span class="card-title">🏷 QR labels <span class="text-muted text-sm" style="font-weight:400" id="lb-count"></span></span>
      <button class="btn btn-ghost btn-sm" onclick="LabelsPanel.toggle()">✕ Close</button></div>
    <div class="card-body lb-filters">
      <div><label class="form-label">Country</label><select class="form-control" id="lb-country"><option value="">All countries</option></select></div>
      <div><label class="form-label">Site</label><select class="form-control" id="lb-site"><option value="">All sites</option><option>Office</option><option>Factory</option></select></div>
      <div><label class="form-label">Asset type</label><select class="form-control" id="lb-type"><option value="">All asset types</option></select></div>
      <div><label class="form-label">Status</label><select class="form-control" id="lb-status"><option value="">All statuses</option><option>Active</option><option>Stock</option><option>Broken</option></select></div>
      <div style="flex:1;min-width:200px"><label class="form-label">Search</label><input class="form-control" id="lb-q" type="search" placeholder="Code, serial, PC name, model, user…"></div>
      <div><label class="form-label">Paper</label><select class="form-control" id="lb-mode">${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    </div>
    <div class="lb-toolbar">
      <button class="btn btn-ghost btn-sm" id="lb-all">Select all shown</button>
      <button class="btn btn-ghost btn-sm" id="lb-none">Clear</button>
      <button class="btn btn-ghost btn-sm" id="lb-expand">Expand / collapse all</button>
      <span class="text-muted text-sm" id="lb-selinfo"></span>
      <span style="flex:1"></span>
      <button class="btn btn-primary" id="lb-print" disabled>🖨 Print selected (0)</button>
    </div>
    <div id="lb-list" class="lb-scroll"></div></div>`;

  // ── List ───────────────────────────────────────────────────────────────────
  async function loadList() {
    const v = (id) => $(id).value.trim();
    const q = new URLSearchParams();
    for (const [k, id] of [['country', 'lb-country'], ['site', 'lb-site'], ['type', 'lb-type'], ['status', 'lb-status'], ['q', 'lb-q']]) if (v(id)) q.set(k, v(id));
    $('lb-list').innerHTML = '<p class="text-muted" style="padding:14px">Loading…</p>';
    let r;
    try { r = await apiGet('/api/stocktake/labels/list?' + q); } catch { $('lb-list').innerHTML = '<p class="text-muted" style="padding:14px">Could not load.</p>'; return; }
    lbAll = r.list; lbAdmin = r.isAdmin;
    // Country choices: the countries of the unfiltered list (your countries), "All countries" first.
    const cs = $('lb-country');
    if (!cs.dataset.filled && !q.get('country')) {
      const cc = [...new Set(lbAll.map(a => a.country).filter(Boolean))].sort();
      cs.innerHTML = '<option value="">All countries</option>' + cc.map(c => `<option>${lbEsc(c)}</option>`).join('');
      cs.dataset.filled = '1';
    }
    const ts = $('lb-type'), cur = ts.value;
    ts.innerHTML = '<option value="">All asset types</option>' + r.types.map(t => `<option value="${lbEsc(t.t)}">${lbEsc(t.t)} (${t.n})</option>`).join('');
    ts.value = cur;
    $('lb-count').textContent = `${lbAll.length.toLocaleString()} asset${lbAll.length === 1 ? '' : 's'}${r.limited ? ' (first 3,000 — use the filters)' : ''}`;
    renderList();
  }

  function groups() {
    const m = new Map();
    for (const a of lbAll) { const k = a.model || '(model not set)'; if (!m.has(k)) m.set(k, []); m.get(k).push(a); }
    // Biggest models first (the fleet), single assets later; "(model not set)" last.
    return [...m.entries()].sort((a, b) => (a[0] === '(model not set)') - (b[0] === '(model not set)') || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }

  function renderList() {
    const g = groups();
    const st = (s) => (s ? `<span class="badge ${s === 'Active' ? 'badge-active' : s === 'Broken' ? 'badge-broken' : 'badge-stock'}">${lbEsc(s)}</span>` : '');
    const edit = typeof QuickEdit !== 'undefined' && canEdit();
    $('lb-list').innerHTML = g.length ? g.map(([model, items]) => {
      const n = items.filter(a => lbSel.has(a.id)).length, all = n === items.length;
      const open = lbOpen.has(model);   // collapsed until you open the model you need
      const types = [...new Set(items.map(a => a.type).filter(Boolean))].join(', ');
      return `<div class="lg-group">
        <div class="lg-head" onclick="LabelsPanel.toggleGroup(${jsArg(model)})">
          <input type="checkbox" ${all ? 'checked' : ''} ${n && !all ? 'data-half="1"' : ''} onclick="event.stopPropagation();LabelsPanel.selectGroup(${jsArg(model)}, this.checked)" title="Select all of this model">
          <span class="lg-caret">${open ? '▾' : '▸'}</span><b>${lbEsc(model)}</b> <span class="text-muted text-sm">${lbEsc(types)}</span>
          <span class="lg-n">${n ? `<b>${n}</b> / ` : ''}${items.length}</span></div>
        ${open ? `<div class="lg-rows">${items.map(a => `<div class="lg-row${lbSel.has(a.id) ? ' sel' : ''}" onclick="LabelsPanel.preview(${a.id})" title="Click to preview the label">
            <input type="checkbox" ${lbSel.has(a.id) ? 'checked' : ''} onclick="event.stopPropagation();LabelsPanel.pick(${a.id}, this.checked)">
            <span class="lg-code">${lbEsc(a.code || '#' + a.id)}</span>
            <span class="lg-c">${lbEsc(a.type || '')}</span>
            <span class="lg-c">SN ${lbEsc(a.serial || '—')}</span>
            <span class="lg-c">${lbEsc(a.pc || '')}</span>
            <span class="lg-c">${lbEsc(a.country)}${a.site && a.site !== '0' ? ' · ' + lbEsc(a.site) : ''}</span>
            <span class="lg-c lg-h">${lbEsc(a.holder || '')}</span>
            <span>${st(a.status)}</span>
            <span class="lg-x" onclick="event.stopPropagation()">${lbAdmin ? `<span class="lg-adm" title="label printed · QR scanned">🏷 ${a.printed} · 📷 ${a.scanned}</span>` : ''}${edit ? ` <button class="btn btn-ghost btn-sm" onclick="QuickEdit.open(${a.id}, LabelsPanel.reload)" title="Edit this asset here">✏️</button>` : ''}</span>
          </div>`).join('')}</div>` : ''}</div>`;
    }).join('') : '<p class="text-muted" style="padding:14px">No assets match.</p>';
    document.querySelectorAll('.lg-head input[data-half]').forEach(i => { i.indeterminate = true; });
    updateSel();
  }
  function toggleGroup(model) { if (lbOpen.has(model)) lbOpen.delete(model); else lbOpen.add(model); renderList(); }
  function selectGroup(model, on) { for (const a of lbAll.filter(x => (x.model || '(model not set)') === model)) on ? lbSel.add(a.id) : lbSel.delete(a.id); renderList(); }
  function pick(id, on) { on ? lbSel.add(id) : lbSel.delete(id); renderList(); }
  function selectShown(on) { for (const a of lbAll) on ? lbSel.add(a.id) : lbSel.delete(a.id); renderList(); }
  function updateSel() {
    const n = lbSel.size;
    $('lb-print').textContent = `🖨 Print selected (${n})`;
    $('lb-print').disabled = !n;
    $('lb-selinfo').textContent = n ? `${n} selected` : 'Open a model, tick assets (or a whole model) to print · click an asset to preview';
  }

  // ── Preview / print: shared with Stocktake (public/js/label-print.js) ───────
  const paper = () => $('lb-mode').value;
  function preview(id) { LabelPrint.preview(id, paper()); }

  // Bind the controls once; opts: { country, site, status, paper, ids }.
  function init(opts = {}) {
    if (ready) return; ready = true;
    if (PAPERS[opts.paper]) $('lb-mode').value = opts.paper;
    (opts.ids || []).forEach(id => lbSel.add(id));
    if (opts.site) $('lb-site').value = opts.site;
    if (opts.status) $('lb-status').value = opts.status;
    let tmr;
    $('lb-q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(loadList, 300); });
    ['lb-country', 'lb-site', 'lb-type', 'lb-status'].forEach(id => $(id).addEventListener('change', loadList));
    $('lb-print').addEventListener('click', () => LabelPrint.print([...lbSel], paper(), loadList));
    $('lb-all').addEventListener('click', () => selectShown(true));
    $('lb-none').addEventListener('click', () => selectShown(false));
    $('lb-expand').addEventListener('click', () => { const g = groups(); const allOpen = g.every(([m]) => lbOpen.has(m)); lbOpen = allOpen ? new Set() : new Set(g.map(([m]) => m)); renderList(); });
    if (opts.country) { const cs = $('lb-country'); cs.innerHTML += `<option selected>${lbEsc(opts.country)}</option>`; cs.value = opts.country; }
    loadList();
  }

  // Stocktake page: open / close the panel in place (the list loads the first time it opens).
  function toggle(opts) {
    const box = $('lb-panel'); if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    if (!box.innerHTML) box.innerHTML = MARKUP;
    box.hidden = false;
    if (!ready) init(opts || {});
    else if (opts && (opts.country || opts.site)) {   // opened again from a stocktake: show that place
      if (opts.country) { const cs = $('lb-country'); if (![...cs.options].some(o => o.value === opts.country)) cs.innerHTML += `<option>${lbEsc(opts.country)}</option>`; cs.value = opts.country; }
      $('lb-site').value = opts.site || '';
      if (PAPERS[opts.paper]) $('lb-mode').value = opts.paper;
      loadList();
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.LabelsPanel = { init, toggle, toggleGroup, selectGroup, pick, preview, reload: () => loadList() };

  // QR labels page: the list is in the page itself.
  document.addEventListener('DOMContentLoaded', () => {
    if ($('lb-panel') || !$('lb-list')) return;
    const p = new URLSearchParams(location.search);
    init({ country: p.get('country'), site: p.get('site'), status: p.get('status'), paper: p.get('paper'),
      ids: (p.get('ids') || '').split(',').map(Number).filter(Boolean) });
  });
})();
