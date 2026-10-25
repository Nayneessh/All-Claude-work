import type { ISODate, ReadinessRecord } from './types';
import { mean } from './periods';

/**
 * Self-reported readiness index, 0–100. Positive ratings (sleep quality, energy, motivation, perceived recovery)
 * count as-is; negative ones (soreness, stress, fatigue) are inverted. Needs at least 3 answers. It is a simple
 * self-report summary — not a medical or overtraining measure.
 */
export function readinessScore(r: Pick<ReadinessRecord, 'sleep_quality' | 'energy' | 'soreness' | 'stress' | 'motivation' | 'perceived_recovery' | 'fatigue'>): number | null {
  const parts: number[] = [];
  const pos = (v: number | null): void => { if (v !== null) parts.push(v); };
  const neg = (v: number | null): void => { if (v !== null) parts.push(6 - v); };
  pos(r.sleep_quality); pos(r.energy); pos(r.motivation); pos(r.perceived_recovery);
  neg(r.soreness); neg(r.stress); neg(r.fatigue);
  if (parts.length < 3) return null;
  return Math.round((((mean(parts) as number) - 1) / 4) * 100);
}

export const readinessLabel = (score: number | null): string =>
  score === null ? 'Not enough answers' : score >= 70 ? 'High' : score >= 45 ? 'Moderate' : 'Low';

export interface Correlation { r: number; n: number; strength: 'weak' | 'moderate' | 'strong'; note: string }

/** Pearson correlation. Needs ≥ 8 pairs. Always reported as correlation, never as cause. */
export function correlate(xs: number[], ys: number[]): Correlation | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 8) return null;
  const mx = mean(xs.slice(0, n)) as number, my = mean(ys.slice(0, n)) as number;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  const a = Math.abs(r);
  return { r, n, strength: a >= 0.6 ? 'strong' : a >= 0.3 ? 'moderate' : 'weak', note: 'A correlation in your own data — it does not show that one thing caused the other.' };
}

export function readinessByDate(records: ReadinessRecord[]): Map<ISODate, number> {
  const m = new Map<ISODate, number>();
  for (const r of records) { const s = readinessScore(r); if (s !== null && !r.deleted_at) m.set(r.record_date, s); }
  return m;
}
