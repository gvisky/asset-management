/* The Dashboard of each report (Excel first sheet / PDF) — built like the app's Dashboard page:
   key numbers with the split per country, and tables with one row per country (Office / Factory
   under Vietnam) or per type, a Total column, one column per status / bucket / country and a mix bar.
   Numbers of different countries are never just added together. */

const { kpi, matrix, colsBy, countryCols, countryOrder, vnSites, blank } = require('./report-dash');
const { CONDITION_LABEL, conditionOf, computeSpares } = require('./parts');

const yearsSince = (v) => { const t = Date.parse(String(v || '').slice(0, 10)); return Number.isFinite(t) ? (Date.now() - t) / (365.25 * 86400000) : null; };
const AGE_ORDER = ['< 1 year', '1–3 years', '3–5 years', '5+ years', 'Purchase date not set'];
const AGE_COLORS = ['16A34A', '0891B2', 'D97706', 'DC2626', '94A3B8'];
const ageBucket = (v) => { const y = yearsSince(v); return y == null ? 'Purchase date not set' : y < 1 ? '< 1 year' : y < 3 ? '1–3 years' : y < 5 ? '3–5 years' : '5+ years'; };
const DAYS_ORDER = ['≤ 7 days', '8–30 days', '31–90 days', '90+ days', 'never / none'];
const DAYS_COLORS = ['16A34A', '0891B2', 'D97706', 'DC2626', '94A3B8'];
const daysBucket = (d) => (d === '' || d == null ? 'never / none' : d <= 7 ? '≤ 7 days' : d <= 30 ? '8–30 days' : d <= 90 ? '31–90 days' : '90+ days');
const withColors = (cols, colors) => cols.map(c => ({ ...c, color: colors[c.idx] }));
const bucketCols = (items, fn, order, colors) => order.map((label, i) => ({ label, test: (it) => fn(it) === label, color: colors[i] }))
  .filter(c => items.some(c.test));
const STATUS3 = [{ label: 'Active', test: a => a.status === 'Active' }, { label: 'Broken', test: a => a.status === 'Broken' },
  { label: 'Stock', test: a => a.status === 'Stock' }];
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');

// ── Assets (Asset Inventory, Asset Summary) ─────────────────────────────────
function assets(raw, title) {
  const C = (a) => a.country;
  const order = countryOrder(raw, C);
  const other = raw.filter(a => !['Active', 'Broken', 'Stock'].includes(a.status));
  return {
    title, subtitle: `${fmtN(raw.length)} assets in ${order.length} countr${order.length === 1 ? 'y' : 'ies'}`,
    kpis: [kpi('Total assets', raw, C, order, 'blue'), kpi('Active', raw.filter(a => a.status === 'Active'), C, order, 'green'),
      kpi('Broken', raw.filter(a => a.status === 'Broken'), C, order, 'red'), kpi('Stock', raw.filter(a => a.status === 'Stock'), C, order, 'amber'),
      ...(other.length ? [kpi('Other status', other, C, order, 'grey')] : [])],
    tables: [
      matrix({ title: 'Assets by country', header: 'Country / site', items: raw, rowKey: a => blank(C(a), 'Unknown'), order, cols: STATUS3,
        sites: (c, list) => vnSites(c, list, a => a.location), note: 'Total includes every status' }),
      matrix({ title: 'Assets by type', header: 'Asset type', items: raw, rowKey: a => blank(a.asset_type, 'Not set'), cols: STATUS3, top: 14 }),
      matrix({ title: 'Assets by type and country', header: 'Asset type', items: raw, rowKey: a => blank(a.asset_type, 'Not set'), cols: countryCols(raw, C), top: 14 }),
      matrix({ title: 'Years in use', header: 'Country / site', items: raw, rowKey: a => blank(C(a), 'Unknown'), order,
        cols: bucketCols(raw, a => ageBucket(a.purchase_date), AGE_ORDER, AGE_COLORS), sites: (c, list) => vnSites(c, list, a => a.location) }),
      matrix({ title: 'Top 10 models', header: 'Brand / model', items: raw, rowKey: a => blank(a.brand_model, 'Not set'), cols: countryCols(raw, C), top: 11, totalRow: false }),
    ],
  };
}

