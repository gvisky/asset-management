/* QR labels — list of assets (grouped by model) → tick → print, or click an asset to preview its label.
   Papers: A4 sheet 3 × 7 (63.5 × 38.1 mm) · label printer 63.5 × 38.1 mm · tall label 65 × 140 mm (with the
   spare parts of broken laptops). The QR opens /scan.html?a=<id> (no personal data on the label).
   QR images are made only for the labels you preview / print; every print is recorded with its purpose. */

const lbEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let lbAll = [], lbAdmin = false, lbOpen = new Set();
const lbSel = new Set();
let lbPrintIds = [], lbPreviewId = null;

// ── List ─────────────────────────────────────────────────────────────────────
async function loadList() {
  const v = (id) => document.getElementById(id).value.trim();
  const q = new URLSearchParams();
  for (const [k, id] of [['country', 'lb-country'], ['site', 'lb-site'], ['type', 'lb-type'], ['status', 'lb-status'], ['q', 'lb-q']]) if (v(id)) q.set(k, v(id));
  document.getElementById('lb-list').innerHTML = '<p class="text-muted" style="padding:14px">Loading…</p>';
  let r;
  try { r = await apiGet('/api/stocktake/labels/list?' + q); } catch { document.getElementById('lb-list').innerHTML = '<p class="text-muted" style="padding:14px">Could not load.</p>'; return; }
  lbAll = r.list; lbAdmin = r.isAdmin;
  // Country choices: the countries of the unfiltered list (your countries), "All countries" first.
  const cs = document.getElementById('lb-country');
  if (!cs.dataset.filled && !q.get('country')) {
    const cc = [...new Set(lbAll.map(a => a.country).filter(Boolean))].sort();
    cs.innerHTML = '<option value="">All countries</option>' + cc.map(c => `<option>${lbEsc(c)}</option>`).join('');
    cs.dataset.filled = '1';
  }
  const ts = document.getElementById('lb-type'), cur = ts.value;
  ts.innerHTML = '<option value="">All asset types</option>' + r.types.map(t => `<option value="${lbEsc(t.t)}">${lbEsc(t.t)} (${t.n})</option>`).join('');
  ts.value = cur;
  document.getElementById('lb-count').textContent = `${lbAll.length.toLocaleString()} asset${lbAll.length === 1 ? '' : 's'}${r.limited ? ' (first 3,000 — use the filters)' : ''}`;
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
  document.getElementById('lb-list').innerHTML = g.length ? g.map(([model, items]) => {
    const n = items.filter(a => lbSel.has(a.id)).length, all = n === items.length;
    const open = lbOpen.has(model) || g.length <= 3;
    const types = [...new Set(items.map(a => a.type).filter(Boolean))].join(', ');
    return `<div class="lg-group">
      <div class="lg-head" onclick="toggleGroup(${jsArg(model)})">
        <input type="checkbox" ${all ? 'checked' : ''} ${n && !all ? 'data-half="1"' : ''} onclick="event.stopPropagation();selectGroup(${jsArg(model)}, this.checked)" title="Select all of this model">
        <span class="lg-caret">${open ? '▾' : '▸'}</span><b>${lbEsc(model)}</b> <span class="text-muted text-sm">${lbEsc(types)}</span>
        <span class="lg-n">${n ? `<b>${n}</b> / ` : ''}${items.length}</span></div>
      ${open ? `<div class="lg-rows">${items.map(a => `<div class="lg-row${lbSel.has(a.id) ? ' sel' : ''}" onclick="preview(${a.id})" title="Click to preview the label">
          <input type="checkbox" ${lbSel.has(a.id) ? 'checked' : ''} onclick="event.stopPropagation();pick(${a.id}, this.checked)">
          <span class="lg-code">${lbEsc(a.code || '#' + a.id)}</span>
          <span class="lg-c">${lbEsc(a.type || '')}</span>
          <span class="lg-c">SN ${lbEsc(a.serial || '—')}</span>
          <span class="lg-c">${lbEsc(a.pc || '')}</span>
          <span class="lg-c">${lbEsc(a.country)}${a.site && a.site !== '0' ? ' · ' + lbEsc(a.site) : ''}</span>
          <span class="lg-c lg-h">${lbEsc(a.holder || '')}</span>
          <span>${st(a.status)}</span>
          ${lbAdmin ? `<span class="lg-adm" title="label printed · QR scanned">🏷 ${a.printed} · 📷 ${a.scanned}</span>` : ''}
        </div>`).join('')}</div>` : ''}</div>`;
  }).join('') : '<p class="text-muted" style="padding:14px">No assets match.</p>';
  document.querySelectorAll('.lg-head input[data-half]').forEach(i => { i.indeterminate = true; });
  updateSel();
}
function toggleGroup(model) { if (lbOpen.has(model)) lbOpen.delete(model); else lbOpen.add(model); renderList(); }
function selectGroup(model, on) { for (const a of lbAll.filter(x => (x.model || '(model not set)') === model)) on ? lbSel.add(a.id) : lbSel.delete(a.id); lbOpen.add(model); renderList(); }
function pick(id, on) { on ? lbSel.add(id) : lbSel.delete(id); renderList(); }
function selectShown(on) { for (const a of lbAll) on ? lbSel.add(a.id) : lbSel.delete(a.id); renderList(); }
function updateSel() {
  const n = lbSel.size;
  document.getElementById('lb-print').textContent = `🖨 Print selected (${n})`;
  document.getElementById('lb-print').disabled = !n;
  document.getElementById('lb-selinfo').textContent = n ? `${n} selected` : 'Tick assets (or a whole model) to print';
}

