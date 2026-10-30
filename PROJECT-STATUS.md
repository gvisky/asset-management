# Hayat Communication Tools — Project Status

_Last synced: 12 Oct 2026 (commit 53c0e6b). Keep this file updated when modules change._

## Where everything lives
| Thing | Location |
|-------|----------|
| **Live app** | https://asset.hayat.io.vn (custom domain → Render service `asset-management-b5qd.onrender.com`) |
| **Code** | github.com/gvisky/asset-management (branch `main`) |
| **Host** | Render (free plan, auto-deploys on every push to `main`) |
| **Database** | Turso (libSQL) cloud — shared live data, no credit card |
| **Development** | GitHub-based (Claude Code cloud sessions). The old local PC copy is no longer the main workspace. |

## Stack
Node + Express · Turso/libSQL (built-in node:sqlite locally) · vanilla HTML/CSS/JS · auth via scrypt + httpOnly session cookies.

## Accounts (as of 12 Oct 2026)
| User | Role | Region | Team | Notes |
|------|------|--------|------|-------|
| viet | admin (global) | all | IT | owner; only one who edits History Usage log |
| hiep | admin (global) | all | IT | |
| quocviet | admin (global) | all | IT | |
| somrutai | editor | Thailand | HR | |
| izzati | editor | Malaysia | HR | |
| hatran | editor | Vietnam | HR | **no Asset Inventory access** |
| yen | editor | Vietnam | HR | **no Asset Inventory access** |
| test | admin (global) | all | IT | test account used by Claude Code to verify changes on the live site |

Roles: **admin / editor / viewer** (+ country scope: global, or one or more countries per user). Teams: **IT / HR** (drive the User Inventory page). Global = no region (sees all countries); regional = limited to their country. **IT admin** = team IT + role admin (needed for Budget, User Inventory editing/import, report import, unlocking).

## Modules
1. **Asset Inventory** — 3 countries (Vietnam/Thailand/Malaysia); search + filters (country, location, brand, department, status, **Asset Type** — landing view defaults to Laptop); clickable dashboard cards; **Needs Attention** (missing info, Active without AD Name, duplicate serials; some asset types exempt); **Missing AD & Asset** inline filter; AD Name column; department / cost center / ECC CC linked dropdowns; **Print Delivery Form** (company .xlsx) from Edit / View Detail; **Recycle Bin** (soft delete + restore, admin; permanent delete for IT admin); audit log. Asset status = **Active / Broken / Stock**.
   - **Locks:** Serial / Brand-Model / Asset Code are IT-only to edit, IT admin unlocks. **History Usage** = holder lock (User Name / AD Name changes) feeding the SAP update list. **Locked models** (Dashboard Top Models) block delete and freeze Asset Type / Brand-Model / Serial for everyone until unlocked.
2. **Auth & Access Control** — login, roles, region scoping, regional admins (admin + a country can restore their region only), global-admin-only user management (with team selector). HR-only users (`asset_access = 0`) are redirected away from all asset pages.
3. **User Inventory (HR/IT offboarding)** — VN/TH/MY personnel; HR sets **User Type** (Hayat / No Hayat Member) + **Leaving Date**; **Status is manual-only** (to be delete / pending delete — shown as "Confirmed Delete" / deleted); editing is IT-admin only. Department + Cost Center (linked to assets via AD Name = email local-part, with linked-assets modal). Add User, **IT CSV import / sync** of the raw Azure export (auto-filters to the 3 countries, upserts by email, never overwrites edited rows). Monthly re-import reminder for IT.
4. **Server Inventory** — 150 servers, separate from the main asset list; Producer + Category columns/filters.
5. **Warranty & Maintenance** — purchase date, warranty expiry, vendor, cost, PO; maintenance logs linked to assets & servers.
6. **Software & License Management** — department + current seat users.
7. **Reports & Export Center** — Full Asset Inventory report + re-upload sync (import is IT-admin only), Locked Items report, **Budget export** (round-trippable). Downloads are no-store / cache-busted.
8. **Budget Tracking** _(IT admin only)_ — built around `budget 2026.xlsx` Sheet1 line items; IT-admin **Import Budget .xlsx** (parsed in the browser); Turkish GL (MÇ No) → Local GL mapping from `GL.xlsx` (`db/gl-map-seed.json`); filters + quick search.
9. **Notifications / Alerts** — alert boxes on Dashboard / Asset Inventory / User Inventory + Needs Attention alerts page; audience-aware (IT/HR/all) + region-scoped; events for HR/IT changes, asset delete/restore, imports.
10. **Dashboard** — asset stats, per-country cards, Top Models by Asset Type (with delete-lock), User Inventory summary cards, consolidated alerts.
11. **Mobile / phone UI** — off-canvas hamburger sidebar, card-view tables, iPhone safe-area support (desktop layout unchanged).
12. **Devices (Intune + Entra)** — IT admin imports 3 Microsoft exports (Azure users, Intune devices, Entra devices); they are linked by email (person ⇄ device), Intune Device ID / device name (Intune ⇄ Entra) and Computer No / Serial (device ⇄ asset). Devices page with compliance, last sign-in, owner and asset links; "Fill assets from Intune" fills only empty asset fields. Devices can be **added** to Asset Inventory (bulk or one by one; Brand / Model learned from existing assets with the same model; personal/BYOD devices unticked by default) and device users missing from User Inventory can be added (IT admin). **➕ Add all to Asset Inventory** adds every device with a known country in one go (in steps of 500). The Devices page shows by default only devices still **to add** (not in Asset Inventory, or user not in User Inventory). Device ⇄ asset links and first-seen dates are remembered across imports (`device_links`, `device_seen`), so later imports only surface **new** devices; the first big import is the baseline (no "New" badges for it). The exports never contain Asset code, Asset S/4, Location (Office/Factory), Department / Cost center or Purchase date — those stay to fill and show in Needs Attention. The Azure users file updates User Inventory for **all countries** (people only — guests and service accounts skipped).
   - **Imports are off** unless Render has `IMPORTS_ENABLED=1` (the first all-countries import added too many assets). **↩ Undo Microsoft import** (IT admin, Devices page) removes what the imports added since 30 Oct 2026 03:20 UTC — assets created from devices and people added by the import that nobody edited by hand, Intune fills, the Devices list and its links — with a preview first. Hand-edited assets / people are kept and listed.
13. **Backup / restore** — `npm run backup` (all tables → timestamped JSON), `npm run restore` (see `DISASTER-RECOVERY.md`).

## Working rule (avoid conflicts)
The project is **one repo + one live site + one database**. Every push to `main` goes live immediately and works on real data.

- Make changes on a **feature branch** (e.g. `claude/...`), review, then merge to `main` to deploy.
- Work in **one place at a time**. If a local copy is still used, `git pull origin main` before touching it.
- After a deploy, verify on https://asset.hayat.io.vn (the `test` account is available for this).

## Open items
- **User Inventory re-import overdue** — last Azure CSV import was 29 May 2026.
- **Malaysia/Thailand asset data** — Thailand has 46 assets and Malaysia 34 in the live DB; check whether the full lists still need importing.
- **Account security** — default seeded passwords should be changed by each user; the `test` account (global IT admin) has a weak password — change it or lower its role when not testing.
