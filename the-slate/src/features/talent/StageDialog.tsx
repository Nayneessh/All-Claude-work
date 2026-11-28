import { useMemo, useState } from 'react';
import { api } from '../../data/api';
import { ALL_RECRUITMENT_KEYS, useAction, useConfig } from '../../data/hooks';
import type { ConfigOption, PipelineRow } from '../../domain/types';
import { Field, Select, TextArea, TextInput } from '../../ui/kit';
import { Modal } from '../../ui/Modal';

export type StageIntent = 'update' | 'select' | 'reject' | 'drop';
const pick = (stages: ConfigOption[], kind: string) => stages.find((s) => s.meta.kind === kind)?.key;

/** Update status / Select / Reject / Drop. Rejection and drop are separate classifications with their own configurable reasons; a reason is mandatory. */
export function StageDialog({ row, intent, onClose, onDone }: { row: PipelineRow; intent: StageIntent; onClose: () => void; onDone?: () => void }) {
  const cfg = useConfig(); const { run, busy } = useAction();
  const stages = cfg.stages;
  const initial = intent === 'select' ? pick(stages, 'selected') : intent === 'reject' ? pick(stages, 'rejected') : intent === 'drop' ? pick(stages, 'dropped') : row.stage;
  const [stage, setStage] = useState(initial ?? row.stage); const [reason, setReason] = useState(''); const [other, setOther] = useState(''); const [comment, setComment] = useState('');
  const [joining, setJoining] = useState(row.joining_date ?? ''); const [ctc, setCtc] = useState(row.offered_ctc ?? ''); const [jstatus, setJstatus] = useState(row.joining_status ?? '');
  const kind = stages.find((s) => s.key === stage)?.meta.kind ?? 'progress';
  const reasons = useMemo(() => (kind === 'rejected' ? cfg.labels('rejection_reason') : kind === 'dropped' ? cfg.labels('drop_reason') : []), [kind, cfg]);
  const finalReason = reason === 'Other' || reason === 'Other rejection' ? (other.trim() ? `Other: ${other.trim()}` : '') : reason;
  const needsReason = kind === 'rejected' || kind === 'dropped';
  const needsJoining = kind === 'offered' || kind === 'selected' || kind === 'joined';
  const invalid = needsReason && !finalReason;
  const title = intent === 'select' ? 'Select candidate' : intent === 'reject' ? 'Reject candidate' : intent === 'drop' ? 'Candidate dropped out' : 'Update status';

  return (
    <Modal title={`${title} — ${row.name}`} onClose={onClose} dirty={!!comment || !!reason}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${kind === 'rejected' || kind === 'dropped' ? 'danger' : 'primary'}`} disabled={busy || invalid || stage === row.stage && !comment && !needsReason}
        onClick={async () => { const ok = await run(() => api.setStage({ candidate: row.candidate_id, mandate: row.mandate_id, stage, reason: finalReason, comment, joiningDate: joining || null, offeredCtc: ctc || null, joiningStatus: jstatus || null }), { success: 'Status recorded', invalidate: ALL_RECRUITMENT_KEYS }); if (ok) { onDone?.(); onClose(); } }}>{busy ? <span className="spinner" /> : 'Record change'}</button></>}>
      <div className="stack">
        <div className="small muted">{row.mandate_title}{row.mandate_company ? ` — ${row.mandate_company}` : ''} · currently <b className="dim">{cfg.allStages.find((s) => s.key === row.stage)?.label ?? row.stage}</b></div>
        <Field label="New status"><Select value={stage} onChange={(e) => { setStage(e.target.value); setReason(''); setOther(''); }} options={stages.map((s) => ({ value: s.key, label: s.label }))} /></Field>
        {needsReason && (
          <Field label={kind === 'rejected' ? 'Rejection reason' : 'Reason the candidate dropped'} required hint={kind === 'rejected' ? 'The candidate was turned down.' : 'The candidate stepped back / was lost.'}>
            <Select value={reason} onChange={(e) => setReason(e.target.value)} options={reasons} placeholder="Select a reason…" />
            {(reason === 'Other' || reason === 'Other rejection') && <TextInput value={other} onChange={(e) => setOther(e.target.value)} placeholder="Describe the reason" maxLength={200} style={{ marginTop: 6 }} />}
          </Field>)}
        {needsJoining && (
          <div className="form-grid">
            <Field label="Expected joining date"><TextInput type="date" value={joining} onChange={(e) => setJoining(e.target.value)} /></Field>
            <Field label="Joining status"><Select value={jstatus} onChange={(e) => setJstatus(e.target.value)} options={[{ value: 'expected', label: 'Expected' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'at_risk', label: 'At risk' }, { value: 'deferred', label: 'Deferred' }, { value: 'joined', label: 'Joined' }]} placeholder="—" /></Field>
            {kind !== 'selected' && <Field label="Offered CTC" full><TextInput value={ctc} onChange={(e) => setCtc(e.target.value)} maxLength={80} /></Field>}
          </div>)}
        <Field label="Comment" hint="Saved with this change in the history."><TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Optional note…" /></Field>
        <div className="small muted">The previous status, new status, date/time, reason and comment are all recorded permanently — earlier history is never overwritten.</div>
      </div>
    </Modal>
  );
}
