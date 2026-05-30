/* Reports & Export page logic */

const REPORTS = [
  { id: 'assets',      title: 'Asset Inventory',     desc: 'All live assets with full details.' },
  { id: 'summary',     title: 'Asset Summary',       desc: 'Counts by status, location and country.' },
  { id: 'warranty',    title: 'Warranty Due',        desc: 'Assets expiring/expired within 90 days.' },
  { id: 'maintenance', title: 'Open Maintenance',    desc: 'Repairs/services not yet completed.' },
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('report-grid').innerHTML = REPORTS.map(card).join('');
});
