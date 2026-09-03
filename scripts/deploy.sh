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
#   CHESS_SERVICE=chess-vault          # service to restart (see below)
#   CHESS_REMOTE_PATH=/opt/node/bin    # prepended to PATH on the server
#
# APP_DIR and SERVICE default to the layout the README describes, so an
# unmodified copy of that layout needs neither. They are variables rather than
# constants because a hardcoded directory and unit name made this one
# machine's script — everything else here is general.
#
# Two server layouts are supported, chosen by `uname` at the bottom: a Linux
# box running a systemd unit (restarted with sudo, so that host needs sudo
# without a password prompt), or a macOS box running a per-user LaunchAgent,
# where SERVICE is the plist's Label and no privilege is needed at all.
#
# CHESS_REMOTE_PATH exists because the deploy's shell is non-interactive and
# reads no profile: a node installed anywhere but a system directory is simply
# absent, and `npm ci` fails on a box where node works fine when you log in.
set -euo pipefail

[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
APP_DIR="${CHESS_APP_DIR:-/srv/chess-vault-app}"
SERVICE="${CHESS_SERVICE:-chess-vault}"
REMOTE_PATH="${CHESS_REMOTE_PATH:-}"
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
# Staged in a directory the remote makes fresh for this deploy, not at a
# fixed name under /tmp: a fixed name is one any other account on the box
# can create first (as a symlink scp would follow) or swap between the copy
# and the fetch, and the service would then run that account's commit.
STAGE=$(ssh "${SSH_KEY[@]}" "$HOST" 'mktemp -d')
scp "${SSH_KEY[@]}" "$BUNDLE" "$HOST":"$STAGE/deploy.bundle"
scp "${SSH_KEY[@]}" "$DIST" "$HOST":"$STAGE/deploy-dist.tar.gz"
rm -f "$BUNDLE" "$DIST"
# The heredoc is quoted, so nothing expands here; the settings arrive as
# environment on the remote command line instead, each one quoted for the
# remote shell by printf %q, so a path holding a quote or a space is still
# one value there. Interpolating them into the script text would put local
# quoting rules in charge of a remote path.
REMOTE_ENV="APP_DIR=$(printf %q "$APP_DIR") SERVICE=$(printf %q "$SERVICE") REMOTE_PATH=$(printf %q "$REMOTE_PATH") STAGE=$(printf %q "$STAGE")"
# Git Bash on Windows rewrites any argument that looks like a POSIX path
# before a Windows program sees it, and the remote command below starts
# with one: APP_DIR=/Users/... arrived at the server as
# C:/Program Files/Git/Users/..., and the deploy died in the remote cd.
# This tells MSYS to leave arguments with that prefix alone; every other
# shell ignores the variable. Only this call needs it: the mktemp call
# carries no path and scp's remote args carry a host in front.
MSYS2_ARG_CONV_EXCL="APP_DIR=" ssh "${SSH_KEY[@]}" "$HOST" "$REMOTE_ENV bash -s" <<'REMOTE'
set -e
if [ -n "${REMOTE_PATH:-}" ]; then PATH="$REMOTE_PATH:$PATH"; fi
cd "$APP_DIR"
git fetch "$STAGE/deploy.bundle" HEAD
git reset --hard FETCH_HEAD
npm ci --no-audit --no-fund >/dev/null
rm -rf dist && tar xzf "$STAGE/deploy-dist.tar.gz" && rm -rf "$STAGE"
# Derived tables and indexes the API relies on. Idempotent and a no-op in
# milliseconds once applied, so it is cheaper to run every deploy than to
# remember which databases predate which optimisation. The first deploy
# after a new derivation is the exception, and the old server keeps
# answering while it runs: the top-games ranking took about half an hour
# per 10 M-game file (measured on a 3 M-row slice).
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

# Restart, then prove it came back — a deploy that leaves the service down
# and says "deployed" is the worst of the failure modes.
if [ "$(uname)" = "Darwin" ]; then
  # A per-user LaunchAgent: no sudo, and none available — a Mac does not
  # have passwordless sudo unless somebody went and configured it, so a
  # `sudo` here would hang the deploy on a password prompt instead of
  # failing. `kickstart -k` stops the job and starts it again.
  launchctl kickstart -k "gui/$(id -u)/$SERVICE"
  sleep 3
  launchctl print "gui/$(id -u)/$SERVICE" | grep -qE '^[[:space:]]*(state = running|pid = [0-9]+)'
else
  sudo systemctl restart "$SERVICE"
  sleep 3
  systemctl is-active "$SERVICE"
fi
REMOTE
echo "deployed to $HOST"
