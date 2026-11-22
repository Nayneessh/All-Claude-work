# Database

PostgreSQL 15+. Everything lives in schema `ss`, which Supabase does not expose through its REST API. Migrations are plain SQL in `supabase/migrations`, applied in file order:

| File | Contents |
| --- | --- |
| `20261122000001_schema.sql` | Tables, constraints, triggers (updated_at, object-deletion queue, append-only access log) |
| `20261122000002_security_and_console.sql` | Row-level security on every table, revokes, claims helpers, 20 console functions |
| `20261122000003_seed.sql` | Default settings and 12 SAMPLE routine templates |

Apply with `npm run db:migrate` (needs `DATABASE_URL`), or paste the files into any SQL runner.

## Tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `cases` | One row per skin check | Private-link token stored as SHA-256 hash only; answers as JSON; `expires_at` is the retention deadline (NULL for an open booked case) |
| `consents` | Each consent with version, language, granted/withdrawn time | One active row per (case, key) |
| `photos`, `objects`, `storage_deletions` | Photo metadata, the private object table, and a queue of objects to remove | A trigger queues the object when a photo row is deleted, including by cascade |
| `analyses` | Each AI run: provider, model, prompt version, passes, disagreements, validated result, timings, tokens | Never raw model text |
| `bookings` | Name, WhatsApp number (E.164 and keyed hash), day, window, method, status | |
| `case_notes`, `ai_feedback` | Staff notes and agree/disagree marks (and missed/false safety-flag reports) | |
| `staff` | Active staff and role | |
| `access_log` | Who opened which case and when | **Append-only** (trigger refuses update and delete) and survives case deletion |
| `routine_templates` | Cosmetologist's routine templates | `approved`, `sample`, approver and time |
| `events` | First-party analytics | |
| `rate_limits`, `blocked_numbers`, `capture_sessions` | Abuse control and phone continuation | |
| `deletion_ledger` | IDs of deleted cases | Replay after any backup restore |
| `settings` | Admin-editable settings | |

## Access model

* `anon` and `authenticated` have no table privileges at all, and RLS is enabled on every table with no policies for them (deny by default). The only direct read granted to staff is `routine_templates` (under an RLS policy) and their own `staff` row.
* Staff reach everything else through `SECURITY DEFINER` functions (`ss.console_*`). Each one calls `ss.require_staff()` which needs: an active `ss.staff` row, the right role, and `aal = aal2` in the verified claims (two-step sign-in). `ss.console_open_case` and friends write the access log in the same transaction, so even direct database access by staff leaves a record.
* Photos, answers and AI output are returned only if the visitor asked to be contacted and has not withdrawn that consent (`ss.case_details_visible`). A flagged visitor who never booked is visible as metadata only.
* The application connects as the owner role, which bypasses RLS, and sets `request.jwt.claims` plus `set local role authenticated` for console calls, as PostgREST does. Visitor routes never use staff claims.

Tests: `tests/db.test.ts` runs these rules on real Postgres semantics (PGlite): anonymous, non-staff, single-step, inactive, cosmetologist and admin sessions, direct table reads refused, append-only log, deletion cascade.

## Retention

Defaults follow the blueprint's proposal and are configuration, not code:

* Unbooked cases are deleted `RETENTION_UNBOOKED_HOURS` after creation (72 by default; staging 24). The private link stops working at that moment.
* Booked cases are deleted `RETENTION_CLOSED_DAYS` (90) after the staff mark them Closed.
* The purge job (`/api/jobs/purge`, daily by Vercel Cron, also callable from any scheduler with `CRON_SECRET`) deletes expired cases, drains the object-deletion queue, removes orphans and stale analyses, and clears rate-limit and capture rows.
* Backups: deleted data may persist in provider backups for their retention window (Supabase: documented by Supabase, 7 days on Pro). `scripts/replay-deletions.ts` re-applies the ledger after any restore. See `docs/BACKUP_RESTORE.md`.

These are proposed values and need legal validation.

## Regenerating types / checking schema

`npm run db:migrate` is idempotent (it records applied files in `public.ss_migrations`). To rebuild from scratch use a fresh database.
