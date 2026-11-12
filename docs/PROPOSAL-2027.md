# Hayat Communication Tools — what to build next (2027 proposal)

_Written from an IT operations manager's point of view, 12 Nov 2026. Jira already covers tickets, requests and
approvals, so nothing here duplicates Jira: this app stays the **source of truth for things, people and their
state**. Jira is where the work about them is tracked._

---

## 1. Summary

The app has grown from an asset list into a real IT-operations tool. Today it has Asset / User / Server
Inventory, Devices (Intune + Entra), AD list, Device Check, Maintenance with spare parts, System Health,
Licenses, Budget, Reports in Excel / PDF / HTML, and a full audit log.
Its main weakness is that **most data still comes in by hand** (CSV / Excel uploads). Because of that, it is
only as fresh as the last upload, and IT spends time feeding it instead of using it.

**The 5 changes that would make the biggest difference:**

| # | Proposal | Why it matters | Effort |
|---|---|---|---|
| 1 | **Automatic Microsoft sync** (Intune, Entra, M365 licences) via Microsoft Graph, nightly | Removes the manual Intune / Entra / Azure CSV uploads; Device Check is always current | M |
| 2 | **Sign in with Microsoft (Entra ID SSO + MFA)** | No local passwords to manage; leavers lose access automatically; weak `test` / seeded passwords are gone | S–M |
| 3 | **Lifecycle & refresh plan** (age policy, Windows 10 / end-of-support, warranty auto-lookup, depreciation, cost per device) | Turns "how old is it" into "what must we replace and budget next year", linked to Budget Tracking | M |
| 4 | **QR labels + phone stocktake + e-signed handover** | Physical audit in hours instead of days; the paper custody form becomes a signed record on the asset | M |
| 5 | **New design** (dark mode, Ctrl+K search everywhere, side panel instead of pop-ups, "my work" home) | The app is now big; finding things fast is the next productivity gain | M–L, step by step |

A suggested order is in **§5 Roadmap**, and what we need from IT / Finance before starting is in **§6**.

---

## 2. Where the app stands vs. good practice

Current practice (Lansweeper, Snipe-IT, AssetSonar, ServiceNow HAM and 2026 HAM checklists) agrees on a core
set of capabilities[^ham][^lan][^cmp]. Here is how the app compares:

| Capability | Good practice | Today | Gap |
|---|---|---|---|
| One inventory with owner, location, lifecycle stage | Mandatory fields, defined states (in stock / in use / repair / retired)[^ham] | ✅ Asset Inventory, Needs Attention flags missing fields; states Active / Broken / Stock | Add **In repair, Reserved / loaner, Retired, Disposed** states with dates |
| Discovery / automatic data | Data pulled from MDM / directory, not typed[^lan] | ⚠️ Intune / Entra / AD via **manual uploads** | **Graph sync** (§3.1) and AD push from the office collector |
| Warranty & end-of-life | Vendor warranty sync and end-of-support flags[^lan][^cloud] | ⚠️ Warranty typed by hand; "Years in use" only | **Warranty auto-lookup** (Lenovo / Dell), EOL flags, refresh plan |
| Refresh & budget | Refresh tied to the budget cycle[^inv] | ⚠️ Budget Tracking exists but is not linked to assets | **Refresh forecast feeding Budget** |
| Physical audit | Cycle counts and yearly full audits with QR / barcode, plus an exception list[^qr][^qr2] | ❌ No labels, no stocktake | **QR + phone stocktake** |
| Handover / custody | Signed custody on the asset record; "My assets" for staff[^sonar][^snow] | ⚠️ Printable delivery / custody forms (paper) | **E-signature handover, staff "My devices" page** |
| Leavers | Device recovery tracked against the leaving date[^jml] | ✅ Offboarding report, Leaving Date in User Inventory | **Return checklist + recovery KPI** |
| Security posture | Disk encryption, supported OS, compliant devices[^ham2] | ⚠️ Compliance only | **BitLocker, OS / Windows 11, stale devices** from Graph |
| Disposal | Certified wipe (NIST SP 800-88 Rev. 2) with a certificate per device[^nist] | ❌ Status just changes | **Disposal record + certificate** |
| Software & licences | Usage-based licence reclaim[^m365] | ⚠️ Seats typed by hand | **M365 licence usage → reclaim list** |
| Monitoring | Alerts where the team works | ✅ System Health + 🔔 in-app alerts | **Teams alerts**, uptime % / SLA history |
| KPIs | Utilisation, ghost assets, recovery rate, MTTR, refresh compliance, TCO[^kpi] | ⚠️ Counts only | **KPI scorecard** |
| Sign-in | SSO + MFA from the company identity provider[^sso] | ❌ Local username / password | **Entra ID SSO** |

