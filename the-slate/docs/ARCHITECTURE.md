# THE SLATE — technical architecture

## 1. Shape of the system

```
Browser (static SPA)  ──HTTPS──►  Supabase project "hiring-copilot"
 React 19 · TypeScript · Vite        ├─ Auth            (email + password / email link, sign-ups whitelisted)
 TanStack Query · React Router       ├─ Postgres 17     (tables, views, RPCs, RLS, triggers)  ← source of truth
 no backend code of its own          ├─ Storage         (private buckets: jds, cvs, backups)
                                     ├─ Edge Functions  (notify · backup · slate-parse · send-reminders)
                                     └─ pg_cron + pg_net (reminders every 5 min, backup nightly)
GitHub (folder the-slate/)  ── CI, 08:00 IST health check, optional off-platform backup
Vercel (project hiring-copilot) ── hosts the static build (any web server can: Dockerfile / nginx.conf)
```

Rule: **the browser holds no secrets and the database enforces every rule.** The UI can be replaced without touching data integrity.

## 2. Repository layout (`the-slate/`)

| Path | What |
|---|---|
| `src/domain/` | Pure business logic, unit-tested: 30-day clock, colour-band precedence, recurrence, calendar geometry, analytics, natural-language parsers |
| `src/data/` | The only code that talks to Supabase (`api.ts`), caching hooks, natural-language client |
| `src/lib/` | Supabase client (`supabase.ts`), **file-storage abstraction** (`storage.ts`), settings, dates |
| `src/features/` | One folder per module: dashboard, mandates, talent, slate, sop, settings, auth, shell |
| `supabase/migrations/` | Portable, ordered SQL (baseline → core → views/RPC → grants → notifications index) |
| `supabase/hosted/` | Supabase-only SQL (pg_cron jobs, health probe) |
| `supabase/functions/` | Edge functions + `_shared/` (generated from `src/`, never edited by hand) |
| `supabase/tests/` | 100+ tests on a real Postgres (PGlite) |
| `e2e/` | Playwright end-to-end suite (real browser + real backend) |
| `scripts/` | Health check, restore tool, test-account cleanup, icon/shared-code generators |

## 3. Data model (all tables have RLS: owner = `user_id`)

- **Mandates**: `mandates` (+`company_id`, `last_activity_at`, `waiting_on`), `companies`, `agencies`, `mandate_agencies` (consultant ↔ mandate, `shared_at`), `mandate_documents` (JD versions; exactly one `is_current`).
- **Candidates**: `candidates` (the person) ↔ `candidate_mandates` (one pipeline position per mandate: `stage`, `status`, reasons, joining data). A person can sit in several mandates.
- **History (append-only, users cannot edit/delete)**: `candidate_status_history` (from/to stage + status, reason type `rejection|drop`, reason, comment, time), `recruitment_activities` (meaningful events only), `audit_log` (who changed what).
- **Other recruitment data kept from Hiring Copilot**: `steps` (434-step workflow checklist), `comments`, `candidate_files`, `reminders`.
- **Configuration**: `config_options` (sources, stages, rejection reasons, drop reasons, hiring levels, task categories), `app_settings.data.slate` (preferences).
- **The Slate**: `slate_tasks` (+difficulty, `est_minutes`, `sched_minutes`, reminder fields, recurrence), `slate_done` (completion per occurrence; reopening sets `undone_at`, nothing is deleted), `slate_overrides` (move one occurrence of a recurring task).
- **Platform**: `notifications` (in-app bell **and** the de-duplication ledger), `sop_documents` + `sop_revisions`, `backup_runs`, `push_subscriptions`, `push_config` (VAPID keys + cron secret, no client access).

Views `v_mandate_overview` and `v_candidate_pipeline` (security-invoker) feed every dashboard; there are no hard-coded numbers anywhere.

## 4. Where the rules live (and why)

| Rule | Enforced by |
|---|---|
| Reason required to reject/drop; a rejection never inherits a drop reason | `slate_cm_guard` trigger |
| Every stage change writes a history row + activity | `slate_cm_history` trigger (even for direct table writes) |
| 30-day clock, last meaningful activity | activity triggers → `mandates.last_activity_at`; computed in `src/domain/mandateClock.ts` |
| One current JD; old versions kept | `slate_doc_supersede` trigger + partial unique index |
| Sub-tasks inherit the parent's schedule; no cycles | `slate_task_inherit` / `slate_task_cascade` triggers |
| Estimate preserved when stretching on the calendar | `slate_move_task` RPC never writes `est_minutes` |
| Atomic multi-row saves | `slate_save_mandate`, `slate_save_candidate`, `slate_set_candidate_stage` RPCs (single transaction) |
| Private files | storage policies per user folder; links are signed and expire in 5 minutes |

## 5. Mandate clock & colours (documented decisions)

- Clock starts on **Work Start Date**; day 1 = that date; 30-day progress ring.
- **Inactive** = open, no meaningful activity for ≥ *N* days (default 5, configurable). Alert severity follows urgency (Critical→critical … Low→info) and rises one notch when idle ≥ 2×N.
- States are mutually exclusive: `closed > on_hold > overdue > inactive > active`.
- **Colour band precedence** (highest wins; the rest show as stripes): Dark Grey *(open ≥ 30 days **and** idle)* > Maroon *(Critical)* > Gold *(joined)* > Green shade *(offered)* > Green *(selected)* > Purple *(shared with consultant)*.

## 6. Reminders — three layers, one ledger

1. `notify` edge function (pg_cron every 5 min) → web push to every registered device (**works with the app closed**) + a `notifications` row.
2. In-app watcher (while the app is open) → toast + the same `notifications` row.
3. Notification bell (history).
`notifications.(user_id, dedupe_key)` is unique, so each reminder is announced **at most once** whichever layer gets there first. Limits: push needs browser permission (and, on iPhone, "Add to Home Screen"); there is no e-mail/SMS channel without a provider key.

## 7. Natural-language entry

`slate-parse` (Claude, tool-use) → validated server-side: every returned field must **quote the words it came from**, otherwise it is dropped; inferred values must be flagged. If the function or key is unavailable the app uses the built-in rule-based parser (same output shape). Either way the result only **pre-fills a form**; nothing is saved until the user confirms.

## 8. Portability

No code depends on Vercel. Config is by environment variables (`docs/ENVIRONMENT.md`); files go through `FileStore` (`src/lib/storage.ts`); the backend is Supabase, which is open source and self-hostable. See `docs/MIGRATION_GUIDE.md`.
