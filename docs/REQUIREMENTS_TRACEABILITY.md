# Requirements traceability

Source of truth: *Fitness App — Product Blueprint & Requirements Checklist v1.0*. Every numbered section is broken into checkable requirements.

**Priority** follows the blueprint's own phases (§25): **P1** Core workout logging (essential) · **P2** Progress intelligence (high value) · **P3** Adaptive training (after foundations) · **P4** Extended ecosystem (later).
**Status**: ✅ implemented and tested · 🟡 partial (what is missing is stated) · ⏳ deferred (not built; reason given). Nothing is marked ✅ without a test or an observed run.

Test names: `unit` = Vitest file under `src/`, `rls` / `sync-pg` = real-Postgres suites under `supabase/tests/`, `E2E-n` = Playwright journey (`e2e/`), where journeys are 1 first launch · 2 create program · 3 perform workout · 4 edit scopes · 5 dashboard · 6 historical correction · 7 offline/backup · 8 security · 9 Android lifecycle.

## §1 System overview
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Plan, actual, history, dashboard, next action as distinct parts | P1 | `domain/*`, `data/repo/*`, screens Today/Workout/History/Progress/Suggestions | E2E-3,5 | ✅ |
| 1.2 | Never overwrite the difference between planned and actual | P1 | `planned_*` columns + frozen `session_exercises.planned` snapshot; `data/repo/sessions.ts` | unit `data.test` "keeps PLANNED and ACTUAL separate", rls "NULL not zero" | ✅ |

## §2 User profile and baseline
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Name, preferred units, height, birth year, week start | P1 | `Settings` → Profile, `profiles` | E2E-1 (units), unit `units.test` | ✅ |
| 2.2 | Language and time zone | P1 | `profiles.language/timezone` stored; UI shows English only, time zone from device | — | 🟡 no language picker (English only) |
| 2.3 | Experience level, training years, goals, equipment, constraints | P1 | `Onboarding`, `Settings` (limitations), `profiles` | E2E-1 | 🟡 experience/goals/equipment captured at onboarding; training years, preferred days, session length stored but not editable in UI |
| 2.4 | Starting baseline (bodyweight, measurements, benchmarks, photos) | P2 | Onboarding baseline kg, `Recovery`/`Body` measurements & photos | unit `recovery.test` | 🟡 benchmarks entered as normal sets/goals, no dedicated "benchmark test" form |
| 2.5 | All personal data optional, privacy controls | P1 | every field nullable; Privacy & security section; account deletion | rls "account deletion" | ✅ |

## §3 Exercise library
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Stable ID, name, aliases, category, muscles (primary/secondary), movement pattern, equipment, laterality, resistance, tracking method, status | P1 | `exercises` table; `seed/exercises.ts` (110 built-ins, deterministic ids) | unit `data.test` "library seed" (4 tests) | ✅ |
| 3.2 | Position/setup, technique, cues, demo video, tempo/rest guidance, difficulty, substitutions | P1 | columns + `Exercises` detail ("Technique", "Alternatives") | unit `data.test` | 🟡 `demo_url` is a link field; no embedded player; "position" stored, not shown |
| 3.3 | Create, rename, edit, duplicate, archive; history preserved | P1 | `Exercises` form, `repo/exercises.ts` | unit `data.test` "custom exercises…archive keeps history", "archived exercise never disappears" | ✅ |
| 3.4 | Map old → new exercise only deliberately; variations distinct | P1 | `variation_of`, "Variation of…" sheet; PRs per exercise id | unit `records.test` | ✅ |
| 3.5 | Search by name/alias/muscle/equipment | P1 | `listExercises` filter, global `Search` | unit `data.test` "searches by name, alias, muscle and equipment" | ✅ |

