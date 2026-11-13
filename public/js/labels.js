/* QR label sheet: A4, 3 × 7 labels (63.5 × 38.1 mm, e.g. Avery L7160 / Tomy A4 21-up) — or one label per
   page for a label printer. The QR opens /scan.html?a=<id> (no personal data on the label). */

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
    const list = await apiGet('/api/stocktake/labels?' + q);
    document.getElementById('lb-count').textContent = `${list.length} label${list.length === 1 ? '' : 's'}${list.length === 500 ? ' (first 500)' : ''}`;
    document.getElementById('lb-sheet').innerHTML = list.length ? list.map(l => `<div class="lbl">
      <div class="lbl-qr">${l.svg}</div>
      <div class="lbl-t"><div class="lbl-co">HAYAT · IT ASSET</div><div class="lbl-code">${lbEsc(l.code || '#' + l.id)}</div>
        <div>${lbEsc(l.model)}</div><div>SN ${lbEsc(l.serial || '—')}</div>${l.pc ? `<div>${lbEsc(l.pc)}</div>` : ''}<div class="lbl-id">${lbEsc(l.country)}${l.site ? ' · ' + lbEsc(l.site) : ''} · #${l.id}</div></div></div>`).join('')
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
  document.getElementById('lb-print').addEventListener('click', () => window.print());
  document.getElementById('lb-mode').addEventListener('change', (e) => { document.body.classList.toggle('lbl-single', e.target.value === 'single'); });
});
