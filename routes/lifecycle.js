/* Stock & disposal (Inventory → ♻ Stock & disposal, and the asset detail).

   Return → ready to reuse: a Stock asset moves Returned → Wiped → Checked (grade A / B / C) → Ready; handing it over takes it out.
   GET  /api/lifecycle/reuse                    Stock assets of the user's countries with their step
   POST /api/lifecycle/reuse/:id                { state, grade, note, photo? } — move one asset (admin / editor)

   Disposal & write-off: the asset goes to the Recycle Bin and a disposal record keeps what Finance needs.
   POST /api/lifecycle/dispose/:id              { method, date, reason, wiped, wipe_method, buyer, price, cert? } (IT admin)
   GET  /api/lifecycle/disposals[?year=]        list;  GET /api/lifecycle/disposals.xlsx  Finance / SAP write-off list
   POST /api/lifecycle/disposals/:id/sap        { done } — written off in SAP (IT admin)
   GET  /api/lifecycle/disposals/:id/cert       the uploaded certificate (recycler / buyer / data-wipe) */

const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, requireRole, requireITAdmin, isITAdmin } = require('../middleware/auth');
const { countrySql, inScope } = require('../lib/scope');
const { depreciation, getYearsMap } = require('../lib/finance');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0) ? res.status(403).json({ error: 'No access to Asset Inventory' }) : next());

const STATES = ['returned', 'wiped', 'checked', 'ready'];
const STATE_LABEL = { returned: 'Returned', wiped: 'Wiped', checked: 'Checked', ready: 'Ready to reuse' };
const METHODS = ['Sold', 'Recycled (e-waste)', 'Donated', 'Scrapped', 'Returned to vendor / leasing', 'Lost / stolen'];
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const appendHist = (h, line) => (h ? `${h}\n${line}` : line);
const label = (a) => a.asset_s4 || a.asset_code || a.brand_model || '#' + a.id;
const DATA_TYPES = /laptop|desktop|tablet|mobile|phone|server|hand terminal/i;

async function assetInScope(req, res) {
  const a = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!a) { res.status(404).json({ error: 'Asset not found' }); return null; }
  if (!inScope(req, a.country)) { res.status(403).json({ error: 'Not in your region' }); return null; }
  return a;
}

// ── Return → ready to reuse ──────────────────────────────────────────────────
router.get('/reuse', wrap(async (req, res) => {
  const c = countrySql(req, 'country', req.query.country || null);
  const rows = await all(`SELECT id, asset_s4, asset_code, asset_type, brand_model, serial_no, computer_no, country, location, purchase_date,
      reuse_state, reuse_grade, reuse_note, reuse_at, reuse_by, updated_at,
      (SELECT MAX(signed_at) FROM asset_docs d WHERE d.asset_id = assets.id AND d.kind = 'return') AS returned_at,
      (SELECT person_name FROM asset_docs d WHERE d.asset_id = assets.id AND d.kind = 'return' ORDER BY id DESC LIMIT 1) AS returned_by
    FROM assets WHERE deleted_at IS NULL AND status = 'Stock'${c.clause ? ' AND ' + c.clause : ''} ORDER BY COALESCE(reuse_at, updated_at) DESC`, c.params);
  res.json({ rows, states: STATES, labels: STATE_LABEL, canEdit: ['admin', 'editor'].includes(req.user.role), canDispose: isITAdmin(req.user) });
}));

