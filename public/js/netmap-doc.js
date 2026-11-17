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
      // VLAN – IP table
      const h0 = (rows[0] || []).join(' | ');
      if (/vlan/i.test(h0) && /network/i.test(h0)) {
        const hdr = rows[0].map(h => h.toLowerCase());
        const ix = (re) => hdr.findIndex(h => re.test(h));
        const iV = ix(/vlan/), iN = ix(/description|name|function/), iNet = ix(/network/), iG = ix(/gateway/);
        for (const r of rows.slice(1)) { const v = (r[iV] || '').trim(); if (/^\d+$/.test(v)) vlans.push({ vlan: v, name: (r[iN] || '').trim(), network: (r[iNet] || '').trim(), gateway: (r[iG] || '').trim() }); }
      }
    }
    // The same device written two ways ("DD-6300" / "DD6300") → the one that has a table.
    const key = (h) => h.replace(/[^A-Z0-9/]/g, '');
    const byKey = new Map([...devices.keys()].map(h => [key(h), h]));
    for (const p of ports) if (p.peer_host && !devices.has(p.peer_host) && byKey.has(key(p.peer_host))) p.peer_host = byKey.get(key(p.peer_host));
    // Far ends that have no table of their own (ISP routers, …) become devices too.
    for (const p of ports) if (p.peer_host && !devices.has(p.peer_host)) devices.set(p.peer_host, { hostname: p.peer_host, role: guessRole(p.peer_host), alias: '', model: '', serial: '', mgmt_ip: '', location: '' });
    // …with the ports other devices point at.
    const have = new Set(ports.map(p => p.device + '|' + p.port));
    for (const p of [...ports]) {
      if (p.peer_host && p.peer_port && !have.has(p.peer_host + '|' + p.peer_port)) {
        ports.push({ device: p.peer_host, port: p.peer_port, peer_host: p.device, peer_port: p.port, cable: p.cable, mode: '', vlan: '', grp: p.grp, patch: '' });
        have.add(p.peer_host + '|' + p.peer_port);
      }
    }
    return { devices: [...devices.values()], ports, vlans, counts: { devices: devices.size, ports: ports.length, links: ports.filter(p => p.peer_host).length, vlans: vlans.length } };
  }
  window.NetmapDoc = { read };
})();
