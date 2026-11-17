/* Budget Tracking page (IT admin only) — multi-year, per month, Opex/Capex
   split, grouped by PYP (WBS). All filtering/aggregation is client-side over
   /api/budget items (a few hundred lines). Parsing of corporate workbooks is
   done here with the shared BudgetCore (public/js/budget-core.js).

   Item: { id, country, year, kind, oc, status, …hierarchy, gl_no, gl_name,
           pyp_ecc(+_name) old ECC, pyp_s4(+_name) new S4,
           budget[12], actual[12], actual_months, comment, note } */

const C = window.BudgetCore;
const MON = C.MONTHS;
// Small SVG flags (Windows does not draw flag emoji — it shows "VN").
const svgFlag = (body, vb) => `<svg class="flag" viewBox="${vb}" width="18" height="12" aria-hidden="true">${body}</svg>`;
const COUNTRY_FLAG = {
  Vietnam: svgFlag('<rect width="30" height="20" fill="#da251d"/><polygon fill="#ff0" points="15,4 16.76,9.43 22.47,9.43 17.85,12.79 19.62,18.22 15,14.86 10.38,18.22 12.15,12.79 7.53,9.43 13.24,9.43"/>', '0 0 30 20'),
  Thailand: svgFlag('<rect width="9" height="6" fill="#a51931"/><rect y="1" width="9" height="4" fill="#f4f5f8"/><rect y="2" width="9" height="2" fill="#2d2a4a"/>', '0 0 9 6'),
  Malaysia: svgFlag('<rect width="28" height="14" fill="#fff"/>' + [0, 2, 4, 6, 8, 10, 12].map(y => `<rect y="${y}" width="28" height="1" fill="#cc0001"/>`).join('')
    + '<rect width="14" height="8" fill="#010066"/><circle cx="6" cy="4" r="3" fill="#fc0"/><circle cx="7" cy="4" r="2.5" fill="#010066"/><circle cx="10.5" cy="4" r="1.4" fill="#fc0"/>', '0 0 28 14'),
};
const KIND_LABEL = {
  approved: ['Approved budget', 'Onaylı bütçe'],
  report: ['B-F report', 'Bütçe-Fiili raporu'],
  legacy: ['budget 2026.xlsx (old)', 'eski dosya'],
};
const OCS = ['CAPEX', 'OPEX'];

let DATA = { items: [], glMap: {}, meta: { years: [], sources: [] } };
const st = Object.assign({ groups: ['pyp'], yoyDiff: false, yoyOpen: [], year: 0, country: '', period: 'fy', pyp: 's4', oc: '', q: '', group: 'pyp', cols: 'sum', ek: true, hideZero: false },
  (() => { try { return JSON.parse(localStorage.getItem('budget.v2') || '{}'); } catch (e) { return {}; } })());
if (!Array.isArray(st.groups)) st.groups = st.group && st.group !== 'none' ? [st.group] : [];
delete st.group; delete st.sel;
const save = () => { try { localStorage.setItem('budget.v2', JSON.stringify(st)); } catch (e) {} };

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EN = (s) => C.tr(s);
const bi = (s) => s ? esc(s) + (EN(s) ? `<span class="en">${esc(EN(s))}</span>` : '') : '<span class="text-muted">—</span>';
const biInline = (s) => s ? esc(s) + (EN(s) ? ` <span class="en-inline">(${esc(EN(s))})</span>` : '') : '';
const USD = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US'); };
const USDk = (n) => { const v = Number(n) || 0, a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : Math.round(a); return (v < 0 ? '−$' : '$') + s; };
const cls = (v) => (v < -0.5 ? 'neg' : v > 0.5 ? 'pos' : '');
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const r2 = C.r2;
// FİİLİ_EK: in a B-F report = actual booked with no budget line; in an approved
// budget = a new budget line derived from last year's actuals ("Yeni Türetme").
const isEK = (it) => /FIILI/i.test(C.fold(it.status)) && it.kind !== 'approved';
const isDerived = (it) => /FIILI/i.test(C.fold(it.status)) && it.kind === 'approved';
const pypCode = (it) => (st.pyp === 'ecc' ? it.pyp_ecc : it.pyp_s4) || '';
const pypName = (it) => (st.pyp === 'ecc' ? it.pyp_ecc_name : it.pyp_s4_name) || '';
const otherPyp = (it) => (st.pyp === 'ecc' ? it.pyp_s4 : it.pyp_ecc) || '';
const ocTag = (oc) => `<span class="oc oc-${esc(oc)}">${esc(oc)}</span>`;

// Months of the selected period → [from, to] inclusive.
function periodRange(p) {
  if (p === 'fy' || !p) return [0, 11];
  if (p === 'ytd') return [0, Math.max(0, yearActualMonths() - 1)];
  let m;
  if ((m = p.match(/^q([1-4])$/))) return [(m[1] - 1) * 3, (m[1] - 1) * 3 + 2];
  if ((m = p.match(/^m(\d+)$/))) return [+m[1], +m[1]];
  return [0, 11];
}
function periodLabel(p) {
  const [a, b] = periodRange(p);
  if (p === 'fy') return `Full year ${st.year}`;
  return a === b ? `${MON[a]} ${st.year}` : `${MON[a]}–${MON[b]} ${st.year}`;
}

// Metrics of one item over months [a..b].
function metrics(it, a, b) {
  let B = 0, A = 0, F = 0;
  for (let k = a; k <= b; k++) {
    B += it.budget[k] || 0;
    if (k < it.actual_months) A += it.actual[k] || 0; else F += it.actual[k] || 0;
  }
  return { B, A, F, AF: A + F, V: B - (A + F) };
}
function addM(t, m) { t.B += m.B; t.A += m.A; t.F += m.F; t.AF += m.AF; t.V += m.V; return t; }
const zeroM = () => ({ B: 0, A: 0, F: 0, AF: 0, V: 0 });

