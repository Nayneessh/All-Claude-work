// Visitor-facing application services. Framework-free: the HTTP layer calls these.
import { z } from 'zod';
import { START_REQUIRED, CONSENT_VERSION, WITHDRAWAL_EFFECTS, type ConsentKey } from '../core/consent';
import { answersSchema, missingQuestions, questionsFor, type Answers } from '../core/questionnaire';
import { composeSnapshot, stoppedSnapshot, type SnapshotVM } from '../core/snapshot';
import { evaluateGateA, combineSafety } from '../core/safety';
import { normaliseObservations } from '../core/validate-output';
import { aiResultSchema, type AiResult } from '../core/ai-schema';
import { bookableDays, bookingSchema, buildWhatsappMessage, firstNameOf, normaliseWhatsapp, whatsappLink } from '../core/booking';
import { generateCaseCode, generateToken, sha256Hex, isToken } from '../core/ids';
import { PATHS, PHOTO_SLOTS, REQUIRED_SLOTS, isPath, type Lang, type PathId, type PhotoSlot, type Reason } from '../core/types';
import { DEFAULT_RETENTION } from '../core/retention';
import * as repo from '../data/repo';
import type { CaseRow } from '../data/repo';
import { photoKey } from '../storage';
import { runAnalysis } from './analysis';
import type { Deps } from './deps';
import { MAX_UPLOAD_BYTES, sanitizeImage } from './images';
import { hmacHex, signToken } from './signing';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public extra?: Record<string, unknown>) {
    super(message ?? code);
  }
}

export interface ReqCtx {
  ip: string;
  ua?: string;
}

const HOUR = 3600_000;

async function dailySaltHash(deps: Deps, value: string): Promise<string> {
  const day = deps.now().toISOString().slice(0, 10);
  return hmacHex(deps.config.signingSecret, `${day}|${value}`);
}

/** Returns false when the caller has exceeded the limit. */
export async function allow(deps: Deps, key: string, max: number, windowSeconds: number): Promise<boolean> {
  return (await repo.hitRateLimit(deps.db, key, windowSeconds)) <= max;
}

async function emit(deps: Deps, c: CaseRow | null, name: string, props: Record<string, unknown> = {}) {
  try {
    await repo.insertEvent(deps.db, { sessionId: c?.session_id ?? null, name, path: c?.path ?? null, lang: c?.lang ?? null, props });
  } catch {
    /* analytics must never break the flow */
  }
}

// ------------------------------------------------------------------ create
const createSchema = z
  .object({
    lang: z.enum(['en', 'hi']),
    path: z.enum(PATHS),
    ageConfirmed: z.literal(true),
    consents: z.object({ privacy: z.literal(true), health: z.literal(true), photos_ai: z.literal(true), evaluation: z.boolean().optional() }).strict(),
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    botToken: z.string().max(600).optional(),
    hp: z.string().max(0).optional(), // honeypot: must stay empty
  })
  .strict();

export async function createCase(deps: Deps, body: unknown, ctx: ReqCtx): Promise<{ token: string }> {
  const settings = await deps.settings();
  if (settings.maintenanceMode) throw new HttpError(503, 'maintenance');
  const p = createSchema.safeParse(body);
  if (!p.success) throw new HttpError(422, 'invalid_request', 'Age confirmation and the three required consents must be ticked.');
  const ipHash = await dailySaltHash(deps, ctx.ip);
  if (!(await allow(deps, `create:${ipHash}`, 12, 3600))) throw new HttpError(429, 'rate_limited');
  if (!(await deps.botcheck.verify(p.data.botToken, ctx.ip))) throw new HttpError(403, 'bot_check_failed');

  const token = generateToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(deps.now().getTime() + settings.retentionUnbookedHours * HOUR);
  const consents = START_REQUIRED.map((key) => ({ key, version: CONSENT_VERSION }));
  if (p.data.consents.evaluation) consents.push({ key: 'evaluation', version: CONSENT_VERSION });

  let row: CaseRow | null = null;
  for (let i = 0; i < 5 && !row; i++) {
    try {
      row = await deps.db.tx((tx) =>
        repo.createCase(tx, {
          code: generateCaseCode(), tokenHash, lang: p.data.lang, path: p.data.path, sessionId: p.data.sessionId ?? null, ipHash,
          deviceHash: ctx.ua ? await_hash(ctx.ua) : null, expiresAt, evalConsent: Boolean(p.data.consents.evaluation), consents,
        }),
      );
    } catch (e) {
      if (!/duplicate key|unique/i.test(String((e as Error).message))) throw e;
    }
  }
  if (!row) throw new HttpError(500, 'code_collision');
  await emit(deps, row, 'consent_completed');
  return { token };
}
const await_hash = (s: string) => s.slice(0, 0) || null; // user agents are not stored

