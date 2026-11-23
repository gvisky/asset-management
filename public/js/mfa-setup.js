// Required two-step login setup: shown right after sign-in to anyone who has not added the
// authenticator yet. Nothing else in the app opens until this is done (see middleware/auth.js).
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Something went wrong'); e.status = r.status; throw e; }
  return d;
}
let me = null;

async function start() {
  try { me = await api('/api/auth/me'); } catch (e) { window.location.href = '/login.html'; return; }
  if (!me.mfa_setup_required) { window.location.href = '/'; return; }
  $('ms-who').innerHTML = `Hello <b style="color:#fff">${esc(me.full_name || me.username)}</b> — two-step login is now required for every account. One time, about 1 minute.`;
  $('ms-body').innerHTML = `
    <ol style="margin:0 0 14px 18px;padding:0;line-height:1.75;font-size:14px">
      <li>On your phone install <b>Google Authenticator</b><br><span class="text-muted" style="font-size:12.5px">(App Store / Google Play — Microsoft Authenticator also works)</span></li>
      <li>In the app tap <b>+</b> → <b>Scan a QR code</b> and scan the code below</li>
      <li>Type the 6-digit code the app shows</li>
    </ol>
    <div style="text-align:center" id="ms-qr"><p class="text-muted">Making your QR code…</p></div>
    <div class="form-group" style="margin-top:12px"><label class="form-label">Code from the app</label>
      <input class="form-control" id="ms-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"
        style="text-align:center;font-size:24px;letter-spacing:6px;padding:12px"></div>
    <div id="ms-err" style="color:#dc2626;font-size:13px;margin-bottom:10px"></div>
    <button class="btn btn-primary" id="ms-go" style="width:100%;justify-content:center">Turn on</button>`;
  try {
    const d = await api('/api/auth/mfa/setup', {});
    $('ms-qr').innerHTML = `<img src="${d.qr}" alt="QR code" width="210" height="210" style="border:1px solid var(--border);border-radius:10px;padding:6px;background:#fff">
      <p class="text-muted" style="font-size:12px;margin:8px 0 2px">On this phone already? In the app choose <b>Enter a setup key</b>:</p>
      <p style="font-family:monospace;font-size:14.5px;letter-spacing:1px;margin:0;user-select:all">${esc(d.secret)}</p>`;
  } catch (e) { $('ms-qr').innerHTML = `<p style="color:#dc2626">${esc(e.message)}</p>`; }
  const go = async () => {
    $('ms-go').disabled = true; $('ms-err').textContent = '';
    try { const r = await api('/api/auth/mfa/enable', { code: $('ms-code').value.trim() }); done(r.recovery_codes); }
    catch (e) { $('ms-err').textContent = e.message; $('ms-go').disabled = false; $('ms-code').select(); }
  };
  $('ms-go').onclick = go;
  $('ms-code').addEventListener('input', () => { if (/^\d{6}$/.test($('ms-code').value.trim()) && !$('ms-go').disabled) go(); });
  setTimeout(() => $('ms-code').focus(), 150);
}

function done(codes) {
  const txt = codes.join('\n');
  $('ms-who').textContent = 'Two-step login is on ✓';
  $('ms-body').innerHTML = `
    <p style="margin:0 0 8px"><b>Save these 10 recovery codes</b> (password manager, or print and keep them safe). If you lose your phone, each code lets you sign in <b>once</b>. They are shown <b>only now</b>.</p>
    <pre style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:12px;font-size:15px;columns:2;line-height:1.8;margin:0">${codes.map(esc).join('\n')}</pre>
    <div style="display:flex;gap:8px;margin:10px 0 16px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="ms-copy">📋 Copy</button>
      <a class="btn btn-ghost btn-sm" download="hayat-tools-recovery-codes.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent('Hayat Tools — recovery codes (' + (me.username || '') + ')\n\n' + txt + '\n')}">⬇ Download .txt</a>
    </div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13.5px;margin-bottom:12px"><input type="checkbox" id="ms-saved" style="margin-top:3px"> I saved my recovery codes</label>
    <button class="btn btn-primary" id="ms-continue" style="width:100%;justify-content:center" disabled>Continue</button>`;
  $('ms-copy').onclick = () => navigator.clipboard.writeText(txt).then(() => { $('ms-copy').textContent = '✓ Copied'; });
  $('ms-saved').onchange = () => { $('ms-continue').disabled = !$('ms-saved').checked; };
  $('ms-continue').onclick = () => { window.location.href = '/'; };
}

$('ms-logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login.html';
});
start();
