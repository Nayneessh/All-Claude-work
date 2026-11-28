import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data/api';
import { ALL_RECRUITMENT_KEYS, useAction, useConfig, useMandates, useSettings } from '../../data/hooks';
import type { PipelineRow, StatusHistory } from '../../domain/types';
import { fmtDate, fmtDateTime, fmtDateShort } from '../../lib/time';
import { initials, maskEmail, maskMoney, maskPhone } from '../../lib/format';
import { validateDocument } from '../../lib/storage';
import { Chip, Empty, ErrorBox, Field, Icon, Loading, Section, Select, Tabs, TextArea, TextInput } from '../../ui/kit';
import { Modal } from '../../ui/Modal';
import { useAuth } from '../auth/AuthProvider';
import { CandidateForm, MandatePicker } from './CandidateForm';
import { StageDialog, type StageIntent } from './StageDialog';

type Tab = 'timeline' | 'rounds' | 'documents' | 'checklist';
interface Round { round: string; date: string; time: string; panel: string; mode: string; status: string; feedback: string }
const ROUND_NAMES = ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Final round'];
const ROUND_STATUS = ['scheduled', 'done', 'cleared', 'rejected', 'hold', 'resched'];
const tone = (s: string) => (s === 'joined' ? 'gold' : s === 'offered' || s === 'selected' ? 'green' : s === 'rejected' || s === 'dropped' ? 'red' : s === 'on_hold' ? 'info' : undefined);

