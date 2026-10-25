import { describe, expect, it } from 'vitest';
import { assessProgress, perfBySession, progressionVelocity, type SessionPerf } from './progression';
import { set } from '@/test/factories';

const barbell = { tracking_method: 'weight_reps', load_mode: 'total', bodyweight_fraction: 1 } as const;

const perf = (date: string, score: number, over: Partial<SessionPerf> = {}): SessionPerf => ({
  session_id: `s-${date}`, date, score, topWeightKg: null, topReps: null, volumeKg: null, avgRir: null, workingSets: 3, comparable: true, tags: [], ...over,
});
const weekly = (start: string, scores: number[]): SessionPerf[] =>
  scores.map((s, i) => perf(new Date(Date.parse(start) + i * 7 * 86_400_000).toISOString().slice(0, 10), s));

describe('progression signals', () => {
  it('never flags anything from a single (or few) poor session(s)', () => {
    const a = assessProgress(weekly('2026-09-01', [100, 100, 80]), '2026-09-20');
    expect(a.signal).toBe('insufficient_data');
    expect(a.reasons[0]).toMatch(/at least 4/);
    expect(assessProgress([], '2026-09-20').signal).toBe('insufficient_data');
  });
  it('detects improvement', () => {
    const a = assessProgress(weekly('2026-09-01', [100, 101, 100, 104, 106, 108]), '2026-10-13');
    expect(a.signal).toBe('improving');
    expect(a.changePct).toBeGreaterThan(2);
  });
  it('detects regression only with ≥ 6 comparable sessions and a sustained drop', () => {
    const a = assessProgress(weekly('2026-09-01', [110, 112, 111, 100, 98, 99]), '2026-10-13');
    expect(a.signal).toBe('regressing');
    expect(assessProgress(weekly('2026-09-01', [110, 112, 111, 100, 98]), '2026-10-06').signal).not.toBe('regressing');
  });
  it('does not call a single dip within normal variation a regression', () => {
    const a = assessProgress(weekly('2026-09-01', [100, 102, 101, 103, 99, 104]), '2026-10-13');
    expect(a.signal).not.toBe('regressing');
  });
  it('raises "possible fatigue" (not a diagnosis) when decline coincides with higher effort', () => {
    const dated = weekly('2026-09-01', [110, 112, 111, 100, 98, 99]).map((x, i) => ({ ...x, avgRir: i < 3 ? 3 : 1 }));
    const a = assessProgress(dated, '2026-10-13');
    expect(a.signal).toBe('possible_fatigue');
    expect(a.reasons.join(' ')).toMatch(/not a diagnosis/);
  });
  it('detects a plateau after enough sessions with no meaningful improvement', () => {
    const early = [perf('2026-08-01', 100), perf('2026-08-08', 104), perf('2026-08-15', 105)];
    const recent = [perf('2026-10-05', 105), perf('2026-10-12', 105.5), perf('2026-10-19', 105)];
    const a = assessProgress([...early, ...recent], '2026-10-22');
    expect(a.signal).toBe('plateau');
  });
  it('excludes deload-tagged and incomplete sessions from comparison', () => {
    const list = [...weekly('2026-09-01', [100, 102, 104, 106]), perf('2026-10-06', 60, { tags: ['deload'], comparable: false })];
    const a = assessProgress(list, '2026-10-07');
    expect(a.sessionsConsidered).toBe(4);
    expect(a.signal).not.toBe('regressing');
  });
  it('flags inconsistent performance by variability', () => {
    const a = assessProgress(weekly('2026-09-01', [100, 125, 95, 120, 100, 122]), '2026-10-13');
    expect(a.signal).toBe('inconsistent');
  });
  it('builds per-session scores from sets (best e1RM), skipping skipped sessions', () => {
    const sets = [
      set({ session_id: 'a', session_date: '2026-10-01', weight_kg: 100, reps: 5 }),
      set({ session_id: 'a', session_date: '2026-10-01', weight_kg: 100, reps: 3, rir: 2 }),
      set({ session_id: 'a', session_date: '2026-10-01', set_type: 'warmup', weight_kg: 140, reps: 5 }),
      set({ session_id: 'b', session_date: '2026-10-08', weight_kg: 105, reps: 5 }),
    ];
    const sessions = new Map([
      ['a', { id: 'a', status: 'completed_as_planned', tags: [] }],
      ['b', { id: 'b', status: 'partial', tags: [] }],
    ] as const);
    const out = perfBySession(sets, sessions as never, barbell);
    expect(out).toHaveLength(2);
    expect(out[0]!.score).toBeCloseTo(116.667, 2);
    expect(out[0]!.comparable).toBe(true);
    expect(out[1]!.comparable).toBe(false); // partial sessions are not comparable
    expect(out[0]!.workingSets).toBe(2);
  });
  it('computes progression velocity per week', () => {
    const list = weekly('2026-09-01', [100, 102, 104, 106, 108]);
    expect(progressionVelocity(list, '2026-10-01', 8)).toBeCloseTo(2, 5);
    expect(progressionVelocity(list.slice(0, 2), '2026-10-01', 8)).toBeNull();
  });
});
