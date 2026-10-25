import Dexie from 'dexie';
import type { Exercise, ExerciseCategory, ISODate, PlannedExercise, PlannedFields, PlannedSnapshot, Program, ProgramVersion, SessionExercise, SessionStatus, SetRecord, SetType, WorkoutSession, WorkoutTemplate, WorkoutType } from '@/domain/types';
import type { PlanTree } from '@/domain/editScope';
import { classifyCompletion, assertTransition, FINISHED, type SlotInput } from '@/domain/sessionState';
import { templatesOnDate } from '@/domain/versioning';
import { todayISO } from '@/domain/periods';
import { validateSetInput } from '@/domain/validate';
import { nextComponent } from '@/domain/techniques';
import { allTables, db, tbl } from '../db';
import { insert, update } from '../write';
import { audit, diffFields } from '../audit';
import { nowIso } from '../runtime';
import { activePrograms, commitEdit, type CommitInput, type CommitResult, type ProgramBundle } from './programs';
import { bodyweightKgOn } from './misc';

const clean = <T extends { _dirty: 0 | 1 }>(r: T): Omit<T, '_dirty'> => { const { _dirty: _d, ...rest } = r; void _d; return rest; };
const defined = <T,>(x: T | undefined): x is T => x !== undefined;
const SESSION_TABLES = allTables;

export const schedKey = (templateKey: string, date: ISODate): string => `sched:${templateKey}:${date}`;

// ── Reading ─────────────────────────────────────────────────────────────────
export interface DayItem {
  date: ISODate;
  bundle: ProgramBundle;
  version: ProgramVersion;
  template: WorkoutTemplate;
  planned: PlannedExercise[];
  session: WorkoutSession | null;
}

export async function getSession(id: string): Promise<WorkoutSession | undefined> {
  const s = await tbl('workout_sessions').get(id);
  return s ? (clean(s) as WorkoutSession) : undefined;
}

export async function sessionByDedupe(key: string): Promise<WorkoutSession | undefined> {
  const s = (await tbl('workout_sessions').where('dedupe_key').equals(key).toArray()).find((x) => !x.deleted_at);
  return s ? (clean(s) as WorkoutSession) : undefined;
}

/** What the program schedules for a date, joined with any session already created for it (planned/started/finished/skipped). */
export async function planForDate(date: ISODate): Promise<DayItem[]> {
  const out: DayItem[] = [];
  for (const bundle of await activePrograms()) {
    for (const t of templatesOnDate(bundle.program, bundle.versions, bundle.templates, date)) {
      const version = bundle.versions.find((v) => v.id === t.program_version_id) as ProgramVersion;
      const planned = bundle.planned.filter((p) => p.template_id === t.id).sort((a, b) => a.position - b.position);
      out.push({ date, bundle, version, template: t, planned, session: (await sessionByDedupe(schedKey(t.template_key, date))) ?? null });
    }
  }
  return out;
}

export async function activeSession(): Promise<WorkoutSession | undefined> {
  const rows = (await tbl('workout_sessions').where('status').equals('in_progress').toArray()).filter((s) => !s.deleted_at);
  rows.sort((a, b) => ((a.started_at ?? '') < (b.started_at ?? '') ? 1 : -1));
  return rows[0] ? (clean(rows[0]) as WorkoutSession) : undefined;
}

const bySetOrder = (a: SetRecord, b: SetRecord): number => (a.set_type === 'warmup' ? 0 : 1) - (b.set_type === 'warmup' ? 0 : 1) || a.set_number - b.set_number || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

export interface SessionExerciseView { se: SessionExercise; exercise: Exercise; sets: SetRecord[] }

export async function sessionExercises(sessionId: string): Promise<SessionExerciseView[]> {
  const ses = (await tbl('session_exercises').where('session_id').equals(sessionId).toArray()).filter((e) => !e.deleted_at).sort((a, b) => a.position - b.position);
  const sets = (await tbl('set_records').where('session_id').equals(sessionId).toArray()).filter((s) => !s.deleted_at).map(clean) as SetRecord[];
  const exIds = [...new Set(ses.map((e) => e.exercise_id))];
  const exs = new Map((await tbl('exercises').bulkGet(exIds)).filter(defined).map((e) => [e.id, clean(e) as Exercise]));
  return ses.map((se) => ({
    se: clean(se) as SessionExercise,
    exercise: exs.get(se.exercise_id) as Exercise,
    sets: sets.filter((s) => s.session_exercise_id === se.id).sort(bySetOrder),
  }));
}

/** Most recent PERFORMED session containing this exercise (before a date), as parent working sets by set number. */
export async function lastPerformance(exerciseId: string, before: ISODate, excludeSessionId?: string): Promise<{ date: ISODate; sessionId: string; sets: SetRecord[]; snapshot: PlannedSnapshot | null } | null> {
  const rows = await tbl('set_records').where('[exercise_id+session_date]').between([exerciseId, Dexie.minKey], [exerciseId, before], true, true).toArray();
  const done = rows.filter((s) => !s.deleted_at && s.status === 'completed' && s.set_type !== 'warmup' && !s.parent_set_id && s.session_id !== excludeSessionId);
  if (!done.length) return null;
  const sessions = new Map((await tbl('workout_sessions').bulkGet([...new Set(done.map((s) => s.session_id))])).filter(defined).map((s) => [s.id, s as WorkoutSession]));
  const valid = done.filter((s) => { const ss = sessions.get(s.session_id); return ss && !ss.deleted_at && (FINISHED.has(ss.status) || ss.status === 'in_progress'); });
  if (!valid.length) return null;
  const latest = valid.map((s) => s.session_date).sort().at(-1) as ISODate;
  const sid = valid.filter((s) => s.session_date === latest).sort((a, b) => ((a.completed_at ?? a.created_at) < (b.completed_at ?? b.created_at) ? 1 : -1))[0]!.session_id;
  const sets = valid.filter((s) => s.session_id === sid).map(clean).sort((a, b) => a.set_number - b.set_number) as SetRecord[];
  const se = (await tbl('session_exercises').where('session_id').equals(sid).toArray()).find((e) => e.exercise_id === exerciseId && !e.deleted_at);
  return { date: latest, sessionId: sid, sets, snapshot: se?.planned ?? null };
}

