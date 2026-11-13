/* HQ Custody Agreement (FR.GLB.16-001) — printable form for one asset.
   Opened from Asset Inventory: /custody-form.html?id=<asset id>
   Device Type = Asset Type, Asset No = Asset Code, Asset No (S/4) = S/4 asset code, Model / Brand from Brand / Model,
   SN / IMEI = Serial, Delivery Party = the user printing, Received Party = User Name, Date = today. */

// Known brand names at the start of "Brand / Model" (e.g. "Lenovo T14 G2" → Lenovo + T14 G2).
const KNOWN_BRANDS = ['lenovo', 'dell', 'hp', 'hewlett-packard', 'apple', 'samsung', 'cisco', 'acer', 'asus',
  'microsoft', 'xiaomi', 'oppo', 'vivo', 'nokia', 'huawei', 'zebra', 'honeywell', 'canon', 'epson', 'brother',
  'lg', 'sony', 'logitech', 'yealink', 'grandstream', 'polycom', 'avaya', 'fujitsu', 'toshiba', 'msi', 'gigabyte',
  'hikvision', 'dahua', 'datalogic', 'ricoh', 'kyocera', 'xerox', 'philips', 'aoc', 'viewsonic', 'benq'];

function splitBrandModel(v) {
  const full = String(v || '').trim();
  if (!full) return { brand: '', model: '' };
  const [first, ...rest] = full.split(/\s+/);
  const model = rest.join(' ').replace(/^inc\.?$/i, '').trim();   // "Dell Inc." → brand Dell, no model
  if (KNOWN_BRANDS.includes(first.toLowerCase().replace(/[.,]$/, ''))) {
    return { brand: first.replace(/[.,]$/, ''), model: model || full };
  }
  return { brand: full, model: full };   // unknown pattern → show the full value in both
}

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 401) { window.location.href = '/login.html'; throw new Error('Not signed in'); }
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

// Shrink the form so it always fits one A4 sheet (same on screen and on paper).
function fitOnePage() {
  const page = document.getElementById('form'), fit = document.getElementById('fit');
  if (!page || page.hidden || !fit) return;
  fit.style.zoom = '';
  const cs = getComputedStyle(page);
  const room = page.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const need = fit.scrollHeight;
  if (need > room) fit.style.zoom = String(Math.floor((room / need) * 1000) / 1000);
}
window.addEventListener('beforeprint', fitOnePage);

document.addEventListener('DOMContentLoaded', async () => {
  const hint = document.getElementById('hint');
  const qs = new URLSearchParams(window.location.search);
  const id = qs.get('id');
  // Signed on My devices: /custody-form.html?c=<confirmation link id>&k=<device key> → e-signature stamp.
  if (qs.get('c')) return signedForm(qs.get('c'), qs.get('k'), hint);
  if (!id) { hint.textContent = 'No asset selected.'; return; }
  try {
    const [a, me] = await Promise.all([getJson(`/api/assets/${encodeURIComponent(id)}`), getJson('/api/auth/me')]);
    const { brand, model } = splitBrandModel(a.brand_model);
    const values = {
      date: today(),
      registry: '',
      request: '',
      type: a.asset_type || '',
      assetNo: a.asset_code || '',
      assetS4: a.asset_s4 || '',
      model,
      serial: a.serial_no || '',
      brand,
      deliveredBy: me.full_name || me.username || '',
      receivedBy: a.user_name || '',
    };
    document.querySelectorAll('[data-f]').forEach(el => { el.textContent = values[el.dataset.f] || ''; });
    document.title = `Custody Agreement — ${values.assetNo || 'Asset #' + a.id}${values.receivedBy ? ' — ' + values.receivedBy : ''}`;
    document.getElementById('form').hidden = false;
    fitOnePage();
    if (document.fonts) document.fonts.ready.then(fitOnePage);
    const missing = [['Asset Type', values.type], ['Asset Code', values.assetNo], ['Serial', values.serial], ['User Name', values.receivedBy]]
      .filter(([, v]) => !v).map(([k]) => k);
    hint.textContent = missing.length ? `⚠ Not filled in this asset: ${missing.join(', ')}` : 'Ready — use Print / Save as PDF.';
  } catch (e) {
    hint.textContent = 'Could not load this asset.';
    console.error(e);
  }
});

async function signedForm(c, k, hint) {
  try {
    const d = await getJson(`/api/confirm-forms/${encodeURIComponent(c)}`);
    const it = d.items.find(i => i.key === k) || d.items[0];
    if (!it) { hint.textContent = 'No device in this confirmation.'; return; }
    const { brand, model } = splitBrandModel(it.brand_model);
    const values = { date: d.date_dmy, registry: '', request: d.signed.ref, type: it.type, assetNo: it.code, assetS4: it.s4, model, serial: it.serial, brand,
      deliveredBy: d.it_member, receivedBy: d.person.name };
    document.querySelectorAll('[data-f]').forEach(el => { el.textContent = values[el.dataset.f] || ''; });
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const recv = document.querySelector('[data-f="receivedBy"]');
    recv.insertAdjacentHTML('afterend', `<div style="margin-top:1.5mm;border:2px solid #15803d;color:#14532d;background:#f0fdf4;border-radius:2mm;padding:1.2mm 2mm;font-size:7.4pt;line-height:1.35">
      <b style="color:#15803d">✔ E-SIGNED</b> · My devices<br>${esc(d.signed.with)}<br>${esc(d.signed.at)} UTC · IP ${esc(d.signed.ip)}<br>Ref ${esc(d.signed.ref)}</div>`);
    document.title = `Custody Agreement — ${it.s4 || it.code || it.serial} — ${d.person.name} — signed`;
    document.getElementById('form').hidden = false;
    fitOnePage();
    if (document.fonts) document.fonts.ready.then(fitOnePage);
    hint.textContent = `Signed by ${d.signed.with} on ${d.signed.at} UTC — use Print / Save as PDF.`;
  } catch (e) { hint.textContent = 'Could not load the signed confirmation.'; console.error(e); }
}
