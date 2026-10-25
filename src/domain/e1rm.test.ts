import { describe, expect, it } from 'vitest';
import { e1rmForSet, estimate1RM } from './e1rm';
import { set } from '@/test/factories';

const ex = { tracking_method: 'weight_reps', load_mode: 'total', bodyweight_fraction: 1 } as const;

describe('e1RM', () => {
  it('matches the published formulas', () => {
    expect(estimate1RM(100, 5, 'epley')).toBeCloseTo(116.667, 3);
    expect(estimate1RM(100, 5, 'brzycki')).toBeCloseTo(112.5, 3);
    expect(estimate1RM(100, 10, 'lombardi')).toBeCloseTo(125.89, 2);
    expect(estimate1RM(100, 12, 'epley')).toBeCloseTo(140, 3);
  });
  it('returns the actual weight for a single', () => {
    expect(estimate1RM(180, 1, 'epley')).toBe(180);
  });
  it('rejects unsuitable inputs instead of guessing', () => {
    expect(estimate1RM(100, 0)).toBeNull();
    expect(estimate1RM(100, 13)).toBeNull(); // too many reps for a trustworthy estimate
    expect(estimate1RM(0, 5)).toBeNull();
    expect(estimate1RM(-5, 5)).toBeNull();
  });
  it('labels results as estimated vs tested and records the formula version', () => {
    const e = e1rmForSet(set({ weight_kg: 100, reps: 5 }), ex)!;
    expect(e.tested).toBe(false);
    expect(e.formula).toBe('epley');
    expect(e.version).toBe(1);
    expect(e1rmForSet(set({ weight_kg: 180, reps: 1 }), ex)!.tested).toBe(true);
  });
  it('skips warm-ups, partial-ROM sets, negatives, incomplete sets and non-weight exercises', () => {
    expect(e1rmForSet(set({ set_type: 'warmup' }), ex)).toBeNull();
    expect(e1rmForSet(set({ rom: 'partial' }), ex)).toBeNull();
    expect(e1rmForSet(set({ set_type: 'negative' }), ex)).toBeNull();
    expect(e1rmForSet(set({ status: 'planned' }), ex)).toBeNull();
    expect(e1rmForSet(set({ weight_kg: null }), ex)).toBeNull();
    expect(e1rmForSet(set({}), { ...ex, tracking_method: 'bodyweight_reps' })).toBeNull();
  });
  it('optionally adds RIR to reps (off by default)', () => {
    const s = set({ weight_kg: 100, reps: 5, rir: 2 });
    expect(e1rmForSet(s, ex)!.value).toBeCloseTo(116.667, 3);
    expect(e1rmForSet(s, ex, { adjustForRir: true })!.value).toBeCloseTo(123.333, 3);
  });
});
