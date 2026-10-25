import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadDashboard } from '@/data/repo/dashboard';
import type { RangeKey } from '@/domain/periods';
import { addDays } from '@/domain/periods';
import { exerciseVolume, inPeriod, muscleStats } from '@/domain/analytics';
import { GROUP_LABELS, GROUP_ORDER, groupOf, type MuscleGroup } from '@/domain/muscles';
import { PR_LABELS } from '@/domain/records';
import { formatVolume, formatWeight } from '@/domain/units';
import { Badge, Button, Card, Empty, Loading, Section } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { StatusBadge } from '@/ui/status';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, plural, signed } from '@/ui/format';
import { sessionSummaries } from '@/data/repo/history';
import type { WorkoutSession } from '@/domain/types';

const OUTCOME_TONE = { done: 'ok', rescheduled_done: 'ok', partial: 'warn', skipped: 'bad', missed: 'bad', pending: 'dim' } as const;

/** Every metric on the dashboard opens here, listing the stored records it was computed from. */
export function Drill() {
  const { type = '', id = 'all' } = useParams();
  const [sp] = useSearchParams();
  const range = (sp.get('r') as RangeKey | null) ?? '8w';
  const nav = useNavigate();
  const { today, unit } = useApp();
  const d = useLive(() => loadDashboard(range, today), [range, today]);
  const dash = d.data;
  const performed = (dash?.sessions ?? []).filter((s) => ['completed_as_planned', 'completed_modified', 'partial'].includes(s.status)) as unknown as WorkoutSession[];
  const sums = useLive(() => sessionSummaries(performed.map((s) => s.id), today), [dash]);
  const title = type === 'week' ? `Week of ${fmtDate(id, { year: true })}` : type === 'muscle' ? (id === 'all' ? 'Sets by muscle group' : GROUP_LABELS[id as MuscleGroup] ?? 'Muscle group') : type === 'sessions' ? 'Planned vs done' : type === 'volume' ? 'Volume by session' : type === 'prs' ? 'Records' : 'Details';
  if (d.loading || !dash) return <div className="screen"><Loading /></div>;
  const back = (
    <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><div className="grow"><div className="eyebrow">{fmtDate(dash.from)} – {fmtDate(dash.to, { year: true })}</div><h1>{title}</h1></div></div>
  );

  if (type === 'sessions') {
    return (
      <div className="screen">{back}
        <Card className="pad-0"><div className="list">{[...dash.results].sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => (
          <button key={`${r.date}${r.template_key}`} type="button" className="item" disabled={!r.session_id} onClick={() => r.session_id && nav(`/history/${r.session_id}`)}><span className="gold strong" style={{ minWidth: 76 }}>{fmtDate(r.date)}</span><span className="grow small dim">{r.outcome === 'rescheduled_done' ? 'Done on another day' : ''}</span><Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome.replace('_', ' ')}</Badge></button>
        ))}{dash.results.length === 0 && <div className="item dim">No scheduled workouts in this range.</div>}</div></Card>
        <p className="tiny dim mt-3">Today and future days are “pending” and never count against you. Skipped and missed sessions count as planned-but-not-done.</p>
      </div>
    );
  }

  if (type === 'week') {
    const wk = inPeriod(dash.sets, id, addDays(id, 6));
    const ss = performed.filter((s) => s.session_date >= id && s.session_date <= addDays(id, 6));
    const ex = exerciseVolume(wk, dash.ctx);
    const mu = muscleStats(wk, dash.ctx, 'direct');
    return (
      <div className="screen">{back}
        <Section title="Sessions"><Card className="pad-0"><div className="list">{ss.map((s) => <button key={s.id} className="item" type="button" onClick={() => nav(`/history/${s.id}`)}><div className="grow"><div className="strong">{s.name.split(' — ')[1] ?? s.name}</div><div className="small dim">{fmtDate(s.session_date)} · {sums.data?.get(s.id) ? `${sums.data.get(s.id)?.workingSets} sets · ${formatVolume(sums.data.get(s.id)?.volumeKg ?? 0, unit)}` : ''}</div></div><StatusBadge status={s.status} /></button>)}{ss.length === 0 && <div className="item dim">No workouts logged this week.</div>}</div></Card></Section>
        <Section title="Exercise volume"><Card className="pad-0"><div className="list">{ex.map((e) => <button key={e.exercise_id} type="button" className="item" onClick={() => nav(`/exercises/${e.exercise_id}`)}><div className="grow"><div className="strong">{e.name}</div><div className="small dim">{plural(e.workingSets, 'set')} · {e.reps} reps{e.unknownVolumeSets ? ` · ${e.unknownVolumeSets} without load` : ''}</div></div><div className="num gold strong">{formatVolume(e.volumeKg, unit)}</div></button>)}</div></Card></Section>
        <Section title="Muscle groups (direct sets)"><Card>{mu.map((m) => <div key={m.group} className="row-flex between small" style={{ padding: '4px 0' }}><span>{GROUP_LABELS[m.group]}</span><span className="num">{m.sets} sets · {m.sessionDays} d</span></div>)}{mu.length === 0 && <span className="dim small">Nothing logged.</span>}</Card></Section>
      </div>
    );
  }

  if (type === 'muscle') {
    const groups = id === 'all' ? GROUP_ORDER : [id as MuscleGroup];
    if (id === 'all') {
      const mu = muscleStats(dash.sets, dash.ctx, 'direct');
      return (
        <div className="screen">{back}
          <Card className="pad-0"><div className="list">{mu.map((m) => <button key={m.group} type="button" className="item" onClick={() => nav(`/progress/drill/muscle/${m.group}?r=${range}`)}><div className="grow"><div className="strong">{GROUP_LABELS[m.group]}</div><div className="small dim">{m.sessionDays} training days · last {m.lastDate ? fmtDate(m.lastDate) : '—'}</div></div><div className="num strong gold">{m.sets} sets</div><div className="small dim num" style={{ minWidth: 70, textAlign: 'right' }}>{m.reps} reps</div></button>)}{mu.length === 0 && <div className="item dim">No sets in range.</div>}</div></Card>
        </div>
      );
    }
    const rows = exerciseVolume(dash.sets.filter((s) => { const e = dash.ctx.exercises.get(s.exercise_id); return !!e && [...e.primary_muscles].some((m) => groupOf(m) === groups[0]); }), dash.ctx);
    return (
      <div className="screen">{back}
        <Card className="pad-0"><div className="list">{rows.map((e) => <button key={e.exercise_id} type="button" className="item" onClick={() => nav(`/exercises/${e.exercise_id}`)}><div className="grow"><div className="strong">{e.name}</div><div className="small dim">{plural(e.workingSets, 'set')} · {e.reps} reps</div></div><div className="num gold strong">{formatVolume(e.volumeKg, unit)}</div></button>)}{rows.length === 0 && <div className="item dim">No direct work for this muscle group in range.</div>}</div></Card>
        <p className="tiny dim mt-3">Exercises where this group is a primary muscle.</p>
      </div>
    );
  }

  if (type === 'volume') {
    const ranked = [...performed].sort((a, b) => (sums.data?.get(b.id)?.volumeKg ?? 0) - (sums.data?.get(a.id)?.volumeKg ?? 0));
    return (
      <div className="screen">{back}
        <Section title="Sessions, biggest first"><Card className="pad-0"><div className="list">{ranked.map((s) => <button key={s.id} className="item" type="button" onClick={() => nav(`/history/${s.id}`)}><div className="grow"><div className="strong ellipsis">{s.name.split(' — ')[1] ?? s.name}</div><div className="small dim">{fmtDate(s.session_date)} · {plural(sums.data?.get(s.id)?.workingSets ?? 0, 'set')}</div></div><div className="num gold strong">{formatVolume(sums.data?.get(s.id)?.volumeKg ?? 0, unit)}</div></button>)}{ranked.length === 0 && <div className="item dim">No sessions in range.</div>}</div></Card></Section>
        <Section title="By exercise"><Card className="pad-0"><div className="list">{dash.topExercises.map((e) => <button key={e.exercise_id} className="item" type="button" onClick={() => nav(`/exercises/${e.exercise_id}`)}><div className="grow strong">{e.name}</div><div className="num gold strong">{formatVolume(e.volumeKg, unit)}</div></button>)}</div></Card></Section>
      </div>
    );
  }

  if (type === 'prs') {
    return (
      <div className="screen">{back}
        {dash.prs.length === 0 ? <Card><Empty icon="trophy" title="No new records in this range" hint="The first logged result of a lift is its baseline; beat it and the record appears here." /></Card> : (
          <Card className="pad-0"><div className="list">{dash.prs.map((p) => <button key={`${p.set_id}${p.type}`} type="button" className="item" onClick={() => nav(`/history/${p.session_id}`)}><span className="sticker">PR</span><div className="grow"><div className="strong">{dash.ctx.exercises.get(p.exercise_id)?.name}</div><div className="small dim">{PR_LABELS[p.type]}{p.estimated ? ' (estimated)' : ''} · {fmtDate(p.date, { year: true })}{p.previous_value !== null ? ` · was ${['max_weight', 'best_e1rm', 'actual_1rm', 'max_set_volume'].includes(p.type) ? formatWeight(p.previous_value, unit) : Math.round(p.previous_value)}` : ''}{p.improvement_pct !== null ? ` (${signed(p.improvement_pct, 1)}%)` : ''}</div></div><div className="num gold strong">{['max_weight', 'best_e1rm', 'actual_1rm', 'max_set_volume'].includes(p.type) ? formatWeight(p.value, unit) : Math.round(p.value)}</div></button>)}</div></Card>
        )}
      </div>
    );
  }

  if (type === 'exercise') return <Navigate to={`/exercises/${id}`} replace />;
  return <div className="screen">{back}<Empty icon="warn" title="Nothing to show" action={<Button onClick={() => nav('/progress')}>Back to Progress</Button>} /></div>;
}
