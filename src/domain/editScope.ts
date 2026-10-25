import type { ISODate, PlannedFields, WorkoutTemplate } from './types';
import { addDays, isoWeekday, weekStartOf } from './periods';

/**
 * Every program edit has an explicit SCOPE, and broad edits state which future workouts change
 * BEFORE they are applied (the `preview`). Scopes:
 *   set                 → a logged set only (not a program edit)
 *   exercise_session    → this exercise in today's session only (session-level substitution)
 *   exercise_future     → this exercise in all future sessions (new program version from today)
 *   day_week            → this workout day for one specific week (materialised session override)
 *   day_future          → this workout day for the rest of the program (new version from today)
 *   program_all         → entire program from today (new version)
 *   program_from_date   → entire program from a selected date (new version)
 * History is never rewritten: a broad edit creates a NEW program version (or edits version N in place
 * only while nothing has been performed against it).
 */
export type EditScope = 'set' | 'exercise_session' | 'exercise_future' | 'day_week' | 'day_future' | 'program_all' | 'program_from_date';

export const SCOPE_LABELS: Record<EditScope, string> = {
  set: 'This set only',
  exercise_session: "This exercise for today's session",
  exercise_future: 'This exercise for all future sessions',
  day_week: 'This workout day for this week',
  day_future: 'This workout day for the rest of the program',
  program_all: 'Entire program (from today)',
  program_from_date: 'Entire program from a selected date',
};

export type TemplateRow = Pick<WorkoutTemplate, 'template_key' | 'name' | 'weekday' | 'sequence' | 'workout_type' | 'target_muscles' | 'est_duration_min' | 'warmup' | 'notes'>;
export type PlannedRow = PlannedFields & { plan_key: string; template_key: string };

export interface PlanTree {
  templates: TemplateRow[];
  planned: PlannedRow[];
}

export type PlanEdit =
  | { kind: 'replace_exercise'; plan_key: string; exercise_id: string }
  | { kind: 'update_prescription'; plan_key: string; patch: Partial<PlannedFields> }
  | { kind: 'add_exercise'; template_key: string; row: PlannedRow }
  | { kind: 'remove_exercise'; plan_key: string }
  | { kind: 'reorder'; template_key: string; ordered_plan_keys: string[] }
  | { kind: 'update_day'; template_key: string; patch: Partial<Pick<TemplateRow, 'name' | 'weekday' | 'est_duration_min' | 'warmup' | 'notes' | 'target_muscles' | 'workout_type'>> }
  | { kind: 'add_day'; template: TemplateRow }
  | { kind: 'remove_day'; template_key: string };

export function applyEdit(tree: PlanTree, edit: PlanEdit): PlanTree {
  const planned = tree.planned.map((p) => ({ ...p }));
  let templates = tree.templates.map((t) => ({ ...t }));
  let out = planned;
  switch (edit.kind) {
    case 'replace_exercise':
      out = planned.map((p) => (p.plan_key === edit.plan_key ? { ...p, exercise_id: edit.exercise_id } : p));
      break;
    case 'update_prescription':
      out = planned.map((p) => (p.plan_key === edit.plan_key ? { ...p, ...edit.patch } : p));
      break;
    case 'add_exercise': {
      const siblings = planned.filter((p) => p.template_key === edit.template_key);
      const pos = edit.row.position ?? siblings.length;
      out = [...planned, { ...edit.row, template_key: edit.template_key, position: pos }];
      break;
    }
    case 'remove_exercise':
      out = planned.filter((p) => p.plan_key !== edit.plan_key);
      break;
    case 'reorder':
      out = planned.map((p) => {
        if (p.template_key !== edit.template_key) return p;
        const i = edit.ordered_plan_keys.indexOf(p.plan_key);
        return i === -1 ? p : { ...p, position: i };
      });
      break;
    case 'update_day':
      templates = templates.map((t) => (t.template_key === edit.template_key ? { ...t, ...edit.patch } : t));
      break;
    case 'add_day':
      templates = [...templates, { ...edit.template }];
      break;
    case 'remove_day':
      templates = templates.filter((t) => t.template_key !== edit.template_key);
      out = planned.filter((p) => p.template_key !== edit.template_key);
      break;
  }
  return { templates, planned: out };
}

export const applyEdits = (tree: PlanTree, edits: PlanEdit[]): PlanTree => edits.reduce(applyEdit, tree);

const FIELD_LABELS: [keyof PlannedFields, string][] = [
  ['sets', 'sets'], ['reps_min', 'min reps'], ['reps_max', 'max reps'], ['rir_target', 'RIR'], ['rest_min_s', 'rest'], ['rest_max_s', 'rest'],
  ['tempo', 'tempo'], ['technique_code', 'last-set technique'], ['start_load_kg', 'start load'],
];

/** Human-readable differences between two versions of the same workout day (matched by plan_key). */
export function diffDay(before: PlannedRow[], after: PlannedRow[], nameOf: (exerciseId: string) => string): string[] {
  const notes: string[] = [];
  const b = new Map(before.map((p) => [p.plan_key, p]));
  const a = new Map(after.map((p) => [p.plan_key, p]));
  for (const [k, p] of a) {
    const old = b.get(k);
    if (!old) { notes.push(`Adds ${nameOf(p.exercise_id)} (${p.sets} sets)`); continue; }
    if (old.exercise_id !== p.exercise_id) notes.push(`Replaces ${nameOf(old.exercise_id)} with ${nameOf(p.exercise_id)}`);
    const changed = new Set<string>();
    for (const [f, label] of FIELD_LABELS) if (old[f] !== p[f]) changed.add(label);
    if (changed.size) notes.push(`${nameOf(p.exercise_id)}: changes ${[...changed].join(', ')}`);
  }
  for (const [k, p] of b) if (!a.has(k)) notes.push(`Removes ${nameOf(p.exercise_id)}`);
  const order = (rows: PlannedRow[]): string => [...rows].sort((x, y) => x.position - y.position).map((r) => r.plan_key).join(',');
  const common = (rows: PlannedRow[], keys: Set<string>): PlannedRow[] => rows.filter((r) => keys.has(r.plan_key));
  const keysBoth = new Set([...a.keys()].filter((k) => b.has(k)));
  if (order(common(before, keysBoth)) !== order(common(after, keysBoth))) notes.push('Reorders exercises');
  return notes;
}

