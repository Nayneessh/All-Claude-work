# Plan → build coverage

Source: *AI-Powered CV Screening & Recruitment Intelligence Platform — Product Strategy, Solution Architecture & Project Plan* (11 Nov 2026). Status legend: **Built** (works, tested), **Partial** (works with a stated gap), **Not built**.

The plan said not to code before eight business decisions were approved. You chose to proceed on its recommended defaults; every default taken is listed under "Decisions assumed" and is a revisable assumption, not an approval.

## Decisions assumed (plan §16)

| Decision | Assumed default | Where it lives |
| --- | --- | --- |
| Organisational structure | Central admin + entity-level access | `permissions.ts`, RLS `app_can_see_entity` |
| Deployment | India only | no multi-country config built |
| Language | English CVs only | heuristic parser is English; hosted model could read more |
| 75-point threshold | Automatic internal status **with 70–74.9 borderline review** | `scoring.ts` `DEFAULT_POLICY`, editable per rubric |
| Rubric control | AI proposes; person edits and approves | `rubrics.ts`, Mandates → Rubric tab |
| Candidate database | Central, entity-level visibility | `candidates`, `app_can_see_candidate` |
| Hosting | Supabase + Vercel (your choice) | `docs/DEPLOY.md` |
| AI provider | Provider-independent; offline engine default, Claude via proxy | `contract.ts`, `api/ai.ts` |

## Functional requirements

| Plan § | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 4.1 | Executive dashboard: 10 components, filters (entity, department, status, date), activity, failure and pending-review alerts | **Built** | `Dashboard.tsx`, `analytics.ts` (7 tests) |
| 4.2 | Mandate records, all field groups, create / edit / duplicate / archive / close / reopen, history, **versioning that preserves the original rubric** | **Built** | Material-change diff, version snapshots, stale-rubric block. *Supporting attachments beyond the JD are not built.* |
| 4.3 | AI Role Intelligence → rubric → review → approve; approved rubric never silently changed | **Built** | Offline engine + Claude proxy; frozen in code **and** by DB trigger |
| 4.4 | Central candidate profile, duplicate detection on multiple identifiers, CV version linking, audited merges, search | **Built** | Name alone never merges. *Manual verification-status editing UI not built.* |
| 4.5 | PDF/DOC/DOCX, validation, security checks, duplicate files, text + page info, OCR, structured extraction, statuses, failed CVs stay accessible | **Partial** | All built **except OCR** (scanned PDFs → Needs Review, paste-text resolution). Security checks are structural, not antivirus. DOC is best-effort. |
| 4.6–4.7 | Evidence / interpretation / verification layers; report with all sections; Met / Partial / Not Met / **Not Evident** / Unable | **Built** | Not Evident is never a failure (tested) |
| 4.8 | Compare up to five candidates | **Built** | Criterion points, gates, evidence quality, gaps, verification; Excel + PDF |
| 4.9 | MVP reports + PDF/Excel export | **Built** | Screening, assessment, comparison, entity dashboard, screening history. Future reports not built. |

## Methodology and scoring

| Plan § | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 5.1–5.2 | Multi-stage pipeline with separate parser / extraction / assessment / **deterministic scoring** / validation | **Built** | Model never supplies a total or status (tested with a lying provider) |
| 5.3 | Requirement → evidence → interpretation → verification | **Built** | |
| 5.4 | Chronology: gaps, overlaps, inconsistencies **flagged, not penalised** | **Built** | `chronology.ts` |
| 6.1–6.2 | Configurable 100-point weighted model, 0–5 rating, `Rating ÷ 5 × Weight`, missing-evidence policy | **Built** | `rescale` (default) or `zero`; score range shown |
| 6.3 | Mandatory gates: Pass / Fail / Needs Verification / N/A | **Built** | Experience gate computed by code; fail only with complete dated chronology |
| 6.4–6.5 | Classification bands and safeguards | **Built** | 74.3 → Borderline Review in the demo |
| 6.6 | Override + audit; original assessment never overwritten | **Built** | Append-only in code and DB |

