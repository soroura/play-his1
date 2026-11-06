#!/bin/bash
# Consistent SQLite backup of play-his1 (VACUUM INTO inside the running container, integrity-checked), keeps 14 days.
# Used by deploy.sh before every deploy (BACKUP_DIR=/opt/play-his1/backups-predeploy) and runnable by hand or from cron:
#     cd /opt/play-his1 && ./scripts/backup.sh
# Overrides: APP_DIR (default /opt/play-his1), BACKUP_DIR (default $APP_DIR/backups).
set -euo pipefail
umask 077
cd "${APP_DIR:-/opt/play-his1}"
BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
PARTIAL="$BACKUP_DIR/.play-$STAMP.sqlite.partial"
FINAL="$BACKUP_DIR/play-$STAMP.sqlite"
trap 'rm -f "$PARTIAL"' EXIT

dc() { docker compose --env-file .env -f docker-compose.prod.yml -p play-his1 "$@"; }

dc exec -T play-app sh -c 'rm -f /tmp/play-backup.sqlite'
dc exec -T play-app bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/data/play.sqlite', { readonly: true }); db.run(\"VACUUM INTO '/tmp/play-backup.sqlite'\"); db.close();"
CHECK=$(dc exec -T play-app bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/tmp/play-backup.sqlite', { readonly: true }); const r = db.query('PRAGMA integrity_check').get() as Record<string, string>; console.log(Object.values(r)[0]); db.close();") || CHECK="check failed"
if [ "$(printf '%s' "$CHECK" | tr -d '[:space:]')" != "ok" ]; then
  dc exec -T play-app sh -c 'rm -f /tmp/play-backup.sqlite' || true
  echo "BACKUP FAILED: integrity_check on the copy said: $CHECK" >&2
  exit 1
fi
dc exec -T play-app sh -c 'cat /tmp/play-backup.sqlite && rm -f /tmp/play-backup.sqlite' > "$PARTIAL"
[ -s "$PARTIAL" ] || { echo "backup is empty" >&2; exit 1; }
mv "$PARTIAL" "$FINAL"
chmod 600 "$FINAL"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'play-*.sqlite' -mtime +14 -delete
echo "backup ok: $FINAL"
