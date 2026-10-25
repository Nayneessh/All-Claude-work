import type { Goal, ISODate } from './types';
import { mean } from './periods';
import { daysBetween, addDays } from './periods';

export interface GoalPoint { date: ISODate; value: number }

export interface GoalProgress {
  current: number | null;
  baseline: number | null;
  target: number;
  pct: number | null;
  reachedMilestones: number;
  totalMilestones: number;
  projectedDate: ISODate | null;
  onTrack: boolean | null;
  note: string;
}

/**
 * progress% = (current − baseline) ÷ (target − baseline), clamped to 0–100. Works for goals that go down
 * (bodyweight loss) because both differences share a sign. Trajectory is a straight-line ESTIMATE
 * from the last 8 weeks of the goal's own history; with fewer than 3 points no date is projected.
 */
export function evaluateGoal(goal: Pick<Goal, 'target_value' | 'baseline_value' | 'target_date' | 'milestones' | 'status'>, history: GoalPoint[], today: ISODate): GoalProgress {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const current = sorted.length ? sorted[sorted.length - 1]!.value : null;
  const baseline = goal.baseline_value ?? (sorted.length ? sorted[0]!.value : null);
  let pct: number | null = null;
  if (current !== null && baseline !== null && goal.target_value !== baseline) {
    pct = Math.max(0, Math.min(100, ((current - baseline) / (goal.target_value - baseline)) * 100));
  } else if (current !== null && baseline !== null && goal.target_value === baseline) {
    pct = 100;
  }
  const total = goal.milestones.length;
  const reached = goal.milestones.filter((m) => m.reached_at).length;

  let projected: ISODate | null = null;
  let note = '';
  const recent = sorted.filter((p) => daysBetween(p.date, today) <= 56);
  if (current !== null && baseline !== null && recent.length >= 3) {
    const x = recent.map((p) => daysBetween(recent[0]!.date, p.date));
    const mx = mean(x) as number, my = mean(recent.map((p) => p.value)) as number;
    const den = x.reduce((a, v) => a + (v - mx) ** 2, 0);
    const slope = den ? x.reduce((a, v, i) => a + (v - mx) * (recent[i]!.value - my), 0) / den : 0; // per day
    const towards = Math.sign(goal.target_value - baseline);
    if (slope !== 0 && Math.sign(slope) === towards) {
      const days = (goal.target_value - current) / slope;
      if (days >= 0 && days < 3650) projected = addDays(today, Math.round(days));
      note = 'Straight-line estimate from your recent history — not a promise.';
    } else if (current !== goal.target_value) {
      note = 'Recent history is flat or moving away from the target, so no date is projected.';
    }
  } else if (current !== null) {
    note = 'Not enough history yet to project a date (needs 3+ data points in the last 8 weeks).';
  }
  const onTrack = goal.target_date && projected ? projected <= goal.target_date : null;
  return { current, baseline, target: goal.target_value, pct, reachedMilestones: reached, totalMilestones: total, projectedDate: projected, onTrack, note };
}

export function defaultMilestones(baseline: number, target: number): Goal['milestones'] {
  return [0.25, 0.5, 0.75, 1].map((f) => ({ value: Math.round((baseline + (target - baseline) * f) * 100) / 100, label: `${Math.round(f * 100)}%`, reached_at: null }));
}

/** Mark milestones as reached (never un-reach — milestone history is preserved). */
export function markMilestones(goal: Pick<Goal, 'target_value' | 'baseline_value' | 'milestones'>, current: number | null, nowIso: string): Goal['milestones'] {
  if (current === null || goal.baseline_value === null) return goal.milestones;
  const up = goal.target_value >= goal.baseline_value;
  return goal.milestones.map((m) => (m.reached_at ? m : (up ? current >= m.value : current <= m.value) ? { ...m, reached_at: nowIso } : m));
}