// ── Creating sessions ───────────────────────────────────────────────────────
type PlannedInput = PlannedFields & { plan_key: string | null; planned_exercise_id: string | null };

async function plannedWeightFor(rowFields: PlannedFields, setIdx: number, prev: Awaited<ReturnType<typeof lastPerformance>>): Promise<number | null> {
  // If the prescription's load was edited since last time (e.g. an accepted recommendation), the new prescription wins.
  const planEdited = prev?.snapshot && prev.snapshot.start_load_kg !== rowFields.start_load_kg && rowFields.start_load_kg !== null;
  if (planEdited) return rowFields.start_load_kg;
  if (prev?.sets.length) {
    const s = prev.sets[Math.min(setIdx, prev.sets.length - 1)]!;
    if (s.weight_kg !== null) return s.weight_kg;
  }
  return rowFields.start_load_kg;
}

async function createExerciseRows(sessionId: string, sessionDate: ISODate, position: number, input: PlannedInput, opts: { origin?: SessionExercise['origin']; exerciseId?: string; excludeSession?: string; sets?: number }): Promise<SessionExercise> {
  const exerciseId = opts.exerciseId ?? input.exercise_id;
  const snapshot: PlannedSnapshot | null = input.plan_key ? { ...input, snapshot_exercise_id: input.exercise_id } : null;
  if (snapshot) { delete (snapshot as Partial<PlannedInput>).plan_key; delete (snapshot as Partial<PlannedInput>).planned_exercise_id; }
  const se = clean(await insert('session_exercises', {
    session_id: sessionId, position, exercise_id: exerciseId, planned_exercise_id: input.planned_exercise_id, plan_key: input.plan_key, planned: snapshot,
    origin: opts.origin ?? (input.plan_key ? 'planned' : 'added'), substituted_from_exercise_id: null, substitution_scope: null, status: 'pending', skip_reason: null,
    superset_group: input.superset_group, label: input.label, notes: null,
  })) as SessionExercise;
  const prev = await lastPerformance(exerciseId, sessionDate, opts.excludeSession ?? sessionId);
  const n = opts.sets ?? input.sets;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    await insert('set_records', {
      session_id: sessionId, session_exercise_id: se.id, exercise_id: exerciseId, session_date: sessionDate, set_number: i + 1, set_type: 'working', parent_set_id: null,
      status: 'planned', side: 'both', planned_weight_kg: await plannedWeightFor(input, i, prev), planned_reps_min: input.reps_min, planned_reps_max: input.reps_max,
      planned_rir: input.rir_last_only ? (last ? input.rir_target : null) : input.rir_target, planned_duration_s: input.duration_target_s,
      weight_kg: null, reps: null, reps_partial: null, reps_assisted: null, duration_s: null, distance_m: null, assist_kg: null, bodyweight_kg: null, rpe: null, rir: null,
      failure: null, tempo: input.tempo, eccentric_s: null, pause_bottom_s: null, concentric_s: null, pause_top_s: null, rom: null, quality: null, rest_before_s: null,
      started_at: null, completed_at: null, load_estimated: false, bar_velocity: null, discomfort: null, note: null, extras: {},
    });
  }
  return se;
}

interface CreateOpts {
  program: Program | null; versionId: string | null; template: Pick<WorkoutTemplate, 'id' | 'template_key' | 'name' | 'workout_type'> | null;
  scheduledDate: ISODate | null; sessionDate: ISODate; status: SessionStatus; name: string; dedupeKey: string | null; repeatedFrom?: string | null;
  rows: PlannedInput[];
}

async function createSession(o: CreateOpts): Promise<WorkoutSession> {
  const t = nowIso();
  const session = clean(await insert('workout_sessions', {
    program_id: o.program?.id ?? null, program_version_id: o.versionId, template_id: o.template?.id ?? null, template_key: o.template?.template_key ?? null, dedupe_key: o.dedupeKey,
    name: o.name, workout_type: o.template?.workout_type ?? 'strength', scheduled_date: o.scheduledDate, session_date: o.sessionDate, status: o.status,
    started_at: o.status === 'in_progress' ? t : null, finished_at: null, paused_at: null, paused_total_s: 0, rescheduled_to: null, skip_reason: null, session_rpe: null,
    energy: null, motivation: null, readiness: null, notes: null, change_reason: null, tags: [], is_bookmarked: false, location: null, equipment_profile_id: null,
    repeated_from: o.repeatedFrom ?? null, corrected_after_completion: false,
  })) as WorkoutSession;
  let pos = 0;
  for (const row of o.rows) await createExerciseRows(session.id, o.sessionDate, pos++, row, { excludeSession: session.id });
  return session;
}

const plannedInputOf = (p: PlannedExercise): PlannedInput => {
  const { id, user_id: _u, created_at: _c, client_updated_at: _cu, server_updated_at: _s, deleted_at: _d, device_id: _dv, program_version_id: _pv, template_id: _t, ...fields } = p as PlannedExercise & { server_updated_at?: unknown };
  void _u; void _c; void _cu; void _s; void _d; void _dv; void _pv; void _t;
  return { ...(fields as PlannedFields & { plan_key: string }), planned_exercise_id: id };
};

/**
 * Starts the workout scheduled for `date` (or any template on any date — a rest day can become a training day).
 * Idempotent: the scheduled (template, date) pair maps to ONE session, so double-taps and retries never duplicate it.
 */
