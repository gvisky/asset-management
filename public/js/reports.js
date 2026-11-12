/* Reports & Export page logic */

const REPORTS = [
  { group: 'Inventory', id: 'assets',   title: 'Asset Inventory',  desc: 'Every field we hold, keyed by ID — edit & re-upload below to sync.' },
  { group: 'Inventory', id: 'users',    title: 'User Inventory',   desc: 'All people, keyed by ID — edit & re-upload below to sync.' },
  { group: 'Inventory', id: 'servers',  title: 'Server Inventory', desc: 'All servers with hostname, IP, OS, specs.' },
  { group: 'Inventory', id: 'summary',  title: 'Asset Summary',    desc: 'Counts by status, location, country, cost center & asset type.' },
  { group: 'Inventory', id: 'locked',   title: 'Locked Items',     desc: 'Records locked by a User Name / AD Name change, with cost center, dept, model, serial, codes & user.' },
  { group: 'Devices & users', id: 'devices',  title: 'Devices (Intune / Entra)', desc: 'Every device of AD users: compliance, last check-in / sign-in, linked asset — plus a sheet of differences to check.' },
  { group: 'Devices & users', id: 'activity', title: 'User activity (AD / Intune / Entra)', desc: 'AD account, last AD logon, Intune check-in, Entra sign-in, days since last seen — and who needs a check.', teams: ['IT', 'HR'] },
  { group: 'Devices & users', id: 'offboarding', title: 'Offboarding Reclaim', desc: 'Leaving personnel and the assets they hold.' },
  { group: 'Maintenance', id: 'broken',      title: 'Broken & Stock + spare parts', desc: 'Broken and stock devices with the parts check of each broken laptop, spare parts per model and in total.' },
  { group: 'Maintenance', id: 'maintenance', title: 'Open Maintenance', desc: 'Open repairs/services across assets and servers.' },
  { group: 'Maintenance', id: 'warranty',    title: 'Warranty Due',     desc: 'Assets & servers expiring/expired within 90 days.' },
  { group: 'IT', id: 'health',   title: 'System Health', desc: 'Collectors, the latest status of every check, and the history of status changes.', teams: ['IT'] },
  { group: 'IT', id: 'licenses', title: 'Licenses',      desc: 'Licenses with seats used and renewal dates.' },
];

// One report: title, description, and a choice of Excel (dashboard + data), PDF (dashboard) or HTML (interactive).
function card(r) {
  const t = Date.now();
  return `<div class="stat-card rep-card">
    <div class="stat-icon" style="background:#dcfce7">
      <svg width="22" height="22" fill="none" stroke="#16a34a" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
    <div style="flex:1;min-width:0"><div class="stat-label" style="font-size:13.5px;color:var(--text);font-weight:600">${r.title}</div>
    <div class="text-muted text-sm" style="margin-top:2px">${r.desc}</div>
    <div class="rep-btns">
      <a class="btn btn-sm rep-xlsx" href="/api/reports/${r.id}.xlsx?t=${t}" download title="Dashboard with charts + raw data sheets">📊 Excel</a>
      <a class="btn btn-sm rep-pdf" href="/api/reports/${r.id}.pdf?t=${t}" download title="Dashboard with charts">📄 PDF</a>
      <a class="btn btn-sm rep-html" href="/api/reports/${r.id}.html?t=${t}" target="_blank" rel="noopener" title="Interactive page: switch country, sort, hover the bars, search the data, CSV">🌐 HTML</a>
    </div></div>
  </div>`;
}
// Reports grouped by area; reports for one team only are shown to that team.
function renderReports(u) {
  const team = u && u.team;
  const list = REPORTS.filter(r => !r.teams || r.teams.includes(team));
  const groups = [...new Set(list.map(r => r.group))];
  document.getElementById('report-grid').innerHTML = groups.map(g =>
    `<div class="rep-group"><div class="rep-group-title">${g}</div><div class="stat-grid">${list.filter(r => r.group === g).map(card).join('')}</div></div>`).join('');
}

