/* 🎬 Videos (/videos.html, routes/media.js): upload a video, get a public link (/v/<token>) that plays without login, and
   an e-mail with the video in it — the player for mail apps that play video (Apple Mail / iPhone), the picture with a ▶
   linking to the video page for the others (Outlook, Gmail). IT admins and editors. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  const errText = (e, f) => { try { return JSON.parse(e.message).error || f; } catch { return (e && e.message) || f; } };
  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
  const dur = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const base = location.origin;
  const links = (v) => ({ watch: `${base}/v/${v.token}`, mp4: `${base}/media/${v.token}.mp4`, poster: `${base}/media/${v.token}.jpg` });
  let D = { rows: [], chunk: 2 * 1024 * 1024 }, busy = false;

  async function load() {
    try { D = await apiGet('/api/media'); render(); }
    catch (e) { $('vd-root').innerHTML = `<p class="text-muted">${esc(errText(e, 'Could not load'))}</p>`; }
  }
  function render() {
    $('vd-sub').textContent = `· ${D.rows.length} video${D.rows.length === 1 ? '' : 's'}`;
    $('vd-root').innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-body vd-up">
        <div><b>⬆ Upload a video</b><div class="text-muted text-sm">MP4 (H.264) plays everywhere — up to 500 MB. It gets a public link that plays without login; switch the link off or delete the video at any time.</div></div>
        <input class="form-control" id="vd-title" placeholder="Title (shown on the video page and in the e-mail)" style="max-width:340px">
        <input type="file" id="vd-file" accept="video/mp4,video/webm,video/quicktime" hidden>
        <button class="btn btn-primary" id="vd-pick"${busy ? ' disabled' : ''}>Choose video…</button>
        <div id="vd-prog" class="vd-prog" hidden><div class="vd-bar"><i id="vd-bar"></i></div><span id="vd-ptxt" class="text-sm"></span></div>
      </div></div>
      <div class="vd-grid">${D.rows.map(v => { const L = links(v); return `<div class="card vd-card${v.public ? '' : ' off'}">
        <a href="${L.watch}" target="_blank" rel="noopener" class="vd-thumb"><img src="${L.poster}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🎬'}))"><span class="vd-dur">${dur(v.duration)}</span></a>
        <div class="card-body"><b>${esc(v.title)}</b><div class="text-muted text-sm">${mb(v.size)}${v.width ? ` · ${v.width}×${v.height}` : ''} · ${v.views} view${v.views === 1 ? '' : 's'} · ${esc(v.uploaded_by)}, ${esc(String(v.uploaded_at).slice(0, 10))}</div>
          ${v.ready ? `<div class="vd-link"><input class="form-control" readonly value="${L.watch}" onclick="this.select()"><button class="btn btn-ghost btn-sm" data-copy="${L.watch}" title="Copy the public link">📋</button></div>`
            : '<div class="text-sm" style="color:#b45309">Upload not finished — delete it and upload again.</div>'}
          <div class="vd-acts">${v.ready ? `<button class="btn btn-primary btn-sm" data-mail="${v.id}">✉ E-mail</button><a class="btn btn-ghost btn-sm" href="${L.watch}" target="_blank" rel="noopener">▶ Open</a>
            <button class="btn btn-ghost btn-sm" data-pub="${v.id}" title="${v.public ? 'Switch the public link off (the video stays)' : 'Switch the public link on'}">${v.public ? '🔓 Link on' : '🔒 Link off'}</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-edit="${v.id}" title="Title / note">✏️</button><button class="btn btn-ghost btn-sm" data-del="${v.id}" title="Delete">🗑</button></div></div></div>`; }).join('')
        || '<p class="text-muted">No videos yet.</p>'}</div>`;
    $('vd-pick').onclick = () => $('vd-file').click();
    $('vd-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); };
    $('vd-root').querySelectorAll('[data-copy]').forEach(b => { b.onclick = () => copyText(b.dataset.copy, 'Link copied'); });
    $('vd-root').querySelectorAll('[data-mail]').forEach(b => { b.onclick = () => mail(D.rows.find(v => v.id === Number(b.dataset.mail))); });
    $('vd-root').querySelectorAll('[data-pub]').forEach(b => { b.onclick = async () => { const v = D.rows.find(x => x.id === Number(b.dataset.pub));
      if (v.public && !confirm(`Switch the public link of "${v.title}" off? People who have the link (or the e-mail) can no longer play it until you switch it on again.`)) return;
      await apiPut('/api/media/' + v.id, { public: !v.public }); load(); }; });
    $('vd-root').querySelectorAll('[data-edit]').forEach(b => { b.onclick = async () => { const v = D.rows.find(x => x.id === Number(b.dataset.edit));
      const t = prompt('Title', v.title); if (t == null) return; const n = prompt('Note under the video (optional)', v.note || ''); if (n == null) return;
      await apiPut('/api/media/' + v.id, { title: t, note: n }); load(); }; });
    $('vd-root').querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => { const v = D.rows.find(x => x.id === Number(b.dataset.del));
      if (!confirm(`Delete "${v.title}"? Its link stops working (also in e-mails already sent).`)) return;
      try { await apiDelete('/api/media/' + v.id); showToast('Deleted'); load(); } catch (e) { showToast(errText(e, 'Could not delete'), 'error'); } }; });
  }
  async function copyText(t, msg) { try { await navigator.clipboard.writeText(t); showToast(msg); } catch { prompt('Copy:', t); } }

  // The video's size and length, and a poster: a frame (at 1 s) with a ▶ button — the picture in the e-mail.
  function readVideo(file) {
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file), v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      v.onerror = () => { URL.revokeObjectURL(url); no(new Error('This browser cannot read the video — use an MP4 (H.264) file')); };
      // Poster: of a few frames (10 … 50 % through, past the intro), the brightest — not a black fade.
      const at = [0.1, 0.2, 0.3, 0.4, 0.5]; let k = 0, best = null;
      const small = document.createElement('canvas'); small.width = 64; small.height = 36; const sg = small.getContext('2d', { willReadFrequently: true });
      v.onloadedmetadata = () => { v.currentTime = (v.duration || 2) * at[0]; };
      v.onseeked = () => {
        sg.drawImage(v, 0, 0, 64, 36); const px = sg.getImageData(0, 0, 64, 36).data; let lum = 0;
        for (let i = 0; i < px.length; i += 4) lum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        if (!best || lum > best.lum) best = { lum, t: v.currentTime };
        if (++k < at.length) { v.currentTime = (v.duration || 2) * at[k]; return; }
        if (Math.abs(v.currentTime - best.t) > 0.01) { k = 99; v.onseeked = draw; v.currentTime = best.t; return; }
        draw();
      };
      const draw = () => {
        const W = Math.min(1280, v.videoWidth || 1280), H = Math.round(W * (v.videoHeight || 720) / (v.videoWidth || 1280));
        const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
        g.drawImage(v, 0, 0, W, H);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, W, H);
        const r = Math.round(Math.min(W, H) * 0.11), x = W / 2, y = H / 2;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = 'rgba(15,23,42,.72)'; g.fill(); g.lineWidth = Math.max(3, r * 0.08); g.strokeStyle = '#fff'; g.stroke();
        g.beginPath(); g.moveTo(x - r * 0.32, y - r * 0.48); g.lineTo(x - r * 0.32, y + r * 0.48); g.lineTo(x + r * 0.52, y); g.closePath(); g.fillStyle = '#fff'; g.fill();
        const poster = c.toDataURL('image/jpeg', 0.84).split(',')[1];
        ok({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, poster }); URL.revokeObjectURL(url);
      };
    });
  }
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function upload(file) {
    if (busy) return; busy = true;
    const title = ($('vd-title').value.trim() || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')).slice(0, 150);
    $('vd-pick').disabled = true; $('vd-prog').hidden = false; const set = (p, t) => { $('vd-bar').style.width = p + '%'; $('vd-ptxt').textContent = t; };
    try {
      set(1, 'Reading the video…');
      const meta = await readVideo(file);
      const mime = file.type || 'video/mp4';
      const c = await apiPost('/api/media', { title, mime, size: file.size, duration: meta.duration, width: meta.width, height: meta.height, poster_b64: meta.poster });
      for (let n = 0; n < c.chunks; n++) {
        const data = b64(await file.slice(n * c.chunk, (n + 1) * c.chunk).arrayBuffer());
        for (let k = 0; ; k++) { try { await apiPut(`/api/media/${c.id}/chunk`, { n, data_b64: data }); break; } catch (e) { if (k >= 2) throw e; await new Promise(r => setTimeout(r, 1500)); } }
        set(Math.round((n + 1) / c.chunks * 100), `Uploading ${mb(Math.min(file.size, (n + 1) * c.chunk))} of ${mb(file.size)}…`);
      }
      await apiPost(`/api/media/${c.id}/done`, {});
      showToast(`"${title}" uploaded — the public link is ready`); $('vd-title').value = '';
    } catch (e) { showToast(errText(e, 'Upload failed'), 'error'); }
    busy = false; await load();
  }

  // ── The e-mail ──
  const text2html = (t) => esc(t).replace(/\n/g, '<br>');
  function emailHtml(v, msg) {
    const L = links(v), w = 640;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a"><tr><td align="center" style="padding:16px">
<table role="presentation" width="${w}" cellpadding="0" cellspacing="0" border="0" style="max-width:${w}px;width:100%">
${msg ? `<tr><td style="font-size:15px;line-height:1.5;padding:0 0 14px">${text2html(msg)}</td></tr>` : ''}
<tr><td><video width="${w}" controls playsinline poster="${L.poster}" style="width:100%;max-width:${w}px;border-radius:8px;display:block"><source src="${L.mp4}" type="${esc(v.mime)}"><a href="${L.watch}" target="_blank"><img src="${L.poster}" width="${w}" alt="▶ Play the video: ${esc(v.title)}" style="width:100%;max-width:${w}px;height:auto;border:0;border-radius:8px;display:block"></a></video></td></tr>
<tr><td style="font-size:13px;color:#475569;padding:10px 0 0">▶ <a href="${L.watch}" target="_blank" style="color:#1a56db">${esc(v.title)}</a> — if the video does not play here, click the picture or this link (${dur(v.duration)}).</td></tr>
</table></td></tr></table></body></html>`;
  }
  // A draft e-mail file (.eml): Outlook / Apple Mail open it as a new message ready to send (X-Unsent).
  function eml(v, to, subject, html) {
    const enc = (s) => '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
    const body = btoa(unescape(encodeURIComponent(html))).replace(/.{76}/g, '$&\r\n');
    return [`X-Unsent: 1`, to ? `To: ${to}` : 'To: ', `Subject: ${enc(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
  }
  function mail(v) {
    if (!$('vm-ov')) document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="vm-ov"><div class="modal" style="max-width:1000px;width:96vw">
      <div class="modal-header"><span class="modal-title">✉ E-mail with the video</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('vm-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body vm-b"><div class="vm-form">
        <div class="form-group"><label class="form-label">To (optional)</label><input class="form-control" id="vm-to" placeholder="name@company.com; …"></div>
        <div class="form-group"><label class="form-label">Subject</label><input class="form-control" id="vm-sub"></div>
        <div class="form-group"><label class="form-label">Message</label><textarea class="form-control" id="vm-msg" rows="6"></textarea></div>
        <div class="vm-note text-sm"><b>Where it plays</b><br>▶ <b>In the e-mail</b>: Apple Mail, iPhone / iPad Mail, some Android mail apps.<br>🖼 <b>Outlook, Gmail, Outlook.com</b>: they never play video inside a mail — they show the picture with ▶; one click opens the video page and plays it (no login).<br>Sending from Outlook: use <b>⬇ E-mail draft</b> or <b>📋 Copy e-mail</b> and paste into a new message.</div>
      </div><div class="vm-prev"><div class="text-muted text-sm" style="margin-bottom:4px">Preview</div><iframe id="vm-if" title="E-mail preview"></iframe></div></div>
      <div class="modal-footer"><button class="btn btn-ghost" id="vm-link">🔗 Copy link</button><span style="flex:1"></span><button class="btn btn-ghost" id="vm-copy">📋 Copy e-mail</button><button class="btn btn-primary" id="vm-eml">⬇ E-mail draft (.eml)</button></div></div></div>`);
    $('vm-sub').value = v.title;
    $('vm-msg').value = `Dear all,\n\nPlease watch the video "${v.title}" below.\n\nBest regards,\n${(window.CURRENT_USER || {}).full_name || ''}`;
    const html = () => emailHtml(v, $('vm-msg').value.trim());
    const prev = () => { $('vm-if').srcdoc = html(); };
    ['vm-msg', 'vm-sub'].forEach(id => { $(id).oninput = prev; }); prev();
    $('vm-link').onclick = () => copyText(links(v).watch, 'Link copied');
    $('vm-copy').onclick = async () => {
      const h = html(), t = `${$('vm-msg').value.trim()}\n\n▶ ${v.title}: ${links(v).watch}`;
      try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([h], { type: 'text/html' }), 'text/plain': new Blob([t], { type: 'text/plain' }) })]); showToast('E-mail copied — paste it into a new message'); }
      catch { copyText(t, 'Text and link copied'); }
    };
    $('vm-eml').onclick = () => {
      const blob = new Blob([eml(v, $('vm-to').value.trim(), $('vm-sub').value.trim() || v.title, html())], { type: 'message/rfc822' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: (v.title.replace(/[^\w .-]+/g, '').trim() || 'video') + '.eml' });
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      showToast('E-mail draft downloaded — open it, check and send');
    };
    $('vm-ov').classList.add('open');
  }
  document.addEventListener('DOMContentLoaded', load);
})();
