/* ⚠️ Needs Attention — Servers & Network: Missing Info (GET /api/servers/needs-info).
   Shared by Server Inventory (window), the Needs Attention page (panel) and the Dashboard (summary card).
     ServerAttention.panel(root, { maxHeight, onSaved })   full list with chips and fill-in-place inputs
     ServerAttention.summary(root)                          count card with the issue chips + link
     ServerAttention.count()                                → total (for a badge) */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TITLE = '⚠️ Needs Attention — Servers & Network: Missing Info';
  const ISSUES = ['Serial', 'Hostname', 'IP', 'Location', 'Dup Serial', 'Serial ≠ document'];
  const FIELD = { Serial: 'serial_no', Hostname: 'hostname', IP: 'ip_address', Location: 'location', 'Serial ≠ document': 'serial_no' };
  const badge = (s) => (typeof statusBadge === 'function' ? statusBadge(s) : esc(s));
  let cache = null;
  async function load(force) { if (!cache || force) cache = await apiGet('/api/servers/needs-info'); return cache; }

  function panel(root, opts = {}) {
    let filter = '';
    const me = () => window.CURRENT_USER || {};
    const render = () => {
      const d = cache, canEdit = ['admin', 'editor'].includes(me().role), it = me().team === 'IT';
      const rows = d.rows.filter(r => !filter || r.issues.includes(filter));
      const input = (r, k) => { const f = FIELD[k]; if (!f || !canEdit || (f === 'serial_no' && !it)) return '';
        return `<label class="na-in"><span>${k === 'Serial ≠ document' ? 'Serial' : k}</span><input class="form-control" data-f="${f}" value="${esc(r[f] || '')}" placeholder="${k === 'IP' ? '10.84.x.x' : k === 'Location' ? 'e.g. MAIN RACK - 03 (U29)' : ''}"></label>`; };
      root.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">${TITLE}</span>
          <span class="text-muted text-sm">${d.total ? `${d.total} device${d.total > 1 ? 's' : ''}` : 'all complete'}</span>
          <span style="flex:1"></span><a class="btn btn-ghost btn-sm" href="/server-inventory.html">Server Inventory →</a></div>
        <div class="card-body">
        ${d.has_doc ? (d.models.length ? `<div class="na-q">📦 Quantity differs from the implementation document: ${d.models.map(m => `<b>${esc(m.family)}</b> ${m.status === 'missing' ? `${-m.diff} missing` : `${m.diff} more`} (document ${m.expected}, inventory ${m.inv})`).join(' · ')}</div>`
          : '<div class="na-q ok">📦 Every model matches the quantity in the implementation document (devices added after it, like the Palo Alto PA-440, count as fine).</div>') : ''}
        <div class="na-chips"><button class="${filter ? '' : 'on'}" data-k="">All <b>${d.total}</b></button>${ISSUES.map(k => d.counts[k] ? `<button class="${filter === k ? 'on' : ''}" data-k="${esc(k)}">${k} <b>${d.counts[k]}</b></button>` : '').join('')}</div>
        <div style="max-height:${opts.maxHeight || 600}px;overflow:auto">${rows.length ? `<table class="ic-tbl"><thead><tr><th>Device</th><th>Missing / to check</th><th>Fill in</th><th></th></tr></thead><tbody>
          ${rows.map(r => `<tr data-id="${r.id}"><td><b>${esc(r.hostname || '—')}</b><div class="text-muted text-sm">#${r.id} · ${esc(r.brand_model)} · ${esc(r.category || '')} · ${esc(r.country || '')}</div><div class="text-sm">S/N ${esc(r.serial_no || '—')} · ${badge(r.status)}</div></td>
            <td>${r.issues.map(k => `<span class="na-tag">${k}</span>`).join(' ')}${r.doc_note ? `<div class="text-sm" style="color:#b45309;margin-top:4px">${esc(r.doc_note)}</div>` : ''}</td>
            <td><div class="na-fill">${[...new Set(r.issues)].map(k => input(r, k)).join('')}</div></td>
            <td style="white-space:nowrap">${canEdit && r.issues.some(k => FIELD[k]) ? '<button class="btn btn-primary btn-sm" data-save>Save</button> ' : ''}<a class="btn btn-ghost btn-sm" href="/server-inventory.html?view=${r.id}">👁</a></td></tr>`).join('')}</tbody></table>`
          : '<p class="ic-ok">✓ Every device has its key info. 🎉</p>'}</div>
        <p class="text-muted text-sm" style="margin:10px 0 0">Network devices and servers need Serial, Hostname, IP and Location; access points a Serial. Serial: IT members only. Broken devices are not listed.</p></div></div>`;
      root.querySelectorAll('.na-chips button').forEach(b => { b.onclick = () => { filter = b.dataset.k; render(); }; });
      root.querySelectorAll('[data-save]').forEach(b => { b.onclick = async () => {
        const tr = b.closest('tr'), body = {};
        tr.querySelectorAll('input[data-f]').forEach(i => { body[i.dataset.f] = i.value.trim(); });
        try { await apiPut('/api/servers/' + tr.dataset.id, body); showToast('Saved'); await load(true); render(); if (opts.onSaved) opts.onSaved(cache); }
        catch (e) { let m = 'Could not save'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
      }; });
    };
    root.innerHTML = '<div class="card"><div class="card-body text-muted">Loading…</div></div>';
    load(true).then(render).catch(() => { root.innerHTML = ''; });
    return { reload: () => load(true).then(render) };
  }

  // Dashboard: count + chips, the list opens on the Needs Attention page.
  async function summary(root) {
    let d; try { d = await load(true); } catch { root.innerHTML = ''; return; }
    root.innerHTML = `<div class="card na-sum"><div class="card-header"><span class="card-title">${TITLE}</span><span style="flex:1"></span>
        <a class="btn btn-ghost btn-sm" href="/alerts.html#na-servers">Open the list →</a></div>
      <div class="card-body na-sum-b"><div class="na-big ${d.total ? '' : 'ok'}">${d.total}</div>
        <div><div class="text-sm" style="margin-bottom:6px">${d.total ? `device${d.total > 1 ? 's' : ''} in Server Inventory need info${Object.keys(d.byCountry).length ? ' · ' + Object.entries(d.byCountry).map(([c, n]) => `${esc(c)} ${n}`).join(' · ') : ''}` : 'All servers and network devices have their key info 🎉'}</div>
          <div class="na-chips" style="margin:0">${ISSUES.map(k => d.counts[k] ? `<a class="na-chip" href="/alerts.html#na-servers">${k} <b>${d.counts[k]}</b></a>` : '').join('')}</div>
          ${d.models.length ? `<div class="text-sm" style="color:#b45309;margin-top:6px">📦 Quantity differs from the document: ${d.models.map(m => esc(m.family)).join(', ')}</div>` : ''}</div></div></div>`;
  }
  async function count() { try { return (await load(true)).total; } catch { return 0; } }

  window.ServerAttention = { panel, summary, count, TITLE };
})();
