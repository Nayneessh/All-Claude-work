import type { Exercise, SetRecord } from './types';

/**
 * Volume conventions (documented in docs/DATA_MODEL.md — "Calculation conventions"):
 *  - Only COMPLETED, non-warm-up sets count towards working totals. Warm-ups are reported separately.
 *  - Volume load = external load (kg) × completed reps. It is a practical tracking metric, not physical work.
 *  - Missing data is not zero: a set without a usable load/reps is excluded and flagged, never counted as 0.
 *  - per-hand dumbbell loads are counted as logged (not doubled) unless `doublePerHand` is on.
 *  - Unilateral work: each side is its own set record; reps and volume are counted for every side performed.
 *  - Bodyweight reps use bodyweight × exercise.bodyweight_fraction + added load (needs a bodyweight; otherwise unknown).
 *  - Assisted reps use max(bodyweight − assistance, 0).
 *  - Duration/distance-only movements have no volume load (their own totals are reported).
 *  - Drop / rest-pause / myo components keep their own load and reps and DO add to volume,
 *    but count as one working set (the parent). Partial reps are tracked separately and excluded.
 */
export interface VolumeOptions {
  doublePerHand?: boolean;
  bodyweightKg?: number | null;
  unratedCountsAsHard?: boolean;
}

export type ExLike = Pick<Exercise, 'tracking_method' | 'load_mode' | 'bodyweight_fraction'>;
export type SetLike = Pick<
  SetRecord,
  | 'status' | 'set_type' | 'parent_set_id' | 'weight_kg' | 'reps' | 'reps_partial' | 'duration_s' | 'distance_m'
  | 'assist_kg' | 'bodyweight_kg' | 'rir' | 'rpe' | 'failure'
> & { deleted_at?: string | null };

export const isCompleted = (s: Pick<SetRecord, 'status'> & { deleted_at?: string | null }): boolean =>
  s.status === 'completed' && !s.deleted_at;
export const isWarmup = (s: Pick<SetRecord, 'set_type'>): boolean => s.set_type === 'warmup';
export const isComponent = (s: Pick<SetRecord, 'parent_set_id'>): boolean => s.parent_set_id !== null && s.parent_set_id !== undefined;

/** A "working set" for counting: completed, not a warm-up, not a technique component. */
export const isCountedWorkingSet = (s: SetLike): boolean => isCompleted(s) && !isWarmup(s) && !isComponent(s);
/** Work that contributes reps/volume: completed, not a warm-up (components included). */
export const isWorkSet = (s: SetLike): boolean => isCompleted(s) && !isWarmup(s);

export function effectiveLoadKg(s: SetLike, ex: ExLike, opts: VolumeOptions = {}): number | null {
  switch (ex.tracking_method) {
    case 'weight_reps': {
      if (s.weight_kg === null || s.weight_kg === undefined) return null;
      const mult = ex.load_mode === 'per_hand' && opts.doublePerHand ? 2 : 1;
      return s.weight_kg * mult;
    }
    case 'bodyweight_reps': {
      const bw = s.bodyweight_kg ?? opts.bodyweightKg ?? null;
      if (bw === null) return null;
      return bw * ex.bodyweight_fraction + (s.weight_kg ?? 0);
    }
    case 'assisted_reps': {
      const bw = s.bodyweight_kg ?? opts.bodyweightKg ?? null;
      if (bw === null || s.assist_kg === null || s.assist_kg === undefined) return null;
      return Math.max(bw * ex.bodyweight_fraction - s.assist_kg, 0);
    }
    default:
      return null;
  }
}

/** Volume load of one set in kg, or null when it cannot be computed (missing data ≠ 0). */
export function setVolumeKg(s: SetLike, ex: ExLike, opts: VolumeOptions = {}): number | null {
  if (!isWorkSet(s)) return null;
  if (s.reps === null || s.reps === undefined) return null;
  const load = effectiveLoadKg(s, ex, opts);
  if (load === null) return null;
  return load * s.reps;
}

export function isHardSet(s: SetLike, opts: VolumeOptions = {}): boolean {
  if (!isCountedWorkingSet(s)) return false;
  if (s.failure === 'muscular' || s.failure === 'technical') return true;
  if (s.rir !== null && s.rir !== undefined) return s.rir <= 3;
  if (s.rpe !== null && s.rpe !== undefined) return s.rpe >= 7;
  return opts.unratedCountsAsHard ?? true;
}

export interface Totals {
  workingSets: number;
  warmupSets: number;
  hardSets: number;
  reps: number;
  partialReps: number;
  volumeKg: number;
  /** Work sets whose volume could not be computed (missing load / bodyweight). */
  unknownVolumeSets: number;
  durationS: number;
  distanceM: number;
}

export const emptyTotals = (): Totals => ({
  workingSets: 0, warmupSets: 0, hardSets: 0, reps: 0, partialReps: 0, volumeKg: 0, unknownVolumeSets: 0, durationS: 0, distanceM: 0,
});

export function addSetToTotals(t: Totals, s: SetLike, ex: ExLike, opts: VolumeOptions = {}): void {
  if (!isCompleted(s)) return;
  if (isWarmup(s)) {
    if (!isComponent(s)) t.warmupSets += 1;
    return;
  }
  if (!isComponent(s)) {
    t.workingSets += 1;
    if (isHardSet(s, opts)) t.hardSets += 1;
  }
  if (s.reps !== null && s.reps !== undefined) t.reps += s.reps;
  if (s.reps_partial) t.partialReps += s.reps_partial;
  if (s.duration_s) t.durationS += s.duration_s;
  if (s.distance_m) t.distanceM += s.distance_m;
  const v = setVolumeKg(s, ex, opts);
  if (v === null) {
    if (ex.tracking_method === 'weight_reps' || ex.tracking_method === 'bodyweight_reps' || ex.tracking_method === 'assisted_reps') {
      t.unknownVolumeSets += 1;
    }
  } else {
    t.volumeKg += v;
  }
}

export function totalsFor(sets: SetLike[], exOf: (s: SetLike) => ExLike | undefined, opts: VolumeOptions = {}): Totals {
  const t = emptyTotals();
  for (const s of sets) {
    const ex = exOf(s);
    if (ex) addSetToTotals(t, s, ex, opts);
  }
  return t;
}
