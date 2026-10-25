import type { SetRecord } from './types';
import { type ExLike, isCompleted, isWarmup } from './volume';

/**
 * Estimated one-rep max.
 *  - Epley (default): w × (1 + reps/30)
 *  - Brzycki:        w × 36 / (37 − reps)
 *  - Lombardi:       w × reps^0.10
 * The result is ALWAYS an estimate: a single (reps = 1) working set is reported as a tested 1RM instead.
 * Only suitable sets are used: weight × reps exercises, completed working sets, 1–12 reps, full range of motion,
 * not warm-ups, partial-rep or negative-only sets. Reps beyond 12 are rejected (formula error grows quickly).
 */
export type E1rmFormula = 'epley' | 'brzycki' | 'lombardi';
export const E1RM_FORMULA_VERSION = 1;
export const E1RM_MAX_REPS = 12;

export interface E1rmOptions {
  formula?: E1rmFormula;
  /** If true, reps-in-reserve are added to reps before estimating (off by default: conservative). */
  adjustForRir?: boolean;
}

export interface E1rmResult {
  value: number;
  formula: E1rmFormula;
  version: number;
  /** True only when a single completed rep was lifted (an actual, not estimated, 1RM). */
  tested: boolean;
}

export function estimate1RM(weight: number, reps: number, formula: E1rmFormula = 'epley'): number | null {
  if (!(weight > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  if (reps === 1) return weight;
  switch (formula) {
    case 'epley': return weight * (1 + reps / 30);
    case 'brzycki': return (weight * 36) / (37 - reps);
    case 'lombardi': return weight * Math.pow(reps, 0.1);
  }
}

type E1rmSet = Pick<SetRecord, 'status' | 'set_type' | 'weight_kg' | 'reps' | 'rir' | 'rom'> & { deleted_at?: string | null };

export function e1rmForSet(s: E1rmSet, ex: ExLike, opts: E1rmOptions = {}): E1rmResult | null {
  if (ex.tracking_method !== 'weight_reps') return null;
  if (!isCompleted(s) || isWarmup(s)) return null;
  if (s.set_type === 'partial' || s.set_type === 'negative') return null;
  if (s.rom === 'partial') return null;
  if (s.weight_kg === null || s.reps === null) return null;
  const formula = opts.formula ?? 'epley';
  const effReps = opts.adjustForRir && s.rir !== null && s.rir > 0 ? s.reps + s.rir : s.reps;
  const value = estimate1RM(s.weight_kg, effReps, formula);
  if (value === null) return null;
  return { value, formula, version: E1RM_FORMULA_VERSION, tested: s.reps === 1 && !opts.adjustForRir };
}
