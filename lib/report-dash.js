/* Building blocks for report dashboards — the same ideas as the app's Dashboard page:
   - key-number tiles with the number per country (VN 601 · TH 56 · MY 48 · CHI 1)
   - tables with one row per country (Office / Factory under Vietnam) or per type, a Total column,
     one column per status / bucket / country, a Total row, and a "mix" bar of those columns.
   Countries are never added together without showing the split. */

const CORE = ['Vietnam', 'Thailand', 'Malaysia'];
const CODES = { Vietnam: 'VN', Thailand: 'TH', Malaysia: 'MY', Turkey: 'TR', Russia: 'RU', Egypt: 'EG', Unknown: '?' };
const code = (c) => CODES[c] || String(c || '?').slice(0, 3).toUpperCase();
const COUNTRY_COLOR = { Vietnam: '1A56DB', Thailand: '7C3AED', Malaysia: '0891B2', China: 'DB2777' };
const PALETTE = ['1A56DB', '7C3AED', '0891B2', 'DB2777', '65A30D', 'EA580C', '475569', '0D9488', 'A16207', '9333EA', 'BE123C', '0369A1'];
// Meaningful colours for common column names (status mix: green good, red bad, orange waiting).
const NAMED = {
  active: '16A34A', up: '16A34A', compliant: '16A34A', usable: '16A34A', ok: '16A34A', online: '16A34A', user: '16A34A',
  broken: 'DC2626', down: 'DC2626', noncompliant: 'DC2626', expired: 'DC2626', 'not compliant': 'DC2626', offline: 'DC2626',
  stock: 'D97706', warn: 'D97706', warning: 'D97706', 'in grace period': 'D97706', open: 'D97706',
  'no data': '94A3B8', unknown: '94A3B8', '(not set)': '94A3B8', 'never / none': '94A3B8', 'purchase date not set': '94A3B8', retired: '94A3B8',
  in_progress: '1A56DB',
};
const blank = (v, e = '(not set)') => (v == null || String(v).trim() === '' ? e : String(v).trim());

/** Countries present, in the app's order: Vietnam, Thailand, Malaysia, then the others by size. */
function countryOrder(items, countryOf) {
  const n = new Map();
  for (const it of items) { const c = blank(countryOf(it), 'Unknown'); n.set(c, (n.get(c) || 0) + 1); }
  const others = [...n.keys()].filter(c => !CORE.includes(c)).sort((a, b) => n.get(b) - n.get(a));
  return [...CORE.filter(c => n.has(c) || !others.length), ...others];
}

/** Key-number tile: value + the number per country (chips). */
function kpi(label, items, countryOf, order, color, value) {
  const split = order.map(c => ({ code: code(c), country: c, n: items.filter(it => blank(countryOf(it), 'Unknown') === c).length }));
  return { label, value: value != null ? value : items.length, color, split };
}

/**
 * Matrix table.
 *   rowsOf: [{ key, label, items, sub }] or built from rowKey/order/top
 *   cols:   [{ label, test(item) }] — counted per row; a Total column comes first
 *   mix:    true → the cols are shown as a mix bar (share of each col in the row)
 */
function matrix({ title, header, items, rowKey, order, top = 12, cols, sites, totalRow = true, mix = true, note }) {
  // Rows: by key, biggest first (or the given order); "Others" after `top`.
  const groups = new Map();
  for (const it of items) { const k = rowKey(it); if (k == null) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  let keys = order ? order.filter(k => groups.has(k)).concat([...groups.keys()].filter(k => !order.includes(k)))
    : [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || String(a).localeCompare(String(b)));
  let othersItems = null;
  if (!order && keys.length > top) { othersItems = keys.slice(top - 1).flatMap(k => groups.get(k)); keys = keys.slice(0, top - 1); }
  const line = (label, list, style = '') => ({ cells: [label, list.length, ...cols.map(c => list.filter(c.test).length)], style });
  const out = [];
  for (const k of keys) {
    out.push(line(k, groups.get(k)));
    if (sites) {                       // sub-rows (e.g. Office / Factory under Vietnam)
      const subs = sites(k, groups.get(k));
      if (subs) for (const s of subs) out.push(line(s.label, s.items, 'sub'));
    }
  }
  if (othersItems) out.push(line('Others', othersItems));
  if (totalRow && keys.length > 1) out.push(line('Total', items.filter(it => rowKey(it) != null), 'total'));
  const colors = cols.map((c, i) => c.color || NAMED[String(c.label).toLowerCase()] || COUNTRY_COLOR[c.label] || PALETTE[i % PALETTE.length]);
  return { kind: 'matrix', title, note, headers: [header, 'Total', ...cols.map(c => c.label)],
    rows: out.map(r => r.cells), styles: out.map(r => r.style), colors, mix };
}

/** Columns: one per value of `fn` (in `order`, else biggest first). */
function colsBy(items, fn, order) {
  const n = new Map();
  for (const it of items) { const v = fn(it); if (v == null) continue; n.set(v, (n.get(v) || 0) + 1); }
  const vals = order ? order.filter(v => n.has(v)).concat([...n.keys()].filter(v => !order.includes(v))) : [...n.keys()].sort((a, b) => n.get(b) - n.get(a));
  return vals.map(v => ({ label: String(v), test: (it) => fn(it) === v }));
}
/** Columns: one per country (app order). */
const countryCols = (items, countryOf) => countryOrder(items, countryOf).map(c => ({ label: c, test: (it) => blank(countryOf(it), 'Unknown') === c }));

/** Office / Factory sub-rows (Vietnam only, like the Dashboard). */
function vnSites(country, list, siteOf) {
  if (country !== 'Vietnam') return null;
  const by = (s) => list.filter(a => (siteOf(a) || '') === s);
  const subs = [{ label: 'Office', items: by('Office') }, { label: 'Factory', items: by('Factory') }];
  const none = list.filter(a => !siteOf(a));
  if (none.length) subs.push({ label: 'Site not set', items: none });
  return subs.filter(s => s.items.length);
}

module.exports = { CORE, code, countryOrder, kpi, matrix, colsBy, countryCols, vnSites, blank, NAMED, COUNTRY_COLOR, PALETTE };
