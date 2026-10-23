#!/usr/bin/env bash
# One-time setup of the Product Management System on a fresh Ubuntu server
# (made for Oracle Cloud "Always Free"; works on any Ubuntu 22.04/24.04 server).
#
#   sudo bash deploy/setup-server.sh <your-address.duckdns.org> [duckdns-token]
#
# Installs Node.js 24, Caddy (automatic HTTPS) and PM2, opens ports 80/443, starts the app,
# makes it start again after a reboot, schedules a nightly backup and sets the QR code address.
# Safe to run again.
set -euo pipefail

DOMAIN="${1:-}"
DUCK_TOKEN="${2:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash deploy/setup-server.sh <your-address.duckdns.org> [duckdns-token]"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-ubuntu}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
cd "$APP_DIR"
# Run a command as the normal user (not root), in the app folder.
as_app() { sudo -u "$APP_USER" -H env "PATH=$PATH" "$@"; }
step() { echo; echo "==> $*"; }

MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [[ "$MEM_MB" -lt 1800 && "$(swapon --show | wc -l)" -eq 0 ]]; then
  step "Small server (${MEM_MB} MB RAM): adding 2 GB swap space"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip iptables-persistent netfilter-persistent
if ! apt-get install -y caddy; then
  # Older Ubuntu releases: use Caddy's official package repository.
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

NODE_MAJOR="$( (node -v 2>/dev/null || echo v0) | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  step "Installing Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js $(node -v)"
command -v pm2 >/dev/null || npm install -g pm2

step "Opening web ports 80 and 443 in the server firewall"
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    # Oracle images end the INPUT chain with a REJECT rule: insert before it.
    pos="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')"
    if [[ -n "$pos" ]]; then
      iptables -I INPUT "$pos" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    else
      iptables -A INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    fi
  fi
done
netfilter-persistent save
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

step "Installing the app"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
if [[ ! -f .env ]]; then
  printf 'PORT=5050\nHOST=127.0.0.1\nSECURE_COOKIES=true\nTRUST_PROXY=true\nNODE_ENV=production\n' > .env
  chown "$APP_USER":"$APP_USER" .env
fi
as_app npm ci --omit=dev || as_app npm install --omit=dev
# Image processing needs the Linux build of sharp; install it if the lockfile missed it.
if ! as_app node -e "require('sharp')" >/dev/null 2>&1; then
  as_app npm install --omit=dev --include=optional sharp
fi
if [[ ! -f client/dist/index.html ]]; then
  as_app npm install
  as_app npm run build
fi

step "Preparing the database and QR code address"
as_app node scripts/set-public-url.js "https://$DOMAIN"

step "Starting the app with PM2"
if as_app pm2 describe pms >/dev/null 2>&1; then
  as_app pm2 restart pms --update-env
else
  as_app pm2 start server/index.js --name pms
fi
as_app pm2 save
pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null

step "Configuring HTTPS for $DOMAIN"
printf '%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:5050\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

step "Scheduling a nightly backup (02:00, keeps the last 14)"
CRON_TMP="$(mktemp)"
(crontab -u "$APP_USER" -l 2>/dev/null || true) | grep -v 'scripts/backup.js' | grep -v 'duckdns.org/update' > "$CRON_TMP" || true
echo "0 2 * * * cd '$APP_DIR' && $(command -v node) scripts/backup.js >> data/logs/backup.log 2>&1" >> "$CRON_TMP"
if [[ -n "$DUCK_TOKEN" && "$DOMAIN" == *.duckdns.org ]]; then
  SUB="${DOMAIN%.duckdns.org}"
  # Keep the DuckDNS address pointing at this server.
  echo "*/10 * * * * curl -fsS 'https://www.duckdns.org/update?domains=$SUB&token=$DUCK_TOKEN&ip=' >/dev/null 2>&1" >> "$CRON_TMP"
  curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$DUCK_TOKEN&ip=" && echo " (DuckDNS address updated)"
fi
crontab -u "$APP_USER" "$CRON_TMP"
rm -f "$CRON_TMP"

step "Checking"
sleep 2
if curl -fsS http://127.0.0.1:5050/api/health >/dev/null; then
  echo "App is running."
else
  echo "The app did not answer. See the log with:  pm2 logs pms"
  exit 1
fi
echo
echo "Done. Open https://$DOMAIN"
echo "(The HTTPS certificate is issued on the first visit. If the page does not open, check that"
echo " $DOMAIN points to this server's IP and that ports 80 and 443 are open in the Oracle security list.)"
