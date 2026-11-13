/* Stocktake (physical audit with QR labels) + QR label data.

   A campaign covers one country, or one Vietnam site (Office / Factory). IT walks around and scans each
   asset's QR label with the phone (or types its code / serial). Results:
     found      registered here and scanned
     elsewhere  scanned here but registered at another country / site → "Move here" fixes the record
     missing    registered here but not scanned (when the campaign is closed: possible ghost assets)
     unknown    a code that matches no asset → add it to Asset Inventory
   A QR label holds only the asset's link (…/scan.html?a=<id>) — no personal data.

   GET  /api/stocktake                      campaigns (your countries)
   POST /api/stocktake                      { name, country, site }            admin / editor
   GET  /api/stocktake/:id                  campaign + expected assets + scans
   POST /api/stocktake/:id/scan             { code, note }                     admin / editor
   POST /api/stocktake/:id/move/:assetId    record the asset at this campaign's country / site
   POST /api/stocktake/:id/close            snapshot the result                admin / editor
   GET  /api/stocktake/labels?ids=1,2 | ?country=&site=&type=   QR labels (SVG)
   GET  /api/stocktake/asset/:id            short asset card for scan.html */

const express = require('express');
const QRCode = require('qrcode');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { inScope, countrySql } = require('../lib/scope');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0 ? res.status(403).json({ error: 'No access to Asset Inventory' }) : next()));

const SITES = ['Office', 'Factory'];
const str = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n);
const origin = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
const scanUrl = (req, id) => `${origin(req)}/scan.html?a=${id}`;
const COLS = 'id, asset_code, asset_s4, asset_type, brand_model, serial_no, computer_no, country, location, status, user_name, ad_name';
// Assets a campaign expects: its country, and its site when it has one (Vietnam Office / Factory).
const expectedSql = (t) => ({ sql: `deleted_at IS NULL AND country = ?${t.site ? ' AND location = ?' : ''}`, params: t.site ? [t.country, t.site] : [t.country] });
const isHere = (t, a) => a.country === t.country && (!t.site || a.location === t.site);

async function campaign(req, res) {
  const t = await get('SELECT * FROM stocktakes WHERE id = ?', [req.params.id]);
  if (!t) { res.status(404).json({ error: 'Stocktake not found' }); return null; }
  if (!inScope(req, t.country)) { res.status(403).json({ error: 'Not in your region' }); return null; }
  return t;
}

router.get('/', wrap(async (req, res) => {
  const cs = countrySql(req, 'country', '');
  const list = await all(`SELECT t.*, (SELECT COUNT(*) FROM stocktake_scans s WHERE s.stocktake_id = t.id) AS scans
      FROM stocktakes t ${cs.clause ? 'WHERE ' + cs.clause : ''} ORDER BY t.id DESC LIMIT 100`, cs.params);
  for (const t of list) { try { t.result = t.result ? JSON.parse(t.result) : null; } catch { t.result = null; } }
  res.json(list);
}));

router.post('/', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const b = req.body || {};
  const country = str(b.country, 60), site = SITES.includes(b.site) && country === 'Vietnam' ? b.site : '';
  if (!country) return res.status(400).json({ error: 'Pick a country' });
  if (!inScope(req, country)) return res.status(403).json({ error: 'Not in your region' });
  const name = str(b.name, 80) || `${country}${site ? ' ' + site : ''} audit ${new Date().toISOString().slice(0, 10)}`;
  const e = expectedSql({ country, site });
  const expected = Number((await get(`SELECT COUNT(*) AS c FROM assets WHERE ${e.sql}`, e.params)).c);
  const r = await run('INSERT INTO stocktakes (name, country, site, expected, created_by) VALUES (?, ?, ?, ?, ?)',
    [name, country, site, expected, req.user.username]);
  await audit(req.user, 'STOCKTAKE', null, `Started stocktake "${name}" (${expected} assets expected)`);
  res.status(201).json({ id: Number(r.lastInsertRowid), name, expected });
}));

