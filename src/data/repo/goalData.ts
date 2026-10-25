import type { Goal, ISODate } from '@/domain/types';
import { addDays, eachWeekStart } from '@/domain/periods';
import { evaluateGoal, markMilestones, type GoalPoint, type GoalProgress } from '@/domain/goals';
import { e1rmForSet } from '@/domain/e1rm';
import { muscleStats, periodStats, inPeriod, performedSets } from '@/domain/analytics';
import { attendance, matchOccurrences } from '@/domain/adherence';
import { occurrences } from '@/domain/versioning';
import { seriesOf, type BodyKey } from '@/domain/body';
import { exerciseSets, loadAnalytics, sessionsInRange } from './history';
import { listBody, updateGoal } from './misc';
import { listPrograms, getBundle } from './programs';
import { tbl } from '../db';
import { nowIso } from '../runtime';
import type { MuscleGroup } from '@/domain/muscles';

/** The value history a goal is measured by, built from the user's own logged data. */
export async function goalSeries(g: Goal, today: ISODate): Promise<GoalPoint[]> {
  switch (g.goal_type) {
    case 'bodyweight': return seriesOf(await listBody(), 'bodyweight_kg');
    case 'measurement': return g.measurement_key ? seriesOf(await listBody(), g.measurement_key as BodyKey) : [];
    case 'exercise_load': case 'exercise_e1rm': case 'exercise_reps_at_load': case 'cardio': case 'mobility': {
      if (!g.exercise_id) return [];
      const ex = await tbl('exercises').get(g.exercise_id);
      if (!ex) return [];
      const sess = new Map((await tbl('workout_sessions').toArray()).map((s) => [s.id, s]));
      const sets = (await exerciseSets(g.exercise_id)).filter((s) => s.status === 'completed' && s.set_type !== 'warmup' && !s.parent_set_id && ['completed_as_planned', 'completed_modified', 'partial', 'in_progress'].includes(sess.get(s.session_id)?.status ?? ''));
      const byDate = new Map<ISODate, number>();
      let best = -Infinity;
      for (const s of [...sets].sort((a, b) => (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : a.set_number - b.set_number))) {
        let v: number | null = null;
        if (g.goal_type === 'exercise_load') v = s.weight_kg;
        else if (g.goal_type === 'exercise_e1rm') v = e1rmForSet(s, ex)?.value ?? null;
        else if (g.goal_type === 'exercise_reps_at_load') v = g.target_weight_kg !== null && s.weight_kg !== null && s.weight_kg >= g.target_weight_kg - 0.01 ? s.reps : null;
        else if (g.goal_type === 'cardio') v = ex.tracking_method === 'distance' || ex.tracking_method === 'distance_duration' ? s.distance_m : s.duration_s;
        else v = s.duration_s;
        if (v !== null && v > best) { best = v; byDate.set(s.session_date, v); }
      }
      return [...byDate].map(([date, value]) => ({ date, value }));
    }
    default: {
      const from = addDays(today, -84);
      const data = await loadAnalytics(from, today, today);
      const pts: GoalPoint[] = [];
      const ws = data.ctx.opts.weekStart;
      for (const w of eachWeekStart(from, today, ws)) {
        const end = addDays(w, 6);
        if (end > today) continue; // only completed weeks
        const sets = inPeriod(data.sets, w, end);
        let v: number | null = null;
        if (g.goal_type === 'weekly_frequency') v = new Set(performedSets(sets, data.ctx).filter((s) => s.status === 'completed').map((s) => s.session_date)).size;
        else if (g.goal_type === 'weekly_volume') v = periodStats(sets, data.ctx).volumeKg;
        else if (g.goal_type === 'weekly_sets') v = muscleStats(sets, data.ctx, 'direct').find((m) => m.group === (g.muscle as MuscleGroup))?.sets ?? (g.muscle ? 0 : periodStats(sets, data.ctx).workingSets);
        else if (g.goal_type === 'adherence') {
          const results = [];
          for (const p of await listPrograms({ includeArchived: true })) { const b = await getBundle(p.id); if (b && !p.is_template) results.push(...matchOccurrences(occurrences(b.program, b.versions, b.templates, w, end), await sessionsInRange(addDays(w, -7), addDays(end, 14)), today)); }
          const a = attendance(results);
          v = a.rate === null ? null : a.rate * 100;
        }
        if (v !== null) pts.push({ date: end, value: v });
      }
      return pts;
    }
  }
}

export interface GoalView { goal: Goal; progress: GoalProgress; series: GoalPoint[] }

export async function evaluateGoals(goals: Goal[], today: ISODate): Promise<GoalView[]> {
  const out: GoalView[] = [];
  for (const g of goals) {
    const series = await goalSeries(g, today);
    const progress = evaluateGoal(g, series, today);
    out.push({ goal: g, progress, series });
  }
  return out;
}

/** Records newly reached milestones (and completes a goal that hit its target) — history is only ever added to. */
export async function syncMilestones(views: GoalView[]): Promise<void> {
  for (const v of views) {
    if (v.goal.status !== 'active' || v.progress.current === null) continue;
    const next = markMilestones(v.goal, v.progress.current, nowIso());
    const changed = JSON.stringify(next) !== JSON.stringify(v.goal.milestones);
    const hit = v.goal.baseline_value !== null && (v.goal.target_value >= v.goal.baseline_value ? v.progress.current >= v.goal.target_value : v.progress.current <= v.goal.target_value);
    if (changed || hit) await updateGoal(v.goal.id, { milestones: next, ...(hit ? { status: 'completed' as const, completed_at: nowIso() } : {}) });
  }
}
