import { useMemo, useState, type ReactNode } from 'react';
import { useCtx, useWorld } from '@/app/hooks';
import { IS_CLOUD, useRuntime } from '@/app/runtime';
import { newId } from '@/data/repo';
import { DEMO_USERS, seedDemo } from '@/data/demo';
import type { LocalRepo } from '@/data/local';
import { can, ROLE_LABEL } from '@/domain/permissions';
import type { Role, UserProfile } from '@/domain/types';
import { audit } from '@/services/ctx';
import { Card, Chip, Empty, Field, Modal, PageHead, Tabs, useAction } from '@/ui/kit';
import { download, fmtDateTime } from '@/ui/format';

type Tab = 'users' | 'entities' | 'audit' | 'settings';

export function Admin(): ReactNode {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <>
      <PageHead title="Settings & Administration" sub="Users, roles and entity access, business entities, the audit trail and system settings." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'users', label: 'Users & access' }, { id: 'entities', label: 'Entities & departments' }, { id: 'audit', label: 'Audit log' }, { id: 'settings', label: 'System settings' }]} />
      {tab === 'users' && <Users />}{tab === 'entities' && <Entities />}{tab === 'audit' && <Audit />}{tab === 'settings' && <Settings />}
    </>
  );
}

function Users(): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const isSuper = ctx.user.role === 'super_admin';
  const save = (u: UserProfile, patch: Partial<UserProfile>): Promise<unknown> => act(async () => {
    if (u.id === ctx.user.id) throw new Error('You cannot change your own role, activation or entity access.');
    const next = { ...u, ...patch };
    if ((next.role === 'admin' || next.role === 'super_admin' || u.role === 'admin' || u.role === 'super_admin') && next.role !== u.role && !isSuper) throw new Error('Only a super admin can change administrator roles.');
    await ctx.repo.put('profiles', next);
    await audit(ctx, { action: 'user.update', targetType: 'user', targetId: u.id, summary: `${u.email}: ${Object.keys(patch).join(', ')} changed`, before: { role: u.role, active: u.active, entityIds: u.entityIds }, after: patch });
  }, 'User updated.');
  return (
    <Card flush>
      {IS_CLOUD && <div className="callout small" style={{ margin: 14 }}>People create their own account on the sign-in page. New accounts are inactive until you activate them and assign business entities here.</div>}
      {w.profiles.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>User</th><th>Role</th><th>Active</th><th>Business entities (recruiters and viewers)</th></tr></thead><tbody>
        {w.profiles.map((u) => {
          const central = u.role === 'admin' || u.role === 'super_admin';
          return <tr key={u.id}><td><b>{u.name.replace(/\s*\(.*\)/, '')}</b><div className="muted small">{u.email}</div></td>
            <td><select className="select" aria-label={`Role for ${u.email}`} value={u.role} disabled={u.id === ctx.user.id} onChange={(e) => void save(u, { role: e.target.value as Role, entityIds: e.target.value === 'admin' || e.target.value === 'super_admin' ? [] : u.entityIds })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r} disabled={(r === 'admin' || r === 'super_admin') && !isSuper}>{ROLE_LABEL[r]}</option>)}</select></td>
            <td><label className="check"><input type="checkbox" checked={u.active} disabled={u.id === ctx.user.id} onChange={(e) => void save(u, { active: e.target.checked })} style={{ accentColor: 'var(--gold)' }} /> {u.active ? 'Active' : 'Inactive'}</label></td>
            <td>{central ? <span className="muted small">Central administration — all entities</span> : <div className="row">{w.entities.map((e) => <label key={e.id} className="check small"><input type="checkbox" disabled={u.id === ctx.user.id} checked={u.entityIds.includes(e.id)} onChange={(ev) => void save(u, { entityIds: ev.target.checked ? [...u.entityIds, e.id] : u.entityIds.filter((x) => x !== e.id) })} style={{ accentColor: 'var(--gold)' }} />{e.name}</label>)}</div>}</td></tr>;
        })}</tbody></table></div> : <Empty title="No users" />}
    </Card>
  );
}

function Entities(): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const [open, setOpen] = useState<'entity' | 'dept'>();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [ent, setEnt] = useState('');
  const can_ = can(ctx.user.role, 'entities.manage');
  return (
    <div className="stack">
      <Card title="Business entities & departments" actions={can_ && <div className="row"><button className="btn sm" onClick={() => setOpen('entity')}>Add entity</button><button className="btn sm" onClick={() => setOpen('dept')}>Add department</button></div>} flush>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Entity</th><th>Code</th><th>Departments</th></tr></thead><tbody>{w.entities.map((e) => <tr key={e.id}><td><b>{e.name}</b></td><td>{e.code}</td><td className="small">{w.departments.filter((d) => d.entityId === e.id).map((d) => d.name).join(', ') || '—'}</td></tr>)}</tbody></table></div>
      </Card>
      {open && <Modal title={open === 'entity' ? 'Add business entity' : 'Add department'} onClose={() => setOpen(undefined)} footer={<><button className="btn ghost" onClick={() => setOpen(undefined)}>Cancel</button><button className="btn primary" disabled={!name.trim() || (open === 'entity' ? !code.trim() : !ent)} onClick={() => void act(async () => {
        if (open === 'entity') { const e = { id: newId(), name: name.trim(), code: code.trim().toUpperCase(), createdAt: new Date().toISOString() }; await ctx.repo.put('entities', e); await audit(ctx, { action: 'entity.create', targetType: 'entity', targetId: e.id, entityId: e.id, summary: `Created entity ${e.name}` }); }
        else { const d = { id: newId(), entityId: ent, name: name.trim() }; await ctx.repo.put('departments', d); await audit(ctx, { action: 'department.create', targetType: 'department', targetId: d.id, entityId: ent, summary: `Created department ${d.name}` }); }
        setOpen(undefined); setName(''); setCode('');
      }, 'Saved.')}>Save</button></>}>
        {open === 'dept' && <Field label="Entity">{(id) => <select id={id} className="select" value={ent} onChange={(e) => setEnt(e.target.value)}><option value="">Select…</option>{w.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}</Field>}
        <Field label="Name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        {open === 'entity' && <Field label="Short code">{(id) => <input id={id} className="input" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>}
      </Modal>}
    </div>
  );
}

