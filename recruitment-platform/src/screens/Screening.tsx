import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorld } from '@/app/hooks';
import { NEEDS_HUMAN, QUALIFIED, STATUS_LABEL, type ScreeningStatus } from '@/domain/types';
import { screeningWorkbook } from '@/services/exports';
import { Card, Chip, Empty, Kpi, PageHead, StatusChip, useAction } from '@/ui/kit';
import { download, slug } from '@/ui/format';

const FILTERS: { id: string; label: string; test: (s: ScreeningStatus) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'qualified', label: 'Qualified (75+, gates passed)', test: (s) => QUALIFIED.has(s) },
  { id: 'review', label: 'Needs a person', test: (s) => NEEDS_HUMAN.has(s) },
  { id: 'below', label: 'Below threshold', test: (s) => s === 'below_threshold' },
  { id: 'mnc', label: 'Mandatory non-compliance', test: (s) => s === 'mandatory_non_compliance' },
];

export function Screening(): ReactNode {
  const w = useWorld();
  const nav = useNavigate();
  const act = useAction();
  const [sp, setSp] = useSearchParams();
  const mandateId = sp.get('mandate') ?? w.mandates.find((m) => w.rows.some((r) => r.mandate.id === m.id))?.id ?? w.mandates[0]?.id ?? '';
  const mandate = w.mandates.find((m) => m.id === mandateId);
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState<string[]>([]);
  const rubric = w.rubrics.find((r) => r.id === mandate?.activeRubricId);
  const rows = useMemo(() => w.rows.filter((r) => r.mandate.id === mandateId).filter((r) => FILTERS.find((f) => f.id === filter)!.test(r.status)).sort((a, b) => b.assessment.score.total - a.assessment.score.total), [w.rows, mandateId, filter]);
  const all = w.rows.filter((r) => r.mandate.id === mandateId);
  const toggle = (id: string): void => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));

  return (
    <>
      <PageHead title="AI Screening" sub="Ranked, explainable screening outcomes per mandate. Scores are computed by code from evidence-backed ratings; people decide what happens next."
        actions={mandate && all.length > 0 && <button className="btn" onClick={() => void act(async () => download(await screeningWorkbook({ mandate, rows: all, rubric }), `${slug(mandate.code)}-screening.xlsx`))}>Export Excel</button>} />
      <div className="card" style={{ marginBottom: 14 }}><div className="form-grid">
        <div className="field"><label htmlFor="sm">Mandate</label><select id="sm" className="select" value={mandateId} onChange={(e) => { setSp({ mandate: e.target.value }); setSel([]); }}>{w.mandates.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}</select></div>
        <div className="field"><label htmlFor="sf">Show</label><select id="sf" className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>{FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
      </div></div>
      {mandate && (
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Kpi label="Screened" value={all.length} /><Kpi label="Qualified" value={all.filter((r) => QUALIFIED.has(r.status)).length} sub={`threshold ${rubric?.policy.threshold ?? 75}`} />
          <Kpi label="Needs a person" value={all.filter((r) => NEEDS_HUMAN.has(r.status)).length} sub="borderline · verification · manual" />
          <Kpi label="Best score" value={all.length ? Math.max(...all.map((r) => r.assessment.score.total)) : '—'} />
        </div>
      )}
      <Card title={mandate ? `${mandate.code} — ${mandate.title}` : 'Candidates'} actions={sel.length >= 2 ? <button className="btn primary sm" onClick={() => nav(`/compare?mandate=${mandateId}&ids=${sel.join(',')}`)}>Compare {sel.length}</button> : <span className="muted small">Select 2–5 to compare</span>} flush>
        {rows.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th style={{ width: 36 }} /><th>#</th><th>Candidate</th><th className="num">Score</th><th>Status</th><th>Mandatory gates</th><th>Top concern</th></tr></thead><tbody>
          {rows.map((r, i) => {
            const a = r.assessment;
            const failed = a.gates.filter((g) => g.status === 'fail').length;
            const unclear = a.gates.filter((g) => g.status === 'needs_verification').length;
            const overridden = r.status !== a.status;
            return <tr key={a.id}>
              <td><input type="checkbox" aria-label={`Select ${r.candidate.name} to compare`} checked={sel.includes(a.id)} onChange={() => toggle(a.id)} /></td>
              <td className="muted">{i + 1}</td>
              <td><Link to={`/assessments/${a.id}`}><b>{r.candidate.name}</b></Link><div className="muted small">{r.candidate.currentDesignation ?? '—'}{r.candidate.currentCompany ? `, ${r.candidate.currentCompany}` : ''} · {r.candidate.totalExperienceYears ?? '?'} yrs</div></td>
              <td className="num"><span className="score">{a.score.total}</span>{a.score.coverage < 1 && <div className="muted small">range {a.score.floor}–{a.score.ceiling}</div>}</td>
              <td><StatusChip status={r.status} />{overridden && <div className="muted small">AI: {STATUS_LABEL[a.status]}</div>}</td>
              <td className="small">{failed ? <Chip tone="bad" icon="alert">{failed} failed</Chip> : unclear ? <Chip tone="info" icon="eye">{unclear} to verify</Chip> : a.gates.length ? <Chip tone="ok" icon="check">all passed</Chip> : '—'}</td>
              <td className="small muted">{a.statusReasons[0]?.slice(0, 120)}</td>
            </tr>;
          })}</tbody></table></div> : <Empty title="No candidates here yet">Upload CVs for this mandate, or change the filter.</Empty>}
      </Card>
      <p className="muted small" style={{ marginTop: 12 }}>Statuses are internal screening outcomes for recruiters. “Below Threshold” is reviewable and overridable; no candidate is ever rejected automatically or notified.</p>
    </>
  );
}
