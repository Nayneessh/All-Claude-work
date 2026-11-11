import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCtx, useWorld } from '@/app/hooks';
import { extractText } from '@/docs/extract';
import { kindFromName } from '@/docs/validate';
import { can } from '@/domain/permissions';
import { diffMandate } from '@/domain/rubric';
import { validateWeights } from '@/domain/scoring';
import { CATEGORY_LABEL, type Mandate, type MandateStatus, type Priority, type Rubric, type RubricCriterion } from '@/domain/types';
import { createMandate, duplicateMandate, setMandateStatus, updateMandate, validateMandate, type MandateInput } from '@/services/mandates';
import { screenPending } from '@/services/pipeline';
import { approveRubricVersion, generateRubric, reviseRubricVersion, saveRubricDraft, screeningBlocker } from '@/services/rubrics';
import { Card, Chip, Empty, Field, Modal, PageHead, StatusChip, Tabs, useAction, useToast } from '@/ui/kit';
import { fmtDate, fmtDateTime } from '@/ui/format';

const csv = (s: string): string[] => s.split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
const rubricLabel = (rs: Rubric[], m: Mandate): { tone: 'ok' | 'caution' | 'neutral' | 'info'; text: string } => {
  const active = rs.find((r) => r.id === m.activeRubricId);
  if (active) return active.mandateVersion === m.version ? { tone: 'ok', text: `Approved v${active.version}` } : { tone: 'caution', text: `v${active.version} out of date` };
  return rs.some((r) => r.status === 'draft') ? { tone: 'info', text: 'Draft awaiting approval' } : { tone: 'neutral', text: 'No rubric' };
};

