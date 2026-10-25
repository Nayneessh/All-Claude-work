import { describe, expect, it } from 'vitest';
import { applyEdit, diffDay, occurrenceInWeek, planProgramEdit, type PlanTree, type PlannedRow } from './editScope';
import type { PlannedFields } from './types';

const base = (over: Partial<PlannedFields> & { exercise_id: string }): PlannedFields => ({
  position: 0, label: null, superset_group: null, muscle_label: null, sets: 3, reps_min: 8, reps_max: 12, rir_target: 1, rir_last_only: false, rpe_target: null,
  rest_min_s: 90, rest_max_s: 90, rest_mode: 'after_set', tempo: null, technique_code: null, technique_text: null, start_load_kg: 80, load_note: null,
  duration_target_s: null, distance_target_m: null, cue: null, notes: null, is_optional: false, ...over,
});
const row = (plan_key: string, template_key: string, over: Partial<PlannedFields> & { exercise_id: string }): PlannedRow => ({ ...base(over), plan_key, template_key });

const tree: PlanTree = {
  templates: [
    { template_key: 'mon', name: 'Monday', weekday: 1, sequence: 0, workout_type: 'strength', target_muscles: [], est_duration_min: 30, warmup: null, notes: null },
    { template_key: 'fri', name: 'Friday', weekday: 5, sequence: 0, workout_type: 'strength', target_muscles: [], est_duration_min: 30, warmup: null, notes: null },
  ],
  planned: [row('legpress', 'mon', { exercise_id: 'legpress', position: 0 }), row('pulldown', 'mon', { exercise_id: 'pulldown', position: 1 }), row('chest', 'fri', { exercise_id: 'chestpress' })],
};
const names: Record<string, string> = { legpress: 'Leg Press', hack: 'Hack Squat', pulldown: 'Lat Pulldown', chestpress: 'Chest Press' };
const nameOf = (id: string): string => names[id] ?? id;
const live = (): boolean => true;
const args = { current: tree, today: '2026-11-02', nameOf, versionIsUnused: false, isLiveOn: live };
const replaceLegPress = [{ kind: 'replace_exercise' as const, plan_key: 'legpress', exercise_id: 'hack' }];

describe('edit scopes', () => {
  it('"this set" and "this exercise today" never touch the program', () => {
    for (const scope of ['set', 'exercise_session'] as const) {
      const p = planProgramEdit({ ...args, scope, edits: replaceLegPress });
      expect(p.mode).toBe('session_only');
      expect(p.tree).toBeNull();
      expect(p.preview).toEqual([]);
    }
  });
  it('"future sessions" creates a new version from today and previews exactly the affected Mondays', () => {
    const p = planProgramEdit({ ...args, scope: 'exercise_future', edits: replaceLegPress });
    expect(p.mode).toBe('new_version');
    expect(p.effectiveFrom).toBe('2026-11-02');
    expect(p.preview.length).toBe(9); // Mondays from 2 Nov through 28 Dec (8-week horizon, inclusive)
    expect(p.preview.every((r) => r.template_name === 'Monday')).toBe(true);
    expect(p.preview[0]!.changes).toEqual(['Replaces Leg Press with Hack Squat']);
    expect(p.preview.some((r) => r.template_name === 'Friday')).toBe(false); // other days untouched
    expect(p.summary).toMatch(/new program version/);
    expect(p.tree!.planned.find((x) => x.plan_key === 'legpress')!.exercise_id).toBe('hack');
    expect(tree.planned.find((x) => x.plan_key === 'legpress')!.exercise_id).toBe('legpress'); // original not mutated
  });
  it('edits in place only while the version has never been used', () => {
    const p = planProgramEdit({ ...args, versionIsUnused: true, scope: 'exercise_future', edits: replaceLegPress });
    expect(p.mode).toBe('in_place');
    expect(p.summary).toMatch(/edited in place/);
  });
  it('"day this week" overrides one date and states which', () => {
    const p = planProgramEdit({ ...args, scope: 'day_week', targetDate: '2026-11-02', edits: replaceLegPress });
    expect(p.mode).toBe('week_override');
    expect(p.weekOverrideDate).toBe('2026-11-02');
    expect(p.preview).toHaveLength(1);
    expect(p.preview[0]!.date).toBe('2026-11-02');
  });
  it('"program from a selected date" starts the preview at that date', () => {
    const p = planProgramEdit({ ...args, scope: 'program_from_date', targetDate: '2026-11-16', edits: replaceLegPress });
    expect(p.effectiveFrom).toBe('2026-11-16');
    expect(p.preview[0]!.date).toBe('2026-11-16');
  });
  it('previews nothing and says so when no scheduled workout changes', () => {
    const p = planProgramEdit({ ...args, scope: 'exercise_future', edits: [], });
    expect(p.preview).toEqual([]);
    expect(p.summary).toMatch(/No scheduled workout changes/);
  });
  it('skips days the program is not live on (paused/ended)', () => {
    const p = planProgramEdit({ ...args, isLiveOn: (d) => d < '2026-11-10', scope: 'exercise_future', edits: replaceLegPress });
    expect(p.preview.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-09']);
  });
  it('applies the edit kinds correctly', () => {
    const updated = applyEdit(tree, { kind: 'update_prescription', plan_key: 'legpress', patch: { sets: 4, start_load_kg: 90 } });
    expect(updated.planned.find((p) => p.plan_key === 'legpress')).toMatchObject({ sets: 4, start_load_kg: 90 });
    const removed = applyEdit(tree, { kind: 'remove_exercise', plan_key: 'pulldown' });
    expect(removed.planned.map((p) => p.plan_key)).toEqual(['legpress', 'chest']);
    const added = applyEdit(tree, { kind: 'add_exercise', template_key: 'fri', row: row('new', 'fri', { exercise_id: 'hack', position: 1 }) });
    expect(added.planned.filter((p) => p.template_key === 'fri')).toHaveLength(2);
    const reordered = applyEdit(tree, { kind: 'reorder', template_key: 'mon', ordered_plan_keys: ['pulldown', 'legpress'] });
    expect(reordered.planned.find((p) => p.plan_key === 'pulldown')!.position).toBe(0);
    const moved = applyEdit(tree, { kind: 'update_day', template_key: 'mon', patch: { weekday: 2, name: 'Tuesday' } });
    expect(moved.templates.find((t) => t.template_key === 'mon')).toMatchObject({ weekday: 2, name: 'Tuesday' });
    const gone = applyEdit(tree, { kind: 'remove_day', template_key: 'fri' });
    expect(gone.templates).toHaveLength(1);
    expect(gone.planned.some((p) => p.template_key === 'fri')).toBe(false);
  });
  it('describes differences in plain language', () => {
    const before = tree.planned.filter((p) => p.template_key === 'mon');
    const after = applyEdit(tree, { kind: 'update_prescription', plan_key: 'legpress', patch: { sets: 4 } }).planned.filter((p) => p.template_key === 'mon');
    expect(diffDay(before, after, nameOf)).toEqual(['Leg Press: changes sets']);
    expect(diffDay(before, before.slice(0, 1), nameOf)).toEqual(['Removes Lat Pulldown']);
  });
  it('finds the date of a weekday inside a given week', () => {
    expect(occurrenceInWeek(5, '2026-11-04', 1)).toBe('2026-11-06');
    expect(occurrenceInWeek(1, '2026-11-04', 1)).toBe('2026-11-02');
  });
});