## §4 Programs and routines
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 4.1 | Program attributes (name, goal, split, dates, frequency, deloads, progression, source, status, version, change history) | P1 | `programs`, `program_versions`, `program_modifications`; `Programs` + MetaSheet; change history tab | unit `data.test` "program editing", E2E-2 | ✅ |
| 4.2 | Workout-day attributes and order, sets/reps/load/RIR/RPE/rest, warm-up, estimated duration, alternatives | P1 | `workout_templates`, `planned_exercises`; `DayEditor` | E2E-4 | ✅ (cardio/mobility components via exercises of those types) |
| 4.3 | Edit the whole program or mid-block | P1 | `commitProgramEdit` | unit `editScope.test` (10), `data.test` | ✅ |
| 4.4 | Change an exercise for one session only / permanently | P1 | `substituteExercise(scope)`, `EditScopeSheet` | unit `data.test` "substituting for TODAY only…", E2E-4a | ✅ |
| 4.5 | Add/remove/reorder exercises; change sets, reps, load, rest, targets | P1 | `DayEditor` edits → `PlanEdit[]` | E2E-2,4 | ✅ |
| 4.6 | Skip exercise/session; move/swap days; repeat a workout; add unplanned session | P1 | `skipExercise`, `skipScheduled`, `rescheduleScheduled`, `repeatSession`, `startAdhoc` | unit `data.test` (skipping, rescheduling, repeat), E2E-3 | ✅ |
| 4.7 | Convert rest day to training day | P1 | "Train a program day anyway" / quick workout on a rest day; add training day for that weekday | E2E-2 | ✅ |
| 4.8 | Pause, resume, restart, abandon a program | P1 | `setProgramStatus`, `paused_intervals` | unit `data.test` "pauses and resumes a program" | 🟡 restart = duplicate + start; no one-tap "restart" |
| 4.9 | New program from existing; save variations as templates | P2 | `duplicateProgram`, "Save as template" | unit `data.test` "duplicates a program" | ✅ |
| 4.10 | Seven edit scopes, each previewed before applying | P1 | `domain/editScope.planProgramEdit` (`set`, `exercise_session`, `exercise_future`, `day_week`, `day_future`, `program_all`, `program_from_date`) | unit `editScope.test`, E2E-4a/4b ("What will change") | ✅ |
| 4.11 | "Which future workouts change" stated before a broad edit | P1 | `EditScopeSheet` preview of next 8 weeks | E2E-4 | ✅ |
| 4.12 | User's routine v6 preloaded | — | `seed/routineV6.ts` (98 sets/week, split matches the sheet) | unit `data.test` "matches the sheet" | ✅ |

## §5 Workout sessions
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Session attributes: scheduled vs actual date, start/finish, duration, active time, type, completion %, counts, session RPE, energy/motivation/readiness, notes, change reasons, location/equipment | P1 | `workout_sessions`; `FinishSheet`, `sessionTimes` | unit `sessionState.test`, `data.test` "pause/resume", E2E-3 | 🟡 energy/motivation/readiness/location/equipment columns exist; the finish sheet asks RPE, tags, notes only |
| 5.2 | States: planned, in progress, completed as planned, with modifications, partial, skipped, cancelled, rescheduled | P1 | `domain/sessionState` | unit `sessionState.test` (10) | ✅ |
| 5.3 | A skipped workout stays visible and is not a zero-performance workout | P1 | status, `ABSENT` set excluded from averages | unit `data.test` "skipped workout stays visible", E2E-3d | ✅ |
| 5.4 | Leave a prescribed exercise incomplete without losing the session | P1 | `finishSession` → `partial`, unlogged sets kept as `skipped` | unit `data.test`, E2E (4b partial) | ✅ |
| 5.5 | Add an unplanned exercise, retain the original plan | P1 | `addExerciseToSession` (`origin: added`) | unit `data.test` "adds an unplanned exercise…" | ✅ |
| 5.6 | Interrupted workout restored after app kill | P1 | persisted in IndexedDB; "Resume" | E2E-3b, 9b | ✅ |

