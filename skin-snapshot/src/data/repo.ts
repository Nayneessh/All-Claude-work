// Repositories: every SQL statement the application runs as the owner role lives here.
// (Staff reads and writes go through the console functions in the database instead.)
import type { Queryable } from './db';
import type { Answers } from '../core/questionnaire';
import type { ConsentKey } from '../core/consent';
import type { PathId, PhotoSlot, RedFlag, Restriction } from '../core/types';
import type { RoutineTemplate } from '../core/routine';

export interface CaseRow {
  id: string;
  code: string;
  token_hash: string;
  lang: 'en' | 'hi';
  path: PathId;
  stage: string;
  answers: Answers;
  answers_at: Date | null;
  safety_flags: RedFlag[];
  restrictions: Restriction[];
  safety_stopped: boolean;
  pending_path: PathId | null;
  session_id: string | null;
  eval_consent: boolean;
  health_withdrawn: boolean;
  contact_withdrawn_at: Date | null;
  created_at: Date;
  expires_at: Date | null;
  booked_at: Date | null;
  closed_at: Date | null;
}

export interface PhotoRow {
  id: string;
  case_id: string;
  slot: PhotoSlot;
  status: 'pending' | 'stored';
  content_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  object_key: string | null;
  client_checks: unknown;
  server_checks: unknown;
}

export interface AnalysisRow {
  id: string;
  case_id: string;
  path: PathId;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  result: unknown;
  gate_b: unknown;
  error_code: string | null;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  lock_until: Date | null;
}

export interface BookingRow {
  case_id: string;
  name: string;
  first_name: string;
  whatsapp_e164: string;
  whatsapp_hash: string;
  preferred_day: string;
  time_window: string;
  method: string;
  note: string;
  status: string;
  requested_at: Date;
}

const one = <T>(rows: T[]): T | null => rows[0] ?? null;