// ── Label HTML ───────────────────────────────────────────────────────────────
const paper = () => document.getElementById('lb-mode').value;
function smallLabel(l) {
  return `<div class="lbl"><div class="lbl-qr">${l.svg}</div>
    <div class="lbl-t"><div class="lbl-co">HAYAT · IT ASSET</div><div class="lbl-code">${lbEsc(l.code || '#' + l.id)}</div>
      <div>${lbEsc(l.model)}</div><div>SN ${lbEsc(l.serial || '—')}</div>${l.pc ? `<div>${lbEsc(l.pc)}</div>` : ''}<div class="lbl-id">${lbEsc(l.country)}${l.site && l.site !== '0' ? ' · ' + lbEsc(l.site) : ''} · #${l.id}</div>
      ${l.printed != null ? `<div class="lbl-adm">printed ${l.printed}× · scanned ${l.scanned}×</div>` : ''}</div></div>`;
}
const PART_MARK = { ok: ['✓', 'usable', 'pt-ok'], bad: ['✗', 'broken', 'pt-bad'], used: ['↪', 'used', 'pt-used'], '': ['?', 'not checked', 'pt-unk'] };
function tallLabel(l) {
  const real = (v) => (v && String(v).trim() !== '0' ? String(v).trim() : '');   // some records hold "0" for empty
  const row = (k, v) => (real(v) ? `<div class="tl-r"><span>${k}</span><b>${lbEsc(real(v))}</b></div>` : '');
  const parts = l.parts ? `<div class="tl-parts"><div class="tl-ph">🔩 Spare parts · <b>${lbEsc(l.condition || '')}</b></div>
      ${l.parts.map(p => { const m = PART_MARK[p.state] || PART_MARK['']; return `<div class="tl-p ${m[2]}"><span>${lbEsc(p.part)}</span><b>${m[0]} ${m[1]}</b></div>`; }).join('')}
      ${l.partsNote ? `<div class="tl-note">${lbEsc(l.partsNote)}</div>` : ''}
      ${l.partsChecked ? `<div class="tl-small">checked ${lbEsc(l.partsChecked)}</div>` : '<div class="tl-small">parts not checked yet</div>'}</div>` : '';
  return `<div class="tl">
    <div class="tl-co">HAYAT · IT ASSET</div>
    <div class="tl-qr">${l.svg}</div>
    <div class="tl-code">${lbEsc(l.code || '#' + l.id)}</div>
    <div class="tl-model">${lbEsc([l.type, l.model].filter(Boolean).join(' · '))}</div>
    <div class="tl-st tl-st-${lbEsc(String(l.status).toLowerCase())}">${lbEsc(l.status || '')}</div>
    <div class="tl-info">${row('Serial', l.serial)}${row('PC No', l.pc)}${row('Place', [l.country, real(l.site)].filter(Boolean).join(' · '))}
      ${row('Dept', l.department)}${l.status !== 'Broken' ? row('Holder', l.holder) : ''}${row('Bought', l.purchase)}</div>
    ${parts}
    <div class="tl-foot">Scan to open in Hayat IT tools · #${l.id}${l.printed != null ? `<span class="lbl-adm"> · printed ${l.printed}× · scanned ${l.scanned}×</span>` : ''}</div>
  </div>`;
}
const labelHtml = (l) => (paper() === 'tall' ? tallLabel(l) : smallLabel(l));

// Paper size for printing: A4 sheet · label printer 63.5 × 38.1 mm · tall 65 × 140 mm.
function setPaper(mode) {
  document.body.classList.toggle('lbl-single', mode === 'single');
  document.body.classList.toggle('lbl-tallmode', mode === 'tall');
  let st = document.getElementById('lb-page');
  if (!st) { st = document.createElement('style'); st.id = 'lb-page'; document.head.appendChild(st); }
  st.textContent = mode === 'tall' ? '@media print { @page { size: 65mm 140mm; margin: 0; } }'
    : mode === 'single' ? '@media print { @page { size: 63.5mm 38.1mm; margin: 0; } }' : '';
}

