import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCtx, useWorld } from '@/app/hooks';
import { can } from '@/domain/permissions';
import type { Candidate, CandidateDocument } from '@/domain/types';
import { groupIds, markNotDuplicate, mergeCandidates, searchCandidates, type CandidateQuery } from '@/services/candidates';
import { screenExisting } from '@/services/pipeline';
import { Card, Chip, Empty, Field, Modal, PageHead, StatusChip, useAction } from '@/ui/kit';
import { fmtDateTime, pct } from '@/ui/format';

export function Candidates(): ReactNode {
  const w = useWorld();
  const [q, setQ] = useState<CandidateQuery>({});
  const [text, setText] = useState('');
  const list = useMemo(() => searchCandidates(w.candidates, { ...q, text }), [w.candidates, q, text]);
  const dupes = w.candidates.filter((c) => !c.mergedInto && (c.duplicateOf?.length ?? 0) > 0);
  const num = (k: keyof CandidateQuery, v: string): void => setQ((x) => ({ ...x, [k]: v === '' ? undefined : Number(v) }));
  const str = (k: keyof CandidateQuery, v: string): void => setQ((x) => ({ ...x, [k]: v || undefined }));
  const count = (id: string): number => { const ids = new Set(groupIds(w.candidates, id)); return new Set(w.assessments.filter((a) => ids.has(a.candidateId)).map((a) => a.mandateId)).size; };

  return (
    <>
      <PageHead title="Candidate Database" sub="One profile per person, linked to every mandate they have been assessed for. Search structured evidence — experience, team size, industry, employers — not just keywords." />
      {dupes.length > 0 && <div className="callout warn" style={{ marginBottom: 14 }}><b>{dupes.length} possible duplicate{dupes.length > 1 ? 's' : ''} need a person.</b> Profiles are never merged on a similar name alone. {dupes.map((d) => <Link key={d.id} to={`/candidates/${d.id}`} style={{ marginLeft: 8 }}>{d.name}</Link>)}</div>}
      <div className="card" style={{ marginBottom: 14 }}><div className="form-grid">
        <div className="field"><label htmlFor="cs">Search</label><input id="cs" className="input" placeholder="Name, designation, company, skill…" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="field"><label htmlFor="cy">Min. experience (yrs)</label><input id="cy" className="input" type="number" min={0} onChange={(e) => num('minYears', e.target.value)} /></div>
        <div className="field"><label htmlFor="ct">Led a team of at least</label><input id="ct" className="input" type="number" min={0} onChange={(e) => num('minTeam', e.target.value)} /></div>
        <div className="field"><label htmlFor="ci">Industry</label><input id="ci" className="input" placeholder="e.g. automotive" onChange={(e) => str('industry', e.target.value)} /></div>
        <div className="field"><label htmlFor="cc">Employer</label><input id="cc" className="input" onChange={(e) => str('company', e.target.value)} /></div>
        <div className="field"><label htmlFor="ck">Skill</label><input id="ck" className="input" onChange={(e) => str('skill', e.target.value)} /></div>
      </div></div>
      <Card flush>
        {list.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Candidate</th><th>Current role</th><th className="num">Experience</th><th>Industries</th><th className="num">Mandates</th><th>Flags</th></tr></thead><tbody>
          {list.map((c) => <tr key={c.id}><td><Link to={`/candidates/${c.id}`}><b>{c.name}</b></Link><div className="muted small">{c.code}{c.location ? ` · ${c.location}` : ''}</div></td>
            <td>{c.currentDesignation ?? '—'}<div className="muted small">{c.currentCompany}</div></td><td className="num">{c.totalExperienceYears ?? '—'}</td>
            <td className="small">{c.industries.slice(0, 3).join(', ') || '—'}</td><td className="num">{count(c.id)}</td>
            <td>{c.extractionConfidence < 0.6 && <Chip tone="info" icon="eye">low confidence</Chip>} {(c.duplicateOf?.length ?? 0) > 0 && <Chip tone="caution" icon="scale">possible duplicate</Chip>}</td></tr>)}
        </tbody></table></div> : <Empty title="No candidates match" />}
      </Card>
    </>
  );
}

