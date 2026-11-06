# Content sources

Beats ported from `informatics/tracks/gahar-standards-reference/wiki/events/records-survey-sim/index.html` (`BEATS` array). Cases from `wiki/events/records-case-bank.md` (hub) and the three case banks in `wiki/concepts/`. Standard codes checked against `raw/gahar_hospital_standards_2025_index.md` (ACT.03 = GSR.01, ICD.18 = GSR.02, ICD.19 = GSR.03, EFS.11 = GSR.28).

| Round | Beat | Scene style | Real case (bank, number, status) |
|---|---|---|---|
| 1 Backup log | B1 | document (backup log) | HSE Ireland Conti 2021: Downtime bank #2. Verified (PwC review, Dec 2021) |
| 2 Missing file | B2 | chat (records room group) | 709,000 unprocessed clinical letters: Records bank #7. Verified (NAO 2017) |
| 3 Same name | B3 | document (HIS screen) | The wrong patient, Chassin and Becher 2002: Records bank #1. Verified |
| 4 Server cupboard | B4 | photo (server-cupboard.jpg, 5 callouts) | Guy's and St Thomas' 2022: Downtime bank #4. Verified (Trust review, Jan 2023) |
| 5 Power cut | B5 | feed (incident timeline) | Ismailia, Aug 2014: Egypt bank #20. Verified for the 2014 events (press: Ahram, Gulf News); worded "press reports" and labelled historical. Not used: the partly verified 2023-24 hospital exemption |
| 6 Potassium 6.9 | B6 | chat (ward WhatsApp, Egyptian colloquial) | PSA result to graduated resident 2011: Records bank #9. Verified (AHRQ WebM&M). Synnovis not used (causation caution) |
| 7 Restore and back-entry | B7 | document (reconciliation sheet) | VA "unknown queue" 2022: Records bank #6. Verified (VA OIG 22-01137-204) |
| 8 Daily briefing | B8 | photo (dark-ward.jpg, 5 recap callouts) | WannaCry 2017: Downtime bank #1. Verified (NAO). Duesseldorf, Springhill not used |

## Scoring and knock-out decisions
- Best option 1000; defensible but incomplete 400 (R1 B, R3 A and D, R4 A, R5 C, R7 C); others 0.
- Knock-outs: R1 D (falsified log), R6 A (result recorded by name only, GSR.01) and R6 D (value on wristband, outside any record). R6 B is also incomplete against GSR.03 but is not flagged.
- No knock-out in R3, R4, R8 (analysis questions: choosing a lesser finding is not itself a GSR breach). IMT.05, IMT.06, IMT.11 and IMT.12 are not GSR, so poor backup, downtime or storage choices alone are not knock-outs.
- R7 back-entry author/date/time rules are tagged X (PHC IMT.08 / best practice), not a hospital requirement.

## Scene notes
- Photo rounds use numbered callouts as `scene.lines` with `t` = the callout number.
- Rounds 3 and 6 use beds 12 and 13 for the two same-name men (the mock-up used 9 and 14) so the story stays consistent with the beat.
