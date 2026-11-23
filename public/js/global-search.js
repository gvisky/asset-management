/* Global search (Ctrl+K or the 🔍 box in the top bar) on every page, the 👤 person view, and the asset timeline.
   Loaded by auth.js once the user is known. Results only show what the user may open (server side). */

(function () {
  if (window.GlobalSearch) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const ICON = { people: '👤', assets: '💻', servers: '🖥', vms: '☁️', net: '🔌', ports: '🔗', devices: '📱' };
  let items = [], idx = 0, timer = null, seq = 0;

  function shell() {
    if ($('gs-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="gs-ov" id="gs-ov"><div class="gs-box" role="dialog" aria-label="Search">
      <div class="gs-in"><span>🔍</span><input id="gs-q" placeholder="Search assets, people, serial, IP, MAC, hostname, port…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <div class="gs-res" id="gs-res"><div class="gs-hint">Type at least 2 characters. Tip: <kbd>Ctrl</kbd>+<kbd>K</kbd> opens this box on any page.</div></div></div></div>`);
    $('gs-ov').addEventListener('mousedown', (e) => { if (e.target.id === 'gs-ov') close(); });
    $('gs-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    $('gs-q').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(items[idx]); } else if (e.key === 'Escape') close();
    });
  }
  function open(prefill) { shell(); $('gs-ov').classList.add('open'); const q = $('gs-q'); if (prefill != null) q.value = prefill; q.focus(); q.select(); if (q.value.trim().length >= 2) run(); }
  function close() { const o = $('gs-ov'); if (o) o.classList.remove('open'); }
  function move(d) { if (!items.length) return; idx = (idx + d + items.length) % items.length; mark(); }
  function mark() { document.querySelectorAll('#gs-res .gs-it').forEach((el, i) => { el.classList.toggle('on', i === idx); if (i === idx) el.scrollIntoView({ block: 'nearest' }); }); }
  function go(it) {
    if (!it) return;
    if (it.person) { close(); PersonView.open(it.id); return; }
    if (it.url) { const u = new URL(it.url, location.origin); if (u.pathname === location.pathname && u.searchParams.get('view') && typeof onView === 'function') { close(); onView(Number(u.searchParams.get('view'))); } else location.href = it.url; }
  }
  async function run() {
    const q = $('gs-q').value.trim(), my = ++seq;
    if (q.length < 2) { items = []; $('gs-res').innerHTML = '<div class="gs-hint">Type at least 2 characters.</div>'; return; }
    $('gs-res').innerHTML = '<div class="gs-hint">Searching…</div>';
    let r; try { r = await apiGet('/api/lookup/search?q=' + encodeURIComponent(q)); } catch { if (my === seq) $('gs-res').innerHTML = '<div class="gs-hint">Search failed.</div>'; return; }
    if (my !== seq) return;
    items = []; idx = 0;
    const html = r.groups.map(g => `<div class="gs-g">${ICON[g.key] || ''} ${esc(g.label)}${g.more ? ' <span>— first results, type more to narrow</span>' : ''}</div>` +
      g.items.map(it => { items.push(it); return `<div class="gs-it" data-i="${items.length - 1}"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span></div>`; }).join('')).join('');
    $('gs-res').innerHTML = html || `<div class="gs-hint">Nothing found for “${esc(q)}”.</div>`;
    $('gs-res').querySelectorAll('.gs-it').forEach(el => { el.onclick = () => go(items[+el.dataset.i]); el.onmousemove = () => { idx = +el.dataset.i; mark(); }; });
    mark();
  }
  function addButton() {
    const bar = document.querySelector('.topbar');
    if (!bar || $('gs-btn')) return;
    const b = document.createElement('button');
    b.id = 'gs-btn'; b.type = 'button'; b.className = 'gs-btn'; b.title = 'Search everything (Ctrl+K)';
    b.innerHTML = '🔍 <span>Search…</span> <kbd>Ctrl K</kbd>';
    b.onclick = () => open();
    const at = $('tb-country') || $('tb-bell') || $('user-chrome'); if (at) bar.insertBefore(b, at); else bar.appendChild(b);
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
  });
  window.GlobalSearch = { open, close, addButton };

  // ── 👤 Person view ─────────────────────────────────────────────────────────
  const d10 = (s) => (s ? String(s).slice(0, 10) : '');
  const ago = (s) => { if (!s) return ''; const t = Date.parse(String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00:00Z' : 'Z')); if (isNaN(t)) return ''; const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`; };
  const kv = (k, v) => v ? `<div class="pv-kv"><span>${k}</span><b>${v}</b></div>` : '';
  const LEAVER = { asset: 'Asset returned', device: 'Intune device', m365: 'M365 licence removed', ad: 'AD account disabled' };
  async function openPerson(id) {
    if (!$('pv-ov')) document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="pv-ov"><div class="modal" style="max-width:980px;width:96vw">
      <div class="modal-header"><span class="modal-title" id="pv-t">👤 Person</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('pv-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="pv-b" style="max-height:78vh;overflow:auto"></div></div></div>`);
    $('pv-ov').classList.add('open'); $('pv-b').innerHTML = '<p class="text-muted">Loading…</p>';
    let r; try { r = await apiGet('/api/lookup/person/' + id); } catch (e) { $('pv-b').innerHTML = `<p class="text-muted">${esc(e.message || 'Could not load')}</p>`; return; }
    const p = r.person;
    const leaving = p.leaving_date ? `<span class="pv-chip warn">Leaving ${esc(p.leaving_date)}</span>` : '';
    const st = p.status && p.status !== 'Active' ? `<span class="pv-chip warn">${esc(p.status)}</span>` : '';
    $('pv-t').innerHTML = `👤 ${esc(p.display_name || p.email)}`;
    const m = r.m365;
    $('pv-b').innerHTML = `
      <div class="pv-head"><div><div class="pv-name">${esc(p.display_name || '')} ${leaving}${st}${p.ad_resource ? '<span class="pv-chip">Resource account</span>' : ''}</div>
        <div class="text-muted">${esc(p.email || '')}${p.position ? ' · ' + esc(p.position) : ''} · ${esc(p.country || '')}</div></div>
        <a class="btn btn-ghost btn-sm" href="/user-inventory.html?search=${encodeURIComponent(p.email || p.display_name || '')}">Open in User Inventory</a></div>
      <div class="pv-grid">
        <div class="pv-card"><h4>Identity &amp; AD</h4>
          ${kv('Employee ID', esc(p.employee_id))}${kv('AD department', esc(p.ad_department))}${kv('Cost center', esc([p.cost_center, p.department].filter(Boolean).join(' — ')))}
          ${kv('User type', esc(p.user_type))}${kv('AD account', esc(p.ad_sam))}${kv('AD OU', esc(p.ad_ou))}${kv('Manager', esc(p.ad_manager))}
          ${kv('Last AD logon', p.ad_never_logon ? 'never' : p.ad_last_logon ? `${esc(d10(p.ad_last_logon))} <span class="text-muted">(${ago(p.ad_last_logon)})</span>` : '')}
          ${kv('In AD list', p.ad_seen_at ? 'yes, ' + esc(d10(p.ad_seen_at)) : '')}${kv('Entra last seen', p.azure_seen_at ? esc(d10(p.azure_seen_at)) : '')}</div>
        <div class="pv-card"><h4>Microsoft 365</h4>
          ${m ? `${kv('Licence', m.licensed ? esc(m.products || 'licensed') : 'no licence')}${kv('Last activity', m.last_activity ? `${esc(d10(m.last_activity))} <span class="text-muted">(${ago(m.last_activity)})</span>` : 'none')}${kv('Report of', esc(d10(m.report_date)))}`
            : '<p class="text-muted text-sm">Not in the latest Active users report.</p>'}
          ${r.leaver.length ? `<h4 style="margin-top:12px">Leaver checklist</h4>${r.leaver.map(l => `<div class="pv-chk ${l.done_at ? 'ok' : ''}">${l.done_at ? '✔' : '○'} ${esc(l.label || LEAVER[String(l.item).split(':')[0]] || l.item)}${l.done_at ? ` <span class="text-muted">${esc(d10(l.done_at))}${l.done_by ? ' · ' + esc(l.done_by) : ''}</span>` : l.due_date ? ` <span class="text-muted">due ${esc(l.due_date)}</span>` : ''}</div>`).join('')}` : ''}</div>
      </div>
      ${r.canAssets ? `<h4 class="pv-h">💻 Assets (${r.assets.length})</h4>
      ${r.assets.length ? `<table class="nm-vt"><thead><tr><th>Asset</th><th>Type</th><th>Model</th><th>Serial</th><th>Status</th><th>Since</th></tr></thead><tbody>
        ${r.assets.map(a => `<tr><td><a href="/inventory.html?view=${a.id}">${esc(a.asset_s4 || a.asset_code || '#' + a.id)}</a></td><td>${esc(a.asset_type)}</td><td>${esc(a.brand_model)}</td><td class="si-sn">${esc(a.serial_no)}</td><td>${esc(a.status)}</td><td>${esc(a.date_assigned)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">No asset has this person as AD Name.</p>'}
      <h4 class="pv-h">📱 Intune / Entra devices (${r.devices.length})</h4>
      ${r.devices.length ? `<table class="nm-vt"><thead><tr><th>Device</th><th>Model</th><th>OS</th><th>Compliant</th><th>Last check-in / sign-in</th><th>Asset</th></tr></thead><tbody>
        ${r.devices.map(d => `<tr><td>${esc(d.name)}${d.in_intune ? '' : ' <span class="text-muted text-sm">(Entra only)</span>'}</td><td>${esc(d.model)}</td><td>${esc([d.os, d.os_version].filter(Boolean).join(' '))}</td>
          <td>${d.is_compliant === 1 ? '✔' : d.is_compliant === 0 ? '<span style="color:#b91c1c">✘</span>' : ''}</td><td>${esc(d10(d.last_checkin || d.last_sign_in))}</td>
          <td>${d.asset_id ? `<a href="/inventory.html?view=${d.asset_id}">#${d.asset_id}</a>` : '<span class="text-muted text-sm">not linked</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">No device in the latest Intune / Entra upload.</p>'}
      <h4 class="pv-h">✍ Signed handovers &amp; returns (${r.docs.length})</h4>
      ${r.docs.length ? r.docs.map(d => `<div class="pv-doc">${d.kind === 'return' ? '↩ Return' : '✍ Handover'} · ${esc(d10(d.signed_at))} · <a href="/inventory.html?view=${d.asset_id}">asset #${d.asset_id}</a> · by ${esc(d.created_by)} · <a href="/api/custody/doc/${d.id}.pdf" target="_blank" rel="noopener">PDF</a>${d.note ? ' · ' + esc(d.note) : ''}</div>`).join('') : '<p class="text-muted text-sm">None yet.</p>'}
      ${r.confirmations.length ? `<h4 class="pv-h">📨 My devices answers</h4>${r.confirmations.map(c => `<div class="pv-doc">${c.result === 'have' ? '✔ has' : '✘ not with them'} · ${esc(c.asset_label)} · ${esc(d10(c.confirmed_at))}${c.note ? ' · ' + esc(c.note) : ''}</div>`).join('')}` : ''}` : ''}
      ${r.history.length ? `<h4 class="pv-h">🕓 Changes</h4>${r.history.map(h => `<div class="pv-doc">${esc(String(h.created_at).slice(0, 16))} · ${esc(h.details)} · ${esc(h.username)}</div>`).join('')}` : ''}`;
  }
  window.PersonView = { open: openPerson };

  // ── 🕑 Asset timeline (inside the asset detail) ───────────────────────────
  const TL_ICON = { bought: '🛒', created: '➕', holder: '👤', status: '🔁', lock: '🔒', warranty: '🛡', 'warranty-end': '🛡', edit: '✏️', handover: '✍', return: '↩',
    repair: '🔧', scan: '📷', photo: '🖼', confirm: '📨', delete: '🗑', restore: '♻', print: '🖨', unlock: '🔓', stocktake: '📦', dispose: '♻', reuse: '🔄' };
  async function timelineHtml(assetId) {
    let r; try { r = await apiGet(`/api/lookup/asset/${assetId}/timeline`); } catch { return '<p class="text-muted text-sm">Could not load the timeline.</p>'; }
    if (!r.events.length && !r.earlier.length) return '<p class="text-muted text-sm">Nothing recorded yet.</p>';
    return `<div class="atl">${r.events.map(e => `<div class="atl-e ${e.future ? 'fut' : ''}"><span class="atl-i">${TL_ICON[e.kind] || '•'}</span><span class="atl-d">${esc(e.at.slice(0, 10))}</span>
      <span class="atl-t">${esc(e.text)}${e.url ? ` · <a href="${e.url}" target="_blank" rel="noopener">PDF</a>` : ''}</span></div>`).join('')}
      ${r.earlier.length ? `<div class="atl-e"><span class="atl-i">👥</span><span class="atl-d">earlier</span><span class="atl-t">Earlier holders / notes: ${r.earlier.map(esc).join(' → ')}</span></div>` : ''}</div>`;
  }
  window.AssetTimeline = { html: timelineHtml };
})();