// ── Preview (click an asset) ─────────────────────────────────────────────────
async function preview(id) {
  lbPreviewId = id;
  const a = lbAll.find(x => x.id === id) || {};
  document.getElementById('pv-title').textContent = `Label — ${a.code || '#' + id}`;
  document.getElementById('pv-body').innerHTML = '<p class="text-muted">Loading…</p>';
  document.getElementById('pv-overlay').classList.add('open');
  try {
    const [l] = await apiGet('/api/stocktake/labels?ids=' + id);
    document.getElementById('pv-body').innerHTML = l ? `<div class="pv-wrap ${paper() === 'tall' ? 'pv-tall' : ''}">${labelHtml(l)}</div>
      <p class="text-muted text-sm" style="margin:10px 0 0;text-align:center">Paper: ${lbEsc(document.getElementById('lb-mode').selectedOptions[0].textContent)}</p>` : 'Not found';
  } catch { document.getElementById('pv-body').innerHTML = '<p class="text-muted">Could not load.</p>'; }
}

// ── Print (selected or the previewed one) ────────────────────────────────────
async function askPurpose(ids) {
  if (!ids.length) { showToast('Tick at least one asset', 'error'); return; }
  if (!canEdit()) { showToast('Only admins / editors can print labels', 'error'); return; }
  lbPrintIds = ids;
  let open = [];
  try { open = (await apiGet('/api/stocktake')).filter(t => t.status === 'open'); } catch { open = []; }
  const opts = ['First label (new asset / never labelled)', 'Replacement — label damaged or lost', ...open.map(t => 'For stocktake: ' + t.name), 'Other'];
  document.getElementById('pp-n').textContent = `${ids.length} label${ids.length === 1 ? '' : 's'}`;
  document.getElementById('pp-list').innerHTML = opts.map((o, i) => `<label class="pp-opt"><input type="radio" name="pp" value="${lbEsc(o)}"${i === 0 ? ' checked' : ''}> ${lbEsc(o)}</label>`).join('');
  document.getElementById('pp-other').value = '';
  document.getElementById('pp-overlay').classList.add('open');
}
async function printNow() {
  let purpose = (document.querySelector('input[name="pp"]:checked') || {}).value || '';
  const note = document.getElementById('pp-other').value.trim();
  if (purpose === 'Other') { purpose = note; if (!purpose) { showToast('Write what the labels are for', 'error'); return; } }
  else if (note) purpose += ' — ' + note;
  const btn = document.getElementById('pp-ok'); btn.disabled = true;
  try {
    const labels = await apiGet('/api/stocktake/labels?ids=' + lbPrintIds.join(','));
    await apiPost('/api/stocktake/labels/printed', { ids: lbPrintIds, purpose });
    document.getElementById('lb-sheet').innerHTML = labels.map(labelHtml).join('');
    document.getElementById('pp-overlay').classList.remove('open');
    document.getElementById('pv-overlay').classList.remove('open');
    setTimeout(() => { window.print(); loadList(); }, 250);
  } catch (e) { let m = 'Could not print'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
  finally { btn.disabled = false; }
}

document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  if (['sheet', 'single', 'tall'].includes(p.get('paper'))) document.getElementById('lb-mode').value = p.get('paper');
  setPaper(document.getElementById('lb-mode').value);
  if (p.get('ids')) p.get('ids').split(',').map(Number).filter(Boolean).forEach(id => lbSel.add(id));
  if (p.get('site')) document.getElementById('lb-site').value = p.get('site');
  if (p.get('status')) document.getElementById('lb-status').value = p.get('status');
  let tmr;
  document.getElementById('lb-q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(loadList, 300); });
  ['lb-country', 'lb-site', 'lb-type', 'lb-status'].forEach(id => document.getElementById(id).addEventListener('change', loadList));
  document.getElementById('lb-mode').addEventListener('change', (e) => { setPaper(e.target.value); if (document.getElementById('pv-overlay').classList.contains('open') && lbPreviewId) preview(lbPreviewId); });
  document.getElementById('lb-print').addEventListener('click', () => askPurpose([...lbSel]));
  document.getElementById('lb-all').addEventListener('click', () => selectShown(true));
  document.getElementById('lb-none').addEventListener('click', () => selectShown(false));
  document.getElementById('lb-expand').addEventListener('click', () => { const g = groups(); const allOpen = g.every(([m]) => lbOpen.has(m)); lbOpen = allOpen ? new Set() : new Set(g.map(([m]) => m)); renderList(); });
  document.getElementById('pv-print').addEventListener('click', () => { if (lbPreviewId) askPurpose([lbPreviewId]); });
  ['pv-close', 'pv-x'].forEach(id => document.getElementById(id).addEventListener('click', () => document.getElementById('pv-overlay').classList.remove('open')));
  ['pp-cancel', 'pp-close'].forEach(id => document.getElementById(id).addEventListener('click', () => document.getElementById('pp-overlay').classList.remove('open')));
  document.getElementById('pp-ok').addEventListener('click', printNow);
  // Country list fills after login (data-countries); then load.
  if (p.get('country')) { const cs = document.getElementById('lb-country'); cs.innerHTML += `<option selected>${lbEsc(p.get('country'))}</option>`; cs.value = p.get('country'); }
  loadList();
});