export async function startScheduled(programId: string, templateKey: string, scheduledDate: ISODate, today: ISODate = todayISO()): Promise<WorkoutSession> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const key = schedKey(templateKey, scheduledDate);
    const existing = await sessionByDedupe(key);
    if (existing) {
      if (existing.status === 'in_progress' || FINISHED.has(existing.status)) return existing;
      if (existing.status === 'planned') return startPlannedSession(existing.id, today);
      if (['skipped', 'rescheduled', 'cancelled'].includes(existing.status)) { await restoreSessionToPlanned(existing.id); return startPlannedSession(existing.id, today); }
    }
    const bundles = await activePrograms();
    const bundle = bundles.find((b) => b.program.id === programId);
    if (!bundle) throw new Error('Program not found or not active');
    const versions = bundle.versions.filter((v) => v.effective_from <= scheduledDate).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version_no - a.version_no);
    const preferred = versions[0] ?? bundle.versions[0]!;
    const template = bundle.templates.find((t) => t.template_key === templateKey && t.program_version_id === preferred.id) ?? bundle.templates.find((t) => t.template_key === templateKey);
    if (!template) throw new Error('Workout day not found');
    const rows = bundle.planned.filter((p) => p.template_id === template.id).sort((a, b) => a.position - b.position).map(plannedInputOf);
    return createSession({ program: bundle.program, versionId: template.program_version_id, template, scheduledDate, sessionDate: today, status: 'in_progress', name: template.name, dedupeKey: key, rows });
  });
}

export async function startPlannedSession(sessionId: string, today: ISODate = todayISO()): Promise<WorkoutSession> {
  const s = await getSession(sessionId);
  if (!s) throw new Error('Session not found');
  if (s.status === 'in_progress') return s;
  assertTransition(s.status, 'in_progress');
  const t = nowIso();
  await update('workout_sessions', sessionId, { status: 'in_progress', started_at: t, session_date: today });
  if (today !== s.session_date) await retargetSetDates(sessionId, today);
  return (await getSession(sessionId)) as WorkoutSession;
}

async function retargetSetDates(sessionId: string, date: ISODate): Promise<void> {
  for (const st of await tbl('set_records').where('session_id').equals(sessionId).toArray()) await update('set_records', st.id, { session_date: date });
}

/** Unplanned session ("add an unplanned session"). The program is untouched. */
export async function startAdhoc(name: string, today: ISODate = todayISO()): Promise<WorkoutSession> {
  return db.transaction('rw', SESSION_TABLES(), () => createSession({ program: null, versionId: null, template: null, scheduledDate: null, sessionDate: today, status: 'in_progress', name: name.trim() || 'Workout', dedupeKey: null, rows: [] }));
}

export interface ActivityInput { exerciseId: string; date: ISODate; durationMin: number; distanceKm?: number | null; rpe?: number | null; notes?: string | null }
const ACTIVITY_TYPE: Partial<Record<ExerciseCategory, WorkoutType>> = { cardio: 'cardio', conditioning: 'cardio', sport: 'sport', mobility: 'mobility', stretching: 'mobility' };

/**
 * "Add activity": a finished, single-exercise session for cardio / sport / mobility (MMA, a run, a stretch routine) logged in one step.
 * It is its own session — the strength program is untouched — and it carries duration/distance only, so it adds no phantom strength volume.
 */
export async function logActivity(input: ActivityInput, today: ISODate = todayISO()): Promise<WorkoutSession> {
  if (!(input.durationMin >= 1) || input.durationMin > 1440) throw new Error('Enter a duration between 1 minute and 24 hours.');
  if (input.distanceKm != null && (input.distanceKm < 0 || input.distanceKm > 1000)) throw new Error('Distance must be between 0 and 1,000 km.');
  if (input.date > today) throw new Error('An activity cannot be dated in the future.');
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const ex = await tbl('exercises').get(input.exerciseId);
    if (!ex || ex.deleted_at) throw new Error('Activity not found.');
    const created = await startAdhoc(ex.name, input.date);
    const se = await addExerciseToSession(created.id, ex.id, 1);
    const set = (await tbl('set_records').where('session_exercise_id').equals(se.id).toArray()).find((r) => !r.deleted_at);
    if (!set) throw new Error('Could not create the activity entry.');
    await logSet(set.id, { duration_s: Math.round(input.durationMin * 60), distance_m: input.distanceKm == null ? null : Math.round(input.distanceKm * 1000), rpe: input.rpe ?? null });
    const done = await finishSession(created.id, { session_rpe: input.rpe ?? null, notes: input.notes?.trim() || null });
    const end = input.date === today ? Date.parse(done.finished_at ?? nowIso()) : Date.parse(`${input.date}T12:00:00`) + input.durationMin * 60_000;
    await update('workout_sessions', created.id, { workout_type: ACTIVITY_TYPE[ex.category] ?? 'mixed', finished_at: new Date(end).toISOString(), started_at: new Date(end - input.durationMin * 60_000).toISOString() });
    return (await getSession(created.id)) as WorkoutSession;
  });
}

