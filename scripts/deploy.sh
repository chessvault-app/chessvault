#!/usr/bin/env bash
# Push the current HEAD to your server and restart the service.
# Usage: CHESS_VAULT_HOST=user@host bash scripts/deploy.sh
#
# Configure the target with env vars (put them in scripts/deploy.env, which
# is gitignored, so this file carries no personal infrastructure — see
# scripts/deploy.env.example):
#   CHESS_VAULT_HOST=ubuntu@<host>     # e.g. a Tailscale tailnet address
#   CHESS_VAULT_KEY=~/.ssh/<key>.pem   # SSH key (optional; omit to use agent)
#   CHESS_APP_DIR=/srv/chess-vault-app # checkout on the server
#   CHESS_SERVICE=chess-vault          # systemd unit to restart
#
# The last two default to the layout the README describes, so an unmodified
# copy of that layout needs neither. They are variables rather than constants
# because a hardcoded directory and unit name made this one machine's script
# — everything else here is general.
#
# Assumed on the server: systemd, and sudo without a password prompt for the
# restart. Anything else is a one-line edit at the bottom.
set -euo pipefail

[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
APP_DIR="${CHESS_APP_DIR:-/srv/chess-vault-app}"
SERVICE="${CHESS_SERVICE:-chess-vault}"
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
# The heredoc is quoted, so nothing expands here; the two settings arrive as
# environment on the remote command line instead. Interpolating them into the
# script text would put local quoting rules in charge of a remote path.
ssh "${SSH_KEY[@]}" "$HOST" "APP_DIR='$APP_DIR' SERVICE='$SERVICE' bash -s" <<'REMOTE'
set -e
cd "$APP_DIR"
git fetch /tmp/deploy.bundle HEAD
git reset --hard FETCH_HEAD
npm ci --no-audit --no-fund >/dev/null
rm -rf dist && tar xzf /tmp/deploy-dist.tar.gz && rm /tmp/deploy-dist.tar.gz
# Derived tables and indexes the API relies on. Idempotent and a no-op in
# milliseconds once applied, so it is cheaper to run every deploy than to
# remember which databases predate which optimisation.
npx tsx scripts/tune-dbs.ts
sudo systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE"
REMOTE
echo "deployed to $HOST"
