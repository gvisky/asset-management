/* OT activity — now part of the write-once change log (lib/changelog.js → audit_log, ot = 1): every change to an OT device of the Server Inventory (it_ot = 'OT') and to a port of
   an OT switch on the Network map — by the OT team or IT — with the row before and after, so an OT admin / IT admin can
   see who did what and put it back (restore). Used by routes/servers.js, routes/netmap.js and routes/ot-activity.js. */
const { get, all, run } = require('../db/database');

// Fields compared / restored. history_usage is not restored (it keeps the trail), updated_at is noise.
const SERVER_KEYS = ['country', 'location', 'hostname', 'brand_model', 'producer', 'category', 'serial_no', 'asset_code', 'ip_address',
  'os', 'cpu', 'ram', 'storage', 'role', 'status', 'purchase_date', 'warranty_expiry', 'vendor', 'cost', 'po_number', 'remark',
  'it_ot', 'mac', 'vlan', 'ot_system', 'switch_port', 'extra', 'deleted_at', 'deleted_by'];
const PORT_KEYS = ['peer_host', 'peer_port', 'cable', 'mode', 'vlan', 'grp', 'patch', 'note', 'ot'];
const LABEL = { hostname: 'Name', ip_address: 'IP', brand_model: 'Model', serial_no: 'Serial', os: 'Firmware', switch_port: 'Connected to', it_ot: 'IT/OT',
  peer_host: 'Device', peer_port: 'Far port', ot: 'Owner', deleted_at: 'Deleted', remark: 'Note', ot_system: 'OT system' };

const norm = (v) => (v == null ? '' : String(v));
const pick = (row, keys) => (row ? Object.fromEntries(keys.map(k => [k, row[k] == null ? null : row[k]])) : null);
const diff = (a, b, keys) => keys.filter(k => norm(a && a[k]) !== norm(b && b[k]));
const short = (v) => { const s = norm(v); return s.length > 40 ? s.slice(0, 39) + '…' : s; };
function summary(a, b, keys) {
  if (!a) return 'added';
  if (!b) return 'removed';
  if (!a.deleted_at && b.deleted_at) return 'deleted';
  if (a.deleted_at && !b.deleted_at) return 'restored from the bin';
  return diff(a, b, keys).filter(k => k !== 'deleted_by').map(k => `${LABEL[k] || k}: "${short(a[k]) || '∅'}" → "${short(b[k]) || '∅'}"`).join('; ');
}

const CL = require('./changelog');
const { nameOf } = CL;

/** A Server Inventory record changed (before / after = full rows or null) — ONE change-log row. With meta.details (a single
    edit from the Server Inventory) it is always written; otherwise (bulk imports) only when either side is OT. */
async function logServer(user, before, after, meta = {}) {
  const b = pick(before, SERVER_KEYS), a = pick(after, SERVER_KEYS);
  const ot = !!((b && b.it_ot === 'OT') || (a && a.it_ot === 'OT'));
  if (!ot && !meta.details) return;
  if (b && a && !diff(b, a, SERVER_KEYS).length && !meta.details) return;
  const kind = meta.kind || (!b ? 'device_add' : a && a.deleted_at && !b.deleted_at ? 'device_delete' : 'device_edit');
  const row = after || before, label = row.hostname || '#' + row.id;
  const sum = (meta.prefix ? meta.prefix + ': ' : '') + summary(b, a, SERVER_KEYS);
  await CL.log(user, { action: meta.action || (kind === 'device_add' ? 'CREATE' : kind === 'device_delete' ? 'DELETE' : 'UPDATE'), asset_id: row.id,
    details: meta.details ? `${meta.details}${sum && sum !== 'added' ? ' — ' + sum : ''}` : `${ot ? 'OT device' : 'Server'} "${label}": ${sum}`,
    kind, ref_type: 'server', ref_id: row.id, label, summary: sum, before: b, after: a, ot, restore_of: meta.restore_of });
}
/** Snapshot of all OT records (for bulk changes): id → row. */
async function snapOT() { return new Map((await all("SELECT * FROM servers WHERE it_ot = 'OT'")).map(r => [r.id, r])); }
async function logOTBulk(user, beforeMap, prefix) {
  const after = await snapOT(), ids = new Set([...beforeMap.keys(), ...after.keys()]);
  // Records that left OT (it_ot changed) are still compared through their own row.
  for (const id of ids) {
    let a = after.get(id); if (!a) a = await get('SELECT * FROM servers WHERE id = ?', [id]);
    await logServer(user, beforeMap.get(id) || null, a || null, { prefix });
  }
}

