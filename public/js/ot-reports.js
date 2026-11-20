/* 📊 OT Reports (/ot-reports.html, routes/ot-reports.js): pick a report, see its key numbers, tables and data on the page,
   download it as Excel (dashboard with charts + data sheets) or PDF. OT team and IT. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const KPI = { blue: '#1a56db', green: '#16a34a', amber: '#d97706', red: '#dc2626', purple: '#7c3aed', grey: '#475569', teal: '#0891b2' };
  const SERIES = ['#2563eb', '#16a34a', '#94a3b8', '#d97706'];
  let list = [], cur = null, rep = null, sheet = 0, q = '';

  async function init() {
    try { list = (await apiGet('/api/ot-reports')).reports; }
    catch (e) { $('otr-root').innerHTML = `<p class="text-muted">${esc(e.message || 'Could not load')}</p>`; return; }
    const want = new URLSearchParams(location.search).get('r');
    open(list.some(r => r.key === want) ? want : list[0].key);
  }
  async function open(key) {
    cur = key; sheet = 0; q = ''; rep = null; render();
    const u = new URL(location.href); u.searchParams.set('r', key); history.replaceState(null, '', u);
    try { rep = await apiGet('/api/ot-reports/' + key); } catch (e) { rep = { error: e.message || 'Could not load' }; }
    render();
  }
  // A table of the dashboard: label, value(s) and a bar per value (several values → a stacked bar).
  function table(t) {
    const n = t.headers.length - 1, max = Math.max(1, ...t.rows.map(r => r.slice(1).reduce((s, v) => s + (Number(v) || 0), 0)));
    return `<div class="card otr-t"><div class="card-header"><b>${esc(t.title)}</b></div><div class="card-body">
      ${n > 1 ? `<div class="otr-leg">${t.headers.slice(1).map((h, i) => `<span><i style="background:${SERIES[i % SERIES.length]}"></i>${esc(h)}</span>`).join('')}</div>` : ''}
      ${t.rows.length ? t.rows.map(r => { const tot = r.slice(1).reduce((s, v) => s + (Number(v) || 0), 0);
        return `<div class="otr-r"><span class="otr-l" title="${esc(r[0])}">${esc(r[0])}</span><span class="otr-bar">${r.slice(1).map((v, i) => `<i style="width:${(Number(v) || 0) / max * 100}%;background:${SERIES[i % SERIES.length]}" title="${esc(t.headers[i + 1])}: ${esc(v)}"></i>`).join('')}</span><b>${n > 1 ? r.slice(1).join(' · ') : tot}</b></div>`; }).join('')
        : '<p class="text-muted text-sm">No data.</p>'}</div></div>`;
  }
  function render() {
    const r = list.find(x => x.key === cur) || {};
    $('otr-sub').textContent = rep && rep.dashboard ? `· ${rep.dashboard.subtitle}` : '';
    const d = rep && rep.dashboard, s = rep && rep.sheets && rep.sheets[sheet];
    const rows = s ? s.rows.filter(x => !q || Object.values(x).join(' ').toLowerCase().includes(q)) : [];
    const cols = s && s.rows.length ? Object.keys(s.rows[0]) : [];
    $('otr-root').innerHTML = `<div class="otr-list">${list.map(x => `<button class="otr-card${x.key === cur ? ' on' : ''}" data-k="${x.key}"><span>${x.icon}</span><b>${esc(x.title)}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>
      <div class="card" style="margin-top:14px"><div class="card-header" style="flex-wrap:wrap;gap:8px"><b style="font-size:16px">${r.icon || ''} ${esc(r.title || '')}</b><span style="flex:1"></span>
        <a class="btn btn-sm rep-xlsx" href="/api/ot-reports/${cur}.xlsx" download title="Dashboard with charts + data sheets">📊 Excel</a>
        <a class="btn btn-sm rep-pdf" href="/api/ot-reports/${cur}.pdf" download title="Dashboard with charts">📄 PDF</a></div>
      <div class="card-body">${!rep ? '<p class="text-muted">Loading…</p>' : rep.error ? `<p class="text-muted">${esc(rep.error)}</p>` : `
        <div class="otr-kpis">${d.kpis.map(k => `<div class="otr-kpi" style="--c:${KPI[k.color] || KPI.blue}"><b>${esc(k.value)}</b><small>${esc(k.label)}</small></div>`).join('')}</div>
        <div class="otr-tables">${d.tables.map(table).join('')}</div>
        <div class="otr-sheet"><span class="nm-tabs small">${rep.sheets.map((x, i) => `<button class="${i === sheet ? 'on' : ''}" data-s="${i}">${esc(x.name)} (${x.total})</button>`).join('')}</span>
          <input class="form-control" id="otr-q" placeholder="Search…" value="${esc(q)}" style="max-width:240px;display:inline-block;margin-left:8px">
          ${s && s.total > s.rows.length ? `<span class="text-muted text-sm"> · first ${s.rows.length} of ${s.total} on the page — all in the Excel file</span>` : ''}</div>
        <div class="table-wrap otr-data"><table class="nm-vt"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(x => `<tr>${cols.map(c => `<td class="text-sm">${esc(x[c])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length || 1}" class="empty-state">No rows.</td></tr>`}</tbody></table></div>`}
      </div></div>`;
    $('otr-root').querySelectorAll('.otr-card').forEach(b => { b.onclick = () => open(b.dataset.k); });
    $('otr-root').querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { sheet = Number(b.dataset.s); render(); }; });
    if ($('otr-q')) $('otr-q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; render(); $('otr-q').focus(); $('otr-q').setSelectionRange(p, p); };
  }
  document.addEventListener('DOMContentLoaded', init);
})();