---

## 3. Proposals in detail

### 3.1 Automate the data: stop uploading files  ⭐ highest value

| What | How | Notes |
|---|---|---|
| **Intune devices**, nightly (+ "Sync now" button) | Microsoft Graph `GET /deviceManagement/managedDevices` with an app registration (application permission **DeviceManagementManagedDevices.Read.All**, admin consent)[^graph] | Also gives `isEncrypted`, OS version, last sync, compliance, serial, model → feeds Device Check and the security views (§3.5)[^enc]. The current Device Check rules stay; only the source changes. |
| **Entra devices + users** | Graph `/devices` (Device.Read.All), `/users` (User.Read.All) with `signInActivity` | Replaces the Azure users CSV and the Entra export. |
| **On-prem AD list** | The **System Health collector** (already inside the office) runs a small PowerShell `Get-ADUser` export daily and pushes it with its key | Same matching as today's AD upload (`lib/ad-import.js`); IT keeps the preview for doubles. |
| **M365 licence usage** | Graph `reportRoot/getOffice365ActiveUserDetail` (Reports.Read.All)[^m365] | See §3.6. |
| **Warranty** | Lenovo warranty API (client key) and Dell TechDirect warranty API (up to 100 service tags per call)[^warr] | Fills Warranty Expiry automatically every month and flags devices out of warranty. |

All sync jobs are **read-only** and write a run log (new / changed / errors). A sync **never deletes**: it flags
instead, using the same rule as today ("the upload never changes Asset / User Inventory without a preview").

### 3.2 Lifecycle, refresh plan and money

- **Lifecycle states with dates:** Ordered → In stock → Assigned → In repair → Loaner → Retired → Disposed.
  Each change is recorded, so we can answer "how long was it in repair" and "how long has it been idle in stock".
- **Refresh policy per type** (e.g. laptop 4 years, desktop 5, phone 3; IT decides the numbers):
  - a **Refresh plan** page with the devices due this year, next year and the year after, per country
  - the forecast cost is sent to **Budget Tracking** as proposed lines, because refresh should follow the budget cycle[^inv].
- **Windows 10 / end-of-support watch:**
  - Windows 10 ended support in Oct 2025.
  - Commercial ESU costs about **US$61 per device in Year 1 and $122 in Year 2** (Oct 2026 – Oct 2027), plus $244 in Year 3. Joining late costs the earlier years too[^esu].
  - The app should list every Windows 10 device from Intune with its age and model, and say whether it is **"replace" or "pay ESU"**. That alone justifies the Graph sync.
- **Depreciation & book value:**
  - straight-line from purchase date and cost, per country rule
  - for Vietnam, Circular 45/2013/TT-BTC Annex 1 sets the frame for computers (to be confirmed with Finance)[^vn45]
  - shows **book value** on each asset and **fully depreciated but still in use** as a refresh candidate.
- **Cost per device (TCO):** purchase + repairs (from the Maintenance log) + spare parts used + licences, per model. This answers "which model costs us the most to keep", and is a common ITAM KPI[^kpi].

### 3.3 Physical control: QR labels, stocktake, handover

- **QR label per asset:**
  - the code holds only the asset's internal link, never sensitive data (labels can be photographed)[^qr2]
  - a **Print labels** button prints sheets for a label printer or A4 label paper; durable polyester labels for laptops[^tag].
