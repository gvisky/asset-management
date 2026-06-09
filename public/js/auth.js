/* Shared auth helpers — loaded on every protected page (before app.js).
   Exposes window.CURRENT_USER and gates UI by role. */

window.CURRENT_USER = null;

// Fetch the logged-in user; redirect to login if not authenticated.
async function ensureAuth() {
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) throw new Error('not auth');
    window.CURRENT_USER = await r.json();
    renderUserChrome();
    applyRoleGates();
    applyAssetGating();
    return window.CURRENT_USER;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

function isAdmin()       { return window.CURRENT_USER && window.CURRENT_USER.role === 'admin'; }
function isGlobalAdmin() { return isAdmin() && !window.CURRENT_USER.country; }   // admin with no country
function canEdit()       { return window.CURRENT_USER && ['admin','editor'].includes(window.CURRENT_USER.role); }
function isIT()          { return window.CURRENT_USER && window.CURRENT_USER.team === 'IT'; }
function isITAdmin()     { return isIT() && window.CURRENT_USER.role === 'admin'; }   // e.g. Viet
function roleLabel(u)    {
  const r = (u.role || '').charAt(0).toUpperCase() + (u.role || '').slice(1);
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
    wrap.innerHTML = `
      <div style="text-align:right;line-height:1.2">
        <div style="font-size:13px;font-weight:600">${u.full_name || u.username}</div>
        <div style="font-size:11px;color:var(--muted)">${roleLabel(u)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" id="changepw-btn" title="Change your password">Change password</button>
      <button class="btn btn-ghost btn-sm" id="logout-btn" title="Sign out">Logout</button>
    `;
    // Insert before any existing "Add Asset" button if present, else append
    topbar.appendChild(wrap);
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('changepw-btn').addEventListener('click', changePassword);
  }

  // Quick Actions: drop "Add Asset"; add "Needs Attention" (alerts) for asset users.
  const addLink = document.getElementById('nav-add');
  if (addLink) addLink.style.display = 'none';
  if (u.asset_access !== 0) {
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
  if (!u || u.asset_access !== 0) return;
  // Hide every asset-related destination for HR-only users.
  document.querySelectorAll([
    '.sidebar nav a[href="/"]', '.sidebar nav a[href="/inventory.html"]',
    '#nav-add', '#nav-servers', '#nav-maintenance', '#nav-licenses', '#nav-reports'
  ].join(',')).forEach(a => a.style.display = 'none');

  const assetPages = ['/', '/index.html', '/inventory.html',
    '/server-inventory.html', '/maintenance.html', '/licenses.html', '/reports.html', '/alerts.html'];
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
  // Regional managers: lock the Country field in the asset form to their country.
  const myCountry = window.CURRENT_USER && window.CURRENT_USER.country;
  if (myCountry) {
    const fc = document.getElementById('f-country');
    if (fc) { fc.value = myCountry; fc.disabled = true; }
  }

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
