/* Reusable Alerts box. Renders notifications (optionally filtered by scope)
   into a container element. Used on Dashboard, Asset Inventory, User Inventory. */

async function loadAlertBox(containerId, scope) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const q = scope ? ('?scope=' + encodeURIComponent(scope)) : '';
    const { unread, data } = await apiGet('/api/notifications' + q);
    if (!data.length) { el.innerHTML = ''; return; }

    const items = data.map(n => `
      <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="color:${n.level === 'warning' ? '#dc2626' : '#1a56db'};font-size:10px;line-height:18px">${n.read ? '○' : '●'}</span>
        <div style="flex:1">
          <div style="font-size:13px">${n.message}</div>
          <div class="text-muted text-sm" style="margin-top:2px">${n.created_at} · ${n.scope}</div>
        </div>
      </div>`).join('');

    el.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <div class="card-header">
          <span class="card-title">🔔 Alerts ${unread ? `<span class="badge badge-broken">${unread} new</span>` : ''}</span>
          <button class="btn btn-ghost btn-sm" onclick="markAlertsRead('${containerId}','${scope || ''}')">Mark all read</button>
        </div>
        <div class="card-body" style="max-height:260px;overflow-y:auto;padding-top:4px;padding-bottom:4px">${items}</div>
      </div>`;
  } catch (e) {
    el.innerHTML = '';   // e.g. users without access — just show nothing
  }
}

async function markAlertsRead(containerId, scope) {
  try {
    await apiPost('/api/notifications/read-all', scope ? { scope } : {});
    loadAlertBox(containerId, scope);
  } catch (e) { /* ignore */ }
}
