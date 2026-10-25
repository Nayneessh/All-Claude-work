import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SetRecord } from '@/domain/types';
import { archiveSession, addSet, changeSessionDate, deleteSet, editSet, getSession, reopenSession, repeatSession, restoreSet, sessionExercises, updateSession, type SessionExerciseView } from '@/data/repo/sessions';
import { auditForSession, compareSessions, exerciseInsight, listSessions, sessionSummaries } from '@/data/repo/history';
import { exerciseMap } from '@/data/repo/exercises';
import { formatVolume, formatWeight, fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { prsInSession, PR_LABELS } from '@/domain/records';
import { sessionTimes, FINISHED } from '@/domain/sessionState';
import { Badge, Banner, Button, Card, Chip, Empty, Loading, Section, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { StatusBadge } from '@/ui/status';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, fmtMin, errMsg, plural, signed } from '@/ui/format';
import { colsFor } from './Workout';

const TAGS = ['high-energy', 'low-energy', 'travel', 'deload', 'return-from-break'];

export function SessionDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const { unit, today } = useApp();
  const s = useLive(() => getSession(id), [id]);
  const views = useLive(() => sessionExercises(id), [id]);
  const sums = useLive(() => sessionSummaries([id], today), [id, today, views.data]);
  const audit = useLive(() => auditForSession(id), [id, views.data]);
  const names = useLive(() => exerciseMap(), []);
  const prs = useLive(async () => { const out = []; for (const v of views.data ?? []) { const ins = await exerciseInsight(v.exercise.id, today); if (ins) out.push(...prsInSession(ins.prs, id).map((p) => ({ ...p, name: v.exercise.name }))); } return out; }, [id, views.data, today]);
  const [edit, setEdit] = useState<{ set: SetRecord; view: SessionExerciseView } | null>(null);
  const [cmp, setCmp] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  if (s.loading || views.loading) return <div className="screen"><Loading /></div>;
  if (!s.data || !views.data) return <div className="screen"><Empty icon="warn" title="Workout not found" action={<Button onClick={() => nav('/history')}>Back</Button>} /></div>;
  const sess = s.data;
  const sum = sums.data?.get(id);
  const t = sessionTimes(sess, sess.finished_at ?? new Date().toISOString());
  const finished = FINISHED.has(sess.status);

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><div className="grow"><div className="eyebrow">{fmtDate(sess.session_date, { year: true })}</div><h1 className="ellipsis">{sess.name.split(' — ')[1] ?? sess.name}</h1></div>
        <IconBtn label={sess.is_bookmarked ? 'Remove bookmark' : 'Bookmark'} icon="bookmark" on={sess.is_bookmarked} onClick={() => void updateSession(id, { is_bookmarked: !sess.is_bookmarked })} /></div>
      <div className="row-flex wrap"><StatusBadge status={sess.status} />{sess.corrected_after_completion && <Badge tone="warn">Corrected after completion</Badge>}{sess.scheduled_date && sess.scheduled_date !== sess.session_date && <Badge tone="info">Scheduled {fmtDate(sess.scheduled_date)}</Badge>}{sess.tags.map((tg) => <Badge key={tg}>{tg}</Badge>)}</div>
      {sess.change_reason && <p className="small dim mt-2">Changes: {sess.change_reason}</p>}
      {sess.skip_reason && <p className="small dim mt-2">Reason: {sess.skip_reason}</p>}

      {sum && (
        <div className="kpis mt-4">
          <div className="kpi"><div className="v">{sum.workingSets}</div><div className="l">working sets</div></div>
          <div className="kpi"><div className="v">{formatVolume(sum.volumeKg, unit)}</div><div className="l">volume load{sum.unknownVolumeSets ? ` · ${plural(sum.unknownVolumeSets, 'set')} unknown` : ''}</div></div>
          <div className="kpi"><div className="v">{sess.started_at ? fmtMin(Math.round(t.activeMs / 60000)) : '—'}</div><div className="l">active time</div></div>
          <div className="kpi"><div className="v">{sess.session_rpe ?? '—'}</div><div className="l">session RPE</div></div>
        </div>
      )}
      {(prs.data?.length ?? 0) > 0 && <Card className="mt-3"><div className="eyebrow">Records in this session</div>{prs.data?.map((p) => <div key={`${p.exercise_id}${p.type}`} className="row-flex between small mt-2"><span><span className="sticker">PR</span> {p.name} · {PR_LABELS[p.type]}{p.estimated ? ' (est.)' : ''}</span><span className="gold strong">{p.type.includes('e1rm') || p.type === 'max_weight' || p.type === 'actual_1rm' ? formatWeight(p.value, unit) : Math.round(p.value)}</span></div>)}</Card>}

      <Section title="Sets — planned vs actual">
        <div className="col">
          {views.data.map((v) => <ExerciseBlock key={v.se.id} v={v} unit={unit} name={(id2) => names.data?.get(id2)?.name ?? 'exercise'} onEdit={(set) => setEdit({ set, view: v })} onAdd={async () => { try { await addSet(v.se.id); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } }} />)}
        </div>
      </Section>

      {sess.notes && <Section title="Notes"><Card><p style={{ whiteSpace: 'pre-wrap' }}>{sess.notes}</p></Card></Section>}

      <Section title="Actions">
        <div className="col">
          <Button block icon="copy" onClick={async () => { const r = await repeatSession(id, today); nav(`/workout/${r.id}`); }}>Repeat this workout today</Button>
          <Button block icon="swap" onClick={() => setCmp(true)}>Compare with another session</Button>
          <Button block icon="edit" onClick={() => setTagsOpen(true)}>Edit notes &amp; tags</Button>
          <Button block icon="calendar" onClick={() => setDateOpen(true)}>Correct the date</Button>
          {finished && <Button block icon="undo" onClick={async () => { const ok = await ui.confirm({ title: 'Reopen this workout?', message: 'You can add or fix sets, then finish it again. The reopening is recorded.', confirmLabel: 'Reopen' }); if (ok) { await reopenSession(id, 'Reopened to correct'); nav(`/workout/${id}`); } }}>Reopen to correct</Button>}
          <Button block icon="note" onClick={() => setShowAudit(true)}>Corrections &amp; audit trail ({audit.data?.length ?? 0})</Button>
          <Button block variant="danger" icon="trash" onClick={async () => { const ok = await ui.confirm({ title: 'Remove from history?', message: 'It disappears from history and all totals. It is not destroyed — you can restore it from Backup → Removed workouts.', confirmLabel: 'Remove', danger: true }); if (ok) { await archiveSession(id, 'Removed by user'); ui.toast('Removed. Restore from Backup → Removed workouts.'); nav('/history', { replace: true }); } }}>Remove this workout</Button>
        </div>
      </Section>

      <EditSetSheet ctx={edit} unit={unit} onClose={() => setEdit(null)} finished={finished} />
      <CompareSheet open={cmp} onClose={() => setCmp(false)} sessionId={id} templateKey={sess.template_key} onPick={(other) => nav(`/history/compare/${id}/${other}`)} />
      <Sheet open={showAudit} onClose={() => setShowAudit(false)} title="Audit trail">
        {(audit.data?.length ?? 0) === 0 ? <p className="dim">No corrections have been made to this workout.</p> : (
          <div className="col">{audit.data?.map((a) => <div key={a.id} className="card"><div className="row-flex between"><span className="strong">{a.action.replace(/_/g, ' ')}</span><span className="tiny dim">{a.occurred_at.slice(0, 16).replace('T', ' ')}</span></div><div className="small dim">{a.entity_type}{a.reason ? ` · ${a.reason}` : ''}</div>{a.before && a.after && <div className="small mt-1">{Object.keys(a.after).map((k) => <div key={k}><span className="dim">{k}:</span> {String(a.before?.[k] ?? '—')} → <span className="gold">{String(a.after?.[k] ?? '—')}</span></div>)}</div>}</div>)}</div>
        )}
      </Sheet>
      <Sheet open={dateOpen} onClose={() => setDateOpen(false)} title="Correct the date">
        <p className="dim small">Moves the workout and all its sets to another day in history. The program is not rewritten.</p>
        <input className="input mt-3" type="date" aria-label="Workout date" max={today} defaultValue={sess.session_date} onChange={async (e) => { if (e.target.value) { await changeSessionDate(id, e.target.value, 'Date corrected'); setDateOpen(false); ui.toast('Date corrected', { tone: 'ok' }); } }} />
      </Sheet>
      <Sheet open={tagsOpen} onClose={() => setTagsOpen(false)} title="Notes & tags">
        <div className="col">
          <div className="chips wrap">{TAGS.map((tg) => <Chip key={tg} on={sess.tags.includes(tg)} onClick={() => void updateSession(id, { tags: sess.tags.includes(tg) ? sess.tags.filter((x) => x !== tg) : [...sess.tags, tg] })}>{tg}</Chip>)}</div>
          <div className="field"><label htmlFor="sd-rpe">Session RPE (1–10)</label><input id="sd-rpe" className="input" inputMode="decimal" defaultValue={sess.session_rpe ?? ''} onBlur={(e) => void updateSession(id, { session_rpe: parseNumber(e.target.value) })} /></div>
          <div className="field"><label htmlFor="sd-notes">Notes</label><textarea id="sd-notes" className="input" defaultValue={sess.notes ?? ''} onBlur={(e) => void updateSession(id, { notes: e.target.value || null })} /></div>
        </div>
      </Sheet>
    </div>
  );
}

