/* OT activity log (table ot_activity): every change to an OT device of the Server Inventory (it_ot = 'OT') and to a port of
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

const teams = new Map();
async function teamOf(user) {
  if (user && typeof user === 'object') return user.team || '';
  if (!teams.has(user)) { const u = await get('SELECT team FROM users WHERE username = ?', [user]).catch(() => null); teams.set(user, (u && u.team) || ''); }
  return teams.get(user);
}
const nameOf = (user) => (user && typeof user === 'object' ? user.username : String(user || ''));

async function insert(user, e) {
  await run(`INSERT INTO ot_activity (by_user, by_team, kind, ref_type, ref_id, label, summary, site, before, after, restore_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nameOf(user), await teamOf(user), e.kind, e.ref_type, e.ref_id, String(e.label || '').slice(0, 120), String(e.summary || '').slice(0, 1000), e.site || '',
      e.before ? JSON.stringify(e.before) : '', e.after ? JSON.stringify(e.after) : '', e.restore_of || null]);
}

/** A Server Inventory record changed (before / after = full rows or null). Logged when either side is OT. */
async function logServer(user, before, after, meta = {}) {
  const b = pick(before, SERVER_KEYS), a = pick(after, SERVER_KEYS);
  if (!((b && b.it_ot === 'OT') || (a && a.it_ot === 'OT'))) return;
  if (b && a && !diff(b, a, SERVER_KEYS).length) return;
  const kind = meta.kind || (!b ? 'device_add' : a && a.deleted_at && !b.deleted_at ? 'device_delete' : 'device_edit');
  await insert(user, { kind, ref_type: 'server', ref_id: (after || before).id, label: (after || before).hostname || '#' + (after || before).id,
    summary: (meta.prefix ? meta.prefix + ': ' : '') + summary(b, a, SERVER_KEYS), before: b, after: a, restore_of: meta.restore_of });
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

/** A switch port changed (dev = net device; before / after = port rows or null). Logged for OT switches only. */
async function logPort(user, dev, before, after, meta = {}) {
  if (!dev || !(meta.force || require('../routes/netmap').otOn(dev))) return;
  const port = (after || before || {}).port || meta.port;
  const b = pick(before, PORT_KEYS), a = pick(after, PORT_KEYS);
  if (!diff(b || {}, a || {}, PORT_KEYS).length) return;
  await insert(user, { kind: meta.kind || 'port', ref_type: 'port', ref_id: dev.id, label: `${dev.hostname} ${port}`, site: dev.site,
    summary: (meta.prefix ? meta.prefix + ': ' : '') + summary(b || {}, a || {}, PORT_KEYS), before: b && { ...b, port }, after: a && { ...a, port }, restore_of: meta.restore_of });
}
/** Snapshot of the ports of the OT switches of a site (for bulk changes): "deviceId|port" → row. */
async function snapOTPorts(site) {
  const nm = require('../routes/netmap');
  const devs = (await all('SELECT * FROM net_devices WHERE site = ?', [site])).filter(d => nm.otOn(d));
  const ids = new Set(devs.map(d => d.id));
  const ports = (await all('SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ?', [site])).filter(p => ids.has(p.device_id));
  return { devs: new Map(devs.map(d => [d.id, d])), ports: new Map(ports.map(p => [`${p.device_id}|${p.port}`, p])) };
}
async function logPortsBulk(user, site, before, prefix) {
  const now = await snapOTPorts(site);
  for (const [k, a] of now.ports) { const b = before.ports.get(k); if (!b || diff(b, a, PORT_KEYS).length) await logPort(user, now.devs.get(a.device_id), b || null, a, { prefix }); }
}

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
    const line = `${ts}: restored to before the change of ${String(e.at).slice(0, 16)} UTC by ${nameOf(user)} (OT activity #${e.id})`;
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
  await run("UPDATE ot_activity SET restored_at = datetime('now'), restored_by = ? WHERE id = ?", [nameOf(user), e.id]);
}

module.exports = { logServer, snapOT, logOTBulk, logPort, snapOTPorts, logPortsBulk, changedSince, restore, SERVER_KEYS, PORT_KEYS };
