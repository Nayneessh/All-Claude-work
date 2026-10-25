import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Exercise, ExerciseCategory, Laterality, LoadMode, MovementPattern, ResistanceType, TrackingMethod } from '@/domain/types';
import { archiveExercise, blankExercise, createExercise, duplicateExercise, listExercises, restoreExercise, updateExercise, type ExerciseDraft } from '@/data/repo/exercises';
import { exerciseInsight } from '@/data/repo/history';
import { suggestSubstitutes } from '@/domain/substitutes';
import { GROUP_LABELS, GROUP_ORDER, MUSCLES, muscleLabel, type MuscleGroup } from '@/domain/muscles';
import { PR_LABELS, currentBests } from '@/domain/records';
import { formatWeight } from '@/domain/units';
import { addDays, parseDate } from '@/domain/periods';
import { Badge, Banner, Button, Card, Chip, Empty, Field, Loading, Seg, Section, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { LineChart } from '@/ui/charts';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, errMsg, plural } from '@/ui/format';
import { ExercisePicker } from './shared/ExercisePicker';

const SIGNAL_TEXT: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'dim' | 'bad' }> = {
  insufficient_data: { label: 'Not enough data yet', tone: 'dim' }, improving: { label: 'Improving', tone: 'ok' }, plateau: { label: 'Plateau', tone: 'warn' }, regressing: { label: 'Trending down', tone: 'bad' },
  possible_fatigue: { label: 'Possible fatigue', tone: 'warn' }, inconsistent: { label: 'Inconsistent', tone: 'info' }, steady: { label: 'Steady', tone: 'info' },
};

export function Exercises() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<MuscleGroup | undefined>();
  const [equipment, setEquipment] = useState<string | undefined>();
  const [archived, setArchived] = useState(false);
  const [custom, setCustom] = useState(false);
  const list = useLive(() => listExercises({ q, group, equipment, includeArchived: archived, onlyCustom: custom }), [q, group, equipment, archived, custom]);
  const equipments = useLive(async () => [...new Set((await listExercises({ includeArchived: true })).map((e) => e.equipment))].sort(), []);
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Exercises</h1><Button small variant="primary" icon="plus" onClick={() => nav('/exercises/new')}>New</Button></div>
      <input className="input" type="search" placeholder="Search name, muscle, equipment" aria-label="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips mt-3">{GROUP_ORDER.map((g) => <Chip key={g} on={group === g} onClick={() => setGroup(group === g ? undefined : g)}>{GROUP_LABELS[g]}</Chip>)}</div>
      <div className="chips mt-2">{(equipments.data ?? []).map((e) => <Chip key={e} on={equipment === e} onClick={() => setEquipment(equipment === e ? undefined : e)}>{e}</Chip>)}<Chip on={custom} onClick={() => setCustom(!custom)}>Custom</Chip><Chip on={archived} onClick={() => setArchived(!archived)}>Archived</Chip></div>
      {list.loading ? <div className="mt-4"><Loading /></div> : (
        <Card className="mt-4 pad-0"><div className="list">
          {list.data?.map((e) => (
            <button key={e.id} className="item" type="button" onClick={() => nav(`/exercises/${e.id}`)}>
              <div className="grow"><div className="strong">{e.name}</div><div className="small dim">{e.primary_muscles.slice(0, 2).map(muscleLabel).join(' · ') || e.category} · {e.equipment}</div></div>
              {e.archived_at && <Badge tone="dim">archived</Badge>}{e.is_custom && <Badge>custom</Badge>}<Icon name="right" className="chev" size={20} />
            </button>
          ))}
          {list.data?.length === 0 && <Empty icon="search" title="No exercises match" hint="Create your own with the New button." />}
        </div></Card>
      )}
      <p className="tiny dim center mt-3">{plural(list.data?.length ?? 0, 'exercise')}</p>
    </div>
  );
}

