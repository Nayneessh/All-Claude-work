# Testing — what was run, what it proved, what it did not

All numbers below are from real runs on this repository (local sandbox and GitHub Actions). Re-run everything with:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```

## 1. Strategy

| Layer | Tool | What it protects |
| --- | --- | --- |
| Pure logic (`src/domain`) | Vitest | every calculation: volume, e1RM, PRs, progression signals, dips, adherence, edit-scope previews, versioning, techniques, goals, readiness, plates |
| Data layer (`src/data`) | Vitest + fake-indexeddb | the local database exactly as the app uses it: sessions, sets, corrections, programs/versions, backup/restore, snapshots, sync engine against an in-memory server |
| **Database** (`supabase/tests`) | Vitest + **PGlite (real PostgreSQL)** | the actual migration files: RLS across two identities, grants, guard trigger, constraints, storage policies, account deletion — and the **real client sync engine against that real schema** |
| End-to-end | Playwright, Pixel 7 profile, Chromium | nine user journeys through the built app (offline, reload, back button, small screens) |
| Android runtime | GitHub Actions emulator job | the signed APK installs, launches, survives a process kill with data intact |
| Static | ESLint (`no-explicit-any` = error), `tsc --strict` + `noUnusedLocals` | whole classes of defects before runtime |

Principle: a test that fails on a real defect is more valuable than one that passes. Several defects below were found *by* these suites, not by inspection.

## 2. Results

### Unit / integration — 234 tests, 25 files, all passing (≈ 10 s)

| File | Tests | File | Tests |
| --- | ---: | --- | ---: |
| `domain/volume` | 12 | `domain/analytics` | 11 |
| `domain/progression` | 10 | `domain/records` | 10 |
| `domain/editScope` | 10 | `domain/sessionState` | 10 |
| `domain/e1rm` | 6 | `domain/dips` | 6 |
| `domain/adherence` | 7 | `domain/plates` | 7 |
| `domain/recovery` | 8 | `domain/techniques` | 8 |
| `domain/recommendations` | 6 | `domain/periods` | 6 |
| `domain/goals` | 5 | `domain/units` | 5 |
| `domain/versioning` | 5 | `brand/tokens` | 3 |
| `data/data` (sessions, programs, corrections, history, library, add-activity) | 37 | `data/backup` | 9 |
| `data/sync/sync` (offline, conflicts, failure isolation, first sign-in, manager) | 16 | `data/perf` (two years of history) | 3 |
| `services/reminders` | 4 | **`supabase/tests/rls` (real Postgres)** | 24 |
| **`supabase/tests/sync.pg` (real client engine ⇄ real Postgres)** | 6 | | |

### Database and RLS (real PostgreSQL via PGlite) — 30 tests

Run as two different authenticated identities (A, B), an unauthenticated session and the `anon` role:

* schema + seed apply cleanly on a fresh database; seed is idempotent (110 built-ins, re-applied twice, still 110);
* RLS **enabled and forced** on all 17 tables; exactly 3 policies per table (select/insert/update), no delete/all policy;
* A sees only A's rows in every populated table, B only B's; unauthenticated sees nothing and cannot write; `anon` gets *permission denied* everywhere;
* B cannot insert a row owned by A, cannot update A's rows (0 rows affected), cannot **upsert onto A's id** (RLS violation), cannot take ownership (trigger pins `user_id`); A cannot hand a row to B;
* `DELETE` and `TRUNCATE` are denied for authenticated users on history tables;
* built-ins readable by all, immutable for all; custom exercises private; "built-in XOR custom" check;
* sync guard: upsert twice → one row; **stale replay (older `client_updated_at`) cannot overwrite newer data**; `server_updated_at` strictly advances; far-future device clock is clamped; per-user `dedupe_key` uniqueness (two users may share a key, one user cannot duplicate);
* constraints reject negative reps, RPE 11, 5,000 kg, unknown status; missing actuals are stored as `NULL` beside intact `planned_*` values; foreign keys reject orphan sets;
* photos bucket is private, 5 MB, jpeg/png/webp; users can write/read only their own folder;
* `delete_my_account()` requires authentication, is not callable by `anon`, removes only the caller's rows and files and leaves the built-in library.

Sync engine against the real schema (6): full logged workout accepted by every real constraint; **exactly-once** even after re-pushing everything (lost acknowledgement); offline edits then reconnect in a valid parent-before-child order after an app restart; **reinstall/new phone restores the whole history identically**; a newer edit from another device wins and an older replay is ignored; another account cannot read, overwrite or detect the data.

**What this does not prove:** it runs PostgreSQL 18 (PGlite) with minimal stand-ins for Supabase's `auth`/`storage` schemas and PostgREST — not the managed Supabase service itself. **Live project (applied by the owner on 2026-10-26, verified read-only):** 17 tables, RLS enabled *and forced* on all 17, 51 public policies (0 for DELETE/ALL), 17 guard triggers, `anon` holds 0 table privileges, `authenticated` holds no DELETE/TRUNCATE, `delete_my_account()` is security definer (not executable by `anon`), private `progress-photos` bucket (5 MB, jpeg/png/webp) with 4 owner-folder policies, and 110 built-in exercises whose content digest (`d189ab56…`) equals the app's seed. **Still not run on the live project:** the two-identity read/write/hijack test (the Supabase tool asks the owner to confirm that statement; it is written, rolls back by design, and passed in the PGlite suite).

**Live sync observed (2026-10-26, read-only queries on the live project):** after the owner created an account in the installed app, the server holds exactly what the phone created — 1 confirmed user, the profile (onboarding done), the *v6 · Arms First · Chest = Back* program (active, from 2026-10-26, 6/week) with its version, 6 workout days, 32 planned exercises, the program-created modification, 2 audit events and one cancelled empty *Quick workout*; 0 orphan rows. The user signed in on 25 Oct *before* the tables existed; the rows stayed queued on the phone and arrived on 26 Oct as soon as the schema was applied — the retry behaviour working as designed, nothing lost. **Not yet exercised live:** set/session-exercise rows (no real workout has been logged yet), pulling history onto a second device or after a reinstall, photo upload, cross-device conflicts.

### End-to-end (Playwright, Pixel 7 profile) — 25 journeys, all passing; green in GitHub Actions on a Linux runner (CI run 40359059146 at the 1.0.1 commit `8d22a377`; earlier: 3 consecutive full runs of the first 20)

| Journey | Test | Asserts |
| --- | --- | --- |
| 1 First launch | `01-first-launch` ×2 | onboarding → v6 routine loaded → Monday workout shown → relaunch skips onboarding, data kept |
| 2 Create program | `06-create-program-perf` | new program → day → exercise → scope preview → apply → appears on Today |
| 3 Perform workout | `02-workout` ×4 | start, log all 9 sets, finish, summary, History, planned-vs-actual detail; interrupted workout restored after hard reload ("Resume"); typed-but-uncompleted reps survive backgrounding + restart; finishing with nothing logged offers *skip* (never a zero session) |
| 4 Edit scopes | `03-program-edit` ×2 | "this day only" materialises 10 sets for that Monday; "all future" creates a new version and the **finished session still shows its original plan (3 × 10-12)** |
| 5 Dashboard | `04-…` | empty state first; real KPIs/trends after a workout; e1RM labelled estimate |
| 6 Historical correction | `04-…` | edit a finished set → totals follow, plan untouched, audit trail shows the reason |
| 7 Offline | `04-…` ×2 | whole workout logged offline, reload, still there; JSON backup contains the 9 completed sets and no tokens |
| 8 Security | `04-…` | shipped bundle contains no `service_role`, secret key, private key block; any JWT in it is not service-role; no auth tokens in storage while signed out |
| 9 Lifecycle | `05-…` ×4 | rest timer survives process restart; back navigation never duplicates/loses a workout; a screen whose code fails to load shows a recoverable message; 320 px width: no horizontal scroll, tap target ≥ 44 px, 130 % text still reachable |
| Add activity | `06-…` | MMA logged as its own session; Monday strength still planned |
| Swap exercise (1.0.1) | `07-sheets-keyboard-swap` ×2 | pick a replacement → the **confirmation sheet appears** (it used to vanish) → swap → toast, 9 sets remain and are loggable; "future sessions too" → scope preview → applied as a new program version |
| Typing never loses focus (1.0.1) | `07-…` ×3 | Add-activity minutes, exercise search and a set row: type one character per 1.2–1.3 s across the screen's 1-second clock ticks — blur events stay 0, field stays focused, value complete |

### Android runtime (GitHub Actions emulator, Android 14 / API 34) — see ANDROID_RELEASE.md for the full log

The **signed release APK** installed on a fresh emulator, reached the foreground without a crash and came back after a force-stop (CI runs 1, 3, 5). The debuggable twin of the same bundle was driven inside Android's real WebView: first launch → set logged → app process killed → relaunch → the logged set (reps = 10) still there (CI runs 3 and 5, passed). Run 4 failed in my first-generation release smoke heuristic (text-matching a `uiautomator` dump — timing-sensitive); it was replaced and run 5 passed on the new check. Static APK checks (signature v2, signer fingerprint = published, zipalign, aapt2 metadata) passed in runs 4 and 5.

### Performance (measured)

| Measure | Result | Budget in test |
| --- | ---: | ---: |
| Cold start incl. 3 onboarding taps, Chromium Pixel 7 profile | ≈ 0.8 s | < 8 s |
| One-tap set completion → UI updated | ≈ 90 ms | < 1 s |
| Year of analytics, 1,413 sets in range (2.8 k total): load / derive | 38 ms / 13 ms | < 3 s / < 1.5 s |
| Exercise insight with two years of PR history | 36 ms | < 2 s |
| History page of 50 sessions with summaries | 143 ms | < 1.5 s |

Not measured: battery use, cold start on a physical mid-range phone, WebView memory.

### Visual and usability review

Screens were captured at Pixel 7 size and reviewed for the golden / night-green / night-blue system, contrast, truncation and overlap (Onboarding, Today, Workout, Summary, Progress, Program, Settings). Defects found and fixed: highlighted-card colour collision with the `.gold` text utility (all text in selected cards turned gold), "Customise today" wrapping, meaningless "1" in the week strip. Automated: tap targets ≥ 44 px, no horizontal overflow at 320 px, 130 % text scale.
Not done: TalkBack walk-through, dark/light OS-theme switching (the app is dark-only by design), tablets.

## 3. Defects the suites found (all fixed, all covered by a regression test)

| # | Defect | Found by | Impact if shipped |
| --- | --- | --- | --- |
| 1 | **Pull cursor used `''` as the id half; Postgres rejects it for `uuid` (22P02)** | `sync.pg` | every pull after the first sync would fail *permanently* → sync stops, silently |
| 2 | Started-but-empty scheduled workout could not be skipped (cancel-then-skip threw) and left the screen stuck on "cancelled" | E2E-3 | user trapped on a dead screen |
| 3 | Typed reps lost on reload: debounced draft saved the *previous* render's values | E2E-3c | data typed but not yet ✓-tapped lost on app kill |
| 4 | Finishing a workout could land on History instead of the summary (live-status redirect raced the finish sheet) | E2E-4b | confusing navigation, intermittently (timing-dependent) |
| 5 | Offline: lazy screen chunk could not load → **blank page** | E2E-7 | web build blank after finishing a workout offline; fixed with idle preload + error boundary |
| 6 | "Workout not logged yet" reminder was only planned when Settings changed → fired after you trained | review while writing traceability | wrong notifications |
| 7 | `.gold` utility colliding with highlighted `.card` variant | visual review | unreadable/odd selected cards |
| 8 | Routine says "log MMA with *Add activity*" but no such feature existed | traceability review | missing feature → built |
| 9 | Unused `pgcrypto` extension in the migration | PGlite | needless surface on the server |
| 10 | **Sheet stole focus every second**: its effect depended on the `onClose` prop, callers pass inline arrows, and Today/Workout re-render each second (clock) → the effect re-ran, focused the sheet container and the on-screen keyboard closed/re-opened while typing | owner on a real phone (the desktop suites did not type across clock ticks); reproduced by a failing E2E before the fix | typing felt like the keyboard "fluttering"; characters could be lost |
| 11 | **Substitute exercise froze**: the picker calls `onPick()` then `onClose()` in the same tick; `onClose` read a stale `picked` (null) and dismissed the whole flow, so the confirmation sheet never showed | owner on a real phone; reproduced by a failing E2E before the fix | "the screen is just stuck" — swapping impossible |

Lesson recorded for 10 and 11: both were missing from the earlier suites because those typed/clicked faster than the 1-second re-render. The 1.0.1 tests now deliberately type *slower than the clock tick*.

## 4. Not tested / known gaps (stated plainly)

* Live Supabase project: two-identity access test, auth e-mail flows, real PostgREST/Storage behaviour (schema is applied and catalog-verified).
* Physical Android device: notifications (including Snooze), haptics, hardware back, TalkBack.
* Multi-device concurrent editing beyond the deterministic last-writer-wins rule (field-level merge is not attempted).
* Long-run soak (weeks of data) — mitigated by the two-year scale test.
* Emulator/APK results: see `docs/ANDROID_RELEASE.md` → *Verification log* for the actual outcome of each step.
