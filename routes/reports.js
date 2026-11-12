const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { buildExcelReport } = require('../lib/report-excel');
const { buildPdfReport } = require('../lib/report-pdf');
const { requireAuth } = require('../middleware/auth');
const { ASSET_COLUMNS } = require('../lib/asset-columns');
const { PERSONNEL_COLUMNS } = require('../lib/personnel-columns');
const { PARTS, PART_WORD, CONDITION_LABEL, MODEL_PARTS, SHARED_PARTS, parseParts, conditionOf, computeSpares } = require('../lib/parts');
const { inScope } = require('../lib/scope');

router.use(requireAuth);
// HR-only users (no Asset Inventory access) can't use the asset reports/export.
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) return res.status(403).json({ error: 'No access' });
  next();
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const { scopeList, countrySql } = require('../lib/scope');

// Country clause for assets/personnel/maintenance (which all carry `country`).
function scoped(req, col = 'country') {
  const cs = countrySql(req, col);
  return cs.clause ? { clause: ` AND ${cs.clause}`, params: cs.params } : { clause: '', params: [] };
}

// Days since a date ('YYYY-MM-DD HH:MM' / ISO) → number, '' when none.
function daysSince(v) {
  const t = Date.parse(String(v || '').trim().replace(' ', 'T'));
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : '';
}
const yesNo = (v) => (v === 1 ? 'Yes' : v === 0 ? 'No' : '');
const ISSUE_LABEL = { duplicate: 'Duplicate (same serial)', conflict: 'Two SAP assets, same serial', sap_desc: 'SAP description names another serial' };
const issuesOf = (v) => { try { const a = v ? JSON.parse(v) : []; return Array.isArray(a) ? a : []; } catch { return []; } };
const isTeam = (req, ...teams) => !!(req.user && teams.includes(req.user.team));
class Forbidden extends Error {}

