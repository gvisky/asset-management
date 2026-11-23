# Network infrastructure: where we stand and what to build next

*Proposal for the IT management and the Network team, November 2026.*

---

## 1. Summary

The app already holds a good **picture** of the network: the device list, the map, ports, VLANs,
racks, patch panels, drawings and a log of port changes. What it does not have yet is the **live
truth**. Every port, MAC address and firmware version is typed in or imported by hand, so it slowly
drifts away from what the switches really do. There is also no copy of any device configuration,
and no view of which hardware is out of vendor support.

The app has just moved from the cloud onto **svrweb02 inside the LAN**. That changes what is
possible. The app can now ask the switches, controllers and firewall directly, read-only, without a
separate collector PC and without opening anything to the internet.

**Proposal: five steps, smallest and most valuable first.**

| # | Module | What the Network team gets | Effort | Value |
|---|---|---|---|---|
| 1 | **Lifecycle and risk board** | Every network model with end-of-sale / end-of-support date, firmware, support contract. A refresh list with costs for the Budget page. | S | ★★★★★ |
| 2 | **Config backup** | Every night, the running config of every switch, controller, router and firewall is saved, with a "what changed" diff and an alert on unplanned change. | M | ★★★★★ |
| 3 | **Auto-discovery and drift check** | The app reads neighbours (CDP/LLDP), MAC and ARP tables and port status, and shows where the map is wrong. | M | ★★★★ |
| 4 | **Live status on the map** | Up/down, port errors, PoE use, uplink load and uptime shown on the map devices. Alerts go to the Network team. | M | ★★★★ |
| 5 | **IPAM, compliance and change records** | Subnets and IP use, "golden config" rules (SSH only, SNMPv3, NTP …), planned changes and maintenance windows, OT zones. | L | ★★★ |

Steps 1 and 2 cover the two biggest risks today: hardware out of support, and no way to rebuild a
switch quickly after a failure. They can be done in about four to six weeks of part-time work.

---

## 2. What we have today

### 2.1 Equipment (from the Server Inventory, Vietnam)

| Category | Count | Main models |
|---|---|---|
| Access points (indoor) | ~70 | Cisco AIR-AP2802E |
| Access points (outdoor) | ~30 | Cisco AIR-AP1572EAC |
| Switches | ~36 | Catalyst C9200L-48P-4X, Catalyst 3560-CX-12PD-S, Nexus N3K-C3548P-XL / C3524P-XL |
| Wireless controllers | 2 | Cisco AIR-CT5520 |
| Voice gateways | 2 | Cisco ISR4331 |
| Firewall | 1 | Sophos XG 210 |
| OT network | CCTV / Kabin switches, cameras, access control | (OT view of the map) |

*Counts come from the device list in the app. The live database on svrweb02 is the final number.*

### 2.2 What the app already does

| Area | Already in the app |
|---|---|
| Inventory | Server Inventory with an IT / OT split, network categories, serials, MAC, VLAN, "connected to" port, photos, protected fields |
| Map | Network map per site: devices, ports (peer, VLAN, mode, patch, note), VLAN list, topology and physical views, IT and OT views |
| Physical | Racks (front view), factory cabinets (Kabin), patch panels and outlets, floor-plan drawings with camera pins |
| Data import | Implementation document (.docx), Factory Info workbook (.xlsx), MAC address-table paste, OT device list, CCTV camera list |
| Change history | Port change log (who, before, after), audit log, OT activity log |
| Checks | Link check (both ends of a cable agree), Needs Attention (missing serial / IP / location), OT Needs Attention, inventory ↔ map sync |
| Monitoring | System Health: a collector PC polls SNMP / ping / HTTP / TCP and pushes the results to the app |
| People | Network team role (new): network devices of IT and OT, the full map, OT Reports |
| Money | Budget page: Opex / Capex by PYP and GL, year over year |

This is a solid base. Most tools in the market (NetBox, Device42) start from the same data model:
device → interface → cable → VLAN / prefix. We already have it.

---

## 3. Gaps and risks (most serious first)

### 3.1 Hardware past or near end of support 🔴

Public vendor notices for the models we run show the following. The dates must be checked against
the exact part numbers on Cisco's and Sophos's own pages, because some notices cover several SKUs.

