/* Reports for the functions added in Nov 2026 — each returns { sheets, dashboard } like routes/reports.js.
     kpi           KPIs: utilisation & data quality by asset type × country, ghost / repair / recovery / book value per country
     depreciation  book value of every asset (straight-line, years per country)
     stocktakes    stocktake campaigns, every scan, assets missing in closed stocktakes
     leavers       leaver return checklist (assets, devices, M365, AD) + 7-day recovery          HR & IT
     m365          Microsoft 365 licence reclaim list
     custody       e-signed handover / return records
     qrlog         QR label prints (with purpose), every QR scan, photos                         admins
     mydevices     My devices: who confirmed their devices, who is waiting / not sent, "not with me"   HR & IT
   Everything follows the user's country scope. */

const { all } = require('../db/database');
const { countrySql, scopeList, inScope } = require('./scope');
const { kpi, matrix, colsBy, countryCols, countryOrder, vnSites, blank, code, COUNTRY_COLOR, PALETTE } = require('./report-dash');
const fin = require('./finance');

class ReportForbidden extends Error {}
const scoped = (req, col = 'country') => { const cs = countrySql(req, col);   // honours ?country= (HTML per-country views)
  return cs.clause ? { clause: ` AND ${cs.clause}`, params: cs.params } : { clause: '', params: [] }; };
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const day = (v) => String(v || '').slice(0, 10);
const month = (v) => String(v || '').slice(0, 7) || '(no date)';
const ccolor = (c, i) => COUNTRY_COLOR[c] || PALETTE[i % PALETTE.length];

// A table without a mix bar (percentages / amounts): rows = [label, ...values].
const plain = (title, headers, rows, note) => ({ kind: 'matrix', title, note, headers, rows, styles: rows.map(() => ''), colors: [], mix: false });
// Key number with a split we already computed per country.
const tile = (label, value, split, color) => ({ label, value, color, split: split.map(([c, n]) => ({ code: code(c), country: c, n })) });

// ── KPIs ─────────────────────────────────────────────────────────────────────
async function kpiReport(req) {
  const k = await require('../routes/kpi').computeKpi(req);
  const C = k.countries;
  const pctOrBlank = (x) => (x ? x.value : '');
  const util = [], dq = [];
  for (const r of k.utilisation) for (const c of C) { const x = r.byCountry[c]; if (x) util.push({ 'Asset type': r.type, 'Country': c, 'Utilisation %': x.value, 'Active': x.active, 'Stock': x.stock, 'Broken': x.broken, 'Other status': x.other, 'Total': x.total }); }
  for (const r of k.dataQuality) for (const c of C) { const x = r.byCountry[c]; if (x) dq.push({ 'Asset type': r.type, 'Country': c, 'Data quality %': x.value, 'Complete': x.complete, 'Needs info': x.missing, 'No serial': x.noSerial, 'No asset code': x.noCode, 'No PC No / AD Name': x.noPcAd, 'Duplicate serial': x.dup }); }
  const per = C.map(c => { const p = k.per[c], dep = p.depreciation; const cur = Object.entries(dep.sums);
    return { 'Country': c, 'Ghost assets %': p.ghost.value == null ? '' : p.ghost.value, 'Ghost: not found': p.ghost.missing || '', 'Ghost: expected': p.ghost.expected || '',
      'Repair time (days)': p.repair.value == null ? '' : p.repair.value, 'Repairs done (12 months)': p.repair.done, 'Open repairs': p.repair.open,
      'Leaver recovery %': p.recovery.value == null ? '' : p.recovery.value, 'Leaver assets due': p.recovery.due, 'Back ≤ 7 days': p.recovery.onTime, 'Back late': p.recovery.late, 'Not back': p.recovery.open,
      'Depreciation years': dep.years, 'Cost': cur.map(([cu, s]) => `${fmtN(s.cost)} ${cu}`).join(' + '), 'Book value': cur.map(([cu, s]) => `${fmtN(s.book)} ${cu}`).join(' + '),
      'Fully depreciated': dep.fully, 'Fully depreciated, still Active': dep.fullyActive, 'Depreciation ends ≤ 12 months': dep.ending12, 'No cost / purchase date': dep.without }; });
  const sum = (f) => C.map(c => [c, f(k.per[c])]);
  return {
    sheets: [{ name: 'Utilisation by type', rows: util }, { name: 'Data quality by type', rows: dq }, { name: 'Per country', rows: per }],
    dashboard: {
      title: 'KPIs', subtitle: 'utilisation and data quality by asset type · ghost assets, repair time, leaver recovery, depreciation per country',
      kpis: [tile('Assets needing info', C.reduce((t, c) => t + k.per[c].dataQuality.missing, 0), sum(p => p.dataQuality.missing), 'red'),
        tile('Ghost assets', C.reduce((t, c) => t + (k.per[c].ghost.missing || 0), 0), sum(p => p.ghost.missing || 0), 'amber'),
        tile('Open repairs', C.reduce((t, c) => t + k.per[c].repair.open, 0), sum(p => p.repair.open), 'blue'),
        tile('Leaver assets not back', C.reduce((t, c) => t + k.per[c].recovery.open, 0), sum(p => p.recovery.open), 'purple'),
        tile('Fully depr., Active', C.reduce((t, c) => t + k.per[c].depreciation.fullyActive, 0), sum(p => p.depreciation.fullyActive), 'grey')],
      tables: [
        plain('Utilisation % by asset type', ['Asset type', 'Assets', ...C.map(c => c + ' %')], k.utilisation.map(r => [r.type, r.total, ...C.map(c => pctOrBlank(r.byCountry[c]))]), 'Active ÷ assets of that type · target 85–90 %'),
        plain('Data quality % by asset type', ['Asset type', 'Checked', ...C.map(c => c + ' %')], k.dataQuality.map(r => [r.type, r.total, ...C.map(c => pctOrBlank(r.byCountry[c]))]), 'no missing info · target 98 %'),
        plain('Per country', ['Country', 'Ghost %', 'Repair days', 'Recovery %', 'Fully depr. Active'],
          C.map(c => { const p = k.per[c]; return [c, p.ghost.value == null ? '' : p.ghost.value, p.repair.value == null ? '' : p.repair.value, p.recovery.value == null ? '' : p.recovery.value, p.depreciation.fullyActive]; })),
      ],
    },
  };
}

