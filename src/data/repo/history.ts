import Dexie from 'dexie';
import type { Exercise, ISODate, SessionStatus, SetRecord, WorkoutSession } from '@/domain/types';
import { MUSCLES, type MuscleGroup } from '@/domain/muscles';
import { type AnalyticsCtx, type AnalyticsSet, type ExerciseLite, type SessionLite, DEFAULT_OPTS, periodStats } from '@/domain/analytics';
import { detectPrs, type PrEvent } from '@/domain/records';
import { assessProgress, perfBySession, type ProgressAssessment, type SessionPerf } from '@/domain/progression';
import { e1rmForSet } from '@/domain/e1rm';
import { addDays } from '@/domain/periods';
import { tbl } from '../db';
import { getProfile, effectiveSettings } from './profile';
import { bodyweightKgOn } from './misc';
import { sessionExercises } from './sessions';

const clean = <T extends { _dirty: 0 | 1 }>(r: T): Omit<T, '_dirty'> => { const { _dirty: _d, ...rest } = r; void _d; return rest; };

export interface HistoryFilter {
  from?: ISODate; to?: ISODate; status?: SessionStatus[]; programId?: string; exerciseId?: string; group?: MuscleGroup; tag?: string; q?: string; bookmarked?: boolean; includeCancelled?: boolean;
}

/** Newest first, paginated (offset/limit) so a long history is never loaded into memory in one go. */
export async function listSessions(f: HistoryFilter = {}, limit = 30, offset = 0): Promise<WorkoutSession[]> {
  let allowedIds: Set<string> | null = null;
  if (f.exerciseId || f.group) {
    const exIds = new Set<string>();
    if (f.exerciseId) exIds.add(f.exerciseId);
    if (f.group) for (const e of await tbl('exercises').toArray()) if ([...e.primary_muscles, ...e.secondary_muscles].some((m) => MUSCLES[m]?.group === f.group)) exIds.add(e.id);
    const ses = await tbl('session_exercises').where('exercise_id').anyOf([...exIds]).toArray();
    allowedIds = new Set(ses.filter((s) => !s.deleted_at && s.status !== 'skipped').map((s) => s.session_id));
  }
  let textIds: Set<string> | null = null;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    textIds = new Set();
    for (const s of await tbl('set_records').filter((x) => !x.deleted_at && !!x.note && x.note.toLowerCase().includes(q)).toArray()) textIds.add(s.session_id);
    for (const s of await tbl('session_exercises').filter((x) => !x.deleted_at && !!x.notes && x.notes.toLowerCase().includes(q)).toArray()) textIds.add(s.session_id);
    const exMatch = new Set((await tbl('exercises').toArray()).filter((e) => e.name.toLowerCase().includes(q)).map((e) => e.id));
    if (exMatch.size) for (const s of await tbl('session_exercises').where('exercise_id').anyOf([...exMatch]).toArray()) if (!s.deleted_at) textIds.add(s.session_id);
  }
  const rows = await tbl('workout_sessions')
    .orderBy('session_date').reverse()
    .filter((s) => {
      if (s.deleted_at) return false;
      if (!f.includeCancelled && s.status === 'cancelled') return false;
      if (f.from && s.session_date < f.from) return false;
      if (f.to && s.session_date > f.to) return false;
      if (f.status && !f.status.includes(s.status)) return false;
      if (f.programId && s.program_id !== f.programId) return false;
      if (f.tag && !s.tags.includes(f.tag)) return false;
      if (f.bookmarked && !s.is_bookmarked) return false;
      if (allowedIds && !allowedIds.has(s.id)) return false;
      if (q) {
        const own = s.name.toLowerCase().includes(q) || (s.notes ?? '').toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q));
        if (!own && !textIds?.has(s.id)) return false;
      }
      return true;
    })
    .offset(offset).limit(limit).toArray();
  return rows.map((r) => clean(r) as WorkoutSession);
}

export async function listAllTags(): Promise<string[]> {
  const tags = new Set<string>();
  for (const s of await tbl('workout_sessions').toArray()) if (!s.deleted_at) for (const t of s.tags) tags.add(t);
  return [...tags].sort();
}

export async function sessionsInRange(from: ISODate, to: ISODate): Promise<WorkoutSession[]> {
  return (await tbl('workout_sessions').where('session_date').between(from, to, true, true).toArray()).filter((s) => !s.deleted_at).map((r) => clean(r) as WorkoutSession);
}

