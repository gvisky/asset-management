/* Interactive HTML report — one self-contained page (works offline once saved):
   - Dashboard: key numbers with the split per country, matrix tables with mix bars (hover = numbers & %),
     click a column title to sort, "%" switch, and country buttons (All / Vietnam / Thailand …) that show
     that country's own dashboard.
   - One tab per data sheet: search, sort, filter by country, 50 / 100 / 500 rows per page, CSV of what you see.
   - Print (dashboard), and links to download the same report as Excel / PDF.
   Data is embedded as JSON with "<" escaped, and every value is HTML-escaped when shown. */

const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * dashboards: { All: dashboard, Vietnam: dashboard, … } (All first)
 * sheets: [{ name, rows: [object] }]
 */
function buildHtmlReport({ name, dashboards, sheets, meta }) {
  const views = Object.keys(dashboards);
  const main = dashboards[views[0]];
  const data = {
    name, meta, views,
    dash: dashboards,
    sheets: sheets.map(s => {
      const cols = [...new Set(s.rows.flatMap(r => Object.keys(r)))];
      return { name: s.name, cols, rows: s.rows.map(r => cols.map(c => (r[c] == null ? '' : r[c]))) };
    }),
  };
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(main.title)} — ${esc(meta.generated)}</title>
<style>${CSS}</style></head>
<body>
<header class="top">
  <div><h1>${esc(main.title)}</h1>
    <div class="meta">${esc([main.subtitle, `Generated ${meta.generated}`, meta.by && `by ${meta.by}`, meta.scope].filter(Boolean).join(' · '))}</div></div>
  <div class="actions">
    <a class="btn x" href="/api/reports/${esc(name)}.xlsx" title="Excel: dashboard + raw data">📊 Excel</a>
    <a class="btn p" href="/api/reports/${esc(name)}.pdf" title="PDF: dashboard">📄 PDF</a>
    <button class="btn" onclick="window.print()" title="Print the dashboard">🖨 Print</button>
  </div>
