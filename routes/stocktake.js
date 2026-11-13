/* Stocktake (physical audit with QR labels) + QR label data.

   A campaign covers one country, or one Vietnam site (Office / Factory). IT walks around and scans each
   asset's QR label with the phone (or types its code / serial). Results:
     found      registered here and scanned
     elsewhere  scanned here but registered at another country / site → "Move here" fixes the record
     missing    registered here but not scanned (when the campaign is closed: possible ghost assets)
     outside    at this place but not in this stocktake's filter (status / department / type)
     unknown    a code that matches no asset → add it to Asset Inventory
   Optional filters when starting: status (Active / Broken / Stock), department, asset type.
   Every scan is logged (qr_scans: who, when, where from, result) and every label print (qr_prints: purpose,
   who, when). Admins see the counts / history, and are asked for a photo after a scan (asset_photos).
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
const { PARTS, CONDITION_LABEL, parseParts, conditionOf } = require('../lib/parts');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0 ? res.status(403).json({ error: 'No access to Asset Inventory' }) : next()));

const SITES = ['Office', 'Factory'];
const str = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n);
const origin = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
const scanUrl = (req, id) => `${origin(req)}/scan.html?a=${id}`;
const COLS = 'id, asset_code, asset_s4, asset_type, brand_model, serial_no, computer_no, country, location, status, user_name, ad_name, department';
const STATUSES = ['Active', 'Broken', 'Stock'];
// Assets a campaign expects: its country, its site (Vietnam Office / Factory), and the optional filters
// status / department / asset type.
function expectedSql(t) {
  const cond = ['deleted_at IS NULL', 'country = ?'], params = [t.country];
  if (t.site) { cond.push('location = ?'); params.push(t.site); }
  if (t.status_filter) { cond.push('status = ?'); params.push(t.status_filter); }
  if (t.department) { cond.push("COALESCE(department, '') = ?"); params.push(t.department === '(not set)' ? '' : t.department); }
  if (t.asset_type) { cond.push("LOWER(COALESCE(asset_type, '')) = LOWER(?)"); params.push(t.asset_type === '(not set)' ? '' : t.asset_type); }
  return { sql: cond.join(' AND '), params };
}
const isHere = (t, a) => a.country === t.country && (!t.site || a.location === t.site);
// At this place but not in this stocktake's filter (e.g. an Active laptop while counting Broken ones).
const inFilter = (t, a) => (!t.status_filter || a.status === t.status_filter)
  && (!t.department || (a.department || '') === (t.department === '(not set)' ? '' : t.department))
  && (!t.asset_type || String(a.asset_type || '').toLowerCase() === (t.asset_type === '(not set)' ? '' : t.asset_type.toLowerCase()));
const isAdmin = (req) => !!(req.user && req.user.role === 'admin');
const ipOf = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60);
const logScan = (req, v) => run(`INSERT INTO qr_scans (asset_id, code, source, stocktake_id, result, scanned_by, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [v.asset_id || null, str(v.code, 300), v.source, v.stocktake_id || null, v.result || '', req.user.username, ipOf(req)]).catch(() => {});

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
  const f = { country, site, status_filter: STATUSES.includes(b.status) ? b.status : '', department: str(b.department, 120), asset_type: str(b.asset_type, 60) };
  const what = [f.status_filter, f.asset_type, f.department].filter(Boolean).join(' · ');
  const name = str(b.name, 80) || `${country}${site ? ' ' + site : ''}${what ? ' · ' + what : ''} audit ${new Date().toISOString().slice(0, 10)}`;
  const e = expectedSql(f);
  const expected = Number((await get(`SELECT COUNT(*) AS c FROM assets WHERE ${e.sql}`, e.params)).c);
  if (!expected) return res.status(400).json({ error: 'No asset matches this country / site / filter' });
  const r = await run('INSERT INTO stocktakes (name, country, site, status_filter, department, asset_type, expected, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, country, site, f.status_filter, f.department, f.asset_type, expected, req.user.username]);
  await audit(req.user, 'STOCKTAKE', null, `Started stocktake "${name}" (${expected} assets expected)`);
  res.status(201).json({ id: Number(r.lastInsertRowid), name, expected });
}));

// Choices for "New stocktake": departments and asset types (with counts) of a country / site.
router.get('/options', wrap(async (req, res) => {
  const country = str(req.query.country, 60);
  if (!country || !inScope(req, country)) return res.json({ departments: [], types: [], statuses: [] });
  const cond = ['deleted_at IS NULL', 'country = ?'], params = [country];
  if (SITES.includes(req.query.site)) { cond.push('location = ?'); params.push(req.query.site); }
  const W = cond.join(' AND ');
  const departments = await all(`SELECT COALESCE(NULLIF(TRIM(department), ''), '(not set)') AS v, COUNT(*) AS n FROM assets WHERE ${W} GROUP BY v ORDER BY n DESC`, params);
  const types = await all(`SELECT COALESCE(NULLIF(TRIM(asset_type), ''), '(not set)') AS v, COUNT(*) AS n FROM assets WHERE ${W} GROUP BY v ORDER BY n DESC`, params);
  const statuses = await all(`SELECT status AS v, COUNT(*) AS n FROM assets WHERE ${W} GROUP BY status ORDER BY n DESC`, params);
  res.json({ departments, types, statuses, total: statuses.reduce((t, r) => t + Number(r.n), 0) });
}));

// Label prints are recorded (purpose, who, when) — admins see how often each label was printed.
router.post('/labels/printed', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const b = req.body || {};
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 500);
  const purpose = str(b.purpose, 120);
  if (!ids.length) return res.status(400).json({ error: 'No labels' });
  if (!purpose) return res.status(400).json({ error: 'Pick what the labels are for' });
  const rows = await all(`SELECT id, country FROM assets WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const ok = rows.filter(a => inScope(req, a.country)).map(a => a.id);
  const batchId = `${Date.now().toString(36)}-${req.user.username}`;
  for (const id of ok) await run('INSERT INTO qr_prints (asset_id, purpose, batch, printed_by) VALUES (?, ?, ?, ?)', [id, purpose, batchId, req.user.username]);
  await audit(req.user, 'PRINT', ok.length === 1 ? ok[0] : null, `Printed ${ok.length} QR label${ok.length === 1 ? '' : 's'} — ${purpose}`);
  res.json({ ok: true, printed: ok.length });
}));

// Labels (registered before /:id so "labels" is not read as an id).
// Light list for the labels page (no QR images): every asset of your countries, filters optional.
router.get('/labels/list', wrap(async (req, res) => {
  const cs = countrySql(req, 'country', '');
  const cond = ['deleted_at IS NULL'], params = [];
  if (cs.clause) { cond.push(cs.clause); params.push(...cs.params); }
  if (req.query.country) { cond.push('country = ?'); params.push(str(req.query.country, 60)); }
  if (SITES.includes(req.query.site)) { cond.push('location = ?'); params.push(req.query.site); }
  if (req.query.type) { cond.push("LOWER(COALESCE(NULLIF(TRIM(asset_type), ''), 'type not set')) = LOWER(?)"); params.push(str(req.query.type, 60)); }
  if (STATUSES.includes(req.query.status)) { cond.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) { const q = `%${str(req.query.q, 80).toLowerCase()}%`;
    cond.push('(LOWER(asset_s4) LIKE ? OR LOWER(asset_code) LIKE ? OR LOWER(serial_no) LIKE ? OR LOWER(computer_no) LIKE ? OR LOWER(brand_model) LIKE ? OR LOWER(user_name) LIKE ?)');
    params.push(q, q, q, q, q, q); }
  const rows = await all(`SELECT ${COLS} FROM assets WHERE ${cond.join(' AND ')} ORDER BY LOWER(COALESCE(NULLIF(TRIM(brand_model), ''), 'zzz')), asset_type, id LIMIT 3000`, params);
  const counts = new Map();
  if (isAdmin(req) && rows.length) {
    for (const r of await all('SELECT asset_id, COUNT(*) AS n FROM qr_prints GROUP BY asset_id')) counts.set(r.asset_id, { printed: r.n });
    for (const r of await all('SELECT asset_id, COUNT(*) AS n FROM qr_scans WHERE asset_id IS NOT NULL GROUP BY asset_id')) counts.set(r.asset_id, { ...(counts.get(r.asset_id) || {}), scanned: r.n });
  }
  const types = await all(`SELECT COALESCE(NULLIF(TRIM(asset_type), ''), 'Type not set') AS t, COUNT(*) AS n FROM assets WHERE deleted_at IS NULL${cs.clause ? ' AND ' + cs.clause : ''} GROUP BY t ORDER BY n DESC`, cs.params);
  res.json({ isAdmin: isAdmin(req), types, limited: rows.length === 3000, list: rows.map(a => ({ id: a.id, code: a.asset_s4 || a.asset_code || '', model: a.brand_model || '',
    type: a.asset_type || '', serial: a.serial_no || '', pc: a.computer_no || '', country: a.country, site: a.location || '', status: a.status || '',
    holder: a.user_name || a.ad_name || '', ...(isAdmin(req) ? { printed: (counts.get(a.id) || {}).printed || 0, scanned: (counts.get(a.id) || {}).scanned || 0 } : {}) })) });
}));

router.get('/labels', wrap(async (req, res) => {
  let rows;
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) return res.json([]);
    rows = await all(`SELECT ${COLS}, parts, purchase_date FROM assets WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ids);
  } else {
    const country = str(req.query.country, 60);
    if (!country) return res.status(400).json({ error: 'Pick a country or assets' });
    const cond = ['deleted_at IS NULL', 'country = ?'], params = [country];
    if (req.query.site) { cond.push('location = ?'); params.push(str(req.query.site, 20)); }
    if (req.query.type) { cond.push('LOWER(asset_type) = LOWER(?)'); params.push(str(req.query.type, 40)); }
    rows = await all(`SELECT ${COLS}, parts, purchase_date FROM assets WHERE ${cond.join(' AND ')} ORDER BY asset_type, brand_model, id LIMIT 500`, params);
  }
  rows = rows.filter(a => inScope(req, a.country));
  const counts = new Map();
  if (isAdmin(req) && rows.length) {
    const ph = rows.map(() => '?').join(',');
    const ids = rows.map(a => a.id);
    for (const r of await all(`SELECT asset_id, COUNT(*) AS n, MAX(printed_at) AS last FROM qr_prints WHERE asset_id IN (${ph}) GROUP BY asset_id`, ids)) counts.set(r.asset_id, { printed: r.n, lastPrint: r.last });
    for (const r of await all(`SELECT asset_id, COUNT(*) AS n FROM qr_scans WHERE asset_id IN (${ph}) GROUP BY asset_id`, ids)) counts.set(r.asset_id, { ...(counts.get(r.asset_id) || {}), scanned: r.n });
  }
  const out = [];
  for (const a of rows) {
    out.push({ id: a.id, code: a.asset_s4 || a.asset_code || '', model: a.brand_model || '', serial: a.serial_no || '', pc: a.computer_no || '',
      country: a.country, site: a.location || '', type: a.asset_type || '',
      // For the tall label (6.5 × 14 cm): more asset info, and the spare parts of a broken laptop.
      status: a.status || '', department: a.department || '', holder: a.user_name || a.ad_name || '', purchase: a.purchase_date || '',
      ...(() => { const cond = conditionOf(a); if (!cond) return {};
        const p = parseParts(a.parts);
        return { condition: CONDITION_LABEL[cond], parts: PARTS.map(([k, n]) => ({ part: n, state: p.total ? 'bad' : (p[k] || '') })),
          partsNote: p.note || '', partsChecked: p.checked_at ? `${p.checked_at} UTC · ${p.checked_by || ''}` : '' }; })(),
      ...(isAdmin(req) ? { printed: (counts.get(a.id) || {}).printed || 0, lastPrint: (counts.get(a.id) || {}).lastPrint || '', scanned: (counts.get(a.id) || {}).scanned || 0 } : {}),
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
  if (req.query.from === 'label') await logScan(req, { asset_id: a.id, code: `scan.html?a=${a.id}`, source: 'label', result: 'opened' });
  res.json({ asset: a, openStocktakes: open, isAdmin: isAdmin(req) });
}));

// QR history of an asset (admins): label prints, every scan (who / when / where), photos.
router.get('/asset/:aid/qr', wrap(async (req, res) => {
  const a = await get('SELECT id, country FROM assets WHERE id = ?', [req.params.aid]);
  if (!a) return res.status(404).json({ error: 'Asset not found' });
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'Not in your region' });
  const photos = await all('SELECT id, stocktake_id, note, size, taken_by, taken_at FROM asset_photos WHERE asset_id = ? ORDER BY id DESC', [a.id]);
  if (!isAdmin(req)) return res.json({ admin: false, photos });
  const prints = await all('SELECT purpose, printed_by, printed_at FROM qr_prints WHERE asset_id = ? ORDER BY id DESC', [a.id]);
  const scans = await all(`SELECT q.source, q.result, q.scanned_by, q.scanned_at, q.ip, t.name AS stocktake FROM qr_scans q
      LEFT JOIN stocktakes t ON t.id = q.stocktake_id WHERE q.asset_id = ? ORDER BY q.id DESC LIMIT 200`, [a.id]);
  res.json({ admin: true, prints, scans, photos });
}));

// Photo of an asset (taken after a scan). Admins; the phone shrinks it to ≤ 1280 px JPEG first.
const MAX_PHOTO = 1.5 * 1024 * 1024;
router.post('/asset/:aid/photo', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Only an admin can add photos' });
  const a = await get('SELECT id, country, asset_s4, asset_code FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.aid]);
  if (!a) return res.status(404).json({ error: 'Asset not found' });
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'Not in your region' });
  const b = req.body || {};
  const m = String(b.image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Not an image' });
  const size = Math.floor(m[2].length * 3 / 4);
  if (size > MAX_PHOTO) return res.status(413).json({ error: 'Photo too large' });
  const tid = Number(b.stocktake_id) || null;
  const r = await run('INSERT INTO asset_photos (asset_id, stocktake_id, note, mime, size, data_b64, taken_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [a.id, tid, str(b.note, 200), m[1], size, m[2], req.user.username]);
  await audit(req.user, 'PHOTO', a.id, `Photo of "${a.asset_s4 || a.asset_code || '#' + a.id}" saved${tid ? ' (stocktake)' : ''}`);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));
router.get('/photo/:pid', wrap(async (req, res) => {
  const p = await get('SELECT p.*, a.country FROM asset_photos p LEFT JOIN assets a ON a.id = p.asset_id WHERE p.id = ?', [Number(String(req.params.pid).replace(/\D/g, ''))]);
  if (!p) return res.status(404).json({ error: 'Photo not found' });
  if (!inScope(req, p.country)) return res.status(403).json({ error: 'Not in your region' });
  res.setHeader('Content-Type', p.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(p.data_b64 || '', 'base64'));
}));

router.get('/:id', wrap(async (req, res) => {
  const t = await campaign(req, res); if (!t) return;
  const e = expectedSql(t);
  const expected = await all(`SELECT ${COLS} FROM assets WHERE ${e.sql} ORDER BY asset_type, brand_model, id`, e.params);
  const scans = await all(`SELECT s.*, a.asset_code, a.asset_s4, a.asset_type, a.brand_model, a.serial_no, a.computer_no, a.country, a.location, a.status, a.user_name, a.department,
        (SELECT COUNT(*) FROM asset_photos p WHERE p.asset_id = s.asset_id AND p.stocktake_id = s.stocktake_id) AS photos
      FROM stocktake_scans s LEFT JOIN assets a ON a.id = s.asset_id WHERE s.stocktake_id = ? ORDER BY s.id DESC`, [t.id]);
  const scanned = new Set(scans.filter(s => s.asset_id).map(s => s.asset_id));
  try { t.result = t.result ? JSON.parse(t.result) : null; } catch { t.result = null; }
  res.json({
    stocktake: t,
    found: scans.filter(s => s.result === 'found'),
    elsewhere: scans.filter(s => s.result === 'elsewhere'),
    outside: scans.filter(s => s.result === 'outside'),
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
    await logScan(req, { code, source: 'stocktake', stocktake_id: t.id, result: 'unknown' });
    return res.json({ result: 'unknown', code });
  }
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'That asset belongs to a country outside your region' });
  const scans = Number((await get('SELECT COUNT(*) AS n FROM qr_scans WHERE asset_id = ?', [a.id])).n) + 1;
  const prev = await get('SELECT result, scanned_at, scanned_by FROM stocktake_scans WHERE stocktake_id = ? AND asset_id = ?', [t.id, a.id]);
  if (prev) {
    await logScan(req, { asset_id: a.id, code, source: 'stocktake', stocktake_id: t.id, result: 'again' });
    return res.json({ result: prev.result, already: true, asset: a, scanned_at: prev.scanned_at, scanned_by: prev.scanned_by, askPhoto: isAdmin(req), ...(isAdmin(req) ? { scans } : {}) });
  }
  const result = !isHere(t, a) ? 'elsewhere' : inFilter(t, a) ? 'found' : 'outside';
  await run('INSERT INTO stocktake_scans (stocktake_id, asset_id, code, result, note, scanned_by) VALUES (?, ?, ?, ?, ?, ?)',
    [t.id, a.id, code, result, note, req.user.username]);
  await logScan(req, { asset_id: a.id, code, source: 'stocktake', stocktake_id: t.id, result });
  res.json({ result, asset: a, askPhoto: isAdmin(req), ...(isAdmin(req) ? { scans } : {}) });
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
    elsewhere: scans.filter(s => s.result === 'elsewhere').length, outside: scans.filter(s => s.result === 'outside').length,
    unknown: scans.filter(s => s.result === 'unknown').length,
    missing: missing.length, missingIds: missing };
  await run("UPDATE stocktakes SET status = 'closed', closed_at = datetime('now'), expected = ?, result = ? WHERE id = ?",
    [expected.length, JSON.stringify(result), t.id]);
  await audit(req.user, 'STOCKTAKE', null, `Closed stocktake "${t.name}": ${result.found} found, ${result.missing} missing, ${result.elsewhere} elsewhere, ${result.unknown} unknown`);
  res.json({ ok: true, result });
}));

module.exports = router;
