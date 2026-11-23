# Move Hayat Communication Tools to the Ubuntu server

The app runs today on **Render** (the program) + **Turso** (the database, in the cloud).
This guide puts the program on **your Ubuntu server**, next to the ETL stack, in the same
style: **Docker Compose + Cloudflare Tunnel**, no ports opened to the internet.

It is done in safe steps — the website keeps working the whole time:

| Step | What | Downtime |
|---|---|---|
| 1–4 | Install on the server, still using the **same Turso data** — test it privately | none |
| 5 | Point **asset.hayat.io.vn** to the server (Cloudflare) — Render stays as a fallback | ~1 min |
| 6 | *(optional, later)* Move the data from Turso onto the server | ~2 min |
| 7 | Nightly backups | — |

> Nothing here touches the ETL stack or the other project: this app has its own Docker project
> (`asset-management`) and network, and only listens on `127.0.0.1:3010`.
> Everything lives under **/DATA/asset-management** (data drive): code, `deploy/data` (database
> file, step 6) and `deploy/backups`. Only the Docker image itself sits in Docker's folder.

---

## 1. Check the server (2 min)

```bash
docker --version && docker compose version     # Docker + Compose plugin already there (ETL uses them)
docker ps --format 'table {{.Names}}\t{{.Ports}}'   # see what runs now (ETL, …)
ss -ltnp | grep -E ':3010\b' || echo "port 3010 is free"
df -h / /DATA     # / needs ~0.5 GB for the image; /DATA holds code, data and backups
```
If 3010 is taken, pick another port for `LOCAL_PORT` in step 3.

## 2. Get the code (3 min)

The GitHub repo is private, so the server needs read access once. Easiest: a **deploy key**.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/asset_deploy -N "" -C "asset-management server"
cat ~/.ssh/asset_deploy.pub
```
GitHub → **gvisky/asset-management → Settings → Deploy keys → Add deploy key** → paste it
(read-only, leave "Allow write access" unticked). Then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-asset
  HostName github.com
  User git
  IdentityFile ~/.ssh/asset_deploy
EOF
git clone github-asset:gvisky/asset-management.git /DATA/asset-management
cd /DATA/asset-management/deploy
```

## 3. Settings (5 min)

```bash
cp .env.example .env
chmod 600 .env
nano .env
```
Copy the values from **Render → asset-management → Environment**:

