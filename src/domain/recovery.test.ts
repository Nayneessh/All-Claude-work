import { describe, expect, it } from 'vitest';
import { correlate, readinessLabel, readinessScore } from './readiness';
import { bodyweightOn, rollingAverage, seriesOf, weeklyRate } from './body';
import { formatRepRange, parseRepRange, validateSetInput } from './validate';
import type { BodyMeasurement } from './types';

describe('readiness', () => {
  it('scores self-reported ratings 0–100 with negatives inverted', () => {
    expect(readinessScore({ sleep_quality: 5, energy: 5, soreness: 1, stress: 1, motivation: 5, perceived_recovery: 5, fatigue: 1 })).toBe(100);
    expect(readinessScore({ sleep_quality: 1, energy: 1, soreness: 5, stress: 5, motivation: 1, perceived_recovery: 1, fatigue: 5 })).toBe(0);
    expect(readinessScore({ sleep_quality: 3, energy: 3, soreness: 3, stress: 3, motivation: 3, perceived_recovery: 3, fatigue: 3 })).toBe(50);
  });
  it('needs at least 3 answers and labels results', () => {
    expect(readinessScore({ sleep_quality: 4, energy: null, soreness: null, stress: null, motivation: null, perceived_recovery: null, fatigue: null })).toBeNull();
    expect(readinessLabel(null)).toMatch(/Not enough/);
    expect(readinessLabel(80)).toBe('High');
    expect(readinessLabel(20)).toBe('Low');
  });
  it('reports correlation (not causation) only with enough pairs', () => {
    expect(correlate([1, 2, 3], [1, 2, 3])).toBeNull();
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const c = correlate(xs, xs.map((x) => x * 2 + 1))!;
    expect(c.r).toBeCloseTo(1, 9);
    expect(c.strength).toBe('strong');
    expect(c.note).toMatch(/does not show that one thing caused/);
    expect(correlate(xs, xs.map(() => 5))).toBeNull();
  });
});

const m = (date: string, kg: number | null): BodyMeasurement => ({ id: date, user_id: null, created_at: '', client_updated_at: '', deleted_at: null, device_id: null, measured_at: `${date}T08:00:00`, bodyweight_kg: kg, waist_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hip_cm: null, calf_cm: null, body_fat_pct: null, body_fat_method: null, muscle_mass_kg: null, conditions: null, notes: null });

describe('body metrics', () => {
  const rows = [m('2026-11-01', 80), m('2026-11-08', 80.5), m('2026-11-15', null), m('2026-11-22', 81.5), m('2026-11-29', 82)];
  it('skips missing values rather than reading them as zero', () => {
    expect(seriesOf(rows, 'bodyweight_kg').map((p) => p.value)).toEqual([80, 80.5, 81.5, 82]);
  });
  it('rolling average and weekly rate of change', () => {
    const s = seriesOf(rows, 'bodyweight_kg');
    expect(rollingAverage(s, 7)[1]!.value).toBeCloseTo(80.5, 5);
    expect(weeklyRate(s, '2026-11-29', 28)!).toBeCloseTo(0.5, 1);
    expect(weeklyRate(s.slice(0, 2), '2026-11-29', 28)).toBeNull();
  });
  it('finds the bodyweight in force on a date, else the fallback', () => {
    expect(bodyweightOn(rows, '2026-11-20')).toBe(80.5);
    expect(bodyweightOn(rows, '2026-10-01', 79)).toBe(79);
    expect(bodyweightOn(rows, '2026-10-01')).toBeNull();
  });
});

describe('input validation', () => {
  it('mirrors the database constraints', () => {
    expect(validateSetInput({ weight_kg: 100, reps: 8, rir: 2 })).toEqual([]);
    expect(validateSetInput({ weight_kg: -1 })).toHaveLength(1);
    expect(validateSetInput({ reps: 1.5 }).map((i) => i.field)).toContain('reps');
    expect(validateSetInput({ rpe: 11 })).toHaveLength(1);
    expect(validateSetInput({ rir: -1 })).toHaveLength(1);
    expect(validateSetInput({ tempo: '3-1-1' })).toEqual([]);
    expect(validateSetInput({ tempo: '1-0-X' })).toEqual([]);
    expect(validateSetInput({ tempo: 'fast' })).toHaveLength(1);
    expect(validateSetInput({ weight_kg: null, reps: null })).toEqual([]); // missing is allowed (not zero)
  });
  it('parses and formats rep ranges', () => {
    expect(parseRepRange('8-12')).toEqual([8, 12]);
    expect(parseRepRange('10')).toEqual([10, 10]);
    expect(parseRepRange('12–15')).toEqual([12, 15]);
    expect(parseRepRange('12-8')).toBeNull();
    expect(parseRepRange('abc')).toBeNull();
    expect(formatRepRange(8, 12)).toBe('8-12');
    expect(formatRepRange(10, 10)).toBe('10');
    expect(formatRepRange(null, null)).toBe('—');
  });
});
