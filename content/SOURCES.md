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

## Extension: set, minutes, keyMessages, discussion (rounds 1-8) and extra rounds 9-14

Rounds 1-8 are `set: "core"` (7-9 minutes each) with 2-3 `keyMessages` and 2 `discussion` questions added from their existing `why` text and standards; nothing in questions, options, scores or knock-outs changed. Rounds 9-14 are `set: "extra"`, framed as "Day 2" stops at Canal General Hospital (clock "Day 2, 09:00" to "Day 2, 14:30"; round 8 stays "Day 3"). Case details come from the same case banks; the discussion questions are new.

Standard codes for the new rounds were checked against `raw/gahar_hospital_standards_2025.md` (IMT.01, IMT.04 to IMT.09, ICD.18, ACT.03, ACT.08, ACT.15, PCC.04, PCC.08) and the survey guide `raw/pdf/hospital/gahar-hospital-accreditation-survey-guide-en.md` (decision rules p. 24, look-back p. 25, Patient Medical Record Review session p. 73-75, IMT tracer p. 70-72).

| Round | Topic | Scene style | Standards | Real case (bank, number, status) |
|---|---|---|---|---|
| 9 Ten closed files | Closed record review: consent, discharge summary, IMT.09 | document (reviewer grid) | PCC.04, PCC.08, ACT.15, IMT.09, ACT.03 | Kafr El-Sheikh and El-Mahalla El-Kubra audits, Egypt 2019: Egypt bank #4. Partly verified (abstract level, single source); worded "reported" |
| 10 "U", "QD", ".5 mg" | Abbreviations on handwritten downtime orders | photo (dark-ward.jpg, 5 callouts) | IMT.04 / GSR.29, MMS.11, PCC.08 | ISMP Canada dangerous abbreviations 2005: Records bank #4. Verified (column read). Used in the wiki map for B5/B7, not in rounds 1-8 |
| 11 One login for every doctor | Shared generic account, password note, role-based access | feed (login log) | IMT.05, IMT.06 | Centro Hospitalar Barreiro Montijo, Portugal 2018: Records bank #20. Partly verified (IAPP report; decision not read); worded "reported" |
| 12 A photo of the whole file | Release of information by WhatsApp | chat (ward chat, Egyptian colloquial) | IMT.08 d, IMT.05 e-f, IMT.01, PCC.13 | MoHP patient data offered for sale 2023: Egypt bank #17. Verified for the claim and the minister's confirmation; record count is the seller's claim. Analogy only: it is a leak, not a WhatsApp case |
| 13 Phone order at 02:15 | Verbal and telephone orders, handover gap | feed (night timeline) | ICD.18 / GSR.02, ACT.08 / GSR.04 | Joint Commission SEA 58 and I-PASS: Records bank #11. Verified |
| 14 The basement archive | Retention, storage, destruction logbook | document (paper-walk notes) | IMT.07, IMT.06, IMT.01 | NYU Langone, Hurricane Sandy 2012: Downtime bank #18. Verified (ProPublica). Used as an analogy: single point of failure below flood level; the case is about power, not paper |

## Scoring and knock-out decisions (rounds 9-14)
- Best option 1000, with its position varied: R9 C, R10 D, R11 B, R12 A, R13 D, R14 C. 400 for defensible but incomplete (R9 A, R10 B, R11 D, R12 C, R13 B, R14 B); others 0.
- Knock-outs: R9 B (altering sampled closed files, consent signed after the event), R10 C (rewriting original orders), R11 C (re-attributing "DOCTOR" orders by guesswork), R13 C (no write-down, read-back or confirmation: ICD.18 / GSR.02), R14 A (back-dated destruction log). All but R13 C are falsification; R13 C is a direct GSR breach.
- No knock-out in R12 (IMT.05, IMT.08 and IMT.01 are not GSR; an unsafe release is a poor choice but not a GSR breach or a falsification).

## Accuracy notes for rounds 9-14
- Author, date and time entry rules and audit-trail review are not stated as hospital requirements. R11 tags access-log review X (survey guide lists audit logs as requested documents; routine review is good practice).
- R9: each surveyor pulls at least 10 closed records (guide p. 74). None of PCC.04, PCC.08, ACT.15 or IMT.09 is a GSR; the round says so.
- R12 and R14: no Egyptian legal citation beyond Law 13/2025 Art 6 and PDPL 151/2020, both read in unofficial translation (partly verified, tag E). No retention period in years and no statutory right of a relative to a copy is stated (wiki L4 and L5 not verified).
- R13: the handover record need not be in the medical file (ACT.08 intent f). No physician authentication deadline is stated beyond "predefined timeframe".
- Patients and staff in the scenes are fictional.
