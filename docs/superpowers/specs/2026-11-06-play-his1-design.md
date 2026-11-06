# play-his1: live GAHAR records survey game — design and build plan

Date: 2026-11-06. Owner: soroura. Repo: https://github.com/soroura/play-his1.git (branch `main`).
Public URL: https://play-his1.endura-assess.com (Cloudflare DNS done, proxied). Session: **tomorrow, 2026-11-07, must be live.**

## 1. Intent

An online live session (GOTHI diploma, Module 4 "QPI & IMT", topic 6 "Quality Review & HIS") in which every participant
plays individually on their own phone or laptop while the facilitator screen-shares the "big screen". The game walks through
a simulated GAHAR survey day at a fictional Egyptian hospital (Canal General Hospital, 220 beds, Port Said, universal health
insurance phase 1): backup log, missing paper file, same-name patients, server cupboard, power cut, critical result during
downtime, restore and back-entry, daily briefing.

The previous single facilitator page was "boring, not engaging, not immersive". The owner liked all four mock-up looks
(A incident-room feed, B ward WhatsApp chat, C dark-ward photo, D quiz-show tiles with team scoreboard). This design
combines them (my call): **D's coloured answer tiles and scoring** for players, **A, B and C as the scene styles** on the big
screen, chosen per round.

### Goals
- Individuals join with a room code and a nickname, answer each question on their own device.
- Live progress on the big screen: "17 / 23 answered", with a progress bar, while answers are open.
- Reveal after each question (owner's choice): answer distribution, best answer, knock-out stamp, why, one real case.
- Leaderboard between rounds; final podium.
- **Personal report per player** after the game: each of their answers vs the best one, points, knock-outs hit, the why,
  the GAHAR standards behind it and the real case. Printable / saveable.
- Instructions inside the game: a "How to play" card for players (English and Arabic) and a facilitator run sheet.
- English and Arabic: each player picks a language; Arabic renders right-to-left.

### Non-goals (tonight)
- Teams, accounts, email, analytics, CSV exports, session-evaluation form, multiple simultaneous facilitators.
- Websockets. Clients poll (simple, robust through Cloudflare and Nginx Proxy Manager).

### Anti-goals (would make it a failure even if it works)
- A player cannot rejoin after a dropped mobile connection or a page refresh (Egyptian mobile networks; must reconnect silently).
- The facilitator refreshes the host page and the game is lost (state must live on the server, persisted).
- Text-heavy screens. Each phone screen does one thing; the big screen is readable when shared in Zoom/Teams.
- Answers or the correct option visible to players before reveal.

## 2. Users and screens

| Route | Who | What |
|---|---|---|
| `/` | player | Join: room code (4 digits), nickname (max 20 chars), language EN/AR. Then "How to play" card. |
| `/play` | player | One state at a time: waiting / look at the shared screen (+ 1-line scene summary) / question with 4 big coloured tiles and timer / "answer locked" / reveal (right or not, points, short why) / leaderboard position / final: link to personal report. |
| `/report/:playerToken` | player | Personal report (works after the game ends; printable with browser print; stays available 14 days). |
| `/host` | facilitator | PIN login (HOST_PIN in `.env`). Create game -> big-screen view with a slim control bar (hideable with `H`). Keyboard: `Space`/`→` next step, `R` reveal, `+` add 15 s, `L` leaderboard. Shows join URL + room code large in the lobby (and a QR code if trivial to add; not required). |
| `/host/help` | facilitator | Run sheet (same content as docs/RUN-SHEET.md). |

### Round flow (state machine, server-authoritative)
`lobby -> [ for each round: scene -> question(open, timer) -> reveal -> leaderboard ] -> final`

- **scene**: big screen plays the round's scene in its style:
  - `feed` (look A): dark incident board, clock, timed lines appearing one by one (normal / warn / crit), status lights.
  - `chat` (look B): phone-style group chat, messages appearing one by one, Arabic and English mixed, names coloured.
  - `photo` (look C): full-width image (`dark-ward.jpg` or `server-cupboard.jpg`) with 3-5 numbered callouts revealed one by one.
  - `document` : a paper/terminal-style prop (backup log, logbook, HIS screen) with lines appearing.
  Players' phones show "Look at the shared screen" plus the round title.
- **question**: big screen shows the question (EN + AR), 4 tiles (▲◆●■ in red/blue/yellow/green), countdown, and the
  live progress bar "N / total answered" (no distribution). Phones show the question and the 4 tiles in the player's
  language. One answer per player per round; locked once sent. Auto-closes when the timer ends or everyone has answered.
- **reveal**: big screen: bar per option with counts, best option highlighted, "Knock-out" stamp on any option that breaks a
  GAHAR safety requirement (GSR), the why (2-3 short points with provenance tags), one real case. Phones: correct / partly /
  not, points gained, one-line why in their language.
- **leaderboard**: top 5 with score deltas; each phone shows the player's own rank.
- **final**: podium top 3 on big screen; phones show total, rank and the "Open my report" button.

### Scoring (content-driven)
Each option carries `score` (best = 1000, partly right = 400, wrong = 0) and `knockout` (true when choosing it would breach
a GSR). Speed bonus for options with score > 0: up to +500 linear in remaining time. Knock-out choices score 0 and are
counted in the report ("knock-outs hit").

## 3. Content

`content/rounds.json` (validated at server start; the server refuses to boot on invalid content):

```json
{
  "meta": {"title": {"en": "...", "ar": "..."}, "hospital": "Canal General Hospital"},
  "rounds": [{
    "id": 1,
    "clock": "09:30",
    "place": {"en": "...", "ar": "..."},
    "title": {"en": "...", "ar": "..."},
    "scene": {
      "style": "feed | chat | photo | document",
      "image": "img/dark-ward.jpg",
      "lines": [{"t": "10:40", "who": "Amal", "tone": "normal | warn | crit", "text": {"en": "...", "ar": "..."}}]
    },
    "question": {"en": "...", "ar": "..."},
    "timeLimit": 45,
    "options": [{"key": "A", "text": {"en": "...", "ar": "..."}, "score": 1000, "knockout": false,
                 "feedback": {"en": "...", "ar": "..."}}],
    "why": [{"tag": "G | S | E | X | I", "text": {"en": "...", "ar": "..."}}],
    "standards": ["IMT.12", "..."],
    "realCase": {"title": "...", "text": "...", "source": "...", "status": "verified | partly"}
  }]
}
```
`ar` is optional everywhere (falls back to `en`); `who` and `image` optional. Exactly 4 options per round; exactly one
option has score 1000.

Sources (ported, not rewritten):
- 8 rounds = the `BEATS` array in
  `/Users/soroura/-workshop-local/informatics/tracks/gahar-standards-reference/wiki/events/records-survey-sim/index.html`
  (clock, place, title, narr, prop, bilingual q, 4 options, best, risk, points with tags, ledger with gsr flags).
- One real case per round: the "Map by simulation decision point" table and "Ten stories" table in
  `.../wiki/events/records-case-bank.md`; detail in `.../wiki/concepts/case-bank-*.md`. Only verified or partly verified
  cases; partly verified are worded "reported".
- Scene lines for round 5 (power cut) and round 6 (critical potassium): the mock-up
  `/Users/soroura/-workshop-local/informatics/.superpowers/brainstorm/45218-1793986931/content/four-looks.html`
  (A feed events, B chat messages, C hotspots) is the model for tone and pacing.
- Images: `dark-ward.png` (same mock-up folder) and `server-cupboard.jpg` (records-survey-sim folder), converted to JPEG
  max 1600 px into `public/img/`.

Rules carried from the wiki: hospital 2025 handbook codes; IMT.05, IMT.11 and IMT.12 are not GSR; one not-met GSR means
rejection (survey guide p. 24). Do not state hospital author/date/time or audit-trail requirements as GAHAR hospital
requirements (those are PHC IMT.08 / beyond GAHAR). Arabic drafted by the model must be listed for a native-speaker check.

## 4. Architecture (decided)

- **Bun 1.4.2 + TypeScript**, `Bun.serve`, no framework; **bun:sqlite** at `/data/play.sqlite` (games, players, answers,
  state). Same runtime as play-emt on the VPS (cached base image `oven/bun:1.4.2-alpine`).
- Client: static vanilla HTML/CSS/JS in `public/` (no build step). Fonts: IBM Plex Sans, IBM Plex Sans Arabic, IBM Plex
  Mono via Google Fonts. Neutral hospital look (not WHO-branded).
- API (JSON): `POST /api/join`, `GET /api/state?token=&v=` (player; returns `304`-style `{"same":true}` when version
  unchanged), `POST /api/answer`, `GET /api/report/:token`; host: `POST /api/host/login`, `POST /api/host/game`,
  `POST /api/host/advance`, `POST /api/host/reveal`, `POST /api/host/extend`, `GET /api/host/state`. Host auth = signed
  cookie (HMAC with `SESSION_SECRET`) after PIN. `GET /api/health` returns `{ok, sha}`.
- Polling: players every 1.5 s, host every 1 s. State object carries a monotonically increasing `version`.
- Player identity: random 128-bit token in localStorage; rejoin with the same token restores the player.
- Security: POST requests must carry `Origin` equal to `PUBLIC_ORIGIN` (when set); nickname sanitised, rendered with
  textContent only; rate-limit join and answer per IP (trust `CF-Connecting-IP`); answer timestamps are server-side.
- Capacity target: 150 players in one game, one active game at a time (several stored).
- Config (`.env`, VPS-owned, mode 600, never in git): `HOST_PIN`, `SESSION_SECRET`, `PUBLIC_ORIGIN`.

## 5. Deployment (decided)

Same shared Contabo VPS as play-emt (ssh alias on this Mac: `mrcem-vps`, root@217.76.56.188). Proxy is **Nginx Proxy
Manager** (container on 80/443), so no nginx files in this repo: the owner adds a proxy host
`play-his1.endura-assess.com -> http://172.17.0.1:8098` with SSL.

| Value | Setting |
|---|---|
| TARGET | `/opt/play-his1` |
| compose project / image | `play-his1` / `play-his1-app:latest` |
| bind | `172.17.0.1:8098 -> 8098` (8098 verified free on 2026-11-06) |
| data | `/opt/play-his1/data` -> `/data` |
| health | `GET /api/health` |
| limits | `mem_limit: 384m`, `cpus: 1.0` |

Pipeline: **deploy-only** variant (shared 8 GB host), copied from
`/Users/soroura/-workshop-local/play-emt-p4` (`.woodpecker.yml`, `scripts/ci-verify.sh`, `ci-gate.sh`, `ci-upload.sh`,
`install-release.sh`, `release-manifest.sh`, `release-commit.sh`, `manual-deploy.sh`, `ssh-retry.sh`, `deploy.sh`,
`docker-compose.prod.yml`, `deploy.env.example`), with every submodule / `core` / `CORE_SHA` line removed and names changed.
Trailer: `Play-check: pass YYYY-MM-DD N` written by `scripts/release-commit.sh` after `scripts/play-check.sh`
(typecheck + `bun test`) passed on exactly HEAD's tree. Woodpecker secrets: same names as play-emt (`VPS_HOST`,
`VPS_USER`, `VPS_SSH_KEY`). Rules from the woodpecker-vps-deploy skill apply (ASCII-only executed lines, tar-stream over
OpenSSH, never ship `.env`, rollback tag, health check, logs on failure).

