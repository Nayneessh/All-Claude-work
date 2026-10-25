import type { Exercise, ISODate, SetRecord, WorkoutSession } from '@/domain/types';
import { addDays, eachWeekStart, rangeFor, weekStartOf, type RangeKey } from '@/domain/periods';
import { type AnalyticsCtx, type AnalyticsSet, type MuscleStats, type WeekPoint, dataQualityFlags, exerciseVolume, inPeriod, monotony, muscleStats, performedSets, periodStats, plannedVsActual, relativeStrength, weeklySeries, workloadRatio, monthlySeries, sessionDurations, daysSinceMuscle, type DataQuality } from '@/domain/analytics';
import { attendance, matchOccurrences, trainingFrequency, weeklyStreaks, type AttendanceSummary, type OccurrenceResult } from '@/domain/adherence';
import { occurrences } from '@/domain/versioning';
import { detectPrs, type PrEvent } from '@/domain/records';
import { assessProgress, perfBySession, progressionVelocity, type ProgressAssessment, type SessionPerf } from '@/domain/progression';
import { detectDips, type DipFlag } from '@/domain/dips';
import { readinessScore } from '@/domain/readiness';
import { mean } from '@/domain/periods';
import { e1rmForSet } from '@/domain/e1rm';
import { generateRecommendations, type RecProposal } from '@/domain/recommendations';
import { tbl } from '../db';
import { getBundle, listPrograms, treeOfVersion } from './programs';
import { analyticsOptions, loadAnalytics, sessionsInRange } from './history';
import { listBody, listReadiness } from './misc';
import { latestVersion, resolveVersion } from '@/domain/versioning';

const clean = <T extends { _dirty: 0 | 1 }>(r: T): Omit<T, '_dirty'> => { const { _dirty: _d, ...rest } = r; void _d; return rest; };

export interface ExerciseTrend { exercise: Exercise; perfs: SessionPerf[]; assessment: ProgressAssessment; prs: PrEvent[]; velocity: { w4: number | null; w8: number | null; w12: number | null }; daysSincePr: number | null; relStrength: number | null }

export interface Dashboard {
  from: ISODate; to: ISODate; prevFrom: ISODate; prevTo: ISODate; today: ISODate;
  stats: ReturnType<typeof periodStats>; prev: ReturnType<typeof periodStats>;
  weeks: WeekPoint[]; months: ReturnType<typeof monthlySeries>;
  attendance: AttendanceSummary; results: OccurrenceResult[]; streak: { currentWeeks: number; longestWeeks: number };
  frequencyPerWeek: number; avgDurationMin: number | null;
  pva: ReturnType<typeof plannedVsActual>;
  muscles: MuscleStats[]; musclesWeighted: MuscleStats[]; sinceMuscle: Map<string, number>;
  topExercises: ReturnType<typeof exerciseVolume>;
  prs: PrEvent[]; prsAll: Map<string, PrEvent[]>;
  trends: ExerciseTrend[];
  dips: DipFlag[];
  quality: DataQuality[];
  workload: ReturnType<typeof workloadRatio>; monotony: ReturnType<typeof monotony>;
  ctx: AnalyticsCtx; sets: AnalyticsSet[]; sessions: WorkoutSession[];
  proposals: RecProposal[];
}

/**
 * Everything on the Progress screen, computed from stored sets and sessions only — no cached or invented numbers.
 * (Records, trends and flags are derived each time, so a correction anywhere changes everything that depends on it.)
 */
