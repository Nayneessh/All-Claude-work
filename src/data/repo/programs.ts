import type { ISODate, PlannedExercise, PlannedFields, Program, ProgramModification, ProgramStatus, ProgramVersion, WorkoutSession, WorkoutTemplate } from '@/domain/types';
import { applyEdits, type EditPlan, type PlanEdit, type PlanTree, type PlannedRow, type TemplateRow } from '@/domain/editScope';
import { latestVersion } from '@/domain/versioning';
import { addDays } from '@/domain/periods';
import { allTables, db, tbl } from '../db';
import { insert, update } from '../write';
import { audit } from '../audit';
import { newId, nowIso } from '../runtime';
import type { ProgramDraft } from '../seed/routineV6';

type ProgramRow = Program;

const clean = <T extends { _dirty: 0 | 1 }>(r: T): Omit<T, '_dirty'> => { const { _dirty: _d, ...rest } = r; void _d; return rest; };

const PLANNED_KEYS: (keyof PlannedFields)[] = [
  'position', 'label', 'superset_group', 'exercise_id', 'muscle_label', 'sets', 'reps_min', 'reps_max', 'rir_target', 'rir_last_only', 'rpe_target', 'rest_min_s',
  'rest_max_s', 'rest_mode', 'tempo', 'technique_code', 'technique_text', 'start_load_kg', 'load_note', 'duration_target_s', 'distance_target_m', 'cue', 'notes', 'is_optional',
];
const TEMPLATE_KEYS: (keyof TemplateRow)[] = ['template_key', 'name', 'weekday', 'sequence', 'workout_type', 'target_muscles', 'est_duration_min', 'warmup', 'notes'];

const pickPlanned = (p: PlannedExercise): PlannedRow => {
  const out: Record<string, unknown> = { plan_key: p.plan_key, template_key: '' };
  for (const k of PLANNED_KEYS) out[k] = p[k];
  return out as unknown as PlannedRow;
};
const pickTemplate = (t: WorkoutTemplate): TemplateRow => {
  const out: Record<string, unknown> = {};
  for (const k of TEMPLATE_KEYS) out[k] = t[k];
  return out as unknown as TemplateRow;
};

export interface ProgramBundle {
  program: ProgramRow;
  versions: ProgramVersion[];
  templates: WorkoutTemplate[];
  planned: PlannedExercise[];
}

