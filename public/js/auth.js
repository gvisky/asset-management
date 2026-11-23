/* Shared auth helpers — loaded on every protected page (before app.js).
   Exposes window.CURRENT_USER and gates UI by role. */

window.CURRENT_USER = null;

// Fetch the logged-in user; redirect to login if not authenticated.
async function ensureAuth() {
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) throw new Error('not auth');
    window.CURRENT_USER = await r.json();
    // Two-step login is required and this account has not set it up yet → setup page first.
    if (window.CURRENT_USER.mfa_setup_required) { window.location.href = '/mfa-setup.html'; return null; }
    // Viewers only look: nothing of "Needs Attention" (things to fix / to add) is shown to them.
    if (window.CURRENT_USER.role === 'viewer') {
      document.documentElement.classList.add('is-viewer');
      if (window.location.pathname === '/alerts.html') { window.location.href = '/'; return null; }
    }
    renderUserChrome();
    applyRoleGates();
    applyAssetGating();
    if (window.Shell) Shell.build(window.CURRENT_USER);   // grouped menu, breadcrumb, country switch, bell (js/shell.js)
    if (!['OT', 'NET'].includes(window.CURRENT_USER.team)) loadGlobalSearch();
    return window.CURRENT_USER;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

// 🔍 Global search (Ctrl+K), 👤 person view and the asset timeline — one script for every page.
function loadGlobalSearch() {
  const ready = () => window.GlobalSearch && GlobalSearch.addButton();
  if (window.GlobalSearch) return ready();
  const s = document.createElement('script');
  s.src = '/js/global-search.js?v=20261123s'; s.onload = ready;
  document.head.appendChild(s);
}

function isAdmin()       { return window.CURRENT_USER && window.CURRENT_USER.role === 'admin'; }
function isGlobalAdmin() { return isAdmin() && !window.CURRENT_USER.country; }   // admin with no country

// Countries the user manages ([] = global, sees every country). Stored as "Vietnam,Thailand".
function myCountries() {
  return String((window.CURRENT_USER && window.CURRENT_USER.country) || '').split(',').map(s => s.trim()).filter(Boolean);
}
// The one country a single-country user is fixed to (null if global or several).
function mySingleCountry() { const l = myCountries(); return l.length === 1 ? l[0] : null; }

// Country list from the server (cached per page): { countries (mine), all, core, scoped }.
let _countriesPromise = null;
function getCountries() {
  if (!_countriesPromise) {
    _countriesPromise = fetch('/api/countries').then(r => (r.ok ? r.json() : { countries: [], all: [], core: [] }))
      .catch(() => ({ countries: [], all: [], core: [] }));
  }
  return _countriesPromise;
}
// Fill every <select data-countries> with the countries this user may pick
// (data-countries="global" also offers "Global (all countries)" first).
async function fillCountrySelects(root = document) {
  const { countries } = await getCountries();
  if (!countries || !countries.length) return;
  root.querySelectorAll('select[data-countries]').forEach(sel => {
    const cur = sel.value;
    const withGlobal = sel.dataset.countries === 'global';
    sel.innerHTML = (withGlobal && !myCountries().length ? '<option value="Global">Global (all countries)</option>' : '') +
      countries.map(c => `<option>${String(c).replace(/</g, '&lt;')}</option>`).join('');
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    const single = mySingleCountry();
    if (single && !withGlobal) { sel.value = single; sel.disabled = true; }
  });
  if (typeof syncLocationField === 'function') syncLocationField();
}
function canEdit()       { return window.CURRENT_USER && ['admin','editor'].includes(window.CURRENT_USER.role); }
function isIT()          { return window.CURRENT_USER && window.CURRENT_USER.team === 'IT'; }
function isITAdmin()     { return isIT() && window.CURRENT_USER.role === 'admin'; }   // e.g. Viet
function roleLabel(u)    {
  const r = (u.ot_admin || u.net_admin ? 'Admin' : (u.role || '').charAt(0).toUpperCase() + (u.role || '').slice(1)) + (u.team === 'OT' ? ' · OT' : u.team === 'NET' ? ' · Network' : '');
  return u.country ? `${u.country} ${r}` : r;
}

