#!/usr/bin/env bash
# Apply a new app version on the server after extracting an app-only package over the app folder.
#
#   bash deploy/update-server.sh
#
# Your data (data/ folder) is not touched. A backup is taken first.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> Backing up data"
node scripts/backup.js

echo "==> Installing dependencies"
npm ci --omit=dev || npm install --omit=dev
node -e "require('sharp')" >/dev/null 2>&1 || npm install --omit=dev --include=optional sharp

echo "==> Restarting"
pm2 restart pms --update-env
sleep 2
curl -fsS http://127.0.0.1:5050/api/health >/dev/null && echo "Updated and running."
