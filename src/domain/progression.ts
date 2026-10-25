import type { ISODate, SetRecord, WorkoutSession } from './types';
import { e1rmForSet, type E1rmFormula } from './e1rm';
import { type ExLike, isCompleted, isWarmup, setVolumeKg, type VolumeOptions } from './volume';
import { addDays, daysBetween, mean, stdev } from './periods';

/**
 * Per-exercise progression signals. These are SIGNALS FOR REVIEW, not diagnoses. A single poor
 * session never triggers a warning: every rule needs a minimum number of comparable sessions.
 *
 * Comparable session = same exercise, a completed/partial-free session (status completed_*), not tagged
 * "deload", with a usable performance score. Score:
 *   weight × reps  → best estimated 1RM of the session's working sets
 *   bodyweight/assisted reps → best reps in a set
 *   duration → longest duration; distance → longest distance
 */
export interface ProgressConfig {
  minSessions: number;          // below this → insufficient_data
  improveThresholdPct: number;  // +2% vs the previous block = improving
  plateauWeeks: number;         // look-back window for a plateau
  plateauMinSessions: number;   // sessions needed inside the window
  plateauBandPct: number;       // best within +1% of the earlier best = no meaningful improvement
  regressionPct: number;        // −5% (3-session means) = regressing
  regressionMinSessions: number;
  cvThresholdPct: number;       // coefficient of variation above this = inconsistent
}

export const DEFAULT_PROGRESS_CONFIG: ProgressConfig = {
  minSessions: 4,
  improveThresholdPct: 2,
  plateauWeeks: 4,
  plateauMinSessions: 3,
  plateauBandPct: 1,
  regressionPct: 5,
  regressionMinSessions: 6,
  cvThresholdPct: 10,
};

export interface SessionPerf {
  session_id: string;
  date: ISODate;
  score: number | null;
  topWeightKg: number | null;
  topReps: number | null;
  volumeKg: number | null;
  avgRir: number | null;
  workingSets: number;
  comparable: boolean;
  tags: string[];
}

type PerfSet = Pick<
  SetRecord,
  | 'session_id' | 'session_date' | 'status' | 'set_type' | 'parent_set_id' | 'weight_kg' | 'reps' | 'reps_partial' | 'duration_s'
  | 'distance_m' | 'assist_kg' | 'bodyweight_kg' | 'rir' | 'rpe' | 'failure' | 'rom'
> & { deleted_at?: string | null };

type PerfSession = Pick<WorkoutSession, 'id' | 'status' | 'tags'>;

const COMPLETE: ReadonlySet<string> = new Set(['completed_as_planned', 'completed_modified']);

