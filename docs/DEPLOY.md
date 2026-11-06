# Deploying play-his1

Same shared Contabo VPS as play-emt (ssh alias on the Mac: `mrcem-vps`). Docker Compose, one container, bound privately; Nginx
Proxy Manager (NPM, container on 80/443) terminates TLS behind Cloudflare. There are no nginx files in this repo.

| Value | Setting |
|---|---|
| Target dir | `/opt/play-his1` |
| Compose project / image / service | `play-his1` / `play-his1-app:latest` / `play-app` |
| Bind | `172.17.0.1:8098 -> 8098` (`HOST_BIND_IP` / `HOST_APP_PORT` override, only those two private values are accepted) |
| Data | `/opt/play-his1/data` -> `/data`, `PLAY_DB=/data/play.sqlite`, owned by uid 1000 |
| Limits | `mem_limit: 384m`, `cpus: 1.0` |
| Health | `GET /api/health` returns `{ok, sha}` |
| Public URL | https://play-his1.endura-assess.com |

What is shipped (CI-owned, replaced every deploy): `package.json`, `bun.lock` (optional), `tsconfig.json`, `src`, `public`,
`content`, `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `deploy.sh`, `deploy.env.example`, `scripts`, `RELEASE_SHA`
(list: `scripts/release-manifest.sh`). Never touched by a deploy: `.env`, `data/`, `backups*`.

## 1. First-time VPS bootstrap (once)

```sh
ssh mrcem-vps
ss -tlnp | grep :8098            # must print nothing (8098 was free on 2026-11-06)
docker ps --format '{{.Names}} {{.Ports}}' | grep 8098    # must print nothing
mkdir -p /opt/play-his1/data
chown 1000:1000 /opt/play-his1/data
chmod 750 /opt/play-his1
cd /opt/play-his1
umask 077
cat > .env <<ENV
HOST_PIN=<6+ characters, you choose>
SESSION_SECRET=$(openssl rand -hex 32)
PUBLIC_ORIGIN=https://play-his1.endura-assess.com
ENV
chmod 600 .env
ls -l .env                       # -rw------- root
```

Plain `KEY=value` lines: no quotes, no spaces around `=`. `deploy.sh` refuses to run if a value is empty, too short
(PIN 6+, secret 32+), still a placeholder (case-insensitive), or if `PUBLIC_ORIGIN` is not an `https://` origin without a
trailing slash. `.env` is VPS-owned: CI never ships or rewrites it.

## 2. Proxy host in Nginx Proxy Manager (once)

In the NPM admin UI, Proxy Hosts -> Add Proxy Host:

- Domain names: `play-his1.endura-assess.com`
- Scheme `http`, Forward Hostname/IP `172.17.0.1`, Forward Port `8098`
- Block Common Exploits: on. Cache Assets: off. Websockets Support: not needed (the app polls); leaving it off is fine.
- SSL tab: request a new certificate (see the Cloudflare notes below), Force SSL on, HTTP/2 on.

Cloudflare: the DNS record already exists and is proxied (orange cloud). SSL/TLS mode must be Full or Full (strict).
The mode is **zone-wide**, so do not change it on a zone that hosts other platforms; play-emt already runs on the same zone.

Pitfalls (from the woodpecker-vps-deploy skill):

- **525 = the TLS handshake from Cloudflare to the origin failed.** With Full/Full (strict) Cloudflare always connects to the
  origin on HTTPS 443, so a proxied hostname with no origin certificate returns 525.
- **Certificate deadlock.** A Let's Encrypt HTTP-01 challenge cannot succeed while the record is proxied, because the challenge
  on port 80 is forwarded to origin 443, which is exactly what is missing. Either set the record to DNS only (grey cloud), request
  the certificate in NPM, then switch back to Proxied; or use the DNS-01 challenge in NPM with a scoped Cloudflare API token,
  which works while proxied and renews unattended. Grey-cloud renewals hit the same wall in about 90 days.
- Tell origin-side from edge-side, on the VPS:
  `curl -sIk --resolve play-his1.endura-assess.com:443:127.0.0.1 https://play-his1.endura-assess.com/api/health | head -3`.
  A handshake error means the origin has no certificate for that name; `200` means the origin is fine and the fault is at Cloudflare.
- Internal health passing while the public URL fails is a proxy/DNS/TLS problem, never a deploy problem. Check the origin first,
  then the public URL, and change nothing until you know which side is broken.
- The app binds `172.17.0.1` only. Never `0.0.0.0` (it would expose plain HTTP and bypass TLS); `deploy.sh` refuses it.
- If the NPM container cannot reach `172.17.0.1:8098`, check `docker network inspect bridge` for the gateway address and that
  `ss -tlnp | grep :8098` shows the bind.

## 3. First deploy, manual, from the Mac (tonight's route)

Needs a commit carrying `Play-check: pass ...` (see section 5), then:

```sh
cd /Users/soroura/-workshop-local/play-his1
DRY_RUN=1 sh scripts/manual-deploy.sh mrcem-vps      # prints the plan, checks the trailer
sh scripts/manual-deploy.sh mrcem-vps                # gate -> upload -> install -> deploy.sh on the VPS
```