// ------------------------------------------------------------------ resolve
export type Scope = 'full' | 'capture';

export async function resolveCase(deps: Deps, headers: { caseToken?: string; captureToken?: string }): Promise<{ c: CaseRow; scope: Scope }> {
  if (headers.caseToken) {
    if (!isToken(headers.caseToken)) throw new HttpError(404, 'not_found');
    const c = await repo.getCaseByTokenHash(deps.db, await sha256Hex(headers.caseToken));
    if (!c) throw new HttpError(404, 'not_found');
    return { c, scope: 'full' };
  }
  if (headers.captureToken) {
    if (!isToken(headers.captureToken)) throw new HttpError(404, 'not_found');
    const s = await repo.getCaptureSession(deps.db, await sha256Hex(headers.captureToken));
    if (!s) throw new HttpError(404, 'not_found');
    const c = await repo.getCaseById(deps.db, s.case_id);
    if (!c) throw new HttpError(404, 'not_found');
    return { c, scope: 'capture' };
  }
  throw new HttpError(404, 'not_found');
}

// ------------------------------------------------------------------ state
export interface VisitorState {
  code: string;
  lang: Lang;
  path: PathId;
  pendingPath: PathId | null;
  stage: string;
  expiresAt: string | null;
  consents: ConsentKey[];
  needsQuestions: string[];
  hasAnswers: boolean;
  photos: { slot: PhotoSlot; status: 'pending' | 'stored' }[];
  analysis: { status: 'none' | 'queued' | 'running' | 'done' | 'failed'; errorCode: string | null };
  retake: { issues: Reason[] } | null;
  safety: { stopped: boolean; source: 'answers' | 'image' | 'both' | null };
  snapshot: SnapshotVM | null;
  booking: null | {
    status: string;
    firstName: string;
    day: string;
    window: string;
    method: string;
    whatsappUrl: string | null;
    whatsappNumber: string | null;
    message: string;
  };
  contactWithdrawn: boolean;
  /** The visitor's own budget answer, used to word the routine note. */
  budget: string | null;
  settings: { servicePromise: string; unbookedHours: number; closedDays: number; sampleRoutines: boolean; testBanner: boolean };
}

