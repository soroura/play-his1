#!/bin/sh
# Local dev server with a throwaway PIN, auto-reload on file changes.
set -eu
cd "$(dirname "$0")/.."
export HOST_PIN="${HOST_PIN:-1234}"
export SESSION_SECRET="${SESSION_SECRET:-dev-secret-not-for-production-0123456789}"
export PORT="${PORT:-8098}"
exec bun --watch src/main.ts
