# Data model

One model, two stores. The **local** Dexie database (`src/data/db.ts`) mirrors the **Postgres** schema (`supabase/migrations/20261025000001_core_schema.sql`) table-for-table and column-for-column (snake_case), plus one local-only flag `_dirty` (0/1, "needs pushing"). Because they are 1:1, sync is a straight copy and the same row can be validated twice (client `domain/validate.ts`, server `CHECK` constraints).

## Conventions on every user-owned table

| Column | Purpose |
| --- | --- |
| `id uuid` PK | **Client-generated** (UUID v4; built-in exercises use v5 of their seed key) → creating the same row twice is an idempotent upsert, so offline creates can never duplicate |
| `user_id uuid` → `auth.users` | Owner. Pinned by trigger; RLS compares it with `auth.uid()` |
| `created_at`, `client_updated_at`, `server_updated_at`, `deleted_at`, `device_id` | `client_updated_at` = conflict-resolution clock; `server_updated_at` = pull cursor (assigned by the server); `deleted_at` = soft delete (clients cannot `DELETE`) |

## Entities (blueprint §22 → table)

| Blueprint entity | Table | Notes |
| --- | --- | --- |
| User profile | `profiles` | units, week start, tz, language, birth year, height, experience, training years, goals, preferred days, session minutes, equipment, constraints, settings (jsonb), baseline (jsonb) |
| Exercise | `exercises` | `user_id NULL` + `seed_key` = built-in (read-only for everyone, 110 seeded); `user_id` set = custom. Check: exactly one of the two. Archive = `archived_at` (history keeps pointing at it). Aliases, primary/secondary muscles, movement pattern, equipment, laterality, resistance, tracking method, load mode, bodyweight fraction, technique, cues, demo URL, default tempo/rest, difficulty, substitutes |
| Exercise variation | `exercises.variation_of` + `variation_label`; `substitute_ids[]` | Linked but never silently merged: a variation is a distinct exercise with its own history and PRs |
| Equipment profile | `equipment_profiles` | Available equipment + machine settings |
| Program | `programs` | status `active/paused/completed/archived/abandoned`, dates, frequency, deload weeks, progression method, `paused_intervals`, `cloned_from`, `is_template` |
| Program version | `program_versions` | `version_no`, `effective_from`, `summary`, `scope`. Immutable once used by a session |
| Workout template | `workout_templates` | A *planned day*, per version. `template_key` = stable identity of "the same day" across versions |
| Planned exercise | `planned_exercises` | Prescription per version: sets, rep range, RIR/RPE, rest (after set / after pair), tempo, technique, start load, superset group/label. `plan_key` = stable identity across versions |
| Workout session | `workout_sessions` | The **actual** occurrence. `scheduled_date` ≠ `session_date`; status machine below; `dedupe_key` (`sched:{template_key}:{date}`) unique per user → a double tap or two devices cannot create two Mondays |
| Session exercise | `session_exercises` | The exercise **actually performed**; `planned` = frozen JSON copy of the prescription; `origin` planned/added/substituted; `substituted_from_exercise_id`; `substitution_scope` session/future |
| Set record | `set_records` | One row per set. `planned_*` columns (never overwritten by logging) and actual columns (`NULL` = not recorded). Components of drop/rest-pause/myo/cluster sets are child rows (`parent_set_id`). Cardio extras in `extras` jsonb |
| Set technique details / Rest interval | columns on `set_records` (`tempo`, `eccentric_s`, `pause_bottom_s`, `concentric_s`, `pause_top_s`, `rom`, `failure`, `rest_before_s`, `side`, `bar_velocity`…) and `planned_exercises` | Kept on the set so a set is one self-contained record |
| Personal record | **derived** (`domain/records.ts`) | Not stored → can never disagree with the sets after a correction |
| Goal | `goals` | type, target, baseline, date, status active/paused/completed/abandoned, milestones |
| Body measurement | `body_measurements` | weight, circumferences, body-fat % + method, muscle mass, conditions |
| Readiness record | `readiness_records` | sleep, energy, soreness (areas), stress, motivation, recovery, fatigue, RHR/HRV (optional), illness note |
| Progress photo | `progress_photos` + private Storage bucket `progress-photos` | Metadata syncs as a row; the image blob lives in the bucket under `{user_id}/…` |
| Program modification | `program_modifications` | Every program change with scope, kind, description, payload, effective date |
| Audit event | `audit_events` | Before/after/reason for corrections, skips, reopen, cancel, restore… |
| Recommendation | `recommendations` | observation, evidence, suggestion, trade-off, status open/accepted/edited/dismissed/deferred, `dedupe_key` |

## Session state machine (`domain/sessionState.ts`, enforced by `assertTransition`)

```
planned ─┬─> in_progress ─┬─> completed_as_planned
         │                ├─> completed_modified
         │                ├─> partial
         │                ├─> skipped    (started, nothing logged — never a zero-volume session)
         │                └─> cancelled
         ├─> skipped ├─> rescheduled └─> cancelled
completed_* / partial ──reopen──> in_progress          (audited correction)
skipped / rescheduled / cancelled ──restore──> planned
```

`skipped`, `cancelled`, `rescheduled` are **absent** to analytics (never 0 volume, never in averages). Completion class is *derived* from the slots: all planned work done unchanged → `completed_as_planned`; changes (substitution, added exercise, extra sets) → `completed_modified`; planned sets undone → `partial`.

## Invariants (each has a test)

1. Planned and actual live in separate columns; logging never rewrites a `planned_*` column or the session's frozen `planned` snapshot.
2. `NULL` ≠ 0 — a missing load/reps is excluded from volume and counted in a data-quality note.
3. Warm-ups never count as working sets; technique components add volume but count as one set.
4. Approved substitutions are *not* non-adherence; the substituted exercise is tracked as its own exercise (no strength-equivalence assumed).
5. A correction recomputes derived values but never edits the program and always leaves an audit row.
6. No duplicates: `id` upsert, `dedupe_key` unique, double-tap start returns the same session.
7. Archived/soft-deleted exercises, sessions and sets stay readable in history and in exports.
8. A program version used by any performed session is never edited in place.
9. Clients cannot hard-delete anything; account deletion is one explicit server function.

## Row-level security (all 17 tables)

`ENABLE` + `FORCE ROW LEVEL SECURITY`; per table exactly three policies for role `authenticated` — `select` (`user_id = (select auth.uid())`; `exercises` additionally allows `user_id is null`), `insert` and `update` (`with check` the same). No delete policy and `DELETE/TRUNCATE/REFERENCES/TRIGGER` revoked; `anon` has nothing. Storage: four owner-folder policies on `storage.objects` for `progress-photos` (private, 5 MB, jpeg/png/webp).

## Migrations

| File | Content | Status |
| --- | --- | --- |
| `20261025000001_core_schema.sql` | 17 tables, constraints, indexes, `mg_row_guard` trigger, RLS, grants, `delete_my_account()`, storage bucket + policies | Verified on PostgreSQL (PGlite) by 24 RLS/integrity tests and 6 sync-engine tests; **applied to the live project 2026-10-26** and its catalog verified read-only (see ANDROID_RELEASE.md) |
| `20261025000002_seed_exercise_library.sql` | 110 built-in exercises, idempotent (`on conflict do update`), generated by `npm run gen:seed` | Same; live content digest equals the app's seed |