router.post('/reuse/:id', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const a = await assetInScope(req, res); if (!a) return;
  if (a.status !== 'Stock') return res.status(400).json({ error: 'Only Stock assets are in the reuse flow (set it to Stock / take it back first).' });
  const b = req.body || {};
  const state = b.state === '' ? '' : STATES.includes(b.state) ? b.state : null;
  if (state === null) return res.status(400).json({ error: 'Unknown step' });
  const grade = ['A', 'B', 'C', ''].includes(b.grade) ? b.grade : (a.reuse_grade || '');
  if ((state === 'checked' || state === 'ready') && !grade) return res.status(400).json({ error: 'Give the condition grade (A / B / C) when checking.' });
  const note = String(b.note == null ? a.reuse_note || '' : b.note).trim().slice(0, 300);
  const line = `${stamp()}: ${state ? `♻ reuse step "${STATE_LABEL[state]}"${grade ? ' · grade ' + grade : ''}` : '♻ taken out of the reuse flow'}${note && note !== a.reuse_note ? ' — ' + note : ''} by ${req.user.username}`;
  await run(`UPDATE assets SET reuse_state = ?, reuse_grade = ?, reuse_note = ?, reuse_at = datetime('now'), reuse_by = ?, history_usage = ? WHERE id = ?`,
    [state, state ? grade : '', state ? note : '', req.user.username, appendHist(a.history_usage, line), a.id]);
  // Optional photo of the condition (same store as stocktake photos).
  const ph = b.photo && typeof b.photo === 'object' ? b.photo : null;
  if (ph && /^image\/(jpeg|png|webp)$/.test(ph.mime || '') && typeof ph.b64 === 'string' && ph.b64.length < 4 * 1024 * 1024) {
    await run('INSERT INTO asset_photos (asset_id, note, mime, size, data_b64, taken_by) VALUES (?, ?, ?, ?, ?, ?)',
      [a.id, `Reuse check${grade ? ' · grade ' + grade : ''}${note ? ' — ' + note : ''}`.slice(0, 300), ph.mime, Math.round(ph.b64.length * 0.75), ph.b64, req.user.username]);
  }
  await audit(req.user, 'REUSE', a.id, `Reuse: "${label(a)}" → ${state ? STATE_LABEL[state] : 'out of the flow'}${grade ? ' (grade ' + grade + ')' : ''}`);
  res.json({ ok: true });
}));

