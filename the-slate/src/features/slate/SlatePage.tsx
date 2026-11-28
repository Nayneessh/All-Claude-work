import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../data/api';
import { useAction, useSettings } from '../../data/hooks';
import { parseQuickTask } from '../../domain/quickTask';
import type { Task } from '../../domain/types';
import type { DateStr } from '../../lib/time';
import { fmtTime } from '../../lib/time';
import { Icon, Loading, ErrorBox, Seg } from '../../ui/kit';
import { CalendarView } from './CalendarView';
import { SlateDashboard } from './SlateDashboard';
import { TaskForm, type TaskPreset } from './TaskForm';
import { TaskList } from './TaskList';
import { useSlateData } from './useSlate';
import { useToast } from '../../ui/Toast';

export default function SlatePage() {
  const { settings } = useSettings(); const qc = useQueryClient(); const toast = useToast(); const { run, busy } = useAction();
  const [range, setRange] = useState<{ from?: DateStr; to?: DateStr }>({});
  const d = useSlateData(range.from, range.to);
  const [tab, setTab] = useState<'list' | 'calendar'>('list'); const [text, setText] = useState('');
  const [form, setForm] = useState<null | { task?: Task; preset?: TaskPreset }>(null); const [dash, setDash] = useState(true);

  async function quickAdd() {
    const v = text.trim(); if (!v) return;
    const q = parseQuickTask(v, d.today);
    const ok = await run(() => api.saveTask({ title: q.title, start_date: q.start_date, due_time: q.due_time, repeat: q.repeat, rec_days: q.rec_days, est_minutes: q.est_minutes ?? 30, reminder_time: q.reminder_time,
      followup_minutes: q.reminder_time ? settings.defaultFollowupMinutes : null } as never), { invalidate: [['slate']] });
    if (ok) { setText(''); toast.ok(`Added “${q.title}”${q.due_time ? ` · ${fmtTime(q.due_time)}` : ''}${q.start_date !== d.today ? ` · ${q.start_date}` : ''}${q.repeat !== 'once' ? ' · repeats' : ''}`); }
  }
  return (
    <div className="stack">
      <div className="row wrap"><h1>The Slate</h1><span className="muted">your day, in order</span>
        <div className="right row"><button className="btn sm" onClick={() => setDash(!dash)}>{dash ? 'Hide' : 'Show'} summary</button><button className="btn primary" onClick={() => setForm({})}><Icon n="plus" size={15} /> Detailed task</button></div></div>
      <form className="quick" onSubmit={(e) => { e.preventDefault(); quickAdd(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a task and press Enter — e.g. Complete the Infinx market mapping by 4 PM" aria-label="Add a task" maxLength={300} />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()} style={{ height: 46 }}>Add</button>
      </form>
      {d.loading && <Loading />}{d.error && <ErrorBox error={d.error} retry={d.refetch} />}
      {!d.loading && !d.error && <>
        {dash && <SlateDashboard tasks={d.tasks} overrides={d.overrides} done={d.done} today={d.today} weekStartsOn={settings.weekStartsOn} />}
        <div className="row"><Seg value={tab} onChange={setTab} options={[{ value: 'list', label: <><Icon n="list" size={15} /> List view</> }, { value: 'calendar', label: <><Icon n="cal" size={15} /> Calendar view</> }]} /></div>
        {tab === 'list'
          ? <TaskList tasks={d.tasks} done={d.done} overrides={d.overrides} today={d.today} doneKey={d.doneKey} onEdit={(t) => setForm({ task: t })} onAdd={(p) => setForm({ preset: p })} />
          : <CalendarView tasks={d.tasks} done={d.done} overrides={d.overrides} today={d.today} onEdit={(t) => setForm({ task: t })} onCreate={(p) => setForm({ preset: p })} onRange={(from, to) => setRange((r) => (r.from === from && r.to === to ? r : { from, to }))} />}
      </>}
      {form && <TaskForm task={form.task} preset={form.preset} tasks={d.tasks} today={d.today} onClose={() => setForm(null)} onSaved={() => { setForm(null); qc.invalidateQueries({ queryKey: ['slate'] }); }} />}
    </div>
  );
}
