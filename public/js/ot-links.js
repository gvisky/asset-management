/* The OT pages for the IT team, from the pages they belong to (instead of three more menu items):
     Needs Attention  → ⚠️ OT Needs Attention (counts per check)
     Reports          → 📊 OT Reports (open / Excel / PDF)
     Users & Audit    → 🕓 OT Activity (latest changes)
   Fills <div id="ot-box" data-ot="attention | reports | activity">. IT team only (the OT team has them in its menu). */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = { dup_name: '🔁', dup_ip: '🔁', dup_mac: '🔁', old_fw: '⬆️', http: '🔓', net: '🌐', dns: '🧭', broken: '🔴', missing: '✏️', port: '🔌' };
  const card = (title, right, body) => `<div class="card" style="margin-bottom:18px"><div class="card-header"><span class="card-title">${title}</span><span style="flex:1"></span>${right}</div><div class="card-body">${body}</div></div>`;
  const R = {
    async attention(box) {
      const d = await apiGet('/api/servers/ot-attention'), n = d.groups.reduce((s, g) => s + g.rows.length, 0);
      box.innerHTML = card(`🏭 OT Needs Attention <span class="text-muted text-sm">· ${d.total} OT devices · ${n} thing${n === 1 ? '' : 's'} to check</span>`, `${['admin', 'editor'].includes((window.CURRENT_USER || {}).role) ? '<a class="btn btn-ghost btn-sm" href="/ot-activity.html" style="margin-right:6px">🕓 OT Activity</a>' : ''}<a class="btn btn-primary btn-sm" href="/ot-attention.html">Open →</a>`,
        d.groups.length ? `<div class="ota-cards">${d.groups.map(g => `<a href="/ot-attention.html#g-${g.key}" class="ota-card ${g.where}"><span>${ICON[g.key] || '⚠'}</span><b>${g.rows.length}</b><small>${esc(g.title)}</small></a>`).join('')}</div>`
          : '<p class="text-muted" style="margin:0">Nothing to fix on the OT devices. 🎉</p>');
    },
    async reports(box) {
      const d = await apiGet('/api/ot-reports');
      box.innerHTML = card('🏭 OT Reports <span class="text-muted text-sm">· OT devices, cameras, OT switch ports, attention, port changes</span>', '<a class="btn btn-ghost btn-sm" href="/ot-reports.html">Open all →</a>',
        `<div class="otr-list">${d.reports.map(r => `<div class="otr-card" style="cursor:default"><span>${r.icon}</span><b><a href="/ot-reports.html?r=${r.key}">${esc(r.title)}</a></b><small>${esc(r.desc)}</small>
          <div style="display:flex;gap:6px;margin-top:6px"><a class="btn btn-sm rep-xlsx" href="/api/ot-reports/${r.key}.xlsx" download>📊 Excel</a><a class="btn btn-sm rep-pdf" href="/api/ot-reports/${r.key}.pdf" download>📄 PDF</a></div></div>`).join('')}</div>`);
    },
    async activity(box) {
      const d = await apiGet('/api/ot-activity?days=7');
      const when = (s) => { const t = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(t) ? s : t.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); };
      box.innerHTML = card(`🕓 OT Activity <span class="text-muted text-sm">· changes to OT devices and OT switch ports, last 7 days: ${d.rows.length}</span>`, '<a class="btn btn-primary btn-sm" href="/ot-activity.html">Open · restore →</a>',
        d.rows.length ? `<table class="nm-vt"><tbody>${d.rows.slice(0, 5).map(r => `<tr><td class="text-sm" style="white-space:nowrap">${esc(when(r.at))}</td><td>${esc(r.by_user)} <span class="oac-tm ${esc(r.by_team)}">${esc(r.by_team)}</span></td>
          <td><b>${esc(r.label)}</b></td><td class="text-sm">${esc(String(r.summary).slice(0, 140))}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted" style="margin:0">No OT changes in the last 7 days.</p>');
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('ot-box'); if (!box) return;
    const t = setInterval(() => { const u = window.CURRENT_USER; if (!u) return; clearInterval(t);
      if (u.team !== 'IT' || !R[box.dataset.ot]) return;
      R[box.dataset.ot](box).catch(() => { box.innerHTML = ''; }); }, 80);
  });
})();