## §6 Set-by-set tracking
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 6.1 | Each set an independent record; planned and actual separate | P1 | `set_records` | rls, unit | ✅ |
| 6.2 | Set number/type, completed/skipped/failed, start/end time, rest before next, set notes | P1 | columns + `Workout` set detail | unit `data.test` | ✅ |
| 6.3 | External load; bar + plates; per-dumbbell vs combined; assistance; bodyweight contribution | P1 | `load_mode`, `assist_kg`, `bodyweight_kg`, `PlateCalc`, `domain/volume` | unit `volume.test` (12) | ✅ |
| 6.4 | Machine stack setting; resistance band type; kg/lb; estimated vs measured load | P2 | exercise/equipment notes + `load_note`; units; `load_estimated` column | unit `units.test` | 🟡 no dedicated stack-setting/band-type fields in the set UI; `load_estimated` stored, not exposed |
| 6.5 | Left/right independently for unilateral work | P2 | `side` + Side selector for unilateral exercises | unit `data.test` | 🟡 recorded per set; no left-right comparison chart yet |
| 6.6 | Rep kinds: completed, partial, assisted, failed, forced | P1 | `reps`, `reps_partial`, `reps_assisted`, status `failed`, `failure` | unit `validate` via `data.test` | ✅ |
| 6.7 | ROM, tempo, pauses, isometric holds, time under tension, quality, technique notes | P1 | `rom`, `tempo`, `eccentric_s`… `quality`, `note`; duration tracking for holds | unit `data.test` | ✅ |
| 6.8 | RPE and RIR; failure type; warm-up vs working | P1 | `rpe`, `rir`, `failure`, `set_type` | unit `volume.test` | ✅ |
| 6.9 | Bar velocity (optional, sensor) | P4 | `bar_velocity` column only | — | ⏳ needs a sensor |
| 6.10 | Concentric/eccentric/phase discomfort notes | P2 | `discomfort`, tempo columns | — | 🟡 stored; surfaced only in set detail |
| 6.11 | Advanced techniques kept as component sets, not flattened | P1 | `parent_set_id`, `domain/techniques` (drop, rest-pause, myo, cluster, negatives…) | unit `techniques.test` (8), `data.test` "guided technique components" | ✅ |
| 6.12 | Edit any set, add missed set, delete accidental entry, duplicate, mark warm-up/working | P1 | `editSet`, `addSet`, `deleteSet` (soft, undo), `duplicateSet` | unit `data.test` "historical corrections and undo", E2E-6 | ✅ |
| 6.13 | Split/combine entries; record interrupted/abandoned sets with reason | P2 | status `failed`/`skipped`, `discomfort`/`note` | — | 🟡 no split/combine action |

## §7 Exercise performance and progression
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 7.1 | Core metrics: sets/reps/volume, avg/heaviest load, most reps at a load, best e1RM, tested 1RM, best set, avg RIR/RPE, work vs warm-up, completion rate, PRs | P1 | `domain/volume`, `e1rm`, `records`; `ExerciseDetail` | unit `volume.test`, `e1rm.test` (6), `records.test` (10) | ✅ |
| 7.2 | Progression: load/reps/volume over sessions, e1RM, fixed-load/fixed-rep, sessions since PR, 4/8/12-week rate, variability, left-right | P2 | `domain/progression` (`velocity`, `variability`), Progress → Advanced | unit `progression.test` (10) | 🟡 left-right differences not computed |
| 7.3 | Detect improvement, plateau, regression, inconsistency, possible fatigue — as review signals; one poor session never triggers a plateau | P2 | `assessExercise` | unit `progression.test` | ✅ |

## §8 Volume analytics
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 8.1 | Set, rep, volume-load, weekly, exercise, muscle-group volume; avg per session/week; period change; planned vs actual; per day; hard sets; distribution | P1 | `domain/analytics` | unit `analytics.test` (11), `perf.test` | ✅ |
| 8.2 | Calculation rules: warm-ups excluded; unilateral counting defined; bodyweight/assisted/machine conventions; compound attribution is an estimate, not full credit | P1 | `domain/volume`, `muscles` (direct vs weighted) | unit `volume.test`, "Calculation rules" in Settings | ✅ |

