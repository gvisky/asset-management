/* Delivery-Acceptance form (VN.FR.07.01) signed on My devices — /delivery-form.html?c=<confirmation link id>
   Every device the person answered "I have it" (max 7 rows, like the company Excel form), the user's
   e-signature (work email, time, IP, reference) in "RECEIPT BY · Signature/Date". Print / Save as PDF, or the Excel form. */
(async function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hint = document.getElementById('hint');
  const c = new URLSearchParams(location.search).get('c');
  if (!c) { hint.textContent = 'No confirmation selected.'; return; }
  const r = await fetch('/api/confirm-forms/' + encodeURIComponent(c));
  if (r.status === 401) { location.href = '/login.html'; return; }
  if (!r.ok) { hint.textContent = 'Could not load the signed confirmation.'; return; }
  const d = await r.json();
  const rows = d.items.slice(0, 7);
  const date = String(d.signed.at).slice(0, 10);
  document.getElementById('rows').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const it = rows[i];
    return it ? `<tr><td>${i + 1}</td><td class="l">${esc([it.type, it.brand_model].filter(Boolean).join(' · '))}</td><td>${esc(it.s4 || it.code)}</td><td>${esc(it.serial)}</td><td>${esc(date)}</td><td></td></tr>`
      : '<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
  }).join('');
  document.getElementById('terms').textContent = d.commitments;
  document.getElementById('dept').textContent = d.person.department || '';
  document.getElementById('it').textContent = d.it_member;
  document.getElementById('user').textContent = d.person.name;
  document.getElementById('stamp').innerHTML = `<div class="stamp"><b>✔ E-SIGNED</b> · My devices<br>${esc(d.signed.with)}<br>${esc(d.signed.at)} UTC · IP ${esc(d.signed.ip)}<br>Ref ${esc(d.signed.ref)}</div>`;
  document.getElementById('xlsx').href = `/api/confirm-forms/${encodeURIComponent(c)}/delivery.xlsx`;
  document.title = `Delivery form — ${d.person.name} — signed ${date}`;
  document.getElementById('form').hidden = false;
  hint.textContent = d.items.length > 7 ? `⚠ ${d.items.length} devices — the form has 7 rows; the first 7 are shown.` : `Signed by ${d.signed.with} on ${d.signed.at} UTC — print, save as PDF or download the Excel form.`;
})();
