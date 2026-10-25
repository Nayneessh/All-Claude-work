import { describe, expect, it } from 'vitest';
import { currentBests, detectPrs, prsInSession } from './records';
import { set } from '@/test/factories';

const barbell = { tracking_method: 'weight_reps', load_mode: 'total', bodyweight_fraction: 1 } as const;
const pullup = { tracking_method: 'bodyweight_reps', load_mode: 'bodyweight', bodyweight_fraction: 1 } as const;
const plank = { tracking_method: 'duration', load_mode: 'bodyweight', bodyweight_fraction: 1 } as const;

const day = (d: string, sid: string, weight: number, reps: number, n = 1, extra = {}) =>
  set({ session_date: d, session_id: sid, weight_kg: weight, reps, set_number: n, created_at: `${d}T10:00:0${n}.000Z`, ...extra });

describe('personal records', () => {
  it('marks the first result as a baseline, later improvements as real PRs', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 100, 5), day('2026-11-02', 's2', 105, 5)], barbell);
    const w = ev.filter((e) => e.type === 'max_weight');
    expect(w[0]!.is_baseline).toBe(true);
    expect(w[1]!.is_baseline).toBe(false);
    expect(w[1]!.previous_value).toBe(100);
    expect(w[1]!.improvement_abs).toBe(5);
    expect(w[1]!.improvement_pct).toBeCloseTo(5, 5);
  });
  it('does not repeat a PR for equal or lower results', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 100, 5), day('2026-11-02', 's2', 100, 5), day('2026-11-09', 's3', 95, 8)], barbell);
    expect(ev.filter((e) => e.type === 'max_weight' && !e.is_baseline)).toHaveLength(0);
  });
  it('tracks most reps at a given load separately per load', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 80, 8), day('2026-11-02', 's2', 80, 10), day('2026-11-02', 's2', 90, 6, 2)], barbell);
    const r = ev.filter((e) => e.type === 'max_reps_at_weight' && !e.is_baseline);
    expect(r).toHaveLength(1);
    expect(r[0]!.value).toBe(10);
  });
  it('labels e1RM PRs as estimated and a single as a tested 1RM', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 100, 5), day('2026-11-02', 's2', 140, 1)], barbell);
    const e = ev.filter((x) => x.type === 'best_e1rm');
    expect(e[0]!.estimated).toBe(true);
    expect(e[1]!.estimated).toBe(false);
    expect(ev.some((x) => x.type === 'actual_1rm')).toBe(true);
  });
  it('ignores warm-ups, planned and soft-deleted sets', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 200, 5, 1, { set_type: 'warmup' }), day('2026-10-26', 's1', 200, 5, 2, { status: 'planned' }), day('2026-10-26', 's1', 200, 5, 3, { deleted_at: 'x' })], barbell);
    expect(ev).toHaveLength(0);
  });
  it('recomputes after a historical correction (records are derived, not stored)', () => {
    const sets = [day('2026-10-26', 's1', 100, 5), day('2026-11-02', 's2', 110, 5)];
    expect(currentBests(detectPrs(sets, barbell)).get('max_weight')!.value).toBe(110);
    sets[1] = { ...sets[1]!, weight_kg: 95 }; // typo corrected: it was 95, not 110
    const after = detectPrs(sets, barbell);
    expect(currentBests(after).get('max_weight')!.value).toBe(100);
    expect(after.some((e) => e.type === 'max_weight' && !e.is_baseline)).toBe(false);
  });
  it('includes drop-set / rest-pause component volume in set-volume records', () => {
    const parent = day('2026-10-26', 's1', 60, 10, 1, { id: 'p' });
    const drop = day('2026-10-26', 's1', 45, 8, 2, { id: 'd', set_type: 'drop', parent_set_id: 'p' });
    const ev = detectPrs([parent, drop], barbell).filter((e) => e.type === 'max_set_volume');
    expect(ev.at(-1)!.value).toBe(600 + 360);
  });
  it('reports the best result per type for a session, excluding baselines', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 100, 5), day('2026-11-02', 's2', 105, 5, 1), day('2026-11-02', 's2', 110, 3, 2)], barbell);
    const s2 = prsInSession(ev, 's2');
    expect(s2.find((e) => e.type === 'max_weight')!.value).toBe(110);
    expect(prsInSession(ev, 's1')).toHaveLength(0);
  });
  it('handles bodyweight reps and timed holds', () => {
    const bw = detectPrs([day('2026-10-26', 's1', 0, 8, 1, { weight_kg: null }), day('2026-11-02', 's2', 0, 10, 1, { weight_kg: null })], pullup);
    expect(bw.filter((e) => e.type === 'max_reps').map((e) => e.value)).toEqual([8, 10]);
    const hold = detectPrs([day('2026-10-26', 's1', 0, 0, 1, { weight_kg: null, reps: null, duration_s: 45 }), day('2026-11-02', 's2', 0, 0, 1, { weight_kg: null, reps: null, duration_s: 60 })], plank);
    expect(hold.filter((e) => e.type === 'longest_duration').map((e) => e.value)).toEqual([45, 60]);
  });
  it('respects configurable PR types', () => {
    const ev = detectPrs([day('2026-10-26', 's1', 100, 5)], barbell, { enabled: ['max_weight'] });
    expect(new Set(ev.map((e) => e.type))).toEqual(new Set(['max_weight']));
  });
});
