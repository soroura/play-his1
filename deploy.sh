#!/bin/bash
# Server-side deploy script - DOCKER COMPOSE runtime. Lives at /opt/play-his1/deploy.sh, installed there by scripts/install-release.sh.
# Invoked by ci-upload.sh over SSH, and equally safe to run by hand:   cd /opt/play-his1 && ./deploy.sh
#
# Order: validate env -> tag rollback image -> build -> pre-deploy backup -> swap -> health probe -> automatic rollback on failure.
# Nothing mutates the running site until the new image builds clean. It never removes the target directory, .env, the data
# directory or any Docker volume.

set -euo pipefail

# ---------------------------- PROJECT CONFIG ----------------------------
APP_DIR="${APP_DIR:-/opt/play-his1}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
# Server-owned, never shipped by CI, preserved across deploys because it is not listed in scripts/release-manifest.sh.
ENV_FILE="${DEPLOY_ENV_FILE:-$APP_DIR/.env}"
# Unique per platform on a shared VPS: compose prefixes every resource with it.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-play-his1}"
export COMPOSE_PROJECT_NAME

APP_SERVICES="play-app"
HEALTH_SERVICE="play-app"
IMAGE_NAME="play-his1-app"

HEALTH_PORT="${HEALTH_PORT:-8098}"
HEALTH_PATHS="${HEALTH_PATHS:-/api/health}"
HOST_HEALTH_PATH="${HOST_HEALTH_PATH:-/api/health}"            # reports {ok, sha}
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"

REQUIRED_ENV="HOST_PIN SESSION_SECRET PUBLIC_ORIGIN"
# -------------------------- END PROJECT CONFIG --------------------------

cd "$APP_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" "$@"
}

on_error() {
  local exit_code=$?
  echo ""
  echo "Deployment FAILED (exit code: $exit_code)"
  if [ "$ROLLBACK_ATTEMPTED" = 1 ]; then
    echo "-> Logs and rollback outcome are printed above."
    exit "$exit_code"
  fi
  echo "-> Recent container logs:"
  for svc in $APP_SERVICES; do
    compose logs --tail=80 "$svc" 2>&1 || true
  done
  if docker image inspect "$IMAGE_NAME:rollback" >/dev/null 2>&1; then
    echo ""
    echo "-> A rollback image exists. To restore the previous release:"
    echo "     docker image tag $IMAGE_NAME:rollback $IMAGE_NAME:latest"
    echo "     cd $APP_DIR && docker compose --env-file .env -f docker-compose.prod.yml \\"
    echo "       -p $COMPOSE_PROJECT_NAME up -d --no-deps --force-recreate $APP_SERVICES"
  fi
  exit "$exit_code"
}
ROLLBACK_ATTEMPTED=0
trap on_error ERR

# ------------------------- Prerequisite check --------------------------
command -v curl >/dev/null 2>&1 || { echo "curl is required on the VPS for the published-port probe"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is not installed on this VPS"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "the docker compose plugin is missing (install docker-compose-plugin)"; exit 1; }

# --------------- Env validation - fail fast BEFORE building ------------
if [ ! -f "$ENV_FILE" ]; then
  echo "No runtime env file found at $ENV_FILE"
  echo "  CI never uploads production secrets. Create it once:"
  echo "     cp $APP_DIR/deploy.env.example $ENV_FILE && chmod 600 $ENV_FILE   (then fill in the values)"
  exit 1
fi

# Load the server env file first, then let already-exported values win.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac
  key="${line%%=*}"
  case "$key" in ''|*[!A-Za-z0-9_]*|[0-9]*) continue ;; esac
  if [ -z "${!key:-}" ]; then export "${line?}"; fi
done < "$ENV_FILE"

# Names only, never values.
for var in $REQUIRED_ENV; do
  val="${!var:-}"
  [ -n "$val" ] || { echo "required env var $var is empty in $ENV_FILE"; exit 1; }
done
[ "${#HOST_PIN}" -ge 4 ] || { echo "HOST_PIN must be at least 4 characters (6+ recommended)"; exit 1; }
[ "${#SESSION_SECRET}" -ge 32 ] || { echo "SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)"; exit 1; }

