# Operations

## Daily
* Console > Queue: new requests are at the top; flagged cases are highlighted (metadata only).
* Reply on WhatsApp; set the status (Requested, Contacted, Scheduled, Completed, No response, Closed). Closing starts the 90-day retention clock.

## Weekly
* Console > Counts: the four success measures, weekly counts, and "safety leaks" (must be zero). Reset the targets after the first 100 visitors, as the blueprint says.
* Console > AI feedback: agree/disagree on observations, and "Report a missed safety flag" on any case where one was missed. These are the evidence for the AI's accuracy.

## Staff
Add staff with `scripts/create-staff.sql`; deactivate with `update ss.staff set active=false where email=...`. Everyone must complete authenticator enrolment on first sign-in.

## Settings (Console > Settings, admin)
* WhatsApp number, service promise.
* Sample routines on or off. **Switch off before launch.**
* Maintenance mode.
* Image safety threshold. Lower is safer; change only with the dermatologist's sign-off.

Retention is configuration (`RETENTION_UNBOOKED_HOURS`, `RETENTION_CLOSED_DAYS`), not an admin toggle, so that the privacy notice and the behaviour change together.

## Routine templates
Console > Routine templates. Categories only, no brands. Saving with approve makes a template visible to visitors; edits can be saved as drafts. Condition names, medicines and treatment claims are refused.

## Monitoring
* `/api/health` for uptime checks.
* Vercel logs (or your host's) for structured one-line JSON events: `analysis.start`, `analysis.done`, `analysis.failed`, `purge.done`, `api.error`. They carry timings, counts and error codes only.
* `select error_code, count(*) from ss.analyses where status='failed' group by 1` for AI failure causes.
* `select percentile_cont(0.95) within group (order by latency_ms) from ss.analyses where status='done'` for the 60-second target.

## Deleting a person's data on request
Open the case in the console and use Delete case (removes photos, answers, booking, notes; leaves a ledger entry and an audit entry). If you only have the case code, the queue is searchable by it.
