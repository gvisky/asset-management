/* Model catalogue + warranty fill (Inventory → 📚 Models).

   GET  /api/catalog/models            catalogue + every Brand/Model text in use with a clean-up proposal
   POST /api/catalog/models            add / edit a catalogue model (IT admin)
   DELETE /api/catalog/models/:id      remove a catalogue model (assets keep their text)
   POST /api/catalog/merge             rename many Brand/Model texts to one catalogue name (+ fill empty asset types)
   POST /api/catalog/fill-types        fill empty Asset Type from the catalogue
   GET  /api/catalog/warranty          assets without a warranty date, per maker
   GET  /api/catalog/warranty/serials  their serials (.xlsx, or ?format=txt one per line) to check on the vendor site
   POST /api/catalog/warranty/apply    vendor results [{serial, end}] → Warranty Expiry (preview with dry)
   POST /api/catalog/warranty/estimate purchase date + model warranty years → Warranty Expiry, marked "estimated"

   Every change is limited to the user's countries and written to the asset's History Usage. */

const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { get, all, run, batch, audit, getMeta, setMeta } = require('../db/database');
const { requireAuth, requireITAdmin, isITAdmin } = require('../middleware/auth');
const { countrySql } = require('../lib/scope');
const { normalizeAssetType } = require('../lib/asset-columns');
const { cleanName, keyOf, isVague, guessType, BRANDS } = require('../lib/model-catalog');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0) ? res.status(403).json({ error: 'No access to Asset Inventory' }) : next());

const scope = (req) => { const c = countrySql(req, 'country', null); return { where: `deleted_at IS NULL${c.clause ? ' AND ' + c.clause : ''}`, params: c.params }; };
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const HIST = `history_usage = CASE WHEN history_usage IS NULL OR history_usage = '' THEN ? ELSE history_usage || char(10) || ? END`;
const noWarranty = `(warranty_expiry IS NULL OR TRIM(warranty_expiry) IN ('', '0', '-'))`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Maker = the catalogue's maker, else the first known brand word of the name ("Monitor Dell 23" → Dell), else "Other".
function makerOf(name, cat) {
  if (cat && cat.maker) return cat.maker;
  const LINE = { surface: 'Microsoft', iphone: 'Apple', ipad: 'Apple', macbook: 'Apple', galaxy: 'Samsung', redmi: 'Xiaomi', thinkpad: 'Lenovo', ideapad: 'Lenovo', latitude: 'Dell', apeosport: 'Fujifilm', laserjet: 'HP' };
  for (const w of cleanName(name).split(/[\s_\-]+/)) { const k = w.toLowerCase(); const b = BRANDS[k] || LINE[k]; if (b) return b; }
  return 'Other';
}

async function catalogue() { return all('SELECT * FROM asset_models ORDER BY name COLLATE NOCASE'); }
const catMap = (rows) => new Map(rows.map(m => [m.name.toLowerCase(), m]));

// ── Catalogue + names in use ──────────────────────────────────────────────────
router.get('/models', wrap(async (req, res) => {
  const s = scope(req);
  const rows = await all(`SELECT TRIM(COALESCE(brand_model, '')) AS name, COALESCE(asset_type, '') AS t, COUNT(*) AS n
    FROM assets WHERE ${s.where} GROUP BY 1, 2`, s.params);
  const cat = await catalogue(), cm = catMap(cat);
  const names = new Map();
  for (const r of rows) {
    const k = r.name;
    if (!names.has(k)) names.set(k, { name: k, count: 0, emptyType: 0, types: {} });
    const o = names.get(k); o.count += r.n;
    if (r.t) o.types[r.t] = (o.types[r.t] || 0) + r.n; else o.emptyType += r.n;
  }
  const list = [...names.values()].map(o => {
    const inCat = cm.get(o.name.toLowerCase());
    const major = Object.entries(o.types).sort((a, b) => b[1] - a[1])[0];
    const clean = inCat ? inCat.name : cleanName(o.name);
    return { ...o, clean, key: keyOf(clean), vague: !o.name || isVague(o.name), model_id: inCat ? inCat.id : null,
      guess: (inCat && inCat.asset_type) || (major && major[0]) || guessType(o.name) };
  }).sort((a, b) => b.count - a.count);
  const usage = {};
  for (const o of list) { const m = cm.get(o.name.toLowerCase()); if (m) { const u = usage[m.id] || (usage[m.id] = { assets: 0, emptyType: 0 }); u.assets += o.count; u.emptyType += o.emptyType; } }
  res.json({ catalogue: cat.map(m => ({ ...m, ...(usage[m.id] || { assets: 0, emptyType: 0 }) })), names: list, canEdit: isITAdmin(req.user),
    totals: { assets: list.reduce((n, o) => n + o.count, 0), names: list.length, emptyType: list.reduce((n, o) => n + o.emptyType, 0) } });
}));

