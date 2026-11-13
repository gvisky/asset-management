/* E-signed handover / return — one window used by Asset Inventory, Leavers and Stocktake.
   custodyHandover(asset, onDone)   pick the person (User Inventory), note, signature → PDF on the asset
   custodyReturn(asset, onDone)     note, Stock / Broken, signature of the person returning it
   custodyDocsHtml(assetId)         → Promise<html> list of signed records (links to the PDFs)
   qrLabelUrl(ids)                  → label sheet page for these asset ids */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return (e && e.message) || f; } };

  function overlay() {
    let ov = document.getElementById('cus-overlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'modal-overlay'; ov.id = 'cus-overlay';
    ov.innerHTML = `<div class="modal" style="max-width:600px">
      <div class="modal-header"><span class="modal-title" id="cus-title"></span><button class="modal-close" id="cus-x" aria-label="Close">✕</button></div>
      <div class="modal-body" id="cus-body"></div>
      <div class="modal-footer"><button class="btn btn-ghost" id="cus-cancel">Cancel</button><button class="btn btn-primary" id="cus-save">Sign &amp; save</button></div></div>`;
    document.body.appendChild(ov);
    return ov;
  }

  // Signature pad: draw with finger / pen / mouse.
  function pad(canvas) {
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * ratio; canvas.height = h * ratio; ctx.scale(ratio, ratio);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
    let drawing = false, strokes = 0, last = null;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.onpointerdown = (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); };
    canvas.onpointermove = (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; strokes++; e.preventDefault(); };
    canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
    return {
      empty: () => strokes < 5,
      clear: () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); strokes = 0; },
      png: () => canvas.toDataURL('image/png'),
    };
  }

  // Holder lock: shown at the top of the window; an IT admin unlocks right here (signature and note are kept).
  const itAdmin = () => !!(window.CURRENT_USER && window.CURRENT_USER.team === 'IT' && window.CURRENT_USER.role === 'admin');
  function lockBanner(a) {
    return `<div class="cus-lock" id="cus-lock" ${a.user_locked ? '' : 'hidden'}>🔒 <span><b>Locked:</b> an earlier holder change waits for the SAP update.
      ${itAdmin() ? '' : 'An IT admin must unlock it first.'}</span>
      ${itAdmin() ? `<button type="button" class="btn btn-ghost btn-sm" id="cus-unlock">🔓 Unlock</button>` : ''}</div>`;
  }
  function wireUnlock(a) {
    const b = document.getElementById('cus-unlock');
    if (!b) return;
    b.onclick = async () => {
      b.disabled = true;
      try {
        await apiPost(`/api/assets/${a.id}/user-unlock`, {});
        a.user_locked = 0;
        document.getElementById('cus-lock').hidden = true;
        showToast('Unlocked — press Sign & save');
      } catch (e) { b.disabled = false; showToast(errText(e, 'Could not unlock'), 'error'); }
    };
  }

  function open({ title, body, onSave, asset }) {
    const ov = overlay();
    document.getElementById('cus-title').textContent = title;
    document.getElementById('cus-body').innerHTML = (asset ? lockBanner(asset) : '') + body + `
      <div class="form-group" style="margin-top:12px"><label class="form-label">Signature *  <span class="text-muted text-sm">— sign with finger, pen or mouse</span></label>
        <canvas id="cus-pad" class="sig-pad"></canvas>
        <div style="display:flex;justify-content:space-between;margin-top:4px"><span class="text-muted text-sm" id="cus-terms"></span><button class="btn btn-ghost btn-sm" id="cus-clear" type="button">Clear</button></div></div>`;
    ov.classList.add('open');
    const sp = pad(document.getElementById('cus-pad'));
    if (asset) wireUnlock(asset);
    document.getElementById('cus-clear').onclick = () => sp.clear();
    const close = () => ov.classList.remove('open');
    document.getElementById('cus-x').onclick = close; document.getElementById('cus-cancel').onclick = close;
    const save = document.getElementById('cus-save');
    save.disabled = false;
    save.onclick = async () => {
      if (sp.empty()) { showToast('Please sign in the box', 'error'); return; }
      save.disabled = true;
      try { await onSave(sp.png()); close(); }
      catch (e) {
        let code = ''; try { code = JSON.parse(e.message).code || ''; } catch {}
        if (code === 'holder_locked' && asset) { asset.user_locked = 1; const l = document.getElementById('cus-lock'); if (l) l.hidden = false; }
        showToast(errText(e, 'Could not save'), 'error');
      }
      finally { save.disabled = false; }
    };
  }

  const assetLine = (a) => `<div class="cus-asset"><b>${esc(a.asset_s4 || a.asset_code || '#' + a.id)}</b> · ${esc(a.brand_model || '')} · SN ${esc(a.serial_no || '—')}
    <span class="text-muted">· ${esc(a.country || '')}${a.location ? ' · ' + esc(a.location) : ''}</span></div>`;

  window.custodyHandover = function (a, onDone) {
    let picked = null;
    open({
      asset: a,
      title: '✍ Hand over — e-signed',
      body: assetLine(a) + `
        <div class="form-group"><label class="form-label">Person (User Inventory) *</label>
          <input class="form-control" id="cus-q" placeholder="Type a name or email…" autocomplete="off">
          <div id="cus-res" class="cus-res"></div></div>
        <div class="form-group"><label class="form-label">Condition / accessories</label>
          <input class="form-control" id="cus-note" maxlength="500" placeholder="e.g. new, with charger and bag"></div>
        <p class="text-muted text-sm" style="margin:0">The person confirms they received it, will keep it safe, report loss / damage and return it when IT asks or when they leave. A PDF record is kept on the asset.</p>`,
      onSave: async (sig) => {
        if (!picked) throw new Error(JSON.stringify({ error: 'Pick the person from the list' }));
        const r = await apiPost(`/api/custody/asset/${a.id}/handover`, { person_id: picked.id, note: document.getElementById('cus-note').value, signature: sig });
        showToast(`Handed over to ${picked.display_name} — signed record #${r.docId} saved`);
        if (onDone) onDone(r);
      },
    });
    const q = document.getElementById('cus-q'), box = document.getElementById('cus-res');
    let t;
    q.oninput = () => { clearTimeout(t); picked = null; t = setTimeout(async () => {
      const v = q.value.trim(); if (v.length < 2) { box.innerHTML = ''; return; }
      try {
        const list = await apiGet('/api/custody/people?q=' + encodeURIComponent(v));
        box.innerHTML = list.length ? list.map((p, i) => `<div class="cus-pick" data-i="${i}"><b>${esc(p.display_name)}</b> <span class="text-muted text-sm">${esc(p.email || '')} · ${esc(p.department || p.position || '')} · ${esc(p.country || '')}</span></div>`).join('')
          : '<div class="text-muted text-sm" style="padding:6px">No one found in User Inventory</div>';
        box.querySelectorAll('.cus-pick').forEach(el => el.onclick = () => { picked = list[Number(el.dataset.i)]; q.value = picked.display_name; box.innerHTML = `<div class="text-sm" style="padding:4px 2px;color:#16a34a">✓ ${esc(picked.display_name)} · ${esc(picked.email || '')}</div>`; });
      } catch { box.innerHTML = ''; }
    }, 250); };
  };

  window.custodyReturn = function (a, onDone) {
    const laptop = String(a.asset_type || '').toLowerCase() === 'laptop';
    open({
      asset: a,
      title: '↩ Return — e-signed',
      body: assetLine(a) + `<div class="text-sm" style="margin:6px 0 10px">Returned by <b>${esc(a.user_name || a.ad_name || '—')}</b></div>
        <div class="form-group"><label class="form-label">Condition on return *</label>
          <div style="display:flex;gap:14px"><label><input type="radio" name="cus-st" value="Stock" checked> Good → back to <b>Stock</b></label>
          <label><input type="radio" name="cus-st" value="Broken"> <b>Broken</b>${laptop ? ' (parts check next)' : ''}</label></div></div>
        <div class="form-group"><label class="form-label">Note (accessories, damage…)</label><input class="form-control" id="cus-note" maxlength="500" placeholder="e.g. with charger, scratch on lid"></div>`,
      onSave: async (sig) => {
        const status = (document.querySelector('input[name="cus-st"]:checked') || {}).value || 'Stock';
        const r = await apiPost(`/api/custody/asset/${a.id}/return`, { status, note: document.getElementById('cus-note').value, signature: sig });
        showToast(`Returned — signed record #${r.docId} saved`);
        if (status === 'Broken' && laptop && typeof partsCheck === 'function') {
          const parts = await partsCheck({ title: `Parts check — ${a.asset_s4 || a.asset_code || '#' + a.id} · returned broken`, parts: a.parts, required: true });
          if (parts) { try { await savePartsCheckFor(a.id, parts); } catch (e) { showToast(errText(e, 'Parts check not saved'), 'error'); } }
        }
        if (onDone) onDone(r);
      },
    });
  };

  window.custodyDocsHtml = async function (assetId) {
    try {
      const docs = await apiGet(`/api/custody/asset/${assetId}`);
      if (!docs.length) return '<span class="text-muted text-sm">No signed handover / return yet</span>';
      return docs.map(d => `<div class="text-sm" style="margin-bottom:3px">${d.kind === 'return' ? '↩ Return' : '✍ Handover'} · ${esc(String(d.signed_at).slice(0, 16))} UTC ·
        ${esc(d.person_name || '—')} · by ${esc(d.created_by)} · <a href="/api/custody/doc/${d.id}.pdf" target="_blank" rel="noopener">PDF #${d.id}</a></div>`).join('');
    } catch { return '<span class="text-muted text-sm">—</span>'; }
  };

  window.qrLabelUrl = (ids) => '/labels.html?ids=' + ids.join(',');
})();
