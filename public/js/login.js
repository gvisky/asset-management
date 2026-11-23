// Sign in: username + password; then, if the account has two-step login on,
// the 6-digit authenticator code (or a one-time recovery code).
const $ = (id) => document.getElementById(id);
let challenge = null;

const goHome = (me) => { window.location.href = me && (me.team === 'OT' || me.team === 'NET') ? '/network-map.html' : '/'; };
function showStep(mfa) {
  $('login-form').style.display = mfa ? 'none' : '';
  $('mfa-form').style.display = mfa ? '' : 'none';
  if (mfa) { $('mfa-code').value = ''; $('mfa-error').style.display = 'none'; setTimeout(() => $('mfa-code').focus(), 50); }
  else { challenge = null; $('password').value = ''; $('password').focus(); }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn'), errEl = $('login-error');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Login failed');
    if (data.mfa_required) {
      challenge = data.challenge;
      $('mfa-user').textContent = 'Hayat Tools (' + $('username').value.trim() + ')';
      showStep(true);
      btn.disabled = false; btn.textContent = 'Sign in';
      return;
    }
    if (data.mfa_setup_required) { window.location.href = '/mfa-setup.html'; return; }
    goHome(data);
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

$('mfa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('mfa-btn'), errEl = $('mfa-error');
  errEl.style.display = 'none'; errEl.style.color = '#dc2626';
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await fetch('/api/auth/login/mfa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, code: $('mfa-code').value.trim() }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (data.restart) { showStep(false); $('login-error').textContent = data.error; $('login-error').style.display = 'block'; return; }
      throw new Error(data.error || 'Wrong code');
    }
    goHome(data);
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
    $('mfa-code').select();
  } finally { btn.disabled = false; btn.textContent = 'Verify'; }
});

// Auto-submit when 6 digits are typed / pasted.
$('mfa-code').addEventListener('input', () => {
  const v = $('mfa-code').value.replace(/\s+/g, '');
  if (/^\d{6}$/.test(v) && !$('mfa-btn').disabled) $('mfa-form').requestSubmit();
});
$('mfa-recovery').addEventListener('click', (e) => {
  e.preventDefault();
  const i = $('mfa-code');
  i.removeAttribute('inputmode'); i.placeholder = 'xxxx-xxxx'; i.style.letterSpacing = '2px'; i.value = ''; i.focus();
  $('mfa-error').textContent = 'Type one of the recovery codes you saved when you turned on two-step login. Each code works once.';
  $('mfa-error').style.color = '#475569'; $('mfa-error').style.display = 'block';
});
$('mfa-back').addEventListener('click', (e) => { e.preventDefault(); showStep(false); });