</header>
<nav class="tabs" id="tabs"></nav>
<main id="main"></main>
<div id="tip" class="tip" hidden></div>
<footer>Hayat Communication Tools · interactive report · save this page (Ctrl + S) to keep it — it works offline</footer>
<script>window.REPORT = ${safeJson(data)};</script>
<script>${JS}</script>
</body></html>`;
}

const CSS = `
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a;background:#f1f5f9}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:#1a56db;color:#fff;padding:16px 24px}
.top h1{margin:0;font-size:22px}.meta{font-size:12px;opacity:.85;margin-top:2px}
.actions{display:flex;gap:8px}.btn{background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:6px;padding:6px 12px;font:600 13px system-ui;cursor:pointer;text-decoration:none}
.btn:hover{background:#f8fafc}.btn.x{color:#166534}.btn.p{color:#991b1b}.btn.on{background:#1a56db;color:#fff;border-color:#1a56db}
.tabs{display:flex;gap:2px;padding:0 24px;background:#fff;border-bottom:1px solid #e2e8f0;position:sticky;top:0;z-index:5;overflow-x:auto}
.tab{padding:11px 16px;border:0;background:none;font:600 13px system-ui;color:#64748b;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap}
.tab.on{color:#1a56db;border-bottom-color:#1a56db}.tab .n{font-weight:400;color:#94a3b8;margin-left:4px}
main{padding:18px 24px;max-width:1500px;margin:0 auto}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.pill{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:5px 13px;font:600 12.5px system-ui;color:#334155;cursor:pointer}
.pill.on{background:#0f172a;color:#fff;border-color:#0f172a}.lbl{font-size:12px;color:#64748b;margin-right:4px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:#fff;border-radius:10px;padding:12px 14px;border-top:3px solid var(--c);box-shadow:0 1px 2px rgba(0,0,0,.05)}
.kpi .l{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em}
.kpi .v{font-size:28px;font-weight:800;color:var(--c);line-height:1.15;margin:2px 0 6px}
.chip{display:inline-block;background:#f1f5f9;border-radius:4px;padding:1px 6px;margin:0 4px 3px 0;font-size:11.5px;color:#64748b;cursor:pointer;border:0}
.chip b{color:#0f172a}.chip.z b{color:#cbd5e1}.chip:hover{background:#e2e8f0}
.card{background:#fff;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.05);margin-bottom:16px;overflow:hidden}
.ch{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
.ch h2{margin:0;font-size:15px}.ch .note{font-size:12px;color:#64748b;font-weight:400;margin-left:8px}
.lg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#475569;align-items:center}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.lg label{cursor:pointer;user-select:none}
table{border-collapse:collapse;width:100%}th,td{padding:7px 12px;text-align:right;white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#64748b;background:#f8fafc;cursor:pointer;user-select:none;position:sticky;top:0}
th:first-child,td:first-child{text-align:left}th:hover{color:#1a56db}th.s::after{content:" ▾"}th.s.up::after{content:" ▴"}
td{border-top:1px solid #f1f5f9}tr.sub td{color:#64748b;background:#fcfdfe;font-size:13px}tr.sub td:first-child{padding-left:30px}
tr.sub td:first-child::before{content:"└ ";color:#cbd5e1}tr.tot td{font-weight:700;border-top:2px solid #cbd5e1}
tr.main td:first-child,td.t{font-weight:700}td.z,tr.sub td.z{color:#cbd5e1}tr:hover td{background:#f8fafc}
td.mix{width:32%;min-width:160px}.mb{display:flex;height:10px;border-radius:3px;overflow:hidden;background:#f1f5f9}
tr.sub .mb{height:7px}.mb span{height:100%}.mb span:hover{filter:brightness(1.15)}
.tip{position:fixed;z-index:50;background:#0f172a;color:#fff;font-size:12px;padding:6px 9px;border-radius:6px;pointer-events:none;white-space:nowrap}
.data .bar input[type=search]{flex:1;min-width:220px;max-width:420px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font:14px system-ui}
.data select{padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:13px system-ui}
.scroll{overflow:auto;max-height:70vh}.data td,.data th{text-align:left;font-size:12.5px}.data td{max-width:360px;overflow:hidden;text-overflow:ellipsis}
.pager{display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:10px 16px;font-size:12.5px;color:#64748b}
mark{background:#fef08a;padding:0}
footer{text-align:center;color:#94a3b8;font-size:11.5px;padding:18px}
@media print{.tabs,.actions,.bar,.pager,footer{display:none!important}body{background:#fff}.card,.kpi{box-shadow:none;border:1px solid #e2e8f0;break-inside:avoid}main{padding:0}.top{-webkit-print-color-adjust:exact;print-color-adjust:exact}.mb span,.kpi{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

const JS = String.raw`
(function () {
  const R = window.REPORT;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v) => typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : esc(v);
  const KC = { blue: '#1a56db', green: '#16a34a', amber: '#d97706', red: '#dc2626', purple: '#7c3aed', grey: '#475569', teal: '#0891b2' };
  const state = { tab: 'dash', view: R.views[0], pct: false, sort: {}, hide: {}, data: {} };
  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => { if (!tip.hidden) { tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; } });

  // ── Tabs ──
  function tabs() {
    $('#tabs').innerHTML = '<button class="tab' + (state.tab === 'dash' ? ' on' : '') + '" data-t="dash">📊 Dashboard</button>'
      + R.sheets.map((s, i) => '<button class="tab' + (state.tab === i ? ' on' : '') + '" data-t="' + i + '">' + esc(s.name) + '<span class="n">' + s.rows.length.toLocaleString() + '</span></button>').join('');
    $('#tabs').querySelectorAll('.tab').forEach(b => b.onclick = () => { state.tab = b.dataset.t === 'dash' ? 'dash' : Number(b.dataset.t); render(); });
  }
  function render() { tabs(); state.tab === 'dash' ? dash() : sheet(state.tab); window.scrollTo(0, 0); }

  // ── Dashboard ──
  function dash() {
    const d = R.dash[state.view];
    let h = '<div class="bar"><span class="lbl">Country</span>' + R.views.map(v => '<button class="pill' + (v === state.view ? ' on' : '') + '" data-v="' + esc(v) + '">' + esc(v === 'All' ? 'All countries' : v) + '</button>').join('')
      + '<span style="flex:1"></span><label class="lbl"><input type="checkbox" id="pct"' + (state.pct ? ' checked' : '') + '> show % of row</label></div>';
    h += '<div class="kpis">' + (d.kpis || []).map(k => '<div class="kpi" style="--c:' + (KC[k.color] || KC.blue) + '"><div class="l">' + esc(k.label) + '</div><div class="v">' + fmt(k.value) + '</div>'
      + (k.split || []).map(s => '<button class="chip' + (s.n ? '' : ' z') + '" data-v="' + esc(s.country) + '" title="' + esc(s.country) + ' — show only this country">' + esc(s.code) + ' <b>' + fmt(s.n) + '</b></button>').join('') + '</div>').join('') + '</div>';
    (d.tables || []).forEach((t, ti) => { h += t.kind === 'matrix' ? matrix(t, ti) : simple(t); });
    $('#main').innerHTML = h;
    $('#main').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { if (R.dash[b.dataset.v]) { state.view = b.dataset.v; dash(); } });
    $('#pct').onchange = (e) => { state.pct = e.target.checked; dash(); };
    $('#main').querySelectorAll('th[data-c]').forEach(th => th.onclick = () => {
      const k = state.view + '|' + th.dataset.t, cur = state.sort[k];
      state.sort[k] = { c: Number(th.dataset.c), up: cur && cur.c === Number(th.dataset.c) ? !cur.up : false }; dash();
    });
    $('#main').querySelectorAll('.lg input').forEach(cb => cb.onchange = () => { state.hide[cb.dataset.k] = !cb.checked; dash(); });
    $('#main').querySelectorAll('.mb span').forEach(sp => {
      sp.onmouseenter = () => { tip.textContent = sp.dataset.tip; tip.hidden = false; };
      sp.onmouseleave = () => { tip.hidden = true; };
    });
  }
  // Rows grouped with their sub-rows (Office / Factory) so sorting keeps them together; Total stays last.
  function groups(t) {
    const g = []; let cur = null; let total = null;
    t.rows.forEach((r, i) => { const st = (t.styles || [])[i] || '';
      if (st === 'total') total = r; else if (st === 'sub' && cur) cur.subs.push(r); else { cur = { r, subs: [] }; g.push(cur); } });
    return { g, total };
  }
  function matrix(t, ti) {
    const key = state.view + '|' + ti, s = state.sort[key];
    const { g, total } = groups(t);
    if (s) g.sort((a, b) => { const x = a.r[s.c], y = b.r[s.c]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return s.up ? c : -c; });
    const mixCols = t.mix && t.headers.length > 2 ? t.headers.slice(2) : [];
    const hidden = (j) => state.hide[ti + ':' + j];
    let h = '<section class="card"><div class="ch"><h2>' + esc(t.title) + (t.note ? '<span class="note">' + esc(t.note) + '</span>' : '') + '</h2>'
      + (mixCols.length ? '<div class="lg">' + mixCols.map((c, j) => '<label title="Show / hide in the bar"><input type="checkbox" data-k="' + ti + ':' + j + '"' + (hidden(j) ? '' : ' checked') + ' hidden><i style="background:#' + t.colors[j] + ';opacity:' + (hidden(j) ? .25 : 1) + '"></i>' + esc(c) + '</label>').join('') + '</div>' : '') + '</div>';
    h += '<div class="scroll" style="max-height:none"><table><thead><tr>' + t.headers.map((c, j) => '<th data-t="' + ti + '" data-c="' + j + '" class="' + (s && s.c === j ? 's' + (s.up ? ' up' : '') : '') + '">' + esc(c) + '</th>').join('')
      + (mixCols.length ? '<th style="cursor:default">Mix</th>' : '') + '</tr></thead><tbody>';
    const row = (r, cls) => {
      const tot = Number(r[1]) || 0, parts = r.slice(2).map(Number);
      const mixTot = parts.reduce((a, b, j) => a + (hidden(j) ? 0 : (b || 0)), 0);
      let tr = '<tr class="' + cls + '">' + r.map((v, j) => {
        if (j === 0) return '<td>' + esc(v) + '</td>';
        if (j === 1) return '<td class="t">' + fmt(v) + '</td>';
        const z = mixCols.length > 0 && Number(v) === 0;   // grey zeros only in count tables
        return '<td class="' + (z ? 'z' : '') + '">' + (state.pct && tot ? (Math.round(v / tot * 1000) / 10) + '%' : fmt(v)) + '</td>';
      }).join('');
      if (mixCols.length) tr += '<td class="mix"><div class="mb">' + parts.map((v, j) => (!v || hidden(j)) ? '' :
        '<span style="width:' + (v / mixTot * 100) + '%;background:#' + t.colors[j] + '" data-tip="' + esc(r[0]) + ' · ' + esc(mixCols[j]) + ': ' + v.toLocaleString() + ' (' + Math.round(v / (tot || mixTot) * 100) + '%)"></span>').join('') + '</div></td>';
      return tr + '</tr>';
    };
    g.forEach(x => { h += row(x.r, 'main'); x.subs.forEach(sr => { h += row(sr, 'sub'); }); });
    if (total) h += row(total, 'tot');
    return h + '</tbody></table></div></section>';
  }
  function simple(t) {
    const max = Math.max(1, ...t.rows.map(r => Number(r[1]) || 0));
    return '<section class="card"><div class="ch"><h2>' + esc(t.title) + '</h2></div><table><tbody>' + t.rows.map(r => '<tr><td>' + esc(r[0]) + '</td><td class="t">' + fmt(r[1]) + '</td><td class="mix"><div class="mb"><span style="width:' + ((Number(r[1]) || 0) / max * 100) + '%;background:#1a56db"></span></div></td></tr>').join('') + '</tbody></table></section>';
  }

  // ── Data sheets ──
  function sheet(i) {
    const S = R.sheets[i];
    const st = state.data[i] || (state.data[i] = { q: '', sort: null, up: false, page: 0, size: 50, country: '' });
    const cIdx = S.cols.findIndex(c => /^country$/i.test(c));
    const countries = cIdx >= 0 ? [...new Set(S.rows.map(r => r[cIdx]).filter(Boolean))].sort() : [];
    const q = st.q.trim().toLowerCase();
    let rows = S.rows.filter(r => (!st.country || r[cIdx] === st.country) && (!q || r.some(v => String(v).toLowerCase().includes(q))));
    if (st.sort != null) { const c = st.sort; rows = rows.slice().sort((a, b) => { const x = a[c], y = b[c];
      const n = (x !== '' && y !== '' && !isNaN(x) && !isNaN(y)) ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return st.up ? n : -n; }); }
    const pages = Math.max(1, Math.ceil(rows.length / st.size)); if (st.page >= pages) st.page = pages - 1;
    const shown = rows.slice(st.page * st.size, (st.page + 1) * st.size);
    const hl = (v) => { const s = esc(v); if (!q) return s; const i2 = s.toLowerCase().indexOf(esc(q)); return i2 < 0 ? s : s.slice(0, i2) + '<mark>' + s.slice(i2, i2 + esc(q).length) + '</mark>' + s.slice(i2 + esc(q).length); };
    let h = '<div class="data"><div class="bar"><input type="search" id="q" placeholder="Search all columns…" value="' + esc(st.q) + '">'
      + (countries.length > 1 ? '<select id="cty"><option value="">All countries</option>' + countries.map(c => '<option' + (c === st.country ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' : '')
      + '<select id="size">' + [50, 100, 500].map(n => '<option' + (n === st.size ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>'
      + '<button class="btn" id="csv" title="Download the rows you see (search / filter / sort) as CSV">⬇ CSV (' + rows.length.toLocaleString() + ')</button></div>'
      + '<section class="card"><div class="scroll"><table><thead><tr>' + S.cols.map((c, j) => '<th data-j="' + j + '" class="' + (st.sort === j ? 's' + (st.up ? ' up' : '') : '') + '">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>'
      + (shown.length ? shown.map(r => '<tr>' + r.map(v => '<td title="' + esc(v) + '">' + hl(v) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + S.cols.length + '" style="text-align:center;color:#94a3b8;padding:30px">No rows</td></tr>')
      + '</tbody></table></div><div class="pager">' + rows.length.toLocaleString() + ' of ' + S.rows.length.toLocaleString() + ' rows · page ' + (st.page + 1) + ' of ' + pages
      + ' <button class="btn" id="prev"' + (st.page ? '' : ' disabled') + '>‹</button><button class="btn" id="next"' + (st.page < pages - 1 ? '' : ' disabled') + '>›</button></div></section></div>';
    $('#main').innerHTML = h;
    const qi = $('#q'); let tmr;
    qi.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = qi.value; st.page = 0; sheet(i); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); };
    if ($('#cty')) $('#cty').onchange = (e) => { st.country = e.target.value; st.page = 0; sheet(i); };
    $('#size').onchange = (e) => { st.size = Number(e.target.value); st.page = 0; sheet(i); };
    $('#prev').onclick = () => { st.page--; sheet(i); }; $('#next').onclick = () => { st.page++; sheet(i); };
    $('#main').querySelectorAll('th[data-j]').forEach(th => th.onclick = () => { const j = Number(th.dataset.j); st.up = st.sort === j ? !st.up : false; st.sort = j; sheet(i); });
    $('#csv').onclick = () => {
      const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = '﻿' + [S.cols, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = R.name + '-' + S.name.replace(/[^\w-]+/g, '_') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }
  render();
})();
`;

module.exports = { buildHtmlReport };
