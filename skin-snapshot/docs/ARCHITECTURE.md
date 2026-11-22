# Architecture

## Principles

1. **Business rules are pure.** `src/core` imports nothing but zod and a phone-number library. A test enforces this.
2. **Everything vendor-specific sits behind an interface.** Database driver, object store, AI provider, auth, bot check. A test checks that Vercel and Supabase packages are referenced only in the adapter files.
3. **Safety is a decision layer, not a prompt.** Rules live in `src/core/safety.ts` and run on the server; the browser runs the same code only for instant feedback.
4. **Closed vocabulary.** The AI cannot write sentences the visitor reads.
5. **The database enforces who can read what.** Staff reach health data only through audited, role-checked functions.

## Layers

```
Browser (Next.js, React)                       Server (Hono API, any Node host)
  public pages  /[lang]/...                      src/server/app.ts   routes, headers, error mapping
  case flow     /[lang]/case/[token]             src/server/service.ts  visitor use-cases (consent, answers, photos, booking, withdrawal)
  camera        MediaPipe (WASM, on-device)      src/server/analysis.ts AI pipeline
  console       /console                         src/server/auth.ts     staff identity adapter
                                                 src/server/purge.ts    retention job
        |  fetch /api/*                                  |
        +------------------------------------------------+
                                                         v
   src/core (pure)   src/ai (providers)   src/data (SQL)   src/storage (objects)
                                                         v
                             PostgreSQL (schema "ss")   +   object store (Postgres table or S3)
```

The same Hono app runs inside Next.js on Vercel (`src/app/api/[[...route]]/route.ts`) or alone on Node (`npm run serve:node`). A test starts it on a plain Node HTTP server.

## Visitor flow and where the gates sit

```
choose path -> age + 3 consents -> questionnaire -> GATE A (answers, deterministic)
   -> guided camera / upload -> review -> [confirm] -> upload (signed) -> server re-encode + check
   -> AI passes (2, parallel) -> validate closed vocabulary -> merge -> GATE B (image flags, over-flag)
   -> compose snapshot (invariants enforced again) -> booking -> WhatsApp
```

Gate A also runs again on the server inside the analysis pipeline, before any image is sent to a model.

## Why the AI returns codes, not sentences

* A diagnosis, score or skin age has no field to live in. Unknown fields and values are rejected (`src/core/ai-schema.ts`, `src/core/validate-output.ts`).
* Hindi needs no extra model call; the cosmetologist approves every phrase once (`src/core/phrases.ts`).
* The cost is less fluent prose. The trade is deliberate.

## Storage

Photos are held in memory on the device until the visitor confirms. After upload the server decodes and re-encodes each image (dropping EXIF/GPS), checks sharpness and light, and stores it privately. Staff see photos through 60-second signed links which are logged. Staging stores objects in a private table (`ss.objects`) because no storage keys were available; production can switch to any S3-compatible bucket with four environment variables and no code change.

## Authentication

* Visitors have no accounts. A 256-bit random token (stored only as a SHA-256 hash) identifies a case. A separate short case code (for WhatsApp) grants nothing.
* Staff use Supabase Auth with a mandatory TOTP code. The API verifies the bearer token with the issuer and passes the claims to the database, which requires `aal2` and an active staff row (`ss.current_staff_role()`).

## Analytics

One first-party table (`ss.events`): step names, timings, a random per-visit id. Whitelisted names and keys only. No cookies, no third-party scripts.
