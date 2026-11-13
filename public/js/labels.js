/* QR labels — list of assets (grouped by model) → tick → print, or click an asset to preview its label.
   Papers: A4 sheet 3 × 7 (63.5 × 38.1 mm) · label printer 63.5 × 38.1 mm · tall label 65 × 140 mm (with the
   spare parts of broken laptops). The QR opens /scan.html?a=<id> (no personal data on the label).
   QR images are made only for the labels you preview / print; every print is recorded with its purpose. */

const lbEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let lbAll = [], lbAdmin = false, lbOpen = new Set();
const lbSel = new Set();

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

// ── Preview / print: shared with Stocktake (public/js/label-print.js) ─────────
const paper = () => document.getElementById('lb-mode').value;
function preview(id) { LabelPrint.preview(id, paper()); }

document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  if (['sheet', 'single', 'tall'].includes(p.get('paper'))) document.getElementById('lb-mode').value = p.get('paper');
  if (p.get('ids')) p.get('ids').split(',').map(Number).filter(Boolean).forEach(id => lbSel.add(id));
  if (p.get('site')) document.getElementById('lb-site').value = p.get('site');
  if (p.get('status')) document.getElementById('lb-status').value = p.get('status');
  let tmr;
  document.getElementById('lb-q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(loadList, 300); });
  ['lb-country', 'lb-site', 'lb-type', 'lb-status'].forEach(id => document.getElementById(id).addEventListener('change', loadList));
  document.getElementById('lb-print').addEventListener('click', () => LabelPrint.print([...lbSel], paper(), loadList));
  document.getElementById('lb-all').addEventListener('click', () => selectShown(true));
  document.getElementById('lb-none').addEventListener('click', () => selectShown(false));
  document.getElementById('lb-expand').addEventListener('click', () => { const g = groups(); const allOpen = g.every(([m]) => lbOpen.has(m)); lbOpen = allOpen ? new Set() : new Set(g.map(([m]) => m)); renderList(); });
  if (p.get('country')) { const cs = document.getElementById('lb-country'); cs.innerHTML += `<option selected>${lbEsc(p.get('country'))}</option>`; cs.value = p.get('country'); }
  loadList();
});