// ── User Inventory ───────────────────────────────────────────────────────────
function users(live) {
  const C = (p) => p.country;
  const order = countryOrder(live, C);
  const statusCols = colsBy(live, p => blank(p.status));
  return {
    title: 'User Inventory', subtitle: `${fmtN(live.length)} people`,
    kpis: [kpi('People', live, C, order, 'blue'), kpi('Active', live.filter(p => p.status === 'Active'), C, order, 'green'),
      kpi('Leaving / left', live.filter(p => p.leaving_date), C, order, 'amber'), kpi('In AD list', live.filter(p => p.ad_seen_at), C, order, 'teal'),
      kpi('Resource accounts', live.filter(p => p.ad_resource === 1), C, order, 'grey')],
    tables: [
      matrix({ title: 'People by country', header: 'Country', items: live, rowKey: p => blank(C(p), 'Unknown'), order, cols: statusCols }),
      matrix({ title: 'People by type', header: 'User type', items: live, rowKey: p => blank(p.user_type), cols: countryCols(live, C) }),
      matrix({ title: 'People by department', header: 'Department', items: live, rowKey: p => blank(p.department), cols: countryCols(live, C), top: 15 }),
    ],
  };
}

// ── Server Inventory ─────────────────────────────────────────────────────────
function servers(rows) {
  const C = (r) => r.Country;
  const order = countryOrder(rows, C);
  const expired = rows.filter(r => { const t = Date.parse(r['Warranty Expiry']); return Number.isFinite(t) && t < Date.now(); });
  return {
    title: 'Server Inventory', subtitle: `${fmtN(rows.length)} servers`,
    kpis: [kpi('Servers', rows, C, order, 'blue'), kpi('Active', rows.filter(r => r.Status === 'Active'), C, order, 'green'),
      kpi('Warranty expired', expired, C, order, 'red')],
    tables: [
      matrix({ title: 'Servers by country', header: 'Country / site', items: rows, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: colsBy(rows, r => blank(r.Status)), sites: (c, list) => vnSites(c, list, r => r.Location) }),
      matrix({ title: 'Servers by OS', header: 'OS', items: rows, rowKey: r => blank(r.OS), cols: countryCols(rows, C) }),
      matrix({ title: 'Servers by role', header: 'Role', items: rows, rowKey: r => blank(r.Role), cols: countryCols(rows, C) }),
    ],
  };
}

// ── Locked Items ─────────────────────────────────────────────────────────────
function locked(rows) {
  const C = (r) => r.Country;
  const order = countryOrder(rows, C);
  return {
    title: 'Locked Items', subtitle: 'assets locked by a User Name / AD Name change',
    kpis: [kpi('Locked items', rows, C, order, 'purple')],
    tables: [
      matrix({ title: 'Locked items by country', header: 'Country', items: rows, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: colsBy(rows, r => blank(r.Status)) }),
      matrix({ title: 'By cost center', header: 'Cost center', items: rows, rowKey: r => blank(r['Cost Center']), cols: countryCols(rows, C), top: 15 }),
      matrix({ title: 'By model', header: 'Brand / model', items: rows, rowKey: r => blank(r['Brand/Model']), cols: countryCols(rows, C), top: 11, totalRow: false }),
    ],
  };
}

// ── Offboarding ──────────────────────────────────────────────────────────────
function offboarding(rows) {
  const C = (r) => r.Country;
  const order = countryOrder(rows, C);
  const people = [...new Map(rows.map(r => [r.Email || r.Person, r])).values()];
  const months = [...new Set(rows.map(r => String(r['Leaving Date'] || '').slice(0, 7) || '(no date)'))].sort();
  return {
    title: 'Offboarding Reclaim', subtitle: 'leaving people and the assets they hold',
    kpis: [kpi('Leaving people', people, C, order, 'amber'), kpi('Assets to reclaim', rows, C, order, 'red')],
    tables: [
      matrix({ title: 'Assets to reclaim by country', header: 'Country', items: rows, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: colsBy(rows, r => blank(r.Status)) }),
      matrix({ title: 'Assets by leaving month', header: 'Month', items: rows, rowKey: r => String(r['Leaving Date'] || '').slice(0, 7) || '(no date)',
        order: months, cols: countryCols(rows, C) }),
    ],
  };
}

