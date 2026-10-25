import type { ISODate, SetRecord } from './types';
import { e1rmForSet, type E1rmFormula } from './e1rm';
import { type ExLike, effectiveLoadKg, isCompleted, isWarmup, setVolumeKg } from './volume';

/**
 * Personal records are DERIVED, never stored: replaying the set history in order means a historical
 * correction automatically re-computes every record that depended on it (no invalidation needed).
 * The first ever result for a record type is a BASELINE (is_baseline = true) and is not celebrated.
 */
export type PrType =
  | 'max_weight'
  | 'max_reps_at_weight'
  | 'best_e1rm'
  | 'actual_1rm'
  | 'max_set_volume'
  | 'max_reps'
  | 'longest_duration'
  | 'longest_distance'
  | 'best_pace';

export const PR_LABELS: Record<PrType, string> = {
  max_weight: 'Heaviest load',
  max_reps_at_weight: 'Most reps at a load',
  best_e1rm: 'Best estimated 1RM',
  actual_1rm: 'Best tested 1RM',
  max_set_volume: 'Highest set volume',
  max_reps: 'Most reps in a set',
  longest_duration: 'Longest hold / duration',
  longest_distance: 'Longest distance',
  best_pace: 'Fastest pace',
};

export type PrSet = Pick<
  SetRecord,
  | 'id' | 'session_id' | 'exercise_id' | 'session_date' | 'set_number' | 'set_type' | 'parent_set_id' | 'status' | 'weight_kg'
  | 'reps' | 'reps_partial' | 'duration_s' | 'distance_m' | 'assist_kg' | 'bodyweight_kg' | 'rir' | 'rpe' | 'failure' | 'rom'
  | 'completed_at' | 'created_at'
> & { deleted_at?: string | null };

export interface PrEvent {
  type: PrType;
  exercise_id: string;
  set_id: string;
  session_id: string;
  date: ISODate;
  value: number;
  weight_kg: number | null;
  reps: number | null;
  previous_value: number | null;
  improvement_abs: number | null;
  improvement_pct: number | null;
  estimated: boolean;
  formula?: E1rmFormula;
  is_baseline: boolean;
}

export interface PrOptions {
  formula?: E1rmFormula;
  doublePerHand?: boolean;
  bodyweightKg?: number | null;
  enabled?: PrType[];
}

const EPS = 1e-6;
const bucket = (kg: number): number => Math.round(kg * 10) / 10;

export function sortChronologically<T extends Pick<PrSet, 'session_date' | 'set_number' | 'completed_at' | 'created_at'>>(sets: T[]): T[] {
  return [...sets].sort((a, b) => {
    if (a.session_date !== b.session_date) return a.session_date < b.session_date ? -1 : 1;
    const ta = a.completed_at ?? a.created_at;
    const tb = b.completed_at ?? b.created_at;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.set_number - b.set_number;
  });
}

/**
 * Replays one exercise's history (all sessions) and returns every record event in order.
 * Exercises are treated separately — a variation is a different exercise unless deliberately mapped.
 */