## Architecture, data, security

| Plan § | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 9.1 | Next.js + FastAPI + Celery + OCR | **Deviation** | React/Vite + Supabase + a Vercel Function, as chosen. Background work runs in the browser with a persisted, crash-recoverable queue, not a server worker. No pgvector. |
| 9.4 | Provider abstraction; record model, prompt version | **Built** | Recorded on every assessment (the model that actually served the call) |
| 10 | Relational model, FKs, versioned rubrics/assessments, immutable audit, soft delete, entity boundaries | **Built** | Typed key columns + `jsonb`; no hard deletes. *Retention and deletion workflows not built.* |
| 11.1 | Roles, entity visibility, permission-based downloads | **Built** | Viewer cannot download CVs (UI + storage policy). *Department-level access not built.* |
| 11.1 | MFA, session management | **Not built** | Enable in Supabase Auth settings |
| 11.2 | Encryption, signed time-limited document access, no public links, secrets outside code, backups | **Partial** | Private bucket + 5-minute signed URLs; encryption and backups are Supabase platform features (verify on your plan). **API rate limiting not built.** |
| 11.3 | Fairness: protected attributes excluded, blind copy, no gap penalty, hallucination controls | **Built** | Name/gender/age/religion swap leaves score unchanged (tested). *Formal bias testing on real CVs not done.* |
| 11.4 | DPDP Act / EU AI Act assessment | **Not built** | A legal and policy workstream, not code |

## Success criteria from §2 (targets, not yet measured)

| Metric | Status |
| --- | --- |
| ≥95% extraction accuracy on an agreed test set | **Not measured** — needs the reviewed CV set |
| 100% of material assessments carry evidence traceability | **Enforced** by the validation layer |
| 100% audit coverage of scoring changes | **Enforced** (audit failure fails the operation) |
| < 2 min per CV | Offline engine: well under a second. Claude: unmeasured. |
| Zero critical vulnerabilities at release | **Not assessed** — needs a security review |

## MVP scope checklist (plan §15.1)

Authentication ✔ (Supabase; demo roles locally) · Organisation management ✔ · Mandate create/edit ✔ · JD upload ✔ (txt/md/docx/pdf) · AI role interpretation ✔ · Editable rubric ✔ · Individual and bulk CV upload ✔ · Extraction and OCR ◐ (OCR missing) · Candidate database ✔ · AI screening ✔ · Scoring /100 ✔ · Mandatory gates ✔ · Report with evidence refs ✔ · Status and overrides ✔ · Comparison ✔ · Dashboard ✔ · Audit trail ✔ · PDF/Excel export ✔

## Phase 2–3 (deliberately not built)

Cross-mandate match suggestions, interview questions and templates, recruiter feedback loop, talent-pool analytics, email and ATS integration, CRM, multi-country configuration, predictive analytics.

## Visual direction

The plan specified night-blue + deep-green + gold. This build uses a **golden and green** scheme throughout, as you asked for. Status colours (teal-green, caution gold, blue, red) were checked with a colour-vision-deficiency validator and are always paired with an icon and a text label.

## Verification performed

- 228 automated tests: scoring and policy, gates, chronology, duplicate detection, fairness, validation layer, write guards, services end to end (real PDF/DOCX generation and parsing), exports (re-read after writing), Claude client, AI proxy, Supabase adapter, **31 Postgres tests (PGlite) of RLS, append-only triggers, frozen rubrics, storage policies and profile-escalation guards**.
- A real-browser walkthrough (Chromium): sign-in by role, demo load, every main screen, real file upload (DOCX, PDF, corrupt, EICAR, scanned), CV version linking, override, viewer read-only. Zero console errors.
- **Not verified:** the live Anthropic API, a real Supabase project, Vercel deployment, real-world CVs.
