import type { Exercise, ISODate, SetRecord, WorkoutSession } from './types';
import { addDays, eachWeekStart, mean, monthKey, stdev, weekStartOf } from './periods';
import { emptyTotals, addSetToTotals, isCompleted, isWarmup, setVolumeKg, type ExLike, type Totals, type VolumeOptions } from './volume';
import { GROUP_ORDER, muscleCredits, type MuscleGroup } from './muscles';
import { PERFORMED } from './sessionState';

export type ExerciseLite = Pick<Exercise, 'id' | 'name' | 'tracking_method' | 'load_mode' | 'bodyweight_fraction' | 'primary_muscles' | 'secondary_muscles' | 'laterality'>;
export type SessionLite = Pick<WorkoutSession, 'id' | 'session_date' | 'status' | 'tags' | 'program_id' | 'template_key' | 'started_at' | 'finished_at' | 'paused_total_s' | 'session_rpe' | 'scheduled_date'>;
export type AnalyticsSet = Pick<
  SetRecord,
  | 'id' | 'session_id' | 'session_exercise_id' | 'exercise_id' | 'session_date' | 'set_number' | 'set_type' | 'parent_set_id' | 'status' | 'weight_kg' | 'reps'
  | 'reps_partial' | 'duration_s' | 'distance_m' | 'assist_kg' | 'bodyweight_kg' | 'rir' | 'rpe' | 'failure' | 'rom' | 'completed_at' | 'created_at'
  | 'planned_weight_kg' | 'planned_reps_min' | 'planned_reps_max'
> & { deleted_at?: string | null };

export interface AnalyticsCtx {
  exercises: Map<string, ExerciseLite>;
  sessions: Map<string, SessionLite>;
  opts: VolumeOptions & { weekStart: number; muscleMode: 'direct' | 'weighted'; secondaryWeight: number };
}

export const DEFAULT_OPTS: AnalyticsCtx['opts'] = { weekStart: 1, muscleMode: 'direct', secondaryWeight: 0.5, doublePerHand: false, unratedCountsAsHard: true };

/** Only sets in sessions that were actually performed count; skipped / cancelled / rescheduled sessions are ABSENT, not zero. */
export function performedSets(sets: AnalyticsSet[], ctx: AnalyticsCtx): AnalyticsSet[] {
  return sets.filter((s) => {
    if (s.deleted_at) return false;
    const sess = ctx.sessions.get(s.session_id);
    return !!sess && PERFORMED.has(sess.status);
  });
}

export function inPeriod(sets: AnalyticsSet[], from: ISODate, to: ISODate): AnalyticsSet[] {
  return sets.filter((s) => s.session_date >= from && s.session_date <= to);
}

export interface PeriodStats extends Totals { sessions: number; trained: boolean }

export function periodStats(sets: AnalyticsSet[], ctx: AnalyticsCtx): PeriodStats {
  const t = emptyTotals();
  const sessionIds = new Set<string>();
  for (const s of performedSets(sets, ctx)) {
    const ex = ctx.exercises.get(s.exercise_id);
    if (!ex) continue;
    addSetToTotals(t, s, ex as ExLike, ctx.opts);
    if (isCompleted(s)) sessionIds.add(s.session_id);
  }
  return { ...t, sessions: sessionIds.size, trained: sessionIds.size > 0 };
}

export interface WeekPoint extends PeriodStats { weekStart: ISODate }

export function weeklySeries(sets: AnalyticsSet[], ctx: AnalyticsCtx, from: ISODate, to: ISODate): WeekPoint[] {
  const by = new Map<ISODate, AnalyticsSet[]>();
  for (const s of performedSets(inPeriod(sets, from, to), ctx)) {
    const w = weekStartOf(s.session_date, ctx.opts.weekStart);
    const arr = by.get(w) ?? [];
    arr.push(s);
    by.set(w, arr);
  }
  return eachWeekStart(from, to, ctx.opts.weekStart).map((w) => ({ weekStart: w, ...periodStats(by.get(w) ?? [], ctx) }));
}

export interface MonthPoint extends PeriodStats { month: string }

export function monthlySeries(sets: AnalyticsSet[], ctx: AnalyticsCtx, from: ISODate, to: ISODate): MonthPoint[] {
  const by = new Map<string, AnalyticsSet[]>();
  for (const s of performedSets(inPeriod(sets, from, to), ctx)) {
    const k = monthKey(s.session_date);
    const arr = by.get(k) ?? [];
    arr.push(s);
    by.set(k, arr);
  }
  const months: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const k = monthKey(d); if (months.at(-1) !== k) months.push(k); }
  return months.map((m) => ({ month: m, ...periodStats(by.get(m) ?? [], ctx) }));
}

export interface ExerciseVolumeRow { exercise_id: string; name: string; workingSets: number; reps: number; volumeKg: number; unknownVolumeSets: number }