| Model | Role | End of sale | Last date of support | Status |
|---|---|---|---|---|
| **Sophos XG 210** | Main firewall | ended | **31 Mar 2025** | 🔴 **Out of support.** No more firmware or security fixes. Sophos's path is XGS 2100. |
| **Cisco AIR-AP1572** (outdoor AP) | Wi-Fi outdoor | 13 Nov 2020 | **30 Nov 2025** (1570 series) | 🔴 Out of support |
| **Cisco ISR4331** (voice gateway) | Voice | 2019 (base SKUs) or newer notice | 31 Oct 2024 (base SKU) or 30 Nov 2028 (newer notice) | 🟠 Check the exact SKU |
| **Cisco AIR-CT5520** (WLC) | Wireless controller | 31 Jan 2022 | **31 Jan 2027** | 🟠 About 2 months left. Cisco's path is Catalyst 9800-40 / 9800-L / 9800-CL. |
| **Cisco AIR-AP2802** (indoor AP) | Wi-Fi | 31 Oct 2022 | Jan–Oct 2027 (the notices disagree) | 🟠 2027 |
| **Nexus 3548P-XL / 3524P-XL** | Server / core switching | no longer sold | about 2027 (third-party trackers) | 🟠 Check |
| **Catalyst 3560-CX-12PD-S** | Compact switch | 30 Apr 2024 | about 2029 (third-party tracker) | 🟡 Plan |
| **Catalyst C9200L** | Access switch | current | — | 🟢 |

**What this means:** the firewall that protects the whole site gets no more security fixes. The
wireless controller and the 100 access points it runs reach end of support within about a year,
and they need to be replaced **together**: AP2802 and AP1572 do not run on the Catalyst 9800 the
same way as on the 5520, so the controller and AP refresh is one project. This must go into the
**2027 Capex** on the Budget page.

### 3.2 No configuration backup 🔴

If a core switch, the WLC or the firewall dies today, its configuration has to be rebuilt from
memory and from the implementation document, which is often out of date. Industry practice is a
nightly automatic backup with a diff, using tools such as Oxidized or RANCID, or built into
NMS tools.

### 3.3 The map is maintained by hand 🟠

Ports, MAC addresses and neighbours are typed or pasted in. After a few months, the map no longer
matches reality: a camera moved, a port re-patched, a new unmanaged switch under a desk. Nothing
tells us.

### 3.4 Monitoring is separate from the map 🟠

System Health shows "up / down" for a short list of checks. It is not linked to the map devices,
has no history of port errors or load, and needs a separate Windows collector PC.

### 3.5 Smaller gaps 🟡

- **No IP address management (IPAM):** VLANs have a subnet, but nobody can see free IPs or conflicts.
- **No standard config check:** nothing confirms that Telnet is off, SNMPv3 and NTP are set, unused
  ports are shut, and BPDU guard is on.
- **Firmware versions** are not tracked per device and not checked against vendor advisories.
- **Internet lines and contracts** (ISP, circuit ID, speed, contract end, support phone) are not recorded.
- **Spares** (spare switch, SFP modules, PSUs, AP stock) are not tracked.
- **OT segmentation** (which OT zone talks to which, through which firewall rule) is not documented.
  IEC 62443 calls these zones and conduits.
- **Planned changes** have no record: no "who changes what, when, rollback plan" before work starts.

---

## 4. Proposal: what to build

### Step 1: Lifecycle and risk board (2 weeks)

**Goal:** one page that tells management which network hardware is at risk and what it will cost to fix.

- New table **`net_models`**: vendor, model / part number, end-of-sale, end of software
  maintenance, last date of support, replacement model, unit price (estimate), source link.
  Filled once by the Network team from the vendor notices, about 10 rows for our estate.
- On each network device, add these fields: **firmware version**, **support contract number and
  end date**, **purchase date**.
- A **Lifecycle** tab on Server Inventory, Network devices:
  - traffic light per device: 🔴 out of support, 🟠 < 18 months, 🟡 < 36 months, 🟢 OK
  - counts by model and site, and devices with no model data
  - **refresh plan**: replacement model × quantity × unit price = cost per year, exported to the
    Budget page as Capex lines (PYP / category "Network refresh")
- A KPI tile on the Dashboard: "% of network devices in vendor support".

*No access to devices is needed. This is data entry plus calculation.*

### Step 2: Configuration backup (2–3 weeks)

**Goal:** any switch, WLC, router or firewall can be rebuilt in minutes, and every change is seen.

- A small job **on svrweb02** (inside the app container, or a sidecar container) logs in to each
  device every night over **SSH with a read-only account** and saves:
  - Cisco IOS / IOS-XE / NX-OS: `show running-config` (+ `show version`, `show inventory`)
  - Cisco WLC 5520 (AireOS): `show run-config commands`
  - Sophos: backup file through its API, or the scheduled e-mail / SCP backup
- Saved in a new table **`net_configs`** (device, taken_at, hash, text). A new version is stored only
  when something changed. Passwords and keys are **masked** before saving.
- On the map device panel: **Config** tab with the version list and a side-by-side diff.
- **Alert** to the Network team when a config changed and no planned change was recorded
  (step 5 makes this stronger).
- Downloads are logged in the audit log. Only Network and IT admins can download.