export function ExerciseDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const { today, unit } = useApp();
  const ins = useLive(() => exerciseInsight(id, today), [id, today]);
  const all = useLive(() => listExercises({ includeArchived: true }), []);
  const hist = useLive(async () => { const { exerciseSets } = await import('@/data/repo/history'); const sets = await exerciseSets(id); return sets.filter((s) => s.status === 'completed' && !s.parent_set_id && s.set_type !== 'warmup'); }, [id]);
  if (ins.loading) return <div className="screen"><Loading /></div>;
  if (!ins.data) return <div className="screen"><Empty icon="warn" title="Exercise not found" action={<Button onClick={() => nav('/exercises')}>Back</Button>} /></div>;
  const { exercise: e, prs, perfs, assessment, bestE1rm } = ins.data;
  const bests = currentBests(prs);
  const subs = suggestSubstitutes(e, all.data ?? [], 5);
  const comp = perfs.filter((p) => p.score !== null);
  const t0 = comp.length ? parseDate(comp[0]!.date) : 0;
  const pts = comp.map((p) => ({ x: Math.round((parseDate(p.date) - t0) / 86_400_000), y: p.score as number, label: `${fmtDate(p.date)} · ${e.tracking_method === 'weight_reps' ? formatWeight(p.score, unit) : Math.round(p.score as number)}`, marker: prs.some((r) => r.session_id === p.session_id && !r.is_baseline && (r.type === 'best_e1rm' || r.type === 'max_reps' || r.type === 'longest_duration')) }));
  const xTicks = comp.length ? [0, Math.round(pts[pts.length - 1]!.x / 2), pts[pts.length - 1]!.x].filter((v, i, a) => a.indexOf(v) === i).map((x) => ({ x, label: fmtDate(addDays(comp[0]!.date, x), { weekday: false }) })) : [];
  const sig = SIGNAL_TEXT[assessment.signal] ?? SIGNAL_TEXT.steady!;
  async function archive(): Promise<void> { if (await ui.confirm({ title: `Archive ${e.name}?`, message: 'It disappears from pickers but every past workout keeps it. You can restore it any time.', confirmLabel: 'Archive' })) { await archiveExercise(e.id); ui.toast('Archived'); } }

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><div className="grow"><div className="eyebrow">{e.category} · {e.equipment}</div><h1>{e.name}</h1></div></div>
      <div className="chips wrap">{e.primary_muscles.map((m) => <Badge key={m}>{muscleLabel(m)}</Badge>)}{e.secondary_muscles.map((m) => <Badge key={m} tone="dim">{muscleLabel(m)}</Badge>)}{e.archived_at && <Badge tone="warn">archived</Badge>}</div>
      <Card className="mt-3">
        <div className="kpis"><div className="kpi"><div className="v">{bestE1rm !== null ? formatWeight(bestE1rm, unit, false) : '—'}</div><div className="l">best estimated 1RM ({unit})</div></div><div className="kpi"><div className="v">{plural(comp.length, 'session')}</div><div className="l">with data</div></div></div>
        <div className="row-flex between mt-3"><span className="small dim">Trend</span><Badge tone={sig.tone}>{sig.label}</Badge></div>
        {assessment.reasons.map((r) => <p key={r} className="small mt-1 dim">{r}</p>)}
      </Card>
      <Section title={e.tracking_method === 'weight_reps' ? 'Estimated 1RM over time' : 'Best performance over time'}>
        <Card className="blue">{pts.length >= 2 ? <LineChart ariaLabel={`${e.name} progress`} series={[{ name: 'Progress', points: pts }]} xTicks={xTicks} yFormat={(n) => (e.tracking_method === 'weight_reps' ? String(Math.round(n)) : String(Math.round(n)))} /> : <Empty icon="chart" title="Not enough history yet" hint="Log this exercise in at least 2 sessions to see a trend. Gold dots are records." />}</Card>
        <p className="tiny dim mt-2">Estimates use the Epley formula by default (change it in Settings). Warm-ups and sets over 12 reps are ignored.</p>
      </Section>
      <Section title="Personal records">
        {bests.size === 0 ? <Card><p className="dim small">Records appear once you've logged this exercise.</p></Card> : (
          <Card className="pad-0"><div className="list">{[...bests.values()].map((r) => <div key={r.type} className="item"><div className="grow"><div className="strong">{PR_LABELS[r.type]}{r.estimated ? ' (estimated)' : ''}</div><div className="small dim">{fmtDate(r.date, { year: true })}{r.improvement_pct !== null ? ` · +${r.improvement_pct.toFixed(1)}% over previous` : r.is_baseline ? ' · first logged' : ''}</div></div><div className="num strong gold">{['max_weight', 'best_e1rm', 'actual_1rm'].includes(r.type) ? formatWeight(r.value, unit) : r.type === 'max_set_volume' ? formatWeight(r.value, unit) : r.type === 'best_pace' ? `${(r.value * 3.6).toFixed(1)} km/h` : Math.round(r.value)}</div></div>)}</div></Card>
        )}
      </Section>
      <Section title="Recent sets">
        {(hist.data?.length ?? 0) === 0 ? <Card><p className="dim small">No logged sets yet.</p></Card> : <Card className="pad-0"><div className="list">{[...(hist.data ?? [])].sort((a, b) => (a.session_date < b.session_date ? 1 : -1)).slice(0, 12).map((s) => <button key={s.id} className="item" type="button" onClick={() => nav(`/history/${s.session_id}`)}><span className="gold strong" style={{ minWidth: 70 }}>{fmtDate(s.session_date)}</span><span className="grow num">{s.weight_kg !== null ? `${formatWeight(s.weight_kg, unit, false)} × ${s.reps ?? '?'}` : s.reps ?? s.duration_s ?? '—'}</span>{s.rir !== null && <span className="small dim">RIR {s.rir}</span>}</button>)}</div></Card>}
      </Section>
      {(e.technique || e.cues) && <Section title="Technique">{e.cues && <Card className="mb-3"><div className="eyebrow">Cue</div><p className="mt-1">{e.cues}</p></Card>}{e.technique && <Card className="mt-3"><p>{e.technique}</p></Card>}</Section>}
      <Section title="Alternatives">
        <Card className="pad-0"><div className="list">{subs.map((s) => <button key={s.exercise.id} className="item" type="button" onClick={() => nav(`/exercises/${s.exercise.id}`)}><div className="grow"><div className="strong">{s.exercise.name}</div><div className="small dim">{s.reasons.slice(0, 2).join(' · ')}</div></div><Icon name="right" className="chev" size={20} /></button>)}{subs.length === 0 && <div className="item dim">No alternatives found.</div>}</div></Card>
        <p className="tiny dim mt-2">Substitutes are tracked as their own exercise — loads are never assumed to be equivalent.</p>
      </Section>
      <div className="col mt-5">
        {e.is_custom ? <Button block icon="edit" onClick={() => nav(`/exercises/${e.id}/edit`)}>Edit exercise</Button> : <Banner icon="info">Built-in exercise. Duplicate it to customise.</Banner>}
        <Button block icon="copy" onClick={async () => { const c = await duplicateExercise(e.id); nav(`/exercises/${c.id}/edit`); }}>Duplicate as custom</Button>
        {e.is_custom && (e.archived_at ? <Button block onClick={async () => { await restoreExercise(e.id); ui.toast('Restored', { tone: 'ok' }); }}>Restore</Button> : <Button block variant="danger" onClick={() => void archive()}>Archive</Button>)}
      </div>
    </div>
  );
}

