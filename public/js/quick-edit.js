/* Quick edit of an asset without leaving the page (Stocktake, QR labels).
   QuickEdit.open(assetId, onSaved)
   Loads the full asset, lets you change the common fields, and saves the whole record back with
   PUT /api/assets/:id (same rules as Asset Inventory: Serial / Brand-Model / Asset Code are IT-only and
   follow the record lock; a holder change locks the record; IT admins can unlock here).
   Setting a laptop to Broken asks for the parts check (parts-check.js). */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
  const ALL = ['location', 'country', 'department', 'computer_no', 'brand_model', 'date_assigned', 'serial_no', 'mk', 'asset_code', 'user_name', 'ad_name',
    'history_usage', 'remark', 'status', 'purchase_date', 'warranty_expiry', 'vendor', 'cost', 'po_number', 'cost_center', 'ecc_cc', 'asset_s4',
    'asset_description', 'cost_center_desc', 'asset_type'];
  const me = () => window.CURRENT_USER || {};
  let cur = null, done = null;

  function ui() {
    if (document.getElementById('qe-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="qe-ov"><div class="modal" style="max-width:640px">
      <div class="modal-header"><span class="modal-title" id="qe-t">Edit asset</span><button class="modal-close" id="qe-x" aria-label="Close">✕</button></div>
      <div class="modal-body" id="qe-b"></div>
      <div class="modal-footer"><a class="btn btn-ghost" id="qe-full" target="_blank" rel="noopener" style="margin-right:auto">Open in Asset Inventory ↗</a>
        <button class="btn btn-ghost" id="qe-c">Cancel</button><button class="btn btn-primary" id="qe-s">Save</button></div></div></div>`);
    const close = () => document.getElementById('qe-ov').classList.remove('open');
    document.getElementById('qe-x').onclick = close; document.getElementById('qe-c').onclick = close;
    document.getElementById('qe-s').onclick = save;
  }

  async function open(id, onSaved) {
    ui(); done = onSaved || null;
    document.getElementById('qe-b').innerHTML = '<p class="text-muted">Loading…</p>';
    document.getElementById('qe-ov').classList.add('open');
    let a;
    try { a = await apiGet('/api/assets/' + id); } catch (e) { document.getElementById('qe-b').innerHTML = `<p class="text-muted">${esc(errText(e, 'Could not load'))}</p>`; return; }
    cur = a;
    const it = me().team === 'IT', itAdmin = it && me().role === 'admin';
    const protRO = !it || !!a.fields_locked, holdRO = !!a.user_locked;
    document.getElementById('qe-t').textContent = `Edit — ${a.asset_s4 || a.asset_code || '#' + a.id}`;
    document.getElementById('qe-full').href = '/inventory.html?search=' + encodeURIComponent(a.asset_s4 || a.asset_code || a.serial_no || '');
    const f = (k, label, ro, type = 'text') => `<div class="form-group"><label class="form-label">${label}</label>
      <input class="form-control" id="qe-${k}" type="${type}" value="${esc(a[k] || '')}" ${ro ? 'readonly style="background:#f3f4f6"' : ''}></div>`;
    const sel = (k, label, opts) => `<div class="form-group"><label class="form-label">${label}</label><select class="form-control" id="qe-${k}">
      ${opts.map(o => `<option value="${esc(o)}"${(a[k] || '') === o ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></div>`;
    document.getElementById('qe-b').innerHTML = `
      ${protRO ? `<div class="qe-note">🔒 Serial, Brand/Model and Asset Code: ${a.fields_locked ? 'locked — an IT admin must unlock them in Asset Inventory' : 'only IT members can change them'}.</div>` : ''}
      ${holdRO ? `<div class="qe-note" id="qe-hold">🔒 User Name / AD Name are locked (holder change waits for the SAP update).
        ${itAdmin ? '<button type="button" class="btn btn-ghost btn-sm" id="qe-unlock">🔓 Unlock</button>' : 'An IT admin must unlock it.'}</div>` : ''}
      <div class="qe-grid">
        ${f('asset_s4', 'Asset S4')}${f('asset_code', 'Asset Code (ECC)', protRO)}
        ${f('asset_type', 'Asset type')}${f('brand_model', 'Brand / Model', protRO)}
        ${f('serial_no', 'Serial', protRO)}${f('computer_no', 'Computer No')}
        ${sel('status', 'Status', ['Active', 'Stock', 'Broken'].concat(['Active', 'Stock', 'Broken'].includes(a.status) ? [] : [a.status || '']))}
        ${a.country === 'Vietnam' ? sel('location', 'Site', ['', 'Office', 'Factory']) : `<div class="form-group"><label class="form-label">Country</label><input class="form-control" value="${esc(a.country)}" readonly style="background:#f3f4f6"></div>`}
        ${f('user_name', 'User Name', holdRO)}${f('ad_name', 'AD Name', holdRO)}
        ${f('department', 'Department')}${f('purchase_date', 'Purchase date', false, 'date')}
      </div>
      <div class="form-group"><label class="form-label">Remark</label><input class="form-control" id="qe-remark" value="${esc(a.remark || '')}"></div>`;
    const ub = document.getElementById('qe-unlock');
    if (ub) ub.onclick = async () => {
      try { await apiPost(`/api/assets/${a.id}/user-unlock`, {}); cur.user_locked = 0;
        ['user_name', 'ad_name'].forEach(k => { const el = document.getElementById('qe-' + k); el.readOnly = false; el.style.background = ''; });
        document.getElementById('qe-hold').remove(); showToast('Unlocked — you can change User Name / AD Name');
      } catch (e) { showToast(errText(e, 'Could not unlock'), 'error'); }
    };
  }

  async function save() {
    const a = cur; if (!a) return;
    const body = {};
    for (const k of ALL) body[k] = a[k] == null ? '' : a[k];
    for (const k of ['asset_s4', 'asset_code', 'asset_type', 'brand_model', 'serial_no', 'computer_no', 'status', 'location', 'user_name', 'ad_name', 'department', 'purchase_date', 'remark']) {
      const el = document.getElementById('qe-' + k); if (el) body[k] = el.value.trim();
    }
    const btn = document.getElementById('qe-s'); btn.disabled = true;
    try {
      let parts = null;
      if (body.status === 'Broken' && a.status !== 'Broken' && String(body.asset_type).toLowerCase() === 'laptop' && typeof partsCheck === 'function') {
        parts = await partsCheck({ title: `Parts check — ${body.asset_s4 || body.asset_code || '#' + a.id} · set to Broken`, parts: a.parts, required: true });
        if (!parts) { showToast('Parts check is needed to set a laptop to Broken', 'error'); return; }
      }
      await apiPut('/api/assets/' + a.id, body);
      if (parts) { try { await savePartsCheckFor(a.id, parts); } catch (e) { showToast(errText(e, 'Saved, but the parts check was not'), 'error'); } }
      document.getElementById('qe-ov').classList.remove('open');
      showToast('Asset saved');
      if (done) done(a.id);
    } catch (e) { showToast(errText(e, 'Could not save'), 'error'); }
    finally { btn.disabled = false; }
  }

  window.QuickEdit = { open };
})();