export async function listPrograms(opts: { includeArchived?: boolean } = {}): Promise<ProgramRow[]> {
  const all = (await tbl('programs').toArray()).filter((p) => !p.deleted_at).map(clean);
  return all.filter((p) => opts.includeArchived || p.status !== 'archived').sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getProgram(id: string): Promise<ProgramRow | undefined> {
  const p = await tbl('programs').get(id);
  return p ? clean(p) : undefined;
}

export async function getBundle(programId: string): Promise<ProgramBundle | undefined> {
  const program = await getProgram(programId);
  if (!program) return undefined;
  const versions = (await tbl('program_versions').where('program_id').equals(programId).toArray()).filter((v) => !v.deleted_at).map(clean).sort((a, b) => a.version_no - b.version_no);
  const vids = versions.map((v) => v.id);
  const templates = (await tbl('workout_templates').where('program_id').equals(programId).toArray()).filter((t) => !t.deleted_at).map(clean);
  const planned = (await tbl('planned_exercises').where('program_version_id').anyOf(vids).toArray()).filter((p) => !p.deleted_at).map(clean);
  return { program, versions, templates, planned };
}

export function treeOfVersion(bundle: ProgramBundle, versionId: string): PlanTree {
  const templates = bundle.templates.filter((t) => t.program_version_id === versionId).sort((a, b) => (a.weekday ?? 9) - (b.weekday ?? 9) || a.sequence - b.sequence);
  const keyOf = new Map(templates.map((t) => [t.id, t.template_key]));
  const planned: PlannedRow[] = bundle.planned
    .filter((p) => p.program_version_id === versionId && keyOf.has(p.template_id))
    .sort((a, b) => a.position - b.position)
    .map((p) => ({ ...pickPlanned(p), template_key: keyOf.get(p.template_id) as string }));
  return { templates: templates.map(pickTemplate), planned };
}

async function insertTree(programId: string, versionId: string, tree: PlanTree): Promise<void> {
  const idByKey = new Map<string, string>();
  for (const t of tree.templates) {
    const row = await insert('workout_templates', { ...t, program_id: programId, program_version_id: versionId });
    idByKey.set(t.template_key, row.id);
  }
  for (const p of tree.planned) {
    const templateId = idByKey.get(p.template_key);
    if (!templateId) continue;
    const { template_key: _k, ...fields } = p;
    void _k;
    await insert('planned_exercises', { ...fields, program_version_id: versionId, template_id: templateId });
  }
}

async function logModification(m: { program_id: string; from_version_id: string | null; to_version_id: string | null; session_id?: string | null; scope: string; kind: string; description: string; payload?: Record<string, unknown>; effective_from: ISODate | null }): Promise<ProgramModification> {
  const row = await insert('program_modifications', { ...m, session_id: m.session_id ?? null, payload: m.payload ?? {} });
  return clean(row) as ProgramModification;
}

export async function createProgram(draft: ProgramDraft, tree: PlanTree, today: ISODate): Promise<{ program: ProgramRow; version: ProgramVersion }> {
  return db.transaction('rw', [tbl('programs'), tbl('program_versions'), tbl('workout_templates'), tbl('planned_exercises'), tbl('program_modifications'), tbl('audit_events')], async () => {
    const program = clean(await insert('programs', draft)) as ProgramRow;
    const version = clean(await insert('program_versions', { program_id: program.id, version_no: 1, effective_from: draft.start_date ?? today, summary: 'Initial program', scope: 'program_all' })) as ProgramVersion;
    await insertTree(program.id, version.id, tree);
    await logModification({ program_id: program.id, from_version_id: null, to_version_id: version.id, scope: 'program_all', kind: 'created', description: `Program “${program.name}” created`, effective_from: version.effective_from });
    await audit('program', program.id, 'create', null, { name: program.name });
    return { program, version };
  });
}

export async function updateProgramMeta(id: string, patch: Partial<Pick<Program, 'name' | 'description' | 'goal' | 'methodology' | 'split' | 'source' | 'notes' | 'duration_weeks' | 'weekly_frequency' | 'deload_weeks' | 'progression_method' | 'target_notes' | 'start_date' | 'end_date' | 'is_template'>>): Promise<void> {
  await db.transaction('rw', tbl('programs'), tbl('audit_events'), tbl('program_modifications'), async () => {
    const before = await getProgram(id);
    await update('programs', id, patch);
    await audit('program', id, 'update_meta', before ? Object.fromEntries(Object.keys(patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? null])) : null, patch as Record<string, unknown>);
  });
}

/** True while nothing has been performed against this version, so it can be corrected in place without losing history. */
export async function versionIsUnused(versionId: string): Promise<boolean> {
  const used = await tbl('workout_sessions').filter((s) => s.program_version_id === versionId && !s.deleted_at && ['in_progress', 'completed_as_planned', 'completed_modified', 'partial'].includes(s.status)).count();
  return used === 0;
}

async function editInPlace(programId: string, version: ProgramVersion, edits: PlanEdit[]): Promise<void> {
  const bundle = (await getBundle(programId)) as ProgramBundle;
  const before = treeOfVersion(bundle, version.id);
  const after = applyEdits(before, edits);
  const tmplByKey = new Map(bundle.templates.filter((t) => t.program_version_id === version.id).map((t) => [t.template_key, t]));
  // templates: update changed / insert new / soft-delete removed
  for (const t of after.templates) {
    const cur = tmplByKey.get(t.template_key);
    if (cur) await update('workout_templates', cur.id, t);
    else { const row = await insert('workout_templates', { ...t, program_id: programId, program_version_id: version.id }); tmplByKey.set(t.template_key, clean(row) as WorkoutTemplate); }
  }
  const keep = new Set(after.templates.map((t) => t.template_key));
  for (const [key, t] of tmplByKey) if (!keep.has(key) && !t.deleted_at) await update('workout_templates', t.id, { deleted_at: nowIso() });
  // planned exercises
  const curPlanned = new Map(bundle.planned.filter((p) => p.program_version_id === version.id).map((p) => [`${p.template_id}:${p.plan_key}`, p]));
  const seen = new Set<string>();
  for (const p of after.planned) {
    const tpl = tmplByKey.get(p.template_key);
    if (!tpl) continue;
    const { template_key: _k, plan_key, ...fields } = p;
    void _k;
    const id = `${tpl.id}:${plan_key}`;
    seen.add(id);
    const cur = curPlanned.get(id);
    if (cur) await update('planned_exercises', cur.id, fields);
    else await insert('planned_exercises', { ...fields, plan_key, program_version_id: version.id, template_id: tpl.id });
  }
  for (const [id, p] of curPlanned) if (!seen.has(id) && !p.deleted_at) await update('planned_exercises', p.id, { deleted_at: nowIso() });
}

