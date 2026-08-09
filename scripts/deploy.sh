#!/usr/bin/env bash
# Push the current HEAD to your server and restart the service.
# Usage: CHESS_VAULT_HOST=user@host bash scripts/deploy.sh
#
# Configure the target with two env vars (put them in scripts/deploy.env,
# which is gitignored, so this file carries no personal infrastructure):
#   CHESS_VAULT_HOST=ubuntu@<host>     # e.g. a Tailscale tailnet address
#   CHESS_VAULT_KEY=~/.ssh/<key>.pem   # SSH key (optional; omit to use agent)
set -euo pipefail

[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
SSH_KEY=(); [ -n "$KEY" ] && SSH_KEY=(-i "$KEY")

BUNDLE=$(mktemp)
git bundle create "$BUNDLE" HEAD
scp "${SSH_KEY[@]}" "$BUNDLE" "$HOST":/tmp/deploy.bundle
rm -f "$BUNDLE"
ssh "${SSH_KEY[@]}" "$HOST" 'set -e
  cd /srv/chess-vault-app
  git fetch /tmp/deploy.bundle HEAD
  git reset --hard FETCH_HEAD
  npm ci --no-audit --no-fund >/dev/null
  npm run build >/dev/null
  sudo systemctl restart chess-vault
  sleep 3
  systemctl is-active chess-vault'
echo "deployed to $HOST"