// ── Licenses (scope: a country or Global) ────────────────────────────────────
function licenses(rows) {
  const C = (r) => r.Scope;
  const order = countryOrder(rows, C);
  const sum = (list, k) => list.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const soon = rows.filter(r => { const t = Date.parse(r.Renewal); return Number.isFinite(t) && t - Date.now() <= 90 * 86400000; });
  const seats = (label, key, color) => ({ label, value: sum(rows, key), color,
    split: order.map(c => ({ code: c === 'Global' ? 'GL' : require('./report-dash').code(c), country: c, n: sum(rows.filter(r => blank(C(r), 'Unknown') === c), key) })) });
  return {
    title: 'Licenses', subtitle: `${rows.length} licenses`,
    kpis: [kpi('Licenses', rows, C, order, 'blue'), seats('Seats used', 'Seats Used', 'green'), seats('Total seats', 'Total Seats', 'grey'),
      kpi('Renewal ≤ 90 days', soon, C, order, 'amber')],
    tables: [
      { kind: 'matrix', title: 'Seats per license', note: 'used vs free', headers: ['License', 'Total seats', 'Used', 'Free'],
        rows: rows.slice().sort((a, b) => (Number(b['Total Seats']) || 0) - (Number(a['Total Seats']) || 0)).slice(0, 15)
          .map(r => { const t = Number(r['Total Seats']) || 0, u = Number(r['Seats Used']) || 0; return [`${r.Name}${r.Scope ? ` (${r.Scope})` : ''}`, t, u, Math.max(0, t - u)]; }),
        styles: [], colors: ['1A56DB', 'CBD5E1'], mix: true },
      matrix({ title: 'Licenses by type', header: 'Type', items: rows, rowKey: r => blank(r.Type), cols: countryCols(rows, C) }),
    ],
  };
}

// ── Open Maintenance ─────────────────────────────────────────────────────────
function maintenance(rows) {
  const C = (r) => r.Country;
  const order = countryOrder(rows, C);
  return {
    title: 'Open Maintenance', subtitle: 'repairs / services not done yet',
    kpis: [kpi('Open items', rows, C, order, 'amber'), kpi('In progress', rows.filter(r => r.Status === 'in_progress'), C, order, 'blue'),
      kpi('Not started', rows.filter(r => r.Status === 'open'), C, order, 'red')],
    tables: [
      matrix({ title: 'Open items by country', header: 'Country', items: rows, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: colsBy(rows, r => blank(r.Status), ['open', 'in_progress']) }),
      matrix({ title: 'By type', header: 'Type', items: rows, rowKey: r => blank(r.Type), cols: countryCols(rows, C) }),
      matrix({ title: 'Assets or servers', header: 'Item type', items: rows, rowKey: r => blank(r['Item Type']), cols: countryCols(rows, C) }),
    ],
  };
}

// ── Devices (Intune / Entra) ─────────────────────────────────────────────────
function devices(devs, diffs) {
  const C = (d) => d.Country;
  const order = countryOrder(devs, C);
  const isComp = (d) => /^compliant$/i.test(d.Compliance);
  return {
    title: 'Devices (Intune / Entra)', subtitle: 'devices of AD users from the last Device Check upload',
    kpis: [kpi('Devices', devs, C, order, 'blue'), kpi('Compliant', devs.filter(isComp), C, order, 'green'),
      kpi('Not compliant', devs.filter(d => d.Compliance && !isComp(d)), C, order, 'red'),
      kpi('Not in Asset Inventory', devs.filter(d => d['In Asset Inventory'] === 'No'), C, order, 'amber'),
      kpi('Differences to check', diffs, C, order, 'purple'),
      kpi('No check-in 30+ days', devs.filter(d => d['Days since check-in'] !== '' && d['Days since check-in'] > 30), C, order, 'grey')],
    tables: [
      matrix({ title: 'Compliance by country', header: 'Country', items: devs, rowKey: d => blank(C(d), 'Unknown'), order,
        cols: colsBy(devs, d => blank(d.Compliance), ['Compliant', 'Noncompliant', 'In grace period']) }),
      matrix({ title: 'Last Intune check-in', header: 'Country', items: devs, rowKey: d => blank(C(d), 'Unknown'), order,
        cols: bucketCols(devs, d => daysBucket(d['Days since check-in']), DAYS_ORDER, DAYS_COLORS) }),
      matrix({ title: 'Differences to check', header: 'Check', items: diffs, rowKey: d => blank(d.Check), cols: countryCols(diffs, C) }),
      matrix({ title: 'Devices by OS', header: 'OS', items: devs, rowKey: d => blank(d.OS), cols: countryCols(devs, C) }),
      matrix({ title: 'Ownership', header: 'Ownership', items: devs, rowKey: d => blank(d.Ownership), cols: countryCols(devs, C) }),
    ],
  };
}

