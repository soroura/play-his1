# play-his1

A live, online, facilitator-led game for the GOTHI diploma session on quality review and HIS (Module 4, topic 6). Each
participant plays on their own phone or laptop, joins with a room code and a nickname, and walks through a simulated GAHAR
survey day at a fictional hospital (Canal General Hospital, Port Said). The facilitator screen-shares the big screen, opens each
question, watches the answers arrive, reveals the best answer with the real case behind it, and shows the leaderboard. Afterwards
every player gets a personal report. English and Arabic. Bun + TypeScript, SQLite, no build step, no websockets (clients poll).

Design: [docs/superpowers/specs/2026-11-06-play-his1-design.md](docs/superpowers/specs/2026-11-06-play-his1-design.md).

## Run locally

```sh
bun install
HOST_PIN=123456 SESSION_SECRET=$(openssl rand -hex 32) bun run dev
```

Open `http://localhost:8098/host` on the facilitator screen and log in with the PIN. Open `/` on a
second device (or a private window) to join as a player with the room code shown in the lobby.
`PUBLIC_ORIGIN` is optional locally; when set, every POST must carry exactly that `Origin`.

## Tests

```sh
bun run typecheck
bun test
sh scripts/play-check.sh      # typecheck + bun test; on a pass with a CLEAN tree it must write .check/last-pass
```

`.check/last-pass` is one line, `<YYYY-MM-DD> <pass count> <git tree id of HEAD>`, and `.check/` must be git-ignored.
`scripts/release-commit.sh` refuses to run unless that line records exactly HEAD's tree. Any failure or a dirty tree must remove
the marker.

## Release

The server is a shared VPS, so Woodpecker only deploys; tests run on your machine. Three commands:

```sh
sh scripts/play-check.sh                          # 1. tests pass on a clean, committed tree (writes the marker)
sh scripts/release-commit.sh "release: <what>"    # 2. empty commit carrying "Play-check: pass YYYY-MM-DD N"
git push origin main                              # 3. Woodpecker: verify -> load gate -> upload -> deploy.sh
```

Fallback (and the first deploy): `sh scripts/manual-deploy.sh mrcem-vps` runs the same upload from your Mac.
Confirm what is live with `curl -fsS https://play-his1.endura-assess.com/api/health` (returns `{ok, sha}`).

## Docs

- [docs/DEPLOY.md](docs/DEPLOY.md): VPS bootstrap, Nginx Proxy Manager, Cloudflare, first deploy, Woodpecker, rollback, logs.
- [docs/RUN-SHEET.md](docs/RUN-SHEET.md): facilitator run sheet for the live session.
