# Content that needs qualified review before public launch

Nothing below is approved. Each item is marked "Pending qualified review" or "DRAFT" wherever it appears on screen.

| # | Item | Who | Where in the code |
| --- | --- | --- | --- |
| 1 | Consent wording (privacy, health answers, photo and AI processing incl. "outside India", WhatsApp contact, optional AI quality checks), versioning, withdrawal effects | Data-protection lawyer | `src/i18n/en.ts` `start.consents`, `legal.consent`; `src/core/consent.ts` |
| 2 | Privacy notice, terms of use, medical disclaimer, grievance contact, data-request response time | Lawyer | `src/i18n/*` `legal.*` |
| 3 | Retention rules: 72 h unbooked, closure plus 90 days booked, backup purge window | Lawyer | `RETENTION_*` variables, `src/core/retention.ts` |
| 4 | Who may see flagged cases that never booked (currently: metadata only; no photos or answers) | Lawyer | `ss.case_details_visible` |
| 5 | Whether red-flag detection from images moves the product towards a regulated medical device; positioning as cosmetic guidance | Lawyer and clinician | `docs/AI.md`, snapshot wording |
| 6 | Answer-based red-flag rules: questions, wording, which answers stop the flow, the stricter concerns-path rules, raised or changing marks on the scars path | Dermatologist | `src/core/safety.ts` (`GATE_A_RULES`), `src/core/questionnaire.ts` |
| 7 | Image red-flag list, the "over-flag" default, and the 95% target (and how the zero-missed measure is read) | Dermatologist | `src/core/safety.ts` (Gate B), `src/ai/prompt.ts` rule 6, Console > Settings |
| 8 | A red-flag test set of photographs across skin tones (Fitzpatrick III to VI at least) labelled by the dermatologist | Dermatologist | not in the repository |
| 9 | Pregnancy, breastfeeding and medicine restrictions | Dermatologist | `routineRestrictions` in `src/core/safety.ts` |
| 10 | The approved phrase library (every sentence the snapshot can show, English and Hindi) | Cosmetologist; native Hindi reviewer | `src/core/phrases.ts` |
| 11 | Starter routine templates. The 12 seeded templates are SAMPLES, shown only while "sample routines" is on | Cosmetologist | Console > Routine templates |
| 12 | The "realistic expectations" text on the concerns and scars paths | Cosmetologist and dermatologist | `phrases.ts` `expect.*` |
| 13 | Cosmetologist's real qualifications, registration, experience, location. No "Dr" unless registered | Cosmetologist | About page (placeholders), `NEXT_PUBLIC_CONTACT_*` |
| 14 | First talk: free or paid, length, service promise | Business owner | FAQ, booking page, Console > Settings |
| 15 | All Hindi text (legal and medical wording especially) | Native Hindi reviewer | `src/i18n/hi.ts`, `phrases.ts` |
| 16 | AI provider terms: no training on your data, retention, data location | Lawyer | provider contract |
| 17 | Accuracy of the AI on Indian skin tones, by tone band | Dermatologist plus evaluation run | `docs/AI.md` evaluation |

Launch gate: items 1 to 9, 13 and 14 must be done. Switch off sample routines (Console > Settings) and set `APP_ENV=production`.