// ── User activity ────────────────────────────────────────────────────────────
function activity(rows, needs) {
  const C = (r) => r.Country;
  const order = countryOrder(rows, C);
  const people = rows.filter(r => !/^Resource/.test(r['Account type']));
  const reasons = needs.flatMap(r => r['Needs check'].split('; ').map(x => ({ x, Country: r.Country })));
  return {
    title: 'User activity (AD / Intune / Entra)', subtitle: 'last sign of each person in AD, Intune and Entra',
    kpis: [kpi('People', rows, C, order, 'blue'), kpi('Need a check', needs, C, order, 'red'),
      kpi('Never logged on', needs.filter(r => /Never/.test(r['Needs check'])), C, order, 'amber'),
      kpi('No activity 90+ days', needs.filter(r => /No AD/.test(r['Needs check'])), C, order, 'purple'),
      kpi('Resource accounts', rows.filter(r => /^Resource/.test(r['Account type'])), C, order, 'grey')],
    tables: [
      matrix({ title: 'Last seen (AD / Intune / Entra)', header: 'Country', items: people, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: bucketCols(people, r => daysBucket(r['Days since last seen']), DAYS_ORDER, DAYS_COLORS), note: 'resource accounts not included' }),
      matrix({ title: 'Why they need a check', header: 'Reason', items: reasons, rowKey: r => r.x, cols: countryCols(reasons, C), totalRow: false }),
      matrix({ title: 'Account type', header: 'Country', items: rows, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: colsBy(rows, r => r['Account type'], ['User', 'Not in AD list']) }),
    ],
  };
}

// ── Broken & Stock + spare parts ─────────────────────────────────────────────
function broken(raw, laptops) {
  const C = (a) => a.country;
  const order = countryOrder(raw, C);
  const B = raw.filter(a => a.status === 'Broken'), S = raw.filter(a => a.status === 'Stock');
  const BS = [{ label: 'Broken', test: a => a.status === 'Broken' }, { label: 'Stock', test: a => a.status === 'Stock' }];
  // Spare parts per country (each country's broken laptops are its own stock).
  const lapOrder = countryOrder(laptops, C);
  const per = lapOrder.map(c => ({ c, sp: computeSpares(laptops.filter(a => blank(C(a), 'Unknown') === c)) }));
  const all = computeSpares(laptops);
  const spareRows = all.totals.map(t => [t.partName + (t.shared ? ' (any laptop)' : ''), t.stock, ...per.map(p => (p.sp.totals.find(x => x.part === t.part) || {}).stock || 0)]);
  return {
    title: 'Broken & Stock + spare parts', subtitle: 'broken and stock devices, parts of broken laptops',
    kpis: [kpi('Broken', B, C, order, 'red'), kpi('Stock', S, C, order, 'amber'), kpi('Broken laptops', laptops, C, order, 'blue'),
      kpi('Total broken', laptops.filter(a => conditionOf(a) === 'total'), C, order, 'grey'),
      kpi('Parts not checked', laptops.filter(a => conditionOf(a) === 'unchecked'), C, order, 'purple')],
    tables: [
      matrix({ title: 'Broken & stock by country', header: 'Country / site', items: raw, rowKey: a => blank(C(a), 'Unknown'), order, cols: BS,
        sites: (c, list) => vnSites(c, list, a => a.location) }),
      matrix({ title: 'Broken & stock by type', header: 'Asset type', items: raw, rowKey: a => blank(a.asset_type, 'Not set'), cols: BS }),
      { kind: 'matrix', title: 'Spare parts in stock', note: 'from broken laptops, by country', headers: ['Part', 'Total', ...lapOrder],
        rows: spareRows, styles: [], colors: lapOrder.map((c, i) => require('./report-dash').COUNTRY_COLOR[c] || require('./report-dash').PALETTE[i]), mix: true },
      matrix({ title: 'Condition of broken laptops', header: 'Country', items: laptops, rowKey: a => blank(C(a), 'Unknown'), order: lapOrder,
        cols: colsBy(laptops, a => CONDITION_LABEL[conditionOf(a)] || '(not set)', ['Usable parts', 'No usable part left', 'Total broken', 'Parts not checked'])
          .map(c => ({ ...c, color: { 'Usable parts': '16A34A', 'No usable part left': 'D97706', 'Total broken': 'DC2626', 'Parts not checked': '94A3B8' }[c.label] })) }),
    ],
  };
}

