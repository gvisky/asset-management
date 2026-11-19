# IT Budget Control — research and proposal

**Scope:** IT in Hayat Vietnam, Thailand and Malaysia (HK_VIETNAM / HK_THAILAND / HK_MALAYSIA)
**Prepared:** November 2026 · for Regional IT and Management
**Basis:** good practice (COBIT 2019, ITIL 4, TBM, Gartner) + our own 2025–2027 data in the Budget Tracking page
(Turkey B-F reports, approved 2027 budgets, Finance IT Opex control files).

> Figures are USD unless stated. "A+F" = actual + forecast. 2026 actuals are Jan–Aug from the Turkey report,
> Jan–May from the local Finance control.

---

## 1. Executive summary

IT spending is controlled today by **two teams looking at the same SAP postings through different maps**
(Turkey: Masraf Çeşidi + PYP; local Finance: local GL hierarchy + cost center), with **no single owner of the
mapping**, a **forecast that is not updated**, and **explanations collected once or twice a year**.
The result is visible in our own numbers:

| What we see (2026, all 3 countries) | Number | Why it matters |
|---|---|---|
| Budget / Actual + Forecast | **$376.5K / $308.4K (82%)** | looks healthy on the surface |
| Spend still "forecast" for Sep–Dec | **$172.6K = 56% of the year** | budget is back-loaded; actual Jan–Aug is only $135.7K |
| Actual spend Jan–Aug that landed on a **budget line** | **$0 of $135.7K (0%)** | *every* actual is on an unmatched "FİİLİ_EK" row (48 rows); budget lines hold only the Sep–Dec forecast |
| Budget lines with **zero spend** | **20 lines, $113.6K** | same money as above: budget on old ECC GL/PYP (e.g. VN salaries `77003…`), actuals on new S4 GL/PYP (`77001…`) |
| Report comments "wrong booking / not sure / check" | **49 of 53** | nobody can explain the variance at line level |
| Finance vs Turkey, Vietnam Jan–May | **$33.4K vs $64.8K** | personnel $27.6K only in Turkey's view, $2.6K double count, $1.2K other PYP |
| 2025 still shown as "forecast" Sep–Dec | **$172K** (in Nov 2026) | the year was never closed in the report |
| 2027 approved budget | **$468.9K (+52% vs 2026 A+F)**, CAPEX 59% | one project (VN OT network renovation, $218.5K) = 47% of the year |

**Proposal in one line:** run IT budget as a *monthly management process* with one owner per line,
one mapping between the Turkey and local views, a pre-spend check, a rolling forecast and a small KPI scorecard —
supported by the Budget Tracking page we already built.

**Seven proposals** (details in section 4):

