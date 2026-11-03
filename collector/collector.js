#!/usr/bin/env node
/* Hayat System Health collector — runs on an always-on PC / VM INSIDE the office network.

   Every minute it checks the systems listed in config.json and pushes the results to
   https://asset.hayat.io.vn (System Health page). Outgoing HTTPS only — nothing in the
   office has to be opened to the internet.

   Check types:
     snmp  router / switch / UPS: up time, interfaces (up/down, traffic), via SNMP v2c or v3 (read-only)
     ping  is the device answering?
     http  does an internal web app answer (and how fast)?
     tcp   is a port open (e.g. RDP 3389, SSH 22, SMB 445)?

   Usage:  node collector.js            run forever (every `intervalSeconds`)
           node collector.js --once     run the checks once, print them, send them, exit
           node collector.js --dry-run  run once and print, don't send
           node collector.js --config D:\path\config.json */

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const cfgPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : path.join(__dirname, 'config.json');

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!cfg.server || !cfg.key) throw new Error('config.json needs "server" and "key"');
  cfg.intervalSeconds = Math.max(30, Number(cfg.intervalSeconds) || 60);
  cfg.checks = Array.isArray(cfg.checks) ? cfg.checks : [];
  // Each check needs a stable key; two checks on the same address get their name added.
  const seen = new Set();
  for (const c of cfg.checks) {
    let k = c.key || `${c.type}:${c.url || c.host || ''}${c.port ? ':' + c.port : ''}`;
    if (seen.has(k)) k += '#' + (c.name || seen.size);
    seen.add(k);
    c._key = k;
  }
  return cfg;
}

const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);
const keyOf = (c) => c._key || c.key || `${c.type}:${c.url || c.host || ''}`;

// ── ping ──────────────────────────────────────────────────────────────────────
function ping(host, timeoutMs = 1500) {
  const win = process.platform === 'win32';
  const a = win ? ['-n', '1', '-w', String(timeoutMs), host] : ['-c', '1', '-W', String(Math.ceil(timeoutMs / 1000)), host];
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile('ping', a, { timeout: timeoutMs + 3000, windowsHide: true }, (err, stdout) => {
      if (err && err.code === 'ENOENT') return resolve({ ok: false, ms: null, missing: true });
      const out = String(stdout || '');
      // Windows prints "Destination host unreachable" with exit code 0 — require a real reply line.
      const ok = !err && /ttl=/i.test(out);
      const m = out.match(/time[=<]\s*([\d.]+)\s*ms/i);
      resolve({ ok, ms: ok ? (m ? Math.round(Number(m[1])) : Date.now() - t0) : null });
    });
  });
}

async function checkPing(c) {
  const r = await ping(c.host, c.timeoutMs);
  if (r.missing) return { status: 'unknown', latency_ms: null, summary: 'The ping command is not available on the collector PC' };
  return { status: r.ok ? 'up' : 'down', latency_ms: r.ms, summary: r.ok ? `Reply in ${r.ms} ms` : 'No reply to ping' };
}

// ── tcp port ─────────────────────────────────────────────────────────────────
function checkTcp(c) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const s = net.connect({ host: c.host, port: Number(c.port), timeout: c.timeoutMs || 3000 });
    const done = (ok, why) => { s.destroy(); const ms = Date.now() - t0;
      resolve({ status: ok ? 'up' : 'down', latency_ms: ok ? ms : null, summary: ok ? `Port ${c.port} open (${ms} ms)` : `Port ${c.port}: ${why}` }); };
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false, 'no answer'));
    s.on('error', (e) => done(false, e.code || e.message));
  });
}