// Read a File as base64 (without the data: prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Generic sync uploader for the round-trippable .xlsx reports.
async function runSync({ endpoint, inputId, statusId, btnId, label }) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  const btn = document.getElementById(btnId);
  const file = input.files && input.files[0];
  if (!file) { showToast(`Choose the ${label} .xlsx first`, 'error'); return; }
  if (!confirm(`Upload this file and update the ${label.toLowerCase()} database? Matching rows (by ID) will be overwritten.`)) return;

  btn.disabled = true;
  status.textContent = 'Uploading…';
  try {
    const xlsx_base64 = await fileToBase64(file);
    const r = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xlsx_base64 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Import failed');
    status.textContent = `✅ ${d.updated} updated, ${d.inserted} added, ${d.skipped} skipped (of ${d.total} rows).`;
    showToast(`Sync complete: ${d.updated} updated, ${d.inserted} added`);
    input.value = '';
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
const runImport = () => runSync({ endpoint: '/api/assets/import', inputId: 'import-file', statusId: 'import-status', btnId: 'import-btn', label: 'Asset Inventory' });
const runImportUsers = () => runSync({ endpoint: '/api/personnel/import-sync', inputId: 'import-users-file', statusId: 'import-users-status', btnId: 'import-users-btn', label: 'User Inventory' });

// Budget Tracking sync: upload the (small, round-trippable) Budget .xlsx and replace.
async function runImportBudget() {
  const input = document.getElementById('budget-rep-file');
  const status = document.getElementById('budget-rep-status');
  const btn = document.getElementById('budget-rep-btn');
  const file = input.files && input.files[0];
  if (!file) { showToast('Choose the Budget .xlsx first', 'error'); return; }
  if (!confirm('Upload this file and REPLACE the budget data?')) return;
  btn.disabled = true; status.textContent = 'Uploading…';
  try {
    const xlsx_base64 = await fileToBase64(file);
    const r = await fetch('/api/budget/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xlsx_base64 }),
    });
    const text = await r.text();
    const d = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(d.error || ('Import failed (HTTP ' + r.status + ')'));
    const by = Object.entries(d.byCountry || {}).map(([k, v]) => `${k} ${v}`).join(', ');
    status.textContent = `✅ Imported ${d.inserted} line items (${by}).`;
    showToast(`Budget synced: ${d.inserted} line items`);
    input.value = '';
  } catch (e) {
    status.textContent = '❌ ' + e.message;
    showToast(e.message, 'error');
  } finally { btn.disabled = false; }
}

document.addEventListener('DOMContentLoaded', () => {
  renderReports(window.CURRENT_USER);

  // Import / Sync — IT administrators only (wait for auth to resolve).
  const setupImport = (u) => {
    renderReports(u);
    if (!u || u.team !== 'IT' || u.role !== 'admin') return;
    const card = document.getElementById('import-card');
    if (card) card.style.display = '';
    const btn = document.getElementById('import-btn');
    if (btn && !btn.dataset.wired) { btn.dataset.wired = '1'; btn.addEventListener('click', runImport); }
    const ucard = document.getElementById('import-card-users');
    if (ucard) ucard.style.display = '';
    const ubtn = document.getElementById('import-users-btn');
    if (ubtn && !ubtn.dataset.wired) { ubtn.dataset.wired = '1'; ubtn.addEventListener('click', runImportUsers); }

    // Budget Tracking — download (cache-busted) + re-upload to sync.
    const bcard = document.getElementById('budget-report-card');
    if (bcard) bcard.style.display = '';
    const bdl = document.getElementById('budget-dl-btn');
    if (bdl) bdl.href = '/api/budget/export.xlsx?t=' + Date.now();
    const bbtn = document.getElementById('budget-rep-btn');
    if (bbtn && !bbtn.dataset.wired) { bbtn.dataset.wired = '1'; bbtn.addEventListener('click', runImportBudget); }
  };
  if (window.CURRENT_USER) setupImport(window.CURRENT_USER);
  else if (typeof ensureAuth === 'function') ensureAuth().then(setupImport);
});