function Audit(): ReactNode {
  const w = useWorld();
  const [q, setQ] = useState('');
  const rows = useMemo(() => w.audit.filter((a) => `${a.action} ${a.summary} ${a.userName}`.toLowerCase().includes(q.toLowerCase())), [w.audit, q]);
  const exportCsv = (): void => {
    const cell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
    download(new Blob([['When,User,Action,Target,Summary', ...rows.map((a) => [a.at, a.userName, a.action, `${a.targetType}:${a.targetId}`, a.summary].map(cell).join(','))].join('\n')], { type: 'text/csv' }), 'audit-log.csv');
  };
  return (
    <Card title={`Audit log (${rows.length})`} actions={<div className="row"><input className="input" style={{ width: 220 }} placeholder="Filter…" aria-label="Filter audit log" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn sm" onClick={exportCsv}>Export CSV</button></div>} flush>
      <p className="muted small" style={{ padding: '0 18px 10px' }}>Append-only: entries cannot be edited or deleted, even by administrators. Scoring changes, overrides, merges, approvals and access changes all land here.</p>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Summary</th></tr></thead><tbody>{rows.slice(0, 200).map((a) => <tr key={a.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</td><td className="small">{a.userName.replace(/\s*\(.*\)/, '')}</td><td><Chip tone="gold">{a.action}</Chip></td><td className="small">{a.summary}</td></tr>)}</tbody></table></div>
    </Card>
  );
}

function Settings(): ReactNode {
  const rt = useRuntime();
  const ctx = useCtx();
  const act = useAction();
  const [wipe, setWipe] = useState(false);
  const [probe, setProbe] = useState<string>();
  const test = async (): Promise<void> => {
    try { const r = await fetch('/api/ai'); const j = (await r.json()) as { ok?: boolean; model?: string; promptVersion?: string }; setProbe(j.ok ? `Reachable — model ${j.model}, prompt ${j.promptVersion}` : 'Not reachable'); } catch { setProbe('Not reachable. Deploy the /api/ai function and set ANTHROPIC_API_KEY.'); }
  };
  return (
    <div className="grid g2">
      <Card title="AI engine">
        <div className="stack">
          <label className="check"><input type="radio" name="ai" checked={rt.aiMode === 'heuristic'} onChange={() => rt.setAiMode('heuristic')} style={{ accentColor: 'var(--gold)' }} /> <span><b>Offline rules engine</b><br /><span className="muted small">Runs in the browser. No data leaves your device. Conservative keyword-in-context evidence; best for demos, tests and a safe fallback.</span></span></label>
          <label className="check"><input type="radio" name="ai" disabled={!IS_CLOUD} checked={rt.aiMode === 'claude'} onChange={() => rt.setAiMode('claude')} style={{ accentColor: 'var(--gold)' }} /> <span><b>Claude (hosted model via the secure proxy)</b><br /><span className="muted small">{IS_CLOUD ? 'CV text is sent to the AI provider through /api/ai using your session. Confirm your data-processing agreement and retention terms first.' : 'Available in cloud mode only (needs Supabase sign-in and the /api/ai function).'}</span></span></label>
          {IS_CLOUD && <div className="row"><button className="btn sm" onClick={() => void test()}>Test connection</button>{probe && <span className="small muted">{probe}</span>}</div>}
          <div className="callout small">Every assessment records the engine, model and prompt version that produced it. Switching engines never changes stored scores, the rubric or the audit trail.</div>
        </div>
      </Card>
      <Card title="Data & deployment">
        <dl className="kv small"><dt>Mode</dt><dd>{rt.mode === 'local' ? 'Local demo — data stays in this browser (IndexedDB).' : 'Cloud — Supabase Postgres with row-level security and private file storage.'}</dd>
          <dt>Screening policy</dt><dd>Threshold 75, borderline review 70–74.9, per-mandate configurable.</dd>
          <dt>OCR</dt><dd>Not configured — scanned PDFs are routed to Needs Review.</dd>
          <dt>Malware scan</dt><dd>Structural checks only (active content, macros, EICAR). Add a real scanner for production.</dd>
          <dt>Retention</dt><dd>Defined retention periods and candidate-rights workflows are a policy decision still to be confirmed.</dd></dl>
        {!IS_CLOUD && <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void act(async () => { await seedDemo({ ...ctx, user: DEMO_USERS[0] }); }, 'Demo data loaded.')}>Load demo data</button>
          <button className="btn danger" onClick={() => setWipe(true)}>Erase all local data</button></div>}
      </Card>
      {wipe && <Modal title="Erase all local data?" onClose={() => setWipe(false)} footer={<><button className="btn ghost" onClick={() => setWipe(false)}>Cancel</button><button className="btn danger" onClick={() => void act(async () => { await (rt.repo as LocalRepo).wipe(); const { ensureBaseData } = await import('@/data/demo'); await ensureBaseData(rt.repo); setWipe(false); }, 'All local data erased.')}>Erase everything</button></>}>
        <p>This permanently deletes every mandate, CV, candidate, assessment and audit record stored in this browser. It cannot be undone. (In cloud mode records are never hard-deleted.)</p>
      </Modal>}
    </div>
  );
}
