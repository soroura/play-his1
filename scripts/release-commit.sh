#!/bin/sh
# Create the release commit: an EMPTY commit on top of the tested tree whose message carries the trailer
#     Play-check: pass YYYY-MM-DD N
# that the Woodpecker `verify` step (scripts/ci-verify.sh) requires. Refuses unless
#   (a) the working tree is clean, and
#   (b) .check/last-pass (scripts/play-check.sh) records the SAME git tree as HEAD, i.e. the check ran on exactly this tree.
# It never pushes.
#     sh scripts/release-commit.sh "release: <subject>"
#     sh scripts/release-commit.sh --print "release: <subject>"   (or DRY_RUN=1) prints the trailer, commits nothing
set -eu

PRINT=${DRY_RUN:-0}
if [ "${1:-}" = "--print" ]; then PRINT=1; shift; fi
SUBJECT=${1:-}
[ -n "$SUBJECT" ] || { echo "usage: sh scripts/release-commit.sh [--print] \"<subject>\"" >&2; exit 64; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
MARKER=${RELEASE_MARKER:-.check/last-pass}
RERUN="sh scripts/play-check.sh"

if [ -n "$(git status --porcelain)" ]; then
  echo "release-commit: REFUSED, the working tree is not clean. Commit or remove changes, then re-run: $RERUN" >&2
  exit 1
fi
if [ ! -f "$MARKER" ]; then
  echo "release-commit: REFUSED, $MARKER does not exist. Run: $RERUN" >&2
  exit 1
fi

read -r DAY PASS TREE EXTRA < "$MARKER" || true
case "${DAY:-}" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "release-commit: REFUSED, $MARKER is malformed." >&2; exit 1 ;; esac
case "${PASS:-}" in ''|*[!0-9]*) echo "release-commit: REFUSED, $MARKER is malformed." >&2; exit 1 ;; esac
[ "$PASS" -gt 0 ] || { echo "release-commit: REFUSED, the recorded pass count is 0." >&2; exit 1; }
[ -z "${EXTRA:-}" ] || { echo "release-commit: REFUSED, $MARKER is malformed." >&2; exit 1; }

HEAD_TREE=$(git rev-parse 'HEAD^{tree}')
if [ "${TREE:-}" != "$HEAD_TREE" ]; then
  echo "release-commit: REFUSED, the last passing check ran on a different tree (${TREE:-none}) than HEAD (${HEAD_TREE}). Re-run: $RERUN" >&2
  exit 1
fi

TRAILER="Play-check: pass $DAY $PASS"
if [ "$PRINT" = "1" ]; then
  echo "$TRAILER"
  exit 0
fi
git commit --allow-empty -q -m "$SUBJECT" -m "$TRAILER" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
echo "release-commit: created $(git rev-parse --short HEAD) with trailer '$TRAILER'. Next: git push origin main (never with [CI SKIP])."
