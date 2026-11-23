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
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  };

  // [group, id, href, label, icon, show(f), also-active paths]
  function items(f) {
    return [
      ['Home', 'nav-dashboard', '/', 'Overview', 'home', f.asset],
      ['Home', 'nav-home', '/home.html', 'Overview', 'home', !f.asset && (f.hr || f.ot || f.net)],
      ['Home', 'nav-alerts', '/inbox.html', 'Inbox', 'inbox', !f.viewer && (f.asset || f.it || f.hr)],
      ['Home', 'nav-otna', '/ot-attention.html', 'Inbox', 'inbox', f.ot],
      ['End-user IT', 'nav-inventory', '/inventory.html', 'Assets', 'laptop', f.asset, ['/scan.html']],
      ['End-user IT', 'nav-devices', '/devices.html', 'Devices', 'phone', f.asset],
      ['End-user IT', 'nav-licenses', '/licenses.html', 'Licenses', 'badge', f.asset],
      ['End-user IT', 'nav-maintenance', '/maintenance.html', 'Maintenance', 'wrench', f.asset],
      ['End-user IT', 'nav-stocktake', '/stocktake.html', 'Stocktake', 'qr', f.asset, ['/labels.html']],
      ['End-user IT', 'nav-labels', '/labels.html', 'QR labels', 'qr', f.asset, [], 'tab'],
      ['People', 'nav-userinv', '/user-inventory.html', 'Users', 'users', f.it || f.hr, ['/leavers.html']],
      ['People', 'nav-leavers', '/leavers.html', 'Leavers', 'leave', f.it || f.hr, [], 'tab'],
      ['Infrastructure', 'nav-servers', '/server-inventory.html', f.ot ? 'OT devices' : f.net ? 'Network devices' : 'Servers & network', 'server', f.asset || f.ot || f.net],
      ['Infrastructure', 'nav-netmap', '/network-map.html', 'Network map', 'net', f.asset || f.ot || f.net],
      ['Infrastructure', 'nav-otrep', '/ot-reports.html', f.ot ? 'OT reports' : 'OT', 'factory', f.ot || f.net || f.it, f.ot ? ['/ot-activity.html'] : ['/ot-attention.html', '/ot-activity.html']],
      ['Infrastructure', 'nav-otna-it', '/ot-attention.html', 'OT needs attention', 'inbox', f.it, [], 'tab'],
      ['Infrastructure', 'nav-otact', '/ot-activity.html', 'OT activity', 'clock', f.otAdmin || (f.it && (f.admin || f.editor)), [], 'tab'],
      ['Infrastructure', 'nav-health', '/system-health.html', 'Monitoring', 'pulse', f.it],
      ['Finance', 'nav-budget', '/budget.html', 'Budget', 'money', f.itAdmin],
      ['Insights', 'nav-reports', '/reports.html', 'Reports', 'report', f.asset, ['/kpi.html']],
      ['Insights', 'nav-kpi', '/kpi.html', 'KPIs', 'kpi', f.asset, [], 'tab'],
      ['Admin', 'nav-users', '/users.html', 'Users & access', 'lock', f.globalAdmin],
      ['Admin', 'nav-bin', '/deleted.html', 'Recycle bin', 'bin', f.admin],
      ['Admin', 'nav-settings', '/settings.html', 'Settings', 'gear', f.admin && !f.ot && !f.net],
    ];
  }
  function flags(u) {
    const team = u.team || '';
    const admin = u.role === 'admin';
    return {
      asset: Number(u.asset_access) !== 0, viewer: u.role === 'viewer', it: team === 'IT', hr: team === 'HR', ot: team === 'OT', net: team === 'NET',
      otAdmin: !!u.ot_admin, admin, editor: u.role === 'editor', itAdmin: team === 'IT' && admin, globalAdmin: admin && !String(u.country || '').trim(),
    };
  }

  let current = null;   // { group, label }
  let allowed = new Set();   // pages this account may open (menu + tab-only)
  // Families of pages shown as one set of tabs (docs/UX-REDESIGN.md, phase 4). Each page keeps its address.
  const FAMILIES = [
    [['/user-inventory.html', 'Users'], ['/leavers.html', 'Leavers']],
    [['/reports.html', 'Reports'], ['/kpi.html', 'KPIs']],
    [['/stocktake.html', 'Stocktake'], ['/labels.html', 'QR labels']],
    [['/ot-reports.html', 'OT reports'], ['/ot-attention.html', 'OT needs attention'], ['/ot-activity.html', 'OT activity']],
  ];
  function buildTabs() {
    const main = document.querySelector('main.content');
    if (!main || main.querySelector('.pg-tabs')) return;
    const path = location.pathname;
    const fam = FAMILIES.find(f => f.some(([h]) => h === path));
    if (!fam) return;
    const vis = fam.filter(([h]) => allowed.has(h));
    if (vis.length < 2) return;
    const nav = document.createElement('nav');
    nav.className = 'pg-tabs'; nav.setAttribute('aria-label', 'Pages');
    nav.innerHTML = vis.map(([h, l]) => `<a href="${h}"${h === path ? ' class="on" aria-current="page"' : ''}>${l}</a>`).join('');
    main.insertBefore(nav, main.firstChild);
  }
  function buildNav(u) {
    const nav = document.querySelector('.sidebar nav');
    if (!nav) return;
    const f = flags(u), path = location.pathname === '/index.html' ? '/' : location.pathname;
    const list = items(f).filter(x => x[5]);
    const menu = list.filter(x => x[7] !== 'tab');   // tab-only pages are reached from their family's tabs
    const act = menu.find(x => x[2] === path) || menu.find(x => (x[6] || []).includes(path));
    current = act ? { group: act[0], label: act[3] } : null;
    allowed = new Set(list.map(x => x[2]));
    let html = '', grp = '';
    for (const [g, id, href, label, icon] of menu) {
      if (g !== grp) { html += `<div class="nav-section-label">${g}</div>`; grp = g; }
      html += `<a href="${href}" class="nav-link${act && act[1] === id ? ' active' : ''}" id="${id}">${ico(I[icon])}<span>${label}</span></a>`;
    }
    nav.innerHTML = html;
    // Inbox count on the menu (GET /api/inbox?count=1 — cached on the server for 2 minutes).
    if (document.getElementById('nav-alerts') && location.pathname !== '/inbox.html') {
      setTimeout(() => fetch('/api/inbox?count=1').then(r => (r.ok ? r.json() : null)).then(d => d && setInboxCount(d.total)).catch(() => {}), 1200);
    }
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

  // ── What's new (avatar menu): /data/app-updates.json, a dot while something new is unread ────────────────
  const SEEN = 'hc-news-seen';
  let news = null;
  async function loadNews() {
    if (news) return news;
    try { news = (await (await fetch('/data/app-updates.json', { cache: 'no-store' })).json()).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))); }
    catch { news = []; }
    return news;
  }
  const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const e = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function openNews() {
    const list = await loadNews();
    let seen = ''; try { seen = localStorage.getItem(SEEN) || ''; } catch { /* ignore */ }
    let ov = document.getElementById('news-ov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'news-ov'; ov.className = 'modal-overlay'; ov.setAttribute('data-drawer', '');
      ov.innerHTML = `<div class="modal"><div class="modal-header"><span class="modal-title">What's new</span><button class="modal-close" aria-label="Close">✕</button></div><div class="modal-body news-body"></div></div>`;
      ov.querySelector('.modal-close').onclick = () => ov.classList.remove('open');
      ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.classList.remove('open'); });
      document.body.appendChild(ov);
    }
    ov.querySelector('.news-body').innerHTML = list.length ? list.slice(0, 40).map(u => `<div class="news-item">
        <div class="news-date">${e(fmtD(u.date))}${u.date > seen ? ' <span class="badge badge-active">New</span>' : ''}</div>
        <div class="news-title">${e(u.title)}</div>${(u.items || []).length ? `<ul>${u.items.map(i => `<li>${e(i)}</li>`).join('')}</ul>` : ''}</div>`).join('')
      : '<p class="text-muted">No updates yet.</p>';
    ov.classList.add('open');
    if (list[0]) { try { localStorage.setItem(SEEN, list[0].date); } catch { /* ignore */ } }
    document.querySelectorAll('.news-dot').forEach(d => d.remove());
  }
  async function buildNews() {
    const menu = document.querySelector('#user-chrome .uc-menu');
    if (!menu || document.getElementById('news-btn')) return;
    const b = document.createElement('button');
    b.className = 'btn btn-ghost btn-sm'; b.id = 'news-btn'; b.setAttribute('role', 'menuitem');
    b.innerHTML = `${ico('<path d="M12 2l2.4 5.6L20 8l-4.4 3.9L17 18l-5-3-5 3 1.4-6.1L4 8l5.6-.4z"/>')} What's new`;
    b.onclick = () => { document.getElementById('user-chrome').classList.remove('open'); openNews(); };
    const pw = document.getElementById('mfa-btn-open');
    menu.insertBefore(b, pw || null);
    const list = await loadNews();
    let seen = ''; try { seen = localStorage.getItem(SEEN) || ''; } catch { /* ignore */ }
    const fresh = list.filter(u => u.date > seen && Date.now() - new Date(u.date + 'T00:00:00').getTime() < 14 * 86400000).length;
    if (fresh) {
      b.insertAdjacentHTML('beforeend', `<span class="uc-tag news-dot" style="background:#dbeafe;color:#1d4ed8">${fresh} new</span>`);
      const av = document.getElementById('uc-avatar'); if (av) av.insertAdjacentHTML('beforeend', '<i class="news-dot av-dot"></i>');
    }
  }

  // ── Phone bottom bar (phase 6): the field-work shortcuts, by team. "More" opens the side menu. ─────────────
  const B = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  };
  function buildBottomBar(u) {
    if (document.getElementById('bb')) return;
    const f = flags(u);
    let list;
    if (f.ot) list = [['/home.html', 'Home', B.home], ['/ot-attention.html', 'Inbox', I.inbox], ['/network-map.html', 'Map', I.net], ['/server-inventory.html', 'Devices', I.server]];
    else if (f.net) list = [['/home.html', 'Home', B.home], ['/server-inventory.html', 'Devices', I.server], ['/network-map.html', 'Map', I.net]];
    else if (!f.asset) list = [['/home.html', 'Home', B.home], ['#search', 'Search', B.search]].concat(!f.viewer ? [['/inbox.html', 'Inbox', I.inbox]] : []).concat([['/user-inventory.html', 'Users', I.users]]);
    else list = [['#scan', 'Scan', B.scan], ['#search', 'Search', B.search]].concat(!f.viewer ? [['/inbox.html', 'Inbox', I.inbox]] : [['/', 'Home', B.home]]).concat([['/network-map.html', 'Map', I.net]]);
    list.push(['#more', 'More', B.more]);
    const path = location.pathname;
    const bar = document.createElement('nav');
    bar.id = 'bb'; bar.className = 'bb'; bar.setAttribute('aria-label', 'Shortcuts');
    bar.innerHTML = list.map(([h, l, icon]) => `<a href="${h.startsWith('#') ? '#' : h}" data-k="${h}"${h === path ? ' class="on" aria-current="page"' : ''}>${ico(icon).replace('width="16" height="16"', 'width="22" height="22"')}<span>${l}</span>${l === 'Inbox' ? '<i class="bb-n" hidden></i>' : ''}</a>`).join('');
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-k]'); if (!a || !a.dataset.k.startsWith('#')) return;
      e.preventDefault();
      if (a.dataset.k === '#more') { const t = document.querySelector('.menu-toggle'); if (t) t.click(); }
      if (a.dataset.k === '#search') { if (window.GlobalSearch) GlobalSearch.open(); }
      if (a.dataset.k === '#scan') openScanner();
    });
    document.body.appendChild(bar);
    document.documentElement.classList.add('has-bb');
  }
  // Full-screen camera scanner: an asset QR label (/scan.html?a=<id>) opens that asset; anything else
  // (serial, asset code, other text) goes to the global search.
  let scanStop = null;
  async function openScanner() {
    let ov = document.getElementById('scan-ov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'scan-ov'; ov.className = 'scan-ov';
      ov.innerHTML = `<video playsinline muted></video><div class="scan-frame"></div>
        <div class="scan-top"><b>Scan a QR label</b><button type="button" aria-label="Close">✕</button></div>
        <div class="scan-msg">Point the camera at an asset's QR label, a serial or asset-code barcode.</div>`;
      document.body.appendChild(ov);
      ov.querySelector('.scan-top button').onclick = closeScanner;
    }
    ov.classList.add('open');
    const msg = ov.querySelector('.scan-msg');
    try {
      if (!window.startQrScanner) await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = '/js/qr-scan.js?v=20261124b'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
      scanStop = await startQrScanner(ov.querySelector('video'), (code) => {
        const m = String(code).match(/\/scan\.html\?a=(\d+)/);
        closeScanner();
        if (m) { location.href = '/scan.html?a=' + m[1]; return; }
        if (window.GlobalSearch) GlobalSearch.open(String(code).trim().slice(0, 80));
      });
    } catch (err) { msg.textContent = (err && err.message) || 'The camera could not start.'; }
  }
  function closeScanner() {
    const ov = document.getElementById('scan-ov'); if (ov) ov.classList.remove('open');
    if (scanStop) { try { scanStop(); } catch { /* ignore */ } scanStop = null; }
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

  function setInboxCount(n) {
    const l = document.getElementById('nav-alerts'); if (!l) return;
    let b = l.querySelector('.nav-cnt');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'nav-cnt'; l.appendChild(b); }
    b.textContent = n > 999 ? '999+' : String(n);
    const bn = document.querySelector('#bb .bb-n'); if (bn) { bn.textContent = n > 99 ? '99+' : String(n); bn.hidden = false; }
  }

  window.Shell = {
    setInboxCount, openNews,
    build(u) { try { buildNav(u); buildTabs(); buildTopbar(u); buildNews(); buildBottomBar(u); } catch (e) { document.documentElement.classList.add('shell-ready'); console.error('shell', e); } },
    getScope, setScope, current: () => current,
  };
  // Safety: never leave the menu hidden.
  setTimeout(() => document.documentElement.classList.add('shell-ready'), 4000);
})();
