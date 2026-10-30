/* Devices (Intune + Entra) and the 3-file directory import (Azure users, Intune devices,
   Entra devices). See lib/directory-import.js for how the files are linked. */
const express = require('express');
const router = express.Router();
const { get, all, run, batch, errorText, audit, notify, setMeta, getMeta } = require('../db/database');
const { requireAuth, requireRole, isITAdmin } = require('../middleware/auth');
const { normalizeAssetType } = require('../lib/asset-columns');
const { normCountry } = require('../lib/countries');
const { learnModels, proposeAsset, assetMissing, personMissing } = require('../lib/device-to-asset');
const { countrySql, inScope, scopeList } = require('../lib/scope');
const { resetCountryCache } = require('../lib/country-list');
const { parseCsv, detectKind, buildDirectory } = require('../lib/directory-import');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const lcKey = (v) => String(v || '').trim().toLowerCase();
router.use(requireAuth);
// Same audience as the Asset Inventory (HR-only members have no access).
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) return res.status(403).json({ error: 'No access to Devices' });
  next();
});

const STALE_DAYS = 90;
const DEVICE_COLS = ['name', 'country', 'user_upn', 'user_name', 'os', 'os_version', 'model', 'manufacturer',
  'serial_no', 'managed_by', 'ownership', 'category', 'join_type', 'is_managed', 'is_compliant', 'account_enabled',
  'last_sign_in', 'intune_id', 'entra_device_id', 'entra_object_id', 'in_intune', 'in_entra'];