// ── Depreciation ─────────────────────────────────────────────────────────────
async function depreciationReport(req) {
  const sc = scoped(req);
  const raw = await all(`SELECT id, asset_s4, asset_code, asset_type, brand_model, serial_no, country, location, department, status, user_name, purchase_date, cost
      FROM assets WHERE deleted_at IS NULL${sc.clause} ORDER BY country, asset_type, id`, sc.params);
  const years = await fin.getYearsMap();
  const items = raw.map(a => ({ ...a, d: fin.depreciation(a, years) }));
  const stateOf = (x) => (!x.d ? 'No cost / date' : x.d.fully ? 'Fully depreciated' : (Date.parse(x.d.endDate) - Date.now() < 365 * 86400000 ? 'Ends ≤ 12 months' : 'Depreciating'));
  const STATE = [{ label: 'Depreciating', color: '16A34A' }, { label: 'Ends ≤ 12 months', color: 'D97706' }, { label: 'Fully depreciated', color: 'DC2626' }, { label: 'No cost / date', color: '94A3B8' }]
    .map(s => ({ ...s, test: (x) => stateOf(x) === s.label }));
  const C = (x) => x.country;
  const order = countryOrder(items, C);
  const rows = items.map(x => ({ 'ID': x.id, 'Asset S4': x.asset_s4, 'Asset Code (ECC)': x.asset_code, 'Type': x.asset_type, 'Brand/Model': x.brand_model, 'Serial': x.serial_no,
    'Country': x.country, 'Location': x.location, 'Department': x.department, 'Status': x.status, 'User Name': x.user_name, 'Purchase date': x.purchase_date, 'Cost (as entered)': x.cost,
    'Cost': x.d ? x.d.cost : '', 'Currency': x.d ? x.d.currency : '', 'Years': x.d ? x.d.years : fin.yearsFor(years, x.country), 'Age (years)': x.d ? x.d.ageYears : '',
    'Book value': x.d ? x.d.bookValue : '', '% left': x.d ? x.d.pctLeft : '', 'Fully depreciated on': x.d ? x.d.endDate : '', 'State': stateOf(x) }));
  const byCur = {};
  for (const x of items.filter(x => x.d)) { const k = `${x.country || 'Unknown'} (${x.d.currency || '?'})`; byCur[k] = byCur[k] || [0, 0, 0]; byCur[k][0]++; byCur[k][1] += x.d.cost; byCur[k][2] += x.d.bookValue; }
  return {
    sheets: [{ name: 'Book value', rows }],
    dashboard: {
      title: 'Depreciation & book value', subtitle: `straight-line from purchase date · ${Object.entries(years).map(([k, v]) => `${k === 'default' ? 'default' : k} ${v} y`).join(' · ')} (VN Circular 45/2013: 3–8 years for IT equipment)`,
      kpis: [kpi('Assets with cost & date', items.filter(x => x.d), C, order, 'blue'), kpi('Fully depreciated', items.filter(x => x.d && x.d.fully), C, order, 'red'),
        kpi('…still Active', items.filter(x => x.d && x.d.fully && x.status === 'Active'), C, order, 'amber'),
        kpi('Ends in 12 months', items.filter(x => stateOf(x) === 'Ends ≤ 12 months'), C, order, 'purple'), kpi('No cost / purchase date', items.filter(x => !x.d), C, order, 'grey')],
      tables: [
        plain('Cost and book value', ['Country (currency)', 'Assets', 'Cost', 'Book value', '% left'],
          Object.entries(byCur).map(([k, v]) => [k, v[0], Math.round(v[1]), Math.round(v[2]), v[1] ? Math.round(v[2] / v[1] * 1000) / 10 : ''])),
        matrix({ title: 'By country', header: 'Country / site', items, rowKey: x => blank(C(x), 'Unknown'), order, cols: STATE, sites: (c, l) => vnSites(c, l, x => x.location) }),
        matrix({ title: 'By asset type', header: 'Asset type', items, rowKey: x => blank(x.asset_type, 'Type not set'), cols: STATE }),
      ],
    },
  };
}

