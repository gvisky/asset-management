/* Admin Users & Audit page */

let userEditMode = false;

const roleBadge = (role) => {
  const map = { admin: 'badge-broken', editor: 'badge-factory', viewer: 'badge-office' };
  return `<span class="badge ${map[role] || ''}" style="text-transform:capitalize">${role}</span>`;
};

const actionBadge = (action) => {
  const colors = { CREATE: '#16a34a', UPDATE: '#1a56db', DELETE: '#dc2626', LOGIN: '#6b7280' };
  return `<span style="font-weight:600;font-size:12px;color:${colors[action] || '#111'}">${action}</span>`;
};

async function loadUsers() {
  try {
    const users = await apiGet('/api/users');
    const me = window.CURRENT_USER;
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td class="text-muted text-sm">${u.id}</td>
        <td><strong>${u.username}</strong>${u.id === (me && me.id) ? ' <span class="text-muted text-sm">(you)</span>' : ''}</td>
        <td>${u.full_name || '—'}</td>
        <td>${roleBadge(u.role)}</td>
        <td>${u.team ? `<span class="badge badge-office">${u.team}</span>` : '<span class="text-muted text-sm">—</span>'}</td>
        <td>${u.country ? `<span class="badge badge-factory">${u.country}</span>` : '<span class="text-muted text-sm">Global</span>'}</td>
        <td class="text-sm">${Number(u.asset_access) === 0 ? '<span class="text-muted">User Inv. only</span>' : 'Yes'}</td>
        <td class="text-muted text-sm">${(u.created_at || '').split(' ')[0]}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick='editUser(${JSON.stringify(u)})'>Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${u.username}')">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load users', 'error');
  }
}

async function loadAudit() {
  try {
    const log = await apiGet('/api/users/audit/log');
    const tbody = document.getElementById('audit-tbody');
    if (!log.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No activity yet.</td></tr>'; return; }
    tbody.innerHTML = log.map(e => `
      <tr>
        <td class="text-muted text-sm" style="white-space:nowrap">${e.created_at}</td>
        <td>${e.username || '—'}</td>
        <td>${actionBadge(e.action)}</td>
        <td>${e.details || '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load audit log', 'error');
  }
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
}

function editUser(u) {
  userEditMode = true;
  document.getElementById('u-id').value = u.id;
  document.getElementById('u-username').value = u.username;
  document.getElementById('u-username').disabled = true;
  document.getElementById('u-fullname').value = u.full_name || '';
  document.getElementById('u-role').value = u.role;
  document.getElementById('u-country').value = u.country || '';
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
  // auth.js redirects non-admins away via gating; also guard here
  setTimeout(() => {
    // Global admins only (regional admins cannot manage users).
    const u = window.CURRENT_USER;
    if (u && !(u.role === 'admin' && !u.country)) window.location.href = '/';
  }, 400);

  loadUsers();
  loadAudit();

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
    const country  = document.getElementById('u-country').value;
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
