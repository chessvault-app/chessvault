#!/usr/bin/env bash
# Cut a release: check the tree, tag it, push. GitHub builds the installers.
#
# Usage: bash scripts/release.sh            # tag and push
#        bash scripts/release.sh --publish  # …and publish the release once built
#        bash scripts/release.sh --deploy   # …and deploy your own server too
#
# The order is load-bearing and --publish exists to make it unbreakable:
# electron-builder uploads the installers and the latest*.yml updater
# manifests into a DRAFT release for the tag, and silently skips a release
# that is already published (the build still goes green — 0.4.9 shipped
# with zero assets this way and had to be re-drafted and rebuilt). So the
# only safe sequence is tag → the desktop workflow fills the draft →
# publish LAST. --publish encodes it: wait for the build, check the assets
# are actually there, then publish.
#
# This deliberately needs NO server and no personal configuration. A release
# is a property of the project: a version, a tag, and three installers built
# from that commit. Anyone with push access can cut one.
#
# It used to deploy one particular cloud box and refuse to tag until that
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
PUBLISH=false
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=true ;;
    --publish) PUBLISH=true ;;
    *) echo "release: unknown option $arg" >&2; exit 1 ;;
  esac
done

# Publishing goes through the GitHub API; find out gh is missing before the
# tag exists, not after.
if [ "$PUBLISH" = true ] && ! command -v gh >/dev/null 2>&1; then
  echo "release: --publish needs the gh CLI (https://cli.github.com)" >&2
  exit 1
fi

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

if [ "$PUBLISH" = true ]; then
  # The run for this tag can take a few seconds to appear after the push.
  RUN=""
  for _ in $(seq 1 12); do
    RUN="$(gh run list --workflow=desktop --branch "${TAG}" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
    [ -n "$RUN" ] && break
    sleep 5
  done
  if [ -z "$RUN" ]; then
    echo "release: could not find the desktop run for ${TAG} — publish by hand once it finishes" >&2
    exit 1
  fi
  echo "release: waiting for the desktop build to fill the draft (run ${RUN})"
  gh run watch "$RUN" --exit-status --interval 30

  # A green run is not proof the upload happened — 0.4.9's was green while
  # electron-builder skipped every file. The updater manifests are the part
  # an installed app actually reads, so their presence is what gates
  # publishing.
  ASSETS="$(gh release view "${TAG}" --json assets -q '[.assets[].name] | join(" ")')"
  for manifest in latest.yml latest-mac.yml latest-linux.yml; do
    case " $ASSETS " in
      *" $manifest "*) ;;
      *)
        echo "release: draft is missing ${manifest} — NOT publishing. Assets: ${ASSETS:-none}" >&2
        exit 1
        ;;
    esac
  done
  gh release edit "${TAG}" --draft=false
  echo "release: ${TAG} published with: ${ASSETS}"
else
  echo "  watch:   gh run watch \$(gh run list --workflow=desktop --limit 1 --json databaseId -q '.[0].databaseId')"
  echo "  publish: gh release view ${TAG} --web"
  echo
  echo "  Publish only AFTER that build finishes: electron-builder fills a DRAFT"
  echo "  and silently skips a release published early, which ships no installers."
  echo "  (--publish does the waiting and the check for you.)"
  echo
  echo "  Nothing is offered to any installed app until that draft is published."
fi
[ "$DEPLOY" = true ] || echo "  If you run a server, deploy it too: bash scripts/deploy.sh"
