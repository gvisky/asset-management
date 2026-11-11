/* Broken laptops: parts check + spare-part stock. Shared by Maintenance & Repairs and Reports.

   assets.parts (JSON): { total: true|false, screen|mainboard|ram|keyboard|battery|storage|charger: 'ok'|'bad'|'used'|'',
     note, checked_by, checked_at }. 'ok' = usable spare, 'bad' = broken, 'used' = taken as a spare, '' = not checked.

   Spare parts: every broken laptop holds one of each part; a part counts as in stock unless it is marked broken
   or used, or the laptop is "Total broken". Screen / Keyboard / Mainboard / Battery fit the same model only →
   counted per model; RAM / SSD / Charger fit any laptop → counted together. "checked" = confirmed usable. */

const PARTS = [['screen', 'Screen'], ['mainboard', 'Mainboard'], ['ram', 'RAM'], ['keyboard', 'Keyboard'], ['battery', 'Battery'],
  ['storage', 'SSD / Storage'], ['charger', 'Charger']];
const PART_STATES = ['', 'ok', 'bad', 'used'];
const isLaptop = (a) => String(a.asset_type || '').toLowerCase() === 'laptop';
const parseParts = (v) => { try { const p = v ? JSON.parse(v) : {}; return p && typeof p === 'object' ? p : {}; } catch { return {}; } };
// Condition of a broken laptop: total (nothing usable) / parts (some usable) / none_left / unchecked.
function conditionOf(a) {
  if (!isLaptop(a) || a.status !== 'Broken') return '';
  const p = parseParts(a.parts);
  if (p.total) return 'total';
  const states = PARTS.map(([k]) => p[k] || '');
  if (states.includes('ok')) return 'parts';
  if (states.every(x => x)) return 'none_left';
  // Checked before SSD / Charger were added: the old five parts all set and none usable → still "no usable part left".
  if (p.checked_at && PARTS.slice(0, 5).every(([k]) => p[k]) && !p.storage && !p.charger) return 'none_left';
  return 'unchecked';
}

const MODEL_PARTS = ['screen', 'keyboard', 'mainboard', 'battery'];
const SHARED_PARTS = ['ram', 'storage', 'charger'];
const PART_WORD = { ok: 'usable', bad: 'broken', used: 'used as spare', '': 'not checked' };
const CONDITION_LABEL = { total: 'Total broken', parts: 'Usable parts', none_left: 'No usable part left', unchecked: 'Parts not checked' };

/** rows: broken laptops { id, asset_code, asset_s4, brand_model, country, location, remark, parts } → spare-part stock. */
function computeSpares(rows) {
  const name = Object.fromEntries(PARTS);
  const inStock = (st) => st === '' || st === 'ok';
  const models = new Map();
  const shared = Object.fromEntries(SHARED_PARTS.map(k => [k, { part: k, partName: name[k], stock: 0, checked: 0, used: 0, sources: [] }]));
  let laptops = 0, totalBroken = 0;
  for (const a of rows) {
    const p = parseParts(a.parts);
    if (p.total) { totalBroken++; continue; }
    laptops++;
    const states = Object.fromEntries(PARTS.map(([k]) => [k, p[k] || '']));
    const src = { id: a.id, code: a.asset_s4 || a.asset_code || '', model: a.brand_model || '', serial: a.serial_no || '', country: a.country, location: a.location,
      remark: a.remark || '', note: p.note || '', states };
    const mk = (a.brand_model || 'Model not set').trim();
    const key = mk.toLowerCase();
    if (!models.has(key)) models.set(key, { model: mk, laptops: [], counts: Object.fromEntries(PARTS.map(([k]) => [k, { stock: 0, checked: 0, used: 0 }])) });
    const m = models.get(key);
    m.laptops.push(src);
    for (const [k] of PARTS) {          // per model: all parts (shared ones are also pooled below)
      if (inStock(states[k])) { m.counts[k].stock++; if (states[k] === 'ok') m.counts[k].checked++; }
      if (states[k] === 'used') m.counts[k].used++;
    }
    for (const k of SHARED_PARTS) {
      const g = shared[k];
      if (inStock(states[k])) { g.stock++; if (states[k] === 'ok') g.checked++; g.sources.push(src); }
      if (states[k] === 'used') g.used++;
    }
  }
  const modelList = [...models.values()].sort((x, y) => y.laptops.length - x.laptops.length || x.model.localeCompare(y.model));
  const totals = [...MODEL_PARTS, ...SHARED_PARTS].map(k => [k, name[k]]).map(([k, n]) => ({ part: k, partName: n, shared: SHARED_PARTS.includes(k),
    stock: SHARED_PARTS.includes(k) ? shared[k].stock : modelList.reduce((t, m) => t + m.counts[k].stock, 0) }));
  return { laptops, totalBroken, models: modelList, totals, shared, name };
}

module.exports = { PARTS, PART_STATES, MODEL_PARTS, SHARED_PARTS, PART_WORD, CONDITION_LABEL, isLaptop, parseParts, conditionOf, computeSpares };