// ───────────────────────── List ─────────────────────────
export function Mandates(): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<MandateStatus | 'all'>('all');
  const [entity, setEntity] = useState('');
  const list = w.mandates.filter((m) => (status === 'all' || m.status === status) && (!entity || m.entityId === entity) && `${m.code} ${m.title} ${m.function}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead title="Hiring Mandates" sub="Every hiring requirement is its own record with its own rubric and screening history."
        actions={can(ctx.user.role, 'mandate.write') && <Link className="btn primary" to="/mandates/new">New mandate</Link>} />
      <div className="card" style={{ marginBottom: 14 }}><div className="form-grid">
        <div className="field"><label htmlFor="q">Search</label><input id="q" className="input" placeholder="Title, code, function" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="s">Status</label><select id="s" className="select" value={status} onChange={(e) => setStatus(e.target.value as MandateStatus | 'all')}><option value="all">All</option><option value="open">Open</option><option value="on_hold">On hold</option><option value="closed">Closed</option><option value="archived">Archived</option></select></div>
        <div className="field"><label htmlFor="e">Entity</label><select id="e" className="select" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">All</option>{w.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
      </div></div>
      <Card flush>
        {list.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Mandate</th><th>Entity</th><th>Status</th><th>Priority</th><th>Rubric</th><th className="num">CVs</th><th className="num">Qualified</th><th>Target</th></tr></thead>
          <tbody>{list.map((m) => {
            const rs = w.rubrics.filter((r) => r.mandateId === m.id);
            const rl = rubricLabel(rs, m);
            const rows = w.rows.filter((r) => r.mandate.id === m.id);
            return <tr key={m.id}><td><Link to={`/mandates/${m.id}`}><b>{m.code}</b></Link> {m.title}<div className="muted small">{m.function} · {m.location} · v{m.version}</div></td>
              <td>{w.entities.find((e) => e.id === m.entityId)?.name}</td>
              <td><Chip tone={m.status === 'open' ? 'ok' : m.status === 'on_hold' ? 'caution' : 'neutral'}>{m.status.replace('_', ' ')}</Chip></td>
              <td><Chip tone={m.priority === 'critical' ? 'bad' : m.priority === 'high' ? 'gold' : 'neutral'}>{m.priority}</Chip></td>
              <td><Chip tone={rl.tone}>{rl.text}</Chip></td>
              <td className="num">{w.jobs.filter((j) => j.mandateId === m.id).length}</td>
              <td className="num">{rows.filter((r) => ['exceptional_match', 'strong_match', 'potential_match'].includes(r.status)).length}</td>
              <td>{fmtDate(m.targetDate)}</td></tr>;
          })}</tbody></table></div> : <Empty title="No mandates match" />}
      </Card>
    </>
  );
}

// ───────────────────────── Form ─────────────────────────
const BLANK: MandateInput = {
  entityId: '', title: '', function: '', reportingManager: '', location: '', minExperience: 10, education: '', certifications: [], competencies: [],
  mandatoryIndustries: [], preferredIndustries: [], currency: 'INR', priority: 'medium', hiringManager: '', jdText: '',
};

export function MandateForm({ editing }: { editing?: Mandate }): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const nav = useNavigate();
  const act = useAction();
  const toast = useToast();
  const [m, setM] = useState<MandateInput>(() => (editing ? (({ id: _i, code: _c, version: _v, status: _s, activeRubricId: _r, createdBy: _b, createdAt: _a, updatedAt: _u, ...rest }) => rest)(editing) : { ...BLANK, entityId: w.entities[0]?.id ?? '' }));
  const [confirm, setConfirm] = useState<string[]>();
  const set = <K extends keyof MandateInput>(k: K, v: MandateInput[K]): void => setM((x) => ({ ...x, [k]: v }));
  const problems = validateMandate(m);
  const depts = w.departments.filter((d) => d.entityId === m.entityId);

  const readJd = async (file: File): Promise<void> => {
    const kind = kindFromName(file.name);
    let text = '';
    if (/\.(txt|md)$/i.test(file.name)) text = await file.text();
    else if (kind && kind !== 'doc') text = (await extractText(kind, new Uint8Array(await file.arrayBuffer()))).pages.map((p) => p.text).join('\n');
    else { toast('Upload a .txt, .md, .docx or .pdf job description, or paste the text.', true); return; }
    set('jdText', text.trim());
    set('jdFileName', file.name);
  };

  const save = async (): Promise<void> => {
    if (editing) {
      const merged = { ...editing, ...m };
      const diff = diffMandate(editing, merged);
      if (diff.material && !confirm) { setConfirm(diff.changes); return; }
      const r = await act(() => updateMandate(ctx, editing.id, m), 'Mandate saved.');
      if (r) nav(`/mandates/${editing.id}`);
    } else {
      const r = await act(() => createMandate(ctx, m), 'Mandate created. Next: generate and approve the screening rubric.');
      if (r) nav(`/mandates/${r.id}?tab=rubric`);
    }
  };

  const text = (k: 'title' | 'function' | 'reportingManager' | 'location' | 'education' | 'hiringManager' | 'teamSize' | 'budget' | 'currency' | 'strategicResponsibilities', label: string, hint?: string): ReactNode =>
    <Field label={label} hint={hint}>{(id) => <input id={id} className="input" value={m[k] ?? ''} onChange={(e) => set(k, e.target.value as never)} />}</Field>;
  const num = (k: 'minExperience' | 'preferredExperience' | 'maxExperience' | 'compMin' | 'compMax', label: string): ReactNode =>
    <Field label={label}>{(id) => <input id={id} className="input" type="number" min={0} value={m[k] ?? ''} onChange={(e) => set(k, (e.target.value === '' ? undefined : Number(e.target.value)) as never)} />}</Field>;

  return (
    <>
      <PageHead title={editing ? `Edit ${editing.code}` : 'New hiring mandate'} crumbs={<Link to="/mandates">Hiring Mandates</Link>}
        sub={editing ? `Currently version ${editing.version}. Material changes create a new version and require a new rubric; earlier assessments keep the version they used.` : 'The job description is the source for the AI-drafted screening rubric, which you review and approve before any CV is scored.'} />
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset><legend>Identification &amp; organisation</legend><div className="form-grid">
          {text('title', 'Position title *')}
          <Field label="Company / entity *">{(id) => <select id={id} className="select" value={m.entityId} onChange={(e) => { set('entityId', e.target.value); set('departmentId', undefined); }} disabled={!!editing}><option value="">Select…</option>{w.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}</Field>
          <Field label="Department">{(id) => <select id={id} className="select" value={m.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value || undefined)}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}</Field>
          {text('function', 'Function', 'e.g. Procurement, Finance, Operations — drives how relevant experience is recognised')}
          {text('reportingManager', 'Reporting manager')}{text('location', 'Location')}
        </div></fieldset>
        <fieldset><legend>Experience &amp; education</legend><div className="form-grid">
          {num('minExperience', 'Minimum experience (years)')}{num('preferredExperience', 'Preferred (years)')}{num('maxExperience', 'Maximum (years)')}
          {text('education', 'Required education', 'Becomes a mandatory gate when filled, e.g. “MBA or equivalent”')}
          <Field label="Certifications" hint="Comma-separated; scored as preferred">{(id) => <input id={id} className="input" value={m.certifications.join(', ')} onChange={(e) => set('certifications', csv(e.target.value))} />}</Field>
        </div></fieldset>
        <fieldset><legend>Functional, industry &amp; leadership</legend><div className="form-grid">
          <Field label="Key competencies" hint="One per line; each becomes a weighted criterion. Leave blank to derive from the JD." wide>{(id) => <textarea id={id} className="textarea" value={m.competencies.join('\n')} onChange={(e) => set('competencies', csv(e.target.value))} />}</Field>
          <Field label="Mandatory industries" hint="Each becomes a mandatory gate">{(id) => <input id={id} className="input" value={m.mandatoryIndustries.join(', ')} onChange={(e) => set('mandatoryIndustries', csv(e.target.value))} />}</Field>
          <Field label="Preferred industries">{(id) => <input id={id} className="input" value={m.preferredIndustries.join(', ')} onChange={(e) => set('preferredIndustries', csv(e.target.value))} />}</Field>
          {text('teamSize', 'Team size')}{text('budget', 'Budget / spend responsibility')}{text('strategicResponsibilities', 'Strategic responsibilities')}
        </div></fieldset>
        <fieldset><legend>Compensation &amp; recruitment</legend><div className="form-grid">
          {num('compMin', 'Compensation minimum')}{num('compMax', 'Compensation maximum')}{text('currency', 'Currency')}
          <Field label="Priority">{(id) => <select id={id} className="select" value={m.priority} onChange={(e) => set('priority', e.target.value as Priority)}>{['low', 'medium', 'high', 'critical'].map((p) => <option key={p}>{p}</option>)}</select>}</Field>
          {text('hiringManager', 'Hiring manager')}
          <Field label="Target date">{(id) => <input id={id} className="input" type="date" value={m.targetDate ?? ''} onChange={(e) => set('targetDate', e.target.value || undefined)} />}</Field>
        </div></fieldset>
        <fieldset><legend>Job description *</legend><div className="stack">
          <div className="row"><input type="file" accept=".txt,.md,.docx,.pdf" aria-label="Upload job description" onChange={(e) => { const f = e.target.files?.[0]; if (f) void act(() => readJd(f)); }} />{m.jdFileName && <span className="muted small">Loaded from {m.jdFileName}</span>}</div>
          <textarea className="textarea" style={{ minHeight: 260 }} aria-label="Job description text" value={m.jdText} onChange={(e) => set('jdText', e.target.value)} placeholder="Paste the job description. Use headings such as “Key responsibilities” and “Requirements” with bullet points for best rubric quality." />
        </div></fieldset>
        {problems.length > 0 && <div className="callout warn small" style={{ marginBottom: 12 }}>{problems.map((p) => <div key={p}>{p}</div>)}</div>}
        <div className="row"><button className="btn primary" type="submit" disabled={problems.length > 0}>{editing ? 'Save changes' : 'Create mandate'}</button><Link className="btn ghost" to={editing ? `/mandates/${editing.id}` : '/mandates'}>Cancel</Link></div>
      </form>
      {confirm && <Modal title="This is a material change" onClose={() => setConfirm(undefined)} footer={<><button className="btn ghost" onClick={() => setConfirm(undefined)}>Cancel</button><button className="btn primary" onClick={() => void save()}>Save as version {(editing?.version ?? 1) + 1}</button></>}>
        <ul>{confirm.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="callout small">The current rubric and every earlier assessment stay exactly as they are and keep pointing at version {editing?.version}. New screening is paused until a rubric is approved for version {(editing?.version ?? 1) + 1}.</div>
      </Modal>}
    </>
  );
}

// ───────────────────────── Detail ─────────────────────────
type Tab = 'overview' | 'rubric' | 'screening' | 'history';

export function MandateDetail(): ReactNode {
  const { id } = useParams();
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'overview';
  const m = w.mandates.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const [blocker, setBlocker] = useState<string>();
  useEffect(() => { if (m) void screeningBlocker(ctx, m).then(setBlocker); }, [ctx, m, w.rubrics]);
  if (!m) return <Empty title="Mandate not found">It may not exist or may belong to an entity you cannot access.</Empty>;
  if (editing) return <MandateForm editing={m} />;
  const rubrics = w.rubrics.filter((r) => r.mandateId === m.id).sort((a, b) => b.version - a.version);
  const writer = can(ctx.user.role, 'mandate.write');
  const entity = w.entities.find((e) => e.id === m.entityId);
  const dept = w.departments.find((d) => d.id === m.departmentId);

  const statusBtns: [MandateStatus, string][] = m.status === 'open' ? [['on_hold', 'Put on hold'], ['closed', 'Close']] : m.status === 'on_hold' ? [['open', 'Reopen'], ['closed', 'Close']] : m.status === 'closed' ? [['open', 'Reopen'], ['archived', 'Archive']] : [['open', 'Restore']];
  return (
    <>
      <PageHead title={`${m.code} — ${m.title}`} crumbs={<Link to="/mandates">Hiring Mandates</Link>}
        sub={<>{entity?.name}{dept ? ` · ${dept.name}` : ''} · {m.location || 'location not set'} · <Chip tone={m.status === 'open' ? 'ok' : m.status === 'on_hold' ? 'caution' : 'neutral'}>{m.status.replace('_', ' ')}</Chip> · version {m.version}</>}
        actions={writer && <>
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn" onClick={() => void act(async () => { const d = await duplicateMandate(ctx, m.id); window.location.hash = `#/mandates/${d.id}`; }, 'Mandate duplicated.')}>Duplicate</button>
          {statusBtns.map(([s, l]) => <button key={s} className="btn" disabled={s === 'closed' || s === 'archived' ? !can(ctx.user.role, 'mandate.close') : false} onClick={() => void act(() => setMandateStatus(ctx, m.id, s), `Mandate ${s.replace('_', ' ')}.`)}>{l}</button>)}
        </>} />
      {blocker && <div className="callout warn small" style={{ marginBottom: 14 }}><b>Screening paused.</b> {blocker}</div>}
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'rubric', label: `Rubric & role intelligence${rubrics.length ? ` (${rubrics.length})` : ''}` }, { id: 'screening', label: 'CVs & screening' }, { id: 'history', label: 'Version history' }]} />
      {tab === 'overview' && <Overview m={m} />}
      {tab === 'rubric' && <RubricTab m={m} rubrics={rubrics} />}
      {tab === 'screening' && <MandateScreening m={m} blocker={blocker} />}
      {tab === 'history' && <History m={m} />}
    </>
  );
}

