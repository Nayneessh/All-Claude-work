# Security and privacy

## Controls in place

| Control | Where |
| --- | --- |
| No visitor accounts; 256-bit private link, stored only as a hash; link dies at the retention deadline | `src/server/service.ts`, `src/core/ids.ts` |
| Separate unticked consents with version, language and time; withdrawal with real effects | `src/core/consent.ts`, `service.ts` |
| Age gate (self-declared) | Start flow, enforced by the API |
| Photos not uploaded until the visitor confirms; verified by a browser test that watches the network | `e2e/journey.spec.ts` |
| Browser re-encodes (drops EXIF/GPS) and shrinks to about 1.5 MB; server decodes and re-encodes again | `src/lib/imaging.ts`, `src/server/images.ts` |
| Upload and view links are signed, bound to one photo and one action, and expire in 5 minutes / 60 seconds | `src/server/signing.ts` |
| Private storage; no public URL exists | Postgres store or private bucket |
| Row-level security on every table; staff reach data only through audited functions requiring a verified two-step session | `supabase/migrations` |
| Append-only access log of who opened which case, viewed which photo, exported or deleted | `ss.access_log` |
| Staff role-based access in the database, not only in the interface | `ss.require_staff` |
| Input validation with strict schemas everywhere | zod in core and server |
| Rate limits per address, number, case; bot check (proof of work by default, Turnstile optional); honeypot | `src/server`, Postgres counters over salted hashes |
| Security headers: CSP, frame denial, no referrer, camera restricted to this site, HSTS | `next.config.ts` |
| Analytics carry step names and timings only; no third-party scripts or cookies | `ss.events` |
| Hard deletion with a ledger; retention job; backup replay script | `src/server/purge.ts`, `scripts/replay-deletions.ts` |
| Logs never contain images, answers or model text; a test checks the log lines | `tests/api.test.ts` |
| Staging cannot start with development sign-in or the mock AI | `src/server/config.ts`, `tests/architecture.test.ts` |
| Search engines blocked on staging, on every case, continuation and console page | headers and `robots.txt` |

## Data sent outside the system

* Photos and the chosen path go to the AI provider. The consent says the service is outside India.
* Nothing goes to analytics or advertising tools.
* The WhatsApp message holds only the first name and case code. It never contains photos, answers or the private link.

## Known weaker points

* The CSP allows inline scripts because Next.js needs them for hydration. A nonce-based policy is a later hardening.
* Staff sign-in uses the identity provider's rate limits. There is no application-level lockout.
* IP-based limits are deliberately loose (40 new cases an hour per address) because many mobile networks in India share one address between many phones (carrier-grade NAT); the proof-of-work check and the per-number booking limit (5 a day) do the real work. `RATE_LIMIT_SCALE` scales them. Limits use the first `x-forwarded-for` value; behind a different proxy configure it to set that header.
* Self-declared age.
* The proof-of-work bot check stops simple scripts, not a determined attacker with real browsers. Turnstile is available.
* The database-backed photo store is fine at Phase 1 volumes. Move to a bucket (four variables) before volume grows.

## Incident basics

Rotate `SIGNING_SECRET` (invalidates all signed links; cases keep working), rotate `CRON_SECRET`, revoke the AI key, deactivate a staff member (`update ss.staff set active=false`). If a breach is suspected, the access log shows every case and photo opened by staff.

## Requires qualified review before launch

See `docs/REVIEW_REQUIRED.md`. This document describes engineering controls, not legal compliance.