// ── http(s) ──────────────────────────────────────────────────────────────────
function checkHttp(c) {
  const t0 = Date.now();
  const u = new URL(c.url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    // Internal devices usually have self-signed certificates → not verified unless "verifyTls": true.
    const req = mod.request(u, { method: 'GET', timeout: c.timeoutMs || 8000, rejectUnauthorized: !!c.verifyTls,
      headers: { 'User-Agent': 'HayatHealthCollector/' + VERSION } }, (res) => {
      res.resume();
      const ms = Date.now() - t0;
      const okCodes = c.okStatus || [200, 201, 204, 301, 302, 303, 307, 308, 401, 403];
      const ok = okCodes.includes(res.statusCode);
      const slow = ok && c.slowMs && ms > c.slowMs;
      resolve({ status: !ok ? 'down' : slow ? 'warn' : 'up', latency_ms: ms,
        summary: `HTTP ${res.statusCode} in ${ms} ms${slow ? ' (slow)' : ''}` });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: 'down', latency_ms: null, summary: `No answer (${e.code || e.message})` }));
    req.end();
  });
}

// ── snmp ─────────────────────────────────────────────────────────────────────
let snmp = null;
function snmpLib() {
  if (!snmp) {
    try { snmp = require('net-snmp'); }
    catch { throw new Error('SNMP module missing — run "npm install" in the collector folder'); }
  }
  return snmp;
}
const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0', sysUpTime: '1.3.6.1.2.1.1.3.0', sysName: '1.3.6.1.2.1.1.5.0',
  ifDescr: '1.3.6.1.2.1.2.2.1.2', ifType: '1.3.6.1.2.1.2.2.1.3', ifAdmin: '1.3.6.1.2.1.2.2.1.7', ifOper: '1.3.6.1.2.1.2.2.1.8',
  ifIn: '1.3.6.1.2.1.2.2.1.10', ifOut: '1.3.6.1.2.1.2.2.1.16',
  ifName: '1.3.6.1.2.1.31.1.1.1.1', ifHCIn: '1.3.6.1.2.1.31.1.1.1.6', ifHCOut: '1.3.6.1.2.1.31.1.1.1.10',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
};

function snmpSession(c) {
  const s = snmpLib();
  const opts = { port: c.port || 161, timeout: c.timeoutMs || 3000, retries: 1 };
  if (String(c.version || '2c') === '3') {
    const user = { name: c.user, level: s.SecurityLevel.noAuthNoPriv };
    if (c.authKey) {
      user.level = s.SecurityLevel.authNoPriv;
      user.authProtocol = /sha/i.test(c.authProtocol || 'sha') ? s.AuthProtocols.sha : s.AuthProtocols.md5;
      user.authKey = c.authKey;
    }
    if (c.privKey) {
      user.level = s.SecurityLevel.authPriv;
      user.privProtocol = /aes/i.test(c.privProtocol || 'aes') ? s.PrivProtocols.aes : s.PrivProtocols.des;
      user.privKey = c.privKey;
    }
    return s.createV3Session(c.host, user, { ...opts, version: s.Version3 });
  }
  return s.createSession(c.host, c.community || 'public', { ...opts, version: s.Version2c });
}

const snmpGet = (sess, oids) => new Promise((resolve, reject) => {
  sess.get(oids, (err, vbs) => {
    if (err) return reject(err);
    const out = {};
    vbs.forEach((vb, i) => { out[oids[i]] = snmpLib().isVarbindError(vb) ? null : vb.value; });
    resolve(out);
  });
});
// Walk a column → { index: value }. A missing column (e.g. no 64-bit counters) returns {};
// a device that never finishes answering is cut off after `limitMs` with what arrived so far.
const snmpWalk = (sess, base, limitMs = 8000) => new Promise((resolve) => {
  const out = {};
  const timer = setTimeout(() => resolve(out), limitMs);
  sess.subtree(base, 20, (vbs) => {
    for (const vb of vbs) if (!snmpLib().isVarbindError(vb)) out[vb.oid.slice(base.length + 1)] = vb.value;
  }, () => { clearTimeout(timer); resolve(out); });
});

