# Recruitment Intelligence Platform

An internal, explainable CV-screening and candidate-intelligence platform built from the *AI-Powered CV Screening & Recruitment Intelligence Platform — Product Strategy, Solution Architecture & Project Plan* (11 Nov 2026). It turns hiring mandates and CVs into evidence-backed assessments, **scores them in code (not in the model)**, and keeps an immutable audit trail. AI assists; recruiters decide.

> **Status: working MVP prototype.** It runs end to end and is covered by 228 automated tests, but it has **not** been validated on real CVs, security-reviewed, or deployed. See [docs/COVERAGE.md](docs/COVERAGE.md) for exactly what the plan asked for, what is built, and what is not.

## Run it

```bash
npm ci
npm run dev          # http://localhost:5173 — Local demo mode, no account or keys needed
npm test             # 228 tests (domain, services, real PDF/DOCX parsing, Postgres RLS via PGlite, AI proxy)
npm run typecheck && npm run lint && npm run build
```

Open the app, sign in as a demo role (Super Admin, Administrator, Recruiter, Viewer), and press **Load demo data**: 3 entities, 3 mandates, an approved VP-Procurement rubric and 10 synthetic CVs screened through the real pipeline, spanning every outcome (Strong, Potential, Borderline 74.3, Below Threshold, Verification Required, Mandatory Non-Compliance, Manual Review, and a scanned PDF waiting for OCR).

## How a screening works

1. **Mandate** → JD → AI drafts a **role-specific rubric** (weighted criteria + mandatory gates) → a person reviews, edits and **approves** it. An approved rubric is frozen; changes create a new version.
2. **CV** → validate → security screen → store original → extract text → structure → de-duplicate (email/phone strong, name alone never) → link to one central candidate.
3. The CV is **blinded** (name, contact, gender/age/religion/marital fields removed) and the model returns **criterion ratings with verbatim evidence**. A validation layer discards invented quotes and withholds ratings that lack evidence.
4. **Code computes the score** (`Rating ÷ 5 × Weight`), applies mandatory gates and the policy: ≥90 Exceptional, ≥85 Strong, ≥75 Potential, **70–74.9 Borderline Review**, below that Below Threshold. A verified mandatory failure is never hidden by a high score; an *unclear* requirement is Verification Required, never a failure; low extraction confidence goes to Manual Review.
5. Every assessment is **immutable**. Humans record overrides (reason required) as separate decisions; the original AI result stays.

## Architecture (deviations from the plan are deliberate and listed in COVERAGE.md)

| Layer | Choice |
| --- | --- |
| UI | React 19 + TypeScript + Vite, plain CSS tokens (golden & green) |
| Data | Repository port with two adapters: **local** (IndexedDB) and **Supabase** (Postgres + RLS + private Storage) |
| AI | `AiProvider` contract: offline rules engine (default) or **Claude via a server-side proxy** (`api/ai.ts`, Vercel Function) |
| Scoring/gates/policy | Pure TypeScript in `src/domain` — deterministic, unit-tested |
| Security | RLS by entity + role, append-only triggers, frozen rubrics, private signed-URL storage |

```
src/domain    types, scoring, gates, chronology, duplicates, fairness (blind copy), validation layer, permissions
src/ai        provider contract adapters: heuristic.ts (offline), claude.ts (via /api/ai), text.ts (CV parsing)
src/services  mandates, rubrics, pipeline (queue), screening, decisions, candidates, analytics, exports
src/data      repo port, local (Dexie), supabase adapter, demo data
src/screens   dashboard, mandates + rubric review, upload/queue, screening, report, compare, candidates, reports, admin
api/ai.ts     secure AI proxy (auth, size cap, untrusted-data prompting, strict JSON schemas, refusal handling)
supabase/     migration (schema, RLS, triggers, storage) + PGlite tests
```

## Configuration

Local mode needs nothing. For cloud mode and the hosted model, see [docs/DEPLOY.md](docs/DEPLOY.md). Environment variables are listed in `.env.example`; the Anthropic key is **server-side only**.

## Known limits (read before relying on it)

- **No OCR** — scanned PDFs are routed to Needs Review (text can be pasted to continue).
- **Malware scanning is structural only** (active content, macros, EICAR). Add a real scanner for production.
- **Background processing runs in the browser** with a persisted job queue and crash recovery, not on a server worker.
- The **offline engine is conservative keyword-in-context**; it cannot read nuance. The Claude path is implemented and unit-tested against a fake provider but has **not been run against the live API** (no key was available).
- Legacy `.doc` extraction is best-effort and is always sent to review.
- Not done: MFA (a Supabase auth setting), rate limiting on `/api/ai`, EU/DPDP compliance work, retention workflows, bias testing on a real CV set. Those are listed in COVERAGE.md.
