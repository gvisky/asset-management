/* Reads the network implementation document (.docx) in the browser — the file is not uploaded, only the
   tables found in it are sent to the server.
   NetmapDoc.read(file) → { devices[], ports[], vlans[], counts }
     Device tables:  "HOSTNAME: MR-03/CSW-01 (HK-VIETNAMBB-PRI)  LOCATION …  IP MGMT …  MODEL …  S/N …" then rows
                     No. | Src. Device | Port | Dest. Device | Port | Cable Type | Mode | Group | Switchport Mode | VLAN
     VLAN table:     No | Description functional | Network IP | Subnet mask | Gateway | VLAN ID
   The section heading above a device table gives its role (Core Switch, Access Switch, Firewall …). */

(function () {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  async function zipLib() {
    if (window.JSZip) return window.JSZip;
    await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/vendor/jszip.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    return window.JSZip;
  }
  const kids = (el, name) => [...el.childNodes].filter(n => n.namespaceURI === W && n.localName === name);
  const textOf = (el) => {
    const parts = [];
    for (const p of el.getElementsByTagNameNS(W, 'p')) {
      let t = '';
      for (const n of p.getElementsByTagNameNS(W, '*')) { if (n.localName === 't') t += n.textContent; else if (n.localName === 'tab') t += ' '; }
      if (t.trim()) parts.push(t);
    }
    if (!parts.length && el.localName === 'p') return el.textContent;
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const tableRows = (tbl) => kids(tbl, 'tr').map(tr => kids(tr, 'tc').map(tc => textOf(tc)));

  const ROLE = [[/firewall/i, 'Firewall'], [/voice|router|gateway/i, 'Router'], [/wireless controller|wlc/i, 'Wireless controller'], [/core|backbone/i, 'Core switch'],
    [/distribution/i, 'Distribution switch'], [/utp/i, 'Server switch'], [/access|edge/i, 'Access switch'], [/vxrail|hci/i, 'HCI server'], [/dd-?6300|data ?domain|storage/i, 'Backup storage'], [/server/i, 'Server']];
  const roleOf = (section, host, model) => { for (const [re, r] of ROLE) if (re.test(section)) return r; for (const [re, r] of ROLE) if (re.test(`${host} ${model}`)) return r; return 'Other'; };
  const guessRole = (host) => (/ISP|VNPT|VIETTEL|FPT|LL-RT|INTERNET/i.test(host) ? 'ISP / external' : /FW/i.test(host) ? 'Firewall' : /RT/i.test(host) ? 'Router' : /SW/i.test(host) ? 'Access switch' : 'Other');

  async function read(file) {
    const JSZip = await zipLib();
    const zip = await JSZip.loadAsync(file);
    const xml = await zip.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = doc.getElementsByTagNameNS(W, 'body')[0];
    const devices = new Map(), ports = [], vlans = [];
    const equipment = [];   // section 2: { part, desc, qty } of the devices bought (network list) / server groups (system list)
    const patches = [];   // 8.1 patch panels: { panel: 'MR01/PP01', port: 7, outlet: 'D07' }
    const ipInfo = [];   // { host, ip, name, gateway, service, serial, service_tag } from 7.1 IP MGMT / System (never user names / passwords)
    let section = '';
    for (const el of body.childNodes) {
      if (el.namespaceURI !== W) continue;
      if (el.localName === 'p') {
        const st = el.getElementsByTagNameNS(W, 'pStyle')[0];
        const sv = st ? st.getAttributeNS(W, 'val') || st.getAttribute('w:val') || '' : '';
        if (/^heading|^\d/i.test(sv)) { const t = textOf(el); if (t) section = t; }
        continue;
      }
      if (el.localName !== 'tbl') continue;
      const rows = tableRows(el);
      const flat = rows.slice(0, 8).map(r => r.join(' ')).join(' ');
      const hdrIdx = rows.findIndex(r => /Src\.? ?Device/i.test(r.join(' ')));
      const hm = flat.match(/HOSTNAME:\s*([A-Z0-9][\w\-/]+)/i);
      if (hm && hdrIdx >= 0) {
        const host = hm[1].toUpperCase();
        const after = flat.slice(flat.indexOf('HOSTNAME'));
        const alias = (after.slice(0, 140).match(/\(([^)]*)\)/) || [])[1] || '';
        const loc = (flat.match(/LOCATION:\s*(.*?)\s*(?:IP MGMT|MODEL|S\/N|$)/i) || [])[1] || '';
        const ip = (flat.match(/IP MGMT:\s*([\d./]+)/i) || [])[1] || '';
        const model = ((flat.match(/MODEL:\s*(.*?)\s*(?:S\/N|No\.|$)/i) || [])[1] || '').trim();
        const sn = (flat.match(/S\/N:\s*([A-Z0-9]{5,})/i) || [])[1] || '';
        devices.set(host, { hostname: host, alias: /^U\d/.test(alias) ? '' : alias.trim(), location: loc.trim(), mgmt_ip: ip, model, serial: sn, role: roleOf(section, host, model) });
        const hdr = rows[hdrIdx].map(h => h.toLowerCase());
        const portCols = hdr.map((h, i) => (h.trim() === 'port' ? i : -1)).filter(i => i >= 0);
        const col = (r, re) => { const i = hdr.findIndex(h => re.test(h)); return i >= 0 ? (r[i] || '').trim() : ''; };
        for (const r of rows.slice(hdrIdx + 1)) {
          if (!/^\d+$/.test((r[0] || '').trim())) continue;
          const port = (r[portCols[0]] || '').trim(); if (!port) continue;
          const dst = col(r, /dest/).toUpperCase(), dport = (r[portCols[1]] || '').trim();
          ports.push({ device: host, port, peer_host: dst, peer_port: dst ? dport : '', patch: dst ? '' : dport, cable: col(r, /cable/),
            mode: col(r, /switchport/) || '', vlan: col(r, /vlan/), grp: col(r, /group|number/) });
        }
        continue;
      }
      // 2. Equipment list: group rows "1 | Backbone switch | | 1" with part rows "| N3K-C3548P-XL | Nexus 3548-XL … | 2".
      if (/part number|description/i.test((rows[0] || []).join(' ')) && /qty/i.test((rows[0] || []).join(' ')) || rows.some(r => /^\d+$/.test((r[0] || '').trim()) && /Cung cấp|Provide/i.test(r[1] || ''))) {
        let grp = null;
        const qtyOf = (r) => { for (let i = r.length - 1; i >= 1; i--) { const v = (r[i] || '').trim(); if (/^\d+$/.test(v)) return Number(v); } return 0; };
        for (const r of rows) {
          const c0 = (r[0] || '').trim(), part = (r[1] || '').trim(), desc = (r[2] || '').trim();
          if (/^\d+$/.test(c0)) { grp = { title: part, qty: qtyOf(r), lines: [] }; if (/Cung cấp|Provide|server|storage|hội tụ/i.test(part)) equipment.push(grp); continue; }
          if (!grp || !part) continue;
          if (/^(N3K-C|C9200L-|WS-C\d|ISR\d|AIR-CT\d+-(\d+-)?K9$|AIR-AP\d)/i.test(part) && !/ACC|KIT|NW-E|DNA|LIC|-SW-/i.test(part)) equipment.push({ part, desc, qty: qtyOf(r) });
          else if (grp.lines && grp.lines.length < 6) grp.lines.push(`${part} ${desc}`);
        }
        continue;
      }
      // 8.1 Patch panel: "MR01/PP01 | D01 … D12" / "1 … 12" / "13 … 24" / "D13 … D24"
      if (rows.some(r => /^MR\d+\/PP\d+$/i.test((r[0] || '').trim()))) {
        let panel = '', block = [];
        const flush = () => { if (!panel || block.length < 4) return;
          const [top, n1, n2, bot] = block;
          top.slice(1).forEach((o, i) => { const n = Number(n1[i + 1]); if (o && n && o !== '-') patches.push({ panel, port: n, outlet: o.trim() }); });
          bot.slice(1).forEach((o, i) => { const n = Number(n2[i + 1]); if (o && n && o !== '-') patches.push({ panel, port: n, outlet: o.trim() }); }); };
        for (const r of rows) {
          if (/^MR\d+\/PP\d+$/i.test((r[0] || '').trim())) { flush(); panel = r[0].trim().toUpperCase(); block = [r]; }
          else if (panel && r.some(c => c.trim())) block.push(r);
        }
        flush();
        continue;
      }
      // 7.1.2 System: No | Roles | Devices | Service Tag | Serial Number | Hostname | Function | IP MGMT (hostname only on a host's first row)
      const h0 = (rows[0] || []).join(' | ');
      if (/function/i.test(h0) && /ip mgmt/i.test(h0)) {
        const hdr = rows[0].map(h => h.toLowerCase()), ix = (re) => hdr.findIndex(h => re.test(h));
        const iT = ix(/service tag/), iS = ix(/serial/), iH = ix(/hostname/), iF = ix(/function/), iI = ix(/ip mgmt/);
        let host = '', tag = '';
        for (const r of rows.slice(1)) {
          const t = (r[iT] || '').trim(), h = (r[iH] || '').trim().toUpperCase(), ip = (r[iI] || '').trim();
          if (h) host = h; else if (t && t !== tag) host = '';
          if (t) tag = t;
          if (!ip) continue;
          ipInfo.push({ host: t ? host : '(cluster)', name: (r[iF] || '').trim(), ip, service_tag: t, serial: (r[iS] || '').trim() });
        }
        continue;
      }
      // 7.1.1 Network: key / value rows (HOSTNAME, IP ADDRESS, IP GATEWAY, SERVICE …) — credentials are skipped.
      if (rows.some(r => /^HOSTNAME$/i.test((r[1] || '').trim())) && rows.some(r => /^IP ADDRESS$/i.test((r[1] || '').trim()))) {
        let cur = null;
        for (const r of rows) {
          const k = (r[1] || '').trim().toUpperCase(), v = (r[2] || '').trim();
          if (/^\d+\.\d+$/.test((r[0] || '').trim())) { cur = { host: /^[A-Z0-9][\w-]*-\d+$/i.test(v) ? v.toUpperCase() : '', title: k, model: v }; ipInfo.push(cur); continue; }
          if (!cur || /USER|PASS|PPPOE|SECRET|KEY/.test(k)) continue;
          if (k === 'HOSTNAME') cur.host = (v.match(/^[^\s(]+/) || [''])[0].toUpperCase();
          else if (k === 'IP ADDRESS') cur.ip = v; else if (k === 'IP GATEWAY') cur.gateway = v;
          else if (k === 'DEVICE IP ADDRESS') cur.device_ip = v; else if (k === 'SERVICE') cur.service = v;
        }
        continue;
      }
      // VLAN – IP table
      if (/vlan/i.test(h0) && /network/i.test(h0)) {
        const hdr = rows[0].map(h => h.toLowerCase());
        const ix = (re) => hdr.findIndex(h => re.test(h));
        const iV = ix(/vlan/), iN = ix(/description|name|function/), iNet = ix(/network/), iG = ix(/gateway/);
        for (const r of rows.slice(1)) { const v = (r[iV] || '').trim(); if (/^\d+$/.test(v)) vlans.push({ vlan: v, name: (r[iN] || '').trim(), network: (r[iNet] || '').trim(), gateway: (r[iG] || '').trim() }); }
      }
    }
    // The same device written two ways ("DD-6300" / "DD6300") → the one that has a table.
    // …and "MR-01/DATA-ASW-01" for the table "MR-01/ASW-01".
    const key = (h) => h.replace(/DATA-?/g, '').replace(/[^A-Z0-9/]/g, '');
    const byKey = new Map([...devices.keys()].map(h => [key(h), h]));
    for (const p of ports) if (p.peer_host && !devices.has(p.peer_host) && byKey.has(key(p.peer_host))) p.peer_host = byKey.get(key(p.peer_host));
    // Far port spelled differently ("T1/1/1" for "T 1/1/1") → the device's own port name.
    // "PORT 1 (LAN)" = "PORT 1" = "PORT 01", "T1/1/1" = "T 1/1/1"
    const pkey = (x) => String(x).toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/\d+/g, (n) => String(Number(n)));
    const portNames = new Map();
    for (const p of ports) { if (!portNames.has(p.device)) portNames.set(p.device, new Map()); portNames.get(p.device).set(pkey(p.port), p.port); }
    for (const p of ports) if (p.peer_host && p.peer_port && portNames.has(p.peer_host)) { const n = portNames.get(p.peer_host).get(pkey(p.peer_port)); if (n) p.peer_port = n; }
    // A link written on one side only → fill the other side's empty port.
    const at = new Map(ports.map(p => [p.device + '|' + p.port, p]));
    for (const p of ports) if (p.peer_host && p.peer_port) { const o = at.get(p.peer_host + '|' + p.peer_port); if (o && !o.peer_host) { o.peer_host = p.device; o.peer_port = p.port; o.cable = o.cable || p.cable; o.grp = o.grp || p.grp; if (/^(E|GE|T|TE)\s*\d/i.test(o.patch)) o.patch = ''; } }
    // Far ends that have no table of their own (ISP routers, …) become devices too.
    for (const p of ports) if (p.peer_host && !devices.has(p.peer_host)) devices.set(p.peer_host, { hostname: p.peer_host, role: guessRole(p.peer_host), alias: '', model: '', serial: '', mgmt_ip: '', location: '' });
    // …with the ports other devices point at.
    const have = new Set(ports.map(p => p.device + '|' + pkey(p.port)));
    for (const p of [...ports]) {
      if (p.peer_host && p.peer_port && !have.has(p.peer_host + '|' + pkey(p.peer_port))) {
        ports.push({ device: p.peer_host, port: p.peer_port, peer_host: p.device, peer_port: p.port, cable: p.cable, mode: '', vlan: '', grp: p.grp, patch: '' });
        have.add(p.peer_host + '|' + pkey(p.peer_port));
      }
    }
    // Attach the IP information to the devices (same name, the other spelling, or the same management IP).
    const findDev = (h, ip) => devices.get(h) || devices.get(byKey.get(key(h)) || '') || [...devices.values()].find(d => [...devices.keys()].length && d.hostname.endsWith('/' + h.replace(/^.*\//, '')))
      || (ip && [...devices.values()].find(d => d.mgmt_ip && d.mgmt_ip.split('/')[0] === ip.split('/')[0])) || null;
    let firstHci = null;
    for (const x of ipInfo) {
      if (x.host === '(cluster)') { x.dev = firstHci; } else x.dev = x.host ? findDev(x.host, x.ip) : null;
      const d = x.dev; if (!d) continue;
      if (/hci|vxrail/i.test(d.role + d.hostname) && !firstHci) firstHci = d;
      d.ips = d.ips || [];
      if (x.name) d.ips.push({ name: (x.host === '(cluster)' ? 'Cluster ' : '') + x.name, ip: x.ip });
      else { if (x.ip) d.ips.push({ name: 'IP address', ip: x.ip }); if (x.gateway) d.ips.push({ name: 'Gateway', ip: x.gateway }); if (x.device_ip) d.ips.push({ name: 'Device IP', ip: x.device_ip }); }
      if (x.service) d.services = x.service;
      if (x.service_tag) d.service_tag = x.service_tag;
      if (x.serial && !d.serial) d.serial = x.serial;
      if (x.model && !d.model && !/LEASE|LINE/i.test(x.model)) d.model = x.model;
      if (x.title && /LEASE LINE|FTTH/.test(x.title)) d.alias = d.alias || x.title;
    }
    const equip = equipment.map(e => (e.lines ? { part: e.title, desc: e.lines.join(' | '), qty: e.qty } : e)).filter(e => e.qty);
    return { devices: [...devices.values()], ports, vlans, patches, equipment: equip, counts: { patches: patches.length, devices: devices.size, ports: ports.length, links: ports.filter(p => p.peer_host).length, vlans: vlans.length } };
  }
  window.NetmapDoc = { read };
})();
