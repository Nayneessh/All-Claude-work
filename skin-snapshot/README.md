# Skin Snapshot (working title)

A web-based skincare assessment and cosmetologist hand-off. A visitor picks a skin concern, takes guided photos in the browser, receives a plain-language AI skin snapshot, and can request a short preliminary conversation with the cosmetologist on WhatsApp. English and Hindi.

This is **Phase 1** of the blueprint *Phase 1 Website: Features and Sections* (see `docs/DECISIONS.md` for how each requirement was met and where the build deliberately differs).

> **Not for public launch yet.** Consent, privacy, retention, disclaimer and clinical-safety wording is draft. Routine templates are labelled samples. The red-flag rules and thresholds have not been reviewed by a dermatologist. See `docs/REVIEW_REQUIRED.md`.

## What is in the box

| Area | What it does |
| --- | --- |
| Public site | Home, three path pages, how it works, about, FAQ, contact, privacy, consent, terms, medical disclaimer, camera help and system pages, in English and Hindi, with a one-tap language switch |
| Assessment | Age gate, four separate consents (plus one optional), path-specific questionnaire, two safety gates, guided camera, upload fallback, phone continuation by QR, analysis, snapshot, WhatsApp booking |
| Guided camera | On-device face model (MediaPipe) checks single face, centring, distance, angle, tilt, light, sharpness and suspected filters; 3-second auto-capture; manual shutter; retake |
| AI engine | Provider-neutral. The model can only return approved codes; the app renders approved English and Hindi phrases. No diagnosis, score, skin age or moisture reading is possible |
| Safety | Deterministic answer rules, image red-flag check tuned to over-flag, server-side invariants: a stopped case never receives observations, a routine or a booking prompt |
| Console | Two-step sign-in, queue, case brief, photos, AI observations with agree/disagree, notes, six statuses, routine templates, export, delete, counts, access log |
| Privacy | Photos stay on the device until confirmed, metadata stripped, short-lived signed links, hard deletion with a ledger, configurable retention, first-party analytics only |

## Quick start (development)

```bash
npm ci                      # also copies the MediaPipe runtime into public/vision/wasm
cp .env.example .env.local  # development works with no values: embedded Postgres, mock AI, development sign-in
npm run dev                 # http://localhost:3000
```

```bash
npm test                    # unit, database (real Postgres semantics), API and architecture tests
npm run typecheck
npm run build:e2e && npm run test:e2e   # browser journeys, camera guidance, accessibility, performance
```

## Deploying

* **Vercel + Supabase (today):** `docs/DEPLOYMENT.md`
* **Any other host (later):** `docs/MIGRATION.md`; there is a `Dockerfile` and `docker-compose.yml`
* **Download everything:** `npm run export:source` writes a secret-free ZIP

## Layout

```
src/core       Pure rules: safety gates, questionnaires, AI schema and validators, phrases, consent, retention, booking
src/ai         Provider adapters (anthropic, openai-compatible, mock), prompt v1
src/data       Database access: drivers and repositories (the only application SQL)
src/storage    Object store interface: Postgres-backed and S3-compatible adapters
src/server     Hono API, services, analysis pipeline, auth, bot check, purge job
src/i18n       English and Hindi catalogues (type-checked for parity)
src/app        Next.js pages: public site (/[lang]), console (/console), API route
src/components UI
supabase/migrations  Plain SQL, applies to any PostgreSQL 15+
tests, e2e     Vitest and Playwright
docs           Architecture, database, API, AI, security, deployment, migration, operations, testing
```

## Honest status

See `docs/TEST_REPORT.md` for what was run and what was not, and `docs/KNOWN_LIMITATIONS.md`. In short: logic, security and flows are tested in an automated way; the **real-device camera matrix, real skin-tone tests, live AI accuracy and all clinical and legal review still need people**.