/** A switch port changed (dev = net device; before / after = port rows or null) — ONE change-log row: the Network map
    port history text (meta.beforeText / afterText) and, for OT switches, the rows for restore. */
async function logPort(user, dev, before, after, meta = {}) {
  if (!dev) return;
  const port = (after || before || {}).port || meta.port;
  const b = pick(before, PORT_KEYS), a = pick(after, PORT_KEYS);
  const textChanged = meta.beforeText !== undefined && meta.beforeText !== meta.afterText;
  if (!diff(b || {}, a || {}, PORT_KEYS).length && !textChanged) return;
  const ot = !!(meta.force || require('../routes/netmap').otOn(dev));
  const sum = (meta.prefix ? meta.prefix + ': ' : '') + summary(b || {}, a || {}, PORT_KEYS);
  const bt = meta.beforeText !== undefined ? meta.beforeText : '', at = meta.afterText !== undefined ? meta.afterText : sum;
  await CL.log(user, { action: 'NETMAP', details: `Network map "${dev.site}": ${dev.hostname} ${port}: ${bt ? bt + ' → ' : ''}${at}${meta.prefix && meta.beforeText !== undefined ? ` (${meta.prefix})` : ''}`,
    kind: meta.kind || 'port', ref_type: 'port', ref_id: dev.id, label: `${dev.hostname} ${port}`, summary: sum, site: dev.site, device: dev.hostname, port,
    before_text: bt, after_text: at, before: b && { ...b, port }, after: a && { ...a, port }, ot, restore_of: meta.restore_of });
}
/** Snapshot of the ports of the OT switches of a site (for bulk changes): "deviceId|port" → row. */
async function snapOTPorts(site) {
  const nm = require('../routes/netmap');
  const devs = (await all('SELECT * FROM net_devices WHERE site = ?', [site])).filter(d => nm.otOn(d));
  const ids = new Set(devs.map(d => d.id));
  const ports = (await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site])).filter(p => ids.has(p.device_id));
  return { devs: new Map(devs.map(d => [d.id, d])), ports: new Map(ports.map(p => [`${p.device_id}|${p.port}`, p])) };
}
// After a bulk import: the import already wrote one Network map line per port it changed (PORT_LOG_SQL). For the OT
// switches, add the rows for restore to THAT line (no second line); a port changed without a line gets its own.
async function logPortsBulk(user, site, before, prefix) {
  const now = await snapOTPorts(site);
  for (const [k, a] of now.ports) {
    const b = before.ports.get(k); if (b && !diff(b, a, PORT_KEYS).length) continue;
    const dev = now.devs.get(a.device_id), pb = pick(b, PORT_KEYS), pa = pick(a, PORT_KEYS);
    const line = await get(`SELECT id FROM audit_log WHERE site = ? AND device = ? AND port = ? AND COALESCE(before_json, '') = '' AND COALESCE(after_json, '') = ''
      AND created_at >= datetime('now', '-10 minutes') ORDER BY id DESC LIMIT 1`, [site, dev.hostname, a.port]);
    if (line) await run('UPDATE audit_log SET ot = 1, kind = ?, ref_id = ?, label = ?, summary = ?, before_json = ?, after_json = ?, by_team = ? WHERE id = ?',
      ['port', dev.id, `${dev.hostname} ${a.port}`, `${prefix}: ${summary(pb || {}, pa || {}, PORT_KEYS)}`, pb ? JSON.stringify({ ...pb, port: a.port }) : '', JSON.stringify({ ...pa, port: a.port }), await CL.teamOf(user), line.id]);
    else await logPort(user, dev, b || null, a, { prefix, force: true });
  }
}
/** audit_log row (ot = 1) → the OT activity entry shape used below and by routes/ot-activity.js. */
const entry = (r) => r && ({ id: r.id, at: r.created_at, by_user: r.username, by_team: r.by_team, kind: r.kind, ref_type: r.ref_type, ref_id: r.ref_id, label: r.label,
  summary: r.summary, site: r.site, before: r.before_json, after: r.after_json, restored_at: r.restored_at, restored_by: r.restored_by, restore_of: r.restore_of });

