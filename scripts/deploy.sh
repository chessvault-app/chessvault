#!/usr/bin/env bash
# Push the current HEAD to the cloud server and restart the service.
# Usage: bash scripts/deploy.sh
#
# SSH goes over the Tailscale tailnet (public port 22 is closed); the key
# still authenticates, the tunnel is just private. Override CHESS_VAULT_HOST
# to reach it another way. The tailnet name resolves if MagicDNS is on;
# the 100.x address is the stable fallback.
set -euo pipefail
HOST="${CHESS_VAULT_HOST:-ubuntu@your-host}"
KEY="${CHESS_VAULT_KEY:-~/.ssh/your-key.pem}"

BUNDLE=$(mktemp)
git bundle create "$BUNDLE" HEAD
scp -i "$KEY" "$BUNDLE" "$HOST":/tmp/deploy.bundle
rm -f "$BUNDLE"
ssh -i "$KEY" "$HOST" 'set -e
  cd /srv/chess-vault-app
  git fetch /tmp/deploy.bundle HEAD
  git reset --hard FETCH_HEAD
  npm ci --no-audit --no-fund >/dev/null
  npm run build >/dev/null
  sudo systemctl restart chess-vault
  sleep 3
  systemctl is-active chess-vault'
echo "deployed: https://3-34-238-216.sslip.io (SSH via tailnet $HOST)"
