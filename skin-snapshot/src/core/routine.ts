// Starter-routine selection. Templates are written and approved by the cosmetologist and stored
// in the database. This code only chooses one; it never invents routine text.
import type { Answers } from './questionnaire';

export type RoutineCategory = 'cleanser' | 'moisturiser' | 'sunscreen' | 'other';
export type FeelGroup = 'dry' | 'balanced' | 'oily';
export type SensitivityGroup = 'low' | 'high';

export interface RoutineItem {
  category: RoutineCategory;
  text_en: string;
  text_hi: string;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  steps: 2 | 3;
  skin_feel: FeelGroup | 'any';
  sensitivity: SensitivityGroup | 'any';
  /** Budget bands this template suits. Empty means any. */
  budget_bands: string[];
  items: RoutineItem[];
  approved: boolean;
  /** Sample content for testing. Never counts as approved. */
  sample: boolean;
}

export function feelGroup(answers: Answers): FeelGroup | undefined {
  switch (answers.skin_feel) {
    case 'dry_tight':
      return 'dry';
    case 'comfortable':
    case 'oily_tzone':
      return 'balanced';
    case 'oily_all':
      return 'oily';
    default:
      return undefined;
  }
}

export function sensitivityGroup(answers: Answers): SensitivityGroup | undefined {
  switch (answers.sensitivity) {
    case 'rarely':
      return 'low';
    case 'sometimes':
    case 'often':
      return 'high';
    default:
      return undefined;
  }
}

export function stepsWanted(answers: Answers): 2 | 3 | undefined {
  return answers.time_per_day === 'two_steps' ? 2 : answers.time_per_day === 'three_steps' ? 3 : undefined;
}

export interface SelectedRoutine {
  template: RoutineTemplate;
  status: 'approved' | 'sample';
}

/**
 * Picks the most specific template that fits the answers. Unapproved templates are used only
 * when `allowSamples` is true (staging), and are then labelled as samples.
 */
export function selectRoutine(
  templates: readonly RoutineTemplate[],
  answers: Answers,
  opts: { allowSamples: boolean },
): SelectedRoutine | null {
  const steps = stepsWanted(answers);
  const feel = feelGroup(answers);
  const sens = sensitivityGroup(answers);
  const budget = typeof answers.budget === 'string' ? answers.budget : undefined;
  if (!steps || !feel || !sens) return null;

  let best: { t: RoutineTemplate; score: number } | null = null;
  for (const t of templates) {
    const usable = t.approved || (opts.allowSamples && t.sample);
    if (!usable) continue;
    if (t.steps !== steps) continue;
    if (t.skin_feel !== 'any' && t.skin_feel !== feel) continue;
    if (t.sensitivity !== 'any' && t.sensitivity !== sens) continue;
    if (t.budget_bands.length > 0 && (!budget || !t.budget_bands.includes(budget))) continue;
    const score =
      (t.skin_feel === feel ? 2 : 1) + (t.sensitivity === sens ? 2 : 1) + (t.budget_bands.length > 0 ? 2 : 1) + (t.approved ? 4 : 0);
    if (!best || score > best.score) best = { t, score };
  }
  return best ? { template: best.t, status: best.t.approved ? 'approved' : 'sample' } : null;
}
