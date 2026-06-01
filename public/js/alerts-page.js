/* Needs Attention page: missing-info/dup-serial table, HR-changes box, all alerts. */

function naEsc(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

async function loadNeedsAttention() {
  const tbody = document.getElementById('na-tbody');
  try {
    const rows = await apiGet('/api/assets/incomplete');
    const badge = document.getElementById('na-count');
    if (rows.length) { badge.textContent = `${rows.length}`; badge.style.display = ''; }
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">
        <svg width="36" height="36" fill="none" stroke="#22c55e" stroke-width="1.5" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>Nothing needs attention. 🎉</p></div></td></tr>`;
      return;
    }
    const miss = (v) => (v === null || v === undefined || String(v).trim() === '');
    tbody.innerHTML = rows.map(a => {
      const tags = [];
      if (miss(a.serial_no))   tags.push('Serial');
      if (miss(a.asset_code))  tags.push('Code');
      if (miss(a.computer_no)) tags.push('PC No');
      if (a.status === 'Active' && miss(a.ad_name)) tags.push('AD Name');
      let html = tags.map(t => `<span class="badge badge-broken" style="margin:1px;font-size:10.5px;padding:2px 6px">${t}</span>`).join('');
      if (a.dup_serial) {
        const others = (a.dup_with || []).map(o => o.asset_code || `#${o.id}`).join(', ');
        const title = others ? `Same serial "${a.serial_no}" as: ${others}` : `Duplicate serial "${a.serial_no}"`;
        html += `<span class="badge" title="${naEsc(title)}" style="margin:1px;font-size:10.5px;padding:2px 6px;background:#fde68a;color:#92400e">Dup Serial: ${naEsc(a.serial_no) || '?'}${others ? ` (also ${naEsc(others)})` : ''}</span>`;
      }
      const label = a.brand_model || a.user_name || a.department || `Asset #${a.id}`;
      return `<tr>
        <td><div class="truncate" title="${naEsc(label)}" style="max-width:200px">${label}</div><span class="text-muted text-sm">#${a.id} · ${a.location}</span></td>
        <td><span class="badge badge-factory">${a.country}</span></td>
        <td>${html}</td>
        <td><a class="btn btn-primary btn-sm" href="/inventory.html?edit=${a.id}">Fix</a></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Could not load.</td></tr>`;
  }
}

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
  loadNeedsAttention();
  loadHrChanges();
  if (typeof loadAlertBox === 'function') loadAlertBox('alert-box', '');
});
