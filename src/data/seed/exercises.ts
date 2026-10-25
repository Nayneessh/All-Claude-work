import { v5 as uuidv5 } from 'uuid';
import type { Exercise, ExerciseCategory, Laterality, LoadMode, MovementPattern, ResistanceType, TrackingMethod } from '@/domain/types';

/** Fixed namespace: the same seed_key always yields the same id on every device and in the SQL seed. */
export const SEED_NAMESPACE = '6f1e2b9c-3a4d-4e8f-9b1a-0c5d7e2f4a11';
export const SEED_VERSION = 1;
export const seedId = (key: string): string => uuidv5(key, SEED_NAMESPACE);

interface S {
  key: string;
  name: string;
  cat: ExerciseCategory;
  p: string[];
  s?: string[];
  mp?: MovementPattern;
  eq: string;
  lat?: Laterality;
  res?: ResistanceType;
  tm?: TrackingMethod;
  lm?: LoadMode;
  bwf?: number;
  alias?: string[];
  cues?: string;
  tech?: string;
  tempo?: string;
  rest?: number;
  diff?: number;
  sub?: string[];
  var?: string;
  vlabel?: string;
}

const COMPOUND = 'compound';
const ISO = 'isolation';

/* eslint-disable max-len */
export const SEED: S[] = [
  // ── Back ──────────────────────────────────────────────────────────────────
  { key: 'underhand-lat-pulldown', name: 'Underhand Lat Pulldown', cat: COMPOUND, p: ['lats'], s: ['biceps_short', 'upper_back'], mp: 'pull', eq: 'cable', res: 'cable', cues: 'Elbows to hips. Chest up, slight lean back, pull to the upper chest.', tech: 'Sit with thighs locked under the pad. Underhand shoulder-width grip. Drive the elbows down and back; control the way up to a full stretch.', rest: 120, diff: 1, sub: ['lat-pulldown-wide', 'neutral-grip-pulldown', 'chin-up'] },
  { key: 'lat-pulldown-wide', name: 'Lat Pulldown (wide grip)', cat: COMPOUND, p: ['lats'], s: ['biceps_short', 'upper_back'], mp: 'pull', eq: 'cable', res: 'cable', alias: ['Wide Pulldown'], diff: 1, sub: ['underhand-lat-pulldown', 'pull-up'] },
  { key: 'neutral-grip-pulldown', name: 'Neutral-Grip Pulldown', cat: COMPOUND, p: ['lats'], s: ['biceps_short', 'upper_back'], mp: 'pull', eq: 'cable', res: 'cable', diff: 1, sub: ['underhand-lat-pulldown'] },
  { key: 'pull-up', name: 'Pull-up', cat: COMPOUND, p: ['lats'], s: ['biceps_short', 'upper_back', 'forearms'], mp: 'pull', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', cues: 'Full hang to chin over the bar. No kipping. Log added weight as external load.', tech: 'Overhand grip just outside shoulder width. Start from a dead hang, pull the elbows down and back until the chin clears the bar, lower under control.', rest: 150, diff: 3, sub: ['lat-pulldown-wide', 'assisted-pull-up'], var: 'chin-up', vlabel: 'Overhand grip' },
  { key: 'chin-up', name: 'Chin-up', cat: COMPOUND, p: ['lats', 'biceps_short'], s: ['upper_back'], mp: 'pull', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', diff: 3, sub: ['underhand-lat-pulldown', 'assisted-pull-up'] },
  { key: 'assisted-pull-up', name: 'Assisted Pull-up (machine)', cat: COMPOUND, p: ['lats'], s: ['biceps_short', 'upper_back'], mp: 'pull', eq: 'machine', res: 'machine', tm: 'assisted_reps', lm: 'assisted', diff: 1, sub: ['lat-pulldown-wide'] },
  { key: 'chest-supported-t-bar-row', name: 'Chest-Supported T-Bar Row', cat: COMPOUND, p: ['upper_back', 'lats'], s: ['biceps_short', 'delt_rear'], mp: 'pull', eq: 'machine', res: 'machine', cues: 'Heaviest row. 1-s squeeze at the ribs. No body English.', rest: 150, diff: 2, sub: ['seated-cable-row', 'barbell-row'] },
  { key: 'pendlay-row', name: 'Pendlay / Barbell Row', cat: COMPOUND, p: ['upper_back', 'lats'], s: ['lower_back', 'biceps_short', 'delt_rear'], mp: 'pull', eq: 'barbell', cues: 'Bar from the floor every rep. Flat back, torso near parallel, no jerking.', tech: 'Reset the bar on the floor for each rep. Explosive pull to the lower chest, controlled lowering.', rest: 150, diff: 4, sub: ['barbell-row', 'chest-supported-t-bar-row'] },
  { key: 'barbell-row', name: 'Bent-Over Barbell Row', cat: COMPOUND, p: ['upper_back', 'lats'], s: ['lower_back', 'biceps_short', 'delt_rear'], mp: 'pull', eq: 'barbell', rest: 150, diff: 3, sub: ['pendlay-row', 'seated-cable-row'] },
  { key: 'seated-cable-row', name: 'Seated Cable Row', cat: COMPOUND, p: ['upper_back', 'lats'], s: ['biceps_short', 'delt_rear'], mp: 'pull', eq: 'cable', res: 'cable', diff: 1, sub: ['chest-supported-t-bar-row'] },
  { key: 'one-arm-db-row', name: 'One-Arm Dumbbell Row', cat: COMPOUND, p: ['lats', 'upper_back'], s: ['biceps_short'], mp: 'pull', eq: 'dumbbell', lat: 'unilateral', lm: 'per_hand', diff: 2, sub: ['seated-cable-row'] },
  { key: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown', cat: ISO, p: ['lats'], mp: 'pull', eq: 'cable', res: 'cable', diff: 1 },
  { key: 'deadlift', name: 'Deadlift', cat: COMPOUND, p: ['hamstrings', 'glutes', 'lower_back'], s: ['upper_back', 'traps', 'forearms', 'quads'], mp: 'hinge', eq: 'barbell', rest: 240, diff: 5, sub: ['romanian-deadlift', 'rack-pull'] },
  { key: 'rack-pull', name: 'Rack Pull', cat: COMPOUND, p: ['lower_back', 'upper_back', 'traps'], s: ['glutes', 'hamstrings', 'forearms'], mp: 'hinge', eq: 'barbell', rest: 240, diff: 3, sub: ['deadlift'] },
  { key: 'back-extension', name: 'Back Extension', cat: ISO, p: ['lower_back'], s: ['glutes', 'hamstrings'], mp: 'extension', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0.6, diff: 1 },
  { key: 'db-shrug', name: 'DB Shrug', cat: ISO, p: ['traps'], s: ['forearms'], mp: 'pull', eq: 'dumbbell', lm: 'per_hand', cues: '2-s hold at the top. Straight up, no rolling.', sub: ['barbell-shrug'] },
  { key: 'barbell-shrug', name: 'Barbell Shrug', cat: ISO, p: ['traps'], s: ['forearms'], mp: 'pull', eq: 'barbell', sub: ['db-shrug'] },
  // ── Chest ─────────────────────────────────────────────────────────────────
  { key: 'incline-db-press-30', name: 'Incline DB Press (30°)', cat: COMPOUND, p: ['chest_upper'], s: ['delt_front', 'triceps_long'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', cues: 'Primary chest lift. 30° bench, elbows ~45° from the torso, full stretch at the bottom.', tech: 'Set the bench to 30°. Press the dumbbells up and slightly together; lower until the chest stretches, wrists stacked over elbows.', rest: 180, diff: 2, sub: ['incline-barbell-press', 'machine-chest-press'] },
  { key: 'incline-barbell-press', name: 'Incline Barbell Press', cat: COMPOUND, p: ['chest_upper'], s: ['delt_front', 'triceps_long'], mp: 'push', eq: 'barbell', rest: 180, diff: 3, sub: ['incline-db-press-30'] },
  { key: 'barbell-bench-press', name: 'Barbell Bench Press', cat: COMPOUND, p: ['chest_mid'], s: ['delt_front', 'triceps_long', 'chest_upper'], mp: 'push', eq: 'barbell', rest: 180, diff: 3, sub: ['db-bench-press', 'machine-chest-press'] },
  { key: 'db-bench-press', name: 'Dumbbell Bench Press', cat: COMPOUND, p: ['chest_mid'], s: ['delt_front', 'triceps_long'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', rest: 150, diff: 2, sub: ['barbell-bench-press', 'machine-chest-press'] },
  { key: 'machine-chest-press', name: 'Machine Chest Press', cat: COMPOUND, p: ['chest_mid'], s: ['delt_front', 'triceps_long'], mp: 'push', eq: 'machine', res: 'machine', rest: 120, diff: 1, sub: ['db-bench-press', 'push-up'] },
  { key: 'push-up', name: 'Push-up', cat: COMPOUND, p: ['chest_mid'], s: ['delt_front', 'triceps_long'], mp: 'push', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0.65, diff: 1, sub: ['machine-chest-press'] },
  { key: 'low-to-high-cable-fly', name: 'Low-to-High Cable Fly', cat: ISO, p: ['chest_upper'], s: ['delt_front'], mp: 'push', eq: 'cable', res: 'cable', lm: 'per_side', cues: 'Arc the handles up to eye level; squeeze at the top.', diff: 1, sub: ['incline-db-fly'] },
  { key: 'high-to-low-cable-fly', name: 'High-to-Low Cable Fly', cat: ISO, p: ['chest_lower'], s: ['delt_front'], mp: 'push', eq: 'cable', res: 'cable', lm: 'per_side', diff: 1, sub: ['pec-deck'] },
  { key: 'incline-db-fly', name: 'Incline Dumbbell Fly', cat: ISO, p: ['chest_upper'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', diff: 2, sub: ['low-to-high-cable-fly'] },
  { key: 'pec-deck', name: 'Pec Deck Fly', cat: ISO, p: ['chest_mid'], mp: 'push', eq: 'machine', res: 'machine', diff: 1, sub: ['high-to-low-cable-fly'] },
  { key: 'chest-dip', name: 'Chest Dip', cat: COMPOUND, p: ['chest_lower'], s: ['triceps_long', 'delt_front'], mp: 'push', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', diff: 3 },
  // ── Shoulders ─────────────────────────────────────────────────────────────
  { key: 'seated-db-overhead-press', name: 'Seated DB Overhead Press', cat: COMPOUND, p: ['delt_front', 'delt_side'], s: ['triceps_long'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', cues: 'Off chest day. Back supported, press slightly forward of the ears.', rest: 150, diff: 2, sub: ['machine-shoulder-press', 'barbell-overhead-press'] },
  { key: 'barbell-overhead-press', name: 'Barbell Overhead Press', cat: COMPOUND, p: ['delt_front', 'delt_side'], s: ['triceps_long', 'upper_back'], mp: 'push', eq: 'barbell', rest: 180, diff: 4, sub: ['seated-db-overhead-press'] },
  { key: 'machine-shoulder-press', name: 'Machine Shoulder Press', cat: COMPOUND, p: ['delt_front', 'delt_side'], s: ['triceps_long'], mp: 'push', eq: 'machine', res: 'machine', diff: 1, sub: ['seated-db-overhead-press'] },
  { key: 'arnold-press', name: 'Arnold Press', cat: COMPOUND, p: ['delt_front', 'delt_side'], s: ['triceps_long'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', diff: 3 },
  { key: 'cable-lateral-raise', name: 'Cable Lateral Raise', cat: ISO, p: ['delt_side'], mp: 'push', eq: 'cable', res: 'cable', lat: 'unilateral', cues: 'Lead with the elbow, stop at shoulder height, constant tension.', diff: 1, sub: ['db-cable-lateral-raise', 'machine-lateral-raise'] },
  { key: 'db-cable-lateral-raise', name: 'DB / Cable Lateral Raise', cat: ISO, p: ['delt_side'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', diff: 1, sub: ['cable-lateral-raise'] },
  { key: 'machine-lateral-raise', name: 'Machine Lateral Raise', cat: ISO, p: ['delt_side'], mp: 'push', eq: 'machine', res: 'machine', diff: 1 },
  { key: 'face-pull', name: 'Face Pull', cat: ISO, p: ['delt_rear'], s: ['upper_back', 'traps'], mp: 'pull', eq: 'cable', res: 'cable', cues: 'Rope to the forehead, elbows high, externally rotate at the end.', diff: 1, sub: ['reverse-pec-deck'] },
  { key: 'reverse-pec-deck', name: 'Reverse Pec Deck', cat: ISO, p: ['delt_rear'], s: ['upper_back'], mp: 'pull', eq: 'machine', res: 'machine', diff: 1, sub: ['face-pull', 'rear-delt-fly'] },
  { key: 'rear-delt-fly', name: 'Rear Delt Fly (dumbbell)', cat: ISO, p: ['delt_rear'], s: ['upper_back'], mp: 'pull', eq: 'dumbbell', lm: 'per_hand', diff: 2, sub: ['reverse-pec-deck'] },
  { key: 'front-raise', name: 'Front Raise', cat: ISO, p: ['delt_front'], mp: 'push', eq: 'dumbbell', lm: 'per_hand', diff: 1 },
  { key: 'upright-row', name: 'Upright Row', cat: COMPOUND, p: ['delt_side', 'traps'], s: ['biceps_short'], mp: 'pull', eq: 'barbell', diff: 2 },
  // ── Biceps ────────────────────────────────────────────────────────────────
  { key: 'preacher-curl', name: 'Preacher Curl', cat: ISO, p: ['biceps_short'], s: ['brachialis'], mp: 'flexion', eq: 'dumbbell', lm: 'per_hand', lat: 'unilateral', cues: 'Isolated short-head work. Full stretch, no swinging off the pad.', diff: 1, sub: ['ez-bar-curl', 'cable-curl'] },
  { key: 'ez-bar-curl', name: 'EZ-Bar Curl', cat: ISO, p: ['biceps'], s: ['brachialis'], mp: 'flexion', eq: 'ezbar', cues: 'Elbows pinned. Last set: 3-4 cheat reps with a slow negative.', diff: 1, sub: ['barbell-curl', 'db-curl'] },
  { key: 'barbell-curl', name: 'Barbell Curl', cat: ISO, p: ['biceps'], s: ['brachialis'], mp: 'flexion', eq: 'barbell', diff: 1, sub: ['ez-bar-curl'] },
  { key: 'incline-db-curl', name: 'Incline DB Curl (both arms)', cat: ISO, p: ['biceps_long'], s: ['brachialis'], mp: 'flexion', eq: 'dumbbell', lm: 'per_hand', cues: 'Arms hang behind the torso for a deep stretch on the long head.', diff: 1, sub: ['bayesian-cable-curl'] },
  { key: 'standing-db-curl', name: 'Standing DB Curl (supinating)', cat: ISO, p: ['biceps'], s: ['brachialis'], mp: 'flexion', eq: 'dumbbell', lm: 'per_hand', cues: 'Supinate (turn the palm up) as you curl.', diff: 1, sub: ['ez-bar-curl'] },
  { key: 'hammer-curl', name: 'Hammer Curl', cat: ISO, p: ['brachialis'], s: ['forearms', 'biceps_long'], mp: 'flexion', eq: 'dumbbell', lm: 'per_hand', cues: 'Finisher. Neutral grip; the grip gives out last.', diff: 1, sub: ['cable-hammer-curl'] },
  { key: 'cable-hammer-curl', name: 'Cable Rope Hammer Curl', cat: ISO, p: ['brachialis'], s: ['forearms'], mp: 'flexion', eq: 'cable', res: 'cable', diff: 1, sub: ['hammer-curl'] },
  { key: 'bayesian-cable-curl', name: 'Bayesian Cable Curl', cat: ISO, p: ['biceps_long'], s: ['brachialis'], mp: 'flexion', eq: 'cable', res: 'cable', lat: 'unilateral', cues: 'Face away from the cable, arm behind the body, stretch at the bottom.', diff: 2, sub: ['incline-db-curl'] },
  { key: 'cable-curl', name: 'Cable Curl', cat: ISO, p: ['biceps'], s: ['brachialis'], mp: 'flexion', eq: 'cable', res: 'cable', diff: 1 },
  { key: 'concentration-curl', name: 'Concentration Curl', cat: ISO, p: ['biceps_short'], mp: 'flexion', eq: 'dumbbell', lat: 'unilateral', lm: 'per_hand', diff: 1 },
  { key: 'db-curl', name: 'Dumbbell Curl', cat: ISO, p: ['biceps'], s: ['brachialis'], mp: 'flexion', eq: 'dumbbell', lm: 'per_hand', diff: 1 },
  // ── Triceps ───────────────────────────────────────────────────────────────
  { key: 'overhead-db-triceps-extension', name: 'Overhead DB Triceps Extension', cat: ISO, p: ['triceps_long'], mp: 'extension', eq: 'dumbbell', cues: 'Two hands, one DB. Deep stretch behind the head, elbows pointing up.', diff: 1, sub: ['overhead-cable-extension'] },
  { key: 'overhead-cable-extension', name: 'Overhead Cable Extension', cat: ISO, p: ['triceps_long'], mp: 'extension', eq: 'cable', res: 'cable', diff: 1, sub: ['overhead-db-triceps-extension'] },
  { key: 'rope-pushdown', name: 'Rope Pushdown', cat: ISO, p: ['triceps_lateral'], mp: 'extension', eq: 'cable', res: 'cable', cues: 'Spread the rope at the bottom. Elbows glued to the sides.', diff: 1, sub: ['wide-grip-cable-pushdown'] },
  { key: 'wide-grip-cable-pushdown', name: 'Wide-Grip Cable Pushdown', cat: ISO, p: ['triceps_lateral'], mp: 'extension', eq: 'cable', res: 'cable', diff: 1, sub: ['rope-pushdown'] },
  { key: 'straight-bar-pushdown', name: 'Straight-Bar Pushdown', cat: ISO, p: ['triceps_lateral'], mp: 'extension', eq: 'cable', res: 'cable', diff: 1 },
  { key: 'close-grip-bench-press', name: 'Close-Grip Bench Press', cat: COMPOUND, p: ['triceps'], s: ['chest_mid', 'delt_front'], mp: 'push', eq: 'barbell', cues: 'Hands about shoulder width. Use a spotter or safeties on the last set.', rest: 150, diff: 3, sub: ['triceps-dip'] },
  { key: 'skull-crusher', name: 'EZ-Bar Skull Crusher', cat: ISO, p: ['triceps_long'], mp: 'extension', eq: 'ezbar', diff: 2 },
  { key: 'triceps-dip', name: 'Triceps Dip', cat: COMPOUND, p: ['triceps'], s: ['chest_lower', 'delt_front'], mp: 'push', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', diff: 3 },
  { key: 'triceps-kickback', name: 'Cable Triceps Kickback', cat: ISO, p: ['triceps_lateral'], mp: 'extension', eq: 'cable', res: 'cable', lat: 'unilateral', diff: 1 },
  // ── Quads / legs ─────────────────────────────────────────────────────────
  { key: 'leg-press', name: 'Leg Press', cat: COMPOUND, p: ['quads'], s: ['glutes', 'adductors'], mp: 'squat', eq: 'machine', res: 'machine', cues: 'No grinding post-MMA. Controlled depth, never lock out hard.', rest: 120, diff: 1, sub: ['hack-squat', 'back-squat'] },
  { key: 'hack-squat', name: 'Hack Squat', cat: COMPOUND, p: ['quads'], s: ['glutes'], mp: 'squat', eq: 'machine', res: 'machine', rest: 150, diff: 2, sub: ['leg-press'] },
  { key: 'back-squat', name: 'Back Squat', cat: COMPOUND, p: ['quads', 'glutes'], s: ['adductors', 'lower_back'], mp: 'squat', eq: 'barbell', rest: 240, diff: 4, sub: ['leg-press', 'hack-squat', 'front-squat'] },
  { key: 'front-squat', name: 'Front Squat', cat: COMPOUND, p: ['quads'], s: ['glutes', 'upper_back'], mp: 'squat', eq: 'barbell', rest: 240, diff: 5, sub: ['back-squat'] },
  { key: 'goblet-squat', name: 'Goblet Squat', cat: COMPOUND, p: ['quads'], s: ['glutes'], mp: 'squat', eq: 'dumbbell', diff: 1 },
  { key: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', cat: COMPOUND, p: ['quads', 'glutes'], s: ['adductors'], mp: 'lunge', eq: 'dumbbell', lat: 'unilateral', lm: 'per_hand', diff: 4 },
  { key: 'walking-lunge', name: 'Walking Lunge', cat: COMPOUND, p: ['quads', 'glutes'], s: ['hamstrings'], mp: 'lunge', eq: 'dumbbell', lat: 'alternating', lm: 'per_hand', diff: 3 },
  { key: 'leg-extension', name: 'Leg Extension', cat: ISO, p: ['quads'], mp: 'extension', eq: 'machine', res: 'machine', diff: 1, sub: ['leg-press'] },
  { key: 'romanian-deadlift', name: 'Romanian Deadlift', cat: COMPOUND, p: ['hamstrings', 'glutes'], s: ['lower_back', 'forearms'], mp: 'hinge', eq: 'barbell', cues: 'Straps — save grip for Saturday. Hips back, bar close, soft knees.', tempo: '3-0-1', rest: 120, diff: 3, sub: ['leg-curl'] },
  { key: 'leg-curl', name: 'Seated / Lying Leg Curl', cat: ISO, p: ['hamstrings'], mp: 'flexion', eq: 'machine', res: 'machine', diff: 1, sub: ['nordic-curl'] },
  { key: 'nordic-curl', name: 'Nordic Curl', cat: ISO, p: ['hamstrings'], mp: 'flexion', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0.5, diff: 5 },
  { key: 'hip-thrust', name: 'Barbell Hip Thrust', cat: COMPOUND, p: ['glutes'], s: ['hamstrings'], mp: 'hinge', eq: 'barbell', rest: 150, diff: 2 },
  { key: 'glute-bridge', name: 'Glute Bridge', cat: COMPOUND, p: ['glutes'], s: ['hamstrings'], mp: 'hinge', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0.5, diff: 1 },
  { key: 'hip-abduction', name: 'Hip Abduction Machine', cat: ISO, p: ['glutes'], mp: 'other', eq: 'machine', res: 'machine', diff: 1 },
  { key: 'hip-adduction', name: 'Hip Adduction Machine', cat: ISO, p: ['adductors'], mp: 'other', eq: 'machine', res: 'machine', diff: 1 },
  { key: 'step-up', name: 'Dumbbell Step-up', cat: COMPOUND, p: ['quads', 'glutes'], mp: 'lunge', eq: 'dumbbell', lat: 'unilateral', lm: 'per_hand', diff: 2 },
  // ── Calves ────────────────────────────────────────────────────────────────
  { key: 'standing-calf-raise', name: 'Standing Calf Raise', cat: ISO, p: ['calves'], mp: 'extension', eq: 'machine', res: 'machine', cues: '2-s pause in the stretch. Full range, no bouncing.', tempo: '2-2-1', rest: 60, diff: 1, sub: ['seated-calf-raise', 'leg-press-calf-raise'] },
  { key: 'seated-calf-raise', name: 'Seated Calf Raise', cat: ISO, p: ['calves'], mp: 'extension', eq: 'machine', res: 'machine', rest: 60, diff: 1, sub: ['standing-calf-raise'] },
  { key: 'leg-press-calf-raise', name: 'Leg Press Calf Raise', cat: ISO, p: ['calves'], mp: 'extension', eq: 'machine', res: 'machine', diff: 1 },
  // ── Core ──────────────────────────────────────────────────────────────────
  { key: 'plank', name: 'Plank', cat: 'isometric', p: ['abs'], s: ['trunk'], mp: 'other', eq: 'bodyweight', res: 'bodyweight', tm: 'duration', lm: 'bodyweight', diff: 1 },
  { key: 'side-plank', name: 'Side Plank', cat: 'isometric', p: ['obliques'], s: ['trunk'], mp: 'other', eq: 'bodyweight', res: 'bodyweight', tm: 'duration', lat: 'unilateral', lm: 'bodyweight', diff: 2 },
  { key: 'hanging-leg-raise', name: 'Hanging Leg Raise', cat: ISO, p: ['abs'], s: ['forearms'], mp: 'flexion', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0.4, diff: 3 },
  { key: 'cable-crunch', name: 'Cable Crunch', cat: ISO, p: ['abs'], mp: 'flexion', eq: 'cable', res: 'cable', diff: 1 },
  { key: 'ab-wheel', name: 'Ab Wheel Rollout', cat: ISO, p: ['abs'], s: ['trunk'], mp: 'extension', eq: 'other', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0.5, diff: 4 },
  { key: 'pallof-press', name: 'Pallof Press', cat: ISO, p: ['obliques'], s: ['trunk'], mp: 'rotation', eq: 'cable', res: 'cable', lat: 'unilateral', diff: 1 },
  { key: 'russian-twist', name: 'Russian Twist', cat: ISO, p: ['obliques'], s: ['abs'], mp: 'rotation', eq: 'other', diff: 1 },
  { key: 'dead-bug', name: 'Dead Bug', cat: ISO, p: ['abs'], s: ['trunk'], mp: 'other', eq: 'bodyweight', res: 'bodyweight', tm: 'bodyweight_reps', lm: 'bodyweight', bwf: 0, diff: 1 },
  { key: 'farmers-walk', name: "Farmer's Walk", cat: 'conditioning', p: ['forearms', 'traps'], s: ['trunk', 'glutes'], mp: 'carry', eq: 'dumbbell', tm: 'weight_duration', lm: 'per_hand', diff: 2 },
  { key: 'dead-hang', name: 'Dead Hang', cat: 'isometric', p: ['forearms', 'lats'], mp: 'pull', eq: 'bodyweight', res: 'bodyweight', tm: 'duration', lm: 'bodyweight', diff: 1 },
  { key: 'wall-sit', name: 'Wall Sit', cat: 'isometric', p: ['quads'], mp: 'squat', eq: 'bodyweight', res: 'bodyweight', tm: 'duration', lm: 'bodyweight', diff: 1 },
  // ── Cardio & conditioning ────────────────────────────────────────────────
  { key: 'running', name: 'Running', cat: 'cardio', p: ['quads', 'calves'], s: ['hamstrings', 'glutes'], mp: 'gait', eq: 'none', res: 'none', tm: 'distance_duration', lm: 'bodyweight', diff: 2 },
  { key: 'incline-treadmill-walk', name: 'Incline Treadmill Walk', cat: 'cardio', p: ['glutes', 'calves'], mp: 'gait', eq: 'machine', res: 'none', tm: 'distance_duration', lm: 'bodyweight', diff: 1 },
  { key: 'walking', name: 'Walking', cat: 'cardio', p: ['quads', 'calves'], mp: 'gait', eq: 'none', res: 'none', tm: 'distance_duration', lm: 'bodyweight', diff: 1 },
  { key: 'cycling', name: 'Cycling', cat: 'cardio', p: ['quads'], s: ['glutes', 'calves'], mp: 'gait', eq: 'machine', res: 'none', tm: 'distance_duration', lm: 'bodyweight', diff: 1 },
  { key: 'rowing-machine', name: 'Rowing Machine', cat: 'cardio', p: ['lats', 'quads'], s: ['upper_back', 'biceps_short'], mp: 'pull', eq: 'machine', res: 'none', tm: 'distance_duration', lm: 'bodyweight', diff: 2 },
  { key: 'swimming', name: 'Swimming', cat: 'cardio', p: ['lats', 'delt_front'], mp: 'other', eq: 'none', res: 'none', tm: 'distance_duration', lm: 'bodyweight', diff: 2 },
  { key: 'jump-rope', name: 'Jump Rope', cat: 'cardio', p: ['calves'], mp: 'gait', eq: 'other', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 2 },
  { key: 'stair-climber', name: 'Stair Climber', cat: 'cardio', p: ['glutes', 'quads'], mp: 'gait', eq: 'machine', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 2 },
  { key: 'hiit-intervals', name: 'HIIT Intervals', cat: 'conditioning', p: ['quads'], mp: 'other', eq: 'none', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 3 },
  { key: 'sled-push', name: 'Sled Push', cat: 'conditioning', p: ['quads', 'glutes'], mp: 'push', eq: 'other', tm: 'weight_duration', diff: 3 },
  // ── Sport, mobility, stretching ──────────────────────────────────────────
  { key: 'mma-training', name: 'MMA Training', cat: 'sport', p: [], mp: 'other', eq: 'none', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 3 },
  { key: 'boxing', name: 'Boxing / Pad Work', cat: 'sport', p: [], mp: 'rotation', eq: 'none', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 3 },
  { key: 'bjj', name: 'Brazilian Jiu-Jitsu', cat: 'sport', p: [], mp: 'other', eq: 'none', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 3 },
  { key: 'yoga', name: 'Yoga Flow', cat: 'mobility', p: [], mp: 'other', eq: 'none', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 1 },
  { key: 'hip-flexor-stretch', name: 'Hip Flexor Stretch', cat: 'stretching', p: [], mp: 'other', eq: 'bodyweight', res: 'none', tm: 'duration', lat: 'unilateral', lm: 'bodyweight', diff: 1 },
  { key: 'hamstring-stretch', name: 'Hamstring Stretch', cat: 'stretching', p: [], mp: 'other', eq: 'bodyweight', res: 'none', tm: 'duration', lat: 'unilateral', lm: 'bodyweight', diff: 1 },
  { key: 'worlds-greatest-stretch', name: "World's Greatest Stretch", cat: 'mobility', p: [], mp: 'other', eq: 'bodyweight', res: 'none', tm: 'duration', lat: 'alternating', lm: 'bodyweight', diff: 1 },
  { key: 'thoracic-rotation', name: 'Thoracic Spine Rotation', cat: 'mobility', p: [], mp: 'rotation', eq: 'bodyweight', res: 'none', tm: 'duration', lat: 'alternating', lm: 'bodyweight', diff: 1 },
  { key: 'shoulder-dislocates', name: 'Band Shoulder Dislocates', cat: 'mobility', p: [], mp: 'other', eq: 'band', res: 'band', tm: 'duration', lm: 'bodyweight', diff: 1 },
  { key: 'cat-cow', name: 'Cat-Cow', cat: 'mobility', p: [], mp: 'other', eq: 'bodyweight', res: 'none', tm: 'duration', lm: 'bodyweight', diff: 1 },
];
/* eslint-enable max-len */

export function toExerciseRow(s: S): Exercise {
  const t = '2026-01-01T00:00:00.000Z';
  const byKey = new Map(SEED.map((x) => [x.key, x]));
  return {
    id: seedId(s.key),
    user_id: null,
    seed_key: s.key,
    name: s.name,
    aliases: s.alias ?? [],
    category: s.cat,
    primary_muscles: s.p,
    secondary_muscles: s.s ?? [],
    movement_pattern: s.mp ?? null,
    equipment: s.eq,
    laterality: s.lat ?? 'bilateral',
    position: null,
    resistance_type: s.res ?? 'free_weight',
    tracking_method: s.tm ?? 'weight_reps',
    load_mode: s.lm ?? 'total',
    bodyweight_fraction: s.bwf ?? 1,
    technique: s.tech ?? null,
    cues: s.cues ?? null,
    demo_url: null,
    default_tempo: s.tempo ?? null,
    default_rest_s: s.rest ?? null,
    difficulty: s.diff ?? null,
    substitute_ids: (s.sub ?? []).filter((k) => byKey.has(k)).map(seedId),
    variation_of: s.var && byKey.has(s.var) ? seedId(s.var) : null,
    variation_label: s.vlabel ?? null,
    is_custom: false,
    archived_at: null,
    notes: null,
    seed_version: SEED_VERSION,
    created_at: t,
    client_updated_at: t,
    deleted_at: null,
    device_id: null,
  };
}

export const SEED_ROWS: Exercise[] = SEED.map(toExerciseRow);
