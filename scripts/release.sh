#!/usr/bin/env bash
# Cut a desktop release: build it, publish it, and deploy the server.
# Usage: CHESS_UPDATE_URL=https://<host>/updates bash scripts/release.sh
#
# Configure the target in scripts/deploy.env, which is gitignored, so this
# file carries no personal infrastructure:
#   CHESS_VAULT_HOST=ubuntu@<host>
#   CHESS_VAULT_KEY=~/.ssh/<key>.pem      # optional; omit to use an agent
#   CHESS_UPDATE_URL=https://<host>/updates
#
# All three steps or none. Publishing an installer without deploying the
# server leaves them disagreeing about what version this is — and in remote
# mode the desktop app runs the SERVER's web build, so the mismatch is real
# and not merely cosmetic. electron-builder cannot do this itself: its
# `generic` provider is download-only, so `--publish always` has nothing to
# upload with, which is why releases were being done by hand.
set -euo pipefail

[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
UPDATE_URL="${CHESS_UPDATE_URL:?set CHESS_UPDATE_URL=https://<host>/updates}"
UPDATES_DIR="${CHESS_UPDATES_DIR:-/srv/chess-vault-updates}"
SSH_KEY=(); [ -n "$KEY" ] && SSH_KEY=(-i "$KEY")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
INSTALLER="release/installer/Chess Vault Setup ${VERSION}.exe"

# A dirty tree means the build would not match the commit it claims to be.
if [ -n "$(git status --porcelain)" ]; then
  echo "release: working tree is dirty — commit first, so the build matches a commit" >&2
  exit 1
fi

echo "release: building ${VERSION}"
CHESS_UPDATE_URL="$UPDATE_URL" npm run desktop:package >/dev/null

[ -f "$INSTALLER" ] || { echo "release: no installer at ${INSTALLER}" >&2; exit 1; }
[ -f release/installer/latest.yml ] || { echo "release: no latest.yml" >&2; exit 1; }

echo "release: publishing to ${HOST}:${UPDATES_DIR}"
scp "${SSH_KEY[@]}" \
  "$INSTALLER" \
  "${INSTALLER}.blockmap" \
  release/installer/latest.yml \
  "$HOST:$UPDATES_DIR/"

echo "release: deploying the server"
bash "$ROOT/scripts/deploy.sh"

# Prove it rather than assume it: the feed and the server must both say the
# version we just built, or the release is half-done.
FEED="$(ssh "${SSH_KEY[@]}" "$HOST" "curl -s http://127.0.0.1:8787/updates/latest.yml | head -1")"
SERVED="$(ssh "${SSH_KEY[@]}" "$HOST" "curl -s http://127.0.0.1:8787/api/health")"
echo
echo "release: ${VERSION} done"
echo "  feed    ${FEED}"
echo "  server  ${SERVED}"
case "$FEED" in *"$VERSION"*) ;; *) echo "release: FEED DOES NOT NAME ${VERSION}" >&2; exit 1;; esac
case "$SERVED" in *"$VERSION"*) ;; *) echo "release: SERVER DOES NOT REPORT ${VERSION}" >&2; exit 1;; esac
