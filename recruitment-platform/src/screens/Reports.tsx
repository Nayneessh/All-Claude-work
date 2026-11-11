import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useWorld } from '@/app/hooks';
import { dashboard } from '@/services/analytics';
import { effectiveStatus } from '@/services/decisions';
import { assessmentPdf, dashboardWorkbook, screeningWorkbook } from '@/services/exports';
import { STATUS_LABEL } from '@/domain/types';
import { BarList, Card, Empty, PageHead, StatusChip, useAction } from '@/ui/kit';
import { download, fmtDateTime, slug } from '@/ui/format';

const csvCell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function Reports(): ReactNode {
  const w = useWorld();
  const act = useAction();
  const [mandateId, setMandateId] = useState('');
  const [assessId, setAssessId] = useState('');
  const mid = mandateId || w.mandates.find((m) => w.rows.some((r) => r.mandate.id === m.id))?.id || '';
  const mandate = w.mandates.find((m) => m.id === mid);
  const mrows = w.rows.filter((r) => r.mandate.id === mid);
  const aid = assessId || mrows[0]?.assessment.id || '';

  const dist = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({ name: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`, value: 0 }));
    for (const r of w.rows) bins[Math.min(9, Math.floor(r.assessment.score.total / 10))].value++;
    return bins;
  }, [w.rows]);

  const history = [...w.assessments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const exportHistory = (): void => {
    const head = ['Assessed', 'Candidate', 'Mandate', 'Assessment v', 'Rubric v', 'Mandate v', 'Score', 'AI status', 'Status in force', 'Engine', 'Prompt'];
    const lines = history.map((a) => {
      const c = w.candidates.find((x) => x.id === a.candidateId);
      const m = w.mandates.find((x) => x.id === a.mandateId);
      return [a.createdAt, c?.name, m?.code, a.version, a.rubricVersion, a.mandateVersion, a.score.total, STATUS_LABEL[a.status], STATUS_LABEL[effectiveStatus(a, w.decisions)], `${a.provider.id}/${a.provider.model}`, a.provider.promptVersion].map(csvCell).join(',');
    });
    download(new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' }), 'screening-history.csv');
  };

  return (
    <>
      <PageHead title="Reports & Analytics" sub="Exports for recruiters and management. PDF and Excel; every report states that statuses are internal screening outcomes, not hiring decisions." />
      <div className="grid g2" style={{ marginBottom: 14 }}>
        <Card title="Mandate-wise candidate screening (Excel)">
          <div className="stack"><div className="field"><label htmlFor="rm">Mandate</label><select id="rm" className="select" value={mid} onChange={(e) => { setMandateId(e.target.value); setAssessId(''); }}>{w.mandates.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}</select></div>
            <div><button className="btn primary" disabled={!mandate || !mrows.length} onClick={() => void act(async () => download(await screeningWorkbook({ mandate: mandate!, rows: mrows, rubric: w.rubrics.find((r) => r.id === mandate!.activeRubricId) }), `${slug(mandate!.code)}-screening.xlsx`))}>Download Excel</button> <Link className="btn" to={`/compare?mandate=${mid}`}>Candidate comparison…</Link></div></div>
        </Card>
        <Card title="Candidate assessment report (PDF)">
          <div className="stack"><div className="field"><label htmlFor="ra">Candidate (for the mandate selected on the left)</label><select id="ra" className="select" value={aid} onChange={(e) => setAssessId(e.target.value)}>{mrows.map((r) => <option key={r.assessment.id} value={r.assessment.id}>{r.candidate.name} — {r.assessment.score.total}</option>)}</select></div>
            <div><button className="btn primary" disabled={!aid} onClick={() => void act(async () => {
              const r = mrows.find((x) => x.assessment.id === aid)!; const rub = w.rubrics.find((x) => x.id === r.assessment.rubricId)!;
              download(await assessmentPdf({ mandate: r.mandate, rubric: rub, candidate: r.candidate, assessment: r.assessment, status: r.status, decisions: w.decisions.filter((d) => d.assessmentId === aid) }), `${slug(r.candidate.name)}-${slug(r.mandate.code)}.pdf`);
            })}>Download PDF</button></div></div>
        </Card>
        <Card title="Entity-wise recruitment dashboard (Excel)"><p className="muted small" style={{ marginBottom: 10 }}>Mandates, CVs, screened and qualified counts by business entity and mandate.</p><button className="btn primary" onClick={() => void act(async () => download(await dashboardWorkbook(dashboard(w)), 'recruitment-dashboard.xlsx'))}>Download Excel</button></Card>
        <Card title="Screening history (CSV)"><p className="muted small" style={{ marginBottom: 10 }}>Every assessment ever produced, with mandate, rubric and assessment versions, model and prompt version, and the status in force.</p><button className="btn primary" disabled={!history.length} onClick={exportHistory}>Download CSV</button></Card>
      </div>

      <div className="grid g2">
        <Card title="Score distribution (latest assessment per candidate and mandate)"><BarList rows={dist} /><p className="muted small" style={{ marginTop: 10 }}>Measure extraction accuracy and assessment quality separately: these distributions describe scores, not correctness.</p></Card>
        <Card title="Future reports (Phase 2–3)"><ul className="small muted" style={{ margin: '0 0 0 18px', padding: 0 }}><li>Management reports and pipeline trends</li><li>Historical candidate-quality analysis</li><li>Hiring-manager feedback and rubric calibration</li><li>Predictive analytics — only once enough validated historical data exists</li></ul></Card>
      </div>

      <div style={{ height: 14 }} />
      <Card title="Screening history" flush>
        {history.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Candidate</th><th>Mandate</th><th className="num">Score</th><th>Status in force</th><th>Versions</th></tr></thead><tbody>
          {history.slice(0, 40).map((a) => { const c = w.candidates.find((x) => x.id === a.candidateId); const m = w.mandates.find((x) => x.id === a.mandateId); return <tr key={a.id}><td className="small">{fmtDateTime(a.createdAt)}</td><td><Link to={`/assessments/${a.id}`}>{c?.name ?? '—'}</Link></td><td>{m?.code}</td><td className="num score">{a.score.total}</td><td><StatusChip status={effectiveStatus(a, w.decisions)} /></td><td className="small">assessment v{a.version} · rubric v{a.rubricVersion} · mandate v{a.mandateVersion}</td></tr>; })}
        </tbody></table></div> : <Empty title="No assessments yet" />}
      </Card>
    </>
  );
}