/** Is the row now still what the entry left behind? (else someone changed it again since) */
async function current(e) {
  if (e.ref_type === 'server') return pick(await get('SELECT * FROM servers WHERE id = ?', [e.ref_id]), SERVER_KEYS);
  const port = JSON.parse(e.after || e.before || '{}').port;
  return pick(await get('SELECT * FROM net_ports WHERE device_id = ? AND port = ?', [e.ref_id, port]), PORT_KEYS);
}
async function changedSince(e) {
  const after = e.after ? JSON.parse(e.after) : null, cur = await current(e);
  const keys = e.ref_type === 'server' ? SERVER_KEYS.filter(k => k !== 'deleted_by') : PORT_KEYS;
  if (!after) return !!(cur && (e.ref_type === 'port' ? keys.some(k => norm(cur[k])) : !cur.deleted_at));
  return !!diff(after, cur || {}, keys).length;
}

/** Put the row back as it was before the entry (an add is undone by deleting the record / clearing the port). */
async function restore(e, user) {
  const before = e.before ? JSON.parse(e.before) : null;
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  if (e.ref_type === 'server') {
    const row = await get('SELECT * FROM servers WHERE id = ?', [e.ref_id]);
    if (!row) throw new Error('The record is gone');
    const line = `${ts}: restored to before the change of ${String(e.at).slice(0, 16)} UTC by ${nameOf(user)} (change #${e.id})`;
    if (!before) await run("UPDATE servers SET deleted_at = datetime('now'), deleted_by = ?, history_usage = COALESCE(history_usage, '') || char(10) || ? WHERE id = ?", [nameOf(user), line, e.ref_id]);
    else {
      const keys = SERVER_KEYS;
      await run(`UPDATE servers SET ${keys.map(k => `${k} = ?`).join(', ')}, history_usage = COALESCE(history_usage, '') || char(10) || ? WHERE id = ?`, [...keys.map(k => before[k]), line, e.ref_id]);
    }
    await logServer(user, row, await get('SELECT * FROM servers WHERE id = ?', [e.ref_id]), { kind: 'restore', restore_of: e.id, prefix: `undo #${e.id}` });
  } else {
    const dev = await get('SELECT * FROM net_devices WHERE id = ?', [e.ref_id]);
    if (!dev) throw new Error('The switch is gone');
    const port = JSON.parse(e.after || e.before).port;
    const values = before || { peer_host: '', peer_port: '', cable: '', mode: '', vlan: '', grp: '', patch: '', note: '', ot: null };
    await require('../routes/netmap').restorePort(dev, port, values, user, { kind: 'restore', restore_of: e.id, prefix: `undo #${e.id}`, force: true });
  }
  await run("UPDATE audit_log SET restored_at = datetime('now'), restored_by = ? WHERE id = ?", [nameOf(user), e.id]);
}

module.exports = { logServer, snapOT, logOTBulk, logPort, snapOTPorts, logPortsBulk, changedSince, restore, entry, SERVER_KEYS, PORT_KEYS };