/** Copy a past workout into today. Loads/reps from the source become the new targets; nothing is pre-logged. */
export async function repeatSession(sourceId: string, today: ISODate = todayISO()): Promise<WorkoutSession> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const src = await getSession(sourceId);
    if (!src) throw new Error('Session not found');
    const views = await sessionExercises(sourceId);
    const session = clean(await insert('workout_sessions', {
      program_id: src.program_id, program_version_id: src.program_version_id, template_id: src.template_id, template_key: src.template_key, dedupe_key: null, name: `${src.name}`,
      workout_type: src.workout_type, scheduled_date: null, session_date: today, status: 'in_progress', started_at: nowIso(), finished_at: null, paused_at: null, paused_total_s: 0,
      rescheduled_to: null, skip_reason: null, session_rpe: null, energy: null, motivation: null, readiness: null, notes: null, change_reason: null, tags: [], is_bookmarked: false,
      location: null, equipment_profile_id: null, repeated_from: sourceId, corrected_after_completion: false,
    })) as WorkoutSession;
    let pos = 0;
    for (const v of views) {
      if (v.se.status === 'skipped') continue;
      const parents = v.sets.filter((s) => !s.parent_set_id && s.set_type !== 'warmup');
      const se = clean(await insert('session_exercises', {
        session_id: session.id, position: pos++, exercise_id: v.se.exercise_id, planned_exercise_id: null, plan_key: null, planned: null, origin: 'added', substituted_from_exercise_id: null,
        substitution_scope: null, status: 'pending', skip_reason: null, superset_group: v.se.superset_group, label: v.se.label, notes: null,
      })) as SessionExercise;
      let n = 1;
      for (const p of parents) {
        await insert('set_records', {
          session_id: session.id, session_exercise_id: se.id, exercise_id: v.se.exercise_id, session_date: today, set_number: n++, set_type: 'working', parent_set_id: null, status: 'planned', side: p.side,
          planned_weight_kg: p.weight_kg, planned_reps_min: p.reps, planned_reps_max: p.reps, planned_rir: null, planned_duration_s: p.duration_s,
          weight_kg: null, reps: null, reps_partial: null, reps_assisted: null, duration_s: null, distance_m: null, assist_kg: null, bodyweight_kg: null, rpe: null, rir: null, failure: null,
          tempo: p.tempo, eccentric_s: null, pause_bottom_s: null, concentric_s: null, pause_top_s: null, rom: null, quality: null, rest_before_s: null, started_at: null,
          completed_at: null, load_estimated: false, bar_velocity: null, discomfort: null, note: null, extras: {},
        });
      }
    }
    await audit('session', session.id, 'repeat', null, { from: sourceId });
    return session;
  });
}

/** "This workout day for this week" / a future-dated substitution: a persisted PLANNED session carrying the edited prescription. */
export async function materializePlannedSession(templateKey: string, date: ISODate, tree: PlanTree, programId: string, versionId: string): Promise<string> {
  const key = schedKey(templateKey, date);
  const existing = await sessionByDedupe(key);
  if (existing && existing.status !== 'planned') throw new Error('That workout already has a session; edit it directly instead.');
  const programRow = await tbl('programs').get(programId);
  const program = programRow ? (clean(programRow) as Program) : undefined;
  const template = (await tbl('workout_templates').where('program_version_id').equals(versionId).toArray()).find((t) => t.template_key === templateKey && !t.deleted_at);
  if (!program || !template) throw new Error('Workout day not found');
  const rows: PlannedInput[] = tree.planned.filter((p) => p.template_key === templateKey).sort((a, b) => a.position - b.position).map((p) => {
    const { template_key: _k, ...fields } = p;
    void _k;
    return { ...fields, planned_exercise_id: null };
  });
  if (existing) {
    // replace the previously materialised plan: drop its (untouched) exercises and sets, rebuild
    for (const v of await sessionExercises(existing.id)) { for (const st of v.sets) await update('set_records', st.id, { deleted_at: nowIso() }); await update('session_exercises', v.se.id, { deleted_at: nowIso() }); }
    let pos = 0;
    for (const row of rows) await createExerciseRows(existing.id, existing.session_date, pos++, row, { excludeSession: existing.id });
    return existing.id;
  }
  const s = await createSession({ program, versionId, template, scheduledDate: date, sessionDate: date, status: 'planned', name: template.name, dedupeKey: key, rows });
  return s.id;
}

/** Commits a previewed program edit (see domain/editScope). Materialises one-week overrides as planned sessions. */
export const commitProgramEdit = (input: CommitInput): Promise<CommitResult> => commitEdit(input, (k, d, t, p, v) => materializePlannedSession(k, d, t, p, v));

// ── Skip / reschedule / restore ─────────────────────────────────────────────
export async function skipScheduled(programId: string, templateKey: string, date: ISODate, reason: string | null): Promise<WorkoutSession> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    let s = await sessionByDedupe(schedKey(templateKey, date));
    if (!s) {
      const bundle = (await activePrograms()).find((b) => b.program.id === programId);
      const tpl = bundle?.templates.find((t) => t.template_key === templateKey && bundle.versions.some((v) => v.id === t.program_version_id && v.effective_from <= date));
      if (!bundle || !tpl) throw new Error('Workout day not found');
      s = await createSession({ program: bundle.program, versionId: tpl.program_version_id, template: tpl, scheduledDate: date, sessionDate: date, status: 'planned', name: tpl.name, dedupeKey: schedKey(templateKey, date), rows: [] });
    }
    assertTransition(s.status, 'skipped');
    if (s.status === 'in_progress') {
      const logged = (await tbl('set_records').where('session_id').equals(s.id).toArray()).some((r) => !r.deleted_at && r.status === 'completed');
      if (logged) throw new Error('This workout already has logged sets — finish it instead of skipping.');
    }
    await update('workout_sessions', s.id, { status: 'skipped', skip_reason: reason });
    await audit('session', s.id, 'skip', { status: s.status }, { status: 'skipped' }, reason);
    return (await getSession(s.id)) as WorkoutSession;
  });
}

export async function rescheduleScheduled(programId: string, templateKey: string, from: ISODate, to: ISODate, reason: string | null): Promise<{ original: WorkoutSession; replacement: WorkoutSession }> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    if (to === from) throw new Error('Pick a different day.');
    const bundle = (await activePrograms()).find((b) => b.program.id === programId);
    if (!bundle) throw new Error('Program not found');
    let s = await sessionByDedupe(schedKey(templateKey, from));
    const tpl = bundle.templates.find((t) => t.template_key === templateKey && bundle.versions.some((v) => v.id === t.program_version_id && v.effective_from <= from)) ?? bundle.templates.find((t) => t.template_key === templateKey);
    if (!tpl) throw new Error('Workout day not found');
    const rows = bundle.planned.filter((p) => p.template_id === tpl.id).sort((a, b) => a.position - b.position).map(plannedInputOf);
    if (!s) s = await createSession({ program: bundle.program, versionId: tpl.program_version_id, template: tpl, scheduledDate: from, sessionDate: from, status: 'planned', name: tpl.name, dedupeKey: schedKey(templateKey, from), rows: [] });
    assertTransition(s.status, 'rescheduled');
    await update('workout_sessions', s.id, { status: 'rescheduled', rescheduled_to: to, skip_reason: reason });
    let repl = await sessionByDedupe(schedKey(templateKey, to));
    if (!repl) repl = await createSession({ program: bundle.program, versionId: tpl.program_version_id, template: tpl, scheduledDate: to, sessionDate: to, status: 'planned', name: tpl.name, dedupeKey: schedKey(templateKey, to), rows });
    await audit('session', s.id, 'reschedule', { date: from }, { date: to }, reason);
    return { original: (await getSession(s.id)) as WorkoutSession, replacement: repl };
  });
}

