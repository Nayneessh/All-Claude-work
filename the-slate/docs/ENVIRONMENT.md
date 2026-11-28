# Environment configuration & infrastructure dependencies

## Browser build (public values only)

| Variable | Meaning | Where set |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase API URL | `.env.production` (committed — public), or real env var / Docker `--build-arg` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public "publishable"/anon key (RLS protects the data) | same |
| `VITE_TIMEZONE` | Default timezone (`Asia/Kolkata`); each user can change it in Settings | same |

`.env.example` documents them. **Never** put a service-role key, DB password or AI key in the browser build.

## Supabase secrets (stored in Supabase, never in Git)

| Secret | Used by | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | edge functions | injected automatically by Supabase |
| `ANTHROPIC_API_KEY` | `slate-parse` | **not set yet** → the rule-based reader is used. Dashboard → Edge Functions → Secrets |
| `SLATE_PARSE_MODEL` (optional) | `slate-parse` | default `claude-sonnet-5-5` |
| `push_config` rows: `vapid_public`, `vapid_private`, `vapid_subject`, `cron_secret`, `functions_url` | `notify`, `send-reminders`, `backup`, pg_cron | table is unreadable by `anon`/`authenticated`; generate VAPID keys with `npx web-push generate-vapid-keys` |

## GitHub (repository settings → Secrets and variables)

| Name | Type | Needed for |
|---|---|---|
| `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | variables (public) | CI build, 8 AM health check |
| `VERCEL_TOKEN` | secret | health check: deployment status |
| `SUPABASE_ACCESS_TOKEN` | secret | health check: platform status/backups |
| `HEALTH_GITHUB_TOKEN` | secret (optional) | health check: Dependabot / secret-scanning alerts (`security_events: read`) |
| `ALERT_WEBHOOK_URL` | secret (optional) | extra alert channel (Slack/Discord/ntfy) |
| `E2E_EMAIL`, `E2E_PASSWORD` | secrets (optional) | CI end-to-end tests with a dedicated, otherwise-empty test account |
| `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `OFFSITE_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `OFFSITE_S3_ENDPOINT` | secrets (optional) | off-platform weekly backup |

## Infrastructure inventory (today)

| Component | Identifier |
|---|---|
| Supabase project | `hiring-copilot` · ref `ebwfqgcxxwwselvfxcdc` · region ap-south-1 · **Free plan** |
| Vercel project | `hiring-copilot` (team `nayneessnh6`) · domains `hiring-copilot-nayneessnh6.vercel.app`, `hiring-copilot-seven.vercel.app` |
| GitHub | `Nayneessh/All-Claude-work`, folder `the-slate/`, branch `claude/kind-carson-0izo71` |
| Edge functions | `notify`, `backup`, `slate-parse`, `send-reminders` (all `verify_jwt=false`, self-authenticating) |
| Cron jobs | `slate-notify-5min`, `slate-backup-daily` (20:30 UTC = 02:00 IST), legacy `send-reminders-5min` |
| Storage buckets | `jds`, `cvs` (private, 10 MB, PDF/Word), `backups` (private, service role only) |

Out of scope and untouched: Supabase `monster-gains`, Vercel `all-claude-work`, the Monster Gains source and workflows.

## Supabase Auth settings (dashboard-only)

- Enable **leaked-password protection** (Auth → Providers → Email) — currently disabled (advisor warning).
- **Site URL / Redirect URLs**: add the production URL and, later, the new domain (needed for e-mail-link sign-in and password reset).
