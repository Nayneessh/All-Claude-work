import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useWorld } from '@/app/hooks';
import { IS_CLOUD, useRuntime } from '@/app/runtime';
import { DEMO_USERS, seedDemo } from '@/data/demo';
import { can } from '@/domain/permissions';
import { STATUS_LABEL, type MandateStatus, type ScreeningStatus } from '@/domain/types';
import { dashboard, type DashFilters } from '@/services/analytics';
import { dashboardWorkbook } from '@/services/exports';
import { BarList, Card, Chip, Empty, JobChip, Kpi, PageHead, StatusChip, useAction } from '@/ui/kit';
import { download, fmtDateTime } from '@/ui/format';

const ORDER: ScreeningStatus[] = ['exceptional_match', 'strong_match', 'potential_match', 'borderline_review', 'verification_required', 'manual_review', 'below_threshold', 'mandatory_non_compliance'];

export function Dashboard(): ReactNode {
  const w = useWorld();
  const rt = useRuntime();
  const act = useAction();
  const [f, setF] = useState<DashFilters>({ mandateStatus: 'all' });
  const data = useMemo(() => dashboard({ ...w, audit: w.audit }, f), [w, f]);
  const depts = w.departments.filter((d) => !f.entityId || d.entityId === f.entityId);
  const set = (p: Partial<DashFilters>): void => setF((x) => ({ ...x, ...p }));

  if (!w.mandates.length && !w.loading) {
    return (
      <>
        <PageHead title="Executive Dashboard" sub="Recruitment visibility across your business entities." />
        <Card><Empty title="No hiring mandates yet">
          <p>Create a mandate, approve its screening rubric, then upload CVs.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            {rt.ctx && can(rt.ctx.user.role, 'mandate.write') && <Link className="btn primary" to="/mandates/new">Create a mandate</Link>}
            {!IS_CLOUD && <button className="btn" onClick={() => void act(async () => { await seedDemo({ ...rt.ctx!, user: DEMO_USERS[0] }); }, 'Demo data loaded: 3 mandates and 10 synthetic CVs screened.')}>Load demo data</button>}
          </div>
        </Empty></Card>
      </>
    );
  }

  const strongest = [...data.byMandate].filter((m) => m.best !== null).sort((a, b) => (b.best ?? 0) - (a.best ?? 0));
  return (
    <>
      <PageHead title="Executive Dashboard" sub="Which mandates are open, how many CVs are in, who qualifies, and where the pipeline is strong or thin."
        actions={<button className="btn" onClick={() => void act(async () => download(await dashboardWorkbook(data), 'recruitment-dashboard.xlsx'))}>Export Excel</button>} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="form-grid" role="group" aria-label="Filters">
          <div className="field"><label htmlFor="fe">Company / entity</label><select id="fe" className="select" value={f.entityId ?? ''} onChange={(e) => set({ entityId: e.target.value || undefined, departmentId: undefined })}><option value="">All entities</option>{w.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <div className="field"><label htmlFor="fd">Department</label><select id="fd" className="select" value={f.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || undefined })}><option value="">All departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="field"><label htmlFor="fs">Mandate status</label><select id="fs" className="select" value={f.mandateStatus} onChange={(e) => set({ mandateStatus: e.target.value as MandateStatus | 'all' })}><option value="all">All</option><option value="open">Open</option><option value="on_hold">On hold</option><option value="closed">Closed</option><option value="archived">Archived</option></select></div>
          <div className="field"><label htmlFor="ff">From</label><input id="ff" type="date" className="input" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></div>
          <div className="field"><label htmlFor="ft">To</label><input id="ft" type="date" className="input" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></div>
        </div>
      </div>

      <div className="grid g5" style={{ marginBottom: 14 }}>
        <Kpi label="Active mandates" value={data.mandateCounts.active} />
        <Kpi label="On-hold mandates" value={data.mandateCounts.onHold} />
        <Kpi label="Closed mandates" value={data.mandateCounts.closed} />
        <Kpi label="CVs received" value={data.cvsReceived} />
        <Kpi label="CVs screened" value={data.cvsScreened} sub={data.cvsReceived ? `${Math.round((data.cvsScreened / data.cvsReceived) * 100)}% of received` : undefined} />
        <Kpi label="Qualified candidates" value={data.qualified} sub="75+ with all mandatory gates passed" />
        <Kpi label="Awaiting review" value={data.awaitingReview} sub="borderline, verification, manual review, OCR" />
        <Kpi label="Average score" value={data.averageScore ?? '—'} sub="mandate-specific, out of 100" />
        <Kpi label="Top score" value={data.top[0]?.assessment.score.total ?? '—'} sub={data.top[0]?.candidate.name} />
        <Kpi label="Needs attention" value={data.alerts.failed.length + data.alerts.needsReview.length} sub="failed or needs-review files" />
      </div>

      <div className="split">
        <div className="stack">
          <Card title="Pipeline by business entity" flush>
            {data.byEntity.length ? (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Entity</th><th className="num">Mandates</th><th className="num">CVs</th><th className="num">Screened</th><th className="num">Qualified</th></tr></thead>
                <tbody>{data.byEntity.map((e) => <tr key={e.entity.id}><td>{e.entity.name}</td><td className="num">{e.mandates}</td><td className="num">{e.cvs}</td><td className="num">{e.screened}</td><td className="num">{e.qualified}</td></tr>)}</tbody></table></div>
            ) : <Empty title="No pipeline data for these filters" />}
          </Card>

          <Card title="Mandate pipelines — strongest first" flush>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Mandate</th><th>Status</th><th className="num">CVs</th><th className="num">Qualified</th><th className="num">Avg</th><th className="num">Best</th></tr></thead>
              <tbody>{[...strongest, ...data.byMandate.filter((m) => m.best === null)].map(({ mandate: m, cvs, qualified, avg, best }) => (
                <tr key={m.id}><td><Link to={`/mandates/${m.id}`}>{m.code}</Link> {m.title}<div className="muted small">{w.entities.find((e) => e.id === m.entityId)?.name}</div></td>
                  <td><Chip tone={m.status === 'open' ? 'ok' : m.status === 'on_hold' ? 'caution' : 'neutral'}>{m.status.replace('_', ' ')}</Chip></td>
                  <td className="num">{cvs}</td><td className="num">{qualified}</td><td className="num">{avg ?? '—'}</td><td className="num">{best ?? '—'}</td></tr>))}</tbody></table></div>
          </Card>

          <Card title="Outcome mix (latest assessment per candidate and mandate)">
            <BarList rows={ORDER.map((s) => ({ name: STATUS_LABEL[s], value: data.statusMix[s] }))} tone="green" />
          </Card>
        </div>

        <div className="stack">
          <Card title="Top candidates">
            {data.top.length ? <div className="stack">{data.top.map((r) => (
              <div key={r.assessment.id} className="spread"><div><Link to={`/assessments/${r.assessment.id}`}>{r.candidate.name}</Link><div className="muted small">{r.candidate.currentDesignation ?? '—'} · {r.mandate.code}</div></div>
                <div style={{ textAlign: 'right' }}><div className="score">{r.assessment.score.total}</div><StatusChip status={r.status} /></div></div>))}</div> : <Empty title="No qualified candidates yet" />}
          </Card>

          <Card title="Alerts">
            <div className="stack">
              {data.alerts.failed.map((j) => <div key={j.id} className="callout bad small"><b>{j.fileName}</b> <JobChip status="failed" /><div>{j.error}</div></div>)}
              {data.alerts.needsReview.map((j) => <div key={j.id} className="callout warn small"><b>{j.fileName}</b> <JobChip status="needs_review" /><div>{j.error ?? 'Needs review'} — <Link to="/upload">open the queue</Link></div></div>)}
              {data.alerts.pendingReview.slice(0, 5).map((r) => <div key={r.assessment.id} className="callout info small"><Link to={`/assessments/${r.assessment.id}`}>{r.candidate.name}</Link> — <StatusChip status={r.status} /></div>)}
              {!data.alerts.failed.length && !data.alerts.needsReview.length && !data.alerts.pendingReview.length && <p className="muted small">Nothing needs attention.</p>}
            </div>
          </Card>

          {data.recent.length > 0 && (
            <Card title="Recent activity">
              <div className="stack small">{data.recent.slice(0, 7).map((a) => <div key={a.id}><span className="muted">{fmtDateTime(a.at)}</span><br />{a.summary.slice(0, 140)}</div>)}</div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
