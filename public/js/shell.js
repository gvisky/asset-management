/* App shell (docs/UX-REDESIGN.md, phase 1): one menu for every page, built from the account's role.
   - Sidebar: 7 groups (Home · End-user IT · People · Infrastructure · Finance · Insights · Admin), only the pages
     the account may open (the server enforces the same rules — lib/access.js).
   - Top bar: breadcrumb (group ›), one country switch for the whole app (remembered), the bell, the account menu.
   Called by auth.js (ensureAuth) before the older menu code, which then finds every link already in place. */
(function () {
  const ico = (d) => `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    home: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    badge: '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    leave: '<path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7"/>',
    server: '<rect x="2" y="3" width="20" height="7" rx="1.5"/><rect x="2" y="14" width="20" height="7" rx="1.5"/><path d="M6 6.5h.01M6 17.5h.01"/>',
    net: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>',
    factory: '<path d="M2 20h20M4 20V9l5 3V9l5 3V6l6 3v11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    money: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h5"/>',
    kpi: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    bin: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  };

  // [group, id, href, label, icon, show(f), also-active paths]
  function items(f) {
    return [
      ['Home', 'nav-dashboard', '/', 'Overview', 'home', f.asset],
      ['Home', 'nav-alerts', '/alerts.html', 'Needs attention', 'inbox', f.asset && !f.viewer],
      ['Home', 'nav-otna', '/ot-attention.html', 'OT needs attention', 'inbox', f.ot],
      ['End-user IT', 'nav-inventory', '/inventory.html', 'Assets', 'laptop', f.asset, ['/scan.html']],
      ['End-user IT', 'nav-devices', '/devices.html', 'Devices', 'phone', f.asset],
      ['End-user IT', 'nav-licenses', '/licenses.html', 'Licenses', 'badge', f.asset],
      ['End-user IT', 'nav-maintenance', '/maintenance.html', 'Maintenance', 'wrench', f.asset],
      ['End-user IT', 'nav-stocktake', '/stocktake.html', 'Stocktake', 'qr', f.asset, ['/labels.html']],
      ['People', 'nav-userinv', '/user-inventory.html', 'Users', 'users', f.it || f.hr],
      ['People', 'nav-leavers', '/leavers.html', 'Leavers', 'leave', f.it || f.hr],
      ['Infrastructure', 'nav-servers', '/server-inventory.html', f.ot ? 'OT devices' : f.net ? 'Network devices' : 'Servers & network', 'server', f.asset || f.ot || f.net],
      ['Infrastructure', 'nav-netmap', '/network-map.html', 'Network map', 'net', f.asset || f.ot || f.net],
      ['Infrastructure', 'nav-otrep', '/ot-reports.html', 'OT reports', 'factory', f.ot || f.net || f.it, f.ot ? [] : ['/ot-attention.html']],
      ['Infrastructure', 'nav-otact', '/ot-activity.html', 'OT activity', 'clock', f.otAdmin],
      ['Infrastructure', 'nav-health', '/system-health.html', 'Monitoring', 'pulse', f.it],
      ['Finance', 'nav-budget', '/budget.html', 'Budget', 'money', f.itAdmin],
      ['Insights', 'nav-reports', '/reports.html', 'Reports', 'report', f.asset],
      ['Insights', 'nav-kpi', '/kpi.html', 'KPIs', 'kpi', f.asset],
      ['Admin', 'nav-users', '/users.html', 'Users & access', 'lock', f.globalAdmin, ['/ot-activity.html'].filter(() => !f.otAdmin)],
      ['Admin', 'nav-bin', '/deleted.html', 'Recycle bin', 'bin', f.admin],
    ];
  }
  function flags(u) {
    const team = u.team || '';
    const admin = u.role === 'admin';
    return {
      asset: Number(u.asset_access) !== 0, viewer: u.role === 'viewer', it: team === 'IT', hr: team === 'HR', ot: team === 'OT', net: team === 'NET',
      otAdmin: !!u.ot_admin, admin, itAdmin: team === 'IT' && admin, globalAdmin: admin && !String(u.country || '').trim(),
    };
  }

  let current = null;   // { group, label }
  function buildNav(u) {
    const nav = document.querySelector('.sidebar nav');
    if (!nav) return;
    const f = flags(u), path = location.pathname === '/index.html' ? '/' : location.pathname;
    const list = items(f).filter(x => x[5]);
    const act = list.find(x => x[2] === path) || list.find(x => (x[6] || []).includes(path));
    current = act ? { group: act[0], label: act[3] } : null;
    let html = '', grp = '';
    for (const [g, id, href, label, icon] of list) {
      if (g !== grp) { html += `<div class="nav-section-label">${g}</div>`; grp = g; }
      html += `<a href="${href}" class="nav-link${act && act[1] === id ? ' active' : ''}" id="${id}">${ico(I[icon])}<span>${label}</span></a>`;
    }
    nav.innerHTML = html;
    const logo = document.querySelector('.sidebar-logo');
    if (logo) logo.innerHTML = '<a href="/" class="brand"><span class="brand-mark">H</span><span><b>Hayat IT</b><small>Communication Tools</small></span></a>';
    document.documentElement.classList.add('shell-ready');
  }

  // ── One country for the whole app (localStorage "hc-country"; "" = all countries) ──────────────────────────
  const KEY = 'hc-country';
  const getScope = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const CODE = { Vietnam: 'VN', Thailand: 'TH', Malaysia: 'MY', Turkey: 'TR', Russia: 'RU', Egypt: 'EG' };
  const code = (v) => (v ? CODE[v] || String(v).slice(0, 3).toUpperCase() : 'All');
  const setScope = (v) => {
    try { localStorage.setItem(KEY, v || ''); } catch { /* private mode */ }
    const s = document.getElementById('tb-country-sel'); if (s && s.value !== (v || '')) s.value = v || '';
    const c = document.querySelector('#tb-country .tb-cc'); if (c) c.textContent = code(v);
  };
  // Page filters that follow the switch (and update it when changed on the page).
  const PAGE_FILTERS = ['filter-country'];
  function applyToPage(v, fire) {
    for (const id of PAGE_FILTERS) {
      const el = document.getElementById(id);
      if (!el) continue;
      let n = 0;
      const t = setInterval(() => {
        if (++n > 50) return clearInterval(t);
        if (![...el.options].some(o => o.value === v)) return;
        clearInterval(t);
        if (el.value !== v) { el.value = v; if (fire) el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, 100);
      if (!el.dataset.hcScope) { el.dataset.hcScope = '1'; el.addEventListener('change', () => setScope(el.value)); }
    }
    if (typeof window.onGlobalCountry === 'function') window.onGlobalCountry(v);   // pages with their own switch (Dashboard)
  }
  async function buildCountry(bar, u) {
    const mine = String(u.country || '').split(',').map(s => s.trim()).filter(Boolean);
    const box = document.createElement('div');
    box.id = 'tb-country'; box.className = 'tb-country';
    if (mine.length === 1) {   // fixed to one country
      box.innerHTML = `${ico(I.globe)}<span>${mine[0]}</span>`;
    } else {
      let list = mine;
      if (!list.length) { try { list = (await getCountries()).countries || []; } catch { list = []; } }
      if (list.length < 2) return;
      const cur = list.includes(getScope()) ? getScope() : '';
      if (cur !== getScope()) setScope('');
      box.innerHTML = `${ico(I.globe)}<b class="tb-cc">${code(cur)}</b><select id="tb-country-sel" aria-label="Country (whole app)" title="Country for every page"><option value="">All countries</option>${list.map(c => `<option${c === cur ? ' selected' : ''}>${c}</option>`).join('')}</select>`;
      box.querySelector('select').addEventListener('change', (e) => { setScope(e.target.value); applyToPage(e.target.value, true); });
      if (cur) applyToPage(cur, true); else applyToPage('', false);
    }
    const uc = document.getElementById('user-chrome');
    bar.insertBefore(box, document.getElementById('tb-bell') || uc || null);
  }

  // ── Bell: the notifications of the account, on every page (alerts.js) ───────────────────────────────────
  function buildBell(bar) {
    let slot = document.getElementById('alert-btn-slot');
    if (!slot) { slot = document.createElement('span'); slot.id = 'alert-btn-slot'; }
    slot.classList.add('tb-bell'); slot.dataset.tbKeep = '1';
    const wrap = document.createElement('span'); wrap.id = 'tb-bell'; wrap.appendChild(slot);
    bar.insertBefore(wrap, document.getElementById('user-chrome') || null);
    const go = () => { if (!slot.innerHTML.trim()) loadAlertButton('alert-btn-slot', ''); };
    if (typeof loadAlertButton === 'function') setTimeout(go, 400);
    else { const s = document.createElement('script'); s.src = '/js/alerts.js?v=20261123s'; s.onload = () => setTimeout(go, 50); document.head.appendChild(s); }
  }

  function buildTopbar(u) {
    const bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('tb-bell')) return;
    const title = bar.querySelector('.topbar-title');
    if (title && current && !bar.querySelector('.tb-crumb')) {
      const c = document.createElement('span'); c.className = 'tb-crumb'; c.textContent = current.group;
      bar.insertBefore(c, title);
    }
    buildBell(bar);
    buildCountry(bar, u);
  }

  window.Shell = {
    build(u) { try { buildNav(u); buildTopbar(u); } catch (e) { document.documentElement.classList.add('shell-ready'); console.error('shell', e); } },
    getScope, setScope, current: () => current,
  };
  // Safety: never leave the menu hidden.
  setTimeout(() => document.documentElement.classList.add('shell-ready'), 4000);
})();
