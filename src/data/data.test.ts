import { beforeEach, describe, expect, it } from 'vitest';
import { configureRuntime } from './runtime';
import { resetDb, tbl } from './db';
import { SEED, SEED_ROWS, seedId } from './seed/exercises';
import { ROUTINE_V6_DAYS, ROUTINE_V6_WEEKLY_SETS, routineV6Program, routineV6Tree } from './seed/routineV6';
import { archiveExercise, createExercise, blankExercise, exerciseMap, listExercises, seedLibrary, updateExercise, duplicateExercise } from './repo/exercises';
import { createProgram, getBundle, listModifications, setProgramStatus, treeOfVersion, duplicateProgram } from './repo/programs';
import * as S from './repo/sessions';
import { listSessions, loadAnalytics, exerciseInsight, compareSessions } from './repo/history';
import { muscleCredits, type MuscleGroup } from '@/domain/muscles';
import { planProgramEdit } from '@/domain/editScope';
import { resolveVersion, occurrences } from '@/domain/versioning';
import { matchOccurrences, attendance } from '@/domain/adherence';
import { periodStats } from '@/domain/analytics';
import type { WorkoutSession } from '@/domain/types';

let tick = 0;
let ids = 0;
const T0 = Date.parse('2026-10-26T06:00:00.000Z');
function clock(): void {
  tick = 0; ids = 0;
  configureRuntime({ now: () => new Date(T0 + tick++ * 1000).toISOString(), newId: () => `id-${String(++ids).padStart(5, '0')}`, userId: null, deviceId: 'test-device' });
}
const TODAY = '2026-10-26'; // Monday: program day 1

async function setup() {
  clock();
  await resetDb();
  await seedLibrary();
  const { program, version } = await createProgram(routineV6Program(), routineV6Tree(), TODAY);
  return { program, version };
}

const exId = (key: string): string => seedId(key);

/** Complete every planned set of a session exercise with the given values. */
async function doSets(sessionId: string, exerciseKey: string, w: number | null, reps: number[]): Promise<string[]> {
  const views = await S.sessionExercises(sessionId);
  const v = views.find((x) => x.exercise.id === exId(exerciseKey))!;
  const planned = v.sets.filter((s) => !s.parent_set_id);
  const done: string[] = [];
  for (const [i, r] of reps.entries()) {
    const target = planned[i] ?? (await S.addSet(v.se.id));
    await S.logSet(target.id, { weight_kg: w, reps: r, rir: 1 });
    done.push(target.id);
  }
  return done;
}

