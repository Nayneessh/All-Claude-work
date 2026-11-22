# Moving to another server

You own the code and the data. Nothing here needs Vercel or Supabase except what is listed under "Replace".

## What is portable as is

| Piece | How |
| --- | --- |
| Application | `Dockerfile` builds a standard Node image; `npx next start` serves it. The API alone runs with `npm run serve:node` |
| Database | Plain PostgreSQL 15+. Migrations are plain SQL (`npm run db:migrate`). Export with `pg_dump`, import with `psql` |
| Photos | In the database by default (moves with the dump). With a bucket, use any S3-compatible service and change four variables |
| AI | Provider and model are variables. Any OpenAI-compatible endpoint works |
| Scheduling | One endpoint, `/api/jobs/purge`. Any scheduler can call it: `curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/jobs/purge` daily |

## Replace

| Today | Replace with | Effort |
| --- | --- | --- |
| Vercel hosting | Docker host, VM, Kubernetes, any PaaS that runs Node 22 | Low |
| Vercel Cron | System cron or the scheduler above | Low |
| Vercel AI Gateway authentication | `AI_AUTH=bearer` with an API key | Variables only |
| Supabase Auth (staff sign-in) | Self-host Supabase Auth (GoTrue, open source) or another OIDC provider by writing one class that implements `AuthProvider.verify` (`src/server/auth.ts`). The database only needs the claims `sub`, `email`, `aal`. Set `aal` to `aal2` only after a second factor | Low to medium |
| Supabase pooler | Any Postgres connection string (use PgBouncer in transaction mode if you add pooling; the driver already disables prepared statements) | Variables only |

## Checklist

1. Provision PostgreSQL. `pg_dump` the old database (schema `ss` and `public.ss_migrations`), restore into the new one, or start fresh and run `npm run db:migrate`.
2. Create staff rows (`scripts/create-staff.sql`) for whichever identity provider you use.
3. Build and run the container; set the environment variables from `.env.example`. Rebuild when any `NEXT_PUBLIC_*` value changes.
4. Point DNS at the new host and terminate TLS. Update the identity provider's allowed redirect URLs.
5. Schedule the purge job.
6. Re-run the checks in `docs/DEPLOYMENT.md` section 4.
7. Before switching traffic: export the deletion ledger from the old database and replay it on the new one (`scripts/replay-deletions.ts`) so nothing deleted since the dump reappears.

## Authentication configuration to carry over

Allowed sites and redirect URLs; TOTP multi-factor enabled; sign-ups disabled; email templates if you use invitations.

## Domain

The app does not hard-code any host. The only absolute URL it builds is the phone-continuation link, from `location.origin` in the browser. Set `NEXT_PUBLIC_SITE_URL` for the sitemap once indexing is allowed.

## Docker quick start

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose up -d app          # http://localhost:3000
```
