import type { ISOTime, SessionStatus, WorkoutSession } from './types';

/**
 * Session lifecycle (blueprint §5). A skipped workout stays visible in history and is NOT a workout with
 * zero performance — analytics treat "skipped" and "cancelled" as absent, never as 0 volume.
 *
 *  planned ─┬─> in_progress ─┬─> completed_as_planned
 *           │                ├─> completed_modified
 *           │                ├─> partial
 *           │                └─> cancelled
 *           ├─> skipped
 *           ├─> rescheduled
 *           └─> cancelled
 *  completed or partial ──reopen──> in_progress  (historical correction; audited)
 *  skipped/rescheduled/cancelled ──restore──> planned
 */
export const FINISHED: ReadonlySet<SessionStatus> = new Set(['completed_as_planned', 'completed_modified', 'partial']);
export const PERFORMED: ReadonlySet<SessionStatus> = new Set(['completed_as_planned', 'completed_modified', 'partial', 'in_progress']);
export const ABSENT: ReadonlySet<SessionStatus> = new Set(['skipped', 'cancelled', 'rescheduled']);

const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  planned: ['in_progress', 'skipped', 'rescheduled', 'cancelled'],
  in_progress: ['completed_as_planned', 'completed_modified', 'partial', 'cancelled'],
  completed_as_planned: ['in_progress'],
  completed_modified: ['in_progress'],
  partial: ['in_progress'],
  skipped: ['planned'],
  rescheduled: ['planned'],
  cancelled: ['planned'],
};

export const canTransition = (from: SessionStatus, to: SessionStatus): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) throw new Error(`Invalid session transition: ${from} → ${to}`);
}

export interface SlotInput {
  plannedSets: number;
  completedWorkingSets: number;
  skipped: boolean;
  origin: 'planned' | 'added' | 'substituted';
}

export interface Classification {
  status: 'completed_as_planned' | 'completed_modified' | 'partial';
  completionPct: number | null;
  modifications: string[];
}

/**
 * Completion = Σ min(planned, done) / Σ planned over PLANNED slots (substituted slots count against the
 * slot they replaced; added exercises are extra work and never count towards — or against — completion).
 *  - < 100% planned work done → partial
 *  - 100% done but something was substituted/added/skipped → completed_modified
 *  - otherwise completed_as_planned (also used for unplanned sessions, which have no plan to deviate from)
 */
export function classifyCompletion(slots: SlotInput[]): Classification {
  const planned = slots.filter((s) => s.origin !== 'added');
  const totalPlanned = planned.reduce((a, s) => a + s.plannedSets, 0);
  const done = planned.reduce((a, s) => a + (s.skipped ? 0 : Math.min(s.plannedSets, s.completedWorkingSets)), 0);
  const modifications: string[] = [];
  const subs = slots.filter((s) => s.origin === 'substituted').length;
  const added = slots.filter((s) => s.origin === 'added').length;
  const skipped = planned.filter((s) => s.skipped).length;
  const setDiff = planned.some((s) => !s.skipped && s.completedWorkingSets !== s.plannedSets && s.completedWorkingSets >= s.plannedSets);
  if (subs) modifications.push(`${subs} substituted`);
  if (added) modifications.push(`${added} added`);
  if (skipped) modifications.push(`${skipped} skipped`);
  if (setDiff) modifications.push('extra sets');
  if (totalPlanned === 0) return { status: modifications.length && planned.length ? 'completed_modified' : 'completed_as_planned', completionPct: null, modifications };
  const pct = done / totalPlanned;
  if (pct < 1) return { status: 'partial', completionPct: pct, modifications };
  return { status: modifications.length ? 'completed_modified' : 'completed_as_planned', completionPct: 1, modifications };
}

type TimedSession = Pick<WorkoutSession, 'started_at' | 'finished_at' | 'paused_at' | 'paused_total_s'>;

/** Elapsed/active/paused milliseconds. While paused, the clock for "active" time stops. */
export function sessionTimes(s: TimedSession, now: ISOTime): { totalMs: number; activeMs: number; pausedMs: number } {
  if (!s.started_at) return { totalMs: 0, activeMs: 0, pausedMs: 0 };
  const end = Date.parse(s.finished_at ?? now);
  const start = Date.parse(s.started_at);
  const total = Math.max(0, end - start);
  let paused = (s.paused_total_s ?? 0) * 1000;
  if (s.paused_at) paused += Math.max(0, end - Date.parse(s.paused_at));
  paused = Math.min(paused, total);
  return { totalMs: total, activeMs: total - paused, pausedMs: paused };
}