// Shared WHERE for list/stats/export: scope + filters from the query string.
function deviceWhere(req) {
  const q = req.query;
  const cond = [], params = [];
  const cs = countrySql(req, 'd.country', q.country === '__none' ? '' : q.country);
  if (q.country === '__none') { if (scopeList(req)) cond.push('1 = 0'); else cond.push("d.country = ''"); }
  else if (cs.clause) { cond.push(cs.clause); params.push(...cs.params); }
  if (q.search) {
    const like = `%${q.search}%`;
    cond.push('(d.name LIKE ? OR d.user_upn LIKE ? OR d.user_name LIKE ? OR d.serial_no LIKE ? OR d.model LIKE ?)');
    params.push(like, like, like, like, like);
  }
  if (q.os)        { cond.push('d.os = ?'); params.push(q.os); }
  if (q.source === 'intune') cond.push('d.in_intune = 1');
  if (q.source === 'entra')  cond.push('d.in_intune = 0');
  if (q.compliant === '1') cond.push('d.is_compliant = 1');
  if (q.compliant === '0') cond.push('d.is_compliant = 0');
  if (q.enabled === '0')   cond.push('d.account_enabled = 0');
  if (q.user === 'none')   cond.push("d.user_upn = ''");
  if (q.user === 'notin')  cond.push("d.user_upn <> '' AND d.person_id IS NULL");   // owner not in User Inventory
  if (q.ownership)         { cond.push('d.ownership = ?'); params.push(q.ownership); }
  if (q.asset === 'linked')   cond.push('d.asset_id IS NOT NULL');
  if (q.asset === 'unlinked') cond.push('d.asset_id IS NULL');
  if (q.stale === '1') cond.push(`(d.last_sign_in = '' OR julianday(d.last_sign_in) < julianday('now', '-${STALE_DAYS} days'))`);
  if (q.person_id) { cond.push('d.person_id = ?'); params.push(Number(q.person_id)); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

// ── GET /api/devices — list ───────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const { where, params } = deviceWhere(req);
  const total = Number((await get(`SELECT COUNT(*) AS c FROM devices d ${where}`, params)).c);
  const data = await all(
    `SELECT d.*, a.asset_code AS asset_code, a.asset_s4 AS asset_s4, a.computer_no AS asset_computer_no
       FROM devices d LEFT JOIN assets a ON a.id = d.asset_id AND a.deleted_at IS NULL
       ${where} ORDER BY CASE WHEN d.name GLOB '[A-Za-z0-9]*' THEN 0 ELSE 1 END, d.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]);
  res.json({ total, page, limit, data });
}));

// ── GET /api/devices/stats — tiles + filter options (same filters as the list) ─
router.get('/stats', wrap(async (req, res) => {
  const { where, params } = deviceWhere(req);
  const and = where ? where + ' AND' : 'WHERE';
  const one = async (extra) => Number((await get(`SELECT COUNT(*) AS c FROM devices d ${and} ${extra}`, params)).c);
  const total = Number((await get(`SELECT COUNT(*) AS c FROM devices d ${where}`, params)).c);
  const byOs = await all(`SELECT d.os AS v, COUNT(*) AS c FROM devices d ${where} GROUP BY d.os ORDER BY c DESC`, params);
  const byCountry = await all(`SELECT d.country AS v, COUNT(*) AS c FROM devices d ${where} GROUP BY d.country ORDER BY c DESC`, params);
  res.json({
    total,
    intune: await one('d.in_intune = 1'),
    compliant: await one('d.is_compliant = 1'),
    notCompliant: await one('d.is_compliant = 0'),
    disabled: await one('d.account_enabled = 0'),
    noUser: await one("d.user_upn = ''"),
    linkedAsset: await one('d.asset_id IS NOT NULL'),
    corpNotInAssets: await one("d.ownership = 'Corporate' AND d.asset_id IS NULL"),
    ownersNotInPeople: Number((await get(`SELECT COUNT(DISTINCT LOWER(d.user_upn)) AS c FROM devices d ${and} d.user_upn <> '' AND d.person_id IS NULL`, params)).c),
    stale: await one(`(d.last_sign_in = '' OR julianday(d.last_sign_in) < julianday('now', '-${STALE_DAYS} days'))`),
    staleDays: STALE_DAYS,
    byOs: byOs.map(r => ({ os: r.v || '', count: Number(r.c) })),
    byCountry: byCountry.map(r => ({ country: r.v || '', count: Number(r.c) })),
    lastImport: await getMeta('directory_last_import'),
    canImport: isITAdmin(req.user),
  });
}));

// ── POST /api/devices/import — IT admin uploads 1–3 export CSVs ───────────────
// Body: { files: [csvText, …] } (any order — each file is recognised by its headers).
router.post('/import', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can import' });
  const texts = (req.body && Array.isArray(req.body.files)) ? req.body.files : [];
  if (!texts.length) return res.status(400).json({ error: 'No files received' });

  const parsed = {};
  for (const t of texts) {
    let rows;
    try { rows = parseCsv(t); } catch (e) { return res.status(400).json({ error: 'Could not read one of the CSV files' }); }
    const kind = detectKind(rows);
    if (!kind) return res.status(400).json({ error: 'Unrecognised file — upload the Azure users, Intune devices or Entra devices export' });
    parsed[kind] = rows;
  }
  try {
    res.json(await applyDirectoryImport(parsed, req.user));
  } catch (e) {
    // Show the real reason to the IT admin (e.g. a database limit) instead of "Server error".
    console.error('[import]', e);
    res.status(500).json({ error: `Import failed: ${errorText(e)}` });
  }
}));

// Shared by POST /api/devices/import and the User Inventory "Upload Azure CSV" button.
// Multi-row INSERT statements (50 rows each) — far fewer round trips to Turso.
function multiInsert(table, cols, rows, per = 50) {
  const stmts = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    stmts.push({
      sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`,
      args: chunk.flat(),
    });
  }
  return stmts;
}
// UPDATE … WHERE id IN (…) in chunks.
function updateIds(sqlPrefix, prefixArgs, ids, per = 500) {
  const stmts = [];
  for (let i = 0; i < ids.length; i += per) {
    const chunk = ids.slice(i, i + per);
    stmts.push({ sql: `${sqlPrefix} WHERE id IN (${chunk.map(() => '?').join(', ')})`, args: [...prefixArgs, ...chunk] });
  }
  return stmts;
}