export interface PreviewRow { date: ISODate; template_name: string; changes: string[] }

export interface EditPlan {
  mode: 'none' | 'session_only' | 'week_override' | 'new_version' | 'in_place';
  scope: EditScope;
  effectiveFrom: ISODate | null;
  weekOverrideDate: ISODate | null;
  tree: PlanTree | null;
  preview: PreviewRow[];
  summary: string;
}

export interface PlanEditInput {
  scope: EditScope;
  edits: PlanEdit[];
  current: PlanTree;
  today: ISODate;
  /** Required for program_from_date and day_week (the specific date being overridden). */
  targetDate?: ISODate;
  /** weekday(1–7) per template_key in the CURRENT tree; used to enumerate affected dates. */
  nameOf: (exerciseId: string) => string;
  /** True when no non-skipped session was ever created from the current version. */
  versionIsUnused: boolean;
  /** Dates the program is live on (so preview skips paused/ended days). */
  isLiveOn: (date: ISODate) => boolean;
  horizonWeeks?: number;
}

function affectedTemplateKeys(edits: PlanEdit[], tree: PlanTree): Set<string> {
  const keys = new Set<string>();
  const keyOfPlan = (pk: string): string | undefined => tree.planned.find((p) => p.plan_key === pk)?.template_key;
  for (const e of edits) {
    if ('template_key' in e && typeof e.template_key === 'string') keys.add(e.template_key);
    if ('plan_key' in e) { const k = keyOfPlan(e.plan_key); if (k) keys.add(k); }
    if (e.kind === 'add_day') keys.add(e.template.template_key);
  }
  return keys;
}

export function planProgramEdit(input: PlanEditInput): EditPlan {
  const { scope, edits, current, today, nameOf } = input;
  const base: EditPlan = { mode: 'none', scope, effectiveFrom: null, weekOverrideDate: null, tree: null, preview: [], summary: '' };

  if (scope === 'set' || scope === 'exercise_session') {
    return { ...base, mode: 'session_only', summary: scope === 'set' ? 'Only this set changes. The program is untouched.' : "Only today's session changes. The program and all future sessions are untouched." };
  }

  const after = applyEdits(current, edits);
  const touched = affectedTemplateKeys(edits, current);

  if (scope === 'day_week') {
    const date = input.targetDate ?? today;
    const tKey = [...touched][0];
    const before = current.planned.filter((p) => p.template_key === tKey);
    const afterRows = after.planned.filter((p) => p.template_key === tKey);
    const tpl = current.templates.find((t) => t.template_key === tKey);
    return {
      ...base, mode: 'week_override', effectiveFrom: date, weekOverrideDate: date, tree: after,
      preview: [{ date, template_name: tpl?.name ?? 'Workout', changes: diffDay(before, afterRows, nameOf) }],
      summary: `Only the workout on ${date} changes. The program and every other week are untouched.`,
    };
  }

  const effectiveFrom = scope === 'program_from_date' ? (input.targetDate ?? today) : today;
  const horizon = addDays(effectiveFrom, (input.horizonWeeks ?? 8) * 7);
  const preview: PreviewRow[] = [];
  for (let d = effectiveFrom; d <= horizon; d = addDays(d, 1)) {
    if (!input.isLiveOn(d)) continue;
    const wd = isoWeekday(d);
    const beforeDays = current.templates.filter((t) => t.weekday === wd);
    const afterDays = after.templates.filter((t) => t.weekday === wd);
    const names = new Set([...beforeDays, ...afterDays].map((t) => t.template_key));
    for (const key of names) {
      const bt = beforeDays.find((t) => t.template_key === key);
      const at = afterDays.find((t) => t.template_key === key);
      const bRows = current.planned.filter((p) => p.template_key === key);
      const aRows = after.planned.filter((p) => p.template_key === key);
      const changes = !bt && at ? [`New workout day: ${at.name}`] : bt && !at ? [`Workout day removed: ${bt.name}`] : diffDay(bRows, aRows, nameOf);
      if (bt && at && bt.name !== at.name) changes.unshift(`Day renamed to ${at.name}`);
      if (changes.length) preview.push({ date: d, template_name: (at ?? bt)!.name, changes });
    }
  }
  // Day moved to a different weekday: the old and new weekday both show up above.
  const mode: EditPlan['mode'] = input.versionIsUnused && effectiveFrom <= today ? 'in_place' : 'new_version';
  const n = preview.length;
  const summary =
    n === 0
      ? 'No scheduled workout changes in the next 8 weeks.'
      : `${n} scheduled workout${n === 1 ? '' : 's'} change from ${effectiveFrom} onward. ${mode === 'in_place' ? 'Nothing has been performed against this version yet, so it is edited in place.' : 'A new program version is created; past sessions keep the version they used.'}`;
  return { ...base, mode, effectiveFrom, tree: after, preview, summary };
}

/** First date within the week of `date` (week start per profile) on which the template occurs. */
export function occurrenceInWeek(weekday: number, date: ISODate, weekStart = 1): ISODate {
  const start = weekStartOf(date, weekStart);
  const offset = (weekday - weekStart + 7) % 7;
  return addDays(start, offset);
}
