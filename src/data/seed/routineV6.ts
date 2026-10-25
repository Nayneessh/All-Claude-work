import type { ISODate, PlannedFields, Program, TechniqueCode, WorkoutType } from '@/domain/types';
import type { PlanTree, PlannedRow, TemplateRow } from '@/domain/editScope';
import { seedId } from './exercises';
import { newId } from '../runtime';

/**
 * The user's own routine: "v6 · ARMS FIRST · CHEST = BACK · STARTS MON 26 OCT".
 * Transcribed row by row from the supplied sheet. Sets per week = 98
 * (Biceps 19 · Triceps 16 · Chest 14 · Back 14 — asserted in the test suite).
 * The sheet's "Start load (last logged)" becomes the first-session target; "Find 12RM"-style entries keep their
 * text as a load note and leave the numeric load empty (missing, not zero).
 */
export const ROUTINE_START_DATE: ISODate = '2026-10-26';

const T_RIR_NOFAIL = 'Last set RIR 1 — no failure with DBs';
const T_MYO_RP = 'Failure → 15 s → max reps → 15 s → max reps';
const T_HALF = 'Failure → 5-8 half reps in the stretch';
const T_DROP = 'Failure → drop 25% → failure';
const T_DDROP = 'Failure → drop 25% → failure → drop again';
const T_MYO_ACT = 'Activation set to failure, then 4-5 mini-sets of 3-5 reps, 15 s rest';

type Rest = [min: number | null, max: number | null, mode: 'after_set' | 'after_pair'];
const NO_REST: Rest = [null, null, 'after_set'];
const s = (sec: number): Rest => [sec, sec, 'after_set'];
const pair = (sec: number): Rest => [sec, sec, 'after_pair'];
const range = (a: number, b: number): Rest => [a, b, 'after_set'];

interface Line {
  label: string;
  ex: string;
  muscle: string;
  sets: number;
  reps: [number, number];
  rir: number;
  last?: boolean;
  rest: Rest;
  tempo: string;
  tech?: [TechniqueCode, string];
  load?: number | null;
  loadNote?: string;
  cue?: string;
}

interface Day { key: string; name: string; weekday: number; minutes: number; type: WorkoutType; muscles: string[]; notes: string; lines: Line[] }

