/* Device specifications + a drawn front-panel picture, for the (i) buttons (Server Inventory, Network map).
   DeviceSpecs.find(model, category) → spec | null      DeviceSpecs.show(model, category)   popup
   Figures from vendor datasheets / reseller spec sheets (Nov 2026) — "≈" where sources differ.
   Pictures are drawn here (SVG), not vendor photos: no copyright or internet needed. */

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Pictures ─────────────────────────────────────────────────────────────
  // Switch front: n RJ45 ports in 2 rows (odd top / even bottom, like Cisco) + uplink SFP cages.
  function switchSvg({ ports = 48, sfp = 4, poe = false, label = '', color = '#2b3a4a', sfpOnly = false }) {
    const cols = Math.ceil(ports / 2), pw = 13, gap = 2.2, x0 = 70;
    const w = Math.max(520, x0 + cols * (pw + gap) + (cols > 12 ? Math.floor(cols / 12) * 6 : 0) + sfp * 20 + 40);
    let s = `<svg viewBox="0 0 ${w} 74" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="72" rx="4" fill="${color}" stroke="#111"/>
      <rect x="8" y="10" width="${sfpOnly ? 30 : 46}" height="16" rx="2" fill="#11202e"/><text x="12" y="22" fill="#9fd3ff" font-size="9" font-family="Arial">${esc(label)}</text>
      <circle cx="16" cy="44" r="3" fill="#22c55e"/><circle cx="28" cy="44" r="3" fill="#22c55e"/><circle cx="40" cy="44" r="3" fill="#f59e0b"/>`;
    for (let i = 0; i < ports; i++) {
      const c = Math.floor(i / 2), r = i % 2, x = x0 + c * (pw + gap) + Math.floor(c / 12) * 6, y = r ? 40 : 14;
      s += sfpOnly ? `<rect x="${x}" y="${y}" width="${pw}" height="18" rx="1" fill="#0b1118" stroke="#8aa0b4" stroke-width=".8"/><rect x="${x + 3}" y="${y + 4}" width="${pw - 6}" height="10" fill="#26323f"/>`
        : `<rect x="${x}" y="${y}" width="${pw}" height="18" rx="1.5" fill="#0b1118" stroke="#5b6b7a"/><rect x="${x + 3}" y="${y + (r ? 2 : 11)}" width="${pw - 6}" height="5" fill="#2e3b48"/>${poe ? `<circle cx="${x + pw - 2}" cy="${y + 2}" r="1.3" fill="#38bdf8"/>` : ''}`;
    }
    const sx = w - 20 - sfp * 20;
    for (let i = 0; i < sfp; i++) s += `<rect x="${sx + i * 20}" y="24" width="16" height="22" rx="1" fill="#0b1118" stroke="#cbd5e1"/><rect x="${sx + i * 20 + 3}" y="29" width="10" height="12" fill="#334155"/>`;
    return s + '</svg>';
  }
  function serverSvg({ u = 2, bays = 8, label = '', color = '#1f2937' }) {
    const h = u * 40, w = 520;
    let s = `<svg viewBox="0 0 ${w} ${h + 4}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="${h}" rx="4" fill="${color}" stroke="#111"/>
      <rect x="10" y="8" width="30" height="${h - 14}" rx="2" fill="#374151"/><text x="50" y="${h / 2 + 4}" fill="#cbd5e1" font-size="11" font-family="Arial">${esc(label)}</text>`;
    const bw = 30, x0 = w - 20 - bays * (bw + 3);
    for (let i = 0; i < bays; i++) s += `<rect x="${x0 + i * (bw + 3)}" y="8" width="${bw}" height="${h - 14}" rx="2" fill="#111827" stroke="#6b7280"/><circle cx="${x0 + i * (bw + 3) + bw - 6}" cy="14" r="2" fill="#22c55e"/>`;
    return s + '</svg>';
  }
  function boxSvg({ label = '', ports = 6, color = '#7c1d1d', sfp = 0 }) {
    const w = 520;
    let s = `<svg viewBox="0 0 ${w} 64" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="60" rx="5" fill="${color}" stroke="#111"/>
      <text x="16" y="36" fill="#fff" font-size="15" font-weight="bold" font-family="Arial">${esc(label)}</text>`;
    for (let i = 0; i < ports; i++) s += `<rect x="${230 + i * 22}" y="18" width="18" height="22" rx="2" fill="#0b1118" stroke="#9ca3af"/><rect x="${234 + i * 22}" y="${30}" width="10" height="6" fill="#374151"/>`;
    for (let i = 0; i < sfp; i++) s += `<rect x="${236 + ports * 22 + i * 20}" y="18" width="16" height="22" rx="1" fill="#0b1118" stroke="#e5e7eb"/>`;
    return s + '</svg>';
  }
  function apSvg({ outdoor = false, antennas = 4 }) {
    if (outdoor) {
      let s = `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg"><rect x="70" y="60" width="120" height="120" rx="10" fill="#9ca3af" stroke="#4b5563" stroke-width="2"/>
        <rect x="88" y="78" width="84" height="84" rx="6" fill="#d1d5db"/><text x="130" y="125" text-anchor="middle" font-size="12" font-family="Arial" fill="#374151">1570</text>`;
      for (let i = 0; i < antennas; i++) s += `<rect x="${84 + i * 28}" y="${10}" width="8" height="52" rx="4" fill="#4b5563"/>`;
      return s + '</svg>';
    }
    let s = `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg"><circle cx="130" cy="110" r="78" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>
      <circle cx="130" cy="110" r="58" fill="#eef2f7"/><circle cx="130" cy="110" r="6" fill="#22c55e"/><text x="130" y="150" text-anchor="middle" font-size="12" font-family="Arial" fill="#475569">cisco</text>`;
    for (let i = 0; i < antennas; i++) { const a = -150 + i * 40, r = Math.PI / 180 * a; s += `<rect x="${130 + 82 * Math.cos(r) - 4}" y="${110 + 82 * Math.sin(r) - 30}" width="8" height="34" rx="4" fill="#cbd5e1" stroke="#94a3b8" transform="rotate(${a + 90} ${130 + 82 * Math.cos(r)} ${110 + 82 * Math.sin(r) - 13})"/>`; }
    return s + '</svg>';
  }

  // ── Specifications ───────────────────────────────────────────────────────
  const S = [
    { match: /C9200L-48P-4X/i, name: 'Cisco Catalyst 9200L 48-port PoE+, 4 × 10G', type: 'Access switch', pic: () => switchSvg({ ports: 48, sfp: 4, poe: true, label: 'C9200L' }),
      specs: [['Ports', '48 × 1G RJ45 PoE+ (802.3at), 4 × 10G SFP+ uplinks (fixed)'], ['PoE budget', '740 W with one 1 kW PSU, up to 1,440 W with two'], ['Switching capacity', '176 Gbps (256 Gbps stacked)'],
        ['Stacking', 'StackWise-80, 80 Gbps, up to 8 members'], ['Layer', 'L2 + basic L3 (static, RIP, OSPF stub)'], ['Licence', 'Network Essentials (perpetual) + DNA Essentials (term)'], ['Size', '1 RU'],
        ['Use here', 'Edge / access switch for users, APs and IP phones (PoE+)']] },
    { match: /3560CX-12PD/i, name: 'Cisco Catalyst 3560-CX 12-port PoE+ compact', type: 'Compact access switch', pic: () => switchSvg({ ports: 12, sfp: 2, poe: true, label: '3560-CX' }),
      specs: [['Ports', '12 × 1G RJ45 PoE+; uplinks 2 × 1G copper + 2 × 10G SFP+'], ['PoE budget', '240 W'], ['Layer', 'L2 / L3 (IP Base)'], ['Form', 'Compact, fanless, desk or 19" rack kit'],
        ['Use here', 'Small cabinets (shipment office, security gate)'], ['Note', 'End of sale — successor C9200CX-12P-2X2G']] },
    { match: /3548P/i, name: 'Cisco Nexus 3548-XL, 48 × SFP+', type: 'Low-latency data-centre switch', pic: () => switchSvg({ ports: 48, sfp: 0, sfpOnly: true, label: 'N3K', color: '#1e293b' }),
      specs: [['Ports', '48 × 1/10G SFP+'], ['Switching capacity', '960 Gbps, ≈720 Mpps'], ['Latency', 'sub-microsecond (warp mode)'], ['Memory', 'XL: extended memory (larger route / MAC tables)'],
        ['OS', 'NX-OS'], ['Size', '1 RU, redundant hot-swap PSU and fans'], ['Use here', 'Distribution switch (server room)']] },
    { match: /3524P/i, name: 'Cisco Nexus 3524-XL, 24 × SFP+', type: 'Low-latency data-centre switch', pic: () => switchSvg({ ports: 24, sfp: 0, sfpOnly: true, label: 'N3K', color: '#1e293b' }),
      specs: [['Ports', '24 × 1/10G SFP+ active (48 cages, licence to open 48)'], ['Switching capacity', '480 Gbps, ≈360 Mpps'], ['Latency', 'sub-microsecond'], ['OS', 'NX-OS, vPC between the pair'],
        ['Size', '1 RU, redundant PSU and fans'], ['Use here', 'Core / backbone switch pair']] },
    { match: /CT5520/i, name: 'Cisco 5520 Wireless Controller', type: 'Wireless LAN controller', pic: () => serverSvg({ u: 1, bays: 4, label: 'Cisco 5520 WLC', color: '#273449' }),
      specs: [['Capacity', 'up to 1,500 APs, 20,000 clients, 4,096 VLANs (licence: 50 APs here)'], ['Throughput', '20 Gbps'], ['Ports', '2 × 10G SFP+ (data), RP / SP for HA, service and console ports'],
        ['HA', 'SSO with a second 5520 (here WLC-01 / WLC-02)'], ['Size', '1 RU (UCS C220 M4 based)'], ['Note', 'End of sale; successor Catalyst 9800']] },
    { match: /ISR4331/i, name: 'Cisco ISR 4331 (UC bundle)', type: 'Router / voice gateway', pic: () => boxSvg({ label: 'ISR 4331', ports: 3, color: '#334155', sfp: 2 }),
      specs: [['Throughput', '100 Mbps, 300 Mbps with performance licence'], ['Ports', '3 × 1G (2 RJ45/SFP combo + 1 RJ45)'], ['Slots', '2 × NIM (here NIM-1MFT-T1/E1), 1 × SM-X, 1 × ISC (PVDM4 DSP)'],
        ['Voice', 'PVDM4-32 → 64 channels, CUBE / SRST, E1 trunk'], ['Memory', '4 GB DRAM / 4 GB flash (max 16 GB)'], ['Size', '1 RU']] },
    { match: /XG ?210/i, name: 'Sophos XG 210 (Rev. 3)', type: 'Firewall appliance', pic: () => boxSvg({ label: 'SOPHOS XG 210', ports: 6, color: '#0b3a63', sfp: 2 }),
      specs: [['Firewall', '≈16 Gbps (IMIX 5.5 Gbps)'], ['IPS', '≈2.7 Gbps'], ['VPN', '≈1.45 Gbps'], ['Ports', '6 × GbE copper (2 bypass pairs) + 2 SFP, 1 FleXi Port bay'],
        ['Size', '1 RU'], ['Use here', 'OT firewall (production network)'], ['Note', 'XG series end of sale — XGS replaces it']] },
    { match: /PA[- ]?440/i, name: 'Palo Alto Networks PA-440', type: 'Next-generation firewall (desktop)', pic: () => boxSvg({ label: 'PA-440', ports: 8, color: '#9a3412' }),
      specs: [['Firewall', '≈2.4–3.0 Gbps'], ['Threat prevention', '≈1.0 Gbps'], ['IPsec VPN', '≈1.6 Gbps'], ['Sessions', '200,000'], ['Ports', '8 × 1G RJ45 + 1 management'], ['Form', 'Desktop, fanless']] },
    { match: /R740/i, name: 'Dell PowerEdge R740 / R740xd', type: 'Rack server (2 U)', pic: () => serverSvg({ u: 2, bays: 12, label: 'PowerEdge R740xd' }),
      specs: [['CPU', 'up to 2 × Intel Xeon Scalable (≤ 28 cores each); here Xeon Silver 4208'], ['Memory', '24 DIMM slots, DDR4, up to 3 TB'], ['Drives', 'R740xd: up to 24 × 2.5" or 12 × 3.5" front (+ rear bays)'],
        ['Network', 'X520 2 × 10G SFP+ + i350 2 × 1G (rNDC), Broadcom 4 × 1G card'], ['Management', 'iDRAC9 Enterprise'], ['Power', '2 × 750 W redundant'], ['Use here', 'WAN firewall nodes (VFW-01 / 02)']] },
    { match: /VXRAIL|VX-?RAIL|E560/i, name: 'Dell VxRail E560 (hybrid)', type: 'Hyper-converged node (1 U)', pic: () => serverSvg({ u: 1, bays: 10, label: 'VxRail E560', color: '#0f172a' }),
      specs: [['Platform', 'PowerEdge R640 based, VMware vSAN + vSphere'], ['Drives', 'up to 10 × 2.5" (hybrid: SSD cache + HDD capacity)'], ['CPU / memory', '2 × Intel Xeon Scalable, up to 3 TB DDR4'],
        ['Network', '2 / 4 × 10 GbE for vSAN, vMotion and VM traffic'], ['Cluster', '4 nodes here (VXRAIL-01…04)'], ['Management', 'iDRAC9, VxRail Manager']] },
    { match: /DD-?6300/i, name: 'Dell EMC Data Domain DD6300', type: 'Backup / dedup storage', pic: () => serverSvg({ u: 2, bays: 12, label: 'Data Domain DD6300', color: '#1e3a5f' }),
      specs: [['Throughput', 'up to ≈8.5 TB/h (≈24 TB/h with DD Boost)'], ['Usable capacity', 'up to ≈178 TB (with shelves)'], ['Logical capacity', 'up to ≈8.9 PB after deduplication'],
        ['Protocols', 'NFS, CIFS, DD Boost, VTL'], ['Size', '2 U controller']] },
    { match: /AP2802/i, name: 'Cisco Aironet 2802E', type: 'Indoor access point (external antennas)', pic: () => apSvg({ antennas: 4 }),
      specs: [['Wi-Fi', '802.11ac Wave 2, 4×4:3SS, dual 5 GHz capable (Flexible Radio)'], ['Data rate', 'up to 1.3 Gbps per 5 GHz radio (80 MHz)'], ['Antennas', '4 × external dual-band, ≤ 6 dBi'],
        ['Power', '802.3at PoE+ / UPOE / power injector'], ['Ports', '2 × 1 GbE'], ['Managed by', 'WLC (CAPWAP)']] },
    { match: /1572/i, name: 'Cisco Aironet 1572EAC', type: 'Outdoor access point', pic: () => apSvg({ outdoor: true, antennas: 4 }),
      specs: [['Wi-Fi', '802.11ac dual-band (2.4 + 5 GHz), mesh capable'], ['Antennas', '4 external N-type (dual-band or 2 + 2 single-band)'], ['Power', 'AC (EAC model), also PoE-out (802.3at)'],
        ['Housing', 'IP67 outdoor, pole / wall mount'], ['Managed by', 'WLC (CAPWAP / mesh)']] },
  ];
  const GENERIC = {
    switch: { name: 'Network switch', type: 'Switch', pic: () => switchSvg({ ports: 24, sfp: 2, label: 'SWITCH' }), specs: [['Role', 'Connects devices in a LAN; ports, VLANs, PoE']] },
    'access point': { name: 'Wireless access point', type: 'Access point', pic: () => apSvg({}), specs: [['Role', 'Wi-Fi for users, managed by the controller']] },
    firewall: { name: 'Firewall', type: 'Firewall', pic: () => boxSvg({ label: 'FIREWALL', ports: 6 }), specs: [['Role', 'Filters traffic between networks, VPN, IPS']] },
    server: { name: 'Server', type: 'Server', pic: () => serverSvg({ label: 'SERVER' }), specs: [['Role', 'Runs applications / virtual machines']] },
  };
  function find(model, category) {
    const m = String(model || '');
    const s = S.find(x => x.match.test(m));
    if (s) return s;
    const c = String(category || '').toLowerCase();
    const k = Object.keys(GENERIC).find(g => c.includes(g) || m.toLowerCase().includes(g));
    return k ? { ...GENERIC[k], generic: true } : null;
  }

  function ui() {
    if (document.getElementById('ds-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="ds-ov"><div class="modal" style="max-width:640px">
      <div class="modal-header"><span class="modal-title" id="ds-t">Specification</span><button class="modal-close" onclick="document.getElementById('ds-ov').classList.remove('open')" aria-label="Close">✕</button></div>
      <div class="modal-body" id="ds-b"></div></div></div>`);
  }
  function show(model, category) {
    ui();
    const s = find(model, category);
    document.getElementById('ds-t').textContent = s ? s.name : String(model || 'Device');
    document.getElementById('ds-b').innerHTML = s ? `<div class="ds-pic">${s.pic()}</div>
      <div class="ds-type">${esc(s.type)}${model && s.generic ? ' · ' + esc(model) : ''}</div>
      <table class="ds-tbl">${s.specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      <p class="text-muted text-sm" style="margin:8px 0 0">${s.generic ? 'General description — no detailed specification for this model yet.' : 'From vendor datasheets / spec sheets; ≈ where sources differ. Picture is a drawing of the front panel.'}</p>`
      : '<p class="text-muted">No specification for this model yet.</p>';
    document.getElementById('ds-ov').classList.add('open');
  }
  const btn = (model, category) => `<button type="button" class="ds-i" title="Specification" onclick="event.stopPropagation();DeviceSpecs.show(${jsArg(model || '')}, ${jsArg(category || '')})">i</button>`;
  window.DeviceSpecs = { find, show, btn, switchSvg, serverSvg, boxSvg, apSvg };
})();
