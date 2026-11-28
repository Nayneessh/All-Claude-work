import { addDays, diffDays, dow, startOfWeek, type DateStr, type TimeStr, toMin, fromMin } from '../lib/time';
import type { Task, TaskDone, TaskOverride } from './types';

type Sched = Pick<Task, 'repeat' | 'start_date' | 'end_date' | 'rec_days' | 'rec_every_weeks'>;

/** Does the task (or series) have an occurrence on `day`? Pure date arithmetic on YYYY-MM-DD strings. */
export function occursOn(t: Sched, day: DateStr): boolean {
  if (day < t.start_date) return false;
  if (t.end_date && day > t.end_date) return false;
  switch (t.repeat) {
    case 'once': return day === t.start_date;
    case 'daily': return true;
    case 'weekdays': { const d = dow(day); return d >= 1 && d <= 5; }
    case 'custom': {
      if (!t.rec_days || !t.rec_days.includes(dow(day))) return false;
      const every = Math.max(1, t.rec_every_weeks || 1);
      const weeks = Math.round(diffDays(startOfWeek(day, 1), startOfWeek(t.start_date, 1)) / 7);
      return weeks >= 0 && weeks % every === 0;
    }
  }
}

export function occurrencesBetween(t: Sched, from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const lo = from < t.start_date ? t.start_date : from;
  const hi = t.end_date && t.end_date < to ? t.end_date : to;
  if (t.repeat === 'once') return t.start_date >= from && t.start_date <= to ? [t.start_date] : [];
  for (let d = lo; d <= hi; d = addDays(d, 1)) if (occursOn(t, d)) out.push(d);
  return out;
}

export interface Occurrence {
  task: Task;
  /** The date this occurrence belongs to in the series (key for completion + overrides). */
  originDay: DateStr;
  /** Where it is shown (differs from originDay when an occurrence was moved). */
  day: DateStr;
  start: TimeStr | null;
  /** Minutes blocked on the calendar: the actual scheduled length, never the original estimate. */
  minutes: number;
  /** Original estimate — never lost when rescheduling. */
  estMinutes: number;
  moved: boolean;
  done: boolean;
}

export const isDone = (done: TaskDone[], taskId: string, day: DateStr): boolean => done.some((d) => d.task_id === taskId && d.day === day && !d.undone_at);

/** All occurrences DISPLAYED inside [from, to] for the given (top-level) tasks, honouring per-occurrence overrides. */
export function expandOccurrences(tasks: Task[], overrides: TaskOverride[], done: TaskDone[], from: DateStr, to: DateStr): Occurrence[] {
  const out: Occurrence[] = [];
  const ovBy = new Map<string, TaskOverride>();
  for (const o of overrides) ovBy.set(`${o.task_id}|${o.day}`, o);
  for (const t of tasks) {
    if (t.archived_at) continue;
    const origins = new Set(occurrencesBetween(t, addDays(from, -60), addDays(to, 60)));
    for (const originDay of origins) {
      const ov = ovBy.get(`${t.id}|${originDay}`);
      const day = ov ? ov.new_day : originDay;
      if (day < from || day > to) continue;
      out.push({
        task: t, originDay, day, start: ov ? ov.start_time : t.due_time, minutes: ov ? ov.sched_minutes : (t.sched_minutes ?? t.est_minutes),
        estMinutes: t.est_minutes, moved: !!ov, done: isDone(done, t.id, originDay),
      });
    }
  }
  return out.sort((a, b) => (a.day === b.day ? (a.start ?? '99:99').localeCompare(b.start ?? '99:99') : a.day.localeCompare(b.day)));
}

/** Children (all depths) of a task. */
export function descendants(tasks: Task[], id: string): Task[] {
  const out: Task[] = [];
  const walk = (pid: string) => { for (const t of tasks) if (t.parent_id === pid && !t.archived_at) { out.push(t); walk(t.id); } };
  walk(id);
  return out;
}
export interface Progress { done: number; total: number; pct: number }
/** Completion progress of a parent for a given occurrence day: counts leaf sub-tasks (nested levels roll up). */
export function progressFor(tasks: Task[], done: TaskDone[], id: string, day: DateStr): Progress {
  const kids = descendants(tasks, id);
  const leaves = kids.filter((k) => !kids.some((x) => x.parent_id === k.id));
  const d = leaves.filter((k) => isDone(done, k.id, day)).length;
  return { done: d, total: leaves.length, pct: leaves.length ? Math.round((d / leaves.length) * 100) : 0 };
}

/** When should the primary / follow-up reminders fire for an occurrence? Minutes since midnight on `day`, or null. */
export function reminderMinutes(o: Occurrence): { primary: number | null; followup: number | null } {
  const t = o.task;
  const rt = t.reminder_time ? toMin(t.reminder_time) : null;
  if (rt === null) return { primary: null, followup: null };
  // when the occurrence itself was moved, its reminder moves by the same shift
  const shift = o.moved && o.start && t.due_time ? toMin(o.start) - toMin(t.due_time) : 0;
  const primary = Math.max(0, Math.min(1439, rt + shift));
  return { primary, followup: t.followup_minutes ? Math.min(1439, primary + t.followup_minutes) : null };
}
export const fmtMinutes = (m: number): TimeStr => fromMin(m);
