import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data/api';
import { K, useConfig, useMandates, usePipeline, useSettings, useToday } from '../../data/hooks';
import { ACTIVITY_RANGES, candidateStats, summarizeActivity, upcomingJoiners, type ActivityRangeKey } from '../../domain/analytics';
import { ActivityBars, BarList, Kpi } from '../../ui/charts';
import { ErrorBox, Loading, Section, Seg } from '../../ui/kit';
import { addDays } from '../../lib/time';
import { JoinersTable } from './Joiners';

export function CandidatesTab() {
  const nav = useNavigate(); const { settings } = useSettings(); const today = useToday(); const cfg = useConfig(); const mandates = useMandates(); const pq = usePipeline();
  const total = useQuery({ queryKey: [...K.candidates, 'count'], queryFn: api.candidateCount });
  const [range, setRange] = useState<ActivityRangeKey>('30d');
  const since = addDays(today, -365);
  const act = useQuery({ queryKey: ['activity', since], queryFn: () => api.activitySummary(`${since}T00:00:00+05:30`) });
  const pipeline = pq.data ?? [];
  const s = useMemo(() => candidateStats(pipeline, cfg.allStages), [pipeline, cfg.allStages]);
  const joiners = useMemo(() => upcomingJoiners(pipeline, today, 30, settings.joiningAlertDays), [pipeline, today, settings.joiningAlertDays]);
  const tl = useMemo(() => summarizeActivity((act.data ?? []).map((r) => ({ ...r, n: Number(r.n) })), today, range), [act.data, today, range]);
  const candActs = tl.byGroup.filter((g) => ['candidates', 'movement', 'interviews', 'comments', 'documents'].includes(g.key));
  const mandateByLabel = useMemo(() => new Map((mandates.data ?? []).map((m) => [`${m.title}${m.company_name ? ' — ' + m.company_name : ''}`, m.id])), [mandates.data]);
  const stageLabel = (key: string) => cfg.allStages.find((x) => x.key === key)?.label ?? key;
  if (pq.isLoading) return <Loading />; if (pq.error) return <ErrorBox error={pq.error} retry={() => pq.refetch()} />;
  const st = (x: string) => s.byStatus[x] ?? 0;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi n={total.data ?? '…'} label="Total candidates" onClick={() => nav('/talent')} sub={`${s.people} in a pipeline`} /><Kpi n={st('selected')} label="Selected" tone="green" onClick={() => nav('/talent?status=selected')} />
        <Kpi n={st('offered')} label="Offered" tone="green" onClick={() => nav('/talent?status=offered')} /><Kpi n={st('joined')} label="Joined" onClick={() => nav('/talent?status=joined')} />
        <Kpi n={st('rejected')} label="Rejected" tone="red" onClick={() => nav('/talent?status=rejected')} /><Kpi n={st('dropped')} label="Dropped out" tone="amber" onClick={() => nav('/talent?status=dropped')} /><Kpi n={joiners.length} label="Joining ≤ 30 days" tone="info" />
      </div>
      <div className="grid g2">
        <Section title="Candidates by recruitment stage" sub="click a bar to see them"><BarList rows={s.byStage.filter((x) => x.n > 0).map((x) => ({ label: x.label, n: x.n }))} onPick={(label) => { const key = s.byStage.find((x) => x.label === label)?.key; nav(`/talent?stage=${key}`); }} /></Section>
        <Section title="Source-wise distribution"><BarList tone="g" rows={s.bySource} onPick={(l) => nav(`/talent?source=${encodeURIComponent(l)}`)} /></Section>
        <Section title="Company-wise distribution" sub="by the mandate's company"><BarList rows={s.byCompany} onPick={(l) => nav(`/mandates?view=all&company=${encodeURIComponent(l)}`)} /></Section>
        <Section title="Mandate-wise distribution"><BarList tone="p" rows={s.byMandate.slice(0, 12)} onPick={(l) => { const id = mandateByLabel.get(l); if (id) nav(`/talent?mandate=${id}`); }} /></Section>
      </div>
      <Section title="Candidate activity" sub="from recorded events" actions={<Seg value={range} onChange={setRange} options={ACTIVITY_RANGES.map((r) => ({ value: r.key, label: r.label.replace('Last ', '') }))} />}>
        {act.isLoading ? <Loading /> : <div className="grid g2"><div><ActivityBars data={tl.byDay} /><div className="tiny muted" style={{ marginTop: 6 }}>Actions per day · {tl.total} in total</div></div><BarList tone="g" rows={candActs.filter((g) => g.n > 0).map((g) => ({ label: g.label, n: g.n }))} /></div>}
      </Section>
      <Section title="Upcoming joiners" sub="next 30 days" actions={<span className="chip gold">{joiners.length}</span>}><JoinersTable rows={joiners} stageLabel={stageLabel} /></Section>
    </div>
  );
}
