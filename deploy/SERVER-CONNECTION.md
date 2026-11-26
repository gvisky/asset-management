# How Hayat IT (asset-management) runs on our server

*As built, November 2026. For the step-by-step move from Render / Turso see `DEPLOY-UBUNTU.md`.*

The app runs on the company Ubuntu server **svrweb02**, in Docker, with its database on the server's data drive.
People reach it at **https://asset.hayat.io.vn** through a **Cloudflare Tunnel**. No port on the server is open to
the internet.

---

## 1. Picture

```
  Staff browser / phone                     System Health collector (office PC)
          │  https://asset.hayat.io.vn                │  POST /api/health/ingest
          ▼                                           ▼
 ┌──────────────────────── Cloudflare ────────────────────────┐
 │  DNS asset.hayat.io.vn  →  Tunnel "asset"                  │   HTTPS certificate, DDoS protection
 │  Public hostname: asset.hayat.io.vn → http://app:3000      │
 └──────────────────────────────┬─────────────────────────────┘
                                │  outbound connection made BY the server
                                │  (nothing inbound is opened in the firewall)
 ┌──────────────── svrweb02 (Ubuntu, Docker) ──────────────────┐
 │                                                              │
 │  Docker project "asset-management"  (own network)            │
 │   ┌─────────────────────┐        ┌──────────────────────┐    │
 │   │ asset-cloudflared   │ ─────▶ │ asset-management     │    │
 │   │ cloudflare/         │  app:  │ Node.js app :3000    │    │
 │   │ cloudflared         │  3000  │ image asset-         │    │
 │   └─────────────────────┘        │ management:latest    │    │
 │                                  └─────────┬────────────┘    │
 │                       127.0.0.1:3010 ──────┘ (server only,   │
 │                                               for testing)   │
 │  /DATA/asset-management/                                     │
 │   ├── (code from GitHub)                                     │
 │   └── deploy/                                                │
 │        ├── .env            settings + secrets (chmod 600)    │
 │        ├── data/assets.db  ◀── THE DATABASE (SQLite)         │
 │        └── backups/        assets-<date>.db.gz               │
 │                                                              │
 │  Other stacks on the same server (ETL, …) — separate         │
 │  projects and networks, not touched by this app.             │
 └──────────────────────────────────────────────────────────────┘

 GitHub gvisky/asset-management (main) ──git pull (deploy key)──▶ /DATA/asset-management
 Turso (cloud database) ── frozen copy of the data up to 2026-11-23, kept as a backup, NOT used
```

---

## 2. The parts

| Part | What / where | Notes |
|---|---|---|
| Server | **svrweb02**, Ubuntu, Docker + Docker Compose | Shared with the ETL stack and another project |
| Code | `/DATA/asset-management` (git clone of `gvisky/asset-management`, branch `main`) | Data drive, not the OS drive |
| Docker project | `asset-management` (`deploy/docker-compose.yml`) | Own network; `docker compose …` is run in `deploy/` |
| App container | `asset-management`, image `asset-management:latest`, Node.js on port 3000 | `restart: unless-stopped`; health check every 30 s |
| Tunnel container | `asset-cloudflared`, image `cloudflare/cloudflared:latest` | Started because `.env` has `COMPOSE_PROFILES=tunnel` |
| Cloudflare Tunnel | Tunnel **"asset"** (Zero Trust → Networks → Tunnels) | Public hostname `asset.hayat.io.vn` → `http://app:3000` |
| Database | **SQLite file** `deploy/data/assets.db` (inside the container: `/data/assets.db`) | Moved from Turso on 2026-11-23 (51 tables, 11 212 rows) |
| Turso | Old cloud database | **Kept as a backup — never delete it, never restore into it** |
| Backups | `deploy/backup.sh` → `deploy/backups/assets-<date>.db.gz` | Keeps 30 days (`BACKUP_KEEP_DAYS`) |
| Local test port | `127.0.0.1:3010` on the server only | For `curl` checks on the server; not reachable from the network |
| GitHub access | Read-only **deploy key** `~/.ssh/asset_deploy`, SSH host alias `github-asset` | Server can pull, cannot push |
| Render | Old hosting | No longer serves the site (DNS points to the tunnel); can stay suspended |

---

## 3. How a request reaches the app

1. A user opens **https://asset.hayat.io.vn**. Cloudflare answers. The certificate and HTTPS are Cloudflare's, so
   there is nothing to renew on the server.
2. Cloudflare sends the request into tunnel **"asset"**. The tunnel is a connection that `asset-cloudflared`
   opened *from* the server to Cloudflare, so no inbound firewall rule is needed.
3. `asset-cloudflared` passes it to **`http://app:3000`**: the app container, by its service name on the project's
   own Docker network.
4. The app checks the session cookie and two-step login, reads or writes **`/data/assets.db`**, and answers.

The **System Health collector** (a small Node program on an office PC) uses the same path. It POSTs to
`https://asset.hayat.io.vn/api/health/ingest` with its own key.

---

## 4. Settings: `deploy/.env`

Kept only on the server (`chmod 600`, never in Git). The keys, **without their values**:

