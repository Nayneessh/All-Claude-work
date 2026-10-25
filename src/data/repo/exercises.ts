import type { Exercise } from '@/domain/types';
import { MUSCLES, type MuscleGroup } from '@/domain/muscles';
import { db, tbl } from '../db';
import { SEED_ROWS, SEED_VERSION } from '../seed/exercises';
import { insert, update, type NewRow } from '../write';
import { audit, diffFields } from '../audit';
import { nowIso } from '../runtime';

/**
 * Idempotent: applying the seed any number of times (on any device) yields the same rows. Built-in rows are
 * read-only, never pushed (user_id stays null) and are only replaced when the shipped seed_version increases.
 */
export async function seedLibrary(): Promise<{ inserted: number; updated: number; unchanged: number }> {
  let inserted = 0, updated = 0, unchanged = 0;
  await db.transaction('rw', tbl('exercises'), async () => {
    const existing = new Map((await tbl('exercises').where('seed_key').notEqual('').toArray()).map((e) => [e.id, e]));
    const toPut: ReturnType<typeof withLocal>[] = [];
    for (const row of SEED_ROWS) {
      const cur = existing.get(row.id);
      if (!cur) { inserted++; toPut.push(withLocal(row)); }
      else if ((cur.seed_version ?? 0) < SEED_VERSION) { updated++; toPut.push(withLocal(row)); }
      else unchanged++;
    }
    if (toPut.length) await tbl('exercises').bulkPut(toPut);
  });
  return { inserted, updated, unchanged };
}
const withLocal = (r: Exercise) => ({ ...r, _dirty: 0 as const });

export interface ExerciseFilter {
  q?: string;
  group?: MuscleGroup;
  equipment?: string;
  category?: Exercise['category'];
  includeArchived?: boolean;
  onlyCustom?: boolean;
}

export async function listExercises(f: ExerciseFilter = {}): Promise<Exercise[]> {
  const all = await tbl('exercises').toArray();
  const q = f.q?.trim().toLowerCase();
  return all
    .filter((e) => !e.deleted_at)
    .filter((e) => f.includeArchived || !e.archived_at)
    .filter((e) => !f.onlyCustom || e.is_custom)
    .filter((e) => !f.equipment || e.equipment === f.equipment)
    .filter((e) => !f.category || e.category === f.category)
    .filter((e) => !f.group || [...e.primary_muscles, ...e.secondary_muscles].some((m) => MUSCLES[m]?.group === f.group))
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)) || e.primary_muscles.some((m) => (MUSCLES[m]?.label ?? m).toLowerCase().includes(q)) || e.equipment.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ _dirty: _d, ...e }) => (void _d, e));
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  const e = await tbl('exercises').get(id);
  if (!e) return undefined;
  const { _dirty: _d, ...rest } = e;
  void _d;
  return rest;
}

export type ExerciseDraft = Omit<NewRow<'exercises'>, 'seed_key' | 'is_custom' | 'archived_at' | 'seed_version'>;

export const blankExercise = (): ExerciseDraft => ({
  name: '', aliases: [], category: 'isolation', primary_muscles: [], secondary_muscles: [], movement_pattern: null, equipment: 'dumbbell', laterality: 'bilateral',
  position: null, resistance_type: 'free_weight', tracking_method: 'weight_reps', load_mode: 'total', bodyweight_fraction: 1, technique: null, cues: null,
  demo_url: null, default_tempo: null, default_rest_s: null, difficulty: null, substitute_ids: [], variation_of: null, variation_label: null, notes: null,
});

export async function createExercise(draft: ExerciseDraft): Promise<Exercise> {
  const name = draft.name.trim();
  if (!name) throw new Error('An exercise needs a name.');
  const row = await insert('exercises', { ...draft, name, seed_key: null, is_custom: true, archived_at: null, seed_version: null });
  const { _dirty: _d, ...rest } = row;
  void _d;
  return rest;
}

/** Renaming keeps the id, so all history stays attached. Built-in exercises are duplicated instead of edited. */
export async function updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<Exercise> {
  const cur = await tbl('exercises').get(id);
  if (!cur) throw new Error('Exercise not found');
  if (!cur.is_custom) throw new Error('Built-in exercises are read-only — duplicate it to customise.');
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('An exercise needs a name.');
  return db.transaction('rw', tbl('exercises'), tbl('audit_events'), async () => {
    const next = await update('exercises', id, patch);
    const d = diffFields(cur as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    if (Object.keys(d.after).length) await audit('exercise', id, 'update', d.before, d.after);
    const { _dirty: _x, ...rest } = next;
    void _x;
    return rest;
  });
}

export async function duplicateExercise(id: string, name?: string): Promise<Exercise> {
  const src = await getExercise(id);
  if (!src) throw new Error('Exercise not found');
  return createExercise({
    ...blankExercise(), name: name ?? `${src.name} (copy)`, aliases: src.aliases, category: src.category, primary_muscles: src.primary_muscles,
    secondary_muscles: src.secondary_muscles, movement_pattern: src.movement_pattern, equipment: src.equipment, laterality: src.laterality, position: src.position,
    resistance_type: src.resistance_type, tracking_method: src.tracking_method, load_mode: src.load_mode, bodyweight_fraction: src.bodyweight_fraction,
    technique: src.technique, cues: src.cues, default_tempo: src.default_tempo, default_rest_s: src.default_rest_s, difficulty: src.difficulty,
    substitute_ids: src.substitute_ids, variation_of: src.id, variation_label: 'Copy',
  });
}

/** Archiving hides an exercise from pickers but NEVER touches history: every past set keeps pointing at it. */
export async function archiveExercise(id: string): Promise<void> {
  const cur = await tbl('exercises').get(id);
  if (!cur) throw new Error('Exercise not found');
  if (!cur.is_custom) throw new Error('Built-in exercises cannot be archived.');
  await db.transaction('rw', tbl('exercises'), tbl('audit_events'), async () => {
    await update('exercises', id, { archived_at: nowIso() });
    await audit('exercise', id, 'archive', { archived_at: null }, { archived_at: nowIso() });
  });
}

export async function restoreExercise(id: string): Promise<void> {
  await db.transaction('rw', tbl('exercises'), tbl('audit_events'), async () => {
    await update('exercises', id, { archived_at: null });
    await audit('exercise', id, 'restore', null, { archived_at: null });
  });
}

export async function exerciseMap(): Promise<Map<string, Exercise>> {
  return new Map((await tbl('exercises').toArray()).map(({ _dirty: _d, ...e }) => (void _d, [e.id, e as Exercise])));
}
