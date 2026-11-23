/* 📜 Audit log & activities (activity.html) — GET /api/activity: one timeline, area chips, filters, CSV. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = { 'Sign-in & security': '🔐', 'Users & access': '👤', 'Assets': '💻', 'Servers & network': '🖧', 'Network map': '🔌', 'OT': '🏭', 'People': '👥',
    'Licenses': '🪪', 'Maintenance': '🔧', 'Stocktake & labels': '🏷', 'Budget': '💰', 'Monitoring': '📈', 'Recycle bin': '🗑', 'Imports': '⬆', 'Exports': '⬇',
    'Page visits': '👁', 'Other changes': '•' };
  const COLOR = { 'Sign-in & security': '#7c3aed', 'Monitoring': '#0891b2', 'OT': '#ea580c', 'Network map': '#2563eb', 'Servers & network': '#1d4ed8', 'Budget': '#15803d', 'Recycle bin': '#b91c1c' };
  const st = { page: 1, limit: 100, areas: new Set() };
  const local = (s) => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? esc(s) : `<span title="${esc(s)} UTC">${d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>`; };
  const query = (extra = {}) => {
    const p = new URLSearchParams();
    if (st.areas.size) p.set('area', [...st.areas].join(','));
    [['q', 'ac-q'], ['user', 'ac-user'], ['from', 'ac-from'], ['to', 'ac-to']].forEach(([k, id]) => { const v = $(id).value.trim(); if (v) p.set(k, v); });
    if ($('ac-views').checked) p.set('views', '1');
    if ($('ac-detail').checked) p.set('detail', '1');
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  };
  async function load() {
    const tb = $('ac-tbody');
    let d;
    try { d = await apiGet('/api/activity?' + query({ page: st.page, limit: st.limit })); }
    catch { tb.innerHTML = '<tr><td colspan="5" class="empty-state">Could not load (global admins only).</td></tr>'; return; }
    $('ac-count').textContent = `${d.total.toLocaleString()} entr${d.total === 1 ? 'y' : 'ies'}`;
    $('ac-areas').innerHTML = `<button type="button" class="ac-chip${st.areas.size ? '' : ' on'}" data-a="">All areas</button>` + d.areas.map(a =>
      `<button type="button" class="ac-chip${st.areas.has(a.area) ? ' on' : ''}" data-a="${esc(a.area)}">${ICON[a.area] || '•'} ${esc(a.area)} <b>${a.n.toLocaleString()}</b></button>`).join('');
    const cur = $('ac-user').value;
    $('ac-user').innerHTML = '<option value="">All users</option>' + d.users.filter(u => u.who).map(u => `<option value="${esc(u.who)}"${u.who === cur ? ' selected' : ''}>${esc(u.who)} (${u.n})</option>`).join('');
    tb.innerHTML = d.rows.length ? d.rows.map(r => `<tr class="ac-${esc(r.src)}${r.action === 'LOGIN_FAILED' || r.action === 'REFUSED' ? ' ac-bad' : ''}">
        <td class="text-sm" style="white-space:nowrap">${local(r.at)}</td>
        <td>${r.who === 'system' ? '<span class="text-muted">system</span>' : esc(r.who) || '—'}</td>
        <td><span class="ac-area" style="--ac:${COLOR[r.area] || '#475569'}">${ICON[r.area] || '•'} ${esc(r.area)}</span><div class="ac-act">${esc(r.action)}${r.src !== 'audit' ? ` · ${esc({ health: 'monitoring', scan: 'QR scan', portlog: 'port log', ot: 'OT log' }[r.src] || r.src)}` : ''}</div></td>
        <td class="ac-txt">${esc(r.text)}${r.asset_id ? ` <a class="text-sm" href="/inventory.html?view=${r.asset_id}">#${r.asset_id}</a>` : ''}</td>
        <td class="text-muted text-sm">${esc(r.ip)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nothing found.</td></tr>';
    const pages = Math.max(1, Math.ceil(d.total / d.limit));
    $('ac-page').textContent = `Page ${d.page} of ${pages}`;
    $('ac-prev').disabled = d.page <= 1; $('ac-next').disabled = d.page >= pages;
    $('ac-export').href = '/api/activity/export.csv?' + query();
  }
  document.addEventListener('DOMContentLoaded', () => {
    const t = setInterval(() => { const u = window.CURRENT_USER; if (!u) return; clearInterval(t);
      if (!(u.role === 'admin' && !String(u.country || '').trim())) { location.href = '/'; return; } load(); }, 100);
    $('ac-areas').addEventListener('click', (e) => { const b = e.target.closest('.ac-chip'); if (!b) return;
      if (!b.dataset.a) st.areas.clear(); else if (st.areas.has(b.dataset.a)) st.areas.delete(b.dataset.a); else st.areas.add(b.dataset.a);
      st.page = 1; load(); });
    let deb; $('ac-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { st.page = 1; load(); }, 300); });
    ['ac-user', 'ac-from', 'ac-to', 'ac-views', 'ac-detail'].forEach(id => $(id).addEventListener('change', () => { st.page = 1; load(); }));
    $('ac-reset').addEventListener('click', () => { ['ac-q', 'ac-user', 'ac-from', 'ac-to'].forEach(id => { $(id).value = ''; }); $('ac-views').checked = $('ac-detail').checked = false; st.areas.clear(); st.page = 1; load(); });
    $('ac-prev').addEventListener('click', () => { if (st.page > 1) { st.page--; load(); } });
    $('ac-next').addEventListener('click', () => { st.page++; load(); });
  });
})();
