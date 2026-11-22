# Deployment status (22 Nov 2026)

## Live now

| Item | Value |
| --- | --- |
| Staging URL (stable alias) | https://skin-snapshot.vercel.app |
| Vercel project | `skin-snapshot` (`prj_6SzyKhYWxU4EtZUuYFLRtfoclDOb`), team `nayneessnh6`, region Mumbai (`bom1`), Node 22 |
| Source | GitHub `Nayneessh/All-Claude-work`, branch `claude/cool-wozniak-7z8obz`, folder `skin-snapshot/` (root directory set in the Vercel project) |
| Deployment | `dpl_8t4hCLieJvPyXBTHJuwD3r3psYFA`, commit `5701873`, target production, state READY |
| Deployment protection | Vercel Authentication applies to **preview** URLs only. The production alias is public |

What a visitor can use without any setup: every public page in English and Hindi, the language switch, the **practice camera** (`/en/camera-preview`, linked from the path picker and the consent page; photos stay on the device), the camera self-test (`/en/test/camera`), camera help, and the whole assessment (path, consents, questionnaire, guided camera, upload, AI snapshot, booking message). The Test banner and search-engine blocking are active (hosted deployments default to staging).

## Temporary in-memory store (test link only)

Until `DATABASE_URL` is set, a staging deployment runs on an **in-memory PostgreSQL** (PGlite) inside the server function, so the link can be tested end to end with nothing else set up (update of 22 Nov 2026, after the camera could not be reached because every API call returned `503 not_configured`).

* Cases, photos and bookings live only in that server instance's memory. They are lost when the instance restarts, and two instances do not share them. If the page says the case is gone, start again. That is expected and the start page says so.
* Production (`APP_ENV=production`) never does this. It refuses to start without `DATABASE_URL`.
* The staff console still needs the Supabase variables (sign-in) and a real database (staff list, notes, audit log). It answers `503 not_configured` until both exist.
* The AI step uses the Vercel AI Gateway with the deployment's own identity (no key). If the Gateway has no credits, the visitor sees the calm retry message and the camera and upload steps are unaffected.

## Still needs the database (for a real, durable deployment)

Anything that must survive a restart (cases, bookings, the console, the audit log, the daily purge of expired data) needs PostgreSQL via `DATABASE_URL`.

## Why it is not finished, and the exact remaining steps

Two actions were refused by the tools available to the build session:

1. **Creating a Supabase project** was refused by the session's permission check because it adds a recurring cost and had not been explicitly approved.
2. **Setting Vercel environment variables** returned `403 forbidden` for the connected Vercel account. The values cannot be put in the repository, so they must be entered once in the Vercel dashboard.

To finish (about 10 minutes):

1. In Supabase, create a project in `ap-south-1` (Mumbai) on a plan that does not pause when idle. Note the database password.
2. Apply the three files in `supabase/migrations` in order (SQL editor, or `DATABASE_URL=... npm run db:migrate`). The session can do this for you if you give it the project reference.
3. In Vercel > Project > Settings > Environment Variables (Production and Preview), add:

| Name | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase pooler connection string (Transaction pooler, port 6543) | Required. The signing secret is derived from it unless you also set `SIGNING_SECRET` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Needed for staff sign-in |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key | Needed for staff sign-in |
| `WHATSAPP_NUMBER` | e.g. `+91XXXXXXXXXX` | Or set it in Console > Settings. Until then visitors are shown the message to copy |
| `CRON_SECRET` | any long random string | Enables the daily purge cron. Optional: cases are also purged opportunistically |
| `AI_API_KEY`, `AI_PROVIDER=anthropic`, `AI_AUTH=bearer`, `AI_MODEL=claude-sonnet-5-5` | | Only if you do not want to use the Vercel AI Gateway (the default, which needs credits on the Vercel team) |

4. Redeploy (Deployments > ... > Redeploy). `NEXT_PUBLIC_*` values are baked in at build time.
5. Create the first staff accounts (`scripts/create-staff.sql`). Sign in at `/console`, set up the authenticator app, then Console > Settings > **Test AI connection**.

Everything else (hosting region, Node version, the daily cron, security headers, the staging defaults) is already configured in `vercel.json` and the project.

## Not verified from the build session

* An unauthenticated fetch of the staging URL: the build environment's network policy blocks `*.vercel.app`. The URL was fetched through Vercel's own tooling (HTTP 200 content for `/en` with the Test banner and the logo placeholder text; `/api/health` correctly returned `503 not_configured`). Open the link in a private window to confirm it needs no sign-in.
* The Vercel AI Gateway call (needs the database to reach the analysis step).
* Supabase Auth sign-in and authenticator enrolment.
