# Architecture

## 1. Decisions that shaped everything

| Blueprint §27 question | Decision | Consequence |
| --- | --- | --- |
| Primary audience | **Personal use** — one athlete tracking their own training | One user per account; RLS isolates accounts; no coach/multi-client model (deferred, see traceability) |
| Training scope | **Strength first, with cardio / sport / mobility support** | Library includes cardio, sport (MMA, BJJ, boxing), mobility, stretching; *Add activity* logs them as their own session |
| Intelligence level | **Manual logging + automatic calculations + rule-based suggestions the user accepts/rejects** | No ML; every suggestion shows observation → evidence → suggestion → trade-off → action; nothing changes the program silently |
| User requirement | *"I should never lose my data or progress"* | **Local-first** (write to the phone first), idempotent cloud sync, rolling snapshots, full export/restore, soft deletes only |

Platform: **Android app built with Capacitor around a React/TypeScript web app** (not React Native/Flutter). Reasons: one codebase that is also testable in a real browser engine (Playwright, 20 journeys), a mature local database (IndexedDB via Dexie) and a build that does not require a local Android SDK (CI builds it). Trade-off accepted: a WebView UI instead of native widgets; mitigated by bundling all assets in the APK (no network needed to render) and by E2E tests on Android's actual WebView (see TESTING.md, emulator job).

## 2. Layers

```
┌──────────────────────────── src/screens, src/ui, src/app ─────────────────────────────┐
│ React 19 screens + design system (tokens: golden / night green / night blue)           │
│ HashRouter · ErrorBoundary · lazy screens (preloaded when idle) · useLive(query)       │
└───────────────▲───────────────────────────────────────────────────────▲──────────────┘
                │ live queries (Dexie liveQuery)                          │ commands
┌───────────────┴───────────────────────────────────────────────────────┴──────────────┐
│ src/data/repo/*  — the ONLY code that reads/writes the database                         │
│   sessions · programs · history · schedule · dashboard · misc · goalData · photos …    │
│   write.ts: insert/update stamp id, client_updated_at, device_id, _dirty=1 + audit.ts   │
└───────────────▲───────────────────────────────────────────────────────▲──────────────┘
                │ pure functions                                          │
┌───────────────┴──────────────┐   ┌──────────────────────────────────────┴──────────────┐
│ src/domain — NO I/O          │   │ src/data/sync + services (Supabase, Capacitor)       │
│ volume · e1rm · records ·    │   │ engine: push dirty rows / pull deltas               │
│ progression · dips · editScope│   │ manager: debounce, backoff, online/resume triggers  │
│ versioning · adherence ·      │   │ backup: JSON/CSV export, merge-restore, snapshots   │
│ recommendations · readiness   │   │ auth, reminders, platform (haptics, files, notifs)  │
└──────────────────────────────┘   └──────────────────────────────────────────────────────┘
                         IndexedDB (Dexie)  ⇄  Supabase Postgres (RLS)  +  private Storage bucket
```

Rules enforced by structure: screens never touch Dexie directly; `src/domain` imports nothing but types (so every calculation is unit-testable and reproducible from source records); raw colour values live only in `src/brand/tokens*` (a test fails otherwise).

## 3. Data flow for a logged set (offline-safe)

1. Tap ✓ → `logSet()` validates (`domain/validate`), then in **one Dexie transaction** updates the `set_records` row, recomputes the exercise status, and (if the session was already finished) records an audited correction. The UI shows success only after the transaction commits.
2. `update()` stamps `client_updated_at`, `device_id` and `_dirty = 1`. Nothing else is needed for durability — the phone has it.
3. The sync manager (debounced, and on online/resume) calls `syncOnce`: **pull first** (never push over something newer unknowingly), then push dirty rows in dependency order (`SYNC_ORDER`: parents before children, so foreign keys resolve).
4. Push = `upsert … on conflict (id)` with client-generated UUIDs → **idempotent**: a retry after a lost acknowledgement cannot duplicate. Rows are cleared (`_dirty = 0`) only if they were not edited again while the request was in flight.
5. The server guard trigger (`mg_row_guard`) applies the conflict rule below and stamps `server_updated_at`, the monotonic cursor for pulls.

### Conflict rule (deterministic, documented, tested)

*Last writer wins on `client_updated_at`, per row.* A write older than the stored row is ignored by the server (so replays are harmless); a pulled row older than a local **dirty** row is ignored locally (the local edit then wins on push); when a remote edit overwrites a local dirty edit, the overwritten values are written to a **conflict log** shown in *More → Sync* — never silent. Server clamps `client_updated_at` to at most 10 minutes ahead of its own clock so a phone with a wrong clock cannot win forever. Ties go to the later arrival. Deletes are soft (`deleted_at`) and sync like any other edit; clients cannot `DELETE`.

Failure isolation: a row the server rejects (constraint/RLS) is recorded in `sync_failures` and skipped; every other row still syncs. Transient errors (network, 5xx, 429) retry with exponential backoff 5 s → 5 min.

Pull cursor: `(server_updated_at, id)` keyset, persisted 2 minutes in the past so a transaction that committed late is still picked up; the id half of an empty cursor is the nil UUID (an empty string is not a valid `uuid` — found and fixed by the real-Postgres test suite).

First sign-in (`claimLocalData`): data created before signing in is adopted by the account and pushed; the server profile is never replaced by a fresh local placeholder (reinstall / second device); a scheduled session that already exists under the same `dedupe_key` on the server is held back and reported, not merged silently.