// ── Dashboard helpers (each report: { sheets, dashboard }) ────────────────────
const blank = (v, e = '(not set)') => (v == null || String(v).trim() === '' ? e : String(v).trim());
/** Count rows by a key → [[label, n]] biggest first; after `top` rows the rest is summed as "Others". */
function countBy(rows, fn, { top = 12, order, others = true } = {}) {
  const m = new Map();
  for (const r of rows) { const k = fn(r); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
  let list = [...m.entries()];
  if (order) return order.filter(k => m.has(k)).map(k => [k, m.get(k)]).concat(list.filter(([k]) => !order.includes(k)));
  list.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  if (list.length > top && !others) return list.slice(0, top);
  if (list.length > top) { const rest = list.slice(top - 1).reduce((t, [, n]) => t + n, 0); list = [...list.slice(0, top - 1), ['Others', rest]]; }
  return list;
}
const tbl = (title, headers, rows, chart = 'bar', extra = {}) => ({ title, headers, rows, chart, ...extra });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const yearsSince = (v) => { const t = Date.parse(String(v || '').slice(0, 10)); return Number.isFinite(t) ? (Date.now() - t) / (365.25 * 86400000) : null; };
const AGE_ORDER = ['< 1 year', '1–3 years', '3–5 years', '5+ years', 'Purchase date not set'];
const ageBucket = (v) => { const y = yearsSince(v); return y == null ? 'Purchase date not set' : y < 1 ? '< 1 year' : y < 3 ? '1–3 years' : y < 5 ? '3–5 years' : '5+ years'; };
const DAYS_ORDER = ['≤ 7 days', '8–30 days', '31–90 days', '90+ days', 'never / none'];
const daysBucket = (d) => (d === '' || d == null ? 'never / none' : d <= 7 ? '≤ 7 days' : d <= 30 ? '8–30 days' : d <= 90 ? '31–90 days' : '90+ days');

// Asset dashboard (Asset Inventory + Asset Summary).
function assetDashboard(raw, title) {
  const by = (k) => raw.filter(a => a.status === k).length;
  const ages = raw.map(a => yearsSince(a.purchase_date)).filter(v => v != null);
  return {
    title, subtitle: `${raw.length.toLocaleString('en-US')} assets`,
    kpis: [{ label: 'Total assets', value: raw.length }, { label: 'Active', value: by('Active'), color: 'green' },
      { label: 'Stock', value: by('Stock'), color: 'amber' }, { label: 'Broken', value: by('Broken'), color: 'red' },
      { label: 'Countries', value: new Set(raw.map(a => a.country).filter(Boolean)).size, color: 'purple' },
      { label: 'Avg. years in use', value: ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : 0, color: 'grey' }],
    tables: [
      tbl('Assets by status', ['Status', 'Assets'], countBy(raw, a => blank(a.status)), 'doughnut'),
      tbl('Assets by country', ['Country', 'Assets'], countBy(raw, a => blank(a.country))),
      tbl('Assets by type', ['Asset type', 'Assets'], countBy(raw, a => blank(a.asset_type))),
      tbl('Years in use', ['Age', 'Assets'], countBy(raw, a => ageBucket(a.purchase_date), { order: AGE_ORDER }), 'column'),
      tbl('Assets by location', ['Location', 'Assets'], countBy(raw, a => blank(a.location)), 'doughnut'),
      tbl('Top 10 models', ['Brand / model', 'Assets'], countBy(raw, a => blank(a.brand_model), { top: 10, others: false }), 'bar', { total: false }),
      tbl('Assets by department', ['Department', 'Assets'], countBy(raw, a => blank(a.department), { top: 12 })),
    ],
  };
}

// Each report returns { sheets: [{ name, rows }] }.
const REPORTS = {
  // Full Asset Inventory — every field we hold, keyed by ID so the file can be
  // edited and re-uploaded (POST /api/assets/import) to sync the database.
  async assets(req) {
    const sc = scoped(req);
    const raw = await all(
      `SELECT * FROM assets WHERE deleted_at IS NULL${sc.clause} ORDER BY country, cost_center, id`, sc.params);
    const rows = raw.map(r => {
      const o = {};
      for (const c of ASSET_COLUMNS) o[c.header] = r[c.field] == null ? '' : r[c.field];
      return o;
    });
    return { sheets: [{ name: 'Assets', rows }], dashboard: assetDashboard(raw, 'Asset Inventory') };
  },

  // Locked items — assets locked by a User Name / AD Name change (holder lock,
  // surfaced via 🕓 History Usage), with the key identifying info.
  async locked(req) {
    const sc = scoped(req);
    const rows = await all(
      `SELECT cost_center AS "Cost Center", department AS "Department", brand_model AS "Brand/Model",
              serial_no AS "Serial", asset_code AS "Asset Code (ECC)", asset_s4 AS "Asset S4",
              user_name AS "User Name", ad_name AS "AD Name"
         FROM assets WHERE deleted_at IS NULL AND user_locked = 1${sc.clause}
        ORDER BY cost_center, brand_model`, sc.params);
    return { sheets: [{ name: 'Locked Items', rows }], dashboard: {
      title: 'Locked Items', subtitle: 'assets locked by a User Name / AD Name change',
      kpis: [{ label: 'Locked items', value: rows.length, color: 'purple' },
        { label: 'Cost centers', value: new Set(rows.map(r => r['Cost Center']).filter(Boolean)).size },
        { label: 'Models', value: new Set(rows.map(r => r['Brand/Model']).filter(Boolean)).size, color: 'grey' }],
      tables: [tbl('By cost center', ['Cost center', 'Items'], countBy(rows, r => blank(r['Cost Center']))),
        tbl('By department', ['Department', 'Items'], countBy(rows, r => blank(r['Department']))),
        tbl('By model', ['Brand / model', 'Items'], countBy(rows, r => blank(r['Brand/Model']), { top: 10, others: false }), 'bar', { total: false })] } };
  },

  // Full User Inventory — keyed by ID so it can be edited and re-uploaded
  // (POST /api/personnel/import-sync) to sync the personnel database.
  async users(req) {
    const sc = scoped(req);
    const raw = await all(
      `SELECT * FROM personnel WHERE 1=1${sc.clause} ORDER BY country, display_name COLLATE NOCASE`, sc.params);
    const rows = raw.map(r => {
      const o = {};
      for (const c of PERSONNEL_COLUMNS) o[c.header] = r[c.field] == null ? '' : r[c.field];
      return o;
    });
    const live = raw.filter(p => p.status !== 'deleted');
    return { sheets: [{ name: 'Users', rows }], dashboard: {
      title: 'User Inventory', subtitle: `${live.length.toLocaleString('en-US')} people`,
      kpis: [{ label: 'People', value: live.length }, { label: 'Active', value: live.filter(p => p.status === 'Active').length, color: 'green' },
        { label: 'Leaving / left', value: live.filter(p => p.leaving_date).length, color: 'amber' },
        { label: 'In AD list', value: live.filter(p => p.ad_seen_at).length, color: 'teal' },
        { label: 'Resource accounts', value: live.filter(p => p.ad_resource === 1).length, color: 'grey' }],
      tables: [tbl('People by country', ['Country', 'People'], countBy(live, p => blank(p.country))),
        tbl('People by status', ['Status', 'People'], countBy(live, p => blank(p.status)), 'doughnut'),
        tbl('People by department', ['Department', 'People'], countBy(live, p => blank(p.department))),
        tbl('People by type', ['User type', 'People'], countBy(live, p => blank(p.user_type)), 'doughnut')] } };
  },

  async summary(req) {
    const sc = scoped(req);
    const sheets = [
      { name: 'By Status',   rows: await all(`SELECT status AS Status, COUNT(*) AS Count FROM assets WHERE deleted_at IS NULL${sc.clause} GROUP BY status ORDER BY Count DESC`, sc.params) },
      { name: 'By Location', rows: await all(`SELECT location AS Location, COUNT(*) AS Count FROM assets WHERE deleted_at IS NULL${sc.clause} GROUP BY location ORDER BY Count DESC`, sc.params) },
      { name: 'By Country',  rows: await all(`SELECT country AS Country, COUNT(*) AS Count FROM assets WHERE deleted_at IS NULL${sc.clause} GROUP BY country ORDER BY Count DESC`, sc.params) },
      { name: 'By Cost Center', rows: await all(
          `SELECT cost_center AS "Cost Center", MAX(cost_center_desc) AS "Description", COUNT(*) AS Count
             FROM assets WHERE deleted_at IS NULL AND cost_center <> ''${sc.clause}
            GROUP BY cost_center ORDER BY Count DESC`, sc.params) },
      { name: 'By Asset Type', rows: await all(
          `SELECT asset_type AS "Asset Type", COUNT(*) AS Count
             FROM assets WHERE deleted_at IS NULL AND asset_type <> ''${sc.clause}
            GROUP BY asset_type ORDER BY Count DESC`, sc.params) },
    ];
    const raw = await all(`SELECT * FROM assets WHERE deleted_at IS NULL${sc.clause}`, sc.params);
    return { sheets, dashboard: assetDashboard(raw, 'Asset Summary') };
  },

  async offboarding(req) {
    const cond = ["p.leaving_date <> ''", 'a.deleted_at IS NULL'];
    const params = [];
    for (const col of ['p.country', 'a.country']) {
      const cs = countrySql(req, col);
      if (cs.clause) { cond.push(cs.clause); params.push(...cs.params); }
    }
    const rows = await all(
      `SELECT p.display_name AS "Person", p.email AS "Email", p.leaving_date AS "Leaving Date",
              p.country AS "Country", a.asset_code AS "Asset Code", a.brand_model AS "Brand/Model",
              a.location AS "Location", a.status AS "Status"
         FROM personnel p
         JOIN assets a ON a.user_name = p.display_name COLLATE NOCASE OR a.ad_name = p.display_name COLLATE NOCASE
        WHERE ${cond.join(' AND ')} ORDER BY p.leaving_date, p.display_name`, params);
    return { sheets: [{ name: 'Offboarding', rows }], dashboard: {
      title: 'Offboarding Reclaim', subtitle: 'leaving people and the assets they hold',
      kpis: [{ label: 'Leaving people', value: new Set(rows.map(r => r.Email || r.Person)).size, color: 'amber' },
        { label: 'Assets to reclaim', value: rows.length, color: 'red' }],
      tables: [tbl('Assets by leaving month', ['Month', 'Assets'], countBy(rows, r => String(r['Leaving Date'] || '').slice(0, 7) || '(no date)', { top: 24 })
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))), 'column'),
        tbl('By country', ['Country', 'Assets'], countBy(rows, r => blank(r.Country))),
        tbl('By asset status', ['Status', 'Assets'], countBy(rows, r => blank(r.Status)), 'doughnut')] } };
  },

  async licenses(req) {
    const list = scopeList(req);
    const used = `(SELECT COUNT(*) FROM license_assignments la WHERE la.license_id = l.id AND la.released_at IS NULL)`;
    let where = '';
    const params = [];
    if (list) { where = `WHERE (country = 'Global' OR country IN (${list.map(() => '?').join(', ')}))`; params.push(...list); }
    else if (req.query.country) { where = 'WHERE country = ?'; params.push(req.query.country); }
    const rows = await all(
      `SELECT name AS "Name", vendor AS "Vendor", type AS "Type", ${used} AS "Seats Used",
              total_seats AS "Total Seats", renewal_date AS "Renewal", cost AS "Cost", country AS "Scope"
         FROM licenses l ${where} ORDER BY name COLLATE NOCASE`, params);
    const seatsUsed = rows.reduce((t, r) => t + (Number(r['Seats Used']) || 0), 0), total = rows.reduce((t, r) => t + (Number(r['Total Seats']) || 0), 0);
    const soon = rows.filter(r => { const t = Date.parse(r.Renewal); return Number.isFinite(t) && t - Date.now() <= 90 * 86400000; }).length;
    return { sheets: [{ name: 'Licenses', rows }], dashboard: {
      title: 'Licenses', subtitle: `${rows.length} licenses`,
      kpis: [{ label: 'Licenses', value: rows.length }, { label: 'Seats used', value: seatsUsed, color: 'green' }, { label: 'Total seats', value: total, color: 'grey' },
        { label: 'Seats used %', value: pct(seatsUsed, total), color: 'purple' }, { label: 'Renewal ≤ 90 days', value: soon, color: 'amber' }],
      tables: [tbl('Seats used vs total', ['License', 'Used', 'Total'],
          rows.slice().sort((a, b) => (Number(b['Total Seats']) || 0) - (Number(a['Total Seats']) || 0)).slice(0, 12)
            .map(r => [r.Name, Number(r['Seats Used']) || 0, Number(r['Total Seats']) || 0])),
        tbl('Licenses by type', ['Type', 'Licenses'], countBy(rows, r => blank(r.Type)), 'doughnut'),
        tbl('Licenses by vendor', ['Vendor', 'Licenses'], countBy(rows, r => blank(r.Vendor)))] } };
  },

  async servers(req) {
    const sc = scoped(req);
    const rows = await all(
      `SELECT asset_code AS "Asset Code", hostname AS "Hostname", brand_model AS "Brand/Model",
              ip_address AS "IP", os AS "OS", role AS "Role", cpu AS "CPU", ram AS "RAM",
              storage AS "Storage", country AS "Country", location AS "Location", status AS "Status",
              vendor AS "Vendor", warranty_expiry AS "Warranty Expiry", purchase_date AS "Purchase Date",
              cost AS "Cost", po_number AS "PO Number"
         FROM servers WHERE deleted_at IS NULL${sc.clause} ORDER BY country, id`, sc.params);
    const expired = rows.filter(r => { const t = Date.parse(r['Warranty Expiry']); return Number.isFinite(t) && t < Date.now(); }).length;
    return { sheets: [{ name: 'Servers', rows }], dashboard: {
      title: 'Server Inventory', subtitle: `${rows.length} servers`,
      kpis: [{ label: 'Servers', value: rows.length }, { label: 'Active', value: rows.filter(r => r.Status === 'Active').length, color: 'green' },
        { label: 'Warranty expired', value: expired, color: 'red' }],
      tables: [tbl('Servers by status', ['Status', 'Servers'], countBy(rows, r => blank(r.Status)), 'doughnut'),
        tbl('Servers by OS', ['OS', 'Servers'], countBy(rows, r => blank(r.OS))),
        tbl('Servers by country', ['Country', 'Servers'], countBy(rows, r => blank(r.Country))),
        tbl('Servers by role', ['Role', 'Servers'], countBy(rows, r => blank(r.Role)))] } };
  },

  async maintenance(req) {
    const sc = scoped(req, 'm.country');
    const rows = await all(
      `SELECT m.asset_type AS "Item Type",
              CASE WHEN m.asset_type = 'server'
                   THEN COALESCE(NULLIF(s.asset_code,''), s.hostname, s.brand_model)
                   ELSE COALESCE(NULLIF(a.asset_code,''), a.brand_model) END AS "Item",
              m.type AS "Type", m.description AS "Description", m.vendor AS "Vendor", m.cost AS "Cost",
              m.status AS "Status", m.reported_at AS "Reported", m.reported_by AS "By", m.country AS "Country"
         FROM maintenance_log m
         LEFT JOIN assets  a ON m.asset_type = 'asset'  AND a.id = m.asset_id
         LEFT JOIN servers s ON m.asset_type = 'server' AND s.id = m.asset_id
        WHERE m.status <> 'done'${sc.clause} ORDER BY m.reported_at DESC`, sc.params);
    return { sheets: [{ name: 'Open Maintenance', rows }], dashboard: {
      title: 'Open Maintenance', subtitle: 'repairs / services not done yet',
      kpis: [{ label: 'Open items', value: rows.length, color: 'amber' },
        { label: 'In progress', value: rows.filter(r => r.Status === 'in_progress').length, color: 'blue' },
        { label: 'Not started', value: rows.filter(r => r.Status === 'open').length, color: 'red' }],
      tables: [tbl('By type', ['Type', 'Items'], countBy(rows, r => blank(r.Type)), 'doughnut'),
        tbl('By status', ['Status', 'Items'], countBy(rows, r => blank(r.Status)), 'doughnut'),
        tbl('By country', ['Country', 'Items'], countBy(rows, r => blank(r.Country))),
        tbl('Assets or servers', ['Item type', 'Items'], countBy(rows, r => blank(r['Item Type'])))] } };
  },

  // Intune + Entra devices of AD users (last Device Check upload) and the differences found with Asset Inventory.
  async devices(req) {
    const sc = scoped(req, 'd.country');
    const raw = await all(
      `SELECT d.*, p.display_name AS person_name, p.email AS person_email,
              a.asset_code AS a_code, a.asset_s4 AS a_s4, a.computer_no AS a_pc, a.status AS a_status
         FROM devices d
         LEFT JOIN personnel p ON p.id = d.person_id
         LEFT JOIN assets a ON a.id = d.asset_id AND a.deleted_at IS NULL
        WHERE 1=1${sc.clause} ORDER BY d.country, p.display_name COLLATE NOCASE, d.name`, sc.params);
    const devices = raw.map(d => {
      const iss = issuesOf(d.issues);
      return {
        'Device': d.name, 'User': d.person_name || d.user_name || '', 'User email / UPN': d.person_email || d.user_upn || '',
        'Country': d.country, 'OS': d.os, 'OS version': d.os_version, 'Manufacturer': d.manufacturer, 'Model': d.model,
        'Serial': d.serial_no, 'Ownership': d.ownership, 'Managed by': d.managed_by,
        'Compliance': d.compliance || (d.is_compliant === 1 ? 'Compliant' : d.is_compliant === 0 ? 'Noncompliant' : ''),
        'Last Intune check-in': d.last_checkin || '', 'Days since check-in': daysSince(d.last_checkin),
        'Last Entra sign-in': d.last_sign_in || '', 'In Intune': d.in_intune ? 'Yes' : 'No', 'In Entra': d.in_entra ? 'Yes' : 'No',
        'Asset ID': d.asset_id || '', 'Asset code (S4 / ECC)': d.a_s4 || d.a_code || '', 'Asset Computer No': d.a_pc || '', 'Asset status': d.a_status || '',
        'In Asset Inventory': d.asset_id ? 'Yes' : 'No', 'Differences': iss.length,
      };
    });
    const diffs = [];
    for (const d of raw) {
      for (const i of issuesOf(d.issues)) {
        diffs.push({ 'Device': d.name, 'User': d.person_name || d.user_upn || '', 'Country': d.country, 'Serial': d.serial_no,
          'Asset ID': d.asset_id || '', 'Check': ISSUE_LABEL[i.code] || i.text || i.code, 'Asset Inventory': i.asset || '', 'Intune / Entra': i.intune || '',
          'Details': i.text || '' });
      }
    }
    const comp = devices.filter(d => /^compliant$/i.test(d.Compliance)).length;
    return { sheets: [{ name: 'Devices', rows: devices }, { name: 'Differences to check', rows: diffs }], dashboard: {
      title: 'Devices (Intune / Entra)', subtitle: 'devices of AD users from the last Device Check upload',
      kpis: [{ label: 'Devices', value: devices.length }, { label: 'Compliant %', value: pct(comp, devices.length), color: 'green' },
        { label: 'Not compliant', value: devices.filter(d => d.Compliance && !/^compliant$/i.test(d.Compliance)).length, color: 'red' },
        { label: 'Not in Asset Inventory', value: devices.filter(d => d['In Asset Inventory'] === 'No').length, color: 'amber' },
        { label: 'Differences to check', value: diffs.length, color: 'purple' },
        { label: 'No check-in 30+ days', value: devices.filter(d => d['Days since check-in'] !== '' && d['Days since check-in'] > 30).length, color: 'grey' }],
      tables: [tbl('Compliance', ['Compliance', 'Devices'], countBy(devices, d => blank(d.Compliance)), 'doughnut'),
        tbl('Last Intune check-in', ['Last check-in', 'Devices'], countBy(devices, d => daysBucket(d['Days since check-in']), { order: DAYS_ORDER }), 'column'),
        tbl('Differences to check', ['Check', 'Devices'], countBy(diffs, d => blank(d.Check))),
        tbl('Devices by OS', ['OS', 'Devices'], countBy(devices, d => blank(d.OS))),
        tbl('Ownership', ['Ownership', 'Devices'], countBy(devices, d => blank(d.Ownership)), 'doughnut'),
        tbl('Devices by country', ['Country', 'Devices'], countBy(devices, d => blank(d.Country)))] } };
  },

  // People with their AD account, last AD logon, last Intune check-in / Entra sign-in, and why they need a check.
  async activity(req) {
    if (!isTeam(req, 'IT', 'HR')) throw new Forbidden('User activity is for HR and IT members only');
    const { AD_COND, INTUNE_LAST_SQL, ENTRA_LAST_SQL } = require('./personnel').peopleChecks;
    const sc = scoped(req, 'p.country');
    const flag = (k) => `CASE WHEN ${AD_COND[k]} THEN 1 ELSE 0 END AS f_${k}`;
    const raw = await all(
      `SELECT p.*, ${INTUNE_LAST_SQL} AS intune_last, ${ENTRA_LAST_SQL} AS entra_last,
              ${flag('missing')}, ${flag('stale')}, ${flag('never')}, ${flag('inactive')}
         FROM personnel p WHERE p.status <> 'deleted'${sc.clause}
        ORDER BY p.country, p.display_name COLLATE NOCASE`, sc.params);
    const rows = raw.map(p => {
      const res = p.ad_resource === 1;
      const reasons = res ? [] : [p.f_missing && 'Not in the last AD list', p.f_never && 'Never logged on (AD)',
        p.f_stale && 'AD logon 90+ days ago', p.f_inactive && 'No AD / Intune / Entra activity 90+ days'].filter(Boolean);
      const last = res ? '' : [p.ad_last_logon, p.intune_last, p.entra_last].filter(Boolean).sort().pop() || '';
      return {
        'ID': p.id, 'Name': p.display_name, 'Email': p.email, 'AD account': p.ad_sam || '', 'Country': p.country,
        'Position': p.position || '', 'Department': p.department || '', 'Status': p.status || '',
        'Account type': res ? 'Resource (shared mailbox / group)' : (p.ad_seen_at ? 'User' : 'Not in AD list'),
        'AD manager': p.ad_manager || '', 'AD OU': p.ad_ou || '',
        'AD last logon': res ? '' : (p.ad_never_logon ? 'never' : (p.ad_last_logon || '')),
        'Intune last check-in': res ? '' : (p.intune_last || ''), 'Entra last sign-in': res ? '' : (p.entra_last || ''),
        'Last seen (any)': last, 'Days since last seen': last ? daysSince(last) : '',
        'Needs check': reasons.join('; '),
      };
    });
    const needs = rows.filter(r => r['Needs check']);
    const reasons = needs.flatMap(r => r['Needs check'].split('; ').map(x => ({ x })));
    const countries = countBy(rows, r => blank(r.Country)).map(([c]) => c);
    return { sheets: [{ name: 'Needs check', rows: needs }, { name: 'All people', rows }], dashboard: {
      title: 'User activity (AD / Intune / Entra)', subtitle: 'last sign of each person in AD, Intune and Entra',
      kpis: [{ label: 'People', value: rows.length }, { label: 'Need a check', value: needs.length, color: 'red' },
        { label: 'Never logged on', value: needs.filter(r => /Never/.test(r['Needs check'])).length, color: 'amber' },
        { label: 'No activity 90+ days', value: needs.filter(r => /No AD/.test(r['Needs check'])).length, color: 'purple' },
        { label: 'Resource accounts', value: rows.filter(r => /^Resource/.test(r['Account type'])).length, color: 'grey' }],
      tables: [tbl('Why they need a check', ['Reason', 'People'], countBy(reasons, r => r.x)),
        tbl('Last seen (AD / Intune / Entra)', ['Last seen', 'People'],
          countBy(rows.filter(r => !/^Resource/.test(r['Account type'])), r => daysBucket(r['Days since last seen']), { order: DAYS_ORDER }), 'column'),
        tbl('By country', ['Country', 'People', 'Need a check'], countries.map(c => [c, rows.filter(r => blank(r.Country) === c).length,
          needs.filter(r => blank(r.Country) === c).length])),
        tbl('Account type', ['Account type', 'People'], countBy(rows, r => r['Account type']), 'doughnut')] } };
  },

  // Broken + Stock devices, the parts check of broken laptops, and the spare-part stock.
  async broken(req) {
    const sc = scoped(req);
    const raw = await all(
      `SELECT * FROM assets WHERE deleted_at IS NULL AND status IN ('Broken', 'Stock')${sc.clause}
        ORDER BY CASE status WHEN 'Broken' THEN 0 ELSE 1 END, asset_type, brand_model, id`, sc.params);
    const devices = raw.map(a => {
      const p = parseParts(a.parts);
      const cond = conditionOf(a);
      const o = { 'ID': a.id, 'Status': a.status, 'Type': a.asset_type, 'Brand/Model': a.brand_model, 'Serial': a.serial_no,
        'Asset S4': a.asset_s4, 'Asset Code (ECC)': a.asset_code, 'Computer No': a.computer_no, 'Country': a.country,
        'Location': a.location, 'Department': a.department, 'User Name': a.user_name, 'Purchase date': a.purchase_date,
        'Condition': CONDITION_LABEL[cond] || '' };
      for (const [k, n] of PARTS) o[n] = cond ? (p.total ? 'broken' : PART_WORD[p[k] || '']) : '';
      Object.assign(o, { 'Parts note': p.note || '', 'Parts checked by': p.checked_by || '', 'Parts checked at (UTC)': p.checked_at || '',
        'Remark': a.remark || '' });
      return o;
    });
    const laptops = raw.filter(a => a.status === 'Broken' && String(a.asset_type || '').toLowerCase() === 'laptop');
    const sp = computeSpares(laptops);
    const order = [...MODEL_PARTS, ...SHARED_PARTS];
    const byModel = sp.models.map(m => {
      const o = { 'Model': m.model, 'Broken laptops (not total)': m.laptops.length };
      for (const k of order) o[sp.name[k] + (SHARED_PARTS.includes(k) ? ' (any laptop)' : '')] = m.counts[k].stock;
      return o;
    });
    const totals = sp.totals.map(t => ({ 'Part': t.partName, 'Fits': t.shared ? 'any laptop' : 'same model only', 'In stock': t.stock,
      'Confirmed usable': t.shared ? sp.shared[t.part].checked : sp.models.reduce((n, m) => n + m.counts[t.part].checked, 0),
      'Used as spare': t.shared ? sp.shared[t.part].used : sp.models.reduce((n, m) => n + m.counts[t.part].used, 0) }));
    totals.push({ 'Part': `From ${sp.laptops} broken laptops (${sp.totalBroken} total broken not counted)` });
    const types = countBy(raw, a => blank(a.asset_type)).map(([t]) => t);
    return { sheets: [{ name: 'Broken & Stock', rows: devices }, { name: 'Spare parts by model', rows: byModel }, { name: 'Spare parts total', rows: totals }], dashboard: {
      title: 'Broken & Stock + spare parts', subtitle: 'broken and stock devices, parts of broken laptops',
      kpis: [{ label: 'Broken', value: raw.filter(a => a.status === 'Broken').length, color: 'red' },
        { label: 'Stock', value: raw.filter(a => a.status === 'Stock').length, color: 'amber' },
        { label: 'Broken laptops', value: laptops.length, color: 'blue' }, { label: 'Total broken', value: sp.totalBroken, color: 'grey' },
        { label: 'Parts not checked', value: laptops.filter(a => conditionOf(a) === 'unchecked').length, color: 'purple' }],
      tables: [tbl('Spare parts in stock', ['Part', 'In stock'], sp.totals.map(t => [t.partName + (t.shared ? ' (any laptop)' : ''), t.stock]), 'bar', { total: false }),
        tbl('Condition of broken laptops', ['Condition', 'Laptops'], countBy(laptops, a => CONDITION_LABEL[conditionOf(a)] || '(not set)'), 'doughnut'),
        tbl('Broken / stock by type', ['Asset type', 'Broken', 'Stock'], types.map(t => [t,
          raw.filter(a => a.status === 'Broken' && blank(a.asset_type) === t).length, raw.filter(a => a.status === 'Stock' && blank(a.asset_type) === t).length])),
        tbl('Broken laptops by model', ['Model', 'Laptops'], countBy(laptops, a => blank(a.brand_model), { top: 10, others: false }), 'bar', { total: false }),
        tbl('By country', ['Country', 'Devices'], countBy(raw, a => blank(a.country)))] } };
  },

  // System Health: collectors, the latest status of each check, and recent status changes (IT team).
  async health(req) {
    if (!isTeam(req, 'IT')) throw new Forbidden('System Health is for the IT team');
    const mine = (country) => (country ? inScope(req, country) : !scopeList(req));
    const collectors = (await all(`SELECT *, CAST((julianday('now') - julianday(last_seen_at)) * 86400 AS INTEGER) AS age_s
        FROM health_collectors ORDER BY country, site, name`)).filter(c => mine(c.country));
    const byId = new Map(collectors.map(c => [c.id, c]));
    const STALE = 180;
    const cols = collectors.map(c => ({ 'Collector': c.name, 'Site': c.site, 'Country': c.country,
      'State': c.revoked ? 'revoked' : (c.age_s != null && c.age_s <= STALE ? 'online' : 'offline'),
      'Last report (UTC)': c.last_seen_at || '', 'Last IP': c.last_ip || '', 'Version': c.version || '', 'Created by': c.created_by, 'Created (UTC)': c.created_at }));
    const checks = (await all(`SELECT *, CAST((julianday('now') - julianday(last_seen_at)) * 86400 AS INTEGER) AS age_s FROM health_checks ORDER BY name`))
      .filter(k => byId.has(k.collector_id))
      .map(k => { const c = byId.get(k.collector_id); return { 'Collector': c.name, 'Site': c.site, 'Country': c.country, 'Check': k.name,
        'Type': k.kind, 'Target': k.target, 'Status': (k.age_s == null || k.age_s > STALE) ? 'no data' : k.status, 'Summary': k.summary,
        'Latency (ms)': k.latency_ms == null ? '' : k.latency_ms, 'Status since (UTC)': k.status_since, 'Last report (UTC)': k.last_seen_at }; });
    const events = (await all('SELECT * FROM health_events ORDER BY id DESC LIMIT 3000')).filter(e => byId.has(e.collector_id))
      .map(e => ({ 'When (UTC)': e.created_at || '', 'Collector': byId.get(e.collector_id).name, 'Check': e.name,
        'From': e.from_status, 'To': e.to_status, 'Summary': e.summary }));
    const st = (k) => checks.filter(c => c.Status === k).length;
    return { sheets: [{ name: 'Checks', rows: checks }, { name: 'Collectors', rows: cols }, { name: 'Status changes', rows: events }], dashboard: {
      title: 'System Health', subtitle: 'routers, switches, servers and web apps checked by the office collectors',
      kpis: [{ label: 'Checks', value: checks.length }, { label: 'Up', value: st('up'), color: 'green' }, { label: 'Warning', value: st('warn'), color: 'amber' },
        { label: 'Down', value: st('down'), color: 'red' }, { label: 'No data', value: st('no data') + st('unknown'), color: 'grey' },
        { label: 'Collectors online', value: `${cols.filter(c => c.State === 'online').length} / ${cols.filter(c => c.State !== 'revoked').length}`, color: 'teal' }],
      tables: [tbl('Checks by status', ['Status', 'Checks'], countBy(checks, c => c.Status, { order: ['up', 'warn', 'down', 'no data', 'unknown'] }), 'doughnut'),
        tbl('Checks by type', ['Type', 'Checks'], countBy(checks, c => blank(c.Type))),
        tbl('Checks per collector', ['Collector', 'Checks'], countBy(checks, c => blank(c.Collector))),
        tbl('Status changes (last 3000)', ['Changed to', 'Times'], countBy(events, e => blank(e.To)), 'column')] } };
  },

  async warranty(req) {
    const sc = scoped(req);
    const assets = await all(
      `SELECT asset_code AS "Asset Code", brand_model AS "Brand/Model", country AS "Country",
              location AS "Location", vendor AS "Vendor", warranty_expiry AS "Warranty Expiry", status AS "Status"
         FROM assets
        WHERE deleted_at IS NULL AND warranty_expiry <> ''
          AND date(warranty_expiry) <= date('now','+90 days')${sc.clause}
        ORDER BY warranty_expiry`, sc.params);
    const servers = await all(
      `SELECT asset_code AS "Asset Code", hostname AS "Hostname", brand_model AS "Brand/Model",
              country AS "Country", location AS "Location", vendor AS "Vendor",
              warranty_expiry AS "Warranty Expiry", status AS "Status"
         FROM servers
        WHERE deleted_at IS NULL AND warranty_expiry <> ''
          AND date(warranty_expiry) <= date('now','+90 days')${sc.clause}
        ORDER BY warranty_expiry`, sc.params);
    const all2 = [...assets, ...servers];
    const days = (r) => Math.floor((Date.parse(r['Warranty Expiry']) - Date.now()) / 86400000);
    const W_ORDER = ['Expired', '≤ 30 days', '31–60 days', '61–90 days'];
    const wb = (r) => { const d = days(r); return !Number.isFinite(d) ? null : d < 0 ? 'Expired' : d <= 30 ? '≤ 30 days' : d <= 60 ? '31–60 days' : '61–90 days'; };
    return { sheets: [{ name: 'Assets', rows: assets }, { name: 'Servers', rows: servers }], dashboard: {
      title: 'Warranty Due', subtitle: 'assets and servers with warranty expired or ending within 90 days',
      kpis: [{ label: 'Expired', value: all2.filter(r => wb(r) === 'Expired').length, color: 'red' },
        { label: 'Ending ≤ 30 days', value: all2.filter(r => wb(r) === '≤ 30 days').length, color: 'amber' },
        { label: 'Ending 31–90 days', value: all2.filter(r => wb(r) === '31–60 days' || wb(r) === '61–90 days').length, color: 'blue' },
        { label: 'Assets', value: assets.length, color: 'grey' }, { label: 'Servers', value: servers.length, color: 'grey' }],
      tables: [tbl('Warranty', ['When', 'Items'], countBy(all2, wb, { order: W_ORDER }), 'column'),
        tbl('By vendor', ['Vendor', 'Items'], countBy(all2, r => blank(r.Vendor))),
        tbl('By country', ['Country', 'Items'], countBy(all2, r => blank(r.Country)))] } };
  },
};

