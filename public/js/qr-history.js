/* QR history + asset photos (Stocktake, scanned-label page, asset detail).
   qrHistoryHtml(assetId)            → Promise<html>: photos (everyone) + label prints / scans (admins only)
   takeAssetPhoto(assetId, takeId)   → Promise<bool>: phone camera / file → JPEG ≤ 1280 px → saved on the asset */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return f; } };
  const SRC = { stocktake: 'stocktake', label: 'label scanned with the phone camera' };
  const RES = { found: '✅ found', elsewhere: '📍 found elsewhere', outside: '🔸 outside filter', unknown: '❓ unknown', again: 'scanned again', opened: 'opened' };

  window.qrHistoryHtml = async function (assetId) {
    let h;
    try { h = await apiGet(`/api/stocktake/asset/${assetId}/qr`); } catch { return ''; }
    const photos = h.photos.length ? `<div class="qr-photos">${h.photos.map(p => `<a href="/api/stocktake/photo/${p.id}" target="_blank" rel="noopener" title="${esc(p.taken_by)} · ${esc(String(p.taken_at).slice(0, 16))} UTC${p.note ? ' · ' + esc(p.note) : ''}">
        <img src="/api/stocktake/photo/${p.id}" loading="lazy" alt="photo"></a>`).join('')}</div>` : '';
    if (!h.admin) return photos ? `<div class="form-label" style="margin-top:8px">📷 Photos</div>${photos}` : '';
    const prints = h.prints.length ? h.prints.map(p => `<div>🏷 ${esc(String(p.printed_at).slice(0, 16))} · ${esc(p.printed_by)} · <i>${esc(p.purpose)}</i></div>`).join('') : '<div class="text-muted">never printed</div>';
    const scans = h.scans.length ? h.scans.slice(0, 15).map(s => `<div>📷 ${esc(String(s.scanned_at).slice(0, 16))} · ${esc(s.scanned_by)} · ${esc(SRC[s.source] || s.source)}${s.stocktake ? ' “' + esc(s.stocktake) + '”' : ''} · ${esc(RES[s.result] || s.result)}${s.ip ? ` <span class="text-muted">· ${esc(s.ip)}</span>` : ''}</div>`).join('')
      + (h.scans.length > 15 ? `<div class="text-muted">… ${h.scans.length - 15} more</div>` : '') : '<div class="text-muted">never scanned</div>';
    return `<details class="qr-hist"><summary>🏷 Label printed <b>${h.prints.length}×</b> · scanned <b>${h.scans.length}×</b> · <b>${h.photos.length}</b> photo${h.photos.length === 1 ? '' : 's'} <span class="text-muted">(admins only)</span></summary>
      <div class="qr-cols"><div><div class="form-label">Label prints</div>${prints}</div><div><div class="form-label">Scans (who · when · where)</div>${scans}</div></div></details>${photos}`;
  };

  // JPEG ≤ 1280 px, ~0.8 quality (a phone photo of 4–8 MB becomes ~150–300 KB).
  function shrink(file) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('Not an image')); };
      img.src = url;
    });
  }

  window.takeAssetPhoto = function (assetId, stocktakeId, note) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
      inp.style.display = 'none'; document.body.appendChild(inp);
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; inp.remove();
        if (!f) return resolve(false);
        try {
          const image = await shrink(f);
          await apiPost(`/api/stocktake/asset/${assetId}/photo`, { image, stocktake_id: stocktakeId || null, note: note || '' });
          showToast('📷 Photo saved on the asset'); resolve(true);
        } catch (e) { showToast(errText(e, 'Photo not saved'), 'error'); resolve(false); }
      };
      inp.click();
    });
  };
})();
