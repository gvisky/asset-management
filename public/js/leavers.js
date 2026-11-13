/* 🚪 Leavers — return checklist per person + 7-day recovery (routes/leavers.js). */

const lvEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let lvData = null, lvCountry = '', lvShow = 'open';

async function loadLeavers() {
  try { lvData = await apiGet('/api/leavers'); } catch { document.getElementById('lv-main').innerHTML = '<p class="text-muted">Could not load.</p>'; return; }
  renderLeavers();
}

function itemIcon(i) { return i.item.startsWith('asset:') ? '💻' : i.item.startsWith('device:') ? '📱' : i.item === 'm365' ? '✉️' : i.item === 'ad' ? '🔑' : '•'; }

function renderLeavers() {
  const d = lvData;
  const countries = [...new Set(d.list.map(p => p.country || 'Unknown'))];
  const inC = (p) => !lvCountry || (p.country || 'Unknown') === lvCountry;
  const list = d.list.filter(inC).filter(p => lvShow === 'all' || !p.cleared);
  // Recovery tiles per country
  const rec = d.recovery;
  const totalDue = Object.values(rec).reduce((t, r) => t + r.due, 0), totalOn = Object.values(rec).reduce((t, r) => t + r.onTime, 0);
  const pct = (r) => (r.due ? Math.round(r.onTime / r.due * 100) : null);
  const tile = (label, r) => { const v = pct(r); const c = v == null ? '#94a3b8' : v >= 95 ? '#16a34a' : v >= 80 ? '#d97706' : '#dc2626';
    return `<div class="lv-tile"><div class="text-muted text-sm">${lvEsc(label)}</div><div class="lv-big" style="color:${c}">${v == null ? '—' : v + '%'}</div>
      <div class="text-muted text-sm">${r.onTime} of ${r.due} back ≤ ${d.recoveryDays} days${r.late ? ` · ${r.late} late` : ''}${r.open ? ` · <b style="color:#dc2626">${r.open} not back</b>` : ''}</div></div>`; };
  const outNow = d.list.filter(inC).reduce((t, p) => t + p.items.filter(i => i.item.startsWith('asset:') && !i.done_at).length, 0);
  document.getElementById('lv-main').innerHTML = `
    <div class="lv-tiles">
      ${tile('Recovery ≤ ' + d.recoveryDays + ' days · all countries', { due: totalDue, onTime: totalOn, late: Object.values(rec).reduce((t, r) => t + r.late, 0), open: Object.values(rec).reduce((t, r) => t + r.open, 0) })}
      ${Object.entries(rec).map(([c, r]) => tile(c, r)).join('')}
      <div class="lv-tile"><div class="text-muted text-sm">Leavers · devices still out</div><div class="lv-big">${d.list.filter(inC).filter(p => !p.cleared).length} · <span style="color:${outNow ? '#dc2626' : '#16a34a'}">${outNow}</span></div>
        <div class="text-muted text-sm">people not cleared · assets not returned</div></div>
    </div>
    <div class="lv-bar">
      <button class="pill${!lvCountry ? ' on' : ''}" onclick="lvCountry='';renderLeavers()">All countries</button>
      ${countries.map(c => `<button class="pill${lvCountry === c ? ' on' : ''}" onclick="lvCountry=${jsArg(c)};renderLeavers()">${lvEsc(c)} <b>${d.list.filter(p => (p.country || 'Unknown') === c && !p.cleared).length}</b></button>`).join('')}
      <span style="flex:1"></span>
      <label class="text-sm"><input type="checkbox" ${lvShow === 'all' ? 'checked' : ''} onchange="lvShow=this.checked?'all':'open';renderLeavers()"> show cleared</label>
    </div>
    ${list.length ? list.map(personCard).join('') : '<div class="card"><div class="card-body empty-state">No leaver with something still to return 🎉</div></div>'}`;
}

function personCard(p) {
  const due = p.days_left == null ? '' : p.days_left > 0 ? `leaves in ${p.days_left} day${p.days_left === 1 ? '' : 's'}` : p.days_left === 0 ? 'leaves today' : `left ${-p.days_left} day${p.days_left === -1 ? '' : 's'} ago`;
  const late = p.days_left != null && p.days_left < -lvData.recoveryDays && p.items.some(i => i.item.startsWith('asset:') && !i.done_at);
  return `<div class="card lv-card${p.cleared ? ' lv-cleared' : ''}">
    <div class="lv-head"><div><b>${lvEsc(p.display_name)}</b> <span class="text-muted text-sm">${lvEsc(p.email || '')}</span>
      <div class="text-muted text-sm">${lvEsc(p.country || '')}${p.department ? ' · ' + lvEsc(p.department) : ''}${p.position ? ' · ' + lvEsc(p.position) : ''}</div></div>
      <div style="text-align:right">${p.leaving_date ? `<div><b>${lvEsc(p.leaving_date)}</b></div>` : ''}<div class="text-sm" style="color:${late ? '#dc2626' : '#64748b'}">${lvEsc(due)}${p.status && p.status !== 'Active' ? ' · ' + lvEsc(p.status) : ''}</div>
        ${p.cleared ? '<span class="badge badge-active">✓ cleared</span>' : `<span class="badge ${late ? 'badge-broken' : 'badge-stock'}">${p.open} open</span>`}</div></div>
    <div class="lv-items">${p.items.length ? p.items.map(i => itemRow(p, i)).join('') : '<div class="text-muted text-sm">Nothing assigned to this person.</div>'}</div></div>`;
}

function itemRow(p, i) {
  const isAsset = i.item.startsWith('asset:');
  const aid = isAsset ? Number(i.item.slice(6)) : null;
  const done = !!i.done_at;
  const box = isAsset
    ? `<span class="lv-check ${done ? 'on' : ''}">${done ? '✓' : ''}</span>`
    : `<input type="checkbox" ${done ? 'checked' : ''} ${lvData.canEdit ? '' : 'disabled'} onchange="tick(${p.id}, ${jsArg(i.item)}, this.checked)">`;
  const right = done
    ? `<span class="text-muted text-sm">${lvEsc(String(i.done_at).slice(0, 16))} · ${lvEsc(i.done_by)}${i.note ? ' · ' + (/^PDF #(\d+)/.test(i.note) ? `<a href="/api/custody/doc/${i.note.match(/#(\d+)/)[1]}.pdf" target="_blank" rel="noopener">${lvEsc(i.note)}</a>` : lvEsc(i.note)) : ''}</span>`
    : (isAsset && lvData.canReturn ? `<button class="btn btn-ghost btn-sm" onclick="returnAsset(${aid})">↩ Return (e-signed)</button>` : '');
  return `<div class="lv-item${done ? ' done' : ''}">${box}<span class="lv-ic">${itemIcon(i)}</span><span class="lv-lbl">${lvEsc(i.label)}</span><span class="lv-right">${right}</span></div>`;
}

async function tick(pid, item, done) {
  try { await apiPost(`/api/leavers/${pid}/item`, { item, done }); loadLeavers(); }
  catch (e) { let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); loadLeavers(); }
}
async function returnAsset(aid) {
  try { const a = await apiGet('/api/assets/' + aid); custodyReturn(a, () => loadLeavers()); }
  catch { showToast('Could not open the asset', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => { const go = (n = 0) => (window.CURRENT_USER || n > 40 ? loadLeavers() : setTimeout(() => go(n + 1), 100)); go(); });