const DAYS: Day[] = [
  {
    key: 'mon', name: 'Monday — Back #1 · Quads · Calves', weekday: 1, minutes: 30, type: 'strength', muscles: ['lats', 'quads', 'calves'],
    notes: 'MMA + 30 min. Log the MMA session separately with “Add activity”.',
    lines: [
      { label: 'A1', ex: 'underhand-lat-pulldown', muscle: 'Back width #1', sets: 3, reps: [8, 12], rir: 0, last: true, rest: NO_REST, tempo: '3-1-1', tech: ['myo_rest_pause', T_MYO_RP], load: 65, loadNote: '65 kg', cue: 'Elbows to hips. Superset A2.' },
      { label: 'A2', ex: 'leg-press', muscle: 'Quads #1', sets: 3, reps: [10, 12], rir: 2, rest: pair(90), tempo: '2-0-1', load: 80, loadNote: '80 kg', cue: 'No grinding post-MMA.' },
      { label: 'B1', ex: 'standing-calf-raise', muscle: 'Calves #1', sets: 3, reps: [12, 15], rir: 0, last: true, rest: s(60), tempo: '2-2-1', tech: ['myo_rest_pause', T_MYO_RP], load: null, loadNote: 'Find 15RM', cue: '2-s pause in the stretch.' },
    ],
  },
  {
    key: 'tue', name: 'Tuesday — Chest #1 · Delts #1 · Triceps #1', weekday: 2, minutes: 90, type: 'strength', muscles: ['chest_upper', 'delt_side', 'triceps_long'],
    notes: '90 min. Triceps #1 (6 sets).',
    lines: [
      { label: 'A1', ex: 'incline-db-press-30', muscle: 'Upper chest', sets: 4, reps: [6, 10], rir: 1, rest: range(150, 180), tempo: '3-1-1', tech: ['rir1_no_failure', T_RIR_NOFAIL], load: 22.5, loadNote: '22.5-25 kg/hand', cue: 'Primary chest lift.' },
      { label: 'B1', ex: 'low-to-high-cable-fly', muscle: 'Upper chest', sets: 3, reps: [10, 12], rir: 0, last: true, rest: NO_REST, tempo: '3-1-1', tech: ['half_reps_stretch', T_HALF], load: null, loadNote: 'Find 12RM', cue: 'Superset B2.' },
      { label: 'B2', ex: 'high-to-low-cable-fly', muscle: 'Lower chest', sets: 3, reps: [10, 12], rir: 0, last: true, rest: pair(90), tempo: '3-1-1', tech: ['drop_25', T_DROP], load: 35, loadNote: '35 kg/side' },
      { label: 'C1', ex: 'cable-lateral-raise', muscle: 'Side delt #1', sets: 3, reps: [12, 15], rir: 0, last: true, rest: NO_REST, tempo: '2-0-2', tech: ['drop_25', T_DROP], load: 10, loadNote: '10 kg', cue: 'Superset C2.' },
      { label: 'C2', ex: 'face-pull', muscle: 'Rear delt #1', sets: 2, reps: [15, 20], rir: 1, rest: pair(60), tempo: '2-1-1', load: 30, loadNote: '30 kg' },
      { label: 'D1', ex: 'db-shrug', muscle: 'Traps #1', sets: 2, reps: [10, 12], rir: 1, rest: s(60), tempo: '2-2-1', load: 35, loadNote: '35 kg/hand', cue: '2-s hold at top.' },
      { label: 'E1', ex: 'overhead-db-triceps-extension', muscle: 'Triceps LONG head #1', sets: 3, reps: [8, 12], rir: 0, last: true, rest: NO_REST, tempo: '3-1-1', tech: ['half_reps_stretch', T_HALF], load: null, loadNote: 'Find 10RM', cue: 'Two hands, one DB. Deep stretch. Superset E2.' },
      { label: 'E2', ex: 'rope-pushdown', muscle: 'Triceps lateral #1', sets: 3, reps: [10, 12], rir: 0, last: true, rest: pair(75), tempo: '2-1-1', tech: ['drop_25', T_DROP], load: 65, loadNote: '65 kg', cue: 'Spread the rope at the bottom.' },
    ],
  },
  {
    key: 'wed', name: 'Wednesday — Biceps #1 · Hamstrings · Calves', weekday: 3, minutes: 30, type: 'strength', muscles: ['biceps_short', 'hamstrings', 'calves'],
    notes: 'MMA + 30 min. Log the MMA session separately with “Add activity”.',
    lines: [
      { label: 'A1', ex: 'preacher-curl', muscle: 'Biceps short head #1', sets: 3, reps: [8, 12], rir: 0, last: true, rest: NO_REST, tempo: '3-1-1', tech: ['myo_activation', T_MYO_ACT], load: 10, loadNote: '10 kg/hand', cue: 'Isolated here as you asked. Superset A2.' },
      { label: 'A2', ex: 'leg-curl', muscle: 'Hamstrings #1', sets: 3, reps: [10, 12], rir: 1, rest: pair(90), tempo: '3-0-1', load: null, loadNote: 'Find 12RM' },
      { label: 'B1', ex: 'seated-calf-raise', muscle: 'Calves #2', sets: 3, reps: [12, 15], rir: 0, last: true, rest: s(60), tempo: '2-2-1', tech: ['myo_rest_pause', T_MYO_RP], load: null, loadNote: 'Find 15RM' },
    ],
  },
  {
    key: 'thu', name: 'Thursday — Back #2 · Shoulders #2 · Biceps', weekday: 4, minutes: 90, type: 'strength', muscles: ['lats', 'upper_back', 'delt_side', 'biceps_long'],
    notes: '90 min. Back #2 (free-weight compounds) · Shoulders #2 · Biceps (3 sets).',
    lines: [
      { label: 'A1', ex: 'pull-up', muscle: 'Back WIDTH', sets: 4, reps: [6, 12], rir: 1, rest: range(150, 180), tempo: '3-0-1', tech: ['negatives', 'Last set: 3-s negatives after failure'], load: null, loadNote: 'BW (log 5×8)', cue: '4×10 clean → add 2.5 kg.' },
      { label: 'B1', ex: 'chest-supported-t-bar-row', muscle: 'Back THICKNESS', sets: 4, reps: [6, 10], rir: 1, rest: s(150), tempo: '2-1-1', tech: ['myo_rest_pause', T_MYO_RP], load: 50, loadNote: '50 kg', cue: 'Heaviest row. 1-s squeeze at ribs.' },
      { label: 'C1', ex: 'pendlay-row', muscle: 'Back thickness (free weight)', sets: 3, reps: [6, 8], rir: 2, rest: s(150), tempo: '1-0-X', tech: ['no_failure', 'No failure — form first'], load: null, loadNote: 'Find 8RM (~60 kg)', cue: 'Bar from floor every rep. Flat back.' },
      { label: 'D1', ex: 'seated-db-overhead-press', muscle: 'Delts', sets: 3, reps: [6, 10], rir: 1, rest: s(150), tempo: '2-1-1', load: 20, loadNote: '20 kg/hand', cue: 'Off chest day.' },
      { label: 'E1', ex: 'db-cable-lateral-raise', muscle: 'Side delt #2', sets: 3, reps: [12, 15], rir: 0, last: true, rest: NO_REST, tempo: '2-0-2', tech: ['drop_25', T_DROP], load: 10, loadNote: '10 kg/hand', cue: 'Superset E2.' },
      { label: 'E2', ex: 'reverse-pec-deck', muscle: 'Rear delt #2', sets: 2, reps: [12, 15], rir: 0, last: true, rest: pair(60), tempo: '2-1-1', tech: ['drop_25', T_DROP], load: 30, loadNote: '30 kg' },
      { label: 'F1', ex: 'db-shrug', muscle: 'Traps #2', sets: 2, reps: [10, 12], rir: 1, rest: NO_REST, tempo: '2-2-1', load: 35, loadNote: '35 kg/hand', cue: 'Superset F2.' },
      { label: 'F2', ex: 'bayesian-cable-curl', muscle: 'Biceps LONG head #2', sets: 3, reps: [10, 12], rir: 0, last: true, rest: pair(75), tempo: '3-1-1', tech: ['myo_activation', T_MYO_ACT], load: null, loadNote: '~10-15 kg', cue: 'Face away from cable, arm behind body.' },
    ],
  },
  {
    key: 'fri', name: 'Friday — Chest #2 · Hamstrings · Quads', weekday: 5, minutes: 30, type: 'strength', muscles: ['chest_mid', 'hamstrings', 'quads'],
    notes: 'MMA + 30 min. Log the MMA session separately with “Add activity”.',
    lines: [
      { label: 'A1', ex: 'machine-chest-press', muscle: 'Chest #2', sets: 4, reps: [8, 10], rir: 0, last: true, rest: NO_REST, tempo: '3-1-1', tech: ['myo_rest_pause', T_MYO_RP], load: 80, loadNote: '80 kg', cue: 'Superset A2.' },
      { label: 'A2', ex: 'romanian-deadlift', muscle: 'Hamstrings #2', sets: 3, reps: [8, 10], rir: 2, rest: pair(120), tempo: '3-0-1', tech: ['no_failure', 'No failure'], load: 70, loadNote: '70 kg', cue: 'Straps — save grip for Saturday.' },
      { label: 'B1', ex: 'leg-extension', muscle: 'Quads #2', sets: 3, reps: [12, 15], rir: 0, last: true, rest: s(60), tempo: '2-1-1', tech: ['drop_25', T_DROP], load: 60, loadNote: '60 kg' },
    ],
  },
  {
    key: 'sat', name: 'Saturday — Arm Day (Biceps 13 · Triceps 10)', weekday: 6, minutes: 90, type: 'strength', muscles: ['biceps', 'triceps'],
    notes: '90 min arm day.',
    lines: [
      { label: 'A1', ex: 'close-grip-bench-press', muscle: 'Triceps mass', sets: 4, reps: [6, 8], rir: 1, rest: NO_REST, tempo: '2-1-1', tech: ['rir1_no_failure', 'Last set RIR 1 — use a spotter or safeties'], load: 60, loadNote: '60 kg', cue: 'Superset A2.' },
      { label: 'A2', ex: 'ez-bar-curl', muscle: 'Biceps mass', sets: 4, reps: [6, 10], rir: 1, rest: pair(150), tempo: '2-0-1', tech: ['cheat_negative', 'Last set: 3-4 cheat reps, slow negative'], load: null, loadNote: 'Find 8RM (~30 kg)' },
      { label: 'B1', ex: 'overhead-cable-extension', muscle: 'Triceps long head', sets: 3, reps: [10, 12], rir: 0, last: true, rest: NO_REST, tempo: '3-1-1', tech: ['half_reps_stretch', T_HALF], load: 30, loadNote: '30 kg', cue: 'Superset B2.' },
      { label: 'B2', ex: 'incline-db-curl', muscle: 'Biceps long head / peak', sets: 3, reps: [8, 12], rir: 0, last: true, rest: pair(120), tempo: '3-1-1', tech: ['half_reps_stretch', T_HALF], load: 12.5, loadNote: '12.5 kg/hand', cue: 'Arms hang behind torso.' },
      { label: 'C1', ex: 'wide-grip-cable-pushdown', muscle: 'Triceps lateral/medial', sets: 3, reps: [10, 12], rir: 0, last: true, rest: NO_REST, tempo: '2-1-1', tech: ['double_drop', T_DDROP], load: 60, loadNote: '60 kg', cue: 'Double drop on the last set. Superset C2.' },
      { label: 'C2', ex: 'standing-db-curl', muscle: 'Biceps', sets: 3, reps: [8, 12], rir: 0, last: true, rest: pair(90), tempo: '2-0-2', tech: ['drop_25', T_DROP], load: 17.5, loadNote: '17.5 kg/hand' },
      { label: 'D1', ex: 'hammer-curl', muscle: 'Brachialis / forearm', sets: 3, reps: [10, 12], rir: 0, last: true, rest: s(75), tempo: '2-0-1', tech: ['myo_rest_pause', T_MYO_RP], load: 12.5, loadNote: '12.5 kg/hand', cue: 'Finisher. Grip gives out last.' },
    ],
  },
];

