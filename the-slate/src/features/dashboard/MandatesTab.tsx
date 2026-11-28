import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data/api';
import { useAgencies, useConfig, useMandateAgencies, useMandates, usePipeline, useSettings, useToday } from '../../data/hooks';
import { ACTIVITY_RANGES, agencyStats, agingBy, companyStats, criticalAttention, funnelSteps, mandateKpis, rejectDropStats, summarizeActivity, upcomingJoiners, withClocks, type ActivityRangeKey, type AgingBy } from '../../domain/analytics';
import { ActivityBars, BarList, FunnelChart, Kpi } from '../../ui/charts';
import { Chip, Empty, ErrorBox, Loading, Section, Select, Seg, Icon } from '../../ui/kit';
import { addDays } from '../../lib/time';
import { urgencyChip } from '../mandates/MandateCard';
import { JoinersTable } from './Joiners';

export function MandatesTab() {
  const nav = useNavigate(); const { settings } = useSettings(); const today = useToday(); const cfg = useConfig();
  const mq = useMandates(); const pq = usePipeline(); const aq = useAgencies(); const lq = useMandateAgencies();
  const [fm, setFm] = useState(''); const [aging, setAging] = useState<AgingBy>('company'); const [range, setRange] = useState<ActivityRangeKey>('30d');
  const funnel = useQuery({ queryKey: ['funnel', fm || 'all'], queryFn: () => api.funnel(fm || undefined) });
  const since = addDays(today, -365);
  const act = useQuery({ queryKey: ['activity', since], queryFn: () => api.activitySummary(`${since}T00:00:00+05:30`) });
  const rows = useMemo(() => withClocks(mq.data ?? [], { today, tz: settings.timezone, inactivityDays: settings.inactivityDays, nearCloseDays: settings.nearCloseDays }), [mq.data, today, settings]);
  const k = useMemo(() => mandateKpis(rows), [rows]);
  const attention = useMemo(() => criticalAttention(rows, { inactivityDays: settings.inactivityDays, limit: 8 }), [rows, settings.inactivityDays]);
  const companies = useMemo(() => companyStats(rows), [rows]);
  const ag = useMemo(() => agencyStats(rows, lq.data ?? [], aq.data ?? [], pq.data ?? []), [rows, lq.data, aq.data, pq.data]);
  const ages = useMemo(() => agingBy(rows, aging, lq.data ?? [], aq.data ?? []), [rows, aging, lq.data, aq.data]);
  const rd = useMemo(() => rejectDropStats(pq.data ?? []), [pq.data]);
  const joiners = useMemo(() => upcomingJoiners(pq.data ?? [], today, 30, settings.joiningAlertDays), [pq.data, today, settings.joiningAlertDays]);
  const timeline = useMemo(() => summarizeActivity((act.data ?? []).map((r) => ({ ...r, n: Number(r.n) })), today, range), [act.data, today, range]);
  const stageLabel = (key: string) => cfg.allStages.find((s) => s.key === key)?.label ?? key;
  if (mq.isLoading) return <Loading />; if (mq.error) return <ErrorBox error={mq.error} retry={() => mq.refetch()} />;
  const go = (view: string) => nav(`/mandates?view=${view}`);

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi n={k.total} label="Total mandates" onClick={() => go('all')} /><Kpi n={k.active} label="Active" tone="green" onClick={() => go('active')} /><Kpi n={k.onHold} label="On hold" tone="info" onClick={() => go('on_hold')} />
        <Kpi n={k.inactive} label="Inactive" tone="amber" onClick={() => go('inactive')} sub={`${settings.inactivityDays}+ days idle`} /><Kpi n={k.critical} label="Critical" tone="red" onClick={() => go('critical')} />
        <Kpi n={k.overdue} label="Overdue" tone="red" onClick={() => go('overdue')} /><Kpi n={k.closed} label="Closed" tone="grey" onClick={() => go('closed')} /><Kpi n={k.nearClose} label="Nearing close" tone="amber" onClick={() => go('near_close')} />
      </div>

      <Section title={<><Icon n="alert" /> Critical attention</>} sub="open mandates that need you now — worst first">
        {attention.length === 0 ? <div className="banner good">Nothing is stalled, overdue or empty. Every open mandate has recent activity.</div> :
          <div className="scroll-x"><table className="t"><thead><tr><th>Mandate</th><th>Priority</th><th>Why it needs attention</th><th className="num">Days open</th><th className="num">Idle</th><th className="num">Candidates</th></tr></thead>
            <tbody>{attention.map(({ mc, reasons }) => (
              <tr key={mc.m.id} className="click" onClick={() => nav(`/mandates/${mc.m.id}`)}><td><b>{mc.m.title}</b><div className="tiny gold">{mc.m.company_name}</div></td><td>{urgencyChip(mc.m.urgency)}</td>
                <td className="small">{reasons.map((r) => <div key={r}>• {r}</div>)}</td><td className="num">{mc.clock.daysOpen}</td><td className="num">{mc.clock.idleDays}d</td><td className="num">{mc.m.candidate_total}</td></tr>))}</tbody></table></div>}
      </Section>

      <div className="grid g2">
        <Section title="Conversion funnel" sub="from real candidate records" actions={<Select aria-label="Funnel scope" value={fm} onChange={(e) => setFm(e.target.value)} options={(mq.data ?? []).filter((m) => m.candidate_total > 0).map((m) => ({ value: m.id, label: `${m.title} — ${m.company_name ?? ''}` }))} placeholder="All mandates" />}>
          {funnel.isLoading ? <Loading /> : funnel.error ? <ErrorBox error={funnel.error} /> : <FunnelChart steps={funnelSteps(funnel.data ?? [])} onPick={(key) => nav(`/talent?stage=${key}${fm ? `&mandate=${fm}` : ''}`)} />}
          <div className="tiny muted" style={{ marginTop: 8 }}>Bars show candidates who ever reached each stage; % is the step conversion from the previous stage. Stages are configurable in Settings.</div>
        </Section>
        <Section title="Rejections & drop-outs" sub="two different events, tracked separately">
          <div className="grid g2"><Kpi n={rd.rejected} label="Rejected" tone="red" onClick={() => nav('/talent?status=rejected')} /><Kpi n={rd.dropped} label="Dropped out" tone="amber" onClick={() => nav('/talent?status=dropped')} /></div>
          <div className="grid g2" style={{ marginTop: 12 }}><div><div className="lbl" style={{ marginBottom: 6 }}>Rejection reasons</div><BarList tone="r" rows={rd.rejectionReasons.map((r) => ({ label: r.reason, n: r.count }))} /></div>
            <div><div className="lbl" style={{ marginBottom: 6 }}>Drop reasons</div><BarList rows={rd.dropReasons.map((r) => ({ label: r.reason, n: r.count }))} /></div></div>
          {rd.byMandate.length > 0 && <><div className="lbl" style={{ margin: '12px 0 6px' }}>By mandate</div><div className="scroll-x"><table className="t"><tbody>{rd.byMandate.slice(0, 6).map((b) => <tr key={b.mandate}><td className="small">{b.mandate}</td><td className="num"><span className="red">{b.rejected} rej</span></td><td className="num"><span style={{ color: 'var(--amber)' }}>{b.dropped} drop</span></td></tr>)}</tbody></table></div></>}
        </Section>
      </div>

      <div className="grid g2">
        <Section title="Company-wise" sub="mandates, status mix and progress">
          {companies.length === 0 ? <Empty title="No mandates" /> : <div className="scroll-x"><table className="t"><thead><tr><th>Company</th><th className="num">Mandates</th><th>Open vs closed</th><th className="num">Cands</th><th className="num">Sel</th><th className="num">Off</th><th className="num">Joined</th></tr></thead>
            <tbody>{companies.map((c) => (<tr key={c.company} className="click" onClick={() => nav(`/mandates?view=all&company=${encodeURIComponent(c.company)}`)}><td><b>{c.company}</b></td><td className="num">{c.mandates}</td>
              <td style={{ minWidth: 110 }}><div className="b-track" title={`${c.open} open · ${c.closed} closed`}><i style={{ width: `${(c.open / c.mandates) * 100}%` }} /><i className="g" style={{ width: `${(c.closed / c.mandates) * 100}%` }} /></div><div className="tiny muted">{c.open} open · {c.closed} closed</div></td>
              <td className="num">{c.candidates}</td><td className="num">{c.selected}</td><td className="num">{c.offered}</td><td className="num"><b className="gold">{c.joined}</b>/{c.positions}</td></tr>))}</tbody></table></div>}
        </Section>
        <Section title="Agency-wise" sub="assigned mandates and what they delivered">
          {ag.stats.length === 0 ? <Empty title="No mandates are shared with agencies or consultants yet" /> : <div className="scroll-x"><table className="t"><thead><tr><th>Agency / consultant</th><th className="num">Assigned</th><th className="num">Active</th><th className="num">Submitted</th><th className="num">Sel</th><th className="num">Off</th><th className="num">Joined</th><th className="num">Avg age</th></tr></thead>
            <tbody>{ag.stats.map((s) => <tr key={s.agencyId} className="click" onClick={() => nav(`/mandates?view=all&consultant=${encodeURIComponent(s.agency)}`)}><td><Chip tone="purple">{s.agency}</Chip></td><td className="num">{s.assigned}</td><td className="num">{s.active}</td><td className="num">{s.submitted}</td><td className="num">{s.selected}</td><td className="num">{s.offered}</td><td className="num"><b className="gold">{s.joined}</b></td><td className="num">{s.avgAging}d</td></tr>)}</tbody></table></div>}
          <div className="tiny muted" style={{ marginTop: 8 }}>Submitted/selected/joined count candidates whose source is the agency's name, or “Agency” on a mandate with exactly one agency.{ag.unattributed > 0 && ` ${ag.unattributed} “Agency”-sourced candidate(s) sit on mandates with several agencies and cannot be attributed.`}</div>
        </Section>
      </div>

      <Section title="Requirement aging" sub="open mandates: days since work started" actions={<Seg value={aging} onChange={setAging} options={[{ value: 'company', label: 'Company' }, { value: 'agency', label: 'Agency' }, { value: 'location', label: 'Location' }, { value: 'level', label: 'Hiring level' }, { value: 'mandate', label: 'Mandate' }]} />}>
        {ages.length === 0 ? <Empty title="No open mandates" /> : <div className="scroll-x"><table className="t"><thead><tr><th>{aging === 'level' ? 'Hiring level' : aging[0].toUpperCase() + aging.slice(1)}</th><th className="num">Open</th><th className="num">Avg days</th><th className="num">Oldest</th><th>0–15</th><th>16–30</th><th>31–60</th><th>60+</th></tr></thead>
          <tbody>{ages.map((a) => <tr key={a.label}><td>{a.label}</td><td className="num">{a.count}</td><td className="num"><b>{a.avgDays}</b></td><td className="num">{a.maxDays}</td><td>{a.b0 || ''}</td><td>{a.b16 || ''}</td><td style={{ color: 'var(--amber)' }}>{a.b31 || ''}</td><td className="red">{a.b61 || ''}</td></tr>)}</tbody></table></div>}
      </Section>

      <Section title="Recruitment activity" sub="what you actually did, from recorded events" actions={<Seg value={range} onChange={setRange} options={ACTIVITY_RANGES.map((r) => ({ value: r.key, label: r.label.replace('Last ', '') }))} />}>
        {act.isLoading ? <Loading /> : <div className="grid g2"><div><div className="row"><div className="kpi" style={{ minWidth: 120 }}><div className="n">{timeline.total}</div><div className="l">Actions</div></div><div className="grow"><ActivityBars data={timeline.byDay} /></div></div>
          <div className="tiny muted" style={{ marginTop: 6 }}>Page views are never counted — only substantive updates.</div></div>
          <BarList rows={timeline.byGroup.filter((g) => g.n > 0).sort((a, b) => b.n - a.n).map((g) => ({ label: g.label, n: g.n }))} /></div>}
      </Section>

      <Section title="Upcoming joining tracker" sub="next 30 days" actions={<span className="chip gold">{joiners.length}</span>}>
        <JoinersTable rows={joiners} stageLabel={stageLabel} />
      </Section>
    </div>
  );
}