export async function restoreSessionToPlanned(sessionId: string): Promise<void> {
  const s = await getSession(sessionId);
  if (!s) throw new Error('Session not found');
  assertTransition(s.status, 'planned');
  await update('workout_sessions', sessionId, { status: 'planned', skip_reason: null, rescheduled_to: null });
  await audit('session', sessionId, 'restore', { status: s.status }, { status: 'planned' });
}

// ── Running a session ───────────────────────────────────────────────────────
export async function pauseSession(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s || s.status !== 'in_progress' || s.paused_at) return;
  await update('workout_sessions', id, { paused_at: nowIso() });
}
export async function resumeSession(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s || !s.paused_at) return;
  const add = Math.max(0, Math.round((Date.parse(nowIso()) - Date.parse(s.paused_at)) / 1000));
  await update('workout_sessions', id, { paused_at: null, paused_total_s: s.paused_total_s + add });
}

export async function updateSession(id: string, patch: Partial<Pick<WorkoutSession, 'name' | 'notes' | 'tags' | 'session_rpe' | 'energy' | 'motivation' | 'readiness' | 'location' | 'is_bookmarked' | 'change_reason' | 'equipment_profile_id' | 'workout_type'>>): Promise<void> {
  await update('workout_sessions', id, patch);
}

async function recomputeExerciseStatus(seId: string): Promise<void> {
  const se = await tbl('session_exercises').get(seId);
  if (!se || se.deleted_at || se.status === 'skipped') return;
  const sets = (await tbl('set_records').where('session_exercise_id').equals(seId).toArray()).filter((s) => !s.deleted_at && !s.parent_set_id && s.set_type !== 'warmup');
  const done = sets.filter((s) => s.status === 'completed').length;
  const open = sets.filter((s) => s.status === 'planned').length;
  const next = done > 0 && open === 0 ? 'completed' : done > 0 ? 'in_progress' : 'pending';
  if (next !== se.status) await update('session_exercises', seId, { status: next });
}

export type SetInput = Partial<Pick<SetRecord, 'weight_kg' | 'reps' | 'reps_partial' | 'reps_assisted' | 'duration_s' | 'distance_m' | 'assist_kg' | 'rpe' | 'rir' | 'failure' | 'tempo' | 'eccentric_s' | 'pause_bottom_s' | 'concentric_s' | 'pause_top_s' | 'rom' | 'quality' | 'discomfort' | 'note' | 'side' | 'set_type' | 'load_estimated' | 'extras' | 'status'>>;

async function isFinishedSession(sessionId: string): Promise<boolean> {
  const s = await getSession(sessionId);
  return !!s && FINISHED.has(s.status);
}

async function markCorrection(sessionId: string, entity: string, id: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason?: string | null): Promise<void> {
  await audit(entity, id, action, before, after, reason ?? null);
  await update('workout_sessions', sessionId, { corrected_after_completion: true });
  await recomputeFinishedStatus(sessionId);
}

/** Complete a set: stores ACTUAL values next to the (untouched) planned ones. */
export async function logSet(setId: string, input: SetInput): Promise<SetRecord> {
  const issues = validateSetInput(input);
  if (issues.length) throw new Error(issues[0]!.message);
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const cur = await tbl('set_records').get(setId);
    if (!cur) throw new Error('Set not found');
    const t = nowIso();
    const ex = (await tbl('exercises').get(cur.exercise_id)) as Exercise | undefined;
    const bw = ex && (ex.tracking_method === 'bodyweight_reps' || ex.tracking_method === 'assisted_reps') ? await bodyweightKgOn(cur.session_date) : null;
    const prevDone = (await tbl('set_records').where('session_id').equals(cur.session_id).toArray()).filter((s) => s.id !== setId && !s.deleted_at && s.status === 'completed' && s.completed_at).sort((a, b) => ((a.completed_at ?? '') < (b.completed_at ?? '') ? 1 : -1))[0];
    const rest = prevDone?.completed_at ? Math.round((Date.parse(t) - Date.parse(prevDone.completed_at)) / 1000) : null;
    const before = cur;
    const next = await update('set_records', setId, { ...input, status: input.status ?? 'completed', completed_at: t, started_at: cur.started_at ?? t, bodyweight_kg: cur.bodyweight_kg ?? bw, rest_before_s: rest !== null && rest >= 0 && rest <= 7200 ? rest : null });
    await recomputeExerciseStatus(cur.session_exercise_id);
    if (await isFinishedSession(cur.session_id)) {
      const d = diffFields(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
      await markCorrection(cur.session_id, 'set', setId, 'log', d.before, d.after);
    }
    return clean(next) as SetRecord;
  });
}

/** Edit any field of a set — including after the session was finished (recorded as an audited correction). */
export async function editSet(setId: string, patch: SetInput, reason?: string): Promise<SetRecord> {
  const issues = validateSetInput(patch);
  if (issues.length) throw new Error(issues[0]!.message);
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const cur = await tbl('set_records').get(setId);
    if (!cur) throw new Error('Set not found');
    const next = await update('set_records', setId, patch);
    await recomputeExerciseStatus(cur.session_exercise_id);
    if (await isFinishedSession(cur.session_id)) {
      const d = diffFields(cur as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
      if (Object.keys(d.after).length) await markCorrection(cur.session_id, 'set', setId, 'correct', d.before, d.after, reason);
    }
    return clean(next) as SetRecord;
  });
}

