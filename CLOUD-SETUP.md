# Put the App Online — Free, No Credit Card

This gives your team one web address (e.g. `https://asset-management-xxxx.onrender.com`)
that Viet, Hiep, and Quoc Viet open from any computer or phone, anywhere. Everyone sees the
same live data. **Nothing to install.**

Two free services, neither asks for a credit card:

| Piece | Service | What it does |
|-------|---------|--------------|
| **Database** | [Turso](https://turso.tech) | Holds the shared data (SQLite in the cloud) |
| **App host** | [Render](https://render.com) | Runs the website |

The app automatically loads your 258 assets and the 3 user accounts into the database
the first time it connects.

---

## Step 1 — Create the shared database (Turso)

1. Go to **https://turso.tech** and sign up (GitHub or email — no card).
2. Create a database (the dashboard has a "Create Database" button). Pick a region near
   Vietnam (e.g. Singapore / `ap-...`). Name it e.g. `assets`.
3. Open the database and copy two things:
   - the **Database URL** — looks like `libsql://assets-yourname.turso.io`
   - a **token** — click "Create Token" and copy the long string.

   *(If you prefer the command line: install the Turso CLI, then
   `turso db create assets`, `turso db show assets --url`, `turso db tokens create assets`.)*

Keep the URL and token handy for Step 3.

---

## Step 2 — Put the code on GitHub

1. Create a free account at **https://github.com** if you don't have one.
2. Create a new **repository** (e.g. `asset-management`). It can be private or public —
   your data isn't stored in the code, it's in Turso.
3. On this PC, in a new terminal, push the folder (Git is already installed):

   ```powershell
   cd "C:\Users\vietnguyen\OneDrive - HAYAT HOLDING\Desktop\Code\Asset control\asset-management"
   git init
   git add .
   git commit -m "Asset Manager"
   git branch -M main
   git remote add origin https://github.com/<your-username>/asset-management.git
   git push -u origin main
   ```
   *(A browser window will pop up to log in to GitHub the first time — that's normal.)*

---

## Step 3 — Deploy on Render

1. Sign up at **https://render.com** (use "Sign in with GitHub" — no card).
2. Click **New → Web Service**, choose your `asset-management` repo.
3. Render auto-detects the settings from `render.yaml`. Confirm:
   - Build command: `npm install`
   - Start command: `node server.js`
   - Plan: **Free**
4. Under **Environment**, add these variables (from Step 1):
   - `TURSO_DATABASE_URL` = your `libsql://...` URL
   - `TURSO_AUTH_TOKEN`   = your Turso token
   - `ADMIN_PASS`         = a strong password for Viet
   - `NODE_ENV`           = `production`
5. Click **Create Web Service**. After a few minutes you get a public URL.

---

## Step 4 — Use it

1. Open the Render URL. Log in:
   - **viet** / the `ADMIN_PASS` you set   (administrator)
   - **hiep** / `hiep123`   (editor)
   - **quocviet** / `quocviet123`   (editor)
2. Everyone clicks **Change password** (top-right) on first login.
3. Share the URL with the team. Done — shared, live, multi-location.

---

## Notes

- **Free Render apps sleep after ~15 minutes of no use** and wake on the next visit, so the
  first page load after a quiet period takes ~30 seconds. Your data is never lost (it's in
  Turso). If you want it always-on, Render's paid plan removes the sleep.
- **To update the app later:** make changes, then `git push` — Render redeploys automatically.
- **Backups:** in the Turso dashboard you can export/dump the database, or use
  `turso db shell assets ".dump" > backup.sql`.
- Everything still runs locally with no setup (`node server.js` → uses a local database file).
  The cloud database only activates when `TURSO_DATABASE_URL` is set.