export async function loadDashboard(rangeKey: RangeKey, today: ISODate, custom?: { from: ISODate; to: ISODate }): Promise<Dashboard> {
  const opts = await analyticsOptions(today);
  const first = (await tbl('workout_sessions').orderBy('session_date').filter((s) => !s.deleted_at && !['planned', 'skipped', 'cancelled', 'rescheduled'].includes(s.status)).first())?.session_date;
  const { from, to } = rangeFor(rangeKey, today, custom, first ?? undefined);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const wide = await loadAnalytics(addDays(prevFrom, -7), to, today);
  const inRange = inPeriod(wide.sets, from, to);
  const stats = periodStats(inRange, wide.ctx);
  const prev = periodStats(inPeriod(wide.sets, prevFrom, prevTo), wide.ctx);
  const weeks = weeklySeries(wide.sets, wide.ctx, from, to);
  const months = monthlySeries(wide.sets, wide.ctx, from, to);

  // attendance over every program that was scheduled in range
  const sessionsAround = await sessionsInRange(addDays(from, -14), addDays(to, 28));
  const results: OccurrenceResult[] = [];
  for (const p of await listPrograms({ includeArchived: true })) {
    if (p.is_template) continue;
    const b = await getBundle(p.id);
    if (!b) continue;
    const occ = occurrences(b.program, b.versions, b.templates, from, to > today ? today : to);
    results.push(...matchOccurrences(occ, sessionsAround.filter((s) => s.program_id === p.id), today));
  }
  const att = attendance(results);
  const streak = weeklyStreaks(results, today, opts.weekStart);
  const performedDates = [...new Set(performedSets(inRange, wide.ctx).filter((s) => s.status === 'completed').map((s) => s.session_date))];
  const freq = trainingFrequency(performedDates, from, to, opts.weekStart);
  const durs = sessionDurations(wide.sessions.filter((s) => s.session_date >= from && s.session_date <= to));
  const finished = inRange.filter((s) => ['completed_as_planned', 'completed_modified', 'partial'].includes(wide.ctx.sessions.get(s.session_id)?.status ?? ''));
  const pva = plannedVsActual(finished, wide.ctx);

  // exercise-level insight for everything trained in the last ~year (bounded by what exists)
  const all = await loadAnalytics(addDays(today, -400), today, today);
  const exIds = [...new Set(all.sets.filter((s) => s.status === 'completed').map((s) => s.exercise_id))];
  const prsAll = new Map<string, PrEvent[]>();
  const trends: ExerciseTrend[] = [];
  const perfsByExercise = new Map<string, SessionPerf[]>();
  const readiness = await listReadiness();
  const lowShare = (() => { const rs = readiness.filter((r) => r.record_date >= addDays(today, -21)).map(readinessScore).filter((x): x is number => x !== null); return rs.length ? rs.filter((x) => x < 50).length / rs.length : 0; })();
  const bodyRows = await listBody();
  const bw = opts.bodyweightKg ?? null;
  for (const id of exIds) {
    const ex = all.exercises.get(id);
    if (!ex) continue;
    const exSets = all.sets.filter((s) => s.exercise_id === id) as SetRecord[];
    const performed = performedSets(exSets as AnalyticsSet[], all.ctx) as SetRecord[];
    const prs = detectPrs(performed, ex, { formula: opts.formula, doublePerHand: opts.doublePerHand, bodyweightKg: opts.bodyweightKg });
    prsAll.set(id, prs);
    const perfs = perfBySession(performed, new Map(all.sessions.map((s) => [s.id, { id: s.id, status: s.status, tags: s.tags }])), ex, { formula: opts.formula, doublePerHand: opts.doublePerHand, bodyweightKg: opts.bodyweightKg });
    perfsByExercise.set(id, perfs);
    const lastPr = [...prs].reverse().find((p) => !p.is_baseline);
    const best = Math.max(0, ...performed.map((s) => e1rmForSet(s, ex, { formula: opts.formula })?.value ?? 0));
    trends.push({
      exercise: ex, perfs, assessment: assessProgress(perfs, today, undefined, { lowReadinessShare: lowShare }), prs,
      velocity: { w4: progressionVelocity(perfs, today, 4), w8: progressionVelocity(perfs, today, 8), w12: progressionVelocity(perfs, today, 12) },
      daysSincePr: lastPr ? Math.round((Date.parse(today) - Date.parse(lastPr.date)) / 86_400_000) : null,
      relStrength: ex.tracking_method === 'weight_reps' ? relativeStrength(best || null, bw) : null,
    });
  }
  trends.sort((a, b) => (b.perfs.at(-1)?.date ?? '') .localeCompare(a.perfs.at(-1)?.date ?? ''));
  const prs = [...prsAll.values()].flat().filter((p) => !p.is_baseline && p.date >= from && p.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));

  const noteRows = (await tbl('workout_sessions').where('session_date').between(addDays(today, -60), today, true, true).toArray()).filter((s) => !s.deleted_at && s.notes).map((s) => ({ date: s.session_date, notes: s.notes as string }));
  const dips = detectDips({ today, sets: all.sets, ctx: all.ctx, attendance: results.length ? results : [], perfsByExercise, readiness, sessionNotes: noteRows });

  // recommendations (proposals only; stored separately and only after the user sees them)
  const proposals = await buildProposals(today, opts.weekStart, all, results, dips, perfsByExercise, lowShare, exIds);
  void bodyRows; void mean; void weekStartOf; void eachWeekStart; void treeOfVersion; void latestVersion; void resolveVersion;

  return {
    from, to, prevFrom, prevTo, today, stats, prev, weeks, months, attendance: att, results, streak, frequencyPerWeek: freq.perWeek,
    avgDurationMin: durs.length ? Math.round(durs.reduce((a, d) => a + d.minutes, 0) / durs.length) : null, pva,
    muscles: muscleStats(inRange, wide.ctx, 'direct'), musclesWeighted: muscleStats(inRange, wide.ctx, 'weighted'), sinceMuscle: daysSinceMuscle(all.sets, all.ctx, today),
    topExercises: exerciseVolume(inRange, wide.ctx).slice(0, 8), prs, prsAll, trends, dips, quality: dataQualityFlags(inRange, wide.ctx),
    workload: workloadRatio(all.sets, all.ctx, today), monotony: monotony(all.sets, all.ctx, today), ctx: wide.ctx, sets: inRange, sessions: wide.sessions as unknown as WorkoutSession[], proposals,
  };
}

