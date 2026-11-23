/* OT reports (/ot-reports.html): what the OT team looks after, as a page view (JSON) or a download — Excel (dashboard sheet
   with charts + data sheets, lib/report-excel.js) or PDF (lib/report-pdf.js).
     ot-devices    OT devices of the Server Inventory: by type, status, location + the full list
     ot-cameras    CCTV cameras: by switch, cabinet, model, firmware; HTTP-only / old firmware / no port
     ot-switches   ports of the OT switches: OT (blue) / IT (green) / free per switch + every port
     ot-attention  everything OT Needs Attention lists, by check
     ot-changes    port changes on the OT switches (last 90 days)
   OT team and the IT team; country scope as everywhere. */
const express = require('express');
const router = express.Router();
const { all } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { countrySql, scopeList } = require('../lib/scope');
const { buildExcelReport } = require('../lib/report-excel');
const { buildPdfReport } = require('../lib/report-pdf');
const { rackOfLocation, nameOf } = require('../lib/cctv-links');
const netmap = require('./netmap');
const servers = require('./servers');

router.use(requireAuth);
router.use((req, res, next) => (req.user && (req.user.team === 'OT' || req.user.team === 'IT' || req.user.team === 'NET') ? next() : res.status(403).json({ error: 'OT team and IT only' })));
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const LIST = [
  { key: 'ot-devices', icon: '🏭', title: 'OT devices', desc: 'Every OT device of the Server Inventory by type, status and location, with the full list.' },
  { key: 'ot-cameras', icon: '📷', title: 'CCTV cameras', desc: 'Cameras per switch and cabinet, models and firmware; cameras with HTTP only, old firmware or no switch port.' },
  { key: 'ot-switches', icon: '🔌', title: 'OT switch ports', desc: 'Ports of the OT switches: OT (blue), IT (green) and free per switch, and what is on every port.' },
  { key: 'ot-attention', icon: '⚠️', title: 'OT needs attention', desc: 'What OT Needs Attention lists, by check — to plan the fixes.' },
  { key: 'ot-changes', icon: '🕓', title: 'Port changes (90 days)', desc: 'Who changed which port of the OT switches in the last 90 days.' },
];

