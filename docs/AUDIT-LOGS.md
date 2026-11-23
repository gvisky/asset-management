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

## Proposal (next, optional)

1. **Stop writing the duplicates** — write a port change once (audit, with before / after in a structured column) and let the
   Network map port history and the OT activity page read from it. Saves space and keeps one truth. Needs a small migration.
2. **Retention**: keep page visits 1 year (already), keep everything else for good; nightly backups hold the history.
3. **Alerts on the log**: failed sign-ins from a new IP, many deletes in a short time, changes outside working hours → Inbox.
