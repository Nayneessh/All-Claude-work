import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Exercise, SetRecord, SetType } from '@/domain/types';
import { formatDuration, formatWeight, fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { nextComponent, techniqueFor } from '@/domain/techniques';
import { sessionTimes } from '@/domain/sessionState';
import { planProgramEdit } from '@/domain/editScope';
import {
  activeSession as _a, addComponentSet, addExerciseToSession, addSet, deleteSet, discardSession, duplicateSet, editSet, finishSession, getSession, lastPerformance, logSet, pauseSession, removeExercise, resumeSession,
  restoreExercise, restoreSet, sessionCompletion, sessionExercises, skipExercise, skipScheduled, substituteExercise, uncompleteSet, unskipExercise, updateExerciseNotes, updateSession, NothingLoggedError, type SessionExerciseView,
} from '@/data/repo/sessions';
import { useLive, useNow } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { useRestTimer, type RestTimer } from '@/app/restTimer';
import { Banner, Button, Chip, Empty, Loading, Seg, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { fmtClock, errMsg, plural } from '@/ui/format';
import { ExercisePicker } from './shared/ExercisePicker';
import { EditScopeSheet } from './shared/EditScopeSheet';
import { PlateCalc } from './shared/PlateCalc';
import { MUSCLES } from '@/domain/muscles';
void _a;

type Field = 'weight' | 'reps';
interface ColSpec { aLabel: string | null; aField: 'weight_kg' | 'assist_kg' | 'distance_m' | null; aKind: 'weight' | 'km' | null; bLabel: string; bField: 'reps' | 'duration_s'; bKind: 'int' | 'seconds' | 'minutes' }

export function colsFor(ex: Exercise): ColSpec {
  switch (ex.tracking_method) {
    case 'bodyweight_reps': return { aLabel: '+kg', aField: 'weight_kg', aKind: 'weight', bLabel: 'Reps', bField: 'reps', bKind: 'int' };
    case 'assisted_reps': return { aLabel: 'Assist', aField: 'assist_kg', aKind: 'weight', bLabel: 'Reps', bField: 'reps', bKind: 'int' };
    case 'duration': return { aLabel: null, aField: null, aKind: null, bLabel: 'Secs', bField: 'duration_s', bKind: 'seconds' };
    case 'weight_duration': return { aLabel: 'Load', aField: 'weight_kg', aKind: 'weight', bLabel: 'Secs', bField: 'duration_s', bKind: 'seconds' };
    case 'distance': return { aLabel: 'km', aField: 'distance_m', aKind: 'km', bLabel: 'Min', bField: 'duration_s', bKind: 'minutes' };
    case 'distance_duration': return { aLabel: 'km', aField: 'distance_m', aKind: 'km', bLabel: 'Min', bField: 'duration_s', bKind: 'minutes' };
    default: return { aLabel: 'Load', aField: 'weight_kg', aKind: 'weight', bLabel: 'Reps', bField: 'reps', bKind: 'int' };
  }
}

const toA = (v: number | null, kind: ColSpec['aKind'], unit: 'kg' | 'lb'): string => (v === null ? '' : kind === 'km' ? String(Math.round((v / 1000) * 100) / 100) : String(toDisplayWeight(v, unit)));
const fromA = (s: string, kind: ColSpec['aKind'], unit: 'kg' | 'lb'): number | null => { const n = parseNumber(s); return n === null ? null : kind === 'km' ? Math.round(n * 1000) : fromDisplayWeight(n, unit); };
const toB = (v: number | null, kind: ColSpec['bKind']): string => (v === null ? '' : kind === 'minutes' ? String(Math.round((v / 60) * 10) / 10) : String(v));
function fromB(s: string, kind: ColSpec['bKind']): number | null {
  if (kind === 'seconds' && s.includes(':')) { const [m, sec] = s.split(':'); const mm = parseNumber(m ?? ''), ss = parseNumber(sec ?? ''); return mm === null || ss === null ? null : mm * 60 + ss; }
  const n = parseNumber(s);
  return n === null ? null : kind === 'minutes' ? Math.round(n * 60) : kind === 'int' ? Math.round(n) : n;
}

/** Order of work: supersets alternate (A1 set 1 → A2 set 1 → A1 set 2 …); everything else runs in sequence. */
export function nextTarget(views: SessionExerciseView[]): { seId: string; setId: string } | null {
  const act = views.filter((v) => v.se.status !== 'skipped');
  const done = new Set<string>();
  for (const v of act) {
    if (done.has(v.se.id)) continue;
    const g = v.se.superset_group;
    const block = g ? act.filter((x) => x.se.superset_group === g) : [v];
    const group = block.length >= 2 ? block : [v];
    group.forEach((x) => done.add(x.se.id));
    const parents = (x: SessionExerciseView): SetRecord[] => x.sets.filter((s) => !s.parent_set_id);
    const warm = group.flatMap((x) => parents(x).filter((s) => s.set_type === 'warmup' && s.status === 'planned').map((s) => ({ seId: x.se.id, setId: s.id })));
    if (warm[0]) return warm[0];
    const n = Math.max(...group.map((x) => parents(x).filter((s) => s.set_type !== 'warmup').length));
    for (let i = 0; i < n; i++) for (const x of group) { const s = parents(x).filter((y) => y.set_type !== 'warmup')[i]; if (s && s.status === 'planned') return { seId: x.se.id, setId: s.id }; }
  }
  return null;
}

export function restSecondsFor(v: SessionExerciseView, set: SetRecord, views: SessionExerciseView[], defaultRest: number): number | null {
  if (set.parent_set_id) return Number((set.extras as { rest_s?: number }).rest_s ?? 15);
  const p = v.se.planned;
  const g = v.se.superset_group;
  const mates = g ? views.filter((x) => x.se.superset_group === g && x.se.status !== 'skipped') : [];
  if (mates.length >= 2 && mates[mates.length - 1]!.se.id !== v.se.id) return null; // go straight to the partner exercise
  if (set.set_type === 'warmup') return 45;
  return p?.rest_max_s ?? p?.rest_min_s ?? v.exercise.default_rest_s ?? defaultRest;
}

export function Workout() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const app = useApp();
  const { unit, settings } = app;
  const now = useNow(1000);
  const rest = useRestTimer({ sound: settings.rest_sound, vibrate: settings.rest_vibrate });
  const session = useLive(() => getSession(id), [id]);
  const views = useLive(() => sessionExercises(id), [id]);
  const exSig = (views.data ?? []).map((v) => v.se.exercise_id).join(',');
  const prev = useLive(async () => {
    const m = new Map<string, Awaited<ReturnType<typeof lastPerformance>>>();
    for (const v of views.data ?? []) m.set(v.se.exercise_id, await lastPerformance(v.se.exercise_id, session.data?.session_date ?? app.today, id));
    return m;
  }, [exSig, id, session.data?.session_date]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<SessionExerciseView | null>(null);
  const [detail, setDetail] = useState<{ set: SetRecord; view: SessionExerciseView } | null>(null);
  const [picker, setPicker] = useState<'add' | null>(null);
  const [sub, setSub] = useState<SessionExerciseView | null>(null);
  const [plate, setPlate] = useState<SessionExerciseView | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [notesFor, setNotesFor] = useState<SessionExerciseView | null>(null);
  const target = useMemo(() => (views.data ? nextTarget(views.data) : null), [views.data]);
  const targetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { targetRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [target?.setId]);

  const s = session.data;
  // Opening a finished workout's URL goes to its history page. A workout finished from *this* screen is routed by the finish
  // sheet to its summary, so the live status update must not race it (it used to land on history about half the time).
  const openedFinished = useRef<boolean | null>(null);
  useEffect(() => {
    if (!s) return;
    const fin = ['completed_as_planned', 'completed_modified', 'partial'].includes(s.status);
    if (openedFinished.current === null) openedFinished.current = fin;
    if (fin && openedFinished.current) nav(`/history/${s.id}`, { replace: true });
  }, [s, nav]);
  useEffect(() => { if (s?.status === 'planned') void import('@/data/repo/sessions').then((m) => m.startPlannedSession(s.id, app.today)); }, [s, app.today]);

  const afterLog = useCallback((v: SessionExerciseView, set: SetRecord, all: SessionExerciseView[]) => {
    if (!settings.auto_start_rest) return;
    const secs = restSecondsFor(v, set, all, settings.default_rest_s);
    const nxt = nextTarget(all.map((x) => (x.se.id === v.se.id ? { ...x, sets: x.sets.map((y) => (y.id === set.id ? { ...y, status: 'completed' as const } : y)) } : x)));
    if (secs && nxt) {
      const nv = all.find((x) => x.se.id === nxt.seId);
      rest.start(secs, nv ? `${nv.se.label ?? ''} ${nv.exercise.name}`.trim() : '');
    }
  }, [rest, settings.auto_start_rest, settings.default_rest_s]);

  if (session.loading || views.loading) return <div className="screen no-nav"><Loading /></div>;
  if (!s || !views.data) return <div className="screen no-nav"><Empty icon="warn" title="Workout not found" action={<Button onClick={() => nav('/')}>Back to Today</Button>} /></div>;
  if (s.status === 'cancelled' || s.status === 'skipped' || s.status === 'rescheduled') return <div className="screen no-nav"><Empty icon="info" title={`This workout is ${s.status}`} action={<Button onClick={() => nav('/')}>Back to Today</Button>} /></div>;

  const t = sessionTimes(s, new Date(now).toISOString());
  const doneSets = views.data.reduce((a, v) => a + v.sets.filter((x) => x.status === 'completed' && !x.parent_set_id && x.set_type !== 'warmup').length, 0);
  const totalSets = views.data.reduce((a, v) => (v.se.status === 'skipped' ? a : a + v.sets.filter((x) => !x.parent_set_id && x.set_type !== 'warmup' && x.status !== 'skipped').length), 0);

  return (
    <div className="screen no-nav" style={{ paddingTop: 0 }}>
      <div className="wk-head">
        <div className="row-flex">
          <button className="icon-btn" type="button" aria-label="Back to Today" onClick={() => nav('/')}><Icon name="left" /></button>
          <div className="grow"><div className="strong ellipsis">{s.name.split(' — ')[1] ?? s.name}</div><div className="tiny dim">{doneSets}/{totalSets} sets{s.paused_at ? ' · paused' : ''}</div></div>
          <div className="time num" aria-label="Active time">{fmtClock(t.activeMs)}</div>
          <button className="icon-btn gold" type="button" aria-label={s.paused_at ? 'Resume workout' : 'Pause workout'} onClick={() => void (s.paused_at ? resumeSession(s.id) : pauseSession(s.id))}><Icon name={s.paused_at ? 'play' : 'pause'} /></button>
          <Button small variant="primary" onClick={() => void onFinish()}>Finish</Button>
        </div>
      </div>
      {rest.active && <RestBar rest={rest} />}
      {s.paused_at && <div style={{ marginBottom: 12 }}><Banner tone="warn" icon="pause" action={<Button small onClick={() => void resumeSession(s.id)}>Resume</Button>}>Workout paused — the clock is stopped.</Banner></div>}

      {views.data.length === 0 && <Empty icon="dumbbell" title="Add your first exercise" hint="This is an unplanned workout. Everything you log is saved straight away." action={<Button variant="primary" icon="plus" onClick={() => setPicker('add')}>Add exercise</Button>} />}

      {views.data.map((v) => {
        const isCurrent = target?.seId === v.se.id || (!!v.se.superset_group && views.data?.find((x) => x.se.id === target?.seId)?.se.superset_group === v.se.superset_group && !!v.se.superset_group);
        const expanded = open[v.se.id] ?? (isCurrent || v.se.status === 'in_progress');
        return (
          <ExerciseCard key={v.se.id} v={v} all={views.data ?? []} prevPerf={prev.data?.get(v.se.exercise_id) ?? null} unit={unit} current={!!isCurrent} expanded={expanded && v.se.status !== 'skipped'} onToggle={() => setOpen((o) => ({ ...o, [v.se.id]: !expanded }))}
            targetSetId={target?.setId ?? null} targetRef={targetRef} rpeMode={settings.rpe_mode}
            onMenu={() => setMenu(v)} onDetail={(set) => setDetail({ set, view: v })}
            onLogged={(set) => afterLog(v, set, views.data ?? [])} />
        );
      })}

      {views.data.length > 0 && (
        <div className="col mt-4">
          <Button block icon="plus" onClick={() => setPicker('add')}>Add exercise</Button>
          <div className="field mt-2"><label htmlFor="sess-notes">Workout notes</label><textarea id="sess-notes" className="input" defaultValue={s.notes ?? ''} placeholder="How is it going? Anything to remember?" onBlur={(e) => { if ((e.target.value || null) !== s.notes) void updateSession(s.id, { notes: e.target.value || null }); }} /></div>
        </div>
      )}

      <ExercisePicker open={picker === 'add'} onClose={() => setPicker(null)} title="Add exercise" onPick={async (e) => { try { await addExerciseToSession(id, e.id, 3); ui.toast(`${e.name} added`, { tone: 'ok' }); } catch (er) { ui.toast(errMsg(er), { tone: 'err' }); } }} />

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.exercise.name ?? ''}>
        {menu && (
          <div className="list" style={{ margin: '0 -16px' }}>
            <button className="item" type="button" onClick={() => { setSub(menu); setMenu(null); }}><Icon name="swap" /><div className="grow"><div className="strong">Substitute exercise</div><div className="small dim">Do something else instead — the plan is kept</div></div></button>
            <button className="item" type="button" onClick={() => { setPlate(menu); setMenu(null); }}><Icon name="scale" /><div className="grow"><div className="strong">Plates &amp; warm-up</div></div></button>
            <button className="item" type="button" onClick={() => { setNotesFor(menu); setMenu(null); }}><Icon name="note" /><div className="grow"><div className="strong">Exercise notes</div></div></button>
            <button className="item" type="button" onClick={() => { nav(`/exercises/${menu.exercise.id}`); }}><Icon name="chart" /><div className="grow"><div className="strong">History &amp; records</div></div></button>
            {menu.se.status === 'skipped'
              ? <button className="item" type="button" onClick={() => { void unskipExercise(menu.se.id); setMenu(null); }}><Icon name="undo" /><div className="grow"><div className="strong">Un-skip</div></div></button>
              : <button className="item" type="button" onClick={() => { void skipExercise(menu.se.id, null); setMenu(null); ui.toast('Exercise skipped', { action: { label: 'Undo', run: () => void unskipExercise(menu.se.id) } }); }}><Icon name="skip" /><div className="grow"><div className="strong">Skip this exercise</div><div className="small dim">Kept in the session as skipped</div></div></button>}
            {!menu.sets.some((x) => x.status === 'completed') && menu.se.origin === 'added' && <button className="item" type="button" onClick={() => { void removeExercise(menu.se.id); setMenu(null); ui.toast('Exercise removed', { action: { label: 'Undo', run: () => void restoreExercise(menu.se.id) } }); }}><Icon name="trash" /><div className="grow bad strong">Remove exercise</div></button>}
          </div>
        )}
      </Sheet>

      <Sheet open={!!notesFor} onClose={() => setNotesFor(null)} title="Exercise notes">
        {notesFor && <textarea className="input" aria-label="Exercise notes" defaultValue={notesFor.se.notes ?? ''} placeholder="Seat setting, grip, how it felt…" onBlur={(e) => void updateExerciseNotes(notesFor.se.id, e.target.value || null)} />}
      </Sheet>

      <SetDetailSheet ctx={detail} unit={unit} rpeMode={settings.rpe_mode} onClose={() => setDetail(null)} onChange={async (patch) => { if (detail) await editSet(detail.set.id, patch); }}
        onDuplicate={async () => { if (detail) { await duplicateSet(detail.set.id); setDetail(null); } }}
        onDelete={async () => { if (detail) { const sid = detail.set.id; await deleteSet(sid); setDetail(null); ui.toast('Set deleted', { action: { label: 'Undo', run: () => void restoreSet(sid) } }); } }}
        onUncomplete={async () => { if (detail) { await uncompleteSet(detail.set.id); setDetail(null); } }} />

      {sub && <SubstituteSheet view={sub} sessionScheduled={!!s.template_key} programId={s.program_id} onClose={() => setSub(null)} />}
      <PlateCalc open={!!plate} onClose={() => setPlate(null)} startKg={plate ? (plate.sets.find((x) => x.status === 'planned' && x.set_type !== 'warmup')?.planned_weight_kg ?? plate.sets[0]?.weight_kg ?? null) : null} seId={plate?.se.id} />
      <FinishSheet open={finishOpen} onClose={() => setFinishOpen(false)} sessionId={id} onDone={() => nav(`/workout/${id}/summary`, { replace: true })} />
    </div>
  );

  async function onFinish(): Promise<void> {
    try {
      const c = await sessionCompletion(id);
      if (c.completedSets === 0) {
        const scheduled = !!s?.template_key && !!s.program_id;
        const skip = await ui.confirm({ title: 'No sets logged yet', message: scheduled ? 'Do you want to mark this workout as skipped? It stays in your history, and nothing is counted as zero.' : 'There is nothing to save. Discard this workout?', confirmLabel: scheduled ? 'Mark as skipped' : 'Discard', cancelLabel: 'Keep training', danger: !scheduled });
        if (!skip) return;
        if (scheduled && s?.program_id && s.template_key) await skipScheduled(s.program_id, s.template_key, s.scheduled_date ?? s.session_date, 'No sets logged'); else await discardSession(id);
        nav('/', { replace: true });
        return;
      }
      setFinishOpen(true);
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
}

function RestBar({ rest }: { rest: RestTimer }) {
  return (
    <div className={`rest-bar${rest.finished ? ' done' : ''}`} role="timer" aria-live="off">
      <Icon name="timer" size={26} />
      <div className="grow"><div className="t num">{rest.finished ? 'Go!' : formatDuration(rest.remaining)}</div><div className="tiny ellipsis" style={{ opacity: 0.85 }}>{rest.label ? `Next: ${rest.label}` : 'Rest'}</div></div>
      <Button small onClick={() => rest.adjust(-15)} aria-label="Minus 15 seconds">−15</Button>
      <Button small onClick={() => rest.adjust(15)} aria-label="Plus 15 seconds">+15</Button>
      <Button small onClick={rest.stop}>{rest.finished ? 'Done' : 'Skip'}</Button>
    </div>
  );
}

function prescription(v: SessionExerciseView, unit: 'kg' | 'lb'): string[] {
  const p = v.se.planned;
  if (!p) return [];
  const out: string[] = [];
  out.push(`${p.sets} × ${p.reps_min === p.reps_max || p.reps_max === null ? (p.reps_min ?? '—') : `${p.reps_min}-${p.reps_max}`}`);
  if (p.rir_target !== null) out.push(`RIR ${p.rir_target}${p.rir_last_only ? ' (last)' : ''}`);
  if (p.tempo) out.push(`Tempo ${p.tempo}`);
  if (p.rest_max_s) out.push(`Rest ${p.rest_min_s !== p.rest_max_s ? `${formatDuration(p.rest_min_s)}–${formatDuration(p.rest_max_s)}` : formatDuration(p.rest_max_s)}${p.rest_mode === 'after_pair' ? ' after pair' : ''}`);
  if (p.start_load_kg !== null) out.push(`${formatWeight(p.start_load_kg, unit)} start`); else if (p.load_note) out.push(p.load_note);
  return out;
}

function ExerciseCard({ v, all, prevPerf, unit, current, expanded, onToggle, targetSetId, targetRef, rpeMode, onMenu, onDetail, onLogged }: {
  v: SessionExerciseView; all: SessionExerciseView[]; prevPerf: Awaited<ReturnType<typeof lastPerformance>>; unit: 'kg' | 'lb'; current: boolean; expanded: boolean; onToggle: () => void;
  targetSetId: string | null; targetRef: React.MutableRefObject<HTMLDivElement | null>; rpeMode: 'rir' | 'rpe' | 'both' | 'none'; onMenu: () => void; onDetail: (s: SetRecord) => void; onLogged: (s: SetRecord) => void;
}) {
  const ui = useUi();
  const cols = colsFor(v.exercise);
  const p = v.se.planned;
  const parents = v.sets.filter((x) => !x.parent_set_id);
  const working = parents.filter((x) => x.set_type !== 'warmup');
  const lastWorking = working[working.length - 1];
  const tech = techniqueFor(p?.technique_code);
  const done = working.filter((x) => x.status === 'completed').length;
  const partner = v.se.superset_group ? all.filter((x) => x.se.superset_group === v.se.superset_group).length >= 2 : false;
  const subbed = v.se.origin === 'substituted';
  const prevSets = prevPerf?.sets ?? [];
  const muscle = v.se.planned?.muscle_label ?? (v.exercise.primary_muscles[0] ? MUSCLES[v.exercise.primary_muscles[0]]?.label : null);

  return (
    <div className={`ex-card${current ? ' current' : ''}${v.se.status === 'skipped' ? ' skipped' : ''}`}>
      <div className="hd">
        <button type="button" className="row-flex grow" style={{ background: 'none', border: 0, textAlign: 'left', color: 'inherit', padding: 0, minWidth: 0 }} onClick={onToggle} aria-expanded={expanded}>
          <span className="lab">{v.se.label ?? '•'}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="strong ellipsis">{v.exercise.name}</div>
            <div className="tiny dim ellipsis">{muscle}{partner ? ' · superset' : ''}{subbed ? ' · substituted' : ''}{v.se.origin === 'added' ? ' · added' : ''}</div>
          </div>
          {v.se.status === 'skipped' ? <span className="badge bad">Skipped</span> : <span className="badge dim num">{done}/{working.filter((x) => x.status !== 'skipped').length}</span>}
          <Icon name={expanded ? 'up' : 'down'} size={20} className="chev" />
        </button>
        <button type="button" className="icon-btn" aria-label={`${v.exercise.name} options`} onClick={onMenu}><Icon name="kebab" /></button>
      </div>
      {subbed && p && <div className="prev-line">Planned: <span className="gold">{p.sets}×{p.reps_min}-{p.reps_max}</span> — substituted for today. Original plan unchanged.</div>}
      {expanded && (
        <>
          {p && <div className="rx">{prescription(v, unit).map((x) => <span key={x} className="pill">{x}</span>)}{p.technique_text && <span className="pill tech">Last set: {p.technique_text}</span>}</div>}
          {p?.cue && <div className="prev-line">{p.cue}</div>}
          {prevSets.length > 0 && <div className="prev-line">Last time ({prevPerf?.date}): {prevSets.map((x) => (cols.aKind === 'weight' && x.weight_kg !== null ? `${toDisplayWeight(x.weight_kg, unit)}×${x.reps ?? '?'}` : x.reps ?? x.duration_s ?? '—')).join(', ')}</div>}
          {v.se.notes && <div className="prev-line">Note: {v.se.notes}</div>}
          <div className="sets">
            <div className="set-h"><span className="center">Set</span><span>Previous</span><span className="center">{cols.aLabel ? (cols.aKind === 'weight' ? `${cols.aLabel} (${unit})` : cols.aLabel) : ''}</span><span className="center">{cols.bLabel}</span><span className="center">{rpeMode === 'none' ? '' : rpeMode === 'rpe' ? 'RPE' : 'RIR'}</span><span className="center">✓</span></div>
            {parents.map((st, idx) => {
              const comps = v.sets.filter((c) => c.parent_set_id === st.id);
              const isLastWorking = st.id === lastWorking?.id;
              const wIdx = working.findIndex((x) => x.id === st.id);
              const prevSet = st.set_type === 'warmup' ? undefined : prevSets[Math.min(Math.max(wIdx, 0), Math.max(prevSets.length - 1, 0))];
              return (
                <div key={st.id}>
                  <div ref={targetSetId === st.id ? targetRef : undefined}>
                    <SetRow set={st} cols={cols} unit={unit} prev={prevSet} next={targetSetId === st.id} rpeMode={rpeMode} label={st.set_type === 'warmup' ? 'W' : String(wIdx + 1)} onDetail={() => onDetail(st)} onLogged={onLogged} />
                  </div>
                  {comps.map((c) => <div key={c.id} ref={targetSetId === c.id ? targetRef : undefined}><SetRow set={c} cols={cols} unit={unit} prev={undefined} next={targetSetId === c.id} rpeMode={rpeMode} label={c.set_type === 'drop' ? 'Drop' : c.set_type === 'rest_pause' ? 'RP' : c.set_type === 'myo' ? 'Myo' : c.set_type === 'negative' ? 'Neg' : '+'} comp onDetail={() => onDetail(c)} onLogged={onLogged} /></div>)}
                  {isLastWorking && tech && st.status !== 'skipped' && (
                    <div className="tech-box">
                      <div className="strong gold">{tech.label}</div>
                      <div className="mt-1 dim">{tech.guidance}</div>
                      {tech.component && comps.length < tech.component.max && st.status === 'completed' && (() => { const nc = nextComponent(p?.technique_code, st, comps.length); return nc ? <Button small variant="soft" className="mt-2" icon="plus" onClick={() => void addComponentSet(st.id).catch((e) => ui.toast(errMsg(e), { tone: 'err' }))}>Add {nc.label.toLowerCase()}{nc.weight_kg !== null ? ` · ${formatWeight(nc.weight_kg, unit)}` : ''}{nc.rest_s ? ` · rest ${nc.rest_s}s` : ''}</Button> : null; })()}
                      {(tech.partialReps || tech.cheatReps) && <div className="small mt-2 dim">Log {tech.partialReps ? 'partial reps' : 'cheat reps'} in the set's details (tap ⋯ on the set).</div>}
                      {tech.component && st.status !== 'completed' && <div className="small mt-2 dim">Finish this set first, then add the next step here.</div>}
                    </div>
                  )}
                  {idx === parents.length - 1 && null}
                </div>
              );
            })}
            <div className="row-flex mt-2" style={{ paddingLeft: 4 }}>
              <Button small variant="ghost" icon="plus" onClick={() => void addSet(v.se.id).catch((e) => ui.toast(errMsg(e), { tone: 'err' }))}>Add set</Button>
              <Button small variant="ghost" icon="scale" onClick={() => void addSet(v.se.id, 'warmup', { planned_weight_kg: null }).catch(() => undefined)}>Warm-up set</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SetRow({ set, cols, unit, prev, next, comp, label, rpeMode, onDetail, onLogged }: {
  set: SetRecord; cols: ColSpec; unit: 'kg' | 'lb'; prev: SetRecord | undefined; next: boolean; comp?: boolean; label: string; rpeMode: 'rir' | 'rpe' | 'both' | 'none'; onDetail: () => void; onLogged: (s: SetRecord) => void;
}) {
  const ui = useUi();
  const completed = set.status === 'completed';
  const skipped = set.status === 'skipped';
  const aVal = cols.aField ? (set[cols.aField] as number | null) : null;
  const [a, setA] = useState(toA(aVal, cols.aKind, unit));
  const [b, setB] = useState(toB(set[cols.bField] as number | null, cols.bKind));
  const [x, setX] = useState(set.rir === null && rpeMode !== 'rpe' ? '' : String((rpeMode === 'rpe' ? set.rpe : set.rir) ?? ''));
  const timer = useRef<number | undefined>(undefined);
  // keep inputs in sync when the stored set changes underneath (undo, sync, correction)
  const rowRef = useRef<HTMLDivElement | null>(null);
  const lastStatus = useRef(set.status);
  useEffect(() => { const statusChanged = lastStatus.current !== set.status; lastStatus.current = set.status; if (!statusChanged && rowRef.current?.contains(document.activeElement)) return; /* never overwrite what the user is typing */ setA(toA(cols.aField ? (set[cols.aField] as number | null) : null, cols.aKind, unit)); setB(toB(set[cols.bField] as number | null, cols.bKind)); setX(String((rpeMode === 'rpe' ? set.rpe : set.rir) ?? '')); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.id, set.status, set.client_updated_at, unit]);

  const phA = cols.aKind === 'weight' ? (set.planned_weight_kg ?? prev?.weight_kg ?? null) : null;
  const phAText = phA === null ? '' : toA(phA, 'weight', unit);
  const phB = prev ? toB(prev[cols.bField] as number | null, cols.bKind) : '';
  const prevText = !prev ? '—' : cols.aKind === 'weight' && prev.weight_kg !== null ? `${toDisplayWeight(prev.weight_kg, unit)} × ${prev.reps ?? '?'}` : String(prev.reps ?? prev.duration_s ?? '—');

  const buildPatch = (): Partial<SetRecord> => {
    const patch: Partial<SetRecord> = {};
    if (cols.aField) (patch as Record<string, unknown>)[cols.aField] = fromA(a, cols.aKind, unit);
    (patch as Record<string, unknown>)[cols.bField] = fromB(b, cols.bKind);
    if (rpeMode !== 'none') { const n = parseNumber(x); if (rpeMode === 'rpe') patch.rpe = n; else patch.rir = n; }
    return patch;
  };
  // The debounced save must read the *latest* typed values (not the render that scheduled it) and must not be lost on blur/unmount.
  const latest = useRef({ build: buildPatch, completed });
  latest.current = { build: buildPatch, completed };
  const pending = useRef(false);
  const saveDraft = (): void => { window.clearTimeout(timer.current); if (!pending.current) return; pending.current = false; if (!latest.current.completed) void editSet(set.id, latest.current.build()).catch(() => undefined); };
  const draft = (): void => { pending.current = true; window.clearTimeout(timer.current); timer.current = window.setTimeout(saveDraft, 450); };
  const flush = useRef(saveDraft); flush.current = saveDraft;
  useEffect(() => () => flush.current(), []);

  async function toggle(): Promise<void> {
    try {
      if (completed) {
        await uncompleteSet(set.id);
        ui.toast('Set marked not done', { action: { label: 'Redo', run: () => void logSet(set.id, buildPatch()) } });
        return;
      }
      const patch = buildPatch();
      if (cols.aField && (patch as Record<string, unknown>)[cols.aField] === null && phA !== null) (patch as Record<string, unknown>)[cols.aField] = phA; // one tap = same load as planned / last time
      if ((patch as Record<string, unknown>)[cols.bField] === null && phB) (patch as Record<string, unknown>)[cols.bField] = fromB(phB, cols.bKind);
      if ((patch as Record<string, unknown>)[cols.bField] === null) { ui.toast(cols.bField === 'reps' ? 'Enter the reps you did' : 'Enter the time', { tone: 'err' }); return; }
      const saved = await logSet(set.id, patch);
      void import('@/services/platform').then((m) => m.haptic('light'));
      onLogged(saved);
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  const blur = (): void => { if (!completed) { saveDraft(); return; } if (completed) { const patch = buildPatch(); const changed = Object.entries(patch).some(([k, val]) => (set as unknown as Record<string, unknown>)[k] !== val); if (changed) void editSet(set.id, patch).catch((e) => ui.toast(errMsg(e), { tone: 'err' })); } };
  const aria = (f: Field): string => `Set ${label} ${f === 'weight' ? cols.aLabel ?? '' : cols.bLabel}`;
  const hasA = cols.aField !== null;

  return (
    <div ref={rowRef} className={`set-r${comp ? ' comp' : ''}${next ? ' next' : ''}${completed ? ' done' : ''}${skipped ? ' skipped' : ''}`} data-testid={`set-${set.id}`}>
      <button type="button" className="n" style={{ background: 'none', border: 0 }} onClick={onDetail} aria-label={`Set ${label} details`}>{label}</button>
      <span className="prev num">{comp ? <span className="tiny dim">linked</span> : prevText}</span>
      {hasA ? <input inputMode="decimal" aria-label={aria('weight')} placeholder={phAText} value={a} onChange={(e) => { setA(e.target.value); draft(); }} onBlur={blur} /> : <span />}
      <input inputMode={cols.bKind === 'int' ? 'numeric' : 'decimal'} aria-label={aria('reps')} placeholder={phB} value={b} onChange={(e) => { setB(e.target.value); draft(); }} onBlur={blur} />
      {rpeMode !== 'none' ? <input inputMode="decimal" aria-label={`Set ${label} ${rpeMode === 'rpe' ? 'RPE' : 'RIR'}`} placeholder={rpeMode === 'rpe' ? '' : set.planned_rir !== null ? String(set.planned_rir) : ''} value={x} onChange={(e) => { setX(e.target.value); draft(); }} onBlur={blur} /> : <span />}
      <button type="button" className={`done-btn${completed ? ' on' : ''}`} aria-label={completed ? `Undo set ${label}` : `Complete set ${label}`} aria-pressed={completed} onClick={() => void toggle()}><Icon name="check" /></button>
    </div>
  );
}

const SET_TYPES: { value: SetType; label: string }[] = [{ value: 'working', label: 'Working' }, { value: 'warmup', label: 'Warm-up' }, { value: 'backoff', label: 'Back-off' }, { value: 'amrap', label: 'AMRAP' }, { value: 'cluster', label: 'Cluster' }];

function SetDetailSheet({ ctx, unit, rpeMode, onClose, onChange, onDuplicate, onDelete, onUncomplete }: {
  ctx: { set: SetRecord; view: SessionExerciseView } | null; unit: 'kg' | 'lb'; rpeMode: 'rir' | 'rpe' | 'both' | 'none'; onClose: () => void;
  onChange: (p: Partial<SetRecord>) => Promise<void>; onDuplicate: () => Promise<void>; onDelete: () => Promise<void>; onUncomplete: () => Promise<void>;
}) {
  const ui = useUi();
  const live = useLive(async () => (ctx ? (await sessionExercises(ctx.set.session_id)).flatMap((v) => v.sets).find((x) => x.id === ctx.set.id) ?? null : null), [ctx?.set.id]);
  const set = live.data ?? ctx?.set;
  const save = async (p: Partial<SetRecord>): Promise<void> => { try { await onChange(p); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } };
  if (!ctx || !set) return <Sheet open={false} onClose={onClose} title="" children={null} />;
  const tech = techniqueFor(ctx.view.se.planned?.technique_code);
  const numField = (label: string, field: keyof SetRecord, hint?: string) => (
    <div className="field"><label htmlFor={`d-${field}`}>{label}</label><input id={`d-${field}`} className="input" inputMode="decimal" defaultValue={set[field] === null || set[field] === undefined ? '' : String(set[field])} onBlur={(e) => void save({ [field]: parseNumber(e.target.value) } as Partial<SetRecord>)} />{hint && <span className="tiny dim">{hint}</span>}</div>
  );
  return (
    <Sheet open onClose={onClose} title={`${ctx.view.exercise.name} · set ${set.set_number}`}>
      <div className="col">
        <div className="field"><span className="label">Set type</span><div className="chips wrap">{SET_TYPES.map((t) => <Chip key={t.value} on={set.set_type === t.value} onClick={() => void save({ set_type: t.value })}>{t.label}</Chip>)}</div></div>
        {ctx.view.exercise.laterality !== 'bilateral' && <div className="field"><span className="label">Side</span><Seg value={set.side} onChange={(v) => void save({ side: v })} options={[{ value: 'both', label: 'Both' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} label="Side" /></div>}
        <div className="field"><span className="label">Failure</span><Seg value={set.failure ?? 'none'} onChange={(v) => void save({ failure: v })} options={[{ value: 'none', label: 'None' }, { value: 'technical', label: 'Technical' }, { value: 'muscular', label: 'Muscular' }]} label="Failure" /></div>
        <div className="row-flex">
          {rpeMode !== 'rpe' && <div className="grow">{numField('RIR', 'rir')}</div>}
          {rpeMode !== 'rir' && <div className="grow">{numField('RPE (1–10)', 'rpe')}</div>}
        </div>
        <div className="row-flex">
          <div className="grow">{numField('Partial reps', 'reps_partial', tech?.partialReps ? 'Stretch-position half reps' : undefined)}</div>
          <div className="grow">{numField('Cheat / assisted reps', 'reps_assisted', tech?.cheatReps ? 'Slow negatives after strict reps' : undefined)}</div>
        </div>
        <div className="field"><label htmlFor="d-tempo">Tempo (e.g. 3-1-1)</label><input id="d-tempo" className="input" defaultValue={set.tempo ?? ''} onBlur={(e) => void save({ tempo: e.target.value.trim() || null })} /></div>
        <div className="row-flex">
          <div className="grow">{numField('Eccentric (s)', 'eccentric_s')}</div><div className="grow">{numField('Pause bottom (s)', 'pause_bottom_s')}</div><div className="grow">{numField('Concentric (s)', 'concentric_s')}</div>
        </div>
        <div className="field"><span className="label">Range of motion</span><Seg value={set.rom ?? 'full'} onChange={(v) => void save({ rom: v })} options={[{ value: 'full', label: 'Full' }, { value: 'partial', label: 'Partial' }, { value: 'custom', label: 'Custom' }]} label="Range of motion" /></div>
        <div className="field"><label htmlFor="d-note">Set note</label><textarea id="d-note" className="input" defaultValue={set.note ?? ''} onBlur={(e) => void save({ note: e.target.value || null })} /></div>
        <div className="small dim">Planned: {set.planned_weight_kg !== null ? formatWeight(set.planned_weight_kg, unit) : '—'} × {set.planned_reps_min ?? '—'}{set.planned_reps_max && set.planned_reps_max !== set.planned_reps_min ? `-${set.planned_reps_max}` : ''}. Planned values are never changed by logging.</div>
        <div className="row-flex wrap">
          {set.status === 'completed' && <Button small onClick={() => void onUncomplete()}>Mark not done</Button>}
          <Button small icon="copy" onClick={() => void onDuplicate()}>Duplicate</Button>
          <Button small variant="danger" icon="trash" onClick={() => void onDelete()}>Delete</Button>
        </div>
      </div>
    </Sheet>
  );
}

function SubstituteSheet({ view, sessionScheduled, programId, onClose }: { view: SessionExerciseView; sessionScheduled: boolean; programId: string | null; onClose: () => void }) {
  const ui = useUi();
  const [picked, setPicked] = useState<Exercise | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [scope, setScope] = useState<'session' | 'future'>('session');
  const [pickOpen, setPickOpen] = useState(true);
  const [scopeOpen, setScopeOpen] = useState(false);
  const canFuture = sessionScheduled && !!programId && !!view.se.plan_key;
  const REASONS = ['Machine busy', 'No equipment', 'Pain / discomfort', 'Preference', 'Other'];
  const logged = view.sets.some((x) => x.status === 'completed');

  async function apply(): Promise<void> {
    if (!picked) return;
    try {
      await substituteExercise(view.se.id, picked.id, scope, reason ?? undefined);
      ui.toast(`Swapped to ${picked.name}`, { tone: 'ok' });
      if (scope === 'future') setScopeOpen(true); else onClose();
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  if (logged) return <Sheet open onClose={onClose} title="Can't substitute"><p className="dim">Sets are already logged for this exercise. Add the other exercise as a new one instead — your logged sets stay where they are.</p></Sheet>;
  return (
    <>
      <ExercisePicker open={pickOpen && !picked} onClose={() => { setPickOpen(false); if (!picked) onClose(); }} title={`Replace ${view.exercise.name}`} replacing={view.exercise} excludeIds={[view.exercise.id]} onPick={(e) => setPicked(e)} />
      <Sheet open={!!picked && !scopeOpen} onClose={onClose} title="Substitute" footer={<Button block variant="primary" onClick={() => void apply()}>Swap exercise</Button>}>
        {picked && (
          <div className="col">
            <div className="card blue"><div className="small dim">Planned</div><div className="strong">{view.exercise.name}</div><div className="small dim mt-2">Doing instead</div><div className="strong gold">{picked.name}</div></div>
            <Banner icon="info">The original prescription is kept. {picked.name} is tracked as its own exercise — loads are not assumed to be equivalent.</Banner>
            <div className="field"><span className="label">Why? (optional)</span><div className="chips wrap">{REASONS.map((r) => <Chip key={r} on={reason === r} onClick={() => setReason(reason === r ? null : r)}>{r}</Chip>)}</div></div>
            <div className="field"><span className="label">Apply to</span>
              <Seg value={scope} onChange={setScope} label="Substitution scope" options={[{ value: 'session', label: "Today only" }, ...(canFuture ? [{ value: 'future' as const, label: 'Future sessions too' }] : [])]} /></div>
          </div>
        )}
      </Sheet>
      {scopeOpen && picked && programId && view.se.plan_key && (
        <EditScopeSheet open onClose={onClose} programId={programId} scopes={['exercise_future', 'day_future']} initialScope="exercise_future" description={`Replace ${view.se.planned ? view.exercise.name : 'exercise'} with ${picked.name}`} edits={[{ kind: 'replace_exercise', plan_key: view.se.plan_key, exercise_id: picked.id }]} onApplied={() => undefined} />
      )}
    </>
  );
}

const TAGS = ['high-energy', 'low-energy', 'travel', 'deload', 'return-from-break'];

function FinishSheet({ open, onClose, sessionId, onDone }: { open: boolean; onClose: () => void; sessionId: string; onDone: () => void }) {
  const ui = useUi();
  const comp = useLive(() => (open ? sessionCompletion(sessionId) : Promise.resolve(null)), [open, sessionId]);
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const c = comp.data;
  async function save(): Promise<void> {
    setBusy(true);
    try { await finishSession(sessionId, { session_rpe: rpe, notes: notes || undefined, tags }); onDone(); }
    catch (e) { ui.toast(e instanceof NothingLoggedError ? 'Log at least one set first.' : errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Finish workout" footer={<Button block variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save workout'}</Button>}>
      <div className="col">
        {c && (
          <div className="card blue">
            <div className="row-flex between"><span>{plural(c.completedSets, 'set')} logged</span>{c.completionPct !== null && <span className={c.completionPct >= 1 ? 'ok strong' : 'warn strong'}>{Math.round(c.completionPct * 100)}% of plan</span>}</div>
            <div className="small dim mt-1">{c.status === 'partial' ? 'Some planned work is not done. You can still save — it is recorded as partial and nothing is lost.' : c.modifications.length ? `Completed with changes: ${c.modifications.join(', ')}.` : 'Completed as planned.'}</div>
          </div>
        )}
        <div className="field"><span className="label">How hard was the session? (RPE 1–10, optional)</span><div className="chips wrap">{[5, 6, 7, 8, 9, 10].map((n) => <Chip key={n} on={rpe === n} onClick={() => setRpe(rpe === n ? null : n)}>{n}</Chip>)}</div></div>
        <div className="field"><span className="label">Tags</span><div className="chips wrap">{TAGS.map((t) => <Chip key={t} on={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</Chip>)}</div></div>
        <div className="field"><label htmlFor="fin-notes">Notes</label><textarea id="fin-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Energy, sleep, pump, anything to remember" /></div>
      </div>
    </Sheet>
  );
}
void planProgramEdit;
