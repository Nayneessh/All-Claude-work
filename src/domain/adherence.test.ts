import { describe, expect, it } from 'vitest';
import { attendance, exerciseAdherence, matchOccurrences, prescriptionAdherence, weeklyStreaks, type OccurrenceResult, type SlotView } from './adherence';

const occ = (date: string, key = 'mon') => ({ date, template: { template_key: key } });
const sess = (over: Record<string, unknown>) => ({ id: String(Math.random()), status: 'completed_as_planned', template_key: 'mon', scheduled_date: '2026-10-26', session_date: '2026-10-26', rescheduled_to: null, deleted_at: null, ...over }) as never;

describe('attendance', () => {
  const today = '2026-11-10';
  it('counts done, partial, skipped and missed; pending days are not held against the user', () => {
    const results = matchOccurrences(
      [occ('2026-10-26'), occ('2026-11-02'), occ('2026-11-03', 'tue'), occ('2026-11-04', 'wed'), occ('2026-11-10'), occ('2026-11-17')],
      [sess({ scheduled_date: '2026-10-26' }), sess({ scheduled_date: '2026-11-02', status: 'partial' }), sess({ template_key: 'tue', scheduled_date: '2026-11-03', status: 'skipped' })],
      today,
    );
    expect(results.map((r) => r.outcome)).toEqual(['done', 'partial', 'skipped', 'missed', 'pending', 'pending']);
    const a = attendance(results);
    expect(a.planned).toBe(4);
    expect(a.attended).toBe(2);
    expect(a.rate).toBe(0.5);
    expect(a.pending).toBe(2);
  });
  it('follows a rescheduled session to its replacement', () => {
    const sessions = [
      sess({ scheduled_date: '2026-11-02', status: 'rescheduled', rescheduled_to: '2026-11-05' }),
      sess({ scheduled_date: '2026-11-05', session_date: '2026-11-05', status: 'completed_modified' }),
    ];
    expect(matchOccurrences([occ('2026-11-02')], sessions, today)[0]!.outcome).toBe('rescheduled_done');
    const future = [sess({ scheduled_date: '2026-11-02', status: 'rescheduled', rescheduled_to: '2026-11-12' })];
    expect(matchOccurrences([occ('2026-11-02')], future, today)[0]!.outcome).toBe('pending');
    const lost = [sess({ scheduled_date: '2026-11-02', status: 'rescheduled', rescheduled_to: '2026-11-05' })];
    expect(matchOccurrences([occ('2026-11-02')], lost, today)[0]!.outcome).toBe('missed');
  });
  it('has no rate when nothing was planned yet', () => {
    expect(attendance([]).rate).toBeNull();
    expect(attendance(matchOccurrences([occ('2026-11-17')], [], today)).rate).toBeNull();
  });
});

describe('exercise and prescription adherence', () => {
  const planned = { sets: 3, reps_min: 8 } as never;
  it('counts approved substitutions as adhered, skipped as not, ignores added work', () => {
    const r = exerciseAdherence([
      { origin: 'planned', status: 'completed', planned, completedWorkingSets: 3, repsPerSet: [10, 9, 8] },
      { origin: 'substituted', status: 'completed', planned, completedWorkingSets: 3, repsPerSet: [10, 10, 10] },
      { origin: 'planned', status: 'skipped', planned, completedWorkingSets: 0, repsPerSet: [] },
      { origin: 'added', status: 'completed', planned: null, completedWorkingSets: 4, repsPerSet: [12] },
    ]);
    expect(r).toEqual({ prescribed: 3, adhered: 2, rate: 2 / 3 });
  });
  it('scores closeness of sets and reps to the plan', () => {
    const perfect: SlotView = { origin: 'planned', status: 'completed', planned, completedWorkingSets: 3, repsPerSet: [8, 9, 12] };
    const short: SlotView = { origin: 'planned', status: 'completed', planned, completedWorkingSets: 3, repsPerSet: [4, 4, 4] };
    expect(prescriptionAdherence([perfect])).toBe(1);
    expect(prescriptionAdherence([short])).toBe(0.5);
    expect(prescriptionAdherence([{ ...perfect, completedWorkingSets: 2 }])).toBeCloseTo(2 / 3, 5);
    expect(prescriptionAdherence([])).toBeNull();
  });
});

describe('consistency streaks', () => {
  const r = (date: string, outcome: OccurrenceResult['outcome']): OccurrenceResult => ({ date, template_key: 'k', outcome, session_id: null });
  it('counts consecutive qualifying weeks (≥ 80% attended)', () => {
    const results = [
      r('2026-10-05', 'done'), r('2026-10-06', 'done'),                 // wk 10-05 ✓
      r('2026-10-12', 'done'), r('2026-10-13', 'missed'),               // wk 10-12 ✗ (50%)
      r('2026-10-19', 'done'), r('2026-10-20', 'done'),                 // wk 10-19 ✓
      r('2026-10-26', 'done'), r('2026-10-27', 'partial'),              // wk 10-26 ✓
    ];
    const s = weeklyStreaks(results, '2026-10-30', 1);
    expect(s.currentWeeks).toBe(2);
    expect(s.longestWeeks).toBe(2);
  });
  it('an unfinished current week extends but never breaks the streak', () => {
    const results = [r('2026-10-19', 'done'), r('2026-10-20', 'done'), r('2026-10-26', 'done'), r('2026-10-27', 'missed'), r('2026-10-28', 'pending')];
    const s = weeklyStreaks(results, '2026-10-28', 1);
    expect(s.currentWeeks).toBe(1);
  });
});