| Key | Current use |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | **Empty**, so the app uses the local file `/data/assets.db`. Filling them would switch back to Turso. Don't. |
| `ADMIN_PASS` | Password of the first-run admin account |
| `IMPORTS_ENABLED`, `UNDO_IMPORT_ENABLED` | Feature switches (device import) |
| `NODE_ENV` | `production` |
| `TUNNEL_TOKEN` | Token of Cloudflare tunnel "asset" (only the `eyJ…` part, not the whole docker command) |
| `COMPOSE_PROFILES` | `tunnel`, which starts `asset-cloudflared` |
| `LOCAL_PORT` | `3010` (test port on the server) |
| `BACKUP_KEEP_DAYS` | `30` |
| `BACKUP_RCLONE_REMOTE` | Optional off-site backup copy (not set) |

`deploy/update.sh` sets `APP_COMMIT` on every build, so the running version is visible at `/api/version`.

---

## 5. Everyday work

All commands run on svrweb02. Start with:

```bash
cd /DATA/asset-management/deploy
```

### Put a new version live (after a pull request is merged on GitHub)
```bash
./update.sh
```
It pulls `main`, rebuilds the image, restarts the app and prints `✓ Running: {"commit":"…"}`. **The commit must
match the latest merge on GitHub.** If it doesn't, the change was not merged yet (or was pushed after the merge).
Users then press **Ctrl+F5** once.

### Is it running?
```bash
docker compose ps                                   # both containers "Up", app "(healthy)"
curl -s http://127.0.0.1:3010/api/version           # {"commit":"…","started":"…"}
curl -s https://asset.hayat.io.vn/api/version       # same answer through Cloudflare
```
"health: starting" is normal for about 40 seconds after a restart.

### Logs
```bash
docker compose logs --tail=100 app            # the app
docker compose logs -f app                    # follow live (Ctrl+C to stop)
docker compose logs --tail=50 cloudflared     # the tunnel
```
On start the app log must say **`Using local SQLite file: /data/assets.db`**.

### Restart / stop / start
```bash
docker compose restart app
docker compose down          # stop both (the data stays in deploy/data)
docker compose up -d         # start both
```

---

## 6. Backups and restore

### Take a backup now (always before risky work)
```bash
./backup.sh
ls -lh backups/ | tail -5
```
It writes a full copy of every table, `backups/assets-YYYY-MM-DD_HHMM.db.gz`, and deletes copies older than 30 days.

### Nightly backup (cron)
Check whether it is set up:
```bash
crontab -l | grep backup.sh
```
If nothing shows, add it with `crontab -e`:
```
15 2 * * * /DATA/asset-management/deploy/backup.sh >> /DATA/asset-management/deploy/backups/backup.log 2>&1
```

### Restore a backup (only if the database is damaged)
```bash
docker compose stop app
cp data/assets.db data/assets.db.broken-$(date +%F)          # keep the damaged file
gunzip -c backups/assets-<date>.db.gz > data/assets.db
docker compose start app
docker compose logs --tail=20 app
```
Test a backup once a month (see `DEPLOY-UBUNTU.md` step 7). **Turso is never used for restore.**

---

## 7. Go back to the previous version (rollback)

If a new version misbehaves:
```bash
cd /DATA/asset-management
git log --oneline -5                       # find the last good commit
git checkout <good-commit>
cd deploy && ./update.sh --no-pull         # build and start that version
```
To return to normal afterwards:
```bash
cd /DATA/asset-management
git checkout main
cd deploy && ./update.sh
```
New versions may add database columns, and older versions ignore them, so going back is safe for the data. Take a
backup first anyway.

---

## 8. Cloudflare side

- **Zero Trust → Networks → Tunnels → "asset"** must show **HEALTHY**.
- **Public hostname**: subdomain `asset`, domain `hayat.io.vn`, service **HTTP** `app:3000`.
- **DNS → Records**: `asset` is a CNAME to the tunnel (created by Cloudflare). The old record to Render was removed.
- To change the tunnel token: edit `TUNNEL_TOKEN` in `.env`, then run `docker compose up -d`.

---

## 9. When something is wrong

| What you see | Check / fix |
|---|---|
| Page shows the old layout after an update | Compare `/api/version` with the latest merge on GitHub. If it matches, press **Ctrl+F5**. If it doesn't match, the change was not merged: merge, then `./update.sh` |
| `asset.hayat.io.vn` doesn't open, but `curl 127.0.0.1:3010` works | Tunnel: `docker compose logs --tail=50 cloudflared`; Cloudflare tunnel "asset" status; `TUNNEL_TOKEN` in `.env` |
| Neither works | `docker compose ps`; `docker compose logs --tail=100 app`; `./update.sh --no-pull` |
| App log doesn't say "Using local SQLite file" | `TURSO_*` got filled in `.env`. Empty them, then run `docker compose up -d` |
| "no space left on device" | `df -h /DATA /`; delete old images with `docker image prune`; check `deploy/backups` |
| Port 3010 already used | Set another `LOCAL_PORT` in `.env`, then `./update.sh --no-pull` |
| Testing from your PC | SSH port forwarding is blocked on svrweb02, so test on the server with `curl` (section 5) or through the public address |

---

## 10. Security in short

- No inbound port: the tunnel connects out, and port 3010 listens on `127.0.0.1` only.
- HTTPS by Cloudflare. In the app: password and two-step login (required for everyone), roles and teams, and an
  audit log of every change.
- `deploy/.env` holds the secrets: `chmod 600`, never committed. Rotate `TUNNEL_TOKEN` and `ADMIN_PASS` if they were
  ever shared.
- GitHub access from the server is a read-only deploy key.
- Backups are files on the same server. Set `BACKUP_RCLONE_REMOTE` for an off-site copy.