export default function CandidateProfile() {
  const { id } = useParams(); const nav = useNavigate(); const { settings } = useSettings(); const cfg = useConfig(); const { user } = useAuth(); const mandates = useMandates();
  const { run, busy } = useAction();
  const cand = useQuery({ queryKey: ['candidate', id], queryFn: () => api.candidate(id!), enabled: !!id });
  const pipe = useQuery({ queryKey: ['cand-detail', 'pipe', id], queryFn: () => api.candidatePipeline(id!), enabled: !!id });
  const hist = useQuery({ queryKey: ['cand-detail', 'hist', id], queryFn: () => api.history(id!), enabled: !!id });
  const comments = useQuery({ queryKey: ['cand-detail', 'comments', id], queryFn: () => api.comments({ candidateId: id }), enabled: !!id });
  const files = useQuery({ queryKey: ['cand-detail', 'files', id], queryFn: () => api.files(id!), enabled: !!id });
  const steps = useQuery({ queryKey: ['cand-detail', 'steps', id], queryFn: () => api.steps({ candidateId: id }), enabled: !!id });
  const [tab, setTab] = useState<Tab>('timeline'); const [edit, setEdit] = useState(false); const [dlg, setDlg] = useState<{ row: PipelineRow; intent: StageIntent } | null>(null);
  const [comment, setComment] = useState(''); const [assoc, setAssoc] = useState(false); const [assocId, setAssocId] = useState(''); const [round, setRound] = useState<{ row: PipelineRow; idx: number } | null>(null); const [reveal, setReveal] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = [...ALL_RECRUITMENT_KEYS, ['cand-detail']];
  const stageLabel = (k: string) => cfg.allStages.find((s) => s.key === k)?.label ?? k;
  const c = cand.data; const rows = pipe.data ?? [];
  const primary = rows.find((r) => r.status === 'active' || r.status === 'selected' || r.status === 'offered') ?? rows[0];
  const timeline = useMemo(() => {
    const items: { at: string; kind: 'h' | 'c'; h?: StatusHistory; body?: string }[] = [];
    for (const h of hist.data ?? []) items.push({ at: h.changed_at, kind: 'h', h });
    for (const x of comments.data ?? []) items.push({ at: x.created_at, kind: 'c', body: x.body });
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [hist.data, comments.data]);
  const mandateName = (mid: string | null) => { const m = (mandates.data ?? []).find((x) => x.id === mid); return m ? `${m.title} — ${m.company_name ?? ''}` : ''; };

  if (cand.isLoading) return <Loading />; if (cand.error) return <ErrorBox error={cand.error} retry={() => cand.refetch()} />;
  if (!c) return <Empty title="Candidate not found"><Link to="/talent">Back to Talent Pool</Link></Empty>;
  const masked = settings.maskSensitive && !reveal;
  const show = (v: string | null, kind: 'phone' | 'email' | 'money') => (v ? (masked ? (kind === 'phone' ? maskPhone(v) : kind === 'email' ? maskEmail(v) : maskMoney(v)) : v) : '—');
  const rounds = (row: PipelineRow): Round[] => (Array.isArray(row.rounds) ? (row.rounds as Round[]) : []);
  const saveRounds = (row: PipelineRow, next: Round[]) => run(() => api.setRounds(row.association_id, next), { success: 'Interview updated', invalidate: refresh });

  async function upload(f: File | undefined) {
    if (!f) return; const bad = validateDocument(f); const target = primary;
    if (bad || !target) { await run(async () => { throw new Error(bad ?? 'Associate the candidate with a mandate before uploading a CV.'); }); return; }
    await run(() => api.uploadCv(c!.id, target.mandate_id, user!.id, f), { success: 'CV uploaded', invalidate: refresh }); if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="stack">
      <div className="row"><button className="btn sm" onClick={() => nav(-1)}><Icon n="back" size={15} /> Back</button>
        <div className="right row wrap">{settings.maskSensitive && <button className="btn sm" onClick={() => setReveal((r) => !r)}>{reveal ? 'Hide' : 'Reveal'} contact & pay</button>}<button className="btn" onClick={() => setAssoc(true)}><Icon n="plus" size={15} /> Add to a mandate</button><button className="btn primary" onClick={() => setEdit(true)}><Icon n="edit" size={15} /> Edit</button></div></div>

      <div className="card pad row gap-l wrap">
        <div className="avatar lg">{initials(c.name)}</div>
        <div className="grow" style={{ minWidth: 220 }}><h1>{c.name}</h1><div className="dim">{[c.designation, c.current_company].filter(Boolean).join(' · ') || 'Role not recorded'}</div>
          <div className="row wrap gap-s" style={{ marginTop: 6 }}>{primary ? <Chip tone={tone(primary.status)}>{stageLabel(primary.stage)}</Chip> : <Chip>Talent pool only</Chip>}{c.source && <Chip>{c.source}</Chip>}{c.open_to_relocate !== null && <Chip tone={c.open_to_relocate ? 'green' : undefined}>{c.open_to_relocate ? 'Open to relocate' : 'Not relocating'}</Chip>}</div></div>
        <dl className="kv" style={{ minWidth: 280 }}><dt>Phone</dt><dd>{show(c.phone, 'phone')}</dd><dt>Email</dt><dd>{show(c.email, 'email')}</dd><dt>Location</dt><dd>{c.current_location ?? '—'}</dd><dt>Notice</dt><dd>{c.notice_period ?? '—'}</dd>
          <dt>Current CTC</dt><dd>{show(c.current_ctc, 'money')}</dd><dt>Expected CTC</dt><dd className="gold">{show(c.expected_ctc, 'money')}</dd>{c.additional_benefits && <><dt>Benefits</dt><dd>{c.additional_benefits}</dd></>}</dl>
      </div>

      <Section title="Mandates & status" sub={`${rows.length} association${rows.length === 1 ? '' : 's'}`}>
        {rows.length === 0 ? <Empty title="Not linked to any mandate yet"><button className="btn primary" onClick={() => setAssoc(true)}>Add to a mandate</button></Empty> :
          <div className="stack">{rows.map((r) => { const closed = r.status === 'rejected' || r.status === 'dropped'; return (
            <div key={r.association_id} className="card pad stack-s">
              <div className="row wrap"><Link to={`/mandates/${r.mandate_id}`} className="bold">{r.mandate_title}</Link><span className="gold small">{r.mandate_company}</span><Chip tone={tone(r.status)}>{stageLabel(r.stage)}</Chip>
                {closed && r.closed_reason && <Chip tone="red">{r.status === 'rejected' ? 'Rejected' : 'Dropped'} · {r.closed_reason}</Chip>}
                {r.joining_date && <Chip tone="gold">Joining {fmtDateShort(r.joining_date)}{r.joining_status ? ` · ${r.joining_status.replace('_', ' ')}` : ''}</Chip>}</div>
              <div className="row wrap gap-s">
                <button className="btn sm" onClick={() => setDlg({ row: r, intent: 'update' })}>Update status</button>
                {!closed && r.status !== 'selected' && r.status !== 'joined' && <button className="btn sm green" onClick={() => setDlg({ row: r, intent: 'select' })}>Select</button>}
                {!closed && <button className="btn sm danger" onClick={() => setDlg({ row: r, intent: 'reject' })}>Reject</button>}
                {!closed && <button className="btn sm danger" onClick={() => setDlg({ row: r, intent: 'drop' })}>Dropped out</button>}
                {closed && <button className="btn sm" onClick={() => setDlg({ row: r, intent: 'update' })}>Reopen</button>}
              </div>
            </div>); })}</div>}
      </Section>

      <div className="card pad">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'timeline', label: 'History & comments' }, { value: 'rounds', label: 'Interviews' }, { value: 'documents', label: `Documents (${files.data?.length ?? 0})` }, { value: 'checklist', label: 'Checklist' }]} />
        {tab === 'timeline' && (
          <div className="stack">
            <div className="row" style={{ alignItems: 'flex-start' }}><div className="grow"><TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" maxLength={4000} /></div>
              <button className="btn primary" disabled={busy || !comment.trim() || !primary} title={!primary ? 'Link the candidate to a mandate to comment' : ''} onClick={async () => { await run(() => api.addComment({ mandateId: primary!.mandate_id, candidateId: c.id, body: comment }), { success: 'Comment added', invalidate: refresh }); setComment(''); }}>Add comment</button></div>
            {timeline.length === 0 ? <Empty title="No history yet" /> : <div className="timeline">{timeline.map((t, i) => t.kind === 'c'
              ? <div key={i} className="tl-item c-grey"><div style={{ whiteSpace: 'pre-wrap' }}>{t.body}</div><div className="tiny muted">Comment · {fmtDateTime(t.at, settings.timezone)}</div></div>
              : <div key={i} className={`tl-item ${t.h!.reason_type ? 'c-red' : t.h!.to_status === 'joined' || t.h!.to_status === 'offered' || t.h!.to_status === 'selected' ? 'c-green' : ''}`}>
                  <div className="small"><b>{t.h!.from_stage ? `${stageLabel(t.h!.from_stage)} → ` : 'Added as '}{stageLabel(t.h!.to_stage)}</b>{t.h!.reason_type && <Chip tone="red">{t.h!.reason_type === 'rejection' ? 'Rejection' : 'Dropped'}: {t.h!.reason}</Chip>}</div>
                  {t.h!.comment && <div className="small dim" style={{ whiteSpace: 'pre-wrap' }}>“{t.h!.comment}”</div>}
                  <div className="tiny muted">{mandateName(t.h!.mandate_id)} · {fmtDateTime(t.at, settings.timezone)}</div></div>)}</div>}
          </div>)}
        {tab === 'rounds' && (rows.length === 0 ? <Empty title="Link a mandate to record interviews" /> :
          <div className="stack">{rows.map((r) => <div key={r.association_id} className="stack-s"><div className="row"><b>{r.mandate_title}</b><button className="btn xs right" onClick={() => setRound({ row: r, idx: -1 })}><Icon n="plus" size={13} /> Add round</button></div>
            {rounds(r).length === 0 ? <div className="muted small">No interviews recorded.</div> : rounds(r).map((x, i) => <div key={i} className="row wrap card pad small"><b>{x.round}</b><Chip tone={x.status === 'cleared' ? 'green' : x.status === 'rejected' ? 'red' : undefined}>{x.status}</Chip><span className="muted">{x.date ? fmtDate(x.date) : ''} {x.time}</span><span className="dim grow">{[x.panel, x.mode].filter(Boolean).join(' · ')}{x.feedback && ` — ${x.feedback}`}</span>
              <button className="btn xs" onClick={() => setRound({ row: r, idx: i })}>Edit</button></div>)}</div>)}</div>)}
        {tab === 'documents' && (
          <div className="stack"><div className="row"><input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => upload(e.target.files?.[0])} /><button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><Icon n="upload" size={15} /> Upload CV</button><span className="small muted">PDF or Word, max 10 MB, stored privately</span></div>
            {(files.data ?? []).length === 0 ? <Empty title="No documents" /> : (files.data ?? []).map((d) => <div key={d.id} className="row card pad"><Icon n="file" /><div className="grow"><div className="bold trunc">{d.file_name}</div><div className="tiny muted">{fmtDateTime(d.created_at, settings.timezone)}</div></div>
              <button className="btn sm" onClick={() => run(async () => window.open(await api.cvUrl(d.path), '_blank', 'noopener'))}>View</button><button className="btn sm" onClick={() => run(async () => window.open(await api.cvUrl(d.path, d.file_name), '_blank', 'noopener'))}><Icon n="download" size={14} /></button></div>)}</div>)}
        {tab === 'checklist' && ((steps.data ?? []).length === 0 ? <Empty title="No checklist steps for this candidate" /> : <div className="stack-s">{steps.data!.map((s) => <div key={s.id} className="row"><input type="checkbox" className="cb" checked={s.status === 'done'} onChange={(e) => run(() => api.setStep(s.id, { status: e.target.checked ? 'done' : 'todo' }), { invalidate: refresh })} aria-label={s.title} /><span style={{ textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{s.title}</span>{s.phase && <span className="tiny muted">{s.phase}</span>}</div>)}</div>)}
      </div>

      {edit && <CandidateForm candidate={c} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />}
      {dlg && <StageDialog row={dlg.row} intent={dlg.intent} onClose={() => setDlg(null)} />}
      {assoc && <Modal title="Add to a mandate" onClose={() => setAssoc(false)} footer={<><button className="btn" onClick={() => setAssoc(false)}>Cancel</button><button className="btn primary" disabled={busy || !assocId} onClick={async () => { await run(() => api.associate(c.id, assocId), { success: 'Added to mandate', invalidate: refresh }); setAssoc(false); setAssocId(''); }}>Add</button></>}>
        <Field label="Mandate" hint="A candidate can be considered for several mandates; each has its own pipeline status."><MandatePicker value={assocId} onChange={setAssocId} mandates={(mandates.data ?? []).filter((m) => !rows.some((r) => r.mandate_id === m.id))} /></Field></Modal>}
      {round && <RoundDialog value={round.idx >= 0 ? rounds(round.row)[round.idx] : undefined} onClose={() => setRound(null)} onSave={async (v) => { const cur = rounds(round.row); const next = round.idx >= 0 ? cur.map((x, i) => (i === round.idx ? v : x)) : [...cur, v]; await saveRounds(round.row, next); setRound(null); }} />}
    </div>
  );
}