export async function earliestSessionDate(): Promise<ISODate | null> {
  const first = await tbl('workout_sessions').orderBy('session_date').filter((s) => !s.deleted_at && !['skipped', 'cancelled', 'rescheduled', 'planned'].includes(s.status)).first();
  return first?.session_date ?? null;
}

const lite = (e: Exercise): ExerciseLite => ({ id: e.id, name: e.name, tracking_method: e.tracking_method, load_mode: e.load_mode, bodyweight_fraction: e.bodyweight_fraction, primary_muscles: e.primary_muscles, secondary_muscles: e.secondary_muscles, laterality: e.laterality });
const liteSession = (s: WorkoutSession): SessionLite => ({ id: s.id, session_date: s.session_date, status: s.status, tags: s.tags, program_id: s.program_id, template_key: s.template_key, started_at: s.started_at, finished_at: s.finished_at, paused_total_s: s.paused_total_s, session_rpe: s.session_rpe, scheduled_date: s.scheduled_date });

export interface AnalyticsData { ctx: AnalyticsCtx; sets: AnalyticsSet[]; sessions: SessionLite[]; exercises: Map<string, Exercise> }

export async function analyticsOptions(today: ISODate) {
  const profile = await getProfile();
  const s = effectiveSettings(profile);
  return { ...DEFAULT_OPTS, weekStart: profile?.week_start ?? 1, doublePerHand: s.double_per_hand, unratedCountsAsHard: s.unrated_counts_as_hard, secondaryWeight: s.secondary_muscle_weight, bodyweightKg: await bodyweightKgOn(today), formula: s.e1rm_formula };
}

/** Loads exactly the sets in a date range (indexed), plus their sessions and the exercise dictionary. */
export async function loadAnalytics(from: ISODate, to: ISODate, today: ISODate): Promise<AnalyticsData> {
  const sets = (await tbl('set_records').where('session_date').between(from, to, true, true).toArray()).filter((s) => !s.deleted_at).map(clean) as SetRecord[];
  const sessions = (await sessionsInRange(from, to)).filter((s) => !s.deleted_at);
  const exercises = new Map((await tbl('exercises').toArray()).map((e) => [e.id, clean(e) as Exercise]));
  const opts = await analyticsOptions(today);
  const ctx: AnalyticsCtx = { exercises: new Map([...exercises].map(([id, e]) => [id, lite(e)])), sessions: new Map(sessions.map((s) => [s.id, liteSession(s)])), opts };
  return { ctx, sets, sessions: sessions.map(liteSession), exercises };
}

export async function exerciseSets(exerciseId: string): Promise<SetRecord[]> {
  return (await tbl('set_records').where('[exercise_id+session_date]').between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey]).toArray()).filter((s) => !s.deleted_at).map(clean) as SetRecord[];
}

export interface ExerciseInsight {
  exercise: Exercise;
  prs: PrEvent[];
  perfs: SessionPerf[];
  assessment: ProgressAssessment;
  bestE1rm: number | null;
}

export async function exerciseInsight(exerciseId: string, today: ISODate): Promise<ExerciseInsight | null> {
  const ex = await tbl('exercises').get(exerciseId);
  if (!ex) return null;
  const sets = await exerciseSets(exerciseId);
  const sessionIds = [...new Set(sets.map((s) => s.session_id))];
  const sessions = new Map((await tbl('workout_sessions').bulkGet(sessionIds)).filter((s): s is NonNullable<typeof s> => !!s && !s.deleted_at).map((s) => [s.id, s as WorkoutSession]));
  const performed = sets.filter((s) => sessions.has(s.session_id) && ['completed_as_planned', 'completed_modified', 'partial', 'in_progress'].includes((sessions.get(s.session_id) as WorkoutSession).status));
  const opts = await analyticsOptions(today);
  const exercise = clean(ex) as Exercise;
  const prs = detectPrs(performed, exercise, { formula: opts.formula, doublePerHand: opts.doublePerHand, bodyweightKg: opts.bodyweightKg });
  const perfs = perfBySession(performed, sessions, exercise, { formula: opts.formula, doublePerHand: opts.doublePerHand, bodyweightKg: opts.bodyweightKg });
  const assessment = assessProgress(perfs, today);
  const best = performed.map((s) => e1rmForSet(s, exercise, { formula: opts.formula })?.value ?? null).filter((v): v is number => v !== null);
  return { exercise, prs, perfs, assessment, bestE1rm: best.length ? Math.max(...best) : null };
}

/** All exercises that have any performed history in the last `days` days (for the dashboard picker). */
export async function recentExerciseIds(today: ISODate, days = 120): Promise<string[]> {
  const sets = await tbl('set_records').where('session_date').between(addDays(today, -days), today, true, true).toArray();
  return [...new Set(sets.filter((s) => !s.deleted_at && s.status === 'completed').map((s) => s.exercise_id))];
}

