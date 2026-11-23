# Hayat Communication Tools: reorganising the app (UX proposal)

*November 2026. Based on a walk-through of all 19 pages as an IT admin, a Network user and an OT user, on desktop and phone.*

---

## 1. Why now

The app grew one feature at a time: assets, then people, servers, the network map, OT, health,
budget, MFA. Each feature is good on its own, but together they feel like **19 separate tools in one
menu**. A new IT colleague, a manager or an auditor has to learn where everything is.

**What is wrong today (found on the walk-through):**

| # | Problem | Where you see it |
|---|---|---|
| 1 | **A flat menu of 15 items** mixing end-user IT, people, infrastructure, money and analytics. Budget sits between Reports and KPIs; System Health between Devices and Maintenance. | Sidebar |
| 2 | **"Needs Attention" is in 7 places:** the menu, a "⚠️ Missing Info" button and a "Missing AD & Asset" button on Asset Inventory, a button on Server Inventory, OT Needs Attention, 🔔 Alerts, and System Health alerts. Nobody has one list of "what do I fix today". | Many pages |
| 3 | **Top bars are crowded.** 2-step login, Change password and Logout are always visible as buttons. On User Inventory, the buttons wrap onto two lines. | Every page |
| 4 | **Every page has its own country filter.** You choose "Vietnam" on the Dashboard, then choose it again on every page. | Dashboard, inventories, reports |
| 5 | **Filter bars are 2–3 rows** of drop-downs plus feature buttons mixed in (History Usage, Models & warranty, Stock & disposal). | Asset Inventory, Server Inventory |
| 6 | **Edit forms are pop-ups** that cover the list. You lose your place, and long forms scroll inside the pop-up. | All inventories |
| 7 | **Similar things live apart:** KPIs vs Reports, Leavers vs User Inventory, QR labels vs Stocktake, OT Reports inside Reports, Racks and drawings inside the Network map. | — |
| 8 | **Settings are scattered:** MFA policy on Users & Audit, depreciation years on KPIs, collectors on System Health, countries in pop-ups. | — |
| 9 | **The Dashboard is the same for everyone.** HR, OT and Network users see asset numbers that are not their job. The "New app function update" box takes the best spot. | Dashboard |
| 10 | **Mixed visual language:** emoji icons next to line icons, coloured "pill" buttons, different card styles per page, a long two-line brand name. | Everywhere |

None of this is broken. It is the normal result of fast growth. The fix is to **organise**, not to rebuild.

---

## 2. Design principles

1. **Organise by the job, not by the database table.** Group pages the way IT staff think: *end-user IT*, *people*, *infrastructure*, *money*, *insights*, *admin*.
2. **One place for each thing.** One inbox for "needs attention", one country switch, one settings page, one detail view per record.
3. **Same page pattern everywhere.** Header → tabs → filter bar → table → detail drawer. Learn it once, use it on every page.
4. **Show only what your role needs.** The menu, the Dashboard and the buttons follow the role (IT admin, IT editor, HR, OT, Network, viewer). The server rules stay as they are.
5. **Phone first for field work.** Scan, search, fix, update a port. Desktop for analysis and imports.
6. **Quiet by default, loud when something is wrong.** Neutral greys, with colour used only for status (OK / warning / broken / stock).

---

## 3. New structure (information architecture)

### 3.1 The menu: 6 groups, about 14 entries

```
🏠  Home
     Overview                 ← role-based dashboard (was Dashboard)
     Inbox  (12)              ← ONE list of everything to fix (was 7 "Needs Attention" places)

💻  End-user IT
     Assets                   ← Asset Inventory   · tabs: All · By user · Stock & disposal · Models & warranty
     Devices                  ← Intune / Entra    · tabs: Devices · Compliance · Not in inventory
     Licenses
     Maintenance
     Stocktake                ← tabs: Counts · QR labels (was a separate page)

👥  People
     Users                    ← User Inventory    · tabs: All · Confirmations · Leavers (was a separate page)

🖧  Infrastructure
     Servers & storage        ← Server Inventory (servers, storage, VMs)
     Network                  ← network devices + map + racks + drawings + VLANs (tabs)
     OT                       ← OT devices · cameras · OT reports · OT activity (tabs)
     Monitoring               ← System Health

💰  Finance
     Budget                   ← tabs: Overview · Lines · Year over year · Finance control · Lifecycle & refresh

📊  Insights
     Reports                  ← tabs: Exports · KPIs (was a separate page) · OT reports

⚙  Admin (admins only)
     Users & access           ← logins, roles, teams, 2-step status
     Audit log                ← (was a tab of Users & Audit)
     Recycle bin
     Settings                 ← 2-step policy, countries & sites, depreciation years, collectors, catalog, notifications
```

