import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../data/api';
import { ALL_RECRUITMENT_KEYS, K, useAction, useAgencies, useConfig, useMandate, useMandateAgencies, usePipeline, useSettings, useToday } from '../../data/hooks';
import { BAND_META, computeBand, computeClock } from '../../domain/mandateClock';
import type { Step } from '../../domain/types';
import { fmtDate, fmtDateTime, fmtDateShort, fmtTime } from '../../lib/time';
import { validateDocument } from '../../lib/storage';
import { Chip, Empty, ErrorBox, Field, Icon, Loading, Progress, Ring, Section, Select, Tabs, TextArea, TextInput } from '../../ui/kit';
import { FunnelChart } from '../../ui/charts';
import { funnelSteps } from '../../domain/analytics';
import { Modal } from '../../ui/Modal';
import { useConfirm } from '../../ui/Confirm';
import { useAuth } from '../auth/AuthProvider';
import { CandidateForm } from '../talent/CandidateForm';
import { MandateForm } from './MandateForm';
import { bandStyle, stateChip, urgencyChip } from './MandateCard';

type Tab = 'candidates' | 'workflow' | 'activity' | 'comments';

export default function MandateDetail() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient();
  const { settings } = useSettings(); const today = useToday(); const { user } = useAuth(); const confirm = useConfirm();
  const q = useMandate(id); const pipe = usePipeline(); const agencies = useAgencies(); const links = useMandateAgencies(); const cfg = useConfig();
  const { run, busy } = useAction();
  const [tab, setTab] = useState<Tab>('candidates'); const [edit, setEdit] = useState(false); const [addCand, setAddCand] = useState(false); const [statusDlg, setStatusDlg] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const m = q.data;
  const clock = useMemo(() => (m ? computeClock(m, { today, tz: settings.timezone, inactivityDays: settings.inactivityDays, nearCloseDays: settings.nearCloseDays }) : null), [m, today, settings]);
  const docs = useQuery({ queryKey: ['mandate-detail', 'docs', id], queryFn: () => api.documents(id!), enabled: !!id });
  const steps = useQuery({ queryKey: ['mandate-detail', 'steps', id], queryFn: () => api.steps({ mandateId: id }), enabled: !!id && tab === 'workflow' });
  const acts = useQuery({ queryKey: ['mandate-detail', 'acts', id], queryFn: () => api.activities(id!), enabled: !!id && tab === 'activity' });
  const comments = useQuery({ queryKey: ['mandate-detail', 'comments', id], queryFn: () => api.comments({ mandateId: id }), enabled: !!id && tab === 'comments' });
  const funnel = useQuery({ queryKey: ['funnel', id], queryFn: () => api.funnel(id), enabled: !!id && tab === 'candidates' });
  const [comment, setComment] = useState('');
  const refresh = [...ALL_RECRUITMENT_KEYS, ['mandate-detail'], K.mandateAgencies];

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!m || !clock) return <Empty title="Mandate not found"><Link to="/mandates">Back to mandates</Link></Empty>;
  const band = computeBand(m, clock);
  const cands = (pipe.data ?? []).filter((p) => p.mandate_id === m.id);
  const myLinks = (links.data ?? []).filter((l) => l.mandate_id === m.id);
  const agName = (aid: string) => (agencies.data ?? []).find((a) => a.id === aid)?.name ?? '—';
  const current = (docs.data ?? []).find((d) => d.is_current && d.kind === 'jd');
  const older = (docs.data ?? []).filter((d) => !d.is_current);
  const stageLabel = (k: string) => cfg.allStages.find((s) => s.key === k)?.label ?? k;

  async function upload(file: File | undefined) {
    if (!file) return; const bad = validateDocument(file);
    if (bad) { await run(async () => { throw new Error(bad); }); return; }
    if (current && !(await confirm({ title: 'Replace the job description?', body: `“${current.file_name}” will be kept in history and “${file.name}” becomes the current JD.`, confirm: 'Replace' }))) return;
    await run(() => api.uploadJd(m!.id, user!.id, file), { success: current ? 'JD replaced' : 'JD uploaded', invalidate: refresh });
    if (fileRef.current) fileRef.current.value = '';
  }
  async function openDoc(path: string, name: string, download: boolean) {
    await run(async () => { const url = await api.documentUrl(path, download ? name : undefined); window.open(url, '_blank', 'noopener'); });
  }

  return (
    <div className="stack">
      <div className="row"><button className="btn sm" onClick={() => nav('/mandates')}><Icon n="back" size={15} /> Mandates</button>
        <div className="right row wrap">
          <button className="btn" onClick={() => setAddCand(true)}><Icon n="plus" size={15} /> Add candidate</button>
          <button className="btn" onClick={() => setStatusDlg(true)}>Change status</button>
          <button className="btn primary" onClick={() => setEdit(true)}><Icon n="edit" size={15} /> Edit</button></div></div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="band" style={{ ...bandStyle(band.primary), padding: '16px 20px' }}>
          <div className="grow"><div style={{ fontSize: 22, fontWeight: 750 }}>{m.title}</div><div style={{ opacity: .9 }}>{m.company_name} {m.confidential && '· 🔒 Confidential'}</div></div>
          <span className="tag">{BAND_META[band.primary].label}</span>
        </div>
        {band.secondary.length > 0 && <div className="band-sub">{band.secondary.map((s) => <i key={s} style={{ ['--c' as string]: `var(${BAND_META[s].colorVar})` }} title={BAND_META[s].hint} />)}</div>}
        <div className="row wrap" style={{ padding: '10px 20px', gap: 8 }}>{stateChip(clock, m)}{urgencyChip(m.urgency)}{band.secondary.map((s) => <Chip key={s}>{BAND_META[s].label}</Chip>)}{m.waiting_on && <Chip tone="amber">Waiting on {m.waiting_on}</Chip>}{m.status_note && <span className="small muted">“{m.status_note}”</span>}</div>
      </div>

      {clock.state !== 'closed' && clock.alerts.length > 0 && (
        <div className="stack-s" role="alert">{clock.alerts.map((a) => <div key={a.kind} className={`alert-line ${a.level}`} style={{ padding: '10px 14px', fontSize: 13.5 }}><Icon n="alert" size={16} /><b>{a.level === 'critical' ? 'ACTION NEEDED' : a.level === 'high' ? 'ATTENTION' : 'NOTE'}</b><span>{a.message}</span></div>)}</div>
      )}

      <div className="split">
        <div className="stack">
          <div className="grid g2">
            <Section title="30-day clock" sub={clock.clockStarted ? `started ${fmtDate(m.started_on)}` : 'not started'}>
              <div className="row gap-l"><Ring pct={clock.clockProgress * 100} label={clock.clockDay ? `D${clock.clockDay}` : '—'} color={clock.clockExpired ? 'var(--red)' : 'var(--gold)'} />
                <div className="stack-s small"><div><b>{clock.daysOpen}</b> <span className="muted">days open</span></div><div><b className={clock.idleDays >= settings.inactivityDays && m.status === 'active' ? 'red' : ''}>{clock.idleDays}</b> <span className="muted">days since meaningful activity</span></div>
                  <div className="muted tiny">Last: {m.last_activity_at ? fmtDateTime(m.last_activity_at, settings.timezone) : 'none yet'}</div></div></div>
              {!clock.clockStarted && <div className="banner warn small" style={{ marginTop: 10 }}>Add a Work start date to start the 30-day clock. <button className="btn xs" onClick={() => setEdit(true)}>Set date</button></div>}
            </Section>
            <Section title="Mandate details">
              <dl className="kv"><dt>Location</dt><dd>{m.location ?? '—'}</dd><dt>Work mode</dt><dd>{m.work_mode ?? '—'}</dd><dt>Positions</dt><dd>{m.positions} · {m.joined_count} joined</dd><dt>Level</dt><dd>{m.level ?? '—'}</dd>
                <dt>Reporting to</dt><dd>{m.reporting_to ?? '—'}</dd><dt>Span</dt><dd>{m.span ?? '—'}</dd><dt>Budget</dt><dd>{m.budget ?? '—'}</dd><dt>Hiring manager</dt><dd>{m.stakeholder ?? '—'}</dd>
                <dt>Received</dt><dd>{fmtDate(m.received_on)}</dd><dt>Target close</dt><dd>{fmtDate(m.target_close)}{clock.daysToClose !== null && clock.state !== 'closed' && <span className={clock.daysToClose < 0 ? 'red' : 'muted'}> ({clock.daysToClose < 0 ? `${-clock.daysToClose}d late` : `${clock.daysToClose}d left`})</span>}</dd>
                <dt>Advertising</dt><dd>{m.confidential ? 'Confidential' : 'Open for advertisement'}</dd>{m.notes && <><dt>Notes</dt><dd>{m.notes}</dd></>}</dl>
            </Section>
          </div>

          <div className="card pad"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'candidates', label: `Candidates (${cands.length})` }, { value: 'workflow', label: `Workflow ${m.open_steps ? `(${m.open_steps} open)` : ''}` }, { value: 'activity', label: 'Activity' }, { value: 'comments', label: 'Comments' }]} />
            {tab === 'candidates' && (
              <div className="stack">
                {funnel.data && funnel.data.length > 0 && cands.length > 0 && <FunnelChart steps={funnelSteps(funnel.data)} />}
                {cands.length === 0 ? <Empty title="No candidates yet"><button className="btn primary" onClick={() => setAddCand(true)}>Add the first candidate</button></Empty> :
                  <div className="scroll-x"><table className="t"><thead><tr><th>Candidate</th><th>Current role</th><th>Stage</th><th>Status</th><th>Source</th><th>Updated</th></tr></thead>
                    <tbody>{cands.map((c) => (
                      <tr key={c.association_id} className="click" onClick={() => nav(`/talent/${c.candidate_id}`)}>
                        <td><b>{c.name}</b></td><td className="small dim">{[c.designation, c.current_company].filter(Boolean).join(' · ') || '—'}</td><td>{stageLabel(c.stage)}</td>
                        <td><Chip tone={c.status === 'joined' ? 'gold' : c.status === 'offered' || c.status === 'selected' ? 'green' : c.status === 'rejected' || c.status === 'dropped' ? 'red' : undefined}>{c.status.replace('_', ' ')}</Chip></td>
                        <td className="small">{c.source ?? '—'}</td><td className="small muted">{fmtDateShort(c.stage_updated_at.slice(0, 10))}</td></tr>))}</tbody></table></div>}
              </div>)}
            {tab === 'workflow' && <Workflow steps={steps.data} loading={steps.isLoading} error={steps.error} onChange={() => qc.invalidateQueries({ queryKey: ['mandate-detail'] }).then(() => qc.invalidateQueries({ queryKey: K.mandates }))} />}
            {tab === 'activity' && (acts.isLoading ? <Loading /> : (acts.data ?? []).length === 0 ? <Empty title="No activity recorded yet" /> :
              <div className="timeline">{acts.data!.map((a) => <div key={a.id} className="tl-item"><div className="small"><b>{a.summary ?? a.kind}</b></div><div className="tiny muted">{fmtDateTime(a.occurred_at, settings.timezone)} · {a.kind.replace(/_/g, ' ')}</div></div>)}</div>)}
            {tab === 'comments' && (
              <div className="stack">
                <div className="row" style={{ alignItems: 'flex-start' }}><div className="grow"><TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment (counts as meaningful activity)…" maxLength={4000} /></div>
                  <button className="btn primary" disabled={busy || !comment.trim()} onClick={async () => { await run(() => api.addComment({ mandateId: m.id, body: comment }), { success: 'Comment added', invalidate: refresh }); setComment(''); }}>Add</button></div>
                {(comments.data ?? []).map((c) => <div key={c.id} className="card pad small"><div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div><div className="tiny muted" style={{ marginTop: 4 }}>{fmtDateTime(c.created_at, settings.timezone)}{c.candidate_id && ' · on a candidate'}</div></div>)}
                {comments.data?.length === 0 && <Empty title="No comments yet" />}
              </div>)}
          </div>
        </div>

        <div className="stack">
          <Section title="Job description" actions={<><input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => upload(e.target.files?.[0])} /><button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}><Icon n="upload" size={14} /> {current ? 'Replace' : 'Upload'}</button></>}>
            {current ? (
              <div className="stack-s"><div className="row"><Icon n="file" /><div className="grow"><div className="bold trunc">{current.file_name}</div><div className="tiny muted">{((current.size ?? 0) / 1024).toFixed(0)} KB · uploaded {fmtDateTime(current.created_at, settings.timezone)}</div></div></div>
                <div className="row"><button className="btn sm" onClick={() => openDoc(current.path, current.file_name, false)}>View</button><button className="btn sm" onClick={() => openDoc(current.path, current.file_name, true)}><Icon n="download" size={14} /> Download</button></div>
                {older.length > 0 && <details><summary className="small muted" style={{ cursor: 'pointer' }}>{older.length} earlier version{older.length > 1 ? 's' : ''}</summary>{older.map((d) => <div key={d.id} className="row small" style={{ marginTop: 6 }}><span className="grow trunc">{d.file_name}</span><span className="muted tiny">{fmtDateShort(d.created_at.slice(0, 10))}</span><button className="btn xs" onClick={() => openDoc(d.path, d.file_name, true)}>Download</button></div>)}</details>}
              </div>) : <Empty title="No JD uploaded">PDF or Word, up to 10 MB. Stored privately.</Empty>}
          </Section>
          <Section title="Consultants & agencies" actions={<AddConsultant mandateId={m.id} refresh={refresh} />}>
            {myLinks.length === 0 ? <div className="muted small">Not shared with any external consultant.</div> : <div className="stack-s">{myLinks.map((l) => (
              <div key={l.id} className="row"><Chip tone="purple">{agName(l.agency_id)}</Chip><span className="small muted grow">{l.shared_at ? `shared ${fmtDateShort(l.shared_at.slice(0, 10))}` : 'assigned, not yet shared'}</span>
                <button className="btn xs" onClick={() => run(() => api.setShared(l.id, !l.shared_at), { invalidate: refresh })}>{l.shared_at ? 'Unshare' : 'Mark shared'}</button>
                <button className="btn xs danger" onClick={async () => { if (await confirm({ title: 'Remove consultant?', body: `${agName(l.agency_id)} will be unassigned from this mandate.`, confirm: 'Remove', danger: true })) run(() => api.removeMandateAgency(l.id), { invalidate: refresh }); }} aria-label="Remove">✕</button></div>))}</div>}
          </Section>
          <Section title="Checklist progress"><div className="stack-s"><Progress pct={m.open_steps + m.done_steps ? (m.done_steps / (m.open_steps + m.done_steps)) * 100 : 0} /><div className="small muted">{m.done_steps} done · {m.open_steps} open{m.overdue_steps > 0 && <span className="red"> · {m.overdue_steps} overdue</span>}</div></div></Section>
        </div>
      </div>

      {edit && <MandateForm mandate={m} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />}
      {addCand && <CandidateForm presetMandateId={m.id} onClose={() => setAddCand(false)} onSaved={(cid) => { setAddCand(false); nav(`/talent/${cid}`); }} />}
      {statusDlg && <StatusDialog m={m} onClose={() => setStatusDlg(false)} />}
      {fmtTime('00:00') && null}
    </div>
  );
}

