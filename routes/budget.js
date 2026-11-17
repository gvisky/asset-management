/* Budget Tracking (IT admin only) — multi-year budget for Vietnam / Thailand /
   Malaysia (table budget_item, one row per line per country+year).

   Workbooks are parsed in the browser with the shared public/js/budget-core.js
   (the corporate reports are ~30 MB); only the parsed rows are posted here.
   Import replaces data per (country, year):
     • approved budget file        → always replaces that country+year
     • B-F report, year with actuals → replaces (budget + actual + forecast + comments)
     • B-F report, budget-only year  → skipped when an approved budget is already loaded
     • legacy budget 2026.xlsx       → only fills a country+year that has nothing newer
   IT notes typed in the app are carried over to the new rows when the line matches. */
const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { all, run, batch, audit } = require('../db/database');
const { requireAuth, requireITAdmin } = require('../middleware/auth');
const core = require('../public/js/budget-core');

router.use(requireAuth);
router.use(requireITAdmin);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const COUNTRIES = core.COUNTRIES;
const KINDS = ['approved', 'report', 'legacy'];
const r2 = core.r2;
const str = (v, n) => String(v == null ? '' : v).slice(0, n || 300);
const arr12 = (v) => { const a = Array.isArray(v) ? v : []; return Array.from({ length: 12 }, (_, i) => r2(a[i])); };
const parseArr = (t) => { try { return arr12(JSON.parse(t || '[]')); } catch (e) { return arr12([]); } };

const TEXT_COLS = ['status', 'company', 'department', 'owner', 'proj_group', 'proj_category', 'program', 'project',
  'sub_project', 'gl_no', 'gl_name', 'cc_no', 'cc_name', 'proje_no', 'proje_name',
  'pyp_ecc', 'pyp_ecc_name', 'pyp_s4', 'pyp_s4_name'];
const COLS = ['country', 'year', 'kind', 'oc', ...TEXT_COLS, 'm_budget', 'm_actual', 'actual_months', 'comment', 'note',
  'source_file', 'imported_at', 'imported_by'];

// Whitelist/coerce client-supplied rows to the schema.
function sanitize(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !COUNTRIES.includes(r.country)) continue;
    const year = Number(r.year);
    if (!(year >= 2020 && year <= 2100)) continue;
    const o = { country: r.country, year, kind: KINDS.includes(r.kind) ? r.kind : 'report' };
    for (const c of TEXT_COLS) o[c] = str(r[c]);
    o.oc = String(r.oc || '').toUpperCase() === 'CAPEX' ? 'CAPEX' : 'OPEX';
    o.budget = arr12(r.budget); o.actual = arr12(r.actual);
    o.actual_months = Math.max(0, Math.min(12, Math.floor(Number(r.actual_months) || 0)));
    o.comment = str(r.comment, 2000);
    out.push(o);
  }
  return out;
}

const lineKey = (r) => [r.oc, r.gl_no, r.pyp_ecc, r.pyp_s4, r.proj_category, r.program, r.project, r.sub_project, r.status].join('|');

function toItem(r) {
  return {
    id: r.id, country: r.country, year: Number(r.year), kind: r.kind, oc: r.oc,
    ...Object.fromEntries(TEXT_COLS.map(c => [c, r[c] || ''])),
    budget: parseArr(r.m_budget), actual: parseArr(r.m_actual), actual_months: Number(r.actual_months) || 0,
    comment: r.comment || '', note: r.note || '', source_file: r.source_file || '', imported_at: r.imported_at || '',
  };
}

async function loadGlMap() {
  const m = {};
  (await all('SELECT gl_tr_no, local_gl FROM gl_map')).forEach(r => { m[r.gl_tr_no] = r.local_gl || ''; });
  return m;
}

// ── GET /api/budget — all items + per country/year source info ───────────────
router.get('/', wrap(async (req, res) => {
  const rows = await all('SELECT * FROM budget_item ORDER BY country, year, oc, proj_group, proj_category, program, project, sub_project, gl_no');
  const items = rows.map(toItem);
  const src = {};
  for (const it of items) {
    const k = it.country + '|' + it.year;
    const s = src[k] = src[k] || { country: it.country, year: it.year, kind: it.kind, source_file: it.source_file, imported_at: it.imported_at, actual_months: 0, lines: 0 };
    s.lines++; s.actual_months = Math.max(s.actual_months, it.actual_months);
  }
  const years = [...new Set(items.map(i => i.year))].sort();
  res.json({ items, glMap: await loadGlMap(), meta: { countries: COUNTRIES, years, sources: Object.values(src) } });
}));