export function exerciseVolume(sets: AnalyticsSet[], ctx: AnalyticsCtx): ExerciseVolumeRow[] {
  const by = new Map<string, AnalyticsSet[]>();
  for (const s of performedSets(sets, ctx)) {
    const arr = by.get(s.exercise_id) ?? [];
    arr.push(s);
    by.set(s.exercise_id, arr);
  }
  const rows: ExerciseVolumeRow[] = [];
  for (const [id, arr] of by) {
    const st = periodStats(arr, ctx);
    rows.push({ exercise_id: id, name: ctx.exercises.get(id)?.name ?? 'Unknown exercise', workingSets: st.workingSets, reps: st.reps, volumeKg: st.volumeKg, unknownVolumeSets: st.unknownVolumeSets });
  }
  return rows.sort((a, b) => b.volumeKg - a.volumeKg);
}

export interface MuscleStats { group: MuscleGroup; sets: number; hardSets: number; reps: number; volumeKg: number; sessionDays: number; lastDate: ISODate | null }

/**
 * Per muscle-group exposure. Credit per set: primary = 1; secondary = `secondaryWeight` (weighted mode only).
 * Volume is an ESTIMATE (the set's volume × the muscle's credit) — compound lifts are never counted in full for every muscle.
 */
export function muscleStats(sets: AnalyticsSet[], ctx: AnalyticsCtx, mode: 'direct' | 'weighted' = ctx.opts.muscleMode): MuscleStats[] {
  const acc = new Map<MuscleGroup, { sets: number; hard: number; reps: number; vol: number; days: Set<ISODate>; last: ISODate | null }>();
  for (const s of performedSets(sets, ctx)) {
    if (!isCompleted(s) || isWarmup(s)) continue;
    const ex = ctx.exercises.get(s.exercise_id);
    if (!ex) continue;
    const credits = muscleCredits(ex, mode, ctx.opts.secondaryWeight);
    const isParent = !s.parent_set_id;
    const v = setVolumeKg(s, ex as ExLike, ctx.opts);
    const t = emptyTotals();
    addSetToTotals(t, s, ex as ExLike, ctx.opts);
    for (const c of credits) {
      const a = acc.get(c.group) ?? { sets: 0, hard: 0, reps: 0, vol: 0, days: new Set<ISODate>(), last: null };
      if (isParent) { a.sets += c.weight; a.hard += t.hardSets * c.weight; }
      a.reps += (s.reps ?? 0) * c.weight;
      if (v !== null) a.vol += v * c.weight;
      a.days.add(s.session_date);
      if (!a.last || s.session_date > a.last) a.last = s.session_date;
      acc.set(c.group, a);
    }
  }
  return GROUP_ORDER.filter((g) => acc.has(g)).map((g) => {
    const a = acc.get(g)!;
    return { group: g, sets: a.sets, hardSets: a.hard, reps: a.reps, volumeKg: a.vol, sessionDays: a.days.size, lastDate: a.last };
  });
}

export function muscleWeekly(sets: AnalyticsSet[], ctx: AnalyticsCtx, from: ISODate, to: ISODate, mode: 'direct' | 'weighted' = ctx.opts.muscleMode): Map<MuscleGroup, { weekStart: ISODate; sets: number; reps: number }[]> {
  const out = new Map<MuscleGroup, { weekStart: ISODate; sets: number; reps: number }[]>();
  const weeks = eachWeekStart(from, to, ctx.opts.weekStart);
  const perWeek = new Map<ISODate, MuscleStats[]>();
  for (const w of weeks) perWeek.set(w, muscleStats(inPeriod(sets, w, addDays(w, 6)), ctx, mode));
  for (const g of GROUP_ORDER) {
    const series = weeks.map((w) => {
      const m = perWeek.get(w)!.find((x) => x.group === g);
      return { weekStart: w, sets: m?.sets ?? 0, reps: m?.reps ?? 0 };
    });
    if (series.some((p) => p.sets > 0)) out.set(g, series);
  }
  return out;
}

export function daysSinceMuscle(sets: AnalyticsSet[], ctx: AnalyticsCtx, today: ISODate): Map<MuscleGroup, number> {
  const out = new Map<MuscleGroup, number>();
  for (const m of muscleStats(sets, ctx, 'direct')) {
    if (m.lastDate) out.set(m.group, Math.round((Date.parse(today) - Date.parse(m.lastDate)) / 86_400_000));
  }
  return out;
}

export interface PlannedVsActual { plannedVolumeKg: number; actualVolumeKg: number; comparableSets: number; plannedSets: number; completedSets: number; ratio: number | null }

/**
 * Like-with-like comparison: only sets that carry BOTH a planned load and planned reps are compared
 * (a "find your 12RM" set has no planned load, so it is excluded from both sides).
 * Planned reps use the midpoint of the target range; a planned set that was never performed counts 0 actual.
 */