function AddConsultant({ mandateId, refresh }: { mandateId: string; refresh: import('@tanstack/react-query').QueryKey[] }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const { run, busy } = useAction(); const ag = useAgencies();
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}><Icon n="plus" size={14} /> Add</button>;
  return (
    <Modal title="Assign a consultant / agency" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()} onClick={async () => { await run(() => api.addMandateAgency(mandateId, name), { success: 'Consultant assigned', invalidate: refresh }); setOpen(false); setName(''); }}>Assign</button></>}>
      <Field label="Name" hint="Choose an existing one or type a new name"><TextInput list="agl" value={name} onChange={(e) => setName(e.target.value)} autoFocus /><datalist id="agl">{(ag.data ?? []).map((a) => <option key={a.id} value={a.name} />)}</datalist></Field>
    </Modal>
  );
}

function StatusDialog({ m, onClose }: { m: import('../../domain/types').MandateRow; onClose: () => void }) {
  const [status, setStatus] = useState<'active' | 'on_hold' | 'closed' | 'cancelled'>(m.status); const [note, setNote] = useState('');
  const { run, busy } = useAction(); const needsNote = status !== 'active';
  return (
    <Modal title="Change mandate status" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${status === 'cancelled' ? 'danger' : 'primary'}`} disabled={busy || status === m.status || (needsNote && !note.trim())} onClick={async () => { await run(() => api.setMandateStatus(m.id, status, note.trim() || null), { success: 'Status updated', invalidate: [...ALL_RECRUITMENT_KEYS] }); onClose(); }}>Update status</button></>}>
      <div className="stack">
        <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value as never)} options={[{ value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'closed', label: 'Closed — position(s) filled' }, { value: 'cancelled', label: 'Closed — cancelled' }]} /></Field>
        {needsNote && <Field label={status === 'on_hold' ? 'Why is it on hold?' : 'Closing note'} required><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>}
        {status === 'closed' && m.joined_count < m.positions && <div className="banner warn small">Only {m.joined_count} of {m.positions} position(s) show as joined.</div>}
      </div>
    </Modal>
  );
}

function Workflow({ steps, loading, error, onChange }: { steps?: Step[]; loading: boolean; error: unknown; onChange: () => void }) {
  const { run } = useAction();
  const groups = useMemo(() => { const g = new Map<string, Step[]>(); for (const s of steps ?? []) g.set(s.phase ?? 'Other', [...(g.get(s.phase ?? 'Other') ?? []), s]); return [...g.entries()]; }, [steps]);
  if (loading) return <Loading />; if (error) return <ErrorBox error={error} />;
  if (!steps?.length) return <Empty title="No workflow steps for this mandate" />;
  const set = (s: Step, status: Step['status']) => run(async () => { await api.setStep(s.id, { status }); onChange(); });
  return (
    <div className="stack">{groups.map(([phase, list]) => { const d = list.filter((s) => s.status === 'done').length; return (
      <details key={phase} open={d < list.length}><summary className="row" style={{ cursor: 'pointer', padding: '6px 0' }}><b>{phase}</b><span className="muted small">{d}/{list.length}</span><div className="grow" style={{ maxWidth: 160 }}><Progress pct={(d / list.length) * 100} /></div></summary>
        <div className="stack-s" style={{ paddingLeft: 6 }}>{list.map((s) => (
          <div key={s.id} className="row" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" className="cb" checked={s.status === 'done'} onChange={(e) => set(s, e.target.checked ? 'done' : 'todo')} aria-label={`Mark “${s.title}” done`} />
            <div className="grow"><div style={{ textDecoration: s.status === 'done' ? 'line-through' : 'none', opacity: s.status === 'done' ? .6 : 1 }}>{s.title}</div>{s.hint && <div className="tiny muted">{s.hint}</div>}
              {s.due_date && s.status !== 'done' && <span className="tiny muted">due {fmtDateShort(s.due_date)}</span>}</div>
            {s.status !== 'done' && <button className={`btn xs ${s.status === 'waiting' ? 'primary' : ''}`} onClick={() => set(s, s.status === 'waiting' ? 'todo' : 'waiting')}>{s.status === 'waiting' ? 'Waiting ✓' : 'Waiting?'}</button>}
          </div>))}</div></details>); })}</div>
  );
}
