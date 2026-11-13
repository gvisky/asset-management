/* QR label drawing, preview and printing — shared by Stocktake and the QR labels page.
   LabelPrint.preview(id, paper)          label preview window with "Print this label"
   LabelPrint.print(ids, paper)           asks the purpose (recorded), then prints only these labels
   LabelPrint.html(label, paper)          label HTML ('sheet' | 'single' = 63.5 × 38.1 mm, 'tall' = 65 × 140 mm)
   LabelPrint.setPaper(paper)             @page size for printing
   Papers: A4 sheet 3 × 7 · label printer 63.5 × 38.1 mm · tall label 6.5 × 14 cm (spare parts of broken laptops). */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const real = (v) => (v && String(v).trim() !== '0' ? String(v).trim() : '');   // some records hold "0" for empty
  const PAPERS = { sheet: 'A4 sheet · 3 × 7 (63.5 × 38.1 mm)', single: 'Label printer · 63.5 × 38.1 mm', tall: 'Tall label · 6.5 × 14 cm' };

  // Small label (63.5 × 38.1 mm): a broken laptop gets a parts strip under the QR — ✓ usable · ✗ broken · ↪ used · ? not checked.
  const SHORT = { 'Screen': 'Scr', 'Mainboard': 'MB', 'RAM': 'RAM', 'Keyboard': 'KB', 'Battery': 'Bat', 'SSD / Storage': 'SSD', 'Charger': 'Chg' };
  const MARK = { ok: '✓', bad: '✗', used: '↪', '': '?' };
  function partsStrip(l) {
    if (!l.parts) return '';
    if (l.condition === 'Total broken') return '<div class="lbl-parts"><span class="lp-bad lp-tot">✗ TOTAL BROKEN — no usable part</span></div>';
    return `<div class="lbl-parts">${l.parts.map(p => `<span class="lp-${p.state || 'unk'}">${MARK[p.state] || '?'}${esc(SHORT[p.part] || p.part)}</span>`).join('')}</div>`;
  }
  function small(l) {
    return `<div class="lbl${l.parts ? ' lbl-wp' : ''}"><div class="lbl-top"><div class="lbl-qr">${l.svg}</div>
      <div class="lbl-t"><div class="lbl-co">HAYAT · IT ASSET</div><div class="lbl-code">${esc(l.code || '#' + l.id)}</div>
        <div>${esc(l.model)}</div><div>SN ${esc(l.serial || '—')}</div>${l.pc ? `<div>${esc(l.pc)}</div>` : ''}<div class="lbl-id">${esc(l.country)}${real(l.site) ? ' · ' + esc(real(l.site)) : ''} · #${l.id}</div>
        ${l.printed != null ? `<div class="lbl-adm">printed ${l.printed}× · scanned ${l.scanned}×</div>` : ''}</div></div>${partsStrip(l)}</div>`;
  }
  const PART_MARK = { ok: ['✓', 'usable', 'pt-ok'], bad: ['✗', 'broken', 'pt-bad'], used: ['↪', 'used', 'pt-used'], '': ['?', 'not checked', 'pt-unk'] };
  function tall(l) {
    const row = (k, v) => (real(v) ? `<div class="tl-r"><span>${k}</span><b>${esc(real(v))}</b></div>` : '');
    const parts = l.parts ? `<div class="tl-parts"><div class="tl-ph">🔩 Spare parts · <b>${esc(l.condition || '')}</b></div>
        ${l.parts.map(p => { const m = PART_MARK[p.state] || PART_MARK['']; return `<div class="tl-p ${m[2]}"><span>${esc(p.part)}</span><b>${m[0]} ${m[1]}</b></div>`; }).join('')}
        ${l.partsNote ? `<div class="tl-note">${esc(l.partsNote)}</div>` : ''}
        ${l.partsChecked ? `<div class="tl-small">checked ${esc(l.partsChecked)}</div>` : '<div class="tl-small">parts not checked yet</div>'}</div>` : '';
    return `<div class="tl">
      <div class="tl-co">HAYAT · IT ASSET</div>
      <div class="tl-qr">${l.svg}</div>
      <div class="tl-code">${esc(l.code || '#' + l.id)}</div>
      <div class="tl-model">${esc([l.type, l.model].filter(Boolean).join(' · '))}</div>
      <div class="tl-st tl-st-${esc(String(l.status).toLowerCase())}">${esc(l.status || '')}</div>
      <div class="tl-info">${row('Serial', l.serial)}${row('PC No', l.pc)}${row('Place', [l.country, real(l.site)].filter(Boolean).join(' · '))}
        ${row('Dept', l.department)}${l.status !== 'Broken' ? row('Holder', l.holder) : ''}${row('Bought', l.purchase)}</div>
      ${parts}
      <div class="tl-foot">Scan to open in Hayat IT tools · #${l.id}${l.printed != null ? `<span class="lbl-adm"> · printed ${l.printed}× · scanned ${l.scanned}×</span>` : ''}</div>
    </div>`;
  }
  const html = (l, paper) => (paper === 'tall' ? tall(l) : small(l));

  function setPaper(mode) {
    document.body.classList.toggle('lbl-single', mode === 'single');
    document.body.classList.toggle('lbl-tallmode', mode === 'tall');
    let st = document.getElementById('lp-page');
    if (!st) { st = document.createElement('style'); st.id = 'lp-page'; document.head.appendChild(st); }
    st.textContent = mode === 'tall' ? '@media print { @page { size: 65mm 140mm; margin: 0; } }'
      : mode === 'single' ? '@media print { @page { size: 63.5mm 38.1mm; margin: 0; } }' : '@media print { @page { size: A4; margin: 15mm 7mm; } }';
  }

  // Windows (created once): preview, print purpose; and the print area.
  function ui() {
    if (document.getElementById('lp-pv')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="lp-pv"><div class="modal" style="max-width:460px">
        <div class="modal-header"><span class="modal-title" id="lp-pv-t">Label</span><button class="modal-close" data-close="lp-pv" aria-label="Close">✕</button></div>
        <div class="modal-body" id="lp-pv-b"></div>
        <div class="modal-footer lp-pv-foot"><select class="form-control" id="lp-pv-paper">${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <button class="btn btn-ghost" data-close="lp-pv">Close</button><button class="btn btn-primary" id="lp-pv-print">🖨 Print this label</button></div></div></div>
      <div class="modal-overlay" id="lp-pp"><div class="modal" style="max-width:480px">
        <div class="modal-header"><span class="modal-title">Print QR labels — what for? <span class="text-muted text-sm" id="lp-pp-n"></span></span><button class="modal-close" data-close="lp-pp" aria-label="Close">✕</button></div>
        <div class="modal-body"><div id="lp-pp-list" class="pp-list"></div>
          <div class="form-group" style="margin-top:10px"><label class="form-label">Note (or the purpose for "Other")</label><input class="form-control" id="lp-pp-note" maxlength="100" placeholder="e.g. labels peeled off in the factory"></div>
          <p class="text-muted text-sm" style="margin:0">Each print is recorded (who, when, why). Admins see how often each label was printed and scanned.</p></div>
        <div class="modal-footer"><button class="btn btn-ghost" data-close="lp-pp">Cancel</button><button class="btn btn-primary" id="lp-pp-ok">🖨 Record &amp; print</button></div></div></div>
      <div id="lp-sheet" class="lb-sheet"></div>`);
    document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => document.getElementById(b.dataset.close).classList.remove('open'); });
    document.getElementById('lp-pp-ok').onclick = doPrint;
    document.getElementById('lp-pv-print').onclick = () => { if (pvId) print([pvId], document.getElementById('lp-pv-paper').value); };
    document.getElementById('lp-pv-paper').onchange = (e) => { if (pvId) preview(pvId, e.target.value); };
  }

  let pvId = null;
  async function preview(id, paper = 'sheet') {
    ui(); pvId = id;
    document.getElementById('lp-pv-paper').value = paper;
    document.getElementById('lp-pv-b').innerHTML = '<p class="text-muted">Loading…</p>';
    document.getElementById('lp-pv').classList.add('open');
    try {
      const [l] = await apiGet('/api/stocktake/labels?ids=' + id);
      document.getElementById('lp-pv-t').textContent = `Label — ${l ? (l.code || '#' + l.id) : id}`;
      document.getElementById('lp-pv-b').innerHTML = l ? `<div class="pv-wrap ${paper === 'tall' ? 'pv-tall' : ''}">${html(l, paper)}</div>` : 'Not found';
    } catch { document.getElementById('lp-pv-b').innerHTML = '<p class="text-muted">Could not load.</p>'; }
  }

  let printIds = [], printPaper = 'sheet', onDone = null;
  async function print(ids, paper = 'sheet', done) {
    ui();
    if (!ids.length) { showToast('Tick at least one asset', 'error'); return; }
    if (!canEdit()) { showToast('Only admins / editors can print labels', 'error'); return; }
    printIds = ids; printPaper = paper; onDone = done || null;
    let open = [];
    try { open = (await apiGet('/api/stocktake')).filter(t => t.status === 'open'); } catch { open = []; }
    const opts = ['First label (new asset / never labelled)', 'Replacement — label damaged or lost', ...open.map(t => 'For stocktake: ' + t.name), 'Other'];
    document.getElementById('lp-pp-n').textContent = `${ids.length} label${ids.length === 1 ? '' : 's'} · ${PAPERS[paper] || paper}`;
    document.getElementById('lp-pp-list').innerHTML = opts.map((o, i) => `<label class="pp-opt"><input type="radio" name="lp-pp" value="${esc(o)}"${i === 0 ? ' checked' : ''}> ${esc(o)}</label>`).join('');
    document.getElementById('lp-pp-note').value = '';
    document.getElementById('lp-pp').classList.add('open');
  }
  async function doPrint() {
    let purpose = (document.querySelector('input[name="lp-pp"]:checked') || {}).value || '';
    const note = document.getElementById('lp-pp-note').value.trim();
    if (purpose === 'Other') { purpose = note; if (!purpose) { showToast('Write what the labels are for', 'error'); return; } }
    else if (note) purpose += ' — ' + note;
    const btn = document.getElementById('lp-pp-ok'); btn.disabled = true;
    try {
      const labels = [];
      for (let i = 0; i < printIds.length; i += 400) labels.push(...await apiGet('/api/stocktake/labels?ids=' + printIds.slice(i, i + 400).join(',')));
      await apiPost('/api/stocktake/labels/printed', { ids: printIds, purpose });
      setPaper(printPaper);
      document.getElementById('lp-sheet').innerHTML = labels.map(l => html(l, printPaper)).join('');
      ['lp-pp', 'lp-pv'].forEach(id => document.getElementById(id).classList.remove('open'));
      document.body.classList.add('lp-printing');
      setTimeout(() => { window.print(); document.body.classList.remove('lp-printing'); if (onDone) onDone(); }, 250);
    } catch (e) { let m = 'Could not print'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
    finally { btn.disabled = false; }
  }

  window.LabelPrint = { html, setPaper, preview, print, PAPERS };
})();
