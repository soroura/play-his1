# Facilitator run sheet

Live online session, 8 rounds, about 60 to 75 minutes. Players use their own phones or laptops; you share the host screen.

## Before (T minus 15 minutes)

1. Open `https://play-his1.endura-assess.com/host`. Log in with the PIN at least 15 minutes before the session (the login lasts 12 hours; repeated wrong PINs from anyone lock new logins for 10 minutes).
2. Create the game. The lobby shows a QR code, the join link with the room code already in it, and the code in large type.
3. Share the browser tab (not the whole desktop) in the meeting. Check the text is readable in the meeting's shared view.
4. Press "Copy invite for chat" and paste it into the meeting chat or a WhatsApp group (English and Arabic, link + code).
   The link already carries the code, so people only type a nickname. Phones in the room can scan the QR on the shared screen.
5. Do a quick check on your own phone: join and see the "How to play" card (then close that test player's tab).
6. Watch the player count in the lobby climb. Start when most people are in.
7. Press `H` to hide the control bar once you are set, so the shared screen is clean.

## Keys (host screen)

| Key | Action |
|---|---|
| `Space` or `Right arrow` | next step |
| `R` | reveal the answer |
| `+` | add 15 seconds to the open question |
| `L` | show the leaderboard |
| `H` | hide or show the control bar |
| `Q` | show or hide the invite (QR, link with code, copy buttons) for late joiners, any time |
| `M` | sound on or off |

## Each round (about 7 to 9 minutes)

| Step | What you do | Time |
|---|---|---|
| Scene | Next (`Space`). The scene plays on the big screen. Read the key lines aloud for people on phones or poor audio. Phones say "look at the shared screen". | 1.5 to 2 min |
| Open the question | Next. Read the question. Tiles appear on phones. The timer runs. | 0.5 min |
| Watch progress | The bar shows "N / total answered". Do not reveal the distribution. Use `+` if many are still thinking. The question closes when the timer ends or everyone has answered. | 1 to 1.5 min |
| Reveal | `R`. Walk through the bars, the best option, any knock-out stamp, the why, the real case. | 1 min |
| Discuss | Ask 2 or 3 people (unmute, or use chat) why they chose what they chose. Keep to 2 to 3 minutes. | 2 to 3 min |
| Leaderboard | `L` or Next. Name the top 3, congratulate, move on. | 0.5 min |

8 rounds x 7 to 9 minutes = 56 to 72 minutes. Add 5 minutes for the lobby, and the final podium and wrap-up. If you are
running late, shorten the discussion first, never the reveal.

## If something goes wrong

- **A player dropped, or their phone refreshed.** Ask them to open the same join link again on the same device. They rejoin as the
  same player with their score. Do not ask them to type a new nickname (that would create a second player).
- **A player is on a different device now.** They join as a new player; their old score stays with the old device.
- **You refreshed or closed the host page.** Open `/host` again and log in. The game state is kept on the server and you continue
  where you were.
- **Nobody can reach the site, or the page does not load for everyone.** Check `https://play-his1.endura-assess.com/api/health`.
  If it fails, tell the group plainly, and use the fallback: keep the scenes, questions and best answers to hand (content/rounds.json, or the earlier
  slide version); read each scene aloud, take answers by chat (A, B, C, D) or a show of hands, reveal verbally. Contact the person with VPS access
  (see docs/DEPLOY.md, sections 6 and 7: restart, rollback, logs).
- **Only some players cannot connect.** Ask them to try mobile data instead of Wi-Fi, or another browser.
- **The timer ran out but a player says they were answering.** Answers are timed on the server; the answer is locked. Explain,
  and let them discuss in the reveal.
- **Wrong key pressed (revealed too early).** Carry on and use the discussion time to ask what people would have chosen.

## After

1. On the final screen read out the podium (top 3).
2. Tell players: "tap Open my report on your phone; it shows each of your answers against the best one, your points, the
   knock-outs you hit, the why and the real case". Reports can be printed or saved from the browser and stay available 14 days.
3. Put the report instructions in the meeting chat too.
4. Close with the two or three lessons from your notes, and what happens next in the module.