## 4. Planned vs actual, versions, corrections

* **Plan** = `programs → program_versions → workout_templates → planned_exercises`. A version is **immutable once any session used it**; edits create the next version (copy-on-write, stable `template_key` / `plan_key` identify "the same day/exercise" across versions). An unused version is edited in place so building a program does not create version noise.
* **Edit scopes** (`domain/editScope.planProgramEdit`): set, exercise-today, exercise-future, day-this-week, day-future, entire program, program-from-date. Each returns a **preview** of the affected dates (next 8 weeks) *before* anything is applied. A "this day this week" change materialises a persisted *planned session* (`dedupe_key = sched:{template_key}:{date}`) and never touches the program. If today already has a session, a broad change takes effect tomorrow.
* **Actual** = `workout_sessions → session_exercises → set_records`. A session freezes a copy of the prescription (`planned` snapshot, `planned_*` set columns). Actual columns are `NULL` until recorded: **missing ≠ zero**. A skipped session/exercise is a status, never a zero-performance record.
* **Corrections** (edit a finished set, change the date, add a missed set, reopen) update derived analytics, set `corrected_after_completion`, and write an `audit_events` row (before/after/reason). The program is never rewritten.
* **Derived, never stored**: PRs, progression signals, dips, attendance, e1RM, volume, streaks are computed from source rows on demand, so they are reproducible and always follow corrections.

## 5. Analytics conventions (consistent across every chart)

Volume load = Σ load × reps over **completed working sets** (warm-ups excluded, `NULL` load/reps excluded and counted in a *data quality* note); dumbbells per-hand by default (configurable); bodyweight lifts need a recorded bodyweight; technique components add volume but count as one set. Muscle credit: *direct* (primary 1.0) or *weighted* (secondary 0.5, setting) — labelled as an estimate. e1RM: Epley by default (Brzycki, Lombardi selectable), valid 1–12 reps, always labelled *estimated*; a 1-rep set is shown as *tested*. Signals (plateau/regression/inconsistent) need a minimum number of comparable sessions; a planned deload week is not flagged.

## 6. Security and privacy

| Concern | Control |
| --- | --- |
| Secrets in the app | Only the **public** Supabase URL and *publishable* key are in the bundle. No service-role key exists anywhere in the repo or app. E2E test `Journey 8` scans the shipped bundle for `service_role`, secret keys, private-key blocks and decodes any JWT to prove none is a service-role token |
| Cross-account access | RLS **enabled and forced** on all 17 tables; policies are `select/insert/update` only and compare `user_id` to `auth.uid()`; ownership is pinned by the guard trigger. 24 tests run as two different identities (reads, writes, hijack/upsert-onto-foreign-id, anonymous, storage) |
| Destruction | `DELETE`/`TRUNCATE` revoked from clients; history is archived. Account deletion is an explicit server function (`delete_my_account()`, `security definer`, authenticated only) that removes the caller's rows and photos only |
| Photos | Private bucket, 5 MB, image types only, path must start with the user's id; upload happens after sync, never inline in a workout |
| Data at rest | App-private storage (Android sandbox + device encryption). Optional **app lock**: PIN stored as salted PBKDF2-SHA256 (100k iterations), locks the UI on resume. Honest limit: it locks the interface, not the database file |
| Transport | HTTPS to Supabase only; cleartext disabled by Android defaults for target SDK 36 |
| Signing | Release key is generated outside the repo, listed in `.gitignore`, never printed; CI uses encrypted secrets if provided; the signer certificate fingerprint is published so users can verify |
| Supply chain | Lockfile committed; CI installs with `npm ci` |
| Privacy of the routine | The repository is public, so the preloaded routine text is public. Use a private repo if that is a concern (nothing else personal is in the repo) |

## 7. Backup and recovery layers (in order of protection)

1. **Local database** (IndexedDB) — every action committed before success is shown.
2. **Rolling snapshots** — JSON written daily (keep 7) and before every restore (keep 3) to the app's *file* store, independent of the WebView database; never for an empty app.
3. **Cloud sync** — optional account; reinstall/new phone: sign in → full history pulled back (tested end to end against real Postgres).
4. **User export** — full JSON (every table including soft-deleted rows, excluding the built-in library) and CSV (sets, workouts, body). Restore is **merge-only** with last-writer-wins, so restoring an old file can never overwrite newer work; a safety snapshot is taken first; restored rows are marked dirty so they sync.
5. **Android Auto Backup** is left enabled by the platform default as an extra, best-effort copy.

## 8. Offline behaviour

The APK bundles all JS, CSS, fonts and images; the app never needs the network to open, log, edit, review history or view analytics. The web build preloads every lazy screen when idle and shows a recoverable message (not a blank page) if a screen's code cannot be loaded. The rest timer stores an *absolute end time* in the database and schedules a native notification, so it survives navigation, screen-off and process death.

## 9. Known limits (honest list)

* Android WebView storage is "best effort durable" if the OS is under extreme storage pressure — mitigated by snapshots, sync and export.
* Last-writer-wins is per row: two devices editing the *same set* offline keep the later edit and log the loser; field-level merge is not attempted.
* Email confirmation / redirect URLs are Supabase project settings that cannot be set from the tooling used here (see ANDROID_RELEASE.md → Supabase setup).
* Wearable import, video technique tracking, voice input and multi-device coach collaboration are deferred (Phase 4 in the blueprint) — see REQUIREMENTS_TRACEABILITY.md.
