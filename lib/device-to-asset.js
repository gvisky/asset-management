/* Turn Intune / Entra devices into Asset Inventory proposals.

   From the device we know: Computer No (device name), Serial, Brand / Model, Asset Type
   (guessed), Country, User Name, AD Name (email before @), Status = Active.
   Brand / Model and Asset Type are LEARNED from devices already linked to assets
   (e.g. Lenovo machine type "20N3…" → "Lenovo T490" / Laptop), else guessed.

   What the exports can't give (must be filled by hand) — see assetMissing(). */

const { CORE_COUNTRIES } = require('./countries');

const SITE_COUNTRY = 'Vietnam';
const lc = (v) => String(v || '').trim().toLowerCase();
const isLenovoType = (manufacturer, model) => /lenovo/i.test(manufacturer || '') && /^[0-9]{2}[A-Z0-9]{2}/i.test(model || '');
// Lenovo machine type = first 4 characters ("20N3SHLH00" → "20N3"); other makers: the full model.
const modelKey = (manufacturer, model) => (isLenovoType(manufacturer, model) ? 'L:' + String(model).slice(0, 4).toUpperCase() : 'M:' + lc(model));

/** learned: rows of { manufacturer, model, brand_model, asset_type } from devices already linked to assets. */
function learnModels(rows) {
  const votes = new Map();   // key → Map(brand_model → n), Map(asset_type → n)
  for (const r of rows) {
    const k = modelKey(r.manufacturer, r.model);
    if (!votes.has(k)) votes.set(k, { names: new Map(), types: new Map() });
    const v = votes.get(k);
    const name = String(r.brand_model || '').trim();
    // Skip names that are only the maker ("LENOVO", "Dell Inc.") — not useful as a model.
    if (name && name.includes(' ') && !/^dell inc\.?$/i.test(name)) v.names.set(name, (v.names.get(name) || 0) + 1);
    if (r.asset_type) v.types.set(r.asset_type, (v.types.get(r.asset_type) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const out = new Map();
  for (const [k, v] of votes) out.set(k, { name: (top(v.names) || [])[0] || '', type: (top(v.types) || [])[0] || '' });
  return out;
}

function guessType(d) {
  const os = lc(d.os), model = lc(d.model), maker = lc(d.manufacturer);
  if (os.includes('iphone') || os === 'ios' || /^iphone/.test(model)) return 'Mobile phone';
  if (os.includes('ipad') || /^ipad|tab|surface go/.test(model)) return 'Tablet';
  if (os.startsWith('android')) return /zebra|honeywell|datalogic/.test(maker) ? 'Hand terminals' : 'Mobile phone';
  if (os.startsWith('mac')) return 'Laptop';
  if (os === 'windows') {
    // Lenovo ThinkCentre machine types start with 10/11/12; Dell OptiPlex / HP ProDesk / Precision Tower are desktops.
    if (isLenovoType(d.manufacturer, d.model) && /^1[0-2]/.test(d.model)) return 'Desktop';
    if (/optiplex|prodesk|elitedesk|tower|thinkcentre|vostro 3[0-9]{3}$|desktop|all-in-one|aio/.test(model)) return 'Desktop';
    return 'Laptop';
  }
  return '';
}

// Short maker names ("ASUSTeK COMPUTER INC." → "Asus", "Hewlett-Packard" → "HP", "Dell Inc." → "Dell").
const MAKERS = [[/asus/i, 'Asus'], [/hewlett|^hp\b/i, 'HP'], [/dell/i, 'Dell'], [/lenovo/i, 'Lenovo'], [/micro-star|^msi\b/i, 'MSI'],
  [/apple/i, 'Apple'], [/samsung/i, 'Samsung'], [/acer/i, 'Acer'], [/microsoft/i, 'Microsoft'], [/xiaomi/i, 'Xiaomi'],
  [/zebra/i, 'Zebra'], [/honeywell/i, 'Honeywell'], [/huawei/i, 'Huawei'], [/oppo/i, 'Oppo'], [/vivo/i, 'Vivo'], [/google/i, 'Google']];
function shortMaker(m) {
  const hit = MAKERS.find(([re]) => re.test(m || ''));
  if (hit) return hit[1];
  return String(m || '').replace(/\b(inc|corp|corporation|computer|co|ltd|limited)\b\.?,?/gi, '').replace(/\s+/g, ' ').trim();
}

function niceBrandModel(d) {
  const maker = shortMaker(d.manufacturer);
  let model = String(d.model || '').trim();
  // ASUS models often repeat themselves: "ASUS V16 V3607VM_V3607VM" → "V16 V3607VM".
  model = model.replace(/_(\S+)$/, (m, x) => (model.includes(x) && model.indexOf(x) < model.length - x.length - 1 ? '' : m));
  if (maker && lc(model).startsWith(lc(maker))) model = model.slice(maker.length).trim();
  return [maker, model].filter(Boolean).join(' ');
}

/** Proposal for one device (editable before saving). */
function proposeAsset(d, learned) {
  const hit = learned.get(modelKey(d.manufacturer, d.model)) || {};
  const upnLocal = String(d.user_upn || '').split('@')[0];
  return {
    device_id: d.id,
    asset_type: hit.type || guessType(d),
    brand_model: hit.name || niceBrandModel(d),
    learned_name: !!hit.name,
    computer_no: d.name || '',
    serial_no: d.serial_no || '',
    country: d.country || '',
    location: '',
    department: '',
    user_name: d.user_name || '',
    ad_name: upnLocal,
    asset_code: '',
    asset_s4: '',
    status: 'Active',
    ownership: d.ownership || '',
  };
}

// Fields still missing after adding (what the exports can't provide).
function assetMissing(a) {
  const m = [];
  const empty = (v) => !String(v || '').trim();
  if (empty(a.asset_code)) m.push('Asset code');
  if (empty(a.asset_s4)) m.push('Asset S/4');
  if (a.country === SITE_COUNTRY && empty(a.location)) m.push('Location (Office/Factory)');
  if (CORE_COUNTRIES.includes(a.country) && empty(a.department)) m.push('Department / Cost center');
  if (empty(a.serial_no)) m.push('Serial');
  if (empty(a.asset_type)) m.push('Asset type');
  if (empty(a.country)) m.push('Country');
  if (['laptop', 'desktop'].includes(lc(a.asset_type))) {
    if (empty(a.computer_no)) m.push('PC No');
    if (empty(a.ad_name)) m.push('AD Name');
  }
  m.push('Purchase date');   // never in the exports (needed for Years in Use / warranty)
  return m;
}

// Fields still missing for a person added from a device owner.
function personMissing(p) {
  const m = ['User Type (HR)'];
  if (!String(p.country || '').trim()) m.unshift('Country');
  if (p.country === SITE_COUNTRY) m.push('Department / Cost center');
  if (!String(p.company_name || '').trim()) m.push('Company');
  if (!String(p.position || '').trim()) m.push('Position');
  return m;
}

module.exports = { learnModels, proposeAsset, assetMissing, personMissing, guessType };
