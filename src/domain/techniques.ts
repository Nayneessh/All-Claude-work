import type { SetRecord, SetType, TechniqueCode } from './types';
import { roundTo } from './units';

/**
 * Last-set techniques from the routine, turned into guided component sets. Components are stored as
 * SEPARATE set records linked by parent_set_id, so advanced methods are never flattened into one ambiguous entry.
 */
export interface TechniqueDef {
  code: TechniqueCode;
  label: string;
  guidance: string;
  /** Guidance only — no extra component sets. */
  guidanceOnly: boolean;
  /** Offers a partial-reps field on the final set (reps_partial). */
  partialReps?: boolean;
  /** Offers a 'cheat/forced reps' field (reps_assisted). */
  cheatReps?: boolean;
  component?: { type: SetType; max: number; restS: number; repsMin: number; repsMax: number | null; dropPct?: number; label: string };
}

export const TECHNIQUES: Record<TechniqueCode, TechniqueDef> = {
  myo_rest_pause: {
    code: 'myo_rest_pause', label: 'Failure → 15 s → max reps → 15 s → max reps',
    guidance: 'Take the set to failure, rest 15 s, do max reps, rest 15 s, do max reps again. Same load.',
    guidanceOnly: false, component: { type: 'rest_pause', max: 2, restS: 15, repsMin: 1, repsMax: null, label: 'Rest-pause' },
  },
  half_reps_stretch: {
    code: 'half_reps_stretch', label: 'Failure → 5-8 half reps in the stretch',
    guidance: 'After failure, continue with 5-8 partial reps in the stretched position. Log them as partial reps.',
    guidanceOnly: false, partialReps: true,
  },
  drop_25: {
    code: 'drop_25', label: 'Failure → drop 25% → failure',
    guidance: 'Take the set to failure, drop the load by about 25%, continue to failure.',
    guidanceOnly: false, component: { type: 'drop', max: 1, restS: 10, repsMin: 1, repsMax: null, dropPct: 0.25, label: 'Drop set' },
  },
  double_drop: {
    code: 'double_drop', label: 'Failure → drop 25% → failure → drop again',
    guidance: 'Two consecutive drops of about 25% each, each taken to failure.',
    guidanceOnly: false, component: { type: 'drop', max: 2, restS: 10, repsMin: 1, repsMax: null, dropPct: 0.25, label: 'Drop set' },
  },
  myo_activation: {
    code: 'myo_activation', label: 'Activation set to failure, then 4-5 mini-sets of 3-5 reps, 15 s rest',
    guidance: 'One activation set to failure, then 4-5 mini-sets of 3-5 reps with 15 s rest between them. Same load.',
    guidanceOnly: false, component: { type: 'myo', max: 5, restS: 15, repsMin: 3, repsMax: 5, label: 'Myo-rep mini-set' },
  },
  negatives: {
    code: 'negatives', label: '3-s negatives after failure',
    guidance: 'After failure, add slow negatives (3 s lowering). Log them as a negative component.',
    guidanceOnly: false, component: { type: 'negative', max: 3, restS: 10, repsMin: 1, repsMax: null, label: 'Negative reps' },
  },
  rir1_no_failure: {
    code: 'rir1_no_failure', label: 'Last set RIR 1 — no failure with DBs',
    guidance: 'Stop the last set with about 1 rep left in reserve. Do not go to failure.', guidanceOnly: true,
  },
  no_failure: {
    code: 'no_failure', label: 'No failure — form first',
    guidance: 'Do not take sets to failure. Prioritise form on every rep.', guidanceOnly: true,
  },
  cheat_negative: {
    code: 'cheat_negative', label: 'Last set: 3-4 cheat reps, slow negative',
    guidance: 'After strict reps fail, add 3-4 cheat reps and lower each one slowly. Log them as cheat/forced reps.',
    guidanceOnly: false, cheatReps: true,
  },
};

export const techniqueFor = (code: TechniqueCode | null | undefined): TechniqueDef | null => (code ? TECHNIQUES[code] ?? null : null);

export interface ComponentSuggestion {
  set_type: SetType;
  weight_kg: number | null;
  planned_reps_min: number;
  planned_reps_max: number | null;
  rest_s: number;
  label: string;
}

type ParentLike = Pick<SetRecord, 'weight_kg'>;

/** Next component to offer after the parent set is done, or null once the technique's maximum is reached. */
export function nextComponent(code: TechniqueCode | null | undefined, parent: ParentLike, existingComponents: number, roundStepKg = 0.5): ComponentSuggestion | null {
  const def = techniqueFor(code);
  if (!def?.component) return null;
  const c = def.component;
  if (existingComponents >= c.max) return null;
  let weight = parent.weight_kg;
  if (c.dropPct && weight !== null) {
    // each successive drop is a further 25% off the previous drop
    weight = parent.weight_kg;
    for (let i = 0; i <= existingComponents; i++) weight = Math.max(roundTo((weight as number) * (1 - c.dropPct), roundStepKg), 0);
  }
  return { set_type: c.type, weight_kg: weight, planned_reps_min: c.repsMin, planned_reps_max: c.repsMax, rest_s: c.restS, label: c.label };
}
