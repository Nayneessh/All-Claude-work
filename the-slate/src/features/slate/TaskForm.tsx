import { useMemo, useState } from 'react';
import { api } from '../../data/api';
import { useAction, useConfig, useSettings } from '../../data/hooks';
import { descendants } from '../../domain/recurrence';
import { DIFFICULTIES, type Difficulty, type Repeat, type Task } from '../../domain/types';
import { dayName, fmtDuration, fromMin, toMin, type DateStr } from '../../lib/time';
import { Field, Select, TextArea, TextInput } from '../../ui/kit';
import { Modal } from '../../ui/Modal';
import { useConfirm } from '../../ui/Confirm';
import { DIFF_COLOR } from './useSlate';

const DURS = [15, 30, 60];
const LEADS = [{ v: 0, l: 'At the task time' }, { v: 5, l: '5 min before' }, { v: 10, l: '10 min before' }, { v: 15, l: '15 min before' }, { v: 30, l: '30 min before' }, { v: 60, l: '1 hour before' }];
const FOLLOW = [15, 30, 60, 120];

export interface TaskPreset { title?: string; start_date?: DateStr; due_time?: string | null; parent_id?: string | null; repeat?: Repeat }
export function TaskForm({ task, preset, tasks, today, onClose, onSaved }: { task?: Task; preset?: TaskPreset; tasks: Task[]; today: DateStr; onClose: () => void; onSaved: () => void }) {
  const editing = !!task; const { settings } = useSettings(); const cfg = useConfig(); const { run, busy } = useAction(); const confirm = useConfirm();
  const init = task ?? ({ title: preset?.title ?? '', repeat: preset?.repeat ?? 'once', start_date: preset?.start_date ?? today, due_time: preset?.due_time ?? null, difficulty: 'moderate', est_minutes: 30, category: null, notes: null,
    reminder_time: null, followup_minutes: null, rec_days: null, rec_every_weeks: 1, end_date: null, parent_id: preset?.parent_id ?? null, sched_minutes: null, xp: 10 } as unknown as Task);
  const [f, setF] = useState({ ...init, title: init.title, due_time: init.due_time ? init.due_time.slice(0, 5) : '', reminder_time: init.reminder_time ? init.reminder_time.slice(0, 5) : '', end_date: init.end_date ?? '', notes: init.notes ?? '', category: init.category ?? '' });
  const [durMode, setDurMode] = useState<'15' | '30' | '60' | 'custom'>(DURS.includes(init.est_minutes) ? (String(init.est_minutes) as '15') : 'custom');
  const [followMode, setFollowMode] = useState<string>(init.followup_minutes ? (FOLLOW.includes(init.followup_minutes) ? String(init.followup_minutes) : 'custom') : '');
  const [errors, setErrors] = useState<Record<string, string>>({}); const [dirty, setDirty] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF({ ...f, [k]: v }); setDirty(true); setErrors({ ...errors, [k]: '' }); };
  const parent = f.parent_id ? tasks.find((t) => t.id === f.parent_id) : undefined;
  const banned = useMemo(() => new Set(task ? [task.id, ...descendants(tasks, task.id).map((d) => d.id)] : []), [task, tasks]);
  const parentOptions = tasks.filter((t) => !banned.has(t.id) && !t.archived_at).map((t) => ({ value: t.id, label: `${t.parent_id ? '↳ ' : ''}${t.title}` }));
  const rdays: number[] = f.rec_days ?? [];
  const lead = f.due_time && f.reminder_time ? toMin(f.due_time) - toMin(f.reminder_time) : null;
  const cats = cfg.labels('task_category'); const catOpts = f.category && !cats.includes(f.category) ? [f.category, ...cats] : cats;
  const sub = !!parent;

  function setLead(v: string) { if (v === '') return set('reminder_time', ''); if (!f.due_time) return; set('reminder_time', fromMin(Math.max(0, toMin(f.due_time) - Number(v)))); }
  async function save() {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Give the task a name.';
    if (!f.start_date) e.start_date = 'Pick a date.';
    if (f.repeat === 'custom' && rdays.length === 0) e.rec_days = 'Choose at least one weekday.';
    if (f.end_date && f.end_date < f.start_date) e.end_date = 'The end date is before the start.';
    if (f.reminder_time && !f.due_time && false) e.reminder_time = '';
    if (f.followup_minutes && !f.reminder_time) e.followup_minutes = 'A follow-up needs a primary reminder time.';
    if (!f.est_minutes || f.est_minutes < 5 || f.est_minutes > 1440) e.est_minutes = 'Use 5–1440 minutes.';
    setErrors(e); if (Object.keys(e).length) return;
    const pts = DIFFICULTIES.find((d) => d.value === f.difficulty)?.points ?? 10;
    const ok = await run(() => api.saveTask({ ...f, id: task?.id, title: f.title, due_time: f.due_time || null, reminder_time: f.reminder_time || null, end_date: f.end_date || null, notes: f.notes || null, category: f.category || null,
      parent_id: f.parent_id || null, rec_days: f.repeat === 'custom' ? rdays : null, xp: pts, followup_minutes: f.reminder_time ? f.followup_minutes : null }), { success: editing ? 'Task updated' : 'Task added', invalidate: [['slate']] });
    if (ok) { setDirty(false); onSaved(); }
  }
  async function archive() {
    if (!task || !(await confirm({ title: 'Archive this task?', body: 'It disappears from your lists and calendar; its completion history is kept. Sub-tasks stay with it.', confirm: 'Archive', danger: true }))) return;
    await run(() => api.archiveTask(task.id, true), { success: 'Task archived', invalidate: [['slate']] }); onSaved();
  }

  return (
    <Modal drawer dirty={dirty} onClose={onClose} title={editing ? 'Edit task' : 'New task'}
      footer={<>{editing && <button className="btn danger" onClick={archive} type="button" style={{ marginRight: 'auto' }}>Archive</button>}<button className="btn" onClick={onClose} type="button">Cancel</button><button className="btn primary" onClick={save} disabled={busy} type="button">{busy ? <span className="spinner" /> : editing ? 'Save task' : 'Add task'}</button></>}>
      <div className="form-grid">
        <Field label="Task name" required error={errors.title} full><TextInput value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={200} autoFocus /></Field>
        <Field label="Parent task" hint="Sub-tasks follow their parent's date and repeat." full><Select value={f.parent_id ?? ''} onChange={(e) => set('parent_id', e.target.value || null)} options={parentOptions} placeholder="None — a top-level task" /></Field>
        <Field label="Occurrence" full>
          <div className="opt-row">{([['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Monday to Friday'], ['custom', 'Custom']] as [Repeat, string][]).map(([v, l]) => <button type="button" key={v} disabled={sub} className={`opt ${f.repeat === v ? 'on' : ''}`} onClick={() => set('repeat', v)}>{l}</button>)}</div>
          {sub && <div className="hint">Following “{parent!.title}”: {parent!.repeat === 'once' ? 'once' : parent!.repeat}.</div>}
        </Field>
        <Field label={f.repeat === 'once' ? 'Date' : 'Starts on'} required error={errors.start_date}><TextInput type="date" value={f.start_date} disabled={sub} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="Start time" hint="Leave empty for an all-day task"><TextInput type="time" value={f.due_time} onChange={(e) => { const v = e.target.value; setF({ ...f, due_time: v, reminder_time: f.reminder_time && f.due_time && v ? fromMin(Math.max(0, toMin(v) - (toMin(f.due_time) - toMin(f.reminder_time)))) : f.reminder_time }); setDirty(true); }} /></Field>
        {f.repeat === 'custom' && !sub && (<>
          <Field label="Repeat on" error={errors.rec_days} full><div className="daychips">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button type="button" key={d} className={rdays.includes(d) ? 'on' : ''} onClick={() => set('rec_days', rdays.includes(d) ? rdays.filter((x) => x !== d) : [...rdays, d].sort())} aria-pressed={rdays.includes(d)}>{dayName(d)}</button>)}</div></Field>
          <Field label="Every how many weeks"><TextInput type="number" min={1} max={52} value={f.rec_every_weeks} onChange={(e) => set('rec_every_weeks', Math.max(1, Math.min(52, Number(e.target.value) || 1)))} /></Field>
        </>)}
        {f.repeat !== 'once' && !sub && <Field label="Ends on (optional)" error={errors.end_date}><TextInput type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>}

        <Field label="Reminder" hint={f.due_time ? (f.reminder_time ? `Reminds at ${f.reminder_time}. Moves with the task if you reschedule it.` : 'No reminder') : 'Pick a time for the reminder'} full>
          <div className="row wrap">{f.due_time && <Select aria-label="Reminder timing" value={lead === null ? '' : LEADS.some((l) => l.v === lead) ? String(lead) : 'x'} onChange={(e) => setLead(e.target.value)} style={{ maxWidth: 200 }}
            options={[...LEADS.map((l) => ({ value: String(l.v), label: l.l })), ...(lead !== null && !LEADS.some((l) => l.v === lead) ? [{ value: 'x', label: 'Custom time' }] : [])]} placeholder="No reminder" />}
            <TextInput aria-label="Reminder time" type="time" value={f.reminder_time} onChange={(e) => set('reminder_time', e.target.value)} style={{ maxWidth: 140 }} />
            {f.reminder_time && <button type="button" className="btn sm" onClick={() => { set('reminder_time', ''); set('followup_minutes', null); setFollowMode(''); }}>Remove</button>}</div>
        </Field>
        <Field label="Follow-up reminder" error={errors.followup_minutes} hint="Nudges you again if the task is still not done" full>
          <div className="opt-row"><button type="button" className={`opt ${followMode === '' ? 'on' : ''}`} onClick={() => { setFollowMode(''); set('followup_minutes', null); }}>None</button>
            {FOLLOW.map((m) => <button type="button" key={m} className={`opt ${followMode === String(m) ? 'on' : ''}`} onClick={() => { setFollowMode(String(m)); set('followup_minutes', m); }}>{fmtDuration(m)} later</button>)}
            <button type="button" className={`opt ${followMode === 'custom' ? 'on' : ''}`} onClick={() => { setFollowMode('custom'); set('followup_minutes', f.followup_minutes ?? settings.defaultFollowupMinutes); }}>Custom</button></div>
          {followMode === 'custom' && <TextInput type="number" min={5} max={1440} value={f.followup_minutes ?? ''} onChange={(e) => set('followup_minutes', Number(e.target.value) || null)} style={{ maxWidth: 140, marginTop: 6 }} placeholder="minutes" />}
        </Field>

        <Field label="Task difficulty" full><div className="opt-row">{DIFFICULTIES.map((d) => <button type="button" key={d.value} className={`opt ${f.difficulty === d.value ? 'on' : ''}`} onClick={() => set('difficulty', d.value as Difficulty)}><i className="diff" style={{ background: DIFF_COLOR[d.value].bar }} />{d.label}<span className="tiny muted">{d.points} pts</span></button>)}</div></Field>
        <Field label="Estimated duration" error={errors.est_minutes} hint={task?.sched_minutes && task.sched_minutes !== task.est_minutes ? `On the calendar this is blocked for ${fmtDuration(task.sched_minutes)}; your original estimate is kept.` : 'Your original estimate — kept even if you stretch the task on the calendar.'} full>
          <div className="opt-row">{DURS.map((m) => <button type="button" key={m} className={`opt ${durMode === String(m) ? 'on' : ''}`} onClick={() => { setDurMode(String(m) as '15'); set('est_minutes', m); }}>{fmtDuration(m)}</button>)}
            <button type="button" className={`opt ${durMode === 'custom' ? 'on' : ''}`} onClick={() => setDurMode('custom')}>Custom</button></div>
          {durMode === 'custom' && <TextInput type="number" min={5} max={1440} value={f.est_minutes} onChange={(e) => set('est_minutes', Number(e.target.value) || 0)} style={{ maxWidth: 140, marginTop: 6 }} placeholder="minutes" />}
        </Field>
        {catOpts.length > 0 && <Field label="Category"><Select value={f.category} onChange={(e) => set('category', e.target.value)} options={catOpts} placeholder="—" /></Field>}
        <Field label="Notes" full><TextArea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} /></Field>
      </div>
    </Modal>
  );
}
