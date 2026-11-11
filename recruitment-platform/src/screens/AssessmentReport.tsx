import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCtx, useWorld } from '@/app/hooks';
import { can } from '@/domain/permissions';
import { pointsLost } from '@/domain/scoring';
import { STATUS_LABEL, type CandidateDocument, type CriterionAssessment, type ScreeningStatus } from '@/domain/types';
import { effectiveStatus } from '@/services/decisions';
import { decide } from '@/services/decisions';
import { assessmentPdf } from '@/services/exports';
import { screenExisting } from '@/services/pipeline';
import { Card, Chip, Empty, Field, Kpi, Modal, PageHead, ScoreRange, StatusChip, useAction } from '@/ui/kit';
import { download, fmtDateTime, pct, slug } from '@/ui/format';

const STATE_TONE: Record<CriterionAssessment['state'], 'ok' | 'gold' | 'bad' | 'neutral' | 'info'> = { met: 'ok', partially_met: 'gold', not_met: 'bad', not_evident: 'neutral', unable_to_assess: 'info' };
const GATE_TONE = { pass: 'ok', fail: 'bad', needs_verification: 'info', not_applicable: 'neutral' } as const;
const ALL_STATUSES = Object.keys(STATUS_LABEL) as ScreeningStatus[];

export function AssessmentReport(): ReactNode {
  const { id } = useParams();
  const w = useWorld();
  const ctx = useCtx();
  const nav = useNavigate();
  const act = useAction();
  const a = w.assessments.find((x) => x.id === id);
  const [doc, setDoc] = useState<CandidateDocument>();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [showCv, setShowCv] = useState(false);
  useEffect(() => { if (a) void ctx.repo.get('candidate_documents', a.documentId).then(setDoc); }, [ctx, a]);
  if (!a) return <Empty title="Assessment not found">It may belong to an entity you cannot access.</Empty>;

  const mandate = w.mandates.find((m) => m.id === a.mandateId);
  const rubric = w.rubrics.find((r) => r.id === a.rubricId);
  const candidate = w.candidates.find((c) => c.id === a.candidateId);
  if (!mandate || !rubric || !candidate) return <Empty title="Loading…" />;
  const decisions = w.decisions.filter((d) => d.assessmentId === a.id).sort((x, y) => y.decidedAt.localeCompare(x.decidedAt));
  const status = effectiveStatus(a, w.decisions);
  const siblings = w.assessments.filter((x) => x.mandateId === a.mandateId && x.candidateId === a.candidateId).sort((x, y) => y.version - x.version);
  const lost = pointsLost(a.score).slice(0, 3);
  const critName = (cid: string): string => rubric.criteria.find((c) => c.id === cid)?.name ?? cid;
  const ref = (e: { page?: number }): string => (e.page ? (doc?.mimeType.includes('pdf') ? `p. ${e.page}` : `section ${e.page}`) : '');
  const mayOverride = can(ctx.user.role, 'decision.override');

  return (
    <>
      <PageHead title={candidate.name} crumbs={<><Link to="/screening">AI Screening</Link> / <Link to={`/mandates/${mandate.id}`}>{mandate.code}</Link></>}
        sub={<>{candidate.currentDesignation ?? '—'}{candidate.currentCompany ? `, ${candidate.currentCompany}` : ''} · screened for <Link to={`/mandates/${mandate.id}`}>{mandate.title}</Link></>}
        actions={<>
          <button className="btn" onClick={() => void act(async () => download(await assessmentPdf({ mandate, rubric, candidate, assessment: a, status, doc, decisions }), `${slug(candidate.name)}-${slug(mandate.code)}-screening.pdf`))}>Export PDF</button>
          {can(ctx.user.role, 'assessment.run') && <button className="btn" onClick={() => void act(async () => { const n = await screenExisting(ctx, candidate.id, mandate.id); nav(`/assessments/${n.id}`); }, 'Re-screened as a new assessment version; the previous one is kept.')}>Re-screen</button>}
          {mayOverride && <button className="btn primary" onClick={() => setOverrideOpen(true)}>Review / override status</button>}
        </>} />

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Kpi label="Overall score" value={<>{a.score.total}<span className="muted" style={{ fontSize: 14 }}> /100</span></>} sub={a.score.coverage < 1 ? `possible range ${a.score.floor}–${a.score.ceiling} · ${pct(a.score.coverage)} of weight evidenced` : 'every criterion evidenced'} />
        <div className="kpi"><div className="label">Status in force</div><div style={{ marginTop: 10 }}><StatusChip status={status} /></div><div className="sub">{status !== a.status ? `AI status: ${STATUS_LABEL[a.status]}` : 'as derived by the screening rules'}</div></div>
        <Kpi label="Extraction confidence" value={pct(a.extractionConfidence)} sub={a.extractionConfidence < rubric.policy.minExtractionConfidence ? 'below the review minimum' : 'CV data read reliably'} />
        <Kpi label="Versions" value={`v${a.version}`} sub={`mandate v${a.mandateVersion} · rubric v${a.rubricVersion}`} />
      </div>

      <div className="split">
        <div className="stack">
          <Card title="Why this status">
            <ul style={{ margin: '0 0 12px 18px', padding: 0 }}>{a.statusReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <ScoreRange total={a.score.total} floor={a.score.floor} ceiling={a.score.ceiling} threshold={rubric.policy.threshold} />
            {lost.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>Biggest point losses: {lost.map((l) => `${critName(l.criterionId)} (−${l.lost})`).join(' · ')}</p>}
            <div className="callout small" style={{ marginTop: 12 }}><b>Recommended next action.</b> {a.recommendedAction}</div>
            {a.flags.filter((f) => f.severity !== 'info').map((f) => <div key={f.message} className={`callout small ${f.severity === 'blocking' ? 'bad' : 'warn'}`} style={{ marginTop: 8 }}>{f.message}</div>)}
          </Card>

          <Card title="Mandatory requirements" flush>
            {a.gates.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Result</th><th>Evidence &amp; note</th></tr></thead><tbody>{a.gates.map((g) => {
              const def = rubric.gates.find((d) => d.id === g.gateId);
              return <tr key={g.gateId}><td><b>{def?.name ?? g.gateId}</b><div className="muted small">{def?.requirement}</div></td>
                <td><Chip tone={GATE_TONE[g.status]} icon={g.status === 'pass' ? 'check' : g.status === 'fail' ? 'alert' : 'eye'}>{g.status.replace('_', ' ')}</Chip></td>
                <td className="small">{g.note}{g.evidence.slice(0, 2).map((e) => <div key={e.quote} className="quote">“{e.quote}” <span className="muted">{ref(e)}</span></div>)}</td></tr>;
            })}</tbody></table></div> : <p className="muted small" style={{ padding: 16 }}>This rubric has no mandatory gates.</p>}
          </Card>

          <Card title="Criterion-by-criterion evaluation">
            <p className="muted small" style={{ marginBottom: 8 }}>Each criterion separates three layers so an AI interpretation is never mistaken for an established fact. <b>Not Evident</b> means the CV is silent — it is not a finding of non-compliance.</p>
            <div className="stack">{rubric.criteria.map((c) => {
              const ca = a.criteria.find((k) => k.criterionId === c.id);
              const line = a.score.lines.find((l) => l.criterionId === c.id);
              return <details key={c.id} className="card" style={{ padding: '10px 14px' }} open={ca?.state === 'not_met' || ca?.state === 'partially_met'}>
                <summary><span className="spread" style={{ display: 'inline-flex', width: 'calc(100% - 20px)' }}><span>{c.name} <span className="muted small">· weight {c.weight}</span></span>
                  <span className="row"><Chip tone={STATE_TONE[ca?.state ?? 'not_evident']}>{(ca?.state ?? 'not_evident').replace(/_/g, ' ')}</Chip><span className="score">{line?.rating === null || line?.rating === undefined ? 'n/e' : `${line.points}/${c.weight}`}</span></span></span></summary>
                <div className="layer ev"><div className="tag">CV evidence</div>{ca?.evidence.length ? ca.evidence.map((e) => <div key={e.quote} className="quote">“{e.quote}” <span className="muted small">{ref(e)}</span></div>) : <span className="muted">Nothing on the CV addresses this criterion.</span>}</div>
                <div className="layer ai"><div className="tag">AI interpretation</div>{ca?.interpretation}{ca ? <span className="muted small"> (confidence {pct(ca.confidence)})</span> : null}</div>
                <div className="layer vf"><div className="tag">Verification</div>{ca?.verification || '—'}</div>
              </details>;
            })}</div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Summary"><p className="small">{a.summary}</p></Card>
          {([['Strengths', a.strengths], ['Gaps', a.gaps], ['Missing or unclear information', a.missingInformation], ['Verification questions', a.verificationQuestions]] as [string, string[]][]).filter(([, l]) => l.length).map(([t, l]) => (
            <Card key={t} title={t}><ul className="small" style={{ margin: '0 0 0 18px', padding: 0 }}>{l.map((x) => <li key={x}>{x}</li>)}</ul></Card>))}
          {a.chronologyFlags.length > 0 && <Card title="Career chronology — for verification, not penalised"><ul className="small" style={{ margin: '0 0 0 18px', padding: 0 }}>{a.chronologyFlags.map((x) => <li key={x}>{x}</li>)}</ul></Card>}
          <Card title="Decision history">
            {decisions.length ? <div className="stack small">{decisions.map((d) => <div key={d.id}><b>{STATUS_LABEL[d.originalStatus]} → {STATUS_LABEL[d.newStatus]}</b><div className="muted">{fmtDateTime(d.decidedAt)} · {w.profiles.find((p) => p.id === d.decidedBy)?.name ?? d.decidedBy.slice(0, 8)}</div><div>{d.reason}</div>{d.comments && <div className="muted">{d.comments}</div>}</div>)}</div> : <p className="muted small">No human decisions recorded. The original AI assessment is never overwritten.</p>}
          </Card>
          <Card title="Provenance">
            <dl className="kv small"><dt>Assessed</dt><dd>{fmtDateTime(a.createdAt)}</dd><dt>Engine</dt><dd>{a.provider.id} / {a.provider.model}</dd><dt>Prompt</dt><dd>{a.provider.promptVersion}</dd><dt>Blind copy</dt><dd>{a.redactions.length ? a.redactions.join(', ') : 'nothing to redact'}</dd><dt>CV</dt><dd>{doc ? `${doc.fileName} (v${doc.version})` : '…'}</dd></dl>
            {siblings.length > 1 && <div className="small" style={{ marginTop: 8 }}>Other versions: {siblings.filter((s) => s.id !== a.id).map((s) => <Link key={s.id} to={`/assessments/${s.id}`} style={{ marginRight: 8 }}>v{s.version} ({s.score.total})</Link>)}</div>}
            <div className="row" style={{ marginTop: 8 }}><Link className="btn sm" to={`/candidates/${candidate.id}`}>Candidate profile</Link>{doc && <button className="btn sm ghost" onClick={() => setShowCv((s) => !s)}>{showCv ? 'Hide CV text' : 'Show CV text'}</button>}</div>
          </Card>
        </div>
      </div>
      {showCv && doc && <div style={{ marginTop: 14 }}><Card title="Extracted CV text (original document is stored separately)"><pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit', maxHeight: 420, overflow: 'auto' }}>{doc.pages.map((p) => `— ${doc.mimeType.includes('pdf') ? 'page' : 'section'} ${p.page} —\n${p.text}`).join('\n\n')}</pre></Card></div>}
      {overrideOpen && <Override assessmentStatus={a.status} current={status} onClose={() => setOverrideOpen(false)} onSave={async (s, reason, comments) => { const r = await act(() => decide(ctx, a.id, s, reason, comments), 'Decision recorded. The original AI assessment is unchanged.'); if (r) setOverrideOpen(false); }} />}
    </>
  );
}

function Override({ current, assessmentStatus, onClose, onSave }: { current: ScreeningStatus; assessmentStatus: ScreeningStatus; onClose: () => void; onSave: (s: ScreeningStatus, reason: string, comments: string) => Promise<void> }): ReactNode {
  const [s, setS] = useState<ScreeningStatus>(current === 'borderline_review' ? 'potential_match' : 'borderline_review');
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState('');
  return (
    <Modal title="Review / override screening status" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!reason.trim() || s === current} onClick={() => void onSave(s, reason, comments)}>Record decision</button></>}>
      <p className="muted small">Recorded with your name, the time, the rubric and assessment versions and your reason. The AI assessment (status <b>{STATUS_LABEL[assessmentStatus]}</b>) is never overwritten.</p>
      <Field label="New status">{(id) => <select id={id} className="select" value={s} onChange={(e) => setS(e.target.value as ScreeningStatus)}>{ALL_STATUSES.filter((x) => x !== current).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select>}</Field>
      <Field label="Reason (required)">{(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Field label="Comments">{(id) => <textarea id={id} className="textarea" style={{ minHeight: 60 }} value={comments} onChange={(e) => setComments(e.target.value)} />}</Field>
    </Modal>
  );
}
