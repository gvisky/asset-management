/* Device Check — compare the live Intune + Entra device exports with Asset Inventory.
   See docs/DEVICE-CHECK.md. Pure functions: nothing here writes to the database.

   checkDevices({ intune, entra }, people, assets, acks) →
     { devices: [...rows for the devices table], stats }
   people: personnel rows (id, email, ad_sam, ad_seen_at, country, display_name)
   assets: live asset rows (id, computer_no, serial_no, brand_model, ad_name, user_name, asset_type)
   acks:   accepted differences [{ device_key, code, value }] */

const { buildDirectory } = require('./directory-import');
const { shortMaker } = require('./device-to-asset');

const lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
const localPart = (upn) => lc(String(upn || '').split('@')[0]);
const isComputer = (d) => /^(windows|mac)/i.test(d.os || '');
// Serials like "Default string", "To be filled by O.E.M.", "0" are not real.
const realSerial = (s) => { const v = lc(s); return v.length >= 4 && !/default|o\.e\.m|to be filled|none|^0+$/.test(v); };
// Serial compared the way people type it: no spaces / dashes, letter O = zero, letter I = one
// ("5CGO12O4K7" typed by hand = "5CG01204K7" in Intune).
const serialKey = (s) => String(s || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/I/g, '1');

// A known maker named anywhere in Brand / Model ("Desktop lenovo" → lenovo); '' when none.
const KNOWN_MAKERS = ['asus', 'hp', 'dell', 'lenovo', 'msi', 'apple', 'samsung', 'acer', 'microsoft', 'xiaomi', 'zebra', 'honeywell', 'huawei', 'oppo', 'vivo', 'google'];
function makerIn(brandModel) {
  for (const w of String(brandModel || '').toLowerCase().split(/[^a-z0-9-]+/)) {
    const m = lc(shortMaker(w));
    if (KNOWN_MAKERS.includes(m)) return m;
  }
  return '';
}

// Intune "2026-11-07 23:53:29.3978190" / Entra "2026-11-03T15:42:32Z" → "YYYY-MM-DD HH:MM:SS" (UTC)
function isoTime(v) {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : '';
}
// Stable key of a device across uploads (for accepted differences).
const deviceKey = (d) => (d.intune_id ? 'intune:' + lc(d.intune_id) : d.entra_object_id ? 'entra:' + lc(d.entra_object_id) : 'name:' + lc(d.name));

// Words in a text that look like a serial number: 6+ letters / digits with both.
const descSerials = (text) => String(text || '').toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 6 && /\d/.test(t) && /[A-Z]/.test(t));

// Lookups used to compare devices with the current Asset Inventory.
function makeContext(people, assets, acks = []) {
  // People from the AD list, by AD account and by email before @.
  const adPeople = new Map();
  for (const p of people) {
    if (!p.ad_seen_at) continue;
    if (p.ad_sam) adPeople.set(lc(p.ad_sam), p);
    const l = localPart(p.email); if (l && !adPeople.has(l)) adPeople.set(l, p);
  }
  const byPc = new Map(), bySerial = new Map();   // bySerial: serialKey → [assets]
  for (const a of assets) {
    if (a.computer_no) { const k = lc(a.computer_no); if (!byPc.has(k)) byPc.set(k, a); }
    if (realSerial(a.serial_no)) { const k = serialKey(a.serial_no); if (!bySerial.has(k)) bySerial.set(k, []); bySerial.get(k).push(a); }
  }
  // Serial-like words in the SAP asset description ("Laptop Lenovo X1 Yoga- PF25Y0MX") → assets.
  const byDesc = new Map();
  for (const a of assets) {
    for (const t of descSerials(a.asset_description)) {
      const k = serialKey(t);
      if (!byDesc.has(k)) byDesc.set(k, []);
      if (!byDesc.get(k).includes(a)) byDesc.get(k).push(a);
    }
  }
  const ackSet = new Set(acks.map(a => `${a.device_key}|${a.code}|${a.value}`));
  return { adPeople, byPc, bySerial, byDesc, ackSet };
}

