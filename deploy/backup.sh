#!/usr/bin/env bash
# Nightly full backup (every table) → deploy/backups/assets-YYYY-MM-DD.db.gz
# Works for both Turso and the local database. Keeps BACKUP_KEEP_DAYS days (default 30).
# Optional off-site copy with rclone: set BACKUP_RCLONE_REMOTE in .env.
#
# cron (as the user that runs docker):   15 2 * * *  /opt/asset-management/deploy/backup.sh >> /opt/asset-management/deploy/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
KEEP="$(grep -E '^BACKUP_KEEP_DAYS=' .env | cut -d= -f2)"; KEEP="${KEEP:-30}"
REMOTE="$(grep -E '^BACKUP_RCLONE_REMOTE=' .env | cut -d= -f2- || true)"
NAME="assets-$(date +%F_%H%M).db"
mkdir -p backups
echo "[$(date -Is)] backup → backups/${NAME}.gz"
docker compose exec -T app node scripts/db-snapshot.js "/app/backups/${NAME}" --force
gzip -f "backups/${NAME}"
find backups -name 'assets-*.db.gz' -mtime +"${KEEP}" -delete
if [ -n "${REMOTE}" ] && command -v rclone >/dev/null; then rclone copy "backups/${NAME}.gz" "${REMOTE}"; fi
ls -lh "backups/${NAME}.gz"
