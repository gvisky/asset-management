/* Handover / return with e-signature (replaces the paper custody form).

   GET  /api/custody/people?q=            people to hand over to (User Inventory, your countries)
   GET  /api/custody/asset/:id            records of an asset (no PDF data)
   GET  /api/custody/doc/:docId.pdf       the signed PDF
   POST /api/custody/asset/:id/handover   { person_id, note, signature (PNG data URL) }  admin / editor
   POST /api/custody/asset/:id/return     { note, status: 'Stock' | 'Broken', signature } admin / editor

   A handover sets the holder (User Name = person's name, AD Name = email before @), Date Assigned and
   status Active; a return clears the holder and sets Stock / Broken. Both follow the asset rules:
   a holder change is written to History Usage and locks the record (SAP update list) — while it is
   locked, IT admin must unlock it first, exactly like an edit in Asset Inventory. */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { get, all, run, audit } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { inScope, countrySql } = require('../lib/scope');
const { auditCtx } = require('../db/database');
const { buildCustodyPdf } = require('../lib/custody-pdf');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);
router.use((req, res, next) => (req.user && req.user.asset_access === 0 ? res.status(403).json({ error: 'No access to Asset Inventory' }) : next()));

const localPart = (email) => String(email || '').split('@')[0].trim();
const nowUtc = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const nowLocal = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+7)';
const MAX_SIG = 400 * 1024;

function readSignature(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > MAX_SIG) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf.length > 200 ? buf : null;          // an empty canvas is tiny
}

// People (User Inventory) of your countries, for the handover picker.
router.get('/people', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const cs = countrySql(req, 'country', '');
  const like = `%${q}%`;
  const rows = await all(`SELECT id, display_name, email, department, position, country FROM personnel
     WHERE status <> 'deleted' AND (LOWER(display_name) LIKE ? OR LOWER(email) LIKE ?)${cs.clause ? ' AND ' + cs.clause : ''}
     ORDER BY display_name COLLATE NOCASE LIMIT 20`, [like, like, ...cs.params]);
  res.json(rows);
}));

