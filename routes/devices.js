/* Devices (Intune + Entra) and the 3-file directory import (Azure users, Intune devices,
   Entra devices). See lib/directory-import.js for how the files are linked. */
const express = require('express');
const router = express.Router();
const { get, all, run, batch, audit, notify, setMeta, getMeta } = require('../db/database');
const { requireAuth, isITAdmin } = require('../middleware/auth');
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
  const result = await applyDirectoryImport(parsed, req.user);
  res.json(result);
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
      ...multiInsert('personnel', ['country', 'display_name', 'email', 'user_type', 'status', 'company_name', 'position',
        'leaving_date', 'entra_id', 'employee_id', 'ad_department', 'azure_seen_at'], inserts),
    ], 50);
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
    await run('DELETE FROM devices');
    await batch(multiInsert('devices', cols, rows, 40), 50);
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

// ── GET /api/devices/:id — one device (scope-checked) ─────────────────────────
router.get('/:id', wrap(async (req, res) => {
  const d = await get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Device not found' });
  if (!inScope(req, d.country) || (scopeList(req) && !d.country)) return res.status(403).json({ error: 'Not in your region' });
  res.json(d);
}));

module.exports = router;
module.exports.applyDirectoryImport = applyDirectoryImport;
