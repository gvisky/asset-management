/* Server Inventory → ⬆ CCTV camera list: the NVR export (.xlsx with a picture in each row) → cameras in Server Inventory on their
   CCTV switch, with their snapshot (routes/servers.js /cctv-import and /photos). The pictures are "pictures in cells": read from the
   file's richData parts in the browser and made into small JPEGs. */

const CctvImport = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);
  let aoa = null, pics = {}, P = null, overrides = {}, fileName = '', itot = 'OT', report = null;

  function shell() {
    if ($('ci-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="ci-ov"><div class="modal" style="max-width:1200px;width:97vw">
      <div class="modal-header"><span class="modal-title">📷 CCTV camera list → Server Inventory &amp; CCTV switches</span><button class="modal-close" aria-label="Close" onclick="document.getElementById('ci-ov').classList.remove('open')">✕</button></div>
      <div class="modal-body" id="ci-b" style="max-height:76vh;overflow:auto"></div><div class="modal-footer" id="ci-f"></div></div></div>`);
  }
  async function needXlsx() {
    if (window.XLSX) return;
    await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/js/vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }
  // Pictures in cells: sheet cell vm → metadata → rich value → rel → xl/media/imageN → { sheet row: dataURL }.
  async function readPictures(buf) {
    const out = {};
    let zip; try { zip = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' }); } catch { return out; }
    const find = (p) => XLSX.CFB.find(zip, '/' + p) || XLSX.CFB.find(zip, p);   // zip entries are found as "/xl/…"
    const txt = (p) => { const f = find(p); return f && f.content ? new TextDecoder().decode(f.content) : ''; };
    const sheet = txt('xl/worksheets/sheet1.xml'), meta = txt('xl/metadata.xml'), rv = txt('xl/richData/rdrichvalue.xml'), rel = txt('xl/richData/richValueRel.xml'), rels = txt('xl/richData/_rels/richValueRel.xml.rels');
    if (!sheet || !rv || !rel || !rels) return out;
    const vmBlocks = ((meta.match(/<valueMetadata[\s\S]*?<\/valueMetadata>/) || [''])[0].match(/<bk>[\s\S]*?<\/bk>/g) || []).map(b => Number((b.match(/v="(\d+)"/) || [])[1]));
    const fut = ((meta.match(/<futureMetadata[\s\S]*?<\/futureMetadata>/) || [''])[0].match(/<bk>[\s\S]*?<\/bk>/g) || []).map(b => Number((b.match(/rvb i="(\d+)"/) || [])[1]));
    const rvs = (rv.match(/<rv\b[\s\S]*?<\/rv>/g) || []).map(x => Number((x.match(/<v>(\d+)<\/v>/) || [])[1]));
    const relIds = (rel.match(/r:id="([^"]+)"/g) || []).map(x => x.slice(6, -1));
    const target = {}; (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(x => { const id = (x.match(/Id="([^"]+)"/) || [])[1], tg = (x.match(/Target="([^"]+)"/) || [])[1]; if (id && tg) target[id] = 'xl/' + tg.replace(/^\.\.\//, ''); });
    const cells = [...sheet.matchAll(/<c r="[A-Z]+(\d+)"[^>]*\bvm="(\d+)"/g)];
    for (const [, row, vm] of cells) {
      const fi = vmBlocks.length ? vmBlocks[Number(vm) - 1] : Number(vm) - 1;
      const ri = fut.length && Number.isFinite(fi) ? fut[fi] : Number(vm) - 1;
      const relIdx = rvs[ri], path = target[relIds[relIdx]];
      const f = path && find(path); if (!f || !f.content) continue;
      out[Number(row)] = await smallJpeg(new Blob([f.content], { type: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' }));
    }
    return out;
  }
  async function smallJpeg(blob) {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(blob); });
    const k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src); return c.toDataURL('image/jpeg', 0.85);
  }
  function start() {
    $('ci-b').innerHTML = `<p>Upload the camera list exported from the NVR / Wisenet tool (.xlsx — Model, Camera Name, MAC Address, S/N, F/W Version, Image, IP Address …).</p>
      <p class="text-muted text-sm">The OT CCTV report (camera export + CAMERA LIST + SWITCH LIST + SERVER DETAIL) works too: areas, the real CCTV switches and the recording servers are added as well. Passwords in it are never stored.</p>
      <p class="text-muted text-sm">Camera names say the cabinet: <b>K5-12</b> = CCTV KABIN 5, <b>HK8-1R</b> = HARICI KABIN 8, <b>K11</b> = IT KABIN 11, <b>K1</b> = office building (MR-01). Each camera is recorded on that cabinet's CCTV switch (add the CCTV switches first: Network map → Racks → 📹). Nothing changes before Apply.</p>
      <input type="file" id="ci-file" accept=".xlsx">`;
    $('ci-f').innerHTML = '<button class="btn btn-ghost" onclick="document.getElementById(\'ci-ov\').classList.remove(\'open\')">Close</button>';
    $('ci-file').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $('ci-b').innerHTML = '<p class="text-muted">Reading the list and its pictures…</p>';
      try { await needXlsx(); fileName = f.name; const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf);
        const sheets = wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }));
        const has = (a, re) => a.slice(0, 15).some(r => r.some(c => re.test(String(c).trim())));
        // The camera export (Camera Name + S/N); in the OT report also CAMERA LIST (areas), SWITCH LIST and SERVER DETAIL.
        aoa = sheets.find(a => has(a, /^camera\s*name$/i) && has(a, /^s\/?n$/i)) || sheets.find(a => has(a, /^camera\s*name$/i));
        const cut = (a) => a && a.map(r => r.slice(0, 30).map(c => String(c).slice(0, 300)));
        const sw = sheets.find(a => has(a, /^host\s*name$/i)), sv = sheets.find(a => has(a, /^device\s*name$/i)), cl = sheets.find(a => a !== aoa && has(a, /^camera\s*name$/i) && has(a, /^location/i));
        report = sw || sv || cl ? { switches: cut(sw) || [], servers: cut(sv) || [], cameras: cut(cl) || [] } : null;
        if (!aoa) { showToast('No sheet with a Camera Name column', 'error'); return start(); }
        // Profiles / long text columns are not needed on the server.
        aoa = aoa.map(r => r.map(c => String(c).slice(0, 120)));
        pics = await readPictures(buf); overrides = {}; P = null; await preview();
      } catch (err) { showToast(err.message || 'Could not read the file', 'error'); start(); }
    };
  }
  async function preview() {
    $('ci-b').innerHTML = '<p class="text-muted">Checking against the map and the Server Inventory…</p>';
    try { P = await apiPost('/api/servers/cctv-import', { aoa, report, overrides, dry: true, site: P && P.site }); render(); }
    catch (e) { $('ci-b').innerHTML = `<p style="color:#b91c1c">${esc(e.message || 'Could not check the file')}</p>`; }
  }
  function render() {
    const C = P.counts, nPics = P.cameras.filter(c => pics[c.line]).length;
    $('ci-b').innerHTML = `
      <div class="us-sum"><div><b>${C.cameras}</b><span>cameras in ${esc(fileName)}</span></div><div class="u"><b>${C.add}</b><span>new in Server Inventory</span></div>
        <div><b>${C.update}</b><span>existing — empty fields filled</span></div><div class="s"><b>${nPics}</b><span>pictures</span></div>
        <div class="f"><b>${C.noSwitch}</b><span>without a CCTV switch</span></div></div>
      ${!C.switches ? '<p class="text-sm" style="color:#b91c1c">⚠ No CCTV switch is on the map yet — add them first (Network map → Racks → 📹), then upload the list again.</p>' : ''}
      <div class="us-bar2"><span class="text-sm">Record the cameras as</span><span class="nm-tabs small"><button data-io="OT" class="${itot === 'OT' ? 'on' : ''}">OT devices</button><button data-io="IT" class="${itot === 'IT' ? 'on' : ''}">IT devices</button></span>
        <span class="text-muted text-sm">OT = the OT team sees and edits them (like the CCTV switches)</span></div>
      <h4 style="margin:12px 0 6px">① CCTV switch for each camera group</h4>
      <table class="nm-vt oi-t"><thead><tr><th>Cameras</th><th>Count</th><th>CCTV switch</th><th>Why</th></tr></thead><tbody>
      ${P.groups.map(g => `<tr><td><b>${esc(g.group)}</b></td><td>${g.cameras}</td><td><select data-g="${esc(g.group)}"><option value="0">— none —</option>${P.switches.map(s => `<option value="${s.id}"${s.id === g.device_id ? ' selected' : ''}>${esc(s.hostname)}${s.location ? ' · ' + esc(s.location) : ''}</option>`).join('')}</select></td><td class="text-sm text-muted">${esc(g.how)}</td></tr>`).join('')}</tbody></table>
      ${P.issues.length ? `<h4 style="margin:16px 0 6px">② To check in the list (${P.issues.length})</h4>${P.issues.map(i => `<div class="text-sm" style="padding:2px 0">⚠ ${esc(i.text)}</div>`).join('')}` : ''}
      ${P.gone && P.gone.length ? `<h4 style="margin:16px 0 6px">Cameras in Server Inventory but not in this list (${P.gone.length})</h4>
        <p class="text-muted text-sm" style="margin:0 0 6px">Removed or replaced? Tick to set them to Stock (they stay in the inventory).</p>
        ${P.gone.map(g => `<label class="mc-m"><input type="checkbox" class="ci-gone" value="${g.id}"> ${esc(g.hostname)} · ${esc(g.ip)} · ${esc(g.mac)}</label>`).join('')}` : ''}
      ${P.report ? `<h4 style="margin:16px 0 6px">CCTV switches from the report (${P.report.switches.length})</h4>
        <p class="text-muted text-sm" style="margin:0 0 6px">The map's CCTV switches came from the rack labels; the report gives their real name, model and IP. The first switch of a cabinet updates the map's switch (ports follow the real model — ports with data are kept); the others are added.</p>
        <table class="nm-vt oi-t"><thead><tr><th>Switch (report)</th><th>Model</th><th>IP</th><th>On the map</th><th>Change</th></tr></thead><tbody>
        ${P.report.switches.map(x => `<tr><td><b>${esc(x.hostname)}</b><div class="text-muted text-sm">${esc(x.status)}</div></td><td class="text-sm">${esc(x.model)}</td><td class="text-sm">${esc(x.ip)}</td>
          <td class="text-sm">${x.map ? esc(x.map) : '<span class="oi-k add">new</span>'}<div class="text-muted">${esc(x.how)}</div></td>
          <td class="text-sm">${x.action === 'same' ? '✔ same' : x.action === 'add' ? `add · ${x.ports.length} ports` : esc(x.changes.join(' · '))}${x.keep ? ` <span class="text-muted">(${x.keep} port(s) with data kept)</span>` : ''}</td></tr>`).join('')}</tbody></table>
        ${P.report.servers.length ? `<h4 style="margin:16px 0 6px">Recording servers (${P.report.servers.length})</h4>
          <table class="nm-vt oi-t"><thead><tr><th>Server</th><th>IP</th><th>Model</th><th>Channels</th><th>Cameras</th><th>Recording</th><th>Note</th></tr></thead><tbody>
          ${P.report.servers.map(x => `<tr><td><b>${esc(x.name)}</b></td><td class="text-sm">${esc(x.ip)}</td><td class="text-sm">${esc(x.model)}</td><td class="text-sm">${esc(x.channels)} (${esc(x.active)} active)</td><td>${esc(x.cameras)}</td><td class="text-sm">${esc(x.record)}</td><td class="text-sm">${esc([x.camStatus, x.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}
      <h4 style="margin:16px 0 6px">Cameras (${P.cameras.length})</h4>
      <table class="nm-vt oi-t ci-t"><thead><tr><th></th><th>Name</th><th>Model</th><th>IP</th><th>MAC / serial</th><th>Firmware</th><th>CCTV switch</th><th>Server Inventory</th></tr></thead><tbody>
      ${P.cameras.map(c => `<tr><td>${pics[c.line] ? `<img src="${pics[c.line]}" alt="" class="ci-th">` : ''}</td><td><b>${esc(c.name)}</b></td><td class="text-sm">${esc(c.model)}</td><td class="text-sm">${esc(c.ip)}</td>
        <td class="si-sn">${esc(c.mac)}<br>${esc(c.serial)}</td><td class="text-sm text-muted">${esc(c.fw)}</td><td class="text-sm">${esc(c.switch) || '<span style="color:#b91c1c">—</span>'}</td>
        <td>${c.action === 'add' ? '<span class="oi-k add">new</span>' : c.action === 'update' ? `<span class="oi-k">fill #${c.server_id}</span>` : `<span class="oi-k">#${c.server_id} same</span>`}</td></tr>`).join('')}</tbody></table>`;
    $('ci-b').querySelectorAll('select[data-g]').forEach(s => { s.onchange = () => { overrides[s.dataset.g] = Number(s.value); preview(); }; });
    $('ci-b').querySelectorAll('[data-io]').forEach(b => { b.onclick = () => { itot = b.dataset.io; render(); }; });
    $('ci-f').innerHTML = `<label class="text-sm" style="margin-right:auto"><input type="checkbox" id="ci-ph" checked> save the ${nPics} picture${nPics === 1 ? '' : 's'}</label>
      ${P.report ? `<label class="text-sm"><input type="checkbox" id="ci-sw" checked> CCTV switches</label><label class="text-sm"><input type="checkbox" id="ci-sv" checked> recording servers</label>` : ''}
      <button class="btn btn-ghost" onclick="CctvImport.restart()">Another file</button><button class="btn btn-primary" id="ci-go">Apply</button>`;
    $('ci-go').onclick = apply;
  }
  async function apply() {
    $('ci-go').disabled = true;
    try {
      const gone = [...$('ci-b').querySelectorAll('.ci-gone:checked')].map(x => Number(x.value));
      const r = await apiPost('/api/servers/cctv-import', { aoa, report, overrides, site: P.site, it_ot: itot, gone,
        apply: { switches: !!($('ci-sw') && $('ci-sw').checked), servers: !!($('ci-sv') && $('ci-sv').checked) } });
      let saved = 0;
      if ($('ci-ph').checked) {
        const items = P.cameras.filter(c => pics[c.line] && r.ids[c.key]).map(c => ({ server_id: r.ids[c.key], mime: 'image/jpeg', b64: pics[c.line].split(',')[1] }));
        for (let i = 0; i < items.length; i += 40) { $('ci-go').textContent = `Pictures ${i}/${items.length}…`; const x = await apiPost('/api/servers/photos', { items: items.slice(i, i + 40), source: 'cctv list' }); saved += x.saved; }
      }
      showToast(`${r.added} camera${r.added === 1 ? '' : 's'} added, ${r.updated} filled, ${r.gone} to Stock · ${saved} picture${saved === 1 ? '' : 's'}${P.report ? ` · switches ${r.switchesUpdated} updated, ${r.switchesAdded} added · ${r.nvr} recording server(s)` : ''}`);
      $('ci-ov').classList.remove('open');
      if (typeof loadFilters === 'function') await loadFilters(); if (typeof loadServers === 'function') loadServers(1);
    } catch (e) { showToast(e.message || 'Could not apply', 'error'); $('ci-go').disabled = false; $('ci-go').textContent = 'Apply'; }
  }
  function open() { shell(); $('ci-ov').classList.add('open'); P = null; start(); }
  return { open, restart: start };
})();
