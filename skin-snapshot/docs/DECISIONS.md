# Decisions and deviations

## The six decisions in the plan, and what was done

The plan asked six questions. The product owner replied "build everything", so the recommended option was taken for each, except where a platform rule required an explicit approval.

| # | Recommended | Done |
| --- | --- | --- |
| D1 Dedicated accounts | New private repo, new Supabase project, new Vercel project, AI key | Code is in this repository on the development branch, in `skin-snapshot/`, because the session may only write to this repository. Supabase project creation needs an explicit spend approval and was **not** done (see `docs/DEPLOYMENT_STATUS.md`) |
| D2 Staging exposure | Public with Test banner, noindex, 24-hour deletion | Implemented (`APP_ENV=staging`). The owner said the site is not being released directly |
| D3 Two darker shades of the palette | Deep Sage `#243A31`, Deep Amber `#6F4C14` | Implemented (`docs/DESIGN.md`) |
| D4 Optional fifth consent for AI quality checks | Yes | Implemented, unticked by default, withdrawable |
| D5 Reviewers and dates | Names needed | Not provided. Everything affected is marked draft (`docs/REVIEW_REQUIRED.md`) |
| D6 Risk-first order | Camera and AI first | Done |

## Deviations from the blueprint and the master prompt (and why)

1. **One package, not a multi-package monorepo.** `src/core`, `src/ai`, `src/data`, `src/storage`, `src/server` are separate directories with enforced boundaries (`tests/architecture.test.ts`). Same separation, simpler Vercel build and Docker image.
2. **Photos are stored in a private database table on staging, not in a Supabase Storage bucket.** The session cannot see the Supabase service key or create S3 keys. The `ObjectStore` interface has an S3-compatible adapter (unit-tested for URL signing, not exercised against a live bucket). Switching is four environment variables.
3. **Staff sign-in is Supabase Auth with TOTP, but could not be exercised here** (no Supabase project was created). The database rules that depend on it (`aal2`, role, active) are tested with simulated verified claims. The development sign-in used in the browser tests is refused outside development by configuration and tests.
4. **The AI returns codes, not sentences.** This goes beyond "do not hard-code AI responses": nothing the visitor reads is model-written.
5. **Two safety gates, not one.** A deterministic gate on the answers runs before any photo is taken.
6. **Flagged visitors who never book show to the cosmetologist as metadata only.** The blueprint alerts the cosmetologist but collects consent to share photos and answers only at booking.
7. **Path switching re-asks the stricter questions** and holds the routine meanwhile.
8. **Sharpness is measured relative to brightness.** Plain Laplacian variance falls with brightness squared and would call darker-skinned faces blurry. Found while testing and fixed (`src/core/vision-metrics.ts`).
9. **Closed-vocabulary side labels:** left and right mean the person's own left and right.
10. **Retention is configuration, not an admin toggle**, so the privacy text and the behaviour change together.
11. **The logo placeholder text is fixed English** ("Your logo goes over here.") in both languages, as specified.
12. **Marathi, shop, payments, accounts, PDFs, progress tracking, calendar booking, WhatsApp API automation: not built**, per the Phase 1 boundary.

## Source of truth for the sizing rules

Distance 42% to 82% of frame height; centre within 14% and 16%; roll up to 8 degrees; front yaw up to 11 degrees; side shots 32 to 58 degrees; sharpness 8 (normalised); light: 95th percentile at least 62, spread at least 22, glare under 8%, side imbalance under 38%. All in `src/core/vision-metrics.ts`. **Calibrated on synthetic fixtures only. They must be re-checked on real devices and real skin tones** (`docs/TESTING.md`).