function IconBtn({ label, icon, on, onClick }: { label: string; icon: 'bookmark'; on: boolean; onClick: () => void }) {
  return <button className="icon-btn" type="button" aria-label={label} aria-pressed={on} onClick={onClick} style={{ color: on ? 'var(--gold)' : undefined }}><Icon name={icon} /></button>;
}

function ExerciseBlock({ v, unit, name, onEdit, onAdd }: { v: SessionExerciseView; unit: 'kg' | 'lb'; name: (id: string) => string; onEdit: (s: SetRecord) => void; onAdd: () => void }) {
  const cols = colsFor(v.exercise);
  const p = v.se.planned;
  const orig = v.se.substituted_from_exercise_id;
  const fmtVal = (st: SetRecord, kind: 'a' | 'b'): string => {
    if (kind === 'a') { const val = cols.aField ? (st[cols.aField] as number | null) : null; return val === null ? '—' : cols.aKind === 'km' ? `${Math.round(val / 10) / 100} km` : formatWeight(val, unit, false); }
    const val = st[cols.bField] as number | null; return val === null ? '—' : cols.bKind === 'minutes' ? `${Math.round(val / 6) / 10} min` : String(val);
  };
  const planned = (st: SetRecord): string => `${st.planned_weight_kg !== null ? formatWeight(st.planned_weight_kg, unit, false) : '—'} × ${st.planned_reps_min ?? '—'}${st.planned_reps_max && st.planned_reps_max !== st.planned_reps_min ? `-${st.planned_reps_max}` : ''}`;
  const parents = v.sets.filter((x) => !x.parent_set_id);
  return (
    <Card className={v.se.status === 'skipped' ? 'dim' : ''}>
      <div className="row-flex between"><div className="grow" style={{ minWidth: 0 }}><div className="strong ellipsis">{v.se.label ? `${v.se.label} · ` : ''}{v.exercise.name}</div>
        {orig && <div className="tiny warn">Substituted for {name(orig)}{v.se.substitution_scope === 'future' ? ' (future sessions too)' : ' (today only)'}</div>}
        {p && <div className="tiny dim">Plan: {p.sets} × {p.reps_min}-{p.reps_max}{p.rir_target !== null ? ` · RIR ${p.rir_target}${p.rir_last_only ? ' last' : ''}` : ''}{p.technique_text ? ` · ${p.technique_text}` : ''}</div>}
        {v.se.origin === 'added' && <div className="tiny info">Added during the workout</div>}</div>
        {v.se.status === 'skipped' && <Badge tone="bad">Skipped</Badge>}</div>
      <div className="mt-2" style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 40px', gap: '4px 8px', alignItems: 'center' }}>
        <span className="tiny dim">Set</span><span className="tiny dim">Planned</span><span className="tiny dim">Actual</span><span className="tiny dim center">RIR</span>
        {parents.map((st, i) => {
          const comps = v.sets.filter((c) => c.parent_set_id === st.id);
          const lbl = st.set_type === 'warmup' ? 'W' : String(parents.filter((x) => x.set_type !== 'warmup').findIndex((x) => x.id === st.id) + 1 || i + 1);
          return (
            <FragmentRows key={st.id}>
              <button type="button" className="strong" style={{ background: 'none', border: 0, color: 'var(--gold)', textAlign: 'left', padding: '8px 0' }} onClick={() => onEdit(st)} aria-label={`Edit set ${lbl}`}>{lbl}</button>
              <span className="small dim num">{planned(st)}</span>
              <span className={`small num ${st.status === 'completed' ? '' : 'dim'}`}>{st.status === 'completed' ? `${fmtVal(st, 'a')} × ${fmtVal(st, 'b')}` : st.status === 'skipped' ? 'skipped' : 'not done'}{st.reps_partial ? ` +${st.reps_partial}p` : ''}{st.reps_assisted ? ` +${st.reps_assisted}c` : ''}</span>
              <span className="small center">{st.rir ?? st.rpe ?? '—'}</span>
              {comps.map((c) => (<FragmentRows key={c.id}><span className="tiny dim" style={{ paddingLeft: 8 }}>↳</span><span className="tiny dim">{c.set_type.replace('_', '-')}</span><span className="small num">{c.status === 'completed' ? `${fmtVal(c, 'a')} × ${fmtVal(c, 'b')}` : 'not done'}</span><span /></FragmentRows>))}
            </FragmentRows>
          );
        })}
      </div>
      {v.se.notes && <div className="small dim mt-2">Note: {v.se.notes}</div>}
      <div className="row-flex mt-2"><Button small variant="ghost" icon="plus" onClick={onAdd}>Add missed set</Button></div>
    </Card>
  );
}
const FragmentRows = ({ children }: { children: React.ReactNode }) => <>{children}</>;

