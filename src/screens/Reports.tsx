import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadDashboard } from '@/data/repo/dashboard';
import { listRecommendations, respondToRecommendation, listBody, listGoals } from '@/data/repo/misc';
import { activePrograms, getBundle, listModifications, listPrograms, sessionsForProgram } from '@/data/repo/programs';
import { rescheduleScheduled } from '@/data/repo/sessions';
import { buildReport, previousPeriod, type PeriodReport } from '@/domain/reports';
import { addDays, weekStartOf, monthKey } from '@/domain/periods';
import { GROUP_LABELS } from '@/domain/muscles';
import { PR_LABELS } from '@/domain/records';
import { formatVolume, formatWeight } from '@/domain/units';
import { seriesOf } from '@/domain/body';
import type { Recommendation } from '@/domain/types';
import { Badge, Banner, Button, Card, Chip, Empty, Loading, ProgressBar, Section, Seg, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { HBars } from '@/ui/charts';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, fmtMonth, pct, plural, errMsg, signed } from '@/ui/format';
import { EditScopeSheet } from './shared/EditScopeSheet';

async function reportFor(from: string, to: string, today: string): Promise<{ r: PeriodReport; prev: PeriodReport; names: Map<string, string>; trends: Awaited<ReturnType<typeof loadDashboard>>['trends'] }> {
  const d = await loadDashboard('custom', today, { from, to });
  const pp = previousPeriod(from, to);
  const dp = await loadDashboard('custom', today, pp);
  const mk = (x: typeof d, f: string, t: string): PeriodReport => buildReport({ from: f, to: t, sets: x.sets, ctx: x.ctx, results: x.results, prs: [...x.prsAll.values()].flat(), sessions: x.sessions.map((s) => ({ ...s })) as never });
  const prev = mk(dp, pp.from, pp.to);
  return { r: buildReport({ from, to, sets: d.sets, ctx: d.ctx, results: d.results, prs: [...d.prsAll.values()].flat(), sessions: d.sessions.map((s) => ({ ...s })) as never }, prev), prev, names: new Map([...d.ctx.exercises].map(([id, e]) => [id, e.name])), trends: d.trends };
}

export function Reports() {
  const nav = useNavigate();
  const { today, weekStart, unit } = useApp();
  const [tab, setTab] = useState<'week' | 'month' | 'block'>('week');
  const [offset, setOffset] = useState(1); // 1 = last complete week/month
  const [progId, setProgId] = useState<string | null>(null);
  const range = useMemo(() => {
    if (tab === 'week') { const s = addDays(weekStartOf(today, weekStart), -7 * offset); return { from: s, to: addDays(s, 6) }; }
    if (tab === 'month') { const [y, m] = monthKey(today).split('-').map(Number) as [number, number]; const dt = new Date(Date.UTC(y, m - 1 - offset, 1)); const from = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`; const end = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)); return { from, to: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}` }; }
    return null;
  }, [tab, offset, today, weekStart]);
  const rep = useLive(() => (range ? reportFor(range.from, range.to, today) : Promise.resolve(null)), [range?.from, range?.to, today]);
  const progs = useLive(() => listPrograms({ includeArchived: true }), []);

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Reports</h1></div>
      <Seg value={tab} onChange={(v) => { setTab(v); setOffset(1); }} label="Report type" options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'block', label: 'Training block' }]} />
      {tab !== 'block' && range && (
        <>
          <div className="row-flex between mt-4"><button className="icon-btn" type="button" aria-label="Earlier" onClick={() => setOffset(offset + 1)}><Icon name="left" /></button><div className="center"><div className="strong">{tab === 'week' ? `${fmtDate(range.from)} – ${fmtDate(range.to, { year: true })}` : fmtMonth(range.from.slice(0, 7))}</div></div><button className="icon-btn" type="button" aria-label="Later" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - 1))}><Icon name="right" /></button></div>
          {rep.loading || !rep.data ? <div className="mt-4"><Loading /></div> : <PeriodView data={rep.data} unit={unit} kind={tab} />}
        </>
      )}
      {tab === 'block' && (
        <div className="mt-4">
          <div className="chips wrap">{(progs.data ?? []).map((p) => <Chip key={p.id} on={progId === p.id} onClick={() => setProgId(p.id)}>{p.name.slice(0, 26)}</Chip>)}</div>
          {progId ? <BlockView programId={progId} /> : <Card className="mt-3"><Empty icon="program" title="Pick a program" hint="A block report compares where you started with where you are, with adherence, interruptions and what responded." /></Card>}
        </div>
      )}
    </div>
  );
}

