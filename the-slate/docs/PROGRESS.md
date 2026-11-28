# Progress log (resume point)

## Done
- [x] Audit (docs/AUDIT.md)
- [x] Portable migrations: baseline + `20261128000001_slate_core_schema.sql` + `20261128000002_slate_views_rpc.sql`
- [x] 55 database tests (PGlite = real Postgres): replay from zero, legacy-data upgrade, RLS isolation, RPCs, history, clock, JD versioning, search, funnel, tasks/calendar moves, audit
- [x] In-database safety snapshot of every existing table: schema `backup_pre_slate_20261128` (counts verified)

## Blocked — needs one human action
`apply_migration` on project **hiring-copilot** timed out waiting for a confirmation prompt (the migration contains
`DROP CONSTRAINT` / `DROP NOT NULL`, which the Supabase connector treats as destructive). **Nothing was applied**; live data verified unchanged
(14 mandates / 9 candidates / 160 tasks).
→ Re-run once the confirmation can be answered. Both migration files are tested and ready.

## Next
1. Apply migrations 1–2 to hiring-copilot, then verify (schema fingerprint vs. PGlite, row counts vs. snapshot).
2. App: foundation → Mandates → Talent Pool → Dashboard → The Slate → SOP/Settings.
3. Edge functions: `slate-parse` (AI + rules fallback), `notify`, `backup`; cron jobs (`supabase/hosted/`).
4. CI, 8 AM IST health workflow, backup workflow, docs; preview deploy → verify → promote.
