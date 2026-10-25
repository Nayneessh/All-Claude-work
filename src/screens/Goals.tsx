import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Goal, GoalType } from '@/domain/types';
import { createGoal, listGoals, setGoalStatus, updateGoal } from '@/data/repo/misc';
import { evaluateGoals, syncMilestones, type GoalView } from '@/data/repo/goalData';
import { defaultMilestones } from '@/domain/goals';
import { exerciseMap } from '@/data/repo/exercises';
import { GROUP_LABELS, GROUP_ORDER } from '@/domain/muscles';
import { BODY_LABELS, type BodyKey } from '@/domain/body';
import { formatWeight, fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { Badge, Banner, Button, Card, Chip, Empty, Field, Loading, ProgressBar, Section, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, errMsg } from '@/ui/format';
import { ExercisePicker } from './shared/ExercisePicker';

const TYPES: { v: GoalType; label: string; hint: string; needsExercise?: boolean; weight?: boolean; unitKind: 'weight' | 'reps' | 'count' | 'pct' | 'volume' | 'sets' | 'measure' }[] = [
  { v: 'exercise_load', label: 'Lift a heavier weight', hint: 'Heaviest set of an exercise', needsExercise: true, unitKind: 'weight' },
  { v: 'exercise_e1rm', label: 'Raise estimated 1RM', hint: 'Estimated, from your sets', needsExercise: true, unitKind: 'weight' },
  { v: 'exercise_reps_at_load', label: 'Reps at a weight', hint: 'e.g. 10 reps at 100 kg', needsExercise: true, weight: true, unitKind: 'reps' },
  { v: 'weekly_frequency', label: 'Training days per week', hint: 'Average sessions per week', unitKind: 'count' },
  { v: 'weekly_sets', label: 'Weekly sets for a muscle', hint: 'Direct sets per week', unitKind: 'sets' },
  { v: 'weekly_volume', label: 'Weekly volume load', hint: 'Total load × reps per week', unitKind: 'volume' },
  { v: 'adherence', label: 'Attendance rate', hint: '% of planned sessions done', unitKind: 'pct' },
  { v: 'bodyweight', label: 'Bodyweight', hint: 'Target scale weight', unitKind: 'weight' },
  { v: 'measurement', label: 'Body measurement', hint: 'Waist, arm, chest…', unitKind: 'measure' },
  { v: 'cardio', label: 'Cardio benchmark', hint: 'Longest distance or time', needsExercise: true, unitKind: 'count' },
  { v: 'mobility', label: 'Mobility / hold', hint: 'Longest hold in seconds', needsExercise: true, unitKind: 'count' },
];

export function Goals() {
  const nav = useNavigate();
  const ui = useUi();
  const { today, unit } = useApp();
  const goals = useLive(() => listGoals(), []);
  const names = useLive(() => exerciseMap(), []);
  const views = useLive(() => evaluateGoals(goals.data ?? [], today), [goals.data, today]);
  const [create, setCreate] = useState(false);
  const [sel, setSel] = useState<GoalView | null>(null);
  useEffect(() => { if (views.data?.length) void syncMilestones(views.data); }, [views.data]);
  const active = (views.data ?? []).filter((v) => v.goal.status === 'active' || v.goal.status === 'paused');
  const past = (views.data ?? []).filter((v) => v.goal.status === 'completed' || v.goal.status === 'abandoned');
  const fmt = (g: Goal, n: number | null): string => {
    if (n === null) return '—';
    const t = TYPES.find((x) => x.v === g.goal_type);
    if (t?.unitKind === 'weight' || g.goal_type === 'weekly_volume') return formatWeight(n, unit);
    if (g.goal_type === 'adherence') return `${Math.round(n)}%`;
    if (g.goal_type === 'cardio') return `${Math.round(n)}`;
    return String(Math.round(n * 10) / 10);
  };
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Goals</h1><Button small variant="primary" icon="plus" onClick={() => setCreate(true)}>New</Button></div>
      {views.loading ? <Loading /> : active.length === 0 ? <Card><Empty icon="target" title="No goals yet" hint="Set a target — a lift, a bodyweight, a weekly habit. Progress is measured from your own logs." action={<Button variant="primary" onClick={() => setCreate(true)}>Set a goal</Button>} /></Card> : (
        <div className="col">{active.map((v) => (
          <button key={v.goal.id} type="button" className="card" style={{ textAlign: 'left', color: 'inherit' }} onClick={() => setSel(v)}>
            <div className="row-flex between"><div className="strong">{v.goal.title}</div><Badge tone={v.goal.status === 'paused' ? 'warn' : undefined}>{v.goal.status}</Badge></div>
            <div className="small dim mt-1">{v.goal.exercise_id ? names.data?.get(v.goal.exercise_id)?.name : v.goal.muscle ? GROUP_LABELS[v.goal.muscle as keyof typeof GROUP_LABELS] : ''}</div>
            <div className="row-flex between mt-3"><span className="num strong gold" style={{ fontSize: '1.3rem' }}>{fmt(v.goal, v.progress.current)}</span><span className="dim">of {fmt(v.goal, v.goal.target_value)}</span></div>
            <div className="mt-2"><ProgressBar value={v.progress.pct ?? 0} label={`${v.goal.title} progress`} /></div>
            <div className="row-flex between tiny dim mt-2"><span>{v.progress.pct !== null ? `${Math.round(v.progress.pct)}%` : 'No data yet'} · from {fmt(v.goal, v.progress.baseline)}</span><span>{v.goal.target_date ? `by ${fmtDate(v.goal.target_date, { year: true })}` : ''}</span></div>
            {v.progress.projectedDate && <div className="tiny mt-1">{v.progress.onTrack === false ? <span className="warn">Estimated {fmtDate(v.progress.projectedDate, { year: true })} — after your target date</span> : <span className="ok">Estimated {fmtDate(v.progress.projectedDate, { year: true })}</span>}</div>}
          </button>
        ))}</div>
      )}
      {past.length > 0 && <Section title="Finished"><Card className="pad-0"><div className="list">{past.map((v) => <button key={v.goal.id} type="button" className="item" onClick={() => setSel(v)}><div className="grow"><div className="strong">{v.goal.title}</div><div className="small dim">{v.goal.completed_at ? `Reached ${fmtDate(v.goal.completed_at.slice(0, 10), { year: true })}` : 'Abandoned'}</div></div><Badge tone={v.goal.status === 'completed' ? 'ok' : 'bad'}>{v.goal.status}</Badge></button>)}</div></Card></Section>}
      <GoalForm open={create} onClose={() => setCreate(false)} onSaved={() => setCreate(false)} />
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel?.goal.title ?? ''}>
        {sel && (
          <div className="col">
            <div className="kpis"><div className="kpi"><div className="l">Now</div><div className="v">{fmt(sel.goal, sel.progress.current)}</div></div><div className="kpi"><div className="l">Target</div><div className="v">{fmt(sel.goal, sel.goal.target_value)}</div></div></div>
            <p className="small dim">{sel.progress.note}</p>
            <div className="eyebrow">Milestones</div>
            {sel.goal.milestones.map((m) => <div key={m.label} className="row-flex between small"><span>{m.label} · {fmt(sel.goal, m.value)}</span>{m.reached_at ? <Badge tone="ok">reached {m.reached_at.slice(0, 10)}</Badge> : <Badge tone="dim">ahead</Badge>}</div>)}
            {sel.goal.notes && <p className="small">{sel.goal.notes}</p>}
            <p className="tiny dim">Goals are paused, completed or abandoned — never deleted — so the record stays.</p>
            <div className="row-flex wrap">
              {sel.goal.status === 'active' && <Button small onClick={async () => { await setGoalStatus(sel.goal.id, 'paused'); setSel(null); }}>Pause</Button>}
              {sel.goal.status === 'paused' && <Button small onClick={async () => { await setGoalStatus(sel.goal.id, 'active'); setSel(null); }}>Resume</Button>}
              {['active', 'paused'].includes(sel.goal.status) && <Button small variant="primary" onClick={async () => { await setGoalStatus(sel.goal.id, 'completed'); setSel(null); ui.toast('Goal completed 🎉', { tone: 'ok' }); }}>Mark done</Button>}
              {['active', 'paused'].includes(sel.goal.status) && <Button small variant="danger" onClick={async () => { if (await ui.confirm({ title: 'Abandon this goal?', message: 'It stays in your history as abandoned.', confirmLabel: 'Abandon', danger: true })) { await setGoalStatus(sel.goal.id, 'abandoned'); setSel(null); } }}>Abandon</Button>}
              {['completed', 'abandoned'].includes(sel.goal.status) && <Button small onClick={async () => { await updateGoal(sel.goal.id, { status: 'active', completed_at: null }); setSel(null); }}>Reopen</Button>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function GoalForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const ui = useUi();
  const { today, unit } = useApp();
  const [type, setType] = useState<GoalType>('exercise_load');
  const [exId, setExId] = useState<string | null>(null);
  const [exName, setExName] = useState('');
  const [pick, setPick] = useState(false);
  const [target, setTarget] = useState('');
  const [tw, setTw] = useState('');
  const [date, setDate] = useState('');
  const [muscle, setMuscle] = useState<string>('chest');
  const [mkey, setMkey] = useState<BodyKey>('waist_cm');
  const [title, setTitle] = useState('');
  const t = TYPES.find((x) => x.v === type) as (typeof TYPES)[number];
  const isW = t.unitKind === 'weight' || type === 'weekly_volume';
  async function save(): Promise<void> {
    const tv = parseNumber(target);
    if (tv === null || tv <= 0) { ui.toast('Enter a target number', { tone: 'err' }); return; }
    if (t.needsExercise && !exId) { ui.toast('Choose an exercise', { tone: 'err' }); return; }
    const twk = parseNumber(tw);
    if (t.weight && twk === null) { ui.toast('Enter the weight for this goal', { tone: 'err' }); return; }
    try {
      const targetValue = isW ? fromDisplayWeight(tv, unit) : tv;
      const [{ goalSeries }, { evaluateGoal }] = await Promise.all([import('@/data/repo/goalData'), import('@/domain/goals')]);
      const draft = { title: title.trim() || `${t.label}${exName ? ` — ${exName}` : ''}`, goal_type: type, exercise_id: t.needsExercise ? exId : null, muscle: type === 'weekly_sets' ? muscle : null, measurement_key: type === 'measurement' ? mkey : null, target_value: targetValue, target_weight_kg: t.weight && twk !== null ? fromDisplayWeight(twk, unit) : null, baseline_value: null as number | null, baseline_date: today, target_date: date || null, priority: 2, status: 'active' as const, completed_at: null, milestones: [] as Goal['milestones'], notes: null };
      const series = await goalSeries({ ...(draft as unknown as Goal), id: 'draft' }, today);
      const base = series.length ? (series.at(-1)?.value as number) : null;
      draft.baseline_value = base;
      if (base !== null) draft.milestones = defaultMilestones(base, targetValue);
      void evaluateGoal;
      await createGoal(draft);
      ui.toast('Goal created', { tone: 'ok' });
      setTarget(''); setTitle(''); setExId(null);
      onSaved();
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="New goal" footer={<Button block variant="primary" onClick={() => void save()}>Create goal</Button>}>
      <div className="col">
        <div className="field"><span className="label">What do you want to achieve?</span><div className="col" style={{ gap: 8 }}>{TYPES.map((x) => <button key={x.v} type="button" className={`card ${type === x.v ? 'hl' : ''}`} style={{ textAlign: 'left', color: 'inherit', padding: 10 }} aria-pressed={type === x.v} onClick={() => setType(x.v)}><div className="strong">{x.label}</div><div className="tiny dim">{x.hint}</div></button>)}</div></div>
        {t.needsExercise && <div className="field"><span className="label">Exercise</span><div className="row-flex"><span className="grow">{exName || 'None chosen'}</span><Button small onClick={() => setPick(true)}>Choose</Button></div></div>}
        {type === 'weekly_sets' && <div className="field"><span className="label">Muscle group</span><div className="chips wrap">{GROUP_ORDER.map((g) => <Chip key={g} on={muscle === g} onClick={() => setMuscle(g)}>{GROUP_LABELS[g]}</Chip>)}</div></div>}
        {type === 'measurement' && <div className="field"><span className="label">Which measurement?</span><div className="chips wrap">{(['waist_cm', 'chest_cm', 'arm_cm', 'thigh_cm', 'hip_cm', 'calf_cm', 'body_fat_pct'] as BodyKey[]).map((k) => <Chip key={k} on={mkey === k} onClick={() => setMkey(k)}>{BODY_LABELS[k].replace(' (estimate)', '')}</Chip>)}</div></div>}
        {t.weight && <Field label={`At this weight (${unit})`}>{(id) => <input id={id} className="input" inputMode="decimal" value={tw} onChange={(e) => setTw(e.target.value)} />}</Field>}
        <Field label={`Target${isW ? ` (${unit})` : type === 'adherence' ? ' (%)' : ''}`}>{(id) => <input id={id} className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={isW ? toDisplayWeight(100, unit).toString() : ''} />}</Field>
        <Field label="Target date (optional)">{(id) => <input id={id} className="input" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Name (optional)">{(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Banner icon="info">Your starting point is taken from your current logged data, and progress is measured from there.</Banner>
      </div>
      <ExercisePicker open={pick} onClose={() => setPick(false)} title="Goal exercise" onPick={(e) => { setExId(e.id); setExName(e.name); }} />
    </Sheet>
  );
}