async function buildProposals(today: ISODate, weekStart: number, all: Awaited<ReturnType<typeof loadAnalytics>>, results: OccurrenceResult[], dips: DipFlag[], perfsByExercise: Map<string, SessionPerf[]>, lowShare: number, exIds: string[]): Promise<RecProposal[]> {
  const progs = (await listPrograms()).filter((p) => p.status === 'active');
  const planByExercise = new Map<string, { plan_key: string; template_key: string; sets: number; reps_min: number | null; reps_max: number | null; start_load_kg: number | null; rir_target: number | null }>();
  for (const p of progs) {
    const b = await getBundle(p.id);
    if (!b) continue;
    const v = resolveVersion(b.versions, today) ?? latestVersion(b.versions);
    if (!v) continue;
    const tree = treeOfVersion(b, v.id);
    for (const r of tree.planned) if (!planByExercise.has(r.exercise_id)) planByExercise.set(r.exercise_id, { plan_key: r.plan_key, template_key: r.template_key, sets: r.sets, reps_min: r.reps_min, reps_max: r.reps_max, start_load_kg: r.start_load_kg, rir_target: r.rir_target });
  }
  const recent = new Map<string, { date: ISODate; sets: { weight_kg: number | null; reps: number | null; rir: number | null }[] }[]>();
  for (const id of exIds) {
    const byS = new Map<string, { date: ISODate; sets: { weight_kg: number | null; reps: number | null; rir: number | null }[] }>();
    for (const s of performedSets(all.sets.filter((x) => x.exercise_id === id), all.ctx)) {
      if (s.status !== 'completed' || s.set_type === 'warmup' || s.parent_set_id) continue;
      const cur = byS.get(s.session_id) ?? { date: s.session_date, sets: [] };
      cur.sets.push({ weight_kg: s.weight_kg, reps: s.reps, rir: s.rir });
      byS.set(s.session_id, cur);
    }
    recent.set(id, [...byS.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-3));
  }
  return generateRecommendations({
    today, weekStart, planByExercise, recentByExercise: recent, perfsByExercise, attendance: results, dips, lowReadinessShare: lowShare,
    nameOf: (id) => all.exercises.get(id)?.name ?? 'exercise',
    incrementKg: (id) => { const e = all.exercises.get(id); return e?.load_mode === 'per_hand' ? 2 : e?.tracking_method === 'weight_reps' ? 2.5 : 1; },
  });
}

void clean;