- **Phone stocktake ("Audit campaign"):**
  - IT starts a campaign (country / site), then walks around scanning with the phone camera. No extra scanner is needed, and it also works offline as an installable web app (PWA).
  - Each scan confirms identity, holder, location and status[^qr2].
  - The result lists **found**, **found elsewhere** (location fixed with one click), **missing** (possible ghost assets) and **not in system** (add it).
  - Each exception gets a reason code. The campaign report goes to Reports.
  - Suggested rhythm: **quarterly per site + yearly full count**, more often for laptops[^ham][^qr].
- **E-signed handover & return:**
  - when a device is assigned, the user signs on the phone or tablet (or accepts with their Microsoft login)
  - the signed PDF, today's custody form, is **stored on the asset record**
  - returns are signed the same way, with the condition noted (and the parts check if broken).
  - This matches what AssetSonar and ServiceNow do for custody[^sonar][^snow].
- **Loaner pool:** spare laptops are lent with a due date, overdue loans show in Needs Attention, and check-in / check-out history is kept.

### 3.4 People: joiners, movers, leavers (without doing Jira's job)

The Jira ticket stays the work order. This app keeps **the state**:

- **Leaver return checklist:**
  - from HR's **Leaving Date**, the app lists the person's assets, Intune devices and licences
  - each item is ticked returned / wiped / licence removed
  - the person is "cleared" only when everything is back.
  - **Recovery rate** (devices back within 7 days of leaving) is tracked as a KPI, because a low recovery rate is the main source of ghost assets[^kpi].
- **Movers:** when AD / Entra shows a department or country change, the app flags their assets for a cost-centre or location update. This is the same idea as Entra lifecycle-workflow "mover" triggers[^jml].
- **Joiners:** a new AD account without any assigned laptop after X days is shown in Needs Attention.

### 3.5 Security and compliance views (from the Graph sync)

- **Encryption:** devices where BitLocker is off (`isEncrypted = false`)[^enc].
- **OS:** Windows 10 devices, old builds, phones on old OS versions.
- **Stale devices:** no Intune check-in for 30 / 90 days, which means lost, stolen or unused.
- **Non-compliant devices by country**, already in Device Check, as a trend over time.
- **Disposal with proof:**
  - a **Dispose** step records the wipe method (Clear / Purge / Destroy, NIST SP 800-88 Rev. 2), who did it, when, the vendor and the **certificate PDF**[^nist]
  - the asset then moves to *Disposed*, is never deleted, and its history is kept.
- **Access:** sign-in with **Microsoft Entra ID (OIDC, MSAL Node)**[^sso]:
  - MFA comes from Microsoft
  - leavers lose access when their account is disabled
  - app roles (IT admin / HR / viewer) can be mapped from Entra groups
  - local passwords stay only as an emergency break-glass account.

### 3.6 Software & licences

- **M365 licence reclaim list:** users with a paid licence but no Exchange / Teams / OneDrive activity for 60+ days, and leavers still holding licences. This is the standard way to cut licence cost[^m365].
- **Licence page fed by Graph:** seats bought vs assigned vs used, with renewals in the calendar.
- _Later:_ software inventory per device from Intune (detected apps), to find unapproved software.

### 3.7 Monitoring & alerts (System Health, next level)

- **Teams alerts:**
  - Office 365 connectors (old incoming webhooks) were switched off in **May 2026**, so the new way is a **Teams Workflows webhook** (Power Automate "When a Teams webhook request is received")[^teams]
  - the app posts DOWN / back UP, collector offline and daily digests to the IT channel.
- **Weekly email digest** to IT managers: what changed, what is overdue, KPIs.
- **Uptime history:** uptime % per device and internet line per month (SLA with the ISP), a small graph per check, and maintenance windows (planned downtime is not counted).
- More checks:
  - UPS battery (SNMP)
  - printer toner (SNMP)
  - certificate expiry of internal websites
  - disk space on servers.

### 3.8 KPI scorecard (one page for management)

