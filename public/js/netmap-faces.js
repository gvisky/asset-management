/* Network map — device panels drawn like the real hardware, patch panels and the cable trace.
   NMFaces.render(device, ports, hl)   SVG front / rear panel with every port where it is on the device
                                       (Cisco: odd ports top row, even bottom; SFP cages; server rear NICs)
   NMFaces.panel(label)                patch panel window: outlet (D07 / T13) ↔ switch port, from table 8.1
   NMFaces.trace(device, port)         path of a port: wall outlet → patch panel → switch → uplinks → core */

const NMFaces = self.NMFaces = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const key = (x) => String(x || '').toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/\d+/g, (n) => String(Number(n)));
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const D = () => NM.data();

  // A block = ports laid out in columns; zig = Cisco numbering (1 top, 2 below, 3 top …).
  const blk = (x, y, names, kind = 'rj45', zig = true, cols) => ({ x, y, names, kind, zig, cols: cols || (zig ? Math.ceil(names.length / 2) : names.length) });
  const MODELS = [
    { re: /C9200L-48/i, w: 1040, h: 112, color: '#e5e7eb', text: '#334155', name: 'Catalyst 9200L-48P-4X · front', blocks: [
      ...range(4, g => blk(118 + g * 196, 22, range(12, i => `GE 1/0/${g * 12 + i + 1}`))), blk(924, 22, range(4, i => `T 1/1/${i + 1}`), 'sfp')] },
    { re: /3560CX-12/i, w: 640, h: 112, color: '#f1f5f9', text: '#334155', name: 'Catalyst 3560-CX-12PD · front', blocks: [
      blk(118, 22, range(12, i => `GE 1/0/${i + 1}`)), blk(330, 22, ['GE 1/0/13', 'GE 1/0/14']), blk(400, 22, ['T 1/1/1', 'T 1/1/2', 'T 1/0/1', 'T 1/0/2'], 'sfp')] },
    { re: /3548P|3524P/i, w: 1040, h: 112, color: '#1f2937', text: '#cbd5e1', name: 'Nexus 3500-XL · front (SFP+)', blocks: range(4, g => blk(118 + g * 210, 22, range(12, i => `E 1/${g * 12 + i + 1}`), 'sfp')) },
    { re: /ISR4331/i, w: 760, h: 96, color: '#334155', text: '#e2e8f0', name: 'ISR 4331 · rear', blocks: [blk(120, 34, ['GE 0/0/0', 'GE 0/0/1'], 'rj45', false), blk(200, 34, ['GE 0/0/2'], 'sfp', false), blk(330, 34, ['CD/LP'], 'rj45', false)],
      deco: '<rect x="300" y="18" width="200" height="60" rx="3" fill="none" stroke="#94a3b8" stroke-dasharray="4 3"/><text x="400" y="88" font-size="10" fill="#94a3b8" text-anchor="middle">NIM-1MFT-T1/E1</text><rect x="520" y="18" width="200" height="60" rx="3" fill="none" stroke="#64748b"/><text x="620" y="52" font-size="11" fill="#94a3b8" text-anchor="middle">SM-X slot</text>' },
    { re: /CT5520/i, w: 760, h: 96, color: '#273449', text: '#e2e8f0', name: 'WLC 5520 · rear', blocks: [blk(120, 34, ['CONSOLE', 'MGMT', 'SP', 'RP'], 'rj45', false), blk(330, 34, ['PORT 1', 'PORT 2'], 'sfp', false)] },
    { re: /R740/i, w: 820, h: 120, color: '#27272a', text: '#d4d4d8', name: 'PowerEdge R740xd · rear', blocks: [blk(110, 44, ['IDRAC'], 'rj45', false), blk(200, 44, ['INTERG-P1', 'INTERG-P2'], 'sfp', false), blk(270, 44, ['INTERG-P3', 'INTERG-P4'], 'rj45', false), blk(420, 44, ['CARD1-P1', 'CARD1-P2', 'CARD1-P3', 'CARD1-P4'], 'rj45', false)],
      deco: '<text x="216" y="100" font-size="10" fill="#a1a1aa">rNDC (X520 + i350)</text><text x="430" y="100" font-size="10" fill="#a1a1aa">PCIe card 1 (4 × 1 GbE)</text><rect x="640" y="24" width="70" height="72" rx="3" fill="#3f3f46"/><rect x="725" y="24" width="70" height="72" rx="3" fill="#3f3f46"/><text x="717" y="112" font-size="10" fill="#a1a1aa" text-anchor="middle">PSU 1 · PSU 2</text>' },
    { re: /VXRAIL|E560/i, w: 820, h: 110, color: '#18181b', text: '#d4d4d8', name: 'VxRail E560 · rear', blocks: [blk(110, 40, ['IDRAC'], 'rj45', false), blk(200, 40, ['INTERG-P1', 'INTERG-P2', 'INTERG-P3', 'INTERG-P4'], 'sfp', false), blk(400, 40, ['CARD1-P1', 'CARD1-P2'], 'sfp', false)],
      deco: '<text x="214" y="96" font-size="10" fill="#a1a1aa">NDC 4 × 10 GbE</text><text x="404" y="96" font-size="10" fill="#a1a1aa">PCIe 2 × 10 GbE</text><rect x="640" y="20" width="70" height="66" rx="3" fill="#3f3f46"/><rect x="725" y="20" width="70" height="66" rx="3" fill="#3f3f46"/>' },
    { re: /DD-?6300|DATA DOMAIN/i, w: 760, h: 110, color: '#1e3a5f', text: '#e2e8f0', name: 'Data Domain DD6300 · rear', blocks: [blk(110, 40, ['MGMT'], 'rj45', false), blk(190, 40, ['PORT 0', 'PORT 1', 'PORT 2', 'PORT 3', 'PORT 4'], 'rj45', false)] },
    { re: /XG ?210|SOPHOS/i, w: 700, h: 90, color: '#f8fafc', text: '#0b3a63', name: 'Sophos XG 210 · front', blocks: [blk(250, 30, range(8, i => `PORT ${i + 1}`), 'rj45', false)],
      deco: '<rect x="20" y="22" width="120" height="46" rx="4" fill="#0b3a63"/><text x="80" y="50" font-size="13" fill="#fff" text-anchor="middle" font-weight="bold">SOPHOS</text>' },
  ];
  const SZ = { rj45: [26, 22], sfp: [24, 16] };

  const portClass = (p) => NM.portClass(p);   // OT blue, IT green, free grey (network-map.js)
  function render(d, ports, hl) {
    const m = MODELS.find(x => x.re.test(d.model || ''));
    if (!m) return null;
    const byKey = new Map(ports.map(p => [key(p.port), p])), used = new Set();
    let g = `<rect x="2" y="2" width="${m.w - 4}" height="${m.h - 4}" rx="6" fill="${m.color}" stroke="#0f172a" stroke-width="2"/>
      <text x="16" y="${m.h - 12}" font-size="11" fill="${m.text}" font-family="system-ui" font-weight="600">${esc(m.name)}</text>${m.deco || ''}`;
    for (const b of m.blocks) {
      const [pw, ph] = SZ[b.kind], gx = pw + 6, gy = ph + 12;
      b.names.forEach((name, i) => {
        const c = b.zig ? Math.floor(i / 2) : i, r = b.zig ? i % 2 : 0;
        const x = b.x + c * gx + (b.zig ? Math.floor(c / 6) * 6 : 0), y = b.y + r * gy;
        const p = byKey.get(key(name)); if (p) used.add(p.port);
        const real = p ? p.port : name, cls = portClass(p), num = (String(name).match(/(\d+)$/) || [, name])[1];
        g += `<g class="pf ${cls}${hl.has(real) ? ' hl' : ''}" onclick="NM.openPort(${d.id}, ${jsArg(real)})"><title>${esc(NM.portTip(p || { port: real }))}</title>
          ${b.kind === 'sfp' ? `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="1.5" class="pf-body"/><rect x="${x + 4}" y="${y + 4}" width="${pw - 8}" height="${ph - 8}" class="pf-in"/>`
            : `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="2" class="pf-body"/><rect x="${x + 6}" y="${y + (r ? 3 : ph - 9)}" width="${pw - 12}" height="6" class="pf-in"/>`}
          <text x="${x + pw / 2}" y="${r ? y + ph + 9 : y - 3}" class="pf-n" fill="${m.text}">${esc(b.names.length > 4 || /^\d/.test(num) ? num : name.replace(/^INTERG-|^CARD1-/, ''))}</text></g>`;
      });
    }
    const rest = ports.filter(p => !used.has(p.port));
    return `<div class="pf-wrap"><svg viewBox="0 0 ${m.w} ${m.h}" class="pf-svg" style="max-width:${m.w}px">${g}</svg></div>${rest.length ? `<div class="fp-row" style="margin-top:8px"><span class="fp-lbl">Other</span><div class="fp-chips">${rest.map(p => `<button class="pt pt-chip ${portClass(p)}${hl.has(p.port) ? ' hl' : ''}" title="${esc(NM.portTip(p))}" onclick="NM.openPort(${d.id}, ${jsArg(p.port)})">${esc(p.port)}</button>`).join('')}</div></div>` : ''}`;
  }

  // ── Patch panels ─────────────────────────────────────────────────────────
  // "MR01/PP01", "MR-01/DATA-PP-01" and "MR01/PP01 (D)" are the same panel.
  const panelName = (label) => { const m = String(label || '').toUpperCase().match(/MR-?0?(\d+)\/(?:DATA-)?PP-?0?(\d+)/); return m ? `MR${m[1].padStart(2, '0')}/PP${m[2].padStart(2, '0')}` : ''; };
  function panel(label) {
    const name = panelName(label), rows = (D().patches || []).filter(p => p.panel === name);
    if (!name) return false;
    const sw = new Map(); for (const p of D().ports) if (p.patch) sw.set(p.patch.toUpperCase(), p);
    const portSvg = (n, x, y) => { const pp = rows.find(r => r.port === n), out = pp ? pp.outlet : '', s = out && sw.get(out.toUpperCase());
      const dv = s && NM.data().devices.find(d => d.id === s.device_id);
      return `<g class="pf ${s ? 'pt-dev' : out ? 'pt-free' : 'pt-free'}"${s ? ` onclick="NMFaces.openSwitchPort(${s.device_id}, ${jsArg(s.port)})"` : ''}><title>${esc(`${name} port ${n}${out ? ' · outlet ' + out : ''}${s ? ` · → ${dv ? dv.hostname : ''} ${s.port}${s.vlan ? ' · VLAN ' + s.vlan : ''}` : ' · not patched to a switch'}`)}</title>
        <rect x="${x}" y="${y}" width="34" height="26" rx="2" class="pf-body"/><rect x="${x + 8}" y="${y + 6}" width="18" height="10" class="pf-in"/>
        <text x="${x + 17}" y="${y - 4}" class="pf-n" fill="#334155">${n}</text><text x="${x + 17}" y="${y + 38}" class="pf-o">${esc(out)}</text></g>`; };
    let g = '<rect x="2" y="2" width="696" height="150" rx="5" fill="#e4e4e7" stroke="#3f3f46" stroke-width="2"/>';
    for (let i = 0; i < 12; i++) { g += portSvg(i + 1, 40 + i * 54 + Math.floor(i / 6) * 10, 22); g += portSvg(i + 13, 40 + i * 54 + Math.floor(i / 6) * 10, 90); }
    const patched = rows.filter(r => sw.has(String(r.outlet).toUpperCase()));
    const ov = document.getElementById('nm-dev-ov');
    document.getElementById('nm-dev-t').textContent = `Patch panel ${name}`;
    document.getElementById('nm-dev-b').innerHTML = `<svg viewBox="0 0 700 154" class="pf-svg">${g}</svg>
      <p class="text-sm text-muted">${rows.length ? `${patched.length} of ${rows.length} outlets patched to a switch port (green — click to open it). Outlets from table 8.1 of the document.` : 'No port list for this panel (table 8.1 of the document has MR01/PP01–PP10).'}</p>
      ${patched.length ? `<table class="nm-vt"><thead><tr><th>Panel port</th><th>Outlet</th><th>Switch</th><th>Port</th><th>VLAN</th></tr></thead><tbody>${patched.map(r => { const s = sw.get(String(r.outlet).toUpperCase()), dv = NM.data().devices.find(d => d.id === s.device_id);
        return `<tr><td>${r.port}</td><td><b>${esc(r.outlet)}</b></td><td>${esc(dv ? dv.hostname : '')}</td><td>${esc(s.port)}</td><td>${esc(s.vlan)}</td></tr>`; }).join('')}</tbody></table>` : ''}`;
    document.getElementById('nm-dev-f').innerHTML = '<button class="btn btn-ghost" onclick="document.getElementById(\'nm-dev-ov\').classList.remove(\'open\')">Close</button>';
    ov.classList.add('open');
    return true;
  }
  function openSwitchPort(devId, port) { document.getElementById('nm-dev-ov').classList.remove('open'); NM.select(devId); NM.openPort(devId, port); }

  // ── Trace ────────────────────────────────────────────────────────────────
  function trace(d, p) {
    const steps = [], data = D();
    if (p.patch && /^[DT]\d+$/i.test(p.patch)) {
      const pp = (data.patches || []).find(x => String(x.outlet).toUpperCase() === p.patch.toUpperCase());
      steps.push({ icon: '🔌', text: `Wall outlet <b>${esc(p.patch)}</b>` });
      if (pp) steps.push({ icon: '🟫', text: `Patch panel <b>${esc(pp.panel)}</b> port ${pp.port}` });
    } else if (p.peer_host && !NM.known(p.peer_host)) steps.push({ icon: '💻', text: `<b>${esc(p.peer_host)}</b> ${esc(p.peer_port)}` });
    steps.push({ icon: '🔷', text: `<b>${esc(d.hostname)}</b> ${esc(p.port)}${p.vlan ? ` · VLAN ${esc(p.vlan)}` : ''}${p.mode ? ' · ' + esc(p.mode) : ''}`, here: true });
    // Upstream: follow links to devices of a higher layer (lower tier number) until the core.
    let cur = d, seen = new Set([d.id]);
    if (NM.known(p.peer_host)) { const n = data.devices.find(x => x.hostname === p.peer_host); steps.push({ icon: '⬆', text: `${esc(p.peer_port)} on <b>${esc(n.hostname)}</b>` }); cur = n; seen.add(n.id); }
    for (let hop = 0; hop < 5; hop++) {
      const t0 = NM.tier(cur.role);
      const ups = data.ports.filter(x => x.device_id === cur.id && NM.known(x.peer_host)).map(x => ({ x, n: data.devices.find(y => y.hostname === x.peer_host) }))
        .filter(o => !seen.has(o.n.id) && NM.tier(o.n.role) < t0);
      if (!ups.length) break;
      const byDev = new Map(); for (const o of ups) { if (!byDev.has(o.n.id)) byDev.set(o.n.id, []); byDev.get(o.n.id).push(o); }
      steps.push({ icon: '⬆', text: [...byDev.values()].map(l => `<b>${esc(l[0].n.hostname)}</b> via ${l.map(o => esc(o.x.port)).join(', ')}${l[0].x.grp ? ` (Po${esc(l[0].x.grp)})` : ''}`).join(' &nbsp;|&nbsp; ') });
      const next = ups[0].n; ups.forEach(o => seen.add(o.n.id)); cur = next;
    }
    return `<div class="nm-trace">${steps.map(s => `<div class="tr-step${s.here ? ' here' : ''}"><span>${s.icon}</span><div>${s.text}</div></div>`).join('<div class="tr-arrow">↓</div>')}</div>`;
  }
  return { render, panel, panelName, trace, openSwitchPort };
})();