function PeriodView({ data, unit, kind }: { data: { r: PeriodReport; prev: PeriodReport; names: Map<string, string>; trends: Awaited<ReturnType<typeof loadDashboard>>['trends'] }; unit: 'kg' | 'lb'; kind: 'week' | 'month' }) {
  const { r, prev, names, trends } = data;
  const nav = useNavigate();
  if (r.totals.sessions === 0 && r.attendance.planned === 0) return <Card className="mt-4"><Empty icon="note" title="Nothing to report" hint="No training or scheduled workouts in this period." /></Card>;
  const dv = prev.totals.volumeKg > 0 ? ((r.totals.volumeKg - prev.totals.volumeKg) / prev.totals.volumeKg) * 100 : null;
  const improved = trends.filter((t) => t.assessment.signal === 'improving').slice(0, 3);
  const stalled = trends.filter((t) => t.assessment.signal === 'plateau').slice(0, 3);
  return (
    <div className="col mt-4">
      <div className="kpis">
        <div className="kpi"><div className="l">Sessions</div><div className="v">{r.sessionsDone}<span className="dim" style={{ fontSize: '1.2rem' }}> / {r.sessionsPlanned || '—'}</span></div><div className="d dim">{r.attendance.rate !== null ? `${pct(r.attendance.rate)} attendance` : ''}</div></div>
        <div className="kpi"><div className="l">Volume load</div><div className="v">{formatVolume(r.totals.volumeKg, unit)}</div><div className={`d ${dv === null ? 'dim' : dv >= 0 ? 'ok' : 'warn'}`}>{dv === null ? 'no previous period' : `${signed(dv)}% vs previous`}</div></div>
        <div className="kpi"><div className="l">Sets · reps</div><div className="v">{r.totals.workingSets}<span className="dim" style={{ fontSize: '1.2rem' }}> · {r.totals.reps}</span></div></div>
        <div className="kpi"><div className="l">Avg session</div><div className="v">{r.avgDurationMin ?? '—'}<span className="dim" style={{ fontSize: '1rem' }}> min</span></div><div className="d dim">{r.avgSessionRpe ? `RPE ${r.avgSessionRpe}` : ''}</div></div>
      </div>
      {r.observations.length > 0 && <Card><div className="eyebrow">Observations</div>{r.observations.map((o) => <p key={o} className="small mt-2">{o}</p>)}</Card>}
      <Section title="Volume by muscle (direct sets)"><Card>{r.muscles.length ? <HBars rows={r.muscles.map((m) => ({ key: m.group, label: GROUP_LABELS[m.group], value: m.sets }))} /> : <span className="dim small">Nothing logged.</span>}</Card></Section>
      <Section title="Top exercises"><Card className="pad-0"><div className="list">{r.topExercises.map((e) => <button key={e.exercise_id} className="item" type="button" onClick={() => nav(`/exercises/${e.exercise_id}`)}><div className="grow strong">{e.name}</div><div className="num gold strong">{formatVolume(e.volumeKg, unit)}</div></button>)}</div></Card></Section>
      {r.prs.length > 0 && <Section title="Records"><Card className="pad-0"><div className="list">{r.prs.slice(0, 8).map((p) => <div key={`${p.set_id}${p.type}`} className="item"><span className="sticker">PR</span><div className="grow small"><span className="strong">{names.get(p.exercise_id)}</span> · {PR_LABELS[p.type]}</div><span className="gold strong num">{['max_weight', 'best_e1rm', 'actual_1rm', 'max_set_volume'].includes(p.type) ? formatWeight(p.value, unit) : Math.round(p.value)}</span></div>)}</div></Card></Section>}
      <Section title="Planned vs actual"><Card><div className="row-flex between"><span>Volume performed vs plan</span><span className="strong">{r.plannedVsActual.ratio !== null ? pct(r.plannedVsActual.ratio) : '—'}</span></div><ProgressBar value={Math.min(100, (r.plannedVsActual.ratio ?? 0) * 100)} label="Planned volume performed" /><div className="small dim mt-2">{plural(r.skipped, 'skipped session')} · {plural(r.substituted, 'session')} with substitutions or changes</div></Card></Section>
      {kind === 'month' && (improved.length > 0 || stalled.length > 0) && <Section title="Lift progress"><Card>{improved.map((t) => <div key={t.exercise.id} className="small mt-1"><Badge tone="ok">improving</Badge> {t.exercise.name}</div>)}{stalled.map((t) => <div key={t.exercise.id} className="small mt-1"><Badge tone="warn">plateau</Badge> {t.exercise.name}</div>)}<p className="tiny dim mt-2">Based on comparable sessions, not single sessions.</p></Card></Section>}
    </div>
  );
}

