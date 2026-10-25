import type { SetRecord } from './types';

export interface ValidationIssue { field: string; message: string }

/** Client-side validation that mirrors the database CHECK constraints so errors are caught before sync. */
export function validateSetInput(s: Partial<Pick<SetRecord, 'weight_kg' | 'reps' | 'reps_partial' | 'reps_assisted' | 'rpe' | 'rir' | 'duration_s' | 'distance_m' | 'tempo' | 'bodyweight_kg' | 'assist_kg'>>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const range = (field: string, v: number | null | undefined, min: number, max: number, label: string): void => {
    if (v === null || v === undefined) return;
    if (!Number.isFinite(v) || v < min || v > max) issues.push({ field, message: `${label} must be between ${min} and ${max}.` });
  };
  range('weight_kg', s.weight_kg, 0, 1500, 'Weight');
  range('reps', s.reps, 0, 1000, 'Reps');
  range('reps_partial', s.reps_partial, 0, 1000, 'Partial reps');
  range('reps_assisted', s.reps_assisted, 0, 1000, 'Cheat/assisted reps');
  range('rpe', s.rpe, 1, 10, 'RPE');
  range('rir', s.rir, 0, 10, 'RIR');
  range('duration_s', s.duration_s, 0, 86_400, 'Duration');
  range('distance_m', s.distance_m, 0, 1_000_000, 'Distance');
  range('bodyweight_kg', s.bodyweight_kg, 20, 500, 'Bodyweight');
  range('assist_kg', s.assist_kg, 0, 500, 'Assistance');
  if (s.reps !== null && s.reps !== undefined && !Number.isInteger(s.reps)) issues.push({ field: 'reps', message: 'Reps must be a whole number.' });
  if (s.tempo && !/^[0-9X]([-][0-9X]){2,3}$/i.test(s.tempo)) issues.push({ field: 'tempo', message: 'Tempo looks like 3-1-1 or 3-1-1-0.' });
  return issues;
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Parse "8-12", "10", "12-15" → [min, max]. Returns null for unparseable input. */
export function parseRepRange(input: string): [number, number] | null {
  const m = input.trim().match(/^(\d{1,3})\s*(?:[-–]\s*(\d{1,3}))?$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return b >= a ? [a, b] : null;
}

export function formatRepRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return '—';
  if (min === null || max === null || min === max) return String(min ?? max);
  return `${min}-${max}`;
}
