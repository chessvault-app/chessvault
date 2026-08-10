#!/usr/bin/env bash
# Send locally-built vault content up to the server.
#
# backup-vault.sh pulls; this is the other direction, and it exists because
# an imported book is built on a workstation (renders, models, an hour of
# CPU) and has to reach the machine that serves it. It is NOT a general
# sync: it pushes the content a build produces and nothing else.
#
#   bash scripts/push-vault.sh                     # puzzlebooks + studies
#   bash scripts/push-vault.sh puzzlebooks         # just one subtree
#
# WHAT IT WILL NOT TOUCH. progress.json and ocr.json belong to whoever has
# been using the server — solved counts, attempt history, hand-made OCR
# templates. They are never in the archive, so the server's copies survive
# a push that replaces everything around them. The server also auto-commits
# every vault change to .history.git, so an overwrite is recoverable.
set -euo pipefail

[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
SSH_KEY=(); [ -n "$KEY" ] && SSH_KEY=(-i "$KEY")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${CHESS_VAULT_REMOTE_DIR:-/srv/chess-vault}"

TREES=("$@")
[ ${#TREES[@]} -eq 0 ] && TREES=(puzzlebooks studies)

for tree in "${TREES[@]}"; do
  [ -d "$ROOT/vault/$tree" ] || { echo "no vault/$tree here — skipping"; continue; }
  bytes=$(du -sh "$ROOT/vault/$tree" | cut -f1)
  echo "pushing vault/$tree ($bytes)…"
  tar czf - -C "$ROOT/vault" \
    --exclude='progress.json' --exclude='ocr.json' \
    "$tree" \
    | ssh "${SSH_KEY[@]}" "$HOST" "tar xzf - -C '$REMOTE'"
done

ssh "${SSH_KEY[@]}" "$HOST" "
  echo '--- server vault now ---'
  for b in '$REMOTE'/puzzlebooks/*/; do
    [ -d \"\$b\" ] || continue
    printf '  %-44s %s\n' \"\$(basename \"\$b\")\" \"\$(ls \"\$b\" | tr '\n' ' ')\"
  done
  ls '$REMOTE'/studies 2>/dev/null | sed 's/^/  study: /'
  du -sh '$REMOTE'
"