/** Un-complete a set (accidental tap). Values stay as a draft; the planned values are never touched. */
export async function uncompleteSet(setId: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const cur = await tbl('set_records').get(setId);
    if (!cur) return;
    await update('set_records', setId, { status: 'planned', completed_at: null });
    await recomputeExerciseStatus(cur.session_exercise_id);
    if (await isFinishedSession(cur.session_id)) await markCorrection(cur.session_id, 'set', setId, 'uncomplete', { status: cur.status }, { status: 'planned' });
  });
}

export async function addSet(seId: string, type: SetType = 'working', template?: Partial<SetRecord>): Promise<SetRecord> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const se = await tbl('session_exercises').get(seId);
    if (!se) throw new Error('Exercise not found');
    const sets = (await tbl('set_records').where('session_exercise_id').equals(seId).toArray()).filter((s) => !s.deleted_at && !s.parent_set_id && (type === 'warmup') === (s.set_type === 'warmup'));
    const last = [...sets].sort((a, b) => a.set_number - b.set_number).at(-1);
    const session = (await getSession(se.session_id)) as WorkoutSession;
    const row = await insert('set_records', {
      session_id: se.session_id, session_exercise_id: seId, exercise_id: se.exercise_id, session_date: session.session_date, set_number: (last?.set_number ?? 0) + 1, set_type: type, parent_set_id: null,
      status: 'planned', side: 'both', planned_weight_kg: last?.weight_kg ?? last?.planned_weight_kg ?? null, planned_reps_min: last?.planned_reps_min ?? null, planned_reps_max: last?.planned_reps_max ?? null,
      planned_rir: null, planned_duration_s: last?.planned_duration_s ?? null, weight_kg: null, reps: null, reps_partial: null, reps_assisted: null, duration_s: null, distance_m: null, assist_kg: null,
      bodyweight_kg: null, rpe: null, rir: null, failure: null, tempo: last?.tempo ?? null, eccentric_s: null, pause_bottom_s: null, concentric_s: null, pause_top_s: null, rom: null, quality: null,
      rest_before_s: null, started_at: null, completed_at: null, load_estimated: false, bar_velocity: null, discomfort: null, note: null, extras: {}, ...template,
    });
    await recomputeExerciseStatus(seId);
    if (FINISHED.has(session.status)) await markCorrection(session.id, 'set', row.id, 'add', null, { set_number: row.set_number });
    return clean(row) as SetRecord;
  });
}

/** Adds a warm-up ramp (separate numbering, never counted as working volume). */
export async function addWarmupSets(seId: string, steps: { weight_kg: number; reps: number }[]): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    for (const st of steps) await addSet(seId, 'warmup', { planned_weight_kg: st.weight_kg, planned_reps_min: st.reps, planned_reps_max: st.reps, planned_rir: null });
  });
}

export async function duplicateSet(setId: string): Promise<SetRecord> {
  const cur = await tbl('set_records').get(setId);
  if (!cur) throw new Error('Set not found');
  return addSet(cur.session_exercise_id, cur.set_type, { planned_weight_kg: cur.weight_kg ?? cur.planned_weight_kg, planned_reps_min: cur.reps ?? cur.planned_reps_min, planned_reps_max: cur.reps ?? cur.planned_reps_max });
}

/** Soft delete (undo with restoreSet). History is never physically removed. */
export async function deleteSet(setId: string, reason?: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const cur = await tbl('set_records').get(setId);
    if (!cur || cur.deleted_at) return;
    await update('set_records', setId, { deleted_at: nowIso() });
    for (const c of (await tbl('set_records').where('parent_set_id').equals(setId).toArray()).filter((x) => !x.deleted_at)) await update('set_records', c.id, { deleted_at: nowIso() });
    await recomputeExerciseStatus(cur.session_exercise_id);
    if (await isFinishedSession(cur.session_id)) await markCorrection(cur.session_id, 'set', setId, 'delete', { weight_kg: cur.weight_kg, reps: cur.reps }, null, reason);
  });
}

export async function restoreSet(setId: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const cur = await tbl('set_records').get(setId);
    if (!cur) return;
    await update('set_records', setId, { deleted_at: null });
    for (const c of (await tbl('set_records').where('parent_set_id').equals(setId).toArray())) if (c.deleted_at) await update('set_records', c.id, { deleted_at: null });
    await recomputeExerciseStatus(cur.session_exercise_id);
    if (await isFinishedSession(cur.session_id)) await markCorrection(cur.session_id, 'set', setId, 'restore', null, { weight_kg: cur.weight_kg, reps: cur.reps });
  });
}

/** Adds the next guided component (drop / rest-pause / myo mini-set) under a parent set. */
export async function addComponentSet(parentId: string): Promise<SetRecord | null> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const parent = await tbl('set_records').get(parentId);
    if (!parent) throw new Error('Set not found');
    const se = await tbl('session_exercises').get(parent.session_exercise_id);
    const code = se?.planned?.technique_code ?? null;
    const comps = (await tbl('set_records').where('parent_set_id').equals(parentId).toArray()).filter((c) => !c.deleted_at);
    const sug = nextComponent(code, parent, comps.length);
    if (!sug) return null;
    const row = await insert('set_records', {
      session_id: parent.session_id, session_exercise_id: parent.session_exercise_id, exercise_id: parent.exercise_id, session_date: parent.session_date, set_number: parent.set_number, set_type: sug.set_type,
      parent_set_id: parentId, status: 'planned', side: parent.side, planned_weight_kg: sug.weight_kg, planned_reps_min: sug.planned_reps_min, planned_reps_max: sug.planned_reps_max, planned_rir: 0,
      planned_duration_s: null, weight_kg: null, reps: null, reps_partial: null, reps_assisted: null, duration_s: null, distance_m: null, assist_kg: null, bodyweight_kg: null, rpe: null, rir: null,
      failure: null, tempo: null, eccentric_s: null, pause_bottom_s: null, concentric_s: null, pause_top_s: null, rom: null, quality: null, rest_before_s: null, started_at: null, completed_at: null,
      load_estimated: false, bar_velocity: null, discomfort: null, note: sug.label, extras: { rest_s: sug.rest_s }, ...{},
    });
    return clean(row) as SetRecord;
  });
}

