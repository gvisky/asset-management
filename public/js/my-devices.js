/* My devices — staff confirm the company devices registered to them (routes/confirm.js, public).
   Link: /my-devices.html#t=<secret>  (the secret stays in the # part: not sent to servers / logs).
   1. enter your work email (must match our record)  2. answer each device (company phones / tablets too for
   Turkish staff; others see them as "also signed in on") and confirm — the checked email is the signature  3. done. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  const main = document.getElementById('md-main');
  let email = '', data = null;

  async function call(path, body) {
    const r = await fetch('/api/my-devices/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong — please try again.'); e.state = j.state; throw e; }
    return j;
  }
  const stop = (msg, icon = '⚠️') => { main.innerHTML = `<div class="md-stop"><div class="md-big">${icon}</div><p>${esc(msg)}</p></div>`; };

  async function start() {
    if (!token) return stop('This link is incomplete. Please open the button in the email from IT again.');
    let o;
    try { o = await call('open', {}); } catch (e) { return stop(e.message); }
    main.innerHTML = `<h2 class="md-h">Hello${o.first_name ? ' ' + esc(o.first_name) : ''} 👋</h2>
      <p>IT keeps a list of the company devices registered to you. ${o.state === 'done' ? `You already confirmed it on <b>${esc(o.confirmed_at)} UTC</b>.` : 'Please check it and confirm.'}</p>
      <form id="md-f" class="md-form">
        <label class="form-label" for="md-email">Your work email</label>
        <input class="form-control" id="md-email" type="email" autocomplete="email" required placeholder="name@company.com">
        <div class="md-err" id="md-err"></div>
        <button class="btn btn-primary md-btn">Continue →</button>
        <p class="text-muted text-sm">To be sure it is you, type your work email — the one this message was sent to.</p>
      </form>`;
    document.getElementById('md-f').onsubmit = verify;
    document.getElementById('md-email').focus();
  }

  async function verify(ev) {
    ev.preventDefault();
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    email = document.getElementById('md-email').value.trim();
    try { data = await call('verify', { email }); render(); }
    catch (e) { if (e.state === 'verify') { document.getElementById('md-err').textContent = e.message; btn.disabled = false; } else stop(e.message); }
  }

  function render() {
    const d = data, done = !!d.confirmed_at;
    const row = (a) => `<div class="md-dev" data-id="${a.id}">
        <div class="md-dev-t"><b>${esc([a.type, a.model].filter(Boolean).join(' · ') || 'Device')}</b>
          <div class="text-sm text-muted">${a.code ? 'Asset ' + esc(a.code) + ' · ' : ''}SN ${esc(a.serial || '—')}${a.pc ? ' · ' + esc(a.pc) : ''}${a.place ? ' · ' + esc(a.place) : ''}</div></div>
        ${done ? `<span class="md-res ${a.result === 'not_have' ? 'no' : 'ok'}">${a.result === 'not_have' ? '✗ Not with me' : a.result ? '✓ I have it' : '—'}</span>`
          : `<div class="md-ch">
            <label class="md-opt ok"><input type="radio" name="h${a.id}" value="1"> ✓ I have it</label>
            <label class="md-opt no"><input type="radio" name="h${a.id}" value="0"> ✗ Not with me</label></div>
          <input class="form-control md-note" id="n${a.id}" maxlength="300" placeholder="What happened? (e.g. returned to IT, given to …)" hidden>`}
      </div>`;
    const mob = d.mobiles || [], company = d.mode === 'company';
    const mrow = (m) => `<div class="md-dev" data-key="${esc(m.key)}">
        <div class="md-dev-t"><b>${m.kind === 'Tablet' ? '📱 Tablet' : '📱 Phone'} · ${esc(m.model || m.name || 'Device')}</b>
          <div class="text-sm text-muted">${[m.name && m.model ? m.name : '', m.os, m.serial ? 'SN ' + m.serial : '', m.last ? 'last seen ' + m.last : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
        ${!company ? '' : done ? `<span class="md-res ${m.result === 'not_have' ? 'no' : 'ok'}">${m.result === 'not_have' ? '✗ Not with me' : m.result ? '✓ I have it' : '—'}</span>`
          : `<div class="md-ch">
            <label class="md-opt ok"><input type="radio" name="m_${esc(m.key)}" value="1"> ✓ I have it</label>
            <label class="md-opt no"><input type="radio" name="m_${esc(m.key)}" value="0"> ✗ Not with me</label></div>
          <input class="form-control md-note" maxlength="300" placeholder="What happened? (e.g. returned to IT, lost, broken …)" hidden>`}
      </div>`;
    main.innerHTML = `<h2 class="md-h">${esc(d.name)}</h2><div class="text-muted text-sm">${esc(d.email)}</div>
      ${done ? `<div class="md-done">✅ Confirmed on <b>${esc(d.confirmed_at)} UTC</b>. Thank you!</div>` : ''}
      <h3 class="md-h3">Devices registered to you (${d.assets.length})</h3>
      ${d.assets.length ? d.assets.map(row).join('') : '<p class="text-muted">No company computer or other asset is registered to you.</p>'}
      ${mob.length ? (company
        ? `<h3 class="md-h3">Company phones &amp; tablets (${mob.length})</h3>${mob.map(mrow).join('')}`
        : `<h3 class="md-h3">You are also signed in on these devices (${mob.length})</h3>
           <p class="text-muted text-sm" style="margin:-4px 0 8px">Your own phones / tablets with company apps (Outlook, Teams…) — nothing to confirm. If one is not yours any more, write it in the box below.</p>
           <div class="md-info">${mob.map(mrow).join('')}</div>`) : ''}
      ${done ? '' : `<div class="form-group" style="margin-top:14px"><label class="form-label">Another company device you use that is not listed? (optional)</label>
          <input class="form-control" id="md-extra" maxlength="300" placeholder="e.g. Dell monitor, iPhone 13 — serial if you know it"></div>
        <div class="md-signwith">✍️ You sign with your work email <b>${esc(email.toLowerCase())}</b></div>
        <label class="md-agree"><input type="checkbox" id="md-agree"> I confirm the answers above are correct, and I will take care of the company devices I have and return them to IT when asked or when I leave.</label>
        <div class="md-err" id="md-err"></div>
        <button class="btn btn-primary md-btn" id="md-go">Confirm</button>`}`;
    if (done) return;
    main.querySelectorAll('.md-dev input[type=radio]').forEach(r => r.onchange = () => {
      const note = r.closest('.md-dev').querySelector('.md-note');
      note.hidden = r.value !== '0'; r.closest('.md-dev').classList.toggle('md-dev-no', r.value === '0'); r.closest('.md-dev').classList.toggle('md-dev-ok', r.value === '1');
    });
    document.getElementById('md-go').onclick = confirm;
  }

  async function confirm() {
    const err = document.getElementById('md-err'); err.textContent = '';
    const items = [];
    for (const a of data.assets) {
      const c = main.querySelector(`input[name="h${a.id}"]:checked`);
      if (!c) { err.textContent = 'Please answer every device: ✓ I have it or ✗ Not with me.'; return; }
      items.push({ asset_id: a.id, have: c.value === '1', note: document.getElementById('n' + a.id).value.trim() });
    }
    if (data.mode === 'company') for (const m of data.mobiles || []) {
      const box = [...main.querySelectorAll('.md-dev[data-key]')].find(x => x.dataset.key === m.key);
      const c = box && box.querySelector('input[type=radio]:checked');
      if (!c) { err.textContent = 'Please answer every device: ✓ I have it or ✗ Not with me.'; return; }
      items.push({ device_key: m.key, have: c.value === '1', note: box.querySelector('.md-note').value.trim() });
    }
    if (!document.getElementById('md-agree').checked) { err.textContent = 'Please tick the confirmation box.'; return; }
    const btn = document.getElementById('md-go'); btn.disabled = true;
    try {
      const r = await call('confirm', { email, items, extra: document.getElementById('md-extra').value.trim() });
      main.innerHTML = `<div class="md-stop"><div class="md-big">✅</div><h2 class="md-h">Thank you, ${esc(data.name)}!</h2>
        <p>Your confirmation was recorded on <b>${esc(r.confirmed_at)} UTC</b> (${r.count} device${r.count === 1 ? '' : 's'}), signed with <b>${esc(r.signed_with)}</b>.</p>
        ${r.not_with_me ? `<p>IT has been told about the ${r.not_with_me} device${r.not_with_me === 1 ? '' : 's'} you do not have, and may contact you.</p>` : ''}
        <p class="text-muted text-sm">You can close this page.</p></div>`;
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  }

  start();
})();