| KPI | Definition | Target (typical) |
|---|---|---|
| Utilisation | assets in use ÷ all assets | 85–90 %[^kpi] |
| Ghost assets | in the register but not found in the last audit | → 0 |
| Recovery rate | leaver devices back within 7 days | > 95 % |
| Data quality | assets with all mandatory fields | > 98 % |
| Refresh compliance | devices younger than the refresh age | > 90 % |
| Warranty coverage | assets in use under warranty | by policy |
| MTTR | average days from repair opened → done (Maintenance log)[^kpi] | trend ↓ |
| Security | encrypted %, compliant %, Windows 10 left | 100 % / 100 % / 0 |
| Cost per device | TCO per model per year | trend |

Each KPI is split **per country** (same style as the reports) and shown as a monthly trend, so it's visible
whether things improve.

---

## 4. New design: modern, faster to use

The app is now big (14 modules). The next productivity gain is **finding and acting faster**, not more pages.
Design direction based on 2026 enterprise dashboard practice[^ui]:

1. **Design system:** one set of colours, spacing and components (tokens), so every page looks and behaves
   the same. Colour is used for **state only**: green ok, amber warning, red problem; one brand blue for actions.
2. **Dark mode** (deep grey, not black), with a switch and the system setting followed. Exports and prints stay light[^ui].
3. **Ctrl + K command palette:**
   - one search box for everything: asset code, serial, PC name, person, email, page names, and actions ("add asset", "upload AD list")
   - results are grouped (Assets · People · Devices · Pages)
   - this replaces hunting through menus.
4. **"My work" home (bento grid):**
   - instead of only statistics, the home shows tiles of what needs **me** today: devices to check, leavers with devices still out, warranty ending, collectors offline, stocktake in progress
   - each tile opens the filtered list.
5. **Side panel instead of pop-ups:** clicking an asset opens a panel on the right (details, history, devices, parts, handover PDFs) while the list stays visible. Inline edit for simple fields.
6. **Saved views & sticky filters:** e.g. "VN Factory laptops broken". Filters are kept in the URL, so a view can be shared with a colleague.
7. **Keyboard shortcuts** (`/` search, `j/k` move, `e` edit) for power users; full keyboard and screen-reader accessibility.
8. **Phone-first screens for field work:** scan, stocktake, handover signature, parts check. Installable as an app (PWA).
9. **Charts in one style** everywhere: the country-split tiles and mix bars from the Dashboard and reports.

A clickable mockup of the new home, the Ctrl+K search and the side panel is in
**[docs/proposal/mockup.html](proposal/mockup.html)** (open it in a browser). Screenshots:
`docs/proposal/mockup-dark.png`, `docs/proposal/mockup-light.png`.

The new design should roll out **page by page** (Dashboard → Asset Inventory → Devices …) behind a
"Try the new design" switch, so nobody loses their way of working on day one.

---

## 5. Roadmap (suggested)

| Phase | When | Deliver | Why first |
|---|---|---|---|
| **1. Quick wins** | Q1 2027 (6–8 weeks) | Entra SSO + MFA · Graph sync (Intune / Entra) replacing uploads · Teams alerts · Windows 10 / BitLocker / stale views · KPI scorecard v1 | Biggest time saving and security gain; no new hardware |
| **2. Physical control** | Q2 2027 | QR labels + phone stocktake (PWA) · e-signed handover / return · loaner pool · lifecycle states with dates · leaver return checklist | Needs label printer + labels; first full audit by end of Q2 |
| **3. Money & lifecycle** | Q3 2027 | Warranty auto-lookup · refresh plan → Budget · depreciation / book value · TCO per model · disposal with certificates | Ready for the **2028 budget** cycle |
| **4. Optimise** | Q4 2027 | M365 licence reclaim · software inventory · uptime / SLA history · weekly digest · KPI trends | Builds on data collected in 1–3 |
| **Design** | all year | Design system + dark mode + Ctrl+K first (Q1), then home, side panel and phone screens page by page | Visible improvement every month, no big-bang switch |

---

## 6. What we need before starting

