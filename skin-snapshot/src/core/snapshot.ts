// Builds the visitor-facing snapshot view-model from validated analysis. This is where the
// safety invariants are enforced a second time:
//   * a stopped case never yields observations, a routine or a booking prompt
//   * a routine is shown only for the maintenance path, with no restriction, no path mismatch,
//     and an approved (or clearly labelled sample) template
import type { Answers } from './questionnaire';
import { selectRoutine, type RoutineTemplate, type SelectedRoutine } from './routine';
import type { SafetyState } from './safety';
import type { NormalisedObservation } from './validate-output';
import { ZONES, type AssessedConfidence, type PathId, type Zone } from './types';

export type NextStep = 'recommended_talk' | 'optional_talk' | 'see_dermatologist';
export type RoutineHeld = null | 'safety' | 'restriction' | 'path_mismatch' | 'no_template' | 'not_maintenance';

export interface SnapshotRow {
  attribute: NormalisedObservation['attribute'];
  finding: string | null;
  side: NormalisedObservation['side'];
  confidence: NormalisedObservation['confidence'];
  reason: string | null;
}

export interface SnapshotVM {
  path: PathId;
  stopped: boolean;
  /** Only populated for a stopped case: which gate(s) raised it. */
  safetySource: 'answers' | 'image' | 'both' | null;
  zones: { zone: Zone; rows: SnapshotRow[] }[];
  bestFit: { path: PathId; confidence: AssessedConfidence; differs: boolean };
  pathMismatch: boolean;
  nextStep: NextStep;
  showBooking: boolean;
  routine: SelectedRoutine | null;
  routineHeld: RoutineHeld;
  talkQuestions: string[];
  qualityFair: boolean;
  expectKey: string | null;
}

export interface SnapshotInput {
  path: PathId;
  answers: Answers;
  safety: SafetyState;
  observations: NormalisedObservation[];
  bestFit: { path: PathId; confidence: AssessedConfidence };
  quality: 'good' | 'fair' | 'poor';
  templates: readonly RoutineTemplate[];
  allowSampleRoutines: boolean;
}

export function stoppedSnapshot(path: PathId, safety: SafetyState): SnapshotVM {
  const hasAnswers = safety.flags.some((f) => f.source === 'answers');
  const hasImage = safety.flags.some((f) => f.source === 'image');
  return {
    path,
    stopped: true,
    safetySource: hasAnswers && hasImage ? 'both' : hasImage ? 'image' : 'answers',
    zones: [],
    bestFit: { path, confidence: 'not_sure', differs: false },
    pathMismatch: false,
    nextStep: 'see_dermatologist',
    showBooking: false,
    routine: null,
    routineHeld: 'safety',
    talkQuestions: [],
    qualityFair: false,
    expectKey: null,
  };
}

const ORDER = (f: string | null, list: readonly string[]) => (f ? list.indexOf(f) : -1);

export function pickTalkQuestions(path: PathId, rows: readonly NormalisedObservation[]): string[] {
  const has = (attr: string, minIndex: number, list: readonly string[]) =>
    rows.some((r) => r.attribute === attr && r.confidence !== 'not_assessed' && ORDER(r.finding, list) >= minIndex);
  const out: string[] = [];
  if (path === 'maintenance') out.push('talk.routine_fit', 'talk.sun_care');
  if (has('texture', 1, ['smooth', 'slightly_uneven', 'uneven', 'rough_patches'])) out.push('talk.texture');
  if (has('dark_patches', 1, ['none_visible', 'faint', 'noticeable', 'pronounced'])) out.push('talk.darker_areas');
  if (has('breakouts', 1, ['none_visible', 'few_small', 'several', 'many'])) out.push('talk.breakouts');
  if (has('redness', 1, ['none_visible', 'mild', 'moderate', 'marked'])) out.push('talk.redness');
  if (has('marks_scars', 1, ['none_visible', 'few_flat_marks', 'several_flat_marks', 'widespread_flat_marks', 'indented_scars'])) out.push('talk.marks');
  if (path !== 'maintenance') out.push('talk.past_treatments');
  out.push('talk.budget', 'talk.when_doctor');
  return Array.from(new Set(out)).slice(0, 5);
}

export function composeSnapshot(input: SnapshotInput): SnapshotVM {
  const { path, answers, safety } = input;
  // Invariant 1: a stopped case never carries advice.
  if (safety.stopped) return stoppedSnapshot(path, safety);

  const zones: SnapshotVM['zones'] = [];
  for (const zone of ZONES) {
    const rows = input.observations
      .filter((o) => o.zone === zone)
      .map((o) => ({ attribute: o.attribute, finding: o.finding, side: o.side, confidence: o.confidence, reason: o.reason }));
    if (rows.length) zones.push({ zone, rows });
  }

  const differs = input.bestFit.path !== path && input.bestFit.confidence !== 'not_sure';
  const pathMismatch = differs;

  let routine: SelectedRoutine | null = null;
  let routineHeld: RoutineHeld = null;
  if (path !== 'maintenance') routineHeld = 'not_maintenance';
  else if (safety.restrictions.includes('no_routine')) routineHeld = 'restriction';
  else if (pathMismatch) routineHeld = 'path_mismatch';
  else {
    routine = selectRoutine(input.templates, answers, { allowSamples: input.allowSampleRoutines });
    if (!routine) routineHeld = 'no_template';
  }

  return {
    path,
    stopped: false,
    safetySource: null,
    zones,
    bestFit: { ...input.bestFit, differs },
    pathMismatch,
    nextStep: path === 'maintenance' ? 'optional_talk' : 'recommended_talk',
    showBooking: true,
    routine,
    routineHeld,
    talkQuestions: pickTalkQuestions(path, input.observations),
    qualityFair: input.quality === 'fair',
    expectKey: `expect.${path}`,
  };
}

/** Every visitor-readable phrase key a snapshot can reference, for the banned-term scan. */
export function snapshotPhraseKeys(vm: SnapshotVM): string[] {
  const keys = new Set<string>();
  keys.add(`next.${vm.nextStep}`);
  if (vm.expectKey) keys.add(vm.expectKey);
  keys.add(`path.${vm.path}`);
  keys.add(`path.${vm.bestFit.path}`);
  for (const z of vm.zones) {
    keys.add(`zone.${z.zone}`);
    for (const r of z.rows) {
      keys.add(`attr.${r.attribute}`);
      keys.add(`side.${r.side}`);
      keys.add(`conf.${r.confidence}`);
      if (r.finding) keys.add(`obs.${r.attribute}.${r.finding}`);
      if (r.reason) keys.add(`reason.${r.reason}`);
    }
  }
  for (const q of vm.talkQuestions) keys.add(q);
  if (vm.stopped) ['safety.title', 'safety.body', 'safety.action'].forEach((k) => keys.add(k));
  return [...keys];
}
