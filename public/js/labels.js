/* QR label sheet: A4, 3 × 7 labels (63.5 × 38.1 mm, e.g. Avery L7160 / Tomy A4 21-up) — or one label per
   page for a label printer. The QR opens /scan.html?a=<id> (no personal data on the label). */

let lbList = [];
const lbEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadLabels() {
  const p = new URLSearchParams(location.search);
  const q = new URLSearchParams();
  if (p.get('ids')) q.set('ids', p.get('ids'));
  else {
    const c = document.getElementById('lb-country').value, s = document.getElementById('lb-site').value, t = document.getElementById('lb-type').value;
    if (!c) { document.getElementById('lb-sheet').innerHTML = '<p class="text-muted">Pick a country (and site / type), then Show labels.</p>'; return; }
    q.set('country', c); if (s) q.set('site', s); if (t) q.set('type', t);
  }
  document.getElementById('lb-sheet').innerHTML = '<p class="text-muted">Loading…</p>';
  try {
    const list = lbList = await apiGet('/api/stocktake/labels?' + q);
    document.getElementById('lb-count').textContent = `${list.length} label${list.length === 1 ? '' : 's'}${list.length === 500 ? ' (first 500)' : ''}`;
    const tall = document.getElementById('lb-mode').value === 'tall';
    document.getElementById('lb-sheet').innerHTML = !list.length ? '<p class="text-muted">No assets.</p>' : tall ? list.map(tallLabel).join('') : list.map(l => `<div class="lbl">
      <div class="lbl-qr">${l.svg}</div>
      <div class="lbl-t"><div class="lbl-co">HAYAT · IT ASSET</div><div class="lbl-code">${lbEsc(l.code || '#' + l.id)}</div>
        <div>${lbEsc(l.model)}</div><div>SN ${lbEsc(l.serial || '—')}</div>${l.pc ? `<div>${lbEsc(l.pc)}</div>` : ''}<div class="lbl-id">${lbEsc(l.country)}${l.site ? ' · ' + lbEsc(l.site) : ''} · #${l.id}</div>
        ${l.printed != null ? `<div class="lbl-adm" title="${l.lastPrint ? 'last printed ' + lbEsc(String(l.lastPrint).slice(0, 16)) + ' UTC' : 'never printed'}">printed ${l.printed}× · scanned ${l.scanned}×</div>` : ''}</div></div>`).join('');
  } catch (e) { document.getElementById('lb-sheet').innerHTML = '<p class="text-muted">Could not load labels.</p>'; }
}

document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  setTimeout(() => {
    if (p.get('country')) document.getElementById('lb-country').value = p.get('country');
    if (p.get('site')) document.getElementById('lb-site').value = p.get('site');
    if (['sheet', 'single', 'tall'].includes(p.get('paper'))) { document.getElementById('lb-mode').value = p.get('paper'); setPaper(p.get('paper')); }
    loadLabels();
  }, 500);
  if (p.get('ids')) document.getElementById('lb-pick').style.display = 'none';
  document.getElementById('lb-show').addEventListener('click', loadLabels);
  document.getElementById('lb-print').addEventListener('click', askPurpose);
  document.getElementById('pp-cancel').addEventListener('click', () => document.getElementById('pp-overlay').classList.remove('open'));
  document.getElementById('pp-close').addEventListener('click', () => document.getElementById('pp-overlay').classList.remove('open'));
  document.getElementById('pp-ok').addEventListener('click', printNow);
  document.getElementById('lb-mode').addEventListener('change', (e) => { setPaper(e.target.value); loadLabels(); });
});

// Every print is recorded with its purpose (who / when) — admins see the counts per label.
async function askPurpose() {
  if (!lbList.length) { showToast('No labels to print', 'error'); return; }
  if (!canEdit()) { showToast('Only admins / editors can print labels', 'error'); return; }
  let open = [];
  try { open = (await apiGet('/api/stocktake')).filter(t => t.status === 'open'); } catch { open = []; }
  const opts = [['First label (new asset / never labelled)'], ['Replacement — label damaged or lost'], ...open.map(t => ['For stocktake: ' + t.name]), ['Other']];
  document.getElementById('pp-n').textContent = `${lbList.length} label${lbList.length === 1 ? '' : 's'}`;
  document.getElementById('pp-list').innerHTML = opts.map(([o], i) => `<label class="pp-opt"><input type="radio" name="pp" value="${lbEsc(o)}"${i === 0 ? ' checked' : ''}> ${lbEsc(o)}</label>`).join('');
  document.getElementById('pp-other').value = '';
  document.getElementById('pp-overlay').classList.add('open');
}
async function printNow() {
  let purpose = (document.querySelector('input[name="pp"]:checked') || {}).value || '';
  if (purpose === 'Other') { purpose = document.getElementById('pp-other').value.trim(); if (!purpose) { showToast('Write what the labels are for', 'error'); return; } }
  else if (document.getElementById('pp-other').value.trim()) purpose += ' — ' + document.getElementById('pp-other').value.trim();
  try { await apiPost('/api/stocktake/labels/printed', { ids: lbList.map(l => l.id), purpose }); }
  catch (e) { let m = 'Could not record the print'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); return; }
  document.getElementById('pp-overlay').classList.remove('open');
  setTimeout(() => { window.print(); loadLabels(); }, 200);
}

// Paper: A4 sheet 3 × 7 · label printer 63.5 × 38.1 mm · tall label 65 × 140 mm (one per page).
function setPaper(mode) {
  document.body.classList.toggle('lbl-single', mode === 'single');
  document.body.classList.toggle('lbl-tallmode', mode === 'tall');
  let st = document.getElementById('lb-page');
  if (!st) { st = document.createElement('style'); st.id = 'lb-page'; document.head.appendChild(st); }
  st.textContent = mode === 'tall' ? '@media print { @page { size: 65mm 140mm; margin: 0; } }'
    : mode === 'single' ? '@media print { @page { size: 63.5mm 38.1mm; margin: 0; } }' : '';
}

// Tall label (6.5 × 14 cm): big QR, all asset info; a broken laptop also shows its spare parts.
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