# Case-folded placeholder checks (a case-sensitive glob lets YOUR-DOMAIN or ChangeMe through).
HOST_PIN_LC=$(printf '%s' "$HOST_PIN" | tr '[:upper:]' '[:lower:]')
case "$HOST_PIN_LC" in
  *replace_me*|*replaceme*|*changeme*|*change-me*|*your-pin*|*yourpin*|*your_pin*|*placeholder*|*'<'*|*'>'*)
    echo "HOST_PIN still holds a placeholder value"; exit 1 ;;
esac
SESSION_SECRET_LC=$(printf '%s' "$SESSION_SECRET" | tr '[:upper:]' '[:lower:]')
case "$SESSION_SECRET_LC" in
  *replace_me*|*replaceme*|*changeme*|*change-me*|*your-secret*|*yoursecret*|*your_secret*|*placeholder*|*'<'*|*'>'*)
    echo "SESSION_SECRET still holds a placeholder value"; exit 1 ;;
esac

case "$PUBLIC_ORIGIN" in
  https://*) ;;
  *) echo "PUBLIC_ORIGIN must be an https:// public origin, got: $PUBLIC_ORIGIN"; exit 1 ;;
esac
case "$PUBLIC_ORIGIN" in
  */) echo "PUBLIC_ORIGIN must not end with a slash (the Origin header never does): $PUBLIC_ORIGIN"; exit 1 ;;
esac
PUBLIC_ORIGIN_LC=$(printf '%s' "$PUBLIC_ORIGIN" | tr '[:upper:]' '[:lower:]')
case "$PUBLIC_ORIGIN_LC" in
  *localhost*|*127.0.0.1*|*0.0.0.0*|*your-domain*|*yourdomain*|*your_domain*|*mydomain*|\
  *example.org*|*example.com*|*example.net*|*.invalid*|*.local*|\
  *replace_me*|*replaceme*|*changeme*|*change-me*|*todo*|*xxx*|*'<'*|*'>'*)
    echo "PUBLIC_ORIGIN still holds a placeholder/local value: $PUBLIC_ORIGIN"
    exit 1 ;;
esac

HOST_BIND_IP="${HOST_BIND_IP:-172.17.0.1}"
export HOST_BIND_IP
case "$HOST_BIND_IP" in
  172.17.0.1|127.0.0.1) ;;
  *) echo "HOST_BIND_IP=$HOST_BIND_IP is not allowed (it could publish the app and bypass TLS). Use 172.17.0.1 or 127.0.0.1."; exit 1 ;;
esac
HOST_APP_PORT="${HOST_APP_PORT:-8098}"
export HOST_APP_PORT
[ "$HOST_APP_PORT" = 8098 ] || echo "WARNING: HOST_APP_PORT=$HOST_APP_PORT (play-his1 is expected on 8098); check the Nginx Proxy Manager upstream."

# Data directory (bind mount into /data): created once, owned by the image's bun user (uid 1000). Never deleted by a deploy.
PLAY_DATA_DIR="${PLAY_DATA_DIR:-$APP_DIR/data}"
export PLAY_DATA_DIR
mkdir -p "$PLAY_DATA_DIR"
chown -R 1000:1000 "$PLAY_DATA_DIR" 2>/dev/null || echo "WARNING: could not chown $PLAY_DATA_DIR to uid 1000; the container may not be able to write there"

RELEASE_SHA=$(cat "$APP_DIR/RELEASE_SHA" 2>/dev/null || echo unknown)
export RELEASE_SHA
echo "Release $RELEASE_SHA"
echo "Env validated - $PUBLIC_ORIGIN via $HOST_BIND_IP:$HOST_APP_PORT"

compose config --quiet

# ------------------------------ Rollback point -------------------------
if docker image inspect "$IMAGE_NAME:latest" >/dev/null 2>&1; then
  docker image tag "$IMAGE_NAME:latest" "$IMAGE_NAME:rollback"
  echo "-> Tagged the outgoing image as $IMAGE_NAME:rollback"
