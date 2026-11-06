#!/bin/sh
# Release gate for the Woodpecker deploy pipeline. Fails unless the head commit message carries the line
#     Play-check: pass YYYY-MM-DD N
# (N = passing test count), written by scripts/release-commit.sh only after scripts/play-check.sh passed on exactly this tree.
# Reads the message from $CI_COMMIT_MESSAGE, or from a file given as the first argument (used by manual-deploy.sh and tests).
# Runs on a bare alpine image: POSIX sh, grep only.
set -eu

if [ "${1:-}" != "" ]; then
  MSG=$(cat "$1")
else
  MSG=${CI_COMMIT_MESSAGE:-}
fi

CLEAN=$(printf '%s\n' "$MSG" | tr -d '\r')

if printf '%s\n' "$CLEAN" | grep -Eq '^Play-check: pass [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]+$'; then
  echo "verify: trailer found: $(printf '%s\n' "$CLEAN" | grep -E '^Play-check: pass ' | tail -1)"
  exit 0
fi

echo "verify: REFUSED. The head commit has no line 'Play-check: pass YYYY-MM-DD N'."
echo "verify: run 'sh scripts/play-check.sh', then 'sh scripts/release-commit.sh \"release: ...\"', then push."
exit 1
