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

function checkDevices(files, people, assets, acks = []) {
  const { devices: all } = buildDirectory({ intune: files.intune || [], entra: files.entra || [] });

  // People from the AD list, by AD account and by email before @.
  const adPeople = new Map();
  for (const p of people) {
    if (!p.ad_seen_at) continue;
    if (p.ad_sam) adPeople.set(lc(p.ad_sam), p);
    const l = localPart(p.email); if (l && !adPeople.has(l)) adPeople.set(l, p);
  }
  const byPc = new Map(), bySerial = new Map();
  for (const a of assets) {
    if (a.computer_no) { const k = lc(a.computer_no); if (!byPc.has(k)) byPc.set(k, a); }
    if (realSerial(a.serial_no)) { const k = lc(a.serial_no); if (!bySerial.has(k)) bySerial.set(k, a); }
  }
  const ackSet = new Set(acks.map(a => `${a.device_key}|${a.code}|${a.value}`));

  const stats = { inFiles: all.length, kept: 0, computers: 0, matched: 0, notInAssets: 0, withIssues: 0,
    issues: {}, compliance: {}, ownership: {}, managedBy: {}, users: 0, ignoredNoUser: 0, ignoredNotAd: 0 };
  const out = [];
  const users = new Set();
  for (const d of all) {
    if (!d.user_upn) { stats.ignoredNoUser++; continue; }
    const person = adPeople.get(localPart(d.user_upn));
    if (!person) { stats.ignoredNotAd++; continue; }
    users.add(person.id);
    const key = deviceKey(d);
    const computer = isComputer(d);
    const byName = d.name ? byPc.get(lc(d.name)) : null;
    const bySn = realSerial(d.serial_no) ? bySerial.get(lc(d.serial_no)) : null;
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
        if (byName && bySn && byName.id !== bySn.id) add('conflict', `#${byName.id} / #${bySn.id}`, d.name, `Computer No matches asset #${byName.id}, serial matches asset #${bySn.id}`);
        if (lc(asset.computer_no) !== lc(d.name) && d.name) add('pc_no', asset.computer_no, d.name, 'Computer No differs');
        if (realSerial(d.serial_no) && lc(asset.serial_no) !== lc(d.serial_no)) add('serial', asset.serial_no, d.serial_no, asset.serial_no ? 'Serial differs' : 'Serial missing in Asset Inventory');
        const devUser = localPart(d.user_upn);
        if (lc(asset.ad_name) !== devUser) add('user', asset.ad_name, devUser, asset.ad_name ? 'Assigned to another user' : 'AD Name missing in Asset Inventory');
        const mk = lc(shortMaker(d.manufacturer)), am = makerIn(asset.brand_model);
        if (KNOWN_MAKERS.includes(mk) && am && am !== mk) add('brand', asset.brand_model, `${shortMaker(d.manufacturer)} ${d.model || ''}`.trim(), 'Brand differs');
      }
    }
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
      asset_values: asset ? JSON.stringify({ computer_no: asset.computer_no || '', serial_no: asset.serial_no || '', brand_model: asset.brand_model || '', ad_name: asset.ad_name || '', user_name: asset.user_name || '' }) : '',
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

module.exports = { checkDevices, deviceKey, isoTime };