It clones the SHA into a temp directory (uncommitted files never ship), waits for the VPS load gate (load < 10, available memory
> 2 GB), checks `/opt/play-his1/.env` exists, streams a tar over OpenSSH, installs, and runs `deploy.sh`: validate env -> tag
rollback image -> build -> health probe inside the container -> health probe on the published port with the release SHA ->
automatic rollback if either fails. Re-running is safe.

Verify:

```sh
ssh mrcem-vps 'curl -fsS http://172.17.0.1:8098/api/health'        # origin: {"ok":true,"sha":"<sha>"}
ssh mrcem-vps 'docker ps --format "{{.Names}} {{.Ports}}" | grep play-app'   # must show 172.17.0.1:8098, NOT 0.0.0.0
curl -fsS https://play-his1.endura-assess.com/api/health            # public path
```

## 4. Woodpecker (can follow; not on the critical path)

1. In Woodpecker, add the repo `soroura/play-his1` (Repos -> Add repository -> activate).
2. Repo settings -> Secrets: `VPS_HOST` (the same value as play-emt, `172.17.0.1`), `VPS_USER`, `VPS_SSH_KEY` (the deploy private
   key, same as play-emt). Names must match byte for byte; an empty value fails the deploy step with a clear message.
3. Trigger: push to `main` and manual. No clone override (no submodule).
4. Lint config changes before pushing:
   `docker run --rm -v $PWD:/repo -w /repo woodpeckerci/woodpecker-cli:v3 lint .woodpecker.yml`.
5. `.woodpecker.yml` executed lines must stay pure ASCII: `grep -nP '[^\x00-\x7F]' .woodpecker.yml` returns nothing.

Pipeline: `verify` (requires the `Play-check` trailer on the head commit, writes `RELEASE_SHA`) -> `deploy` (load gate, then
`ci-upload.sh`). A push without the trailer starts a pipeline whose `verify` step fails red by design. Do not use `[CI SKIP]` for
releases, only for docs-only pushes.

## 5. Release recipe

```sh
sh scripts/play-check.sh                          # typecheck + bun test; writes .check/last-pass on a clean tree
sh scripts/release-commit.sh "release: <what>"    # empty commit with "Play-check: pass YYYY-MM-DD N" (refuses if the tree differs)
git push origin main                              # Woodpecker deploys; or: sh scripts/manual-deploy.sh mrcem-vps
```

The trailer is an attestation from your machine, not something Woodpecker can verify. Confirm what is live from the health
endpoint: `curl -fsS https://play-his1.endura-assess.com/api/health` and compare `sha` with `git rev-parse HEAD`.

## 6. Rollback

`deploy.sh` retags the outgoing image as `play-his1-app:rollback` before each build and rolls back automatically when the new
release does not become healthy (the deploy still reports FAILED). To roll back by hand, one generation:

```sh
ssh mrcem-vps
docker image tag play-his1-app:rollback play-his1-app:latest
cd /opt/play-his1 && docker compose --env-file .env -f docker-compose.prod.yml -p play-his1 up -d --no-deps --force-recreate play-app
curl -fsS http://172.17.0.1:8098/api/health
```

Deeper rollback means redeploying a known-good commit with `sh scripts/manual-deploy.sh mrcem-vps <sha>` (it needs that commit to
carry the trailer). The SQLite file is never touched by a rollback. Before each deploy to a running container, `deploy.sh` also
writes a consistent copy to `/opt/play-his1/backups-predeploy/` (14 days); `SKIP_BACKUP=1 ./deploy.sh` skips it in an emergency.
Manual backup: `cd /opt/play-his1 && ./scripts/backup.sh`.

## 7. Logs and day-to-day

```sh
ssh mrcem-vps
cd /opt/play-his1
docker compose --env-file .env -f docker-compose.prod.yml -p play-his1 logs --tail=100 -f play-app
docker compose --env-file .env -f docker-compose.prod.yml -p play-his1 ps
docker stats --no-stream $(docker ps -q --filter name=play-his1)
./deploy.sh          # re-run the deploy of the installed release (idempotent)
```

Changing `.env` (PIN, secret, origin) needs `./deploy.sh` (or `docker compose ... up -d --force-recreate play-app`) to take effect.
Changing `SESSION_SECRET` signs the facilitator out. Never run `docker compose down -v`, `docker volume rm` or
`docker system prune --volumes` on this host.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| deploy fails at "required env var ... is empty" or "placeholder" | fix `/opt/play-his1/.env`, re-run |
| `No /opt/play-his1/.env on the VPS` from the upload | bootstrap step 1 not done |
| gate waits then fails | VPS busy (load >= 10 or < 2 GB free); retry later, do not bypass |
| container healthy, public URL 525 | Cloudflare to origin TLS; section 2 |
| container healthy, public URL 502 | NPM upstream wrong (must be `http` `172.17.0.1` `8098`) |
| POSTs fail with 403 in the browser | `PUBLIC_ORIGIN` differs from the browser's origin (scheme, host, trailing slash) |
| SQLite "unable to open database file" | `/opt/play-his1/data` not owned by uid 1000: `chown -R 1000:1000 /opt/play-his1/data` |
