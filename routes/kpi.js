/* KPI page — split by country (your countries only).

   utilisation   per ASSET TYPE and country: Active ÷ assets of that type (types serve different purposes, so
                 they are never added together)                       target 85–90 %
   ghost assets  missing in the latest closed stocktake (per country / site), still on the register
   data quality  per ASSET TYPE and country: assets without missing info (same rule as Needs Attention) ÷ assets
                 checked                                               target 98 %
   repair time   average days reported → done (Maintenance log, last 12 months), open repairs
   recovery      leaver assets back within 7 days of the leaving date   target 95 %
   depreciation  cost, book value (straight-line, 5 years by default), fully depreciated still Active
   A snapshot per country is saved once a day for the current month (kpi_snapshots) → monthly trend.

   GET /api/kpi
   GET /api/kpi/depreciation-years · PUT (global IT admin) { default, Vietnam, Thailand, … } */

const express = require('express');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, isITAdmin } = require('../middleware/auth');
const { countrySql, scopeList } = require('../lib/scope');
const fin = require('../lib/finance');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0 ? res.status(403).json({ error: 'No access' }) : next()));

const CORE = ['Vietnam', 'Thailand', 'Malaysia'];
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

router.get('/depreciation-years', wrap(async (req, res) => res.json({ years: await fin.getYearsMap(), canEdit: isITAdmin(req.user) && !scopeList(req) })));
router.put('/depreciation-years', wrap(async (req, res) => {
  if (!isITAdmin(req.user) || scopeList(req)) return res.status(403).json({ error: 'Only a global IT admin can change depreciation years' });
  const years = await fin.setYearsMap(req.body || {});
  await audit(req.user, 'UPDATE', null, `Depreciation years set: ${Object.entries(years).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  res.json({ years });
}));

/** All KPIs for the signed-in user's countries (used by the page and by Reports → KPIs). */
async function computeKpi(req) {
  const cs = countrySql(req, 'country', '');
  const W = cs.clause ? ` AND ${cs.clause}` : '';
  const assets = await all(`SELECT id, country, location, status, asset_type, cost, purchase_date FROM assets WHERE deleted_at IS NULL${W}`, cs.params);
  const countries = [...new Set(assets.map(a => a.country || 'Unknown'))]
    .sort((a, b) => (CORE.indexOf(a) + 1 || 99) - (CORE.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const per = Object.fromEntries(countries.map(c => [c, { country: c }]));
  const ofC = (c) => assets.filter(a => (a.country || 'Unknown') === c);

  // Utilisation — per asset type × country (a laptop fleet and a printer fleet are not comparable).
  const typeOf = (a) => (String(a.asset_type || '').trim() || 'Type not set');
  const typeTotals = new Map();
  for (const a of assets) typeTotals.set(typeOf(a), (typeTotals.get(typeOf(a)) || 0) + 1);
  const types = [...typeTotals.keys()].sort((x, y) => (x === 'Type not set') - (y === 'Type not set') || typeTotals.get(y) - typeTotals.get(x));
  const utilisation = types.map(t => {
    const row = { type: t, total: typeTotals.get(t), byCountry: {} };
    for (const c of countries) {
      const l = ofC(c).filter(a => typeOf(a) === t);
      if (!l.length) continue;
      const act = l.filter(a => a.status === 'Active').length;
      row.byCountry[c] = { value: pct(act, l.length), active: act, stock: l.filter(a => a.status === 'Stock').length,
        broken: l.filter(a => a.status === 'Broken').length, other: l.filter(a => !['Active', 'Stock', 'Broken'].includes(a.status)).length, total: l.length };
    }
    return row;
  });
  for (const c of countries) per[c].utilisation = Object.fromEntries(utilisation.filter(r => r.byCountry[c]).map(r => [r.type, r.byCountry[c].value]));

  // Data quality — per asset type × country (same rule as Needs Attention; exempt types such as Screen /
  // IP phone / Camera are not checked).
  const { MISSING_PC_AD_SQL, NOT_FLAGGED_SQL, NO_FLAG_TYPES } = require('./assets').quality;
  const dqRows = await all(`SELECT country, COALESCE(NULLIF(TRIM(asset_type), ''), 'Type not set') AS t, COUNT(*) AS n,
        SUM(CASE WHEN serial_no IS NULL OR serial_no = '' THEN 1 ELSE 0 END) AS no_serial,
        SUM(CASE WHEN asset_code IS NULL OR asset_code = '' THEN 1 ELSE 0 END) AS no_code,
        SUM(CASE WHEN ${MISSING_PC_AD_SQL} THEN 1 ELSE 0 END) AS no_pc_ad,
        SUM(CASE WHEN serial_no IN (SELECT serial_no FROM assets WHERE deleted_at IS NULL AND serial_no <> ''${W} GROUP BY serial_no HAVING COUNT(*) > 1) THEN 1 ELSE 0 END) AS dup,
        SUM(CASE WHEN serial_no IS NULL OR serial_no = '' OR asset_code IS NULL OR asset_code = '' OR ${MISSING_PC_AD_SQL} OR
          serial_no IN (SELECT serial_no FROM assets WHERE deleted_at IS NULL AND serial_no <> ''${W} GROUP BY serial_no HAVING COUNT(*) > 1) THEN 1 ELSE 0 END) AS bad
      FROM assets WHERE deleted_at IS NULL${W} AND ${NOT_FLAGGED_SQL} GROUP BY country, t`,
    [...cs.params, ...cs.params, ...cs.params, ...NO_FLAG_TYPES]);
  const dqTypes = [...new Set(dqRows.map(r => r.t))];
  const dqTotal = (t) => dqRows.filter(r => r.t === t).reduce((x, r) => x + Number(r.n), 0);
  dqTypes.sort((x, y) => (x === 'Type not set') - (y === 'Type not set') || dqTotal(y) - dqTotal(x));
  const dataQuality = dqTypes.map(t => {
    const row = { type: t, total: dqTotal(t), byCountry: {} };
    for (const r of dqRows.filter(r => r.t === t)) {
      const c = r.country || 'Unknown', n = Number(r.n), bad = Number(r.bad);
      row.byCountry[c] = { value: pct(n - bad, n), complete: n - bad, missing: bad, checked: n,
        noSerial: Number(r.no_serial), noCode: Number(r.no_code), noPcAd: Number(r.no_pc_ad), dup: Number(r.dup) };
    }
    return row;
  });
  for (const c of countries) {
    const l = dataQuality.filter(r => r.byCountry[c]);
    const n = l.reduce((x, r) => x + r.byCountry[c].checked, 0), bad = l.reduce((x, r) => x + r.byCountry[c].missing, 0);
    per[c].dataQuality = { value: pct(n - bad, n), complete: n - bad, missing: bad, checked: n,
      byType: Object.fromEntries(l.map(r => [r.type, r.byCountry[c].value])) };
  }

  // Ghost assets — latest closed stocktake per country / site; missing ones still on the register.
  const takes = await all(`SELECT * FROM stocktakes WHERE status = 'closed'${W} ORDER BY closed_at DESC`, cs.params);
  const latest = new Map();
  for (const t of takes) { const k = `${t.country}|${t.site}`; if (!latest.has(k)) latest.set(k, t); }
  const live = new Set(assets.map(a => a.id));
  for (const c of countries) {
    const ts = [...latest.values()].filter(t => t.country === c);
    if (!ts.length) { per[c].ghost = { value: null, note: 'no stocktake closed yet' }; continue; }
    let expected = 0, missing = 0; const audits = [];
    for (const t of ts) {
      let r = {}; try { r = JSON.parse(t.result || '{}'); } catch { r = {}; }
      const still = (r.missingIds || []).filter(id => live.has(id)).length;
      expected += r.expected || 0; missing += still;
      audits.push({ id: t.id, name: t.name, site: t.site, closed_at: t.closed_at, expected: r.expected || 0, missing: still });
    }
    per[c].ghost = { value: pct(missing, expected), missing, expected, audits };
  }

  // Repair time (assets, last 12 months) + open repairs
  const mcs = countrySql(req, 'country', '');
  const rep = await all(`SELECT country, status, reported_at, resolved_at FROM maintenance_log WHERE asset_type = 'asset'
      AND (status <> 'done' OR resolved_at >= datetime('now', '-365 days'))${mcs.clause ? ' AND ' + mcs.clause : ''}`, mcs.params);
  for (const c of countries) {
    const l = rep.filter(r => (r.country || 'Unknown') === c);
    const done = l.filter(r => r.status === 'done' && r.resolved_at && r.reported_at);
    const days = done.map(r => Math.max(0, (Date.parse(String(r.resolved_at).replace(' ', 'T') + 'Z') - Date.parse(String(r.reported_at).replace(' ', 'T') + 'Z')) / 86400000));
    per[c].repair = { value: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : null, done: done.length, open: l.filter(r => r.status !== 'done').length };
  }

  // Leaver recovery (7 days)
  const recovery = await require('./leavers').recovery(req);
  for (const c of countries) { const r = recovery[c]; per[c].recovery = r ? { value: pct(r.onTime, r.due), ...r } : { value: null, due: 0, onTime: 0, late: 0, open: 0 }; }

  // Depreciation
  const years = await fin.getYearsMap();
  for (const c of countries) {
    const sums = {}; let withData = 0, fully = 0, fullyActive = 0, ending12 = 0;
    for (const a of ofC(c)) {
      const d = fin.depreciation(a, years);
      if (!d) continue;
      withData++;
      const cur = d.currency || '?';
      sums[cur] = sums[cur] || { cost: 0, book: 0 };
      sums[cur].cost += d.cost; sums[cur].book += d.bookValue;
      if (d.fully) { fully++; if (a.status === 'Active') fullyActive++; }
      else if (Date.parse(d.endDate) - Date.now() < 365 * 86400000) ending12++;
    }
    per[c].depreciation = { years: fin.yearsFor(years, c), withData, without: ofC(c).length - withData, fully, fullyActive, ending12, sums };
  }

  // Snapshot (one per country per month, refreshed daily) + trend of the last 12 months
  const month = new Date().toISOString().slice(0, 7);
  for (const c of countries) {
    const p = per[c];
    const snap = { utilisationByType: p.utilisation, dataQualityByType: p.dataQuality.byType, ghost: p.ghost.value, repair: p.repair.value, recovery: p.recovery.value, at: new Date().toISOString().slice(0, 10) };
    await run('INSERT INTO kpi_snapshots (month, country, data) VALUES (?, ?, ?) ON CONFLICT (month, country) DO UPDATE SET data = excluded.data', [month, c, JSON.stringify(snap)]);
  }
  const hist = countries.length ? await all(`SELECT * FROM kpi_snapshots WHERE month >= ? AND country IN (${countries.map(() => '?').join(',')}) ORDER BY month`,
    [new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 7), ...countries]) : [];
  for (const c of countries) per[c].trend = hist.filter(h => h.country === c).map(h => { let d = {}; try { d = JSON.parse(h.data); } catch { d = {}; } return { month: h.month, ...d }; });

  return { countries, per, utilisation, dataQuality, exemptTypes: NO_FLAG_TYPES, targets: { utilisation: [85, 90], dataQuality: 98, ghost: 0, recovery: 95 },
    depreciationYears: years, canEditYears: isITAdmin(req.user) && !scopeList(req) };
}
router.get('/', wrap(async (req, res) => res.json(await computeKpi(req))));


module.exports = router;
module.exports.computeKpi = computeKpi;