| Item | Who | For |
|---|---|---|
| **Entra app registration** (Graph application permissions: DeviceManagementManagedDevices.Read.All, Device.Read.All, User.Read.All, AuditLog.Read.All, Reports.Read.All; admin consent) + a second one for sign-in (OIDC, redirect `https://asset.hayat.io.vn/auth/callback`) | Global admin of the tenant | §3.1, §3.5 |
| Intune licence on the tenant (already in place, as Intune is used) | — | Graph Intune API[^graph] |
| **Teams IT channel + Workflows webhook URL** | IT | §3.7 |
| **Lenovo warranty API key**, **Dell TechDirect** account | IT (vendor registration; Dell approval can take a few days)[^warr] | §3.1 |
| **Refresh policy** (years per device type) and **ESU decision rule** | IT manager | §3.2 |
| **Depreciation rule per country** (VN Circular 45 Annex 1 period for computers, TH, MY) | Finance | §3.2 |
| **Label printer + polyester labels** (≈ 1 per asset + 10 % spare per year)[^tag] | IT purchase | §3.3 |
| **Disposal vendor** that issues per-device certificates | IT / Procurement | §3.5 |

Secrets (Graph client secret, API keys, webhook URL) go into Render environment variables only, never into
the repository.

---

## 7. Risks and how to handle them

- **Wrong data from automation overwriting good data:** syncs never overwrite hand-edited or locked fields, never delete, and always keep a run log and an undo. These are the same rules that protect today's Device Check.
- **Graph permissions are powerful:** read-only permissions only. The secret is kept in Render, rotated yearly, and every sync run is in the Audit Log.
- **Free Render instance sleeps:** nightly jobs need the instance awake. Use a paid instance (or a scheduled ping) before Phase 1.
- **Too much change at once for users:** the new design is opt-in page by page, with short "what's new" notes in the existing 🚀 box.

---

## Sources

