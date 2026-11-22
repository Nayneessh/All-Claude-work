'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { phrase } from '../core/phrases';
import { BOOKING_STATUSES } from '../core/types';
import { qdef, getDict } from '../i18n';
import { ApiError } from '../lib/api';
import { capi } from '../lib/console';
import { useMe } from './ConsoleShell';

const en = getDict('en');
const P = (k: string) => phrase('en', k);
const when = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const STATUS_LABEL = en.confirm.statuses as Record<string, string>;

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && (setData(d), setErr(null))).catch((e) => alive && setErr(e instanceof ApiError ? `${e.status} ${e.code}` : 'Error'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, err, reload: () => setTick((t) => t + 1) };
}

const Err = ({ err }: { err: string | null }) => (err ? <p className="error-text" role="alert">{err}</p> : null);

// ---------------------------------------------------------------- queue
export function QueuePage() {
  const [path, setPath] = useState('');
  const [status, setStatus] = useState('');
  const [flagged, setFlagged] = useState('');
  const { data, err, reload } = useLoad<any[]>(() => capi(`/api/console/cases?path=${path}&status=${status}&flagged=${flagged}`), [path, status, flagged]);
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <h1 style={{ fontSize: '2rem' }}>Case queue</h1>
      <p className="muted">Newest booking requests first. Flagged cases are highlighted and show metadata only, because those visitors have not shared their photos or answers with you.</p>
      <div className="btn-row">
        <label>Path <select value={path} onChange={(e) => setPath(e.target.value)} data-testid="f-path" style={{ width: 'auto' }}><option value="">All</option><option value="maintenance">Maintenance</option><option value="concerns">Concerns</option><option value="scars">Scars</option></select></label>
        <label>Status <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="f-status" style={{ width: 'auto' }}><option value="">All</option>{BOOKING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label>Flags <select value={flagged} onChange={(e) => setFlagged(e.target.value)} data-testid="f-flag" style={{ width: 'auto' }}><option value="">All</option><option value="true">Flagged only</option><option value="false">Not flagged</option></select></label>
        <button className="btn secondary small" onClick={reload}>Refresh</button>
      </div>
      <Err err={err} />
      <div className="table-wrap">
        <table data-testid="queue">
          <thead><tr><th>Code</th><th>Requested</th><th>Path</th><th>Status</th><th>Name</th><th>Preferred</th><th>Budget</th><th>Flags</th></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className={c.flagged ? 'flagged' : ''} data-testid={`row-${c.code}`}>
                <td><Link href={`/console/cases/${c.id}`} style={{ fontWeight: 700 }}>{c.code}</Link></td>
                <td>{when(c.requested_at ?? c.created_at)}</td>
                <td>{c.path}</td>
                <td>{c.booking_status ? <span className="chip">{STATUS_LABEL[c.booking_status]}</span> : <span className="muted">No booking</span>}</td>
                <td>{c.first_name ?? '—'}</td>
                <td>{c.preferred_day ? `${String(c.preferred_day).slice(0, 10)} ${c.time_window}, ${String(c.method).replace('_', ' ')}` : '—'}</td>
                <td>{c.budget ? (qdef(en, 'budget').opt[c.budget] ?? c.budget) : '—'}</td>
                <td>{c.flagged ? <strong>⚑ Flagged ({(c.flag_codes ?? []).join(', ')})</strong> : ''}{c.contact_withdrawn ? <span className="chip">Do not contact</span> : null}</td>
              </tr>
            ))}
            {data && data.length === 0 && <tr><td colSpan={8} className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- case
export function CasePage({ id }: { id: string }) {
  const me = useMe();
  const { data: c, err, reload } = useLoad<any>(() => capi(`/api/console/cases/${id}`), [id]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(reload, 45_000); // photo links last 60 s
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setMsg(ok);
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? `Could not do that (${e.code}).` : 'Error');
    }
  };

  if (err) return <div className="stack"><Err err={err} /><Link href="/console">Back to queue</Link></div>;
  if (!c) return <div className="spinner" role="status" aria-label="Loading" />;
  const vis = c.details_visible;
  const analysis = c.analysis;
  const obs: any[] = analysis?.result?.observations ?? [];
  const counts = obs.reduce((a: Record<string, number>, o: any) => ((a[o.confidence] = (a[o.confidence] ?? 0) + 1), a), {});
  const fb = (zone: string, attribute: string) => (c.feedback ?? []).find((f: any) => f.kind === 'observation' && f.zone === zone && f.attribute === attribute);
  const budgetLabel = c.answers?.budget ? (qdef(en, 'budget').opt[c.answers.budget] ?? c.answers.budget) : '—';

  const exportCase = async () => {
    const data = await capi(`/api/console/cases/${id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `case-${c.code}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack" data-testid="case-view">
      <p><Link href="/console">← Queue</Link></p>
      <h1 style={{ fontSize: '2rem' }}>{c.code} {c.flagged && <span className="chip" style={{ background: '#FBF0D4' }}>⚑ Flagged</span>}</h1>

      <section className="card accent" aria-label="Brief" data-testid="brief">
        <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}>One-screen brief</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '10px 20px', margin: '10px 0 0' }}>
          <div><dt className="eyebrow">Path</dt><dd style={{ margin: 0 }}>{P(`path.${c.path}`)}</dd></div>
          <div><dt className="eyebrow">Visitor language</dt><dd style={{ margin: 0 }}>{c.lang === 'hi' ? 'Hindi' : 'English'}</dd></div>
          {vis && <div><dt className="eyebrow">Budget</dt><dd style={{ margin: 0 }} data-testid="brief-budget">{budgetLabel}</dd></div>}
          {c.booking && <div><dt className="eyebrow">Booking</dt><dd style={{ margin: 0 }}>{c.booking.first_name}, {c.booking.preferred_day?.slice(0, 10)} {c.booking.time_window}, {c.booking.method.replace('_', ' ')}</dd></div>}
          {c.booking && <div><dt className="eyebrow">WhatsApp</dt><dd style={{ margin: 0 }}>{vis ? c.booking.whatsapp_e164 : 'Hidden (consent withdrawn)'}</dd></div>}
          <div><dt className="eyebrow">Safety flags</dt><dd style={{ margin: 0 }} data-testid="brief-flags">{(c.flags ?? []).length ? c.flags.map((f: any) => `${f.code} (${f.source})`).join(', ') : 'None'}</dd></div>
          {c.restrictions?.length > 0 && <div><dt className="eyebrow">Restrictions</dt><dd style={{ margin: 0 }}>Routine advice withheld (pregnancy, breastfeeding or medicines)</dd></div>}
          {vis && analysis && <div><dt className="eyebrow">AI observations</dt><dd style={{ margin: 0 }}>{Object.entries(counts).map(([k, n]) => `${P(`conf.${k}`)}: ${n}`).join(' · ')}</dd></div>}
        </dl>
        {c.booking?.note && vis && <p style={{ marginTop: 12 }}><strong>Visitor note:</strong> {c.booking.note}</p>}
      </section>

      {!vis && <p className="notice" data-testid="details-hidden">Details are hidden. {c.contact_withdrawn_at ? 'The visitor withdrew WhatsApp consent.' : 'This visitor has not asked to be contacted, so their photos and answers are not shared with you.'}</p>}

      {c.booking && (
        <section className="card flat stack">
          <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}>Status: <span className="chip" data-testid="status-now">{STATUS_LABEL[c.booking.status]}</span></h2>
          <div className="btn-row">
            {c.booking.status === 'requested' && <button className="btn" onClick={() => act(() => capi(`/api/console/cases/${id}/status`, { body: { status: 'contacted' } }), 'Marked as contacted.')} data-testid="mark-contacted">Mark as contacted</button>}
            {BOOKING_STATUSES.map((s) => (
              <button key={s} className={`btn small${s === c.booking.status ? '' : ' secondary'}`} onClick={() => act(() => capi(`/api/console/cases/${id}/status`, { body: { status: s } }), `Status: ${STATUS_LABEL[s]}`)} data-testid={`status-${s}`} aria-pressed={s === c.booking.status}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
        </section>
      )}

      {vis && c.photos?.length > 0 && (
        <section aria-labelledby="ph">
          <h2 id="ph" style={{ fontSize: '1.5rem' }}>Photos</h2>
          <div className="thumbs" data-testid="photos" style={{ marginTop: 10 }}>
            {c.photos.map((p: any) => (
              <button key={p.id} type="button" className="thumb" onClick={() => setLightbox(p.url)} style={{ padding: 0, cursor: 'zoom-in', textAlign: 'left', font: 'inherit' }} aria-label={`Enlarge ${p.slot} photo`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`${p.slot} photo`} />
                <div className="cap">{p.slot}</div>
              </button>
            ))}
          </div>
          {lightbox && (
            <div role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(27,42,35,0.92)', display: 'grid', placeItems: 'center', zIndex: 200, padding: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightbox} alt="" style={{ maxHeight: '92dvh', maxWidth: '96vw', objectFit: 'contain' }} />
            </div>
          )}
        </section>
      )}

      {vis && c.answers && (
        <section aria-labelledby="ans">
          <h2 id="ans" style={{ fontSize: '1.5rem' }}>Questionnaire answers</h2>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table><tbody>
              {Object.entries(c.answers).map(([k, v]) => {
                const def = qdef(en, k);
                const vals = Array.isArray(v) ? v : [v as string];
                return <tr key={k}><td style={{ width: '55%' }}>{def?.label ?? k}</td><td><strong>{vals.map((x) => def?.opt?.[x] ?? x).join(', ')}</strong></td></tr>;
              })}
            </tbody></table>
          </div>
        </section>
      )}

      {vis && analysis && (
        <section aria-labelledby="ai">
          <h2 id="ai" style={{ fontSize: '1.5rem' }}>AI observations</h2>
          <p className="help">{analysis.provider} · {analysis.model} · {analysis.prompt_version} · {analysis.passes} passes, {analysis.disagreements} disagreements · {analysis.latency_ms} ms. Mark whether you agree with each point. This builds the evidence for how accurate the AI is.</p>
          <div className="table-wrap">
            <table data-testid="observations">
              <thead><tr><th>Zone</th><th>Attribute</th><th>Observation</th><th>Label</th><th>Your view</th></tr></thead>
              <tbody>
                {obs.map((o) => {
                  const f = fb(o.zone, o.attribute);
                  return (
                    <tr key={`${o.zone}-${o.attribute}`}>
                      <td>{P(`zone.${o.zone}`)}</td><td>{P(`attr.${o.attribute}`)}</td>
                      <td>{o.finding ? P(`obs.${o.attribute}.${o.finding}`) : <span className="muted">{o.reason ? P(`reason.${o.reason}`) : 'Not assessed'}</span>} {o.side !== 'centre' && <span className="chip">{P(`side.${o.side}`)}</span>}</td>
                      <td><span className={`badge ${o.confidence}`}><i />{P(`conf.${o.confidence}`)}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {(['agree', 'disagree'] as const).map((v) => (
                          <button key={v} className={`btn small${f?.verdict === v ? '' : ' secondary'}`} style={{ marginRight: 6 }} aria-pressed={f?.verdict === v} data-testid={`fb-${o.zone}-${o.attribute}-${v}`}
                            onClick={() => act(() => capi(`/api/console/cases/${id}/feedback`, { body: { analysisId: analysis.id, zone: o.zone, attribute: o.attribute, verdict: v } }))}>
                            {v === 'agree' ? 'Agree' : 'Disagree'}
                          </button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn gold small" onClick={() => act(() => capi(`/api/console/cases/${id}/feedback`, { body: { kind: 'missed_flag', verdict: 'disagree', comment: 'Safety flag missed by the system' } }), 'Reported: a safety flag was missed.')} data-testid="missed-flag">Report a missed safety flag</button>
            <button className="btn gold small" onClick={() => act(() => capi(`/api/console/cases/${id}/feedback`, { body: { kind: 'false_flag', verdict: 'disagree', comment: 'Safety flag raised without cause' } }), 'Reported: a false safety flag.')}>Report a false safety flag</button>
          </div>
        </section>
      )}

      <section aria-labelledby="notes">
        <h2 id="notes" style={{ fontSize: '1.5rem' }}>Private notes</h2>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="note" className="sr-only">Add a note</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible only to staff" data-testid="note-input" />
          <div><button className="btn small" disabled={!note.trim()} onClick={() => act(async () => { await capi(`/api/console/cases/${id}/notes`, { body: { body: note } }); setNote(''); })} data-testid="note-add">Add note</button></div>
        </div>
        <ul style={{ listStyle: 'none', padding: 0 }} data-testid="notes">
          {(c.notes ?? []).map((n: any) => <li key={n.id} className="card flat" style={{ marginBottom: 8 }}><p style={{ marginBottom: 4 }}>{n.body}</p><span className="help">{n.author_email} · {when(n.created_at)}</span></li>)}
        </ul>
      </section>

      <section className="card flat stack">
        <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}>Case actions</h2>
        <div className="btn-row">
          {vis && <button className="btn secondary small" onClick={() => void exportCase()} data-testid="export">Export case (JSON)</button>}
          {c.booking && <button className="btn secondary small" onClick={() => act(() => capi(`/api/console/cases/${id}/block-number`, { body: { reason: 'Blocked from the console' } }), 'This WhatsApp number is blocked from future bookings.')}>Block this number</button>}
          <DeleteCase onConfirm={async () => { await capi(`/api/console/cases/${id}`, { method: 'DELETE' }); location.href = '/console'; }} />
        </div>
        <p className="help">Consents: {(c.consents ?? []).map((k: any) => `${k.key}${k.withdrawn_at ? ' (withdrawn)' : ''}`).join(', ')} · Created {when(c.created_at)} · Signed in as {me?.email}</p>
      </section>
      {msg && <p role="status" className="notice calm" data-testid="msg">{msg}</p>}
    </div>
  );
}

function DeleteCase({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="btn-row"><button className="btn danger small" onClick={() => void onConfirm()} data-testid="delete-confirm">Yes, delete this case</button><button className="btn secondary small" onClick={() => setAsk(false)}>Cancel</button></span>
  ) : (
    <button className="btn danger small" onClick={() => setAsk(true)} data-testid="delete-case">Delete case</button>
  );
}

// ---------------------------------------------------------------- templates
const CATS = ['cleanser', 'moisturiser', 'sunscreen', 'other'] as const;
export function TemplatesPage() {
  const { data, err, reload } = useLoad<any[]>(() => capi('/api/console/templates'), []);
  const [edit, setEdit] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [terms, setTerms] = useState<string[]>([]);

  const blank = () => ({ id: null, name: '', steps: 2, skin_feel: 'any', sensitivity: 'any', budget_bands: [] as string[], items: [{ category: 'cleanser', text_en: '', text_hi: '' }, { category: 'moisturiser', text_en: '', text_hi: '' }], approved: false });
  const save = async (approve: boolean) => {
    setTerms([]);
    setMsg(null);
    const body = { name: edit.name, steps: Number(edit.steps), skinFeel: edit.skin_feel, sensitivity: edit.sensitivity, budgetBands: edit.budget_bands, items: edit.items.slice(0, Number(edit.steps)), approve };
    try {
      await capi(edit.id ? `/api/console/templates/${edit.id}` : '/api/console/templates', { method: edit.id ? 'PUT' : 'POST', body });
      setEdit(null);
      setMsg(approve ? 'Saved and approved.' : 'Saved as a draft.');
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'banned_terms') setTerms((e as any).fields ?? []);
      setMsg(e instanceof ApiError ? (e.code === 'banned_terms' ? 'Routine text may not name conditions, treatments or medicines.' : `Could not save (${e.code}). Check every box is filled.`) : 'Error');
    }
  };
  const setItems = (steps: number) => setEdit((x: any) => ({ ...x, steps, items: Array.from({ length: steps }, (_, i) => x.items[i] ?? { category: i === 2 ? 'sunscreen' : 'cleanser', text_en: '', text_hi: '' }) }));

  return (
    <div className="stack">
      <h1 style={{ fontSize: '2rem' }}>Routine templates</h1>
      <p className="muted">Starter routines for the healthy-skin path. Categories only, no brands. Visitors see a template only after it is approved; samples are labelled as samples and shown only while the test setting is on.</p>
      <div><button className="btn" onClick={() => setEdit(blank())} data-testid="new-template">New template</button></div>
      <Err err={err} />
      {msg && <p role="status" className="notice calm" data-testid="tpl-msg">{msg}</p>}
      {edit && (
        <form className="card stack" onSubmit={(e) => e.preventDefault()} data-testid="tpl-form">
          <div className="field"><label htmlFor="t-name">Name</label><input id="t-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="t-name" /></div>
          <div className="grid g3">
            <div className="field"><label htmlFor="t-steps">Steps</label><select id="t-steps" value={edit.steps} onChange={(e) => setItems(Number(e.target.value))}><option value={2}>2</option><option value={3}>3</option></select></div>
            <div className="field"><label htmlFor="t-feel">Skin feel</label><select id="t-feel" value={edit.skin_feel} onChange={(e) => setEdit({ ...edit, skin_feel: e.target.value })}>{['any', 'dry', 'balanced', 'oily'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label htmlFor="t-sens">Sensitivity</label><select id="t-sens" value={edit.sensitivity} onChange={(e) => setEdit({ ...edit, sensitivity: e.target.value })}>{['any', 'low', 'high'].map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <fieldset><legend>Budget bands (none selected means any)</legend>
            <div className="options">{(['under_500', 'b500_1500', 'b1500_3000', 'over_3000'] as const).map((b) => (
              <label key={b} className="opt multi"><input type="checkbox" checked={edit.budget_bands.includes(b)} onChange={(e) => setEdit({ ...edit, budget_bands: e.target.checked ? [...edit.budget_bands, b] : edit.budget_bands.filter((x: string) => x !== b) })} /><span className="mark" /><span>{qdef(en, 'budget').opt[b]}</span></label>
            ))}</div></fieldset>
          {edit.items.slice(0, Number(edit.steps)).map((it: any, i: number) => (
            <div key={i} className="card flat stack">
              <div className="field"><label htmlFor={`c${i}`}>Step {i + 1} category</label><select id={`c${i}`} value={it.category} onChange={(e) => setEdit((x: any) => ({ ...x, items: x.items.map((y: any, j: number) => (j === i ? { ...y, category: e.target.value } : y)) }))}>{CATS.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field"><label htmlFor={`en${i}`}>English text</label><textarea id={`en${i}`} value={it.text_en} onChange={(e) => setEdit((x: any) => ({ ...x, items: x.items.map((y: any, j: number) => (j === i ? { ...y, text_en: e.target.value } : y)) }))} data-testid={`t-en-${i}`} /></div>
              <div className="field"><label htmlFor={`hi${i}`}>Hindi text</label><textarea id={`hi${i}`} lang="hi" value={it.text_hi} onChange={(e) => setEdit((x: any) => ({ ...x, items: x.items.map((y: any, j: number) => (j === i ? { ...y, text_hi: e.target.value } : y)) }))} data-testid={`t-hi-${i}`} /></div>
            </div>
          ))}
          {terms.length > 0 && <p className="error-text">Not allowed: {terms.join(', ')}</p>}
          <div className="btn-row">
            <button className="btn secondary" onClick={() => void save(false)} data-testid="t-save-draft">Save as draft</button>
            <button className="btn" onClick={() => void save(true)} data-testid="t-save-approve">Save and approve</button>
            <button className="btn secondary" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="table-wrap">
        <table data-testid="templates">
          <thead><tr><th>Name</th><th>Match</th><th>Status</th><th>Items</th><th /></tr></thead>
          <tbody>{(data ?? []).map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.steps} steps · {t.skin_feel} · {t.sensitivity}{t.budget_bands.length ? ` · ${t.budget_bands.join('/')}` : ''}</td>
              <td>{t.approved ? <span className="chip">Approved</span> : t.sample ? <span className="chip" style={{ background: '#FBF0D4' }}>Sample</span> : <span className="chip">Draft</span>}</td>
              <td>{t.items.map((i: any) => i.category).join(', ')}</td>
              <td><button className="btn secondary small" onClick={() => { setEdit({ ...t }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>{' '}<button className="btn danger small" onClick={async () => { await capi(`/api/console/templates/${t.id}`, { method: 'DELETE' }); reload(); }}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- stats
export function StatsPage() {
  const { data, err } = useLoad<any>(() => capi('/api/console/stats?weeks=8'), []);
  const m = data?.measures;
  const row = (label: string, value: string, target: string, ok: boolean | null) => (
    <tr><td>{label}</td><td><strong>{value}</strong></td><td>{target}</td><td>{ok === null ? '—' : ok ? '✓ Meets target' : '✗ Below target'}</td></tr>
  );
  const n = (v: any) => (v === null || v === undefined ? null : Number(v));
  return (
    <div className="stack">
      <h1 style={{ fontSize: '2rem' }}>Counts</h1>
      <Err err={err} />
      {m && (
        <>
          <h2 style={{ fontSize: '1.4rem' }}>Phase 1 success measures (proposed targets; reset after the first 100 visitors)</h2>
          <div className="table-wrap"><table data-testid="measures"><thead><tr><th>Measure</th><th>Now</th><th>Target</th><th /></tr></thead><tbody>
            {row('Camera started → snapshot reached', n(m.camera_to_snapshot_pct) === null ? 'no data' : `${m.camera_to_snapshot_pct}% (${m.camera_to_snapshot} of ${m.camera_sessions})`, '50% or more', n(m.camera_to_snapshot_pct) === null ? null : n(m.camera_to_snapshot_pct)! >= 50)}
            {row('Snapshot within 60 s of the last photo', n(m.within_60s_pct) === null ? 'no data' : `${m.within_60s_pct}% (median ${m.time_to_snapshot_p50_s ?? '—'} s, 95th ${m.time_to_snapshot_p95_s ?? '—'} s)`, 'Within 60 s', n(m.within_60s_pct) === null ? null : n(m.time_to_snapshot_p95_s)! <= 60)}
            {row('Snapshot viewers who request a booking', n(m.snapshot_to_booking_pct) === null ? 'no data' : `${m.snapshot_to_booking_pct}% (${m.snapshot_to_booking} of ${m.snapshot_viewers})`, '20% or more', n(m.snapshot_to_booking_pct) === null ? null : n(m.snapshot_to_booking_pct)! >= 20)}
            {row('Cases where a safety stop was followed by a routine', String(m.safety_leaks), 'Zero', m.safety_leaks === 0)}
          </tbody></table></div>
          <p className="help">Safety leaks are measured from events. The database and API also prevent a stopped case from receiving a routine at all. Answer-based flags are deterministic; image-based flags are a probabilistic check, so use “Report a missed safety flag” on any case where one was missed.</p>
          <h2 style={{ fontSize: '1.4rem' }}>By week</h2>
          <div className="table-wrap"><table data-testid="weekly"><thead><tr><th>Week of</th><th>Visitors</th><th>Paths picked</th><th>Started</th><th>Consented</th><th>Camera</th><th>Photos done</th><th>Snapshots</th><th>Bookings</th><th>Flags</th></tr></thead><tbody>
            {data.weeks.map((w: any) => <tr key={w.week_start}><td>{w.week_start}</td><td>{w.visitors}</td><td>{w.path_selected}</td><td>{w.assessments_started}</td><td>{w.consents_completed}</td><td>{w.camera_started}</td><td>{w.photos_completed}</td><td>{w.snapshots}</td><td>{w.bookings}</td><td>{w.flags}</td></tr>)}
            {data.weeks.length === 0 && <tr><td colSpan={10} className="muted">No activity yet.</td></tr>}
          </tbody></table></div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- access log
export function AccessLogPage() {
  const { data, err } = useLoad<any[]>(() => capi('/api/console/access-log?limit=200'), []);
  return (
    <div className="stack">
      <h1 style={{ fontSize: '2rem' }}>Access log</h1>
      <p className="muted">Who opened which case and when. This log is append-only.</p>
      <Err err={err} />
      <div className="table-wrap"><table data-testid="access-log"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Case</th><th>Detail</th></tr></thead><tbody>
        {(data ?? []).map((l) => <tr key={l.id}><td>{when(l.at)}</td><td>{l.actor_email ?? 'system'}</td><td>{l.action}</td><td>{l.case_code ?? '—'}</td><td className="small">{Object.keys(l.meta ?? {}).length ? JSON.stringify(l.meta) : ''}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}

// ---------------------------------------------------------------- settings
export function SettingsPage() {
  const { data, err, reload } = useLoad<Record<string, any>>(() => capi('/api/console/settings'), []);
  const staff = useLoad<any[]>(() => capi('/api/console/staff'), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [wa, setWa] = useState<string | null>(null);
  const [promise, setPromise] = useState<string | null>(null);
  const put = useCallback(async (key: string, value: string | number | boolean) => {
    try {
      await capi(`/api/console/settings/${key}`, { method: 'PUT', body: { value } });
      setMsg('Saved.');
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? `Could not save (${e.code}).` : 'Error');
    }
  }, [reload]);
  const s = data ?? {};
  return (
    <div className="stack">
      <h1 style={{ fontSize: '2rem' }}>Settings</h1>
      <Err err={err} />
      {msg && <p className="notice calm" role="status">{msg}</p>}
      <div className="card stack">
        <div className="field"><label htmlFor="s-wa">Cosmetologist WhatsApp number (with country code)</label>
          <input id="s-wa" value={wa ?? s.whatsapp_number ?? ''} onChange={(e) => setWa(e.target.value)} placeholder="+91…" data-testid="s-wa" />
          <span className="help">Used for the “Open WhatsApp” button and QR code. If empty, visitors are shown the message to copy.</span>
          <div><button className="btn small" onClick={() => void put('whatsapp_number', (wa ?? s.whatsapp_number ?? '').trim())} data-testid="s-wa-save">Save</button></div></div>
        <div className="field"><label htmlFor="s-pr">Service promise shown to visitors</label>
          <input id="s-pr" value={promise ?? s.service_promise ?? ''} onChange={(e) => setPromise(e.target.value)} />
          <div><button className="btn small" onClick={() => void put('service_promise', (promise ?? s.service_promise ?? '').trim())}>Save</button></div></div>
        <label className="consent-row"><input type="checkbox" checked={s.allow_sample_routines === true} onChange={(e) => void put('allow_sample_routines', e.target.checked)} /><span>Show labelled SAMPLE routines when no approved template matches (testing only; switch off before public launch).</span></label>
        <label className="consent-row"><input type="checkbox" checked={s.maintenance_mode === true} onChange={(e) => void put('maintenance_mode', e.target.checked)} /><span>Maintenance mode (visitors cannot start a new check).</span></label>
        <div className="field"><label htmlFor="s-gb">Image safety check: stop the flow at this model confidence or higher</label>
          <select id="s-gb" value={s.gate_b_min_confidence ?? 'not_sure'} onChange={(e) => void put('gate_b_min_confidence', e.target.value)}><option value="not_sure">Not sure (most cautious, recommended)</option><option value="likely">Likely</option><option value="clear">Clear</option></select>
          <span className="help">Lower is safer: more visitors are referred to a dermatologist. Changing this needs the dermatologist’s sign-off.</span></div>
      </div>
      <div className="card stack">
        <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}>Staff</h2>
        <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Active</th></tr></thead><tbody>
          {(staff.data ?? []).map((x) => <tr key={x.email}><td>{x.email}</td><td>{x.role}</td><td>{x.active ? 'Yes' : 'No'}</td></tr>)}
        </tbody></table></div>
        <p className="help">Staff accounts are added by an administrator in the identity provider and in the staff table. See docs/OPERATIONS.md.</p>
      </div>
    </div>
  );
}
