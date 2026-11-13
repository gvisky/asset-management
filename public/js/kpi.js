/* 📈 KPIs — split by country (routes/kpi.js). */

const kEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let kData = null;

const KPIS = [
  { key: 'ghost', title: 'Ghost assets', unit: '%', lowerBetter: true, good: (v) => v <= 1, warn: (v) => v <= 5,
    target: 'target 0 %', help: 'Registered but not found in the latest closed stocktake (and still on the register). Typical first audits find 15–30 %.',
    detail: (x) => x.value == null ? kEsc(x.note || 'no stocktake yet') + ' · <a href="/stocktake.html">start one →</a>'
      : `${x.missing} of ${x.expected} not found · ${x.audits.map(a => `<a href="/stocktake.html#${a.id}">${kEsc(a.site || 'whole country')} ${kEsc(String(a.closed_at).slice(0, 10))}</a>`).join(' · ')}` },
  { key: 'repair', title: 'Repair time', unit: ' days', lowerBetter: true, good: (v) => v <= 5, warn: (v) => v <= 10,
    target: 'average · last 12 months', help: 'Days from "repair reported" to "done" in the Maintenance log (assets).',
    detail: (x) => `${x.done} repairs done · <a href="/maintenance.html">${x.open} open →</a>` },
  { key: 'recovery', title: 'Leaver recovery', unit: '%', good: (v) => v >= 95, warn: (v) => v >= 80,
    target: 'returned ≤ 7 days · target 95 %', help: 'Assets of leavers returned within 7 days after the leaving date (Leavers checklist).',
    detail: (x) => x.due ? `${x.onTime} of ${x.due} on time${x.late ? ` · ${x.late} late` : ''}${x.open ? ` · <b style="color:#dc2626">${x.open} not back</b>` : ''} · <a href="/leavers.html">Leavers →</a>` : 'no leaver assets due yet · <a href="/leavers.html">Leavers →</a>' },
];

