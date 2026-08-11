#!/usr/bin/env bash
# Cut a release: deploy the server, verify it, then tag — and the tag makes
# GitHub build and draft the installers.
#
# Usage: bash scripts/release.sh
#
# Configure the target in scripts/deploy.env, which is gitignored, so this
# file carries no personal infrastructure (see scripts/deploy.env.example):
#   CHESS_VAULT_HOST=ubuntu@<host>
#   CHESS_VAULT_KEY=~/.ssh/<key>.pem      # optional; omit to use an agent
#
# This used to build the installer here and scp it to the server, because
# electron-builder's `generic` provider is download-only and had nothing to
# upload with. Publishing now goes through GitHub releases, so the halves
# separate:
#
#   here    deploy the server, prove it is serving this version, push the tag
#   Actions build Windows, macOS and Linux, and put them on ONE draft release
#   you    check both, then press Publish
#
# They stay connected by the tag and by the draft. In remote mode the desktop
# app runs the SERVER's web build, so an installer released without a
# matching deploy leaves the two disagreeing about what version this is. The
# deploy happens first and the draft holds the installers back until a human
# agrees, which is the same guarantee the old all-or-nothing script gave.
set -euo pipefail

[ -f "$(dirname "$0")/deploy.env" ] && . "$(dirname "$0")/deploy.env"
HOST="${CHESS_VAULT_HOST:?set CHESS_VAULT_HOST=user@host (see scripts/deploy.env)}"
KEY="${CHESS_VAULT_KEY:-}"
SSH_KEY=(); [ -n "$KEY" ] && SSH_KEY=(-i "$KEY")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

# A dirty tree means what gets built would not match the commit it claims to
# be — and here the commit is all GitHub has to build from.
if [ -n "$(git status --porcelain)" ]; then
  echo "release: working tree is dirty — commit first, so the build matches a commit" >&2
  exit 1
fi

# Stop before touching the server if the tag is already taken: the build is
# triggered by pushing it, so an existing tag means there is nothing to
# trigger and the version was probably not bumped.
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "release: tag ${TAG} already exists — bump the version in package.json first" >&2
  exit 1
fi

echo "release: deploying ${VERSION} to the server"
bash "$ROOT/scripts/deploy.sh"

# Prove it rather than assume it.
SERVED="$(ssh "${SSH_KEY[@]}" "$HOST" "curl -s http://127.0.0.1:8787/api/health")"
case "$SERVED" in
  *"$VERSION"*) echo "release: server reports ${VERSION}" ;;
  *) echo "release: SERVER DOES NOT REPORT ${VERSION} — got: ${SERVED}" >&2; exit 1 ;;
esac

# The tag is now load-bearing: it is what starts the desktop build and the
# demo rebuild. Failing to push it is a failed release, not a footnote —
# which is why this is fatal where the old script's tagging was not.
git tag -a "${TAG}" -m "Release ${VERSION}"
git push origin "${TAG}"

echo
echo "release: ${VERSION} deployed and tagged"
echo "  the desktop workflow is now building all three platforms onto a DRAFT release"
echo "  watch:   gh run watch \$(gh run list --workflow=desktop --limit 1 --json databaseId -q '.[0].databaseId')"
echo "  then:    gh release view ${TAG} --web    # check the assets, press Publish"
echo
echo "  Nothing updates for anyone until that draft is published."
