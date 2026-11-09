/* Keep the Device Check up to date with Asset Inventory.
   The differences are worked out at upload time; when assets change afterwards (added from a device,
   edited, merged, deleted, restored) or a difference is marked as checked, they must be worked out
   again from the stored device list. recheckDevices() does that, but only when something changed
   (signature of assets + accepted checks + last upload), so calling it before every read is cheap. */

const { get, all, batch, getMeta, setMeta } = require('../db/database');
const { makeContext, evaluate } = require('./device-check');

// Bump when the comparison rules change, so stored differences are worked out again after a deploy.
const RULES_VERSION = 'r3-pc-candidates';
let running = null;
async function signature() {
  // Count + last change + a checksum of the compared fields (two edits in the same second still change it).
  const a = await get(`SELECT COUNT(*) AS n, COALESCE(MAX(COALESCE(updated_at, created_at)), '') AS m,
      SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS live,
      SUM(CASE WHEN deleted_at IS NULL THEN id * 7 + LENGTH(COALESCE(computer_no, '')) * 131 + LENGTH(COALESCE(serial_no, '')) * 17
          + LENGTH(COALESCE(ad_name, '')) * 3 + LENGTH(COALESCE(asset_code, '') || COALESCE(asset_s4, '')) * 5
          + LENGTH(COALESCE(asset_description, '')) + LENGTH(COALESCE(brand_model, '')) * 11 ELSE 0 END) AS sum FROM assets`);
  const k = await get('SELECT COUNT(*) AS n, COALESCE(MAX(at), \'\') AS m FROM device_ack');
  return [RULES_VERSION, a.n, a.m, a.live, a.sum, k.n, k.m, await getMeta('device_check_last')].join('|');
}

async function recheck(force) {
  const sig = await signature();
  if (!force && sig === await getMeta('device_recheck_sig')) return 0;
  const devices = await all('SELECT id, device_key, name, os, ownership, serial_no, user_upn, manufacturer, model, asset_id, issues, asset_values FROM devices');
  if (!devices.length) { await setMeta('device_recheck_sig', sig); return 0; }
  const assets = await all('SELECT id, computer_no, serial_no, brand_model, ad_name, user_name, asset_type, asset_code, asset_s4, asset_description FROM assets WHERE deleted_at IS NULL ORDER BY id');
  const acks = await all('SELECT device_key, code, value FROM device_ack');
  const ctx = makeContext([], assets, acks);
  const stmts = [];
  for (const d of devices) {
    const { asset, issues, assetValues } = evaluate(d, ctx, d.device_key || undefined);
    const iss = issues.length ? JSON.stringify(issues) : '';
    const aid = asset ? asset.id : null;
    if (iss !== (d.issues || '') || aid !== d.asset_id || assetValues !== (d.asset_values || '')) {
      stmts.push({ sql: 'UPDATE devices SET issues = ?, asset_id = ?, asset_values = ? WHERE id = ?', args: [iss, aid, assetValues, d.id] });
    }
  }
  if (stmts.length) await batch(stmts, 100);
  await setMeta('device_recheck_sig', sig);
  return stmts.length;
}

/** Re-run the comparison if assets / accepted checks changed since the last time (force: always). */
async function recheckDevices(force = false) {
  if (running) return running;                         // one at a time
  running = recheck(force).catch((e) => { console.error('[device-recheck]', e.message); return 0; }).finally(() => { running = null; });
  return running;
}

module.exports = { recheckDevices };
