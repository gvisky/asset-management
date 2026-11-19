/* Global search, person view and asset timeline.

   GET /api/lookup/search?q=        one box for everything: assets, people, servers, VMs, network devices (IP / MAC / serial),
                                    Intune / Entra devices — each group only for users who may open that page, limited to their countries
   GET /api/lookup/person/:id       everything about one person: AD, assets, devices, M365 licence, signed handovers, leaver checklist, history
   GET /api/lookup/asset/:id/timeline  one timeline per asset: bought, created, history lines, handovers / returns, repairs, scans, photos, … */

const express = require('express');
const router = express.Router();
const { get, all } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { countrySql, inScope } = require('../lib/scope');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);

const assetsOk = (req) => req.user && req.user.asset_access !== 0;
const peopleOk = (req) => req.user && (req.user.team === 'IT' || req.user.team === 'HR');
const where = (req, col, extra) => { const c = countrySql(req, col, null); return { sql: [extra, c.clause].filter(Boolean).join(' AND '), params: c.params }; };
const localPart = (e) => String(e || '').split('@')[0].trim().toLowerCase();
const LIMIT = 8;

// ── Search ───────────────────────────────────────────────────────────────────
router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json({ q, groups: [] });
  const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
  const L = (cols) => '(' + cols.map(c => `COALESCE(${c}, '') LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
  const P = (n) => Array(n).fill(like);
  const macQ = q.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const groups = [];

  if (assetsOk(req)) {
    const cols = ['asset_s4', 'asset_code', 'brand_model', 'serial_no', 'computer_no', 'user_name', 'ad_name', 'asset_description', 'remark'];
    const w = where(req, 'country', `deleted_at IS NULL AND ${L(cols)}`);
    const rows = await all(`SELECT id, asset_s4, asset_code, brand_model, serial_no, computer_no, user_name, ad_name, status, asset_type, country
      FROM assets WHERE ${w.sql} ORDER BY CASE WHEN serial_no = ? OR asset_s4 = ? OR asset_code = ? OR computer_no = ? THEN 0 ELSE 1 END, id DESC LIMIT ${LIMIT + 1}`,
      [...P(cols.length), ...w.params, q, q, q, q]);
    groups.push({ key: 'assets', label: 'Assets', more: rows.length > LIMIT, items: rows.slice(0, LIMIT).map(a => ({
      id: a.id, title: `${a.brand_model || a.asset_type || 'Asset'}${a.asset_s4 || a.asset_code ? ' · ' + (a.asset_s4 || a.asset_code) : ''}`,
      sub: [a.status, a.user_name || a.ad_name, a.serial_no && 'SN ' + a.serial_no, a.computer_no, a.country].filter(Boolean).join(' · '),
      url: `/inventory.html?view=${a.id}` })) });

    const scols = ['hostname', 'serial_no', 'asset_code', 'ip_address', 'brand_model', 'role'];
    const ws = where(req, 'country', `deleted_at IS NULL AND ${L(scols)}`);
    const srv = await all(`SELECT id, hostname, brand_model, serial_no, ip_address, status, country FROM servers WHERE ${ws.sql} ORDER BY id DESC LIMIT ${LIMIT + 1}`, [...P(scols.length), ...ws.params]);
    groups.push({ key: 'servers', label: 'Servers & equipment', more: srv.length > LIMIT, items: srv.slice(0, LIMIT).map(s => ({
      id: s.id, title: s.hostname || s.brand_model || `Server #${s.id}`, sub: [s.brand_model, s.ip_address, s.serial_no && 'SN ' + s.serial_no, s.status, s.country].filter(Boolean).join(' · '),
      url: `/server-inventory.html?view=${s.id}` })) });

    const vcols = ['hostname', 'ip', 'infra_ip', 'usage', 'description', 'os', 'backup_client'];
    const wv = where(req, 'country', L(vcols));
    const vms = await all(`SELECT id, hostname, ip, kind, status, os, usage FROM virtual_servers WHERE ${wv.sql} ORDER BY hostname LIMIT ${LIMIT + 1}`, [...P(vcols.length), ...wv.params]);
    groups.push({ key: 'vms', label: 'Virtual servers', more: vms.length > LIMIT, items: vms.slice(0, LIMIT).map(v => ({
      id: v.id, title: v.hostname, sub: [v.kind, v.ip, v.os, v.usage, v.status].filter(Boolean).join(' · '), url: `/server-inventory.html?tab=vm&search=${encodeURIComponent(v.hostname)}` })) });

    const ncols = ['hostname', 'alias', 'mgmt_ip', 'ips', 'serial', 'model', 'location'];
    const net = await all(`SELECT id, site, hostname, alias, role, model, mgmt_ip, serial, mac, location, state FROM net_devices
      WHERE ${L(ncols)}${macQ.length >= 4 ? ` OR REPLACE(REPLACE(REPLACE(LOWER(COALESCE(mac, '')), ':', ''), '-', ''), '.', '') LIKE ?` : ''} ORDER BY hostname LIMIT ${LIMIT + 1}`,
      [...P(ncols.length), ...(macQ.length >= 4 ? [`%${macQ}%`] : [])]);
    groups.push({ key: 'net', label: 'Network devices', more: net.length > LIMIT, items: net.slice(0, LIMIT).map(n => ({
      id: n.id, title: n.hostname + (n.state === 'retired' ? ' (retired)' : ''), sub: [n.role, n.model, n.mgmt_ip, n.mac && 'MAC ' + n.mac, n.location, n.site].filter(Boolean).join(' · '),
      url: `/network-map.html?host=${encodeURIComponent(n.hostname)}` })) });

    const ports = await all(`SELECT p.port, p.peer_host, p.peer_port, p.note, p.vlan, d.hostname FROM net_ports p JOIN net_devices d ON d.id = p.device_id
      WHERE ${L(['p.peer_host', 'p.note', 'p.patch'])} ORDER BY d.hostname, p.sort LIMIT ${LIMIT + 1}`, P(3));
    groups.push({ key: 'ports', label: 'Switch ports', more: ports.length > LIMIT, items: ports.slice(0, LIMIT).map(p => ({
      title: `${p.hostname} ${p.port}`, sub: [p.peer_host && `→ ${p.peer_host}${p.peer_port ? ' ' + p.peer_port : ''}`, p.vlan && 'VLAN ' + p.vlan, p.note].filter(Boolean).join(' · '),
      url: `/network-map.html?host=${encodeURIComponent(p.hostname)}` })) });

    const dcols = ['name', 'serial_no', 'user_upn', 'user_name', 'model'];
    const wd = where(req, 'country', L(dcols));
    const devs = await all(`SELECT id, name, user_name, user_upn, model, os, serial_no, is_compliant FROM devices WHERE ${wd.sql} ORDER BY name LIMIT ${LIMIT + 1}`, [...P(dcols.length), ...wd.params]);
    groups.push({ key: 'devices', label: 'Intune / Entra devices', more: devs.length > LIMIT, items: devs.slice(0, LIMIT).map(d => ({
      id: d.id, title: d.name || d.serial_no, sub: [d.user_name || d.user_upn, d.model, d.os, d.serial_no && 'SN ' + d.serial_no, d.is_compliant === 0 ? 'not compliant' : ''].filter(Boolean).join(' · '),
      url: `/devices.html?search=${encodeURIComponent(d.name || d.serial_no)}` })) });
  }
  if (peopleOk(req)) {
    const cols = ['display_name', 'email', 'employee_id', 'ad_email', 'ad_sam', 'position', 'department', 'ad_department', 'cost_center'];
    const w = where(req, 'country', L(cols));
    const ppl = await all(`SELECT id, display_name, email, status, country, position, ad_department, department, employee_id, leaving_date FROM personnel
      WHERE ${w.sql} ORDER BY CASE WHEN LOWER(email) = LOWER(?) OR employee_id = ? THEN 0 ELSE 1 END, display_name LIMIT ${LIMIT + 1}`, [...P(cols.length), ...w.params, q, q]);
    groups.unshift({ key: 'people', label: 'People', more: ppl.length > LIMIT, items: ppl.slice(0, LIMIT).map(p => ({
      id: p.id, person: true, title: p.display_name || p.email, sub: [p.email, p.employee_id && 'ID ' + p.employee_id, p.ad_department || p.department, p.leaving_date && 'leaving ' + p.leaving_date, p.country].filter(Boolean).join(' · ') })) });
  }
  res.json({ q, groups: groups.filter(g => g.items.length) });
}));

