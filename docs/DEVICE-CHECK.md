# Device Check — Intune + Entra vs Asset Inventory

_Proposal, plan and how it works. Started 10 Nov 2026._

## Why
Asset Inventory was built and corrected by hand over a long time. Intune and Entra hold the
**live** state of every company device: PC name, serial, model, primary user, compliance,
ownership and when it was last seen. The goal is to **compare** both and show IT where they
disagree, so IT can check and fix in real life. **No upload may change Asset Inventory or User Inventory by itself.**

## What was asked (user, 10 Nov 2026)
1. Import only devices whose user is in the **AD user list** (User Inventory people uploaded from AD).
2. One user can have several devices → **Asset Inventory grouped by user**.
3. Show **days since** Entra `approximateLastSignInDateTime` and Intune `Last check-in`.
4. Windows device name / serial / model in Intune & Entra may differ from the hand-made Asset
   Inventory → **highlight differences** for checking and fixing.
5. Show Intune **Managed by**, **Ownership** (company / personal) and **Compliance**.
6. Don't destroy the current database. Highlight, let IT decide.

## The two files
| File | Where to export | Columns used |
|---|---|---|
| Entra devices | Entra ID → Devices → All devices → Download | id, deviceId, displayName, operatingSystem(+Version), model, owner, upnName, isCompliant, isManaged, accountEnabled, profileType, approximateLastSignInDateTime |
| Intune devices | Intune → Devices → All devices → Export | Device ID, Device name, Managed by, Ownership, Compliance, OS version, Primary user UPN, Last check-in, Model, Manufacturer, Serial number, Primary user display name |

Intune ⇄ Entra are joined on Intune `Device ID` = Entra `deviceId` (else the device name).

## Rules
**Kept devices:** primary user (Intune `Primary user UPN`, else Entra `upnName`) whose part before @
is a User Inventory person seen in the latest AD upload (`ad_sam` or email before @). Everything
else in the files is ignored (other countries, people not in AD, devices without a user).

**Matching a device to an asset** (computers = Windows / macOS only):
1. asset Computer No = device name, 2. else asset Serial # = device serial.
Phones / tablets are linked by serial when it matches, but never flagged (their asset serial is
often the IMEI, and many phones are personal).

**Differences flagged** (computers, not Personal):
| Code | Meaning |
|---|---|
| `not_in_assets` | Company computer of an AD user with no asset (no Computer No / serial match) |
| `pc_no` | Found by serial, but the asset's Computer No differs from the Intune device name |
| `serial` | Found by Computer No, but the asset's Serial # is empty or differs from Intune |
| `user` | The asset's AD Name is empty or another person than the device's primary user |
| `brand` | The asset's brand (first word of Brand / Model) is another maker than Intune's manufacturer |
| `duplicate` | Another asset has the same serial (typos O↔0, I↔1, spaces / dashes ignored) and at most one of the two has an SAP asset code → the same machine recorded twice → **Merge** |
| `sap_desc` | The SAP asset description of another asset names this machine's serial ("Laptop Lenovo X1 Yoga- PF25Y0MX") while that asset holds another / no serial → check which is right (Open asset / Mark as checked) |
| `conflict` | Same serial on two assets that both have (different) SAP asset codes → two real assets, one serial is probably mistyped → check by hand (never merged) |