async function applyDirectoryImport(parsed, user) {
  const known = new Map((await all('SELECT email, country FROM personnel')).map(r => [String(r.email).toLowerCase(), r.country]));
  const { people, devices, stats } = buildDirectory(parsed, known);
  const now = (await get("SELECT datetime('now') AS n")).n;
  const out = { files: Object.keys(parsed), ...stats, added: 0, updated: 0, preserved: 0 };

  // ── People → User Inventory (upsert by email; HR/IT-edited rows keep their edits) ──
  // Only rows whose details changed are rewritten; the rest just get "seen in this export".
  if (parsed.azure) {
    const existing = new Map((await all(
      'SELECT id, email, touched, display_name, company_name, position, country, entra_id, employee_id, ad_department FROM personnel'))
      .map(r => [String(r.email).toLowerCase(), r]));
    const same = (a, b) => String(a || '') === String(b || '');
    const seen = new Set();
    const stmts = [], seenIds = [], inserts = [];
    for (const p of people) {
      const key = p.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const found = existing.get(key);
      if (found && found.touched) {
        // Edited by HR/IT: only refresh the Azure reference fields, fill blanks.
        const blanks = (!found.display_name && p.display_name) || (!found.company_name && p.company_name) || (!found.position && p.position);
        if (blanks || !same(found.entra_id, p.entra_id) || !same(found.employee_id, p.employee_id) || !same(found.ad_department, p.ad_department)) {
          stmts.push({ sql: `UPDATE personnel SET entra_id = ?, employee_id = ?, ad_department = ?,
                display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END,
                company_name = CASE WHEN company_name = '' THEN ? ELSE company_name END,
                position     = CASE WHEN position = '' THEN ? ELSE position END
              WHERE id = ?`,
            args: [p.entra_id, p.employee_id, p.ad_department, p.display_name, p.company_name, p.position, found.id] });
        }
        seenIds.push(found.id);
        out.preserved++;
      } else if (found) {
        const changed = !same(found.display_name, p.display_name) || !same(found.company_name, p.company_name)
          || !same(found.position, p.position) || !same(found.country, p.country) || !same(found.entra_id, p.entra_id)
          || !same(found.employee_id, p.employee_id) || !same(found.ad_department, p.ad_department);
        if (changed) {
          stmts.push({ sql: `UPDATE personnel SET display_name = ?, company_name = ?, position = ?, country = ?,
                entra_id = ?, employee_id = ?, ad_department = ?, updated_at = datetime('now') WHERE id = ?`,
            args: [p.display_name, p.company_name, p.position, p.country, p.entra_id, p.employee_id, p.ad_department, found.id] });
          out.updated++;
        } else out.unchanged = (out.unchanged || 0) + 1;
        seenIds.push(found.id);
      } else {
        inserts.push([p.country, p.display_name, p.email, '', 'Active', p.company_name, p.position, '', p.entra_id, p.employee_id, p.ad_department, now]);
        out.added++;
      }
    }
    await batch([
      ...stmts,
      ...updateIds('UPDATE personnel SET azure_seen_at = ?', [now], seenIds),
      // One statement per new person, skipped if the email already exists — safe to retry.
      ...inserts.map(v => ({
        sql: `INSERT INTO personnel (country, display_name, email, user_type, status, company_name, position,
                leaving_date, entra_id, employee_id, ad_department, azure_seen_at)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM personnel WHERE email = ?)`,   // exact match → uses idx_personnel_email
        args: [...v, v[2]] })),
    ], 100);
    out.notInExport = Number((await get(
      'SELECT COUNT(*) AS c FROM personnel WHERE azure_seen_at IS NULL OR azure_seen_at < ?', [now])).c);
    await setMeta('personnel_last_import', now);
  }

  // Lookups for the links: device → person (email), device → asset (Computer No, else serial).
  const personByEmail = new Map((await all('SELECT id, email FROM personnel')).map(r => [String(r.email).toLowerCase(), r.id]));
  const assetRows = await all("SELECT id, computer_no, serial_no FROM assets WHERE deleted_at IS NULL");
  const assetByName = new Map(), assetBySerial = new Map();
  for (const a of assetRows) {
    if (a.computer_no && !assetByName.has(lcKey(a.computer_no))) assetByName.set(lcKey(a.computer_no), a.id);
    if (a.serial_no && !assetBySerial.has(lcKey(a.serial_no))) assetBySerial.set(lcKey(a.serial_no), a.id);
  }
  const personOf = (upn) => (upn ? personByEmail.get(lcKey(upn)) || null : null);
  const assetOf = (d) => (d.name && assetByName.get(lcKey(d.name))) || (d.serial_no && assetBySerial.get(lcKey(d.serial_no))) || null;

  if (parsed.intune || parsed.entra) {
    // ── Devices (replaced by the new snapshot, links set on insert) ───────────────
    const defaults = (c) => (['is_managed', 'is_compliant', 'account_enabled'].includes(c) ? null : (c.startsWith('in_') ? 0 : ''));
    const cols = [...DEVICE_COLS, 'person_id', 'asset_id', 'imported_at'];
    const rows = devices.map(d => [...DEVICE_COLS.map(c => (d[c] === undefined ? defaults(c) : d[c])), personOf(d.user_upn), assetOf(d), now]);
    // DELETE + inserts in one transaction per request chunk; 50 statements ≈ 2,000 rows per request.
    // Insert the new snapshot first, then drop the old one — if any request fails, the
    // previous devices are kept (and the half-written new rows removed).
    try {
      await batch(multiInsert('devices', cols, rows, 25), 50);
    } catch (e) {
      await run('DELETE FROM devices WHERE imported_at = ?', [now]).catch(() => {});
      throw e;
    }
    // A retried request may have been applied twice — keep one row per device of this snapshot.
    await run(`DELETE FROM devices WHERE imported_at = ? AND id NOT IN (
        SELECT MIN(id) FROM devices WHERE imported_at = ?
        GROUP BY COALESCE(NULLIF(intune_id, ''), ''), COALESCE(NULLIF(entra_object_id, ''), ''), name)`, [now, now]);
    await run('DELETE FROM devices WHERE imported_at IS NULL OR imported_at <> ?', [now]);
    await setMeta('directory_last_import', now);
  } else {
    // People only: re-link existing devices to (new) people / assets where it changed.
    const devRows = await all('SELECT id, name, serial_no, user_upn, person_id, asset_id FROM devices');
    await batch(devRows
      .map(d => ({ d, pid: personOf(d.user_upn), aid: assetOf(d) }))
      .filter(x => x.pid !== x.d.person_id || x.aid !== x.d.asset_id)
      .map(x => ({ sql: 'UPDATE devices SET person_id = ?, asset_id = ? WHERE id = ?', args: [x.pid, x.aid, x.d.id] })), 800);
  }
  out.linkedPeople = Number((await get('SELECT COUNT(*) AS c FROM devices WHERE person_id IS NOT NULL')).c);
  out.linkedAssets = Number((await get('SELECT COUNT(*) AS c FROM devices WHERE asset_id IS NOT NULL')).c);
  out.last_import = now;
  resetCountryCache();

  const msg = `${user.full_name} imported the Microsoft exports (${out.files.join(', ')}): `
    + (parsed.azure ? `people +${out.added} new, ${out.updated} refreshed, ${out.preserved} kept (edited); ` : '')
    + ((parsed.intune || parsed.entra) ? `${out.devices} devices, ${out.linkedAssets} linked to assets.` : '');
  await audit(user, 'IMPORT', null, msg);
  await notify({ audience: 'IT', scope: 'system', message: msg });
  return out;
}