// Labels (registered before /:id so "labels" is not read as an id).
router.get('/labels', wrap(async (req, res) => {
  let rows;
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) return res.json([]);
    rows = await all(`SELECT ${COLS} FROM assets WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ids);
  } else {
    const country = str(req.query.country, 60);
    if (!country) return res.status(400).json({ error: 'Pick a country or assets' });
    const cond = ['deleted_at IS NULL', 'country = ?'], params = [country];
    if (req.query.site) { cond.push('location = ?'); params.push(str(req.query.site, 20)); }
    if (req.query.type) { cond.push('LOWER(asset_type) = LOWER(?)'); params.push(str(req.query.type, 40)); }
    rows = await all(`SELECT ${COLS} FROM assets WHERE ${cond.join(' AND ')} ORDER BY asset_type, brand_model, id LIMIT 500`, params);
  }
  rows = rows.filter(a => inScope(req, a.country));
  const out = [];
  for (const a of rows) {
    out.push({ id: a.id, code: a.asset_s4 || a.asset_code || '', model: a.brand_model || '', serial: a.serial_no || '', pc: a.computer_no || '',
      country: a.country, site: a.location || '', type: a.asset_type || '',
      svg: await QRCode.toString(scanUrl(req, a.id), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) });
  }
  res.json(out);
}));

router.get('/asset/:aid', wrap(async (req, res) => {
  const a = await get(`SELECT ${COLS}, purchase_date, department FROM assets WHERE id = ? AND deleted_at IS NULL`, [req.params.aid]);
  if (!a) return res.status(404).json({ error: 'Asset not found (deleted?)' });
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'Not in your region' });
  const cs = countrySql(req, 'country', '');
  const open = await all(`SELECT id, name, country, site FROM stocktakes WHERE status = 'open'${cs.clause ? ' AND ' + cs.clause : ''} ORDER BY id DESC`, cs.params);
  res.json({ asset: a, openStocktakes: open });
}));

router.get('/:id', wrap(async (req, res) => {
  const t = await campaign(req, res); if (!t) return;
  const e = expectedSql(t);
  const expected = await all(`SELECT ${COLS} FROM assets WHERE ${e.sql} ORDER BY asset_type, brand_model, id`, e.params);
  const scans = await all(`SELECT s.*, a.asset_code, a.asset_s4, a.asset_type, a.brand_model, a.serial_no, a.computer_no, a.country, a.location, a.status, a.user_name
      FROM stocktake_scans s LEFT JOIN assets a ON a.id = s.asset_id WHERE s.stocktake_id = ? ORDER BY s.id DESC`, [t.id]);
  const scanned = new Set(scans.filter(s => s.asset_id).map(s => s.asset_id));
  try { t.result = t.result ? JSON.parse(t.result) : null; } catch { t.result = null; }
  res.json({
    stocktake: t,
    found: scans.filter(s => s.result === 'found'),
    elsewhere: scans.filter(s => s.result === 'elsewhere'),
    unknown: scans.filter(s => s.result === 'unknown'),
    missing: expected.filter(a => !scanned.has(a.id)),
    expected: expected.length,
  });
}));

// A scanned value → asset: the QR link (…?a=<id>), an id, an asset code (S4 / ECC), a serial or a computer no.
async function resolve(code) {
  const c = str(code, 300);
  const m = c.match(/[?&]a=(\d+)/) || c.match(/^#?(\d{1,7})$/);
  if (m) { const a = await get(`SELECT ${COLS} FROM assets WHERE id = ? AND deleted_at IS NULL`, [Number(m[1])]); if (a) return a; }
  if (!c) return null;
  return get(`SELECT ${COLS} FROM assets WHERE deleted_at IS NULL AND (asset_s4 = ? OR asset_code = ? OR LOWER(serial_no) = LOWER(?) OR LOWER(computer_no) = LOWER(?))
      ORDER BY id LIMIT 1`, [c, c, c, c]);
}

router.post('/:id/scan', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const t = await campaign(req, res); if (!t) return;
  if (t.status !== 'open') return res.status(400).json({ error: 'This stocktake is closed' });
  const code = str((req.body || {}).code, 300), note = str((req.body || {}).note, 300);
  if (!code) return res.status(400).json({ error: 'Nothing scanned' });
  const a = await resolve(code);
  if (!a) {
    await run('INSERT INTO stocktake_scans (stocktake_id, code, result, note, scanned_by) VALUES (?, ?, ?, ?, ?)', [t.id, code, 'unknown', note, req.user.username]);
    return res.json({ result: 'unknown', code });
  }
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'That asset belongs to a country outside your region' });
  const prev = await get('SELECT result, scanned_at, scanned_by FROM stocktake_scans WHERE stocktake_id = ? AND asset_id = ?', [t.id, a.id]);
  if (prev) return res.json({ result: prev.result, already: true, asset: a, scanned_at: prev.scanned_at, scanned_by: prev.scanned_by });
  const result = isHere(t, a) ? 'found' : 'elsewhere';
  await run('INSERT INTO stocktake_scans (stocktake_id, asset_id, code, result, note, scanned_by) VALUES (?, ?, ?, ?, ?, ?)',
    [t.id, a.id, code, result, note, req.user.username]);
  res.json({ result, asset: a });
}));

router.post('/:id/move/:assetId', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const t = await campaign(req, res); if (!t) return;
  const a = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.assetId]);
  if (!a) return res.status(404).json({ error: 'Asset not found' });
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'Not in your region' });
  const loc = t.country === 'Vietnam' ? (t.site || a.location || '') : '';
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `${ts} UTC: edited Country / Location: "${a.country || '∅'} / ${a.location || '∅'}"→"${t.country} / ${loc || '∅'}" (found in stocktake "${t.name}") by ${req.user.username}`;
  await run('UPDATE assets SET country = ?, location = ?, history_usage = ? WHERE id = ?',
    [t.country, loc, a.history_usage ? `${a.history_usage}\n${line}` : line, a.id]);
  await run("UPDATE stocktake_scans SET result = 'found', note = TRIM(note || ' (moved here)') WHERE stocktake_id = ? AND asset_id = ?", [t.id, a.id]);
  await audit(req.user, 'STOCKTAKE', a.id, `Moved "${a.asset_s4 || a.asset_code || '#' + a.id}" to ${t.country}${loc ? ' · ' + loc : ''} (found in stocktake "${t.name}")`);
  res.json({ ok: true });
}));

router.post('/:id/close', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const t = await campaign(req, res); if (!t) return;
  if (t.status !== 'open') return res.status(400).json({ error: 'Already closed' });
  const e = expectedSql(t);
  const expected = await all(`SELECT id FROM assets WHERE ${e.sql}`, e.params);
  const scans = await all('SELECT asset_id, result FROM stocktake_scans WHERE stocktake_id = ?', [t.id]);
  const scanned = new Set(scans.filter(s => s.asset_id).map(s => s.asset_id));
  const missing = expected.filter(a => !scanned.has(a.id)).map(a => a.id);
  const result = { expected: expected.length, found: scans.filter(s => s.result === 'found').length,
    elsewhere: scans.filter(s => s.result === 'elsewhere').length, unknown: scans.filter(s => s.result === 'unknown').length,
    missing: missing.length, missingIds: missing };
  await run("UPDATE stocktakes SET status = 'closed', closed_at = datetime('now'), expected = ?, result = ? WHERE id = ?",
    [expected.length, JSON.stringify(result), t.id]);
  await audit(req.user, 'STOCKTAKE', null, `Closed stocktake "${t.name}": ${result.found} found, ${result.missing} missing, ${result.elsewhere} elsewhere, ${result.unknown} unknown`);
  res.json({ ok: true, result });
}));

module.exports = router;