export async function getVisitorState(deps: Deps, c: CaseRow, lang?: Lang): Promise<VisitorState> {
  const [consents, photos, analysis, booking, settings] = await Promise.all([
    repo.activeConsents(deps.db, c.id),
    repo.listPhotos(deps.db, c.id),
    repo.latestAnalysis(deps.db, c.id),
    repo.getBooking(deps.db, c.id),
    deps.settings(),
  ]);
  const target = c.pending_path ?? c.path;
  const hasAnswers = c.answers_at !== null && !c.health_withdrawn;
  const needsQuestions = c.pending_path ? missingQuestions(c.pending_path, c.answers).map((q) => q.id) : [];

  let snapshot: SnapshotVM | null = null;
  let retake: VisitorState['retake'] = null;
  const stopped = c.safety_stopped;
  if (stopped) {
    // INVARIANT: a stopped case never receives observations, a routine or a booking prompt.
    snapshot = stoppedSnapshot(c.path, { stopped: true, flags: c.safety_flags, restrictions: c.restrictions });
  } else if (analysis?.status === 'done' && analysis.result && c.stage === 'snapshot_ready' && analysis.path === c.path) {
    const r = analysis.result as { observations: ReturnType<typeof normaliseObservations>; bestFit: { path: PathId; confidence: 'clear' | 'likely' | 'not_sure' }; quality: AiResult['image_quality'] };
    const templates = c.path === 'maintenance' ? await repo.listTemplates(deps.db) : [];
    snapshot = composeSnapshot({
      path: c.path, answers: c.answers, safety: combineSafety(evaluateGateA(c.path, c.answers)), observations: r.observations,
      bestFit: r.bestFit, quality: r.quality.overall, templates, allowSampleRoutines: settings.allowSampleRoutines,
    });
    if (snapshot.routine) await emit(deps, c, 'routine_shown');
  } else if (c.stage === 'needs_retake' && analysis?.result) {
    retake = { issues: ((analysis.result as { quality?: { issues?: Reason[] } }).quality?.issues ?? []) as Reason[] };
  }

  let bookingOut: VisitorState['booking'] = null;
  if (booking) {
    const l = lang ?? c.lang;
    const message = buildWhatsappMessage(l, booking.first_name, c.code);
    const number = settings.whatsappNumber;
    bookingOut = {
      status: booking.status, firstName: booking.first_name, day: booking.preferred_day, window: booking.time_window, method: booking.method,
      message, whatsappNumber: number, whatsappUrl: number ? whatsappLink(number, message) : null,
    };
  }

  return {
    code: c.code, lang: c.lang, path: c.path, pendingPath: c.pending_path, stage: c.stage,
    expiresAt: c.expires_at ? c.expires_at.toISOString() : null,
    consents: consents.map((x) => x.key), needsQuestions, hasAnswers,
    photos: photos.map((p) => ({ slot: p.slot, status: p.status })),
    analysis: { status: analysis?.status ?? 'none', errorCode: analysis?.error_code ?? null },
    retake,
    safety: { stopped, source: snapshot?.safetySource ?? null },
    snapshot, booking: bookingOut, contactWithdrawn: c.contact_withdrawn_at !== null,
    budget: typeof c.answers.budget === 'string' ? c.answers.budget : null,
    settings: { servicePromise: settings.servicePromise, unbookedHours: settings.retentionUnbookedHours, closedDays: settings.retentionClosedDays, sampleRoutines: settings.allowSampleRoutines, testBanner: deps.config.testBanner },
  };
  void target;
}

// ------------------------------------------------------------------ answers
export async function saveAnswers(deps: Deps, c: CaseRow, body: unknown): Promise<{ stopped: boolean }> {
  if (c.safety_stopped) throw new HttpError(409, 'safety_stopped');
  const consents = (await repo.activeConsents(deps.db, c.id)).map((x) => x.key);
  if (!consents.includes('privacy') || !consents.includes('health')) throw new HttpError(403, 'consent_required');
  const given = z.object({ answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }).safeParse(body);
  if (!given.success) throw new HttpError(422, 'invalid_request');

  const target = c.pending_path ?? c.path;
  const ids = new Set(questionsFor(target).map((q) => q.id));
  const merged: Answers = {};
  for (const [k, v] of Object.entries(c.answers)) if (ids.has(k)) merged[k] = v;
  for (const [k, v] of Object.entries(given.data.answers)) {
    if (!ids.has(k)) throw new HttpError(422, 'invalid_answers', `Unknown question: ${k}`);
    merged[k] = v;
  }
  const parsed = answersSchema(target).safeParse(merged);
  if (!parsed.success) throw new HttpError(422, 'invalid_answers', 'Some answers are missing or not valid.', { fields: parsed.error.issues.map((i) => String(i.path[0])) });

  const gate = evaluateGateA(target, merged);
  const photos = await repo.listPhotos(deps.db, c.id);
  const allPhotos = REQUIRED_SLOTS.every((s) => photos.some((p) => p.slot === s && p.status === 'stored'));
  await repo.updateCase(deps.db, c.id, {
    path: target, pending_path: null, answers: merged, answers_at: deps.now(), health_withdrawn: false,
    safety_flags: gate.flags, restrictions: gate.restrictions, safety_stopped: gate.stop, gate_a_version: gate.rulesetVersion,
    stage: gate.stop ? 'safety_stopped' : allPhotos ? 'photos_ready' : 'answers_done',
  });
  const after = { ...c, path: target };
  await emit(deps, after, 'questionnaire_completed');
  if (gate.stop) await emit(deps, after, 'safety_stop', { source: 'answers' });
  return { stopped: gate.stop };
}

export async function switchPath(deps: Deps, c: CaseRow, path: unknown): Promise<{ needsQuestions: string[] }> {
  if (c.safety_stopped) throw new HttpError(409, 'safety_stopped');
  if (!isPath(path) || path === c.path) throw new HttpError(422, 'invalid_request');
  await repo.updateCase(deps.db, c.id, { pending_path: path, stage: 'needs_path_questions' });
  return { needsQuestions: missingQuestions(path, c.answers).map((q) => q.id) };
}