// ── GET /api/devices/asset-fill — what Intune can fill on linked assets ───────
// Only EMPTY asset fields are filled: Serial, AD Name, User Name, Computer No.
// ?apply=1 (IT admin) writes them and logs each change in History Usage.
router.get('/asset-fill', wrap(async (req, res) => fillAssets(req, res, false)));
router.post('/asset-fill', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can fill assets from Intune' });
  return fillAssets(req, res, true);
}));

async function fillAssets(req, res, apply) {
  const cs = countrySql(req, 'a.country');
  const rows = await all(
    `SELECT a.id, a.country, a.asset_code, a.brand_model, a.computer_no, a.serial_no, a.ad_name, a.user_name, a.history_usage,
            d.name AS d_name, d.serial_no AS d_serial, d.user_upn AS d_upn, d.user_name AS d_user
       FROM devices d JOIN assets a ON a.id = d.asset_id AND a.deleted_at IS NULL
      ${cs.clause ? 'WHERE ' + cs.clause : ''} ORDER BY a.id`, cs.params);
  const empty = (v) => !String(v || '').trim();
  const changes = [];
  const done = new Set();
  for (const r of rows) {
    if (done.has(r.id)) continue;
    const set = {};
    if (empty(r.serial_no) && r.d_serial) set.serial_no = r.d_serial;
    if (empty(r.computer_no) && r.d_name) set.computer_no = r.d_name;
    const upnLocal = String(r.d_upn || '').split('@')[0];
    if (empty(r.ad_name) && upnLocal) set.ad_name = upnLocal;
    if (empty(r.user_name) && r.d_user) set.user_name = r.d_user;
    if (!Object.keys(set).length) continue;
    done.add(r.id);
    changes.push({ id: r.id, country: r.country, label: r.asset_code || r.brand_model || `#${r.id}`, device: r.d_name, set, history: r.history_usage });
  }
  if (apply) {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const LABEL = { serial_no: 'Serial', computer_no: 'Computer No', ad_name: 'AD Name', user_name: 'User' };
    await batch(changes.map(c => {
      const keys = Object.keys(c.set);
      const line = `${ts} UTC: filled from Intune (${c.device}) — ${keys.map(k => `${LABEL[k]}: "${c.set[k]}"`).join('; ')} by ${req.user.username}`;
      return { sql: `UPDATE assets SET ${keys.map(k => `${k} = CASE WHEN ${k} IS NULL OR ${k} = '' THEN ? ELSE ${k} END`).join(', ')},
                     history_usage = ?, sap_confirmed = 0 WHERE id = ?`,
               args: [...keys.map(k => c.set[k]), c.history ? `${c.history}\n${line}` : line, c.id] };
    }));
    await audit(req.user, 'IMPORT', null, `Filled ${changes.length} assets from Intune / Entra`);
  }
  const count = (k) => changes.filter(c => c.set[k]).length;
  res.json({ applied: apply, assets: changes.length,
    fields: { serial_no: count('serial_no'), computer_no: count('computer_no'), ad_name: count('ad_name'), user_name: count('user_name') },
    sample: changes.slice(0, 50).map(({ history, ...c }) => c) });
}