export function perfBySession(
  sets: PerfSet[],
  sessions: Map<string, PerfSession>,
  ex: ExLike,
  opts: { formula?: E1rmFormula } & VolumeOptions = {},
): SessionPerf[] {
  const by = new Map<string, PerfSet[]>();
  for (const s of sets) {
    if (!isCompleted(s) || isWarmup(s) || s.parent_set_id) continue;
    const arr = by.get(s.session_id) ?? [];
    arr.push(s);
    by.set(s.session_id, arr);
  }
  const out: SessionPerf[] = [];
  for (const [sid, arr] of by) {
    const sess = sessions.get(sid);
    const date = arr[0]!.session_date;
    let score: number | null = null;
    let topW: number | null = null;
    let topReps: number | null = null;
    let vol: number | null = null;
    const rirs: number[] = [];
    for (const s of arr) {
      if (s.rir !== null && s.rir !== undefined) rirs.push(s.rir);
      const v = setVolumeKg(s, ex, opts);
      if (v !== null) vol = (vol ?? 0) + v;
      if (s.reps !== null && (topReps === null || s.reps > topReps)) topReps = s.reps;
      if (s.weight_kg !== null && (topW === null || s.weight_kg > topW)) topW = s.weight_kg;
      let cand: number | null = null;
      if (ex.tracking_method === 'weight_reps') cand = e1rmForSet(s, ex, { formula: opts.formula })?.value ?? null;
      else if (ex.tracking_method === 'bodyweight_reps' || ex.tracking_method === 'assisted_reps') cand = s.reps;
      else if (ex.tracking_method === 'distance') cand = s.distance_m;
      else cand = s.duration_s;
      if (cand !== null && cand !== undefined && (score === null || cand > score)) score = cand;
    }
    const tags = sess?.tags ?? [];
    out.push({
      session_id: sid,
      date,
      score,
      topWeightKg: topW,
      topReps,
      volumeKg: vol,
      avgRir: mean(rirs),
      workingSets: arr.length,
      comparable: !!sess && COMPLETE.has(sess.status) && !tags.includes('deload') && score !== null,
      tags,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
}

export type ProgressSignal = 'insufficient_data' | 'improving' | 'plateau' | 'regressing' | 'possible_fatigue' | 'inconsistent' | 'steady';

export interface ProgressAssessment {
  signal: ProgressSignal;
  sessionsConsidered: number;
  reasons: string[];
  changePct: number | null;
  latestScore: number | null;
  bestScore: number | null;
  sessionsSinceBest: number | null;
}

export function assessProgress(
  perfs: SessionPerf[],
  today: ISODate,
  cfg: ProgressConfig = DEFAULT_PROGRESS_CONFIG,
  context: { lowReadinessShare?: number } = {},
): ProgressAssessment {
  const comp = perfs.filter((p) => p.comparable && p.score !== null);
  const scores = comp.map((p) => p.score as number);
  const base: ProgressAssessment = {
    signal: 'insufficient_data', sessionsConsidered: comp.length, reasons: [], changePct: null,
    latestScore: scores.at(-1) ?? null, bestScore: scores.length ? Math.max(...scores) : null, sessionsSinceBest: null,
  };
  if (comp.length) {
    const bi = scores.lastIndexOf(Math.max(...scores));
    base.sessionsSinceBest = scores.length - 1 - bi;
  }
  if (comp.length < cfg.minSessions) {
    base.reasons.push(`Only ${comp.length} comparable session${comp.length === 1 ? '' : 's'} — at least ${cfg.minSessions} are needed before a trend is shown.`);
    return base;
  }

  const last3 = scores.slice(-3);
  const prev3 = scores.slice(-6, -3);
  const m3 = mean(last3) as number;
  if (prev3.length === 3) {
    const pm = mean(prev3) as number;
    base.changePct = ((m3 - pm) / pm) * 100;
    const lowRegress = m3 <= pm * (1 - cfg.regressionPct / 100) && Math.max(...last3) < Math.max(...prev3);
    if (comp.length >= cfg.regressionMinSessions && lowRegress) {
      const rirLast = mean(comp.slice(-3).map((p) => p.avgRir).filter((x): x is number => x !== null));
      const rirPrev = mean(comp.slice(-6, -3).map((p) => p.avgRir).filter((x): x is number => x !== null));
      const harder = rirLast !== null && rirPrev !== null && rirLast <= rirPrev - 0.5;
      const lowReady = (context.lowReadinessShare ?? 0) >= 0.5;
      if (harder || lowReady) {
        base.signal = 'possible_fatigue';
        base.reasons.push(`Performance fell ${Math.abs(base.changePct).toFixed(1)}% over the last 3 sessions versus the 3 before.`);
        if (harder) base.reasons.push('Reps in reserve dropped over the same sessions — the same work felt harder.');
        if (lowReady) base.reasons.push('Readiness ratings were low on at least half of these days.');
        base.reasons.push('This is a signal for review, not a diagnosis. Consider whether a lighter week is appropriate.');
      } else {
        base.signal = 'regressing';
        base.reasons.push(`Performance fell ${Math.abs(base.changePct).toFixed(1)}% (mean of last 3 vs previous 3 sessions) and no recent session beat the earlier best.`);
      }
      return base;
    }
  }

  // 1) A genuine new best: the last 3 sessions beat everything earlier by the improvement threshold.
  const earlier = scores.slice(0, -3);
  if (earlier.length >= 1 && Math.max(...last3) >= Math.max(...earlier) * (1 + cfg.improveThresholdPct / 100)) {
    base.signal = 'improving';
    base.reasons.push(`A recent session beat the previous best by ${(((Math.max(...last3) / Math.max(...earlier)) - 1) * 100).toFixed(1)}%.`);
    return base;
  }

  // 2) Erratic results are reported as inconsistent before any plateau/steady reading.
  const recent6 = scores.slice(-6);
  const sd = stdev(recent6);
  const mn = mean(recent6);
  if (sd !== null && mn) {
    const cv = (sd / mn) * 100;
    if (cv > cfg.cvThresholdPct) {
      base.signal = 'inconsistent';
      base.reasons.push(`Session-to-session variation is ${cv.toFixed(1)}% (above ${cfg.cvThresholdPct}%), so no trend is claimed.`);
      return base;
    }
  }

  // 3) Plateau: ≥ N sessions in the window and no meaningful improvement over what came before the window.
  const windowStart = addDays(today, -cfg.plateauWeeks * 7);
  const inWin = comp.filter((p) => p.date >= windowStart);
  const before = comp.filter((p) => p.date < windowStart);
  if (inWin.length >= cfg.plateauMinSessions && before.length >= 1) {
    const bestBefore = Math.max(...before.map((p) => p.score as number));
    const bestWin = Math.max(...inWin.map((p) => p.score as number));
    if (bestWin <= bestBefore * (1 + cfg.plateauBandPct / 100)) {
      base.signal = 'plateau';
      base.reasons.push(`No meaningful improvement in ${cfg.plateauWeeks} weeks (${inWin.length} sessions; best ${bestWin.toFixed(1)} vs earlier ${bestBefore.toFixed(1)}).`);
      return base;
    }
  }

  // 4) Steady climb without a single standout session: the 3-session mean rose past the threshold.
  if (base.changePct !== null && base.changePct >= cfg.improveThresholdPct) {
    base.signal = 'improving';
    base.reasons.push(`Mean of the last 3 sessions is ${base.changePct.toFixed(1)}% above the 3 before.`);
    return base;
  }

  base.signal = 'steady';
  base.reasons.push('Performance is steady with no meaningful change.');
  return base;
}

/** Linear trend (units per week) over the last `weeks` weeks, via least squares. */
export function progressionVelocity(perfs: SessionPerf[], today: ISODate, weeks: 4 | 8 | 12): number | null {
  const from = addDays(today, -weeks * 7);
  const pts = perfs.filter((p) => p.comparable && p.score !== null && p.date >= from).map((p) => ({ x: daysBetween(from, p.date) / 7, y: p.score as number }));
  if (pts.length < 3) return null;
  const mx = mean(pts.map((p) => p.x)) as number;
  const my = mean(pts.map((p) => p.y)) as number;
  const den = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (den === 0) return null;
  return pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / den;
}
