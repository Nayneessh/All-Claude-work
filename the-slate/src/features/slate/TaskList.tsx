import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../data/api';
import { friendlyError } from '../../lib/supabase';
import { useToast } from '../../ui/Toast';
import { descendants, expandOccurrences, isDone, progressFor, type Occurrence } from '../../domain/recurrence';
import type { Task, TaskDone, TaskOverride } from '../../domain/types';
import { addDays, dayName, dow, fmtDateShort, fmtDuration, fmtTime, type DateStr } from '../../lib/time';
import { Chip, Empty, Icon, Progress, Seg } from '../../ui/kit';
import { DIFF_COLOR } from './useSlate';

type View = 'today' | 'upcoming' | 'overdue' | 'all' | 'done';
const repeatLabel = (t: Task) => t.repeat === 'once' ? '' : t.repeat === 'daily' ? 'Every day' : t.repeat === 'weekdays' ? 'Mon–Fri' : `${(t.rec_days ?? []).map((d) => dayName(d)).join(' ')}${t.rec_every_weeks > 1 ? ` · every ${t.rec_every_weeks}w` : ''}`;

export function TaskList({ tasks, done: doneRaw, overrides, today, onEdit, onAdd }: { tasks: Task[]; done: TaskDone[]; overrides: TaskOverride[]; today: DateStr; doneKey?: readonly unknown[]; onEdit: (t: Task) => void; onAdd: (preset: { parent_id?: string; title?: string }) => void }) {
  const [view, setView] = useState<View>('today'); const qc = useQueryClient(); const toast = useToast();
  // Pending ticks overlay the server data until the server confirms, so a background refresh can never flip a checkbox back.
  const [pending, setPending] = useState<Record<string, { v: boolean; n: number }>>({}); const seq = useRef(0);
  const done = useMemo(() => {
    const keys = Object.keys(pending); if (!keys.length) return doneRaw;
    return [...doneRaw.filter((d) => !(`${d.task_id}|${d.day}` in pending)), ...keys.map((k) => { const [task_id, day] = k.split('|'); return { task_id, day, completed_at: '', undone_at: pending[k].v ? null : 'pending' }; })];
  }, [doneRaw, pending]);
  const top = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);
  const occ = (from: DateStr, to: DateStr) => expandOccurrences(top, overrides, done, from, to);
  const todayOcc = useMemo(() => occ(today, today), [top, overrides, done, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => occ(addDays(today, 1), addDays(today, 14)), [top, overrides, done, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const overdue = useMemo(() => top.filter((t) => t.repeat === 'once' && t.start_date < today && !isDone(done, t.id, t.start_date)).sort((a, b) => a.start_date.localeCompare(b.start_date)), [top, done, today]);
  const recentDone = useMemo(() => done.filter((d) => !d.undone_at && d.day >= addDays(today, -7)).sort((a, b) => b.completed_at.localeCompare(a.completed_at)), [done, today]);
  const counts = { today: todayOcc.filter((o) => !o.done).length, upcoming: upcoming.length, overdue: overdue.length };

  /** Instant, concurrent ticking: the overlay shows the new state immediately; a failure rolls back just that row. */
  const toggle = (taskId: string, day: DateStr, value: boolean) => {
    const key = `${taskId}|${day}`; const n = ++seq.current;
    setPending((p) => ({ ...p, [key]: { v: value, n } }));
    const settle = () => setPending((p) => { if (p[key]?.n !== n) return p; const { [key]: _drop, ...rest } = p; void _drop; return rest; });
    api.setDone(taskId, day, value).then(() => qc.invalidateQueries({ queryKey: ['slate'] })).then(settle).catch((e) => { settle(); toast.error(friendlyError(e)); });
  };
  const row = (o: Occurrence) => <TaskRow key={`${o.task.id}|${o.originDay}`} task={o.task} day={o.originDay} shownDay={o.day} start={o.start} minutes={o.minutes} est={o.estMinutes} done={o.done} tasks={tasks} doneRows={done} toggle={toggle} onEdit={onEdit} onAdd={onAdd} today={today} />;

  return (
    <div className="stack">
      <Seg value={view} onChange={setView} options={[{ value: 'today', label: `Today${counts.today ? ` · ${counts.today}` : ''}` }, { value: 'upcoming', label: `Upcoming${counts.upcoming ? ` · ${counts.upcoming}` : ''}` }, { value: 'overdue', label: `Overdue${counts.overdue ? ` · ${counts.overdue}` : ''}` }, { value: 'all', label: 'All tasks' }, { value: 'done', label: 'Completed' }]} />
      {view === 'today' && (todayOcc.length === 0 ? <Empty title="Nothing scheduled for today">Type a task in the box above.</Empty> : <div>{[...todayOcc].sort((a, b) => Number(a.done) - Number(b.done)).map(row)}</div>)}
      {view === 'upcoming' && (upcoming.length === 0 ? <Empty title="Nothing in the next two weeks" /> : <div className="stack">{[...new Set(upcoming.map((o) => o.day))].map((d) => <div key={d}><div className="lbl" style={{ margin: '4px 0 6px' }}>{dayName(dow(d))} · {fmtDateShort(d)}</div>{upcoming.filter((o) => o.day === d).map(row)}</div>)}</div>)}
      {view === 'overdue' && (overdue.length === 0 ? <div className="banner good">No overdue tasks. 🎯</div> : <div>{overdue.map((t) => <TaskRow key={t.id} task={t} day={t.start_date} shownDay={t.start_date} start={t.due_time} minutes={t.sched_minutes ?? t.est_minutes} est={t.est_minutes} done={false} tasks={tasks} doneRows={done} toggle={toggle} onEdit={onEdit} onAdd={onAdd} today={today} overdue />)}</div>)}
      {view === 'all' && (top.length === 0 ? <Empty title="No tasks yet" /> : <div>{top.map((t) => <TaskRow key={t.id} task={t} day={t.repeat === 'once' ? t.start_date : today} shownDay={t.start_date} start={t.due_time} minutes={t.sched_minutes ?? t.est_minutes} est={t.est_minutes} done={isDone(done, t.id, t.repeat === 'once' ? t.start_date : today)} tasks={tasks} doneRows={done} toggle={toggle} onEdit={onEdit} onAdd={onAdd} today={today} series />)}</div>)}
      {view === 'done' && (recentDone.length === 0 ? <Empty title="Nothing completed in the last 7 days" /> : <div className="stack-s">{recentDone.map((d) => { const t = tasks.find((x) => x.id === d.task_id); if (!t) return null; return (
        <div key={`${d.task_id}${d.day}`} className="task done"><div className="task-main"><input className="cb" type="checkbox" checked readOnly onChange={() => toggle(d.task_id, d.day, false)} aria-label={`Reopen ${t.title}`} /><span className="title grow">{t.title}</span><span className="small muted">{fmtDateShort(d.day)}</span><button className="btn xs" onClick={() => toggle(d.task_id, d.day, false)}>Reopen</button></div></div>); })}</div>)}
    </div>
  );
}

function TaskRow({ task, day, shownDay, start, minutes, est, done, tasks, doneRows, toggle, onEdit, onAdd, today, overdue, series }: {
  task: Task; day: DateStr; shownDay: DateStr; start: string | null; minutes: number; est: number; done: boolean; tasks: Task[]; doneRows: TaskDone[]; toggle: (id: string, day: DateStr, v: boolean) => void;
  onEdit: (t: Task) => void; onAdd: (p: { parent_id?: string }) => void; today: DateStr; overdue?: boolean; series?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const kids = tasks.filter((t) => t.parent_id === task.id);
  const prog = progressFor(tasks, doneRows, task.id, day);
  const moved = shownDay !== day;
  return (
    <div className={`task ${done ? 'done' : ''}`}>
      <div className="task-main">
        <input className="cb" type="checkbox" checked={done} onChange={(e) => toggle(task.id, day, e.target.checked)} aria-label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap gap-s"><span className="title">{task.title}</span>{overdue && <Chip tone="red">Overdue · {fmtDateShort(task.start_date)}</Chip>}{series && task.repeat === 'once' && <span className="small muted">{fmtDateShort(task.start_date)}</span>}</div>
          <div className="row wrap gap-s tiny muted"><span title={task.difficulty}><i className="diff" style={{ background: DIFF_COLOR[task.difficulty].bar }} /> {task.difficulty.replace('_', ' ')}</span>
            {start && <span>🕐 {fmtTime(start)}</span>}<span>⏱ {fmtDuration(minutes)}{minutes !== est && <span title="Scheduled on the calendar; estimate kept"> (est. {fmtDuration(est)})</span>}</span>
            {task.repeat !== 'once' && <span>↻ {repeatLabel(task)}</span>}{task.category && <span>#{task.category}</span>}{task.reminder_time && <span>🔔 {fmtTime(task.reminder_time)}</span>}{moved && <span className="gold">moved to {fmtDateShort(shownDay)}</span>}</div>
          {prog.total > 0 && <div className="row" style={{ marginTop: 5, maxWidth: 260 }}><Progress pct={prog.pct} /><span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{prog.done}/{prog.total}</span></div>}
        </div>
        {(kids.length > 0 || open) && <button className="btn xs ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle sub-tasks"><span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' }}><Icon n="chev" size={14} /></span> {kids.length}</button>}
        <button className="btn xs" onClick={() => { setOpen(true); onAdd({ parent_id: task.id }); }} title="Add a sub-task" aria-label="Add sub-task"><Icon n="plus" size={13} /></button>
        <button className="btn xs" onClick={() => onEdit(task)} aria-label={`Edit ${task.title}`}><Icon n="edit" size={13} /></button>
      </div>
      {(open || (kids.length > 0 && !done && false)) && kids.length > 0 && <div className="sub-tasks">{kids.map((k) => <SubTask key={k.id} t={k} day={day} tasks={tasks} doneRows={doneRows} toggle={toggle} onEdit={onEdit} onAdd={onAdd} today={today} />)}</div>}
    </div>
  );
}
function SubTask({ t, day, tasks, doneRows, toggle, onEdit, onAdd, today }: { t: Task; day: DateStr; tasks: Task[]; doneRows: TaskDone[]; toggle: (id: string, day: DateStr, v: boolean) => void; onEdit: (t: Task) => void; onAdd: (p: { parent_id?: string }) => void; today: DateStr }) {
  const d = isDone(doneRows, t.id, day); const kids = tasks.filter((x) => x.parent_id === t.id); const prog = progressFor(tasks, doneRows, t.id, day);
  return (
    <div className={`task ${d ? 'done' : ''}`}>
      <div className="task-main"><input className="cb" type="checkbox" checked={d} onChange={(e) => toggle(t.id, day, e.target.checked)} aria-label={t.title} /><span className="title grow">{t.title}{prog.total > 0 && <span className="tiny muted"> · {prog.done}/{prog.total}</span>}</span>
        <button className="btn xs" onClick={() => onAdd({ parent_id: t.id })} aria-label="Add nested sub-task"><Icon n="plus" size={12} /></button><button className="btn xs" onClick={() => onEdit(t)} aria-label="Edit"><Icon n="edit" size={12} /></button></div>
      {kids.length > 0 && <div className="sub-tasks" style={{ paddingLeft: 26 }}>{kids.map((k) => <SubTask key={k.id} t={k} day={day} tasks={tasks} doneRows={doneRows} toggle={toggle} onEdit={onEdit} onAdd={onAdd} today={today} />)}</div>}
    </div>
  );
}
export { descendants };
