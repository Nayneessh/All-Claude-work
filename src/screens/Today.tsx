import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activeSession, planForDate, repeatSession, rescheduleScheduled, restoreSessionToPlanned, sessionExercises, skipScheduled, startAdhoc, startScheduled, type DayItem } from '@/data/repo/sessions';
import { listSessions } from '@/data/repo/history';
import { upcomingWorkouts, weekOverview } from '@/data/repo/schedule';
import { activePrograms } from '@/data/repo/programs';
import { listRecommendations, listReadiness } from '@/data/repo/misc';
import { Badge, Banner, Button, Card, Chip, Empty, Loading, Section, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { StatusBadge } from '@/ui/status';
import { useLive, useNow } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtClock, fmtDate, fmtMin, errMsg, plural, weekdayShort } from '@/ui/format';
import { addDays, isoWeekday, weekStartOf } from '@/domain/periods';
import { sessionTimes, FINISHED } from '@/domain/sessionState';
import { muscleLabel } from '@/domain/muscles';
import { exerciseMap } from '@/data/repo/exercises';
import { SyncChip } from '@/ui/SyncChip';
import { ActivitySheet } from './shared/ActivitySheet';

const SKIP_REASONS = ['Sick', 'Injury', 'Travel', 'No time', 'Recovery', 'Other'];