function cleanModel(b) {
  const num = (v, lo, hi) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n < lo || n > hi ? null : n; };
  return {
    name: String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    maker: String(b.maker || '').trim().slice(0, 40),
    asset_type: normalizeAssetType(b.asset_type || ''),
    warranty_years: num(b.warranty_years, 0, 10),
    eos_year: num(b.eos_year, 1990, 2100),
    note: String(b.note || '').trim().slice(0, 300),
  };
}
async function upsertModel(m, user) {
  const ex = await get('SELECT * FROM asset_models WHERE name = ? COLLATE NOCASE', [m.name]);
  if (ex) {
    await run(`UPDATE asset_models SET name = ?, maker = ?, asset_type = ?, warranty_years = ?, eos_year = ?, note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [m.name, m.maker || ex.maker, m.asset_type || ex.asset_type, m.warranty_years != null ? m.warranty_years : ex.warranty_years,
        m.eos_year != null ? m.eos_year : ex.eos_year, m.note || ex.note, user.username, ex.id]);
    return ex.id;
  }
  const r = await run(`INSERT INTO asset_models (name, maker, asset_type, warranty_years, eos_year, note, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [m.name, m.maker || (makerOf(m.name) === 'Other' ? '' : makerOf(m.name)), m.asset_type, m.warranty_years, m.eos_year, m.note, user.username]);
  return Number(r.lastInsertRowid);
}

router.post('/models', requireITAdmin, wrap(async (req, res) => {
  const m = cleanModel(req.body || {});
  if (!m.name) return res.status(400).json({ error: 'Model name is required' });
  const id = Number(req.body.id);
  if (id) {
    const ex = await get('SELECT * FROM asset_models WHERE id = ?', [id]);
    if (!ex) return res.status(404).json({ error: 'Model not found' });
    const clash = await get('SELECT id FROM asset_models WHERE name = ? COLLATE NOCASE AND id <> ?', [m.name, id]);
    if (clash) return res.status(409).json({ error: 'Another catalogue model already has this name' });
    await run(`UPDATE asset_models SET name = ?, maker = ?, asset_type = ?, warranty_years = ?, eos_year = ?, note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [m.name, m.maker, m.asset_type, m.warranty_years, m.eos_year, m.note, req.user.username, id]);
  } else await upsertModel(m, req.user);
  await audit(req.user, 'CATALOG', null, `Model catalogue: saved "${m.name}"`);
  res.json({ ok: true });
}));

router.delete('/models/:id', requireITAdmin, wrap(async (req, res) => {
  const ex = await get('SELECT * FROM asset_models WHERE id = ?', [req.params.id]);
  if (!ex) return res.status(404).json({ error: 'Model not found' });
  await run('DELETE FROM asset_models WHERE id = ?', [ex.id]);
  await audit(req.user, 'CATALOG', null, `Model catalogue: removed "${ex.name}"`);
  res.json({ ok: true });
}));

// ── Merge names → one catalogue model ────────────────────────────────────────
// body { groups: [{ from: [names], to, asset_type, warranty_years? }] }
router.post('/merge', requireITAdmin, wrap(async (req, res) => {
  const groups = Array.isArray(req.body && req.body.groups) ? req.body.groups.slice(0, 500) : [];
  const s = scope(req);
  let locked = [];
  try { locked = JSON.parse(await getMeta('locked_models') || '[]'); } catch { locked = []; }
  let renamed = 0, typed = 0, models = 0; const stmts = [];
  for (const g of groups) {
    const m = cleanModel({ name: g.to, asset_type: g.asset_type, warranty_years: g.warranty_years, maker: g.maker });
    if (!m.name) continue;
    await upsertModel(m, req.user); models++;
    const from = [...new Set((g.from || []).map(x => String(x == null ? '' : x).trim()))].filter(x => x && x !== m.name).slice(0, 200);
    for (const old of from) {
      const ids = await all(`SELECT id FROM assets WHERE ${s.where} AND TRIM(brand_model) = ?`, [...s.params, old]);
      if (!ids.length) continue;
      const line = `${stamp()}: model name cleaned "${old}" → "${m.name}" by ${req.user.username}`;
      const sameText = keyOf(old) === keyOf(m.name);
      stmts.push({ sql: `UPDATE assets SET brand_model = ?, ${HIST}${sameText ? '' : `, remark = CASE WHEN remark IS NULL OR remark = '' THEN ? ELSE remark || char(10) || ? END`}
        WHERE ${s.where} AND TRIM(brand_model) = ?`,
        args: [m.name, line, line, ...(sameText ? [] : [`Model text was: ${old}`, `Model text was: ${old}`]), ...s.params, old] });
      renamed += ids.length;
      if (locked.some(x => x.toLowerCase() === old.toLowerCase())) locked = [...locked.filter(x => x.toLowerCase() !== old.toLowerCase()), m.name];
    }
    if (m.asset_type) {
      const line = `${stamp()}: Asset Type set to "${m.asset_type}" from the model catalogue by ${req.user.username}`;
      const n = await get(`SELECT COUNT(*) AS n FROM assets WHERE ${s.where} AND (asset_type IS NULL OR asset_type = '') AND (TRIM(brand_model) = ? COLLATE NOCASE ${from.length ? `OR TRIM(brand_model) IN (${from.map(() => '?').join(',')})` : ''})`,
        [...s.params, m.name, ...from]);
      typed += n.n;
      stmts.push({ sql: `UPDATE assets SET asset_type = ?, ${HIST} WHERE ${s.where} AND (asset_type IS NULL OR asset_type = '') AND TRIM(brand_model) = ? COLLATE NOCASE`,
        args: [m.asset_type, line, line, ...s.params, m.name] });
    }
  }
  if (stmts.length) await batch(stmts);
  await setMeta('locked_models', JSON.stringify([...new Set(locked)]));
  await audit(req.user, 'CATALOG', null, `Model clean-up: ${models} model(s), ${renamed} asset(s) renamed, ${typed} asset type(s) filled`);
  res.json({ models, renamed, typed });
}));

// ── Fill empty Asset Type from the catalogue ─────────────────────────────────
router.post('/fill-types', requireITAdmin, wrap(async (req, res) => {
  const s = scope(req);
  const cat = (await catalogue()).filter(m => m.asset_type);
  let typed = 0; const stmts = [];
  for (const m of cat) {
    const n = await get(`SELECT COUNT(*) AS n FROM assets WHERE ${s.where} AND (asset_type IS NULL OR asset_type = '') AND TRIM(brand_model) = ? COLLATE NOCASE`, [...s.params, m.name]);
    if (!n.n) continue;
    typed += n.n;
    const line = `${stamp()}: Asset Type set to "${m.asset_type}" from the model catalogue by ${req.user.username}`;
    stmts.push({ sql: `UPDATE assets SET asset_type = ?, ${HIST} WHERE ${s.where} AND (asset_type IS NULL OR asset_type = '') AND TRIM(brand_model) = ? COLLATE NOCASE`,
      args: [m.asset_type, line, line, ...s.params, m.name] });
  }
  if (stmts.length) await batch(stmts);
  if (typed) await audit(req.user, 'CATALOG', null, `Filled ${typed} empty asset type(s) from the model catalogue`);
  res.json({ typed });
}));

// ── Warranty ──────────────────────────────────────────────────────────────────
async function warrantyRows(req) {
  const s = scope(req);
  const rows = await all(`SELECT id, brand_model, serial_no, purchase_date, country, asset_type FROM assets WHERE ${s.where} AND ${noWarranty}`, s.params);
  const cm = catMap(await catalogue());
  return rows.map(r => { const m = cm.get(String(r.brand_model || '').trim().toLowerCase());
    return { ...r, maker: makerOf(r.brand_model || '', m), years: m && m.warranty_years != null ? Number(m.warranty_years) : null }; });
}
const addYears = (iso, y) => { const d = new Date(iso + 'T00:00:00Z'); if (isNaN(d)) return ''; d.setUTCMonth(d.getUTCMonth() + Math.round(y * 12)); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

router.get('/warranty', wrap(async (req, res) => {
  const rows = await warrantyRows(req);
  const s = scope(req);
  const tot = await get(`SELECT COUNT(*) AS n, SUM(CASE WHEN warranty_source = 'estimated' THEN 1 ELSE 0 END) AS est,
    SUM(CASE WHEN warranty_source = 'vendor' THEN 1 ELSE 0 END) AS vendor FROM assets WHERE ${s.where}`, s.params);
  const by = {};
  for (const r of rows) {
    const b = by[r.maker] || (by[r.maker] = { maker: r.maker, missing: 0, withSerial: 0, estimable: 0 });
    b.missing++; if (String(r.serial_no || '').trim()) b.withSerial++;
    if (r.years != null && ISO.test(String(r.purchase_date || ''))) b.estimable++;
  }
  res.json({ total: tot.n, missing: rows.length, estimated: tot.est || 0, vendor: tot.vendor || 0,
    estimable: rows.filter(r => r.years != null && ISO.test(String(r.purchase_date || ''))).length,
    noYears: rows.filter(r => r.years == null && ISO.test(String(r.purchase_date || ''))).length,
    makers: Object.values(by).sort((a, b) => b.missing - a.missing), canEdit: isITAdmin(req.user) });
}));

router.get('/warranty/serials', wrap(async (req, res) => {
  const maker = String(req.query.maker || '');
  const rows = (await warrantyRows(req)).filter(r => String(r.serial_no || '').trim() && (!maker || r.maker === maker));
  const tag = (maker || 'all').replace(/[^\w-]+/g, '');
  res.set('Cache-Control', 'no-store');
  if (req.query.format === 'txt') {
    res.set('Content-Type', 'text/plain; charset=utf-8').set('Content-Disposition', `attachment; filename="serials-${tag}.txt"`);
    return res.send([...new Set(rows.map(r => r.serial_no.trim()))].join('\r\n'));
  }
  const ws = XLSX.utils.aoa_to_sheet([['Serial', 'ID', 'Brand/Model', 'Purchase Date', 'Country', 'Warranty End (fill in)'],
    ...rows.map(r => [r.serial_no.trim(), r.id, r.brand_model || '', r.purchase_date || '', r.country || '', ''])]);
  ws['!cols'] = [{ wch: 18 }, { wch: 7 }, { wch: 34 }, { wch: 13 }, { wch: 11 }, { wch: 20 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Serials');
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', `attachment; filename="warranty-serials-${tag}.xlsx"`);
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}));

// body { rows: [{ serial, end }], dry, overwrite } — end is YYYY-MM-DD (the browser reads the vendor file).
router.post('/warranty/apply', requireITAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const input = (Array.isArray(b.rows) ? b.rows : []).slice(0, 20000)
    .map(r => ({ serial: String(r.serial || '').trim().toUpperCase(), end: String(r.end || '').trim() })).filter(r => r.serial && ISO.test(r.end));
  const latest = new Map(); for (const r of input) if (!latest.has(r.serial) || latest.get(r.serial) < r.end) latest.set(r.serial, r.end);
  const s = scope(req);
  const assets = await all(`SELECT id, serial_no, brand_model, warranty_expiry, warranty_source FROM assets WHERE ${s.where} AND TRIM(COALESCE(serial_no, '')) <> ''`, s.params);
  const out = { set: [], same: [], kept: [], unknown: [] };
  const seen = new Set();
  for (const a of assets) {
    const sn = String(a.serial_no).trim().toUpperCase(); const end = latest.get(sn);
    if (!end) continue; seen.add(sn);
    const cur = String(a.warranty_expiry || '').trim();
    const empty = !cur || cur === '0' || cur === '-';
    const row = { id: a.id, serial: a.serial_no, model: a.brand_model, from: empty ? '' : cur, to: end };
    if (cur === end) out.same.push(row);
    else if (empty || a.warranty_source === 'estimated' || b.overwrite) out.set.push(row);
    else out.kept.push(row);
  }
  for (const sn of latest.keys()) if (!seen.has(sn)) out.unknown.push(sn);
  if (!b.dry && out.set.length) {
    await batch(out.set.map(r => { const line = `${stamp()}: Warranty "${r.from || '∅'}"→"${r.to}" from the vendor warranty file by ${req.user.username}`;
      return { sql: `UPDATE assets SET warranty_expiry = ?, warranty_source = 'vendor', ${HIST} WHERE id = ?`, args: [r.to, line, line, r.id] }; }));
    await audit(req.user, 'WARRANTY', null, `Warranty from vendor file: ${out.set.length} asset(s) updated`);
  }
  res.json({ dry: !!b.dry, counts: { set: out.set.length, same: out.same.length, kept: out.kept.length, unknown: out.unknown.length }, ...out,
    unknown: out.unknown.slice(0, 200) });
}));

router.post('/warranty/estimate', requireITAdmin, wrap(async (req, res) => {
  const rows = (await warrantyRows(req)).filter(r => r.years != null && r.years > 0 && ISO.test(String(r.purchase_date || '')))
    .map(r => ({ id: r.id, model: r.brand_model, purchase: r.purchase_date, years: r.years, to: addYears(r.purchase_date, r.years) })).filter(r => r.to);
  if (!(req.body && req.body.dry) && rows.length) {
    await batch(rows.map(r => { const line = `${stamp()}: Warranty estimated "${r.to}" (purchase ${r.purchase} + ${r.years} y, model catalogue) by ${req.user.username}`;
      return { sql: `UPDATE assets SET warranty_expiry = ?, warranty_source = 'estimated', ${HIST} WHERE id = ? AND ${noWarranty}`, args: [r.to, line, line, r.id] }; }));
    await audit(req.user, 'WARRANTY', null, `Warranty estimated for ${rows.length} asset(s) from purchase date + model warranty years`);
  }
  res.json({ count: rows.length, rows: rows.slice(0, 300) });
}));

module.exports = router;
