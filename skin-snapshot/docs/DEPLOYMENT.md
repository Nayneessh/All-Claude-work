# Deployment: Vercel + Supabase (today)

## 0. What you need

* A Supabase project (region `ap-south-1`, Mumbai, keeps data in India) on a plan that does not pause when idle. Free projects pause; a staging site must stay up.
* A Vercel project connected to this repository, **root directory `skin-snapshot`** (the app lives in a subfolder of the repository), framework Next.js. Vercel Hobby is for non-commercial use; use Pro for anything commercial.
* A way to call an AI model: either the Vercel AI Gateway (no key to manage; spend is billed by Vercel) or an API key for any supported provider.

## 1. Database

1. Create the Supabase project. Save the database password.
2. Apply the three files in `supabase/migrations` in order (SQL editor, `supabase db push`, or `DATABASE_URL=... npm run db:migrate`).
3. Copy the **pooler** connection string (Project Settings > Database > Connection string > Transaction pooler, port 6543). Vercel functions cannot reach the direct host over IPv6.
4. Create staff: Authentication > Users > Add user (auto confirm), then run `scripts/create-staff.sql` with the user's UUID and role. Each person enrols an authenticator app at first sign-in. Authentication > Providers: leave email on, switch off sign-ups (staff are invited by an administrator).

## 2. Vercel environment variables

Copy `.env.example`. For staging:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `staging` (Test banner, search engines blocked) |
| `DATABASE_URL` | pooler connection string |
| `SIGNING_SECRET`, `CRON_SECRET` | `openssl rand -base64 48` each |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Project Settings > API (publishable key) |
| `AI_PROVIDER` / `AI_MODEL` / `AI_AUTH` | for the AI Gateway: `openai-compatible`, a gateway model id, `vercel-oidc`. For a key: `anthropic`, `claude-sonnet-5-5`, `bearer`, plus `AI_API_KEY` |
| `RETENTION_UNBOOKED_HOURS` | `24` for staging |
| `WHATSAPP_NUMBER` | the number for the Open WhatsApp button (or set it later in Console > Settings) |

`NEXT_PUBLIC_*` values are baked in at build time: redeploy after changing them.

## 3. Deploy

Push to the production branch (or use "Redeploy"). `vercel.json` sets the Mumbai region, a 60-second limit for the API and a daily purge cron. The build runs `npm run build`, which copies the MediaPipe runtime into `public/vision`.

## 4. Verify

1. `GET /api/health` returns `{"ok":true,"db":"ok"}`.
2. Open `/en`, switch to Hindi, run a full check on a phone, request a talk.
3. Sign in at `/console`, enrol the authenticator, open the case. `Access log` (admin) shows the open and photo views.
4. Run `/en/test/camera` on each real device and keep the results (see `docs/TESTING.md`).

## 5. Stable URL

Vercel gives every project a production alias `https://<project>.vercel.app`. Use that for staging; it does not change between deployments. Preview URLs are protected by Vercel Authentication by default; the production alias is public.

## 6. Going to production later

Create a second Supabase project and Vercel environment with `APP_ENV=production`, `RETENTION_UNBOOKED_HOURS=72`, the real domain (Vercel > Domains), and switch **off** sample routines (Console > Settings). Do not launch before the reviews in `docs/REVIEW_REQUIRED.md`.
