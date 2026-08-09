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
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Build the web app HERE, not on the server: `vite build` is the heaviest
# step and a small (2 GB) box can OOM under it — which once left a
# half-written dist/ serving stale assets. The server only runs `npm ci`
# (runtime deps for the TS server) and takes the finished dist/ we ship.
( cd "$ROOT" && npm run build >/dev/null )

BUNDLE=$(mktemp)
DIST=$(mktemp)
git -C "$ROOT" bundle create "$BUNDLE" HEAD
tar czf "$DIST" -C "$ROOT" dist
scp "${SSH_KEY[@]}" "$BUNDLE" "$HOST":/tmp/deploy.bundle
scp "${SSH_KEY[@]}" "$DIST" "$HOST":/tmp/deploy-dist.tar.gz
rm -f "$BUNDLE" "$DIST"
ssh "${SSH_KEY[@]}" "$HOST" 'set -e
  cd /srv/chess-vault-app
  git fetch /tmp/deploy.bundle HEAD
  git reset --hard FETCH_HEAD
  npm ci --no-audit --no-fund >/dev/null
  rm -rf dist && tar xzf /tmp/deploy-dist.tar.gz && rm /tmp/deploy-dist.tar.gz
  sudo systemctl restart chess-vault
  sleep 3
  systemctl is-active chess-vault'
echo "deployed to $HOST"
