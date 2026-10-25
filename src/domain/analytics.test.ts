import { describe, expect, it } from 'vitest';
import { dataQualityFlags, daysSinceMuscle, exerciseVolume, monotony, monthlySeries, muscleStats, muscleWeekly, performedSets, periodStats, plannedVsActual, relativeStrength, sessionDurations, weeklySeries, workloadRatio } from './analytics';
import { ctxOf, ex, session, set } from '@/test/factories';

const bench = ex({ id: 'bench', name: 'Bench Press', primary_muscles: ['chest_mid'], secondary_muscles: ['triceps_long', 'delt_front'] });
const curl = ex({ id: 'curl', name: 'EZ Curl', primary_muscles: ['biceps_short'] });
const sessions = [
  session({ id: 's1', session_date: '2026-10-26' }),
  session({ id: 's2', session_date: '2026-11-03' }),
  session({ id: 'skip', session_date: '2026-11-04', status: 'skipped' }),
  session({ id: 'plan', session_date: '2026-11-05', status: 'planned' }),
];
const ctx = ctxOf([bench, curl], sessions);
const sets = [
  set({ session_id: 's1', session_date: '2026-10-26', weight_kg: 100, reps: 5 }),
  set({ session_id: 's1', session_date: '2026-10-26', weight_kg: 100, reps: 5, set_number: 2 }),
  set({ session_id: 's1', session_date: '2026-10-26', exercise_id: 'curl', weight_kg: 30, reps: 10, set_number: 3 }),
  set({ session_id: 's2', session_date: '2026-11-03', weight_kg: 105, reps: 5 }),
  set({ session_id: 'skip', session_date: '2026-11-04', weight_kg: 500, reps: 50 }),
  set({ session_id: 'plan', session_date: '2026-11-05', weight_kg: 500, reps: 50, status: 'planned' }),
];

describe('analytics', () => {
  it('ignores sets from skipped / planned sessions (absent, never zero-performance)', () => {
    expect(performedSets(sets, ctx).map((s) => s.session_id)).not.toContain('skip');
    expect(periodStats(sets, ctx).volumeKg).toBe(500 + 500 + 300 + 525);
    expect(periodStats(sets, ctx).sessions).toBe(2);
  });
  it('builds a weekly series with empty weeks left empty (trained = false)', () => {
    const w = weeklySeries(sets, ctx, '2026-10-26', '2026-11-08');
    expect(w.map((x) => x.weekStart)).toEqual(['2026-10-26', '2026-11-02']);
    expect(w[0]!.volumeKg).toBe(1300);
    expect(w[1]!.volumeKg).toBe(525);
    const gap = weeklySeries(sets, ctx, '2026-10-12', '2026-11-08');
    expect(gap[0]!.trained).toBe(false);
    expect(gap[0]!.sessions).toBe(0);
  });
  it('aggregates months', () => {
    const m = monthlySeries(sets, ctx, '2026-10-01', '2026-11-30');
    expect(m.map((x) => [x.month, x.volumeKg])).toEqual([['2026-10', 1300], ['2026-11', 525]]);
  });
  it('ranks exercise volume', () => {
    const rows = exerciseVolume(sets, ctx);
    expect(rows[0]).toMatchObject({ name: 'Bench Press', workingSets: 3, volumeKg: 1525 });
  });
  it('counts direct muscle sets (primary only) and weighted sets (secondary at 0.5)', () => {
    const direct = muscleStats(sets, ctx, 'direct');
    expect(direct.find((m) => m.group === 'chest')!.sets).toBe(3);
    expect(direct.find((m) => m.group === 'triceps')).toBeUndefined();
    const weighted = muscleStats(sets, ctx, 'weighted');
    expect(weighted.find((m) => m.group === 'triceps')!.sets).toBe(1.5);
    expect(weighted.find((m) => m.group === 'chest')!.volumeKg).toBe(1525);
    expect(weighted.find((m) => m.group === 'triceps')!.volumeKg).toBe(762.5);
  });
  it('gives weekly muscle series and days since last exposure', () => {
    const wk = muscleWeekly(sets, ctx, '2026-10-26', '2026-11-08');
    expect(wk.get('chest')!.map((p) => p.sets)).toEqual([2, 1]);
    expect(daysSinceMuscle(sets, ctx, '2026-11-06').get('biceps')).toBe(11);
  });
  it('compares planned vs actual like with like', () => {
    const planned = [
      set({ session_id: 's1', planned_weight_kg: 100, planned_reps_min: 8, planned_reps_max: 10, weight_kg: 100, reps: 10 }),
      set({ session_id: 's1', planned_weight_kg: 100, planned_reps_min: 8, planned_reps_max: 10, status: 'skipped', weight_kg: null, reps: null }),
      set({ session_id: 's1', planned_weight_kg: null, planned_reps_min: 10, planned_reps_max: 12, weight_kg: 50, reps: 12 }), // "find your 12RM": excluded
    ];
    const r = plannedVsActual(planned, ctx);
    expect(r.comparableSets).toBe(2);
    expect(r.plannedVolumeKg).toBe(1800);
    expect(r.actualVolumeKg).toBe(1000);
    expect(r.ratio).toBeCloseTo(1000 / 1800, 5);
    expect(r.plannedSets).toBe(3);
    expect(r.completedSets).toBe(2);
  });
  it('reports acute vs chronic workload and monotony as descriptive numbers', () => {
    const w = workloadRatio(sets, ctx, '2026-11-03');
    expect(w.acuteKg).toBe(525);
    expect(w.chronicWeeklyKg).toBe((1300 + 525) / 4);
    expect(w.ratio).toBeCloseTo(525 / ((1300 + 525) / 4), 5);
    expect(monotony(sets, ctx, '2026-11-03').monotony).not.toBeNull();
    expect(monotony([], ctx, '2026-11-03').monotony).toBeNull();
  });
  it('flags missing data so a drop caused by gaps is not read as decline', () => {
    const f = dataQualityFlags([set({ session_id: 's1', weight_kg: null, reps: 8 }), ...sets], ctx);
    expect(f.map((x) => x.code)).toContain('missing_load');
  });
  it('relative strength is null when bodyweight is unknown', () => {
    expect(relativeStrength(140, 80)).toBe(1.75);
    expect(relativeStrength(140, null)).toBeNull();
    expect(relativeStrength(null, 80)).toBeNull();
  });
  it('derives session durations excluding paused time', () => {
    const d = sessionDurations([session({ id: 'x', started_at: '2026-10-26T10:00:00.000Z', finished_at: '2026-10-26T11:10:00.000Z', paused_total_s: 600 }), session({ id: 'y' })]);
    expect(d).toEqual([{ sessionId: 'x', date: '2026-10-26', minutes: 60 }]);
  });
});
