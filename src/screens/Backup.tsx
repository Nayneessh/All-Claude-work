import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackupFormatError, createSnapshot, exportBackup, exportCsv, importBackup, listSnapshots, parseBackup, readSnapshot, type BackupFile, type SnapshotInfo } from '@/data/backup';
import { listArchivedSessions } from '@/data/repo/history';
import { restoreArchivedSession } from '@/data/repo/sessions';
import { loadConflicts, loadFailures, retryFailures } from '@/data/sync/engine';
import { Badge, Banner, Button, Card, Empty, Section, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, errMsg, plural } from '@/ui/format';
import { shareFile } from '@/services/platform';

const when = (iso: string | null): string => (iso ? `${fmtDate(iso.slice(0, 10), { year: true })} ${iso.slice(11, 16)}` : 'never');

export function Backup() {
  const nav = useNavigate();
  const ui = useUi();
  const { today, sync, auth } = useApp();
  const snaps = useLive(() => listSnapshots(), []);
  const removed = useLive(() => listArchivedSessions(), []);
  const persisted = useLive(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : false), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: BackupFile; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportJson(): Promise<void> {
    setBusy(true);
    try { const b = await exportBackup(); const how = await shareFile(`monster-gains-backup-${today}.json`, JSON.stringify(b)); ui.toast(how === 'shared' ? 'Choose where to save it (Drive, Files…)' : 'Backup downloaded', { tone: 'ok' }); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }
  async function csv(kind: 'sets' | 'sessions' | 'body'): Promise<void> {
    try { await shareFile(`monster-gains-${kind}-${today}.csv`, await exportCsv(kind), 'text/csv'); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  async function onFile(f: File | undefined): Promise<void> {
    if (!f) return;
    try { setPreview({ file: parseBackup(await f.text()), name: f.name }); } catch (e) { ui.toast(e instanceof BackupFormatError ? e.message : errMsg(e), { tone: 'err' }); }
  }
  async function doRestore(file: BackupFile): Promise<void> {
    setBusy(true);
    try { const r = await importBackup(file); ui.toast(`Restored: ${r.added} added, ${r.updated} updated, ${r.skippedNewerLocal} kept (newer on this phone)`, { tone: 'ok' }); setPreview(null); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }
  const total = (f: BackupFile): number => Object.values(f.counts ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Backup &amp; export</h1></div>
      <Card tone="hl">
        <div className="eyebrow">Your safety net</div>
        <div className="col mt-2" style={{ gap: 8 }}>
          <div className="row-flex between small"><span>Cloud backup</span>{auth.status === 'signed_in' ? <Badge tone={sync.pending ? 'warn' : 'ok'}>{sync.pending ? `${sync.pending} waiting` : 'up to date'}</Badge> : <Badge tone="warn">not signed in</Badge>}</div>
          <div className="row-flex between small"><span>Last synced</span><span className="dim">{when(sync.lastSyncAt)}</span></div>
          <div className="row-flex between small"><span>Last on-device snapshot</span><span className="dim">{snaps.data?.[0] ? when(snaps.data[0].at) : 'none yet'}</span></div>
          <div className="row-flex between small"><span>Storage protected from clean-up</span><Badge tone={persisted.data ? 'ok' : 'dim'}>{persisted.data ? 'yes' : 'not guaranteed'}</Badge></div>
        </div>
        {auth.status !== 'signed_in' && <Banner icon="cloud" action={<Button small variant="soft" onClick={() => nav('/auth')}>Sign in</Button>}>Sign in so your history is also saved off this phone.</Banner>}
      </Card>

      <Section title="Export">
        <div className="col">
          <Button variant="primary" block icon="download" disabled={busy} onClick={() => void exportJson()}>Save a full backup (JSON)</Button>
          <p className="tiny dim">Everything: programs, every set, goals, body metrics, history of changes. Keep a copy in Drive or email it to yourself.</p>
          <div className="row-flex"><Button block small onClick={() => void csv('sets')}>Sets (CSV)</Button><Button block small onClick={() => void csv('sessions')}>Workouts (CSV)</Button><Button block small onClick={() => void csv('body')}>Body (CSV)</Button></div>
        </div>
      </Section>

      <Section title="Restore">
        <Card>
          <p className="small">Restoring <strong>merges</strong>: it adds anything missing and updates older records, but never overwrites something you changed more recently. A safety snapshot is taken first.</p>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="Choose a backup file" />
          <Button block className="mt-3" icon="upload" onClick={() => fileRef.current?.click()}>Choose a backup file…</Button>
        </Card>
      </Section>

      <Section title="Automatic snapshots" action={<Button small variant="soft" onClick={async () => { await createSnapshot('manual'); ui.toast('Snapshot saved', { tone: 'ok' }); }}>Snapshot now</Button>}>
        <Card className="pad-0"><div className="list">
          {(snaps.data ?? []).map((s: SnapshotInfo) => <div key={s.name} className="item"><div className="grow"><div className="strong">{when(s.at)}</div><div className="small dim">{s.reason} · {Math.round(s.size / 1024)} KB</div></div><Button small onClick={async () => { try { const f = await readSnapshot(s.name); setPreview({ file: f, name: s.name }); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } }}>Restore</Button></div>)}
          {(snaps.data?.length ?? 0) === 0 && <div className="item dim small">A snapshot is taken automatically once a day and before every restore (last 7 + 3 kept).</div>}
        </div></Card>
      </Section>

      <Section title="Removed workouts">
        {(removed.data?.length ?? 0) === 0 ? <Card><p className="small dim">Workouts you remove are kept here, never destroyed.</p></Card> : (
          <Card className="pad-0"><div className="list">{removed.data?.map((s) => <div key={s.id} className="item"><div className="grow"><div className="strong">{s.name.split(' — ')[1] ?? s.name}</div><div className="small dim">{fmtDate(s.session_date, { year: true })}</div></div><Button small onClick={async () => { await restoreArchivedSession(s.id); ui.toast('Workout restored', { tone: 'ok' }); }}>Restore</Button></div>)}</div></Card>
        )}
      </Section>

      <Sheet open={!!preview} onClose={() => setPreview(null)} title="Restore this backup?" footer={<Button block variant="primary" disabled={busy} onClick={() => preview && void doRestore(preview.file)}>{busy ? 'Restoring…' : 'Restore (merge)'}</Button>}>
        {preview && (
          <div className="col">
            <div className="small dim">{preview.name} · saved {when(preview.file.exported_at)}</div>
            <div className="card blue"><div className="strong">{plural(total(preview.file), 'record')}</div><div className="small dim mt-1">{plural(preview.file.counts.workout_sessions ?? 0, 'workout')} · {plural(preview.file.counts.set_records ?? 0, 'set')} · {plural(preview.file.counts.programs ?? 0, 'program')} · {plural(preview.file.counts.body_measurements ?? 0, 'measurement')}</div></div>
            <Banner icon="info">Newer data on this phone is always kept. Nothing is deleted.</Banner>
          </div>
        )}
      </Sheet>
    </div>
  );
}

export function SyncStatus() {
  const nav = useNavigate();
  const ui = useUi();
  const { sync, syncNow, auth, online } = useApp();
  const failures = useLive(() => loadFailures(), [sync.failures]);
  const conflicts = useLive(() => loadConflicts(), [sync.conflicts]);
  const label = auth.status !== 'signed_in' ? 'Not signed in' : !online ? 'Offline' : sync.status === 'syncing' ? 'Syncing…' : sync.status === 'error' ? 'Will retry' : sync.pending ? 'Waiting to sync' : 'Everything is backed up';
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Sync</h1></div>
      <Card tone="hl">
        <div className="row-flex between"><div><div className="eyebrow">Status</div><h2>{label}</h2></div><Icon name={auth.status === 'signed_in' && online ? 'cloud' : 'cloudoff'} size={32} className="gold" /></div>
        <div className="row-flex between small mt-3"><span className="dim">Waiting to upload</span><span className="strong">{plural(sync.pending, 'item')}</span></div>
        <div className="row-flex between small mt-1"><span className="dim">Last successful sync</span><span>{when(sync.lastSyncAt)}</span></div>
        {sync.lastError && <p className="small bad mt-2">Last problem: {sync.lastError}</p>}
        <p className="tiny dim mt-3">Every set is saved on this phone first — syncing only adds a cloud copy. If you're offline, changes wait here and upload automatically; nothing is lost and nothing is uploaded twice.</p>
        <div className="row-flex mt-3">{auth.status === 'signed_in' ? <Button block variant="primary" icon="refresh" disabled={!online || sync.status === 'syncing'} onClick={async () => { await syncNow(); ui.toast('Sync finished'); }}>Sync now</Button> : <Button block variant="primary" onClick={() => nav('/auth')}>Sign in to sync</Button>}</div>
      </Card>
      <Section title={`Held back (${Object.keys(failures.data ?? {}).length})`}>
        {Object.keys(failures.data ?? {}).length === 0 ? <Card><p className="small dim">Nothing is being rejected by the server.</p></Card> : (
          <Card><p className="small">These items could not be saved to the cloud. They are safe on this phone. {' '}</p>{Object.entries(failures.data ?? {}).map(([k, v]) => <div key={k} className="small mt-2"><span className="gold">{k.split(':')[0]}</span> — {v.message}</div>)}<Button small className="mt-3" onClick={async () => { await retryFailures(); await syncNow(); }}>Try again</Button></Card>
        )}
      </Section>
      <Section title={`Edit conflicts (${conflicts.data?.length ?? 0})`}>
        {(conflicts.data?.length ?? 0) === 0 ? <Card><Empty icon="check" title="No conflicts" hint="A conflict happens only if two devices edit the same set while apart. The newest edit wins and the replaced one is listed here." /></Card> : (
          <Card><p className="small dim">The newer edit won. These older versions were replaced — they're listed so nothing disappears silently.</p>{conflicts.data?.map((c) => <div key={`${c.table}${c.id}${c.at}`} className="card mt-2" style={{ padding: 10 }}><div className="small"><span className="gold">{c.table}</span> · {when(c.at)}</div><div className="tiny dim" style={{ wordBreak: 'break-all' }}>{JSON.stringify(Object.fromEntries(Object.entries(c.lost).filter(([k]) => !['id', 'user_id', 'created_at', 'device_id'].includes(k)).slice(0, 8)))}</div></div>)}</Card>
        )}
      </Section>
    </div>
  );
}
