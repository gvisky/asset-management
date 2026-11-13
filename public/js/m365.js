/* ♻ Microsoft 365 licence reclaim list (Licenses page) — routes/m365.js. */

const mEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let mData = null, mCountry = '';

async function loadReclaim() {
  const days = document.getElementById('m365-days').value;
  const box = document.getElementById('m365-body');
  try { mData = await apiGet('/api/m365/reclaim?days=' + days); } catch { box.innerHTML = '<p class="text-muted">Could not load.</p>'; return; }
  document.getElementById('m365-upload-wrap').style.display = mData.canUpload ? '' : 'none';
  if (mData.empty) {
    document.getElementById('m365-meta').textContent = 'no report uploaded yet';
    box.innerHTML = `<div class="empty-state"><p>Upload the Microsoft 365 <b>Active users</b> report: admin centre → Reports → Usage → <b>Active users</b> → Export (CSV).</p></div>`;
    return;
  }
  document.getElementById('m365-meta').textContent = `report of ${mData.asOf} · ${mData.users} users · ${mData.licensed} licensed`;
  renderReclaim();
}

function renderReclaim() {
  const d = mData;
  const countries = [...new Set(d.list.map(r => r.country))];
  const byC = Object.fromEntries(countries.map(c => [c, d.list.filter(r => r.country === c).length]));
  const list = d.list.filter(r => !mCountry || r.country === mCountry);
  const chips = `<button class="pill${!mCountry ? ' on' : ''}" onclick="mCountry='';renderReclaim()">All <b>${d.list.length}</b></button>`
    + countries.map(c => `<button class="pill${mCountry === c ? ' on' : ''}" onclick="mCountry=${jsArg(c)};renderReclaim()">${mEsc(c)} <b>${byC[c]}</b></button>`).join('');
  const prods = Object.entries(d.byProduct).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([p, n]) => `<span class="m365-prod">${mEsc(p)} <b>${n}</b></span>`).join('');
  document.getElementById('m365-body').innerHTML = `
    <div class="m365-sum"><div><div class="m365-big">${d.list.length}</div><div class="text-muted text-sm">licences to review</div></div>
      <div><div class="m365-big" style="color:#dc2626">${d.list.filter(r => r.leaver).length}</div><div class="text-muted text-sm">leavers still licensed</div></div>
      <div><div class="m365-big" style="color:#d97706">${d.list.filter(r => !r.leaver && !r.never).length}</div><div class="text-muted text-sm">no activity ${d.days}+ days</div></div>
      <div><div class="m365-big" style="color:#64748b">${d.list.filter(r => !r.leaver && r.never).length}</div><div class="text-muted text-sm">never active</div></div>
      <div class="m365-prods">${prods || ''}</div></div>
    <div class="m365-chips">${chips}<span style="flex:1"></span><button class="btn btn-ghost btn-sm" onclick="exportReclaim()">⬇ CSV</button></div>
    <div class="table-wrap"><table><thead><tr><th>User</th><th>Country</th><th>Why</th><th>Last activity</th><th>Licences</th></tr></thead><tbody>
    ${list.length ? list.map(r => `<tr><td><b>${mEsc(r.name)}</b><div class="text-muted text-sm">${mEsc(r.upn)}${r.department ? ' · ' + mEsc(r.department) : ''}</div></td>
      <td class="text-sm">${mEsc(r.country)}</td>
      <td><span class="badge ${r.leaver ? 'badge-broken' : r.never ? 'badge-retired' : 'badge-stock'}">${mEsc(r.reason)}</span>${r.leaving_date ? `<div class="text-muted text-sm">leaving ${mEsc(r.leaving_date)}</div>` : ''}</td>
      <td class="text-sm" title="${mEsc(Object.entries(r.activity).map(([k, v]) => k + ': ' + v).join('\n'))}">${r.last_activity ? mEsc(r.last_activity) : '<span class="text-muted">never</span>'}</td>
      <td class="text-sm">${mEsc(r.products)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nothing to reclaim 🎉</td></tr>'}</tbody></table></div>`;
}

function exportReclaim() {
  const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = mData.list.filter(r => !mCountry || r.country === mCountry);
  const csv = '﻿' + [['User', 'UPN', 'Country', 'Department', 'Why', 'Last activity', 'Days idle', 'Leaving date', 'Licences'],
    ...rows.map(r => [r.name, r.upn, r.country, r.department, r.reason, r.last_activity, r.days_idle == null ? '' : r.days_idle, r.leaving_date, r.products])]
    .map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `m365-reclaim-${mData.days}d-${mData.asOf}.csv`; a.click();
}

async function uploadM365() {
  const f = document.getElementById('m365-file').files[0];
  if (!f) { showToast('Choose the Active users export first', 'error'); return; }
  const b64 = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = fail; r.readAsDataURL(f); });
  try { const r = await apiPost('/api/m365/upload', { file_base64: b64, filename: f.name }); showToast(`Uploaded: ${r.users} users, ${r.licensed} licensed`); document.getElementById('m365-file').value = ''; loadReclaim(); }
  catch (e) { let m = 'Upload failed'; try { m = JSON.parse(e.message).error || m; } catch {} showToast(m, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('m365-days').addEventListener('change', loadReclaim);
  document.getElementById('m365-upload').addEventListener('click', uploadM365);
  loadReclaim();
});
