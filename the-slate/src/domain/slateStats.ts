import { addDays, diffDays, type DateStr } from '../lib/time';
import { DIFFICULTIES, type Task, type TaskDone, type TaskOverride } from './types';
import { expandOccurrences, isDone, occurrencesBetween, progressFor, type Occurrence } from './recurrence';

export interface SlateStats {
  todayTotal: number; todayDone: number; todayPending: number; completionPct: number; overdue: number; upcoming: number;
  focusPending: number; estMinutes: number; scheduledMinutes: number; pointsToday: number; pointsWeek: number;
  week: { day: DateStr; total: number; done: number; pct: number }[];
  recurring: { id: string; title: string; occurrences: number; done: number; pct: number }[];
  todayList: Occurrence[];
}
const points = (t: Task) => DIFFICULTIES.find((d) => d.value === t.difficulty)?.points ?? t.xp;

/** Everything on the Slate dashboard, from the task, override and completion tables. */
export function slateStats(allTasks: Task[], overrides: TaskOverride[], done: TaskDone[], today: DateStr, weekStartsOn: 0 | 1 = 1): SlateStats {
  const live = allTasks.filter((t) => !t.archived_at);
  const top = live.filter((t) => !t.parent_id);
  const todayList = expandOccurrences(top, overrides, done, today, today);
  const todayDone = todayList.filter((o) => o.done).length;
  const wkStart = addDays(today, -((new Date(today + 'T00:00:00Z').getUTCDay() - weekStartsOn + 7) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(wkStart, i); const occ = expandOccurrences(top, overrides, done, day, day); const d = occ.filter((o) => o.done).length;
    return { day, total: occ.length, done: d, pct: occ.length ? Math.round((d / occ.length) * 100) : 0 };
  });
  const overdue = top.filter((t) => t.repeat === 'once' && t.start_date < today && !isDone(done, t.id, t.start_date)).length;
  const upcoming = expandOccurrences(top, overrides, done, addDays(today, 1), addDays(today, 7)).filter((o) => !o.done).length;
  const doneToday = done.filter((d) => !d.undone_at && d.day === today);
  const weekDone = done.filter((d) => !d.undone_at && d.day >= wkStart && d.day <= today);
  const byId = new Map(live.map((t) => [t.id, t]));
  const pts = (rows: TaskDone[]) => rows.reduce((s, r) => s + (byId.has(r.task_id) ? points(byId.get(r.task_id)!) : 0), 0);
  const recurring = top.filter((t) => t.repeat !== 'once').map((t) => {
    const from = addDays(today, -13); const occs = occurrencesBetween(t, from < t.start_date ? t.start_date : from, today);
    const d = occs.filter((x) => isDone(done, t.id, x)).length;
    return { id: t.id, title: t.title, occurrences: occs.length, done: d, pct: occs.length ? Math.round((d / occs.length) * 100) : 0 };
  }).filter((r) => r.occurrences > 0).sort((a, b) => a.pct - b.pct);
  return {
    todayTotal: todayList.length, todayDone, todayPending: todayList.length - todayDone,
    completionPct: todayList.length ? Math.round((todayDone / todayList.length) * 100) : 0, overdue, upcoming,
    focusPending: todayList.filter((o) => !o.done && (o.task.difficulty === 'focus' || o.task.difficulty === 'extra_focus')).length,
    estMinutes: todayList.reduce((s, o) => s + o.estMinutes, 0), scheduledMinutes: todayList.reduce((s, o) => s + o.minutes, 0),
    pointsToday: pts(doneToday), pointsWeek: pts(weekDone), week, recurring, todayList,
  };
}
export { progressFor, diffDays };