**Alternative:** run **Oxidized** (open source, Docker) next to the app on svrweb02 and show its git
history in the app. It is faster to start and supports 130+ device types, but it is one more service
to look after. **Recommendation:** start built-in for Cisco IOS / NX-OS / AireOS, which are about 95%
of our devices, and keep Oxidized as the fallback if we add many other vendors.

### Step 3: Auto-discovery and drift check (3 weeks)

**Goal:** the map stays true without people typing.

From svrweb02, read-only, every 15–30 minutes (SNMP v3 preferred, SSH as fallback):

| Read | SNMP MIB / command | Used for |
|---|---|---|
| Neighbours | CDP / LLDP-MIB · `show cdp neighbors detail` | Switch ↔ switch / AP / phone links, and uplinks |
| MAC table | BRIDGE-MIB / Q-BRIDGE · `show mac address-table` | Which end device is on which port (replaces the manual paste) |
| ARP | IP-MIB (on the L3 core / firewall) | MAC → IP, for cameras, PCs and OT devices |
| Port status | IF-MIB | up/down, speed/duplex, admin-down, last change |
| VLAN per port | Cisco VLAN MIBs · `show interfaces status` | VLAN and trunk check |
| PoE | POWER-ETHERNET-MIB | Watts per port and budget left |
| Version / serial | ENTITY-MIB, `show version` | Firmware and serial into the inventory automatically |
| WLC | AIRESPACE MIBs | AP list, AP → controller, clients per AP |

A **Drift** report compares this with the map:

- port says "free" but a MAC is seen → *something new is plugged in*
- map says camera X on Gi1/0/12 but its MAC is on Gi1/0/14 → *moved*
- an unknown MAC with many addresses behind one port → *unmanaged switch*
- a neighbour that is not on the map → *new device*
- a serial in the inventory that differs from the device → *swapped hardware*

Each line has **Accept** (update the map) or **Ignore**. Updates go through the existing port log, so
history is kept. The existing MAC-paste and link-check features become the manual fallback.

### Step 4: Live status on the map (2–3 weeks)

**Goal:** the map is also the place to see that something is wrong.

- Polling from step 3 writes **samples** every 5 minutes: up/down, uptime, CPU/memory (Cisco),
  in/out load and error counters on uplinks, and PoE use. Keep 30 days of 5-minute data and
  1 year of hourly data. This stays small for about 150 devices.
- On the map: a red or amber device ring, uplink thickness or colour by load, a reboot icon if uptime
  dropped, and a small "last 24 h" chart in the device panel.
- **Alerts** (in-app notification to audience `NET`, optional e-mail / Teams): device down > 3 min, uplink
  down, errors rising, PoE budget > 85%, AP count on the WLC dropped, config changed (step 2).
- System Health stays for servers and web apps. Its existing SNMP checks can be linked to map devices,
  so nothing is lost. Sites with no server inside (other countries) keep using the collector PC.

**Build or buy:** for deep metrics (NetFlow, long history, hundreds of graphs), **LibreNMS** or
**Zabbix** in Docker on svrweb02 is the right tool, and the app can link to it. For our size and team,
light polling inside the app gives the Network team one place to work. **Recommendation:** start
in-app and re-assess after 6 months.

### Step 5: IPAM, compliance, changes and OT zones (4–6 weeks, can be split)

**a. IPAM.** Prefixes from `net_vlans` (network, gateway). IP use comes from ARP (step 3) plus the
inventory IPs. The page shows used, free and conflicting addresses (same IP, two MACs), and lets
you reserve an IP when adding a device.

**b. Compliance ("golden config").** Rules checked against the saved configs (step 2), with a
score per device and a fix list:

- SSH v2 only, no Telnet or HTTP management · AAA / local users with secret (type 8/9) · `service password-encryption`
- SNMPv3 only (or v2c with ACL), no `public` / `private` · NTP to our servers · syslog to a central server
- unused access ports shutdown and in a parking VLAN · BPDU guard / portfast on access ports · DHCP snooping / ARP inspection where used
- login banner · VTY access-class (management subnet only) · exec timeout
- firmware not on vendor's "deferred" list · on the WLC: WPA2/WPA3-Enterprise, management over wireless off

**c. Planned changes.** A short change record: what, devices, when (maintenance window), risk,
rollback, approver. A port change or config diff during an approved window links to the change. Any
other change is flagged as "unplanned". This is light ITIL, not a ticket system.

**d. OT zones and conduits.** Following IEC 62443, record the OT zones (CCTV, access control, PLC /
production, building management) and, for each conduit, the allowed flows (from-zone → to-zone, ports,
firewall rule). This becomes the reference when the OT firewall or switch config is checked, and when
an auditor asks.

**e. Small registers.** **Internet lines** (ISP, circuit ID, speed, public IPs, contract end,
support phone), and **spares** (spare switches, SFPs, PSUs, APs in stock, linked to Stocktake).

---