const text = (v) => (v == null ? '' : Buffer.isBuffer(v) ? v.toString('utf8').replace(/\0/g, '').trim() : String(v));
// SNMP numbers: plain numbers, or a big-endian Buffer for 64-bit counters (Counter64).
const num = (v) => {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v.length ? Number(BigInt('0x' + v.toString('hex'))) : 0;
  return Number(v);
};
function fmtUptime(ticks) {
  let s = Math.floor(Number(ticks) / 100);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const fmtBps = (b) => (b == null ? '—' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' Gbps' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' Mbps'
  : b >= 1e3 ? (b / 1e3).toFixed(0) + ' kbps' : Math.round(b) + ' bps');

const lastCounters = new Map();   // check key → { t, ifIndex → { in, out } }

async function checkSnmp(c, key) {
  let sess;
  try {
    sess = snmpSession(c);
    const sys = await snmpGet(sess, [OID.sysDescr, OID.sysUpTime, OID.sysName]);
    const [descr, type, admin, oper, name, alias, hcIn, hcOut] = await Promise.all(
      [OID.ifDescr, OID.ifType, OID.ifAdmin, OID.ifOper, OID.ifName, OID.ifAlias, OID.ifHCIn, OID.ifHCOut].map(o => snmpWalk(sess, o, (c.timeoutMs || 3000) * 3)));
    const use64 = Object.keys(hcIn).length > 0;
    const [in32, out32] = use64 ? [{}, {}] : await Promise.all([OID.ifIn, OID.ifOut].map(o => snmpWalk(sess, o, (c.timeoutMs || 3000) * 3)));

    const now = Date.now();
    const prev = lastCounters.get(key);
    const counters = {};
    let ifaces = Object.keys(descr).map(idx => {
      const inC = num(use64 ? hcIn[idx] : in32[idx]), outC = num(use64 ? hcOut[idx] : out32[idx]);
      counters[idx] = { in: inC, out: outC };
      let inBps = null, outBps = null;
      const p = prev && prev.c[idx];
      if (p && p.in != null && inC != null && inC >= p.in && outC >= p.out) {      // skip counter reset / wrap
        const dt = (now - prev.t) / 1000;
        if (dt > 0) { inBps = ((inC - p.in) * 8) / dt; outBps = ((outC - p.out) * 8) / dt; }
      }
      return { index: Number(idx), name: text(name[idx]) || text(descr[idx]), descr: text(descr[idx]), alias: text(alias[idx]),
        type: num(type[idx]), admin: num(admin[idx]) === 1 ? 'up' : 'down', oper: num(oper[idx]) === 1 ? 'up' : 'down',
        inBps, outBps, inTotal: inC, outTotal: outC };
    });
    lastCounters.set(key, { t: now, c: counters });

    // Which interfaces to show: the ones listed in config ("interfaces"), else every enabled non-loopback one.
    const want = Array.isArray(c.interfaces) && c.interfaces.length ? c.interfaces : null;
    if (want) {
      ifaces = want.map(w => {
        const re = new RegExp(w.match, 'i');
        const f = ifaces.find(i => re.test(i.name) || re.test(i.descr) || re.test(i.alias));
        return f ? { ...f, label: w.label || f.name, required: w.required !== false }
                 : { label: w.label || w.match, name: w.match, oper: 'missing', required: w.required !== false };
      });
    } else {
      ifaces = ifaces.filter(i => i.admin === 'up' && i.type !== 24).map(i => ({ ...i, label: i.name, required: false }));
    }
    const downReq = ifaces.filter(i => i.required && i.oper !== 'up');
    const main = ifaces.find(i => i.required && i.oper === 'up' && i.inBps != null) || ifaces.find(i => i.inBps != null);
    const summary = [`Up ${fmtUptime(sys[OID.sysUpTime])}`,
      downReq.length ? `${downReq.map(i => i.label).join(', ')} down` : '',
      main ? `${main.label} ↓${fmtBps(main.inBps)} ↑${fmtBps(main.outBps)}` : ''].filter(Boolean).join(' · ');
    return {
      status: downReq.length ? (c.downIfAnyRequired ? 'down' : 'warn') : 'up',
      latency_ms: null,
      summary,
      detail: { sysName: text(sys[OID.sysName]), sysDescr: text(sys[OID.sysDescr]).slice(0, 200),
        uptime: fmtUptime(sys[OID.sysUpTime]), uptimeTicks: num(sys[OID.sysUpTime]), counters64: use64,
        interfaces: ifaces.slice(0, 64).map(i => ({ label: i.label, name: i.name, alias: i.alias, oper: i.oper, required: !!i.required,
          inBps: i.inBps == null ? null : Math.round(i.inBps), outBps: i.outBps == null ? null : Math.round(i.outBps) })) },
    };
  } catch (e) {
    // SNMP silent: is the device at least answering ping?
    const p = await ping(c.host);
    if (p.missing) return { status: 'down', latency_ms: null, summary: `No SNMP reply: ${e.message || e}` };
    return { status: p.ok ? 'warn' : 'down', latency_ms: p.ms,
      summary: p.ok ? `Answers ping (${p.ms} ms) but not SNMP — check SNMP settings / community` : `No reply (SNMP and ping): ${e.message || e}` };
  } finally {
    try { sess && sess.close(); } catch { /* ignore */ }
  }
}

// ── run one round ─────────────────────────────────────────────────────────────
async function runCheck(c) {
  const key = keyOf(c);
  const base = { key, name: c.name || key, kind: c.type, target: c.url || [c.host, c.port].filter(Boolean).join(':') };
  try {
    let r;
    if (c.type === 'snmp') r = await checkSnmp(c, key);
    else if (c.type === 'ping') r = await checkPing(c);
    else if (c.type === 'http') r = await checkHttp(c);
    else if (c.type === 'tcp') r = await checkTcp(c);
    else r = { status: 'unknown', summary: `Unknown check type "${c.type}"` };
    // Optional "slowMs": answering but slower than that → amber.
    if (r.status === 'up' && c.slowMs && r.latency_ms != null && r.latency_ms > c.slowMs) r.status = 'warn';
    return { ...base, ...r };
  } catch (e) {
    return { ...base, status: 'unknown', summary: `Check failed: ${e.message || e}` };
  }
}

async function send(cfg, checks) {
  const res = await fetch(cfg.server.replace(/\/+$/, '') + '/api/health/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key, 'User-Agent': 'HayatHealthCollector/' + VERSION },
    body: JSON.stringify({ version: VERSION, checks }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

// Keep the log small when running for months: print a check only when its status changes
// (every round with --once / --dry-run), plus an hourly "still running" line.
const lastStatus = new Map();
let rounds = 0, sendFailing = false;
async function round(cfg, verbose) {
  const results = await Promise.all(cfg.checks.map(runCheck));
  for (const r of results) {
    if (verbose || lastStatus.get(r.key) !== r.status) log(`${r.status.toUpperCase().padEnd(7)} ${r.name} — ${r.summary}`);
    lastStatus.set(r.key, r.status);
  }
  if (flag('--dry-run')) return;
  try {
    const r = await send(cfg, results);
    if (verbose || sendFailing || r.changes) log(`sent ${r.received} checks${r.changes ? `, ${r.changes} status change(s)` : ''}`);
    sendFailing = false;
  } catch (e) { log('could not send to the website:', e.message); sendFailing = true; }
  if (!verbose && ++rounds % Math.round(3600 / cfg.intervalSeconds) === 0) log(`running — ${results.filter(r => r.status === 'up').length}/${results.length} up`);
}

(async () => {
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error(`Config problem (${cfgPath}): ${e.message}`); process.exit(1); }
  log(`Hayat System Health collector ${VERSION} — ${cfg.checks.length} check(s), every ${cfg.intervalSeconds}s → ${cfg.server}`);
  if (flag('--once') || flag('--dry-run')) {
    // SNMP traffic rates need two samples — take a second one shortly after the first.
    if (cfg.checks.some(c => c.type === 'snmp')) { await Promise.all(cfg.checks.filter(c => c.type === 'snmp').map(runCheck)); await new Promise(r => setTimeout(r, 5000)); }
    await round(cfg, true);
    return;
  }
  for (;;) {
    const t0 = Date.now();
    try { cfg = loadConfig(); } catch (e) { log('config problem, keeping the previous one:', e.message); }
    await round(cfg, false);
    await new Promise(r => setTimeout(r, Math.max(1000, cfg.intervalSeconds * 1000 - (Date.now() - t0))));
  }
})();
