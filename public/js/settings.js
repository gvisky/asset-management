/* Settings (docs/UX-REDESIGN.md, phase 2): the configuration that was spread over Users & Audit, KPIs and System
   Health, in one place. Each section uses its own API and permission; a section the account may not change is
   shown read-only (or explains who can change it). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errMsg = (e, d) => { try { return JSON.parse(e.message).error || d; } catch { return d; } };
  const ago = (s) => { if (s == null) return 'never'; s = Number(s); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
  const row = (k, v) => `<div class="st-kv"><span>${k}</span><b>${v}</b></div>`;

  // ── Security: two-step login for everyone (global admin) ──────────────────────────────────────────────
  async function security(u) {
    const box = $('st-security-b');
    const global = u.role === 'admin' && !String(u.country || '').trim();
    if (!global) { box.innerHTML = '<p class="text-muted text-sm">Only a global admin changes the security settings.</p>'; return; }
    let p;
    try { p = await apiGet('/api/users/mfa-policy'); } catch { box.innerHTML = '<p class="text-muted text-sm">Could not load.</p>'; return; }
    const off = p.users - p.enabled;
    box.innerHTML = `
      <label class="st-switch"><input type="checkbox" id="st-mfa"${p.required ? ' checked' : ''}><span></span>
        <div><b>Two-step login required for everyone</b><div class="text-muted text-sm">Password + a 6-digit code from Google / Microsoft Authenticator. Users cannot turn it off for themselves.</div></div></label>
      <div class="st-stats">${row('Accounts', p.users)}${row('With two-step login', `<span style="color:#15803d">${p.enabled}</span>`)}${row('Not set up yet', off ? `<span style="color:#b45309">${off}</span>` : '0')}</div>
      <p class="text-sm" style="margin-top:10px"><a href="/users.html">Logins, roles, teams and "Reset 2-step" → Users &amp; access</a></p>`;
    $('st-mfa').addEventListener('change', async (e) => {
      const on = e.target.checked;
      if (!on && !confirm('Make two-step login optional? Accounts will be protected by a password only, until each person sets it up.')) { e.target.checked = true; return; }
      try { await apiPut('/api/users/mfa-policy', { required: on }); showToast(on ? 'Two-step login is required for everyone' : 'Two-step login is optional'); }
      catch (err) { e.target.checked = !on; showToast(errMsg(err, 'Could not save'), 'error'); }
    });
  }

  // ── Assets: depreciation years per country (global IT admin) ──────────────────────────────────────────
  async function assets() {
    const box = $('st-assets-b');
    let d;
    try { d = await apiGet('/api/kpi/depreciation-years'); } catch { box.innerHTML = '<p class="text-muted text-sm">Not available for this account.</p>'; return; }
    const keys = ['default', ...Object.keys(d.years).filter(k => k !== 'default')];
    let countries = [];
    try { countries = (await getCountries()).core || []; } catch { /* ignore */ }
    countries.forEach(c => { if (!keys.includes(c)) keys.push(c); });
    box.innerHTML = `<p class="text-muted text-sm" style="margin:0 0 10px">Straight-line from the purchase date. Used by KPIs (book value, fully depreciated) and reports.
        Vietnam: Circular 45/2013 allows 3–8 years for IT equipment.</p>
      <div class="st-years">${keys.map(k => `<label><span>${k === 'default' ? 'Default (other countries)' : esc(k)}</span>
        <input class="form-control" type="number" min="1" max="20" step="0.5" data-k="${esc(k)}" value="${d.years[k] != null ? esc(d.years[k]) : ''}" placeholder="${esc(d.years.default)}"${d.canEdit ? '' : ' disabled'}> <em>years</em></label>`).join('')}</div>
      ${d.canEdit ? '<div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="st-years-save">Save</button></div>' : '<p class="text-muted text-sm" style="margin-top:10px">Only a global IT admin changes these.</p>'}`;
    const b = $('st-years-save');
    if (b) b.addEventListener('click', async () => {
      const body = {};
      box.querySelectorAll('input[data-k]').forEach(i => { if (i.value !== '') body[i.dataset.k] = Number(i.value); });
      try { await apiPut('/api/kpi/depreciation-years', body); showToast('Depreciation years saved'); assets(); }
      catch (e) { showToast(errMsg(e, 'Could not save'), 'error'); }
    });
  }

  // ── Monitoring: collectors (read here, managed on Monitoring) ─────────────────────────────────────────
  async function monitoring(u) {
    const box = $('st-monitoring-b');
    if (u.team !== 'IT') { box.innerHTML = '<p class="text-muted text-sm">Monitoring is managed by the IT team.</p>'; return; }
    let d;
    try { d = await apiGet('/api/health'); } catch { box.innerHTML = '<p class="text-muted text-sm">Could not load.</p>'; return; }
    const cols = d.collectors || [];
    if (!cols.length) { box.innerHTML = '<p class="text-muted text-sm">No collectors yet. Add one on the Monitoring page.</p>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Collector</th><th>Site</th><th>Country</th><th>Status</th><th>Last report</th><th>Version</th></tr></thead><tbody>
      ${cols.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.site || '—')}</td><td>${esc(c.country || '—')}</td>
        <td>${c.revoked ? '<span class="badge badge-retired">Revoked</span>' : c.online ? '<span class="badge badge-active">Reporting</span>' : '<span class="badge badge-broken">Not reporting</span>'}</td>
        <td>${esc(ago(c.age_s))}</td><td>${esc(c.version || '—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ── Countries ─────────────────────────────────────────────────────────────────────────────────────────
  async function countries(u) {
    const box = $('st-countries-b');
    let d;
    try { d = await getCountries(); } catch { box.innerHTML = '<p class="text-muted text-sm">Could not load.</p>'; return; }
    const core = d.core || [];
    box.innerHTML = `<p class="text-muted text-sm" style="margin:0 0 10px">Countries come from the data (assets, people, servers). ${d.scoped ? 'Your account covers: <b>' + esc((d.countries || []).join(', ')) + '</b>.' : 'Your account covers every country.'}</p>
      <div class="st-chips">${(d.all || []).map(c => `<span class="st-chip${core.includes(c) ? ' core' : ''}">${esc(c)}</span>`).join('')}</div>
      <p class="text-muted text-sm" style="margin-top:8px">Blue = main countries (always shown first). The country switch in the top bar applies one of these to every page.</p>`;
  }

  // ── System ────────────────────────────────────────────────────────────────────────────────────────────
  async function system() {
    const box = $('st-system-b');
    let d;
    try { d = await apiGet('/api/settings/system'); } catch { box.innerHTML = '<p class="text-muted text-sm">Admins only.</p>'; return; }
    const up = d.uptime_s > 86400 ? `${Math.floor(d.uptime_s / 86400)} d ${Math.floor(d.uptime_s % 86400 / 3600)} h` : `${Math.floor(d.uptime_s / 3600)} h ${Math.floor(d.uptime_s % 3600 / 60)} min`;
    box.innerHTML = `<div class="st-stats">
      ${row('Version (commit)', esc(d.commit))}${row('Running since', esc(new Date(d.started).toLocaleString()) + ` <span class="text-muted">(${up})</span>`)}
      ${row('Database', esc(d.database))}${row('Node.js', esc(d.node))}
      ${row('Login accounts', d.users)}${row('Signed-in sessions', d.sessions)}
      ${row('Device imports', d.imports.enabled ? 'On' : 'Off')}</div>
      <p class="text-muted text-sm" style="margin-top:10px">Backups: deploy/backup.sh on the server (every night once its cron job is set up — deploy/DEPLOY-UBUNTU.md step 7). The Turso copy is kept as a backup.</p>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const t = setInterval(() => {
      const u = window.CURRENT_USER; if (!u) return; clearInterval(t);
      if (u.role !== 'admin') { location.href = '/'; return; }
      security(u); assets(); monitoring(u); countries(u); system();
    }, 100);
    // Left section list: highlight the section in view.
    const links = [...document.querySelectorAll('#st-nav a')];
    const mark = () => {
      const cards = [...document.querySelectorAll('.st-card')];
      let cur = cards[0];
      for (const c of cards) if (c.getBoundingClientRect().top <= 130) cur = c;
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) cur = cards[cards.length - 1];
      links.forEach(l => l.classList.toggle('on', l.getAttribute('href') === '#' + cur.id));
    };
    window.addEventListener('scroll', mark, { passive: true }); setTimeout(mark, 300);
  });
})();
