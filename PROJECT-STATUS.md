# Hayat Communication Tools — Project Status

_Last synced: 29 May 2026 (commit 42e79cf). Keep this file updated when modules change._

## Where everything lives
| Thing | Location |
|-------|----------|
| **Live app** | https://asset-management-b5qd.onrender.com |
| **Code** | github.com/gvisky/asset-management (branch `main`) |
| **Host** | Render (free plan, auto-deploys on every push to `main`) |
| **Database** | Turso (libSQL) cloud — shared live data, no credit card |
| **Local dev** | This PC: `…\Desktop\Code\Asset control\asset-management` (Node 24, Git) |

## Stack
Node + Express · Turso/libSQL (built-in node:sqlite locally) · vanilla HTML/CSS/JS · auth via scrypt + httpOnly session cookies.

## Accounts (change passwords after first login)
| User | Role | Region | Team | Notes |
|------|------|--------|------|-------|
| viet | admin (global) | all | IT | owner; only one who edits History Usage log |
| hiep | editor | all | IT | |
| quocviet | editor | all | IT | |
| somrutai | editor | Thailand | HR | |
| izzati | editor | Malaysia | HR | |
| hatran | editor | Vietnam | HR | **no Asset Inventory access** |

Roles: **admin / editor / viewer** (+ region scope). Teams: **IT / HR** (drive the User Inventory page). Global = no region (sees all countries); regional = limited to their country.

## Modules
1. **Asset Inventory** — 3 countries (Vietnam/Thailand/Malaysia); search + filters (country, location, brand, department, status); clickable dashboard cards; missing-info alerts; **Recycle Bin** (soft delete + restore, admin); audit log. Asset status = **Active / Broken / Stock** (Stock was formerly "Retired").
2. **Auth & Access Control** — login, roles, region scoping, regional admins (admin + a country can restore their region only), global-admin-only user management.
3. **User Inventory (HR/IT offboarding)** — VN/TH/MY personnel; HR sets **User Type** (Hayat / No Hayat Member) + **Leaving Date**; IT sets **Status** (to be delete / pending delete / deleted) — *only after HR sets User Type*; "to be delete" auto-→ "pending delete" after 1 month. **IT CSV import** of the raw Azure export (auto-filters to the 3 countries, upserts by email, never overwrites edited rows). Monthly re-import reminder for IT.
4. **Server Inventory** — server assets, separate from the main asset list _(added on phone)_.
5. **Warranty & Maintenance** — purchase date, warranty expiry, vendor, cost, PO; maintenance logs linked to assets & servers _(phone)_.
6. **Software & License Management** _(phone)_.
7. **Reports & Export Center** _(phone)_.
8. **Notifications / Alerts** — alert boxes on Dashboard / Asset Inventory / User Inventory; audience-aware (IT/HR/all) + region-scoped; events for HR/IT changes, asset delete/restore, imports.
9. **Dashboard** — asset stats, per-country cards, User Inventory summary cards, consolidated alerts.
10. **Mobile / phone UI** — off-canvas hamburger sidebar, card-view tables, iPhone safe-area support (desktop layout unchanged) _(phone)_.

## ⚠️ Two-device working rule (avoid conflicts)
The project is **one repo + one live site + one database**, shared by every device. But the PC and phone are separate chat sessions that only sync through Git.

**Rule: build on ONE device at a time, and `git pull` before starting.**

Files edited by *both* PC and phone (highest conflict risk if not synced first):
`db/database.js`, `server.js`, `routes/assets.js`, `public/js/app.js`, `public/js/dashboard.js`, `public/js/inventory.js`, `public/css/style.css`, and all page HTML (`index`, `inventory`, `user-inventory`, `users`, `deleted`, `login`).

Phone-only module files (low risk — pure additions):
`routes/{maintenance,licenses,reports,servers}.js` and `public/{maintenance,licenses,reports,server-inventory}.{html,js}`.

## Common commands (run on PC)
```powershell
cd "…\Desktop\Code\Asset control\asset-management"
git pull origin main      # ALWAYS before starting work
git add . ; git commit -m "..." ; git push origin main   # deploys to Render automatically
```

## Open items
- **Malaysia/Thailand asset data**: the `Asset_List_Organized MY.xlsx` / `TL.xlsx` files are empty templates (only Vietnam sample rows) — real data still needed before importing.
- Default seeded passwords should be changed by each user.