// ── filtering ────────────────────────────────────────────────────────────────
function matchesQuery(it, q) {
  if (!q) return true;
  const hay = [it.country, it.status, it.company, it.proj_group, it.proj_category, it.program, it.project, it.sub_project,
    it.oc, it.gl_no, it.gl_name, DATA.glMap[it.gl_no] || '', it.cc_no, it.cc_name, it.proje_no, it.proje_name,
    it.pyp_ecc, it.pyp_ecc_name, it.pyp_s4, it.pyp_s4_name, it.comment, it.note];
  const s = hay.map(v => C.fold(v) + ' ' + C.fold(EN(v))).join(' ').toLowerCase();
  return C.fold(q).toLowerCase().split(/\s+/).filter(Boolean).every(w => s.includes(w));
}
// Filter ignoring year (for YoY) or for the selected year.
function baseFilter(it) {
  return (!st.country || it.country === st.country) && (!st.oc || it.oc === st.oc) && (st.ek || !isEK(it)) && matchesQuery(it, st.q);
}
const yearItems = () => DATA.items.filter(it => it.year === st.year && baseFilter(it));
function yearActualMonths() {
  const list = DATA.items.filter(it => it.year === st.year && (!st.country || it.country === st.country));
  return Math.max(0, ...list.map(i => i.actual_months));
}
const yearHasActuals = () => DATA.items.some(it => it.year === st.year && (!st.country || it.country === st.country) && it.actual.some(v => v));

// ── toolbar ──────────────────────────────────────────────────────────────────
function seg(id, options, current, onPick) {
  const el = document.getElementById(id);
  if (options) el.innerHTML = options.map(o => `<button data-v="${esc(o.v)}"${o.disabled ? ' disabled' : ''} title="${esc(o.title || '')}">${o.label}</button>`).join('');
  el.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === String(current));
    b.onclick = () => { if (!b.disabled) onPick(b.dataset.v); };
  });
}
function buildToolbar() {
  const years = DATA.meta.years || [];
  seg('seg-year', years.map(y => ({ v: String(y), label: String(y) })), String(st.year), v => { st.year = +v; if (!validPeriod()) st.period = 'fy'; renderAll(); });
  const have = (c) => DATA.items.some(i => i.year === st.year && i.country === c);
  seg('seg-country', [{ v: '', label: 'All' }].concat(C.COUNTRIES.map(c => ({ v: c, label: `${COUNTRY_FLAG[c]} ${c}`, title: have(c) ? '' : `No ${st.year} data for ${c}` }))),
    st.country, v => { st.country = v; renderAll(); });
  seg('seg-pyp', null, st.pyp, v => { st.pyp = v; renderAll(); });
  seg('seg-oc', null, st.oc, v => { st.oc = v; renderAll(); });
  // Grouping: toggle buttons, several at once (nested in the order switched on).
  const gEl = document.getElementById('seg-group');
  gEl.innerHTML = Object.keys(GROUP_DIMS).map(d => { const i = st.groups.indexOf(d); return `<button data-v="${d}" class="${i >= 0 ? 'on' : ''}" title="Click to ${i >= 0 ? 'remove' : 'add'} this grouping">${i >= 0 ? `<span class="gnum">${i + 1}</span>` : '+ '}${GROUP_DIMS[d]}</button>`; }).join('')
    + `<button data-v="" class="${st.groups.length ? '' : 'on'}">No grouping</button>`;
  gEl.querySelectorAll('button').forEach(btn => btn.onclick = () => {
    const d = btn.dataset.v;
    if (!d) st.groups = [];
    else st.groups = st.groups.includes(d) ? st.groups.filter(x => x !== d) : st.groups.concat(d);
    renderAll();
  });
  seg('seg-cols', null, st.cols, v => { st.cols = v; renderAll(); });
  const am = yearActualMonths();
  const opts = [['fy', `Full year ${st.year}`]];
  if (am > 0 && am < 12) opts.push(['ytd', `YTD actual (Jan–${MON[am - 1]})`]);
  [1, 2, 3, 4].forEach(q => opts.push(['q' + q, `Q${q} (${MON[(q - 1) * 3]}–${MON[(q - 1) * 3 + 2]})`]));
  MON.forEach((m, i) => opts.push(['m' + i, `${m} ${st.year}${am ? (i < am ? ' · actual' : ' · forecast') : ''}`]));
  const sel = document.getElementById('f-period');
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  sel.value = st.period;
  document.getElementById('f-ek').checked = st.ek;
  document.getElementById('f-zero').checked = st.hideZero;
}
function validPeriod() { return st.period !== 'ytd' || (yearActualMonths() > 0 && yearActualMonths() < 12); }

