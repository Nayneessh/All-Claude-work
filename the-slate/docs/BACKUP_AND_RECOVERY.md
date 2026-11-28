# Backup & recovery

## The honest starting point

The Supabase organisation is on the **Free plan**. Free projects have **no automatic backups and no point-in-time recovery**. Enabling a cloud database does not by itself protect you, so THE SLATE ships its own backup system. Upgrading to Supabase **Pro** (daily backups, 7-day retention, optional PITR) is still recommended and complements — does not replace — what is below.

## Layers

| # | Layer | What it protects against | Frequency | Retention | Where it lives | Verified? |
|---|---|---|---|---|---|---|
| 1 | **Nightly logical backup** (`backup` edge function) | accidental deletion/corruption, bad migration | 02:00 IST daily + "Back up now" in Settings | 30 days (newest 7 always kept) | private bucket `backups` (same Supabase project) | **Yes, automatically**: re-downloaded, SHA-256 compared, parsed, row counts compared. A run that fails verification is recorded as `failed`. |
| 2 | **Download everything** (Settings → Data & security) | lost project/account, vendor failure | on demand — do it monthly | yours | your computer | n/a (JSON you can open) |
| 3 | **Off-platform encrypted dump** (`slate-backup-offsite.yml`, optional) | lost project/account | weekly | your bucket's policy | S3-compatible bucket you own, AES-256 encrypted | the job fails if `pg_dump` or upload fails |
| 4 | **Pre-migration snapshot** | a risky migration | once (27 Nov 2026) | until you drop it | schema `backup_pre_slate_20261128` inside the database (11 tables) | counts checked |
| — | Supabase platform backups | everything | daily | 7 days | Supabase | **not available on Free** |

Layer 1 and 4 live inside the same Supabase project: they protect your *data*, not the *project*. Layers 2–3 protect against losing the project. **Do layer 2 or 3.**

What a backup contains: all 23 data tables (mandates, candidates, history, comments, steps, tasks, SOP, settings, audit log …). It deliberately excludes secrets (`push_config`), device push endpoints, and Supabase Auth users (they live in the Auth service). Uploaded JD/CV **files** are not inside the JSON: the backup records their paths (`mandate_documents`, `candidate_files`); keep copies via the Storage dashboard or the off-platform job if you need the files themselves.

Monitoring: the 8 AM check fails if the last backup is older than 36 h, unverified, or the nightly job did not run (`docs/MONITORING.md`).

## Recovery procedures

### A. Undo a bad change (data is damaged, project is fine) — 15 min
1. Settings → Data & security → **Back up now** (so the bad state is also kept).
2. Storage → bucket `backups` → download the file from before the problem (`YYYY/MM/slate-<timestamp>.json.gz`).
3. Generate the restore script and review it:
   ```bash
   node scripts/restore-from-backup.mjs slate-20261128T200000Z.json.gz > restore.sql
   ```
4. Restore into a **scratch** project/DB first to confirm it contains what you expect:
   `psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f restore.sql`
5. To repair production, either restore only the affected rows by editing `restore.sql`, or (for a full rollback) restore into an *empty* schema (below). The script uses `ON CONFLICT DO NOTHING`, so running it on top of live data **adds missing rows but never overwrites existing ones** — it cannot make things worse.

### B. Rebuild everything on a new project / server — 1–2 h
1. Create the Supabase project (or self-host). Apply `supabase/migrations/*.sql` in order, then `supabase/hosted/*.sql` (edit the project ref), deploy the functions, set secrets (`docs/ENVIRONMENT.md`).
2. Add the owner's e-mail to `allowed_emails`, then create the user in Auth (same e-mail). Note the new user id.
3. Restore:
   ```bash
   node scripts/restore-from-backup.mjs backup.json.gz --map-user OLD_USER_UUID=NEW_USER_UUID > restore.sql
   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f restore.sql      # single transaction: all or nothing
   ```
   Triggers are paused during the load so history is not re-logged; they are re-enabled afterwards.
4. Upload JD/CV files back to the buckets under the same paths (`<user_id>/…`; if the user id changed, rename the folder to the new id and update `path` columns).
5. Sign in, check the dashboard totals against the backup's `counts`, send a test push.

The restore tool is covered by an automated round-trip test (backup a populated database → restore into a fresh one → compare row counts and content).

## Backup verification you can do yourself
`select * from backup_runs order by started_at desc limit 5;` — `status = ok` and `verified = true`. The same is visible in Settings → Data & security.

## Known limitations
- Backups share the fate of the Supabase project (layer 1). Use layers 2–3.
- Storage files (JD/CV) are not in the JSON backup.
- Restore of Auth users is manual (create user, map id).
- A free-tier project **pauses after ~7 days of inactivity**; the daily jobs and the 8 AM check count as activity.