// ── Disposal ─────────────────────────────────────────────────────────────────
router.post('/dispose/:id', requireITAdmin, wrap(async (req, res) => {
  const a = await assetInScope(req, res); if (!a) return;
  const b = req.body || {};
  const method = METHODS.includes(b.method) ? b.method : null;
  if (!method) return res.status(400).json({ error: 'Choose how it was disposed of.' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10);
  const lost = method === 'Lost / stolen';
  if (!lost && (String(a.user_name || '').trim() || String(a.ad_name || '').trim()))
    return res.status(400).json({ error: `It is still with ${a.user_name || a.ad_name} — take it back (↩ Return) first.` });
  const wiped = ['yes', 'no data', 'no'].includes(b.wiped) ? b.wiped : '';
  if (!lost && DATA_TYPES.test(a.asset_type || '') && !['yes', 'no data'].includes(wiped))
    return res.status(400).json({ error: 'A device that can hold company data must be wiped before it leaves (or confirm it holds no data).' });
  let cert = null;
  if (b.cert && typeof b.cert === 'object' && typeof b.cert.b64 === 'string') {
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(b.cert.mime || '')) return res.status(400).json({ error: 'Certificate: PDF or picture only.' });
    if (b.cert.b64.length > 7 * 1024 * 1024) return res.status(400).json({ error: 'Certificate is larger than 5 MB.' });
    cert = { name: String(b.cert.name || 'certificate').slice(0, 120), mime: b.cert.mime, b64: b.cert.b64 };
  }
  const dep = depreciation(a, await getYearsMap());
  const book = dep ? `${dep.bookValue.toLocaleString('en-US')} ${dep.currency}`.trim() : '';
  const s = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
  const ins = await run(`INSERT INTO asset_disposals (asset_id, country, asset_s4, asset_code, asset_type, brand_model, serial_no, cost_center, cost, purchase_date,
      book_value, disposed_on, method, reason, wiped, wipe_method, buyer, price, cert_name, cert_mime, cert_b64, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.country || '', a.asset_s4 || '', a.asset_code || '', a.asset_type || '', a.brand_model || '', a.serial_no || '', a.cost_center || '', a.cost || '',
      a.purchase_date || '', book, date, method, s(b.reason, 300), wiped, s(b.wipe_method, 120), s(b.buyer, 120), s(b.price, 60),
      cert ? cert.name : '', cert ? cert.mime : '', cert ? cert.b64 : '', req.user.username]);
  const line = `${stamp()}: ♻ disposed — ${method} on ${date}${wiped ? ' · data: ' + wiped : ''}${b.buyer ? ' · ' + s(b.buyer, 120) : ''} (record #${ins.lastInsertRowid}) by ${req.user.username}`;
  await run(`UPDATE assets SET deleted_at = datetime('now'), deleted_by = ?, history_usage = ?, reuse_state = '' WHERE id = ?`,
    [req.user.username, appendHist(a.history_usage, line), a.id]);
  await audit(req.user, 'DISPOSE', a.id, `Disposed "${label(a)}" — ${method} on ${date} (record #${ins.lastInsertRowid}; moved to the Recycle Bin)`);
  res.json({ ok: true, id: Number(ins.lastInsertRowid) });
}));

async function disposals(req) {
  const c = countrySql(req, 'd.country', req.query.country || null);
  const yr = /^\d{4}$/.test(req.query.year || '') ? req.query.year : '';
  return all(`SELECT d.id, d.asset_id, d.country, d.asset_s4, d.asset_code, d.asset_type, d.brand_model, d.serial_no, d.cost_center, d.cost, d.purchase_date,
      d.book_value, d.disposed_on, d.method, d.reason, d.wiped, d.wipe_method, d.buyer, d.price, d.cert_name, d.sap_done, d.sap_by, d.sap_at, d.created_by, d.created_at,
      CASE WHEN a.id IS NOT NULL AND a.deleted_at IS NULL THEN 1 ELSE 0 END AS restored
    FROM asset_disposals d LEFT JOIN assets a ON a.id = d.asset_id
    WHERE 1 = 1${c.clause ? ' AND ' + c.clause : ''}${yr ? " AND substr(d.disposed_on, 1, 4) = ?" : ''} ORDER BY d.disposed_on DESC, d.id DESC`, [...c.params, ...(yr ? [yr] : [])]);
}
router.get('/disposals', wrap(async (req, res) => res.json({ rows: await disposals(req), methods: METHODS, canEdit: isITAdmin(req.user) })));

router.get('/disposals.xlsx', wrap(async (req, res) => {
  const rows = (await disposals(req)).filter(r => !r.restored);
  const head = ['Record', 'Disposed on', 'Country', 'Asset S4', 'Asset Code (ECC)', 'Cost Center', 'Asset Type', 'Brand/Model', 'Serial', 'Purchase Date', 'Cost',
    'Book value at disposal', 'Method', 'Buyer / recycler', 'Sale price', 'Data wiped', 'Wipe method', 'Reason', 'Certificate', 'Written off in SAP', 'SAP by / on', 'Recorded by'];
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows.map(r => [r.id, r.disposed_on, r.country, r.asset_s4, r.asset_code, r.cost_center, r.asset_type, r.brand_model, r.serial_no,
    r.purchase_date, r.cost, r.book_value, r.method, r.buyer, r.price, r.wiped, r.wipe_method, r.reason, r.cert_name ? 'yes' : '', r.sap_done ? 'yes' : 'NO',
    r.sap_done ? `${r.sap_by} ${String(r.sap_at || '').slice(0, 10)}` : '', r.created_by])]);
  ws['!cols'] = head.map((h, i) => ({ wch: [7, 11, 10, 14, 16, 12, 12, 26, 16, 12, 16, 16, 18, 20, 12, 10, 14, 30, 10, 10, 18, 12][i] || 12 }));
  ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(head.length - 1)}${rows.length + 1}` };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Disposals');
  res.set('Cache-Control', 'no-store').set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .set('Content-Disposition', `attachment; filename="asset-disposals${req.query.year ? '-' + String(req.query.year).replace(/\D/g, '') : ''}.xlsx"`);
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}));

router.post('/disposals/:id/sap', requireITAdmin, wrap(async (req, res) => {
  const d = await get('SELECT * FROM asset_disposals WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Record not found' });
  if (!inScope(req, d.country)) return res.status(403).json({ error: 'Not in your region' });
  const done = req.body && req.body.done ? 1 : 0;
  await run(`UPDATE asset_disposals SET sap_done = ?, sap_by = ?, sap_at = ${done ? "datetime('now')" : 'NULL'} WHERE id = ?`, [done, done ? req.user.username : '', d.id]);
  await audit(req.user, 'DISPOSE', d.asset_id, `Disposal #${d.id}: ${done ? 'written off in SAP' : 'SAP write-off un-ticked'}`);
  res.json({ ok: true });
}));

router.get('/disposals/:id/cert', wrap(async (req, res) => {
  const d = await get('SELECT country, cert_name, cert_mime, cert_b64 FROM asset_disposals WHERE id = ?', [req.params.id]);
  if (!d || !d.cert_b64) return res.status(404).json({ error: 'No certificate' });
  if (!inScope(req, d.country)) return res.status(403).json({ error: 'Not in your region' });
  res.set('Cache-Control', 'no-store').set('Content-Type', d.cert_mime)
    .set('Content-Disposition', `inline; filename="${String(d.cert_name).replace(/[^\w.\- ]+/g, '_')}"`);
  res.send(Buffer.from(d.cert_b64, 'base64'));
}));

module.exports = router;
module.exports.STATES = STATES;