// ── Person view ──────────────────────────────────────────────────────────────
router.get('/person/:id', wrap(async (req, res) => {
  if (!peopleOk(req)) return res.status(403).json({ error: 'People are for HR and IT members' });
  const p = await get('SELECT * FROM personnel WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Person not found' });
  if (!inScope(req, p.country)) return res.status(403).json({ error: 'Not in your region' });
  const keys = [...new Set([localPart(p.email), localPart(p.ad_email), String(p.ad_sam || '').trim().toLowerCase()].filter(Boolean))];
  const mails = [...new Set([p.email, p.ad_email].map(x => String(x || '').trim().toLowerCase()).filter(Boolean))];
  const inK = keys.length ? keys.map(() => '?').join(',') : "''";
  const out = { person: p, assets: [], devices: [], m365: null, docs: [], leaver: [], history: [], confirmations: [], canAssets: assetsOk(req) };
  if (assetsOk(req)) {
    out.assets = keys.length ? await all(`SELECT id, asset_s4, asset_code, asset_type, brand_model, serial_no, computer_no, status, date_assigned, country, location, user_name
      FROM assets WHERE deleted_at IS NULL AND LOWER(TRIM(ad_name)) IN (${inK}) ORDER BY asset_type, id`, keys) : [];
    out.devices = await all(`SELECT id, name, model, os, os_version, serial_no, is_compliant, last_sign_in, last_checkin, in_intune, in_entra, asset_id FROM devices
      WHERE person_id = ? ${mails.length ? `OR LOWER(user_upn) IN (${mails.map(() => '?').join(',')})` : ''} ORDER BY name`, [p.id, ...mails]);
    out.docs = await all(`SELECT id, asset_id, kind, note, signed_at, created_by FROM asset_docs WHERE person_id = ? ${mails.length ? `OR LOWER(person_email) IN (${mails.map(() => '?').join(',')})` : ''} ORDER BY signed_at DESC`, [p.id, ...mails]);
    out.confirmations = await all(`SELECT asset_id, asset_label, result, note, confirmed_at FROM asset_confirmations WHERE person_id = ? ORDER BY confirmed_at DESC LIMIT 50`, [p.id]);
  }
  if (mails.length) out.m365 = await get(`SELECT upn, products, licensed, last_activity, report_date FROM m365_users WHERE LOWER(upn) IN (${mails.map(() => '?').join(',')}) AND COALESCE(is_deleted, 0) = 0 ORDER BY licensed DESC LIMIT 1`, mails);
  out.leaver = await all('SELECT item, label, due_date, done_at, done_by, note FROM leaver_items WHERE person_id = ? ORDER BY item', [p.id]);
  out.history = await all(`SELECT action, details, username, created_at FROM audit_log WHERE action = 'PERSONNEL' AND asset_id = ? ORDER BY id DESC LIMIT 30`, [p.id]);
  res.json(out);
}));

