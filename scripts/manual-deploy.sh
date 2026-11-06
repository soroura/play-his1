#!/bin/sh
# MANUAL first deploy (and the documented fallback) from the Mac: ci-upload from a clean checkout of one SHA,
# over an ssh alias that reaches the VPS (on this Mac: mrcem-vps).
#
#     sh scripts/manual-deploy.sh <ssh-alias> [<sha>]        (default: HEAD of this checkout)
#     DRY_RUN=1 sh scripts/manual-deploy.sh <ssh-alias> [<sha>]   prints the plan, touches nothing
#
# It refuses unless the commit carries `Play-check: pass ...` (scripts/ci-verify.sh), makes a clean clone of the SHA in a temporary
# directory (so uncommitted files never ship), waits for the VPS gate (load < 10, available memory > 2 GB), then runs
# ci-upload.sh -> install-release.sh -> deploy.sh on the VPS.
# Prerequisites on the VPS (owner): /opt/play-his1/.env exists (see deploy.env.example). Never run it without the owner's go.
set -eu

ALIAS=${1:-}
[ -n "$ALIAS" ] || { echo "usage: sh scripts/manual-deploy.sh <ssh-alias> [<sha>]" >&2; exit 64; }
ROOT=$(git rev-parse --show-toplevel)
SHA=$(git -C "$ROOT" rev-parse "${2:-HEAD}^{commit}")

WORK=$(mktemp -d "${TMPDIR:-/tmp}/play-his1-deploy.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" log -1 --format=%B "$SHA" > "$WORK/message.txt"
sh "$ROOT/scripts/ci-verify.sh" "$WORK/message.txt"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN - would clone $SHA from $ROOT, gate, then upload to /opt/play-his1 over ssh alias '$ALIAS'"
  exit 0
fi

CHECKOUT="$WORK/src"
git clone -q "$ROOT" "$CHECKOUT"
git -C "$CHECKOUT" checkout -q "$SHA"
printf '%s\n' "$SHA" > "$CHECKOUT/RELEASE_SHA"

cd "$CHECKOUT"
export TARGET=/opt/play-his1
export REMOTE="$ALIAS"
export SSH_OPTS="-o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 -o ConnectTimeout=20"
echo "Deploying play-his1 $SHA to $TARGET via '$ALIAS'"
sh scripts/ci-gate.sh
sh scripts/ci-upload.sh
