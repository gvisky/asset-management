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
    document.getElementById('lb-sheet').innerHTML = list.length ? list.map(l => `<div class="lbl">
      <div class="lbl-qr">${l.svg}</div>
      <div class="lbl-t"><div class="lbl-co">HAYAT · IT ASSET</div><div class="lbl-code">${lbEsc(l.code || '#' + l.id)}</div>
        <div>${lbEsc(l.model)}</div><div>SN ${lbEsc(l.serial || '—')}</div>${l.pc ? `<div>${lbEsc(l.pc)}</div>` : ''}<div class="lbl-id">${lbEsc(l.country)}${l.site ? ' · ' + lbEsc(l.site) : ''} · #${l.id}</div>
        ${l.printed != null ? `<div class="lbl-adm" title="${l.lastPrint ? 'last printed ' + lbEsc(String(l.lastPrint).slice(0, 16)) + ' UTC' : 'never printed'}">printed ${l.printed}× · scanned ${l.scanned}×</div>` : ''}</div></div>`).join('')
      : '<p class="text-muted">No assets.</p>';
  } catch (e) { document.getElementById('lb-sheet').innerHTML = '<p class="text-muted">Could not load labels.</p>'; }
}

document.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  setTimeout(() => {
    if (p.get('country')) document.getElementById('lb-country').value = p.get('country');
    if (p.get('site')) document.getElementById('lb-site').value = p.get('site');
    loadLabels();
  }, 500);
  if (p.get('ids')) document.getElementById('lb-pick').style.display = 'none';
  document.getElementById('lb-show').addEventListener('click', loadLabels);
  document.getElementById('lb-print').addEventListener('click', askPurpose);
  document.getElementById('pp-cancel').addEventListener('click', () => document.getElementById('pp-overlay').classList.remove('open'));
  document.getElementById('pp-close').addEventListener('click', () => document.getElementById('pp-overlay').classList.remove('open'));
  document.getElementById('pp-ok').addEventListener('click', printNow);
  document.getElementById('lb-mode').addEventListener('change', (e) => { document.body.classList.toggle('lbl-single', e.target.value === 'single'); });
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
