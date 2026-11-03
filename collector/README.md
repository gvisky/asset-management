# Hayat System Health collector

A small program for an **always-on PC or VM inside the office**. Every minute it checks the
router, switches, servers and internal web apps listed in `config.json`, then sends the results
to **https://asset.hayat.io.vn → System Health**.

It only makes **outgoing HTTPS** calls. Nothing in the office is opened to the internet, and the
website never connects into the office network.

| Check type | What it tells you | Typical use |
|---|---|---|
| `snmp` | Up time, every interface up/down, live traffic (Mbps) | Routers (DrayTek), switches, UPS |
| `ping` | Is it answering, and how fast | Any device, internet (8.8.8.8) |
| `http` | Does the web page answer, HTTP code, response time | Internal web apps, device admin pages |
| `tcp`  | Is a port open | Server RDP 3389, SSH 22, file share 445 |

---

## 1. Turn on SNMP on the DrayTek Vigor2133 (read-only)

1. Open https://192.168.3.1 → **System Maintenance → SNMP**.
2. Tick **Enable SNMP Agent**.
3. **Get Community**: replace `public` with your own word (letters and numbers, e.g. `hayatMon2026`).
   Leave **Set Community** empty or different, so the collector can only read.
4. **Manager Host IP**: the IP of the collector PC (e.g. `192.168.3.50`), so only that PC is allowed to ask.
5. If your firmware offers **SNMPv3**, you can use it instead (user + SHA/AES keys). See the v3 example below.
6. **OK**. Leave SNMP access from WAN **off**.

> Update the router firmware first (3.9.9.2 or later for the Vigor2133). See System Maintenance → Firmware Upgrade.

## 2. Create the collector key on the website

1. Log in as an **IT admin** → **System Health** → **➕ Add collector**.
2. Name it after the PC (e.g. `HCM office PC`), and pick the site and country.
3. Copy the key that appears (`hc_…`). **It is shown only once.** If it's lost, delete the collector and add a new one.

## 3. Install on the collector PC (Windows)

1. Install **Node.js LTS** (version 18 or newer) from https://nodejs.org (default options).
2. Copy this `collector` folder to the PC, e.g. `C:\HayatCollector`.
3. In that folder, copy `config.example.json` to **`config.json`** and fill in:
   - `key`: the `hc_…` key from step 2
   - `community`: the Get Community from step 1
   - the checks you want (see below)
4. Open **PowerShell** in the folder and test:
   ```powershell
   npm install
   node collector.js --once
   ```
   Each check prints UP / WARN / DOWN, then `sent N checks`. The System Health page shows them within a minute.
5. Install it to start with Windows (run PowerShell **as Administrator**):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
   ```
   It runs as a scheduled task named **Hayat System Health Collector** and writes `collector.log` in the folder.
   Changes to `config.json` are picked up on the next round, with no restart needed.

**Linux:** `npm install`, then run `node collector.js` as a systemd service (Restart=always).

## 4. config.json

```json
{
  "server": "https://asset.hayat.io.vn",
  "key": "hc_…",
  "intervalSeconds": 60,
  "checks": [
    { "name": "DrayTek Vigor2133 (main router)", "type": "snmp", "host": "192.168.3.1",
      "version": "2c", "community": "hayatMon2026",
      "interfaces": [
        { "match": "^wan1$|wan 1", "label": "WAN 1" },
        { "match": "^wan2$|wan 2", "label": "WAN 2" },
        { "match": "wan3|usb|lte",  "label": "WAN 3 (4G backup)", "required": false }
      ] },
    { "name": "Router web page", "type": "http", "url": "https://192.168.3.1/", "slowMs": 3000 },
    { "name": "Internet", "type": "ping", "host": "8.8.8.8", "slowMs": 150 },
    { "name": "File server RDP", "type": "tcp", "host": "192.168.3.10", "port": 3389 }
  ]
}
```

- **`interfaces`** (SNMP): the ports to show. `match` is matched (ignoring case) against the interface
  name or description the device reports. Leave the list out the first time: the collector then
  shows every enabled interface, so you can see the real names (e.g. `WAN1`, `ppp0`) and fill in `match`.
- **`required`**: a required interface that is down turns the device **amber** (WARN).
  Add `"downIfAnyRequired": true` to the check to make it **red** instead. Use `"required": false` for
  backup lines (like the 4G USB WAN) so they're shown but don't raise an alert.
- **`slowMs`**: answering but slower than this turns it amber.
- **`http`**: internal self-signed certificates are accepted. Add `"verifyTls": true` to check the certificate.
  401 / 403 count as "up" (the page answers, it just wants a login).
- **SNMPv3** example:
  `{ "type": "snmp", "host": "192.168.3.1", "version": "3", "user": "monitor", "authProtocol": "sha", "authKey": "…", "privProtocol": "aes", "privKey": "…" }`

## 5. What you see on the website

- **System Health** page: a tile per system (🟢 up, 🟠 warn, 🔴 down, ⚪ no data), grouped by
  collector / site, refreshing every 30 seconds. Router tiles list each interface with live ↓/↑ Mbps and up time.
- If a collector stops reporting for 3 minutes, its checks show **no data**, and the collector is marked offline.
- When something goes **DOWN** or comes **back up**, IT gets an entry in 🔔 Alerts.
- Only status changes are kept in history, not every minute's readings.

Keep `config.json` private: it holds the collector key and the SNMP community. It is excluded from Git.