async function assetInScope(req, res) {
  const a = await get('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!a) { res.status(404).json({ error: 'Asset not found' }); return null; }
  if (!inScope(req, a.country)) { res.status(403).json({ error: 'Not in your region' }); return null; }
  return a;
}

router.get('/asset/:id', wrap(async (req, res) => {
  const a = await assetInScope(req, res); if (!a) return;
  res.json(await all(`SELECT id, kind, person_id, person_name, person_email, note, signed_at, created_by, sha256
     FROM asset_docs WHERE asset_id = ? ORDER BY id DESC`, [a.id]));
}));

router.get('/doc/:docId', wrap(async (req, res) => {
  const id = Number(String(req.params.docId).replace(/\.pdf$/i, ''));
  const d = await get('SELECT * FROM asset_docs WHERE id = ?', [id]);
  if (!d) return res.status(404).json({ error: 'Record not found' });
  const a = await get('SELECT country FROM assets WHERE id = ?', [d.asset_id]);
  if (!inScope(req, (a && a.country) || d.country)) return res.status(403).json({ error: 'Not in your region' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${d.kind}-asset${d.asset_id}-${String(d.signed_at).slice(0, 10)}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(d.pdf_b64 || '', 'base64'));
}));

// Shared: change the holder like an Asset Inventory edit (history + holder lock), store the signed PDF.
async function record(req, res, a, { kind, person, holder, status, note, sig }) {
  const norm = (v) => String(v == null ? '' : v).trim();
  const holderChanged = ['user_name', 'ad_name'].filter(k => norm(a[k]) !== '' && norm(a[k]) !== norm(holder[k]));
  if (holderChanged.length && a.user_locked) {
    return res.status(403).json({ code: 'holder_locked', error: 'User Name / AD Name are locked (an earlier holder change waits for the SAP update). An IT admin must unlock this record first.' });
  }
  const ts = nowUtc();
  const lines = [];
  const changes = [];
  if (norm(a.user_name) !== norm(holder.user_name)) changes.push(`User: "${norm(a.user_name) || '∅'}"→"${norm(holder.user_name) || '∅'}"`);
  if (norm(a.ad_name) !== norm(holder.ad_name)) changes.push(`AD Name: "${norm(a.ad_name) || '∅'}"→"${norm(holder.ad_name) || '∅'}"`);
  if (status && status !== a.status) changes.push(`Status: "${a.status || '∅'}"→"${status}"`);
  lines.push(`${ts} UTC: ${kind === 'return' ? '↩ returned' : '✍ handed over'} (e-signed${person.name ? ' by ' + person.name : ''})${changes.length ? ' — ' + changes.join('; ') : ''} by ${req.user.username}`);
  let lock = a.user_locked;
  if (holderChanged.length) { lock = 1; lines.push(`${ts} UTC: 🔒 locked — ${holderChanged.map(k => (k === 'user_name' ? 'User Name' : 'AD Name')).join(' & ')} changed by ${req.user.username} (IT admin to unlock)`); }
  const history = [a.history_usage, ...lines].filter(Boolean).join('\n');

  // Record first (to get its number for the PDF), then the PDF + fingerprint.
  const ctx = auditCtx.getStore();
  const ins = await run(`INSERT INTO asset_docs (asset_id, kind, person_id, person_name, person_email, note, country, created_by, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [a.id, kind, person.id || null, person.name || '', person.email || '', note, a.country || '', req.user.username, (ctx && ctx.ip) || '']);
  const docId = Number(ins.lastInsertRowid);
  const pdf = await buildCustodyPdf({ kind, asset: a, person, note, signaturePng: sig, by: req.user.full_name || req.user.username,
    when: nowLocal(), ip: (ctx && ctx.ip) || '', recordId: docId });
  const sha = crypto.createHash('sha256').update(pdf).digest('hex');
  await run('UPDATE asset_docs SET pdf_b64 = ?, sha256 = ? WHERE id = ?', [pdf.toString('base64'), sha, docId]);
  await run(`UPDATE assets SET user_name = ?, ad_name = ?, status = COALESCE(?, status), date_assigned = CASE WHEN ? = 'handover' THEN date('now') ELSE date_assigned END,
       history_usage = ?, user_locked = ? WHERE id = ?`,
    [holder.user_name, holder.ad_name, status || null, kind, history, lock, a.id]);
  await audit(req.user, kind === 'return' ? 'RETURN' : 'HANDOVER', a.id,
    `${kind === 'return' ? 'Return' : 'Handover'} of "${a.asset_s4 || a.asset_code || a.brand_model || '#' + a.id}" ${kind === 'return' ? 'from' : 'to'} ${person.name || '—'} (e-signed, record #${docId})`);
  res.json({ ok: true, docId, sha256: sha, locked: !!lock });
}

router.post('/asset/:id/handover', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const a = await assetInScope(req, res); if (!a) return;
  const b = req.body || {};
  const sig = readSignature(b.signature);
  if (!sig) return res.status(400).json({ error: 'The person must sign in the box.' });
  const p = await get("SELECT * FROM personnel WHERE id = ? AND status <> 'deleted'", [Number(b.person_id)]);
  if (!p) return res.status(400).json({ error: 'Pick the person from User Inventory.' });
  if (!inScope(req, p.country)) return res.status(403).json({ error: 'That person is not in your region' });
  if (a.status === 'Broken') return res.status(400).json({ error: 'This asset is Broken — repair it or set it to Stock first.' });
  const person = { id: p.id, name: p.display_name, email: p.email, department: p.department };
  return record(req, res, a, { kind: 'handover', person, holder: { user_name: p.display_name || '', ad_name: localPart(p.email) },
    status: 'Active', note: String(b.note || '').trim().slice(0, 500), sig });
}));

router.post('/asset/:id/return', requireRole('admin', 'editor'), wrap(async (req, res) => {
  const a = await assetInScope(req, res); if (!a) return;
  const b = req.body || {};
  const sig = readSignature(b.signature);
  if (!sig) return res.status(400).json({ error: 'The person returning it must sign in the box.' });
  if (!String(a.user_name || '').trim() && !String(a.ad_name || '').trim()) return res.status(400).json({ error: 'This asset has no holder to return it from.' });
  const status = b.status === 'Broken' ? 'Broken' : 'Stock';
  // Who returns it: the holder (found in User Inventory by AD Name / name when possible).
  const p = await get(`SELECT * FROM personnel WHERE (? <> '' AND LOWER(substr(email, 1, instr(email, '@') - 1)) = LOWER(?))
      OR (? <> '' AND LOWER(display_name) = LOWER(?)) ORDER BY id LIMIT 1`, [a.ad_name || '', a.ad_name || '', a.user_name || '', a.user_name || '']);
  const person = p ? { id: p.id, name: p.display_name, email: p.email, department: p.department }
    : { id: null, name: a.user_name || a.ad_name, email: '', department: a.department };
  return record(req, res, a, { kind: 'return', person, holder: { user_name: '', ad_name: '' }, status,
    note: String(b.note || '').trim().slice(0, 500), sig });
}));

module.exports = router;