export function Today() {
  const nav = useNavigate();
  const ui = useUi();
  const { today, weekStart, auth, profile } = useApp();
  const now = useNow(1000);
  const plan = useLive(() => planForDate(today), [today]);
  const active = useLive(() => activeSession(), []);
  const upcoming = useLive(() => upcomingWorkouts(addDays(today, 1), 3), [today]);
  const week = useLive(() => weekOverview(weekStartOf(today, weekStart)), [today, weekStart]);
  const recent = useLive(() => listSessions({}, 3), []);
  const recs = useLive(async () => (await listRecommendations()).filter((r) => r.status === 'open').length, []);
  const exs = useLive(() => exerciseMap(), []);
  const ready = useLive(async () => (await listReadiness()).find((r) => r.record_date === today) ?? null, [today]);
  const bundles = useLive(() => activePrograms(), []);
  const [skipFor, setSkipFor] = useState<DayItem | null>(null);
  const [moveFor, setMoveFor] = useState<DayItem | null>(null);
  const [moveDate, setMoveDate] = useState(addDays(today, 1));
  const [anyOpen, setAnyOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function start(item: DayItem): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const s = await startScheduled(item.bundle.program.id, item.template.template_key, item.date, today);
      nav(`/workout/${s.id}`);
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }
  async function doSkip(reason: string): Promise<void> {
    if (!skipFor) return;
    try {
      await skipScheduled(skipFor.bundle.program.id, skipFor.template.template_key, skipFor.date, reason);
      const id = skipFor.template.template_key;
      ui.toast('Workout skipped — it stays in your history', { action: { label: 'Undo', run: () => void restoreAfterSkip(id) } });
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
    setSkipFor(null);
  }
  async function restoreAfterSkip(templateKey: string): Promise<void> {
    const item = (await planForDate(today)).find((i) => i.template.template_key === templateKey);
    if (item?.session) await restoreSessionToPlanned(item.session.id);
  }
  async function doMove(): Promise<void> {
    if (!moveFor) return;
    try {
      await rescheduleScheduled(moveFor.bundle.program.id, moveFor.template.template_key, moveFor.date, moveDate, null);
      ui.toast(`Moved to ${fmtDate(moveDate)}`, { tone: 'ok' });
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
    setMoveFor(null);
  }
  async function quick(): Promise<void> {
    const s = await startAdhoc('Quick workout', today);
    nav(`/workout/${s.id}`);
  }

  const greeting = profile?.display_name ? `, ${profile.display_name}` : '';
  const items = plan.data ?? [];
  const live = items.filter((i) => !i.session || !['skipped', 'rescheduled', 'cancelled'].includes(i.session.status));

  return (
    <div className="screen">
      <div className="page-title">
        <div className="grow"><div className="eyebrow">{fmtDate(today, { year: true })}</div><h1>Today{greeting}</h1></div>
        <SyncChip />
      </div>

      {auth.status !== 'signed_in' && auth.status !== 'loading' && auth.status !== 'unconfigured' && (
        <div className="mb-3" style={{ marginBottom: 12 }}><Banner icon="cloud" action={<Button small variant="soft" onClick={() => nav('/auth')}>Back up</Button>}><strong>Your data is only on this phone.</strong> Create a free account to back it up.</Banner></div>
      )}

      {active.data && (
        <Card tone="hl" className="mb-3" style={{ marginBottom: 12 }}>
          <div className="row-flex between"><div><div className="eyebrow">Workout in progress</div><div className="strong">{active.data.name}</div><div className="small dim num">{fmtClock(sessionTimes(active.data, new Date(now).toISOString()).activeMs)} active{active.data.paused_at ? ' · paused' : ''}</div></div>
            <Button variant="primary" icon="play" onClick={() => nav(`/workout/${active.data?.id}`)}>Resume</Button></div>
        </Card>
      )}

      {plan.loading ? <Loading /> : (
        <div className="col">
          {items.map((item) => <DayCard key={item.template.id} item={item} exName={(id) => exs.data?.get(id)?.name ?? '…'} busy={busy} onStart={() => void start(item)} onSkip={() => setSkipFor(item)} onMove={() => { setMoveDate(addDays(today, 1)); setMoveFor(item); }} onCustomize={() => nav(`/program/${item.bundle.program.id}/day/${item.template.template_key}?date=${item.date}&scope=day_week`)} onView={(id) => nav(`/history/${id}`)} onRepeat={async (id) => { const s = await repeatSession(id, today); nav(`/workout/${s.id}`); }} onRestore={async (id) => { await restoreSessionToPlanned(id); }} />)}
          {items.length === 0 && (
            <Card>
              <Empty icon="moon" title={bundles.data?.length ? 'Rest day' : 'No program yet'} hint={bundles.data?.length ? 'Recover, eat, sleep. Or train anyway — your call.' : 'Create a program, or start a quick workout to log sets right now.'}
                action={<div className="col"><Button variant="primary" block onClick={() => void quick()}>Start a quick workout</Button>{bundles.data?.length ? <Button block onClick={() => setAnyOpen(true)}>Train a program day anyway</Button> : <Button block onClick={() => nav('/program')}>Set up a program</Button>}</div>} />
            </Card>
          )}
          {live.length === 0 && items.length > 0 && <Button block variant="soft" onClick={() => void quick()}>Start a quick workout instead</Button>}
        </div>
      )}

      <Section title="This week">
        <Card className="pad-0"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: 12, gap: 6 }}>
          {(week.data ?? []).map((d) => {
            const done = d.items.some((i) => i.session && FINISHED.has(i.session.status));
            const skipped = d.items.some((i) => i.session && ['skipped', 'cancelled'].includes(i.session.status));
            const prog = d.items.some((i) => i.session?.status === 'in_progress');
            const rest = d.items.length === 0;
            return (
              <div key={d.date} className="center" aria-label={`${fmtDate(d.date)}: ${done ? 'done' : skipped ? 'skipped' : rest ? 'rest' : 'planned'}`}>
                <div className={`tiny ${d.date === today ? 'gold strong' : 'dim'}`}>{weekdayShort(isoWeekday(d.date))}</div>
                <div style={{ margin: '6px auto 0', width: 30, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${d.date === today ? 'var(--gold)' : 'var(--line)'}`, background: done ? 'var(--success)' : prog ? 'var(--gold)' : 'transparent', color: 'var(--on-gold)' }}>
                  {done ? <Icon name="check" size={18} /> : skipped ? <span style={{ color: 'var(--danger)' }}>×</span> : rest ? <span className="dim">·</span> : <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: 'var(--gold)', display: 'block' }} />}
                </div>
              </div>
            );
          })}
        </div></Card>
      </Section>

      {(upcoming.data?.length ?? 0) > 0 && (
        <Section title="Coming up"><Card className="pad-0"><div className="list">
          {upcoming.data?.map((u) => <div key={`${u.date}${u.template.id}`} className="item"><div style={{ minWidth: 64 }} className="gold strong">{fmtDate(u.date)}</div><div className="grow"><div className="small strong ellipsis">{u.template.name.split(' — ')[1] ?? u.template.name}</div><div className="tiny dim">{fmtMin(u.template.est_duration_min)}</div></div></div>)}
        </div></Card></Section>
      )}

      <Section title="Quick actions">
        <div className="chips wrap">
          <Chip onClick={() => void quick()}><Icon name="plus" size={16} /> Quick workout</Chip>
          <Chip onClick={() => setActivityOpen(true)}><Icon name="timer" size={16} /> Add activity</Chip>
          <Chip onClick={() => nav('/recovery')}><Icon name="moon" size={16} /> {ready.data ? 'Update readiness' : 'Check in'}</Chip>
          <Chip onClick={() => nav('/body')}><Icon name="scale" size={16} /> Bodyweight</Chip>
          <Chip onClick={() => nav('/search')}><Icon name="search" size={16} /> Search</Chip>
          {(recs.data ?? 0) > 0 && <Chip on onClick={() => nav('/progress/suggestions')}><Icon name="bolt" size={16} /> {plural(recs.data ?? 0, 'suggestion')}</Chip>}
        </div>
      </Section>

      <Section title="Recent" action={<Button small variant="ghost" onClick={() => nav('/history')}>All</Button>}>
        {(recent.data?.length ?? 0) === 0 ? <Card><Empty icon="history" title="No workouts yet" hint="Your first session will appear here." /></Card> : (
          <Card className="pad-0"><div className="list">{recent.data?.map((s) => <button key={s.id} className="item" type="button" onClick={() => nav(`/history/${s.id}`)}><div className="grow"><div className="strong ellipsis">{s.name}</div><div className="small dim">{fmtDate(s.session_date)}</div></div><StatusBadge status={s.status} /><Icon name="right" className="chev" size={20} /></button>)}</div></Card>
        )}
      </Section>

      <Sheet open={!!skipFor} onClose={() => setSkipFor(null)} title="Skip this workout?">
        <p className="dim small">It stays visible in your history as skipped — it is not counted as a zero-performance session.</p>
        <div className="chips wrap mt-3">{SKIP_REASONS.map((r) => <Chip key={r} onClick={() => void doSkip(r)}>{r}</Chip>)}</div>
      </Sheet>
      <Sheet open={!!moveFor} onClose={() => setMoveFor(null)} title="Move to another day" footer={<Button block variant="primary" onClick={() => void doMove()}>Move workout</Button>}>
        <p className="dim small">The original day is kept as “rescheduled” and the new day is planned.</p>
        <label className="label" htmlFor="move-date">New date</label>
        <input id="move-date" className="input" type="date" value={moveDate} min={addDays(today, -7)} onChange={(e) => setMoveDate(e.target.value)} />
      </Sheet>
      <ActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} today={today} />
      <Sheet open={anyOpen} onClose={() => setAnyOpen(false)} title="Train a program day">
        <div className="list">{bundles.data?.flatMap((b) => b.templates.filter((t) => t.program_version_id === b.versions[b.versions.length - 1]?.id).map((t) => (
          <button key={t.id} className="item" type="button" onClick={async () => { const s = await startScheduled(b.program.id, t.template_key, today, today); setAnyOpen(false); nav(`/workout/${s.id}`); }}>
            <div className="grow"><div className="strong">{t.name}</div><div className="small dim">{t.target_muscles.slice(0, 3).map(muscleLabel).join(' · ')}</div></div><Icon name="play" className="chev" size={20} /></button>)))}</div>
      </Sheet>
    </div>
  );
}

function DayCard({ item, exName, busy, onStart, onSkip, onMove, onCustomize, onView, onRepeat, onRestore }: {
  item: DayItem; exName: (id: string) => string; busy: boolean; onStart: () => void; onSkip: () => void; onMove: () => void; onCustomize: () => void;
  onView: (id: string) => void; onRepeat: (id: string) => Promise<void>; onRestore: (id: string) => Promise<void>;
}) {
  const s = item.session;
  const sets = item.planned.reduce((a, p) => a + p.sets, 0);
  const [title, rest] = item.template.name.split(' — ');
  const finished = s && FINISHED.has(s.status);
  const exercises = useLive(async () => (s && s.status !== 'planned' ? sessionExercises(s.id) : null), [s?.id, s?.status]);
  return (
    <Card tone="hl">
      <div className="row-flex between"><div className="eyebrow">{title ?? 'Workout'}</div>{s ? <StatusBadge status={s.status} /> : <Badge>{fmtMin(item.template.est_duration_min)}</Badge>}</div>
      <h2 className="mt-1">{rest ?? item.template.name}</h2>
      <div className="small dim mt-1">{plural(item.planned.length, 'exercise')} · {plural(sets, 'set')}{item.template.est_duration_min ? ` · ~${fmtMin(item.template.est_duration_min)}` : ''}</div>
      {item.template.notes && <div className="small gold mt-2">{item.template.notes}</div>}
      <div className="mt-3 col gap-1" style={{ gap: 6 }}>
        {item.planned.map((p) => (
          <div key={p.id} className="row-flex small" style={{ gap: 8 }}>
            <span className="gold strong" style={{ minWidth: 26 }}>{p.label}</span><span className="grow ellipsis">{exName(p.exercise_id)}</span><span className="dim num">{p.sets}×{p.reps_min === p.reps_max ? p.reps_min : `${p.reps_min}-${p.reps_max}`}</span>
          </div>
        ))}
      </div>
      {finished && exercises.data && <div className="small ok mt-3">Done · {exercises.data.reduce((a, v) => a + v.sets.filter((x) => x.status === 'completed' && !x.parent_set_id).length, 0)} sets logged</div>}
      <div className="col mt-4" style={{ gap: 8 }}>
        {(!s || s.status === 'planned') && <Button variant="primary" block icon="play" disabled={busy} onClick={onStart}>Start workout</Button>}
        {s?.status === 'in_progress' && <Button variant="primary" block icon="play" onClick={onStart}>Resume workout</Button>}
        {finished && <div className="row-flex"><Button block onClick={() => onView(s.id)}>View</Button><Button block onClick={() => void onRepeat(s.id)}>Repeat</Button></div>}
        {s && ['skipped', 'rescheduled', 'cancelled'].includes(s.status) && <div className="row-flex"><Button block onClick={() => void onRestore(s.id)}>Restore</Button><Button block variant="primary" onClick={onStart}>Start anyway</Button></div>}
        {(!s || s.status === 'planned') && <div className="row-flex"><Button small block onClick={onCustomize}>Customise</Button><Button small block onClick={onMove}>Move</Button><Button small block onClick={onSkip}>Skip</Button></div>}
      </div>
    </Card>
  );
}
