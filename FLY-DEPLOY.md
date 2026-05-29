# Deploy to the Cloud (Fly.io) — Free, Persistent

This puts the Asset Manager on the internet at a URL like
`https://asset-manager-hv.fly.dev`, reachable from anywhere — office, home, phone.
Your data lives on a **persistent volume**, so nothing is lost when the app restarts.

The Fly CLI (`flyctl`) is already installed on this PC.

> **About cost:** Fly's small free allowance covers an app this size. Fly **does ask for a
> credit card** when you sign up (to prevent abuse), but it won't charge you for staying
> within the free allowance. If you'd rather not enter a card at all, tell me — I can switch
> the app to a free cloud database (Turso) that needs no card.

---

## One-time setup

**1. Open a NEW PowerShell window** (so the newly installed `fly` command is recognised),
then go to the app folder:

```powershell
cd "C:\Users\vietnguyen\OneDrive - HAYAT HOLDING\Desktop\Code\Asset control\asset-management"
fly version          # confirms flyctl is available
```

**2. Create your Fly.io account** (opens a browser):

```powershell
fly auth signup
```
*(Already have an account? Use `fly auth login` instead.)*

**3. Pick a unique app name.** The name in `fly.toml` is `asset-manager-hv`. App names are
global, so if it's taken, open `fly.toml` and change the first line to something unique
(e.g. `asset-manager-hv-2026`). Use that same name in the commands below.

**4. Create the app, its storage volume, and the admin password, then deploy:**

```powershell
# create the app (use your chosen name)
fly apps create asset-manager-hv

# create the persistent disk in Singapore (closest region to Vietnam)
fly volumes create asset_data --region sin --size 1 --yes --app asset-manager-hv

# set Viet's admin password as a secret (choose a strong one)
fly secrets set ADMIN_PASS="choose-a-strong-password" --app asset-manager-hv

# build and deploy (Fly builds the Docker image in the cloud — no Docker needed locally)
fly deploy
```

**5. Open it:**

```powershell
fly open
```

You'll get a URL like `https://asset-manager-hv.fly.dev`. Share that with Hiep and Quoc Viet.

---

## After it's live

1. Log in as **viet** with the password you set in `ADMIN_PASS` above
   (Hiep = `hiep123`, Quoc Viet = `quocviet123` until they change theirs).
2. Everyone clicks **Change password** (top-right) on first login.
3. The 258 assets are already loaded automatically.

---

## Everyday commands

```powershell
fly deploy                 # push code changes (run from the app folder)
fly logs                   # view live server logs
fly status                 # see if the app is running
fly secrets set KEY=value  # change a setting (e.g. ADMIN_PASS)
```

The app **sleeps when no one is using it** (to stay within the free allowance) and wakes
automatically on the next visit — the first page load after idle takes a few extra seconds.

---

## Backing up your data

```powershell
# download a copy of the live database to your PC
fly ssh sftp get /data/assets.db ./assets-backup.db
```

Keep occasional backups somewhere safe (e.g. your OneDrive).