**What each team sees** (the server rules already exist, so only the menu changes):

| Role | Menu |
|---|---|
| IT admin | everything |
| IT editor / viewer | Home, End-user IT, People, Infrastructure, Insights |
| HR | Home, People |
| OT | Home (OT view), OT, Network (OT view) |
| Network | Home (network view), Network, OT (read), Monitoring |
| Global admin | + Admin |

### 3.2 Pages merged or moved

| Today | New place | Why |
|---|---|---|
| Needs Attention, ⚠️ Missing Info, Missing AD & Asset, Server Needs Attention, OT Needs Attention, 🔔 Alerts | **Inbox** (with a filter by area) | One to-do list, with counts per area |
| Leavers | **Users → Leavers tab** | Same people, same data |
| KPIs | **Reports → KPIs tab** | Both are "look at the numbers" |
| QR labels | **Stocktake → Labels tab** | Labels are printed for the stocktake |
| OT Reports, OT Activity, OT Needs Attention | **OT** tabs (+ Inbox) | One home for the OT team |
| Network map, racks, drawings, network devices | **Network** tabs | One home for the Network team |
| History Usage, Models & warranty, Stock & disposal buttons | **Assets** tabs | Views, not buttons |
| Depreciation years, MFA policy, collectors | **Settings** | One place for configuration |
| Snipe-IT comparison | **Reports → About** (or removed) | Not daily work |

---

## 4. The app shell (the same on every page)

```
┌──────────────┬─────────────────────────────────────────────────────────────────────┐
│ ▣ Hayat IT   │  Assets  ›  All assets                 [🔍 Search  Ctrl K]  🌏 Vietnam ▾  🔔 3  (VN)│
│              ├─────────────────────────────────────────────────────────────────────┤
│ HOME         │  Assets                                     [⋯ Import/Export]  [+ Add asset]   │
│  Overview    │  712 assets · 705 active · 4 broken · 3 stock · 405 need info            │
│  Inbox   12  │  ─────────────────────────────────────────────────────────────────── │
│ END-USER IT  │  All │ By user │ Stock & disposal │ Models & warranty                 │
│  Assets  ●   │  ─────────────────────────────────────────────────────────────────── │
│  Devices     │  [🔍 Search…] [Type ▾] [Status ▾] [Location ▾] [+ Filter]  Saved views ▾ ⚙ │
│  Licenses    │  ┌───────────────────────────────────────────────┐ ┌──────────────────┐ │
│  …           │  │ table (sticky header, density, column chooser)│ │ DETAIL DRAWER    │ │
│ PEOPLE       │  │ ☐ bulk select → [Assign] [Move] [Export]      │ │ Overview│History │ │
│  Users       │  │                                               │ │ Maint. │ Files   │ │
│ …            │  └───────────────────────────────────────────────┘ └──────────────────┘ │
│ ──────────── │                                                                      │
│ ‹ collapse   │                                                                      │
└──────────────┴─────────────────────────────────────────────────────────────────────┘
```

**Top bar (always the same):**
- **Breadcrumb** (Group › Page › Tab) on the left
- **Global search** (Ctrl K) in the middle: assets, people, servers, IPs, MACs, ports, pages
- **🌏 Country / site switch**: one choice for the whole app, remembered (regional users see only theirs)
- **🔔 Notifications** (not to-dos; to-dos are in the Inbox)
- **Avatar menu** with name, role, team, 2-step login, change password, *What's new*, help, sign out

**Page header:** title, one-line summary numbers, **one primary button** (Add …), and everything
else (imports, exports, sync, bulk tools) in a **⋯ menu**.

**Filter bar:** one row. Search, the 3 most used filters, then **+ Filter** for the rest. **Saved
views** ("My site", "Broken laptops", "Warranty < 90 days") and a ⚙ column chooser.