// ── Exercise-level edits inside a session ───────────────────────────────────
export async function addExerciseToSession(sessionId: string, exerciseId: string, sets = 3): Promise<SessionExercise> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const s = (await getSession(sessionId)) as WorkoutSession;
    const pos = (await tbl('session_exercises').where('session_id').equals(sessionId).toArray()).filter((e) => !e.deleted_at).length;
    const blank: PlannedInput = {
      position: pos, label: null, superset_group: null, exercise_id: exerciseId, muscle_label: null, sets, reps_min: null, reps_max: null, rir_target: null, rir_last_only: false, rpe_target: null, rest_min_s: null,
      rest_max_s: null, rest_mode: 'after_set', tempo: null, technique_code: null, technique_text: null, start_load_kg: null, load_note: null, duration_target_s: null, distance_target_m: null, cue: null,
      notes: null, is_optional: false, plan_key: null, planned_exercise_id: null,
    };
    const se = await createExerciseRows(sessionId, s.session_date, pos, blank, { origin: 'added', excludeSession: sessionId });
    if (FINISHED.has(s.status)) await markCorrection(sessionId, 'session_exercise', se.id, 'add_exercise', null, { exercise_id: exerciseId });
    return se;
  });
}

/**
 * Substitute what was actually performed. The original prescription stays frozen in `planned`; the new exercise is tracked
 * separately (no strength-equivalence is assumed). Allowed until a set of the original exercise has been completed.
 * scope 'future' is recorded here only as intent — the caller then commits a previewed program edit.
 */
export async function substituteExercise(seId: string, newExerciseId: string, scope: 'session' | 'future', reason?: string): Promise<SessionExercise> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const se = await tbl('session_exercises').get(seId);
    if (!se) throw new Error('Exercise not found');
    const sets = (await tbl('set_records').where('session_exercise_id').equals(seId).toArray()).filter((s) => !s.deleted_at);
    if (sets.some((s) => s.status === 'completed')) throw new Error('Sets are already logged for this exercise. Add the other exercise as a new one instead.');
    const original = se.substituted_from_exercise_id ?? se.planned?.snapshot_exercise_id ?? se.exercise_id;
    const session = (await getSession(se.session_id)) as WorkoutSession;
    const prev = await lastPerformance(newExerciseId, session.session_date, se.session_id);
    const parents = sets.filter((s) => !s.parent_set_id).sort((a, b) => a.set_number - b.set_number);
    for (const c of sets.filter((s) => s.parent_set_id)) await update('set_records', c.id, { deleted_at: nowIso() });
    for (const [i, s] of parents.entries()) {
      const w = prev?.sets.length ? prev.sets[Math.min(i, prev.sets.length - 1)]!.weight_kg : null;
      await update('set_records', s.id, { exercise_id: newExerciseId, planned_weight_kg: w });
    }
    const next = await update('session_exercises', seId, { exercise_id: newExerciseId, origin: newExerciseId === original ? (se.plan_key ? 'planned' : 'added') : 'substituted', substituted_from_exercise_id: newExerciseId === original ? null : original, substitution_scope: scope, skip_reason: null });
    await audit('session_exercise', seId, 'substitute', { exercise_id: se.exercise_id }, { exercise_id: newExerciseId, scope }, reason ?? null);
    return clean(next) as SessionExercise;
  });
}

export async function skipExercise(seId: string, reason: string | null): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const se = await tbl('session_exercises').get(seId);
    if (!se) return;
    await update('session_exercises', seId, { status: 'skipped', skip_reason: reason });
    for (const s of (await tbl('set_records').where('session_exercise_id').equals(seId).toArray()).filter((x) => !x.deleted_at && x.status === 'planned')) await update('set_records', s.id, { status: 'skipped' });
    if (await isFinishedSession(se.session_id)) await markCorrection(se.session_id, 'session_exercise', seId, 'skip_exercise', null, { skipped: true }, reason);
  });
}

export async function unskipExercise(seId: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const se = await tbl('session_exercises').get(seId);
    if (!se) return;
    await update('session_exercises', seId, { status: 'pending', skip_reason: null });
    for (const s of (await tbl('set_records').where('session_exercise_id').equals(seId).toArray()).filter((x) => !x.deleted_at && x.status === 'skipped')) await update('set_records', s.id, { status: 'planned' });
    await recomputeExerciseStatus(seId);
  });
}

/** Only exercises with nothing logged can be removed (they are soft-deleted, so undo is possible). */
export async function removeExercise(seId: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const sets = (await tbl('set_records').where('session_exercise_id').equals(seId).toArray()).filter((s) => !s.deleted_at);
    if (sets.some((s) => s.status === 'completed')) throw new Error('This exercise has logged sets — skip it instead so the history is kept.');
    for (const s of sets) await update('set_records', s.id, { deleted_at: nowIso() });
    await update('session_exercises', seId, { deleted_at: nowIso() });
  });
}
export async function restoreExercise(seId: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    for (const s of await tbl('set_records').where('session_exercise_id').equals(seId).toArray()) if (s.deleted_at) await update('set_records', s.id, { deleted_at: null });
    await update('session_exercises', seId, { deleted_at: null });
  });
}

export async function reorderExercises(sessionId: string, orderedSeIds: string[]): Promise<void> {
  await db.transaction('rw', tbl('session_exercises'), async () => {
    for (const [i, id] of orderedSeIds.entries()) await update('session_exercises', id, { position: i });
  });
  void sessionId;
}

export async function updateExerciseNotes(seId: string, notes: string | null): Promise<void> { await update('session_exercises', seId, { notes }); }

