/* HQ Custody Agreement (FR.GLB.16-001) — printable form for one asset.
   Opened from Asset Inventory: /custody-form.html?id=<asset id>
   Device Type = Asset Type, Asset No = Asset Code, Model / Brand from Brand / Model,
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

document.addEventListener('DOMContentLoaded', async () => {
  const hint = document.getElementById('hint');
  const id = new URLSearchParams(window.location.search).get('id');
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
      model,
      serial: a.serial_no || '',
      brand,
      deliveredBy: me.full_name || me.username || '',
      receivedBy: a.user_name || '',
    };
    document.querySelectorAll('[data-f]').forEach(el => { el.textContent = values[el.dataset.f] || ''; });
    document.title = `Custody Agreement — ${values.assetNo || 'Asset #' + a.id}${values.receivedBy ? ' — ' + values.receivedBy : ''}`;
    document.getElementById('form').hidden = false;
    const missing = [['Asset Type', values.type], ['Asset Code', values.assetNo], ['Serial', values.serial], ['User Name', values.receivedBy]]
      .filter(([, v]) => !v).map(([k]) => k);
    hint.textContent = missing.length ? `⚠ Not filled in this asset: ${missing.join(', ')}` : 'Ready — use Print / Save as PDF.';
  } catch (e) {
    hint.textContent = 'Could not load this asset.';
    console.error(e);
  }
});