// ── System Health ────────────────────────────────────────────────────────────
function health(checks, cols, events) {
  const C = (r) => r.Country;
  const order = countryOrder(checks.length ? checks : cols, C);
  const st = (k) => checks.filter(c => c.Status === k);
  const STATUS = [{ label: 'up', test: c => c.Status === 'up' }, { label: 'warn', test: c => c.Status === 'warn' },
    { label: 'down', test: c => c.Status === 'down' }, { label: 'no data', test: c => c.Status === 'no data' || c.Status === 'unknown' }];
  return {
    title: 'System Health', subtitle: 'routers, switches, servers and web apps checked by the office collectors',
    kpis: [kpi('Checks', checks, C, order, 'blue'), kpi('Up', st('up'), C, order, 'green'), kpi('Warning', st('warn'), C, order, 'amber'),
      kpi('Down', st('down'), C, order, 'red'), kpi('No data', [...st('no data'), ...st('unknown')], C, order, 'grey'),
      kpi('Collectors online', cols.filter(c => c.State === 'online'), C, order, 'teal')],
    tables: [
      matrix({ title: 'Checks by country', header: 'Country / collector', items: checks, rowKey: c => blank(C(c), 'Unknown'), order, cols: STATUS,
        sites: (c, list) => { const by = new Map(); for (const k of list) { if (!by.has(k.Collector)) by.set(k.Collector, []); by.get(k.Collector).push(k); }
          return by.size > 1 || order.length > 1 ? [...by].map(([label, items]) => ({ label, items })) : null; } }),
      matrix({ title: 'Checks by type', header: 'Type', items: checks, rowKey: c => blank(c.Type), cols: STATUS }),
      matrix({ title: 'Status changes (recent)', header: 'Changed to', items: events, rowKey: e => blank(e.To), cols: countryCols(events, C),
        order: ['down', 'warn', 'up', 'unknown'] }),
    ],
  };
}

// ── Warranty Due ─────────────────────────────────────────────────────────────
function warranty(assetsRows, serverRows) {
  const C = (r) => r.Country;
  const all = [...assetsRows.map(r => ({ ...r, Kind: 'Asset' })), ...serverRows.map(r => ({ ...r, Kind: 'Server' }))];
  const order = countryOrder(all, C);
  const days = (r) => Math.floor((Date.parse(r['Warranty Expiry']) - Date.now()) / 86400000);
  const W_ORDER = ['Expired', '≤ 30 days', '31–60 days', '61–90 days'];
  const wb = (r) => { const d = days(r); return !Number.isFinite(d) ? null : d < 0 ? 'Expired' : d <= 30 ? '≤ 30 days' : d <= 60 ? '31–60 days' : '61–90 days'; };
  return {
    title: 'Warranty Due', subtitle: 'assets and servers with warranty expired or ending within 90 days',
    kpis: [kpi('Expired', all.filter(r => wb(r) === 'Expired'), C, order, 'red'), kpi('Ending ≤ 30 days', all.filter(r => wb(r) === '≤ 30 days'), C, order, 'amber'),
      kpi('Ending 31–90 days', all.filter(r => ['31–60 days', '61–90 days'].includes(wb(r))), C, order, 'blue'),
      kpi('Assets', assetsRows, C, order, 'grey'), kpi('Servers', serverRows, C, order, 'grey')],
    tables: [
      matrix({ title: 'Warranty by country', header: 'Country / site', items: all, rowKey: r => blank(C(r), 'Unknown'), order,
        cols: bucketCols(all, wb, W_ORDER, ['DC2626', 'D97706', '0891B2', '16A34A']), sites: (c, list) => vnSites(c, list, r => r.Location) }),
      matrix({ title: 'By vendor', header: 'Vendor', items: all, rowKey: r => blank(r.Vendor), cols: countryCols(all, C) }),
      matrix({ title: 'Assets or servers', header: 'Kind', items: all, rowKey: r => r.Kind, cols: countryCols(all, C) }),
    ],
  };
}

module.exports = { assets, users, servers, locked, offboarding, licenses, maintenance, devices, activity, broken, health, warranty, withColors };