// ── GET /api/reports/:name(.xlsx|.pdf) — download (region/role scoped) ─────────
// Excel: "Dashboard" sheet (key numbers, summary tables, charts) + the raw data sheets.
// PDF (?format=pdf or name.pdf): the Dashboard only.
function reportMeta(req) {
  const list = scopeList(req);
  const generated = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+7)';
  return { generated, by: req.user && (req.user.full_name || req.user.username), scope: list ? `Countries: ${list.join(', ')}` : 'All countries' };
}
router.get('/:name', wrap(async (req, res) => {
  const raw = String(req.params.name);
  const pdf = /\.pdf$/i.test(raw) || req.query.format === 'pdf';
  const name = raw.replace(/\.(xlsx|pdf)$/i, '');
  const builder = REPORTS[name];
  if (!builder) return res.status(404).json({ error: 'Unknown report' });

  let rep;
  try { rep = await builder(req); }
  catch (e) { if (e instanceof Forbidden) return res.status(403).json({ error: e.message }); throw e; }
  const meta = reportMeta(req);
  const stamp = new Date().toISOString().slice(0, 10);
  // Always serve a fresh export — never a cached copy (re-downloads after a sync).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (pdf) {
    const buf = await buildPdfReport({ dashboard: rep.dashboard, meta });
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(buf);
  }
  const buf = await buildExcelReport({ dashboard: rep.dashboard, sheets: rep.sheets, meta });
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

module.exports = router;
