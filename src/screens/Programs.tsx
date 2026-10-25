import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createProgram, duplicateProgram, getBundle, listModifications, listPrograms, sessionsForProgram, setProgramStatus, treeOfVersion, updateProgramMeta } from '@/data/repo/programs';
import { exerciseMap } from '@/data/repo/exercises';
import { latestVersion, resolveVersion } from '@/domain/versioning';
import { muscleCredits, GROUP_LABELS, GROUP_ORDER, type MuscleGroup } from '@/domain/muscles';
import { type PlanEdit } from '@/domain/editScope';
import { Badge, Banner, Button, Card, Chip, Empty, Field, Loading, Seg, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, fmtMin, errMsg, plural, weekdayLong, weekdayShort } from '@/ui/format';
import { EditScopeSheet } from './shared/EditScopeSheet';
import { newId } from '@/data/runtime';
import type { ProgramDraft } from '@/data/seed/routineV6';
import { addDays } from '@/domain/periods';

const STATUS_TONE = { active: 'ok', paused: 'warn', completed: 'info', archived: 'dim', abandoned: 'bad' } as const;

export function Programs() {
  const nav = useNavigate();
  const ui = useUi();
  const { today } = useApp();
  const progs = useLive(() => listPrograms({ includeArchived: true }), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState(today);
  const [showArchived, setShowArchived] = useState(false);

  async function create(): Promise<void> {
    if (!name.trim()) { ui.toast('Give the program a name', { tone: 'err' }); return; }
    try {
      const draft: ProgramDraft = { name: name.trim(), description: null, goal: null, methodology: null, split: null, source: null, status: 'active', start_date: start, end_date: null, duration_weeks: null, weekly_frequency: null, deload_weeks: [], progression_method: null, target_notes: null, notes: null, is_template: false, paused_intervals: [], cloned_from: null };
      const { program } = await createProgram(draft, { templates: [], planned: [] }, today);
      setCreating(false); setName('');
      nav(`/program/${program.id}`);
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  const visible = (progs.data ?? []).filter((p) => showArchived || !['archived'].includes(p.status));
  return (
    <div className="screen">
      <div className="page-title"><h1>Program</h1><Button small icon="plus" variant="primary" onClick={() => setCreating(true)}>New</Button></div>
      {progs.loading ? <Loading /> : visible.length === 0 ? (
        <Card><Empty icon="program" title="No program yet" hint="Build a weekly plan — days, exercises, sets, reps, targets — or start from a template." action={<Button variant="primary" onClick={() => setCreating(true)}>Create a program</Button>} /></Card>
      ) : (
        <div className="col">{visible.map((p) => (
          <button key={p.id} type="button" className={`card ${p.status === 'active' ? 'hl' : ''}`} style={{ textAlign: 'left', color: 'inherit' }} onClick={() => nav(`/program/${p.id}`)}>
            <div className="row-flex between"><div className="eyebrow">{p.is_template ? 'Template' : p.goal ?? 'Program'}</div><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></div>
            <h3 className="mt-1">{p.name}</h3>
            <div className="small dim mt-1">{p.start_date ? `From ${fmtDate(p.start_date, { year: true })}` : 'No start date'}{p.weekly_frequency ? ` · ${p.weekly_frequency} days/week` : ''}</div>
            {p.target_notes && <div className="small gold mt-2">{p.target_notes}</div>}
          </button>
        ))}</div>
      )}
      <div className="row-flex mt-4"><Button block icon="dumbbell" onClick={() => nav('/exercises')}>Exercise library</Button><Chip on={showArchived} onClick={() => setShowArchived(!showArchived)}>Archived</Chip></div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="New program" footer={<Button block variant="primary" onClick={() => void create()}>Create</Button>}>
        <div className="col"><Field label="Name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer cut — PPL" autoFocus />}</Field>
          <Field label="Starts on">{(id) => <input id={id} className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <p className="small dim">You'll add training days and exercises next. Every change is saved straight away.</p></div>
      </Sheet>
    </div>
  );
}

export function ProgramDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const { today, unit } = useApp();
  const bundle = useLive(() => getBundle(id), [id]);
  const exs = useLive(() => exerciseMap(), []);
  const mods = useLive(() => listModifications(id), [id]);
  const used = useLive(async () => { const ss = await sessionsForProgram(id); const m = new Map<string, number>(); for (const s of ss) if (s.program_version_id && ['completed_as_planned', 'completed_modified', 'partial', 'in_progress'].includes(s.status)) m.set(s.program_version_id, (m.get(s.program_version_id) ?? 0) + 1); return m; }, [id]);
  const [tab, setTab] = useState<'schedule' | 'versions' | 'changes'>('schedule');
  const [menu, setMenu] = useState(false);
  const [dup, setDup] = useState<{ asTemplate: boolean } | null>(null);
  const [dupName, setDupName] = useState('');
  const [metaOpen, setMetaOpen] = useState(false);
  const [moveDay, setMoveDay] = useState<{ templateKey: string; name: string } | null>(null);
  const [pendingEdits, setPendingEdits] = useState<{ edits: PlanEdit[]; description: string } | null>(null);
  const [addDay, setAddDay] = useState(false);
  const [dayName, setDayName] = useState('');
  const [dayWd, setDayWd] = useState(1);

  const b = bundle.data;
  const view = useMemo(() => {
    if (!b) return null;
    const v = resolveVersion(b.versions, today) ?? latestVersion(b.versions);
    if (!v) return null;
    const tree = treeOfVersion(b, v.id);
    return { v, tree };
  }, [b, today]);

  const muscle = useMemo(() => {
    const m = new Map<MuscleGroup, number>();
    if (!view || !exs.data) return m;
    for (const row of view.tree.planned) { const ex = exs.data.get(row.exercise_id); if (!ex) continue; for (const c of muscleCredits(ex, 'direct')) m.set(c.group, (m.get(c.group) ?? 0) + row.sets * c.weight); }
    return m;
  }, [view, exs.data]);

  if (bundle.loading) return <div className="screen"><Loading /></div>;
  if (!b || !view) return <div className="screen"><Empty icon="warn" title="Program not found" action={<Button onClick={() => nav('/program')}>Back</Button>} /></div>;
  const p = b.program;
  const totalSets = view.tree.planned.reduce((a, r) => a + r.sets, 0);
  const byDay = new Map<number, typeof view.tree.templates>();
  for (const t of view.tree.templates) byDay.set(t.weekday ?? 0, [...(byDay.get(t.weekday ?? 0) ?? []), t]);

  async function setStatus(s: Parameters<typeof setProgramStatus>[1]): Promise<void> {
    try { await setProgramStatus(id, s, today); setMenu(false); ui.toast(`Program ${s}`, { tone: 'ok' }); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  async function doDup(): Promise<void> {
    if (!dup) return;
    try { const c = await duplicateProgram(id, dupName.trim() || `${p.name} (copy)`, today, { asTemplate: dup.asTemplate }); setDup(null); ui.toast(dup.asTemplate ? 'Saved as template' : 'Program duplicated', { tone: 'ok' }); nav(`/program/${c.id}`); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav('/program')}><Icon name="left" /></button><div className="grow"><div className="eyebrow">{p.is_template ? 'Template' : 'Program'}</div><h1 className="ellipsis">{p.name}</h1></div><button className="icon-btn" type="button" aria-label="Program options" onClick={() => setMenu(true)}><Icon name="kebab" /></button></div>
      <div className="row-flex wrap"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge><Badge>v{view.v.version_no}</Badge>{p.start_date && <Badge tone="dim">from {fmtDate(p.start_date)}</Badge>}{p.paused_intervals.some((i) => i.to === null) && <Badge tone="warn">paused</Badge>}</div>
      {p.description && <p className="small dim mt-2">{p.description}</p>}
      <Card className="mt-3 blue">
        <div className="row-flex between"><div><div className="kpi"><div className="v">{totalSets}</div><div className="l">sets / week</div></div></div>
          <div className="chips wrap" style={{ justifyContent: 'flex-end', maxWidth: '65%' }}>{GROUP_ORDER.filter((g) => muscle.has(g)).map((g) => <span key={g} className="badge">{GROUP_LABELS[g]} {Math.round((muscle.get(g) ?? 0) * 10) / 10}</span>)}</div></div>
        <div className="tiny dim mt-2">Direct sets per muscle group (primary muscles only).</div>
      </Card>
      <div className="mt-4"><Seg value={tab} onChange={setTab} label="Program sections" options={[{ value: 'schedule', label: 'Schedule' }, { value: 'versions', label: 'Versions' }, { value: 'changes', label: 'Changes' }]} /></div>

      {tab === 'schedule' && (
        <div className="col mt-3">
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
            const ts = byDay.get(wd) ?? [];
            return (
              <Card key={wd} className="pad-0">
                <div className="row-flex between" style={{ padding: '12px 16px' }}><div className="strong">{weekdayLong(wd)}</div><span className="tiny dim">{ts.length ? '' : 'Rest'}</span></div>
                {ts.map((t) => {
                  const rows = view.tree.planned.filter((r) => r.template_key === t.template_key);
                  return (
                    <div key={t.template_key} className="item" style={{ borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                      <button type="button" className="grow" style={{ background: 'none', border: 0, color: 'inherit', textAlign: 'left', padding: 0 }} onClick={() => nav(`/program/${id}/day/${t.template_key}`)}>
                        <div className="strong">{t.name.split(' — ')[1] ?? t.name}</div>
                        <div className="small dim">{plural(rows.length, 'exercise')} · {plural(rows.reduce((a, r) => a + r.sets, 0), 'set')}{t.est_duration_min ? ` · ${fmtMin(t.est_duration_min)}` : ''}</div>
                      </button>
                      <Button small variant="ghost" onClick={() => setMoveDay({ templateKey: t.template_key, name: t.name })} aria-label={`Move ${t.name}`}>Move</Button>
                      <Icon name="right" className="chev" size={20} />
                    </div>
                  );
                })}
              </Card>
            );
          })}
          <Button block icon="plus" onClick={() => { setDayName(''); setDayWd(1); setAddDay(true); }}>Add training day</Button>
          <p className="tiny dim center">Changes you make here ask which workouts they apply to, and show you the affected days first.</p>
        </div>
      )}

      {tab === 'versions' && (
        <div className="col mt-3">
          <Banner icon="info">Every broad change creates a new version. Past workouts keep the version they were done with, so your history never changes retroactively.</Banner>
          {[...b.versions].reverse().map((v) => (
            <Card key={v.id}><div className="row-flex between"><div className="strong">Version {v.version_no}</div>{v.id === view.v.id && <Badge tone="ok">in force today</Badge>}</div>
              <div className="small dim mt-1">Effective {fmtDate(v.effective_from, { year: true })} · {plural(used.data?.get(v.id) ?? 0, 'workout')} done with it</div>
              {v.summary && <div className="small mt-1">{v.summary}</div>}
              <div className="tiny dim mt-1">{b.planned.filter((r) => r.program_version_id === v.id).length} exercises across {b.templates.filter((t) => t.program_version_id === v.id).length} days</div></Card>
          ))}
        </div>
      )}

      {tab === 'changes' && (
        <div className="col mt-3">
          {(mods.data?.length ?? 0) === 0 ? <Empty icon="note" title="No changes yet" /> : mods.data?.map((m) => (
            <Card key={m.id}><div className="row-flex between"><div className="strong">{m.description}</div></div><div className="small dim mt-1">{m.created_at.slice(0, 10)} · {m.kind.replace(/_/g, ' ')} · scope: {m.scope.replace(/_/g, ' ')}{m.effective_from ? ` · from ${fmtDate(m.effective_from, { year: true })}` : ''}</div></Card>
          ))}
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Program options">
        <div className="list" style={{ margin: '0 -16px' }}>
          <button className="item" type="button" onClick={() => { setMenu(false); setMetaOpen(true); }}><Icon name="edit" /><div className="grow strong">Edit details</div></button>
          {p.status === 'active' && <button className="item" type="button" onClick={() => void setStatus('paused')}><Icon name="pause" /><div className="grow"><div className="strong">Pause program</div><div className="small dim">No workouts are scheduled while paused</div></div></button>}
          {p.status === 'paused' && <button className="item" type="button" onClick={() => void setStatus('active')}><Icon name="play" /><div className="grow strong">Resume program</div></button>}
          {['completed', 'archived', 'abandoned'].includes(p.status) && <button className="item" type="button" onClick={() => void setStatus('active')}><Icon name="refresh" /><div className="grow"><div className="strong">Restart / restore</div></div></button>}
          <button className="item" type="button" onClick={() => { setMenu(false); setDupName(`${p.name} (copy)`); setDup({ asTemplate: false }); }}><Icon name="copy" /><div className="grow strong">Duplicate as a new program</div></button>
          <button className="item" type="button" onClick={() => { setMenu(false); setDupName(`${p.name} — template`); setDup({ asTemplate: true }); }}><Icon name="bookmark" /><div className="grow strong">Save as template</div></button>
          {p.status !== 'completed' && <button className="item" type="button" onClick={() => void setStatus('completed')}><Icon name="trophy" /><div className="grow strong">Mark completed</div></button>}
          {p.status !== 'abandoned' && p.status !== 'archived' && <button className="item" type="button" onClick={async () => { if (await ui.confirm({ title: 'Abandon this program?', message: 'It stops being scheduled. All history is kept and you can restart it later.', confirmLabel: 'Abandon', danger: true })) void setStatus('abandoned'); }}><Icon name="x" /><div className="grow strong bad">Abandon</div></button>}
          {p.status !== 'archived' && <button className="item" type="button" onClick={() => void setStatus('archived')}><Icon name="download" /><div className="grow strong">Archive</div></button>}
        </div>
      </Sheet>
      <Sheet open={!!dup} onClose={() => setDup(null)} title={dup?.asTemplate ? 'Save as template' : 'Duplicate program'} footer={<Button block variant="primary" onClick={() => void doDup()}>{dup?.asTemplate ? 'Save template' : 'Duplicate'}</Button>}>
        <Field label="Name">{(fid) => <input id={fid} className="input" value={dupName} onChange={(e) => setDupName(e.target.value)} />}</Field>
        <p className="small dim mt-3">{dup?.asTemplate ? 'A template keeps the structure so you can start new programs from it later. It is never scheduled.' : 'Copies the current version. The original is not changed.'}</p>
      </Sheet>
      <MetaSheet open={metaOpen} onClose={() => setMetaOpen(false)} program={p} />
      <Sheet open={!!moveDay} onClose={() => setMoveDay(null)} title={`Move ${moveDay?.name.split(' — ')[1] ?? ''}`}>
        <p className="small dim">Pick the new weekday. If another workout is there, the two days swap places.</p>
        <div className="chips wrap mt-3">{[1, 2, 3, 4, 5, 6, 7].map((wd) => <Chip key={wd} onClick={() => {
          if (!moveDay) return;
          const me = view.tree.templates.find((t) => t.template_key === moveDay.templateKey);
          const other = view.tree.templates.find((t) => t.weekday === wd && t.template_key !== moveDay.templateKey);
          const edits: PlanEdit[] = [{ kind: 'update_day', template_key: moveDay.templateKey, patch: { weekday: wd } }];
          if (other && me?.weekday) edits.push({ kind: 'update_day', template_key: other.template_key, patch: { weekday: me.weekday } });
          setPendingEdits({ edits, description: other ? `Swap ${weekdayShort(me?.weekday ?? 1)} and ${weekdayShort(wd)} workouts` : `Move ${moveDay.name.split(' — ')[0]} to ${weekdayLong(wd)}` });
          setMoveDay(null);
        }}>{weekdayShort(wd)}</Chip>)}</div>
      </Sheet>
      <Sheet open={addDay} onClose={() => setAddDay(false)} title="Add training day" footer={<Button block variant="primary" onClick={() => {
        if (!dayName.trim()) { ui.toast('Name the day', { tone: 'err' }); return; }
        setPendingEdits({ edits: [{ kind: 'add_day', template: { template_key: newId(), name: dayName.trim(), weekday: dayWd, sequence: 0, workout_type: 'strength', target_muscles: [], est_duration_min: 60, warmup: null, notes: null } }], description: `Add ${dayName.trim()} on ${weekdayLong(dayWd)}` });
        setAddDay(false);
      }}>Continue</Button>}>
        <div className="col"><Field label="Name">{(fid) => <input id={fid} className="input" value={dayName} onChange={(e) => setDayName(e.target.value)} placeholder="e.g. Push · chest, shoulders, triceps" />}</Field>
          <div className="field"><span className="label">Weekday</span><div className="chips wrap">{[1, 2, 3, 4, 5, 6, 7].map((wd) => <Chip key={wd} on={dayWd === wd} onClick={() => setDayWd(wd)}>{weekdayShort(wd)}</Chip>)}</div></div></div>
      </Sheet>
      {pendingEdits && <EditScopeSheet open onClose={() => setPendingEdits(null)} programId={id} edits={pendingEdits.edits} scopes={['day_future', 'program_from_date']} initialScope="day_future" description={pendingEdits.description} onApplied={() => setPendingEdits(null)} />}
      <span hidden>{unit}{addDays(today, 0)}</span>
    </div>
  );
}

function MetaSheet({ open, onClose, program }: { open: boolean; onClose: () => void; program: NonNullable<ReturnType<typeof useLive<Awaited<ReturnType<typeof getBundle>>>>['data']>['program'] }) {
  const ui = useUi();
  const [name, setName] = useState(program.name);
  const [desc, setDesc] = useState(program.description ?? '');
  const [prog, setProg] = useState(program.progression_method ?? '');
  const [freq, setFreq] = useState(String(program.weekly_frequency ?? ''));
  const [notes, setNotes] = useState(program.notes ?? '');
  async function save(): Promise<void> {
    try { await updateProgramMeta(program.id, { name: name.trim() || program.name, description: desc || null, progression_method: prog || null, weekly_frequency: freq ? Number(freq) : null, notes: notes || null }); ui.toast('Saved', { tone: 'ok' }); onClose(); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Program details" footer={<Button block variant="primary" onClick={() => void save()}>Save</Button>}>
      <div className="col">
        <Field label="Name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Description">{(id) => <textarea id={id} className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
        <Field label="Progression method">{(id) => <input id={id} className="input" value={prog} onChange={(e) => setProg(e.target.value)} placeholder="e.g. double progression" />}</Field>
        <Field label="Training days per week">{(id) => <input id={id} className="input" inputMode="numeric" value={freq} onChange={(e) => setFreq(e.target.value)} />}</Field>
        <Field label="Notes">{(id) => <textarea id={id} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Sheet>
  );
}