function color(k, v) { if (v == null) return '#94a3b8'; return k.good(v) ? '#16a34a' : k.warn(v) ? '#d97706' : '#dc2626'; }
function spark(trend, key, c) {
  const pts = trend.map(t => t[key]).filter(v => v != null);
  if (pts.length < 2) return '';
  const max = Math.max(...pts), min = Math.min(...pts), span = max - min || 1;
  const p = pts.map((v, i) => `${(i / (pts.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(' ');
  return `<svg class="k-spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline fill="none" stroke="${c}" stroke-width="2" points="${p}"/></svg>`;
}
const money = (n, cur) => { const v = Number(n) || 0; const s = v >= 1e9 ? (v / 1e9).toFixed(2) + ' bn' : v >= 1e6 ? (v / 1e6).toFixed(1) + ' M' : v.toLocaleString('en-US'); return `${s} ${kEsc(cur)}`; };

function render() {
  const d = kData;
  if (!d.countries.length) { document.getElementById('kpi-main').innerHTML = '<p class="text-muted">No assets in your countries.</p>'; return; }
  let h = utilisationHtml(d) + dataQualityHtml(d);
  for (const k of KPIS) {
    h += `<section class="card k-sec"><div class="card-header"><span class="card-title">${k.title} <span class="text-muted text-sm" style="font-weight:400">· ${k.target}</span></span>
      <span class="text-muted text-sm" title="${kEsc(k.help)}">ⓘ ${kEsc(k.help)}</span></div><div class="k-grid">`;
    for (const c of d.countries) {
      const x = d.per[c][k.key] || {}; const v = x.value; const col = color(k, v);
      h += `<div class="k-tile" style="--c:${col}"><div class="k-c">${kEsc(c)}</div>
        <div class="k-v">${v == null ? '—' : v + k.unit}</div>
        ${spark(d.per[c].trend || [], k.key, col)}
        <div class="text-sm k-d">${k.detail(x)}</div></div>`;
    }
    h += '</div></section>';
  }
  // Depreciation
  h += `<section class="card k-sec"><div class="card-header"><span class="card-title">Depreciation <span class="text-muted text-sm" style="font-weight:400">· straight-line from purchase date</span></span>
    <span class="text-muted text-sm">Vietnam: Circular 45/2013 Annex 1 allows 3–8 years for IT / electronic management equipment — company rule ${kEsc(d.depreciationYears.Vietnam || d.depreciationYears.default)} years</span></div>
    <div class="table-wrap"><table><thead><tr><th>Country</th><th>Years</th><th style="text-align:right">Cost</th><th style="text-align:right">Book value</th><th style="text-align:right">Fully depreciated</th><th style="text-align:right">…still Active</th><th style="text-align:right">Ends in 12 months</th><th style="text-align:right">No cost / date</th></tr></thead><tbody>
    ${d.countries.map(c => { const x = d.per[c].depreciation; const cur = Object.entries(x.sums);
      return `<tr><td><b>${kEsc(c)}</b></td><td>${x.years}</td>
        <td style="text-align:right">${cur.map(([k, s]) => money(s.cost, k)).join('<br>') || '—'}</td>
        <td style="text-align:right"><b>${cur.map(([k, s]) => money(s.book, k)).join('<br>') || '—'}</b>${cur.length ? `<div class="text-muted text-sm">${cur.map(([, s]) => Math.round(s.book / (s.cost || 1) * 100) + '% left').join(' · ')}</div>` : ''}</td>
        <td style="text-align:right">${x.fully}</td><td style="text-align:right"><b style="color:${x.fullyActive ? '#d97706' : 'inherit'}">${x.fullyActive}</b></td>
        <td style="text-align:right">${x.ending12}</td><td style="text-align:right" class="text-muted">${x.without}</td></tr>`; }).join('')}
    </tbody></table></div><p class="text-muted text-sm" style="padding:0 18px 12px">"Fully depreciated but still Active" = book value 0, still in use → refresh candidates. Each asset's book value is in its detail view (Asset Inventory).</p></section>`;
  document.getElementById('kpi-main').innerHTML = h;
}

// Utilisation per asset type × country — each type has its own purpose, so no combined figure.
function utilisationHtml(d) {
  const uColor = (v) => (v == null ? '#94a3b8' : v >= 85 ? '#16a34a' : v >= 75 ? '#d97706' : '#dc2626');
  const cell = (x) => {
    if (!x) return '<td class="k-u k-u-none">—</td>';
    const w = (n) => (x.total ? (n / x.total) * 100 : 0);
    return `<td class="k-u" title="${x.active} active · ${x.stock} stock · ${x.broken} broken${x.other ? ' · ' + x.other + ' other' : ''} · ${x.total} total">
      <b style="color:${uColor(x.value)}">${x.value}%</b> <span class="text-muted text-sm">${x.active}/${x.total}</span>
      <div class="k-mix"><i style="width:${w(x.active)}%;background:#16a34a"></i><i style="width:${w(x.stock)}%;background:#d97706"></i><i style="width:${w(x.broken)}%;background:#dc2626"></i><i style="width:${w(x.other)}%;background:#94a3b8"></i></div></td>`;
  };
  return `<section class="card k-sec"><div class="card-header"><span class="card-title">Utilisation by asset type <span class="text-muted text-sm" style="font-weight:400">· target 85–90 %</span></span>
    <span class="text-muted text-sm">ⓘ Active ÷ assets of that type, per country — types have different purposes, so they are not added together.
      <span class="k-lg"><i style="background:#16a34a"></i>Active <i style="background:#d97706"></i>Stock <i style="background:#dc2626"></i>Broken</span></span></div>
    <div class="table-wrap"><table class="k-ut"><thead><tr><th>Asset type</th>${d.countries.map(c => `<th>${kEsc(c)}</th>`).join('')}</tr></thead><tbody>
    ${d.utilisation.map(r => `<tr><td><b>${kEsc(r.type)}</b> <span class="text-muted text-sm">${r.total}</span></td>${d.countries.map(c => cell(r.byCountry[c])).join('')}</tr>`).join('')}
    </tbody></table></div></section>`;
}

// Data quality per asset type × country (same rule as Needs Attention).
function dataQualityHtml(d) {
  const qColor = (v) => (v == null ? '#94a3b8' : v >= 98 ? '#16a34a' : v >= 90 ? '#d97706' : '#dc2626');
  const cell = (x) => {
    if (!x) return '<td class="k-u k-u-none">—</td>';
    const why = [x.noSerial && `${x.noSerial} no serial`, x.noCode && `${x.noCode} no asset code`, x.noPcAd && `${x.noPcAd} no PC No / AD Name`, x.dup && `${x.dup} duplicate serial`].filter(Boolean).join(' · ');
    return `<td class="k-u" title="${kEsc(why || 'all complete')}"><b style="color:${qColor(x.value)}">${x.value}%</b> <span class="text-muted text-sm">${x.complete}/${x.checked}</span>
      <div class="k-mix"><i style="width:${x.checked ? x.complete / x.checked * 100 : 0}%;background:#16a34a"></i><i style="width:${x.checked ? x.missing / x.checked * 100 : 0}%;background:#dc2626"></i></div>
      ${x.missing ? `<div class="text-sm k-why">${kEsc(why)}</div>` : ''}</td>`;
  };
  return `<section class="card k-sec"><div class="card-header"><span class="card-title">Data quality by asset type <span class="text-muted text-sm" style="font-weight:400">· target 98 %</span></span>
    <span class="text-muted text-sm">ⓘ Assets with no missing info — serial, asset code, PC No / AD Name for laptops &amp; desktops, no duplicate serial (same rule as <a href="/alerts.html">Needs Attention</a>).
      Not checked: ${kEsc((d.exemptTypes || []).join(', '))}.
      <span class="k-lg"><i style="background:#16a34a"></i>Complete <i style="background:#dc2626"></i>Needs info</span></span></div>
    <div class="table-wrap"><table class="k-ut"><thead><tr><th>Asset type</th>${d.countries.map(c => `<th>${kEsc(c)}</th>`).join('')}</tr></thead><tbody>
    ${d.dataQuality.map(r => `<tr><td><b>${kEsc(r.type)}</b> <span class="text-muted text-sm">${r.total}</span></td>${d.countries.map(c => cell(r.byCountry[c])).join('')}</tr>`).join('')}
    </tbody></table></div></section>`;
}

async function load() {
  try { kData = await apiGet('/api/kpi'); } catch { document.getElementById('kpi-main').innerHTML = '<p class="text-muted">Could not load.</p>'; return; }
  document.getElementById('kpi-dep-btn').style.display = kData.canEditYears ? '' : 'none';
  render();
}

async function editYears() {
  const y = kData.depreciationYears;
  const txt = prompt('Depreciation years per country (straight-line). Format: default=5, Vietnam=5, Thailand=5, Malaysia=5',
    Object.entries(y).map(([k, v]) => `${k}=${v}`).join(', '));
  if (txt == null) return;
  const body = {};
  for (const part of txt.split(',')) { const [k, v] = part.split('=').map(s => (s || '').trim()); if (k && v) body[k] = Number(v); }
  try { await apiPut('/api/kpi/depreciation-years', body); showToast('Depreciation years saved'); load(); }
  catch (e) { let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => { document.getElementById('kpi-dep-btn').addEventListener('click', editYears); load(); });
