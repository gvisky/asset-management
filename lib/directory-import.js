/* Directory import — links the three Microsoft exports together:

   Azure users   (Entra "Download users"):  id, displayName, userPrincipalName, employeeId,
                                            country, companyName, jobTitle, department
   Intune devices (Intune "Export"):        Device ID, Device name, Managed by, Ownership,
                                            OS version, Primary user UPN, Category, Model,
                                            Manufacturer, Serial number, Primary user display name
   Entra devices (Entra "Download devices"): id, deviceId, isManaged, profileType, model,
                                            displayName, accountEnabled, operatingSystem,
                                            operatingSystemVersion, owner, upnName, isCompliant,
                                            approximateLastSignInDateTime

   Links:
     person  ⇄ device : email (userPrincipalName = Primary user UPN = upnName)
     Intune  ⇄ Entra  : Intune "Device ID" = Entra "deviceId", else the device name
     device  ⇄ asset  : device name = asset Computer No, else the serial number   (done in SQL)
     device country   : its user's country, else a VN / TH / MY device-name prefix */

const XLSX = require('xlsx');
const { normCountry, countryFromCompany } = require('./countries');

// Parse CSV text into row objects (every value kept as text, header names trimmed).
function parseCsv(text) {
  if (!text) return [];
  const clean = String(text).replace(/^﻿/, '');
  const wb = XLSX.read(clean, { type: 'string', raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  return rows.map(r => {
    const o = {};
    for (const k of Object.keys(r)) o[k.replace(/^﻿/, '').trim()] = String(r[k] == null ? '' : r[k]).trim();
    return o;
  });
}

// Pick the first non-empty value among several possible header names.
const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return ''; };
const bool = (v) => { const s = String(v).toLowerCase(); return s === 'true' ? 1 : s === 'false' ? 0 : null; };
const lc = (v) => String(v || '').trim().toLowerCase();

// Which file is which — by its headers, so the upload order doesn't matter.
function detectKind(rows) {
  const h = new Set(Object.keys(rows[0] || {}));
  if (h.has('Device name') || h.has('Primary user UPN')) return 'intune';
  if (h.has('deviceId') || h.has('operatingSystem') || h.has('isCompliant')) return 'entra';
  if (h.has('userPrincipalName')) return 'azure';
  return null;
}

// Device-name prefixes that clearly mean one of our sites (e.g. VNHCMC0273, THBKK0356, MYKLM0117).
const PREFIX_COUNTRY = [[/^VN[A-Z]/i, 'Vietnam'], [/^TH[A-Z]/i, 'Thailand'], [/^MY[A-Z]/i, 'Malaysia']];
const countryFromDeviceName = (name) => (PREFIX_COUNTRY.find(([re]) => re.test(name || '')) || [null, ''])[1];

/**
 * Build people + devices from the parsed files (any of them may be missing).
 * knownPeople: Map(email lowercased → country) from the database, used for device
 * countries when no Azure file is uploaded.
 */
function buildDirectory({ azure = [], intune = [], entra = [] }, knownPeople = new Map()) {
  const stats = { azureRows: azure.length, intuneRows: intune.length, entraRows: entra.length,
                  people: 0, skippedGuests: 0, skippedNoCountry: 0, devices: 0, linkedIntuneEntra: 0 };

  // ── People ────────────────────────────────────────────────────────────────
  // Country = company (VN/TH/MY) → Azure country field → the usual country of that company.
  const companyVotes = new Map();
  for (const r of azure) {
    const c = normCountry(r.country);
    const co = lc(r.companyName);
    if (!c || !co) continue;
    if (!companyVotes.has(co)) companyVotes.set(co, new Map());
    const m = companyVotes.get(co); m.set(c, (m.get(c) || 0) + 1);
  }
  const companyCountry = (co) => {
    const m = companyVotes.get(lc(co)); if (!m) return '';
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const people = [];
  const emailCountry = new Map(knownPeople);       // every Azure user (even skipped) → country, for devices
  for (const r of azure) {
    const email = pick(r, 'userPrincipalName', 'User principal name', 'Email');
    if (!email) continue;
    const company = pick(r, 'companyName', 'Company name');
    const country = countryFromCompany(company) || normCountry(pick(r, 'country', 'Country')) || companyCountry(company);
    if (country) emailCountry.set(lc(email), country);
    // People only: no external guests, no accounts without a country or a company (service / room accounts).
    if (email.includes('#EXT#')) { stats.skippedGuests++; continue; }
    if (!country && !company) { stats.skippedNoCountry++; continue; }
    people.push({
      email, entra_id: pick(r, 'id', 'Object ID'), display_name: pick(r, 'displayName', 'Display name'),
      employee_id: pick(r, 'employeeId', 'Employee ID'), country: country || 'Unknown',
      company_name: company, position: pick(r, 'jobTitle', 'Job title'), ad_department: pick(r, 'department', 'Department'),
    });
  }
  stats.people = people.length;

  // ── Devices: Intune first, then merge Entra into them ────────────────────────
  const devices = [];
  const byIntuneId = new Map();
  const byName = new Map();          // name lowercased → [device] not yet matched to Entra
  for (const r of intune) {
    const d = {
      name: pick(r, 'Device name'), intune_id: pick(r, 'Device ID'),
      managed_by: pick(r, 'Managed by'), ownership: pick(r, 'Ownership'), os_version: pick(r, 'OS version'),
      user_upn: pick(r, 'Primary user UPN'), user_name: pick(r, 'Primary user display name'),
      category: pick(r, 'Category'), model: pick(r, 'Model'), manufacturer: pick(r, 'Manufacturer'),
      serial_no: pick(r, 'Serial number'), os: pick(r, 'OS', 'Operating system'),
      in_intune: 1, in_entra: 0,
    };
    devices.push(d);
    if (d.intune_id) byIntuneId.set(lc(d.intune_id), d);
    const k = lc(d.name);
    if (k) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(d); }
  }
  for (const r of entra) {
    const entraDeviceId = pick(r, 'deviceId', 'Device ID');
    const name = pick(r, 'displayName', 'Name');
    let d = entraDeviceId && byIntuneId.get(lc(entraDeviceId));
    if (!d || d.in_entra) {
      const list = byName.get(lc(name)) || [];
      d = list.find(x => !x.in_entra) || null;
    }
    if (d) stats.linkedIntuneEntra++;
    else { d = { name, in_intune: 0 }; devices.push(d); }
    d.in_entra = 1;
    d.entra_object_id = pick(r, 'id');
    d.entra_device_id = entraDeviceId;
    d.name = d.name || name;
    d.os = pick(r, 'operatingSystem') || d.os || '';
    d.os_version = d.os_version || pick(r, 'operatingSystemVersion');
    d.model = d.model || pick(r, 'model');
    d.user_upn = d.user_upn || pick(r, 'upnName');
    d.user_name = d.user_name || pick(r, 'owner');
    d.join_type = pick(r, 'profileType');
    d.is_managed = bool(pick(r, 'isManaged'));
    d.is_compliant = bool(pick(r, 'isCompliant'));
    d.account_enabled = bool(pick(r, 'accountEnabled'));
    d.last_sign_in = pick(r, 'approximateLastSignInDateTime');
  }
  // Intune-only devices: derive the OS family (the Intune export has no OS column).
  const ANDROID_MAKERS = /samsung|xiaomi|redmi|oppo|vivo|huawei|honor|google|motorola|nokia|realme|tecno|infinix|oneplus|zebra|honeywell|lenovo tab/i;
  for (const d of devices) {
    if (!d.os) {
      if (/^10\.0\./.test(d.os_version || '')) d.os = 'Windows';
      else if (/^iphone/i.test(d.model || '')) d.os = 'IPhone';
      else if (/^ipad/i.test(d.model || '')) d.os = 'IPad';
      else if (/^mac/i.test(d.model || '')) d.os = 'MacMDM';
      else if (ANDROID_MAKERS.test(`${d.manufacturer || ''} ${d.model || ''}`)) d.os = 'Android';
    }
    d.country = emailCountry.get(lc(d.user_upn)) || countryFromDeviceName(d.name) || '';
  }
  stats.devices = devices.length;
  return { people, devices, stats };
}

module.exports = { parseCsv, detectKind, buildDirectory };
