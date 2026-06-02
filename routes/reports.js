const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { all } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
// HR-only users (no Asset Inventory access) can't use the asset reports/export.
router.use((req, res, next) => {
  if (req.user && req.user.asset_access === 0) return res.status(403).json({ error: 'No access' });
  next();
});
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const scopeOf = (req) => (req.user && req.user.country) ? req.user.country : null;

// Country clause for assets/personnel/maintenance (which all carry `country`).
function scoped(req, col = 'country') {
  const s = scopeOf(req);
  if (s) return { clause: ` AND ${col} = ?`, params: [s] };
  if (req.query.country) return { clause: ` AND ${col} = ?`, params: [req.query.country] };
  return { clause: '', params: [] };
}

// Each report returns { sheets: [{ name, rows }] }.
const REPORTS = {
  async assets(req) {
    const sc = scoped(req);
    const rows = await all(
      `SELECT asset_code AS "Asset Code", brand_model AS "Brand/Model", computer_no AS "Computer No",
              serial_no AS "Serial", country AS "Country", location AS "Location",
              department AS "Department", user_name AS "User", ad_name AS "AD Name", status AS "Status",
              vendor AS "Vendor", purchase_date AS "Purchase Date", warranty_expiry AS "Warranty Expiry",
              cost AS "Cost", po_number AS "PO Number"
         FROM assets WHERE deleted_at IS NULL${sc.clause} ORDER BY country, id`, sc.params);
    return { sheets: [{ name: 'Assets', rows }] };
  },

  async summary(req) {
    const sc = scoped(req);
    const sheets = [
      { name: 'By Status',   rows: await all(`SELECT status AS Status, COUNT(*) AS Count FROM assets WHERE deleted_at IS NULL${sc.clause} GROUP BY status ORDER BY Count DESC`, sc.params) },
      { name: 'By Location', rows: await all(`SELECT location AS Location, COUNT(*) AS Count FROM assets WHERE deleted_at IS NULL${sc.clause} GROUP BY location ORDER BY Count DESC`, sc.params) },
      { name: 'By Country',  rows: await all(`SELECT country AS Country, COUNT(*) AS Count FROM assets WHERE deleted_at IS NULL${sc.clause} GROUP BY country ORDER BY Count DESC`, sc.params) },
      { name: 'By Cost Center', rows: await all(
          `SELECT cost_center AS "Cost Center", MAX(cost_center_desc) AS "Description", COUNT(*) AS Count
             FROM assets WHERE deleted_at IS NULL AND cost_center <> ''${sc.clause}
            GROUP BY cost_center ORDER BY Count DESC`, sc.params) },
    ];
    return { sheets };
  },

  async offboarding(req) {
    const s = scopeOf(req);
    const cond = ["p.leaving_date <> ''", 'a.deleted_at IS NULL'];
    const params = [];
    if (s) { cond.push('p.country = ?', 'a.country = ?'); params.push(s, s); }
    else if (req.query.country) { cond.push('p.country = ?', 'a.country = ?'); params.push(req.query.country, req.query.country); }
    const rows = await all(
      `SELECT p.display_name AS "Person", p.email AS "Email", p.leaving_date AS "Leaving Date",
              p.country AS "Country", a.asset_code AS "Asset Code", a.brand_model AS "Brand/Model",
              a.location AS "Location", a.status AS "Status"
         FROM personnel p
         JOIN assets a ON a.user_name = p.display_name COLLATE NOCASE OR a.ad_name = p.display_name COLLATE NOCASE
        WHERE ${cond.join(' AND ')} ORDER BY p.leaving_date, p.display_name`, params);
    return { sheets: [{ name: 'Offboarding', rows }] };
  },

  async licenses(req) {
    const s = scopeOf(req);
    const used = `(SELECT COUNT(*) FROM license_assignments la WHERE la.license_id = l.id AND la.released_at IS NULL)`;
    let where = '';
    const params = [];
    if (s) { where = "WHERE (country = 'Global' OR country = ?)"; params.push(s); }
    else if (req.query.country) { where = 'WHERE country = ?'; params.push(req.query.country); }
    const rows = await all(
      `SELECT name AS "Name", vendor AS "Vendor", type AS "Type", ${used} AS "Seats Used",
              total_seats AS "Total Seats", renewal_date AS "Renewal", cost AS "Cost", country AS "Scope"
         FROM licenses l ${where} ORDER BY name COLLATE NOCASE`, params);
    return { sheets: [{ name: 'Licenses', rows }] };
  },

  async servers(req) {
    const sc = scoped(req);
    const rows = await all(
      `SELECT asset_code AS "Asset Code", hostname AS "Hostname", brand_model AS "Brand/Model",
              ip_address AS "IP", os AS "OS", role AS "Role", cpu AS "CPU", ram AS "RAM",
              storage AS "Storage", country AS "Country", location AS "Location", status AS "Status",
              vendor AS "Vendor", warranty_expiry AS "Warranty Expiry", purchase_date AS "Purchase Date",
              cost AS "Cost", po_number AS "PO Number"
         FROM servers WHERE deleted_at IS NULL${sc.clause} ORDER BY country, id`, sc.params);
    return { sheets: [{ name: 'Servers', rows }] };
  },

  async maintenance(req) {
    const sc = scoped(req, 'm.country');
    const rows = await all(
      `SELECT m.asset_type AS "Item Type",
              CASE WHEN m.asset_type = 'server'
                   THEN COALESCE(NULLIF(s.asset_code,''), s.hostname, s.brand_model)
                   ELSE COALESCE(NULLIF(a.asset_code,''), a.brand_model) END AS "Item",
              m.type AS "Type", m.description AS "Description", m.vendor AS "Vendor", m.cost AS "Cost",
              m.status AS "Status", m.reported_at AS "Reported", m.reported_by AS "By", m.country AS "Country"
         FROM maintenance_log m
         LEFT JOIN assets  a ON m.asset_type = 'asset'  AND a.id = m.asset_id
         LEFT JOIN servers s ON m.asset_type = 'server' AND s.id = m.asset_id
        WHERE m.status <> 'done'${sc.clause} ORDER BY m.reported_at DESC`, sc.params);
    return { sheets: [{ name: 'Open Maintenance', rows }] };
  },

  async warranty(req) {
    const sc = scoped(req);
    const assets = await all(
      `SELECT asset_code AS "Asset Code", brand_model AS "Brand/Model", country AS "Country",
              location AS "Location", vendor AS "Vendor", warranty_expiry AS "Warranty Expiry", status AS "Status"
         FROM assets
        WHERE deleted_at IS NULL AND warranty_expiry <> ''
          AND date(warranty_expiry) <= date('now','+90 days')${sc.clause}
        ORDER BY warranty_expiry`, sc.params);
    const servers = await all(
      `SELECT asset_code AS "Asset Code", hostname AS "Hostname", brand_model AS "Brand/Model",
              country AS "Country", location AS "Location", vendor AS "Vendor",
              warranty_expiry AS "Warranty Expiry", status AS "Status"
         FROM servers
        WHERE deleted_at IS NULL AND warranty_expiry <> ''
          AND date(warranty_expiry) <= date('now','+90 days')${sc.clause}
        ORDER BY warranty_expiry`, sc.params);
    return { sheets: [{ name: 'Assets', rows: assets }, { name: 'Servers', rows: servers }] };
  },
};

// ── GET /api/reports/:name — download an .xlsx (region/role scoped) ───────────
router.get('/:name', wrap(async (req, res) => {
  const name = String(req.params.name).replace(/\.xlsx$/i, '');
  const builder = REPORTS[name];
  if (!builder) return res.status(404).json({ error: 'Unknown report' });

  const { sheets } = await builder(req);
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '(no data)': '' }]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

module.exports = router;
