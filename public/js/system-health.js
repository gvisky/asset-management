/* System Health page — live status pushed by the office collectors (see /collector).
   Refreshes every 30 s. Team IT only; IT admins can add / revoke / delete collectors. */

const HL_REFRESH_MS = 30000;
const HL = { up: ['#16a34a', 'Up'], warn: ['#d97706', 'Warning'], down: ['#dc2626', 'Down'], stale: ['#9ca3af', 'No data'], unknown: ['#9ca3af', 'Unknown'] };
const hEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const utc = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z') : null);
function ago(s) {
  const d = utc(s); if (!d) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
const since = (s) => ago(s).replace(' ago', '');
const localTime = (s) => { const d = utc(s); return d ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
const mbps = (b) => (b == null ? '—' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' G' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' M' : b >= 1e3 ? Math.round(b / 1e3) + ' k' : Math.round(b) + ' ');
const pill = (st) => { const [c, l] = HL[st] || HL.unknown; return `<span class="hl-pill" style="--hl:${c}">${l}</span>`; };

let hlData = null, hlTimer = null;

async function loadHealth() {
  try {
    hlData = await apiGet('/api/health');
    renderHealth();
    document.getElementById('hl-updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB');
  } catch (e) {
    let m = 'Could not load System Health.';
    try { m = JSON.parse(e.message).error || m; } catch { /* keep */ }
    document.getElementById('hl-sites').innerHTML = `<div class="card"><div class="card-body text-muted">${hEsc(m)}</div></div>`;
  }
}

function renderHealth() {
  const { collectors, checks, events, canManage } = hlData;
  document.getElementById('btn-add-col').style.display = canManage ? '' : 'none';
  document.getElementById('hl-empty').style.display = checks.length ? 'none' : '';

  // Tiles: Systems / Up / Warning / Down / No data, split by country.
  const colById = new Map(collectors.map(c => [c.id, c]));
  const countryOf = (ch) => (colById.get(ch.collector_id) || {}).country || 'Unknown';
  const order = kpiCountryOrder(checks.reduce((m, ch) => { m[countryOf(ch)] = (m[countryOf(ch)] || 0) + 1; return m; }, {}));
  const tile = (label, color, test) => {
    const rows = checks.filter(test);
    const per = rows.reduce((m, ch) => { m[countryOf(ch)] = (m[countryOf(ch)] || 0) + 1; return m; }, {});
    return { label, color, value: rows.length, onClick: () => scrollToStatus(test),
      splits: order.map(c => ({ country: c, count: per[c] || 0, onClick: () => scrollToStatus(test) })) };
  };
  renderKpiTiles('hl-tiles', [
    tile('Systems', '#1a56db', () => true),
    tile('Up', '#16a34a', ch => ch.shown_status === 'up'),
    tile('Warning', '#d97706', ch => ch.shown_status === 'warn'),
    tile('Down', '#dc2626', ch => ch.shown_status === 'down'),
    tile('No data', '#9ca3af', ch => ch.shown_status === 'stale' || ch.shown_status === 'unknown'),
  ]);

  // One card per collector (site); worst status first inside each card.
  const rank = { down: 0, warn: 1, stale: 2, unknown: 3, up: 4 };
  document.getElementById('hl-sites').innerHTML = collectors.filter(c => !c.revoked || checks.some(ch => ch.collector_id === c.id)).map(col => {
    const mine = checks.filter(ch => ch.collector_id === col.id).sort((a, b) => (rank[a.shown_status] - rank[b.shown_status]) || a.name.localeCompare(b.name));
    if (!mine.length) return '';
    return `<div class="card" style="margin-bottom:18px">
      <div class="card-header">
        <span class="card-title">${hEsc(col.site || col.name)}${col.country ? ` <span class="text-muted text-sm">· ${hEsc(col.country)}</span>` : ''}</span>
        <span class="text-sm ${col.online ? 'text-muted' : ''}" style="${col.online ? '' : 'color:#dc2626;font-weight:600'}">
          ${col.revoked ? 'collector revoked' : col.online ? `● collector online · ${hEsc(col.name)}` : `⚠ collector offline — last report ${ago(col.last_seen_at)}`}</span>
      </div>
      <div class="hl-grid">${mine.map(checkCard).join('')}</div>
    </div>`;
  }).join('');

  // Status changes
  const nameOf = (id) => { const c = colById.get(id); return c ? (c.site || c.name) : ''; };
  document.getElementById('hl-events').innerHTML = events.length ? events.map(e => `<tr>
      <td class="text-sm" style="white-space:nowrap">${localTime(e.created_at)}</td>
      <td class="text-sm"><b>${hEsc(e.name)}</b><div class="text-muted">${hEsc(nameOf(e.collector_id))}</div></td>
      <td class="text-sm" style="white-space:nowrap">${e.from_status === 'new' ? 'added' : pill(e.from_status)} → ${pill(e.to_status)}</td>
      <td class="text-sm text-muted">${hEsc(e.summary)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty-state">No changes yet.</td></tr>';

  // Collectors
  document.getElementById('hl-collectors').innerHTML = collectors.length ? collectors.map(c => `<tr>
      <td><b>${hEsc(c.name)}</b>${c.revoked ? ' <span class="badge badge-retired">revoked</span>' : ''}</td>
      <td class="text-sm">${hEsc([c.site, c.country].filter(Boolean).join(' · ')) || '—'}</td>
      <td class="text-sm">${c.revoked ? '—' : c.online ? `<span style="color:#16a34a">● ${ago(c.last_seen_at)}</span>` : `<span style="color:#dc2626">${c.last_seen_at ? ago(c.last_seen_at) : 'never'}</span>`}</td>
      <td class="text-sm text-muted">${hEsc(c.version || '—')}${c.last_ip ? ' · ' + hEsc(c.last_ip) : ''}</td>
      <td style="white-space:nowrap">${canManage ? `${c.revoked ? '' : `<button class="btn btn-ghost btn-sm" onclick="revokeCollector(${c.id}, ${jsArg(c.name)})">Revoke key</button>`}
        <button class="btn btn-ghost btn-sm" onclick="deleteCollector(${c.id}, ${jsArg(c.name)})">Delete</button>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty-state">No collectors yet${canManage ? ' — click ➕ Add collector.' : '.'}</td></tr>`;
}

function checkCard(ch) {
  const st = ch.shown_status;
  const [color] = HL[st] || HL.unknown;
  const d = ch.detail || {};
  const ifaces = Array.isArray(d.interfaces) ? d.interfaces : [];
  const ifRows = ifaces.map(i => {
    const ok = i.oper === 'up';
    const c = ok ? '#16a34a' : (i.required ? '#dc2626' : '#9ca3af');
    return `<div class="hl-if"><span class="hl-dot" style="background:${c}"></span><span class="hl-if-name" title="${hEsc(i.name)}${i.alias ? ' · ' + hEsc(i.alias) : ''}">${hEsc(i.label)}</span>
      ${ok ? `<span class="hl-rate">↓ ${mbps(i.inBps)}bps</span><span class="hl-rate">↑ ${mbps(i.outBps)}bps</span>`
           : `<span class="hl-rate" style="color:${c}">${i.oper === 'missing' ? 'not found' : 'down'}</span><span></span>`}</div>`;
  }).join('');
  return `<div class="hl-card hl-${st}" style="--hl:${color}" data-status="${st}">
    <div class="hl-head"><span class="hl-name">${hEsc(ch.name)}</span>${pill(st)}</div>
    <div class="hl-summary">${hEsc(st === 'stale' ? `No report for ${since(ch.last_seen_at)} — last: ${ch.summary}` : ch.summary) || '&nbsp;'}</div>
    ${d.uptime ? `<div class="hl-meta">Up time <b>${hEsc(d.uptime)}</b>${d.sysName ? ` · ${hEsc(d.sysName)}` : ''}</div>` : ''}
    ${ifRows ? `<div class="hl-ifs">${ifRows}</div>` : ''}
    <div class="hl-foot"><span>${hEsc(ch.kind.toUpperCase())} · ${hEsc(ch.target)}</span><span title="Status since ${localTime(ch.status_since)}">${HL[st] ? HL[st][1] : st} for ${since(ch.status_since)}</span></div>
  </div>`;
}

function scrollToStatus(test) {
  const first = hlData.checks.find(test);
  if (!first) return;
  const el = [...document.querySelectorAll('.hl-card')].find(x => x.dataset.status === first.shown_status);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('hl-flash'); setTimeout(() => el.classList.remove('hl-flash'), 1500); }
}

// ── Collectors (IT admin) ─────────────────────────────────────────────────────
function setupCollectorModal() {
  const ov = document.getElementById('col-overlay');
  const body = document.getElementById('col-body');
  const save = document.getElementById('col-save');
  const form = body.innerHTML;
  const close = () => { ov.classList.remove('open'); body.innerHTML = form; save.style.display = ''; loadHealth(); };
  document.getElementById('btn-add-col').addEventListener('click', () => {
    body.innerHTML = form; save.style.display = '';
    if (typeof fillCountrySelects === 'function') fillCountrySelects(body);
    ov.classList.add('open');
    document.getElementById('col-name').focus();
  });
  save.addEventListener('click', async () => {
    const name = document.getElementById('col-name').value.trim();
    if (!name) { showToast('Give the collector a name', 'error'); return; }
    save.disabled = true;
    try {
      const r = await apiPost('/api/health/collectors', { name, site: document.getElementById('col-site').value.trim(),
        country: document.getElementById('col-country').value });
      save.style.display = 'none';
      body.innerHTML = `<p class="text-sm" style="margin-top:0">✅ Collector <b>${hEsc(r.name)}</b> created. Put this key in <code>config.json</code> on the office PC
        (<code>"key": "…"</code>). <b>It is shown only once.</b></p>
        <div style="display:flex;gap:8px"><input class="form-control" id="col-key" readonly value="${hEsc(r.key)}" style="font-family:monospace">
        <button class="btn btn-primary btn-sm" id="col-copy">Copy</button></div>
        <p class="text-muted text-sm">Next: on the PC run <code>npm install</code>, <code>node collector.js --once</code> to test, then <code>install-windows.ps1</code>. Steps: <code>collector/README.md</code>.</p>`;
      document.getElementById('col-copy').addEventListener('click', async () => {
        const inp = document.getElementById('col-key'); inp.select();
        try { await navigator.clipboard.writeText(inp.value); } catch { document.execCommand('copy'); }
        showToast('Key copied');
      });
    } catch (err) {
      let m = 'Could not create the collector'; try { m = JSON.parse(err.message).error || m; } catch { /* keep */ }
      showToast(m, 'error');
    } finally { save.disabled = false; }
  });
  document.getElementById('col-close').addEventListener('click', close);
  document.getElementById('col-cancel').addEventListener('click', close);
}

async function revokeCollector(id, name) {
  if (!confirm(`Revoke the key of "${name}"? That PC can no longer send checks (its last results stay until you delete it).`)) return;
  try { await apiPost(`/api/health/collectors/${id}/revoke`, {}); showToast('Key revoked'); loadHealth(); }
  catch { showToast('Could not revoke', 'error'); }
}
async function deleteCollector(id, name) {
  if (!confirm(`Delete "${name}" and all its checks and history?`)) return;
  try { await apiDelete(`/api/health/collectors/${id}`); showToast('Collector deleted'); loadHealth(); }
  catch { showToast('Could not delete', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  // IT team only.
  setTimeout(() => { const u = window.CURRENT_USER; if (u && u.team !== 'IT') window.location.href = '/'; }, 400);
  loadHealth();
  setupCollectorModal();
  if (typeof loadAlertButton === 'function') loadAlertButton('alert-btn-slot', '');
  document.getElementById('btn-refresh').addEventListener('click', loadHealth);
  hlTimer = setInterval(() => { if (!document.hidden) loadHealth(); }, HL_REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadHealth(); });
});
