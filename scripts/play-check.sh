#!/bin/sh
# Typecheck, run the tests, and write the release marker .check/last-pass
# when everything passed on a clean working tree.
set -u
cd "$(dirname "$0")/.."
mkdir -p .check
rm -f .check/last-pass
bun run typecheck || exit 1
bun test --timeout=30000 > .check/test.log 2>&1
status=$?
cat .check/test.log
if [ "$status" -ne 0 ]; then
  echo "play-check: tests failed" >&2
  exit "$status"
fi
PASS=$(grep -E '^ *[0-9]+ pass$' .check/test.log | tail -1 | tr -dc '0-9')
if [ -n "$PASS" ] && [ "$PASS" -gt 0 ] && [ -z "$(git status --porcelain)" ]; then
  echo "$(date +%Y-%m-%d) $PASS $(git rev-parse 'HEAD^{tree}')" > .check/last-pass
fi
echo "play-check: ok ($PASS passed)"