// ── Finishing / reopening ───────────────────────────────────────────────────
async function slotsOf(sessionId: string): Promise<SlotInput[]> {
  const views = await sessionExercises(sessionId);
  return views.map((v) => ({
    plannedSets: v.se.planned?.sets ?? 0,
    completedWorkingSets: v.sets.filter((s) => s.status === 'completed' && !s.parent_set_id && s.set_type !== 'warmup').length,
    skipped: v.se.status === 'skipped',
    origin: v.se.origin,
  }));
}

export async function sessionCompletion(sessionId: string): Promise<ReturnType<typeof classifyCompletion> & { completedSets: number }> {
  const slots = await slotsOf(sessionId);
  return { ...classifyCompletion(slots), completedSets: slots.reduce((a, s) => a + s.completedWorkingSets, 0) };
}

export class NothingLoggedError extends Error { constructor() { super('No sets were completed in this workout.'); this.name = 'NothingLoggedError'; } }

export interface FinishInput { session_rpe?: number | null; notes?: string | null; tags?: string[]; energy?: number | null; motivation?: number | null; readiness?: number | null }

export async function finishSession(id: string, input: FinishInput = {}): Promise<WorkoutSession> {
  return db.transaction('rw', SESSION_TABLES(), async () => {
    const s = await getSession(id);
    if (!s) throw new Error('Session not found');
    if (s.status !== 'in_progress') throw new Error(`Cannot finish a session that is ${s.status}.`);
    const c = await sessionCompletion(id);
    if (c.completedSets === 0) throw new NothingLoggedError();
    const t = nowIso();
    let pausedTotal = s.paused_total_s;
    if (s.paused_at) pausedTotal += Math.max(0, Math.round((Date.parse(t) - Date.parse(s.paused_at)) / 1000));
    // Untouched planned sets are kept as 'skipped' records (planned vs actual stays visible); exercises with nothing done are 'skipped'.
    for (const v of await sessionExercises(id)) {
      const done = v.sets.some((x) => x.status === 'completed');
      for (const st of v.sets.filter((x) => x.status === 'planned')) await update('set_records', st.id, { status: 'skipped' });
      if (!done && v.se.status !== 'skipped') await update('session_exercises', v.se.id, { status: 'skipped' });
      else if (done && v.se.status !== 'completed') await update('session_exercises', v.se.id, { status: 'completed' });
    }
    assertTransition(s.status, c.status);
    await update('workout_sessions', id, { ...input, status: c.status, finished_at: t, paused_at: null, paused_total_s: pausedTotal, change_reason: c.modifications.length ? c.modifications.join(', ') : null });
    return (await getSession(id)) as WorkoutSession;
  });
}

/** Re-derives completed / modified / partial after a correction. Never touches a session that is not finished. */
export async function recomputeFinishedStatus(sessionId: string): Promise<void> {
  const s = await getSession(sessionId);
  if (!s || !FINISHED.has(s.status)) return;
  const c = await sessionCompletion(sessionId);
  if (c.status !== s.status) {
    await update('workout_sessions', sessionId, { status: c.status, change_reason: c.modifications.join(', ') || null });
    await audit('session', sessionId, 'status_recomputed', { status: s.status }, { status: c.status });
  }
}

/** Reopen a finished session to correct it. Recorded in the audit trail; re-finish to re-classify. */
export async function reopenSession(id: string, reason?: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const s = await getSession(id);
    if (!s) throw new Error('Session not found');
    assertTransition(s.status, 'in_progress');
    await update('workout_sessions', id, { status: 'in_progress', finished_at: null, corrected_after_completion: true });
    await audit('session', id, 'reopen', { status: s.status }, { status: 'in_progress' }, reason ?? null);
  });
}

export async function discardSession(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s) return;
  assertTransition(s.status, 'cancelled');
  await db.transaction('rw', SESSION_TABLES(), async () => {
    await update('workout_sessions', id, { status: 'cancelled' });
    await audit('session', id, 'cancel', { status: s.status }, { status: 'cancelled' });
  });
}

/** Historical correction of the day a session happened on. Derived analytics follow; the program is not rewritten. */
export async function changeSessionDate(id: string, date: ISODate, reason?: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const s = await getSession(id);
    if (!s) throw new Error('Session not found');
    await update('workout_sessions', id, { session_date: date, corrected_after_completion: FINISHED.has(s.status) ? true : s.corrected_after_completion });
    await retargetSetDates(id, date);
    await audit('session', id, 'change_date', { session_date: s.session_date }, { session_date: date }, reason ?? null);
  });
}

export const isLikelySameDay = (a: ISODate, b: ISODate): boolean => a === b;

/** "Remove" a workout from history without destroying it: soft-deleted with all its records, restorable, audited. */
export async function archiveSession(id: string, reason?: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const s = await tbl('workout_sessions').get(id);
    if (!s || s.deleted_at) return;
    const t = nowIso();
    for (const v of await tbl('set_records').where('session_id').equals(id).toArray()) if (!v.deleted_at) await update('set_records', v.id, { deleted_at: t });
    for (const v of await tbl('session_exercises').where('session_id').equals(id).toArray()) if (!v.deleted_at) await update('session_exercises', v.id, { deleted_at: t });
    await update('workout_sessions', id, { deleted_at: t, dedupe_key: null });
    await audit('session', id, 'archive', { status: s.status }, { deleted_at: t }, reason ?? null);
  });
}

export async function restoreArchivedSession(id: string): Promise<void> {
  await db.transaction('rw', SESSION_TABLES(), async () => {
    const s = await tbl('workout_sessions').get(id);
    if (!s || !s.deleted_at) return;
    const at = s.deleted_at;
    for (const v of await tbl('set_records').where('session_id').equals(id).toArray()) if (v.deleted_at === at) await update('set_records', v.id, { deleted_at: null });
    for (const v of await tbl('session_exercises').where('session_id').equals(id).toArray()) if (v.deleted_at === at) await update('session_exercises', v.id, { deleted_at: null });
    await update('workout_sessions', id, { deleted_at: null, dedupe_key: s.template_key && s.scheduled_date ? schedKey(s.template_key, s.scheduled_date) : null });
    await audit('session', id, 'restore_archived', null, { restored: true });
  });
}