// ── Stocktakes ───────────────────────────────────────────────────────────────
async function stocktakesReport(req) {
  const sc = scoped(req);
  const takes = await all(`SELECT * FROM stocktakes WHERE 1=1${sc.clause} ORDER BY id DESC LIMIT 200`, sc.params);
  const ids = takes.map(t => t.id);
  const scans = ids.length ? await all(`SELECT s.*, a.asset_s4, a.asset_code, a.asset_type, a.brand_model, a.serial_no, a.country AS a_country, a.location AS a_location, a.status AS a_status
      FROM stocktake_scans s LEFT JOIN assets a ON a.id = s.asset_id WHERE s.stocktake_id IN (${ids.map(() => '?').join(',')}) ORDER BY s.id`, ids) : [];
  const res = (t) => { try { return t.result ? JSON.parse(t.result) : null; } catch { return null; } };
  const cnt = (t, r) => scans.filter(s => s.stocktake_id === t.id && s.result === r).length;
  const sheetT = takes.map(t => { const r = res(t); const exp = t.expected || 0;
    return { 'ID': t.id, 'Name': t.name, 'Country': t.country, 'Site': t.site, 'Status filter': t.status_filter, 'Asset type': t.asset_type, 'Department': t.department,
      'State': t.status, 'Started (UTC)': t.created_at, 'Started by': t.created_by, 'Closed (UTC)': t.closed_at || '', 'Expected': exp,
      'Found': cnt(t, 'found'), 'Found elsewhere': cnt(t, 'elsewhere'), 'Here, outside filter': cnt(t, 'outside'), 'Unknown codes': cnt(t, 'unknown'),
      'Missing / not scanned': r ? r.missing : Math.max(0, exp - cnt(t, 'found')), 'Found %': exp ? Math.round(cnt(t, 'found') / exp * 1000) / 10 : '' }; });
  const byId = new Map(takes.map(t => [t.id, t]));
  const sheetS = scans.map(s => ({ 'Stocktake': (byId.get(s.stocktake_id) || {}).name, 'Scanned (UTC)': s.scanned_at, 'By': s.scanned_by, 'Result': s.result, 'Code scanned': s.code,
    'Asset ID': s.asset_id || '', 'Asset S4 / ECC': s.asset_s4 || s.asset_code || '', 'Type': s.asset_type || '', 'Brand/Model': s.brand_model || '', 'Serial': s.serial_no || '',
    'Registered at': [s.a_country, s.a_location].filter(Boolean).join(' · '), 'Status': s.a_status || '', 'Note': s.note }));
  const missIds = [...new Set(takes.flatMap(t => (res(t) || {}).missingIds || []))];
  const miss = missIds.length ? await all(`SELECT id, asset_s4, asset_code, asset_type, brand_model, serial_no, country, location, status, user_name, department
      FROM assets WHERE deleted_at IS NULL AND id IN (${missIds.map(() => '?').join(',')})`, missIds) : [];
  const sheetM = [];
  for (const t of takes) for (const id of (res(t) || {}).missingIds || []) { const a = miss.find(x => x.id === id); if (a) sheetM.push({ 'Stocktake': t.name, 'Closed (UTC)': t.closed_at, 'Asset ID': a.id,
    'Asset S4 / ECC': a.asset_s4 || a.asset_code, 'Type': a.asset_type, 'Brand/Model': a.brand_model, 'Serial': a.serial_no, 'Country': a.country, 'Location': a.location, 'Status': a.status, 'User Name': a.user_name, 'Department': a.department }); }
  const C = (t) => t.country, order = countryOrder(takes, C);
  const scanned = scans.map(s => ({ ...s, country: (byId.get(s.stocktake_id) || {}).country }));
  return {
    sheets: [{ name: 'Stocktakes', rows: sheetT }, { name: 'Scans', rows: sheetS }, { name: 'Missing (closed)', rows: sheetM }],
    dashboard: {
      title: 'Stocktakes (QR audit)', subtitle: `${takes.length} stocktakes · ${fmtN(scans.length)} scans`,
      kpis: [kpi('Stocktakes', takes, C, order, 'blue'), kpi('Open now', takes.filter(t => t.status === 'open'), C, order, 'teal'),
        kpi('Assets scanned', scanned.filter(s => s.asset_id), (s) => s.country, order, 'green'),
        kpi('Missing (closed)', sheetM, (r) => r['Country'], order, 'red')],
      tables: [
        { kind: 'matrix', title: 'Latest stocktakes',
          headers: ['Stocktake', 'Expected', 'Found', 'Elsewhere', 'Outside filter', 'Unknown', 'Missing / not scanned'],
          rows: sheetT.slice(0, 15).map(r => [`${r['Name']}${r['State'] === 'open' ? ' (open)' : ''}`, r['Expected'], r['Found'], r['Found elsewhere'], r['Here, outside filter'], r['Unknown codes'], r['Missing / not scanned']]),
          styles: [], colors: ['16A34A', 'D97706', '0891B2', '7C3AED', 'DC2626'], mix: true },
        matrix({ title: 'Missing assets by type', header: 'Asset type', items: miss, rowKey: a => blank(a.asset_type, 'Type not set'), cols: countryCols(miss, a => a.country) }),
      ],
    },
  };
}

