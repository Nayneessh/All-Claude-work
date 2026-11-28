import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data/api';
import { useSettings } from '../../data/hooks';
import type { SopDoc } from '../../domain/types';
import { fmtDateTime } from '../../lib/time';
import { friendlyError } from '../../lib/supabase';
import { ErrorBox, Loading } from '../../ui/kit';
import { Modal } from '../../ui/Modal';

type Status = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
/**
 * Intentionally simple: one document, a big text area, automatic saving.
 * Safety: saves use optimistic concurrency (a stale tab can never silently overwrite newer text), and the database keeps
 * the last 50 revisions. The table already supports several documents for later expansion.
 */
export default function SopPage() {
  const { settings } = useSettings();
  const q = useQuery({ queryKey: ['sop'], queryFn: api.sop, staleTime: Infinity, refetchOnWindowFocus: false });
  const [doc, setDoc] = useState<SopDoc | null>(null); const [text, setText] = useState(''); const [status, setStatus] = useState<Status>('saved'); const [msg, setMsg] = useState('');
  const [hist, setHist] = useState(false); const timer = useRef<ReturnType<typeof setTimeout>>(undefined); const latest = useRef({ text: '', doc: null as SopDoc | null, saving: false });
  const revs = useQuery({ queryKey: ['sop-rev', doc?.id, status === 'saved'], queryFn: () => api.sopRevisions(doc!.id), enabled: hist && !!doc });

  useEffect(() => { if (q.data && !doc) { setDoc(q.data); setText(q.data.body); latest.current = { text: q.data.body, doc: q.data, saving: false }; } }, [q.data, doc]);

  const flush = useCallback(async () => {
    const l = latest.current; if (!l.doc || l.saving) return; if (l.text === l.doc.body) { setStatus('saved'); return; }
    l.saving = true; setStatus('saving'); const sent = l.text;
    try {
      const saved = await api.saveSop(l.doc.id, sent, l.doc.updated_at);
      if (!saved) { setStatus('conflict'); return; }
      latest.current.doc = saved; setDoc(saved);
      if (latest.current.text !== sent) { setStatus('dirty'); timer.current = setTimeout(flush, 600); } else setStatus('saved');
    } catch (e) { setStatus('error'); setMsg(friendlyError(e)); timer.current = setTimeout(flush, 8000); }
    finally { latest.current.saving = false; }
  }, []);
  const onChange = (v: string) => { setText(v); latest.current.text = v; setStatus('dirty'); clearTimeout(timer.current); timer.current = setTimeout(flush, 900); };
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (latest.current.text !== latest.current.doc?.body) { flush(); e.preventDefault(); e.returnValue = ''; } };
    const vis = () => { if (document.hidden) flush(); };
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', vis); clearTimeout(timer.current); flush(); };
  }, [flush]);

  async function reloadLatest() { const d = await api.sop(); setDoc(d); setText(d.body); latest.current = { text: d.body, doc: d, saving: false }; setStatus('saved'); }
  async function overwrite() { const d = await api.sop(); latest.current.doc = { ...d, body: '' }; setDoc(d); setStatus('dirty'); flush(); }

  if (q.isLoading || !doc) return q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <Loading />;
  const label = { saved: `Saved · ${fmtDateTime(doc.updated_at, settings.timezone)}`, dirty: 'Unsaved changes…', saving: 'Saving…', error: `Could not save — retrying (${msg})`, conflict: 'Changed on another device' }[status];
  return (
    <div className="stack">
      <div className="row wrap"><h1>SOP</h1><span className="muted">Standard operating procedures</span>
        <div className="right row"><span className={`chip ${status === 'saved' ? 'green' : status === 'error' || status === 'conflict' ? 'red' : 'amber'}`} role="status" aria-live="polite">{label}</span><button className="btn sm" onClick={() => setHist(true)}>History</button></div></div>
      {status === 'conflict' && <div className="banner bad" role="alert"><div className="grow"><b>This SOP was changed somewhere else.</b> Your last edit was not saved so nothing is overwritten.</div><button className="btn sm" onClick={reloadLatest}>Load latest</button><button className="btn sm danger" onClick={overwrite}>Keep mine</button></div>}
      <textarea className="sop-area" value={text} onChange={(e) => onChange(e.target.value)} placeholder="Write your standard operating procedures here. Everything is saved automatically." aria-label="SOP content" spellCheck />
      <div className="tiny muted">{text.length.toLocaleString()} characters · saved automatically · the last 50 versions are kept</div>
      {hist && <Modal title="Earlier versions" onClose={() => setHist(false)} wide>
        {revs.isLoading ? <Loading /> : (revs.data ?? []).length === 0 ? <div className="muted">No earlier versions yet — they appear as you edit.</div> :
          <div className="stack">{revs.data!.map((r) => <div key={r.id} className="card pad stack-s"><div className="row"><b>{fmtDateTime(r.saved_at, settings.timezone)}</b><span className="muted small">{r.body.length.toLocaleString()} characters</span><button className="btn sm right" onClick={() => { onChange(r.body); setHist(false); }}>Restore this version</button></div>
            <div className="small dim" style={{ whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'hidden' }}>{r.body.slice(0, 400) || '(empty)'}</div></div>)}</div>}</Modal>}
    </div>
  );
}
