# THE SLATE — Phase 1 audit (2026-11-28)

## What exists today
| Layer | Finding |
|---|---|
| Live app | `hiring-copilot-nayneessnh6.vercel.app` — framework-free JavaScript SPA (one `app.js` loader + 35 compressed chunks, supabase-js via CDN). **No source repository exists for it**; it was deployed by upload. |
| Vercel | Project `hiring-copilot` (team `nayneessnh6`), static, no Git link, no password/SSO protection. Latest production deployment `dpl_6m7xELkmPj6vGqaN7bxBRmd2bpCL` is kept as the rollback target. |
| Supabase | Project `hiring-copilot` (`ebwfqgcxxwwselvfxcdc`, ap-south-1, Postgres 17). Single user, sign-ups whitelisted (`allowed_emails` + trigger). RLS on every table. Private `cvs` bucket. Edge functions `command` (Claude-powered free-text actions) and `send-reminders` (web-push). `pg_cron` job every 5 min. |
| Data (real, must survive) | 14 mandates · 9 candidates · 434 workflow steps · 160 My-Slate tasks · 170 completions · 9 CVs · 1 comment · 1 push subscription |
| GitHub | The only repository in scope (`Nayneessh/All-Claude-work`) is **Monster Gains**, a different product. It is not touched. THE SLATE lives in the self-contained folder `the-slate/`. |
| Other projects | Supabase `monster-gains` and Vercel `all-claude-work` are **out of scope and untouched**. |

## Features worth keeping (and where they go)
- Mandate workflow checklist (11 phases, 434 steps) → mandate page, "Workflow" tab.
- Interview rounds, reminders/24h follow-ups, comments, CV uploads → candidate profile.
- Web-push alerts + cron → reused (VAPID keys stay in the database; new `notify` function).
- My Slate (daily/weekday/once tasks, sub-tasks, per-day completion, XP) → **The Slate** module.
- AI free-text command → superseded by the two natural-language entry points (mandate, candidate).

## Weaknesses found
1. **Supabase org is on the Free plan → no automatic backups at all.** (PITR/daily backups are Pro.) → own backup system built.
2. Free-plan projects pause after ~7 days of inactivity → daily health ping doubles as keep-alive.
3. Candidate belongs to exactly one mandate (`candidates.mandate_id NOT NULL`) → new `candidate_mandates` association.
4. Company is free text; agencies are a text array; no stage/rejection/drop configuration; rejection and drop not distinguished.
5. Stage history is a JSON blob on the row (overwritable) → append-only `candidate_status_history`.
6. No activity log → the 30-day clock could not be computed → `recruitment_activities` (trigger-fed).
7. Edge functions have `verify_jwt=false` (they authenticate themselves); `push_config` holds VAPID private key + cron secret in a table (RLS, no policy → service role only). Acceptable, documented.
8. Auth: "leaked password protection" is disabled (dashboard-only setting) → listed in the hand-over checklist.
9. Existing app is not reproducible from source → this repo is now the source of truth.

## Constraints that shaped the design
- Sandbox network allows npm/GitHub only; Supabase/Vercel are reached through their APIs.
- Monster Gains workflows fire on every push → all commits to this branch carry `[skip ci]`; THE SLATE's own workflows activate after merge to `main`.
- GitHub scheduled workflows run only from the default branch → the 8 AM health check starts after merge.

## Key decisions (assumptions are flagged so they can be reversed)
- Stack: Vite + React + TypeScript SPA, Supabase backend, static hosting (portable to any server; Dockerfile + nginx included).
- "Open for 30+ days with no meaningful activity" ⇒ days-open ≥ 30 **and** currently idle ≥ 5 days.
- Inactivity alert fires at 5 idle days; severity scales with urgency.
- Colour-band precedence: Dark grey (stalled) > Maroon (critical) > Gold (joined) > Green shade (offered) > Green (selected) > Purple (shared). Secondary conditions are shown as stripes so nothing is hidden.
- The "Confidential / Open for Advertisement" checkbox is one boolean (`confidential`); unticked = open for advertisement.
