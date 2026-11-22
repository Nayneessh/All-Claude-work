# API

Base path `/api`. JSON. All responses carry `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`. Errors are `{ "error": "<code>", "message"?: "...", "fields"?: [...] }`.

Visitor calls send the private case token in the header `x-case-token`. The phone-continuation token is sent as `x-capture-token` and can only reach the photo endpoints. Staff calls send `Authorization: Bearer <access token>` from a two-step-verified session.

## Public

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness and database check |
| `GET /config` | Non-sensitive settings: test banner, bot-check kind, service promise, retention numbers, whether WhatsApp is configured |
| `GET /botcheck` | A proof-of-work challenge (null when the bot check is off) |
| `POST /events` | Analytics event. Whitelisted names and keys only |

## Visitor (case token)

| Method and path | Purpose |
| --- | --- |
| `POST /cases` | Create a case. Needs `ageConfirmed`, the three required consents, optional `evaluation`, bot token, honeypot empty. Returns `{ token }` |
| `GET /case?lang=` | Everything the UI needs: stage, consents, photo slots, analysis status, safety state, snapshot view-model, booking, settings. A stopped case never returns observations, a routine or a booking prompt |
| `POST /case/answers` | Submit answers for the current (or pending) path. Validated against the path's questions; Gate A runs |
| `POST /case/switch-path` | Switch to the path the photos fit better; returns the questions still needed |
| `POST /case/photos` | Start a photo upload for a slot. Returns a short-lived upload URL (this app, or a presigned bucket URL) |
| `PUT /uploads/:photoId?t=` | Upload target for the database-backed store (signed, 5 minutes, size-capped) |
| `POST /case/photos/:photoId/complete` | Decode, re-encode, strip metadata, check sharpness and light. Returns `{ ok }` or `{ ok:false, reason }` |
| `POST /case/retake` | Clear photos and analysis, keep answers |
| `POST /case/analyze` | Run the analysis (waits for the result, up to about 60 s) |
| `POST /case/capture-session` | Create the 15-minute phone-continuation link |
| `POST /case/booking` | Create the booking. Rejected for stopped cases and before a snapshot exists |
| `POST /case/consents/:key/withdraw` | Withdraw a consent with its effect (see below) |
| `DELETE /case` | Delete the whole case at once |

Withdrawal effects: `privacy` deletes the case; `health` erases answers and analysis; `photos_ai` deletes photos and analysis; `whatsapp` stops contact and hides photos and answers from staff; `evaluation` stops any use of photos for AI checks.

## Console (staff)

| Method and path | Purpose |
| --- | --- |
| `GET /console/me` | Role and email |
| `GET /console/cases?path=&status=&flagged=` | Queue: newest booking first, flagged highlighted |
| `GET /console/cases/:id` | Case brief with signed 60-second photo links; logged |
| `POST /console/cases/:id/status` | `requested, contacted, scheduled, completed, no_response, closed` |
| `POST /console/cases/:id/notes` | Private note |
| `POST /console/cases/:id/feedback` | Agree/disagree per observation, or report a missed or false safety flag |
| `GET /console/cases/:id/export` | JSON export (photos as short-lived links); logged |
| `DELETE /console/cases/:id` | Delete a case |
| `POST /console/cases/:id/block-number` | Block the booking's WhatsApp number |
| `GET/POST/PUT/DELETE /console/templates` | Routine templates. Condition names, treatment and medicine claims are refused in both languages |
| `GET /console/stats` | Weekly counts and the four success measures |
| `GET /console/access-log` | Admin only |
| `GET /console/staff` | Admin only |
| `GET /console/settings`, `PUT /console/settings/:key` | Admin only for writes |
| `GET /media/:token` | Signed photo link (60 s). Logged as `view_photo` |

## Jobs

`GET|POST /jobs/purge` with `Authorization: Bearer $CRON_SECRET`.

## Development only

`POST /dev/token` mints a development staff token. It does not exist unless `AUTH_PROVIDER=dev` and the environment is not staging or production; configuration refuses to start otherwise.
