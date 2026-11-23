/* Inbox (docs/UX-REDESIGN.md, phase 2): every "needs attention" rule in one place.
   Top: one card per area with the count of each rule (GET /api/inbox, the same checks as before).
   Below: the lists where each item is fixed — Missing Info / Missing AD & Asset (needs-attention.js), Servers & network
   (server-attention.js), OT (ot-links.js), leavers, monitoring, HR changes and notifications. Only the sections this
   account may see are shown. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = { assets: '💻', servers: '🖧', ot: '🏭', people: '👥', health: '📈' };
  const SEC = { assets: 'sec-assets', servers: 'sec-servers', ot: 'sec-ot', people: 'sec-people', health: 'sec-health' };

  async function loadSummary(fresh) {
    const box = $('ib-areas');
    let d;
    try { d = await apiGet('/api/inbox' + (fresh ? '?fresh=1' : '')); }
    catch { box.innerHTML = '<div class="text-muted text-sm">Could not load the inbox.</div>'; return; }
    $('ib-total').innerHTML = d.total ? `<b>${d.total.toLocaleString()}</b> open item${d.total === 1 ? '' : 's'}` : '✅ <b>Nothing to fix</b>';
    $('ib-at').textContent = 'Updated ' + new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (window.Shell && Shell.setInboxCount) Shell.setInboxCount(d.total);
    if (!d.areas.length) { box.innerHTML = '<div class="ib-empty">Everything on your list is done. New items appear here as soon as a check finds them.</div>'; return; }
    box.innerHTML = d.areas.map(a => {
      const n = a.items.reduce((t, i) => t + i.count, 0);
      // Many rules (more than twice the next-longest card) → a double-width card with the rules in two columns.
      const others = d.areas.filter(x => x !== a).map(x => x.items.length), wide = d.areas.length > 1 && a.items.length >= 5 && a.items.length > 1.6 * Math.max(1, ...others);
      return `<div class="ib-card${wide ? ' ib-wide' : ''}">
        <div class="ib-card-h"><span class="ib-ico">${ICON[a.key] || '•'}</span><b>${esc(a.title)}</b><span class="ib-team">${esc(a.team)}</span><span class="ib-n">${n.toLocaleString()}</span></div>
        <div class="ib-items">${a.items.map(i => `<a class="ib-item" href="${esc(i.href)}" data-sec="${esc(SEC[a.key] || '')}"${i.hint ? ` title="${esc(i.hint)}"` : ''}><span>${esc(i.label)}</span><b>${i.count.toLocaleString()}</b></a>`).join('')}</div>
      </div>`;
    }).join('');
    fitWide();
    // Links to this page scroll to the section instead of reloading.
    box.querySelectorAll('a.ib-item').forEach(l => l.addEventListener('click', (e) => {
      const href = l.getAttribute('href');
      if (!href.startsWith('/inbox.html')) return;
      e.preventDefault();
      const id = href.split('#')[1], el = (id && $(id)) || $(l.dataset.sec);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  // A double-width card only while every card still fits in one row (else it would push a card to a row of its own).
  function fitWide() {
    const box = $('ib-areas'); if (!box) return;
    const cards = [...box.querySelectorAll('.ib-card')], wide = cards.filter(c => c.dataset.wide === '1' || c.classList.contains('ib-wide'));
    if (!wide.length) return;
    wide.forEach(c => { c.dataset.wide = '1'; });
    const gap = parseFloat(getComputedStyle(box).columnGap) || 14;
    const cols = Math.max(1, Math.floor((box.clientWidth + gap) / (260 + gap)));
    const fits = cards.length + wide.length <= cols;
    wide.forEach(c => c.classList.toggle('ib-wide', fits));
  }
  window.addEventListener('resize', () => { clearTimeout(fitWide.t); fitWide.t = setTimeout(fitWide, 120); });

  async function loadLeavers() {
    const box = $('ib-leavers');
    try {
      const d = await apiGet('/api/leavers');
      const open = (d.list || []).filter(p => p.open > 0).sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));
      if (!open.length) { box.innerHTML = '<div class="text-muted text-sm">No open leaver checklists.</div>'; return; }
      box.innerHTML = open.slice(0, 12).map(p => {
        const when = p.days_left == null ? '' : p.days_left < 0 ? `<span class="ib-late">left ${-p.days_left} d ago</span>` : `leaves in ${p.days_left} d`;
        return `<div class="ib-row"><div><b>${esc(p.display_name || p.email)}</b> <span class="text-muted text-sm">${esc(p.department || '')} · ${esc(p.country || '')}</span></div>
          <div class="text-sm">${when} · <b>${p.open}</b> open</div></div>`;
      }).join('') + (open.length > 12 ? `<div class="text-muted text-sm" style="padding-top:6px">+ ${open.length - 12} more on the Leavers page</div>` : '');
    } catch { box.innerHTML = '<div class="text-muted text-sm">Could not load.</div>'; }
  }

  async function loadHealth() {
    const box = $('ib-health');
    try {
      const d = await apiGet('/api/health');
      const bad = (d.checks || []).filter(c => c.shown_status === 'down' || c.shown_status === 'warn');
      const off = (d.collectors || []).filter(c => !c.revoked && !c.online);
      if (!bad.length && !off.length) { box.innerHTML = '<div class="text-muted text-sm">All monitored systems are up.</div>'; return; }
      box.innerHTML = bad.map(c => `<div class="ib-row"><div><span class="ib-dot ${c.shown_status}"></span><b>${esc(c.name || c.target)}</b> <span class="text-muted text-sm">${esc(c.kind)} · ${esc(c.target)}</span></div>
          <div class="text-sm">${esc(c.summary || c.shown_status)}</div></div>`).join('')
        + off.map(c => `<div class="ib-row"><div><span class="ib-dot stale"></span><b>${esc(c.name)}</b> <span class="text-muted text-sm">collector · ${esc(c.site || c.country || '')}</span></div>
          <div class="text-sm">not reporting</div></div>`).join('');
    } catch { box.innerHTML = '<div class="text-muted text-sm">Could not load.</div>'; }
  }

  async function loadHrChanges() {
    const box = $('hr-box');
    try {
      const { data } = await apiGet('/api/notifications?scope=personnel');
      const hr = data.filter(n => /^HR \(/.test(n.message));
      if (!hr.length) { box.innerHTML = '<div class="text-muted text-sm">No recent changes by HR.</div>'; return; }
      box.innerHTML = hr.map(n => `<div class="ib-row"><div style="font-size:13px">${n.read ? '' : '<span class="ib-dot down"></span>'}${esc(n.message)}</div>
        <div class="text-muted text-sm">${esc(n.created_at)}</div></div>`).join('');
    } catch { box.innerHTML = '<div class="text-muted text-sm">Could not load.</div>'; }
  }

  function initSections(u) {
    const asset = Number(u.asset_access) !== 0 && u.role !== 'viewer', it = u.team === 'IT', hr = u.team === 'HR';
    const show = (id, on) => { $(id).hidden = !on; return on; };
    if (show('sec-assets', asset)) {
      // Fixing one problem can clear the other list too, so a save in either panel reloads both.
      const panels = {};
      const reloadOther = (key) => () => { const other = panels[key === 'missing' ? 'ad' : 'missing']; if (other) other.reload(); loadSummary(true); };
      panels.missing = NeedsAttention({ root: $('na-missing'), mode: 'missing', maxHeight: 480, onSaved: reloadOther('missing') });
      panels.ad = NeedsAttention({ root: $('na-ad'), mode: 'ad', maxHeight: 420, onSaved: reloadOther('ad') });
    }
    if (show('sec-servers', asset && typeof ServerAttention !== 'undefined')) ServerAttention.panel($('na-servers'), { maxHeight: 520 });
    show('sec-ot', it);   // ot-links.js fills it for the IT team
    if (show('sec-people', it || hr)) { loadLeavers(); loadHrChanges(); }
    if (show('sec-health', it)) loadHealth();
    if (show('sec-notes', asset) && typeof loadAlertBox === 'function') loadAlertBox('alert-box', 'asset');
    const h = location.hash && $(location.hash.slice(1));
    if (h) setTimeout(() => h.scrollIntoView({ behavior: 'smooth' }), 800);
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('ib-refresh').addEventListener('click', () => { $('ib-total').textContent = '…'; loadSummary(true); });
    const t = setInterval(() => { if (!window.CURRENT_USER) return; clearInterval(t); initSections(window.CURRENT_USER); loadSummary(false); }, 100);
  });
})();