function RoundDialog({ value, onClose, onSave }: { value?: Round; onClose: () => void; onSave: (r: Round) => void }) {
  const [r, setR] = useState<Round>(value ?? { round: 'Round 1', date: '', time: '', panel: '', mode: '', status: 'scheduled', feedback: '' });
  const set = (k: keyof Round, v: string) => setR({ ...r, [k]: v });
  return (
    <Modal title={value ? 'Edit interview' : 'Add interview round'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(r)}>Save</button></>}>
      <div className="form-grid">
        <Field label="Round"><Select value={r.round} onChange={(e) => set('round', e.target.value)} options={ROUND_NAMES} /></Field>
        <Field label="Status"><Select value={r.status} onChange={(e) => set('status', e.target.value)} options={ROUND_STATUS} /></Field>
        <Field label="Date"><TextInput type="date" value={r.date} onChange={(e) => set('date', e.target.value)} /></Field><Field label="Time"><TextInput type="time" value={r.time} onChange={(e) => set('time', e.target.value)} /></Field>
        <Field label="Panel"><TextInput value={r.panel} onChange={(e) => set('panel', e.target.value)} maxLength={160} /></Field><Field label="Mode"><TextInput value={r.mode} onChange={(e) => set('mode', e.target.value)} maxLength={60} placeholder="In person / video" /></Field>
        <Field label="Feedback" full><TextArea rows={3} value={r.feedback} onChange={(e) => set('feedback', e.target.value)} maxLength={2000} /></Field>
      </div>
    </Modal>
  );
}