export function CandidateProfile(): ReactNode {
  const { id } = useParams();
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const c = w.candidates.find((x) => x.id === id);
  const [docs, setDocs] = useState<CandidateDocument[]>([]);
  const [mergeWith, setMergeWith] = useState<Candidate>();
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const ids = useMemo(() => (c ? groupIds(w.candidates, c.id) : []), [w.candidates, c]);
  useEffect(() => { if (c) void Promise.all(ids.map((i) => ctx.repo.list('candidate_documents', { candidateId: i }))).then((l) => setDocs(l.flat().sort((a, b) => b.version - a.version))); }, [ctx, c, ids]);
  if (!c) return <Empty title="Candidate not found">It may belong to an entity you cannot access.</Empty>;

  const rows = w.rows.filter((r) => ids.includes(r.candidate.id) || ids.includes(r.assessment.candidateId));
  const suspects = (c.duplicateOf ?? []).map((d) => w.candidates.find((x) => x.id === d)).filter((x): x is Candidate => !!x);
  const mayMerge = can(ctx.user.role, 'candidate.merge');
  const otherMandates = w.mandates.filter((m) => m.status === 'open' && !rows.some((r) => r.mandate.id === m.id));
  const dl = async (d: CandidateDocument): Promise<void> => { if (!d.storagePath) return; const u = await ctx.repo.fileUrl(d.storagePath); if (u) { const a = document.createElement('a'); a.href = u; a.download = d.fileName; a.click(); } };

  return (
    <>
      <PageHead title={c.name} crumbs={<Link to="/candidates">Candidate Database</Link>}
        sub={<>{c.code} · {c.currentDesignation ?? '—'}{c.currentCompany ? `, ${c.currentCompany}` : ''} · {c.location ?? 'location unknown'} · {c.totalExperienceYears ?? '?'} years (per CV chronology)</>} />
      {c.identityFlags.map((f) => <div key={f} className="callout warn small" style={{ marginBottom: 8 }}>{{ possible_duplicate: 'Possible duplicate: a person must confirm before profiles are merged.', shared_identifier_name_conflict: 'This CV shares an email or phone with an existing profile but the name differs. Review before linking.', name_not_found: 'A name could not be read from the CV.' }[f] ?? f}</div>)}
      {suspects.length > 0 && <Card title="Possible duplicates"><div className="stack">{suspects.map((s) => <div key={s.id} className="spread"><div><Link to={`/candidates/${s.id}`}><b>{s.name}</b></Link> <span className="muted small">{s.code} · {s.currentDesignation} · {s.currentCompany} · {s.email ?? 'no email'}</span></div>
        {mayMerge ? <div className="row"><button className="btn sm" onClick={() => setMergeWith(s)}>Same person — merge</button><button className="btn sm ghost" onClick={() => void act(() => markNotDuplicate(ctx, c.id, s.id), 'Marked as different people.')}>Not the same person</button></div> : <span className="muted small">A recruiter must resolve this.</span>}</div>)}</div></Card>}
      <div style={{ height: 14 }} />
      <div className="split">
        <div className="stack">
          <Card title="Assessments across mandates" flush>
            {rows.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Mandate</th><th className="num">Score</th><th>Status</th><th>Version</th></tr></thead><tbody>{rows.map((r) => <tr key={r.assessment.id}>
              <td><Link to={`/mandates/${r.mandate.id}`}>{r.mandate.code}</Link> {r.mandate.title}</td><td className="num score"><Link to={`/assessments/${r.assessment.id}`}>{r.assessment.score.total}</Link></td><td><StatusChip status={r.status} /></td><td className="small">v{r.assessment.version} · rubric v{r.assessment.rubricVersion}</td></tr>)}</tbody></table></div> : <Empty title="Not assessed yet" />}
            {can(ctx.user.role, 'assessment.run') && otherMandates.length > 0 && <div className="row" style={{ padding: 14 }}>
              <select className="select" style={{ maxWidth: 300 }} aria-label="Screen against another mandate" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Screen against another mandate…</option>{otherMandates.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}</select>
              <button className="btn sm primary" disabled={!target} onClick={() => void act(() => screenExisting(ctx, c.id, target), 'Screened. The original assessment for the other mandate is not transferred or changed.')}>Screen</button></div>}
          </Card>
          <Card title="Career history" flush><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Role</th><th>Period</th></tr></thead><tbody>{c.employment.map((e, i) => <tr key={i}><td><b>{e.title || '—'}</b>, {e.company || '—'}<div className="muted small">{e.description.slice(0, 260)}{e.description.length > 260 ? '…' : ''}</div></td><td className="small">{e.start} → {e.end}</td></tr>)}{!c.employment.length && <tr><td colSpan={2} className="muted">No roles could be read from the CV.</td></tr>}</tbody></table></div></Card>
          {c.achievements.length > 0 && <Card title="Achievements (as stated on the CV — unverified)"><ul className="small" style={{ margin: '0 0 0 18px', padding: 0 }}>{c.achievements.map((a) => <li key={a.text}>{a.text}{a.metric && <Chip tone="gold">{a.metric}</Chip>}</li>)}</ul></Card>}
        </div>
        <div className="stack">
          <Card title="Profile"><dl className="kv small"><dt>Email</dt><dd>{c.email ?? '—'}</dd><dt>Phone</dt><dd>{c.phone ?? '—'}</dd><dt>Extraction</dt><dd>{pct(c.extractionConfidence)} confidence</dd><dt>Verification</dt><dd>{c.verificationStatus.replace('_', ' ')}</dd><dt>Updated</dt><dd>{fmtDateTime(c.updatedAt)}</dd></dl></Card>
          <Card title="Education & certifications"><div className="stack small">{c.education.map((e) => <div key={e.qualification + e.year}><b>{e.qualification}</b><div className="muted">{[e.institution, e.year].filter(Boolean).join(' · ')}</div></div>)}{c.certifications.length > 0 && <div className="pill-row">{c.certifications.map((x) => <span key={x} className="tag-pill">{x}</span>)}</div>}{!c.education.length && !c.certifications.length && <span className="muted">None read from the CV.</span>}</div></Card>
          {(c.skills.length > 0 || c.industries.length > 0) && <Card title="Skills & industries"><div className="pill-row">{c.industries.map((s) => <Chip key={s} tone="gold">{s}</Chip>)}{c.skills.map((s) => <span key={s} className="tag-pill">{s}</span>)}</div></Card>}
          <Card title="CV versions (originals kept)"><div className="stack small">{docs.map((d) => <div key={d.id} className="spread"><div><b>v{d.version}</b> {d.fileName}<div className="muted">{fmtDateTime(d.uploadedAt)}</div></div>{d.storagePath && can(ctx.user.role, 'cv.download') && <button className="btn sm ghost" onClick={() => void dl(d)}>Download</button>}</div>)}{!docs.length && <span className="muted">No documents.</span>}</div>
            <p className="muted small" style={{ marginTop: 8 }}>A new CV never changes a historical score: each assessment keeps pointing at the CV version it was based on.</p></Card>
        </div>
      </div>
      {mergeWith && <Modal title={`Merge ${mergeWith.code} into ${c.code}`} onClose={() => setMergeWith(undefined)} footer={<><button className="btn ghost" onClick={() => setMergeWith(undefined)}>Cancel</button><button className="btn primary" disabled={!reason.trim()} onClick={() => void act(async () => { await mergeCandidates(ctx, c.id, mergeWith.id, reason); setMergeWith(undefined); setReason(''); }, 'Profiles merged and audited. Both records and all assessments are preserved.')}>Merge</button></>}>
        <p className="small muted">{mergeWith.name} will be linked to {c.name}. Their documents and assessments stay attached and appear together on this profile. This is audited; nothing is deleted.</p>
        <Field label="Reason (required)">{(fid) => <textarea id={fid} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Confirmed same person — same career history and personal email" />}</Field>
      </Modal>}
    </>
  );
}
