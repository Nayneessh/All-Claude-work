import type { Exercise, SetRecord, WorkoutSession } from '@/domain/types';
import type { AnalyticsCtx, AnalyticsSet, ExerciseLite, SessionLite } from '@/domain/analytics';
import { DEFAULT_OPTS } from '@/domain/analytics';

let n = 0;
export const uid = (p = 'id'): string => `${p}-${++n}`;
export const resetIds = (): void => { n = 0; };

export const ex = (over: Partial<ExerciseLite> & { id: string }): ExerciseLite => ({
  name: over.id, tracking_method: 'weight_reps', load_mode: 'total', bodyweight_fraction: 1, primary_muscles: [], secondary_muscles: [], laterality: 'bilateral', ...over,
});

export const set = (over: Partial<AnalyticsSet> = {}): AnalyticsSet => ({
  id: uid('set'), session_id: 's1', session_exercise_id: 'se1', exercise_id: 'bench', session_date: '2026-10-26', set_number: 1, set_type: 'working',
  parent_set_id: null, status: 'completed', weight_kg: 100, reps: 5, reps_partial: null, duration_s: null, distance_m: null, assist_kg: null,
  bodyweight_kg: null, rir: null, rpe: null, failure: null, rom: null, completed_at: null, created_at: '2026-10-26T10:00:00.000Z',
  planned_weight_kg: null, planned_reps_min: null, planned_reps_max: null, ...over,
});

export const session = (over: Partial<SessionLite> & { id: string }): SessionLite => ({
  session_date: '2026-10-26', status: 'completed_as_planned', tags: [], program_id: 'p1', template_key: 'tk1', started_at: null, finished_at: null,
  paused_total_s: 0, session_rpe: null, scheduled_date: null, ...over,
});

export function ctxOf(exercises: ExerciseLite[], sessions: SessionLite[], opts: Partial<AnalyticsCtx['opts']> = {}): AnalyticsCtx {
  return { exercises: new Map(exercises.map((e) => [e.id, e])), sessions: new Map(sessions.map((s) => [s.id, s])), opts: { ...DEFAULT_OPTS, ...opts } };
}

export type { Exercise, SetRecord, WorkoutSession };
