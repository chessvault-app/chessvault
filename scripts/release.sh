#!/usr/bin/env bash
# Cut a release: check the tree, tag it, push. GitHub builds the installers.
#
# Usage: bash scripts/release.sh            # tag and push
#        bash scripts/release.sh --deploy   # …and deploy your own server too
#
# This deliberately needs NO server and no personal configuration. A release
# is a property of the project: a version, a tag, and three installers built
# from that commit. Anyone with push access can cut one.
#
# It used to deploy a particular cloud box and refuse to tag until that
# box answered — which made releasing depend on one person's private
# infrastructure being reachable, and meant nobody else could do it at all.
# Deploying a server is a separate act, run by whoever operates that server,
# whenever they choose: scripts/deploy.sh.
#
# The two are still related, and here is the honest version of that
# relationship: in REMOTE mode the desktop app loads the SERVER's web build,
# so a server left on an older commit will disagree with a freshly installed
# app about what version it is. Settings shows both numbers for exactly this
# reason. If you run a server, deploy it around the same time — `--deploy`
# does that for you.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY=false
[ "${1:-}" = "--deploy" ] && DEPLOY=true

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

# A dirty tree means the build would not match the commit it claims to be —
# and the commit is all GitHub has to build from.
if [ -n "$(git status --porcelain)" ]; then
  echo "release: working tree is dirty — commit first, so the build matches a commit" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "release: tag ${TAG} already exists — bump the version in package.json first" >&2
  exit 1
fi

# Push access is what a release actually requires; find out now rather than
# after the tag exists locally.
if ! git ls-remote --exit-code origin >/dev/null 2>&1; then
  echo "release: cannot reach origin" >&2
  exit 1
fi

echo "release: checking ${VERSION}"
npm run typecheck
npm test

if [ "$DEPLOY" = true ]; then
  echo "release: deploying your server"
  bash "$ROOT/scripts/deploy.sh"
fi

git tag -a "${TAG}" -m "Release ${VERSION}"
git push origin "${TAG}"

echo
echo "release: tagged ${TAG} and pushed"
echo "  GitHub is now building Windows, macOS and Linux onto one DRAFT release."
echo "  watch:   gh run watch \$(gh run list --workflow=desktop --limit 1 --json databaseId -q '.[0].databaseId')"
echo "  publish: gh release view ${TAG} --web"
echo
echo "  Nothing is offered to any installed app until that draft is published."
[ "$DEPLOY" = true ] || echo "  If you run a server, deploy it too: bash scripts/deploy.sh"