// ------------------------------------------------------------------ photos
const photoInit = z
  .object({
    slot: z.enum(PHOTO_SLOTS),
    contentType: z.literal('image/jpeg'),
    size: z.number().int().min(1000).max(MAX_UPLOAD_BYTES),
    width: z.number().int().min(100).max(8000).optional(),
    height: z.number().int().min(100).max(8000).optional(),
    checks: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();

export async function initPhoto(deps: Deps, c: CaseRow, body: unknown): Promise<{ photoId: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }> {
  if (c.safety_stopped) throw new HttpError(409, 'safety_stopped');
  if (c.answers_at === null) throw new HttpError(409, 'answers_first');
  const consents = (await repo.activeConsents(deps.db, c.id)).map((x) => x.key);
  if (!consents.includes('photos_ai')) throw new HttpError(403, 'consent_required');
  const p = photoInit.safeParse(body);
  if (!p.success) throw new HttpError(422, 'invalid_request');
  if (!(await allow(deps, `photo:${c.id}`, 40, 3600))) throw new HttpError(429, 'rate_limited');

  const { photo } = await repo.upsertPhotoSlot(deps.db, c.id, p.data.slot, { contentType: 'image/jpeg', width: p.data.width ?? null, height: p.data.height ?? null, clientChecks: p.data.checks ?? null });
  await drainStorageDeletions(deps);
  const ttl = 300;
  const rawKey = `cases/${c.id}/${photo.id}.upload`;
  const presigned = await deps.store.presignUpload(rawKey, 'image/jpeg', ttl);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const uploadUrl = presigned ?? `/api/uploads/${photo.id}?t=${encodeURIComponent(await signToken(deps.config.signingSecret, { a: 'upload', id: photo.id, exp, max: MAX_UPLOAD_BYTES }))}`;
  return { photoId: photo.id, uploadUrl, method: 'PUT', headers: { 'content-type': 'image/jpeg' }, expiresAt: new Date(exp * 1000).toISOString() };
}

/** PUT target used by the database-backed store. Validates the signed token's size limit. */
export async function receiveUpload(deps: Deps, photoId: string, bytes: Uint8Array, max: number): Promise<void> {
  if (bytes.byteLength < 1000 || bytes.byteLength > Math.min(max, MAX_UPLOAD_BYTES)) throw new HttpError(413, 'bad_size');
  const photo = await repo.getPhoto(deps.db, photoId);
  if (!photo || photo.status !== 'pending') throw new HttpError(404, 'not_found');
  await deps.store.put(`cases/${photo.case_id}/${photo.id}.upload`, bytes, 'image/jpeg');
}

export async function completePhoto(deps: Deps, c: CaseRow, photoId: string): Promise<{ ok: true; allRequired: boolean } | { ok: false; reason: string }> {
  const photo = await repo.getPhoto(deps.db, photoId);
  if (!photo || photo.case_id !== c.id) throw new HttpError(404, 'not_found');
  const rawKey = `cases/${c.id}/${photo.id}.upload`;
  const obj = await deps.store.get(rawKey);
  if (!obj) throw new HttpError(409, 'upload_missing');
  const res = await sanitizeImage(obj.bytes);
  await deps.store.delete(rawKey);
  if (!res.ok) {
    await repo.deletePhotosOfCaseSlot(deps.db, photo.id);
    return { ok: false, reason: res.reason };
  }
  const key = photoKey(c.id, photo.id);
  await deps.store.put(key, res.bytes, 'image/jpeg');
  await repo.markPhotoStored(deps.db, photo.id, { key, size: res.bytes.byteLength, width: res.width, height: res.height, serverChecks: res.checks });
  const photos = await repo.listPhotos(deps.db, c.id);
  const all = REQUIRED_SLOTS.every((s) => photos.some((p) => p.slot === s && p.status === 'stored'));
  if (all && c.stage !== 'photos_ready') {
    await repo.updateCase(deps.db, c.id, { stage: 'photos_ready' });
    await emit(deps, c, 'photos_completed');
  }
  return { ok: true, allRequired: all };
}

export async function drainStorageDeletions(deps: Deps): Promise<number> {
  const pending = await repo.pendingStorageDeletions(deps.db);
  let n = 0;
  for (const { key } of pending) {
    try {
      await deps.store.delete(key);
      await repo.clearStorageDeletion(deps.db, key);
      n++;
    } catch {
      /* retried by the next purge */
    }
  }
  return n;
}

// ------------------------------------------------------------------ retake
/** Clears the photos and analysis so the visitor can capture again. Answers and consents are kept. */
export async function retakePhotos(deps: Deps, c: CaseRow): Promise<void> {
  if (c.safety_stopped) throw new HttpError(409, 'safety_stopped');
  await deps.db.query(`delete from ss.analyses where case_id=$1`, [c.id]);
  await repo.deletePhotosOfCase(deps.db, c.id);
  await drainStorageDeletions(deps);
  await repo.updateCase(deps.db, c.id, { stage: c.answers_at ? 'answers_done' : 'consented' });
}

// ------------------------------------------------------------------ analysis
export async function startAnalysis(deps: Deps, c: CaseRow): Promise<{ started: boolean }> {
  if (c.safety_stopped) throw new HttpError(409, 'safety_stopped');
  if (c.answers_at === null) throw new HttpError(409, 'answers_first');
  const consents = (await repo.activeConsents(deps.db, c.id)).map((x) => x.key);
  if (!consents.includes('photos_ai') || !consents.includes('health')) throw new HttpError(403, 'consent_required');
  const photos = await repo.listPhotos(deps.db, c.id);
  if (!REQUIRED_SLOTS.every((s) => photos.some((p) => p.slot === s && p.status === 'stored'))) throw new HttpError(409, 'photos_missing');
  if (!(await allow(deps, `analyze:${c.id}`, 6, 3600))) throw new HttpError(429, 'rate_limited');
  const latest = await repo.latestAnalysis(deps.db, c.id);
  if (latest && latest.status === 'running' && latest.lock_until && latest.lock_until > deps.now()) return { started: false };
  if (c.stage === 'snapshot_ready' && latest?.status === 'done' && latest.path === c.path) return { started: false };
  await emit(deps, c, 'analysis_started');
  await runAnalysis(deps, c);
  return { started: true };
}

// ------------------------------------------------------------------ booking
export async function book(deps: Deps, c: CaseRow, body: unknown, ctx: ReqCtx, lang?: Lang): Promise<void> {
  if (c.safety_stopped) throw new HttpError(409, 'safety_stopped');
  if (c.stage !== 'snapshot_ready') throw new HttpError(409, 'snapshot_first');
  if (await repo.getBooking(deps.db, c.id)) return; // idempotent
  const raw = z.object({ botToken: z.string().max(600).optional(), hp: z.string().max(0).optional(), lang: z.enum(['en', 'hi']).optional() }).passthrough().parse(body);
  const { botToken, hp, lang: _l, ...rest } = raw as Record<string, unknown>;
  void hp; void _l;
  const p = bookingSchema.safeParse(rest);
  if (!p.success) throw new HttpError(422, 'invalid_booking', 'Please check the booking details.', { fields: p.error.issues.map((i) => String(i.path[0])) });
  const e164 = normaliseWhatsapp(p.data.whatsapp, 'IN');
  if (!e164) throw new HttpError(422, 'invalid_booking', 'Please enter a valid WhatsApp number with country code.', { fields: ['whatsapp'] });
  if (!bookableDays(deps.now()).includes(p.data.day)) throw new HttpError(422, 'invalid_booking', 'Please pick a day within the next seven days.', { fields: ['day'] });

  const ipHash = await dailySaltHash(deps, ctx.ip);
  const numHash = await hmacHex(deps.config.signingSecret, `num|${e164}`);
  if (!(await deps.botcheck.verify(botToken as string | undefined, ctx.ip))) throw new HttpError(403, 'bot_check_failed');
  if (!(await allow(deps, `book-ip:${ipHash}`, 10, 86400)) || !(await allow(deps, `book-num:${numHash}`, 5, 86400))) throw new HttpError(429, 'rate_limited');
  if (await repo.isNumberBlocked(deps.db, numHash)) throw new HttpError(429, 'rate_limited');

  await deps.db.tx(async (tx) => {
    await repo.grantConsent(tx, c.id, 'whatsapp', CONSENT_VERSION, lang ?? c.lang);
    await repo.createBooking(tx, { caseId: c.id, name: p.data.name, firstName: firstNameOf(p.data.name), e164, hash: numHash, day: p.data.day, window: p.data.window, method: p.data.method, note: p.data.note });
    await repo.updateCase(tx, c.id, { booked_at: deps.now(), expires_at: null, contact_withdrawn_at: null });
  });
  await emit(deps, c, 'booking_requested');
}

// ------------------------------------------------------------------ withdrawal and deletion
export async function deleteCaseFully(deps: Deps, c: { id: string; code: string }, reason: 'visitor_request' | 'consent_withdrawn' | 'retention_expired' | 'staff_request'): Promise<void> {
  await deps.db.tx((tx) => repo.deleteCase(tx, c, reason));
  await drainStorageDeletions(deps);
}

export async function withdrawConsent(deps: Deps, c: CaseRow, key: ConsentKey): Promise<{ deleted: boolean }> {
  if (!(key in WITHDRAWAL_EFFECTS)) throw new HttpError(404, 'not_found');
  await repo.withdrawConsentRow(deps.db, c.id, key);
  const effect = WITHDRAWAL_EFFECTS[key];
  await emit(deps, c, 'consent_withdrawn', { key });
  switch (effect) {
    case 'delete_case':
      await deleteCaseFully(deps, c, 'consent_withdrawn');
      return { deleted: true };
    case 'delete_answers_and_analysis':
      await deps.db.query(`delete from ss.analyses where case_id=$1`, [c.id]);
      await repo.updateCase(deps.db, c.id, { answers: {}, answers_at: null, health_withdrawn: true, stage: 'consented', safety_flags: [], restrictions: [], safety_stopped: false });
      return { deleted: false };
    case 'delete_photos_and_analysis':
      await deps.db.query(`delete from ss.analyses where case_id=$1`, [c.id]);
      await repo.deletePhotosOfCase(deps.db, c.id);
      await drainStorageDeletions(deps);
      await repo.updateCase(deps.db, c.id, { stage: c.answers_at ? 'answers_done' : 'consented' });
      return { deleted: false };
    case 'stop_contact':
      await repo.updateCase(deps.db, c.id, { contact_withdrawn_at: deps.now() });
      return { deleted: false };
    case 'stop_evaluation_use':
      await repo.updateCase(deps.db, c.id, { eval_consent: false });
      return { deleted: false };
  }
}

// ------------------------------------------------------------------ phone continuation
export async function createCaptureSession(deps: Deps, c: CaseRow): Promise<{ token: string; expiresAt: string }> {
  if (c.safety_stopped || c.answers_at === null) throw new HttpError(409, 'answers_first');
  if (!(await allow(deps, `capture:${c.id}`, 10, 3600))) throw new HttpError(429, 'rate_limited');
  const token = generateToken();
  const expiresAt = new Date(deps.now().getTime() + DEFAULT_RETENTION.captureSessionMinutes * 60_000);
  await repo.createCaptureSession(deps.db, c.id, await sha256Hex(token), expiresAt);
  return { token, expiresAt: expiresAt.toISOString() };
}

// ------------------------------------------------------------------ analytics
const EVENT_NAMES = ['page_view', 'path_selected', 'assessment_started', 'camera_started', 'booking_started', 'whatsapp_opened', 'snapshot_viewed', 'upload_fallback_used', 'camera_blocked', 'inapp_browser_detected', 'retake'] as const;
const eventSchema = z
  .object({
    name: z.enum(EVENT_NAMES),
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    path: z.enum(PATHS).optional(),
    lang: z.enum(['en', 'hi']).optional(),
    ms: z.number().int().min(0).max(3_600_000).optional(),
    reason: z.enum(['denied', 'no_camera', 'in_app', 'load_failed', 'blur', 'light', 'angle', 'other']).optional(),
    device: z.enum(['mobile', 'desktop']).optional(),
  })
  .strict();

export async function recordEvent(deps: Deps, body: unknown, ctx: ReqCtx): Promise<void> {
  const p = eventSchema.safeParse(body);
  if (!p.success) throw new HttpError(422, 'invalid_request');
  const ipHash = await dailySaltHash(deps, ctx.ip);
  if (!(await allow(deps, `event:${ipHash}`, 240, 3600))) throw new HttpError(429, 'rate_limited');
  await repo.insertEvent(deps.db, { sessionId: p.data.sessionId, name: p.data.name, path: p.data.path ?? null, lang: p.data.lang ?? null, props: { ms: p.data.ms, reason: p.data.reason, device: p.data.device } });
}

void aiResultSchema;