// One device (from the files, or a row of the devices table) → its asset and the differences.
function evaluate(d, ctx, key = deviceKey(d)) {
  const { byPc, bySerial, byDesc, ackSet } = ctx;
  const computer = isComputer(d);
  const byName = d.name ? byPc.get(lc(d.name)) : null;
  const sameSerial = realSerial(d.serial_no) ? (bySerial.get(serialKey(d.serial_no)) || []) : [];
  const bySn = sameSerial[0] || null;
  // Phones / tablets: link by serial only. Computers: Computer No first, then serial.
  const asset = computer ? (byName || bySn || null) : (bySn || null);
  const issues = [];
  const personal = lc(d.ownership) === 'personal';
  if (computer && !personal) {
    const add = (code, assetValue, intuneValue, text) => {
      if (ackSet.has(`${key}|${code}|${lc(intuneValue)}`)) return;           // accepted earlier
      issues.push({ code, asset: assetValue || '', intune: intuneValue || '', text });
    };
    if (!asset) add('not_in_assets', '', d.name, 'Not in Asset Inventory');
    else {
      // Same machine recorded twice: another asset with this serial (typos like O/0 included) → merge.
      // Two different SAP asset codes = two real assets (one serial is probably mistyped) → check by hand, never merge.
      const codeOf = (x) => [x.asset_s4, x.asset_code].map(v => String(v || '').trim()).find(v => v && !/^(missing|none|n\/?a|-+|—|0+|null|tbd|\?)$/i.test(v)) || '';
      for (const other of sameSerial) {
        if (other.id === asset.id) continue;
        if (ackSet.has(`${key}#${other.id}|duplicate|${other.id}`)) continue;     // marked as checked
        const twoSap = codeOf(asset) && codeOf(other) && codeOf(asset) !== codeOf(other);
        issues.push(twoSap
          ? { code: 'conflict', asset: `#${asset.id} / #${other.id}`, intune: d.serial_no, other: other.id,
              text: `Same serial on two SAP assets: #${asset.id} (${codeOf(asset)}) and #${other.id} (${codeOf(other)}) — check which is right` }
          : { code: 'duplicate', asset: `#${other.id} ${other.computer_no || ''}`.trim(), intune: d.name, other: other.id,
              text: `Same serial as asset #${other.id}${other.computer_no ? ` (${other.computer_no})` : ''} — duplicate, merge` });
      }
      if (lc(asset.computer_no) !== lc(d.name) && d.name) add('pc_no', asset.computer_no, d.name, 'Computer No differs');
      if (realSerial(d.serial_no) && lc(asset.serial_no) !== lc(d.serial_no)) add('serial', asset.serial_no, d.serial_no, asset.serial_no ? 'Serial differs' : 'Serial missing in Asset Inventory');
      const devUser = localPart(d.user_upn);
      if (lc(asset.ad_name) !== devUser) add('user', asset.ad_name, devUser, asset.ad_name ? 'Assigned to another user' : 'AD Name missing in Asset Inventory');
      const mk = lc(shortMaker(d.manufacturer)), am = makerIn(asset.brand_model);
      if (KNOWN_MAKERS.includes(mk) && am && am !== mk) add('brand', asset.brand_model, `${shortMaker(d.manufacturer)} ${d.model || ''}`.trim(), 'Brand differs');
    }
  }
  // SAP description of another asset names this machine's serial, while that asset holds another / no serial.
  if (computer && !personal && realSerial(d.serial_no)) {
    for (const a of (byDesc ? byDesc.get(serialKey(d.serial_no)) || [] : [])) {
      if (serialKey(a.serial_no) === serialKey(d.serial_no)) continue;
      if (ackSet.has(`${key}#${a.id}|sap_desc|${a.id}`)) continue;
      const code = String(a.asset_s4 || a.asset_code || '').trim();
      issues.push({ code: 'sap_desc', asset: `#${a.id}${code ? ` (${code})` : ''} serial ${a.serial_no || '∅'}`, intune: d.serial_no, other: a.id,
        text: `SAP description of asset #${a.id}${code ? ` (${code})` : ''} names this serial ("${String(a.asset_description || '').slice(0, 60)}"), but #${a.id} has serial ${a.serial_no || '∅'} — check which is right` });
    }
  }
  const assetValues = asset ? JSON.stringify({ computer_no: asset.computer_no || '', serial_no: asset.serial_no || '', brand_model: asset.brand_model || '', ad_name: asset.ad_name || '', user_name: asset.user_name || '' }) : '';
  return { asset, issues, assetValues, computer };
}

function checkDevices(files, people, assets, acks = []) {
  const { devices: all } = buildDirectory({ intune: files.intune || [], entra: files.entra || [] });
  const ctx = makeContext(people, assets, acks);
  const stats = { inFiles: all.length, kept: 0, computers: 0, matched: 0, notInAssets: 0, withIssues: 0,
    issues: {}, compliance: {}, ownership: {}, managedBy: {}, users: 0, ignoredNoUser: 0, ignoredNotAd: 0 };
  const out = [];
  const users = new Set();
  for (const d of all) {
    if (!d.user_upn) { stats.ignoredNoUser++; continue; }
    const person = ctx.adPeople.get(localPart(d.user_upn));
    if (!person) { stats.ignoredNotAd++; continue; }
    users.add(person.id);
    const key = deviceKey(d);
    const { asset, issues, assetValues, computer } = evaluate(d, ctx, key);
    const row = {
      device_key: key, name: d.name || '', country: person.country || '', user_upn: d.user_upn, user_name: d.user_name || person.display_name || '',
      person_id: person.id, asset_id: asset ? asset.id : null,
      os: d.os || '', os_version: d.os_version || '', model: d.model || '', manufacturer: d.manufacturer || '', serial_no: d.serial_no || '',
      managed_by: d.managed_by || '', ownership: d.ownership || '', compliance: d.compliance || (d.is_compliant === 1 ? 'Compliant' : d.is_compliant === 0 ? 'Noncompliant' : ''),
      category: d.category || '', join_type: d.join_type || '', is_managed: d.is_managed, is_compliant: d.is_compliant, account_enabled: d.account_enabled,
      last_sign_in: isoTime(d.last_sign_in), last_checkin: isoTime(d.last_checkin),
      intune_id: d.intune_id || '', entra_device_id: d.entra_device_id || '', entra_object_id: d.entra_object_id || '',
      in_intune: d.in_intune ? 1 : 0, in_entra: d.in_entra ? 1 : 0,
      issues: issues.length ? JSON.stringify(issues) : '',
      asset_values: assetValues,
    };
    out.push(row);
    stats.kept++;
    if (computer) stats.computers++;
    if (asset) stats.matched++;
    if (issues.some(i => i.code === 'not_in_assets')) stats.notInAssets++;
    if (issues.length) stats.withIssues++;
    issues.forEach(i => { stats.issues[i.code] = (stats.issues[i.code] || 0) + 1; });
    const inc = (o, k) => { o[k || '—'] = (o[k || '—'] || 0) + 1; };
    inc(stats.compliance, row.compliance); inc(stats.ownership, row.ownership); inc(stats.managedBy, row.managed_by);
  }
  stats.users = users.size;
  return { devices: out, stats };
}

module.exports = { checkDevices, makeContext, evaluate, deviceKey, isoTime, serialKey };
