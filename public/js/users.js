/* Admin Users & Audit page */

let userEditMode = false;

const roleBadge = (role) => {
  const map = { admin: 'badge-broken', editor: 'badge-factory', viewer: 'badge-office' };
  return `<span class="badge ${map[role] || ''}" style="text-transform:capitalize">${role}</span>`;
};

const ACTION_STYLE = {
  LOGIN: ['#0f766e', '🔑 Login'], LOGIN_FAILED: ['#dc2626', '⛔ Login failed'], LOGOUT: ['#6b7280', '↩ Logout'],
  PASSWORD: ['#7c3aed', '🔒 Password'], USER: ['#7c3aed', '👤 User account'],
  CREATE: ['#16a34a', '＋ Create'], UPDATE: ['#1a56db', '✎ Update'], DELETE: ['#dc2626', '🗑 Delete'],
  PERSONNEL: ['#0f766e', '👥 User Inventory'], LICENSE: ['#1a56db', '🪪 License'], IMPORT: ['#9333ea', '⬆ Import'],
  MAINTENANCE: ['#d97706', '🔧 Maintenance'], HEALTH: ['#0891b2', '📡 System Health'], LOCK: ['#475569', '🔒 Lock'],
  UNLOCK: ['#475569', '🔓 Unlock'], RESTORE: ['#16a34a', '♻ Restore'], PURGE: ['#dc2626', '🔥 Purge'], PRINT: ['#475569', '🖨 Print'],
  ACTION: ['#1a56db', '⚙ Action'], REFUSED: ['#d97706', '✋ Refused'], EXPORT: ['#0891b2', '⬇ Export'], VIEW: ['#94a3b8', '👁 View'],
};
const actionBadge = (action) => {
  const [c, label] = ACTION_STYLE[action] || ['#111', action];
  return `<span class="au-act" style="color:${c}">${htmlEsc(label)}</span>`;
};
// audit_log times are UTC ("YYYY-MM-DD HH:MM:SS") → local time, with the UTC time on hover.
const localTime = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return htmlEsc(s);
  const p = (n) => String(n).padStart(2, '0');
  return `<span title="${htmlEsc(s)} UTC">${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</span>`;
};
const ago = (s) => {
  if (!s) return '';
  const min = Math.floor((Date.now() - new Date(String(s).replace(' ', 'T') + 'Z')) / 60000);
  if (!Number.isFinite(min)) return '';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
};