## §9 Personal records
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 9.1 | Heaviest load, most reps at a weight, highest e1RM, tested 1RM, highest set volume, best session volume | P1 | `detectPrs` | unit `records.test` | ✅ |
| 9.2 | Longest hold, fastest time, longest distance/duration | P2 | `detectPrs` (duration/distance types) | unit `records.test` | ✅ |
| 9.3 | Best at a given RPE/RIR; first completion of a target; return to a previous best | P3 | goals mark target completion | unit `goals.test` | 🟡 first-completion via goals; RPE-specific and "return to previous best" PRs not implemented |
| 9.4 | Record details: exercise/variation, date, load, reps, previous, absolute and % improvement, tested vs estimated | P1 | `PrEvent` fields; Recent records list | unit `records.test` | ✅ |
| 9.5 | All-time, recent and date-range PR views | P1 | `prsInRange`, `Drill` PR list, Progress "Recent records" | unit `records.test`, E2E-5 | ✅ |
| 9.6 | First time a lift is logged is a baseline, not a PR | P1 | `includeBaselines=false` | unit `records.test`, E2E-5 (0 PRs after first workout) | ✅ |

## §10 History and replay
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 10.1 | Retain every workout/exercise/set, planned and actual, additions/removals/substitutions, missed/rescheduled, program changes, PRs, notes, ratings | P1 | all tables, soft-delete | unit `backup.test` "exports everything (including soft-deleted rows)" | ✅ |
| 10.2 | Program version used on that date | P1 | `workout_sessions.program_version_id` | E2E-4b (history keeps its plan after a future edit) | ✅ |
| 10.3 | Open any day; compare sessions side by side; repeat a past workout | P1 | `History`, `SessionDetail`, `Compare`, `repeatSession` | unit `data.test` "repeating a past workout", "history queries" | ✅ |
| 10.4 | Reopen and correct a session; filter by exercise/muscle/program/date; search notes | P1 | `reopenSession`, `History` filters, `Search` | unit `data.test`, E2E-6 | ✅ |
| 10.5 | Export selected records; restore archived programs/exercises/sessions | P2 | full JSON/CSV export; restore archived sessions; programs/exercises un-archive | unit `backup.test` | 🟡 no "export selected sessions" picker (full export + CSV only) |
| 10.6 | Correction updates analytics, never silently rewrites the program, and records that it happened | P1 | `markCorrection`, `audit_events` | unit `data.test` "correcting a finished set…", E2E-6 (audit trail visible) | ✅ |

## §11 Progress dashboard
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 11.1 | Answers the six questions (stronger? more/better work? which muscles? regressing? consistent? what next?) | P1 | `Progress` sections: KPIs, Strength trend, Muscle groups, What changed, Plan vs reality, Suggestions | E2E-5 | ✅ |
| 11.2 | Filters: 7 d, 4/8/12 w, 6 m, 1 y, all, custom; program, exercise, muscle, workout type | P1 | range chips; drill-downs by exercise/muscle/session | E2E-5 | 🟡 date ranges ✅; program/muscle/exercise filtering is by drill-down, not a global filter bar; custom range via drill URL only |
| 11.3 | Charts: weekly/monthly volume; sets & reps per muscle; weight/e1RM per exercise; fixed-load reps; PR timeline; planned vs actual volume & sessions; session duration; RPE/RIR trend; bodyweight; streaks; frequency; | P1–P2 | `Progress`, `Drill`, `Reports`, `ExerciseDetail`, `Body` | unit `analytics.test`; E2E-5 | 🟡 all listed except: left-right comparison, performance-vs-sleep chart (table of correlations instead), program-phase comparison |
| 11.4 | Dip detection with what changed, start, magnitude, comparison period, contributors, persistence, hypotheses, optional action; deload not flagged | P2 | `domain/dips`, "What changed" | unit `dips.test` (6) | ✅ |
| 11.5 | "Why did this metric change" | P1 | Drill-downs list the contributing sessions/exercises | E2E-5 | ✅ |

