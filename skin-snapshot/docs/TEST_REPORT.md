# Test report

Generated 2026-11-22 by `scripts/make-test-report.ts` from the actual output of `vitest` and `playwright`. Nothing below is claimed without having been run.

## Summary

| Tier | Suite | Tests | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 Automated | api.test.ts | 61 | 61 | 0 | 0 |
| 1 Automated | architecture.test.ts | 13 | 13 | 0 | 0 |
| 1 Automated | core.test.ts | 60 | 60 | 0 | 0 |
| 1 Automated | db.test.ts | 20 | 20 | 0 | 0 |
| 1 Automated | i18n.test.ts | 6 | 6 | 0 | 0 |
| 2 Emulated browser | camera.spec.ts | 12 | 12 | 0 | 0 |
| 2 Emulated browser | journey.spec.ts | 10 | 10 | 0 | 0 |
| 2 Emulated browser | quality.spec.ts | 5 | 5 | 0 | 0 |
| **Total** | | **187** | **187** | **0** | **0** |

Throttled performance measurement (Chromium, 1.6 Mbit/s, 150 ms RTT, 4x CPU slowdown), time to largest contentful paint in ms and kilobytes transferred:

`{"/en":{"lcp":640,"fcp":640,"kb":385},"/hi":{"lcp":596,"fcp":596,"kb":473},"/en/start?path=maintenance":{"lcp":1844,"fcp":512,"kb":333},"/en/healthy-skin":{"lcp":540,"fcp":540,"kb":329}}`

## Not run (open, needs people or accounts)

| Item | Why it was not run | What is needed |
| --- | --- | --- |
| Android Chrome, iPhone Safari, low-end Android, real laptop webcam | No physical devices in the build environment | Run `docs/TESTING.md` tier 3 |
| Real darker and lighter skin tones in varied light | No consented photographs available | Volunteers; send `/en/test/camera` output |
| Left and right 45-degree real head turns | Simulated feed is a frontal portrait | Real device run |
| Beauty-filter detection rate | Needs real filtered frames | Real device run |
| Live AI model: accuracy, label calibration, 60-second target, cost per case | No AI credential reachable from the build environment | An API key or gateway credits, then Console > Settings > Test AI connection and an evaluation run |
| Red-flag recall (95% target) | Needs the dermatologist's labelled photo set | Dermatologist |
| 100-case "no diagnosis, score, skin age or moisture" check on real model output | Needs a live model | The same live run. The vocabulary is enforced by schema and tested on 300 fuzzed outputs and 12 adversarial outputs |
| Supabase Auth sign-in and authenticator enrolment | No Supabase project could be created without a spend approval | Create the project (`docs/DEPLOYMENT.md`) |
| Screen reader pass (VoiceOver, TalkBack, NVDA) | Needs people with the devices | Manual pass |
| Native Hindi review | Needs a reviewer | `docs/REVIEW_REQUIRED.md` |
| Legal and clinical review | Needs professionals | `docs/REVIEW_REQUIRED.md` |
| Backup and restore drill | No production database | Do once before launch (`docs/BACKUP_RESTORE.md`) |

## Blueprint acceptance checklist

| # | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Home page to snapshot in under 5 minutes | Browser journey completes the whole flow in about 8 seconds with scripted input; a person's time depends on the questionnaire and camera | Automated: pass. Human timing: open |
| 2 | Camera works on Android Chrome, iPhone Safari, desktop Chrome, with upload fallback | Desktop Chromium with a simulated camera: pass. Upload fallback: pass | Desktop: pass. Android and iPhone: **open** |
| 3 | In-app browser shows "Open in Chrome or Safari" | Browser test with an Instagram user agent | Pass (user-agent simulation) |
| 4 | Poor photos (dark, blurry, off-angle, two faces) rejected with a specific instruction | Camera tests for each, plus server-side rejection tests | Pass (simulated feed) |
| 5 | Nothing uploaded before the visitor confirms | Browser test watches every request | Pass |
| 6 | Snapshot within 60 seconds of the last photo on a normal mobile connection | Mock provider completes in about 0.1 s; real model not run | **Open** |
| 7 | Snapshot never contains a condition name, score, skin age or moisture reading (100 cases) | Closed vocabulary enforced by schema; 12 adversarial outputs rejected; 300 fuzzed outputs scanned in English and Hindi; every phrase scanned | Pass for the mechanism. Real-model 100-case run: **open** |
| 8 | Planted red-flag photos stop the flow at 95% or more | Answer-based rules: 100% by test. Image flags: mechanism tested with a simulated flag; no planted photos | Answers: pass. Images: **open** |
| 9 | Booking creates a case in the console and opens WhatsApp with only code and first name | API and browser tests | Pass |
| 10 | Delete my photos removes photos and answers and the console no longer shows them | API and browser tests | Pass |
| 11 | Consents stored with version and time; withdrawal works | API and database tests | Pass |
| 12 | Three paths show different questions, observations and next steps | Unit, API and browser tests | Pass |
| 13 | Mobile pages show main content within 2.5 s on a throttled connection | Emulated throttling (see above) | Pass (emulated). Physical phone: **open** |
| 14 | Accessibility check passes on the whole flow | axe WCAG 2.1 A/AA on public pages, flow and console; keyboard test | Pass (automated). Screen reader: **open** |