export function plannedVsActual(sets: AnalyticsSet[], ctx: AnalyticsCtx): PlannedVsActual {
  let planned = 0, actual = 0, comparable = 0, plannedSets = 0, done = 0;
  for (const s of sets) {
    if (s.deleted_at || s.parent_set_id || isWarmup(s)) continue;
    const sess = ctx.sessions.get(s.session_id);
    if (!sess || !['completed_as_planned', 'completed_modified', 'partial'].includes(sess.status)) continue;
    plannedSets += 1;
    if (isCompleted(s)) done += 1;
    if (s.planned_weight_kg === null || s.planned_reps_min === null) continue;
    const mid = ((s.planned_reps_min ?? 0) + (s.planned_reps_max ?? s.planned_reps_min ?? 0)) / 2;
    comparable += 1;
    planned += s.planned_weight_kg * mid;
    const ex = ctx.exercises.get(s.exercise_id);
    const v = ex ? setVolumeKg(s, ex as ExLike, ctx.opts) : null;
    if (isCompleted(s) && v !== null) actual += v;
  }
  return { plannedVolumeKg: planned, actualVolumeKg: actual, comparableSets: comparable, plannedSets, completedSets: done, ratio: planned > 0 ? actual / planned : null };
}

/** Acute (7 d) vs chronic (28 d weekly average) volume. Descriptive only — NOT an injury-prediction score. */
export function workloadRatio(sets: AnalyticsSet[], ctx: AnalyticsCtx, today: ISODate): { acuteKg: number; chronicWeeklyKg: number; ratio: number | null } {
  const acute = periodStats(inPeriod(sets, addDays(today, -6), today), ctx).volumeKg;
  const chronicTotal = periodStats(inPeriod(sets, addDays(today, -27), today), ctx).volumeKg;
  const chronic = chronicTotal / 4;
  return { acuteKg: acute, chronicWeeklyKg: chronic, ratio: chronic > 0 ? acute / chronic : null };
}

/** Training monotony = mean(daily volume) / sd(daily volume) over 7 days; strain = weekly volume × monotony. Descriptive only. */
export function monotony(sets: AnalyticsSet[], ctx: AnalyticsCtx, today: ISODate): { monotony: number | null; strain: number | null } {
  const days: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push(periodStats(inPeriod(sets, d, d), ctx).volumeKg);
  }
  const m = mean(days) as number;
  const sd = stdev(days);
  if (!sd || sd === 0 || m === 0) return { monotony: null, strain: null };
  return { monotony: m / sd, strain: m * 7 * (m / sd) };
}

export interface DataQuality { code: string; message: string; count: number }

/** Flags missing / incomparable data so a "drop" caused by gaps is not mistaken for a performance decline. */
export function dataQualityFlags(sets: AnalyticsSet[], ctx: AnalyticsCtx): DataQuality[] {
  const flags: DataQuality[] = [];
  const done = performedSets(sets, ctx).filter((s) => isCompleted(s) && !isWarmup(s));
  const noLoad = done.filter((s) => {
    const ex = ctx.exercises.get(s.exercise_id);
    return ex?.tracking_method === 'weight_reps' && s.weight_kg === null;
  }).length;
  if (noLoad) flags.push({ code: 'missing_load', message: `${noLoad} completed set${noLoad === 1 ? '' : 's'} have no weight recorded and are excluded from volume.`, count: noLoad });
  const noReps = done.filter((s) => {
    const ex = ctx.exercises.get(s.exercise_id);
    return ex && ['weight_reps', 'bodyweight_reps', 'assisted_reps'].includes(ex.tracking_method) && s.reps === null;
  }).length;
  if (noReps) flags.push({ code: 'missing_reps', message: `${noReps} completed set${noReps === 1 ? '' : 's'} have no reps recorded.`, count: noReps });
  const bwMissing = done.filter((s) => {
    const ex = ctx.exercises.get(s.exercise_id);
    return (ex?.tracking_method === 'bodyweight_reps' || ex?.tracking_method === 'assisted_reps') && s.bodyweight_kg === null && ctx.opts.bodyweightKg == null;
  }).length;
  if (bwMissing) flags.push({ code: 'missing_bodyweight', message: `${bwMissing} bodyweight set${bwMissing === 1 ? '' : 's'} cannot be converted to volume — add a bodyweight measurement.`, count: bwMissing });
  const noEffort = done.filter((s) => s.rir === null && s.rpe === null && !s.failure).length;
  if (noEffort > done.length * 0.5 && done.length >= 10) flags.push({ code: 'missing_effort', message: 'More than half of the sets have no RIR/RPE, so hard-set counts are assumptions.', count: noEffort });
  return flags;
}

/** Relative strength: e1RM ÷ bodyweight (both in kg). Null when either is unknown. */
export const relativeStrength = (e1rmKg: number | null, bodyweightKg: number | null): number | null =>
  e1rmKg !== null && bodyweightKg !== null && bodyweightKg > 0 ? e1rmKg / bodyweightKg : null;

export interface SessionDuration { sessionId: string; date: ISODate; minutes: number }

export function sessionDurations(sessions: SessionLite[]): SessionDuration[] {
  const out: SessionDuration[] = [];
  for (const s of sessions) {
    if (!s.started_at || !s.finished_at || !PERFORMED.has(s.status)) continue;
    const ms = Date.parse(s.finished_at) - Date.parse(s.started_at) - (s.paused_total_s ?? 0) * 1000;
    if (ms > 0) out.push({ sessionId: s.id, date: s.session_date, minutes: Math.round(ms / 60000) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