export const ROUTINE_V6_DAYS = DAYS;
export const ROUTINE_V6_WEEKLY_SETS = DAYS.reduce((a, d) => a + d.lines.reduce((b, l) => b + l.sets, 0), 0);

export type ProgramDraft = Pick<Program, 'name' | 'description' | 'goal' | 'methodology' | 'split' | 'source' | 'status' | 'start_date' | 'end_date' | 'duration_weeks' | 'weekly_frequency' | 'deload_weeks' | 'progression_method' | 'target_notes' | 'notes' | 'is_template' | 'paused_intervals' | 'cloned_from'>;

export function routineV6Program(start: ISODate = ROUTINE_START_DATE): ProgramDraft {
  return {
    name: 'v6 · Arms First · Chest = Back',
    description: 'Mon–Sat, Sunday complete rest. Difficulty comes from intensity on the LAST set, not from junk sets.',
    goal: 'hypertrophy',
    methodology: 'Arms first, chest = back volume. Intensity techniques on the last set only.',
    split: 'Mon Back/Quads/Calves · Tue Chest/Delts/Triceps · Wed Biceps/Hams/Calves · Thu Back/Shoulders/Biceps · Fri Chest/Hams/Quads · Sat Arms',
    source: 'Own routine (v6)',
    status: 'active',
    start_date: start,
    end_date: null,
    duration_weeks: null,
    weekly_frequency: 6,
    deload_weeks: [],
    progression_method: 'Double progression: reach the top of the rep range on every set, then add load.',
    target_notes: `${ROUTINE_V6_WEEKLY_SETS} sets/week. Biceps 19 · Triceps 16 · Chest 14 · Back 14.`,
    notes: null,
    is_template: false,
    paused_intervals: [],
    cloned_from: null,
  };
}