// ── Leavers ──────────────────────────────────────────────────────────────────
async function leaversReport(req) {
  if (!req.user || !['IT', 'HR'].includes(req.user.team)) throw new ReportForbidden('Leavers is for HR and IT members');
  const sc = scoped(req, 'p.country');
  const rows = await all(`SELECT p.id, p.display_name, p.email, p.country, p.department, p.leaving_date, p.status, i.item, i.label, i.due_date, i.done_at, i.done_by, i.note
      FROM leaver_items i JOIN personnel p ON p.id = i.person_id WHERE i.due_date >= date('now', '-365 days')${sc.clause} ORDER BY p.leaving_date DESC, p.display_name, i.item`, sc.params);
  const plus7 = (d) => new Date(Date.parse(d) + 7 * 86400000).toISOString().slice(0, 10);
  const kind = (i) => (i.startsWith('asset:') ? 'Asset' : i.startsWith('device:') ? 'Intune / Entra device' : i === 'm365' ? 'Microsoft 365 licence' : i === 'ad' ? 'AD account' : 'Other');
  const items = rows.map(r => ({ ...r, kind: kind(r.item), state: r.done_at ? (r.item.startsWith('asset:') && day(r.done_at) > plus7(r.due_date) ? 'Done late' : 'Done') : 'Open' }));
  const sheet = items.map(r => ({ 'Person': r.display_name, 'Email': r.email, 'Country': r.country, 'Department': r.department, 'Leaving date': r.leaving_date, 'Status in User Inventory': r.status,
    'What': r.kind, 'Item': r.label, 'State': r.state, 'Done (UTC)': r.done_at || '', 'Done by': r.done_by || '', 'Note': r.note || '',
    'Back ≤ 7 days': r.item.startsWith('asset:') ? (r.done_at ? (day(r.done_at) <= plus7(r.due_date) ? 'Yes' : 'No') : (plus7(r.due_date) < new Date().toISOString().slice(0, 10) ? 'No (not back)' : 'not due yet')) : '' }));
  const people = [...new Map(items.map(r => [r.id, r])).values()];
  const C = (r) => r.country, order = countryOrder(people, C);
  const rec = await require('../routes/leavers').recovery(req);
  const STATES = [{ label: 'Done', color: '16A34A', test: r => r.state === 'Done' }, { label: 'Done late', color: 'D97706', test: r => r.state === 'Done late' }, { label: 'Open', color: 'DC2626', test: r => r.state === 'Open' }];
  return {
    sheets: [{ name: 'Checklist', rows: sheet }],
    dashboard: {
      title: 'Leavers — return checklist', subtitle: 'assets, Intune devices, Microsoft 365 licence and AD account of people who left or are leaving',
      kpis: [kpi('Leavers', people, C, order, 'blue'), kpi('People not cleared', people.filter(p => items.some(i => i.id === p.id && !i.done_at)), C, order, 'amber'),
        kpi('Assets not back', items.filter(i => i.kind === 'Asset' && !i.done_at), C, order, 'red'),
        tile('Recovery ≤ 7 days %', (() => { const due = Object.values(rec).reduce((t, r) => t + r.due, 0), on = Object.values(rec).reduce((t, r) => t + r.onTime, 0); return due ? Math.round(on / due * 1000) / 10 : 0; })(),
          Object.entries(rec).map(([c, r]) => [c, r.due ? Math.round(r.onTime / r.due * 100) : 0]), 'green')],
      tables: [
        plain('Recovery: assets back within 7 days', ['Country', 'Due', 'Back ≤ 7 days', 'Late', 'Not back', 'Recovery %'],
          Object.entries(rec).map(([c, r]) => [c, r.due, r.onTime, r.late, r.open, r.due ? Math.round(r.onTime / r.due * 1000) / 10 : ''])),
        matrix({ title: 'Checklist by country', header: 'Country', items, rowKey: r => blank(r.country, 'Unknown'), order, cols: STATES }),
        matrix({ title: 'Checklist by kind', header: 'What', items, rowKey: r => r.kind, order: ['Asset', 'Intune / Entra device', 'Microsoft 365 licence', 'AD account', 'Other'], cols: STATES }),
      ],
    },
  };
}

