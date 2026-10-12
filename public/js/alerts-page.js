/* Needs Attention page: Missing Info + Missing AD & Asset panels (shared with the
   Dashboard / Asset Inventory), the HR-changes box, and the 🔔 Alerts button. */

async function loadHrChanges() {
  const box = document.getElementById('hr-box');
  try {
    const { data } = await apiGet('/api/notifications?scope=personnel');
    const hr = data.filter(n => /^HR \(/.test(n.message));
    if (!hr.length) { box.innerHTML = '<div class="text-muted text-sm">No recent changes by HR.</div>'; return; }
    box.innerHTML = hr.map(n => `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="color:#dc2626;font-size:10px;line-height:18px">${n.read ? '○' : '●'}</span>
        <div style="flex:1"><div style="font-size:13px">${n.message}</div>
          <div class="text-muted text-sm">${n.created_at}</div></div>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = '<div class="text-muted text-sm">Could not load.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Fixing one problem can clear the other list too, so a save in either panel reloads both.
  const panels = {};
  const reloadOther = (key) => () => { const other = panels[key === 'missing' ? 'ad' : 'missing']; if (other) other.reload(); };
  panels.missing = NeedsAttention({ root: document.getElementById('na-missing'), mode: 'missing', maxHeight: 480, onSaved: reloadOther('missing') });
  panels.ad = NeedsAttention({ root: document.getElementById('na-ad'), mode: 'ad', maxHeight: 420, onSaved: reloadOther('ad') });
  loadHrChanges();
  if (typeof loadAlertButton === 'function') loadAlertButton('alert-btn-slot', '');
});