/** Builds the full version-1 tree. Keys (template_key / plan_key) are fresh ids that stay stable across future versions. */
export function routineV6Tree(): PlanTree {
  const templates: TemplateRow[] = [];
  const planned: PlannedRow[] = [];
  for (const d of DAYS) {
    const template_key = newId();
    templates.push({ template_key, name: d.name, weekday: d.weekday, sequence: 0, workout_type: d.type, target_muscles: d.muscles, est_duration_min: d.minutes, warmup: null, notes: d.notes });
    d.lines.forEach((l, i) => {
      const fields: PlannedFields = {
        position: i, label: l.label, superset_group: l.label.slice(0, 1), exercise_id: seedId(l.ex), muscle_label: l.muscle, sets: l.sets,
        reps_min: l.reps[0], reps_max: l.reps[1], rir_target: l.rir, rir_last_only: l.last ?? false, rpe_target: null,
        rest_min_s: l.rest[0], rest_max_s: l.rest[1], rest_mode: l.rest[2], tempo: l.tempo,
        technique_code: l.tech?.[0] ?? null, technique_text: l.tech?.[1] ?? null,
        start_load_kg: l.load ?? null, load_note: l.loadNote ?? null, duration_target_s: null, distance_target_m: null,
        cue: l.cue ?? null, notes: null, is_optional: false,
      };
      planned.push({ ...fields, plan_key: newId(), template_key });
    });
  }
  return { templates, planned };
}