**Tonight's route**: `sh scripts/manual-deploy.sh mrcem-vps` from the Mac (same scripts, same server-side `deploy.sh`).
Woodpecker activation can follow; it is not on tomorrow's critical path.

## 6. Build plan (executed by Sonnet sub-agents, reviewed by Opus)

Three parallel work packages, disjoint files:

1. **App** (`src/`, `public/`, `test/`, `package.json`, `tsconfig.json`): server, state machine, scoring, persistence,
   player / host / report pages, bun tests (state machine, scoring incl. speed bonus and knock-outs, rejoin, answer locking,
   reveal hides nothing early, content validation). Use `content/rounds.example.json` (2 rounds, written by this package)
   until the real file exists.
2. **Content** (`content/rounds.json`, `public/img/`, `content/ARABIC-CHECK.md`): port the 8 beats + cases + scene lines.
3. **Deploy and docs** (`.woodpecker.yml`, `scripts/`, `deploy.sh`, `Dockerfile`, `docker-compose.prod.yml`,
   `deploy.env.example`, `.dockerignore`, `README.md`, `docs/DEPLOY.md`, `docs/RUN-SHEET.md`).

Then: integrate, run locally (`bun run start`), simulate 30 players with a script, fix, commit, release commit, manual
deploy, verify `https://play-his1.endura-assess.com/api/health`.

## 7. Calls I made (owner can overrule)
- Combined looks: tiles for players, A/B/C/document as scene styles on the big screen.
- Polling instead of websockets. Bun + sqlite + vanilla JS, no build step.
- Scores 1000 / 400 / 0 + speed bonus; knock-out = 0 and counted.
- Room code 4 digits; nickname only, no personal data; reports kept 14 days.
- Port 8098, target `/opt/play-his1`, manual first deploy tonight over `mrcem-vps`.
