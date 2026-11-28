# Moving THE SLATE to your own server and domain

Everything is portable: a static front-end + a Supabase backend. Choose **A** (keep Supabase hosted, move only the web front-end) or **B** (move both).

## A. New server/domain, same Supabase (≈ 30 min)

1. **Build** (any machine with Node ≥ 22):
   ```bash
   cd the-slate && npm ci
   VITE_SUPABASE_URL=https://ebwfqgcxxwwselvfxcdc.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_… npm run build   # → dist/
   ```
   or with Docker: `docker build -t the-slate --build-arg VITE_SUPABASE_URL=… --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=… .`
2. **Serve** `dist/` with any web server. `nginx.conf` is ready (SPA fallback for `/mandates`, `/talent/<id>`…, security headers, cache rules). Terminate TLS (Caddy, nginx + certbot, a cloud load balancer) and enable the HSTS line.
3. **DNS**: point `slate.yourdomain.com` at the server.
4. **Supabase → Authentication → URL configuration**: set *Site URL* to the new domain and add it under *Redirect URLs* (required for the e-mail-link sign-in and password reset).
5. **Content-Security-Policy**: `connect-src` already allows `*.supabase.co`; nothing to change while Supabase stays hosted.
6. **Push notifications**: browsers tie a push subscription to the *origin*. After the domain changes, open Settings → Notifications → **Enable on this device** once per device.
7. Update the monitor: GitHub variable `APP_URL`. Keep the old Vercel project until you have verified, then remove the domain from it.
8. Roll-back is instant: DNS back to the old host (the old deployment still exists).

## B. Move the backend too

1. Self-host Supabase (https://supabase.com/docs/guides/self-hosting) or create a new hosted project.
2. **Database**: apply `supabase/migrations/*.sql` in filename order to an empty database; then `supabase/hosted/20261128000010_cron_and_health.sql` (replace `YOUR-PROJECT-REF`; self-hosted needs `pg_cron` + `pg_net` or use the host's cron to call the two function URLs with the `x-cron-secret` header).
3. **Data**: follow `docs/BACKUP_AND_RECOVERY.md` procedure B (take a fresh backup first; `--map-user` for the new user id).
4. **Functions**: `supabase functions deploy notify backup slate-parse send-reminders --no-verify-jwt`; set secrets; insert `push_config` rows (generate **new** VAPID keys — then devices must re-enable push).
5. **Files**: copy the `jds` and `cvs` buckets (Storage API or `rclone`). Paths are `<user_id>/…`.
6. Rebuild the front-end with the new `VITE_SUPABASE_URL` / key and follow A.
7. Switch the health check variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`).

## What is *not* locked to a vendor
- **Hosting**: static files only; Vercel-specific config is confined to `vercel.json` (mirrored by `nginx.conf`).
- **Database**: standard Postgres; migrations are plain SQL; the only Supabase-isms are `auth.uid()`, the `auth.users` FK and `storage.*` policies (stubbed in the test harness, so a replay on a fresh Postgres is tested on every CI run).
- **File storage**: all uploads/downloads go through `FileStore` in `src/lib/storage.ts`; swap its implementation for S3/MinIO without touching screens.
- **AI**: one function (`slate-parse`); the app works without it.
- **Secrets**: only environment variables / Supabase secrets; none in the repository.

## Moving the code to its own repository
The folder is self-contained. To split it out with history:
```bash
git subtree split --prefix=the-slate -b the-slate-only        # then push that branch to a new empty repo
```
Move `.github/workflows/slate-*.yml` into the new repo's `.github/workflows/` and delete the `defaults.run.working-directory: the-slate` / `paths` lines.

## Vercel (current host) — how it is wired
Project `hiring-copilot`: framework Vite, root directory `the-slate`, install `npm ci`, build `npm run build`, output `dist`. Public build values come from `the-slate/.env.production`. To get automatic deploys: Vercel → Project → Settings → Git → connect `Nayneessh/All-Claude-work`, production branch `main`, keep the root directory `the-slate`.
