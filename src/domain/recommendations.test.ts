import { describe, expect, it } from 'vitest';
import { generateRecommendations, type RecInput, type RecSessionView } from './recommendations';

const plan = { plan_key: 'pk', template_key: 'tk', sets: 3, reps_min: 8, reps_max: 12, start_load_kg: 60, rir_target: 1 };
const view = (date: string, reps: number[], w = 60): RecSessionView => ({ date, sets: reps.map((r) => ({ weight_kg: w, reps: r, rir: 1 })) });
const input = (recent: RecSessionView[]): RecInput => ({
  today: '2026-11-10', weekStart: 1, planByExercise: new Map([['curl', plan]]), recentByExercise: new Map([['curl', recent]]),
  perfsByExercise: new Map(), attendance: [], dips: [], lowReadinessShare: 0, nameOf: () => 'EZ-Bar Curl', incrementKg: () => 2.5,
});

describe('recommendations', () => {
  it('suggests more load only after top-of-range on every set in two consecutive sessions', () => {
    const r = generateRecommendations(input([view('2026-11-03', [12, 12, 12]), view('2026-11-08', [12, 12, 12])]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'increase_load', exercise_id: 'curl' });
    expect(r[0]!.proposed_change).toMatchObject({ type: 'update_prescription', patch: { start_load_kg: 62.5 } });
    expect(r[0]!.observation).toMatch(/last 2 sessions/);
    expect(r[0]!.tradeoff).toBeTruthy();
    expect(r[0]!.evidence).toBeTruthy();
  });
  it('never recommends from a single session', () => {
    expect(generateRecommendations(input([view('2026-11-08', [12, 12, 12])]))).toEqual([]);
  });
  it('suggests adding reps before load when reps are rising inside the range', () => {
    const r = generateRecommendations(input([view('2026-11-03', [9, 8, 8]), view('2026-11-08', [10, 9, 8])]));
    expect(r.map((x) => x.kind)).toEqual(['add_reps_first']);
    expect(r[0]!.proposed_change).toBeNull();
  });
  it('suggests a lighter load when half the sets miss the bottom of the range twice', () => {
    const r = generateRecommendations(input([view('2026-11-03', [6, 5, 7]), view('2026-11-08', [6, 6, 5])]));
    expect(r[0]).toMatchObject({ kind: 'reduce_load' });
    expect((r[0]!.proposed_change as { patch: { start_load_kg: number } }).patch.start_load_kg).toBeLessThan(60);
  });
  it('is deterministic: the dedupe key stays stable within a week so a dismissed card is not re-created', () => {
    const a = generateRecommendations(input([view('2026-11-03', [12, 12, 12]), view('2026-11-08', [12, 12, 12])]));
    const b = generateRecommendations({ ...input([view('2026-11-03', [12, 12, 12]), view('2026-11-08', [12, 12, 12])]), today: '2026-11-12' });
    expect(a[0]!.dedupe_key).toBe(b[0]!.dedupe_key);
  });
  it('proposes rescheduling a missed session and a deload review — both only as proposals', () => {
    const r = generateRecommendations({
      ...input([]), attendance: [{ date: '2026-11-09', template_key: 'mon', outcome: 'missed', session_id: null }],
      dips: [{ kind: 'e1rm_decline' }, { kind: 'e1rm_decline' }] as never, lowReadinessShare: 0.6,
    });
    expect(r.map((x) => x.kind).sort()).toEqual(['deload_review', 'reschedule_missed']);
    expect(r.find((x) => x.kind === 'reschedule_missed')!.proposed_change).toMatchObject({ type: 'reschedule', from: '2026-11-09' });
  });
});
