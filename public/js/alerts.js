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

// ── Compact alerts: a 🔔 button (with unread count) that opens a pop-up list ──
// Used on Asset Inventory / User Inventory so alerts don't take page space.
async function loadAlertButton(slotId, scope) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let data = [], unread = 0;
  try {
    const q = scope ? ('?scope=' + encodeURIComponent(scope)) : '';
    ({ unread, data } = await apiGet('/api/notifications' + q));
  } catch (e) { slot.innerHTML = ''; return; }   // no access → no button

  slot.innerHTML = `
    <div class="alert-pop-wrap">
      <button type="button" class="btn btn-ghost btn-sm alert-btn" aria-haspopup="dialog" aria-expanded="false">
        🔔 Alerts${unread ? ` <span class="badge badge-broken">${unread}</span>` : ''}
      </button>
      <div class="alert-pop" role="dialog" aria-label="Alerts" hidden>
        <div class="alert-pop-head">
          <b>🔔 Alerts</b>
          ${unread ? `<span class="badge badge-broken">${unread} new</span>` : ''}
          <span style="flex:1"></span>
          ${data.length ? '<button type="button" class="btn btn-ghost btn-sm" data-act="read">Mark all read</button>' : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="alert-pop-body">
          ${data.length ? data.map(n => `
            <div class="alert-pop-item">
              <span style="color:${n.level === 'warning' ? '#dc2626' : '#1a56db'};font-size:10px;line-height:18px">${n.read ? '○' : '●'}</span>
              <div style="flex:1">
                <div style="font-size:13px">${esc(n.message)}</div>
                <div class="text-muted text-sm" style="margin-top:2px">${esc(n.created_at)} · ${esc(n.scope)}</div>
              </div>
            </div>`).join('') : '<div class="text-muted text-sm" style="padding:14px 4px">No alerts.</div>'}
        </div>
      </div>
    </div>`;

  const btn = slot.querySelector('.alert-btn');
  const pop = slot.querySelector('.alert-pop');
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  pop.querySelector('[data-act="close"]').addEventListener('click', close);
  const readBtn = pop.querySelector('[data-act="read"]');
  if (readBtn) readBtn.addEventListener('click', async () => {
    try {
      await apiPost('/api/notifications/read-all', scope ? { scope } : {});
      await loadAlertButton(slotId, scope);
      const again = document.querySelector(`#${slotId} .alert-pop`);
      if (again) { again.hidden = false; document.querySelector(`#${slotId} .alert-btn`).setAttribute('aria-expanded', 'true'); }
    } catch (e) { /* ignore */ }
  });
}
