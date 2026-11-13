/* Which pages an account can open, and whether it can change data there — the same rules the
   server enforces (route guards) and the menu shows (public/js/auth.js). Used by Users & Audit
   (🔑 Logins) so an admin can review each account's access next to its logins.

   Rules:
   - asset pages (Dashboard, Asset / Server Inventory, Devices, Maintenance, Licenses, Reports (IT admin: sync uploads),
     Needs Attention): every account except User-Inventory-only (asset_access = 0); admin / editor
     change data, viewer reads only
   - User Inventory: team HR or IT; only an IT admin edits · Leavers: HR and IT see it, IT (admin / editor) ticks
   - Stocktake: asset users; admin / editor scan · KPIs: asset users; IT admin sets depreciation years
   - System Health: team IT; IT admin manages collectors
   - Budget Tracking: IT admin
   - Recycle Bin: admin (a regional admin sees / restores their countries)
   - Users & Audit: global admin (admin with no country)
   Every page shows only the account's countries (users.country; empty = all countries). */

const ASSET_PAGES = [
  ['dashboard', 'Dashboard'], ['assets', 'Asset Inventory'], ['servers', 'Server Inventory'], ['devices', 'Devices'],
  ['maintenance', 'Maintenance'], ['stocktake', 'Stocktake'], ['licenses', 'Licenses'], ['reports', 'Reports'], ['kpi', 'KPIs'],
  ['attention', 'Needs Attention'],
];

/** → [{ key, page, edit: bool }] in menu order. */
function pagesFor(u) {
  if (!u) return [];
  const admin = u.role === 'admin', editor = admin || u.role === 'editor';
  const it = u.team === 'IT', hr = u.team === 'HR', itAdmin = it && admin;
  const global = !String(u.country || '').trim();
  const out = [];
  if (Number(u.asset_access) !== 0) {
    for (const [key, page] of ASSET_PAGES) out.push({ key, page, edit: key === 'dashboard' ? false : key === 'reports' || key === 'kpi' ? itAdmin : editor });
  }
  if (it || hr) out.push({ key: 'people', page: 'User Inventory', edit: itAdmin });
  if (it || hr) out.push({ key: 'leavers', page: 'Leavers', edit: it && editor });
  if (it) out.push({ key: 'health', page: 'System Health', edit: itAdmin });
  if (itAdmin) out.push({ key: 'budget', page: 'Budget Tracking', edit: true });
  if (admin) out.push({ key: 'bin', page: 'Recycle Bin', edit: true });
  if (admin && global) out.push({ key: 'users', page: 'Users & Audit', edit: true });
  return out;
}

module.exports = { pagesFor };