[^ham]: Lansweeper — Hardware Asset Management Best Practices for IT Teams in 2026: https://www.lansweeper.com/blog/insights/hardware-asset-management-best-practices-for-it-teams-in-2026/ · Greenwave — What is HAM: https://greenwaveelectronics.com/blog/hardware-asset-management · Asset Infinity — Asset Lifecycle Management Checklist 2026: https://www.assetinfinity.com/blog/asset-lifecycle-management-checklist-2026
[^ham2]: 10 hardware asset management best practices for IT teams in 2026: https://assetmanagementforjira.com/blog/10-hardware-asset-management-best-practices-for-it-teams
[^lan]: Lansweeper 2026 best practices (EOL / EOS flagging, consolidated inventory): https://www.lansweeper.com/blog/insights/hardware-asset-management-best-practices-for-it-teams-in-2026/
[^cloud]: Cloudaware — IT hardware asset management: https://cloudaware.com/blog/it-hardware-asset-management/
[^inv]: InvGate — Hardware lifecycle (refresh tied to budget cycles): https://blog.invgate.com/hardware-lifecycle
[^cmp]: Virima — asset management tools compared (ServiceNow, Lansweeper, Snipe-IT, Freshservice): https://virima.com/blog/asset-management-tools · InvGate — Lansweeper vs Snipe-IT: https://blog.invgate.com/lansweeper-vs-snipe-it
[^qr]: InvGate — Physical inventory of IT assets with QR / barcodes: https://blog.invgate.com/physical-inventory-it-assets · QR code inventory management: https://blog.invgate.com/qr-code-inventory-management
[^qr2]: Asset tagging best practices (lifecycle-linked scans, exception sweep, codes as lookup keys only): https://hardwareassetmanagement-com.pages.dev/best-practices/tagging · Cleverence — IT inventory audit: https://www.cleverence.com/articles/for-business/it-inventory-audit-7382/
[^tag]: Prey — IT asset tagging strategies: https://preyproject.com/blog/top-it-asset-tagging-strategies-for-efficient-asset-management · Camcode — IT asset tracking best practices: https://camcode.com/blog/best-practices-for-it-asset-tracking/
[^sonar]: AssetSonar — IT asset custody & e-signature: https://ezo.io/assetsonar/features/it-asset-custody/
[^snow]: ServiceNow — Confirm the assigned assets on the Employee Center portal: https://www.servicenow.com/docs/r/cCCsnXLy_7vD00AGlASipQ/Nd4vYmslSFkELlMtFH5hbw · JumpCloud — employees view assigned assets: https://jumpcloud.com/?p=157719
[^jml]: Microsoft Learn — Entra lifecycle workflow tasks (joiner / mover / leaver): https://learn.microsoft.com/en-us/entra/id-governance/lifecycle-workflow-tasks · Hexnode — HR-to-IT provisioning workflow: https://www.hexnode.com/mobile-device-management/help/hr-to-it-provisioning-workflow-guide/
[^graph]: Microsoft Learn — List managedDevices: https://learn.microsoft.com/en-us/graph/api/intune-devices-manageddevice-list · Intune Graph API access: https://learn.microsoft.com/en-us/intune/developer/configure-graph-api-access · Permission reference: https://graphpermissions.merill.net/permission/DeviceManagementManagedDevices.Read.All
[^enc]: Microsoft Learn — managedDevice resource (isEncrypted): https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice · managedDeviceEncryptionState: https://learn.microsoft.com/en-us/graph/api/resources/intune-deviceconfig-manageddeviceencryptionstate
[^m365]: Microsoft Learn — getOffice365ActiveUserDetail: https://learn.microsoft.com/en-us/graph/api/reportroot-getoffice365activeuserdetail?view=graph-rest-beta · Office 365 IT Pros — composite user activity report: https://office365itpros.com/2022/08/08/microsoft-365-user-activity-2022/
[^warr]: InvGate — Warranty check across vendors: https://blog.invgate.com/warranty-check · Lenovo warranty lookup: https://support.lenovo.com/lc/en/warrantylookup · Patch My PC — Dell Warranty API: https://docs.patchmypc.com/patch-my-pc-insights/insights-external-services-dell-warranty-api
[^esu]: eWeek — Windows 10 ESU cheat sheet: https://www.eweek.com/news/windows-10-esu-cheat-sheet/ · TechnologyMatch — Windows 10 ESU year 2 cost: https://technologymatch.com/blog/windows-10-esu-year-2-cost (prices to confirm with Microsoft / reseller)
[^vn45]: Circular 45/2013/TT-BTC (management, use and depreciation of fixed assets): https://english.luatvietnam.vn/circular-no-45-2013-tt-btc-dated-april-25-2013-of-the-ministry-of-finance-guiding-the-management-use-and-depreciation-of-fixed-assets-78162-Doc1.html · amended by Circular 147/2016 and 28/2017 (Annex 1 period for computers to be confirmed with Finance)
[^nist]: NIST SP 800-88 (media sanitization): https://csrc.nist.gov/pubs/sp/800/88/r1/final · Rev. 2 programme changes: https://hobi.com/?p=29455 · Virima — secure IT asset disposal: https://virima.com/blog/secure-it-asset-disposal-nist-800-88
[^sso]: Microsoft Learn — Sign in users in a Node.js web app with MSAL Node: https://learn.microsoft.com/entra/identity-platform/quickstart-web-app-nodejs-msal-sign-in · Tutorial: https://learn.microsoft.com/en-my/entra/identity-platform/tutorial-web-app-node-sign-in-sign-out
[^teams]: Microsoft — Retirement of Office 365 connectors within Teams: https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/ · Message Center MC1181996: https://mc.merill.net/message/MC1181996
[^kpi]: Signifi — ITAM metrics & KPI dashboard: https://www.signifi.com/blog/what-is-it-asset-management-guide/ · InvGate — 5 essential ITAM KPIs: https://blog.invgate.com/5-essential-itam-kpis-you-should-be-tracking · Allwhere — ITAM metrics: https://www.allwhere.co/post/it-asset-management-metrics · ServiceNow asset analytics (MTTR, TCO thresholds): https://www.servicenow.com/docs/r/it-asset-management/hardware-asset-management/asset-analytics-view.html
[^ui]: AdminLTE — Admin dashboard design 2026: https://adminlte.io/blog/admin-dashboard-design/ · UXMagic — B2B SaaS UI trends (command palette, progressive disclosure): https://uxmagic.ai/blog/b2b-saas-ui-design-trends · Fuselab — UI/UX trends 2026: https://fuselabcreative.com/ui-ux-design-trends-2026-modern-ui-trends-ux-trends-guide/
