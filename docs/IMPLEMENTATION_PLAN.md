# Implementation plan and status

Method: inspect → plan → implement in **vertical slices** → verify each slice with tests → release. Each slice went from domain logic to data layer to UI before the next began, so there is never a half-built layer.

## Vertical slices (all complete unless marked)

| # | Slice | Contents | Verification | Status |
| ---: | --- | --- | --- | --- |
| 0 | Foundation | Vite/React/TS strict, Capacitor Android project, lint/typecheck/test/E2E tooling, CI, design tokens, traced logo + icon/splash | CI green | ✅ |
| 1 | Domain core | units, periods, muscles/credit, volume, e1RM, records, progression, versioning, edit scopes, session state, techniques, plates | 100+ unit tests | ✅ |
| 2 | Data layer | Dexie schema mirroring Postgres, audited writes, repositories, 110-exercise library, v6 routine seed | 37 data tests | ✅ |
| 3 | Workout logging | start/resume, one-tap sets, drafts, rest timer, supersets, techniques, substitution, add/skip, finish, summary | E2E-3 | ✅ |
| 4 | Programs | create/edit, seven edit scopes with preview, versions, pause/resume, templates, move/skip/reschedule | E2E-2,4 | ✅ |
| 5 | History & corrections | session detail, compare, repeat, reopen, correct, soft-delete/undo, audit, search, filters | E2E-6 | ✅ |
| 6 | Analytics | dashboard, drill-downs, PRs, signals, dips, adherence, reports (weekly/monthly/block), muscle analytics, advanced workload | E2E-5 + perf | ✅ |
| 7 | Recovery, body, goals, suggestions | readiness + correlations, measurements, photos, goals with trajectory, rule-based suggestions | unit | ✅ |
| 8 | Add activity | MMA / cardio / sport / mobility sessions | unit + E2E | ✅ |
| 9 | Safety net | sync engine, manager, JSON/CSV export, merge-restore, rolling snapshots, app lock, account deletion | 60+ tests, real-Postgres suite | ✅ |
| 10 | Backend | schema, RLS, guard trigger, storage policies, seed migration | 30 real-Postgres tests + live catalog verification | ✅ applied 2026-10-26 · ⏳ live two-identity access test pending |
| 11 | Android release | CI build, signing, verification, emulator job, release page | see ANDROID_RELEASE.md | see that file |

## Remaining / deferred (in priority order)

1. **Run the two-identity access test against the live Supabase project** (rolled-back transaction; needs the owner to confirm the tool prompt). The migrations themselves are applied and their catalog verified.
2. Confirm Supabase Auth settings: e-mail confirmation on/off and the *Site URL / redirect URL* used by password-reset links (cannot be set through the tooling used; the app works fully without an account, so this does not block use).
3. Device verification of notifications (incl. Snooze) and TalkBack on a physical phone.
4. Blueprint items deliberately left out (see traceability): voice input, wearables/health imports, video technique tracking, set-level media, multi-user coach mode, left-right comparison charts, program-completion and inactivity prompts, "export selected sessions".
5. Optional polish: embedded exercise demos, language packs, dashboard widget customisation.

## Risks and how they are handled

| Risk | Handling |
| --- | --- |
| Losing the signing key makes in-place updates impossible (not data loss — data survives via sync/export — but a reinstall is then needed) | key kept outside the repo, fingerprint published, backup procedure in ANDROID_RELEASE.md |
| Sync conflicts between two devices | deterministic rule + visible conflict log; field merge intentionally not attempted |
| WebView storage eviction | snapshots in the app file store, optional sync, export |
| Public repo exposes the personal routine | documented; switch the repo to private if undesired (APK distribution then needs another channel) |
| Scope creep from a 27-section blueprint | phases honoured: core logging and history before intelligence; deferrals recorded rather than half-built |