// ── source strip ─────────────────────────────────────────────────────────────
function renderSources() {
  const src = DATA.meta.sources || [];
  const html = C.COUNTRIES.filter(c => !st.country || c === st.country).map(c => {
    const s = src.find(x => x.country === c && x.year === st.year);
    if (!s) return `<span class="src-pill none">${COUNTRY_FLAG[c]} <b>${c} ${st.year}</b> · no data loaded</span>`;
    const k = KIND_LABEL[s.kind] || [s.kind, ''];
    const act = s.actual_months ? ` · actual Jan–${MON[s.actual_months - 1]}${s.actual_months < 12 ? `, forecast ${MON[s.actual_months]}–Dec` : ''}` : '';
    return `<span class="src-pill ${esc(s.kind)}" title="${esc(s.source_file)} · imported ${esc((s.imported_at || '').slice(0, 10))}">${COUNTRY_FLAG[c]} <b>${c} ${st.year}</b> · ${esc(k[0])}${act} · ${s.lines} lines</span>`;
  }).join('');
  document.getElementById('src-strip').innerHTML = html;
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
function renderKpis(items, a, b) {
  const by = { OPEX: zeroM(), CAPEX: zeroM() }, t = zeroM();
  items.forEach(it => { const m = metrics(it, a, b); addM(by[it.oc] || by.OPEX, m); addM(t, m); });
  const split = (f) => `<div class="s"><span>OPEX <b>${USDk(by.OPEX[f])}</b></span><span>CAPEX <b>${USDk(by.CAPEX[f])}</b></span></div>`;
  const card = (label, en, val, color, f, extra) => `<div class="bk" style="--c:${color}"><div class="l">${label} <span class="en-inline">· ${en}</span></div><div class="v ${extra || ''}">${val}</div>${f ? split(f) : ''}</div>`;
  const P = periodLabel(st.period);
  let html;
  if (yearHasActuals()) {
    const used = pct(t.AF, t.B);
    html = card('Budget', 'Bütçe', USD(t.B), '#3b82f6', 'B')
      + card('Actual', 'Fiili', USD(t.A), '#f59e0b', 'A')
      + card('Forecast', 'Tahmin', USD(t.F), '#a855f7', 'F')
      + card('Actual + Forecast', 'Fiili + Tahmin', USD(t.AF), '#0ea5e9', 'AF')
      + card('Remaining (B − A+F)', 'Fark', USD(t.V), t.V < 0 ? '#dc2626' : '#16a34a', 'V', cls(t.V))
        .replace('</div></div>', `</div><div class="s"><span>Used <b>${used}%</b> of budget</span></div></div>`);
  } else {
    // Budget-only year (e.g. newly approved 2027): compare with prior year A+F.
    const prev = DATA.items.filter(it => it.year === st.year - 1 && baseFilter(it));
    const pv = { OPEX: 0, CAPEX: 0, T: 0 };
    prev.forEach(it => { const m = metrics(it, a, b); pv[it.oc] = (pv[it.oc] || 0) + m.AF; pv.T += m.AF; });
    const d = t.B - pv.T;
    html = card('Budget', 'Bütçe', USD(t.B), '#3b82f6', 'B')
      + card('OPEX budget', 'Opex', USD(by.OPEX.B), '#0ea5e9')
      + card('CAPEX budget', 'Capex', USD(by.CAPEX.B), '#7c3aed')
      + card(`${st.year - 1} Actual + Forecast`, 'önceki yıl', prev.length ? USD(pv.T) : '—', '#94a3b8')
      + card(`Change vs ${st.year - 1} A+F`, 'Fark', prev.length ? (d >= 0 ? '+' : '') + USD(d) : '—', '#f59e0b', null, '')
        .replace('</div></div>', prev.length ? `</div><div class="s"><span>OPEX <b>${USDk(by.OPEX.B - pv.OPEX)}</b></span><span>CAPEX <b>${USDk(by.CAPEX.B - pv.CAPEX)}</b></span></div></div>` : '</div></div>');
  }
  document.getElementById('kpis').innerHTML = html;
  document.getElementById('sum-hint').textContent = `${P} · USD · ${items.length} lines`;
}

// ── Opex / Capex × country ───────────────────────────────────────────────────
function renderSummary(items, a, b) {
  const hasA = yearHasActuals();
  const countries = C.COUNTRIES.filter(c => (!st.country || c === st.country));
  const ocs = OCS.filter(o => !st.oc || o === st.oc);
  const cell = (m) => hasA
    ? `<td class="num">${USD(m.B)}</td><td class="num">${USD(m.AF)}</td><td class="num ${cls(m.V)}">${USD(m.V)}</td>`
    : `<td class="num">${USD(m.B)}</td>`;
  const sub = hasA ? '<th class="num">Budget</th><th class="num">A+F</th><th class="num">Var.</th>' : '<th class="num">Budget</th>';
  let h = `<thead><tr><th rowspan="2">Country · Ülke</th>${ocs.map(o => `<th colspan="${hasA ? 3 : 1}" style="text-align:center">${ocTag(o)}</th>`).join('')}<th colspan="${hasA ? 4 : 1}" style="text-align:center">Total · Toplam</th></tr>`
    + `<tr>${ocs.map(() => sub).join('')}${sub}${hasA ? '<th class="num">Used</th>' : ''}</tr></thead><tbody>`;
  const grand = { OPEX: zeroM(), CAPEX: zeroM(), T: zeroM() };
  countries.forEach(c => {
    const ci = items.filter(i => i.country === c);
    const m = { OPEX: zeroM(), CAPEX: zeroM(), T: zeroM() };
    ci.forEach(it => { const x = metrics(it, a, b); addM(m[it.oc], x); addM(m.T, x); addM(grand[it.oc], x); addM(grand.T, x); });
    h += `<tr><td><b>${COUNTRY_FLAG[c]} ${c}</b>${ci.length ? '' : ' <span class="hint">no data</span>'}</td>${ocs.map(o => cell(m[o])).join('')}${cell(m.T)}${hasA ? `<td class="num">${pct(m.T.AF, m.T.B)}%</td>` : ''}</tr>`;
  });
  if (countries.length > 1) h += `<tr style="border-top:2px solid #cbd5e1;font-weight:700"><td>Total</td>${ocs.map(o => cell(grand[o])).join('')}${cell(grand.T)}${hasA ? `<td class="num">${pct(grand.T.AF, grand.T.B)}%</td>` : ''}</tr>`;
  document.getElementById('sum-table').innerHTML = h + '</tbody>';
}

// ── Monthly grid + chart ─────────────────────────────────────────────────────
function renderMonthly(items, a, b) {
  const hasA = yearHasActuals();
  const am = yearActualMonths();
  const inP = (k) => k >= a && k <= b;
  const head = `<thead><tr><th></th>${MON.map((m, k) => `<th class="num ${hasA && k >= am ? 'fc' : ''} ${inP(k) && st.period !== 'fy' ? 'inp' : ''}">${m}${hasA ? `<span class="en">${k < am ? 'actual' : 'forecast'}</span>` : ''}</th>`).join('')}${st.period === 'fy' ? '' : '<th class="num">Period</th>'}<th class="num">Year</th></tr></thead>`;
  const series = (list) => {
    const B = Array(12).fill(0), AF = Array(12).fill(0);
    list.forEach(it => { for (let k = 0; k < 12; k++) { B[k] += it.budget[k] || 0; AF[k] += it.actual[k] || 0; } });
    return { B, AF };
  };
  const sumR = (arr, x, y) => arr.slice(x, y + 1).reduce((s, v) => s + v, 0);
  const row = (label, arr, opt) => {
    opt = opt || {};
    return `<tr class="${opt.cls || ''}"><td>${label}</td>${arr.map((v, k) => `<td class="num ${opt.fc && k >= am ? 'fc' : ''} ${inP(k) && st.period !== 'fy' ? 'inp' : ''} ${opt.var ? cls(v) : ''}">${Math.abs(v) < 0.5 ? '<span class="text-muted">–</span>' : USD(v)}</td>`).join('')}`
      + (st.period === 'fy' ? '' : `<td class="num ${opt.var ? cls(sumR(arr, a, b)) : ''}"><b>${opt.cum ? USD(arr[b]) : USD(sumR(arr, a, b))}</b></td>`)
      + `<td class="num ${opt.var && st.period === 'fy' ? cls(sumR(arr, 0, 11)) : ''}">${st.period === 'fy' ? '<b>' : ''}${opt.cum ? USD(arr[11]) : USD(sumR(arr, 0, 11))}${st.period === 'fy' ? '</b>' : ''}</td></tr>`;
  };
  let body = '';
  const ocs = OCS.filter(o => !st.oc || o === st.oc);
  ocs.forEach(o => {
    const s = series(items.filter(i => i.oc === o));
    body += `<tr class="sec"><td colspan="${st.period === 'fy' ? 14 : 15}">${ocTag(o)}</td></tr>` + row('Budget · Bütçe', s.B);
    if (hasA) body += row('Actual / Forecast · Fiili / Tahmin', s.AF, { fc: true }) + row('Variance · Fark', s.B.map((v, k) => v - s.AF[k]), { var: true });
  });
  const T = series(items);
  const cum = (arr) => arr.reduce((o, v, k) => (o.push((o[k - 1] || 0) + v), o), []);
  body += `<tr class="sec"><td colspan="${st.period === 'fy' ? 14 : 15}">Total · Toplam</td></tr>` + row('Budget', T.B, { cls: '' });
  if (hasA) body += row('Actual / Forecast', T.AF, { fc: true }) + row('Variance', T.B.map((v, k) => v - T.AF[k]), { var: true })
    + row('Cumulative budget', cum(T.B), { cum: true }) + row('Cumulative A+F', cum(T.AF), { cum: true, fc: true });
  document.getElementById('month-table').innerHTML = head + '<tbody>' + body + '</tbody>';
  document.getElementById('month-chart').innerHTML = barChart(T.B, hasA ? T.AF : null, am);
}
function barChart(B, AF, am) {
  const W = 900, H = 230, padL = 64, padB = 34, padT = 10, padR = 10;
  const max = Math.max(1, ...B, ...(AF || []).map(v => Math.max(0, v)));
  const plotH = H - padB - padT, gw = (W - padL - padR) / 12, bw = Math.min(26, gw / 3);
  const y = (v) => padT + plotH - (Math.max(0, v) / max) * plotH;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = max / 4 * i, yy = y(v); g += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e5e7eb"/><text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="10" fill="#64748b">${USDk(v)}</text>`; }
  MON.forEach((m, k) => {
    const cx = padL + gw * k + gw / 2;
    g += `<rect x="${AF ? cx - bw - 1 : cx - bw / 2}" y="${y(B[k])}" width="${bw}" height="${padT + plotH - y(B[k])}" fill="#3b82f6" rx="2"><title>${m} budget ${USD(B[k])}</title></rect>`;
    if (AF) {
      const fc = k >= am;
      g += `<rect x="${cx + 1}" y="${y(AF[k])}" width="${bw}" height="${padT + plotH - y(AF[k])}" fill="${fc ? '#fcd34d' : '#f59e0b'}" ${fc ? 'stroke="#f59e0b" stroke-dasharray="3 2"' : ''} rx="2"><title>${m} ${fc ? 'forecast' : 'actual'} ${USD(AF[k])}</title></rect>`;
    }
    g += `<text x="${cx}" y="${H - padB + 15}" text-anchor="middle" font-size="11" fill="#0f172a">${m}</text>`;
  });
  const lg = [['Budget', '#3b82f6']].concat(AF ? [['Actual', '#f59e0b'], ['Forecast', '#fcd34d']] : []);
  return `<div class="bdg-scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${g}</svg></div>`
    + `<div style="display:flex;gap:16px;font-size:12px;color:#475569;margin-top:4px">${lg.map(([t, c]) => `<span style="display:inline-flex;align-items:center;gap:5px"><i style="width:12px;height:12px;border-radius:3px;background:${c};display:inline-block"></i>${t}</span>`).join('')}</div>`;
}

// ── Year over year ───────────────────────────────────────────────────────────
function renderYoy() {
  const items = DATA.items.filter(baseFilter);
  const years = (DATA.meta.years || []).slice();
  const yHasA = {}; years.forEach(y => { yHasA[y] = items.some(i => i.year === y && i.actual.some(v => v)); });
  const countries = C.COUNTRIES.filter(c => !st.country || c === st.country);
  const ocs = OCS.filter(o => !st.oc || o === st.oc);
  const fy = (list) => list.reduce((t, it) => addM(t, metrics(it, 0, 11)), zeroM());
  const last = years[years.length - 1], prev = years[years.length - 2];
  const diff = !!st.yoyDiff;
  const btn = document.getElementById('yoy-diff');
  if (btn) btn.textContent = diff ? '(−) Hide changes' : '(+) Changes vs last year';
  const dash = '<span class="text-muted">–</span>';
  // "+$1,234 (+12%)" — increase red, decrease green (spend view).
  const dcell = (cur, base, extra) => {
    if (!cur && !base) return `<td class="num dlt ${extra || ''}">${dash}</td>`;
    const dv = cur - base;
    return `<td class="num dlt ${dv > 0.5 ? 'neg' : dv < -0.5 ? 'pos' : ''} ${extra || ''}">${(dv >= 0 ? '+' : '') + USD(dv)}${base ? ` <span class="hint">(${dv >= 0 ? '+' : ''}${pct(dv, base)}%)</span>` : ''}</td>`;
  };
  let h = '<thead><tr><th>Country</th><th>Type</th>';
  years.forEach((y, i) => {
    h += `<th class="num">${y} B</th>`;
    if (diff && i > 0) h += `<th class="num dlt" title="${y} budget − ${years[i - 1]} budget">± vs ${years[i - 1]} B</th>`;
    if (yHasA[y]) {
      h += `<th class="num">${y} A+F</th>`;
      if (diff && i > 0 && yHasA[years[i - 1]]) h += `<th class="num dlt" title="${y} actual+forecast − ${years[i - 1]} actual+forecast">± vs ${years[i - 1]} A+F</th>`;
    }
  });
  h += (prev ? `<th class="num">${last} B vs ${prev} ${yHasA[prev] ? 'A+F' : 'B'}</th>` : '') + '</tr></thead><tbody>';
  const ncols = 2 + years.reduce((n, y, i) => n + 1 + (diff && i > 0 ? 1 : 0) + (yHasA[y] ? 1 + (diff && i > 0 && yHasA[years[i - 1]] ? 1 : 0) : 0), 0) + (prev ? 1 : 0);
  const cellsFor = (list) => {
    const per = {}; years.forEach(y => { per[y] = fy(list.filter(i => i.year === y)); });
    let cells = '';
    years.forEach((y, i) => {
      const m = per[y], p = per[years[i - 1]];
      cells += `<td class="num">${m.B ? USD(m.B) : dash}</td>`;
      if (diff && i > 0) cells += dcell(m.B, p.B);
      if (yHasA[y]) {
        cells += `<td class="num">${m.AF ? USD(m.AF) : dash}</td>`;
        if (diff && i > 0 && yHasA[years[i - 1]]) cells += dcell(m.AF, p.AF);
      }
    });
    const lastD = prev ? per[last].B - (yHasA[prev] ? per[prev].AF : per[prev].B) : 0;
    if (prev) cells += dcell(per[last].B, yHasA[prev] ? per[prev].AF : per[prev].B, 'last');
    return { cells, lastD, any: years.some(y => per[y].B || per[y].AF) };
  };
  // Items behind a row: grouped by program › project › sub-project (+ Opex/Capex),
  // biggest change (last column) first.
  const details = (list) => {
    const g = new Map();
    list.forEach(it => {
      const k = [it.oc, it.program, it.project, it.sub_project].join('|');
      if (!g.has(k)) g.set(k, { it, items: [] });
      g.get(k).items.push(it);
    });
    const rows = [...g.values()].map(x => ({ x, c: cellsFor(x.items) })).filter(r => r.c.any)
      .sort((p, q) => Math.abs(q.c.lastD) - Math.abs(p.c.lastD));
    if (!rows.length) return `<tr class="yoy-d"><td colspan="${ncols}" class="hint">No items.</td></tr>`;
    return rows.map(({ x, c }) => {
      const it = x.it, parts = [it.program, it.project, it.sub_project].filter((v, i, a) => v && a.indexOf(v) === i);
      const en = parts.map(p => EN(p) || p).join(' › ');
      const pyps = [...new Set(x.items.map(pypCode).filter(Boolean))];
      return `<tr class="yoy-d"><td>${esc(parts.join(' › ') || it.proj_category)}${en !== parts.join(' › ') ? `<span class="en">${esc(en)}</span>` : ''}${pyps.length ? `<span class="en">PYP ${esc(pyps.slice(0, 2).join(', '))}${pyps.length > 2 ? ' …' : ''}</span>` : ''}</td><td>${ocTag(it.oc)}</td>${c.cells}</tr>`;
    }).join('');
  };
  const open = new Set(st.yoyOpen || []);
  const line = (label, oc, list, strong, id) => {
    const c = cellsFor(list), isOpen = open.has(id);
    return `<tr class="yoy-tg" data-id="${esc(id)}" title="Click to ${isOpen ? 'hide' : 'show'} the items behind this row"${strong ? ' style="font-weight:700;border-top:1px solid #cbd5e1"' : ''}><td><span class="car">${isOpen ? '▾' : '▸'}</span>${label}</td><td>${oc ? ocTag(oc) : 'Total'}</td>${c.cells}</tr>`
      + (isOpen ? details(list) : '');
  };
  countries.forEach(c => {
    const ci = items.filter(i => i.country === c);
    ocs.forEach(o => { h += line(`${COUNTRY_FLAG[c]} ${c}`, o, ci.filter(i => i.oc === o), false, c + '|' + o); });
    if (ocs.length > 1) h += line(`${COUNTRY_FLAG[c]} ${c}`, '', ci, true, c + '|');
  });
  if (countries.length > 1) h += line('<b>All countries</b>', '', items, true, 'ALL|');
  document.getElementById('yoy-table').innerHTML = h + '</tbody>';
  document.querySelectorAll('#yoy-table tr.yoy-tg').forEach(tr => tr.addEventListener('click', () => {
    const id = tr.dataset.id, o = new Set(st.yoyOpen || []);
    if (o.has(id)) o.delete(id); else o.add(id);
    st.yoyOpen = [...o]; save(); renderYoy();
  }));
}

// ── Lines (grouped by PYP / category / GL) ───────────────────────────────────
const GROUP_DIMS = { pyp: 'PYP', cat: 'Category', gl: 'GL' };
function groupOf(it, dim) {
  if (dim === 'pyp') { const c = pypCode(it); return { key: c || '~', label: c ? `<span class="hint">PYP</span> <code>${esc(c)}</code> ${biInline(pypName(it))}` : '<span class="text-muted">(no PYP)</span>' }; }
  if (dim === 'cat') return { key: it.proj_group + '|' + it.proj_category, label: `<span class="hint">Category</span> ${biInline(it.proj_group)} › ${biInline(it.proj_category)}` };
  if (dim === 'gl') return { key: it.gl_no || '~', label: it.gl_no ? `<span class="hint">GL</span> <code>${esc(it.gl_no)}</code> ${biInline(it.gl_name)}${DATA.glMap[it.gl_no] ? ` <span class="hint">· Local GL <code>${esc(DATA.glMap[it.gl_no])}</code></span>` : ''}` : '<span class="text-muted">(no GL)</span>' };
  return { key: '', label: '' };
}
function itemLabel(it) {
  const parts = [it.program, it.project, it.sub_project].filter((v, i, a) => v && a.indexOf(v) === i);
  const en = parts.map(EN).filter(Boolean);
  return `${esc(parts.join(' › ') || it.proj_category)}${isEK(it) ? ' <span class="tag-ek" title="FİİLİ_EK — actual booked without a budget line">Unbudgeted actual</span>' : isDerived(it) ? ' <span class="tag-ek" style="background:#f0fdf4;color:#166534;border-color:#bbf7d0" title="FİİLİ_EK / Yeni Türetme — new budget line based on last year\'s actuals">From actuals</span>' : ''}`
    + (en.length ? `<span class="en">${esc(parts.map(p => EN(p) || p).join(' › '))}</span>` : '');
}
function renderLines(items, a, b) {
  const hasA = yearHasActuals();
  let list = items;
  if (st.hideZero) list = list.filter(it => { const m = metrics(it, a, b); return Math.abs(m.B) > 0.5 || Math.abs(m.AF) > 0.5; });
  const ocs = OCS.filter(o => !st.oc || o === st.oc);
  const months = st.cols === 'month';
  const showCountry = !st.country;
  const headSum = `<tr>${showCountry ? '<th>Country</th>' : ''}<th>Item · Kalem</th><th>GL · MÇ</th><th>PYP ${st.pyp === 'ecc' ? '(old ECC)' : '(new S4)'}</th>`
    + (hasA ? '<th class="num">Budget</th><th class="num">Actual</th><th class="num">A+F</th><th class="num">Var.</th><th>Used</th>' : '<th class="num">Budget</th>') + '<th>Comment · Açıklama</th></tr>';
  const headMon = `<tr>${showCountry ? '<th>Country</th>' : ''}<th>Item · Kalem</th><th>GL</th><th>PYP</th>${MON.map((m, k) => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr>`;
  const valsSum = (m) => hasA
    ? `<td class="num">${USD(m.B)}</td><td class="num">${USD(m.A)}</td><td class="num">${USD(m.AF)}</td><td class="num ${cls(m.V)}">${USD(m.V)}</td><td>${usedBar(m)}</td>`
    : `<td class="num">${USD(m.B)}</td>`;
  const monthCells = (it) => MON.map((_, k) => {
    const bv = it.budget[k] || 0, av = it.actual[k] || 0;
    const top = Math.abs(bv) > 0.5 ? USD(bv) : '<span class="text-muted">–</span>';
    const bot = hasA && Math.abs(av) > 0.5 ? `<span class="en" style="${k >= it.actual_months ? 'font-style:italic' : 'color:#b45309'}">${USD(av)}</span>` : '';
    return `<td class="num">${top}${bot}</td>`;
  }).join('');
  let html = '';
  ocs.forEach(o => {
    const L = list.filter(i => i.oc === o);
    const tot = L.reduce((t, it) => addM(t, metrics(it, a, b)), zeroM());
    html += `<h3 style="margin:${html ? '22px' : '0'} 0 8px;font-size:14px;display:flex;align-items:center;gap:8px">${ocTag(o)} ${o === 'CAPEX' ? 'Capital expenditure · Yatırım' : 'Operating expenditure · İşletme gideri'}`
      + `<span class="hint" style="font-weight:400">${L.length} lines · budget ${USD(tot.B)}${hasA ? ` · A+F ${USD(tot.AF)} · var. ${USD(tot.V)}` : ''} · ${esc(periodLabel(st.period))}</span></h3>`;
    if (!L.length) { html += '<p class="hint">No lines.</p>'; return; }
    const ncolLead = (showCountry ? 1 : 0) + 3;
    const lineRow = (it, depth) => {
      const m = metrics(it, a, b);
      const pyp = pypCode(it), alt = otherPyp(it);
      const pypCell = `<td>${pyp ? `<code>${esc(pyp)}</code>` : '<span class="text-muted">—</span>'}${alt && alt !== pyp ? `<span class="en" title="${st.pyp === 'ecc' ? 'new S4' : 'old ECC'}">${st.pyp === 'ecc' ? 'S4' : 'ECC'}: ${esc(alt)}</span>` : ''}</td>`;
      const glCell = `<td>${it.gl_no ? `<code>${esc(it.gl_no)}</code>` : ''}${it.gl_name ? `<span class="en">${esc(EN(it.gl_name) || it.gl_name)}</span>` : ''}</td>`;
      const cmt = [it.comment ? `${esc(it.comment)}${EN(it.comment) ? `<span class="en">${esc(EN(it.comment))}</span>` : ''}` : '', it.note ? `<div class="note">📝 ${esc(it.note)}</div>` : ''].join('');
      const pad = `style="padding-left:${18 + depth * 18}px"`;
      return `<tr class="line" data-id="${it.id}">${showCountry ? `<td ${pad}>${COUNTRY_FLAG[it.country]} ${esc(it.country)}</td><td>` : `<td ${pad}>`}${itemLabel(it)}</td>${glCell}${pypCell}`
        + (months ? monthCells(it) + `<td class="num"><b>${USD(C.sum(it.budget))}</b>${hasA ? `<span class="en">${USD(C.sum(it.actual))}</span>` : ''}</td>` : valsSum(m) + `<td class="cmt">${cmt}</td>`) + '</tr>';
    };
    // Group recursively by the selected dimensions, in the order they were switched on.
    const dims = (st.groups || []).filter(d => GROUP_DIMS[d]);
    const renderLevel = (its, depth) => {
      if (depth >= dims.length) return its.map(it => lineRow(it, depth)).join('');
      const groups = new Map();
      its.forEach(it => { const g = groupOf(it, dims[depth]); if (!groups.has(g.key)) groups.set(g.key, { label: g.label, items: [] }); groups.get(g.key).items.push(it); });
      const keys = [...groups.keys()].sort((x, y) => (x === '~') - (y === '~') || x.localeCompare(y));
      return keys.map(k => {
        const g = groups.get(k);
        const head = `<td colspan="${ncolLead}" style="padding-left:${8 + depth * 18}px">${depth ? '↳ ' : ''}${g.label} <span class="hint">· ${g.items.length} line${g.items.length > 1 ? 's' : ''}</span></td>`;
        let row;
        if (months) {
          const mb = Array(12).fill(0); g.items.forEach(it => it.budget.forEach((v, i) => { mb[i] += v || 0; }));
          row = `<tr class="grp lvl${depth}">${head}${mb.map(v => `<td class="num">${Math.abs(v) > 0.5 ? USD(v) : ''}</td>`).join('')}<td class="num">${USD(mb.reduce((s2, v) => s2 + v, 0))}</td></tr>`;
        } else {
          row = `<tr class="grp lvl${depth}">${head}${valsSum(g.items.reduce((t, it) => addM(t, metrics(it, a, b)), zeroM()))}<td></td></tr>`;
        }
        return row + renderLevel(g.items, depth + 1);
      }).join('');
    };
    const rows = renderLevel(L, 0);
    html += `<div class="bdg-scroll"><table class="lt"><thead>${months ? headMon : headSum}</thead><tbody>${rows}</tbody></table></div>`;
  });
  if (months && hasA) html = '<p class="hint" style="margin:0 0 8px">Each month: <b>budget</b> on top, actual (amber) or <i>forecast (italic)</i> below.</p>' + html;
  document.getElementById('lines-body').innerHTML = html || '<p class="hint">No lines match.</p>';
  document.querySelectorAll('#lines-body tr.line').forEach(tr => tr.addEventListener('click', () => openDetail(+tr.dataset.id)));
}
function usedBar(m) {
  if (!m.B) return m.AF ? '<span class="tag-ek">no budget</span>' : '';
  const p = pct(m.AF, m.B), c = p > 100 ? '#dc2626' : p > 85 ? '#f59e0b' : '#16a34a';
  return `<div style="font-size:11px">${p}%</div><div class="bar"><i style="width:${Math.min(100, Math.max(0, p))}%;background:${c}"></i></div>`;
}

// ── detail modal ─────────────────────────────────────────────────────────────
function openDetail(id) {
  const it = DATA.items.find(i => i.id === id); if (!it) return;
  const hasA = it.actual.some(v => v);
  const f = (tr, en, v, code) => `<dt>${tr}<span class="en-inline">${en}</span></dt><dd>${v ? (code ? `<code>${esc(v)}</code>` : bi(v)) : '<span class="text-muted">—</span>'}</dd>`;
  const pair = (tr, en, code, name) => `<dt>${tr}<span class="en-inline">${en}</span></dt><dd>${code ? `<code>${esc(code)}</code>` : '<span class="text-muted">—</span>'} ${name ? bi(name) : ''}</dd>`;
  const rows = MON.map((m, k) => {
    const b = it.budget[k] || 0, a = it.actual[k] || 0;
    return `<tr><td>${m} ${it.year}</td><td class="num">${USD(b)}</td>${hasA ? `<td class="num" style="${k >= it.actual_months ? 'font-style:italic;color:#64748b' : ''}">${USD(a)} <span class="hint">${k < it.actual_months ? 'A' : 'F'}</span></td><td class="num ${cls(b - a)}">${USD(b - a)}</td>` : ''}</tr>`;
  }).join('');
  const tb = C.sum(it.budget), ta = C.sum(it.actual);
  document.getElementById('bd-title').innerHTML = `${COUNTRY_FLAG[it.country]} ${esc(it.country)} ${it.year} · ${ocTag(it.oc)} ${esc(it.sub_project || it.project || it.program)}`;
  document.getElementById('bd-body').innerHTML = `
    <div class="twocol">
      <dl class="kv">
        ${f('Durum', 'Status', it.status)}
        ${f('Şirket Tanımı', 'Company', it.company)}
        ${f('Bütçe Sahibi / Müdürlük', 'Owner / Department', [it.owner, it.department].filter(Boolean).join(' / '))}
        ${f('Proje Grubu', 'Project group', it.proj_group)}
        ${f('Proje Kategorisi', 'Project category', it.proj_category)}
        ${f('Program / Servis Adı', 'Program / service', it.program)}
        ${f('Proje / Servis Adı', 'Project / service', it.project)}
        ${f('Alt Proje / Servis Adı', 'Sub project / service', it.sub_project)}
      </dl>
      <dl class="kv">
        ${pair('PYP öğesi (Yeni Yapı)', 'PYP new — S/4HANA', it.pyp_s4, it.pyp_s4_name)}
        ${pair('PYP No', 'PYP old — ECC', it.pyp_ecc, it.pyp_ecc_name)}
        ${pair('Masraf Çeşidi / MÇ', 'GL account (Turkish)', it.gl_no, it.gl_name)}
        ${f('Local GL', 'GL.xlsx mapping', DATA.glMap[it.gl_no] || '', true)}
        ${pair('MY No', 'Cost center', it.cc_no, it.cc_name)}
        ${pair('Proje No', 'Project no', it.proje_no, it.proje_name)}
        ${f('Kaynak', 'Source', `${(KIND_LABEL[it.kind] || [it.kind])[0]} · ${it.source_file || ''}`)}
      </dl>
    </div>
    <div class="bdg-scroll" style="margin-top:16px"><table>
      <thead><tr><th>Month · Ay</th><th class="num">Budget · Bütçe</th>${hasA ? '<th class="num">Actual / Forecast</th><th class="num">Variance · Fark</th>' : ''}</tr></thead>
      <tbody>${rows}<tr style="font-weight:700;border-top:2px solid #cbd5e1"><td>Total</td><td class="num">${USD(tb)}</td>${hasA ? `<td class="num">${USD(ta)}</td><td class="num ${cls(tb - ta)}">${USD(tb - ta)}</td>` : ''}</tr></tbody>
    </table></div>
    <div style="margin-top:16px">
      <div class="hint" style="font-weight:600">Açıklama · Comment (from report)</div>
      <div style="margin-top:4px">${it.comment ? bi(it.comment) : '<span class="text-muted">—</span>'}</div>
    </div>
    <div style="margin-top:14px">
      <label class="hint" style="font-weight:600" for="bd-note">IT note · our own comment (kept when the next report is imported)</label>
      <textarea id="bd-note" class="form-control" rows="2" style="width:100%;margin-top:4px">${esc(it.note)}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-primary btn-sm" id="bd-save">Save note</button></div>
    </div>`;
  document.getElementById('bd-modal').classList.add('open');
  document.getElementById('bd-save').onclick = async () => {
    const note = document.getElementById('bd-note').value;
    try {
      const r = await fetch(`/api/budget/${it.id}/note`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      if (!r.ok) throw new Error('Save failed (HTTP ' + r.status + ')');
      it.note = note; showToast('Note saved'); renderLines(yearItems(), ...periodRange(st.period));
    } catch (e) { showToast(e.message, 'error'); }
  };
}
function closeDetail() { document.getElementById('bd-modal').classList.remove('open'); }

// ── data sources & import ────────────────────────────────────────────────────
function renderSourceTable() {
  const src = (DATA.meta.sources || []).slice().sort((x, y) => y.year - x.year || x.country.localeCompare(y.country));
  document.getElementById('src-table').innerHTML = src.length
    ? '<thead><tr><th>Country</th><th>Year</th><th>Type</th><th>Actual through</th><th class="num">Lines</th><th>File</th><th>Imported</th><th></th></tr></thead><tbody>'
      + src.map(s => `<tr><td>${COUNTRY_FLAG[s.country]} ${esc(s.country)}</td><td>${s.year}</td><td><span class="src-pill ${esc(s.kind)}">${esc((KIND_LABEL[s.kind] || [s.kind])[0])}</span></td>`
        + `<td>${s.actual_months ? MON[s.actual_months - 1] + ' ' + s.year : '<span class="hint">budget only</span>'}</td><td class="num">${s.lines}</td>`
        + `<td class="hint">${esc(s.source_file)}</td><td class="hint">${esc((s.imported_at || '').slice(0, 16).replace('T', ' '))}</td>`
        + `<td><button class="btn btn-ghost btn-sm" data-del="${esc(s.country)}|${s.year}" title="Remove ${esc(s.country)} ${s.year}">🗑</button></td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="hint">No budget data loaded yet.</td></tr></tbody>';
  document.querySelectorAll('#src-table [data-del]').forEach(btn => btn.addEventListener('click', async () => {
    const [c, y] = btn.dataset.del.split('|');
    if (!confirm(`Remove all ${c} ${y} budget lines?`)) return;
    try { await apiDelete(`/api/budget/${encodeURIComponent(c)}/${y}`); showToast(`${c} ${y} removed`); await loadData(); }
    catch (e) { showToast(e.message, 'error'); }
  }));
}

let PENDING = [];   // [{ file, sheets, items, plan }]
const tick = () => new Promise(r => setTimeout(r, 30));
function fileToArrayBuffer(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsArrayBuffer(file); }); }
async function postImport(body) {
  const r = await fetch('/api/budget/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text(); const d = t ? JSON.parse(t) : {};
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
async function readFiles() {
  const input = document.getElementById('imp-files'), status = document.getElementById('imp-status');
  const files = [...(input.files || [])];
  if (!files.length) { showToast('Choose one or more .xlsx files first', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('Excel reader not loaded — hard-refresh the page', 'error'); return; }
  PENDING = []; document.getElementById('imp-preview').innerHTML = '';
  const errors = [];
  for (const [i, file] of files.entries()) {
    status.textContent = `Reading ${i + 1}/${files.length}: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`;
    await tick();
    try {
      const { items, sheets } = C.parseWithXLSX(XLSX, await fileToArrayBuffer(file), 'array', file.name);
      const { plan } = await postImport({ rows: items, file_name: file.name, dry_run: true });
      PENDING.push({ file: file.name, sheets, items, plan });
    } catch (e) { errors.push(`${file.name}: ${e.message}`); }
  }
  status.textContent = errors.length ? '⚠️ ' + errors.join(' · ') : '';
  renderPreview();
}
function renderPreview() {
  const el = document.getElementById('imp-preview');
  if (!PENDING.length) { el.innerHTML = ''; return; }
  const rows = PENDING.flatMap(p => p.plan.map(x => ({ ...x, file: p.file, sheet: p.sheets.join(', ') })));
  el.innerHTML = `<div class="bdg-scroll"><table class="imp-table"><thead><tr><th>File · sheet</th><th>Country</th><th>Year</th><th>Type</th><th class="num">Lines</th><th class="num">Budget</th><th class="num">Actual+Fcst</th><th>Actual through</th><th>Action</th></tr></thead><tbody>`
    + rows.map(x => `<tr><td class="hint">${esc(x.file)}<br>· ${esc(x.sheet)}</td><td>${COUNTRY_FLAG[x.country]} ${esc(x.country)}</td><td>${x.year}</td><td>${esc((KIND_LABEL[x.kind] || [x.kind])[0])}</td>`
      + `<td class="num">${x.lines}</td><td class="num">${USD(x.budget)}</td><td class="num">${x.actual ? USD(x.actual) : '–'}</td><td>${x.actual_months ? MON[x.actual_months - 1] : '–'}</td>`
      + `<td><span class="act-${x.action}">${x.action === 'add' ? 'Add' : x.action === 'replace' ? `Replace ${x.existing} lines` : 'Skip'}</span>${x.reason ? `<div class="hint">${esc(x.reason)}</div>` : ''}</td></tr>`).join('')
    + `</tbody></table></div><div style="margin-top:10px;display:flex;gap:10px;align-items:center"><button class="btn btn-primary" id="imp-save">Save ${PENDING.length} file${PENDING.length > 1 ? 's' : ''}</button><button class="btn btn-ghost" id="imp-cancel">Cancel</button><span class="hint">Approved budgets are saved first, then reports.</span></div>`;
  document.getElementById('imp-cancel').onclick = () => { PENDING = []; renderPreview(); };
  document.getElementById('imp-save').onclick = saveImport;
}
async function saveImport() {
  const btn = document.getElementById('imp-save'), status = document.getElementById('imp-status');
  btn.disabled = true;
  const order = { approved: 0, report: 1, legacy: 2 };
  const list = PENDING.slice().sort((x, y) => (order[x.items[0].kind] || 0) - (order[y.items[0].kind] || 0));
  const done = [];
  try {
    for (const p of list) {
      status.textContent = `Saving ${p.file}…`;
      const d = await postImport({ rows: p.items, file_name: p.file });
      d.plan.forEach(x => done.push(`${x.country} ${x.year}: ${x.action === 'skip' ? 'skipped' : x.lines + ' lines'}`));
    }
    status.textContent = '✅ ' + done.join(' · ');
    showToast('Budget imported');
    PENDING = []; renderPreview(); document.getElementById('imp-files').value = '';
    await loadData();
  } catch (e) { status.textContent = '❌ ' + e.message; showToast(e.message, 'error'); btn.disabled = false; }
}

// ── main ─────────────────────────────────────────────────────────────────────
function renderAll() {
  save();
  buildToolbar();
  renderSources();
  const items = yearItems();
  const [a, b] = periodRange(st.period);
  renderKpis(items, a, b);
  renderSummary(items, a, b);
  renderMonthly(items, a, b);
  renderYoy();
  renderLines(items, a, b);
  renderSourceTable();
}

async function loadData() {
  DATA = await apiGet('/api/budget');
  const years = DATA.meta.years || [];
  if (!years.includes(st.year)) {
    const now = new Date().getFullYear();
    st.year = years.includes(now) ? now : (years[years.length - 1] || now);
    st.period = 'fy';
  }
  if (!validPeriod()) st.period = 'fy';
  document.getElementById('export-btn').href = '/api/budget/export.xlsx?t=' + Date.now();
  renderAll();
}

async function initBudget() {
  const gate = document.getElementById('gate-card'), gateMsg = document.getElementById('gate-msg'), body = document.getElementById('budget-body');
  const u = window.CURRENT_USER || (typeof ensureAuth === 'function' ? await ensureAuth() : null);
  if (!u) return;
  if (!(u.team === 'IT' && u.role === 'admin')) { gate.style.display = ''; gateMsg.textContent = '🔒 Budget Tracking is available to IT administrators only.'; return; }
  try {
    body.style.display = '';
    document.getElementById('f-period').addEventListener('change', (e) => { st.period = e.target.value; renderAll(); });
    const se = document.getElementById('f-search');
    se.value = st.q || '';
    let t = null;
    se.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = se.value; renderAll(); }, 150); });
    document.getElementById('f-ek').addEventListener('change', (e) => { st.ek = e.target.checked; renderAll(); });
    document.getElementById('f-zero').addEventListener('change', (e) => { st.hideZero = e.target.checked; renderAll(); });
    document.getElementById('imp-read').addEventListener('click', readFiles);
    document.getElementById('yoy-diff').addEventListener('click', () => { st.yoyDiff = !st.yoyDiff; renderAll(); });
    document.getElementById('bd-close').addEventListener('click', closeDetail);
    document.getElementById('bd-modal').addEventListener('click', (e) => { if (e.target.id === 'bd-modal') closeDetail(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
    await loadData();
  } catch (e) { gate.style.display = ''; gateMsg.textContent = 'Could not load budget data: ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => { initBudget(); });
