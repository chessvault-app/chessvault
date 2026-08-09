#!/usr/bin/env bash
# Push the current HEAD to the cloud server and restart the service.
# Usage: bash scripts/deploy.sh
set -euo pipefail
HOST=ubuntu@your-host
KEY=~/.ssh/your-key.pem

git bundle create /tmp/chess-vault-deploy.bundle HEAD
scp -i "$KEY" /tmp/chess-vault-deploy.bundle "$HOST":/tmp/deploy.bundle
ssh -i "$KEY" "$HOST" 'set -e
  cd /srv/chess-vault-app
  git fetch /tmp/deploy.bundle HEAD
  git reset --hard FETCH_HEAD
  npm ci --no-audit --no-fund >/dev/null
  npm run build >/dev/null
  sudo systemctl restart chess-vault
  sleep 3
  systemctl is-active chess-vault'
echo "deployed: https://3-34-238-216.sslip.io"