// Replace data per country+year (rules at the top of this file).
async function importRows(raw, fileNameIn, user, dryRun) {
  const rows = sanitize(raw);
  if (!rows.length) throw Object.assign(new Error('No Vietnam / Thailand / Malaysia budget rows found in this file.'), { status: 400 });
  const fileName = str(fileNameIn, 200);

  // Group incoming rows by country+year and decide per group.
  const groups = {};
  rows.forEach(r => { const k = r.country + '|' + r.year; (groups[k] = groups[k] || []).push(r); });
  const existing = await all('SELECT id, country, year, kind, oc, note, actual_months, ' + TEXT_COLS.join(', ') + ' FROM budget_item');
  const plan = [];
  for (const k of Object.keys(groups).sort()) {
    const g = groups[k], { country, year, kind } = g[0];
    const ex = existing.filter(e => e.country === country && Number(e.year) === year);
    const exKinds = [...new Set(ex.map(e => e.kind))];
    const hasActuals = g.some(r => r.actual_months > 0);
    let action = ex.length ? 'replace' : 'add', reason = '';
    if (kind === 'report' && !hasActuals && exKinds.includes('approved')) { action = 'skip'; reason = 'approved budget already loaded — report only has a draft for this year'; }
    if (kind === 'legacy' && exKinds.some(x => x !== 'legacy')) { action = 'skip'; reason = 'newer data already loaded'; }
    // Never replace data that has more actual months (e.g. an older mid-year file, or a
    // budget-only draft, over a report with actuals through Aug).
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const exMonths = Math.max(0, ...ex.map(e => Number(e.actual_months) || 0));
    const inMonths = Math.max(0, ...g.map(r => r.actual_months));
    if (action !== 'skip' && kind !== 'approved' && exMonths > inMonths) {
      action = 'skip';
      reason = `loaded data is newer (actual through ${MON[exMonths - 1]} ${year}; this file ${inMonths ? 'only to ' + MON[inMonths - 1] : 'has no actuals'})`;
    }
    plan.push({ country, year, kind, action, reason, lines: g.length, existing: ex.length, existing_kind: exKinds.join(', '),
      budget: r2(g.reduce((s, r) => s + core.sum(r.budget), 0)), actual: r2(g.reduce((s, r) => s + core.sum(r.actual), 0)),
      actual_months: Math.max(...g.map(r => r.actual_months)) });
  }
  if (dryRun) return { plan };

  const now = new Date().toISOString(), by = (user && user.username) || '';
  const stmts = [];
  let inserted = 0;
  for (const p of plan) {
    if (p.action === 'skip') continue;
    const ex = existing.filter(e => e.country === p.country && Number(e.year) === p.year);
    const notes = {};
    ex.forEach(e => { if (e.note) notes[lineKey(e)] = e.note; });
    stmts.push({ sql: 'DELETE FROM budget_item WHERE country = ? AND year = ?', args: [p.country, p.year] });
    for (const r of groups[p.country + '|' + p.year]) {
      const v = { ...r, m_budget: JSON.stringify(r.budget), m_actual: JSON.stringify(r.actual), note: notes[lineKey(r)] || '',
        source_file: fileName, imported_at: now, imported_by: by };
      stmts.push({ sql: `INSERT INTO budget_item (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`, args: COLS.map(c => v[c] == null ? '' : v[c]) });
      inserted++;
    }
  }
  if (stmts.length) await batch(stmts);
  const done = plan.filter(p => p.action !== 'skip').map(p => `${p.country} ${p.year} (${p.lines})`).join(', ');
  await audit(user, 'BUDGET_IMPORT', null, `Budget import ${fileName || ''}: ${done || 'nothing changed'}`);
  return { inserted, plan };
}
// ── POST /api/budget/import — { rows, file_name, dry_run } ────────────────────
router.post('/import', wrap(async (req, res) => {
  const body = req.body || {};
  let raw = body.rows;
  if (!Array.isArray(raw) && body.xlsx_base64) {          // Reports page: whole file, parse here
    try { raw = core.parseWithXLSX(XLSX, Buffer.from(String(body.xlsx_base64), 'base64'), 'buffer', body.file_name || '').items; }
    catch (e) { return res.status(400).json({ error: e.message || 'Could not read the Excel file' }); }
  }
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'No file provided' });
  try { res.json(await importRows(raw, body.file_name, req.user, !!body.dry_run)); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
}));

// ── PATCH /api/budget/:id/note — IT team's own note on a line ────────────────
router.patch('/:id/note', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad id' });
  const note = str((req.body || {}).note, 2000);
  await run('UPDATE budget_item SET note = ? WHERE id = ?', [note, id]);
  res.json({ ok: true, id, note });
}));

