# Monster Gains

A personal training operating system for Android: a **plan** (program, split, exercises, targets), the **actual** workout (sets, reps, load, effort, substitutions), the **history** (sessions, PRs, corrections), **progress analytics** (volume, strength, dips, consistency, recovery) and the **next action** (rules-based, user-controlled suggestions).

Built from the product blueprint *Fitness App — Product Blueprint & Requirements Checklist v1.0*, preloaded with the **v6 · Arms First · Chest = Back** routine (starts Mon 26 Oct 2026).

> **Your data is yours and never silently lost.** Everything is written to the phone first. Cloud sync, rolling snapshots and a one-tap full export protect it from a lost phone, a reinstall or a bad edit. Nothing is ever hard-deleted by the app.

## Install (Android 7.0+)

1. Download the signed APK: **https://github.com/Nayneessh/All-Claude-work/raw/release/MonsterGains-1.0.1.apk** — checksum and signing-certificate fingerprint to compare are in [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md).
2. Open the file on the phone and allow *Install unknown apps* for your browser/file manager when asked.
3. First launch: three short screens → **Start training**. The v6 routine is already loaded. No account is required; sign in later to back up and sync.

Updating later? Install the next APK **over** the old one (same signing key) — your data stays. Do **not** uninstall first.

## What it does

| Area | Highlights |
| --- | --- |
| Live workout | One-tap set completion, previous values beside targets, superset-aware rest timer (survives app kill), plate calculator, warm-up helper, undo, pause/resume, add/skip/substitute exercise, advanced techniques (drop, rest-pause, myo, cluster…) kept as linked component sets |
| Programs | Create/edit anytime; **edit scopes with a preview** (this set → entire program from a date); copy-on-write versions so history never changes; pause/resume/restart/abandon; templates |
| History | Every session with planned-vs-actual, compare two sessions, repeat a workout, reopen & correct (audited), search notes, restore archived items |
| Analytics | Weekly/monthly volume, muscle-group sets (direct vs weighted), e1RM (labelled *estimated*), PRs, plateau/regression/inconsistency signals, dip detection with hypotheses, adherence & streaks, planned vs actual |
| Recovery & body | Daily readiness, bodyweight/measurements/body-fat, private progress photos, correlations (never causal claims) |
| Goals & suggestions | Goals with trajectory; rules-based suggestions showing observation → evidence → suggestion → trade-off → accept/edit/dismiss/defer. Never changes the program silently |
| Add activity | MMA, cardio, sport and mobility logged as their own session (no phantom strength volume) |
| Safety | Local-first, idempotent sync, deterministic conflict rule, rolling snapshots, JSON/CSV export + restore, app lock, account deletion |

## Tech

React 19 · TypeScript (strict) · Vite 7 · **Capacitor 8** (Android) · **Dexie/IndexedDB** local database · **Supabase** (Auth, Postgres + RLS, Storage) for optional sync. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
npm ci
npm run dev          # web dev server
npm run typecheck && npm run lint
npm test             # 234 unit/integration tests incl. real-Postgres RLS + sync tests (PGlite)
npm run test:e2e     # 20 Playwright journeys on a Pixel 7 profile (builds + serves the app)
npm run build        # production web bundle -> dist/
npx cap sync android # copy the bundle into the Android project
```

Android builds run in CI (`.github/workflows/android-build.yml`); local Android SDK is not required. Release procedure: [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md).

Configuration: `.env.production` holds only **public** values (Supabase URL + publishable key). No service-role key, signing key or password is ever committed — see the security section of the architecture doc.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Testing — real results](docs/TESTING.md) · [Requirements traceability](docs/REQUIREMENTS_TRACEABILITY.md) · [Android release](docs/ANDROID_RELEASE.md)

## Brand

Golden `#D4AF37` · Night Green `#071F16` · Night Blue `#0B1630` (design tokens in `src/brand/tokens.ts`; a test forbids raw hex outside the token files). Logo and icon are traced from the supplied artwork (`scripts/brand/trace_logo.py`).
