/* Is two-step login required for everyone? (app_meta 'mfa_required': '1' on — the default — or '0' off)
   Switched by a global admin on Users & Audit. Cached a few seconds (read on every request). */
const { getMeta, setMeta } = require('../db/database');
let cache = null, at = 0;
async function mfaRequired() {
  if (cache !== null && Date.now() - at < 10000) return cache;
  const v = await getMeta('mfa_required').catch(() => null);
  cache = v == null || v === '' ? true : v === '1'; at = Date.now();
  return cache;
}
async function setMfaRequired(on) { await setMeta('mfa_required', on ? '1' : '0'); cache = !!on; at = Date.now(); }
module.exports = { mfaRequired, setMfaRequired };