function EditSetSheet({ ctx, unit, onClose, finished }: { ctx: { set: SetRecord; view: SessionExerciseView } | null; unit: 'kg' | 'lb'; onClose: () => void; finished: boolean }) {
  const ui = useUi();
  const [reason, setReason] = useState('');
  const cols = ctx ? colsFor(ctx.view.exercise) : null;
  const key = ctx?.set.id ?? 'none';
  if (!ctx || !cols) return null;
  const st = ctx.set;
  const aVal = cols.aField ? (st[cols.aField] as number | null) : null;
  async function save(form: HTMLFormElement): Promise<void> {
    const d = new FormData(form);
    const patch: Record<string, unknown> = {};
    if (cols?.aField) { const n = parseNumber(String(d.get('a') ?? '')); patch[cols.aField] = n === null ? null : cols.aKind === 'km' ? Math.round(n * 1000) : fromDisplayWeight(n, unit); }
    if (cols) { const n = parseNumber(String(d.get('b') ?? '')); patch[cols.bField] = n === null ? null : cols.bKind === 'minutes' ? Math.round(n * 60) : cols.bKind === 'int' ? Math.round(n) : n; }
    patch.rir = parseNumber(String(d.get('rir') ?? ''));
    try {
      if (st.status !== 'completed' && (patch[cols?.bField ?? 'reps'] !== null)) patch.status = 'completed';
      await editSet(st.id, patch as Partial<SetRecord>, reason || undefined);
      ui.toast(finished ? 'Correction saved and recorded' : 'Saved', { tone: 'ok' });
      onClose();
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  return (
    <Sheet open onClose={onClose} title={`Edit set · ${ctx.view.exercise.name}`}>
      <form key={key} className="col" onSubmit={(e) => { e.preventDefault(); void save(e.currentTarget); }}>
        {finished && <Banner icon="info">This workout is finished. Your correction updates totals and records, and is kept in the audit trail. The original plan is not changed.</Banner>}
        <div className="row-flex">
          {cols.aField && <div className="field grow"><label htmlFor="e-a">{cols.aKind === 'weight' ? `${cols.aLabel} (${unit})` : cols.aLabel}</label><input id="e-a" name="a" className="input" inputMode="decimal" defaultValue={aVal === null ? '' : cols.aKind === 'km' ? String(aVal / 1000) : String(toDisplayWeight(aVal, unit))} /></div>}
          <div className="field grow"><label htmlFor="e-b">{cols.bLabel}</label><input id="e-b" name="b" className="input" inputMode="decimal" defaultValue={st[cols.bField] === null ? '' : cols.bKind === 'minutes' ? String((st[cols.bField] as number) / 60) : String(st[cols.bField])} /></div>
          <div className="field" style={{ width: 80 }}><label htmlFor="e-rir">RIR</label><input id="e-rir" name="rir" className="input" inputMode="decimal" defaultValue={st.rir ?? ''} /></div>
        </div>
        <div className="field"><label htmlFor="e-reason">Why? (optional)</label><input id="e-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. typo, wrong weight" /></div>
        <div className="row-flex"><Button variant="danger" onClick={async () => { await deleteSet(st.id, reason || undefined); onClose(); ui.toast('Set deleted', { action: { label: 'Undo', run: () => void restoreSet(st.id) } }); }}>Delete set</Button><Button type="submit" variant="primary" block>Save</Button></div>
      </form>
    </Sheet>
  );
}

function CompareSheet({ open, onClose, sessionId, templateKey, onPick }: { open: boolean; onClose: () => void; sessionId: string; templateKey: string | null; onPick: (id: string) => void }) {
  const rows = useLive(async () => (open ? (await listSessions({ status: ['completed_as_planned', 'completed_modified', 'partial'] }, 60)).filter((x) => x.id !== sessionId) : []), [open, sessionId]);
  const sorted = useMemo(() => [...(rows.data ?? [])].sort((a, b) => Number(b.template_key === templateKey) - Number(a.template_key === templateKey)), [rows.data, templateKey]);
  return (
    <Sheet open={open} onClose={onClose} title="Compare with…">
      <div className="list" style={{ margin: '0 -16px' }}>{sorted.map((x) => <button key={x.id} className="item" type="button" onClick={() => onPick(x.id)}><div className="grow"><div className="strong">{x.name.split(' — ')[1] ?? x.name}</div><div className="small dim">{fmtDate(x.session_date, { year: true })}{x.template_key === templateKey ? ' · same workout' : ''}</div></div><Icon name="right" className="chev" size={20} /></button>)}{sorted.length === 0 && <Empty icon="history" title="Nothing to compare with yet" />}</div>
    </Sheet>
  );
}

export function Compare() {
  const { a = '', b = '' } = useParams();
  const nav = useNavigate();
  const { unit } = useApp();
  const sa = useLive(() => getSession(a), [a]);
  const sb = useLive(() => getSession(b), [b]);
  const rows = useLive(() => compareSessions(a, b), [a, b]);
  if (rows.loading) return <div className="screen"><Loading /></div>;
  const delta = (x: number | null | undefined, y: number | null | undefined): string => (x && y ? `${signed(((y - x) / x) * 100)}%` : '—');
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Compare</h1></div>
      <div className="row-flex between small"><div><span className="gold strong">A</span> {sa.data ? fmtDate(sa.data.session_date, { year: true }) : ''}</div><div><span className="gold strong">B</span> {sb.data ? fmtDate(sb.data.session_date, { year: true }) : ''}</div></div>
      <div className="col mt-3">
        {(rows.data ?? []).map((r) => (
          <Card key={r.exercise_id}>
            <div className="strong">{r.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }} className="small mt-2">
              <span className="dim" /><span className="dim center">A</span><span className="dim center">B</span><span className="dim center">Δ B vs A</span>
              <span className="dim">Sets</span><span className="center num">{r.a?.workingSets ?? '—'}</span><span className="center num">{r.b?.workingSets ?? '—'}</span><span className="center">{r.a && r.b ? signed(r.b.workingSets - r.a.workingSets) : '—'}</span>
              <span className="dim">Reps</span><span className="center num">{r.a?.reps ?? '—'}</span><span className="center num">{r.b?.reps ?? '—'}</span><span className="center">{r.a && r.b ? signed(r.b.reps - r.a.reps) : '—'}</span>
              <span className="dim">Volume</span><span className="center num">{r.a ? formatVolume(r.a.volumeKg, unit) : '—'}</span><span className="center num">{r.b ? formatVolume(r.b.volumeKg, unit) : '—'}</span><span className="center">{delta(r.a?.volumeKg, r.b?.volumeKg)}</span>
              <span className="dim">e1RM</span><span className="center num">{formatWeight(r.aTopE1rm, unit, false)}</span><span className="center num">{formatWeight(r.bTopE1rm, unit, false)}</span><span className="center">{delta(r.aTopE1rm, r.bTopE1rm)}</span>
            </div>
            {(!r.a || !r.b) && <div className="tiny warn mt-2">Only performed in {r.a ? 'A' : 'B'} — not comparable.</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}