// ── Microsoft 365 licence reclaim ────────────────────────────────────────────
async function m365Report(req) {
  const d = await require('../routes/m365').computeReclaim(req, req.query.days || 60);
  const list = d.list || [];
  const C = (r) => r.country, order = countryOrder(list, C);
  const reason = (r) => (r.leaver ? 'Leaver still licensed' : r.never ? 'Never active' : `No activity ${d.days}+ days`);
  return {
    sheets: [{ name: 'Reclaim list', rows: list.map(r => ({ 'User': r.name, 'UPN': r.upn, 'Country': r.country, 'Department': r.department, 'Why': r.reason, 'Last activity': r.last_activity,
      'Days idle': r.days_idle == null ? '' : r.days_idle, 'Leaving date': r.leaving_date, 'Licences': r.products,
      ...Object.fromEntries(Object.entries(r.activity || {}).map(([k, v]) => [`${k} last activity`, v])) })) }],
    dashboard: {
      title: 'Microsoft 365 licence reclaim', subtitle: d.empty ? 'no Active users report uploaded yet (Licenses page)' : `report of ${d.asOf} · ${d.users} users · ${d.licensed} licensed · no activity ${d.days}+ days`,
      kpis: [kpi('Licences to review', list, C, order, 'blue'), kpi('Leavers still licensed', list.filter(r => r.leaver), C, order, 'red'),
        kpi(`No activity ${d.days}+ days`, list.filter(r => !r.leaver && !r.never), C, order, 'amber'), kpi('Never active', list.filter(r => !r.leaver && r.never), C, order, 'grey')],
      tables: [
        matrix({ title: 'Why, by country', header: 'Country', items: list, rowKey: r => blank(r.country, 'Unknown'), order,
          cols: [{ label: 'Leaver still licensed', color: 'DC2626', test: r => r.leaver }, { label: `No activity ${d.days}+ days`, color: 'D97706', test: r => !r.leaver && !r.never }, { label: 'Never active', color: '94A3B8', test: r => !r.leaver && r.never }] }),
        plain('Licences that could be freed', ['Licence', 'Users'], Object.entries(d.byProduct || {}).sort((a, b) => b[1] - a[1]).map(([p, n]) => [p, n])),
      ],
    },
  };
}

