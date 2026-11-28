-- Production fix: the original unique index on notifications was partial (WHERE dedupe_key IS NOT NULL), which PostgREST/Postgres
-- cannot use as an ON CONFLICT (user_id, dedupe_key) arbiter. Add the full unique index (additive; the old partial one is harmless and is
-- not present on fresh installs because migration 0001 now creates the full index directly).
create unique index if not exists notifications_dedupe_full_uq on public.notifications (user_id, dedupe_key);