export function detectPrs(allSets: PrSet[], ex: ExLike, opts: PrOptions = {}): PrEvent[] {
  const enabled = new Set<PrType>(opts.enabled ?? (Object.keys(PR_LABELS) as PrType[]));
  const sets = sortChronologically(allSets.filter((s) => isCompleted(s) && !isWarmup(s) && s.parent_set_id === null));
  const best = new Map<string, number>();
  const events: PrEvent[] = [];
  const volOpts = { doublePerHand: opts.doublePerHand, bodyweightKg: opts.bodyweightKg };

  const consider = (s: PrSet, type: PrType, key: string, value: number | null, extra: Partial<PrEvent> = {}): void => {
    if (value === null || !Number.isFinite(value) || value <= 0 || !enabled.has(type)) return;
    // best_pace: lower is better, handled by negating through the caller (value passed as 1/pace)
    const prev = best.get(key);
    if (prev !== undefined && value <= prev + EPS) return;
    const isBaseline = prev === undefined;
    best.set(key, value);
    events.push({
      type,
      exercise_id: s.exercise_id,
      set_id: s.id,
      session_id: s.session_id,
      date: s.session_date,
      value,
      weight_kg: s.weight_kg,
      reps: s.reps,
      previous_value: prev ?? null,
      improvement_abs: prev === undefined ? null : value - prev,
      improvement_pct: prev === undefined ? null : ((value - prev) / prev) * 100,
      estimated: false,
      is_baseline: isBaseline,
      ...extra,
    });
  };

  // Group sets by session so the working-set components (drop, rest-pause…) can be included in set volume.
  const componentsOf = new Map<string, PrSet[]>();
  for (const s of allSets) {
    if (s.parent_set_id && isCompleted(s)) {
      const arr = componentsOf.get(s.parent_set_id) ?? [];
      arr.push(s);
      componentsOf.set(s.parent_set_id, arr);
    }
  }

  for (const s of sets) {
    switch (ex.tracking_method) {
      case 'weight_reps': {
        if (s.weight_kg === null || s.reps === null || s.reps < 1) break;
        const load = effectiveLoadKg(s, ex, volOpts) ?? s.weight_kg;
        consider(s, 'max_weight', 'max_weight', load);
        consider(s, 'max_reps_at_weight', `reps@${bucket(load)}`, s.reps);
        const e = e1rmForSet(s, ex, { formula: opts.formula });
        if (e) {
          consider(s, 'best_e1rm', 'best_e1rm', e.value, { estimated: !e.tested, formula: e.formula });
          if (e.tested) consider(s, 'actual_1rm', 'actual_1rm', s.weight_kg);
        }
        const v = setVolumeKg(s, ex, volOpts);
        consider(s, 'max_set_volume', 'max_set_volume', v);
        break;
      }
      case 'bodyweight_reps':
      case 'assisted_reps': {
        if (s.reps === null || s.reps < 1) break;
        consider(s, 'max_reps', 'max_reps', s.reps);
        if (ex.tracking_method === 'bodyweight_reps' && s.weight_kg) consider(s, 'max_weight', 'max_weight', s.weight_kg);
        const v = setVolumeKg(s, ex, volOpts);
        consider(s, 'max_set_volume', 'max_set_volume', v);
        break;
      }
      case 'duration':
      case 'weight_duration':
        consider(s, 'longest_duration', 'longest_duration', s.duration_s);
        if (ex.tracking_method === 'weight_duration' && s.weight_kg) consider(s, 'max_weight', 'max_weight', s.weight_kg);
        break;
      case 'distance':
        consider(s, 'longest_distance', 'longest_distance', s.distance_m);
        break;
      case 'distance_duration':
        consider(s, 'longest_distance', 'longest_distance', s.distance_m);
        consider(s, 'longest_duration', 'longest_duration', s.duration_s);
        if (s.distance_m && s.distance_m >= 1000 && s.duration_s && s.duration_s > 0) {
          // faster pace = bigger speed; value reported as speed in m/s so "higher is better" holds
          const speed = s.distance_m / s.duration_s;
          consider(s, 'best_pace', 'best_pace', speed);
        }
        break;
    }
  }

  // Set-volume PRs include technique components (a drop set's work counts towards the parent set).
  if (enabled.has('max_set_volume') && ex.tracking_method === 'weight_reps' && componentsOf.size > 0) {
    // Recompute max_set_volume including components: drop earlier events and rebuild.
    const without = events.filter((e) => e.type !== 'max_set_volume');
    let bestVol: number | undefined;
    const rebuilt: PrEvent[] = [];
    for (const s of sets) {
      const own = setVolumeKg(s, ex, volOpts);
      if (own === null) continue;
      const comp = (componentsOf.get(s.id) ?? []).reduce((a, c) => a + (setVolumeKg(c, ex, volOpts) ?? 0), 0);
      const total = own + comp;
      if (bestVol === undefined || total > bestVol + EPS) {
        rebuilt.push({
          type: 'max_set_volume', exercise_id: s.exercise_id, set_id: s.id, session_id: s.session_id, date: s.session_date,
          value: total, weight_kg: s.weight_kg, reps: s.reps, previous_value: bestVol ?? null,
          improvement_abs: bestVol === undefined ? null : total - bestVol,
          improvement_pct: bestVol === undefined ? null : ((total - bestVol) / bestVol) * 100,
          estimated: false, is_baseline: bestVol === undefined,
        });
        bestVol = total;
      }
    }
    return [...without, ...rebuilt].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  }

  return events;
}

/** Per-session summary: the final (best) event per record type reached in that session; baselines excluded. */
export function prsInSession(events: PrEvent[], sessionId: string): PrEvent[] {
  const byType = new Map<PrType, PrEvent>();
  for (const e of events) {
    if (e.session_id !== sessionId || e.is_baseline) continue;
    byType.set(e.type, e);
  }
  return [...byType.values()];
}

export function prsInRange(events: PrEvent[], from: ISODate, to: ISODate, includeBaselines = false): PrEvent[] {
  return events.filter((e) => e.date >= from && e.date <= to && (includeBaselines || !e.is_baseline));
}

/** Current best per record type (all-time). */
export function currentBests(events: PrEvent[]): Map<PrType, PrEvent> {
  const m = new Map<PrType, PrEvent>();
  for (const e of events) m.set(e.type, e);
  return m;
}
