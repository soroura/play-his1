#!/bin/sh
# Mirror a staged release into the persistent application directory.
# Runs ON THE VPS, invoked by ci-upload.sh.
#
#     sh install-release.sh <staging-dir> <target-dir>
#
# This file enforces the ownership boundary, and it is the only part of the
# deploy that deletes anything on the server:
#
#   CI-OWNED  - every path in RELEASE_PATHS and OPTIONAL_PATHS. Removed, then replaced. This is what
#               stops a file deleted from the repository lingering on the VPS and
#               being compiled into a later build.
#   VPS-OWNED - everything else in the target. Never touched: .env, named Docker
#               volumes, backups, uploads, operator-created directories.
#
# This is why the deploy does not simply extract over the target, and why it does
# not use drone-scp's rm:true - that option removes the WHOLE target directory
# (verified in the plugin source: `if p.Config.Remove { ssh.Run(rmcmd(target)) }`),
# taking production secrets and data with it.
#
# It therefore never removes the target directory itself. `rm -rf "$TARGET"`,
# `docker compose down -v` and `docker volume rm` must never appear in a routine
# deploy.

set -eu

STAGE="${1:?usage: install-release.sh <staging-dir> <target-dir>}"
TARGET="${2:?usage: install-release.sh <staging-dir> <target-dir>}"

[ -d "$STAGE" ] || { echo "Staging directory does not exist: $STAGE"; exit 1; }

# Refuse obviously catastrophic targets. This script often runs as root on a
# shared host; a mistyped or unexpanded variable must not become a recursive
# delete of a system directory.
case "$TARGET" in
  ""|"/"|"/root"|"/home"|"/etc"|"/usr"|"/var"|"/srv"|"/tmp"|"/opt")
    echo "Refusing to install into an unsafe target: '$TARGET'"; exit 1 ;;
esac
case "$TARGET" in
  /*) ;;
  *) echo "Target must be an absolute path: '$TARGET'"; exit 1 ;;
esac

. "$STAGE/scripts/release-manifest.sh"
[ -n "${RELEASE_PATHS:-}" ] || { echo "RELEASE_PATHS is empty - refusing to proceed"; exit 1; }

# Verify the staged release is complete BEFORE deleting anything from the
# target. Removing first and discovering a truncated upload second would leave
# the server with no application at all.
for path in $RELEASE_PATHS; do
  [ -e "$STAGE/$path" ] || { echo "Staged release is incomplete, missing: $path"; exit 1; }
done

mkdir -p "$TARGET"

echo "-> Replacing CI-owned paths in $TARGET"
# Remove ALL first, then copy ALL. Removing each path immediately before copying
# it would also work, but a single removal pass keeps the window in which the
# target is inconsistent as short as possible.
for path in $RELEASE_PATHS ${OPTIONAL_PATHS:-}; do
  rm -rf "$TARGET/$path"
done
# Optional paths are copied only when the staged release contains them.
for path in $RELEASE_PATHS ${OPTIONAL_PATHS:-}; do
  [ -e "$STAGE/$path" ] || continue
  # The prior rm is what makes this correct: `cp -R src dst` creates dst when it
  # is absent, but copies INTO it when it exists - which would silently produce
  # $TARGET/app/app on the second deploy.
  cp -R "$STAGE/$path" "$TARGET/$path"
  echo "    $path"
done

# Informational only - the deploy fails later with a clearer message if absent.
if [ -f "$TARGET/.env" ]; then
  echo "Preserved server-owned $TARGET/.env"
else
  echo "WARNING: no $TARGET/.env present - deploy.sh will fail validation"
fi

echo "Release installed"
