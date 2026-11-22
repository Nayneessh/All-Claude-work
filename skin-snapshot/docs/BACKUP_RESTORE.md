# Backup and restore

## What to back up

* The database (all of schema `ss`). With the default storage adapter this includes the photos.
* If you use a bucket: the bucket, with a retention policy no longer than your documented backup purge window.
* Your environment variables, stored in a password manager. Never in the repository.
* The repository itself (GitHub) and the periodic source ZIP (`npm run export:source`).

## Schedule (suggested)

| Item | Frequency | Keep |
| --- | --- | --- |
| Database backup | Daily (Supabase Pro does this and keeps 7 days; confirm in your plan) | 7 days |
| Source ZIP | After every release | Last 5 |
| Deletion ledger export | Daily, alongside the database backup | Same as the backup |

The proposed rule is that deleted data may remain in encrypted backups only for this short purge window. The window equals the backup retention you choose. Do not extend backups beyond it without updating the privacy notice.

## Restore procedure

1. Before restoring, export the **current** ledger so recent deletions are not lost:
   `psql "$OLD_DATABASE_URL" -c "\copy (select case_id from ss.deletion_ledger) to 'ledger.csv' csv"`
2. Restore the backup into the target database (provider tooling, or `psql < dump.sql`).
3. Re-apply deletions made since the backup:
   `DATABASE_URL=... npx tsx scripts/replay-deletions.ts ledger.csv`
4. Run the purge job once to remove stored photos for those cases and any expired cases:
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://host/api/jobs/purge`
5. Check `/api/health`, open a recent case in the console, check the access log is intact.

## Test it

Restore into a scratch database at least once before launch and record the time it took.
