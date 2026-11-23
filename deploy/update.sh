#!/usr/bin/env bash
# First start and every update:  ./update.sh   (from the deploy/ folder)
# Pulls the latest code from GitHub, rebuilds the image and restarts the app (a few seconds).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Missing deploy/.env — run: cp .env.example .env && nano .env"; exit 1; }

if [ "${1:-}" != "--no-pull" ]; then git -C .. pull --ff-only; fi
export APP_COMMIT="$(git -C .. rev-parse --short HEAD)"
echo "▶ Building asset-management ${APP_COMMIT} …"
mkdir -p backups data
docker compose build app
docker compose up -d --remove-orphans
mkdir -p backups data

echo "▶ Waiting for the app to answer …"
PORT="$(grep -E '^LOCAL_PORT=' .env | cut -d= -f2)"; PORT="${PORT:-3010}"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/version" >/dev/null 2>&1; then
    echo "✓ Running: $(curl -fsS "http://127.0.0.1:${PORT}/api/version")"
    docker compose ps
    exit 0
  fi
  sleep 2
done
echo "✗ The app did not answer on 127.0.0.1:${PORT} — last log lines:"
docker compose logs --tail=60 app
exit 1