function BlockView({ programId }: { programId: string }) {
  const { today, unit } = useApp();
  const data = useLive(async () => {
    const b = await getBundle(programId);
    if (!b) return null;
    const from = b.program.start_date ?? today;
    const to = b.program.end_date && b.program.end_date < today ? b.program.end_date : today;
    const rep = await reportFor(from, to, today);
    const sessions = await sessionsForProgram(programId);
    const mods = await listModifications(programId);
    const goals = await listGoals();
    const body = seriesOf(await listBody(), 'bodyweight_kg').filter((p) => p.date >= from && p.date <= to);
    return { b, from, to, rep, sessions, mods, goals, body };
  }, [programId, today]);
  if (data.loading) return <div className="mt-3"><Loading /></div>;
  if (!data.data) return null;
  const { b, from, to, rep, sessions, mods, goals, body } = data.data;
  const lifts = rep.trends.filter((t) => t.perfs.filter((p) => p.comparable && p.score !== null).length >= 2).slice(0, 8);
  const pauses = b.program.paused_intervals;
  const skipped = sessions.filter((s) => s.status === 'skipped').length;
  const responsive = lifts.filter((t) => t.assessment.signal === 'improving');
  const flat = lifts.filter((t) => ['plateau', 'regressing', 'possible_fatigue'].includes(t.assessment.signal));
  return (
    <div className="col mt-3">
      <Card><div className="eyebrow">Block</div><div className="strong">{b.program.name}</div><div className="small dim">{fmtDate(from, { year: true })} – {fmtDate(to, { year: true })} · {plural(b.versions.length, 'version')}</div>
        <div className="kpis mt-3"><div className="kpi"><div className="l">Sessions</div><div className="v">{rep.r.sessionsDone}</div><div className="d dim">{rep.r.attendance.rate !== null ? `${pct(rep.r.attendance.rate)} attended` : ''}</div></div><div className="kpi"><div className="l">Total volume</div><div className="v">{formatVolume(rep.r.totals.volumeKg, unit)}</div></div></div></Card>
      <Section title="Baseline vs now"><Card className="pad-0"><div className="list">{lifts.map((t) => { const c = t.perfs.filter((p) => p.comparable && p.score !== null); const a = c[0]!.score as number, z = c.at(-1)!.score as number; return <div key={t.exercise.id} className="item"><div className="grow"><div className="strong">{t.exercise.name}</div><div className="small dim">{fmtDate(c[0]!.date)} → {fmtDate(c.at(-1)!.date)}</div></div><div className="num small">{Math.round(a)} → <span className="gold strong">{Math.round(z)}</span> <span className={z >= a ? 'ok' : 'warn'}>({signed(((z - a) / a) * 100, 1)}%)</span></div></div>; })}{lifts.length === 0 && <div className="item dim">Needs 2+ comparable sessions per lift.</div>}</div></Card></Section>
      <Section title="Interruptions & changes"><Card><div className="small">{plural(pauses.length, 'pause')} · {plural(skipped, 'skipped session')} · {plural(mods.filter((m) => m.kind.startsWith('new_version') || m.kind === 'edited_in_place').length, 'program change')}</div>{pauses.map((p) => <div key={p.from} className="small dim mt-1">Paused {fmtDate(p.from)} → {p.to ? fmtDate(p.to) : 'now'}</div>)}</Card></Section>
      <Section title="Goals"><Card>{goals.filter((g) => g.status !== 'paused').length === 0 ? <span className="small dim">No goals set.</span> : goals.map((g) => <div key={g.id} className="row-flex between small mt-1"><span>{g.title}</span><Badge tone={g.status === 'completed' ? 'ok' : g.status === 'abandoned' ? 'bad' : 'dim'}>{g.status}</Badge></div>)}</Card></Section>
      <Section title="Body"><Card>{body.length >= 2 ? <div className="small">Bodyweight {body[0]!.value} → {body.at(-1)!.value} kg ({signed(body.at(-1)!.value - body[0]!.value, 1)} kg). <span className="dim">A scale weight change is not the same as muscle gain.</span></div> : <span className="small dim">Log bodyweight to see changes during the block.</span>}</Card></Section>
      <Section title="What to take into the next block"><Card>
        {responsive.length > 0 && <p className="small"><Badge tone="ok">Responded</Badge> {responsive.map((t) => t.exercise.name).join(', ')}</p>}
        {flat.length > 0 && <p className="small mt-2"><Badge tone="warn">Stalled or slipping</Badge> {flat.map((t) => t.exercise.name).join(', ')}</p>}
        {responsive.length === 0 && flat.length === 0 && <p className="small dim">Not enough comparable sessions yet to say what responded.</p>}
        <p className="tiny dim mt-2">Suggestions, not verdicts — one block of data can't separate training from sleep, food and life.</p></Card></Section>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { increase_load: 'Increase load', reduce_load: 'Reduce load', add_reps_first: 'Add reps first', plateau_review: 'Plateau review', deload_review: 'Deload review', reschedule_missed: 'Missed session', muscle_volume: 'Muscle volume' };

export function Suggestions() {
  const nav = useNavigate();
  const { today } = useApp();
  const recs = useLive(() => listRecommendations(), []);
  const bundles = useLive(() => activePrograms(), []);
  const open = (recs.data ?? []).filter((r) => r.status === 'open' || (r.status === 'deferred' && (r.deferred_until ?? '') <= today));
  const done = (recs.data ?? []).filter((r) => !open.includes(r));
  const progOf = (r: Recommendation): string | null => {
    const key = (r.proposed_change as { template_key?: string } | null)?.template_key;
    return bundles.data?.find((b) => b.templates.some((t) => t.template_key === key))?.program.id ?? null;
  };
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Suggestions</h1></div>
      <Banner icon="info">Suggestions come from your own logged data with simple, explainable rules. You decide — nothing is changed silently.</Banner>
      <div className="col mt-3">{open.length === 0 ? <Card><Empty icon="bolt" title="No suggestions right now" hint="They appear after a few sessions, e.g. when you hit the top of a rep range two sessions in a row." /></Card> : open.map((r) => <RecCard key={r.id} r={r} programId={progOf(r)} actions />)}</div>
      {done.length > 0 && <Section title="Earlier"><div className="col">{done.slice(0, 10).map((r) => <RecCard key={r.id} r={r} programId={progOf(r)} actions={false} />)}</div></Section>}
    </div>
  );
}

function RecCard({ r, programId, actions }: { r: Recommendation; programId: string | null; actions: boolean }) {
  const nav = useNavigate();
  const ui = useUi();
  const { today } = useApp();
  const [apply, setApply] = useState(false);
  const [defer, setDefer] = useState(false);
  const [resched, setResched] = useState(false);
  const [date, setDate] = useState(addDays(today, 1));
  const ch = r.proposed_change as { type?: string; plan_key?: string; template_key?: string; from?: string; patch?: Record<string, unknown> } | null;

  async function accept(): Promise<void> {
    if (ch?.type === 'update_prescription' && programId) { setApply(true); return; }
    if (ch?.type === 'reschedule') { setResched(true); return; }
    await respondToRecommendation(r.id, 'accepted');
    ui.toast(r.kind === 'deload_review' ? 'Noted. Tag this week\'s workouts “deload” so they aren\'t compared with normal sessions.' : 'Noted', { tone: 'ok' });
  }
  async function doReschedule(): Promise<void> {
    try {
      if (!programId || !ch?.template_key || !ch.from) throw new Error('Program not found');
      await rescheduleScheduled(programId, ch.template_key, ch.from, date, 'Accepted suggestion');
      await respondToRecommendation(r.id, 'accepted');
      ui.toast(`Moved to ${fmtDate(date)}`, { tone: 'ok' });
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
    setResched(false);
  }
  return (
    <Card>
      <div className="row-flex between"><Badge>{KIND_LABEL[r.kind] ?? r.kind}</Badge>{!actions && <Badge tone="dim">{r.status}</Badge>}</div>
      <div className="mt-2"><div className="eyebrow">Observation</div><p className="small">{r.observation}</p></div>
      <div className="mt-2"><div className="eyebrow">Evidence</div><p className="small dim">{Object.entries(r.evidence).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') || 'Recent sessions'}</p></div>
      <div className="mt-2"><div className="eyebrow">Suggestion</div><p className="small strong">{r.suggestion}</p></div>
      {r.tradeoff && <div className="mt-2"><div className="eyebrow">Expected trade-off</div><p className="small dim">{r.tradeoff}</p></div>}
      <p className="tiny dim mt-2">Nothing changes unless you accept — and accepted program changes show exactly which workouts they affect first.</p>
      {actions && (
        <div className="row-flex wrap mt-3">
          <Button small variant="primary" onClick={() => void accept()}>Accept</Button>
          {programId && ch?.template_key && <Button small onClick={() => { void respondToRecommendation(r.id, 'edited'); nav(`/program/${programId}/day/${ch.template_key}`); }}>Edit myself</Button>}
          <Button small onClick={() => setDefer(true)}>Later</Button>
          <Button small variant="ghost" onClick={async () => { await respondToRecommendation(r.id, 'dismissed'); ui.toast('Dismissed', { action: { label: 'Undo', run: () => void respondToRecommendation(r.id, 'open') } }); }}>Dismiss</Button>
        </div>
      )}
      {apply && programId && ch?.plan_key && ch.patch && <EditScopeSheet open onClose={() => setApply(false)} programId={programId} edits={[{ kind: 'update_prescription', plan_key: ch.plan_key, patch: ch.patch }]} scopes={['exercise_future', 'program_from_date']} initialScope="exercise_future" description={r.suggestion} onApplied={() => { void respondToRecommendation(r.id, 'accepted'); setApply(false); }} />}
      <Sheet open={defer} onClose={() => setDefer(false)} title="Remind me later"><div className="chips">{[3, 7, 14].map((n) => <Chip key={n} onClick={async () => { await respondToRecommendation(r.id, 'deferred', { deferUntil: addDays(today, n) }); setDefer(false); ui.toast(`I'll bring it back in ${n} days`); }}>{n} days</Chip>)}</div></Sheet>
      <Sheet open={resched} onClose={() => setResched(false)} title="Move the missed workout" footer={<Button block variant="primary" onClick={() => void doReschedule()}>Move workout</Button>}><label className="label" htmlFor="rs-date">New date</label><input id="rs-date" className="input" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} /></Sheet>
    </Card>
  );
}
