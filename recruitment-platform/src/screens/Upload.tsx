import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCtx, useWorld } from '@/app/hooks';
import { can } from '@/domain/permissions';
import type { ProcessingJob } from '@/domain/types';
import { createJob, ingestText, recoverStuckJobs, releaseQuarantine, resolveWithText, retryJob, runQueue, screenPending } from '@/services/pipeline';
import { screeningBlocker } from '@/services/rubrics';
import { Card, Empty, JobChip, Modal, PageHead, useAction, useToast } from '@/ui/kit';
import { fmtDateTime } from '@/ui/format';

export function Upload(): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const writable = can(ctx.user.role, 'cv.upload');
  const open = w.mandates.filter((m) => m.status === 'open');
  const mandateId = sp.get('mandate') ?? open[0]?.id ?? '';
  const mandate = w.mandates.find((m) => m.id === mandateId);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number }>();
  const [blocker, setBlocker] = useState<string>();
  const [textFor, setTextFor] = useState<ProcessingJob>();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const [stuck, setStuck] = useState<string[]>([]);

  useEffect(() => { if (mandate) void screeningBlocker(ctx, mandate).then(setBlocker); }, [ctx, mandate, w.rubrics]);
  useEffect(() => { setStuck(w.jobs.filter((j) => ['extracting', 'screening', 'queued'].includes(j.status) && j.storagePath && !busy).map((j) => j.id)); }, [w.jobs, busy]);

  const handle = async (files: File[]): Promise<void> => {
    if (!mandate || !files.length) return;
    setBusy({ done: 0, total: files.length });
    const ids: string[] = [];
    for (const f of files) {
      try {
        const j = await createJob(ctx, { mandateId: mandate.id, fileName: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        if (j.status === 'queued') ids.push(j.id);
      } catch (e) { toast(`${f.name}: ${e instanceof Error ? e.message : e}`, true); }
    }
    let done = files.length - ids.length;
    setBusy({ done, total: files.length });
    await runQueue(ctx, ids, { concurrency: 2, onDone: () => { done++; setBusy({ done, total: files.length }); } });
    setBusy(undefined);
    toast(`${files.length} file${files.length > 1 ? 's' : ''} processed. Check the queue for anything that needs review.`);
  };

  const jobs = w.jobs.filter((j) => filter === 'all' || j.status === filter);
  const mandateOf = (id: string): string => w.mandates.find((m) => m.id === id)?.code ?? '—';
  const dl = async (j: ProcessingJob): Promise<void> => {
    if (!j.storagePath) return;
    const url = await ctx.repo.fileUrl(j.storagePath);
    if (!url) { toast('The original file is not available.', true); return; }
    const a = document.createElement('a'); a.href = url; a.download = j.fileName; a.click();
  };

  return (
    <>
      <PageHead title="CV Upload & Processing" sub="Upload one CV or a batch. Each file is validated, security-screened, stored, extracted and screened. Nothing is silently discarded: a CV ends Completed, Needs Review or Failed, and its original stays downloadable." />
      {!writable ? <div className="callout warn">Your role is read-only. You can monitor the queue but cannot upload.</div> : (
        <Card title="Add CVs">
          <div className="stack">
            <div style={{ maxWidth: 460 }}>
              <div className="field"><label htmlFor="um">Mandate</label><select id="um" className="select" value={mandateId} onChange={(e) => setSp({ mandate: e.target.value })}>{open.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.title}</option>)}</select></div>
            </div>
            {blocker && <div className="callout warn small">{blocker} CVs you upload now will be extracted and wait; they are screened when a rubric is approved. {mandate && <Link to={`/mandates/${mandate.id}?tab=rubric`}>Go to rubric</Link>}</div>}
            <div className={`drop${over ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Choose CV files or drop them here"
              onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void handle([...e.dataTransfer.files]); }}>
              <b>Drop CVs here or click to choose</b><div className="muted small">PDF, DOC or DOCX · up to 10 MB each · bulk upload supported</div>
              <input ref={fileRef} type="file" multiple hidden accept=".pdf,.doc,.docx" onChange={(e) => { void handle([...(e.target.files ?? [])]); e.target.value = ''; }} />
            </div>
            {busy && <div className="callout info small" role="status">Processing {busy.done} of {busy.total}…</div>}
            <div className="row"><button className="btn sm" onClick={() => setPasteOpen(true)}>Add a CV as pasted text</button>
              {stuck.length > 0 && <button className="btn sm primary" onClick={() => void act(async () => { const ids = await recoverStuckJobs(ctx); await runQueue(ctx, ids); }, 'Interrupted files resumed.')}>Resume {stuck.length} interrupted file{stuck.length > 1 ? 's' : ''}</button>}
              {mandate && w.jobs.some((j) => j.mandateId === mandate.id && j.status === 'extracted') && !blocker && <button className="btn sm primary" onClick={() => void act(() => screenPending(ctx, mandate.id), 'Waiting CVs screened.')}>Screen waiting CVs</button>}</div>
          </div>
        </Card>
      )}

      <div style={{ height: 14 }} />
      <Card title="Processing queue" actions={<select className="select" style={{ width: 170 }} aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All statuses</option>{['queued', 'extracting', 'extracted', 'screening', 'completed', 'needs_review', 'failed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>} flush>
        {jobs.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>File</th><th>Mandate</th><th>Status</th><th>Detail</th><th>Updated</th><th /></tr></thead><tbody>
          {jobs.map((j) => <tr key={j.id}>
            <td><b>{j.fileName}</b><div className="muted small">{j.size ? `${Math.round(j.size / 1024)} KB` : ''}{j.attempts > 1 ? ` · attempt ${j.attempts}` : ''}</div></td>
            <td>{mandateOf(j.mandateId)}</td><td><JobChip status={j.status} /></td>
            <td className="small">{j.error && <div style={{ color: j.status === 'failed' ? 'var(--bad)' : 'var(--gold-2)' }}>{j.error}</div>}<div className="muted">{j.notes[j.notes.length - 1]}</div>
              <div className="row">{j.candidateId && <Link to={`/candidates/${j.candidateId}`}>Candidate</Link>}{j.assessmentId && <Link to={`/assessments/${j.assessmentId}`}>Assessment</Link>}</div></td>
            <td className="small">{fmtDateTime(j.updatedAt)}</td>
            <td><div className="row" style={{ justifyContent: 'flex-end' }}>
              {j.status === 'failed' && j.storagePath && writable && <button className="btn sm" onClick={() => void act(() => retryJob(ctx, j.id), 'Retried.')}>Retry</button>}
              {j.status === 'needs_review' && j.error?.startsWith('Quarantined') && can(ctx.user.role, 'config.manage') && <button className="btn sm" onClick={() => void act(async () => { const q = await releaseQuarantine(ctx, j.id); await runQueue(ctx, [q.id]); }, 'Released and processed.')}>Release</button>}
              {j.status === 'needs_review' && j.error?.includes('OCR') && writable && <button className="btn sm primary" onClick={() => setTextFor(j)}>Paste text</button>}
              {j.storagePath && can(ctx.user.role, 'cv.download') && <button className="btn sm ghost" onClick={() => void dl(j)}>Original</button>}</div></td>
          </tr>)}</tbody></table></div> : <Empty title="No files yet">Uploaded CVs and their processing status appear here.</Empty>}
      </Card>

      {textFor && <TextModal title={`Supply text for ${textFor.fileName}`} help="This file has no readable text layer and no OCR provider is configured. Paste the CV text to continue. The original file stays attached." onClose={() => setTextFor(undefined)}
        onSubmit={async (t) => { await act(() => resolveWithText(ctx, textFor.id, t), 'Text accepted; CV processed.'); setTextFor(undefined); }} />}
      {pasteOpen && mandate && <TextModal title="Add a CV as text" help="Paste the full CV. It is processed exactly like an uploaded file (no original file is stored)." withName onClose={() => setPasteOpen(false)}
        onSubmit={async (t, name) => { await act(() => ingestText(ctx, mandate.id, `${(name || 'Pasted CV').replace(/\.\w+$/, '')}.docx`, t), 'CV processed.'); setPasteOpen(false); }} />}
    </>
  );
}

function TextModal({ title, help, onClose, onSubmit, withName }: { title: string; help: string; onClose: () => void; onSubmit: (text: string, name: string) => Promise<void>; withName?: boolean }): ReactNode {
  const [t, setT] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || t.trim().length < 80} onClick={() => { setBusy(true); void onSubmit(t, name).finally(() => setBusy(false)); }}>{busy ? 'Processing…' : 'Process'}</button></>}>
      <p className="muted small">{help}</p>
      {withName && <div className="field"><label htmlFor="pn">File name</label><input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Candidate_Name_CV" /></div>}
      <textarea className="textarea" style={{ minHeight: 240 }} aria-label="CV text" value={t} onChange={(e) => setT(e.target.value)} />
    </Modal>
  );
}
