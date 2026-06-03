const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { get, all, run, audit, notify, getMeta, setMeta } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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

// Lazily flip "to be delete" → "pending delete" once it's older than one month.
async function applyAutoTransition() {
  await run(
    "UPDATE personnel SET status = 'pending delete' " +
    "WHERE status = 'to be delete' AND status_changed_at IS NOT NULL " +
    "AND status_changed_at <= datetime('now','-1 month')"
  );
}

// ── GET /api/personnel — list (country-scoped) ────────────────────────────────
router.get('/', wrap(async (req, res) => {
  await applyAutoTransition();

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
  // Department & Cost Center are pulled from the person's linked assets (same AD
  // Name link as asset_count). A person may hold assets across more than one, so
  // these are the distinct values, comma-separated.
  const adMatch = `a.deleted_at IS NULL AND instr(p.email,'@') > 0
        AND LOWER(a.ad_name) = LOWER(substr(p.email, 1, instr(p.email,'@') - 1))`;
  const data = await all(
    `SELECT p.*,
      (SELECT COUNT(*)        FROM assets a WHERE ${adMatch} AND a.ad_name <> '')            AS asset_count,
      (SELECT GROUP_CONCAT(DISTINCT a.department)  FROM assets a WHERE ${adMatch} AND a.department <> '')  AS departments,
      (SELECT GROUP_CONCAT(DISTINCT a.cost_center) FROM assets a WHERE ${adMatch} AND a.cost_center <> '') AS cost_centers
     FROM personnel p ${where} ORDER BY display_name COLLATE NOCASE LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
  );
  res.json({ total, page: Number(page), limit: Number(limit), data,
             can: { editUserType: isHR(req), editStatus: isIT(req) } });
}));

// ── GET /api/personnel/filters — country list for the filter dropdown ─────────
router.get('/filters', wrap(async (req, res) => {
  const countries = scopeOf(req) ? [scopeOf(req)] : ['Vietnam', 'Thailand', 'Malaysia'];
  res.json({ countries });
}));

// ── GET /api/personnel/summary — dashboard metrics (country-scoped) ───────────
router.get('/summary', wrap(async (req, res) => {
  await applyAutoTransition();
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
  res.json({ last_import: last, days_since: days, due, canImport: isIT(req) });
}));

// ── POST /api/personnel/import — IT uploads a raw Azure CSV export ────────────
// Filters to Vietnam/Thailand/Malaysia by Company Name, then upserts by email,
// preserving HR/IT workflow fields (user_type, status, leaving_date).
router.post('/import', wrap(async (req, res) => {
  if (!isIT(req)) return res.status(403).json({ error: 'Only IT members can upload' });

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

// ── PUT /api/personnel/:id — field-level edit by team ─────────────────────────
router.put('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM personnel WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Person not found' });

  // Region scope: HR/regional users can only touch their own country.
  const scope = scopeOf(req);
  if (scope && row.country !== scope) return res.status(403).json({ error: 'Not in your region' });

  const sets = [];
  const params = [];

  // HR: User Type + Leaving date
  if (isHR(req)) {
    if ('user_type' in req.body) {
      const ut = req.body.user_type || '';
      if (!USER_TYPES.includes(ut)) return res.status(400).json({ error: 'Invalid user type' });
      sets.push('user_type = ?'); params.push(ut);
    }
    if ('leaving_date' in req.body) {
      const ld = req.body.leaving_date || '';
      // A non-empty leaving date requires a User Type first; clearing is always allowed.
      const effectiveType = ('user_type' in req.body) ? (req.body.user_type || '') : row.user_type;
      if (ld && !effectiveType) return res.status(400).json({ error: 'Set User Type before the leaving date' });
      sets.push('leaving_date = ?'); params.push(ld);
    }
  }

  // IT: Status — only allowed once HR has set the User Type.
  if (isIT(req) && 'status' in req.body) {
    if (!row.user_type) return res.status(400).json({ error: 'HR must set the User Type before Status can be changed' });
    const st = req.body.status;
    if (!STATUSES.includes(st)) return res.status(400).json({ error: 'Invalid status' });
    sets.push('status = ?'); params.push(st);
    sets.push("status_changed_at = datetime('now')");
  }

  if (!sets.length) return res.status(403).json({ error: 'Nothing you are allowed to change' });

  sets.push('touched = 1');                 // mark edited → import won't overwrite it
  sets.push("updated_at = datetime('now')");
  await run(`UPDATE personnel SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);

  const updated = await get('SELECT * FROM personnel WHERE id = ?', [req.params.id]);
  await audit(req.user, 'PERSONNEL', updated.id, `Updated personnel "${updated.display_name}" (${updated.country})`);

  // Raise an alert about the change for the other team.
  if (isHR(req) && ('user_type' in req.body || 'leaving_date' in req.body)) {
    const bits = [];
    if (updated.user_type) bits.push(`User Type "${updated.user_type}"`);
    if (updated.leaving_date) bits.push(`leaving ${updated.leaving_date}`);
    await notify({ audience: 'IT', country: updated.country, scope: 'personnel', level: 'warning',
      message: `HR (${req.user.full_name}) updated ${updated.display_name} [${updated.country}]: ${bits.join(', ') || 'cleared'}.` });
  }
  if (isIT(req) && 'status' in req.body) {
    await notify({ audience: 'HR', country: updated.country, scope: 'personnel', level: 'info',
      message: `IT (${req.user.full_name}) set ${updated.display_name} [${updated.country}] status → "${updated.status}".` });
  }
  res.json(updated);
}));

module.exports = router;