Model is shown side by side for information only (Intune gives machine types like
`20N3SHLH00`, Asset Inventory friendly names like `Lenovo T490` — they can't be compared exactly).

**What IT can do with a difference** (IT admin):
- **Use Intune value** — copies that one value (Computer No, Serial #, or AD Name + User Name) to
  the asset, writes a line to the asset's History Usage and the audit log.
  It refuses when another asset already has that Serial / Computer No (no duplicates), and follows the
  same locks as a manual edit (locked Serial / locked model / user lock → unlock first); copying a
  Serial or a new user sets the same locks a manual edit would.
- **Merge** (duplicates only, 10 Nov 2026) — keeps the record with the SAP asset code (else the older
  one) and **puts the system first**: Computer No + Serial from Intune, User Name (AD display name) +
  AD Name from the device's AD user, Brand / Model, Asset Type, Location, Country, Status from the newer
  record (the one created from Intune) when it has a value. Accounting / IT details (SAP codes,
  department, cost center, purchase date, warranty, vendor, cost, PO, remark, history) stay from the
  kept record, its empty fields filled from the other. A real holder change (another AD Name) locks the
  record like a manual edit. Then it moves
  maintenance / license links and the device link, combines both History Usage logs, and puts the other
  record in the **Recycle Bin** (restorable). Refused when both records have different SAP codes, or
  the kept record's Serial is locked. Placeholder codes like "Missing" / "N/A" don't count as codes.
- **Mark as checked** — the difference is accepted as is; it stays hidden on later uploads as long
  as the values don't change (stored in `device_ack`).
- Or open the asset and edit by hand.

## Upload flow (IT admin, Devices page → ⬆ Upload Intune + Entra)
1. Pick both CSV files → **preview**: devices in the files, devices of AD users, matched to
   assets, differences by type, not in Asset Inventory, compliance / ownership counts.
2. **Apply** replaces only the `devices` snapshot table (the Devices list). Assets, people,
   accepted checks (`device_ack`) are not touched. Safe to repeat with every new export.

The old 3-file import / "Add all" stays switched off (`IMPORTS_ENABLED`).

## Where it shows
- **Devices page** — default view **Needs check**; columns compliance, ownership, managed by,
  last check-in / last sign-in in days, and the differences with the fix buttons.
- **Asset Inventory → View: By user** (default) — one block per user: their assets, each with
  its Intune status (compliance, days since check-in, differences), plus their Intune devices
  that are not in Asset Inventory (highlighted) and their phones / tablets.

## Data (additive, nothing removed)
- `devices`: + `compliance`, `last_checkin`, `issues` (JSON list of differences), `asset_values`
  (the asset's values at upload time, for the side-by-side view).
- `device_ack (device_key, code, value, by_user, at)` — accepted differences.
- `app_meta.device_check_last` — time of the last upload.

## Code
- `lib/device-check.js` — reading the files, keeping AD users' devices, matching, differences (no database writes).
- `routes/devices.js` — `POST /api/devices/check-upload` (preview / apply),
  `POST /api/devices/:id/use-intune` (one field → asset), `POST /api/devices/:id/ack` (mark checked).
- `routes/assets.js` — `GET /api/assets?group=user` (grouped view with devices).
- `public/js/devices.js`, `public/js/inventory.js` — pages.

## Tested (10 Nov 2026, local copy, real exports 09 Nov 2026)
- Files: 14,646 devices → **453** of 236 AD users kept (13,280 of people not in AD, 913 without a user ignored).
- 253 computers; 209 devices linked to an asset; **79 need a check**: 40 not in Asset Inventory,
  29 user, 12 serial, 10 PC No, 7 PC No/serial on two assets, 1 brand.
- Compliance: 330 compliant, 76 non-compliant. Ownership: 241 corporate, 115 personal, 97 Entra only.
- Apply: assets and personnel tables identical before / after (hash compared); only `devices` replaced.
- Use Intune value (serial, PC No) and Mark as checked work; the next upload no longer flags them (79 → 77).
- Use Intune value refuses a Serial already on another asset.

## Also changed
- The one-off "Undo Microsoft import" button (October 2026) is switched off — it would now also remove
  assets added from devices. Render `UNDO_IMPORT_ENABLED=1` brings it back if ever needed.
- The old 3-file import / Add all stay off (`IMPORTS_ENABLED`).

## Next ideas (not built)
- A person with assets but **no** Intune computer (laptop not enrolled / lost?).
- Compare model names through a machine-type → model map (e.g. Lenovo 20N3 → T490).
- Scheduled pull from Microsoft Graph instead of uploading CSVs (needs an app registration with read rights).

## Duplicates (added 10 Nov 2026)
Asked: "If a device has the same Serial but a different Computer No, merge to the one from Intune and
Entra." Example: #750 (VNHCMC0500, serial 5CG01204K7, no asset code, added from Intune) and #253
(VNHCMC0293, serial typed 5CGO12O4K7 with letter O, asset code 255020000004) → Merge keeps #253 with
Computer No VNHCMC0500 / Serial 5CG01204K7; #750 goes to the Recycle Bin.
Test on the local copy: 4 duplicates to merge, 6 serials shared by two SAP assets (check by hand).

## Kept up to date after the upload (10 Nov 2026)
The differences used to be worked out only at upload time, so an asset added afterwards (e.g. with
➕ Add on the Devices page) left the device showing "Not in Asset Inventory" and no Merge button.
Now `lib/device-recheck.js` re-runs the comparison on the stored device list whenever assets or
accepted checks changed since the last time (cheap signature check), before the Devices page and
Asset Inventory → View: by user are loaded.

## Search + SAP description (10 Nov 2026)
Searching PF25Y0MX showed asset #112 (serial PF25Y51Q): its SAP description says "Laptop Lenovo X1 Yoga-
PF25Y0MX", while Intune has PF25Y0MX as VNHCMC0198 of Haluk Ozgur Acar. Now:
- Asset Inventory (view by user) says when a row was **found in the SAP description**, and lists the
  **Intune / Entra devices** matching the search (name, serial, user) with who uses them and their asset.
- Device Check flags `sap_desc` (12 on the local copy). `lib/device-recheck.js` has a rules version so stored
  differences are worked out again after a rules change.

## Bug review (10 Nov 2026) — fixed
- Several assets with the same Computer No: the device now takes the one with its serial, else its user (was: the
  first one → false conflict / serial / user differences, e.g. VNHCMC0246 → #94 instead of #242).
- Intune has two records for one PC (old ConfigMgr without user + current): the Entra row joins the one with the
  same user; Entra's older duplicate records (same name + user) are skipped, newest sign-in first.
- Merge follows manual-edit locks: locked holder kept, locked Serial / model stops the merge, locked Brand / Asset
  code left as is, and Serial / Brand / Asset code / holder changes lock the record. Device links move too.
- Use Intune value → Serial locks also when filling an empty Serial.
- Country scope: Mark as checked / Merge / Use Intune value only on devices + assets of the user's countries;
  the Intune + Entra upload and the AD upload are global IT admin only; search shows only in-scope devices.
- Two uploads at the same time are refused (409); first-seen dates are kept across uploads.
- Recheck signature includes a checksum of the compared fields.