**Detail drawer** (instead of pop-ups): opens on the right, and the list stays visible. Tabs are
Overview, History, Maintenance, Files / photos, Network (for devices), Audit. Edit happens in the
drawer, with Save pinned at the bottom. On the phone, the drawer becomes a full screen.

**Status colours** (one meaning everywhere):

| Meaning | Colour | Used for |
|---|---|---|
| OK / Active / Up | green `#16A34A` | assets, devices, health |
| Warning / Expiring / Needs info | amber `#D97706` | warranty, missing data |
| Broken / Down / Overdue | red `#DC2626` | broken, down, over budget |
| Stock / Spare / Info | blue `#2563EB` | stock, new |
| Retired / Deleted / Unknown | grey `#64748B` | retired, no data |
| OT (badge only) | orange `#EA580C` | OT devices |

---

## 5. Key screens

### 5.1 Overview (role-based dashboard)

**IT admin:**
1. **Row 1 (KPI tiles):** Assets in use · Need info · Warranty < 90 d · Open repairs · Devices not compliant · Systems down · Budget used (YTD %)
2. **Row 2:** *Inbox top 5* (left) and *Health now* (right; up/down by site)
3. **Row 3:** *Assets by country / type* (compact, from today's table), and *Budget vs actual by month* (small chart)
4. **Row 4:** *Recent activity* (who changed what), and *Expiring soon* (warranty, licenses, support contracts)
5. *What's new* moves to the avatar menu, with a small dot when there is something new

**HR:** people count, leavers this month, devices not returned, confirmations pending.
**OT:** OT devices up/down, cameras with problems, OT inbox, recent port changes.
**Network:** devices out of support, devices down, unplanned config changes (later), map drift (later).

### 5.2 Inbox (new)

One list of every "needs attention" rule the app already has, grouped by area, with a count,
**who should fix it** (team), and a **Fix** button that opens the record's drawer at the right field.

```
Inbox  12 open                         [All areas ▾] [My team ▾] [Country ▾]
┌───────────────────────────────────────────────────────────────────────┐
│ ASSETS (5)        Missing serial · 3   Missing user · 1   Not in AD · 1 │
│ PEOPLE (2)        Leaver with laptop · 1   Not confirmed > 30 d · 1   │
│ SERVERS (1)       No IP · 1                                            │
│ OT (3)            Old firmware · 2   Port unknown · 1                  │
│ HEALTH (1)        HCM core switch down 4 min                           │
└───────────────────────────────────────────────────────────────────────┘
→ click a group → list of items → [Fix] opens the drawer
```

### 5.3 Inventory list (Assets, Servers, Users, Devices, Licenses …)

Same pattern for all of them (see the shell). Specifics:
- **Assets**: tabs All · By user (today's grouping) · Stock & disposal · Models & warranty; columns Code, Model, Type, User, Department, Location, Status, Warranty.
- **Users**: tabs All · Confirmations · Leavers; the AD / Intune / Entra "last seen" shown as 3 small dots, not 3 lines.
- **Servers**: tabs Servers · Storage · Virtual; IT/OT as a filter.

### 5.4 Network (one home)

Tabs: **Map** (topology) · **Devices** (network devices list) · **Racks** · **Drawings** · **VLANs & IPs** · **Lifecycle** (from the network proposal) · **Changes** (port log).
Left: site picker. Right: device drawer (ports, neighbours, health, config later).

### 5.5 Budget

Keep today's content and put it in tabs: **Overview** (KPI tiles + monthly chart) · **Lines** (grouping by PYP / Category / GL) · **Year over year** · **Finance control** (reconciliation) · **Refresh plan** (later, from lifecycle).

### 5.6 Settings (new, admins)

Sections on the left: General (countries, sites) · Security (2-step policy, session time) · Assets (types, depreciation years, catalog) · Monitoring (collectors) · Notifications · Data (imports allowed, backups info).

### 5.7 Phone

- **Bottom bar:** Scan · Search · Inbox · Map · More
- Lists show cards (as done for Server Inventory), the drawer opens full-screen, Save is pinned
- Big touch targets (44 px), no tables wider than the screen

---

## 6. Visual style (design tokens)

| Token | Value |
|---|---|
| Font | Inter 14 px body / 13 px tables / 20 px page title / 600 weight headings |
| Sidebar | `#0F172A` (slate-900), active item `#1E293B` with a 3 px `#3B82F6` bar |
| Primary | `#2563EB` (blue-600); hover `#1D4ED8` |
| Background | `#F8FAFC`; cards `#FFFFFF` with a 1 px `#E2E8F0` border, radius 10, no heavy shadows |
| Text | `#0F172A` main · `#475569` secondary · `#94A3B8` hints |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32 |
| Icons | one set only (Lucide line icons, 16–18 px); **no emojis in menus, buttons or titles** |
| Tables | 40 px rows (compact 32 px), sticky header, zebra off, row hover `#F1F5F9` |
| Brand | "Hayat IT" with a small logo; full name only on the login page |

---

## 7. How to get there (phased, nothing breaks)

| Phase | What | Effort | Risk |
|---|---|---|---|
| **1. Shell** | Grouped menu (role-based), new top bar with avatar menu, global country switch, breadcrumb, page header with ⋯ menu, design tokens, icons instead of emojis | 1–2 weeks | Low: one place (`auth.js` + CSS) builds the menu and top bar for all pages |
| **2. Inbox + Settings** | Inbox page reading the existing attention rules (assets, people, servers, OT, health); Settings page collecting today's scattered settings | 1–2 weeks | Low: the logic already exists |
| **3. List pattern** | One shared list component: one-row filter bar, saved views, column chooser, bulk actions, **detail drawer**. Rolled out page by page (Assets → Users → Servers → Devices → Licenses → Maintenance) | 3–4 weeks | Medium: done one page at a time, old pop-up kept until the drawer is complete |
| **4. Merges** | Leavers → Users tab, KPIs → Reports tab, Labels → Stocktake tab, OT and Network homes with tabs; old addresses redirect | 1–2 weeks | Low: redirects keep bookmarks working |
| **5. Overview** | Role-based dashboards | 1 week | Low |
| **6. Phone** | Bottom bar, full-screen drawer | 1 week | Low |

Phase 1 alone fixes half of the problems above (menu, top bar, country, look).

---

## 8. Using Google Stitch

Google Stitch turns a text prompt (and, in its experimental mode, a screenshot) into screens you can
paste into Figma or export as HTML. Use it to **try layouts and looks quickly**, then bring the
picture back here. This app's code stays the source of truth.

**Tips:**
- Start with the **master prompt** to set the style. Then make one screen per prompt in the same project, so the style stays the same.
- Attach a **screenshot of today's page** with each screen prompt ("redesign this"). This works better than text alone.
- Before uploading screenshots, **blur real names, e-mails and serials**. Stitch is an external Google service.
- Ask for **desktop 1440 px** first, then "make a mobile version of this screen".
- When you like a result, send me the screenshot or the exported HTML. I will build it in the app with the real data and the same rules.

### 8.1 Master prompt (style + shell)

```
Design a professional internal IT operations web app called "Hayat IT" for a manufacturing
company with sites in Vietnam, Thailand and Malaysia. Users: IT admins, IT staff, HR, OT
(factory operation technology) and Network engineers.
Style: clean enterprise SaaS, calm and dense but readable, like Linear / Vercel / Atlassian.
Font Inter. Light theme. Background #F8FAFC, white cards with 1px #E2E8F0 border, radius 10,
no heavy shadows. Dark left sidebar #0F172A, 240px, with grouped navigation and Lucide line icons
(no emojis). Primary colour #2563EB. Status colours: green #16A34A ok, amber #D97706 warning,
red #DC2626 broken/down, blue #2563EB stock, grey #64748B retired; orange #EA580C badge for OT.
Sidebar groups: HOME (Overview, Inbox with count badge 12), END-USER IT (Assets, Devices,
Licenses, Maintenance, Stocktake), PEOPLE (Users), INFRASTRUCTURE (Servers & storage, Network,
OT, Monitoring), FINANCE (Budget), INSIGHTS (Reports), ADMIN (Users & access, Audit log,
Recycle bin, Settings). Collapse button at the bottom.
Top bar: breadcrumb left, global search "Search assets, people, IPs… Ctrl K" centre, a
country switch "🌏 All countries ▾", a notification bell with a dot, and an avatar menu
(name, role, team). Desktop 1440px wide.
```

### 8.2 Screen prompts (one at a time, same project)

**Overview (IT admin)**
```
Screen "Overview" for an IT admin. Row of 7 KPI tiles: Assets in use 705, Need info 405
(amber), Warranty < 90 days 79 (amber), Open repairs 0, Devices not compliant 12 (red),
Systems down 1 (red), Budget used 64% YTD. Below, two columns: left "Inbox – top 5" list with
area tag, item, team, Fix button; right "Health now" with sites HCM Office, HCM Factory,
Bangkok, KL each with up/down counts. Next row: "Assets by country" compact table with a small
status bar per row, and "Budget vs actual by month" bar + line chart. Last row: "Recent
activity" feed and "Expiring soon" (warranty, licenses, support contracts).
```

**Inbox**
```
Screen "Inbox": one to-do list of everything that needs fixing across the IT app. Header
"Inbox 12 open" with filters All areas / My team / Country. Grouped cards by area: Assets (5),
People (2), Servers (1), OT (3), Health (1); each group lists items with a short reason,
the responsible team chip, age, and a "Fix" button. Clicking an item opens a right-side drawer
with the record and the field to fix highlighted.
```

**Assets list + drawer**
```
Screen "Assets": page header "Assets" with summary "712 assets · 705 active · 4 broken ·
3 stock · 405 need info", a "⋯ Import / Export" menu and a primary "+ Add asset" button.
Tabs: All, By user, Stock & disposal, Models & warranty. One-row filter bar: search, Type,
Status, Location, "+ Filter", "Saved views ▾", column chooser icon. Dense table with checkbox,
Asset code, Model (with type chip), User, Department, Location, Status pill, Warranty date,
Last updated. One row selected: a 420px right drawer shows the asset with tabs Overview,
History, Maintenance, Files; fields in two columns; Save / Cancel pinned at the bottom.
Bulk action bar appears when rows are checked: Assign, Move, Change status, Export.
```

**Users (people)**
```
Screen "Users" (people directory, not logins). Tabs: All, Confirmations, Leavers.
Table: Name + e-mail, Department / cost center, Country chip, Assets count, Device
confirmation status, "Seen in" three small dots for AD / Intune / Entra (green = seen
recently), Status pill. Right drawer for a person: profile, assigned assets list, confirmation
history, leaver checklist.
```

**Network**
```
Screen "Network" for a network engineer. Left: site picker (HCM Factory, HCM Office …).
Tabs: Map, Devices, Racks, Drawings, VLANs & IPs, Lifecycle, Changes. Map tab shows a layered
topology (ISP → firewalls → core → distribution → access switches → APs) with status rings
(green up, red down) and uplink lines. Right drawer for a selected switch: model, IP, serial,
firmware, support status (red "Out of support"), a 48-port front-panel grid coloured by
state (connected, free, OT device, disabled), neighbours list, and the last 24 h uplink chart.
```

**Budget**
```
Screen "Budget" for IT finance control. Year selector 2026 and country selector. Tabs:
Overview, Lines, Year over year, Finance control, Refresh plan. Overview: tiles Approved
budget, Actual + forecast, Variance (red if over), Opex / Capex split donut; monthly
budget vs actual chart; table of top 10 lines by variance grouped by PYP code with
expandable rows.
```

**Settings**
```
Screen "Settings" (admins). Left section list: General, Security, Assets, Monitoring,
Notifications, Data. Security section shown: toggle "Two-step login required for everyone"
(on, locked note), session length, list of accounts without two-step, recovery policy.
Calm form layout with section cards and a pinned Save bar.
```

**Phone**
```
Mobile version (390px) of the app: bottom tab bar Scan, Search, Inbox, Map, More. Show the
Assets list as cards (code, model, user, status pill) and a full-screen asset detail with a
pinned Save button. Large touch targets.
```

---

## 9. Decisions for you

1. **Menu groups and names**: OK as in 3.1? (For example "Assets" instead of "Asset Inventory", "Users" for people and "Users & access" for logins.)
2. **Merges** in 3.2: OK to fold in Leavers, KPIs, QR labels, OT pages and Network pages as tabs?
3. **Detail drawer instead of pop-ups**: yes?
4. **One global country switch**: yes?
5. **Start with Phase 1 (shell)** while you try Stitch? Phase 1 doesn't depend on the final look, and the colours and spacing can be adjusted to your Stitch result afterwards.
