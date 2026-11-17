/* Reads the "Factory Info" workbook (.xlsx) in the browser — the file is not uploaded, only what is read from it
   is sent to the server, which compares it with the network map / Server Inventory and shows a preview first.
   NetmapXlsx.read(file) → {
     blocks     port tables of SWPORT - MAINRACK, SWPORT - SUBRACK, SYSTEM PORT ASSIGNMENT
                { sheet, host, alias, location, ip, model, serial, ports: [{ port, dest, dport, cable, chmode, grp, swmode, vlan, notes[] }] }
     equipment  NW EQUIPMENT LIST rows { role, model, serial, mac, location, name, ip, remark }
     aps        IP AP - MGMT rows { label, location, mac, model, switch, port, state, serial }
     vlans      VLAN (Vietnam factory table) { vlan, name, description, network, gateway, dhcp }
     racks      RACK LAYOUT { name, kind: rack | cabinet, area, units, items: [{ label, u, height }] }
     vms        VM SERVER { key, status, hostname, ip, infra_ip, kind, farm, … }
     printers   PRINTER services { name, model, location, ip, share, server, sap }
   Skipped on purpose: the "Request" sheet (people's names and phone numbers), the contract prices (Appendix),
   and any row that looks like a credential (user / password / secret / key). */

(function () {
  async function lib() {
    if (window.XLSX) return window.XLSX;
    await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    return window.XLSX;
  }
  const T = (v) => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const SECRET = /\b(USER ?NAME|PASSWORD|PASS|PPPOE|SECRET|API ?KEY|KEY)\b/i;

  // Sheet → absolute grid (row / column from A1) + merged ranges.
  function grid(X, ws) {
    if (!ws || !ws['!ref']) return { rows: [], merges: [] };
    const rg = X.utils.decode_range(ws['!ref']), rows = [];
    for (let r = 0; r <= rg.e.r; r++) {
      const row = [];
      for (let c = 0; c <= rg.e.c; c++) { const cell = r >= rg.s.r && c >= rg.s.c ? ws[X.utils.encode_cell({ r, c })] : null; row.push(cell ? T(cell.w != null ? cell.w : cell.v) : ''); }
      rows.push(row);
    }
    return { rows, merges: ws['!merges'] || [] };
  }
  const sheet = (X, wb, re) => { const n = wb.SheetNames.find(s => re.test(s)); return n ? grid(X, wb.Sheets[n]) : { rows: [], merges: [] }; };

  // ── Port tables: "HOSTNAME: …" block, LOCATION / IP MGMT / MODEL / S/N rows, header row, numbered rows ──
  function portBlocks(g, name) {
    const out = [], R = g.rows;
    for (let r = 0; r < R.length; r++) for (let c = 0; c < R[r].length; c++) {
      const m = R[r][c].match(/^HOSTNAME\s*:\s*(.+)$/i); if (!m) continue;
      const hm = m[1].match(/^([^\s(]+)\s*(?:\((.*?)\)?)?\s*$/) || [, m[1], ''];
      const b = { sheet: name, host: hm[1].toUpperCase(), alias: T(hm[2]), location: '', ip: '', model: '', serial: '', ports: [] };
      let h = -1;
      for (let k = r + 1; k < Math.min(R.length, r + 10); k++) {
        const v = R[k][c] || '', kv = v.match(/^(LOCATION|IP MGMT|IP IDRAC|MODEL|S\/N)\s*:\s*(.*)$/i);
        if (kv) { const key = kv[1].toUpperCase(), val = T(kv[2]); if (key === 'LOCATION') b.location = val; else if (/^IP/.test(key)) b.ip = b.ip || val; else if (key === 'MODEL') b.model = val; else b.serial = val.replace(/\s+/g, ''); continue; }
        if (/^No\.?$/i.test(v) && R[k].slice(c, c + 4).some(x => /Src\.? ?Device/i.test(x))) { h = k; break; }
      }
      if (h < 0) continue;
      const hdr = []; for (let k = c; k < Math.min(R[h].length, c + 16); k++) { if (!R[h][k] && hdr.length > 10) break; hdr.push(R[h][k].toLowerCase()); }
      const at = (re, nth = 0) => { const l = hdr.map((x, i) => (re.test(x) ? i : -1)).filter(i => i >= 0); return l[nth] == null ? -1 : c + l[nth]; };
      const iPort = at(/^port$/), iDst = at(/^(dest\.? ?device|patch ?panel)$/), iDport = at(/^port$/, 1), iCable = at(/cable/), iCh = at(/(channels?|teaming) mode/),
        iGrp = at(/(channel group|teaming number)/), iSw = at(/switchport/), iVlan = at(/vlan/), iNotes = ['description', 'device note', 'location', 'config hostname'].map(n => at(new RegExp('^' + n + '$'))).filter(i => i >= 0);
      const patchHdr = /patch/.test(hdr[iDst - c] || '');
      for (let k = h + 1; k < R.length; k++) {
        const no = R[k][c] || '';
        if (/^HOSTNAME/i.test(no) || /^No\.?$/i.test(no)) break;
        if (!/^\d+$/.test(no)) { if (R[k].slice(c, c + 12).some(x => /^HOSTNAME/i.test(x))) break; continue; }
        const v = (i) => (i >= 0 ? R[k][i] || '' : '');
        const port = v(iPort); if (!port) continue;
        b.ports.push({ port, dest: v(iDst), dport: v(iDport), patchHdr, cable: v(iCable), chmode: v(iCh), grp: v(iGrp), swmode: v(iSw), vlan: v(iVlan), notes: iNotes.map(v).filter(Boolean) });
      }
      out.push(b);
    }
    return out;
  }

  // ── Header-row tables ─────────────────────────────────────────────────────
  function table(g, must, map, opts = {}) {
    const R = g.rows; const h = R.findIndex(r => must.every(re => r.some(x => re.test(x)))); if (h < 0) return [];
    const col = {}; for (const [k, re] of Object.entries(map)) col[k] = R[h].findIndex(x => re.test(x));
    const out = [];
    for (let r = h + 1; r < R.length; r++) {
      const row = R[r]; if (opts.stop && opts.stop(row)) break;
      const o = {}; for (const [k, i] of Object.entries(col)) o[k] = i >= 0 ? row[i] || '' : '';
      if (!Object.values(o).some(Boolean)) continue;
      if (row.some(x => SECRET.test(x) && /:|=/.test(x))) continue;
      out.push(o);
    }
    return out;
  }

  // ── RACK LAYOUT: elevation blocks (header "MR-01 FRONT ELEVATION" / "SR-01-IT = IT-KABIN2 (…)"), U labels left of
  //    the items, an item spans as many U labels as its merged cell covers. ──
  function rackLayout(g) {
    const R = g.rows, merges = g.merges;
    const span = (r, c) => { const m = merges.find(x => x.s.r === r && x.s.c === c); return m ? m.e : { r, c }; };
    const isU = (v) => /^\d+U$/i.test(v);
    const heads = [];
    for (let r = 0; r < R.length; r++) for (let c = 0; c < R[r].length; c++) {
      const v = R[r][c]; if (!v) continue;
      if (/ELEVATION/i.test(v) || /^SR-\d+.*=/.test(v)) heads.push({ r, c, e: span(r, c), v });
    }
    const blocks = [];
    for (const hd of heads) {
      let name, kind = 'rack', area = '', side = 'front';
      const m = hd.v.match(/^(MR-\d+)\s+(FRONT|REAR)/i);
      if (m) { name = m[1].toUpperCase(); side = m[2].toLowerCase(); area = 'Server room'; }
      else {
        const s = hd.v.match(/^(SR-\d+)-([A-Z/]+)\s*=\s*(.*?)\s*(?:\((.*)\))?$/i); if (!s) continue;
        kind = 'cabinet'; area = T(s[4]);
        const n = (s[3].match(/(\d+)\s*$/) || [, ''])[1];
        name = /HAR[I]?CI/i.test(s[3]) ? `HARICI-KABIN${n}` : /^IT-/i.test(s[3]) || /IT/i.test(s[2]) ? `IT-KABIN${n}` : `CCTV-KABIN${n}`;
        hd.sr = s[1].toUpperCase();
      }
      if (blocks.some(b => b.name === name && b.side === side && b.kind === kind)) continue;   // the same cabinet drawn twice
      blocks.push({ ...hd, name, kind, area, side, c0: hd.c, c1: hd.e.c, r0: hd.e.r + 1 });
    }
    // Block rows end at the next header below in the same columns.
    for (const b of blocks) { const below = heads.filter(h => h.r > b.r && h.c <= b.c1 && h.e.c >= b.c0).map(h => h.r); b.r1 = below.length ? Math.min(...below) - 1 : R.length - 1; }
    const racks = new Map();
    for (const b of blocks) {
      const items = []; let units = 0;
      const uAt = (r) => { for (let c = b.c0 - 1; c >= Math.max(0, b.c0 - 4); c--) if (isU(R[r][c])) return parseInt(R[r][c], 10); return null; };
      for (let r = b.r0; r <= b.r1; r++) { const u = uAt(r); if (u) units = Math.max(units, u); }
      for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) {
        const v = R[r][c]; if (!v || isU(v) || /ELEVATION|POWER UNIT/i.test(v)) continue;
        const e = span(r, c), us = []; for (let k = r; k <= e.r; k++) { const u = uAt(k); if (u) us.push(u); }
        if (!us.length) continue;
        items.push({ label: v, u: Math.min(...us), height: Math.max(1, us.length) });
      }
      if (!items.length && b.side === 'rear') continue;
      const key = b.name;
      if (!racks.has(key)) racks.set(key, { name: b.name, kind: b.kind, area: b.area, sr: b.sr || '', units: units || (b.kind === 'cabinet' ? 12 : 42), items: [] });
      const rk = racks.get(key); rk.units = Math.max(rk.units, units || 0);
      for (const it of items) rk.items.push({ ...it, side: b.side });
    }
    return [...racks.values()];
  }

  async function read(file) {
    const X = await lib();
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    const blocks = [...portBlocks(sheet(X, wb, /SWPORT\s*-\s*MAIN/i), 'SWPORT - MAINRACK'), ...portBlocks(sheet(X, wb, /SWPORT\s*-\s*SUB/i), 'SWPORT - SUBRACK'), ...portBlocks(sheet(X, wb, /SYSTEM PORT/i), 'SYSTEM PORT ASSIGNMENT')];
    // NW EQUIPMENT LIST: the role is written once per group (merged cell) → carry it down.
    let role = '';
    const equipment = table(sheet(X, wb, /NW EQUIPMENT/i), [/^Serial Number$/i, /^Roles$/i],
      { role: /^Roles$/i, model: /^Devices$/i, serial: /^Serial Number$/i, mac: /^MAC Address$/i, location: /^Location$/i, name: /^Device Name$/i, ip: /^IP MGMT$/i, remark: /^Remark$/i })
      .map(e => { if (e.role) role = e.role; return { ...e, role, serial: e.serial.replace(/\s+/g, '') }; }).filter(e => e.serial || e.model);
    const aps = table(sheet(X, wb, /IP AP/i), [/^LABEL NAME$/i], { location: /^LOCATION$/i, mac: /^MAC ADDRESS$/i, label: /^LABEL NAME$/i, model: /^MODEL$/i, switch: /^SWITCH$/i, port: /^PORT$/i, state: /^STATE$/i, serial: /^AP SERIAL$/i })
      .filter(a => a.label);
    const vlans = table(sheet(X, wb, /^VLAN$/i), [/^VLAN ID$/i, /^Network IP$/i], { description: /^Description functional$/i, network: /^Network IP$/i, gateway: /^Gateway$/i, vlan: /^VLAN ID$/i, name: /^VLAN NAME$/i, dhcp: /^DHCP Server$/i },
      { stop: (row) => row.some(x => /^VN-Office$/i.test(x)) }).filter(v => /^\d+$/.test(v.vlan)).map(v => ({ ...v, dhcp: /^none$/i.test(v.dhcp) ? '' : v.dhcp }));
    const vmG = sheet(X, wb, /VM SERVER/i);
    const vms = table(vmG, [/^HostName$/i, /^IPAddress$/i], { key: /^Key$/i, status: /^Status$/i, country: /^Country2$/i, hostname: /^HostName$/i, ip: /^IPAddress$/i, infra_ip: /^InfraIP$/i, kind: /^Virtual \/ Physical$/i,
      farm: /^VMFarm$/i, system_type: /^SystemType$/i, it_ot: /^IT\/OT$/i, platform: /^Platform$/i, os: /^OS$/i, domain: /^Domain$/i, sap: /^SAP\/NonSAP$/i, usage: /^SystemUsage$/i, impact: /^OutageImpact$/i,
      backup: /^BackUpPolicyName$/i, os_version: /^OtherNotes$/i, model: /^Model$/i, serial: /^SerialNumber$/i, memory: /^Memory$/i, cpu: /^CPUType$/i },
      { stop: (row) => row.some(x => /^STT$/i.test(x)) })
      .filter(v => /^[A-Z0-9][\w.-]+$/i.test(v.hostname) && !/^HostName$/i.test(v.hostname) && v.key && /^IK-/i.test(v.key));
    // Second table on the same sheet: what each server is for (HOSTNAME / Description / Noted).
    const desc = table(vmG, [/^HOSTNAME$/i, /^Description$/i, /^STT$/i], { hostname: /^HOSTNAME$/i, description: /^Description$/i, note: /^Noted$/i, location: /^LOCATION$/i });
    for (const v of vms) { const d = desc.find(x => x.hostname.toUpperCase() === v.hostname.toUpperCase()); if (d) { v.description = d.description; v.note = d.note; v.location = d.location; } }
    const printers = table(sheet(X, wb, /PRINTER/i), [/Printer IP/i], { name: /SAP PRINTER NAME/i, brand: /Printer\s+Details/i, location: /^Location$/i, ip: /Printer IP/i, share: /shared name/i, server: /Print server IP/i, ref: /Referns|Reference/i })
      .filter(p => /^\d+\.\d+\.\d+\./.test(p.ip));   // "10.84.21.x" = IP not given yet, the printer still counts
    // "Printer Details" spans Model + Type columns.
    const pg = sheet(X, wb, /PRINTER/i), ph = pg.rows.findIndex(r => r.some(x => /Printer IP/i.test(x)));
    if (ph >= 0) { const ci = pg.rows[ph].findIndex(x => /Printer\s+Details/i.test(x)); for (const p of printers) { const row = pg.rows.find(r => r.includes(p.ip) && r.includes(p.name)); if (row && ci >= 0) p.model = T(`${row[ci]} ${row[ci + 1]}`);
      // The MAC address is in a column without a heading (Zebra label printers).
      if (row) p.mac = row.find(x => /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i.test(x)) || ''; } }
    const racks = rackLayout(sheet(X, wb, /RACK LAYOUT/i));
    return { file: file.name, blocks, equipment, aps, vlans, racks, vms, printers,
      counts: { blocks: blocks.length, ports: blocks.reduce((t, b) => t + b.ports.length, 0), equipment: equipment.length, aps: aps.length, vlans: vlans.length, racks: racks.length, vms: vms.length, printers: printers.length } };
  }
  window.NetmapXlsx = { read };
})();