// ── Handover / return records ────────────────────────────────────────────────
async function custodyReport(req) {
  const sc = scoped(req, 'a.country');
  const docs = await all(`SELECT d.id, d.kind, d.signed_at, d.person_name, d.person_email, d.note, d.created_by, d.ip, d.sha256,
        a.id AS asset_id, a.asset_s4, a.asset_code, a.asset_type, a.brand_model, a.serial_no, a.country, a.location
      FROM asset_docs d JOIN assets a ON a.id = d.asset_id WHERE 1=1${sc.clause} ORDER BY d.id DESC`, sc.params);
  const C = (r) => r.country, order = countryOrder(docs, C);
  const KIND = [{ label: 'Handover', color: '1A56DB', test: r => r.kind === 'handover' }, { label: 'Return', color: '0F766E', test: r => r.kind === 'return' }];
  const months = [...new Set(docs.map(r => month(r.signed_at)))].sort().reverse().slice(0, 12);
  return {
    sheets: [{ name: 'Signed records', rows: docs.map(r => ({ 'Record': r.id, 'Kind': r.kind === 'return' ? 'Return' : 'Handover', 'Signed (UTC)': r.signed_at,
      'Person': r.person_name, 'Email': r.person_email, 'Asset ID': r.asset_id, 'Asset S4 / ECC': r.asset_s4 || r.asset_code, 'Type': r.asset_type, 'Brand/Model': r.brand_model,
      'Serial': r.serial_no, 'Country': r.country, 'Location': r.location, 'Condition / note': r.note, 'IT member': r.created_by, 'IP': r.ip,
      'PDF': `/api/custody/doc/${r.id}.pdf`, 'SHA-256': r.sha256 })) }],
    dashboard: {
      title: 'Handover & return (e-signed)', subtitle: 'signed records kept on the assets (PDF + SHA-256 fingerprint)',
      kpis: [kpi('Signed records', docs, C, order, 'blue'), kpi('Handovers', docs.filter(r => r.kind === 'handover'), C, order, 'blue'), kpi('Returns', docs.filter(r => r.kind === 'return'), C, order, 'teal')],
      tables: [
        matrix({ title: 'By month', header: 'Month', items: docs.filter(r => months.includes(month(r.signed_at))), rowKey: r => month(r.signed_at), order: months, cols: KIND }),
        matrix({ title: 'By country', header: 'Country / site', items: docs, rowKey: r => blank(C(r), 'Unknown'), order, cols: KIND, sites: (c, l) => vnSites(c, l, r => r.location) }),
        matrix({ title: 'By asset type', header: 'Asset type', items: docs, rowKey: r => blank(r.asset_type, 'Type not set'), cols: KIND }),
      ],
    },
  };
}

// ── QR log (admins) ──────────────────────────────────────────────────────────
async function qrlogReport(req) {
  if (!req.user || req.user.role !== 'admin') throw new ReportForbidden('The QR log is for admins');
  const sc = scoped(req, 'a.country');
  const J = `JOIN assets a ON a.id = x.asset_id`;
  const A = 'a.asset_s4, a.asset_code, a.asset_type, a.brand_model, a.serial_no, a.country, a.location';
  const prints = await all(`SELECT x.*, ${A} FROM qr_prints x ${J} WHERE 1=1${sc.clause} ORDER BY x.id DESC LIMIT 20000`, sc.params);
  const scans = await all(`SELECT x.*, t.name AS stocktake, ${A} FROM qr_scans x LEFT JOIN assets a ON a.id = x.asset_id LEFT JOIN stocktakes t ON t.id = x.stocktake_id
      WHERE (x.asset_id IS NULL AND ${scopeList(req) ? '0' : '1'}) OR (x.asset_id IS NOT NULL${sc.clause}) ORDER BY x.id DESC LIMIT 20000`, sc.params);
  const photos = await all(`SELECT x.id, x.asset_id, x.stocktake_id, x.note, x.size, x.taken_by, x.taken_at, ${A} FROM asset_photos x ${J} WHERE 1=1${sc.clause} ORDER BY x.id DESC`, sc.params);
  const asset = (r) => ({ 'Asset ID': r.asset_id || '', 'Asset S4 / ECC': r.asset_s4 || r.asset_code || '', 'Type': r.asset_type || '', 'Brand/Model': r.brand_model || '', 'Serial': r.serial_no || '', 'Country': r.country || '', 'Location': r.location || '' });
  const SRC = { stocktake: 'Stocktake', label: 'Phone camera (label)' };
  const C = (r) => r.country, order = countryOrder([...prints, ...scans.filter(s => s.country), ...photos], C);
  const purposeOf = (p) => String(p.purpose || '').replace(/ — .*$/, '').replace(/^For stocktake: .*/, 'For a stocktake') || '(none)';
  return {
    sheets: [
      { name: 'Label prints', rows: prints.map(r => ({ 'Printed (UTC)': r.printed_at, 'By': r.printed_by, 'Purpose': r.purpose, ...asset(r) })) },
      { name: 'Scans', rows: scans.map(r => ({ 'Scanned (UTC)': r.scanned_at, 'By': r.scanned_by, 'From': SRC[r.source] || r.source, 'Stocktake': r.stocktake || '', 'Result': r.result, 'Code': r.code, 'IP': r.ip, ...asset(r) })) },
      { name: 'Photos', rows: photos.map(r => ({ 'Photo': `/api/stocktake/photo/${r.id}`, 'Taken (UTC)': r.taken_at, 'By': r.taken_by, 'Note': r.note, 'Size (KB)': Math.round((r.size || 0) / 1024), ...asset(r) })) },
    ],
    dashboard: {
      title: 'QR labels & scans log', subtitle: 'every label print (with purpose), every QR scan and every photo — admins only',
      kpis: [kpi('Labels printed', prints, C, order, 'blue'), kpi('QR scans', scans.filter(s => s.country), C, order, 'green'),
        kpi('Photos', photos, C, order, 'purple'), kpi('Labels printed 2+ times', [...new Map(prints.map(p => [p.asset_id, p])).values()].filter(p => prints.filter(q => q.asset_id === p.asset_id).length > 1), C, order, 'amber')],
      tables: [
        matrix({ title: 'Label prints by purpose', header: 'Purpose', items: prints, rowKey: purposeOf, cols: countryCols(prints, C) }),
        matrix({ title: 'Scans by person', header: 'Scanned by', items: scans, rowKey: s => s.scanned_by || '?', cols: [{ label: 'Stocktake', color: '1A56DB', test: s => s.source === 'stocktake' }, { label: 'Phone camera (label)', color: '0891B2', test: s => s.source === 'label' }] }),
        matrix({ title: 'Scans by month', header: 'Month', items: scans, rowKey: s => month(s.scanned_at), order: [...new Set(scans.map(s => month(s.scanned_at)))].sort().reverse(), cols: colsBy(scans, s => s.result || '?') }),
      ],
    },
  };
}

