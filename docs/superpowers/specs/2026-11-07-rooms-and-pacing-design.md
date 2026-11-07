# Facilitator rooms and pacing settings

Date: 2026-11-07. Approved by the owner through three questions on the same day.

## Why
The game was used live on 2026-11-07 (36 players, 14 rounds). The owner wants other facilitators to use it for training, and wants each facilitator to choose whether people read the scenario on a shared screen or on phones, including at their own speed.

## Decisions (owner)
- Self-paced means both: facilitator-paced with scenes on phones, and each person at their own speed. Chosen in the settings at game creation; the shared screen stays as it was.
- Facilitators have their own rooms and can run at the same time.
- They are managed from a screen in the game, not from the server's settings file.

## Design
- `games.owner_id` (0 = main facilitator, the HOST_PIN holder) and `games.mode` (`screen`, `phones`, `self`). Migration is idempotent; earlier games become the main facilitator's, in `screen` mode.
- `activeGame`, `createGame`, `advance`, `reveal`, `extend` and `hostState` take an owner. `createGame` ends only that owner's game. Room codes are unique among active games. `tick()` covers every active question.
- `facilitators` table: name, hash of an 8-digit PIN, ids never reused. Host cookie is `<id>.<expiry>.<signature>`; the signature covers a hash of the PIN, so New PIN and Remove end existing logins. `/api/host/team*` is main-facilitator only.
- Self-paced: `players.self_round` and `players.self_step` hold each person's place. `POST /api/next` moves them, with `from` guarding against double taps. Game phases are `lobby -> running -> final`. Answers have no clock, so no speed bonus.
- `report()` never shows a round the player has not reached until the exercise ends.

## Calls made by the builder
- Self-paced has a lobby: nobody starts until the facilitator opens it, so a class can begin together. Late joiners start at round 1.
- Phone-mode reveal carries the why, the real case and the standards, because the phone may be the only screen.
- Facilitators can read all rounds and answers, since they need to prepare. The copied message and the screen say so.
- Ending a game (new game, Remove) moves its players to the final screen rather than leaving them on a dead one.