## §12 Reports and consistency
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 12.1 | Weekly report (planned/completed, volume by muscle, best/worst changes, PRs, skipped/substituted, duration/effort, missed days, WoW, observations) | P2 | `domain/reports`, `Reports` | unit `analytics.test`, `recommendations.test` | ✅ |
| 12.2 | Monthly report | P2 | `Reports` monthly | same | ✅ |
| 12.3 | Training-block report (baseline vs final, goals, interruptions, responsive exercises, lessons) | P3 | `Reports` block view | same | ✅ |
| 12.4 | Attendance, exercise adherence (approved substitutions not penalised), prescription adherence, frequency, streak | P1 | `domain/adherence` | unit `adherence.test` (7) | ✅ |

## §13 Muscle-group analytics
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 13.1 | Weekly sets/hard sets/reps/volume per muscle; frequency; time since last; planned vs actual exposure | P2 | `muscleStats`, `muscleWeekly`, `daysSinceMuscle` | unit `analytics.test` | ✅ |
| 13.2 | Trends, selection changes, distribution across the week | P2 | `Drill` muscle view | — | 🟡 distribution shown as per-muscle weekly sets; no day-of-week heat map |
| 13.3 | Left-right differences | P3 | — | — | ⏳ |
| 13.4 | Subdivisions presented as training classifications, not activation measurements | P2 | `domain/muscles` (upper/middle/lower chest, lats/upper back…) + note | unit `volume.test` | ✅ |

## §14 Fatigue, recovery, readiness
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 14.1 | Daily readiness: sleep, energy, soreness, recovery, motivation, stress, fatigue, RHR/HRV (optional), illness note | P3 | `Recovery`, `readiness_records` | unit `recovery.test` (8) | ✅ (RHR/HRV typed manually; no device import) |
| 14.2 | During workout: perceived readiness, RPE/RIR deviations, early stop, pain flags | P3 | session readiness column, `discomfort`, dips/progression signals | — | 🟡 no in-workout pain flag button |
| 14.3 | Recovery analysis: correlations only, no causal or medical claims | P3 | `domain/readiness` ("Patterns in your data") | unit `recovery.test` | ✅ |

## §15 Body composition
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 15.1 | Bodyweight, circumferences, body-fat + method, muscle mass, photos, conditions, notes | P2 | `Body`, `body_measurements`, `progress_photos` | unit `recovery.test`, rls (photos) | ✅ |
| 15.2 | Trends, rolling averages, rate of change, photo timeline, bodyweight vs strength | P2 | `domain/body`, `Recovery` | unit `recovery.test` | ✅ |
| 15.3 | Scale weight/consumer body-fat not equated with muscle gain | P2 | wording in `Body` | — | ✅ |

## §16 Cardio, conditioning, mobility
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 16.1 | Running, cycling, walking, rowing, swimming, HIIT, mobility, stretching, isometrics, sport-specific with their attributes | P4 (default scope: support) | exercise types with `duration`/`distance`/`distance_duration` tracking; **Add activity** (`logActivity`) | unit `data.test` "add activity", E2E "Add activity" | 🟡 duration, distance, RPE captured; pace, HR, cadence, power, strokes, intervals are not first-class fields (free-text notes; `extras` column ready) |
| 16.2 | Mixed sessions (strength + cardio + mobility in one workout) | P2 | any exercise type can be added to a session; `workout_type` mixed | unit `data.test` | ✅ |

## §17 Goals
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 17.1 | Goal types (strength, reps at weight, e1RM, frequency, volume, adherence, bodyweight/measurement, cardio/mobility) with target, date, baseline, progress %, trajectory, milestones | P3 | `domain/goals`, `Goals`, `goals` | unit `goals.test` (5) | ✅ |
| 17.2 | Edit, pause, complete, abandon without losing history | P3 | goal status machine | unit `goals.test` | ✅ |

