import { describe, expect, it } from 'vitest';
import { plateBreakdown, warmupSuggestions } from './plates';

describe('plate calculator', () => {
  it('loads a 100 kg bar as 25 + 15 per side on a 20 kg bar', () => {
    const r = plateBreakdown(100, 20);
    expect(r.perSide).toEqual([25, 15]);
    expect(r).toMatchObject({ achievedKg: 100, exact: true, remainderKg: 0 });
  });
  it('is exact for 62.5 kg using the small plates', () => {
    const r = plateBreakdown(62.5, 20);
    expect(r.perSide).toEqual([20, 1.25]);
    expect(r.achievedKg).toBe(62.5);
  });
  it('says so when the target cannot be loaded exactly (never silently rounds)', () => {
    const odd = plateBreakdown(60.3, 20); // smallest plate is 0.5 kg per side, so 60.3 kg is not buildable
    expect(odd.exact).toBe(false);
    expect(odd.remainderKg).toBeGreaterThan(0);
    expect(odd.achievedKg).toBeLessThan(60.3);
  });
  it('a target at or below the bar needs no plates', () => {
    expect(plateBreakdown(15, 20).perSide).toEqual([]);
    expect(plateBreakdown(20, 20).achievedKg).toBe(20);
  });
});

describe('warm-up suggestions', () => {
  it('ramps up to a heavy working weight and never reaches it', () => {
    const w = warmupSuggestions(100);
    expect(w.map((s) => s.weight_kg)).toEqual([40, 60, 80, 90]);
    expect(w.every((s) => s.weight_kg < 100)).toBe(true);
    expect(w.map((s) => s.reps)).toEqual([8, 5, 3, 1]);
  });
  it('suggests nothing for a light working weight', () => {
    expect(warmupSuggestions(25)).toEqual([]);
    expect(warmupSuggestions(30)).toEqual([]);
  });
  it('never suggests a weight below the empty bar and never repeats a step', () => {
    const w = warmupSuggestions(35);
    expect(w.every((s) => s.weight_kg >= 20)).toBe(true);
    expect(new Set(w.map((s) => s.weight_kg)).size).toBe(w.length);
  });
});