// ── Asset timeline ───────────────────────────────────────────────────────────
const HIST_LINE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?(?:\s*UTC)?\s*:\s*(.+)$/;
router.get('/asset/:id/timeline', wrap(async (req, res) => {
  if (!assetsOk(req)) return res.status(403).json({ error: 'No access to Asset Inventory' });
  const a = await get('SELECT * FROM assets WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Asset not found' });
  if (!inScope(req, a.country)) return res.status(403).json({ error: 'Not in your region' });
  const ev = [];
  const add = (at, kind, text, extra = {}) => { if (at) ev.push({ at: String(at).replace('T', ' ').slice(0, 16), kind, text, ...extra }); };
  if (/^\d{4}-\d{2}-\d{2}/.test(a.purchase_date || '')) add(a.purchase_date, 'bought', `Bought${a.vendor ? ' from ' + a.vendor : ''}${a.cost ? ' · ' + a.cost : ''}${a.po_number ? ' · PO ' + a.po_number : ''}`);
  const earlier = [];
  for (const line of String(a.history_usage || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const m = line.match(HIST_LINE);
    if (!m) { earlier.push(line); continue; }
    const t = m[3];
    const kind = /created by/i.test(t) ? 'created' : /User:|AD Name:|holder|handover|hand over/i.test(t) ? 'holder'
      : /Status:/i.test(t) ? 'status' : /locked|unlock/i.test(t) ? 'lock' : /warranty/i.test(t) ? 'warranty' : 'edit';
    add(`${m[1]} ${m[2] || '00:00'}`, kind, t);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(a.date_assigned || '') && (a.user_name || a.ad_name)) add(a.date_assigned, 'holder', `Assigned to ${a.user_name || a.ad_name} (Date Assigned)`);
  if (!ev.some(e => e.kind === 'created') && a.created_at) add(a.created_at, 'created', 'Added to the inventory');
  for (const d of await all('SELECT id, kind, person_name, note, signed_at, created_by FROM asset_docs WHERE asset_id = ?', [a.id]))
    add(d.signed_at, d.kind === 'return' ? 'return' : 'handover', `${d.kind === 'return' ? 'Returned by' : 'Handed over to'} ${d.person_name || '—'} (signed)${d.note ? ' — ' + d.note : ''} · by ${d.created_by}`, { url: `/api/custody/doc/${d.id}.pdf` });
  for (const m of await all("SELECT type, description, vendor, cost, status, reported_by, reported_at, resolved_at FROM maintenance_log WHERE asset_id = ? AND asset_type = 'asset'", [a.id])) {
    add(m.reported_at, 'repair', `${m.type[0].toUpperCase() + m.type.slice(1)}: ${m.description}${m.vendor ? ' · ' + m.vendor : ''}${m.cost ? ' · ' + m.cost : ''} (${m.reported_by})`);
    if (m.resolved_at) add(m.resolved_at, 'repair', `${m.type[0].toUpperCase() + m.type.slice(1)} done: ${m.description}`);
  }
  for (const s of await all(`SELECT q.source, q.result, q.scanned_by, q.scanned_at, t.name AS st FROM qr_scans q LEFT JOIN stocktakes t ON t.id = q.stocktake_id WHERE q.asset_id = ?`, [a.id]))
    add(s.scanned_at, 'scan', `QR scanned${s.st ? ' in stocktake "' + s.st + '"' : s.source ? ' (' + s.source + ')' : ''}${s.result ? ' — ' + s.result : ''} by ${s.scanned_by || '—'}`);
  for (const ph of await all('SELECT id, note, taken_by, taken_at FROM asset_photos WHERE asset_id = ?', [a.id]))
    add(ph.taken_at, 'photo', `Photo${ph.note ? ': ' + ph.note : ''} by ${ph.taken_by || '—'}`);
  for (const c of await all('SELECT result, note, signed_name, confirmed_at FROM asset_confirmations WHERE asset_id = ?', [a.id]))
    add(c.confirmed_at, 'confirm', `${c.signed_name || 'Holder'} ${c.result === 'have' ? 'confirmed they have it (My devices)' : c.result === 'not_have' ? 'said it is NOT with them (My devices)' : 'answered: ' + c.result}${c.note ? ' — ' + c.note : ''}`);
  for (const l of await all(`SELECT action, details, username, created_at FROM audit_log WHERE asset_id = ? AND action IN ('DELETE', 'RESTORE', 'PRINT', 'UNLOCK', 'STOCKTAKE', 'DISPOSE', 'REUSE')
      AND details NOT LIKE '%server%'`, [a.id]))
    add(l.created_at, l.action.toLowerCase(), `${l.details} (${l.username})`);
  if (/^\d{4}-\d{2}-\d{2}/.test(a.warranty_expiry || '')) add(a.warranty_expiry, 'warranty-end', `Warranty ${a.warranty_expiry > new Date().toISOString().slice(0, 10) ? 'ends' : 'ended'}${a.warranty_source === 'estimated' ? ' (estimated)' : ''}`, { future: a.warranty_expiry > new Date().toISOString().slice(0, 10) });
  ev.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  res.json({ events: ev, earlier });
}));

module.exports = router;