async function loadUsers() {
  try {
    const users = await apiGet('/api/users');
    window._usersById = new Map(users.map(u => [u.id, u]));
    const me = window.CURRENT_USER;
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td class="text-muted text-sm">${u.id}</td>
        <td><strong>${htmlEsc(u.username)}</strong>${u.id === (me && me.id) ? ' <span class="text-muted text-sm">(you)</span>' : ''}</td>
        <td>${htmlEsc(u.full_name) || '—'}</td>
        <td>${roleBadge(u.role)}</td>
        <td>${u.team ? `<span class="badge badge-office">${htmlEsc(u.team)}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
        <td>${u.country ? String(u.country).split(',').map(c => `<span class="badge badge-factory" style="margin:1px">${htmlEsc(c)}</span>`).join('') : '<span class="text-muted text-sm">Global</span>'}</td>
        <td class="text-sm">${Number(u.asset_access) === 0 ? '<span class="text-muted">User Inv. only</span>' : 'Yes'}</td>
        <td class="text-muted text-sm">${(u.created_at || '').split(' ')[0]}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="editUser(window._usersById.get(${u.id}))">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, ${jsArg(u.username)})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load users', 'error');
  }
}

const AU = { page: 1, limit: 100 };
function auditQuery(extra = {}) {
  const v = (id) => document.getElementById(id).value.trim();
  const q = new URLSearchParams();
  if (v('au-q')) q.set('q', v('au-q'));
  if (v('au-user')) q.set('user', v('au-user'));
  if (v('au-action')) q.set('action', v('au-action'));
  if (v('au-from')) q.set('from', v('au-from'));
  if (v('au-to')) q.set('to', v('au-to'));
  if (document.getElementById('au-hide-views').checked) q.set('hideViews', '1');
  for (const [k, val] of Object.entries(extra)) q.set(k, val);
  return q;
}
async function loadAudit() {
  try {
    const r = await apiGet('/api/users/audit/log?' + auditQuery({ page: AU.page, limit: AU.limit }));
    const tbody = document.getElementById('audit-tbody');
    tbody.innerHTML = r.rows.length ? r.rows.map(e => `
      <tr class="${e.action === 'LOGIN_FAILED' || e.action === 'REFUSED' ? 'au-bad' : e.action === 'VIEW' ? 'au-view' : ''}">
        <td class="text-sm" style="white-space:nowrap">${localTime(e.created_at)}</td>
        <td><a href="#" onclick="filterAuditUser(${jsArg(e.username || '')}); return false">${htmlEsc(e.username) || '—'}</a></td>
        <td style="white-space:nowrap">${actionBadge(e.action)}</td>
        <td class="text-sm">${htmlEsc(e.details) || '—'}${e.asset_id ? ` <span class="text-muted">· asset #${e.asset_id}</span>` : ''}</td>
        <td class="text-muted text-sm" style="white-space:nowrap">${htmlEsc(e.ip || '')}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No activity matches these filters.</td></tr>';
    const pages = Math.max(1, Math.ceil(r.total / r.limit));
    document.getElementById('au-page').textContent = `${r.total.toLocaleString()} entries · page ${r.page} of ${pages}`;
    document.getElementById('au-prev').disabled = r.page <= 1;
    document.getElementById('au-next').disabled = r.page >= pages;
    document.getElementById('au-export').href = '/api/users/audit/export.xlsx?' + auditQuery();
    // Filter lists (keep the current choice).
    const us = document.getElementById('au-user'), cur = us.value;
    us.innerHTML = '<option value="">All users</option>' + r.users.map(u => `<option value="${htmlEsc(u.username || '')}">${htmlEsc(u.username || '—')} (${u.n})</option>`).join('');
    us.value = cur;
    const as = document.getElementById('au-action'), curA = as.value;
    const fixed = [['', 'All actions'], ['LOGIN,LOGIN_FAILED,LOGOUT,PASSWORD', 'Logins, logouts & passwords']];
    as.innerHTML = fixed.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')
      + r.actions.map(a => `<option value="${htmlEsc(a.action)}">${htmlEsc((ACTION_STYLE[a.action] || [0, a.action])[1])} (${a.n})</option>`).join('');
    as.value = curA;
    renderLogins(r.lastLogins);
  } catch (err) {
    showToast('Failed to load audit log', 'error');
  }
}
// Pages an account can open: ✎ = can change data there, 👁 = read only; plus its countries.
function accessChips(u) {
  const pages = u.pages || [];
  if (!pages.length) return '<span class="text-muted text-sm">no pages</span>';
  const chips = pages.map(p => `<span class="acc-chip ${p.edit ? 'acc-edit' : 'acc-view'}" title="${htmlEsc(p.page)}: ${p.edit ? 'can change data' : 'read only'}">${p.edit ? '✎' : '👁'} ${htmlEsc(p.page)}</span>`).join('');
  const scope = u.country ? htmlEsc(u.country) : 'All countries';
  return `<div class="acc-chips">${chips}</div><div class="text-muted text-sm" style="margin-top:3px">🌏 ${scope} · ${pages.length} page${pages.length === 1 ? '' : 's'}</div>`;
}
function renderLogins(list) {
  document.getElementById('logins-tbody').innerHTML = list.map(u => `
    <tr class="au-click" onclick="filterAuditUser(${jsArg(u.username)})">
      <td><b>${htmlEsc(u.username)}</b>${u.full_name ? ` <span class="text-muted text-sm">${htmlEsc(u.full_name)}</span>` : ''}</td>
      <td class="text-sm">${htmlEsc(u.role || '')}${u.team ? ' · ' + htmlEsc(u.team) : ''}${u.country ? ' · ' + htmlEsc(u.country) : ''}</td>
      <td class="text-sm">${u.last_login ? `${localTime(u.last_login)} <span class="text-muted">· ${ago(u.last_login)}</span>` : '<span class="text-muted">never recorded</span>'}</td>
      <td class="text-sm">${u.last_activity ? `${localTime(u.last_activity)} <span class="text-muted">· ${ago(u.last_activity)}</span>` : '—'}</td>
      <td class="text-sm">${u.failed_7d ? `<b style="color:#dc2626">${u.failed_7d}</b>` : '<span class="text-muted">0</span>'}</td>
      <td class="acc-cell">${accessChips(u)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-state">No users.</td></tr>';
}
function filterAuditUser(name) {
  const us = document.getElementById('au-user');
  if (![...us.options].some(o => o.value === name)) us.insertAdjacentHTML('beforeend', `<option value="${htmlEsc(name)}">${htmlEsc(name)}</option>`);
  us.value = name; AU.page = 1; loadAudit();
  document.getElementById('audit-tbody').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openUserModal(title) {
  document.getElementById('user-modal-title').textContent = title;
  document.getElementById('user-overlay').classList.add('open');
}
function closeUserModal() {
  document.getElementById('user-overlay').classList.remove('open');
  document.getElementById('user-form').reset();
  document.getElementById('u-id').value = '';
  setUserCountries('');
}

// ── Countries picker: "All countries (global)" or a set of countries ─────────
async function renderCountryPicker() {
  const box = document.getElementById('u-country-list');
  const { all } = await getCountries();
  box.innerHTML = (all || []).map(c =>
    `<label><input type="checkbox" value="${htmlEsc(c)}"> ${htmlEsc(c)}</label>`).join('');
}
function setUserCountries(value) {
  const list = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const allBox = document.getElementById('u-country-all');
  const box = document.getElementById('u-country-list');
  allBox.checked = !list.length;
  box.hidden = !list.length;
  box.querySelectorAll('input').forEach(i => { i.checked = list.includes(i.value); });
}
function getUserCountries() {
  if (document.getElementById('u-country-all').checked) return '';
  return [...document.querySelectorAll('#u-country-list input:checked')].map(i => i.value).join(',');
}

function editUser(u) {
  userEditMode = true;
  document.getElementById('u-id').value = u.id;
  document.getElementById('u-username').value = u.username;
  document.getElementById('u-username').disabled = true;
  document.getElementById('u-fullname').value = u.full_name || '';
  document.getElementById('u-role').value = u.role;
  setUserCountries(u.country || '');
  document.getElementById('u-team').value = u.team || '';
  document.getElementById('u-asset_access').value = String(Number(u.asset_access) === 0 ? 0 : 1);
  document.getElementById('u-password').value = '';
  document.getElementById('u-pass-label').textContent = 'Reset Password';
  document.getElementById('u-pass-hint').style.display = 'block';
  openUserModal('Edit User');
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try {
    await apiDelete(`/api/users/${id}`);
    showToast('User deleted');
    loadUsers();
  } catch (err) {
    showToast(parseErr(err), 'error');
  }
}

function parseErr(err) {
  try { return JSON.parse(err.message).error || err.message; } catch { return 'Operation failed'; }
}

document.addEventListener('DOMContentLoaded', () => {
  renderCountryPicker();
  document.getElementById('u-country-all').addEventListener('change', (e) => {
    document.getElementById('u-country-list').hidden = e.target.checked;
  });
  // auth.js redirects non-admins away via gating; also guard here
  setTimeout(() => {
    // Global admins only (regional admins cannot manage users).
    const u = window.CURRENT_USER;
    if (u && !(u.role === 'admin' && !u.country)) window.location.href = '/';
  }, 400);

  loadUsers();
  loadAudit();
  // Audit log filters
  let auT = null;
  document.getElementById('au-q').addEventListener('input', () => { clearTimeout(auT); auT = setTimeout(() => { AU.page = 1; loadAudit(); }, 300); });
  ['au-user', 'au-action', 'au-from', 'au-to', 'au-hide-views'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { AU.page = 1; loadAudit(); }));
  document.getElementById('au-reset').addEventListener('click', () => {
    ['au-q', 'au-user', 'au-action', 'au-from', 'au-to'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('au-hide-views').checked = false; AU.page = 1; loadAudit();
  });
  document.getElementById('au-prev').addEventListener('click', () => { if (AU.page > 1) { AU.page--; loadAudit(); } });
  document.getElementById('au-next').addEventListener('click', () => { AU.page++; loadAudit(); });

  document.getElementById('btn-add-user').addEventListener('click', () => {
    userEditMode = false;
    document.getElementById('user-form').reset();
    document.getElementById('u-id').value = '';
    document.getElementById('u-username').disabled = false;
    document.getElementById('u-pass-label').textContent = 'Password *';
    document.getElementById('u-pass-hint').style.display = 'none';
    openUserModal('Add User');
  });

  document.getElementById('user-close').addEventListener('click', closeUserModal);
  document.getElementById('user-cancel').addEventListener('click', closeUserModal);

  document.getElementById('user-save').addEventListener('click', async () => {
    const id       = document.getElementById('u-id').value;
    const username = document.getElementById('u-username').value.trim();
    const full_name= document.getElementById('u-fullname').value.trim();
    const role     = document.getElementById('u-role').value;
    const country  = getUserCountries();
    if (!document.getElementById('u-country-all').checked && !country) { showToast('Pick at least one country, or tick All countries', 'error'); return; }
    const team     = document.getElementById('u-team').value;
    const asset_access = document.getElementById('u-asset_access').value;
    const password = document.getElementById('u-password').value;

    if (!username) { showToast('Username is required', 'error'); return; }

    try {
      if (userEditMode && id) {
        const body = { full_name, role, country, team, asset_access };
        if (password) body.password = password;
        await apiPut(`/api/users/${id}`, body);
        showToast('User updated');
      } else {
        if (!password) { showToast('Password is required', 'error'); return; }
        await apiPost('/api/users', { username, full_name, role, country, team, asset_access, password });
        showToast('User created');
      }
      closeUserModal();
      loadUsers();
    } catch (err) {
      showToast(parseErr(err), 'error');
    }
  });
});
