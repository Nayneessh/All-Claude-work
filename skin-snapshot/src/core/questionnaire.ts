// Path-specific questionnaires. Question text and option labels live in the i18n catalogues
// under `q.<id>.label`, `q.<id>.help` and `q.<id>.opt.<option>`. This file owns structure only.
import { z } from 'zod';
import type { PathId } from './types';

export type QuestionKind = 'single' | 'multi';
export type Section = 'about' | 'health' | 'budget';

export interface Question {
  id: string;
  kind: QuestionKind;
  section: Section;
  options: readonly string[];
  /** For multi questions: option that excludes all others. */
  exclusive?: string;
  /** Paths that ask it. */
  paths: readonly PathId[] | 'all';
}

const YN = ['yes', 'no'] as const;
const ALL = 'all' as const;

export const QUESTIONS: readonly Question[] = [
  // Path: maintenance
  { id: 'skin_feel', kind: 'single', section: 'about', paths: ['maintenance'], options: ['dry_tight', 'comfortable', 'oily_tzone', 'oily_all'] },
  { id: 'sun_exposure', kind: 'single', section: 'about', paths: ['maintenance', 'scars'], options: ['low', 'moderate', 'high'] },
  { id: 'current_products', kind: 'multi', section: 'about', paths: ['maintenance'], options: ['cleanser', 'moisturiser', 'sunscreen', 'serum', 'none'], exclusive: 'none' },
  { id: 'time_per_day', kind: 'single', section: 'about', paths: ['maintenance'], options: ['two_steps', 'three_steps'] },
  { id: 'sensitivity', kind: 'single', section: 'about', paths: ['maintenance'], options: ['rarely', 'sometimes', 'often'] },
  // Path: concerns
  { id: 'duration', kind: 'single', section: 'about', paths: ['concerns'], options: ['under_1m', 'one_to_6m', 'six_to_12m', 'over_1y'] },
  { id: 'worsened_by', kind: 'multi', section: 'about', paths: ['concerns'], options: ['sun', 'stress', 'hormonal_changes', 'new_products', 'heat_sweat', 'none_known'], exclusive: 'none_known' },
  { id: 'tried', kind: 'multi', section: 'about', paths: ['concerns'], options: ['shop_creams', 'home_remedies', 'clinic_treatments', 'prescribed_by_doctor', 'nothing'], exclusive: 'nothing' },
  { id: 'pregnant_bf', kind: 'single', section: 'about', paths: ['concerns'], options: ['no', 'pregnant', 'breastfeeding', 'prefer_not'] },
  { id: 'medicines', kind: 'single', section: 'about', paths: ['concerns'], options: ['none', 'prescription_cream', 'prescription_tablets', 'other'] },
  // Path: scars
  { id: 'mark_age', kind: 'single', section: 'about', paths: ['scars'], options: ['under_6m', 'six_to_12m', 'one_to_3y', 'over_3y'] },
  { id: 'mark_type', kind: 'multi', section: 'about', paths: ['scars'], options: ['flat', 'raised', 'dented'] },
  { id: 'earlier_treatments', kind: 'multi', section: 'about', paths: ['scars'], options: ['none', 'shop_creams', 'home_remedies', 'clinic_procedures'], exclusive: 'none' },
  // Health screen. Standard for every path.
  { id: 'mole_changing', kind: 'single', section: 'health', paths: ALL, options: YN },
  { id: 'sore_not_healing', kind: 'single', section: 'health', paths: ALL, options: YN },
  { id: 'infection_signs', kind: 'single', section: 'health', paths: ALL, options: YN },
  { id: 'severe_inflammation', kind: 'single', section: 'health', paths: ALL, options: YN },
  { id: 'eye_area_problem', kind: 'single', section: 'health', paths: ALL, options: YN },
  // Stricter screen. Concerns path only.
  { id: 'rapid_worsening', kind: 'single', section: 'health', paths: ['concerns'], options: YN },
  { id: 'painful_lumps', kind: 'single', section: 'health', paths: ['concerns'], options: YN },
  { id: 'bleeding_or_oozing', kind: 'single', section: 'health', paths: ['concerns'], options: YN },
  // Scars path: changing marks
  { id: 'marks_changing', kind: 'single', section: 'health', paths: ['scars'], options: YN },
  // Common to every path
  { id: 'makeup_today', kind: 'single', section: 'budget', paths: ALL, options: YN },
  { id: 'budget', kind: 'single', section: 'budget', paths: ALL, options: ['under_500', 'b500_1500', 'b1500_3000', 'over_3000', 'prefer_not'] },
];

export const SECTIONS: readonly Section[] = ['about', 'health', 'budget'];

export function questionsFor(path: PathId, section?: Section): Question[] {
  return QUESTIONS.filter(
    (q) => (q.paths === 'all' || q.paths.includes(path)) && (section ? q.section === section : true),
  );
}

export type Answers = Record<string, string | string[]>;

/** Every answer a path needs. Used to detect which questions are missing after a path switch. */
export function missingQuestions(path: PathId, answers: Answers): Question[] {
  return questionsFor(path).filter((q) => answers[q.id] === undefined);
}

/** Builds a strict validator for a path. Unknown keys and out-of-vocabulary values are rejected. */
export function answersSchema(path: PathId, opts: { partial?: boolean; onlyIds?: readonly string[] } = {}) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of questionsFor(path)) {
    if (opts.onlyIds && !opts.onlyIds.includes(q.id)) continue;
    const opt = z.enum(q.options as [string, ...string[]]);
    let field: z.ZodTypeAny;
    if (q.kind === 'single') field = opt;
    else {
      field = z
        .array(opt)
        .min(1)
        .max(q.options.length)
        .refine((arr) => new Set(arr).size === arr.length, 'duplicate option')
        .refine((arr) => !q.exclusive || !arr.includes(q.exclusive) || arr.length === 1, 'exclusive option combined');
    }
    shape[q.id] = opts.partial ? field.optional() : field;
  }
  return z.object(shape).strict();
}

export type BudgetBand = 'under_500' | 'b500_1500' | 'b1500_3000' | 'over_3000' | 'prefer_not';
