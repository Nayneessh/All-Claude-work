# Testing

Evidence comes in three tiers. A result is only reported as passed if the test was actually run in that tier.

| Tier | What | Who runs it |
| --- | --- | --- |
| 1. Automated | Unit, database, API, architecture tests (`npm test`) | CI or anyone |
| 2. Emulated browser | Playwright in desktop Chromium: full journeys, a simulated camera, accessibility (axe), keyboard, throttled performance (`npm run build:e2e && npm run test:e2e`) | CI or anyone |
| 3. Real device | Android Chrome, iPhone Safari, low-end Android, a laptop webcam, a range of skin tones and lighting | **A person with the device** |

`docs/TEST_REPORT.md` lists what was run in tiers 1 and 2 and what is still open in tier 3.

## Commands

```bash
npm run typecheck
npm test                                  # 160+ tests, no browser; embedded Postgres, mock AI
npm run build:e2e && npm run test:e2e     # builds with the e2e environment, runs 27 browser tests
bash scripts/e2e-server.sh                # run the e2e build by hand on :3100
npx tsx scripts/measure-fixtures.ts       # print the sharpness metric for the camera fixtures
```

## What the automated tests cover

* **Safety:** every red-flag question on every path stops the flow; the concerns-only stricter questions; raised or changing marks; pregnancy and medicine restrictions; image red flags stop an otherwise clean case; a stopped case never has observations, a routine or a booking prompt (unit, API and browser levels); path mismatch holds the routine and a switch re-asks the stricter questions.
* **AI output:** 12 kinds of malformed or forbidden model output are rejected (diagnosis, score, skin age, hydration, free text, wrong vocabulary, wrong zone, product list, unknown red flag...); 300 fuzzed outputs rendered in English and Hindi contain no condition name, digit, score or claim; a failing or invalid provider never produces a snapshot; logs hold no answers, images or model text.
* **Privacy:** nothing is uploaded before confirmation (network watch in the browser); EXIF and GPS metadata are removed; signed links are scoped and expire; the staff console cannot be reached without a two-step session; role limits; append-only access log; consent withdrawal effects; "delete my photos and case" removes everything including objects; retention purge; deleted cases leave only a ledger row.
* **Camera:** live checks run on a simulated feed: good frame auto-captures after a 3-second countdown; a darker-skin brightness proxy is not rejected; dim, blurred, two-face, tilted and too-far frames each give a specific instruction and never count down; a manual shutter on a bad frame cannot be used; a soft angle problem can; blocked permission, no camera, in-app browser; phone continuation by QR end to end.
* **Booking:** validation, number format, seven-day window, rate limits, block list, idempotence, WhatsApp message contains only first name and code (English and Hindi), QR on laptop.
* **Language:** both catalogues have identical keys and placeholders (type-checked and tested); Hindi journey end to end; switch persists for the visit.
* **Accessibility:** axe (WCAG 2.1 A and AA) on 30 public pages, the whole assessment flow including the safety stop in Hindi, and every console page; keyboard completion of consent and a question.
* **Performance:** home, Hindi home, start and a path page measured at 1.6 Mbit/s, 150 ms round trip, 4x CPU slowdown.
* **Portability:** core is pure; vendor packages only in adapters; the API runs on a plain Node server; S3 adapter signs URLs; a clean unzip of the exported source rebuilds, type-checks and passes tests.

## Real-device checklist (tier 3)

Do this on the staging URL. Run `/en/test/camera` first on each device and keep the copied result.

| # | Device | Check |
| --- | --- | --- |
| 1 | Low-end Android phone, Chrome | Home to snapshot in under 5 minutes; auto-capture works; side shots at about 45 degrees pass; poor light is refused with a specific instruction; self-test shows model load time and inference per frame |
| 2 | iPhone, Safari | Same; camera permission prompt; front camera; retake; QR continuation from a laptop |
| 3 | Laptop, Chrome and Safari or Edge | Webcam capture; denied permission help; upload fallback; QR to phone |
| 4 | WhatsApp, Instagram in-app browsers | "Open in Chrome or Safari" prompt appears |
| 5 | Skin tones | At least 3 volunteers across light, medium and deep skin (with consent): good light is accepted, dim light is refused, no "too dark" for deep skin in good light. Note any false refusals and send the self-test output |
| 6 | Lighting | Window light, lamp from one side, backlit, direct sun: each gives the right instruction |
| 7 | Filters | A phone beauty filter: is it caught? Record the miss rate |
| 8 | Slow network | Throttle to 3G: the model download finishes during the questionnaire, upload retries work |
| 9 | Screen readers | VoiceOver (iPhone), TalkBack (Android), NVDA (Windows): consent, questionnaire, camera guidance announcements, snapshot |
| 10 | Hindi | A native reader reads every screen: wording natural, medical and legal terms right, fonts render on each device |
| 11 | WhatsApp | The message opens with only first name and code on a phone and via QR from a laptop |
| 12 | Console | Staff sign-in with authenticator app; case opens; photos load; status; notes; template approve; counts; access log |

Record device, OS, browser, result and screenshots in a table and add it to `docs/TEST_REPORT.md`.

## Calibration

Camera thresholds are in `src/core/vision-metrics.ts`. If real-device runs show false refusals or false passes, adjust there and re-run `npm test` (the pose and metric tests state the intended behaviour) and `npm run test:e2e`.

## Acceptance criteria from the blueprint

Mapped in `docs/TEST_REPORT.md`, section "Blueprint acceptance checklist".
