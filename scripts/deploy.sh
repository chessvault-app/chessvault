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

# The native fast path, rebuilt against the commit that was just deployed.
#
# This is not an optimisation step, it is a correctness one. The binary
# lives under native/target/, which is gitignored — so the `git reset
# --hard` above does NOT touch it, and without this a binary compiled from
# an older commit would go on answering beside this commit's JavaScript.
# The golden fixtures prove the two agree AT THE SAME COMMIT and say
# nothing about that pairing; a zobrist or schema change between them is
# silent wrong answers, which is the one failure this whole pipeline was
# built to make impossible.
#
# A no-op in about a second when nothing changed, and skipped entirely on
# a box with no Rust toolchain — the server then spawns the JavaScript
# children exactly as it always has. A FAILED build deletes the old
# binary rather than leaving it: falling back to JavaScript is slower and
# right, where a stale binary is fast and wrong.
if [ -x "$HOME/.cargo/bin/cargo" ] || command -v cargo >/dev/null 2>&1; then
  if ! PATH="$HOME/.cargo/bin:$PATH" nice -n 19 \
      cargo build --release --manifest-path native/Cargo.toml; then
    echo "deploy: native build FAILED — dropping the old binary so the" >&2
    echo "        server falls back to the JavaScript jobs (slower, correct)" >&2
    rm -f native/target/release/chessvault-core
  fi
fi

sudo systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE"
REMOTE
echo "deployed to $HOST"