// ---------------------------------------------------------------- cases
export async function createCase(
  q: Queryable,
  c: {
    code: string;
    tokenHash: string;
    lang: string;
    path: PathId;
    sessionId: string | null;
    ipHash: string;
    deviceHash: string | null;
    expiresAt: Date;
    evalConsent: boolean;
    consents: { key: ConsentKey; version: string }[];
  },
): Promise<CaseRow> {
  const row = one(
    await q.query<CaseRow>(
      `insert into ss.cases (code, token_hash, lang, path, session_id, ip_hash, device_hash, expires_at, eval_consent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [c.code, c.tokenHash, c.lang, c.path, c.sessionId, c.ipHash, c.deviceHash, c.expiresAt, c.evalConsent],
    ),
  )!;
  for (const k of c.consents) {
    await q.query(`insert into ss.consents (case_id, key, version, lang) values ($1,$2,$3,$4)`, [row.id, k.key, k.version, c.lang]);
  }
  return row;
}

export const getCaseByTokenHash = async (q: Queryable, hash: string) =>
  one(await q.query<CaseRow>(`select * from ss.cases where token_hash = $1 and (expires_at is null or expires_at > now())`, [hash]));

export const getCaseById = async (q: Queryable, id: string) => one(await q.query<CaseRow>(`select * from ss.cases where id = $1`, [id]));

export async function updateCase(q: Queryable, id: string, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}${['answers', 'safety_flags', 'restrictions'].includes(k) ? '::jsonb' : ''}`);
  const vals = keys.map((k) => (['answers', 'safety_flags', 'restrictions'].includes(k) ? JSON.stringify(patch[k]) : patch[k]));
  await q.query(`update ss.cases set ${sets.join(', ')} where id = $1`, [id, ...vals]);
}

export const activeConsents = async (q: Queryable, caseId: string) =>
  (await q.query<{ key: ConsentKey; version: string; granted_at: Date }>(`select key, version, granted_at from ss.consents where case_id=$1 and withdrawn_at is null`, [caseId]));

export async function grantConsent(q: Queryable, caseId: string, key: ConsentKey, version: string, lang: string): Promise<void> {
  await q.query(`insert into ss.consents (case_id, key, version, lang) values ($1,$2,$3,$4) on conflict do nothing`, [caseId, key, version, lang]);
}

export async function withdrawConsentRow(q: Queryable, caseId: string, key: ConsentKey): Promise<boolean> {
  const r = await q.query(`update ss.consents set withdrawn_at = now() where case_id=$1 and key=$2 and withdrawn_at is null returning id`, [caseId, key]);
  return r.length > 0;
}

export async function deleteCase(q: Queryable, c: { id: string; code: string }, reason: 'visitor_request' | 'consent_withdrawn' | 'retention_expired' | 'staff_request'): Promise<void> {
  await q.query(`insert into ss.deletion_ledger (case_id, case_code, reason) values ($1,$2,$3)`, [c.id, c.code, reason]);
  await q.query(`delete from ss.cases where id = $1`, [c.id]);
}

export const expiredCases = async (q: Queryable, limit = 200) =>
  q.query<{ id: string; code: string }>(`select id, code from ss.cases where expires_at is not null and expires_at <= now() order by expires_at limit $1`, [limit]);

// ---------------------------------------------------------------- photos
export const listPhotos = (q: Queryable, caseId: string) => q.query<PhotoRow>(`select * from ss.photos where case_id=$1 order by slot`, [caseId]);

export const getPhoto = async (q: Queryable, id: string) => one(await q.query<PhotoRow>(`select * from ss.photos where id=$1`, [id]));

/** Create or replace the photo row for a slot. Returns the new row and the key of any replaced object. */
export async function upsertPhotoSlot(q: Queryable, caseId: string, slot: PhotoSlot, p: { contentType: string; width: number | null; height: number | null; clientChecks: unknown }): Promise<{ photo: PhotoRow; replacedKey: string | null }> {
  const prev = one(await q.query<PhotoRow>(`select * from ss.photos where case_id=$1 and slot=$2`, [caseId, slot]));
  if (prev) await q.query(`delete from ss.photos where id=$1`, [prev.id]); // trigger queues the old object for deletion
  const photo = one(
    await q.query<PhotoRow>(
      `insert into ss.photos (case_id, slot, content_type, width, height, client_checks) values ($1,$2,$3,$4,$5,$6::jsonb) returning *`,
      [caseId, slot, p.contentType, p.width, p.height, JSON.stringify(p.clientChecks ?? null)],
    ),
  )!;
  return { photo, replacedKey: prev?.object_key ?? null };
}

export async function markPhotoStored(q: Queryable, id: string, p: { key: string; size: number; width: number; height: number; serverChecks: unknown }): Promise<void> {
  await q.query(`update ss.photos set status='stored', object_key=$2, size_bytes=$3, width=$4, height=$5, server_checks=$6::jsonb, stored_at=now() where id=$1`, [id, p.key, p.size, p.width, p.height, JSON.stringify(p.serverChecks)]);
}

export const deletePhotosOfCase = (q: Queryable, caseId: string) => q.query(`delete from ss.photos where case_id=$1`, [caseId]);

// ---------------------------------------------------------------- storage queue and Postgres object store
export const putObject = (q: Queryable, key: string, contentType: string, bytes: Uint8Array) =>
  q.query(`insert into ss.objects (key, content_type, bytes) values ($1,$2,$3::bytea) on conflict (key) do update set bytes=excluded.bytes, content_type=excluded.content_type`, [key, contentType, bytes]);

export const getObject = async (q: Queryable, key: string) =>
  one(await q.query<{ content_type: string; bytes: Uint8Array }>(`select content_type, bytes from ss.objects where key=$1`, [key]));

export const deleteObject = (q: Queryable, key: string) => q.query(`delete from ss.objects where key=$1`, [key]);
export const pendingStorageDeletions = (q: Queryable, limit = 200) => q.query<{ key: string }>(`select key from ss.storage_deletions order by queued_at limit $1`, [limit]);
export const clearStorageDeletion = (q: Queryable, key: string) => q.query(`delete from ss.storage_deletions where key=$1`, [key]);
export const orphanObjectKeys = (q: Queryable, limit = 200) =>
  q.query<{ key: string }>(`select o.key from ss.objects o where not exists (select 1 from ss.photos p where p.object_key = o.key) and o.created_at < now() - interval '1 hour' limit $1`, [limit]);

// ---------------------------------------------------------------- analyses
export async function createAnalysis(q: Queryable, caseId: string, path: PathId): Promise<AnalysisRow> {
  return one(await q.query<AnalysisRow>(`insert into ss.analyses (case_id, path) values ($1,$2) returning *`, [caseId, path]))!;
}
export const latestAnalysis = async (q: Queryable, caseId: string) =>
  one(await q.query<AnalysisRow>(`select * from ss.analyses where case_id=$1 order by queued_at desc limit 1`, [caseId]));

/** Atomically claim a queued (or stale running) analysis. Returns null if another worker holds it. */
export async function claimAnalysis(q: Queryable, id: string, lockSeconds: number): Promise<AnalysisRow | null> {
  return one(
    await q.query<AnalysisRow>(
      `update ss.analyses set status='running', started_at=now(), attempts=attempts+1, lock_until = now() + make_interval(secs => $2)
       where id=$1 and (status='queued' or (status='running' and lock_until < now())) returning *`,
      [id, lockSeconds],
    ),
  );
}
export async function finishAnalysis(
  q: Queryable,
  id: string,
  p: { status: 'done' | 'failed'; provider?: string; model?: string; promptVersion?: string; schemaVersion?: string; passes?: number; disagreements?: number; gateB?: unknown; result?: unknown; errorCode?: string | null; inputTokens?: number; outputTokens?: number },
): Promise<void> {
  await q.query(
    `update ss.analyses set status=$2, provider=$3, model=$4, prompt_version=$5, schema_version=$6, passes=$7, disagreements=$8, gate_b=$9::jsonb, result=$10::jsonb,
       error_code=$11, input_tokens=$12, output_tokens=$13, finished_at=now(), latency_ms = (extract(epoch from (now() - coalesce(started_at, queued_at))) * 1000)::int, lock_until=null
     where id=$1`,
    [id, p.status, p.provider ?? null, p.model ?? null, p.promptVersion ?? null, p.schemaVersion ?? null, p.passes ?? null, p.disagreements ?? null, JSON.stringify(p.gateB ?? null), JSON.stringify(p.result ?? null), p.errorCode ?? null, p.inputTokens ?? null, p.outputTokens ?? null],
  );
}
export const staleAnalyses = (q: Queryable) => q.query<{ id: string; case_id: string }>(`select id, case_id from ss.analyses where status in ('queued','running') and queued_at < now() - interval '3 minutes' limit 50`);

// ---------------------------------------------------------------- bookings
export const getBooking = async (q: Queryable, caseId: string) => one(await q.query<BookingRow>(`select *, preferred_day::text as preferred_day from ss.bookings where case_id=$1`, [caseId]));

export async function createBooking(q: Queryable, b: { caseId: string; name: string; firstName: string; e164: string; hash: string; day: string; window: string; method: string; note: string }): Promise<BookingRow> {
  return one(
    await q.query<BookingRow>(
      `insert into ss.bookings (case_id, name, first_name, whatsapp_e164, whatsapp_hash, preferred_day, time_window, method, note)
       values ($1,$2,$3,$4,$5,$6::date,$7,$8,$9) returning *, preferred_day::text as preferred_day`,
      [b.caseId, b.name, b.firstName, b.e164, b.hash, b.day, b.window, b.method, b.note],
    ),
  )!;
}

export const isNumberBlocked = async (q: Queryable, hash: string) => (await q.query(`select 1 from ss.blocked_numbers where whatsapp_hash=$1`, [hash])).length > 0;

// ---------------------------------------------------------------- capture sessions (phone continuation)
export async function createCaptureSession(q: Queryable, caseId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await q.query(`insert into ss.capture_sessions (case_id, token_hash, expires_at) values ($1,$2,$3)`, [caseId, tokenHash, expiresAt]);
}
export const getCaptureSession = async (q: Queryable, hash: string) =>
  one(await q.query<{ id: string; case_id: string; expires_at: Date }>(`select id, case_id, expires_at from ss.capture_sessions where token_hash=$1 and expires_at > now()`, [hash]));

// ---------------------------------------------------------------- templates, settings, events, rate limits
export async function listTemplates(q: Queryable): Promise<RoutineTemplate[]> {
  return q.query<RoutineTemplate>(`select id, name, steps, skin_feel, sensitivity, budget_bands, items, approved, sample from ss.routine_templates`);
}
export async function getSettings(q: Queryable): Promise<Record<string, unknown>> {
  const rows = await q.query<{ key: string; value: unknown }>(`select key, value from ss.settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export const insertEvent = (q: Queryable, e: { sessionId: string | null; name: string; path?: string | null; lang?: string | null; props?: Record<string, unknown> }) =>
  q.query(`insert into ss.events (session_id, name, path, lang, props) values ($1,$2,$3,$4,$5::jsonb)`, [e.sessionId, e.name, e.path ?? null, e.lang ?? null, JSON.stringify(e.props ?? {})]);

export async function hitRateLimit(q: Queryable, key: string, windowSeconds: number): Promise<number> {
  const r = await q.query<{ count: number }>(
    `insert into ss.rate_limits (key, count, expires_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set count = case when ss.rate_limits.expires_at < now() then 1 else ss.rate_limits.count + 1 end,
       expires_at = case when ss.rate_limits.expires_at < now() then now() + make_interval(secs => $2) else ss.rate_limits.expires_at end
     returning count`,
    [key, windowSeconds],
  );
  return Number(r[0]!.count);
}
export const purgeExpiredRateLimits = (q: Queryable) => q.query(`delete from ss.rate_limits where expires_at < now()`);
export const purgeExpiredCaptureSessions = (q: Queryable) => q.query(`delete from ss.capture_sessions where expires_at < now() - interval '1 hour'`);

export const deletePhotosOfCaseSlot = (q: Queryable, photoId: string) => q.query(`delete from ss.photos where id=$1`, [photoId]);
