/* Reports & Export page logic */

const REPORTS = [
  { id: 'assets',      title: 'Asset Inventory',     desc: 'Every field we hold, keyed by ID — edit & re-upload below to sync.' },
  { id: 'servers',     title: 'Server Inventory',    desc: 'All servers with hostname, IP, OS, specs.' },
  { id: 'locked',      title: 'Locked Items',        desc: 'Locked assets with cost center, dept, model, serial, codes & user.' },
  { id: 'summary',     title: 'Asset Summary',       desc: 'Counts by status, location, country, cost center & asset type.' },
  { id: 'warranty',    title: 'Warranty Due',        desc: 'Assets & servers expiring/expired within 90 days.' },
  { id: 'maintenance', title: 'Open Maintenance',    desc: 'Open repairs/services across assets and servers.' },
  { id: 'offboarding', title: 'Offboarding Reclaim', desc: 'Leaving personnel and the assets they hold.' },
  { id: 'licenses',    title: 'Licenses',            desc: 'Licenses with seats used and renewal dates.' },
];

function card(r) {
  return `<a class="stat-card" href="/api/reports/${r.id}.xlsx" download>
    <div class="stat-icon" style="background:#dcfce7">
      <svg width="22" height="22" fill="none" stroke="#16a34a" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
    <div><div class="stat-label" style="font-size:13.5px;color:var(--text);font-weight:600">${r.title}</div>
    <div class="text-muted text-sm" style="margin-top:2px">${r.desc}</div></div>
  </a>`;
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

async function runImport() {
  const input = document.getElementById('import-file');
  const status = document.getElementById('import-status');
  const btn = document.getElementById('import-btn');
  const file = input.files && input.files[0];
  if (!file) { showToast('Choose the Asset Inventory .xlsx first', 'error'); return; }
  if (!confirm('Upload this file and update the asset database? Matching rows (by ID) will be overwritten.')) return;

  btn.disabled = true;
  status.textContent = 'Uploading…';
  try {
    const xlsx_base64 = await fileToBase64(file);
    const r = await fetch('/api/assets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('report-grid').innerHTML = REPORTS.map(card).join('');

  // Import / Sync — IT administrators only (wait for auth to resolve).
  const setupImport = (u) => {
    if (!u || u.team !== 'IT' || u.role !== 'admin') return;
    const card = document.getElementById('import-card');
    if (card) card.style.display = '';
    const btn = document.getElementById('import-btn');
    if (btn && !btn.dataset.wired) { btn.dataset.wired = '1'; btn.addEventListener('click', runImport); }
  };
  if (window.CURRENT_USER) setupImport(window.CURRENT_USER);
  else if (typeof ensureAuth === 'function') ensureAuth().then(setupImport);
});