// ── Add devices to Asset Inventory / their users to User Inventory ────────────
const MAX_ADD = 300;
const idList = (v) => [...new Set(String(v || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, MAX_ADD);

async function loadDevicesInScope(req, ids) {
  if (!ids.length) return [];
  const rows = await all(`SELECT * FROM devices WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
  return rows.filter(d => (scopeList(req) ? d.country && inScope(req, d.country) : true));
}

// GET /api/devices/proposals?ids=1,2,3 — what each device would become as an asset
// (+ what would still be missing). Devices already in Asset Inventory are reported, not proposed.
router.get('/proposals', wrap(async (req, res) => {
  const devices = await loadDevicesInScope(req, idList(req.query.ids));
  const learned = learnModels(await all(
    `SELECT d.manufacturer, d.model, a.brand_model, a.asset_type FROM devices d
       JOIN assets a ON a.id = d.asset_id AND a.deleted_at IS NULL WHERE d.model <> ''`));
  const assets = await all("SELECT id, computer_no, serial_no, asset_code, asset_s4 FROM assets WHERE deleted_at IS NULL");
  const byName = new Map(), bySerial = new Map();
  for (const a of assets) {
    if (a.computer_no) byName.set(lcKey(a.computer_no), a);
    if (a.serial_no) bySerial.set(lcKey(a.serial_no), a);
  }
  const proposals = [], existing = [];
  for (const d of devices) {
    const hit = d.asset_id ? { id: d.asset_id } : (byName.get(lcKey(d.name)) || (d.serial_no && bySerial.get(lcKey(d.serial_no))));
    if (hit) { existing.push({ device_id: d.id, name: d.name, asset_id: hit.id }); continue; }
    const p = proposeAsset(d, learned);
    proposals.push({ ...p, missing: assetMissing(p) });
  }
  res.json({ proposals, existing });
}));

// POST /api/devices/to-assets — { items: [{ device_id, asset_type, brand_model, … }] }
// Creates the assets (same rules as Add Asset: country scope, Office/Factory only in
// Vietnam, History Usage line) and links each device to its new asset.
router.post('/to-assets', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const items = (req.body && Array.isArray(req.body.items) ? req.body.items : []).slice(0, MAX_ADD);
  const devices = new Map((await loadDevicesInScope(req, items.map(i => Number(i.device_id)))).map(d => [d.id, d]));
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const created = [], skipped = [];
  for (const it of items) {
    const d = devices.get(Number(it.device_id));
    if (!d) { skipped.push({ device_id: it.device_id, reason: 'Device not found or outside your countries' }); continue; }
    if (d.asset_id) { skipped.push({ device_id: d.id, reason: 'Already in Asset Inventory' }); continue; }
    const str = (k) => String(it[k] == null ? '' : it[k]).trim();
    const country = normCountry(str('country')) || d.country;
    if (!country) { skipped.push({ device_id: d.id, reason: 'Pick a country' }); continue; }
    if (!inScope(req, country)) { skipped.push({ device_id: d.id, reason: 'Country outside your scope' }); continue; }
    const computerNo = str('computer_no'), serial = str('serial_no');
    // Don't create a duplicate of an asset that already has this Computer No / Serial.
    const dup = await get(`SELECT id FROM assets WHERE deleted_at IS NULL AND (
        (? <> '' AND LOWER(computer_no) = LOWER(?)) OR (? <> '' AND LOWER(serial_no) = LOWER(?))) LIMIT 1`,
      [computerNo, computerNo, serial, serial]);
    if (dup) {
      await run('UPDATE devices SET asset_id = ? WHERE id = ?', [dup.id, d.id]);
      skipped.push({ device_id: d.id, reason: `Already in Asset Inventory (#${dup.id}) — linked`, asset_id: dup.id });
      continue;
    }
    const location = country === 'Vietnam' && ['Office', 'Factory'].includes(str('location')) ? str('location') : '';
    const status = ['Active', 'Broken', 'Stock'].includes(str('status')) ? str('status') : 'Active';
    const hist = `${ts} UTC: created from Intune / Entra device "${d.name}" by ${req.user.username}`;
    const r = await run(`INSERT INTO assets (location, country, department, computer_no, brand_model, serial_no,
        asset_code, asset_s4, user_name, ad_name, status, history_usage, sap_confirmed, asset_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [location, country, str('department'), computerNo, str('brand_model'), serial, str('asset_code'), str('asset_s4'),
       str('user_name'), str('ad_name'), status, hist, normalizeAssetType(str('asset_type'))]);
    const id = r.lastInsertRowid;
    await run('UPDATE devices SET asset_id = ? WHERE id = ?', [id, d.id]);
    created.push({ device_id: d.id, asset_id: id, name: d.name, country });
  }
  if (created.length) {
    const byCountry = created.reduce((m, c) => { m[c.country] = (m[c.country] || 0) + 1; return m; }, {});
    const msg = `${req.user.full_name} added ${created.length} device(s) from Intune / Entra to Asset Inventory (${Object.entries(byCountry).map(([c, n]) => `${c} ${n}`).join(', ')}).`;
    await audit(req.user, 'CREATE', null, msg);
    await notify({ audience: 'IT', scope: 'asset', message: msg });
  }
  res.json({ created, skipped });
}));

// GET /api/devices/owners?ids= — device owners not yet in User Inventory (one row per email).
router.get('/owners', wrap(async (req, res) => {
  const devices = await loadDevicesInScope(req, idList(req.query.ids));
  const seen = new Map();
  for (const d of devices) {
    if (!d.user_upn || d.person_id) continue;
    const k = lcKey(d.user_upn);
    if (!seen.has(k)) seen.set(k, { email: d.user_upn, display_name: d.user_name || d.user_upn.split('@')[0], country: d.country || '', devices: [] });
    seen.get(k).devices.push(d.name);
  }
  // Already in User Inventory under that email (e.g. added since the import)?
  const people = await all('SELECT id, email FROM personnel');
  const inPeople = new Set(people.map(p => lcKey(p.email)));
  const owners = [...seen.values()].filter(o => !inPeople.has(lcKey(o.email)))
    .map(o => ({ ...o, missing: personMissing(o) }));
  res.json({ owners });
}));

// POST /api/devices/to-people — { items: [{ email, display_name, country, company_name, position }] } (IT admin)
router.post('/to-people', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can add users to User Inventory' });
  const items = (req.body && Array.isArray(req.body.items) ? req.body.items : []).slice(0, MAX_ADD);
  const created = [], skipped = [];
  for (const it of items) {
    const str = (k) => String(it[k] == null ? '' : it[k]).trim();
    const email = str('email');
    const country = normCountry(str('country'));
    if (!email || !email.includes('@')) { skipped.push({ email, reason: 'Missing email' }); continue; }
    if (!country) { skipped.push({ email, reason: 'Pick a country' }); continue; }
    if (!inScope(req, country)) { skipped.push({ email, reason: 'Country outside your scope' }); continue; }
    if (await get('SELECT id FROM personnel WHERE LOWER(email) = LOWER(?)', [email])) { skipped.push({ email, reason: 'Already in User Inventory' }); continue; }
    const r = await run(`INSERT INTO personnel (country, display_name, email, user_type, status, company_name, position, leaving_date)
      VALUES (?, ?, ?, '', 'Active', ?, ?, '')`, [country, str('display_name') || email.split('@')[0], email, str('company_name'), str('position')]);
    const id = r.lastInsertRowid;
    // Link this person's devices; devices without a country take the person's country.
    await run("UPDATE devices SET person_id = ?, country = CASE WHEN country = '' THEN ? ELSE country END WHERE LOWER(user_upn) = LOWER(?)", [id, country, email]);
    created.push({ email, person_id: id, country });
  }
  if (created.length) {
    resetCountryCache();
    const msg = `${req.user.full_name} added ${created.length} device owner(s) to User Inventory.`;
    await audit(req.user, 'PERSONNEL', null, msg);
    await notify({ audience: 'all', scope: 'personnel', message: msg });
  }
  res.json({ created, skipped });
}));

// ── GET /api/devices/:id — one device (scope-checked) ─────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const d = await get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Device not found' });
  if (!inScope(req, d.country) || (scopeList(req) && !d.country)) return res.status(403).json({ error: 'Not in your region' });
  res.json(d);
}));

module.exports = router;
module.exports.applyDirectoryImport = applyDirectoryImport;
