import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PlannedFields, TechniqueCode } from '@/domain/types';
import { applyEdits, type EditScope, type PlanEdit, type PlannedRow } from '@/domain/editScope';
import { resolveVersion, latestVersion } from '@/domain/versioning';
import { TECHNIQUES } from '@/domain/techniques';
import { formatWeight, fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { getBundle, treeOfVersion } from '@/data/repo/programs';
import { exerciseMap, listExercises } from '@/data/repo/exercises';
import { newId } from '@/data/runtime';
import { Banner, Button, Card, Chip, Empty, Field, Loading, Sheet, Toggle, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { plural, weekdayShort } from '@/ui/format';
import { ExercisePicker } from './shared/ExercisePicker';
import { EditScopeSheet } from './shared/EditScopeSheet';

const BLANK = (exercise_id: string, position: number): PlannedRow => ({
  plan_key: newId(), template_key: '', position, label: null, superset_group: null, exercise_id, muscle_label: null, sets: 3, reps_min: 8, reps_max: 12, rir_target: 1, rir_last_only: false, rpe_target: null,
  rest_min_s: 90, rest_max_s: 90, rest_mode: 'after_set', tempo: null, technique_code: null, technique_text: null, start_load_kg: null, load_note: null, duration_target_s: null, distance_target_m: null, cue: null, notes: null, is_optional: false,
});

export function DayEditor() {
  const { id = '', templateKey = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ui = useUi();
  const { today, unit } = useApp();
  const bundle = useLive(() => getBundle(id), [id]);
  const exs = useLive(() => exerciseMap(), []);
  const all = useLive(() => listExercises(), []);
  const [edits, setEdits] = useState<PlanEdit[]>([]);
  const [editing, setEditing] = useState<PlannedRow | null>(null);
  const [picker, setPicker] = useState<'add' | { replace: string } | null>(null);
  const [save, setSave] = useState(false);
  const dateParam = sp.get('date') ?? undefined;
  const scopeParam = (sp.get('scope') as EditScope | null) ?? undefined;

  const base = useMemo(() => {
    const b = bundle.data;
    if (!b) return null;
    const v = resolveVersion(b.versions, dateParam ?? today) ?? latestVersion(b.versions);
    return v ? treeOfVersion(b, v.id) : null;
  }, [bundle.data, today, dateParam]);
  const tree = useMemo(() => (base ? applyEdits(base, edits) : null), [base, edits]);
  if (bundle.loading) return <div className="screen"><Loading /></div>;
  if (!tree || !base) return <div className="screen"><Empty icon="warn" title="Program not found" action={<Button onClick={() => nav('/program')}>Back</Button>} /></div>;
  const tpl = tree.templates.find((t) => t.template_key === templateKey);
  if (!tpl) return <div className="screen"><Empty icon="warn" title="That workout day no longer exists" action={<Button onClick={() => nav(`/program/${id}`)}>Back to program</Button>} /></div>;
  const rows = tree.planned.filter((r) => r.template_key === templateKey).sort((a, b) => a.position - b.position);
  const nameOf = (eid: string): string => exs.data?.get(eid)?.name ?? 'Exercise';
  const push = (e: PlanEdit): void => setEdits((x) => [...x, e]);
  const move = (i: number, d: -1 | 1): void => {
    const keys = rows.map((r) => r.plan_key);
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
    push({ kind: 'reorder', template_key: templateKey, ordered_plan_keys: keys });
  };
  const description = scopeParam === 'day_week' && dateParam ? `Adjust ${tpl.name.split(' — ')[0]} for ${dateParam}` : `Update ${tpl.name.split(' — ')[0] ?? 'workout day'}`;
  const scopes: EditScope[] = scopeParam === 'day_week' ? ['day_week', 'day_future', 'program_from_date'] : ['day_future', 'day_week', 'program_from_date'];

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={async () => { if (edits.length && !(await ui.confirm({ title: 'Discard changes?', message: 'You have changes that are not saved yet.', confirmLabel: 'Discard', danger: true }))) return; nav(`/program/${id}`); }}><Icon name="left" /></button><div className="grow"><div className="eyebrow">{weekdayShort(tpl.weekday ?? 1)} · {plural(rows.length, 'exercise')}</div><h1 className="ellipsis">{tpl.name.split(' — ')[1] ?? tpl.name}</h1></div></div>
      {scopeParam === 'day_week' && dateParam && <Banner icon="info">Adjusting <strong>{dateParam}</strong>. You choose below whether this changes only that day or more.</Banner>}
      <div className="col mt-3">
        {rows.map((r, i) => (
          <Card key={r.plan_key} className="pad-0">
            <div className="row-flex" style={{ padding: '12px 12px 12px 16px' }}>
              <span className="gold strong" style={{ minWidth: 28, fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{r.label ?? i + 1}</span>
              <button type="button" className="grow" style={{ background: 'none', border: 0, color: 'inherit', textAlign: 'left', padding: 0, minWidth: 0 }} onClick={() => setEditing(r)} aria-label={`Edit ${nameOf(r.exercise_id)}`}>
                <div className="strong ellipsis">{nameOf(r.exercise_id)}</div>
                <div className="small dim">{r.sets} × {r.reps_min === r.reps_max ? r.reps_min : `${r.reps_min}-${r.reps_max}`}{r.rir_target !== null ? ` · RIR ${r.rir_target}${r.rir_last_only ? ' last' : ''}` : ''}{r.start_load_kg !== null ? ` · ${formatWeight(r.start_load_kg, unit)}` : r.load_note ? ` · ${r.load_note}` : ''}</div>
                {r.technique_text && <div className="tiny gold ellipsis">{r.technique_text}</div>}
              </button>
              <div className="col" style={{ gap: 0 }}><button className="icon-btn" style={{ height: 30 }} type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><Icon name="up" size={20} /></button><button className="icon-btn" style={{ height: 30 }} type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === rows.length - 1}><Icon name="down" size={20} /></button></div>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <Card><Empty icon="dumbbell" title="No exercises yet" hint="Add the first exercise for this day." /></Card>}
        <Button block icon="plus" onClick={() => setPicker('add')}>Add exercise</Button>
        <Card>
          <div className="eyebrow">Day details</div>
          <div className="col mt-2">
            <Field label="Name">{(fid) => <input id={fid} className="input" defaultValue={tpl.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== tpl.name) push({ kind: 'update_day', template_key: templateKey, patch: { name: e.target.value.trim() } }); }} />}</Field>
            <Field label="Estimated minutes">{(fid) => <input id={fid} className="input" inputMode="numeric" defaultValue={tpl.est_duration_min ?? ''} onBlur={(e) => { const n = parseNumber(e.target.value); if (n !== tpl.est_duration_min) push({ kind: 'update_day', template_key: templateKey, patch: { est_duration_min: n } }); }} />}</Field>
            <Field label="Warm-up / notes">{(fid) => <textarea id={fid} className="input" defaultValue={tpl.notes ?? ''} onBlur={(e) => { if ((e.target.value || null) !== tpl.notes) push({ kind: 'update_day', template_key: templateKey, patch: { notes: e.target.value || null } }); }} />}</Field>
            <div className="field"><span className="label">Weekday</span><div className="chips wrap">{[1, 2, 3, 4, 5, 6, 7].map((wd) => <Chip key={wd} on={tpl.weekday === wd} onClick={() => { if (wd !== tpl.weekday) push({ kind: 'update_day', template_key: templateKey, patch: { weekday: wd } }); }}>{weekdayShort(wd)}</Chip>)}</div></div>
            <Button variant="danger" small onClick={async () => { if (await ui.confirm({ title: 'Remove this day?', message: 'It is removed from future scheduling. Past workouts are kept exactly as they were.', confirmLabel: 'Remove day', danger: true })) push({ kind: 'remove_day', template_key: templateKey }); }}>Remove this day</Button>
          </div>
        </Card>
      </div>
      <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, background: 'linear-gradient(transparent, var(--bg) 40%)' }}>
        <div className="row-flex"><Button block disabled={!edits.length} onClick={() => setEdits((e) => e.slice(0, -1))} icon="undo">Undo</Button><Button block variant="primary" disabled={!edits.length} onClick={() => setSave(true)}>Save changes{edits.length ? ` (${edits.length})` : ''}</Button></div>
      </div>

      <ExercisePicker open={!!picker} onClose={() => setPicker(null)} title={picker === 'add' ? 'Add exercise' : 'Replace exercise'} replacing={picker && picker !== 'add' ? exs.data?.get(rows.find((r) => r.plan_key === picker.replace)?.exercise_id ?? '') : undefined}
        onPick={(e) => { if (picker === 'add') push({ kind: 'add_exercise', template_key: templateKey, row: { ...BLANK(e.id, rows.length), template_key: templateKey, rest_min_s: e.default_rest_s ?? 90, rest_max_s: e.default_rest_s ?? 90, tempo: e.default_tempo, reps_min: e.category === 'isolation' ? 10 : 6, reps_max: e.category === 'isolation' ? 15 : 10 } }); else if (picker) push({ kind: 'replace_exercise', plan_key: picker.replace, exercise_id: e.id }); }} />
      {editing && <PlannedSheet row={editing} unit={unit} nameOf={nameOf} onClose={() => setEditing(null)} onReplace={() => { setPicker({ replace: editing.plan_key }); setEditing(null); }} onPatch={(patch) => { push({ kind: 'update_prescription', plan_key: editing.plan_key, patch }); setEditing(null); }} onRemove={() => { push({ kind: 'remove_exercise', plan_key: editing.plan_key }); setEditing(null); }} />}
      {save && <EditScopeSheet open onClose={() => setSave(false)} programId={id} edits={edits} scopes={scopes} initialScope={scopeParam ?? 'day_future'} targetDate={dateParam} description={description} onApplied={() => { setEdits([]); nav(`/program/${id}`); }} />}
      <span hidden>{all.data?.length}</span>
    </div>
  );
}

const RIRS = [0, 1, 2, 3];

function PlannedSheet({ row, unit, nameOf, onClose, onPatch, onRemove, onReplace }: { row: PlannedRow; unit: 'kg' | 'lb'; nameOf: (id: string) => string; onClose: () => void; onPatch: (p: Partial<PlannedFields>) => void; onRemove: () => void; onReplace: () => void }) {
  const [sets, setSets] = useState(String(row.sets));
  const [rmin, setRmin] = useState(String(row.reps_min ?? ''));
  const [rmax, setRmax] = useState(String(row.reps_max ?? ''));
  const [rir, setRir] = useState<number | null>(row.rir_target);
  const [last, setLast] = useState(row.rir_last_only);
  const [rest, setRest] = useState(String(row.rest_max_s ?? ''));
  const [pair, setPair] = useState(row.rest_mode === 'after_pair');
  const [tempo, setTempo] = useState(row.tempo ?? '');
  const [tech, setTech] = useState<TechniqueCode | null>(row.technique_code);
  const [load, setLoad] = useState(row.start_load_kg === null ? '' : String(toDisplayWeight(row.start_load_kg, unit)));
  const [loadNote, setLoadNote] = useState(row.load_note ?? '');
  const [label, setLabel] = useState(row.label ?? '');
  const [cue, setCue] = useState(row.cue ?? '');
  const ui = useUi();
  function apply(): void {
    const s = parseNumber(sets), a = parseNumber(rmin), b = parseNumber(rmax), r = parseNumber(rest);
    if (!s || s < 1 || s > 30) { ui.toast('Sets must be between 1 and 30', { tone: 'err' }); return; }
    if (a !== null && b !== null && b < a) { ui.toast('Max reps must be at least min reps', { tone: 'err' }); return; }
    const ln = parseNumber(load);
    onPatch({ sets: Math.round(s), reps_min: a, reps_max: b ?? a, rir_target: rir, rir_last_only: last, rest_min_s: r, rest_max_s: r, rest_mode: pair ? 'after_pair' : 'after_set', tempo: tempo.trim() || null, technique_code: tech, technique_text: tech ? TECHNIQUES[tech].label : null, start_load_kg: ln === null ? null : fromDisplayWeight(ln, unit), load_note: loadNote || null, label: label.trim() || null, superset_group: label.trim() ? label.trim().slice(0, 1).toUpperCase() : row.superset_group, cue: cue || null });
  }
  return (
    <Sheet open onClose={onClose} title={nameOf(row.exercise_id)} footer={<><Button variant="danger" icon="trash" onClick={onRemove}>Remove</Button><Button block variant="primary" onClick={apply}>Done</Button></>}>
      <div className="col">
        <Button icon="swap" onClick={onReplace}>Replace exercise</Button>
        <div className="row-flex"><Field label="Sets">{(id) => <input id={id} className="input" inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} />}</Field><Field label="Min reps">{(id) => <input id={id} className="input" inputMode="numeric" value={rmin} onChange={(e) => setRmin(e.target.value)} />}</Field><Field label="Max reps">{(id) => <input id={id} className="input" inputMode="numeric" value={rmax} onChange={(e) => setRmax(e.target.value)} />}</Field></div>
        <div className="field"><span className="label">Reps in reserve target</span><div className="chips">{RIRS.map((n) => <Chip key={n} on={rir === n} onClick={() => setRir(rir === n ? null : n)}>RIR {n}</Chip>)}</div></div>
        <div className="row-flex between"><span>Target applies to the last set only</span><Toggle on={last} onChange={setLast} label="RIR applies to last set only" /></div>
        <div className="row-flex"><Field label="Rest (seconds)">{(id) => <input id={id} className="input" inputMode="numeric" value={rest} onChange={(e) => setRest(e.target.value)} />}</Field><Field label="Tempo">{(id) => <input id={id} className="input" value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="3-1-1" />}</Field></div>
        <div className="row-flex between"><span>Rest only after the superset pair</span><Toggle on={pair} onChange={setPair} label="Rest after pair" /></div>
        <div className="row-flex"><Field label={`Start load (${unit})`}>{(id) => <input id={id} className="input" inputMode="decimal" value={load} onChange={(e) => setLoad(e.target.value)} />}</Field><Field label="Load note">{(id) => <input id={id} className="input" value={loadNote} onChange={(e) => setLoadNote(e.target.value)} placeholder="Find 12RM" />}</Field></div>
        <div className="field"><span className="label">Last-set technique</span><div className="chips wrap"><Chip on={tech === null} onClick={() => setTech(null)}>None</Chip>{(Object.keys(TECHNIQUES) as TechniqueCode[]).map((t) => <Chip key={t} on={tech === t} onClick={() => setTech(t)}>{TECHNIQUES[t].label.length > 34 ? `${TECHNIQUES[t].label.slice(0, 32)}…` : TECHNIQUES[t].label}</Chip>)}</div></div>
        <div className="row-flex"><Field label="Label (A1, B2…)">{(id) => <input id={id} className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A1" />}</Field></div>
        <Field label="Cue">{(id) => <input id={id} className="input" value={cue} onChange={(e) => setCue(e.target.value)} />}</Field>
        <p className="tiny dim">Exercises that share the same letter (A1 and A2) run as a superset: you alternate sets and rest after the pair.</p>
      </div>
    </Sheet>
  );
}
