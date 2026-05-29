# Deploying for Multi-User Access

The app now has **user accounts, roles, login, and an audit trail**. This guide covers running it for a team — both on your office network and on the cloud (accessible from anywhere).

---

## Roles

| Role | View | Add / edit / delete assets | Restore deleted (recycle bin) | Manage users + audit log |
|------|:---:|:---:|:---:|:---:|
| **admin**  | ✅ | ✅ | ✅ | ✅ |
| **editor** | ✅ | ✅ | ❌ | ❌ |
| **viewer** | ✅ | ❌ | ❌ | ❌ |

On first run the app creates the team's accounts:

```
viet      / viet123       (admin)
hiep      / hiep123       (editor)
quocviet  / quocviet123   (editor)
```

**Everyone should change their password after first login** (the "Change password"
button at the top-right). Admins can add/edit/remove accounts on the **Users & Audit** page.

### Recycle bin

Deleting an asset does **not** erase it — it moves to the **Recycle Bin**, tagged with who
deleted it and when. Only an **admin** can open the recycle bin and **restore** records.
Every delete and restore is also written to the audit log.

---

## Option A — Cloud (anywhere access)  ←  recommended for your case

Files included: `Dockerfile`, `render.yaml`, `.dockerignore`. The database lives on a
**persistent disk** so it survives restarts and redeploys. The 258 assets auto-load on
first boot from `db/seed-data.json` — no Excel file needed on the server.

### Deploy to Render.com (easiest)

1. Put this `asset-management` folder in a **GitHub repository** and push it.
2. Create a free account at https://render.com and connect your GitHub.
3. Click **New → Blueprint**, select your repo. Render reads `render.yaml` automatically.
4. In the service's **Environment** settings, set a strong `ADMIN_PASS` secret.
5. Click **Apply**. After the build, you get a public HTTPS URL like
   `https://asset-management-xxxx.onrender.com`.
6. Share that URL with your team. They log in with the accounts you create.

> The `starter` plan ($7/mo) is required for a persistent disk — the **free** plan wipes
> the disk on every restart, so your edits would be lost. Asset data still auto-seeds, but
> any changes users make would not persist on the free plan.

### Deploy anywhere else with Docker

Any host that runs Docker + supports a mounted volume works (Railway, Fly.io, a company VM, Azure):

```bash
docker build -t asset-management .
docker run -d -p 3000:3000 \
  -e ADMIN_PASS="choose-a-strong-password" \
  -v asset_data:/data \
  --name asset-app asset-management
```

The `-v asset_data:/data` volume keeps the SQLite database (`/data/assets.db`) persistent.

---

## Option B — Office network (LAN)

Run it on one always-on PC; colleagues on the same network reach it by that PC's IP.

1. On the host PC, in the `asset-management` folder:
   ```powershell
   $env:ADMIN_PASS = "choose-a-strong-password"
   npm start
   ```
2. Find the host PC's IP:
   ```powershell
   ipconfig   # look for "IPv4 Address", e.g. 192.168.1.50
   ```
3. Allow port 3000 through Windows Firewall (run PowerShell **as Administrator**, once):
   ```powershell
   New-NetFirewallRule -DisplayName "Asset Manager" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```
4. Colleagues open `http://192.168.1.50:3000` (use the host's real IP) and log in.

> The host PC must stay on and running `npm start`. For 24/7 availability, prefer Option A
> or install the app as a Windows service.

---

## Security notes

- Passwords are hashed with scrypt (never stored in plain text).
- Sessions use HttpOnly cookies; in production (`NODE_ENV=production`) the cookie is also
  marked `Secure`, so **always serve over HTTPS** in the cloud (Render does this for you).
- Every create / edit / delete and every login is recorded in the audit log, viewable by admins.
- Back up the database file (`assets.db`, or the `/data` volume) periodically.