// Render the username + logout into the topbar, and the Users/Audit nav links.
function renderUserChrome() {
  const u = window.CURRENT_USER;
  if (!u) return;

  // Topbar user badge
  const topbar = document.querySelector('.topbar');
  if (topbar && !document.getElementById('user-chrome')) {
    const wrap = document.createElement('div');
    wrap.id = 'user-chrome';
    wrap.style.cssText = 'display:flex;align-items:center;gap:12px;margin-left:auto';
    const nm = String(u.full_name || u.username || '?');
    const initials = nm.split(/\s+/).filter(Boolean).map(w => w[0]).slice(-2).join('').toUpperCase() || '?';
    // Account menu (every screen size): the round avatar opens name, role, two-step login, password, sign out.
    const ucEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const mi = (d) => `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${d}</svg>`;
    wrap.innerHTML = `
      <button type="button" class="uc-avatar" id="uc-avatar" aria-label="Account" aria-haspopup="menu" title="${htmlEsc(nm)}">${htmlEsc(initials)}</button>
      <div class="uc-menu" role="menu">
        <div class="uc-who">
          <div class="uc-name">${htmlEsc(u.full_name || u.username)}</div>
          <div class="uc-role">${htmlEsc(roleLabel(u))}${u.full_name ? ' · ' + htmlEsc(u.username) : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="mfa-btn-open" role="menuitem">${mi('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')} Two-step login <span class="uc-tag">${u.mfa_enabled ? 'On' : 'Set up'}</span></button>
        <button class="btn btn-ghost btn-sm" id="changepw-btn" role="menuitem">${mi('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>')} Change password</button>
        <button class="btn btn-ghost btn-sm" id="logout-btn" role="menuitem">${mi('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')} Sign out</button>
      </div>
    `;
    // Insert before any existing "Add Asset" button if present, else append
    topbar.appendChild(wrap);
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('changepw-btn').addEventListener('click', changePassword);
    document.getElementById('mfa-btn-open').addEventListener('click', () => { wrap.classList.remove('open'); openMfaSettings(); });
    document.getElementById('uc-avatar').addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) wrap.classList.remove('open'); });
  }

  // Quick Actions: drop "Add Asset"; add "Needs Attention" (alerts) for asset users.
  const addLink = document.getElementById('nav-add');
  if (addLink) addLink.style.display = 'none';
  if (u.asset_access !== 0 && u.role !== 'viewer') {
    const nav = document.querySelector('.sidebar nav');
    if (nav && !document.getElementById('nav-alerts')) {
      const link = document.createElement('a');
      link.href = '/alerts.html';
      link.id = 'nav-alerts';
      link.className = 'nav-link';
      link.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ⚠️ Needs Attention`;
      if (addLink) addLink.insertAdjacentElement('afterend', link);
      else nav.appendChild(link);
      if (window.location.pathname.includes('alerts.html')) link.classList.add('active');
    }
  }

  // New pages: Stocktake (after Maintenance) and KPIs (after Reports) for asset users; Leavers for HR & IT.
  const navAdd = (id, href, html, afterSel, show) => {
    const nav = document.querySelector('.sidebar nav');
    if (!show || !nav || document.getElementById(id)) return;
    const link = document.createElement('a');
    link.href = href; link.id = id; link.className = 'nav-link'; link.innerHTML = html;
    const after = afterSel && nav.querySelector(afterSel);
    if (after) after.insertAdjacentElement('afterend', link); else nav.appendChild(link);
    if (window.location.pathname === href) link.classList.add('active');
  };
  const ico = (d) => `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">${d}</svg>`;
  navAdd('nav-stocktake', '/stocktake.html', ico('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>') + ' Stocktake', '#nav-maintenance', u.asset_access !== 0);
  navAdd('nav-netmap', '/network-map.html', ico('<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>') + ' Network map', '#nav-servers', u.asset_access !== 0 || u.team === 'OT' || u.team === 'NET');
  navAdd('nav-otna', '/ot-attention.html', ico('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>') + ' OT Needs Attention', '#nav-netmap', u.team === 'OT');
  navAdd('nav-otrep', '/ot-reports.html', ico('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>') + ' OT Reports', '#nav-otna', u.team === 'OT' || u.team === 'NET');
  navAdd('nav-otact', '/ot-activity.html', ico('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>') + ' OT Activity', '#nav-otrep', !!u.ot_admin);
  navAdd('nav-kpi', '/kpi.html', ico('<polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/>') + ' KPIs', '#nav-reports', u.asset_access !== 0);

  // System Health link — IT team only, right after Devices.
  if (u.team === 'IT') {
    const nav = document.querySelector('.sidebar nav');
    if (nav && !document.getElementById('nav-health')) {
      const link = document.createElement('a');
      link.href = '/system-health.html';
      link.id = 'nav-health';
      link.className = 'nav-link';
      link.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> System Health`;
      const dev = document.getElementById('nav-devices');
      if (dev) dev.insertAdjacentElement('afterend', link); else nav.appendChild(link);
      if (window.location.pathname.includes('system-health')) link.classList.add('active');
    }
  }

  // User Inventory link — for HR and IT members (appears on every page).
  if (u.team === 'HR' || u.team === 'IT') {
    const nav = document.querySelector('.sidebar nav');
    if (nav && !document.getElementById('nav-userinv')) {
      const link = document.createElement('a');
      link.href = '/user-inventory.html';
      link.id = 'nav-userinv';
      link.className = 'nav-link';
      link.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg> User Inventory`;
      const invLink = nav.querySelector('a[href="/inventory.html"]');
      if (invLink && invLink.nextSibling) nav.insertBefore(link, invLink.nextSibling);
      else nav.appendChild(link);
      if (window.location.pathname.includes('user-inventory')) link.classList.add('active');
    }
    navAdd('nav-leavers', '/leavers.html', ico('<path d="M16 17l5-5-5-5"/><path d="M21 12H9"/><path d="M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7"/>') + ' Leavers', '#nav-userinv', true);
  }

  // Budget Tracking — IT admin only, placed right after Reports.
  if (isITAdmin()) {
    const nav = document.querySelector('.sidebar nav');
    if (nav && !document.getElementById('nav-budget')) {
      const link = document.createElement('a');
      link.href = '/budget.html';
      link.id = 'nav-budget';
      link.className = 'nav-link';
      link.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Budget Tracking`;
      const reportsLink = document.getElementById('nav-reports');
      if (reportsLink) reportsLink.insertAdjacentElement('afterend', link);
      else nav.appendChild(link);
      if (window.location.pathname.includes('budget')) link.classList.add('active');
    }
  }

  // Admin-only nav links (Recycle Bin + Users & Audit) — inject into sidebar
  if (isAdmin()) {
    const nav = document.querySelector('.sidebar nav');
    if (nav && !document.getElementById('nav-users')) {
      const label = document.createElement('div');
      label.className = 'nav-section-label';
      label.style.marginTop = '8px';
      label.textContent = 'Administration';
      nav.appendChild(label);

      // Recycle Bin — available to all admins (regional admins see only their region).
      const binLink = document.createElement('a');
      binLink.href = '/deleted.html';
      binLink.id = 'nav-bin';
      binLink.className = 'nav-link';
      binLink.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg> Recycle Bin`;
      nav.appendChild(binLink);
      if (window.location.pathname.includes('deleted.html')) binLink.classList.add('active');

      // Users & Audit — GLOBAL admins only.
      if (isGlobalAdmin()) {
        const usersLink = document.createElement('a');
        usersLink.href = '/users.html';
        usersLink.id = 'nav-users';
        usersLink.className = 'nav-link';
        usersLink.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg> Users & Audit`;
        nav.appendChild(usersLink);
        if (window.location.pathname.includes('users.html')) usersLink.classList.add('active');
      }
    }
  }
}

// Users without Asset Inventory access (e.g. HR-only) don't see Dashboard/Assets.
function applyAssetGating() {
  const u = window.CURRENT_USER;
  // OT team (Operation Technology): the Network map only — in its OT view (Kabin switches and what is connected to them).
  if (u && u.team === 'OT') {
    document.documentElement.classList.add('is-ot', u.role === 'editor' ? 'is-ot-editor' : 'is-ot-viewer'); if (u.ot_admin) document.documentElement.classList.add('is-ot-admin');
    // …and the OT devices of the Server Inventory (read-only).
    document.querySelectorAll('.sidebar nav a').forEach(a => { if (!['nav-netmap', 'nav-servers', 'nav-otna', 'nav-otrep', 'nav-otact'].includes(a.id)) a.style.display = 'none'; });
    document.querySelectorAll('.sidebar .nav-section-label').forEach((l, i) => { if (i > 0) l.style.display = 'none'; });
    if (!['/network-map.html', '/server-inventory.html', '/ot-attention.html', '/ot-reports.html'].concat(u.ot_admin ? ['/ot-activity.html'] : []).includes(window.location.pathname)) window.location.href = '/network-map.html';
    return;
  }
  // Network team: the network devices of IT and OT (Server Inventory), the full Network map and OT Reports.
  if (u && u.team === 'NET') {
    document.documentElement.classList.add('is-net', u.role === 'editor' ? 'is-net-editor' : 'is-net-viewer');
    document.querySelectorAll('.sidebar nav a').forEach(a => { if (!['nav-netmap', 'nav-servers', 'nav-otrep'].includes(a.id)) a.style.display = 'none'; });
    document.querySelectorAll('.sidebar .nav-section-label').forEach((l, i) => { if (i > 0) l.style.display = 'none'; });
    if (!['/network-map.html', '/server-inventory.html', '/ot-reports.html'].includes(window.location.pathname)) window.location.href = '/network-map.html';
    return;
  }
  if (!u || u.asset_access !== 0) return;
  // Hide every asset-related destination for HR-only users.
  document.querySelectorAll([
    '.sidebar nav a[href="/"]', '.sidebar nav a[href="/inventory.html"]',
    '#nav-add', '#nav-servers', '#nav-devices', '#nav-maintenance', '#nav-licenses', '#nav-reports'
  ].join(',')).forEach(a => a.style.display = 'none');

  const assetPages = ['/', '/index.html', '/inventory.html',
    '/server-inventory.html', '/devices.html', '/maintenance.html', '/licenses.html', '/reports.html', '/alerts.html',
    '/stocktake.html', '/scan.html', '/labels.html', '/kpi.html', '/network-map.html'];
  if (assetPages.includes(window.location.pathname)) {
    window.location.href = '/user-inventory.html';
  }
}

// Self-service password change (available to every logged-in user).
async function changePassword() {
  const current = prompt('Enter your CURRENT password:');
  if (current === null) return;
  const next = prompt('Enter your NEW password (at least 6 characters):');
  if (next === null) return;
  if (next.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
  try {
    const r = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
    showToast('Password changed successfully');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Hide create/edit/delete affordances for viewers.
function applyRoleGates() {
  // Country pickers list the user's countries; a single-country user is locked to theirs.
  fillCountrySelects();
  if (typeof syncLocationField === 'function') syncLocationField();
  // IT-team tools (e.g. Inventory → 📚 Models & warranty) start hidden.
  document.querySelectorAll('[data-it-only]').forEach(el => { el.style.display = isIT() ? '' : 'none'; });

  if (canEdit()) return;
  // Viewers: hide all "add asset" buttons
  document.querySelectorAll('#btn-add-top, #nav-add').forEach(el => el.style.display = 'none');
  document.body.classList.add('role-viewer');
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  window.location.href = '/login.html';
}

// Run immediately on load.
ensureAuth();

// ── Two-step login settings (Google / Microsoft Authenticator) ───────────────
// Turn on: QR → scan with the app → type a code → save the 10 recovery codes.
// Required for everyone — no "turn off". New recovery codes: password · Move to a new phone: password + a current code.
function mfaModal(title, body, foot) {
  let ov = document.getElementById('mfa-ov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'mfa-ov'; ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal" style="max-width:480px"><div class="modal-header"><span class="modal-title" id="mfa-t"></span>
      <button class="modal-close" aria-label="Close" onclick="document.getElementById('mfa-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="mfa-b"></div><div class="modal-footer" id="mfa-f"></div></div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
    document.body.appendChild(ov);
  }
  document.getElementById('mfa-t').textContent = title;
  document.getElementById('mfa-b').innerHTML = body;
  document.getElementById('mfa-f').innerHTML = foot || '<button class="btn btn-ghost" onclick="document.getElementById(\'mfa-ov\').classList.remove(\'open\')">Close</button>';
  ov.classList.add('open');
}
async function mfaApi(path, body) {
  const r = await fetch('/api/auth/mfa' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
const mfaEsc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mfaCodesHtml(codes) {
  const txt = codes.join('\n');
  return `<p style="margin:0 0 8px"><b>Save these 10 recovery codes</b> somewhere safe (password manager, printed in a drawer). Each works <b>once</b> if you lose your phone. They are shown <b>only now</b>.</p>
    <pre style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:12px;font-size:15px;columns:2;line-height:1.8;margin:0">${codes.map(mfaEsc).join('\n')}</pre>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(${JSON.stringify(txt).replace(/"/g, '&quot;')}).then(()=>showToast('Copied'))">📋 Copy</button>
      <a class="btn btn-ghost btn-sm" download="hayat-tools-recovery-codes.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent('Hayat Tools — recovery codes (' + ((window.CURRENT_USER || {}).username || '') + ')\n\n' + txt + '\n')}">⬇ Download .txt</a>
    </div>`;
}
async function openMfaSettings() {
  let st;
  try { st = await mfaApi(''); } catch (e) { showToast(e.message, 'error'); return; }
  if (!st.enabled) {
    mfaModal('🔐 Two-step login', `
      <p style="margin:0 0 10px">Protect your account with a 6-digit code from your phone in addition to your password.</p>
      <ol style="margin:0 0 4px 18px;padding:0;line-height:1.7;font-size:13.5px">
        <li>Install <b>Google Authenticator</b> (or Microsoft Authenticator) on your phone.</li>
        <li>Scan the QR code on the next screen.</li>
        <li>Type the code the app shows.</li>
      </ol>`,
      `<button class="btn btn-ghost" onclick="document.getElementById('mfa-ov').classList.remove('open')">Not now</button><button class="btn btn-primary" id="mfa-start">Set up</button>`);
    document.getElementById('mfa-start').onclick = () => mfaSetup();
    return;
  }
  mfaModal('🔐 Two-step login is on', `
    <p style="margin:0 0 8px">✅ You sign in with your password <b>and</b> a code from your authenticator app.</p>
    <p class="text-muted" style="margin:0 0 14px;font-size:13px">Recovery codes left: <b>${st.recovery_left}</b> of 10.</p>
    <div class="form-group"><label class="form-label">Your password</label><input class="form-control" id="mfa-pw" type="password" autocomplete="current-password"></div>
    <div class="form-group"><label class="form-label">Current 6-digit code (only to move to a new phone)</label><input class="form-control" id="mfa-off-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></div>
    <p class="text-muted" style="margin:0 0 6px;font-size:12.5px">Two-step login is required for every account and cannot be turned off. Lost your phone and your recovery codes? Ask an IT admin to reset it.</p>
    <div id="mfa-msg" class="text-sm" style="color:#dc2626"></div>`,
    `<button class="btn btn-ghost" id="mfa-newcodes">New recovery codes</button><button class="btn btn-primary" id="mfa-move">📱 Move to a new phone</button>`);
  document.getElementById('mfa-newcodes').onclick = async () => {
    try { const d = await mfaApi('/recovery', { password: document.getElementById('mfa-pw').value }); mfaModal('🔐 New recovery codes', mfaCodesHtml(d.recovery_codes) + '<p class="text-muted text-sm" style="margin:10px 0 0">The old codes no longer work.</p>'); }
    catch (e) { document.getElementById('mfa-msg').textContent = e.message; }
  };
  document.getElementById('mfa-move').onclick = () => mfaSetup({ password: document.getElementById('mfa-pw').value, code: document.getElementById('mfa-off-code').value });
}
// creds = { password, code } when moving to a new phone (the old phone keeps working until the new code is confirmed).
async function mfaSetup(creds) {
  let d;
  try { d = await mfaApi('/setup', creds && creds.password !== undefined ? creds : {}); }
  catch (e) { const m = document.getElementById('mfa-msg'); if (m && creds) m.textContent = e.message; else showToast(e.message, 'error'); return; }
  mfaModal('🔐 Scan with your authenticator app', `
    <div style="text-align:center"><img src="${d.qr}" alt="QR code" width="220" height="220" style="border:1px solid var(--border);border-radius:10px;padding:6px;background:#fff"></div>
    <p class="text-muted" style="font-size:12.5px;margin:8px 0 2px;text-align:center">Can't scan? In the app choose <b>Enter a setup key</b> and type:</p>
    <p style="text-align:center;font-family:monospace;font-size:15px;letter-spacing:1px;margin:0 0 14px;user-select:all">${mfaEsc(d.secret)}</p>
    <div class="form-group"><label class="form-label">Code shown in the app</label>
      <input class="form-control" id="mfa-first" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" style="text-align:center;font-size:22px;letter-spacing:5px"></div>
    <div id="mfa-msg" class="text-sm" style="color:#dc2626"></div>`,
    `<button class="btn btn-ghost" onclick="document.getElementById('mfa-ov').classList.remove('open')">Cancel</button><button class="btn btn-primary" id="mfa-confirm">Turn on</button>`);
  const go = async () => {
    try {
      const r = await mfaApi('/enable', { code: document.getElementById('mfa-first').value });
      mfaModal('✅ Two-step login is on', mfaCodesHtml(r.recovery_codes) + '<p class="text-muted text-sm" style="margin:10px 0 0">Next time you sign in you will be asked for the code from the app.</p>',
        '<button class="btn btn-primary" onclick="location.reload()">I saved them — done</button>');
    } catch (e) { document.getElementById('mfa-msg').textContent = e.message; }
  };
  document.getElementById('mfa-confirm').onclick = go;
  document.getElementById('mfa-first').addEventListener('input', (e) => { if (/^\d{6}$/.test(e.target.value.trim())) go(); });
  setTimeout(() => document.getElementById('mfa-first').focus(), 100);
}
