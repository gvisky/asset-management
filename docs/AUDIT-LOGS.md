# Logs in the app — review and how they are combined

*November 2026. Page: Admin › 📜 Audit log & activities (`/activity.html`, API `routes/activity.js`).*

## What the app records

| # | Log (table / field) | What it holds | Where it was shown | Duplicate? |
|---|---|---|---|---|
| 1 | **audit_log** | Every sign-in (and failed sign-in), change, export, import, unlock, restore, page visit — with user and IP | Users & Audit → 📜 Audit Log | **Master log** — kept |
| 2 | **net_port_log** | Network map: each port change (before → after) and device added / edited / deleted | Network map → port history | **Port lines = duplicate** of the audit `NETMAP` entry (same change, same text). Device-level lines (added, edited, OT view) are only here |
| 3 | **ot_activity** | OT devices and OT switch ports: row before and after, for restore | OT activity (OT admin / IT) | **Duplicate** of the audit `UPDATE` / `NETMAP` entries — kept for its *restore* button |
| 4 | **history_usage** (field on every asset / server) | The record's own trail: "edited Status: Active → Stock by viet", locks | Asset / server details | **Duplicate** of the audit `UPDATE` entry — kept, it is the record's history |
| 5 | **health_events** | Monitoring: a system went up / down / warn | System Health | Unique — system events, no user |
| 6 | **qr_scans** | Every QR label / stocktake scan (who, when, where from) | Asset scan history | Unique |
| 7 | **stocktake_scans** | Result per stocktake (found / elsewhere / unknown) | Stocktake | Data of the stocktake (the scan itself is in `qr_scans`) |
| 8 | **asset_confirmations** | Staff confirmed / refused their devices | Users → confirmations | Also audited as `CONFIRM_*` → duplicate |
| 9 | **notifications** | Messages to people (bell) made from the same events | 🔔 | Not a log — messages |

So one Network map port change was written **3 times** (audit + port log + OT log) and one server edit **3 times** (audit + history usage + OT log).

## What was done

- **One page, one timeline**: `audit_log` + monitoring events + QR scans + Network map device lines, newest first, grouped into areas
  (Sign-in & security, Users & access, Assets, Servers & network, Network map, OT, People, Licenses, Maintenance, Stocktake & labels,
  Budget, Monitoring, Recycle bin, Imports, Exports, Page visits). Filters: area chips with counts, user, dates, search; CSV export.
- **Duplicates hidden by default**: the port-by-port Network map log and the OT before → after log are shown only with
  "Detail logs (duplicates)". Page visits are off by default (many lines).
- Users & access keeps 🔑 Logins (accounts); its Audit Log card now links to the new page.
- Nothing is deleted or stops being written: the port history on the map, the OT restore, and each record's history usage keep working.

## Write-once (done)

Every change is now written **once**, as one row of `audit_log` (`lib/changelog.js`):

| Change | Before | Now |
|---|---|---|
| A Network map port | audit text + `net_port_log` + `ot_activity` (OT switch) | **1 row**: text, site / device / port, before → after; for OT switches also the rows (JSON) for restore |
| Port owner (OT / IT) | 3 rows | **1 row** |
| Move a cable between ports | summary + 1 line per port | **1 line per port changed** |
| A Server Inventory record (create / edit / delete) | audit + `ot_activity` (OT) | **1 row** with the field changes (and the rows for restore when OT) |
| OT restore | restore line + audit line | **1 row** (kind *restore*, linked to the change it undid) |
| Bulk imports (CCTV list, MAC tables, OT list …) | 1 summary + 1 port line + 1 OT line per port | 1 summary + **1 line per port** (the OT restore data is added to that line) |

- Readers now use `audit_log`: Network map port history (`GET /api/netmap/log`), OT activity and its restore, OT Reports
  (port changes), and the 📜 Audit log & activities page.
- **Migration (automatic, once, on start)**: the rows of `net_port_log` and `ot_activity` are copied into `audit_log`
  (`legacy` = `portlog` / `ot`) so the map history and OT restore keep their past. The old tables are **kept as a backup**
  and are no longer written. On the Audit page the copied rows are hidden unless "Old copied logs" is ticked (they repeat old
  entries), except the old device-level map lines, which existed only there.
- Each record's *History usage* field stays — it is the record's own trail.

## Proposal (next, optional)

1. **Retention**: keep page visits 1 year (already), keep everything else for good; nightly backups hold the history.
2. **Alerts on the log**: failed sign-ins from a new IP, many deletes in a short time, changes outside working hours → Inbox.
