#!/usr/bin/env bash
# Pull the server's vault down to a local timestamped folder.
#
# Your host's own snapshots guard against instance loss, but they usually
# live in the same account as the instance — this is the copy that does
# not. The tarball includes vault/.history.git, so the pulled copy carries
# the full change history, not just the latest state.
#
#   bash scripts/backup-vault.sh                # -> vault-backups/<date>/
#   bash scripts/backup-vault.sh /mnt/nas/chess # -> explicit destination
set -euo pipefail

# Target configured via env (or scripts/deploy.env, gitignored) — no
# personal host baked into the repo.
[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
# The vault's path ON THE SERVER — named apart from CHESS_VAULT_DIR, which
# the app reads locally, so setting one for dev cannot redirect a backup.
VAULT="${CHESS_SERVER_VAULT:-/srv/chess-vault}"
SSH_KEY=(); [ -n "$KEY" ] && SSH_KEY=(-i "$KEY")
DEST="${1:-vault-backups/$(date +%F)}"

mkdir -p "$DEST"
ssh "${SSH_KEY[@]}" "$HOST" "VAULT='$VAULT' bash -s" <<'REMOTE' \
  | tar xzf - -C "$DEST" --strip-components=1
set -e
# COPYFILE_DISABLE and --no-xattrs are for a macOS server: bsdtar otherwise
# packs each file's extended attributes as an AppleDouble `._name` member
# and a LIBARCHIVE.xattr header, and GNU tar on the other end restores the
# junk files while warning about the headers it does not know. Measured on
# one 2.5 GB vault: 7,198 `._` files out of 14,085. Both are understood by
# GNU tar as well, where they change nothing.
COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C "$(dirname "$VAULT")" "$(basename "$VAULT")"
REMOTE

echo "vault pulled to $DEST"
du -sh "$DEST"