export interface CommitInput { programId: string; plan: EditPlan; edits: PlanEdit[]; description: string; today: ISODate }
export interface CommitResult { mode: EditPlan['mode']; versionId: string | null; sessionId: string | null }

/**
 * Applies a previewed edit. Nothing is ever applied silently: callers obtain `plan` from planProgramEdit(), show its preview,
 * and only then call this. History is preserved — a new version is created (or an unused version corrected in place), and
 * every change is recorded in the modification log and the audit trail.
 */
export async function commitEdit(input: CommitInput, materialize: (templateKey: string, date: ISODate, tree: PlanTree, programId: string, versionId: string) => Promise<string>): Promise<CommitResult> {
  const { programId, plan, edits, description, today } = input;
  if (plan.mode === 'none' || plan.mode === 'session_only') return { mode: plan.mode, versionId: null, sessionId: null };
  return db.transaction('rw', allTables(), async () => {
    const bundle = await getBundle(programId);
    if (!bundle) throw new Error('Program not found');
    const resolveFrom = plan.effectiveFrom ?? today;
    const current = latestVersion(bundle.versions);
    if (!current) throw new Error('Program has no versions');

    if (plan.mode === 'week_override') {
      const date = plan.weekOverrideDate as ISODate;
      const tKey = edits.map((e) => ('template_key' in e ? e.template_key : undefined)).find(Boolean) ?? plan.tree?.templates[0]?.template_key;
      const live = bundle.versions.filter((v) => v.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version_no - a.version_no)[0] ?? current;
      const tree = applyEdits(treeOfVersion(bundle, live.id), edits);
      const sessionId = await materialize(tKey as string, date, tree, programId, live.id);
      await logModification({ program_id: programId, from_version_id: live.id, to_version_id: null, session_id: sessionId, scope: plan.scope, kind: 'week_override', description, payload: { edits } as unknown as Record<string, unknown>, effective_from: date });
      await audit('program', programId, 'week_override', null, { date, description });
      return { mode: plan.mode, versionId: null, sessionId };
    }

    if (plan.mode === 'in_place') {
      await editInPlace(programId, current, edits);
      await logModification({ program_id: programId, from_version_id: current.id, to_version_id: current.id, scope: plan.scope, kind: 'edited_in_place', description, payload: { edits } as unknown as Record<string, unknown>, effective_from: resolveFrom });
      await audit('program', programId, 'edit_in_place', null, { version: current.version_no, description });
      return { mode: plan.mode, versionId: current.id, sessionId: null };
    }

    // new_version: copy-on-write from the version in force on the effective date
    const base = bundle.versions.filter((v) => v.effective_from <= resolveFrom).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version_no - a.version_no)[0] ?? current;
    const tree = applyEdits(treeOfVersion(bundle, base.id), edits);
    const version = clean(await insert('program_versions', { program_id: programId, version_no: current.version_no + 1, effective_from: resolveFrom, summary: description, scope: plan.scope })) as ProgramVersion;
    await insertTree(programId, version.id, tree);
    // later-dated versions that were never performed carry the same edit, so "from this date onward" really means onward
    for (const later of bundle.versions.filter((v) => v.effective_from > resolveFrom)) {
      if (await versionIsUnused(later.id)) await editInPlace(programId, later, edits);
    }
    await logModification({ program_id: programId, from_version_id: base.id, to_version_id: version.id, scope: plan.scope, kind: 'new_version', description, payload: { edits } as unknown as Record<string, unknown>, effective_from: resolveFrom });
    await audit('program', programId, 'new_version', { version: base.version_no }, { version: version.version_no, effective_from: resolveFrom, description });
    return { mode: plan.mode, versionId: version.id, sessionId: null };
  });
}