// ── DELETE /api/budget/:country/:year — remove one country+year dataset ──────
router.delete('/:country/:year', wrap(async (req, res) => {
  const { country } = req.params, year = Number(req.params.year);
  if (!COUNTRIES.includes(country) || !year) return res.status(400).json({ error: 'Bad country/year' });
  await run('DELETE FROM budget_item WHERE country = ? AND year = ?', [country, year]);
  await audit(req.user, 'BUDGET_DELETE', null, `Deleted budget ${country} ${year}`);
  res.json({ ok: true });
}));

// ── GET /api/budget/export.xlsx — one sheet per year, re-importable ──────────
// Row 1 = English labels, row 2 = the corporate (Turkish) headers the parser
// reads, so the file can be edited and uploaded again. "(EN)" columns carry
// the English translation next to each Turkish text.
const MON = core.MONTHS;
router.get('/export.xlsx', wrap(async (req, res) => {
  const items = (await all('SELECT * FROM budget_item ORDER BY year, country, oc, proj_group, proj_category, program, project, sub_project, gl_no')).map(toItem);
  const glMap = await loadGlMap();
  const wb = XLSX.utils.book_new();
  const years = [...new Set(items.map(i => i.year))].sort();
  const en = (v) => core.tr(v) || '';
  for (const y of years) {
    const list = items.filter(i => i.year === y);
    const yy = String(y).slice(2);
    const am = Math.max(0, ...list.map(i => i.actual_months));
    const hasAct = list.some(i => i.actual.some(v => v));
    const cols = [
      ['Country', 'Country', i => i.country], ['Company', 'Şirket Tanımı', i => i.company],
      ['Status', 'DURUM', i => i.status], ['Status (EN)', 'DURUM (EN)', i => en(i.status)],
      ['Opex / Capex', 'Opex/Capex', i => i.oc],
      ['Project group', 'Proje Grubu', i => i.proj_group], ['Project category', 'Proje Kategorisi', i => i.proj_category],
      ['Program / service', 'Program / Servis Adı', i => i.program], ['Program (EN)', 'Program (EN)', i => en(i.program)],
      ['Project / service', 'Proje / Servis Adı', i => i.project], ['Sub project / service', 'Alt Proje / Servis Adı', i => i.sub_project],
      ['GL (Turkish)', 'Masraf Çeşidi', i => i.gl_no], ['GL name', 'MÇ Tanımı', i => i.gl_name], ['GL name (EN)', 'MÇ Tanımı (EN)', i => en(i.gl_name)],
      ['Local GL', 'Local GL', i => glMap[i.gl_no] || ''],
      ['Cost center', 'MY No', i => i.cc_no], ['Cost center name', 'MY Tanımı', i => i.cc_name],
      ['Project no', 'Proje No', i => i.proje_no], ['Project name', 'Proje Tanım', i => i.proje_name],
      ['PYP old (ECC)', 'PYP No', i => i.pyp_ecc], ['PYP old name', 'PYP Tanım', i => i.pyp_ecc_name],
      ['PYP new (S4)', 'PYP öğesi (Yeni Yapı)', i => i.pyp_s4], ['PYP new name', 'Ad (Yeni Yapı)', i => i.pyp_s4_name],
    ];
    const top = cols.map(c => c[0]), head = cols.map(c => c[1]);
    top.push(`BUDGET ${y}_USD`, ...Array(12).fill('')); head.push(...MON.map(m => `B_${m}-${yy}`), `${y} Budget USD`);
    if (hasAct) {
      top.push(`ACTUAL+FORECAST ${y}_USD`, ...Array(12).fill(''));
      head.push(...MON.map((m, k) => `${k < am ? 'A' : 'F'}_${m}-${yy}`), `${y} A+F USD`);
      top.push('Variance USD (B − A+F)'); head.push('Variance USD');
    }
    top.push('Comment', 'Comment (EN)', 'IT note'); head.push(`${y} Açıklama`, `${y} Comment (EN)`, 'IT note');
    const data = [top, head];
    for (const i of list) {
      const row = cols.map(c => c[2](i));
      const bt = core.sum(i.budget);
      row.push(...i.budget, bt);
      if (hasAct) { const at = core.sum(i.actual); row.push(...i.actual, at, r2(bt - at)); }
      row.push(i.comment, en(i.comment), i.note);
      data.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!freeze'] = { xSplit: 0, ySplit: 2 };
    XLSX.utils.book_append_sheet(wb, ws, `Budget ${y}`);
  }
  if (!years.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No budget data']]), 'Budget');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Budget_Tracking.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}));

module.exports = router;
module.exports.importRows = importRows;
