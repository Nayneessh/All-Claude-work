import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, exportEverything } from '../../data/api';
import { useAction, useSettings } from '../../data/hooks';
import { supabase } from '../../lib/supabase';
import { fmtDateTime } from '../../lib/time';
import { Chip, Empty, Loading, Section } from '../../ui/kit';
import { useAuth } from '../auth/AuthProvider';

export function DataTab() {
  const { settings } = useSettings(); const { user } = useAuth(); const { run, busy } = useAction();
  const backups = useQuery({ queryKey: ['backups'], queryFn: api.backups }); const [audit, setAudit] = useState(false);
  const al = useQuery({ queryKey: ['audit'], queryFn: () => api.audit(100), enabled: audit });
  async function download() {
    await run(async () => {
      const data = await exportEverything(); const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), app: 'THE SLATE', version: 1, tables: data }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `the-slate-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, { success: 'Export downloaded — it contains confidential data, store it safely.' });
  }
  async function backupNow() { await run(async () => { const { data, error } = await supabase.functions.invoke('backup', { body: { manual: true } }); if (error) throw new Error(error.message); if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error); }, { success: 'Backup completed', invalidate: [['backups']] }); }
  const last = (backups.data ?? []).find((b) => b.status === 'ok');
  return (
    <div className="stack">
      <Section title="Backups" sub="nightly snapshot of all your data, kept 30 days" actions={<button className="btn sm" onClick={backupNow} disabled={busy}>Back up now</button>}>
        {backups.isLoading ? <Loading /> : !last ? <div className="banner warn">No completed backup yet. The first runs automatically tonight, or press “Back up now”.</div> : <div className="banner good">Last good backup: <b>{fmtDateTime(last.finished_at, settings.timezone)}</b> · {((last.size_bytes ?? 0) / 1024).toFixed(0)} KB · {last.verified ? 'verified against the live row counts ✓' : 'not yet verified'}</div>}
        {(backups.data ?? []).length > 0 && <div className="scroll-x" style={{ marginTop: 10 }}><table className="t"><thead><tr><th>Started</th><th>Result</th><th className="num">Size</th><th>Rows</th><th>Verified</th></tr></thead><tbody>{backups.data!.map((b) => <tr key={b.id}><td className="small">{fmtDateTime(b.started_at, settings.timezone)}</td><td><Chip tone={b.status === 'ok' ? 'green' : b.status === 'failed' ? 'red' : 'amber'}>{b.status}</Chip>{b.error && <span className="tiny red"> {b.error}</span>}</td><td className="num small">{((b.size_bytes ?? 0) / 1024).toFixed(0)} KB</td><td className="small muted">{Object.values(b.row_counts ?? {}).reduce((a, c) => a + Number(c), 0)}</td><td>{b.verified ? '✓' : '—'}</td></tr>)}</tbody></table></div>}
        <div className="tiny muted" style={{ marginTop: 8 }}>The backup lives in private storage inside the same Supabase project. Keep an off-platform copy too: use “Download everything” regularly (see docs/BACKUP_AND_RECOVERY.md).</div>
      </Section>
      <Section title="Export your data" sub="a complete, portable copy">
        <div className="row"><button className="btn primary" onClick={download} disabled={busy}>{busy ? <span className="spinner" /> : 'Download everything (JSON)'}</button><span className="small muted">Mandates, candidates, history, tasks, SOP, settings and the audit log. Uploaded files (JDs, CVs) stay in private storage.</span></div>
      </Section>
      <Section title="Security" sub={user?.email ?? ''}>
        <ul className="small dim" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Every table is protected by row-level security — only your account can read or change your records.</li>
          <li>Job descriptions and CVs are stored in private buckets and opened through short-lived links (5 minutes).</li>
          <li>Candidate history, activity and audit tables cannot be edited or deleted from the app.</li>
          <li>Set “Sign out after inactivity” in Preferences to lock an unattended screen.</li>
        </ul>
        <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={() => setAudit(!audit)}>{audit ? 'Hide' : 'Show'} audit log</button></div>
        {audit && (al.isLoading ? <Loading /> : (al.data ?? []).length === 0 ? <Empty title="No audit entries yet" /> : <div className="scroll-x" style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}><table className="t"><thead><tr><th>When</th><th>Table</th><th>Action</th><th>Changed</th></tr></thead><tbody>{al.data!.map((r) => <tr key={r.id}><td className="small">{fmtDateTime(r.at, settings.timezone)}</td><td className="small mono">{r.table_name}</td><td><Chip tone={r.action === 'DELETE' ? 'red' : r.action === 'INSERT' ? 'green' : undefined}>{r.action}</Chip></td><td className="tiny muted trunc" style={{ maxWidth: 360 }}>{r.action === 'UPDATE' ? Object.keys((r.changes ?? {}) as object).join(', ') : ''}</td></tr>)}</tbody></table></div>)}
      </Section>
    </div>
  );
}
