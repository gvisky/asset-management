/* Server Inventory → 📦 Used / stock (GET /api/servers/usage): per model, how many records are in use according to the
   network mapping (a device of the map / cabled on a switch port in the port sheets) and how many are stock, next to the
   quantity of the implementation document. Records whose status disagrees with the mapping are listed with a fix button. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  let data = null, fam = '', only = '';
  const can = () => ['admin', 'editor'].includes((window.CURRENT_USER || {}).role);
  function shell() {
    if ($('us-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="us-ov"><div class="modal" style="max-width:1100px;width:96vw">
      <div class="modal-header"><span class="modal-title">📦 Used / stock — from the network mapping</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('us-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="us-b" style="max-height:74vh;overflow:auto"></div></div></div>`);
  }
  async function load() { data = await apiGet('/api/servers/usage'); }
  const bar = (f) => { const t = f.total || 1; return `<div class="us-bar" title="${f.used} used · ${f.stock} stock · ${f.broken} broken"><i class="u" style="width:${f.used / t * 100}%"></i><i class="s" style="width:${f.stock / t * 100}%"></i><i class="b" style="width:${f.broken / t * 100}%"></i></div>`; };
  function render() {
    const T = data.totals, flags = data.rows.filter(r => r.flag);
    const rows = data.rows.filter(r => (!fam || r.family === fam) && (!only || (only === 'flag' ? r.flag : r.state === only)));
    $('us-b').innerHTML = `
      <div class="us-sum"><div><b>${T.total}</b><span>records</span></div><div class="u"><b>${T.used}</b><span>in use</span></div><div class="s"><b>${T.stock}</b><span>stock / spare</span></div>
        <div class="b"><b>${T.broken}</b><span>broken</span></div><div class="f"><b>${T.flags}</b><span>status to check</span></div></div>
      <p class="text-muted text-sm" style="margin:6px 0 12px">In use = the record is a device of the network map (same record, serial or hostname) or is cabled on a switch port in the port sheets; retired devices count as not in use. Stock = everything else that is not broken.</p>
      <table class="nm-vt us-t"><thead><tr><th>Model</th><th>Records</th><th>In use</th><th>Stock</th><th>Broken</th><th>Document</th><th style="width:22%"></th><th>To check</th></tr></thead><tbody>
      ${data.families.map(f => `<tr class="${fam === f.family ? 'on' : ''}" data-f="${esc(f.family)}"><td><b>${esc(f.family)}</b></td><td>${f.total}</td><td class="u">${f.used}</td><td class="s">${f.stock}</td><td>${f.broken || ''}</td>
        <td>${f.doc_qty != null ? `${f.doc_qty}${f.doc_qty !== f.total ? ` <span class="text-muted text-sm">(${f.total - f.doc_qty > 0 ? '+' : ''}${f.total - f.doc_qty})</span>` : ' ✓'}` : '<span class="text-muted text-sm">added later</span>'}</td>
        <td>${bar(f)}</td><td>${f.flags ? `<span class="us-flag">${f.flags}</span>` : ''}</td></tr>`).join('')}</tbody></table>
      ${data.missing.length ? `<p class="text-sm" style="margin:10px 0 0">⚠ In the map but no Server Inventory record: ${data.missing.map(m => `<b>${esc(m.hostname)}</b>${m.serial ? ` (${esc(m.serial)})` : ''}`).join(', ')}</p>` : ''}
      <div class="us-bar2"><span class="nm-tabs small">${[['', 'All'], ['used', 'In use'], ['stock', 'Stock'], ['broken', 'Broken'], ['flag', `Status to check (${flags.length})`]].map(([k, l]) => `<button class="${only === k ? 'on' : ''}" data-o="${k}">${l}</button>`).join('')}</span>
        ${fam ? `<span class="text-sm">Model: <b>${esc(fam)}</b> <a href="#" id="us-allf">all models</a></span>` : '<span class="text-muted text-sm">Click a model to list its records.</span>'}
        <span style="flex:1"></span>${can() && rows.some(r => r.flag === 'Active but not in the mapping') ? `<button class="btn btn-ghost btn-sm" id="us-bulk">Set the ${rows.filter(r => r.flag === 'Active but not in the mapping').length} "Active but not in the mapping" to Stock</button>` : ''}</div>
      <table class="nm-vt"><thead><tr><th>Record</th><th>Model</th><th>Serial</th><th>Status</th><th>In the mapping</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 400).map(r => `<tr class="${r.flag ? 'us-fl' : ''}"><td><a href="/server-inventory.html?view=${r.id}">#${r.id}</a> ${esc(r.hostname || '')}</td><td class="text-sm">${esc(r.brand_model)}</td><td class="si-sn">${esc(r.serial_no || '')}</td>
        <td>${esc(r.status)}</td><td class="text-sm">${r.map ? `<span class="us-st ${r.state}">${r.state === 'used' ? 'in use' : r.map.retired ? 'retired' : r.state}</span> ${esc(r.map.hostname)} <span class="text-muted">${esc(r.map.location || '')}${r.map.how === 'hostname' ? ' · matched by name' : ''}</span>`
          : `<span class="us-st ${r.state}">${r.state === 'stock' ? 'not in the mapping' : r.state}</span>`}${r.flag ? `<div class="us-why">⚠ ${esc(r.flag)}</div>` : ''}</td>
        <td style="white-space:nowrap">${can() && r.flag === 'Active but not in the mapping' ? `<button class="btn btn-ghost btn-sm" data-st="Stock" data-id="${r.id}">→ Stock</button>` : can() && r.flag === 'Stock but in the mapping' ? `<button class="btn btn-ghost btn-sm" data-st="Active" data-id="${r.id}">→ Active</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Nothing here.</td></tr>'}
      </tbody></table>`;
    $('us-b').querySelectorAll('tr[data-f]').forEach(tr => { tr.onclick = () => { fam = fam === tr.dataset.f ? '' : tr.dataset.f; render(); }; });
    $('us-b').querySelectorAll('[data-o]').forEach(b => { b.onclick = () => { only = b.dataset.o; render(); }; });
    if ($('us-allf')) $('us-allf').onclick = (e) => { e.preventDefault(); fam = ''; render(); };
    $('us-b').querySelectorAll('[data-st]').forEach(b => { b.onclick = () => setStatus([Number(b.dataset.id)], b.dataset.st); });
    if ($('us-bulk')) $('us-bulk').onclick = () => { const ids = rows.filter(r => r.flag === 'Active but not in the mapping').map(r => r.id);
      if (confirm(`Set ${ids.length} record${ids.length > 1 ? 's' : ''} to Stock? They are not in the network mapping (spares).`)) setStatus(ids, 'Stock'); };
  }
  async function setStatus(ids, status) {
    let ok = 0; for (const id of ids) { try { await apiPut('/api/servers/' + id, { status }); ok++; } catch {} }
    showToast(`${ok} record${ok === 1 ? '' : 's'} set to ${status}`); await load(); render();
    if (typeof loadServers === 'function') loadServers();
  }
  async function open() { shell(); $('us-ov').classList.add('open'); $('us-b').innerHTML = '<p class="text-muted">Counting…</p>'; try { await load(); render(); } catch { $('us-b').innerHTML = '<p class="text-muted">Could not count.</p>'; } }
  window.ServerUsage = { open };
})();