const blank = (v, d = 'Not set') => (v == null || String(v).trim() === '' ? d : String(v).trim());
const count = (items, key, top = 0) => {
  const m = new Map(); for (const it of items) { const k = key(it); m.set(k, (m.get(k) || 0) + 1); }
  let rows = [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  if (top && rows.length > top) { const rest = rows.slice(top - 1).reduce((s, r) => s + r[1], 0); rows = [...rows.slice(0, top - 1), ['Others', rest]]; }
  return rows;
};
const ex = (r) => { try { return JSON.parse(r.extra || '{}') || {}; } catch { return {}; } };
const isCam = (r) => /camera/i.test(`${r.category || ''}`);
const switchOf = (sp) => String(sp || '').trim().split(/\s+/)[0] || '';

async function data(req) {
  const cs = countrySql(req, 'country');
  const recs = await all(`SELECT * FROM servers WHERE deleted_at IS NULL AND it_ot = 'OT'${cs.clause ? ' AND ' + cs.clause : ''} ORDER BY hostname`, cs.params);
  const sites = await all('SELECT site, COUNT(*) AS n FROM net_devices GROUP BY site ORDER BY n DESC');
  const site = req.query.site != null ? String(req.query.site).slice(0, 80) : (sites[0] ? sites[0].site : '');
  const devices = await all('SELECT * FROM net_devices WHERE site = ?', [site]);
  return { recs, site, devices };
}

const R = {
  async 'ot-devices'(req) {
    const { recs } = await data(req);
    const st = (s) => recs.filter(r => r.status === s).length;
    return {
      dashboard: { title: 'OT devices', subtitle: `${recs.length} OT devices in the Server Inventory`,
        kpis: [{ label: 'OT devices', value: recs.length, color: 'blue' }, { label: 'Active', value: st('Active'), color: 'green' }, { label: 'Broken', value: st('Broken'), color: 'red' },
          { label: 'Stock', value: st('Stock'), color: 'amber' }, { label: 'Cameras', value: recs.filter(isCam).length, color: 'teal' }],
        tables: [
          { title: 'OT devices by type', headers: ['Type', 'Devices'], rows: count(recs, r => blank(r.category), 14), chart: 'bar' },
          { title: 'By status', headers: ['Status', 'Devices'], rows: count(recs, r => blank(r.status)), chart: 'doughnut' },
          { title: 'By OT system', headers: ['OT system', 'Devices'], rows: count(recs, r => blank(r.ot_system), 12), chart: 'bar' },
          { title: 'By location (top 15)', headers: ['Location', 'Devices'], rows: count(recs, r => blank(r.location), 15), chart: 'bar' },
          { title: 'By model (top 12)', headers: ['Model', 'Devices'], rows: count(recs, r => blank(r.brand_model), 12), chart: 'bar' }] },
      sheets: [{ name: 'OT devices', rows: recs.map(r => ({ Name: r.hostname, Type: r.category, 'OT system': r.ot_system, Model: r.brand_model, Producer: r.producer, IP: r.ip_address, MAC: r.mac,
        Serial: r.serial_no, Firmware: r.os, Status: r.status, 'Connected to': r.switch_port, VLAN: r.vlan, Location: r.location, Area: r.role, Country: r.country, Note: r.remark })) }],
    };
  },

  async 'ot-cameras'(req) {
    const { recs, devices } = await data(req);
    const cams = recs.filter(isCam), byHost = new Map(devices.map(d => [d.hostname, d]));
    const sw = (r) => byHost.get(switchOf(r.switch_port));
    const cab = (r) => { const d = sw(r); return d ? rackOfLocation(d.location) || blank(d.location) : 'No switch'; };
    const http = cams.filter(r => /enable/i.test(ex(r).http || '') && /disable/i.test(ex(r).https || ''));
    const oldFw = cams.filter(r => /^FW\s*1\./i.test(r.os || '')), noPort = cams.filter(r => !/\S+\s+\S*\d+\/\d+/.test(r.switch_port || ''));
    return {
      dashboard: { title: 'CCTV cameras', subtitle: `${cams.length} cameras`,
        kpis: [{ label: 'Cameras', value: cams.length, color: 'blue' }, { label: 'Active', value: cams.filter(r => r.status === 'Active').length, color: 'green' },
          { label: 'HTTP without HTTPS', value: http.length, color: 'amber' }, { label: 'Old firmware', value: oldFw.length, color: 'red' }, { label: 'Switch port unknown', value: noPort.length, color: 'grey' }],
        tables: [
          { title: 'Cameras by cabinet', headers: ['Cabinet', 'Cameras'], rows: count(cams, cab, 20), chart: 'bar' },
          { title: 'Cameras by switch (top 20)', headers: ['Switch', 'Cameras'], rows: count(cams, r => { const d = sw(r); return d ? nameOf(d) : 'No switch'; }, 20), chart: 'bar' },
          { title: 'Cameras by model', headers: ['Model', 'Cameras'], rows: count(cams, r => blank(r.brand_model), 12), chart: 'doughnut' },
          { title: 'Firmware versions', headers: ['Firmware', 'Cameras'], rows: count(cams, r => blank(r.os), 12), chart: 'bar' },
          { title: 'Cameras by area (top 15)', headers: ['Area', 'Cameras'], rows: count(cams, r => blank(r.role), 15), chart: 'bar' }] },
      sheets: [{ name: 'Cameras', rows: cams.map(r => { const e = ex(r), d = sw(r); return { Name: r.hostname, Area: r.role, Model: r.brand_model, IP: r.ip_address, MAC: r.mac, Serial: r.serial_no,
        Firmware: r.os, Status: r.status, Switch: d ? nameOf(d) : switchOf(r.switch_port), 'Connected to': r.switch_port, Cabinet: cab(r), Mask: e.mask || '', Gateway: e.gw || '',
        DNS: (e.dns || []).join(' / '), HTTP: e.http || '', HTTPS: e.https || '' }; }) },
        { name: 'To fix', rows: [...http.map(r => ({ Camera: r.hostname, IP: r.ip_address, Issue: 'HTTP on, HTTPS off' })), ...oldFw.map(r => ({ Camera: r.hostname, IP: r.ip_address, Issue: 'Old firmware ' + r.os })),
          ...noPort.map(r => ({ Camera: r.hostname, IP: r.ip_address, Issue: r.switch_port ? `On ${r.switch_port}, port unknown` : 'Not connected to a switch' }))] }],
    };
  },

  async 'ot-switches'(req) {
    const { site, devices } = await data(req);
    const otSw = devices.filter(d => d.state !== 'retired' && /switch/i.test(d.role || '') && netmap.otOn(d));
    const ids = new Set(otSw.map(d => d.id));
    const ports = otSw.length ? (await all(`SELECT p.* FROM net_ports p JOIN net_devices d ON d.id = p.device_id WHERE d.site = ? ORDER BY p.device_id, p.sort, p.port`, [site])).filter(p => ids.has(p.device_id)) : [];
    const owned = await netmap.withOwners(site, devices, ports), byId = new Map(otSw.map(d => [d.id, d]));
    const per = otSw.map(d => { const l = owned.filter(p => p.device_id === d.id); return { d, total: l.length, ot: l.filter(p => p.owner === 'OT').length, it: l.filter(p => p.owner === 'IT').length }; })
      .sort((a, b) => String(nameOf(a.d)).localeCompare(nameOf(b.d), undefined, { numeric: true }));
    const n = (k) => per.reduce((s, x) => s + x[k], 0);
    return {
      dashboard: { title: 'OT switch ports', subtitle: `${otSw.length} OT switches · ${site}`,
        kpis: [{ label: 'OT switches', value: otSw.length, color: 'blue' }, { label: 'Ports', value: n('total'), color: 'grey' }, { label: 'OT ports (blue)', value: n('ot'), color: 'blue' },
          { label: 'IT ports (green)', value: n('it'), color: 'green' }, { label: 'Free', value: n('total') - n('ot') - n('it'), color: 'amber' }],
        tables: [
          { title: 'Ports per switch', headers: ['Switch', 'OT', 'IT', 'Free'], rows: per.map(x => [nameOf(x.d), x.ot, x.it, x.total - x.ot - x.it]), chart: 'bar' },
          { title: 'All OT switch ports', headers: ['Owner', 'Ports'], rows: [['OT', n('ot')], ['IT', n('it')], ['Free', n('total') - n('ot') - n('it')]], chart: 'doughnut' }] },
      sheets: [{ name: 'Switches', rows: per.map(x => ({ Switch: x.d.hostname, Name: nameOf(x.d), Model: x.d.model, IP: x.d.mgmt_ip, Location: x.d.location, Ports: x.total, OT: x.ot, IT: x.it, Free: x.total - x.ot - x.it })) },
        { name: 'Ports', rows: owned.map(p => ({ Switch: (byId.get(p.device_id) || {}).hostname, Port: p.port, Owner: p.owner || 'free', Why: p.owner_why, 'Connected to': p.peer_host, 'Far port': p.peer_port,
          VLAN: p.vlan, Mode: p.mode, Patch: p.patch, Note: p.note, 'Set by IT': p.ot === 1 ? 'OT' : p.ot === 0 ? 'IT' : '' })) }],
    };
  },

  async 'ot-attention'(req) {
    const a = await servers.otAttention(req);
    const rows = a.groups.flatMap(g => g.rows.map(r => ({ Check: g.title, 'Fix where': g.where === 'device' ? 'On the device' : 'In the record', Device: r.hostname, Detail: r.detail, 'How to fix': g.fix })));
    return {
      dashboard: { title: 'OT needs attention', subtitle: `${a.total} OT devices · ${rows.length} things to check`,
        kpis: [{ label: 'OT devices', value: a.total, color: 'blue' }, { label: 'To check', value: rows.length, color: 'amber' },
          { label: 'Fix on the device', value: rows.filter(r => r['Fix where'] === 'On the device').length, color: 'red' }, { label: 'Fix in the record', value: rows.filter(r => r['Fix where'] === 'In the record').length, color: 'purple' }],
        tables: [{ title: 'Things to check', headers: ['Check', 'Devices'], rows: a.groups.map(g => [g.title, g.rows.length]), chart: 'bar' }] },
      sheets: [{ name: 'To check', rows }],
    };
  },

  async 'ot-changes'(req) {
    const { site, devices } = await data(req);
    const otHosts = new Set(devices.filter(d => /switch/i.test(d.role || '') && netmap.otOn(d)).map(d => d.hostname));
    // Port history from the write-once change log (audit_log; old net_port_log lines were copied in).
    const log = (await all("SELECT site, device, port, before_text AS before, after_text AS after, username AS by_user, created_at AS at FROM audit_log WHERE site = ? AND device <> '' AND created_at >= datetime('now', '-90 days') ORDER BY created_at DESC", [site])).filter(l => otHosts.has(l.device));
    const users = new Set((await all("SELECT username FROM users WHERE team = 'OT'")).map(u => u.username));
    return {
      dashboard: { title: 'Port changes on the OT switches', subtitle: `Last 90 days · ${log.length} changes`,
        kpis: [{ label: 'Changes', value: log.length, color: 'blue' }, { label: 'By the OT team', value: log.filter(l => users.has(l.by_user)).length, color: 'teal' },
          { label: 'By IT', value: log.filter(l => !users.has(l.by_user)).length, color: 'green' }, { label: 'Switches changed', value: new Set(log.map(l => l.device)).size, color: 'grey' }],
        tables: [{ title: 'Changes by person', headers: ['Person', 'Changes'], rows: count(log, l => blank(l.by_user, '?'), 12), chart: 'bar' },
          { title: 'Changes by switch', headers: ['Switch', 'Changes'], rows: count(log, l => l.device, 15), chart: 'bar' },
          { title: 'Changes by month', headers: ['Month', 'Changes'], rows: count(log, l => String(l.at).slice(0, 7)).sort((a, b) => String(a[0]).localeCompare(b[0])), chart: 'column' }] },
      sheets: [{ name: 'Changes', rows: log.map(l => ({ 'When (UTC)': String(l.at).slice(0, 16), Switch: l.device, Port: l.port, Before: l.before, After: l.after, By: l.by_user, Team: users.has(l.by_user) ? 'OT' : 'IT' })) }],
    };
  },
};

router.get('/', (req, res) => res.json({ reports: LIST }));
router.get('/:name', wrap(async (req, res) => {
  const raw = String(req.params.name), fmt = (raw.match(/\.(xlsx|pdf)$/i) || [])[1], name = raw.replace(/\.(xlsx|pdf)$/i, '');
  if (!R[name]) return res.status(404).json({ error: 'Unknown report' });
  const rep = await R[name](req);
  const list = scopeList(req);
  const meta = { generated: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+7)', by: req.user.full_name || req.user.username, scope: list ? `Countries: ${list.join(', ')}` : 'All countries' };
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Cache-Control', 'no-store');
  if (!fmt) return res.json({ name, ...LIST.find(x => x.key === name), dashboard: rep.dashboard, sheets: rep.sheets.map(s => ({ name: s.name, total: s.rows.length, rows: s.rows.slice(0, 300) })) });
  if (fmt.toLowerCase() === 'pdf') {
    const buf = await buildPdfReport({ dashboard: rep.dashboard, meta });
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.pdf"`); res.setHeader('Content-Type', 'application/pdf'); return res.send(buf);
  }
  const buf = await buildExcelReport({ dashboard: rep.dashboard, sheets: rep.sheets, meta });
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}));

module.exports = router;
