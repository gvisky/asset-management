/* Parts check of a broken laptop — one popup used by Maintenance and Asset Inventory.
   partsCheck({ title, parts, required }) → Promise<{ total, parts, note } | null> (null = cancelled).
   required: every part must be set (or Total broken) — used when a laptop is set to Broken. */

const PC_PARTS = [['screen', 'Screen'], ['mainboard', 'Mainboard'], ['ram', 'RAM'], ['keyboard', 'Keyboard'], ['battery', 'Battery'],
  ['storage', 'SSD / Storage'], ['charger', 'Charger']];
const isLaptopType = (t) => String(t || '').trim().toLowerCase() === 'laptop';
const parsePartsJson = (v) => { if (v && typeof v === 'object') return v; try { const p = v ? JSON.parse(v) : {}; return p && typeof p === 'object' ? p : {}; } catch { return {}; } };

function pcxOverlay() {
  let ov = document.getElementById('pcx-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'modal-overlay'; ov.id = 'pcx-overlay';
  ov.innerHTML = `<div class="modal" style="max-width:560px">
    <div class="modal-header"><span class="modal-title" id="pcx-title">Parts check</span>
      <button class="modal-close" id="pcx-close" aria-label="Close">✕</button></div>
    <div class="modal-body" id="pcx-body"></div>
    <div class="modal-footer"><button class="btn btn-ghost" id="pcx-cancel">Cancel</button>
      <button class="btn btn-primary" id="pcx-save">Save</button></div></div>`;
  document.body.appendChild(ov);
  return ov;
}

function partsCheck({ title, parts, required }) {
  const p = parsePartsJson(parts);
  const ov = pcxOverlay();
  document.getElementById('pcx-title').textContent = title || 'Parts check';
  const opt = (k, v, label) => `<label class="pc-opt"><input type="radio" name="pcx-${k}" value="${v}"${(p[k] || '') === v ? ' checked' : ''}> ${label}</label>`;
  document.getElementById('pcx-body').innerHTML = `
    ${required ? '<div class="pc-required">⚠ This laptop is set to <b>Broken</b>: check which parts are broken before saving — set every part, or tick <b>Total broken</b>.</div>' : ''}
    <label class="pc-total"><input type="checkbox" id="pcx-total"${p.total ? ' checked' : ''}> <b>Total broken</b> — no part can be used</label>
    <table class="pc-table" id="pcx-parts"><tbody>${PC_PARTS.map(([k, name]) => `<tr><td><b>${name}</b></td><td>
      ${opt(k, 'ok', '✓ Usable')}${opt(k, 'bad', '✗ Broken')}${opt(k, 'used', '↪ Used as spare')}${required ? '' : opt(k, '', 'Not checked')}</td></tr>`).join('')}</tbody></table>
    <div class="form-group" style="margin-top:10px"><label class="form-label">Note</label><input class="form-control" id="pcx-note" maxlength="300" value="${htmlEsc(p.note || '')}" placeholder="e.g. water damage, screen cracked"></div>
    ${p.checked_by ? `<p class="text-muted text-sm">Last check by ${htmlEsc(p.checked_by)} · ${htmlEsc(p.checked_at || '')} UTC</p>` : ''}`;
  const tot = document.getElementById('pcx-total');
  const sync = () => { document.getElementById('pcx-parts').style.opacity = tot.checked ? .4 : 1; document.querySelectorAll('#pcx-parts input').forEach(i => { i.disabled = tot.checked; }); };
  tot.addEventListener('change', sync); sync();
  ov.classList.add('open');

  return new Promise((resolve) => {
    const done = (val) => {
      ov.classList.remove('open');
      ['pcx-save', 'pcx-cancel', 'pcx-close'].forEach(id => { document.getElementById(id).onclick = null; });
      resolve(val);
    };
    document.getElementById('pcx-cancel').onclick = () => done(null);
    document.getElementById('pcx-close').onclick = () => done(null);
    document.getElementById('pcx-save').onclick = () => {
      const body = { total: tot.checked, note: document.getElementById('pcx-note').value, parts: {} };
      PC_PARTS.forEach(([k]) => { const c = document.querySelector(`input[name="pcx-${k}"]:checked`); body.parts[k] = c ? c.value : ''; });
      if (required && !body.total) {
        const missing = PC_PARTS.filter(([k]) => !body.parts[k]).map(([, n]) => n);
        if (missing.length) { showToast(`Set every part (or tick Total broken): ${missing.join(', ')}`, 'error'); return; }
      }
      done(body);
    };
  });
}

/** Save a parts check of asset `id` (status must already be Broken). */
async function savePartsCheckFor(id, body) {
  return apiPut(`/api/maintenance/devices/${id}/parts`, body);
}
const partsErr = (err, fallback) => { let m = fallback; try { m = JSON.parse(err.message).error || m; } catch {} return m; };
