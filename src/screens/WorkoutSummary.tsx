import { useNavigate, useParams } from 'react-router-dom';
import { getSession, sessionExercises } from '@/data/repo/sessions';
import { exerciseInsight, listSessions, sessionSummaries } from '@/data/repo/history';
import { prsInSession, PR_LABELS } from '@/domain/records';
import { formatVolume, formatWeight } from '@/domain/units';
import { sessionTimes } from '@/domain/sessionState';
import { Badge, Button, Card, Empty, Loading, Section } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, plural, signed } from '@/ui/format';
import { StatusBadge } from '@/ui/status';

export function WorkoutSummary() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { unit, today } = useApp();
  const data = useLive(async () => {
    const session = await getSession(id);
    if (!session) return null;
    const views = await sessionExercises(id);
    const sum = (await sessionSummaries([id], today)).get(id);
    const prs = [];
    for (const v of views) {
      const ins = await exerciseInsight(v.exercise.id, today);
      if (ins) prs.push(...prsInSession(ins.prs, id).map((p) => ({ ...p, name: v.exercise.name })));
    }
    const earlier = (await listSessions({ programId: session.program_id ?? undefined, to: session.session_date, status: ['completed_as_planned', 'completed_modified', 'partial'] }, 12)).filter((s) => s.id !== id && s.template_key === session.template_key && session.template_key)[0];
    const prevSum = earlier ? (await sessionSummaries([earlier.id], today)).get(earlier.id) : undefined;
    return { session, views, sum, prs, earlier, prevSum };
  }, [id, today]);
  if (data.loading) return <div className="screen no-nav"><Loading /></div>;
  if (!data.data) return <div className="screen no-nav"><Empty icon="warn" title="Workout not found" action={<Button onClick={() => nav('/')}>Back to Today</Button>} /></div>;
  const { session, views, sum, prs, earlier, prevSum } = data.data;
  const t = sessionTimes(session, session.finished_at ?? new Date().toISOString());
  const dv = sum && prevSum && prevSum.volumeKg > 0 ? ((sum.volumeKg - prevSum.volumeKg) / prevSum.volumeKg) * 100 : null;
  return (
    <div className="screen no-nav">
      <div className="center mt-3"><Icon name="trophy" size={44} className="gold" /><h1 className="mt-2">Workout saved</h1><div className="dim">{session.name.split(' — ')[1] ?? session.name} · {fmtDate(session.session_date)}</div><div className="mt-2"><StatusBadge status={session.status} /></div></div>
      <div className="kpis mt-5">
        <div className="kpi"><div className="v">{sum?.workingSets ?? 0}</div><div className="l">working sets</div></div>
        <div className="kpi"><div className="v">{sum?.reps ?? 0}</div><div className="l">reps</div></div>
        <div className="kpi"><div className="v">{formatVolume(sum?.volumeKg ?? 0, unit)}</div><div className="l">volume load</div>{sum && sum.unknownVolumeSets > 0 && <div className="d warn">{plural(sum.unknownVolumeSets, 'set')} without a load not counted</div>}</div>
        <div className="kpi"><div className="v">{Math.round(t.activeMs / 60000)}</div><div className="l">active minutes</div></div>
      </div>
      {dv !== null && earlier && <Card className="mt-3"><div className="small dim">Compared with {fmtDate(earlier.session_date)}</div><div className="strong">Volume {signed(dv)}%</div></Card>}
      <Section title={prs.length ? 'New records' : 'Records'}>
        {prs.length === 0 ? <Card><p className="dim small">No new personal records this time. Consistency builds them.</p></Card> : (
          <Card className="pad-0"><div className="list">{prs.map((p) => (
            <div key={`${p.exercise_id}${p.type}`} className="item"><span className="sticker">PR</span><div className="grow"><div className="strong">{p.name}</div><div className="small dim">{PR_LABELS[p.type]}{p.estimated ? ' (estimated)' : ''}</div></div><div className="num strong gold">{p.type.includes('e1rm') || p.type === 'max_weight' || p.type === 'actual_1rm' ? formatWeight(p.value, unit) : Math.round(p.value)}</div></div>
          ))}</div></Card>
        )}
      </Section>
      <Section title="Exercises">
        <Card className="pad-0"><div className="list">{views.map((v) => {
          const done = v.sets.filter((x) => x.status === 'completed' && !x.parent_set_id && x.set_type !== 'warmup');
          return <div key={v.se.id} className="item"><div className="grow"><div className="strong">{v.exercise.name}</div><div className="small dim">{v.se.status === 'skipped' ? 'Skipped' : done.map((x) => (x.weight_kg !== null ? `${formatWeight(x.weight_kg, unit, false)}×${x.reps ?? '?'}` : `${x.reps ?? x.duration_s ?? '?'}`)).join('  ')}</div></div>{v.se.origin !== 'planned' && <Badge tone="info">{v.se.origin}</Badge>}</div>;
        })}</div></Card>
      </Section>
      <div className="col mt-5"><Button variant="primary" block onClick={() => nav('/', { replace: true })}>Done</Button><Button block onClick={() => nav(`/history/${id}`, { replace: true })}>View details</Button></div>
    </div>
  );
}
