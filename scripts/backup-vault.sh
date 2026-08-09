#!/usr/bin/env bash
# Pull the server's vault down to a local timestamped folder.
#
# cloud auto-snapshots already guard against instance loss, but they
# live in the same AWS account — this is the off-cloud copy. The tarball
# includes vault/.history.git, so the pulled copy carries the full
# change history, not just the latest state.
#
#   bash scripts/backup-vault.sh                # -> vault-backups/<date>/
#   bash scripts/backup-vault.sh /mnt/nas/chess # -> explicit destination
set -euo pipefail

# Target configured via env (or scripts/deploy.env, gitignored) — no
# personal host baked into the repo.
[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
SSH_KEY=(); [ -n "$KEY" ] && SSH_KEY=(-i "$KEY")
DEST="${1:-vault-backups/$(date +%F)}"

mkdir -p "$DEST"
ssh "${SSH_KEY[@]}" "$HOST" 'tar czf - -C /srv chess-vault' \
  | tar xzf - -C "$DEST" --strip-components=1

echo "vault pulled to $DEST"
du -sh "$DEST"
