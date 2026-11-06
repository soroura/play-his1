#!/bin/sh
# Retry helper for ssh/scp calls made by the deploy scripts (sourced, not run).
# The VPS sshd is under a brute-force flood and sometimes drops a NEW connection
# at connect time. ssh then exits 255 (connection error). Any other exit code is
# the remote command's own result and is never retried.
#
#   retry255 cmd args...            run cmd; on exit 255 wait and run it again
#   retry255_with PREP cmd args...  same, but run the function PREP before each retry
#                                   (use it to reset state a half-done attempt left)
#
# Up to SSH_RETRY_ATTEMPTS (3) attempts, waiting SSH_RETRY_WAITS (default "5 15")
# seconds before the 2nd and 3rd. Commands that are not safe to run twice must NOT
# use this: probe the connection first (retried), then run them once.

SSH_RETRY_ATTEMPTS=${SSH_RETRY_ATTEMPTS:-3}
SSH_RETRY_WAITS=${SSH_RETRY_WAITS:-"5 15"}

retry255_with() {
  _prep=$1
  shift
  _n=1
  while :; do
    if "$@"; then
      return 0
    else
      _rc=$?
    fi
    if [ "$_rc" -ne 255 ]; then
      return "$_rc"
    fi
    if [ "$_n" -ge "$SSH_RETRY_ATTEMPTS" ]; then
      echo "ssh: connection failed (exit 255) on attempt $_n of $SSH_RETRY_ATTEMPTS; giving up" >&2
      return 255
    fi
    _wait=$(printf '%s\n' "$SSH_RETRY_WAITS" | awk -v k="$_n" '{ print ($k != "" ? $k : $NF) }')
    echo "ssh: connection failed (exit 255) on attempt $_n of $SSH_RETRY_ATTEMPTS; retrying in ${_wait}s" >&2
    sleep "$_wait"
    _n=$((_n + 1))
    if [ -n "$_prep" ]; then
      "$_prep" || return $?
    fi
  done
}

retry255() {
  retry255_with "" "$@"
}
