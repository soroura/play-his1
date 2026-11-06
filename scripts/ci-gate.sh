#!/bin/sh
# VPS load gate: wait until the VPS 1-minute load is below GATE_MAX_LOAD (10) and available memory is above
# GATE_MIN_MB (2000), polling every GATE_POLL seconds (60) for up to GATE_MAX_WAIT seconds (1500), else fail.
# The shared 8 GB VPS was driven to load 330 by CI work once; never deploy onto a loaded machine.
# Executed BY the Woodpecker runner (or by hand before scripts/ci-upload.sh). Expects SSH_OPTS and REMOTE.
#     DRY_RUN=1 SSH_OPTS=x REMOTE=x sh scripts/ci-gate.sh
# GATE_PROBE (tests only) replaces the ssh probe: a command printing load then available MB on two lines.
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/ssh-retry.sh"

MAX_WAIT=${GATE_MAX_WAIT:-1500}
POLL=${GATE_POLL:-60}
MAX_LOAD=${GATE_MAX_LOAD:-10}
MIN_MB=${GATE_MIN_MB:-2000}

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN - would wait up to ${MAX_WAIT}s (poll ${POLL}s) for VPS 1-min load < ${MAX_LOAD} and available memory > ${MIN_MB} MB, then return 0"
  exit 0
fi

: "${SSH_OPTS:?SSH_OPTS is not set}"
: "${REMOTE:?REMOTE is not set}"

probe() {
  if [ -n "${GATE_PROBE:-}" ]; then
    sh -c "$GATE_PROBE" 2>/dev/null || true
  else
    # shellcheck disable=SC2086
    retry255 ssh $SSH_OPTS -o ConnectTimeout=30 -o ConnectionAttempts=3 "$REMOTE" 'cut -d" " -f1 /proc/loadavg; free -m | awk "NR==2{print \$7}"' 2>/dev/null || true
  fi
}

waited=0
while :; do
  o=$(probe)
  l=$(printf '%s\n' "$o" | sed -n 1p)
  a=$(printf '%s\n' "$o" | sed -n 2p)
  if [ -n "$l" ] && [ -n "$a" ] && awk -v l="$l" -v a="$a" -v ml="$MAX_LOAD" -v mm="$MIN_MB" 'BEGIN{exit !(l+0<ml+0 && a+0>mm+0)}'; then
    echo "gate reached: load=$l avail_mb=$a after ${waited}s"
    exit 0
  fi
  echo "gate waiting: load=${l:-?} avail_mb=${a:-?} (need load < ${MAX_LOAD}, available > ${MIN_MB} MB) waited ${waited}s"
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "gate FAILED: the VPS stayed loaded for ${MAX_WAIT}s; not deploying. Re-run the pipeline later."
    exit 1
  fi
  sleep "$POLL"
  waited=$((waited + POLL))
done
