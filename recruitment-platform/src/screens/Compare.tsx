import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWorld } from '@/app/hooks';
import { STATUS_LABEL } from '@/domain/types';
import { comparisonPdf, comparisonWorkbook } from '@/services/exports';
import { Card, Chip, Empty, PageHead, StatusChip, useAction } from '@/ui/kit';
import { download, pct, slug } from '@/ui/format';

export function Compare(): ReactNode {
  const w = useWorld();
  const act = useAction();
  const [sp, setSp] = useSearchParams();
  const mandateId = sp.get('mandate') ?? w.mandates.find((m) => w.rows.some((r) => r.mandate.id === m.id))?.id ?? '';
  const ids = (sp.get('ids') ?? '').split(',').filter(Boolean).slice(0, 5);
  const mandate = w.mandates.find((m) => m.id === mandateId);
  const rubric = w.rubrics.find((r) => r.id === mandate?.activeRubricId);
  const pool = w.rows.filter((r) => r.mandate.id === mandateId).sort((a, b) => b.assessment.score.total - a.assessment.score.total);
  const items = useMemo(() => ids.map((i) => pool.find((r) => r.assessment.id === i)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ candidate: r.candidate, assessment: r.assessment, status: r.status })), [ids, pool]);
  const toggle = (id: string): void => { const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 5); setSp({ mandate: mandateId, ids: next.join(',') }); };

  return (
    <>
      <PageHead title="Candidate Comparison" sub="Up to five candidates side by side on the same approved rubric. Longer or keyword-heavy CVs earn nothing extra — only evidenced ratings count."
        actions={mandate && rubric && items.length >= 2 && <>
          <button className="btn" onClick={() => void act(async () => download(await comparisonWorkbook({ mandate, rubric, items }), `${slug(mandate.code)}-comparison.xlsx`))}>Excel</button>
          <button className="btn" onClick={() => void act(async () => download(await comparisonPdf({ mandate, rubric, items }), `${slug(mandate.code)}-comparison.pdf`))}>PDF</button></>} />
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field" style={{ maxWidth: 420, marginBottom: 12 }}><label htmlFor="cm">Mandate</label><select id="cm" className="select" value={mandateId} onChange={(e) => setSp({ mandate: e.target.value })}>{w.mandates.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}</select></div>
        <div className="lbl" style={{ marginBottom: 6 }}>Choose 2–5 candidates ({ids.length} selected)</div>
        <div className="row">{pool.map((r) => <label key={r.assessment.id} className="chip gold" style={{ cursor: 'pointer', opacity: ids.length >= 5 && !ids.includes(r.assessment.id) ? 0.45 : 1 }}><input type="checkbox" checked={ids.includes(r.assessment.id)} onChange={() => toggle(r.assessment.id)} style={{ accentColor: 'var(--gold)' }} /> {r.candidate.name} · {r.assessment.score.total}</label>)}{!pool.length && <span className="muted small">No screened candidates for this mandate.</span>}</div>
      </div>
      {items.length < 2 || !rubric ? <Card><Empty title="Select at least two candidates" /></Card> : (
        <Card flush>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Evaluation area</th><th className="num">Weight</th>{items.map((i) => <th key={i.assessment.id}><Link to={`/assessments/${i.assessment.id}`}>{i.candidate.name}</Link></th>)}</tr></thead><tbody>
            {rubric.criteria.map((c) => {
              const pts = items.map((i) => i.assessment.score.lines.find((l) => l.criterionId === c.id));
              const best = Math.max(...pts.map((p) => (p && p.rating !== null ? p.points : -1)));
              return <tr key={c.id}><td>{c.name}</td><td className="num">{c.weight}</td>{pts.map((p, i) => {
                const ne = !p || p.rating === null;
                return <td key={i} className="mono" style={{ color: !ne && p!.points === best && best >= 0 ? 'var(--gold-2)' : undefined, fontWeight: !ne && p!.points === best ? 700 : 400 }}>{ne ? <span className="muted" title="Not Evident: the CV is silent; not a finding of non-compliance">n/e</span> : `${p!.points}/${c.weight}`}</td>;
              })}</tr>;
            })}
            <tr style={{ background: 'var(--panel-2)' }}><td><b>Total score</b></td><td className="num">100</td>{items.map((i) => <td key={i.assessment.id} className="score" style={{ fontSize: 16 }}>{i.assessment.score.total}</td>)}</tr>
            <tr><td>Score range (missing evidence 0 → 5)</td><td />{items.map((i) => <td key={i.assessment.id} className="small muted">{i.assessment.score.floor}–{i.assessment.score.ceiling}</td>)}</tr>
            <tr><td>Status in force</td><td />{items.map((i) => <td key={i.assessment.id}><StatusChip status={i.status} /></td>)}</tr>
            {rubric.gates.map((g) => <tr key={g.id}><td>Gate: {g.name}</td><td />{items.map((i) => { const r = i.assessment.gates.find((x) => x.gateId === g.id); return <td key={i.assessment.id}>{r && <Chip tone={r.status === 'pass' ? 'ok' : r.status === 'fail' ? 'bad' : 'info'} icon={r.status === 'pass' ? 'check' : r.status === 'fail' ? 'alert' : 'eye'}>{r.status.replace('_', ' ')}</Chip>}</td>; })}</tr>)}
            <tr><td>Evidence quality</td><td />{items.map((i) => <td key={i.assessment.id} className="small">{pct(i.assessment.score.coverage)} of weight evidenced · extraction {pct(i.assessment.extractionConfidence)}</td>)}</tr>
            <tr><td>Career progression</td><td />{items.map((i) => <td key={i.assessment.id} className="small">{i.candidate.employment.length} roles · {i.candidate.totalExperienceYears ?? '?'} yrs{i.assessment.chronologyFlags.length ? ` · ${i.assessment.chronologyFlags.length} flag(s)` : ''}</td>)}</tr>
            <tr><td>Critical gaps</td><td />{items.map((i) => <td key={i.assessment.id} className="small">{i.assessment.gaps.slice(0, 2).join('; ') || '—'}</td>)}</tr>
            <tr><td>Missing information</td><td />{items.map((i) => <td key={i.assessment.id} className="small muted">{i.assessment.missingInformation.length} item(s)</td>)}</tr>
            <tr><td>Verification needs</td><td />{items.map((i) => <td key={i.assessment.id} className="small">{i.assessment.verificationQuestions.slice(0, 2).join('; ') || '—'}</td>)}</tr>
          </tbody></table></div>
        </Card>
      )}
      {items.length >= 2 && <p className="muted small" style={{ marginTop: 10 }}>Highlighted gold = best on that criterion. A top total does not override a failed mandatory gate: {items.filter((i) => i.assessment.gates.some((g) => g.status === 'fail')).map((i) => i.candidate.name).join(', ') || 'none in this comparison'}. Statuses: {Array.from(new Set(items.map((i) => STATUS_LABEL[i.status]))).join(', ')}.</p>}
    </>
  );
}
