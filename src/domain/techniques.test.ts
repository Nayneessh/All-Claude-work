import { describe, expect, it } from 'vitest';
import { nextComponent, TECHNIQUES, techniqueFor } from './techniques';
import { plateBreakdown, warmupSuggestions } from './plates';

describe('last-set techniques', () => {
  it('drop set: 25% off the parent, rounded to the plate step, one component', () => {
    const c = nextComponent('drop_25', { weight_kg: 40 }, 0)!;
    expect(c.set_type).toBe('drop');
    expect(c.weight_kg).toBe(30);
    expect(nextComponent('drop_25', { weight_kg: 40 }, 1)).toBeNull();
  });
  it('double drop: each drop is a further 25% off', () => {
    expect(nextComponent('double_drop', { weight_kg: 60 }, 0)!.weight_kg).toBe(45);
    expect(nextComponent('double_drop', { weight_kg: 60 }, 1)!.weight_kg).toBe(34); // 60 → 45 → 33.75 → 34 (0.5 step)
    expect(nextComponent('double_drop', { weight_kg: 60 }, 2)).toBeNull();
  });
  it('rest-pause: same load, 15 s rest, two segments', () => {
    const c = nextComponent('myo_rest_pause', { weight_kg: 65 }, 0)!;
    expect(c).toMatchObject({ set_type: 'rest_pause', weight_kg: 65, rest_s: 15 });
    expect(nextComponent('myo_rest_pause', { weight_kg: 65 }, 2)).toBeNull();
  });
  it('myo-reps: up to 5 mini-sets of 3–5 reps with 15 s rest', () => {
    const c = nextComponent('myo_activation', { weight_kg: 10 }, 0)!;
    expect(c).toMatchObject({ set_type: 'myo', planned_reps_min: 3, planned_reps_max: 5, rest_s: 15 });
    expect(nextComponent('myo_activation', { weight_kg: 10 }, 4)).not.toBeNull();
    expect(nextComponent('myo_activation', { weight_kg: 10 }, 5)).toBeNull();
  });
  it('guidance-only and field-based techniques create no component sets', () => {
    for (const code of ['no_failure', 'rir1_no_failure', 'half_reps_stretch', 'cheat_negative'] as const) expect(nextComponent(code, { weight_kg: 50 }, 0)).toBeNull();
    expect(TECHNIQUES.half_reps_stretch.partialReps).toBe(true);
    expect(TECHNIQUES.cheat_negative.cheatReps).toBe(true);
    expect(techniqueFor(null)).toBeNull();
  });
  it('handles a missing parent weight (bodyweight / unknown load)', () => {
    expect(nextComponent('drop_25', { weight_kg: null }, 0)!.weight_kg).toBeNull();
  });
});

describe('plates and warm-ups', () => {
  it('loads a barbell per side', () => {
    const r = plateBreakdown(100, 20);
    expect(r.perSide).toEqual([25, 15]);
    expect(r.exact).toBe(true);
    expect(plateBreakdown(61, 20, [25, 20, 10, 5]).exact).toBe(false);
    expect(plateBreakdown(20, 20).perSide).toEqual([]);
  });
  it('suggests an ascending ramp only for heavy lifts', () => {
    const w = warmupSuggestions(100, 20, 2.5);
    expect(w.map((x) => x.weight_kg)).toEqual([40, 60, 80, 90]);
    expect(w.every((x) => x.weight_kg < 100)).toBe(true);
    expect(warmupSuggestions(25, 20)).toEqual([]);
  });
});