1. **Governance & approval limits** — a budget owner for every line, a regional IT controller, clear spend limits.
2. **One mapping ("crosswalk")** — S4 GL ↔ ECC GL ↔ local GL ↔ PYP old/new ↔ budget line, owned by IT + Finance.
3. **Commit before you spend** — PR/PO and contracts checked against *available* budget (budget − actual − commitments).
4. **Monthly close & variance rule** — fixed calendar (D+10), explanation for every line over **±$1,000** (HQ's own rule) or ±10%.
5. **Rolling forecast** — re-forecast monthly, CAPEX phased to the real delivery month, release unused budget by mid-year.
6. **Cost levers** — telecom/internet contracts, licences, maintenance vs replacement, device refresh by age.
7. **KPI scorecard** — 10 measures reviewed monthly by IT and quarterly by management.

**Ask:** approve the governance model and approval limits (section 4.1), nominate a Finance partner per country,
and agree the 30-day action list (section 7) so 2027 starts clean on 1 January.

---

## 2. What good practice says (research)

| Framework / source | Key idea | What we take from it |
|---|---|---|
| **COBIT 2019 — APO06 Managed Budget and Costs** (ISACA)[^cobit][^apo0603][^apo0605] | Manage IT finance & accounting, prioritise resource allocation, create and maintain budgets, model costs, manage costs; monitor performance regularly to find variances and adjust in time | A formal, owned process — not a yearly file |
| **ITIL 4 — Service Financial Management** (AXELOS)[^itil][^itil2] | Reliable financial information for decisions at many levels; **budgeting is continuous**, not one-off; accounting tracks actual cost of services; charging optional | Monthly re-forecast; costs visible per service (internet, devices, maintenance…) |
| **TBM — Technology Business Management** (TBM Council)[^tbm][^tbmguide] | Common taxonomy: **cost pools** (what was bought: labour, hardware, software, services — ties to the GL and separates Opex/Capex) → **towers** (network, compute, end-user…) → services; mapping is a separate, owned step | Exactly our problem: two GL views need **one owned mapping**. Start simple: aggregate pools and towers first |
| **Gartner — Run / Grow / Transform**[^rgt][^rgt2] | Tag spend by purpose; protect foundations (e.g. security) while funding change | Tag each budget line Run / Grow / Transform to show how much is "keep the lights on" |
| **Rolling forecasts** (Gartner, TechTarget)[^roll][^tt] | Keep the budget as the commitment, but re-forecast 12–18 months on a rolling basis to move money faster | Quarterly re-forecast + monthly update of the current quarter |
| **Variance drivers** (Apptio)[^apptio] | Explain variance by business demand and project status, not only actual vs budget | Comments must say *why* (timing, price, scope, wrong booking) |
| **SaaS / licence waste** (Zylo 2025, Certero, Flexera)[^zylo][^certero] | Around **46–50%** of SaaS licences go unused in a typical organisation | Licence reclaim every quarter (our M365 reclaim report already exists) |
| **Benchmark** (Avasant/Computer Economics via secondary source)[^bench] | Manufacturers spend roughly **~3% of revenue** on IT (75th percentile 3.2%) | Compute our IT spend as % of revenue and per employee once a year |

*Note: some sources are summaries of paywalled research; treat benchmark numbers as indicative.*

---

## 3. Where we stand — findings from our data

### 3.1 Two views of the same SAP postings
Line by line, Finance and Turkey **agree exactly** for stationery, travel, IT maintenance (office + factory),
subscriptions, photocopy and hardware. Differences come only from **mapping and scope**:

| Gap (Vietnam, Jan–May 2026) | Amount | Cause | Fix |
|---|---|---|---|
| IT salaries & personnel GLs `77001…` | $27.6K | in Turkey's IT view, not in Finance's IT control (HR controls personnel) | agree scope: personnel either *in* IT budget (with budget lines on the S4 GLs) or *out* of both |
| Factory internet `7300803000`, May | $2.6K | one NTT invoice (67.5M VND) counted twice in Turkey view | correct booking / accrual reversal |
| Office telecom `7700803000` | $1.2K | "Phone land lines" postings on a different PYP | map PYP `T010-99999-BTF-30-1` to the IT budget line |

### 3.2 Actuals never meet the budget lines — a mapping problem, not overspend
- In the Turkey B-F report for 2026, **100% of actual spend (Jan–Aug, $135.7K) is on "FİİLİ_EK" rows** and **0% on a budget
  line** (VN $109.2K, TH $17.1K, MY $9.5K). Budget lines carry only the Sep–Dec forecast. The headline "82% used" therefore
  adds actuals on unmatched rows to forecasts on budget lines — **line-level budget vs actual is not possible today**.
- Budgets sit on **old ECC GLs and PYPs** (`7700301100`, `BT-99999-VN40-…`), actuals arrive on **new S4 GLs and
  PYPs** (`7700101300`, `VN10-99999-BTF-30-…` / `T010-99999-BTF-30-…`).
- So the same cost shows twice: as "unused budget" ($113.6K) **and** "unbudgeted actual" ($135.7K).
- Example: VN salaries — budget $44.4K on `77003xxxxx`, actual $41.9K on `77001xxxxx` (same names: *ÜCRET-NORMAL MESAİ*, *SSK PRİMİ* …).

### 3.3 Forecast quality
- 2026: **56%** of the year's spend is forecast for Sep–Dec (CAPEX servers/storage $113K in November alone).
- 2025: Sep–Dec still shown as forecast in November 2026 — the year-end was never closed in the report.
- Malaysia 2026: 31% used; CAPEX $14K and data internet $14.4K with no spend recorded.

### 3.4 2027 concentration risk
- $468.9K, +52% vs 2026 A+F; CAPEX $275.5K (59%).
- **VN OT network renovation $218.5K = 47%** of the whole IT budget — needs project-level control (stage gates, milestones, contingency).

---

## 4. Proposal — IT Budget Control Framework

### 4.1 Governance, roles and approval limits
| Role | Who (proposal) | Responsibilities |
|---|---|---|
| **Budget owner** (per line) | Country IT lead (VN, TH, MY) | Plans the line, raises PR/PO, explains variance monthly, updates forecast |
| **Regional IT controller** | Regional IT manager | Consolidates, checks coding (GL + PYP), runs monthly review, owns the crosswalk with Finance |
| **Finance partner** | One per country (local Finance) | Posts actuals & accruals, provides the monthly control file by D+5, agrees mapping |
| **HQ IT / Finance** | Turkey | Approves budget, receives B-F report, owns corporate GL/PYP structure |
| **Management** | Regional management | Approves limits, exceptions and reallocations; quarterly review |

**Spend approval limits (proposal — calibrate with Finance's existing delegation of authority):**

| Request | Within budget line | Not in budget / over line |
|---|---|---|
| < $1,000 | Country IT lead | Regional IT manager |
| $1,000 – $10,000 | Regional IT manager | Regional IT manager + country GM / Finance |
| > $10,000 or any new CAPEX | Regional IT manager + Finance | Regional management + HQ IT |
| Reallocation between lines | Same country, same Opex/Capex: Regional IT manager | Across countries or Opex↔Capex: Regional management + HQ |

### 4.2 One mapping — the crosswalk
A single table, owned by the Regional IT controller and agreed with Finance, that links for every budget line:
**S4 GL ↔ ECC GL ↔ local GL / New Account Hierarchy ↔ PYP new (S4) ↔ PYP old (ECC) ↔ cost center ↔ budget line**.
- Every PR/PO must carry the **budget line + PYP + GL** before approval.
- Finance checks coding before posting; wrong coding is corrected in the same month.
- Target: **"unbudgeted" spend < 5%** of actual within one quarter (today 100% of 2026 actuals are on unmatched rows).

### 4.3 Commit before you spend
- **Available budget = Budget − Actual − Open commitments (PO + contracts)**, checked at PR approval.
- **Contract register** for recurring costs (internet & leased lines, maintenance, licences, printing):
  owner, value, start/end, notice period, **renewal alert 90 days before**.
- Three-way match (PO – goods receipt – invoice) for hardware and services.

### 4.4 Monthly close and variance rule
| Day | Step | Owner |
|---|---|---|
| D+5 | Finance IT control file + SAP actuals ready | Finance partner |
| D+7 | Upload to Budget Tracking; Finance ↔ Turkey reconciliation reviewed | Regional IT controller |
| D+10 | Comment every line with variance **> ±$1,000 or ±10%** (HQ already asks for ±1,000 USD); reason code: *timing / price / scope / wrong booking / new need* | Budget owners |
| D+12 | Update forecast for remaining months | Budget owners |
| D+15 | 30-minute monthly review (IT); quarterly with management | Regional IT manager |

Wrong bookings found in the review are **corrected in the next close**, not just commented.

### 4.5 Rolling forecast
- Re-forecast **monthly for the current quarter, quarterly for the rest of the year + next year** (rolling 12 months).
- Phase CAPEX to the **realistic delivery month** (quote → PO → delivery → invoice), not the end of the year.
- **Mid-year release rule:** lines with no spend and no commitment by June are released or reallocated
  (avoids year-end rush and "use it or lose it").
- Close each year properly: actuals for all 12 months by end of January.

### 4.6 Cost levers (where the money is)
| Lever | Evidence | Action |
|---|---|---|
| **Internet & telecom** — largest Opex | 2027: VN phone/land lines $66K, TH data internet $21K, MY $14.4K | Re-tender / consolidate leased lines, review bandwidth vs use, one contract register |
| **Licences / SaaS** | Industry: ~46–50% of licences unused[^zylo] | Quarterly reclaim (M365 reclaim report exists), remove duplicates |
| **Maintenance vs replace** | VxRail end-of-support, storage replacement in 2026 | Decide by age + support cost; use Asset Inventory age data |
| **Devices** | Notebooks/PCs, phones each year | Standard catalogue, refresh by age policy (e.g. notebooks 4–5 years), reuse stock first |
| **Big projects** | OT renovation $218.5K | Stage gates (design → order → install → acceptance), milestone payments, 5–10% contingency, own PYP |

### 4.7 KPI scorecard (monthly, one page)
| KPI | Definition | Target (proposal) |
|---|---|---|
| Budget accuracy | Year-end A+F vs budget | within ±5% |
| Forecast accuracy | Month-ahead forecast vs actual | within ±10% |
| Unbudgeted spend | Actual with no budget line / total actual | < 5% |
| Variance explained | Lines over threshold with reason code | 100% by D+10 |
| Close on time | Upload + reconciliation done | by D+7 |
| Finance ↔ Turkey gap | Difference after agreed scope | < 2% |
| CAPEX on plan | CAPEX spent in planned quarter | ≥ 80% |
| Contract renewals | Renewals with ≥ 90 days notice | 100% |
| Licence utilisation | Assigned & active / purchased | ≥ 90% |
| Run / Grow / Transform | Share of budget by purpose | tracked; Run ≤ 70% (indicative[^rgt2]) |
| Unit cost | IT cost per employee and per device | tracked yearly, trend down |

---

## 5. Tooling — what Budget Tracking already does, and what to add

**Already live:** multi-year budget (2024–2027), approved budgets + Turkey B-F reports + local Finance control,
Opex/Capex split, per month / YTD / quarter, PYP old & new, grouping by PYP / Category / GL, year-over-year with item
drill-down, Finance ↔ Turkey reconciliation by S4 GL with postings, comments in Turkish + English, IT notes, export.

**Proposed additions (priority order):**
| # | Feature | Supports | Size |
|---|---|---|---|
| 1 | **Crosswalk table** (GL / PYP old ↔ new ↔ local) + automatic pairing of "unbudgeted actual" with the matching "unused budget" line | 4.2 | M |
| 2 | **Variance workflow**: lines over ±$1,000 / ±10% flagged each month, reason code + comment required, shown on *Needs Attention* | 4.4 | S |
| 3 | **Commitments & contract register** (PO, contract, renewal date) → *available budget* per line; renewal alerts | 4.3 | M |
| 4 | **Forecast in the app**: edit remaining months per line, monthly snapshot (versioned) → forecast accuracy KPI | 4.5 | M |
| 5 | **Management scorecard / monthly pack** (PDF + Excel) with the KPIs in 4.7 | 4.7 | S |
| 6 | **Run / Grow / Transform + TBM tower tag** per line | 4.7 | S |
| 7 | **Refresh plan from Asset Inventory** → proposed lines for the 2028 budget | 4.6 | M |
| 8 | Automatic intake of Finance and Turkey files (shared mailbox / SharePoint) | 4.4 | M |

---

## 6. Roadmap

| Phase | When | Deliverables |
|---|---|---|
| **1. Clean start** | Dec 2026 – Jan 2027 | Roles & limits approved · crosswalk v1 · 2025 and 2026 closed with full actuals · 2027 lines on S4 GL + new PYP · thresholds agreed |
| **2. Control** | Q1 2027 | Monthly close calendar running · variance workflow · contract register · first scorecard (Jan close) |
| **3. Forecast & optimise** | Q2 2027 | In-app rolling forecast · telecom re-tender · licence reclaim cycle · OT project stage gates |
| **4. Plan 2028** | Q3 2027 | Bottom-up 2028 budget: driver-based for Run (users, devices, sites), zero-based for discretionary, refresh plan from assets |

---

## 7. First 30 days — action list

1. Agree with Finance (VN, TH, MY) and HQ **whether IT personnel cost is inside the IT budget** — and map it the same way in both views.
2. Build **crosswalk v1** from the 2026 data: budget lines on old GL/PYP ↔ actuals on new S4 GL/PYP (salaries, telecom, printing, small hardware).
3. Correct the **May factory internet double count** ($2.6K) and the **land-line PYP** in SAP.
4. Re-issue the **2027 approved budget lines on the S4 GL and new PYP** so January 2027 actuals land on a budget line.
5. Close **2025** and **2026** actuals in the B-F report (no "forecast" months for past periods).
6. Set up the **OT network renovation** as a project: PYP, milestones, payment plan, contingency.
7. Start the **contract register** with the top 10 recurring contracts (internet, leased lines, maintenance, printing, licences).
8. Run the **first monthly review** on the November 2026 close using the Budget Tracking page.

---

## 8. Decisions needed from management
- Approve roles and the spend approval limits (4.1).
- Nominate one Finance partner per country and confirm the D+5 file delivery.
- Decide the scope of IT personnel cost (in or out of the IT budget).
- Approve the mid-year release rule (4.5) and the KPI targets (4.7).
- Approve phase 1–2 of the tooling additions (section 5).

## 9. Risks
| Risk | Mitigation |
|---|---|
| Extra workload for small country IT teams | Process runs in the Budget Tracking page; comments only above threshold; 30-min monthly review |
| Finance and HQ use different structures that we cannot change | The crosswalk absorbs the difference; we don't change SAP, we map it |
| Exchange-rate movement (VND, THB, MYR vs USD) | Report local currency next to USD; explain FX separately from spend variance |
| Single large project dominates 2027 | Stage gates, milestone payments, contingency, monthly project review |

---

## Sources
[^cobit]: ISACA COBIT 2019 objective APO06 overview — https://worldoftaxonomy.com/system/reg_cobit/node/apo06 ; SFIA view of APO06 — https://sfia-online.org/@@multilingual-selector/6f11ac0a7eae4202bd0ddc664f54df2e/en ; CIO.com on COBIT — https://www.cio.com/article/228151/what-is-cobit-a-framework-for-alignment-and-governance.html
[^apo0603]: COBIT APO06.03 Create and maintain budgets — https://www.itsm-docs.com/blogs/cobit-framework/cobit-apo06-03-create-and-maintain-budgets
[^apo0605]: COBIT APO06.05 Manage costs — https://www.itsm-docs.com/blogs/cobit-framework/cobit-apo06-05-manage-costs
[^itil]: AXELOS, Service financial management: ITIL 4 Practice Guide — https://axelos.com/resource-hub/practice/service-financial-management-itil-4-practice-guide
[^itil2]: Matrix42, ITIL service financial management practice — https://www.matrix42.com/itil-service-financial-management-practice ; NovelVista, ITIL financial management — https://www.novelvista.com/blogs/it-service-management/itil-financial-management
[^tbm]: TBM Council, TBM Taxonomy — https://www.tbmcouncil.org/taxonomy
[^tbmguide]: TBM Council, The TBM Practice Lead's Guide to the TBM Taxonomy — https://www.tbmcouncil.org/the-tbm-practice-leads-guide-to-the-tbm-taxonomy/ ; Apptio, What is TBM — https://www.apptio.com/topics/what-is-tbm/
[^rgt]: Gartner, Evolve Run-Grow-Transform to Manage IT Investment Strategically — https://www.gartner.com/en/documents/8478845 ; Nicus, Run/Grow/Transform: a CFO's lens — https://www.nicus.com/resource/run-grow-transform-a-cfos-lens-on-it-strategy-and-spend/
[^rgt2]: Enterprise IT primer, IT budgeting (Run 60–75%, Transform 10–20%; non-Gartner, indicative) — https://leifulstrup.github.io/enterprise-it-primer/governance/it-budgeting
[^roll]: Gartner, Use Rolling Forecasts to Enable Timelier Resource Trade-Offs — https://www.gartner.com/en/documents/8247257
[^tt]: TechTarget, Predictable IT spending in an unpredictable economy — https://www.techtarget.com/it-strategy/feature/Predictable-IT-spending-in-an-unpredictable-economy
[^apptio]: Apptio, Four early indicators of budget variance — https://www.apptio.com/blog/four-early-indicators-budget-variance/ ; Apptio, IT budget management — https://www.apptio.com/emerge/it-budget-management-setting-direction-and-strategy/
[^zylo]: Zylo, 2025 SaaS Management Index — https://zylo.com/news/2025-saas-management-index ; Zylo, licence waste — https://zylo.com/blog/how-much-wasted-on-saas-spend
[^certero]: Certero, Five surprising stats about SaaS waste — https://www.certero.com/blog/five-surprising-stats-about-saas-waste-in-enterprise-it/
[^bench]: Enterprise IT primer, The economics of enterprise IT spending (citing Avasant/Computer Economics 2025) — https://leifulstrup.github.io/enterprise-it-primer/governance/it-spending-economics ; Gartner IT spending forecast — https://www.gartner.com/en/newsroom/press-releases/2025-07-15-gartner-forecasts-worldwide-it-spending-to-grow-7-point-9-percent-in-2025