function Overview({ m }: { m: Mandate }): ReactNode {
  const kv: [string, ReactNode][] = [
    ['Function', m.function || '—'], ['Reports to', m.reportingManager || '—'], ['Hiring manager', m.hiringManager || '—'], ['Experience', `${m.minExperience}+ yrs${m.preferredExperience ? ` (preferred ${m.preferredExperience})` : ''}${m.maxExperience ? `, up to ${m.maxExperience}` : ''}`],
    ['Education', m.education || '—'], ['Certifications', m.certifications.join(', ') || '—'], ['Mandatory industries', m.mandatoryIndustries.join(', ') || '—'], ['Preferred industries', m.preferredIndustries.join(', ') || '—'],
    ['Team / budget', [m.teamSize, m.budget].filter(Boolean).join(' · ') || '—'], ['Compensation', m.compMin || m.compMax ? `${m.currency} ${m.compMin?.toLocaleString() ?? '?'} – ${m.compMax?.toLocaleString() ?? '?'}` : '—'],
    ['Priority', m.priority], ['Target date', fmtDate(m.targetDate)], ['Created', fmtDateTime(m.createdAt)], ['Updated', fmtDateTime(m.updatedAt)],
  ];
  return (
    <div className="split">
      <Card title="Requirements"><dl className="kv">{kv.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Card>
      <Card title="Job description"><pre style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit', color: 'var(--text-2)', maxHeight: 460, overflow: 'auto' }}>{m.jdText}</pre></Card>
    </div>
  );
}

function RubricTab({ m, rubrics }: { m: Mandate; rubrics: Rubric[] }): ReactNode {
  const ctx = useCtx();
  const act = useAction();
  const canEdit = can(ctx.user.role, 'rubric.edit');
  const [selId, setSelId] = useState<string>();
  const sel = rubrics.find((r) => r.id === (selId ?? m.activeRubricId ?? rubrics[0]?.id));
  const [draft, setDraft] = useState<Rubric>();
  useEffect(() => { setDraft(sel ? structuredClone(sel) : undefined); }, [sel]);
  const [busy, setBusy] = useState(false);

  if (!rubrics.length) {
    return <Card><Empty title="No rubric yet"><p>AI reads the job description and proposes a role-specific, weighted rubric with mandatory gates. You review and approve it before any CV is scored.</p>
      {canEdit && <button className="btn primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => { setBusy(true); void act(() => generateRubric(ctx, m.id), 'Rubric drafted — review it, then approve.').then((r) => { setBusy(false); if (r) setSelId(r.id); }); }}>{busy ? 'Generating…' : 'Generate rubric from JD'}</button>}</Empty></Card>;
  }
  if (!sel || !draft) return null;
  const editable = sel.status === 'draft' && canEdit;
  const check = validateWeights(draft.criteria);
  const dirty = JSON.stringify(draft) !== JSON.stringify(sel);
  const patchC = (id: string, p: Partial<RubricCriterion>): void => setDraft((d) => d && ({ ...d, criteria: d.criteria.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const ri = draft.roleIntelligence;

  return (
    <div className="stack">
      <Card title="Versions" actions={canEdit && <div className="row">
        <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); void act(() => generateRubric(ctx, m.id), 'New draft generated.').then((r) => { setBusy(false); if (r) setSelId(r.id); }); }}>{busy ? 'Generating…' : 'Generate new draft with AI'}</button>
        {sel.status !== 'draft' && <button className="btn sm" onClick={() => void act(() => reviseRubricVersion(ctx, sel.id), 'Editable draft created.').then((r) => r && setSelId(r.id))}>Revise this version</button>}
      </div>}>
        <div className="row">{rubrics.map((r) => <button key={r.id} className={`btn sm${r.id === sel.id ? ' primary' : ''}`} onClick={() => setSelId(r.id)}>v{r.version} · {r.status}{r.id === m.activeRubricId ? ' ★' : ''}</button>)}</div>
        <p className="muted small" style={{ marginTop: 10 }}>Built for mandate v{sel.mandateVersion} · {sel.generatedBy === 'manual' ? 'written manually' : `drafted by ${sel.generatedBy.id}/${sel.generatedBy.model} (${sel.generatedBy.promptVersion})`}{sel.approvedAt ? ` · approved ${fmtDateTime(sel.approvedAt)}` : ''}{sel.notes ? ` · ${sel.notes}` : ''}</p>
        {sel.status !== 'draft' && <div className="callout small" style={{ marginTop: 10 }}>An {sel.status} rubric is frozen. AI never changes it silently — use <b>Revise this version</b> to create a new editable draft.</div>}
      </Card>

      <Card title="Role intelligence">
        <div className="grid g2 small">
          <div><b>Purpose</b><p className="muted">{ri.purpose}</p></div>
          {([['Mandatory requirements', ri.mandatory], ['Preferred', ri.preferred], ['Competencies', ri.competencies], ['Industry', ri.industry], ['Leadership expectations', ri.leadership], ['Scale of responsibility', ri.scale], ['Expected achievements', ri.achievements], ['Career progression', ri.progression], ['Practical requirements', ri.practical]] as [string, string[]][]).filter(([, v]) => v.length).map(([t, v]) => <div key={t}><b>{t}</b><ul style={{ margin: '4px 0 0 18px', padding: 0 }} className="muted">{v.map((x) => <li key={x}>{x}</li>)}</ul></div>)}
        </div>
      </Card>

      <Card title="Mandatory requirement gates" flush>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Type</th><th>Years</th><th>How it is checked</th></tr></thead><tbody>
          {draft.gates.map((g, i) => <tr key={g.id}>
            <td>{editable ? <input className="input" value={g.name} aria-label="Gate name" onChange={(e) => setDraft({ ...draft, gates: draft.gates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /> : <b>{g.name}</b>}<div className="muted small">{g.requirement}</div></td>
            <td>{g.type.replace('_', ' ')}</td>
            <td>{editable && g.type === 'min_experience' ? <input className="input" type="number" min={0} style={{ width: 80 }} aria-label="Years" value={g.years ?? 0} onChange={(e) => setDraft({ ...draft, gates: draft.gates.map((x, j) => (j === i ? { ...x, years: Number(e.target.value) } : x)) })} /> : g.years ?? '—'}</td>
            <td className="small muted">{g.type === 'min_experience' ? 'Computed by code from the CV chronology. A shortfall is a verified failure only when dates are complete; otherwise it needs verification.' : 'Pass only with CV evidence. Unclear = Verification Required, never a failure.'}</td>
            </tr>)}
          {!draft.gates.length && <tr><td colSpan={4} className="muted">No mandatory gates. Every requirement is scored.</td></tr>}
        </tbody></table></div>
      </Card>

      <Card title="Weighted criteria" actions={<Chip tone={check.ok ? 'ok' : 'bad'} icon={check.ok ? 'check' : 'alert'}>Weights total {Math.round(check.total * 10) / 10} / 100</Chip>} flush>
        <p className="muted small" style={{ padding: '0 18px 10px' }}>Class tells reviewers how important a criterion is. Only the mandatory requirement gates above can block a candidate; everything here contributes weighted points.</p>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Criterion</th><th>Class</th><th style={{ width: 90 }}>Weight</th><th>What the CV should show</th></tr></thead><tbody>
          {draft.criteria.map((c) => <tr key={c.id}>
            <td>{editable ? <input className="input" value={c.name} aria-label="Criterion name" onChange={(e) => patchC(c.id, { name: e.target.value })} /> : <b>{c.name}</b>}<div className="muted small">{CATEGORY_LABEL[c.category]}</div>
              <details><summary className="small">Guidance &amp; keywords</summary><div className="small stack" style={{ marginTop: 6 }}>
                {editable ? <><textarea className="textarea" aria-label="Description" value={c.description} onChange={(e) => patchC(c.id, { description: e.target.value })} /><textarea className="textarea" aria-label="Guidance" value={c.guidance} onChange={(e) => patchC(c.id, { guidance: e.target.value })} /><input className="input" aria-label="Keywords" value={c.keywords.join(', ')} onChange={(e) => patchC(c.id, { keywords: csv(e.target.value) })} /></>
                  : <><p>{c.description}</p><p className="muted">Guidance: {c.guidance}</p><p className="muted">Verify: {c.verification}</p><div className="pill-row">{c.keywords.map((k) => <span key={k} className="tag-pill">{k}</span>)}</div></>}
              </div></details></td>
            <td>{editable ? <select className="select" aria-label="Class" value={c.classification} onChange={(e) => patchC(c.id, { classification: e.target.value as RubricCriterion['classification'] })}><option>mandatory</option><option>preferred</option><option>desirable</option></select> : c.classification}</td>
            <td>{editable ? <input className="input" type="number" min={0} max={100} aria-label="Weight" value={c.weight} onChange={(e) => patchC(c.id, { weight: Number(e.target.value) })} /> : <b>{c.weight}</b>}</td>
            <td className="small">{editable ? <textarea className="textarea" style={{ minHeight: 60 }} aria-label="Expected evidence" value={c.expectedEvidence} onChange={(e) => patchC(c.id, { expectedEvidence: e.target.value })} /> : c.expectedEvidence}</td>
          </tr>)}
        </tbody></table></div>
      </Card>

      <Card title="Screening policy">
        <div className="form-grid">
          {([['threshold', 'Screening threshold'], ['borderlineFloor', 'Borderline review from'], ['strongAt', 'Strong match from'], ['exceptionalAt', 'Exceptional from']] as const).map(([k, l]) => <Field key={k} label={l}>{(fid) => <input id={fid} className="input" type="number" disabled={!editable} value={draft.policy[k]} onChange={(e) => setDraft({ ...draft, policy: { ...draft.policy, [k]: Number(e.target.value) } })} />}</Field>)}
          <Field label="Missing evidence policy" hint="Not Evident is never silently zero">{(fid) => <select id={fid} className="select" disabled={!editable} value={draft.policy.missingEvidencePolicy} onChange={(e) => setDraft({ ...draft, policy: { ...draft.policy, missingEvidencePolicy: e.target.value as 'rescale' | 'zero' } })}><option value="rescale">Rescale over assessed criteria (default)</option><option value="zero">Count as zero (conservative)</option></select>}</Field>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>{draft.policy.threshold} is the initial business policy, subject to validation. Scores from {draft.policy.borderlineFloor} to {Math.round((draft.policy.threshold - 0.1) * 10) / 10} go to a human borderline review rather than an automatic below-threshold status. No external rejection is ever sent.</p>
      </Card>

      {editable && <div className="row">
        <button className="btn" disabled={!dirty} onClick={() => void act(() => saveRubricDraft(ctx, draft), 'Draft saved.')}>Save draft</button>
        {can(ctx.user.role, 'rubric.approve') && <button className="btn primary" disabled={!check.ok} onClick={() => void act(async () => { if (dirty) await saveRubricDraft(ctx, draft); await approveRubricVersion(ctx, sel.id); }, `Rubric v${sel.version} approved. CVs can now be screened.`)}>{dirty ? 'Save & approve' : 'Approve rubric'}</button>}
        {!check.ok && <span className="small" style={{ color: 'var(--bad)' }}>{check.problems[0]}</span>}
      </div>}
    </div>
  );
}

function MandateScreening({ m, blocker }: { m: Mandate; blocker?: string }): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const rows = w.rows.filter((r) => r.mandate.id === m.id).sort((a, b) => b.assessment.score.total - a.assessment.score.total);
  const waiting = w.jobs.filter((j) => j.mandateId === m.id && j.status === 'extracted').length;
  return (
    <Card title="Screened candidates" actions={<div className="row">
      {waiting > 0 && !blocker && <button className="btn sm primary" onClick={() => void act(async () => { const r = await screenPending(ctx, m.id); return r; }, 'Pending CVs screened.')}>Screen {waiting} waiting CV{waiting > 1 ? 's' : ''}</button>}
      {can(ctx.user.role, 'cv.upload') && <Link className="btn sm" to={`/upload?mandate=${m.id}`}>Upload CVs</Link>}
      <Link className="btn sm" to={`/screening?mandate=${m.id}`}>Open screening board</Link></div>} flush>
      {rows.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Candidate</th><th className="num">Score</th><th>Status</th><th>Gates</th></tr></thead><tbody>{rows.map((r) => <tr key={r.assessment.id}>
        <td><Link to={`/assessments/${r.assessment.id}`}>{r.candidate.name}</Link><div className="muted small">{r.candidate.currentDesignation ?? '—'}{r.candidate.currentCompany ? `, ${r.candidate.currentCompany}` : ''}</div></td>
        <td className="num score">{r.assessment.score.total}</td><td><StatusChip status={r.status} /></td>
        <td className="small">{r.assessment.gates.filter((g) => g.status === 'pass').length}/{r.assessment.gates.length} passed</td></tr>)}</tbody></table></div>
        : <Empty title="No screened CVs yet">{waiting ? `${waiting} CV(s) are extracted and waiting for an approved rubric.` : 'Upload CVs to begin.'}</Empty>}
    </Card>
  );
}

function History({ m }: { m: Mandate }): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const [versions, setVersions] = useState<{ version: number; changedAt: string; changes: string[]; materialChange: boolean }[]>([]);
  useEffect(() => { void ctx.repo.list('mandate_versions', { mandateId: m.id }).then((v) => setVersions(v.sort((a, b) => b.version - a.version))); }, [ctx, m.id, m.version]);
  const log = w.audit.filter((a) => a.targetId === m.id || a.summary.includes(m.code)).slice(0, 25);
  const rubrics = useMemo(() => w.rubrics.filter((r) => r.mandateId === m.id), [w.rubrics, m.id]);
  return (
    <div className="split">
      <Card title="Mandate versions" flush><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Version</th><th>When</th><th>Changes</th><th>Rubric</th></tr></thead><tbody>
        {versions.map((v) => <tr key={v.version}><td>v{v.version} {v.materialChange && <Chip tone="caution">material</Chip>}</td><td>{fmtDateTime(v.changedAt)}</td><td className="small">{v.changes.join('; ')}</td><td className="small">{rubrics.filter((r) => r.mandateVersion === v.version).map((r) => `v${r.version} ${r.status}`).join(', ') || '—'}</td></tr>)}
      </tbody></table></div></Card>
      <Card title="Audit trail">{log.length ? <div className="stack small">{log.map((a) => <div key={a.id}><span className="muted">{fmtDateTime(a.at)} · {a.userName}</span><br />{a.summary}</div>)}</div> : <p className="muted small">Audit entries are visible to administrators.</p>}</Card>
    </div>
  );
}

// ───────────────────────── AI Role Intelligence ─────────────────────────
export function RoleIntelligence(): ReactNode {
  const w = useWorld();
  const ctx = useCtx();
  const act = useAction();
  const nav = useNavigate();
  return (
    <>
      <PageHead title="AI Role Intelligence" sub="AI turns each job description into role intelligence and a weighted screening rubric. You review and approve it; it is never changed silently during a screening cycle." />
      <Card flush>
        {w.mandates.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Mandate</th><th>Rubric state</th><th className="num">Criteria</th><th className="num">Gates</th><th /></tr></thead><tbody>
          {w.mandates.map((m) => {
            const rs = w.rubrics.filter((r) => r.mandateId === m.id).sort((a, b) => b.version - a.version);
            const rl = rubricLabel(rs, m);
            const cur = rs.find((r) => r.id === m.activeRubricId) ?? rs[0];
            return <tr key={m.id}><td><Link to={`/mandates/${m.id}?tab=rubric`}>{m.code}</Link> {m.title}<div className="muted small">v{m.version}</div></td><td><Chip tone={rl.tone}>{rl.text}</Chip></td>
              <td className="num">{cur?.criteria.length ?? '—'}</td><td className="num">{cur?.gates.length ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>{rs.length ? <Link className="btn sm" to={`/mandates/${m.id}?tab=rubric`}>Review</Link> : can(ctx.user.role, 'rubric.edit') && <button className="btn sm primary" onClick={() => void act(async () => { await generateRubric(ctx, m.id); nav(`/mandates/${m.id}?tab=rubric`); }, 'Rubric drafted.')}>Generate</button>}</td></tr>;
          })}</tbody></table></div> : <Empty title="No mandates yet" />}
      </Card>
    </>
  );
}