// ── My devices confirmations ─────────────────────────────────────────────────
async function myDevicesReport(req) {
  if (!req.user || !['IT', 'HR'].includes(req.user.team)) throw new ReportForbidden('My devices is for HR and IT members');
  const sc = scoped(req, 'p.country');
  const adMatch = `a.deleted_at IS NULL AND TRIM(COALESCE(a.ad_name, '')) <> '' AND instr(p.email, '@') > 0
      AND LOWER(TRIM(a.ad_name)) = LOWER(substr(p.email, 1, instr(p.email, '@') - 1))`;
  const people = await all(`SELECT p.id, p.display_name, p.email, p.country, p.department, p.status,
        (SELECT COUNT(*) FROM assets a WHERE ${adMatch}) AS assets
      FROM personnel p WHERE p.status <> 'deleted'${sc.clause}
        AND ((SELECT COUNT(*) FROM assets a WHERE ${adMatch}) > 0 OR EXISTS (SELECT 1 FROM confirm_links c WHERE c.person_id = p.id))
      ORDER BY p.country, p.display_name`, sc.params);
  const ids = people.map(p => p.id);
  const links = ids.length ? await all(`SELECT * FROM confirm_links ORDER BY id`) : [];
  const answers = ids.length ? await all(`SELECT c.*, a.asset_s4, a.asset_code, a.asset_type, a.brand_model, a.serial_no FROM asset_confirmations c
      LEFT JOIN assets a ON a.id = c.asset_id ORDER BY c.id DESC`) : [];
  const byPerson = new Map(people.map(p => [p.id, p]));
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const STATE_ORDER = ['Confirmed', 'Confirmed — not with them', 'Waiting', 'Expired / locked', 'Not sent'];
  const rows = people.map(p => {
    const ls = links.filter(l => l.person_id === p.id), last = ls[ls.length - 1] || null;
    const lastConf = [...ls].reverse().find(l => l.confirmed_at) || null;
    const ans = lastConf ? answers.filter(a => a.link_id === lastConf.id) : [];
    const notHave = ans.filter(a => a.result === 'not_have').length;
    let state = 'Not sent';
    if (last && last.confirmed_at) state = notHave ? 'Confirmed — not with them' : 'Confirmed';
    else if (last && !last.revoked && last.expires_at >= now && !(last.attempts >= 5 && !last.verified_at)) state = 'Waiting';
    else if (last) state = lastConf ? (notHave ? 'Confirmed — not with them' : 'Confirmed') : 'Expired / locked';
    return { ...p, state, last, lastConf, notHave, signed: (ans[0] || {}).signed_name || '', sent: ls.length };
  });
  const mine = answers.filter(a => byPerson.has(a.person_id));
  const C = (r) => r.country, order = countryOrder(rows, C);
  const COLORS = { 'Confirmed': '16A34A', 'Confirmed — not with them': 'DC2626', 'Waiting': 'D97706', 'Expired / locked': '7C3AED', 'Not sent': '94A3B8' };
  const SHORT = { 'Confirmed — not with them': 'Not with them', 'Expired / locked': 'Expired' };
  const STATES = STATE_ORDER.map(s => ({ label: SHORT[s] || s, color: COLORS[s], test: r => r.state === s }));
  const months = [...new Set(mine.map(a => month(a.confirmed_at)))].sort().reverse().slice(0, 12);
  const assetName = (a) => a.asset_label || `${a.asset_type || ''} ${a.brand_model || ''} · ${a.asset_s4 || a.asset_code || '#' + a.asset_id}`.trim();
  // Latest answer per asset that says "not with me".
  const latest = new Map(); for (const a of mine) if (!latest.has(a.asset_id)) latest.set(a.asset_id, a);
  const notWith = [...latest.values()].filter(a => a.result === 'not_have');
  return {
    sheets: [
      { name: 'People', rows: rows.map(r => ({ 'Person': r.display_name, 'Email': r.email, 'Country': r.country, 'Department': r.department || '',
        'Devices registered now': r.assets, 'State': r.state, 'Links sent': r.sent,
        'Last link (UTC)': r.last ? r.last.created_at : '', 'Sent by': r.last ? r.last.created_by : '', 'Valid until (UTC)': r.last ? r.last.expires_at : '',
        'Opened (UTC)': (r.last && r.last.opened_at) || '', 'Email checked (UTC)': (r.last && r.last.verified_at) || '', 'Wrong emails': r.last ? r.last.attempts : '',
        'Confirmed (UTC)': (r.lastConf && r.lastConf.confirmed_at) || '', 'Not with them': r.lastConf ? r.notHave : '', 'Signed name': r.signed })) },
      { name: 'Answers', rows: mine.map(a => { const p = byPerson.get(a.person_id) || {}; return { 'Confirmed (UTC)': a.confirmed_at, 'Person': p.display_name, 'Email': a.email, 'Country': p.country,
        'Asset ID': a.asset_id, 'Asset S4 / ECC': a.asset_s4 || a.asset_code || '', 'Asset': assetName(a), 'Serial': a.serial_no || '',
        'Answer': a.result === 'have' ? 'I have it' : 'Not with me', 'Note': a.note || '', 'Signed name': a.signed_name, 'IP': a.ip, 'Browser': a.user_agent }; }) },
      { name: 'Not with them', rows: notWith.map(a => { const p = byPerson.get(a.person_id) || {}; return { 'Answered (UTC)': a.confirmed_at, 'Person': p.display_name, 'Email': a.email, 'Country': p.country,
        'Asset ID': a.asset_id, 'Asset': assetName(a), 'Serial': a.serial_no || '', 'Note': a.note || '' }; }) },
    ],
    dashboard: {
      title: 'My devices — confirmations', subtitle: 'staff checking and confirming the devices registered to them (personal link + work email check)',
      kpis: [kpi('People with devices', rows, C, order, 'blue'), kpi('Confirmed', rows.filter(r => r.state.startsWith('Confirmed')), C, order, 'green'),
        kpi('Waiting for answer', rows.filter(r => r.state === 'Waiting'), C, order, 'amber'), kpi('Not sent yet', rows.filter(r => r.state === 'Not sent'), C, order, 'grey'),
        kpi('Devices "not with me"', notWith.map(a => ({ country: (byPerson.get(a.person_id) || {}).country })), C, order, 'red')],
      tables: [
        matrix({ title: 'People by state, per country', header: 'Country', items: rows, rowKey: r => blank(r.country, 'Unknown'), order, cols: STATES }),
        matrix({ title: 'People by state, per department', header: 'Department', items: rows, rowKey: r => blank(r.department, 'Department not set'), cols: STATES }),
        matrix({ title: 'Answers by month', header: 'Month', items: mine.filter(a => months.includes(month(a.confirmed_at))), rowKey: a => month(a.confirmed_at), order: months,
          cols: [{ label: 'I have it', color: '16A34A', test: a => a.result === 'have' }, { label: 'Not with me', color: 'DC2626', test: a => a.result === 'not_have' }] }),
        plain('Devices people say are not with them', ['Person', 'Country', 'Asset', 'Note', 'Answered'],
          notWith.map(a => { const p = byPerson.get(a.person_id) || {}; return [p.display_name || a.email, p.country || '', assetName(a), a.note || '', day(a.confirmed_at)]; })),
      ],
    },
  };
}

module.exports = { ReportForbidden, extraReports: { kpi: kpiReport, depreciation: depreciationReport, stocktakes: stocktakesReport, leavers: leaversReport, m365: m365Report, custody: custodyReport, qrlog: qrlogReport, mydevices: myDevicesReport } };
