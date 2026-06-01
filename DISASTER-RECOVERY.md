# Disaster Recovery — Hayat Communication Tools

Keep this file handy. It explains how to recover if something breaks.

## Where everything lives
| Piece | Location | Source of truth? |
|-------|----------|------------------|
| **Code** | GitHub: `github.com/gvisky/asset-management` | ✅ yes |
| **App host** | Render → `https://asset-management-b5qd.onrender.com` | replaceable |
| **Live data** | Turso cloud database (`libsql://assets-gvisky…turso.io`) | ✅ yes |
| **Backups** | `backups/*.json` on the PC (run `npm run backup`) | recovery copy |

> The PC is **not** a source of truth — code is on GitHub, data is in Turso.
> Losing the PC loses nothing important.

## Credentials you need to recover (keep them somewhere safe)
- GitHub login (for the code)
- Turso: **Database URL** + **Auth Token** (Turso dashboard → your DB → tokens)
- Render login (or whichever host you use)
- The 4 env vars the app needs: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASS`, `NODE_ENV=production`

---

## Make a backup (do this weekly)
```powershell
cd "…\Desktop\Code\Asset control\asset-management"
$env:TURSO_DATABASE_URL="libsql://assets-gvisky.aws-ap-northeast-1.turso.io"
$env:TURSO_AUTH_TOKEN="<your token>"
npm run backup        # writes backups/backup-<date>.json (all tables)
```
Copy that JSON file somewhere safe (OneDrive, USB, etc.).

---

## Scenario A — The website (Render) is down or you want a new host
The data is safe (it's in Turso); only the app needs a new home.
1. Pick any Node host: **Render, Railway, Fly.io, a company VPS, Azure App Service**, or even run it on an office PC.
2. Point it at the GitHub repo (build: `npm install`, start: `node server.js`).
3. Set the env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASS`, `NODE_ENV=production`.
4. Deploy. It connects to the same data — nothing to migrate. Share the new URL.

*(To run it on a local/office machine instead of the cloud: install Node 22+, `git clone`, `npm install`, set the same env vars, `npm start`, open `http://<that-PC-IP>:3000`.)*

## Scenario B — The database (Turso) is lost or corrupted
1. Create a fresh database (new Turso DB, or run locally with built-in SQLite).
2. Point the app/CLI at it via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
   (or unset them and set `DB_PATH` to use a local file).
3. Restore the most recent backup:
   ```powershell
   $env:TURSO_DATABASE_URL="libsql://<new-db>…turso.io"
   $env:TURSO_AUTH_TOKEN="<new token>"
   node db/restore.js backups/backup-<date>.json
   ```
   This refills every table (assets, servers, personnel, users, licenses, …).
4. Restart the app. Done.

*(No backup? The app re-seeds the original Vietnam assets, 283 personnel, servers, and
the user accounts automatically on first boot — but any edits made since launch would be lost.
That's why the weekly backup matters.)*

## Scenario C — The PC died / you lost the code
```powershell
git clone https://github.com/gvisky/asset-management.git
cd asset-management
npm install
```
Everything is back. The live site and data were never on the PC.

---

## Quick "is everything safe right now?" check
```powershell
git -C . status -sb     # should say nothing important uncommitted
git -C . push origin main   # makes sure GitHub has your latest
npm run backup          # fresh data snapshot
```

## Reference docs
- `PROJECT-STATUS.md` — modules, accounts, architecture
- `CLOUD-SETUP.md` — first-time deploy steps (Turso + Render)