const TRACK: { v: TrackingMethod; label: string; hint: string }[] = [
  { v: 'weight_reps', label: 'Weight × reps', hint: 'Barbells, dumbbells, machines, cables' }, { v: 'bodyweight_reps', label: 'Bodyweight reps', hint: 'Pull-ups, push-ups (optionally added weight)' },
  { v: 'assisted_reps', label: 'Assisted reps', hint: 'Assisted pull-up machine' }, { v: 'duration', label: 'Time / hold', hint: 'Planks, stretches, MMA, yoga' },
  { v: 'weight_duration', label: 'Weight × time', hint: "Farmer's walk, sled" }, { v: 'distance', label: 'Distance', hint: 'Walking, swimming' }, { v: 'distance_duration', label: 'Distance + time', hint: 'Running, cycling, rowing (pace)' },
];
const CATS: ExerciseCategory[] = ['compound', 'isolation', 'cardio', 'mobility', 'stretching', 'isometric', 'sport', 'conditioning'];
const PATTERNS: MovementPattern[] = ['push', 'pull', 'squat', 'hinge', 'lunge', 'carry', 'rotation', 'flexion', 'extension', 'gait', 'other'];
const EQUIP = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'band', 'kettlebell', 'ezbar', 'smith', 'other', 'none'];