## §18 Recommendations
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 18.1 | Inputs: performance, RPE/RIR, volume, adherence, readiness, equipment, time, rules, preferences | P3 | `domain/recommendations` | unit `recommendations.test` (6) | 🟡 available time/equipment are not inputs |
| 18.2 | Types: increase load, reps before load, reduce load, maintain, adjust sets, substitute, shorten, reschedule missed, deload for review, flag plateau/regression, review discomfort | P3 | rules in `recommendations.ts`; reschedule action in `Reports` | unit `recommendations.test` | 🟡 increase/reps-first/reduce/maintain/plateau/regression/deload/reschedule ✅; substitute-unavailable and shorten-workout not auto-suggested (available manually) |
| 18.3 | Format: observation → evidence → suggestion → trade-off → accept/edit/dismiss/defer | P3 | `RecCard`, `recommendations` table | unit `recommendations.test`, `data.test` | ✅ |
| 18.4 | Never silently change a program from an inferred trend | P1 | suggestions only act on user accept | unit `recommendations.test` | ✅ |

## §19 Timers, reminders, live workout
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 19.1 | Rest timer with defaults, auto/manual start, superset-linked | P1 | `app/restTimer.ts` (absolute end time, after-pair rest) | E2E-9a | ✅ |
| 19.2 | Navigation between exercises/sets; previous values beside targets; quick entry; one-tap completion | P1 | `Workout` | E2E-3, perf (set logged in ~90 ms) | ✅ |
| 19.3 | Voice input | P4 | — | — | ⏳ optional in the blueprint |
| 19.4 | Undo accidental entries; pause/resume; offline logging + automatic local saving | P1 | `uncompleteSet`, `pauseSession`; local-first | E2E-3c, 7 | ✅ |
| 19.5 | Demos, plate calculator, warm-up suggestions | P2 | `PlateCalc` ("Plates & warm-up"), `demo_url` link | unit `plates.test` (7) | 🟡 demo is a link, not an embedded video |
| 19.6 | Notifications: workout reminders, missed-workout prompts, PR/milestone alerts, weekly summary, program completion, inactivity | P2 | `services/reminders.ts` (`refreshReminders` re-plans at launch/resume/when today's workout is done), `platform.setupNotificationActions` (Snooze), Settings → Reminders (all configurable, disableable) | unit `reminders.test` (day planning, "not logged" cancelled once done) | 🟡 workout reminders, missed-workout prompts (auto-cancelled once you train), weekly summary, snooze ✅ in code; PR/milestone are in-app, not push; program-completion and inactivity prompts not implemented; **native notifications and the Snooze button are not verified on a physical device** |

## §20 Editing, integrity, audit
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 20.1 | Everything in the editable-data list is editable (profile, library, programs, planned, actual, sessions, goals, recovery, body, notes/tags, units/conventions) | P1 | screens above | E2E-2,4,6 | 🟡 exercise→muscle mapping editable only for custom exercises (built-ins read-only by design); dashboard widget layout not customisable |
| 20.2 | Plan and actual separate; program revisions and historical corrections recorded; derived metrics recomputed | P1 | versions, `program_modifications`, `audit_events`, derived analytics | unit `data.test`, E2E-4b,6 | ✅ |
| 20.3 | No duplicate sessions/sets; undo; archive by default | P1 | `dedupe_key`, idempotent upsert, soft delete | unit `data.test` "double tap", rls "dedupe", sync-pg "exactly-once" | ✅ |
| 20.4 | Missing ≠ zero; preserve exercise IDs and program versions; consistent calculation rules | P1 | `NULL` actuals; ids/versions immutable | rls "NULL not zero", unit `volume.test` | ✅ |
| 20.5 | Export, account deletion, backups, recovery | P1 | `backup.ts`, snapshots, `delete_my_account()` | unit `backup.test` (9), rls "account deletion", E2E-7b | ✅ |
| 20.6 | Sync devices without silently overwriting newer edits | P1 | LWW + conflict log | unit `sync.test` (16), sync-pg (6), rls "sync guard" | ✅ (verified on real Postgres; **live Supabase project not yet migrated**) |
| 20.7 | Mid-program substitution example (keep squat prescription, record leg press, ask today/future, update only with authorisation, separate performance, show in history) | P1 | `substituteExercise`, `EditScopeSheet`, history badge "Substituted for…" | unit `data.test` (2 substitution tests) | ✅ |

## §21 Search, filters, tags, notes
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 21.1 | Search exercises, workouts, programs, historical notes | P1 | `Search` | unit `data.test` "filters, searches notes" | ✅ |
| 21.2 | Filter by date, muscle, exercise, program, type | P1 | `History` filters | unit `data.test` | ✅ |
| 21.3 | Tags (high-energy, low-energy, travel, deload, return-from-break) | P2 | finish sheet + edit tags | unit `data.test` | ✅ |
| 21.4 | Notes at profile, program, session, exercise, set level | P1 | Settings, MetaSheet, finish sheet, exercise notes, set note | unit `data.test` | ✅ |
| 21.5 | Attach videos/photos to sets | P4 | — | — | ⏳ (progress photos only) |
| 21.6 | Bookmark workouts; favourites/templates | P2 | `is_bookmarked`; program templates | unit `data.test` | 🟡 no "favourite exercises" list |
| 21.7 | Compare similar-condition sessions; find last performance quickly | P1 | `Compare`, previous column in `Workout`, `lastPerformance` | unit `data.test` | ✅ |

## §22 Core data model
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 22.1 | All entities in the blueprint table | P1 | see DATA_MODEL.md (PRs derived by design) | rls "applies cleanly…17 tables" | ✅ |
| 22.2 | Template ≠ session; planned exercise ≠ performed; current version ≠ version six weeks ago | P1 | separate tables, frozen snapshot, immutable used versions | unit `data.test`, E2E-4b | ✅ |

## §23 Advanced analytics
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 23.1 | Configurable e1RM; relative strength vs bodyweight | P2 | Epley/Brzycki/Lombardi setting; `relStrength` | unit `e1rm.test` | ✅ |
| 23.2 | Normalised volume; acute vs chronic workload; progression velocity; monotony | P3 | `workloadRatio`, `monotony`, `velocity` (labelled descriptive, not injury scores) | unit `analytics.test`, `progression.test` | ✅ |
| 23.3 | Exercise-specific consistency; rolling muscle exposure; time since PR; goal time estimates; plateau detection; fatigue indicators | P3 | `adherence`, `muscleWeekly`, `daysSincePr`, `goals` | unit tests | ✅ |
| 23.4 | Program comparisons; long-term progression history; data-quality flags | P3 | data-quality flags ✅ | unit `analytics.test` | 🟡 no side-by-side program comparison screen |

## §24 Settings, privacy, integrations
| ID | Requirement | Pri | Implementation | Test | Status |
| --- | --- | --- | --- | --- | --- |
| 24.1 | Units, default rest, RPE/RIR display and entry preferences | P1 | Settings → Logging | E2E-1 | ✅ |
| 24.2 | Exercise-library prefs; custom dashboard widgets; configurable PR definitions | P3 | — | — | 🟡 library filters ✅; widgets / PR definitions fixed |
| 24.3 | Week start day; volume calculation rules | P1 | Settings → Calculation rules | unit `periods.test`, `volume.test` | ✅ |
| 24.4 | Cloud sync, offline mode | P1 | `data/sync`, Auth | sync-pg | ✅ (live project pending migration) |
| 24.5 | Wearable/health-platform integrations; heart-rate/activity import | P4 | — | — | ⏳ Phase 4 |
| 24.6 | CSV/JSON export | P1 | `Backup` | unit `backup.test`, E2E-7b | ✅ |
| 24.7 | Account deletion, privacy controls, optional app lock | P1 | Settings | rls, unit | ✅ |
| 24.8 | Notification controls, accessibility, text scaling, screen-reader support | P2 | Settings → Reminders; `font-scale` setting; aria labels, 44 px targets, roles | E2E-9d (no horizontal scroll at 320 px, tap target ≥ 44 px, 130 % text) | 🟡 not audited with TalkBack on a device |

## §25 Phases
| Phase | Scope | Status |
| --- | --- | --- |
| 1 Core logging | library, editable programs, daily substitutions, sets, history, volume/PR, basic dashboard | ✅ complete |
| 2 Progress intelligence | reports, muscle volume, planned vs actual, plateau/regression, comparisons, versioning/audit | ✅ complete |
| 3 Adaptive training | readiness, recommendations, block analysis, goals, forecasting | ✅ rule-based; see 18.1/18.2 gaps |
| 4 Extended ecosystem | wearables, advanced cardio, video, multi-device/coach | ⏳ deferred by design (single-user app); multi-device sync for the same user ✅ |

## §26 Acceptance criteria
| # | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| 1 | I can create a program and modify it at any point | E2E-2, E2E-4a/4b | ✅ |
| 2 | Replace an exercise for today's workout without changing future workouts | unit `data.test` "substituting for TODAY only…" | ✅ |
| 3 | Permanently change an exercise for future sessions | E2E-4b ("this and all future" → new version) | ✅ |
| 4 | Record actual sets/weights/reps/tempo/effort separately from targets | E2E-3, unit `data.test` | ✅ |
| 5 | Leave a prescribed exercise incomplete without losing the session | unit `data.test`, E2E-4b (partial) | ✅ |
| 6 | Add an unplanned exercise and retain the original plan | unit `data.test` | ✅ |
| 7 | Inspect any historical workout and compare with another | unit `data.test` "compareSessions", E2E-3 | ✅ |
| 8 | See weekly volume, muscle-group volume and strength trends | E2E-5 | ✅ |
| 9 | Identify improvement, plateau or decline | unit `progression.test` | ✅ |
| 10 | Distinguish performance decline from missing/corrected data | "Data quality" banners, `corrected_after_completion`, E2E-5 | ✅ |
| 11 | See why a dashboard metric changed | drill-downs, "What changed" | ✅ |
| 12 | Correct old entries without corrupting program history | E2E-6 | ✅ |
| 13 | Export my data and recover it | unit `backup.test` round-trip, E2E-7b, sync-pg reinstall restore | ✅ |
| 14 | Use the app during a workout without excessive navigation | E2E performance (set logged in one tap, ~90 ms) | ✅ |

## Product principles (§ end)
1 plan ≠ actual ✅ · 2 changes carry scope and preserve history ✅ · 3 derived analytics reproducible from source ✅ (nothing derived is stored) · 4 consistent definitions ✅ (single `domain` module) · 5 missing ≠ zero ✅ · 6 recommendations show evidence and stay user-controlled ✅ · 7 reliable logging and history before sophistication ✅.

## Release-prompt requirements outside the blueprint
| Requirement | Status |
| --- | --- |
| Name "Monster Gains", supplied logo/icon, golden/night-green/night-blue brand | ✅ `src/brand`, `resources/` (icon + splash generated from the supplied artwork) |
| "I should never lose my data or progress" | ✅ five layers (ARCHITECTURE §7); the one residual risk — losing the **signing key**, which blocks in-place updates — is covered in ANDROID_RELEASE.md |
| Supabase backend with migrations, RLS tested with different identities | 🟡 migrations + 30 real-Postgres tests ✅; **applying to the live project is pending** (the MCP server asked a question that has not been answered) |
| Signed APK, metadata inspected, signature verified, emulator install/launch, persistence | ✅ signed (v2, RSA-4096), metadata + signature + alignment inspected in CI, installed/launched on an Android 14 emulator, data survived a process kill (CI runs 3 and 5). One earlier re-run (run 4) failed in a flaky smoke heuristic that was then replaced. ⏳ not tried on a physical phone. Details: ANDROID_RELEASE.md |
| Direct download link, verified | ✅ HTTP 200 and identical SHA-256 after downloading the public URL |
| Documentation set (README, ARCHITECTURE, IMPLEMENTATION_PLAN, DATA_MODEL, TESTING, ANDROID_RELEASE, REQUIREMENTS_TRACEABILITY) | ✅ in `docs/` |