else
  echo "-> No previous image found (first deploy) - no rollback point yet"
fi

# --------------------------------- Build -------------------------------
echo "-> Building..."
# shellcheck disable=SC2086
compose build $APP_SERVICES

# ---------------------------- Pre-deploy backup ------------------------
# Only when an app container is already running (a first deploy has nothing to protect). A failed backup stops the deploy
# while the old release is still serving.
# SKIP_BACKUP=1 skips it (emergency only).
if [ "${SKIP_BACKUP:-0}" != 1 ] && compose ps --status running -q play-app | grep -q .; then
  BACKUP_DIR="$APP_DIR/backups-predeploy" "$APP_DIR/scripts/backup.sh" || { echo "pre-deploy backup failed"; false; }
fi

# ------------------------------- Restart -------------------------------
echo "-> Restarting app containers..."
up_failed=0
# shellcheck disable=SC2086
compose up -d --no-deps --remove-orphans $APP_SERVICES || up_failed=1

# ----------------------------- Health probe ----------------------------
health_probe() {
  local i p ok
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    ok=1
    for p in $HEALTH_PATHS; do
      compose exec -T "$HEALTH_SERVICE" sh -c \
        "wget -q -O /dev/null http://127.0.0.1:$HEALTH_PORT$p || curl -fsS http://127.0.0.1:$HEALTH_PORT$p" \
        >/dev/null 2>&1 || ok=0
    done
    if [ "$ok" = 1 ]; then
      echo "   $HEALTH_SERVICE is healthy (attempt $i)"
      return 0
    fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  return 1
}

host_probe() {
  local want="${1:-}" body
  body=$(curl -fsS --max-time 5 "http://$HOST_BIND_IP:$HOST_APP_PORT$HOST_HEALTH_PATH" 2>/dev/null) || return 1
  # The quoted sha value anywhere in the {ok, sha} body.
  [ -z "$want" ] || case "$body" in *"\"$want\""*) ;; *) return 1 ;; esac
  return 0
}

echo "-> Waiting for $HEALTH_SERVICE on :$HEALTH_PORT ($HEALTH_PATHS)..."
deploy_ok=0
if [ "$up_failed" = 0 ] && health_probe; then
  for _ in $(seq 1 "$HEALTH_RETRIES"); do
    if host_probe "$RELEASE_SHA"; then deploy_ok=1; break; fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  [ "$deploy_ok" = 1 ] || echo "$HOST_BIND_IP:$HOST_APP_PORT did not serve release $RELEASE_SHA"
fi
if [ "$deploy_ok" = 0 ]; then
  [ "$up_failed" = 0 ] || echo "compose up failed"
  echo "$HEALTH_SERVICE did not become healthy within $((HEALTH_RETRIES * HEALTH_SLEEP_SEC))s"
  echo "-> Last 100 log lines of $HEALTH_SERVICE:"
  compose logs --tail=100 "$HEALTH_SERVICE" 2>&1 || true
  if docker image inspect "$IMAGE_NAME:rollback" >/dev/null 2>&1; then
    ROLLBACK_ATTEMPTED=1
    echo "-> Rolling back to $IMAGE_NAME:rollback..."
    docker image tag "$IMAGE_NAME:rollback" "$IMAGE_NAME:latest" || true
    compose up -d --no-deps --force-recreate $APP_SERVICES || true
    if health_probe && host_probe; then
      echo "-> ROLLBACK SUCCEEDED: the previous release is serving again. This deploy still FAILED."
    else
      echo "-> ROLLBACK FAILED: the previous release did not become healthy either. Investigate on the VPS."
    fi
  else
    echo "-> No rollback image (first deploy); leaving the failed container for inspection."
  fi
  false
fi

echo "-> Pruning dangling images..."
docker image prune -f >/dev/null || true
docker builder prune -f --filter until=168h >/dev/null || true

echo ""
echo "Deployment complete - $PUBLIC_ORIGIN"
echo "  Internal and published-port health passed (release $RELEASE_SHA). Verify the public origin separately:"
echo "     curl -fsS $PUBLIC_ORIGIN/api/health"