| In `.env` | From Render |
|---|---|
| `TURSO_DATABASE_URL` | same name |
| `TURSO_AUTH_TOKEN` | same name |
| `ADMIN_PASS` | same name |
| `IMPORTS_ENABLED`, `UNDO_IMPORT_ENABLED` | same names (leave empty if Render doesn't have them) |

For now set `COMPOSE_PROFILES=` (empty) — the tunnel comes in step 5.

## 4. Start it and test privately (5 min)

```bash
./update.sh --no-pull
```
It builds the image, starts the app and prints `✓ Running: {"commit":"…"}`.

Test from **your PC** without opening anything — an SSH tunnel to the server:
```bash
ssh -L 3010:127.0.0.1:3010 <you>@<server>
```
then open **http://localhost:3010** on your PC and log in as usual. You see the **same live
data** as asset.hayat.io.vn (both use Turso). Check a few pages: Dashboard, Asset Inventory,
Server Inventory, Network map, Budget.

Useful:
```bash
docker compose ps                 # status (healthy)
docker compose logs -f app        # live log
docker compose restart app
```

## 5. Point asset.hayat.io.vn to the server (Cloudflare)

Choose **one**:

**Option A — its own tunnel** (simplest, independent from ETL)
1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, name `asset-management`.
2. On "Install connector" pick **Docker**, copy only the token (`eyJ…`) → `.env`: `TUNNEL_TOKEN=eyJ…` and `COMPOSE_PROFILES=tunnel`.
3. `./update.sh --no-pull` → the tunnel shows **HEALTHY**.
4. Tunnel → **Public Hostname → Add**: subdomain `asset`, domain `hayat.io.vn`, type **HTTP**, URL **`app:3000`**.

**Option B — reuse the ETL tunnel**
1. `docker network ls` → find the ETL stack's network (the one its `cloudflared` container is on, e.g. `smartetl_default`).
2. `.env`: `COMPOSE_FILE=docker-compose.yml:docker-compose.shared-tunnel.yml`, `SHARED_TUNNEL_NETWORK=<that network>`, `COMPOSE_PROFILES=` (empty).
3. `./update.sh --no-pull`
4. In the **ETL tunnel** → **Public Hostname → Add**: `asset` . `hayat.io.vn`, type **HTTP**, URL **`asset-management:3000`**.

**Switch the name** (both options): Cloudflare will say a DNS record for `asset.hayat.io.vn`
already exists (it points to Render). In **DNS → Records** delete that `asset` record, then save
the public hostname again — Cloudflare creates the tunnel record. Within a minute
asset.hayat.io.vn is served from your server. Check **https://asset.hayat.io.vn/api/version**
shows the commit from step 4.

Nothing else changes: same address, same logins, the **System Health collector** keeps sending
to the same URL, staff "My devices" links keep working.

**Rollback** (if anything is wrong): delete the tunnel public hostname and re-create the DNS
record `asset` → CNAME → your Render address (`…onrender.com`, proxied). Render is untouched.
After a week without problems, suspend the Render service.

> **Cloudflare Access (Microsoft login in front)** — optional. If you add it, create **Bypass**
> rules for the parts that must work without a Microsoft login: `/api/health/ingest`
> (System Health collector, uses its own key), `/my-devices.html`, `/js/my-devices.js`,
> `/api/my-devices/*` (staff personal links), `/css/style.css`. The app keeps its own login and roles.

## 6. (Optional, later) Move the data from Turso onto the server

Faster pages (no round trip to Turso) and no dependency on Turso. Do it after step 5 is stable.

```bash
cd /DATA/asset-management/deploy
./backup.sh                                                   # safety copy first (from Turso)
docker compose exec -T app node scripts/db-snapshot.js /data/assets.db --force   # copy every table
nano .env        # empty TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
docker compose up -d                                          # restart on the local database
docker compose logs --tail=20 app                             # must say "Using local SQLite file: /data/assets.db"
```
Do this in a quiet moment (changes made between the copy and the restart would stay in Turso only).
**Keep the Turso database — do not delete it.** It stays as a backup copy (the snapshot script only reads from it).
To refresh that copy later, Render can stay connected to Turso, or restore a server backup into Turso with `node db/restore.js` (tables of `db/backup.js`).

## 7. Nightly backups

```bash
crontab -e
# add:
15 2 * * * /DATA/asset-management/deploy/backup.sh >> /DATA/asset-management/deploy/backups/backup.log 2>&1
```
Each night: a full copy of every table → `deploy/backups/assets-DATE.db.gz` (kept 30 days,
`BACKUP_KEEP_DAYS`). For an off-site copy install `rclone`, configure a remote (B2, OneDrive,
company storage) and set `BACKUP_RCLONE_REMOTE` in `.env`.

**Test a restore once a month** — a backup you never restored isn't a backup:
```bash
gunzip -k backups/assets-<date>.db.gz
docker run --rm -v "$PWD/backups:/b" -e DB_PATH=/b/assets-<date>.db asset-management:latest \
  node -e "require('./db/database').init().then(async()=>{const d=require('./db/database');console.log(await d.get('select count(*) n from assets'));process.exit(0)})"
```

## Updating later

Every time new changes are merged on GitHub:
```bash
cd /DATA/asset-management/deploy && ./update.sh
```
(pull → rebuild → restart, a few seconds; `/api/version` shows the new commit). Render's
auto-deploy keeps working too until you suspend it.

## Server hardening (same as the ETL guide)
- `ufw default deny incoming`, allow SSH from admins only — no 80/443 needed (the tunnel is outbound).
- `unattended-upgrades` on; SSH key-only login.
- `deploy/.env` holds secrets: `chmod 600`, never commit it (it is in `.gitignore`).
