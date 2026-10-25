/** Training classifications (not measurements of activated muscle fibres). */
export type MuscleGroup =
  | 'chest' | 'back' | 'traps' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'adductors' | 'calves' | 'core';

export interface MuscleDef { label: string; group: MuscleGroup }

export const MUSCLES: Record<string, MuscleDef> = {
  chest_upper: { label: 'Upper chest', group: 'chest' },
  chest_mid: { label: 'Mid chest', group: 'chest' },
  chest_lower: { label: 'Lower chest', group: 'chest' },
  lats: { label: 'Lats', group: 'back' },
  upper_back: { label: 'Upper back', group: 'back' },
  lower_back: { label: 'Spinal erectors', group: 'back' },
  traps: { label: 'Traps', group: 'traps' },
  delt_front: { label: 'Front delts', group: 'shoulders' },
  delt_side: { label: 'Side delts', group: 'shoulders' },
  delt_rear: { label: 'Rear delts', group: 'shoulders' },
  biceps_long: { label: 'Biceps (long head)', group: 'biceps' },
  biceps_short: { label: 'Biceps (short head)', group: 'biceps' },
  biceps: { label: 'Biceps', group: 'biceps' },
  brachialis: { label: 'Brachialis', group: 'biceps' },
  triceps_long: { label: 'Triceps (long head)', group: 'triceps' },
  triceps_lateral: { label: 'Triceps (lateral/medial)', group: 'triceps' },
  triceps: { label: 'Triceps', group: 'triceps' },
  forearms: { label: 'Forearms', group: 'forearms' },
  quads: { label: 'Quads', group: 'quads' },
  hamstrings: { label: 'Hamstrings', group: 'hamstrings' },
  glutes: { label: 'Glutes', group: 'glutes' },
  adductors: { label: 'Adductors', group: 'adductors' },
  calves: { label: 'Calves', group: 'calves' },
  abs: { label: 'Abs', group: 'core' },
  obliques: { label: 'Obliques', group: 'core' },
  trunk: { label: 'Trunk stabilisers', group: 'core' },
};

export const GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest', back: 'Back', traps: 'Traps', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', adductors: 'Adductors',
  calves: 'Calves', core: 'Core',
};

export const GROUP_ORDER: MuscleGroup[] = [
  'chest', 'back', 'traps', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'core',
];

export const muscleLabel = (id: string): string => MUSCLES[id]?.label ?? id;
export const groupOf = (muscleId: string): MuscleGroup | null => MUSCLES[muscleId]?.group ?? null;

export interface MuscleCredit { muscle: string; group: MuscleGroup; weight: number }

/**
 * Per-set muscle credit. 'direct' counts only primary muscles (1 set each — matches how a program
 * sheet counts "Biceps 19"). 'weighted' also gives secondary muscles partial credit
 * (default 0.5): an ESTIMATE, never a count of every set for every involved muscle.
 * A muscle listed twice (e.g. two heads of one group) is credited once per group per set.
 */
export function muscleCredits(
  ex: { primary_muscles: string[]; secondary_muscles: string[] },
  mode: 'direct' | 'weighted',
  secondaryWeight = 0.5,
): MuscleCredit[] {
  const byGroup = new Map<MuscleGroup, MuscleCredit>();
  const add = (muscle: string, weight: number): void => {
    const group = groupOf(muscle);
    if (!group) return;
    const cur = byGroup.get(group);
    if (!cur || weight > cur.weight) byGroup.set(group, { muscle, group, weight });
  };
  for (const m of ex.primary_muscles) add(m, 1);
  if (mode === 'weighted') for (const m of ex.secondary_muscles) add(m, secondaryWeight);
  return [...byGroup.values()];
}
