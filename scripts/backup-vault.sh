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

HOST="${CHESS_VAULT_HOST:-ubuntu@your-host}"
KEY="${CHESS_VAULT_KEY:-$HOME/.ssh/your-key.pem}"
DEST="${1:-vault-backups/$(date +%F)}"

mkdir -p "$DEST"
ssh -i "$KEY" "$HOST" 'tar czf - -C /srv chess-vault' \
  | tar xzf - -C "$DEST" --strip-components=1

echo "vault pulled to $DEST"
du -sh "$DEST"
