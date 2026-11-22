// Safety gates. Deterministic, framework-free, unit-tested. The server is the authority;
// the browser runs the same code only for instant feedback.
//
// CLINICAL REVIEW REQUIRED: every rule, threshold and wording below is a draft that a
// dermatologist must review before real visitors use the product.
import type { Answers } from './questionnaire';
import type { AssessedConfidence, ImageRedFlagCode, PathId, RedFlag, RedFlagCode, Restriction } from './types';

export const GATE_A_VERSION = 'gateA-v1-DRAFT-pending-clinical-review';
export const GATE_B_VERSION = 'gateB-v1-DRAFT-pending-clinical-review';

type Match = (value: string | string[] | undefined) => boolean;
const isYes: Match = (v) => v === 'yes';
const includes = (opt: string): Match => (v) => Array.isArray(v) && v.includes(opt);

export interface GateARule {
  id: string;
  paths: readonly PathId[] | 'all';
  question: string;
  when: Match;
  flag: RedFlagCode;
}

export const GATE_A_RULES: readonly GateARule[] = [
  // Standard screen, every path
  { id: 'A1', paths: 'all', question: 'mole_changing', when: isYes, flag: 'changing_mole' },
  { id: 'A2', paths: 'all', question: 'sore_not_healing', when: isYes, flag: 'non_healing_sore' },
  { id: 'A3', paths: 'all', question: 'infection_signs', when: isYes, flag: 'infection_signs' },
  { id: 'A4', paths: 'all', question: 'severe_inflammation', when: isYes, flag: 'severe_inflammation' },
  { id: 'A5', paths: 'all', question: 'eye_area_problem', when: isYes, flag: 'eye_area_problem' },
  // Stricter screen, concerns path
  { id: 'A6', paths: ['concerns'], question: 'rapid_worsening', when: isYes, flag: 'rapid_worsening' },
  { id: 'A7', paths: ['concerns'], question: 'painful_lumps', when: isYes, flag: 'painful_lumps' },
  { id: 'A8', paths: ['concerns'], question: 'bleeding_or_oozing', when: isYes, flag: 'bleeding_or_oozing' },
  // Scars path: raised or changing marks go straight to a dermatologist
  { id: 'A9', paths: ['scars'], question: 'mark_type', when: includes('raised'), flag: 'raised_or_changing_marks' },
  { id: 'A10', paths: ['scars'], question: 'marks_changing', when: isYes, flag: 'raised_or_changing_marks' },
];

/** Answers that restrict routine advice without stopping the flow (concerns path). */
export function routineRestrictions(answers: Answers): Restriction[] {
  const out: Restriction[] = [];
  const preg = answers.pregnant_bf;
  const meds = answers.medicines;
  if (preg === 'pregnant' || preg === 'breastfeeding' || preg === 'prefer_not') out.push('no_routine');
  if (meds !== undefined && meds !== 'none') {
    if (!out.includes('no_routine')) out.push('no_routine');
  }
  return out;
}

export interface GateAResult {
  stop: boolean;
  flags: RedFlag[];
  restrictions: Restriction[];
  rulesetVersion: string;
}

export function evaluateGateA(path: PathId, answers: Answers): GateAResult {
  const flags: RedFlag[] = [];
  for (const rule of GATE_A_RULES) {
    if (rule.paths !== 'all' && !rule.paths.includes(path)) continue;
    if (rule.when(answers[rule.question])) {
      if (!flags.some((f) => f.code === rule.flag)) flags.push({ code: rule.flag, source: 'answers', detail: rule.id });
    }
  }
  return { stop: flags.length > 0, flags, restrictions: routineRestrictions(answers), rulesetVersion: GATE_A_VERSION };
}

const RANK: Record<AssessedConfidence, number> = { not_sure: 1, likely: 2, clear: 3 };

export interface ImageFlagReport {
  code: ImageRedFlagCode;
  confidence: AssessedConfidence;
}

export interface GateBResult {
  stop: boolean;
  flags: RedFlag[];
  minConfidence: AssessedConfidence;
  rulesetVersion: string;
}

/**
 * Image-based red flags. Tuned to over-flag: by default any report, even "not_sure", stops the flow.
 * A missed flag harms a person; a false alarm costs one conversation.
 */
export function evaluateGateB(reports: readonly ImageFlagReport[], minConfidence: AssessedConfidence = 'not_sure'): GateBResult {
  const flags: RedFlag[] = [];
  for (const r of reports) {
    if (RANK[r.confidence] >= RANK[minConfidence] && !flags.some((f) => f.code === r.code)) {
      flags.push({ code: r.code, source: 'image', detail: r.confidence });
    }
  }
  return { stop: flags.length > 0, flags, minConfidence, rulesetVersion: GATE_B_VERSION };
}

export interface SafetyState {
  stopped: boolean;
  flags: RedFlag[];
  restrictions: Restriction[];
}

export function combineSafety(a: GateAResult, b?: GateBResult): SafetyState {
  const flags = [...a.flags];
  for (const f of b?.flags ?? []) if (!flags.some((x) => x.code === f.code && x.source === f.source)) flags.push(f);
  return { stopped: a.stop || (b?.stop ?? false), flags, restrictions: a.restrictions };
}
