/* TOTP (RFC 6238) — the 6-digit codes of Google Authenticator, Microsoft Authenticator,
   Authy … Built on Node's crypto only (HMAC-SHA1, 30-second steps, 6 digits).
   Secrets are base32 (what the authenticator apps scan from the QR code). */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of s) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const STEP = 30, DIGITS = 6;
const stepNow = (t = Date.now()) => Math.floor(t / 1000 / STEP);

function codeAt(secret, step) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  msg.writeUInt32BE(step >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Returns the matching time step (to block re-use of the same code), or null.
// window = 1 accepts the previous / next 30 s as well (phone clock a little off).
function verify(secret, code, { window = 1, afterStep = -1, now = Date.now() } = {}) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const cur = stepNow(now);
  for (let w = -window; w <= window; w++) {
    const st = cur + w;
    if (st <= afterStep) continue;
    const exp = Buffer.from(codeAt(secret, st)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(exp, got)) return st;
  }
  return null;
}

const newSecret = () => base32Encode(crypto.randomBytes(20));   // 160-bit, 32 chars

function otpauthUrl(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

// Recovery codes: 10 × "xxxx-xxxx" (letters + digits without look-alikes); stored hashed.
const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(8);
    const s = [...b].map(x => RC[x % RC.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
const hashRecovery = (code) => crypto.createHash('sha256').update(String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

module.exports = { base32Encode, base32Decode, codeAt, verify, stepNow, newSecret, otpauthUrl, newRecoveryCodes, hashRecovery };