## Issues found by testing and fixed

| Issue | Found by | Fix |
| --- | --- | --- |
| The sharpness check called a darker-skinned face blurry, because Laplacian variance falls with brightness squared | Fixture measurement (a 45%-brightness copy scored 14 against 55) | Normalised by mean brightness squared; unit test shows tone-independence |
| The booking confirmation crashed because the date column was returned as a date object | Browser journey | Return the date as text; API assertion added |
| Header logo area was inset by the 1080 px content width instead of sitting in the top-right corner | Browser test | Header uses the full width |
| Eyebrow text on the hero (4.41:1) and the active photo-step tab (3.6:1) failed contrast | axe | Lighter text; darker tab with light text |
| 12 new cases an hour per address would block many phones that share one mobile-network address | Test run hitting the limit from one address | Raised to 40; documented; scalable by `RATE_LIMIT_SCALE` |
| Option buttons were not clickable by automation through the hidden input | Browser test | Tests click the visible label, as a person does |

## Every test

| Tier | Suite | Test case (states the expected result) | Actual | Result |
| --- | --- | --- | --- | --- |
| 1 Automated | api.test.ts | health and config reports health, and exposes only non-sensitive config | As expected | Pass |
| 1 Automated | api.test.ts | health and config sends no-store, noindex and no-referrer headers on every response | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: age not confirmed | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: privacy consent missing | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: health consent unticked | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: photo and AI consent unticked | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: unknown path | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: honeypot filled | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents rejects: unknown field | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents records each consent with version and time, and returns only a private token | As expected | Pass |
| 1 Automated | api.test.ts | starting a case: age gate and consents unknown, short or tampered tokens look like "not found" | As expected | Pass |
| 1 Automated | api.test.ts | the three paths ask different things rejects answers meant for another path and accepts the right ones | As expected | Pass |
| 1 Automated | api.test.ts | the three paths ask different things incomplete questionnaires are rejected, and out-of-vocabulary values too | As expected | Pass |
| 1 Automated | api.test.ts | Gate A: answer-based safety stop maintenance with {"mole_changing":"yes"} stops the flow before any photo is requested | As expected | Pass |
| 1 Automated | api.test.ts | Gate A: answer-based safety stop concerns with {"infection_signs":"yes"} stops the flow before any photo is requested | As expected | Pass |
| 1 Automated | api.test.ts | Gate A: answer-based safety stop concerns with {"rapid_worsening":"yes"} stops the flow before any photo is requested | As expected | Pass |
| 1 Automated | api.test.ts | Gate A: answer-based safety stop scars with {"mark_type":["raised"]} stops the flow before any photo is requested | As expected | Pass |
| 1 Automated | api.test.ts | Gate A: answer-based safety stop scars with {"marks_changing":"yes"} stops the flow before any photo is requested | As expected | Pass |
| 1 Automated | api.test.ts | Gate A: answer-based safety stop flags the case for the cosmetologist with metadata only | As expected | Pass |
| 1 Automated | api.test.ts | photos: upload, sanitising, privacy nothing is stored before the browser asks to upload, and tokens are scoped | As expected | Pass |
| 1 Automated | api.test.ts | photos: upload, sanitising, privacy re-encodes the image, removing EXIF/GPS metadata and capping size | As expected | Pass |
| 1 Automated | api.test.ts | photos: upload, sanitising, privacy rejects non-images, tiny, dark and blurry photos with a reason, and frees the slot | As expected | Pass |
| 1 Automated | api.test.ts | photos: upload, sanitising, privacy uploading a slot again replaces the earlier photo and queues its object for deletion | As expected | Pass |
| 1 Automated | api.test.ts | photos: upload, sanitising, privacy the phone-continuation token can upload photos but nothing else | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B maintenance path: snapshot with zones, labels and a (sample) routine; no condition names, scores or digits | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B concerns and scars: observations for their own attributes, recommended talk, no routine | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B INVARIANT: a red flag found in the photos stops the flow, with no routine and no booking | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B poor-quality photos ask for a retake instead of giving a snapshot | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B an invalid or failing provider never produces a snapshot, and leaks no model text | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B path mismatch holds the routine and a switch re-asks the stricter questions and re-runs Gate A | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B pregnancy answers (concerns path) restrict routine advice and are visible to the cosmetologist | As expected | Pass |
| 1 Automated | api.test.ts | analysis, snapshot and gate B logs identifiers and timings but never answers, images or model output | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off creates the booking, records WhatsApp consent, and builds a message with only first name and code | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off the Hindi message has the same two items only | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off is idempotent: a second submit does not create a second booking | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: no contact consent | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: bad number | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: number without country code that is not Indian | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: day outside the next seven | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: unknown window | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: unknown method | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: name with markup | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rejects: note too long | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off requires a finished snapshot first | As expected | Pass |
| 1 Automated | api.test.ts | booking and WhatsApp hand-off rate-limits per number, and blocked numbers cannot book | As expected | Pass |
| 1 Automated | api.test.ts | console: authentication, roles and audit refuses missing, invalid, non-staff and single-step sessions | As expected | Pass |
| 1 Automated | api.test.ts | console: authentication, roles and audit visitor tokens cannot call the console, and staff tokens cannot act as visitors | As expected | Pass |
| 1 Automated | api.test.ts | console: authentication, roles and audit role limits: cosmetologist cannot read the access log, staff list or change settings; admin can | As expected | Pass |
| 1 Automated | api.test.ts | console: authentication, roles and audit opening a case, viewing a photo and changing status are all recorded in the access log | As expected | Pass |
| 1 Automated | api.test.ts | console: authentication, roles and audit notes, AI feedback, missed-flag report, export and deletion work; deletion removes it everywhere | As expected | Pass |
| 1 Automated | api.test.ts | console: authentication, roles and audit routine templates: edit, approve, banned terms refused, and approved text reaches visitors without the sample label | As expected | Pass |
| 1 Automated | api.test.ts | consent withdrawal and deletion by the visitor withdrawing photo/AI consent deletes photos and analysis; the case continues without them | As expected | Pass |
| 1 Automated | api.test.ts | consent withdrawal and deletion by the visitor withdrawing health-answers consent erases the answers and snapshot | As expected | Pass |
| 1 Automated | api.test.ts | consent withdrawal and deletion by the visitor withdrawing WhatsApp consent stops contact and hides details from the console | As expected | Pass |
| 1 Automated | api.test.ts | consent withdrawal and deletion by the visitor withdrawing the privacy consent, or pressing "delete my photos and case", removes everything at once | As expected | Pass |
| 1 Automated | api.test.ts | retention and purge refuses callers without the cron secret | As expected | Pass |
| 1 Automated | api.test.ts | retention and purge deletes unbooked cases after the deadline (photos, objects, answers) but keeps booked ones | As expected | Pass |
| 1 Automated | api.test.ts | analytics accepts whitelisted events with only step names and timings; rejects anything else | As expected | Pass |
| 1 Automated | api.test.ts | analytics the server records funnel events through the whole journey | As expected | Pass |
| 1 Automated | api.test.ts | bot protection (proof of work) requires a solved, unexpired, single-use challenge | As expected | Pass |
| 1 Automated | api.test.ts | rate limits limits case creation per visitor address | As expected | Pass |
| 1 Automated | architecture.test.ts | module boundaries (hosting and vendor independence) src/core is pure: it imports only itself, zod and libphonenumber-js, never I/O, frameworks or vendors | As expected | Pass |
| 1 Automated | architecture.test.ts | module boundaries (hosting and vendor independence) no Vercel- or Supabase-specific code outside the adapters that isolate them | As expected | Pass |
| 1 Automated | architecture.test.ts | module boundaries (hosting and vendor independence) the data layer is the only code that writes SQL for application tables | As expected | Pass |
| 1 Automated | architecture.test.ts | module boundaries (hosting and vendor independence) no secrets or hosts are hard-coded: server code reads configuration only through server/config.ts | As expected | Pass |
| 1 Automated | architecture.test.ts | portability the API runs on a plain Node HTTP server with no Next.js or Vercel involved | As expected | Pass |
| 1 Automated | architecture.test.ts | portability S3-compatible storage adapter produces short-lived presigned upload URLs and never leaks the secret | As expected | Pass |
| 1 Automated | architecture.test.ts | portability signed links expire and are bound to one action | As expected | Pass |
| 1 Automated | architecture.test.ts | development sign-in is unavailable outside development refuses to start in staging or production with the development auth provider or the mock AI | As expected | Pass |
| 1 Automated | architecture.test.ts | development sign-in is unavailable outside development /api/dev/token does not exist when the provider is not "dev" | As expected | Pass |
| 1 Automated | architecture.test.ts | retake clears photos and analysis but keeps answers and consents, and the case can capture again | As expected | Pass |
| 1 Automated | architecture.test.ts | Turnstile adapter (mocked network) accepts only when the provider says success, and never without a token | As expected | Pass |
| 1 Automated | architecture.test.ts | hosted defaults a Vercel deployment without APP_ENV is staging with 24-hour retention; production must be explicit; the signing secret can derive from the database credential | As expected | Pass |
| 1 Automated | architecture.test.ts | hosted defaults admins can check the AI connection; cosmetologists cannot | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) passes a clean maintenance questionnaire | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) stops every path on mole_changing=yes | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) stops every path on sore_not_healing=yes | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) stops every path on infection_signs=yes | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) stops every path on severe_inflammation=yes | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) stops every path on eye_area_problem=yes | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) applies the stricter concerns-only screen | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) sends raised or changing marks straight to referral (scars path) | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) restricts routine advice for pregnancy, breastfeeding, unknown, or medicines, without stopping | As expected | Pass |
| 1 Automated | core.test.ts | Gate A (answers) every red-flag question on every path is covered by a rule (no silent gaps) | As expected | Pass |
| 1 Automated | core.test.ts | Gate B (image) over-flags by default: even a "not_sure" report stops the flow | As expected | Pass |
| 1 Automated | core.test.ts | Gate B (image) can be configured to require higher confidence | As expected | Pass |
| 1 Automated | core.test.ts | Gate B (image) combines with Gate A | As expected | Pass |
| 1 Automated | core.test.ts | questionnaire validation has different questions per path | As expected | Pass |
| 1 Automated | core.test.ts | questionnaire validation accepts valid answers and rejects unknown keys, bad values and exclusive conflicts | As expected | Pass |
| 1 Automated | core.test.ts | questionnaire validation detects which questions a path switch still needs | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) accepts a well-formed result | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a diagnosis field | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a score field | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a skin age field | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a hydration field | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects free text in a finding | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a finding from another attribute | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects an attribute reported for the wrong zone | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a side that is not valid for the zone | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects not_assessed without a reason | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects an unknown red-flag code | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a product recommendation field | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) rejects a percentage as a string value | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) fills missing grid cells as not assessed and drops rows the path does not assess | As expected | Pass |
| 1 Automated | core.test.ts | AI output validation (closed vocabulary) merging passes downgrades disagreement to "not sure" and unions red flags | As expected | Pass |
| 1 Automated | core.test.ts | phrase library and banned terms has every phrase in English and Hindi | As expected | Pass |
| 1 Automated | core.test.ts | phrase library and banned terms has a phrase for every finding, zone, attribute, side, confidence and reason | As expected | Pass |
| 1 Automated | core.test.ts | phrase library and banned terms contains no condition name, score, skin age, hydration claim or digit in any phrase (EN and HI) | As expected | Pass |
| 1 Automated | core.test.ts | phrase library and banned terms the scanner itself catches what it should | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants maintenance: routine from a template, optional talk | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants concerns and scars: no routine, talk recommended | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants INVARIANT: a stopped case has no observations, no routine, no booking prompt | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants INVARIANT: an image red flag stops an otherwise clean case | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants holds the routine when pregnancy/medicine answers restrict it | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants holds the routine when photos fit another path better (stricter questions not yet asked) | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants shows no routine at all when only unapproved templates exist and samples are off | As expected | Pass |
| 1 Automated | core.test.ts | snapshot composition and safety invariants FUZZ: 300 random model outputs never put a banned term, digit or condition name into the rendered snapshot | As expected | Pass |
| 1 Automated | core.test.ts | routine selection uses only approved templates unless samples are allowed, and prefers approved over sample | As expected | Pass |
| 1 Automated | core.test.ts | routine selection matches steps, skin feel and sensitivity | As expected | Pass |
| 1 Automated | core.test.ts | booking and WhatsApp hand-off message contains only first name and case code | As expected | Pass |
| 1 Automated | core.test.ts | booking and WhatsApp hand-off validates numbers with country code and rejects junk | As expected | Pass |
| 1 Automated | core.test.ts | booking and WhatsApp hand-off offers the next seven days and requires contact consent | As expected | Pass |
| 1 Automated | core.test.ts | identifiers and retention case codes are well-formed and distinct; tokens are 256-bit | As expected | Pass |
| 1 Automated | core.test.ts | identifiers and retention unbooked cases expire after 72 hours; booked cases 90 days after closure | As expected | Pass |
| 1 Automated | core.test.ts | image metrics sharpness separates textured from flat images | As expected | Pass |
| 1 Automated | core.test.ts | image metrics sharpness does not depend on skin tone or exposure: the same texture at 40% brightness scores the same | As expected | Pass |
| 1 Automated | core.test.ts | image metrics light check is relative: a dark-skinned face in good light is not "too dark" | As expected | Pass |
| 1 Automated | core.test.ts | image metrics flags a genuinely dim image, glare, side lighting and backlight | As expected | Pass |
| 1 Automated | core.test.ts | image metrics luma stats | As expected | Pass |
| 1 Automated | core.test.ts | pose and live-guidance checks recovers yaw, pitch and roll from a transform matrix | As expected | Pass |
| 1 Automated | core.test.ts | pose and live-guidance checks takes the sign of the turn from the landmarks | As expected | Pass |
| 1 Automated | core.test.ts | pose and live-guidance checks front shot: passes when centred, near, level and facing forward | As expected | Pass |
| 1 Automated | core.test.ts | pose and live-guidance checks gives a specific instruction for each failure | As expected | Pass |
| 1 Automated | core.test.ts | pose and live-guidance checks left shot wants the left cheek toward the camera at about 45 degrees; right shot the opposite | As expected | Pass |
| 1 Automated | db.test.ts | migrations create the expected tables, all with row-level security enabled | As expected | Pass |
| 1 Automated | db.test.ts | migrations seed sample routine templates, none approved | As expected | Pass |
| 1 Automated | db.test.ts | visitor and anonymous roles have no direct data access anon cannot read or write any table | As expected | Pass |
| 1 Automated | db.test.ts | visitor and anonymous roles have no direct data access a signed-in role without a staff row is forbidden everywhere | As expected | Pass |
| 1 Automated | db.test.ts | visitor and anonymous roles have no direct data access a staff member without two-step verification (aal1) is forbidden | As expected | Pass |
| 1 Automated | db.test.ts | visitor and anonymous roles have no direct data access an inactive staff member is forbidden | As expected | Pass |
| 1 Automated | db.test.ts | visitor and anonymous roles have no direct data access even a staff session cannot read the sensitive tables directly, only through the logged functions | As expected | Pass |
| 1 Automated | db.test.ts | role-based access inside the console cosmetologist can open cases but cannot read the access log, staff list or change settings | As expected | Pass |
| 1 Automated | db.test.ts | role-based access inside the console admin can read the access log, staff list and settings | As expected | Pass |
| 1 Automated | db.test.ts | case visibility and the access log opening a booked case returns details and writes an access-log row in the same transaction | As expected | Pass |
| 1 Automated | db.test.ts | case visibility and the access log a flagged case that never booked shows metadata only (no answers, photos or analysis) | As expected | Pass |
| 1 Automated | db.test.ts | case visibility and the access log withdrawing WhatsApp consent hides photos and answers from the console | As expected | Pass |
| 1 Automated | db.test.ts | case visibility and the access log access log is append-only, even for the application role | As expected | Pass |
| 1 Automated | db.test.ts | case visibility and the access log the queue lists newest booking first, supports filters, and hides personal fields of unbooked flagged cases | As expected | Pass |
| 1 Automated | db.test.ts | status, notes, feedback, templates, deletion moves through all six statuses; closing sets the retention deadline, reopening clears it | As expected | Pass |
| 1 Automated | db.test.ts | status, notes, feedback, templates, deletion notes are private to staff and logged | As expected | Pass |
| 1 Automated | db.test.ts | status, notes, feedback, templates, deletion AI feedback is one verdict per reviewer per observation and can be changed | As expected | Pass |
| 1 Automated | db.test.ts | status, notes, feedback, templates, deletion routine templates: staff can read directly under RLS; approval stamps the approver; samples stop being samples once approved | As expected | Pass |
| 1 Automated | db.test.ts | status, notes, feedback, templates, deletion deleting a case removes everything, queues object removal, and leaves a ledger row and an audit row | As expected | Pass |
| 1 Automated | db.test.ts | analytics counts computes the proposed success measures from events | As expected | Pass |
| 1 Automated | i18n.test.ts | i18n Hindi has exactly the same keys as English | As expected | Pass |
| 1 Automated | i18n.test.ts | i18n no Hindi string is empty, and none is left identical to English except brand-neutral tokens | As expected | Pass |
| 1 Automated | i18n.test.ts | i18n placeholders are preserved in translations | As expected | Pass |
| 1 Automated | i18n.test.ts | i18n every question and option has text in both languages | As expected | Pass |
| 1 Automated | i18n.test.ts | i18n every consent has wording in both languages | As expected | Pass |
| 1 Automated | i18n.test.ts | i18n the logo placeholder text is the exact English string regardless of language (it is not translated) | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | good light, centred and still: overlay turns green, 3-second countdown, automatic capture, review | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | darker-skin proxy (same face at 45% brightness) is NOT rejected as too dark or blurry | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | underexposed picture: "too dark" instruction, never counts down | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | blurred picture: "blurry" instruction | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | two faces: asks for a solo photo | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | tilted head: asks to keep head level | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | face too small in frame: asks to move closer | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | manual shutter on an underexposed frame: photo is rejected with a specific reason and cannot be used | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | side shots: a frontal face is told to turn; a soft angle problem still allows a manual photo | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | camera permission blocked: step-by-step help for this browser, plus the upload option | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | no camera on this device: upload option plus continue-on-phone QR code | As expected | Pass |
| 2 Emulated browser | camera.spec.ts | in-app browser (Instagram) is detected and told to open in Chrome or Safari | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | home page: brand, reserved logo slot top right, privacy strip, three paths | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | language switch: one tap each way, persists across pages, whole flow translated | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | all public pages render in both languages with no horizontal scroll at phone width | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | mobile navigation opens and the logo slot stays top right | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | start: consents are separate and unticked; cannot continue without them; creates a private case | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | maintenance journey: questions, tips, upload fallback, nothing uploaded before confirm, snapshot, booking, WhatsApp | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | console: sign in, the new booking is at the top, photos load, notes, status, feedback, templates, counts, access log | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | safety: a red-flag answer stops the flow with a calm referral, no photos, no routine, no booking | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | Hindi end to end: questions, snapshot, booking and WhatsApp message in Hindi | As expected | Pass |
| 2 Emulated browser | journey.spec.ts | visitor deletes everything: link dies, console no longer lists it | As expected | Pass |
| 2 Emulated browser | quality.spec.ts | accessibility: public pages in English and Hindi | As expected | Pass |
| 2 Emulated browser | quality.spec.ts | accessibility: the whole assessment flow (questions, tips, camera fallback, snapshot, booking, confirmation, safety stop) | As expected | Pass |
| 2 Emulated browser | quality.spec.ts | accessibility: console | As expected | Pass |
| 2 Emulated browser | quality.spec.ts | keyboard: the questionnaire and consent form can be completed with the keyboard alone | As expected | Pass |
| 2 Emulated browser | quality.spec.ts | performance: home page main content within 2.5 s on a throttled mobile connection | As expected | Pass |
