import { roundTo } from './units';

export const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

export interface PlateResult { perSide: number[]; achievedKg: number; exact: boolean; remainderKg: number }

/** Greedy plate loading for a barbell. Returns plates per side and what the bar will actually weigh. */
export function plateBreakdown(targetKg: number, barKg = 20, plates: number[] = DEFAULT_PLATES_KG): PlateResult {
  const sorted = [...plates].sort((a, b) => b - a);
  let rest = Math.max(0, (targetKg - barKg) / 2);
  const perSide: number[] = [];
  for (const p of sorted) {
    while (rest + 1e-9 >= p) { perSide.push(p); rest -= p; }
  }
  const achieved = barKg + perSide.reduce((a, b) => a + b, 0) * 2;
  return { perSide, achievedKg: achieved, exact: Math.abs(achieved - targetKg) < 1e-6, remainderKg: Math.max(0, targetKg - achieved) };
}

export interface WarmupStep { pct: number; reps: number; weight_kg: number }

/** Ramp-up suggestion for a heavy working weight. Skipped when the working weight is light. */
export function warmupSuggestions(workingKg: number, barKg = 20, stepKg = 2.5): WarmupStep[] {
  if (!(workingKg > barKg * 1.5)) return [];
  const ramp: [number, number][] = [[0.4, 8], [0.6, 5], [0.8, 3], [0.9, 1]];
  const steps: WarmupStep[] = [];
  for (const [pct, reps] of ramp) {
    const w = Math.max(barKg, roundTo(workingKg * pct, stepKg));
    if (w < workingKg && !steps.some((s) => s.weight_kg === w)) steps.push({ pct, reps, weight_kg: w });
  }
  return steps;
}