export interface ExerciseComparison { exercise_id: string; name: string; a: ReturnType<typeof periodStats> | null; b: ReturnType<typeof periodStats> | null; aTopE1rm: number | null; bTopE1rm: number | null }

export async function compareSessions(aId: string, bId: string): Promise<ExerciseComparison[]> {
  const [va, vb] = await Promise.all([sessionExercises(aId), sessionExercises(bId)]);
  const profile = await getProfile();
  const today = (await tbl('workout_sessions').get(aId))?.session_date ?? '2026-01-01';
  const opts = await analyticsOptions(today);
  const rows = new Map<string, ExerciseComparison>();
  const mk = (sid: string, views: typeof va, side: 'a' | 'b'): void => {
    const sessionLite: SessionLite = { id: sid, session_date: today, status: 'completed_as_planned', tags: [], program_id: null, template_key: null, started_at: null, finished_at: null, paused_total_s: 0, session_rpe: null, scheduled_date: null };
    for (const v of views) {
      const exLite = lite(v.exercise);
      const ctx: AnalyticsCtx = { exercises: new Map([[v.exercise.id, exLite]]), sessions: new Map([[sid, sessionLite]]), opts };
      const sets = v.sets.map((s) => s as AnalyticsSet);
      const stats = periodStats(sets, ctx);
      const e = Math.max(0, ...v.sets.map((s) => e1rmForSet(s, v.exercise, { formula: opts.formula })?.value ?? 0));
      const cur = rows.get(v.exercise.id) ?? { exercise_id: v.exercise.id, name: v.exercise.name, a: null, b: null, aTopE1rm: null, bTopE1rm: null };
      if (side === 'a') { cur.a = stats; cur.aTopE1rm = e || null; } else { cur.b = stats; cur.bTopE1rm = e || null; }
      rows.set(v.exercise.id, cur);
    }
  };
  mk(aId, va, 'a');
  mk(bId, vb, 'b');
  void profile;
  return [...rows.values()];
}

export interface SessionSummary { id: string; workingSets: number; reps: number; volumeKg: number; unknownVolumeSets: number; exercises: number; prs: number }

/** Totals for a page of sessions (one indexed read per page, not per session). */
export async function sessionSummaries(ids: string[], today: ISODate): Promise<Map<string, SessionSummary>> {
  const out = new Map<string, SessionSummary>();
  if (!ids.length) return out;
  const sets = (await tbl('set_records').where('session_id').anyOf(ids).toArray()).filter((s) => !s.deleted_at).map(clean) as SetRecord[];
  const sessions = (await tbl('workout_sessions').bulkGet(ids)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => liteSession(clean(s) as WorkoutSession));
  const exercises = new Map((await tbl('exercises').toArray()).map((e) => [e.id, lite(clean(e) as Exercise)]));
  const opts = await analyticsOptions(today);
  for (const sess of sessions) {
    const ctx: AnalyticsCtx = { exercises, sessions: new Map([[sess.id, { ...sess, status: sess.status === 'planned' ? 'completed_as_planned' : sess.status }]]), opts };
    const mine = sets.filter((s) => s.session_id === sess.id);
    const st = periodStats(mine, ctx);
    out.set(sess.id, { id: sess.id, workingSets: st.workingSets, reps: st.reps, volumeKg: st.volumeKg, unknownVolumeSets: st.unknownVolumeSets, exercises: new Set(mine.filter((s) => s.status === 'completed').map((s) => s.exercise_id)).size, prs: 0 });
  }
  return out;
}

export async function auditForSession(sessionId: string): Promise<import('@/domain/types').AuditEvent[]> {
  const setIds = new Set((await tbl('set_records').where('session_id').equals(sessionId).toArray()).map((s) => s.id));
  const seIds = new Set((await tbl('session_exercises').where('session_id').equals(sessionId).toArray()).map((s) => s.id));
  const all = await tbl('audit_events').toArray();
  return all.filter((a) => !a.deleted_at && (a.entity_id === sessionId || setIds.has(a.entity_id) || seIds.has(a.entity_id))).map((a) => clean(a) as import('@/domain/types').AuditEvent).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
}

export async function listArchivedSessions(): Promise<WorkoutSession[]> {
  return (await tbl('workout_sessions').toArray()).filter((s) => !!s.deleted_at).map((s) => clean(s) as WorkoutSession).sort((a, b) => (a.session_date < b.session_date ? 1 : -1));
}