export function ExerciseForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const existing = useLive(async () => (id ? (await listExercises({ includeArchived: true })).find((e) => e.id === id) ?? null : null), [id]);
  if (id && existing.loading) return <div className="screen"><Loading /></div>;
  return <Form key={id ?? 'new'} initial={existing.data ?? undefined} onDone={(e) => nav(`/exercises/${e.id}`, { replace: true })} onCancel={() => nav(-1)} toast={ui.toast} />;
}

function Form({ initial, onDone, onCancel, toast }: { initial?: Exercise; onDone: (e: Exercise) => void; onCancel: () => void; toast: (t: string, o?: { tone?: 'ok' | 'err' }) => void }) {
  const [d, setD] = useState<ExerciseDraft>(() => (initial ? { ...blankExercise(), ...initial } as ExerciseDraft : blankExercise()));
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join(', '));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [varPick, setVarPick] = useState(false);
  const [subPick, setSubPick] = useState(false);
  const all = useLive(() => listExercises({ includeArchived: true }), []);
  const set = <K extends keyof ExerciseDraft>(k: K, v: ExerciseDraft[K]): void => setD((x) => ({ ...x, [k]: v }));
  const toggleM = (k: 'primary_muscles' | 'secondary_muscles', m: string): void => set(k, d[k].includes(m) ? d[k].filter((x) => x !== m) : [...d[k], m]);
  const needsMuscle = !['cardio', 'mobility', 'stretching', 'sport'].includes(d.category);
  const muscleIds = useMemo(() => Object.keys(MUSCLES), []);
  const nameOf = (x: string): string => all.data?.find((e) => e.id === x)?.name ?? 'exercise';

  async function save(): Promise<void> {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = 'Give the exercise a name.';
    if (needsMuscle && d.primary_muscles.length === 0) e.muscles = 'Pick at least one primary muscle so volume is counted correctly.';
    if (all.data?.some((x) => x.name.toLowerCase() === d.name.trim().toLowerCase() && x.id !== initial?.id)) e.name = 'An exercise with this name already exists.';
    setErrs(e);
    if (Object.keys(e).length) return;
    try {
      const draft = { ...d, name: d.name.trim(), aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) };
      const saved = initial?.is_custom ? await updateExercise(initial.id, draft) : await createExercise(draft);
      toast(initial?.is_custom ? 'Exercise updated' : 'Exercise created', { tone: 'ok' });
      onDone(saved);
    } catch (er) { toast(errMsg(er), { tone: 'err' }); }
  }
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={onCancel}><Icon name="left" /></button><h1>{initial?.is_custom ? 'Edit exercise' : 'New exercise'}</h1></div>
      <div className="col">
        <Field label="Name" error={errs.name}>{(fid) => <input id={fid} className={`input${errs.name ? ' err' : ''}`} value={d.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Other names (comma separated)">{(fid) => <input id={fid} className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} />}</Field>
        <div className="field"><span className="label">How is it tracked?</span><div className="col" style={{ gap: 8 }}>{TRACK.map((t) => <button key={t.v} type="button" className={`card ${d.tracking_method === t.v ? 'hl' : ''}`} style={{ textAlign: 'left', color: 'inherit', padding: 12 }} aria-pressed={d.tracking_method === t.v} onClick={() => { set('tracking_method', t.v); if (t.v === 'bodyweight_reps') set('load_mode', 'bodyweight'); if (t.v === 'assisted_reps') set('load_mode', 'assisted'); }}><div className="strong">{t.label}</div><div className="small dim">{t.hint}</div></button>)}</div></div>
        <div className="field"><span className="label">Category</span><div className="chips wrap">{CATS.map((c) => <Chip key={c} on={d.category === c} onClick={() => set('category', c)}>{c}</Chip>)}</div></div>
        <div className="field"><span className="label">Equipment</span><div className="chips wrap">{EQUIP.map((c) => <Chip key={c} on={d.equipment === c} onClick={() => set('equipment', c)}>{c}</Chip>)}</div></div>
        <div className="field"><span className="label">Primary muscles{needsMuscle ? ' *' : ''}</span>{errs.muscles && <span className="err-text">{errs.muscles}</span>}<div className="chips wrap">{muscleIds.map((m) => <Chip key={m} on={d.primary_muscles.includes(m)} onClick={() => toggleM('primary_muscles', m)}>{muscleLabel(m)}</Chip>)}</div></div>
        <div className="field"><span className="label">Secondary muscles (half credit in weighted counts)</span><div className="chips wrap">{muscleIds.map((m) => <Chip key={m} on={d.secondary_muscles.includes(m)} onClick={() => toggleM('secondary_muscles', m)}>{muscleLabel(m)}</Chip>)}</div></div>
        <div className="field"><span className="label">Movement</span><div className="chips wrap">{PATTERNS.map((p) => <Chip key={p} on={d.movement_pattern === p} onClick={() => set('movement_pattern', d.movement_pattern === p ? null : p)}>{p}</Chip>)}</div></div>
        <div className="field"><span className="label">One side or both?</span><Seg value={d.laterality} onChange={(v: Laterality) => set('laterality', v)} label="Laterality" options={[{ value: 'bilateral', label: 'Both' }, { value: 'unilateral', label: 'One side' }, { value: 'alternating', label: 'Alternating' }]} /></div>
        <div className="field"><span className="label">What does the logged weight mean?</span><Seg value={d.load_mode} onChange={(v: LoadMode) => set('load_mode', v)} label="Load mode" options={[{ value: 'total', label: 'Total' }, { value: 'per_hand', label: 'Per hand' }, { value: 'per_side', label: 'Per side' }]} /></div>
        <div className="field"><span className="label">Resistance</span><Seg value={d.resistance_type} onChange={(v: ResistanceType) => set('resistance_type', v)} label="Resistance" options={[{ value: 'free_weight', label: 'Free' }, { value: 'machine', label: 'Machine' }, { value: 'cable', label: 'Cable' }, { value: 'bodyweight', label: 'Body' }]} /></div>
        <div className="row-flex"><Field label="Default rest (s)">{(fid) => <input id={fid} className="input" inputMode="numeric" value={d.default_rest_s ?? ''} onChange={(e) => set('default_rest_s', e.target.value ? Number(e.target.value) : null)} />}</Field><Field label="Default tempo">{(fid) => <input id={fid} className="input" value={d.default_tempo ?? ''} onChange={(e) => set('default_tempo', e.target.value || null)} placeholder="3-1-1" />}</Field></div>
        <Field label="Technique cue">{(fid) => <input id={fid} className="input" value={d.cues ?? ''} onChange={(e) => set('cues', e.target.value || null)} />}</Field>
        <Field label="Instructions">{(fid) => <textarea id={fid} className="input" value={d.technique ?? ''} onChange={(e) => set('technique', e.target.value || null)} />}</Field>
        <Field label="Demo video link (optional)">{(fid) => <input id={fid} className="input" inputMode="url" value={d.demo_url ?? ''} onChange={(e) => set('demo_url', e.target.value || null)} />}</Field>
        <div className="field"><span className="label">Variation of</span><div className="row-flex"><span className="grow">{d.variation_of ? nameOf(d.variation_of) : 'None'}</span><Button small onClick={() => setVarPick(true)}>Choose</Button>{d.variation_of && <Button small variant="ghost" onClick={() => set('variation_of', null)}>Clear</Button>}</div></div>
        <div className="field"><span className="label">Alternatives</span><div className="chips wrap">{d.substitute_ids.map((s) => <Chip key={s} on onClick={() => set('substitute_ids', d.substitute_ids.filter((x) => x !== s))}>{nameOf(s)} ✕</Chip>)}<Chip onClick={() => setSubPick(true)}>+ Add</Chip></div></div>
        <Button variant="primary" block onClick={() => void save()}>Save exercise</Button>
      </div>
      <ExercisePicker open={varPick} onClose={() => setVarPick(false)} title="Variation of…" onPick={(e) => set('variation_of', e.id)} />
      <ExercisePicker open={subPick} onClose={() => setSubPick(false)} title="Add alternative" onPick={(e) => set('substitute_ids', [...new Set([...d.substitute_ids, e.id])])} />
    </div>
  );
}
