import type { ISODate, PlannedSnapshot, SessionExercise, WorkoutSession } from './types';
import { addDays, weekStartOf } from './periods';
import type { Occurrence } from './versioning';

export type OccurrenceOutcome = 'done' | 'partial' | 'skipped' | 'missed' | 'rescheduled_done' | 'pending';

export interface OccurrenceResult { date: ISODate; template_key: string; outcome: OccurrenceOutcome; session_id: string | null }

type SessLite = Pick<WorkoutSession, 'id' | 'status' | 'template_key' | 'scheduled_date' | 'session_date' | 'rescheduled_to' | 'deleted_at'>;

/**
 * Attendance (blueprint §12): completed sessions ÷ planned sessions.
 *  - an occurrence matches the session created for that template + scheduled date
 *  - partial sessions attended (counted as attended, reported separately)
 *  - rescheduled: follows the replacement session; pending while the new date is still ahead
 *  - skipped / cancelled / no session in the past: planned but not done
 *  - today with nothing logged yet and future days are PENDING and never counted against the user
 */
export function matchOccurrences(occ: Occurrence<{ template_key: string }>[], sessions: SessLite[], today: ISODate): OccurrenceResult[] {
  const live = sessions.filter((s) => !s.deleted_at);
  const find = (key: string, date: ISODate): SessLite | undefined =>
    live.find((s) => s.template_key === key && (s.scheduled_date ?? s.session_date) === date);
  return occ.map((o) => {
    const key = o.template.template_key;
    const s = find(key, o.date);
    const res = (outcome: OccurrenceOutcome, id: string | null = s?.id ?? null): OccurrenceResult => ({ date: o.date, template_key: key, outcome, session_id: id });
    if (!s) return o.date >= today ? res('pending', null) : res('missed', null);
    switch (s.status) {
      case 'completed_as_planned':
      case 'completed_modified': return res('done');
      case 'partial': return res('partial');
      case 'skipped':
      case 'cancelled': return res('skipped');
      case 'rescheduled': {
        const to = s.rescheduled_to;
        if (!to) return res('missed');
        const repl = find(key, to);
        if (repl && ['completed_as_planned', 'completed_modified', 'partial'].includes(repl.status)) return res('rescheduled_done', repl.id);
        return to >= today ? res('pending') : res('missed');
      }
      default: return o.date > today ? res('pending') : o.date === today ? res('pending') : res('missed');
    }
  });
}

export interface AttendanceSummary { planned: number; attended: number; partial: number; skipped: number; missed: number; pending: number; rate: number | null }

export function attendance(results: OccurrenceResult[]): AttendanceSummary {
  const c = { done: 0, partial: 0, skipped: 0, missed: 0, rescheduled_done: 0, pending: 0 };
  for (const r of results) c[r.outcome] += 1;
  const planned = results.length - c.pending;
  const attended = c.done + c.partial + c.rescheduled_done;
  return { planned, attended, partial: c.partial, skipped: c.skipped, missed: c.missed, pending: c.pending, rate: planned > 0 ? attended / planned : null };
}

export interface SlotView {
  origin: SessionExercise['origin'];
  status: SessionExercise['status'];
  planned: PlannedSnapshot | null;
  completedWorkingSets: number;
  repsPerSet: number[];
}

/** Exercise adherence: prescribed exercises completed ÷ prescribed. Approved substitutions count as adhered. */
export function exerciseAdherence(slots: SlotView[]): { prescribed: number; adhered: number; rate: number | null } {
  const prescribed = slots.filter((s) => s.origin !== 'added');
  const adhered = prescribed.filter((s) => s.status === 'completed' && s.completedWorkingSets > 0).length;
  return { prescribed: prescribed.length, adhered, rate: prescribed.length ? adhered / prescribed.length : null };
}

/**
 * Prescription adherence: closeness of performed sets/reps to the plan.
 * per slot = setCompletion × repScore, where repScore for each set is 1 inside the rep range,
 * reps/min below it, and 1 above it (extra reps are not a deviation worth penalising).
 */
export function prescriptionAdherence(slots: SlotView[]): number | null {
  const scores: number[] = [];
  for (const s of slots) {
    if (s.origin === 'added' || !s.planned || s.status === 'skipped') continue;
    const plannedSets = s.planned.sets;
    if (plannedSets <= 0) continue;
    const setCompletion = Math.min(1, s.completedWorkingSets / plannedSets);
    const min = s.planned.reps_min;
    const repScores = s.repsPerSet.map((r) => (min && r < min ? r / min : 1));
    const repScore = repScores.length ? repScores.reduce((a, b) => a + b, 0) / repScores.length : 0;
    scores.push(setCompletion * repScore);
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

export function trainingFrequency(sessionDates: ISODate[], from: ISODate, to: ISODate, weekStart = 1): { perWeek: number; weeks: number } {
  const weeks = Math.max(1, Math.round(((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1) / 7));
  const inRange = new Set(sessionDates.filter((d) => d >= from && d <= to));
  void weekStart;
  return { perWeek: inRange.size / weeks, weeks };
}

export interface Streaks { currentWeeks: number; longestWeeks: number }

/**
 * Consistency streak rule: a week QUALIFIES when attended ≥ 80% of that week's planned sessions (at least 1 planned).
 * The current (unfinished) week extends the streak only if it already qualifies; it never breaks it.
 */
export function weeklyStreaks(results: OccurrenceResult[], today: ISODate, weekStart = 1, threshold = 0.8): Streaks {
  const by = new Map<ISODate, { planned: number; attended: number }>();
  for (const r of results) {
    if (r.outcome === 'pending') continue;
    const w = weekStartOf(r.date, weekStart);
    const a = by.get(w) ?? { planned: 0, attended: 0 };
    a.planned += 1;
    if (r.outcome === 'done' || r.outcome === 'partial' || r.outcome === 'rescheduled_done') a.attended += 1;
    by.set(w, a);
  }
  const weeks = [...by.keys()].sort();
  const qualifies = (w: ISODate): boolean => { const a = by.get(w)!; return a.planned > 0 && a.attended / a.planned >= threshold; };
  let longest = 0, run = 0;
  for (const w of weeks) { run = qualifies(w) ? run + 1 : 0; longest = Math.max(longest, run); }
  const thisWeek = weekStartOf(today, weekStart);
  let current = 0;
  for (let w = addDays(thisWeek, w0(by, thisWeek)); ; w = addDays(w, -7)) {
    if (!by.has(w)) break;
    if (qualifies(w)) current += 1;
    else if (w === thisWeek) continue;
    else break;
  }
  return { currentWeeks: current, longestWeeks: longest };
}
// start from the current week if it has data, otherwise from last week
function w0(by: Map<ISODate, unknown>, thisWeek: ISODate): number { return by.has(thisWeek) ? 0 : -7; }
