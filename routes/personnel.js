const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { get, all, run, audit, notify, getMeta, setMeta } = require('../db/database');
const { requireAuth, isITAdmin } = require('../middleware/auth');
const { PERSONNEL_COLUMNS } = require('../lib/personnel-columns');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const VALID_COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];

const USER_TYPES = ['', 'Hayat Member', 'No Hayat Member'];
const STATUSES   = ['Active', 'to be delete', 'pending delete', 'deleted'];

// Map an Azure "Company Name" to one of our 3 countries (else null = ignore).
function countryFromCompany(company) {
  const c = String(company || '').toLowerCase();
  if (c.includes('vietnam')) return 'Vietnam';
  if (c.includes('thailand') || c.includes('thailans')) return 'Thailand';  // handles the export typo
  if (c.includes('malaysia')) return 'Malaysia';
  return null;
}

router.use(requireAuth);

const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;
const isHR = (req) => req.user && req.user.team === 'HR';
const isIT = (req) => req.user && req.user.team === 'IT';

// Only HR and IT members may use the User Inventory at all.
router.use((req, res, next) => {
  if (!isHR(req) && !isIT(req)) {
    return res.status(403).json({ error: 'User Inventory is for HR and IT members only' });
  }
  next();
});

// ── GET /api/personnel — list (country-scoped) ────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const { search = '', country = '', status = '', user_type = '', page = 1, limit = 50 } = req.query;
  const conditions = [];
  const params = [];

  const scope = scopeOf(req);
  if (scope) { conditions.push('country = ?'); params.push(scope); }
  else if (country) { conditions.push('country = ?'); params.push(country); }

  if (search) {
    conditions.push('(display_name LIKE ? OR email LIKE ? OR company_name LIKE ? OR position LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (status)    { conditions.push('status = ?');    params.push(status); }
  if (user_type) { conditions.push('user_type = ?'); params.push(user_type); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(limit);

  const total = Number((await get(`SELECT COUNT(*) AS c FROM personnel ${where}`, params)).c);
  // asset_count links a person to the Asset Inventory by AD Name:
  // asset.ad_name == the local-part of the person's email (before @hayat.com.tr).
  // Department & Cost Center are stored on the person (editable by HR/IT, seeded
  // from their assets). asset_count links to the Asset Inventory by AD Name.
  const adMatch = `a.deleted_at IS NULL AND a.ad_name <> '' AND instr(p.email,'@') > 0
        AND LOWER(a.ad_name) = LOWER(substr(p.email, 1, instr(p.email,'@') - 1))`;
  const data = await all(
    `SELECT p.*, (SELECT COUNT(*) FROM assets a WHERE ${adMatch}) AS asset_count
     FROM personnel p ${where} ORDER BY display_name COLLATE NOCASE LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  res.json({ total, page: Number(page), limit: Number(limit), data,
             can: { edit: isITAdmin(req.user) } });
}));

// ── GET /api/personnel/filters — country list for the filter dropdown ─────────
router.get('/filters', wrap(async (req, res) => {
  const countries = scopeOf(req) ? [scopeOf(req)] : ['Vietnam', 'Thailand', 'Malaysia'];
  res.json({ countries });
}));

// ── GET /api/personnel/cost-centers — the Cost Center ⇄ Department map ─────────
// Country-scoped: Thailand/Malaysia use a different scheme, so they get only
// their own cost centers (currently none → blank). Available to HR & IT.
router.get('/cost-centers', wrap(async (req, res) => {
  const country = scopeOf(req) || req.query.country || '';
  const cond = ['deleted_at IS NULL', "cost_center <> ''"];
  const params = [];
  if (country) { cond.push('country = ?'); params.push(country); }
  const rows = await all(
    `SELECT cost_center AS code, MAX(cost_center_desc) AS descr
       FROM assets WHERE ${cond.join(' AND ')}
       GROUP BY cost_center ORDER BY cost_center COLLATE NOCASE`, params);
  res.json(rows.map(r => ({ code: r.code, descr: r.descr || '' })));
}));

// ── POST /api/personnel — add a new user (IT admin only) ──────────────────────
router.post('/', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can add users' });
  const b = req.body || {};
  const display_name = (b.display_name || '').trim();
  const email = (b.email || '').trim();
  if (!display_name || !email) return res.status(400).json({ error: 'Display name and email are required' });
  let country = (b.country || '').trim();
  if (!VALID_COUNTRIES.includes(country)) country = 'Vietnam';
  const user_type = USER_TYPES.includes(b.user_type) ? b.user_type : '';
  const status = STATUSES.includes(b.status) ? b.status : 'Active';
  // TH/MY use a different scheme — don't store VN cost centers for them.
  const department  = country === 'Vietnam' ? (b.department || '')  : '';
  const cost_center = country === 'Vietnam' ? (b.cost_center || '') : '';

  const dup = await get('SELECT id FROM personnel WHERE LOWER(email) = LOWER(?)', [email]);
  if (dup) return res.status(409).json({ error: 'A user with that email already exists' });

  const result = await run(
    `INSERT INTO personnel (country, display_name, email, user_type, status, company_name, position,
        department, cost_center, touched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [country, display_name, email, user_type, status, (b.company_name || '').trim(), (b.position || '').trim(),
     department, cost_center]);
  const created = await get('SELECT * FROM personnel WHERE id = ?', [result.lastInsertRowid]);
  await audit(req.user, 'PERSONNEL', created.id, `Added user "${display_name}" (${country})`);
  res.status(201).json(created);
}));

// ── POST /api/personnel/import-sync — re-upload the User Inventory report ──────
// IT admin uploads the .xlsx exported from /api/reports/users.xlsx (base64).
// Rows with an ID update that person; blank-ID rows are inserted.
const PERS_WRITABLE = PERSONNEL_COLUMNS.filter(c => c.writable);
router.post('/import-sync', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can import the User Inventory' });
  const b64 = req.body && req.body.xlsx_base64;
  if (!b64) return res.status(400).json({ error: 'No file provided' });

  let rows;
  try {
    const wb = XLSX.read(Buffer.from(b64, 'base64'), { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch (e) { return res.status(400).json({ error: 'Could not read the Excel file' }); }

  let updated = 0, inserted = 0, skipped = 0;
  for (const row of rows) {
    const byHeader = {};
    for (const k of Object.keys(row)) byHeader[k.trim().toLowerCase()] = row[k];
    const data = {};
    for (const c of PERS_WRITABLE) {
      const key = c.header.trim().toLowerCase();
      if (key in byHeader) data[c.field] = String(byHeader[key] == null ? '' : byHeader[key]).trim();
    }
    if (!VALID_COUNTRIES.includes(data.country)) data.country = data.country || 'Vietnam';
    // Thailand/Malaysia don't carry Vietnam's cost-center/department scheme.
    if (data.country !== 'Vietnam') { data.department = ''; data.cost_center = ''; }

    const idRaw = byHeader['id'];
    const id = (idRaw === '' || idRaw == null) ? null : Number(idRaw);
    if (id && Number.isFinite(id)) {
      const existing = await get('SELECT * FROM personnel WHERE id = ?', [id]);
      if (!existing) { skipped++; continue; }
      const ut = USER_TYPES.includes(data.user_type) ? data.user_type : existing.user_type;
      const st = STATUSES.includes(data.status) ? data.status : existing.status;
      const fields = PERS_WRITABLE.map(c => c.field);
      const vals = fields.map(f => f === 'user_type' ? ut : f === 'status' ? st
        : (data[f] !== undefined ? data[f] : existing[f]));
      await run(`UPDATE personnel SET ${fields.map(f => f + ' = ?').join(', ')}, touched = 1, updated_at = datetime('now') WHERE id = ?`,
        [...vals, id]);
      updated++;
    } else {
      if (!data.display_name && !data.email) { skipped++; continue; }
      if (!USER_TYPES.includes(data.user_type)) data.user_type = '';
      if (!STATUSES.includes(data.status)) data.status = 'Active';
      const fields = PERS_WRITABLE.map(c => c.field);
      const cols = [...fields, 'touched'];
      const vals = [...fields.map(f => data[f] || ''), 1];
      await run(`INSERT INTO personnel (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
      inserted++;
    }
  }
  await audit(req.user, 'PERSONNEL', null, `Synced User Inventory: ${updated} updated, ${inserted} inserted, ${skipped} skipped`);
  res.json({ updated, inserted, skipped, total: rows.length });
}));

// ── GET /api/personnel/summary — dashboard metrics (country-scoped) ───────────
router.get('/summary', wrap(async (req, res) => {
  const scope = scopeOf(req);
  const cond = scope ? 'WHERE country = ?' : '';
  const params = scope ? [scope] : [];

  const total = Number((await get(`SELECT COUNT(*) AS c FROM personnel ${cond}`, params)).c);
  const byStatus = (await all(`SELECT status, COUNT(*) AS c FROM personnel ${cond} GROUP BY status`, params))
    .reduce((a, r) => { a[r.status] = Number(r.c); return a; }, {});
  const byCountry = (await all(`SELECT country, COUNT(*) AS c FROM personnel ${cond} GROUP BY country`, params))
    .reduce((a, r) => { a[r.country] = Number(r.c); return a; }, {});
  const noHayat = Number((await get(
    `SELECT COUNT(*) AS c FROM personnel ${cond ? cond + ' AND' : 'WHERE'} user_type = 'No Hayat Member'`, params)).c);
  const leaving = Number((await get(
    `SELECT COUNT(*) AS c FROM personnel ${cond ? cond + ' AND' : 'WHERE'} leaving_date <> ''`, params)).c);

  res.json({ total, byStatus, byCountry, noHayat, leaving });
}));

// ── GET /api/personnel/meta — last import + monthly reminder (for IT) ──────────
router.get('/meta', wrap(async (req, res) => {
  const last = await getMeta('personnel_last_import');
  let days = null, due = true;
  if (last) {
    const r = await get("SELECT (julianday('now') - julianday(?)) AS d", [last]);
    days = Math.floor(Number(r.d));
    due = days >= 30;
  }
  res.json({ last_import: last, days_since: days, due, canImport: isITAdmin(req.user) });
}));

// ── POST /api/personnel/import — IT uploads a raw Azure CSV export ────────────
// Filters to Vietnam/Thailand/Malaysia by Company Name, then upserts by email,
// preserving HR/IT workflow fields (user_type, status, leaving_date).
router.post('/import', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can upload' });

  const csv = req.body && req.body.csv;
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'No CSV content received' });

  let rows;
  try {
    const wb = XLSX.read(csv, { type: 'string' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse the CSV file' });
  }

  const existing = await all('SELECT id, email, touched FROM personnel');
  const byEmail = new Map(existing.map(r => [String(r.email).toLowerCase(), r]));

  let added = 0, updated = 0, skipped = 0, preserved = 0;
  const byCountry = { Vietnam: 0, Thailand: 0, Malaysia: 0 };

  for (const r of rows) {
    const display = String(r.displayName || r['Display Name'] || '').trim();
    const email   = String(r.userPrincipalName || r.Email || r.email || '').trim();
    const company = String(r.companyName || r['Company Name'] || '').trim();
    const country = countryFromCompany(company);
    if (!country || !email) { skipped++; continue; }
    byCountry[country]++;

    const found = byEmail.get(email.toLowerCase());
    if (found) {
      // Never overwrite records an HR/IT member has already edited.
      if (found.touched) { preserved++; continue; }
      // Untouched existing: refresh roster fields only (workflow fields kept).
      await run("UPDATE personnel SET display_name = ?, company_name = ?, country = ?, updated_at = datetime('now') WHERE id = ?",
                [display, company, country, found.id]);
      updated++;
    } else {
      // New person → insert (no duplicates, matched by email above).
      await run(`INSERT INTO personnel (country, display_name, email, user_type, status, company_name, position, leaving_date)
                 VALUES (?, ?, ?, '', 'Active', ?, '', '')`,
                [country, display, email, company]);
      added++;
    }
  }

  const nowStr = (await get("SELECT datetime('now') AS n")).n;
  await setMeta('personnel_last_import', nowStr);
  await audit(req.user, 'IMPORT', null,
    `Imported personnel: +${added} new, ${updated} updated, ${preserved} preserved (edited), ${skipped} skipped`);
  await notify({ audience: 'all', scope: 'personnel', message:
    `${req.user.full_name} imported the Azure user export: +${added} new, ${updated} refreshed, ${preserved} kept (already edited).` });

  res.json({ added, updated, skipped, preserved, byCountry, last_import: nowStr });
}));

// ── PUT /api/personnel/:id — edit a record (IT admin only) ────────────────────
router.put('/:id', wrap(async (req, res) => {
  if (!isITAdmin(req.user)) return res.status(403).json({ error: 'Only an IT admin can edit User Inventory records' });
  const row = await get('SELECT * FROM personnel WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Person not found' });

  const sets = [];
  const params = [];
  const effectiveType = ('user_type' in req.body) ? (req.body.user_type || '') : row.user_type;

  if ('user_type' in req.body) {
    const ut = req.body.user_type || '';
    if (!USER_TYPES.includes(ut)) return res.status(400).json({ error: 'Invalid user type' });
    sets.push('user_type = ?'); params.push(ut);
  }
  if ('leaving_date' in req.body) {
    const ld = req.body.leaving_date || '';
    if (ld && !effectiveType) return res.status(400).json({ error: 'Set User Type before the leaving date' });
    sets.push('leaving_date = ?'); params.push(ld);
  }
  if ('status' in req.body) {
    const st = req.body.status;
    if (!STATUSES.includes(st)) return res.status(400).json({ error: 'Invalid status' });
    // Status is set manually only — no preconditions, no auto-transition.
    sets.push('status = ?'); params.push(st);
    sets.push("status_changed_at = datetime('now')");
  }
  if ('department' in req.body)  { sets.push('department = ?');  params.push(req.body.department || ''); }
  if ('cost_center' in req.body) { sets.push('cost_center = ?'); params.push(req.body.cost_center || ''); }

  if (!sets.length) return res.status(400).json({ error: 'Nothing to change' });

  sets.push('touched = 1');                 // mark edited → import won't overwrite it
  sets.push("updated_at = datetime('now')");
  await run(`UPDATE personnel SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);

  const updated = await get('SELECT * FROM personnel WHERE id = ?', [req.params.id]);
  await audit(req.user, 'PERSONNEL', updated.id, `Updated personnel "${updated.display_name}" (${updated.country})`);
  await notify({ audience: 'all', country: updated.country, scope: 'personnel', level: 'info',
    message: `${req.user.full_name} updated ${updated.display_name} [${updated.country}] in User Inventory.` });
  res.json(updated);
}));

module.exports = router;
