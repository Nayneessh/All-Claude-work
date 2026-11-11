# Deploying: Supabase + Vercel

Nothing here has been run against your accounts. Each step changes shared infrastructure, so do them deliberately.

## 1. Supabase (Postgres, Auth, private Storage)

1. Use a project dedicated to this app (a `hiring-copilot` project exists in the connected Supabase organisation).
2. Apply `supabase/migrations/20261111000001_core_schema.sql` (SQL editor, `supabase db push`, or the MCP `apply_migration`). It creates the tables, RLS policies, append-only/frozen-rubric triggers, the profile bootstrap trigger and the private `cvs` bucket. The same file is what the PGlite tests run.
3. Auth → enable email/password; decide on email confirmation; **turn on MFA** (TOTP) for administrators.
4. Run Supabase's security advisor afterwards and fix anything it reports.
5. **The first account to sign up becomes the super admin.** Create it yourself immediately after applying the migration. Later accounts are inactive viewers until an admin activates them (Settings & Administration → Users).
6. Seed business entities and departments in the app (Settings → Entities), then assign recruiters/viewers to entities.

## 2. Vercel (static app + `/api/ai`)

Project root: `recruitment-platform/`. Environment variables:

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build | switches the app to cloud mode |
| `ANTHROPIC_API_KEY` | server only | used by `api/ai.ts`; never `VITE_`-prefixed |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | server | lets the proxy verify the caller's session |
| `AI_MODEL` | server, optional | defaults to `claude-opus-5-5` |

Then Settings → AI engine → Claude → **Test connection**. Until then the app uses the offline engine.

## 3. Before real candidate data goes in

- Confirm a data-processing agreement and retention terms with the AI provider (CV text is sent to it in Claude mode).
- Add a real malware scanner and OCR; add rate limiting to `/api/ai` (e.g. Vercel Firewall).
- Define retention and candidate-rights procedures; take legal advice on DPDP (India) and, if relevant, the EU AI Act.
- Validate on at least 100 recruiter-reviewed CVs (extraction accuracy and assessment quality separately) and run a bias review.