export async function setProgramStatus(programId: string, status: ProgramStatus, today: ISODate): Promise<void> {
  await db.transaction('rw', tbl('programs'), tbl('audit_events'), tbl('program_modifications'), async () => {
    const p = await getProgram(programId);
    if (!p) throw new Error('Program not found');
    const intervals = [...p.paused_intervals];
    const patch: Partial<Program> = { status };
    if (status === 'paused' && p.status !== 'paused') intervals.push({ from: today, to: null });
    if (status === 'active' && p.status === 'paused') {
      const open = intervals.findIndex((i) => i.to === null);
      if (open >= 0) intervals[open] = { ...intervals[open]!, to: today };
    }
    if (status === 'completed' || status === 'archived' || status === 'abandoned') {
      patch.end_date = p.end_date ?? today;
      const open = intervals.findIndex((i) => i.to === null);
      if (open >= 0) intervals[open] = { ...intervals[open]!, to: today };
    }
    if (status === 'active' && p.end_date) patch.end_date = null; // restart / restore
    patch.paused_intervals = intervals;
    await update('programs', programId, patch);
    await logModification({ program_id: programId, from_version_id: null, to_version_id: null, scope: 'program_all', kind: `status_${status}`, description: `Program ${status}`, effective_from: today });
    await audit('program', programId, `status_${status}`, { status: p.status }, { status });
  });
}

export async function duplicateProgram(programId: string, name: string, today: ISODate, opts: { asTemplate?: boolean; startDate?: ISODate | null } = {}): Promise<Program> {
  const bundle = await getBundle(programId);
  if (!bundle) throw new Error('Program not found');
  const latest = latestVersion(bundle.versions) as ProgramVersion;
  const tree = treeOfVersion(bundle, latest.id);
  const src = bundle.program;
  const keyMap = new Map<string, string>();
  const rekey = (k: string): string => { if (!keyMap.has(k)) keyMap.set(k, newId()); return keyMap.get(k) as string; };
  const copy: PlanTree = {
    templates: tree.templates.map((t) => ({ ...t, template_key: rekey(t.template_key) })),
    planned: tree.planned.map((p) => ({ ...p, plan_key: rekey(p.plan_key), template_key: rekey(p.template_key) })),
  };
  const draft: ProgramDraft = {
    name, description: src.description, goal: src.goal, methodology: src.methodology, split: src.split, source: src.source, status: opts.asTemplate ? 'archived' : 'active',
    start_date: opts.startDate ?? today, end_date: null, duration_weeks: src.duration_weeks, weekly_frequency: src.weekly_frequency, deload_weeks: src.deload_weeks,
    progression_method: src.progression_method, target_notes: src.target_notes, notes: src.notes, is_template: !!opts.asTemplate, paused_intervals: [], cloned_from: src.id,
  };
  const { program } = await createProgram(draft, copy, today);
  return program;
}

export async function listModifications(programId: string): Promise<ProgramModification[]> {
  return (await tbl('program_modifications').where('program_id').equals(programId).toArray()).filter((m) => !m.deleted_at).map(clean).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) as ProgramModification[];
}

export async function activePrograms(): Promise<ProgramBundle[]> {
  const ps = (await listPrograms()).filter((p) => p.status === 'active' || p.status === 'paused');
  const out: ProgramBundle[] = [];
  for (const p of ps) { const b = await getBundle(p.id); if (b) out.push(b); }
  return out;
}

/** Sessions that used a given program (for the version history screen). */
export async function sessionsForProgram(programId: string): Promise<WorkoutSession[]> {
  return (await tbl('workout_sessions').where('program_id').equals(programId).toArray()).filter((s) => !s.deleted_at).map(clean) as WorkoutSession[];
}

export const earliestEffective = (versions: ProgramVersion[]): ISODate | null => versions.length ? versions.map((v) => v.effective_from).sort()[0]! : null;
export const dayBefore = (d: ISODate): ISODate => addDays(d, -1);