## 5. How the app reaches the devices safely

Reading from devices is safe if it is done strictly read-only:

1. **Accounts.** A dedicated **read-only** SSH user (Cisco: privilege 1 with `show` commands allowed,
   or NX-OS role `network-operator`) and **SNMPv3** (authPriv, SHA + AES) with a read-only view. No write
   community, no `configure` rights. The app never sends configuration.
2. **Where.** Only **svrweb02** polls. Its IP is allowed in the management ACL / VTY access-class of each
   device and in the firewall rule from the server VLAN to the management VLAN, and nothing else.
3. **Secrets.** Credentials live in `deploy/.env` on svrweb02 (chmod 600), never in Git and never in the
   database. Saved configs have passwords, keys and communities masked.
4. **Load.** Polling is spread out (one device at a time, 5–30 minute intervals) and uses bulk SNMP. It is
   far below what the switches handle.
5. **People.** Only the Network team and IT admins see configs. Every download is in the audit log.

---

## 6. Timeline (part-time, one developer plus the Network team for data)

| Month | Delivered |
|---|---|
| Dec 2026 | Step 1, the lifecycle board. **Firewall and WLC/AP refresh cost into the 2027 budget.** |
| Jan 2027 | Step 2, config backup (Cisco). Read-only accounts and SNMPv3 rolled out on devices. |
| Feb 2027 | Step 3, discovery and drift report |
| Mar 2027 | Step 4, live status and alerts on the map |
| Q2 2027 | Step 5 a–e, in order of need (suggested: compliance → IPAM → changes → OT zones → registers) |

**Not software, but urgent (Network team):**
1. **Firewall:** plan the Sophos XG 210 → XGS (e.g. XGS 2100) replacement now. It is out of support.
2. **Wireless:** plan the 5520 + AP2802 / AP1572 → Catalyst 9800 + Wi-Fi 6/6E APs as one project, a site
   survey first, before Jan 2027.
3. **Check SKUs** of the ISR4331 and Nexus 3548P-XL against Cisco's lifecycle pages, and put any
   support contracts in step 1.

---

## 7. KPIs for the Network team (shown on the dashboard)

| KPI | Target |
|---|---|
| Network devices in vendor support | ≥ 95% |
| Devices with a config backup < 24 h old | 100% |
| Map accuracy (open drift lines) | < 10 |
| Core / distribution availability (monthly) | ≥ 99.9% |
| Unplanned config changes | 0 |
| Compliance score (golden config) | ≥ 90% |
| Mean time to restore a failed switch (from backup + spare) | < 1 h |

---

## 8. Decisions needed

1. **Go / no-go and order** of the five steps. Recommended: 1 → 2 → 3 → 4 → 5.
2. **Read-only access:** may svrweb02 poll the network devices (SNMPv3 + read-only SSH)? Steps 2–4
   need this. Without it, only step 1 and the manual parts of step 5 are possible.
3. **Built-in vs. Oxidized / LibreNMS** for backup and metrics. Recommended: built-in first.
4. **Alerts channel:** in-app only, or also e-mail / Microsoft Teams?
5. Which **other countries' sites** to include (they need a collector or a site-to-site path to svrweb02).

---

### Sources (vendor lifecycle notices; confirm against the exact part numbers)

- Sophos XG Series hardware EOL FAQ: https://community.sophos.com/sophos-xg-firewall/b/blog/posts/xg-series-hardware-end-of-life-eol-frequently-asked-questions
- Sophos network security hardware lifecycle: https://doc.sophos.com/support/help/en-us/lifecycle/hardware/
- Cisco 5520 Wireless Controller EOS/EOL: https://www.cisco.com/c/en/us/products/collateral/wireless/5520-wireless-controller/eos-eol-notice-c51-744430.html
- Cisco Aironet 1570 EOS/EOL: https://www.cisco.com/c/en/us/products/collateral/wireless/aironet-1570-series/eos-eol-notice-c51-743780.html
- Cisco Aironet 2800 EOL: https://bxin.cisco.com/c/en/us/products/collateral/wireless/aironet-2800-series-access-points/aironet-2800-series-access-points-eol.pdf
- Cisco AP 2800E support page: https://www.cisco.com/c/en/us/support/wireless/aironet-2800e-access-point/model.html
- Cisco ISR4200 / 4300 / 4400 EOL: https://cisco.com/c/en/us/products/collateral/routers/4000-series-integrated-services-routers-isr/select-isr4k-series-platform-eol.html
- Cisco Catalyst 3560-CX EOL: https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-3560-cx-series-switches/catalyst-3560-cx-serie-switche-eol.html
- Cisco Nexus 3524-X / 3548-X EOL: https://www.cisco.com/c/en/us/products/collateral/switches/nexus-3000-series-switches/nexus-3524-x-3548-x-eol.html
