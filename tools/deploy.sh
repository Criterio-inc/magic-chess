#!/usr/bin/env bash
# Driftsätter Marble & Mayhem på Vultr-boxen: statiska filer via Caddy (automatisk HTTPS) och onlineservern
# som systemd-tjänst bakom /ws. Idempotent: kör igen för att uppdatera.
#
#   tools/deploy.sh                 # bygg + skicka + starta om
#   DOMAIN=annan.bjarby.com tools/deploy.sh
#
# Kräver: ssh-nyckel till root@HOST och en A-post för DOMAIN som pekar på HOST (Caddy hämtar certifikatet själv).
set -euo pipefail
HOST=${HOST:-root@70.34.220.159}
DOMAIN=${DOMAIN:-mayhem.bjarby.com}
APP=/opt/marble-mayhem
PORT=${PORT:-8243}
cd "$(dirname "$0")/.."

echo "› bygger"
npm run build >/dev/null

# servern behöver bara ws och chess.js, inte hela klientens beroenden
mkdir -p build/deploy
node -e "
const p = require('./package.json');
const out = { name: 'marble-mayhem-server', private: true, type: 'module',
  dependencies: { ws: p.dependencies.ws, 'chess.js': p.dependencies['chess.js'] } };
require('fs').writeFileSync('build/deploy/package.json', JSON.stringify(out, null, 2));
"

echo "› skickar till $HOST:$APP"
ssh "$HOST" "mkdir -p $APP/dist $APP/server"
rsync -az --delete dist/ "$HOST:$APP/dist/"
rsync -az --delete --exclude data --exclude test.mjs server/ "$HOST:$APP/server/"
rsync -az build/deploy/package.json "$HOST:$APP/package.json"

echo "› installerar och startar"
ssh "$HOST" APP="$APP" PORT="$PORT" DOMAIN="$DOMAIN" bash -s <<'REMOTE'
set -euo pipefail
id mayhem >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin mayhem
mkdir -p /var/lib/marble-mayhem && chown mayhem /var/lib/marble-mayhem
cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null

cat > /etc/systemd/system/marble-mayhem.service <<UNIT
[Unit]
Description=Marble & Mayhem onlineserver
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
User=mayhem
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DATA_FILE=/var/lib/marble-mayhem/rooms.json
Environment=TRUST_PROXY=1
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/marble-mayhem

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable marble-mayhem >/dev/null 2>&1
systemctl restart marble-mayhem

if ! grep -q "^$DOMAIN {" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  cat >> /etc/caddy/Caddyfile <<CADDY

$DOMAIN {
    encode zstd gzip

    handle /ws {
        reverse_proxy localhost:$PORT
    }

    handle {
        root * $APP/dist
        @immutable path /assets/*
        header @immutable Cache-Control "public, max-age=31536000, immutable"
        try_files {path} /index.html
        file_server
    }
}
CADDY
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
sleep 1
systemctl is-active marble-mayhem
REMOTE
echo "› klart: https://$DOMAIN"