describe('exercise library seed', () => {
  beforeEach(async () => { clock(); await resetDb(); });
  it('is reproducible and never creates duplicates when applied repeatedly', async () => {
    const a = await seedLibrary();
    expect(a.inserted).toBe(SEED.length);
    const b = await seedLibrary();
    const c = await seedLibrary();
    expect(b).toEqual({ inserted: 0, updated: 0, unchanged: SEED.length });
    expect(c.inserted).toBe(0);
    expect(await tbl('exercises').count()).toBe(SEED.length);
  });
  it('has unique keys/ids, valid references and a useful starter set', () => {
    expect(new Set(SEED.map((s) => s.key)).size).toBe(SEED.length);
    expect(new Set(SEED_ROWS.map((r) => r.id)).size).toBe(SEED.length);
    expect(SEED.length).toBeGreaterThanOrEqual(100);
    const keys = new Set(SEED.map((s) => s.key));
    for (const s of SEED) {
      for (const k of s.sub ?? []) expect(keys.has(k), `${s.key} → substitute ${k}`).toBe(true);
      if (s.var) expect(keys.has(s.var), `${s.key} → variation ${s.var}`).toBe(true);
    }
    expect(seedId('pull-up')).toBe(seedId('pull-up')); // deterministic
    for (const r of SEED_ROWS) expect(r.user_id).toBeNull();
  });
  it('built-in rows are never marked dirty (never pushed)', async () => {
    await seedLibrary();
    expect(await tbl('exercises').where('_dirty').equals(1).count()).toBe(0);
  });
  it('custom exercises: create, rename keeps id, archive keeps history, built-ins are read-only', async () => {
    await seedLibrary();
    const e = await createExercise({ ...blankExercise(), name: 'Zottman Curl', primary_muscles: ['biceps'] });
    expect(e.is_custom).toBe(true);
    const renamed = await updateExercise(e.id, { name: 'Zottman Curl (DB)' });
    expect(renamed.id).toBe(e.id);
    await archiveExercise(e.id);
    expect((await listExercises({ q: 'zottman' })).length).toBe(0);
    expect((await listExercises({ q: 'zottman', includeArchived: true })).length).toBe(1);
    await expect(updateExercise(exId('pull-up'), { name: 'x' })).rejects.toThrow(/read-only/);
    await expect(archiveExercise(exId('pull-up'))).rejects.toThrow(/cannot be archived/);
    await expect(createExercise({ ...blankExercise(), name: '  ' })).rejects.toThrow(/name/);
    const copy = await duplicateExercise(exId('pull-up'));
    expect(copy.is_custom).toBe(true);
    expect(copy.variation_of).toBe(exId('pull-up'));
    expect((await exerciseMap()).has(exId('pull-up'))).toBe(true);
  });
  it('searches by name, alias, muscle and equipment', async () => {
    await seedLibrary();
    expect((await listExercises({ q: 'bayesian' })).map((e) => e.name)).toEqual(['Bayesian Cable Curl']);
    expect((await listExercises({ q: 'wide pulldown' })).length).toBe(1);
    expect((await listExercises({ group: 'calves' })).length).toBeGreaterThanOrEqual(3);
    expect((await listExercises({ equipment: 'cable', q: 'curl' })).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the user's v6 routine", () => {
  it('matches the sheet: 98 sets/week and the muscle split', async () => {
    expect(ROUTINE_V6_WEEKLY_SETS).toBe(98);
    expect(ROUTINE_V6_DAYS.map((d) => d.lines.reduce((a, l) => a + l.sets, 0))).toEqual([9, 23, 9, 24, 10, 23]);
    await seedLibrary();
    const byId = new Map(SEED_ROWS.map((r) => [r.id, r]));
    const totals = new Map<MuscleGroup, number>();
    for (const row of routineV6Tree().planned) {
      for (const c of muscleCredits(byId.get(row.exercise_id)!, 'direct')) totals.set(c.group, (totals.get(c.group) ?? 0) + row.sets * c.weight);
    }
    expect(totals.get('biceps')).toBe(19);
    expect(totals.get('triceps')).toBe(16);
    expect(totals.get('chest')).toBe(14);
    expect(totals.get('back')).toBe(14);
  });
  it('every exercise exists in the library and Sunday is a rest day', async () => {
    const keys = new Set(SEED.map((s) => s.key));
    for (const d of ROUTINE_V6_DAYS) for (const l of d.lines) expect(keys.has(l.ex), l.ex).toBe(true);
    const { program, version } = await setup();
    const bundle = (await getBundle(program.id))!;
    expect(bundle.templates.map((t) => t.weekday).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(version.effective_from).toBe('2026-10-26');
    const sun = await S.planForDate('2026-11-01');
    expect(sun).toEqual([]);
    const mon = await S.planForDate('2026-10-26');
    expect(mon).toHaveLength(1);
    expect(mon[0]!.planned.map((p) => p.label)).toEqual(['A1', 'A2', 'B1']);
    expect(await S.planForDate('2026-10-25')).toEqual([]); // before the program starts
  });
});

describe('workout sessions', () => {
  beforeEach(async () => { await setup(); });
  const startMonday = async (): Promise<WorkoutSession> => {
    const [item] = await S.planForDate(TODAY);
    return S.startScheduled(item!.bundle.program.id, item!.template.template_key, TODAY, TODAY);
  };

  it('starts a scheduled workout idempotently — a double tap never duplicates it', async () => {
    const a = await startMonday();
    const b = await startMonday();
    expect(b.id).toBe(a.id);
    expect(await tbl('workout_sessions').count()).toBe(1);
    const views = await S.sessionExercises(a.id);
    expect(views).toHaveLength(3);
    expect(views.reduce((n, v) => n + v.sets.length, 0)).toBe(9);
    expect((await S.activeSession())!.id).toBe(a.id);
  });
  it('keeps PLANNED and ACTUAL separate and freezes the prescription in the session', async () => {
    const s = await startMonday();
    const v = (await S.sessionExercises(s.id)).find((x) => x.exercise.id === exId('underhand-lat-pulldown'))!;
    expect(v.se.planned!.sets).toBe(3);
    expect(v.se.planned!.technique_code).toBe('myo_rest_pause');
    const first = v.sets[0]!;
    expect(first.planned_weight_kg).toBe(65);
    expect(first.weight_kg).toBeNull(); // nothing is pre-filled as an actual
    expect(first.reps).toBeNull();
    await S.logSet(first.id, { weight_kg: 67.5, reps: 11, rir: 1 });
    const after = (await S.sessionExercises(s.id)).find((x) => x.exercise.id === exId('underhand-lat-pulldown'))!.sets[0]!;
    expect(after).toMatchObject({ planned_weight_kg: 65, planned_reps_min: 8, planned_reps_max: 12, weight_kg: 67.5, reps: 11, status: 'completed' });
    expect(after.completed_at).toBeTruthy();
  });
  it('rejects invalid input before it is stored', async () => {
    const s = await startMonday();
    const set = (await S.sessionExercises(s.id))[0]!.sets[0]!;
    await expect(S.logSet(set.id, { weight_kg: -5, reps: 5 })).rejects.toThrow(/Weight/);
    await expect(S.logSet(set.id, { weight_kg: 50, reps: 2.5 })).rejects.toThrow(/whole number/);
    await expect(S.logSet(set.id, { weight_kg: 50, reps: 5, rpe: 12 })).rejects.toThrow(/RPE/);
    expect((await tbl('set_records').get(set.id))!.status).toBe('planned');
  });
  it('completes as planned when everything is done', async () => {
    const s = await startMonday();
    await doSets(s.id, 'underhand-lat-pulldown', 65, [10, 9, 8]);
    await doSets(s.id, 'leg-press', 80, [12, 12, 10]);
    await doSets(s.id, 'standing-calf-raise', 50, [15, 14, 12]);
    const f = await S.finishSession(s.id, { session_rpe: 8, notes: 'Felt good' });
    expect(f.status).toBe('completed_as_planned');
    expect(f.finished_at).toBeTruthy();
    expect(f.session_rpe).toBe(8);
  });
  it('can leave an exercise incomplete without losing the session (partial), and keeps the unlogged sets visible', async () => {
    const s = await startMonday();
    await doSets(s.id, 'underhand-lat-pulldown', 65, [10, 9, 8]);
    await doSets(s.id, 'leg-press', 80, [12]);
    const f = await S.finishSession(s.id);
    expect(f.status).toBe('partial');
    const views = await S.sessionExercises(s.id);
    const calves = views.find((v) => v.exercise.id === exId('standing-calf-raise'))!;
    expect(calves.se.status).toBe('skipped');
    expect(calves.sets.every((x) => x.status === 'skipped')).toBe(true); // recorded as not done, not as zero reps
    expect(calves.sets.every((x) => x.reps === null)).toBe(true);
  });
  it('refuses to finish a session with nothing logged (the user can skip it instead)', async () => {
    const s = await startMonday();
    await expect(S.finishSession(s.id)).rejects.toBeInstanceOf(S.NothingLoggedError);
  });
  it('substituting for TODAY only leaves the program and the original prescription untouched', async () => {
    const s = await startMonday();
    const before = (await getBundle((await tbl('programs').toArray())[0]!.id))!;
    const v = (await S.sessionExercises(s.id)).find((x) => x.exercise.id === exId('leg-press'))!;
    const sub = await S.substituteExercise(v.se.id, exId('hack-squat'), 'session', 'Leg press taken');
    expect(sub.origin).toBe('substituted');
    expect(sub.substituted_from_exercise_id).toBe(exId('leg-press'));
    expect(sub.planned!.snapshot_exercise_id).toBe(exId('leg-press')); // original prescription kept
    const setRows = (await S.sessionExercises(s.id)).find((x) => x.se.id === v.se.id)!.sets;
    expect(setRows.every((x) => x.exercise_id === exId('hack-squat'))).toBe(true);
    expect(setRows[0]!.planned_weight_kg).toBeNull(); // leg-press loads are NOT assumed equivalent
    const after = (await getBundle(before.program.id))!;
    expect(after.planned.map((p) => p.exercise_id).sort()).toEqual(before.planned.map((p) => p.exercise_id).sort());
    expect(after.versions).toHaveLength(1);
    // the replaced exercise is tracked separately from the original
    await doSets(s.id, 'hack-squat', 100, [12, 12, 12]);
    await doSets(s.id, 'underhand-lat-pulldown', 65, [10, 10, 10]);
    await doSets(s.id, 'standing-calf-raise', 50, [15, 15, 15]);
    const f = await S.finishSession(s.id);
    expect(f.status).toBe('completed_modified');
    expect(f.change_reason).toMatch(/1 substituted/);
  });
  it('refuses to substitute after sets were logged, and lets you add the other exercise instead', async () => {
    const s = await startMonday();
    await doSets(s.id, 'leg-press', 80, [10]);
    const v = (await S.sessionExercises(s.id)).find((x) => x.exercise.id === exId('leg-press'))!;
    await expect(S.substituteExercise(v.se.id, exId('hack-squat'), 'session')).rejects.toThrow(/already logged/);
    const added = await S.addExerciseToSession(s.id, exId('hack-squat'), 2);
    expect(added.origin).toBe('added');
    expect((await S.sessionExercises(s.id)).length).toBe(4);
  });
  it('adds an unplanned exercise while retaining the original plan', async () => {
    const s = await startMonday();
    await S.addExerciseToSession(s.id, exId('hammer-curl'), 3);
    const views = await S.sessionExercises(s.id);
    expect(views).toHaveLength(4);
    const added = views.at(-1)!;
    expect(added.se.planned).toBeNull();
    expect(views.slice(0, 3).every((v) => v.se.planned !== null)).toBe(true);
  });
  it('plans the next session from the last one (previous weights become the new targets)', async () => {
    const s = await startMonday();
    await doSets(s.id, 'underhand-lat-pulldown', 70, [10, 9, 8]);
    await doSets(s.id, 'leg-press', 90, [12, 12, 12]);
    await doSets(s.id, 'standing-calf-raise', 55, [15, 15, 15]);
    await S.finishSession(s.id);
    const next = await S.startScheduled((await tbl('programs').toArray())[0]!.id, (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!.template_key, '2026-11-02', '2026-11-02');
    const v = (await S.sessionExercises(next.id)).find((x) => x.exercise.id === exId('underhand-lat-pulldown'))!;
    expect(v.sets.map((x) => x.planned_weight_kg)).toEqual([70, 70, 70]);
    const prev = await S.lastPerformance(exId('underhand-lat-pulldown'), '2026-11-02', next.id);
    expect(prev!.date).toBe('2026-10-26');
    expect(prev!.sets.map((x) => x.reps)).toEqual([10, 9, 8]);
  });
  it('pause/resume accounts for paused time', async () => {
    const s = await startMonday();
    await S.pauseSession(s.id);
    expect((await S.getSession(s.id))!.paused_at).toBeTruthy();
    await S.resumeSession(s.id);
    const r = (await S.getSession(s.id))!;
    expect(r.paused_at).toBeNull();
    expect(r.paused_total_s).toBeGreaterThanOrEqual(0);
  });
  it('guided technique components (drop sets, rest-pause) are separate linked records', async () => {
    const s = await startMonday();
    const v = (await S.sessionExercises(s.id)).find((x) => x.exercise.id === exId('underhand-lat-pulldown'))!;
    const last = v.sets.at(-1)!;
    await S.logSet(last.id, { weight_kg: 60, reps: 9, rir: 0, failure: 'muscular' });
    const c1 = (await S.addComponentSet(last.id))!;
    const c2 = (await S.addComponentSet(last.id))!;
    expect(await S.addComponentSet(last.id)).toBeNull(); // rest-pause allows two segments
    expect(c1).toMatchObject({ set_type: 'rest_pause', parent_set_id: last.id, planned_weight_kg: 60 });
    await S.logSet(c1.id, { weight_kg: 60, reps: 4 });
    await S.logSet(c2.id, { weight_kg: 60, reps: 3 });
    const data = await loadAnalytics('2026-10-01', '2026-11-30', TODAY);
    const st = periodStats(data.sets, data.ctx);
    expect(st.workingSets).toBe(1); // components do not add working sets…
    expect(st.reps).toBe(16);      // …but their reps and volume count
    expect(st.volumeKg).toBe(60 * 16);
  });
});

describe('skipping, rescheduling and attendance', () => {
  beforeEach(async () => { await setup(); });
  it('a skipped workout stays visible and is not a zero-performance session', async () => {
    const [item] = await S.planForDate(TODAY);
    const sk = await S.skipScheduled(item!.bundle.program.id, item!.template.template_key, TODAY, 'Sick');
    expect(sk.status).toBe('skipped');
    expect(sk.skip_reason).toBe('Sick');
    expect((await listSessions({})).map((x) => x.status)).toContain('skipped');
    const data = await loadAnalytics('2026-10-01', '2026-11-30', TODAY);
    const st = periodStats(data.sets, data.ctx);
    expect(st.sessions).toBe(0);
    expect(st.volumeKg).toBe(0);
    expect((await S.planForDate(TODAY))[0]!.session!.status).toBe('skipped');
  });
  it('reschedules to another day, keeps both records, and attendance follows the replacement', async () => {
    const [item] = await S.planForDate(TODAY);
    const programId = item!.bundle.program.id;
    const key = item!.template.template_key;
    const r = await S.rescheduleScheduled(programId, key, TODAY, '2026-10-28', 'MMA camp');
    expect(r.original.status).toBe('rescheduled');
    expect(r.original.rescheduled_to).toBe('2026-10-28');
    expect(r.replacement.status).toBe('planned');
    const started = await S.startScheduled(programId, key, '2026-10-28', '2026-10-28');
    await doSets(started.id, 'underhand-lat-pulldown', 65, [10, 10, 10]);
    await doSets(started.id, 'leg-press', 80, [12, 12, 12]);
    await doSets(started.id, 'standing-calf-raise', 40, [15, 15, 15]);
    await S.finishSession(started.id);
    const bundle = (await getBundle(programId))!;
    const occ = occurrences(bundle.program, bundle.versions, bundle.templates, '2026-10-26', '2026-10-28').filter((o) => o.template.weekday === 1);
    const sessions = await tbl('workout_sessions').toArray();
    const res = matchOccurrences(occ, sessions, '2026-11-03');
    expect(res[0]!.outcome).toBe('rescheduled_done');
    expect(attendance(res).rate).toBe(1);
    await expect(S.rescheduleScheduled(programId, key, TODAY, TODAY, null)).rejects.toThrow(/different day/);
  });
  it('a started workout with nothing logged can be skipped in place; one with logged sets cannot', async () => {
    const [item] = await S.planForDate(TODAY);
    const pid = item!.bundle.program.id; const key = item!.template.template_key;
    const started = await S.startScheduled(pid, key, TODAY, TODAY);
    const sk = await S.skipScheduled(pid, key, TODAY, 'No sets logged');
    expect(sk.id).toBe(started.id);
    expect(sk.status).toBe('skipped');
    expect(await tbl('workout_sessions').count()).toBe(1);
    // restore, start again, log a set: skipping is now refused (it would hide real performance)
    await S.skipScheduled(pid, key, TODAY, null).catch(() => undefined);
    const again = await S.startScheduled(pid, key, TODAY, TODAY);
    const set = (await tbl('set_records').where('session_id').equals(again.id).toArray()).find((r) => r.set_type === 'working')!;
    await S.logSet(set.id, { weight_kg: 60, reps: 8, rir: 1 });
    await expect(S.skipScheduled(pid, key, TODAY, 'oops')).rejects.toThrow(/already has logged sets/);
  });
  it('can restore a skipped workout and then start it', async () => {
    const [item] = await S.planForDate(TODAY);
    await S.skipScheduled(item!.bundle.program.id, item!.template.template_key, TODAY, null);
    const s = await S.startScheduled(item!.bundle.program.id, item!.template.template_key, TODAY, TODAY);
    expect(s.status).toBe('in_progress');
    expect(await tbl('workout_sessions').count()).toBe(1);
  });
});

describe('program editing, versions and scopes', () => {
  let programId = '';
  beforeEach(async () => { programId = (await setup()).program.id; });

  async function planFor(scope: Parameters<typeof planProgramEdit>[0]['scope'], targetDate?: string, opts: { today?: string; todayHasSession?: boolean } = {}) {
    const bundle = (await getBundle(programId))!;
    const v = bundle.versions[0]!;
    const names = await exerciseMap();
    const tree = treeOfVersion(bundle, v.id);
    const lp = tree.planned.find((p) => p.exercise_id === exId('leg-press'))!;
    const edits = [{ kind: 'replace_exercise' as const, plan_key: lp.plan_key, exercise_id: exId('hack-squat') }];
    const plan = planProgramEdit({ scope, edits, current: tree, today: opts.today ?? TODAY, todayHasSession: opts.todayHasSession, targetDate, nameOf: (id) => names.get(id)?.name ?? id, versionIsUnused: await (await import('./repo/programs')).versionIsUnused(v.id), isLiveOn: () => true });
    return { plan, edits };
  }

  it('edits an unused version in place (no version spam while building the program)', async () => {
    const { plan, edits } = await planFor('exercise_future');
    expect(plan.mode).toBe('in_place');
    const res = await S.commitProgramEdit({ programId, plan, edits, description: 'Leg press → hack squat', today: TODAY });
    expect(res.mode).toBe('in_place');
    const bundle = (await getBundle(programId))!;
    expect(bundle.versions).toHaveLength(1);
    expect(bundle.planned.some((p) => p.exercise_id === exId('hack-squat'))).toBe(true);
    expect(bundle.planned.some((p) => p.exercise_id === exId('leg-press'))).toBe(false);
    expect((await listModifications(programId))[0]!.kind).toBe('edited_in_place');
  });

  it('a future-sessions edit AFTER a session was performed creates a new version and preserves history', async () => {
    // perform Monday 26 Oct against version 1
    const [item] = await S.planForDate(TODAY);
    const s = await S.startScheduled(programId, item!.template.template_key, TODAY, TODAY);
    await doSets(s.id, 'underhand-lat-pulldown', 65, [10, 10, 10]);
    await doSets(s.id, 'leg-press', 80, [12, 12, 12]);
    await doSets(s.id, 'standing-calf-raise', 40, [15, 15, 15]);
    await S.finishSession(s.id);

    const { plan, edits } = await planFor('exercise_future', undefined, { todayHasSession: true });
    // preview goes first: it names exactly which workouts change, and nothing is applied yet
    expect(plan.mode).toBe('new_version');
    expect(plan.effectiveFrom).toBe('2026-10-27'); // today's workout is already done, so the change starts tomorrow
    expect(plan.preview.length).toBeGreaterThan(0);
    expect(plan.preview[0]!.changes[0]).toMatch(/Replaces Leg Press with Hack Squat/);
    expect((await getBundle(programId))!.versions).toHaveLength(1);

    const res = await S.commitProgramEdit({ programId, plan, edits, description: 'Leg press → hack squat', today: TODAY });
    expect(res.mode).toBe('new_version');
    const bundle = (await getBundle(programId))!;
    expect(bundle.versions.map((v) => v.version_no)).toEqual([1, 2]);
    const v1 = resolveVersion(bundle.versions, '2026-10-26')!;
    const v2 = resolveVersion(bundle.versions, '2026-11-09')!;
    expect(v1.version_no).toBe(1);
    expect(v2.version_no).toBe(2);
    const keys = (vid: string) => bundle.planned.filter((p) => p.program_version_id === vid).map((p) => p.exercise_id);
    expect(keys(v1.id)).toContain(exId('leg-press'));    // history intact
    expect(keys(v2.id)).toContain(exId('hack-squat'));   // new prescription
    expect(keys(v2.id)).not.toContain(exId('leg-press'));
    // stable identities link the "same" prescription across versions
    const k1 = bundle.planned.find((p) => p.program_version_id === v1.id && p.exercise_id === exId('leg-press'))!.plan_key;
    const k2 = bundle.planned.find((p) => p.program_version_id === v2.id && p.exercise_id === exId('hack-squat'))!.plan_key;
    expect(k1).toBe(k2);
    // the performed session still points at version 1 and still shows the leg press prescription
    const old = (await S.getSession(s.id))!;
    expect(old.program_version_id).toBe(v1.id);
    expect((await S.sessionExercises(s.id)).some((v) => v.exercise.id === exId('leg-press'))).toBe(true);
    // the next Monday uses the new version
    const next = (await S.planForDate('2026-11-09'))[0]!;
    expect(next.planned.map((p) => p.exercise_id)).toContain(exId('hack-squat'));
    const mods = await listModifications(programId);
    expect(mods[0]).toMatchObject({ kind: 'new_version', scope: 'exercise_future', to_version_id: v2.id });
    expect((await tbl('audit_events').toArray()).some((a) => a.action === 'new_version')).toBe(true);
  });

  it('"this day this week" only changes that one date via a persisted planned session', async () => {
    const { plan, edits } = await planFor('day_week', '2026-11-02');
    expect(plan.mode).toBe('week_override');
    const res = await S.commitProgramEdit({ programId, plan, edits, description: 'Leg press unavailable this week', today: TODAY });
    expect(res.sessionId).toBeTruthy();
    expect((await getBundle(programId))!.versions).toHaveLength(1);
    expect((await getBundle(programId))!.planned.some((p) => p.exercise_id === exId('hack-squat'))).toBe(false); // program untouched
    const item = (await S.planForDate('2026-11-02'))[0]!;
    expect(item.session!.status).toBe('planned');
    const views = await S.sessionExercises(item.session!.id);
    expect(views.map((v) => v.exercise.id)).toContain(exId('hack-squat'));
    const other = (await S.planForDate('2026-11-09'))[0]!;
    expect(other.session).toBeNull();
    expect(other.planned.map((p) => p.exercise_id)).toContain(exId('leg-press'));
    // starting that day uses the override
    const started = await S.startScheduled(programId, item.template.template_key, '2026-11-02', '2026-11-02');
    expect(started.id).toBe(item.session!.id);
    expect(started.status).toBe('in_progress');
  });

  it('pauses and resumes a program; paused days are not scheduled', async () => {
    await setProgramStatus(programId, 'paused', '2026-11-01');
    let bundle = (await getBundle(programId))!;
    expect(bundle.program.paused_intervals).toEqual([{ from: '2026-11-01', to: null }]);
    await setProgramStatus(programId, 'active', '2026-11-08');
    bundle = (await getBundle(programId))!;
    expect(bundle.program.paused_intervals).toEqual([{ from: '2026-11-01', to: '2026-11-08' }]);
    expect(await S.planForDate('2026-11-02')).toEqual([]); // paused
    expect((await S.planForDate('2026-11-09')).length).toBe(1);
  });

  it('duplicates a program with fresh keys and keeps the source unchanged', async () => {
    const copy = await duplicateProgram(programId, 'v7 draft', TODAY, { asTemplate: false });
    const a = (await getBundle(programId))!;
    const b = (await getBundle(copy.id))!;
    expect(b.planned).toHaveLength(a.planned.length);
    expect(new Set(b.planned.map((p) => p.plan_key)).size).toBe(b.planned.length);
    expect(b.planned.some((p) => a.planned.some((q) => q.plan_key === p.plan_key))).toBe(false);
    expect(b.program.cloned_from).toBe(programId);
  });
});

describe('historical corrections and undo', () => {
  let programId = '';
  let sessionId = '';
  beforeEach(async () => {
    programId = (await setup()).program.id;
    const [item] = await S.planForDate(TODAY);
    const s = await S.startScheduled(programId, item!.template.template_key, TODAY, TODAY);
    sessionId = s.id;
    await doSets(s.id, 'underhand-lat-pulldown', 65, [10, 10, 10]);
    await doSets(s.id, 'leg-press', 80, [12, 12, 12]);
    await doSets(s.id, 'standing-calf-raise', 40, [15, 15, 15]);
    await S.finishSession(s.id);
  });

  it('correcting a finished set updates analytics, records the correction and leaves the prescription alone', async () => {
    const before = await loadAnalytics('2026-10-01', '2026-11-30', TODAY);
    const volBefore = periodStats(before.sets, before.ctx).volumeKg;
    const target = (await S.sessionExercises(sessionId)).find((v) => v.exercise.id === exId('leg-press'))!.sets[0]!;
    const snapshotBefore = JSON.stringify((await S.sessionExercises(sessionId)).map((v) => v.se.planned));
    await S.editSet(target.id, { weight_kg: 100, reps: 12 }, 'Typo: it was 100, not 80');
    const after = await loadAnalytics('2026-10-01', '2026-11-30', TODAY);
    expect(periodStats(after.sets, after.ctx).volumeKg).toBe(volBefore + (100 - 80) * 12);
    expect(JSON.stringify((await S.sessionExercises(sessionId)).map((v) => v.se.planned))).toBe(snapshotBefore);
    const sess = (await S.getSession(sessionId))!;
    expect(sess.corrected_after_completion).toBe(true);
    const ev = (await tbl('audit_events').toArray()).filter((a) => a.entity_id === target.id && a.action === 'correct');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ before: { weight_kg: 80 }, after: { weight_kg: 100 }, reason: 'Typo: it was 100, not 80' });
    // the exercise's PR history recomputes from the corrected data
    const insight = (await exerciseInsight(exId('leg-press'), '2026-11-30'))!;
    expect(insight.prs.find((p) => p.type === 'max_weight')!.value).toBe(100);
  });

  it('deleting a set is a soft delete with undo; deleting the only evidence of a planned set re-classifies the session', async () => {
    const v = (await S.sessionExercises(sessionId)).find((x) => x.exercise.id === exId('leg-press'))!;
    expect((await S.getSession(sessionId))!.status).toBe('completed_as_planned');
    await S.deleteSet(v.sets[2]!.id, 'Logged by mistake');
    expect((await S.getSession(sessionId))!.status).toBe('partial'); // one planned set is now missing
    expect(await tbl('set_records').get(v.sets[2]!.id)).toMatchObject({ deleted_at: expect.any(String) }); // still in the table
    await S.restoreSet(v.sets[2]!.id);
    expect((await S.getSession(sessionId))!.status).toBe('completed_as_planned');
  });

  it('reopening a finished session is audited, and re-finishing re-classifies it', async () => {
    await S.reopenSession(sessionId, 'Forgot one set');
    expect((await S.getSession(sessionId))!.status).toBe('in_progress');
    expect((await tbl('audit_events').toArray()).some((a) => a.action === 'reopen' && a.reason === 'Forgot one set')).toBe(true);
    const f = await S.finishSession(sessionId);
    expect(f.status).toBe('completed_as_planned');
  });

  it('changing the date of a session moves its sets with it (denormalised dates stay consistent)', async () => {
    await S.changeSessionDate(sessionId, '2026-10-25', 'Logged a day late');
    const sets = await tbl('set_records').where('session_id').equals(sessionId).toArray();
    expect(sets.every((s) => s.session_date === '2026-10-25')).toBe(true);
    expect((await S.getSession(sessionId))!.session_date).toBe('2026-10-25');
  });

  it('an archived exercise never disappears from history', async () => {
    const c = await createExercise({ ...blankExercise(), name: 'Zottman Curl', primary_muscles: ['biceps'] });
    const s2 = await S.startAdhoc('Extra arms', '2026-10-27');
    const se = await S.addExerciseToSession(s2.id, c.id, 1);
    const set = (await S.sessionExercises(s2.id))[0]!.sets[0]!;
    await S.logSet(set.id, { weight_kg: 12, reps: 10 });
    await S.finishSession(s2.id);
    await archiveExercise(c.id);
    const views = await S.sessionExercises(s2.id);
    expect(views[0]!.exercise.name).toBe('Zottman Curl');
    expect(views[0]!.se.id).toBe(se.id);
    expect((await listSessions({ exerciseId: c.id })).map((x) => x.id)).toEqual([s2.id]);
  });
});

describe('history queries', () => {
  beforeEach(async () => { await setup(); });
  it('filters, searches notes and paginates newest-first', async () => {
    const programId = (await tbl('programs').toArray())[0]!.id;
    const monKey = (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!.template_key;
    const dates = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
    const made: string[] = [];
    for (const d of dates) {
      const s = await S.startScheduled(programId, monKey, d, d);
      await doSets(s.id, 'leg-press', 80, [12]);
      await S.updateSession(s.id, { notes: d === '2026-11-09' ? 'knee felt tight' : null, tags: d === '2026-11-16' ? ['deload'] : [], is_bookmarked: d === '2026-10-26' });
      await S.finishSession(s.id);
      made.push(s.id);
    }
    expect((await listSessions({})).map((s) => s.session_date)).toEqual([...dates].reverse());
    expect((await listSessions({}, 2, 0)).length).toBe(2);
    expect((await listSessions({}, 2, 2)).map((s) => s.session_date)).toEqual(['2026-11-02', '2026-10-26']);
    expect((await listSessions({ q: 'knee' })).map((s) => s.session_date)).toEqual(['2026-11-09']);
    expect((await listSessions({ tag: 'deload' })).map((s) => s.session_date)).toEqual(['2026-11-16']);
    expect((await listSessions({ bookmarked: true })).map((s) => s.session_date)).toEqual(['2026-10-26']);
    expect((await listSessions({ from: '2026-11-01', to: '2026-11-10' })).length).toBe(2);
    expect((await listSessions({ exerciseId: exId('leg-press') })).length).toBe(4);
    expect((await listSessions({ exerciseId: exId('hammer-curl') })).length).toBe(0);
    expect((await listSessions({ group: 'quads' })).length).toBe(4);
    const cmp = await compareSessions(made[0]!, made[1]!);
    expect(cmp.find((c) => c.exercise_id === exId('leg-press'))!.a!.volumeKg).toBe(960);
  });

  it('repeating a past workout copies its structure with the old actuals as new targets', async () => {
    const programId = (await tbl('programs').toArray())[0]!.id;
    const monKey = (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!.template_key;
    const s = await S.startScheduled(programId, monKey, TODAY, TODAY);
    await doSets(s.id, 'leg-press', 85, [12, 11, 10]);
    await S.finishSession(s.id);
    const r = await S.repeatSession(s.id, '2026-11-03');
    expect(r.repeated_from).toBe(s.id);
    expect(r.dedupe_key).toBeNull(); // repeats are deliberate extras, not the scheduled occurrence
    const v = (await S.sessionExercises(r.id)).find((x) => x.exercise.id === exId('leg-press'))!;
    expect(v.sets.map((x) => x.planned_weight_kg)).toEqual([85, 85, 85]);
    expect(v.sets.every((x) => x.reps === null)).toBe(true);
  });
});
