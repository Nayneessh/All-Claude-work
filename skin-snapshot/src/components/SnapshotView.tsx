'use client';
import { useState } from 'react';
import { phrase } from '../core/phrases';
import type { PathId } from '../core/types';
import type { VisitorState } from '../server/service';
import { fmt } from '../i18n';
import { ApiError, api, errorText } from '../lib/api';
import { useLang } from './LangProvider';

const CONF_HELP = ['clear', 'likely', 'not_sure', 'not_assessed'] as const;

export function ConfidenceBadge({ c }: { c: string }) {
  const { lang } = useLang();
  return <span className={`badge ${c}`}><i aria-hidden="true" />{phrase(lang, `conf.${c}`)}</span>;
}

export function SnapshotView({ state, token, onBook, onChanged }: { state: VisitorState; token: string; onBook: () => void; onChanged: () => void }) {
  const { lang, dict: d } = useLang();
  const vm = state.snapshot!;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const p = (k: string) => phrase(lang, k);
  const budget = state.budget;

  const doSwitch = async (path: PathId) => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/case/switch-path', { token, body: { path } });
      onChanged();
    } catch (e) {
      setErr(errorText(e, d.errors));
      setBusy(false);
    }
  };

  const routineHeldText: Record<string, string | undefined> = {
    restriction: p('routine.restricted'),
    path_mismatch: p('fit.better.hold'),
    no_template: p('routine.no_template'),
  };

  return (
    <div className="container flow-wrap" data-testid="snapshot">
      <p className="eyebrow">{d.snapshot.caseCode}: <strong data-testid="case-code">{state.code}</strong></p>
      <h1 style={{ fontSize: 'clamp(1.9rem,5vw,3rem)' }}>{d.snapshot.title}</h1>
      <hr className="gold-rule" />
      <p className="lead">{d.snapshot.lead}</p>
      {vm.qualityFair && <p className="notice">{p('quality.fair')}</p>}
      {vm.expectKey && <p className="notice calm">{p(vm.expectKey)}</p>}

      <section aria-labelledby="see" style={{ marginTop: 28 }}>
        <h2 id="see" style={{ fontSize: '1.9rem' }}>{d.snapshot.see}</h2>
        <div className="legend" style={{ margin: '14px 0 18px' }}>
          <p style={{ gridColumn: '1 / -1', margin: 0 }} className="help">{d.snapshot.legendLead}</p>
          {CONF_HELP.map((c) => (
            <div key={c}><ConfidenceBadge c={c} /><span>{p(`conf.${c}.help`)}</span></div>
          ))}
        </div>
        <div className="grid g2" style={{ alignItems: 'start' }}>
          {vm.zones.map((z) => (
            <article key={z.zone} className="zone" data-testid={`zone-${z.zone}`}>
              <h3>{p(`zone.${z.zone}`)}</h3>
              {z.rows.map((r) => (
                <div className="row" key={r.attribute} data-testid={`row-${z.zone}-${r.attribute}`}>
                  <span className="attr">{p(`attr.${r.attribute}`)}</span>
                  <span className="finding">{r.finding ? p(`obs.${r.attribute}.${r.finding}`) : d.snapshot.noObservation}</span>
                  <span className="meta">
                    <ConfidenceBadge c={r.confidence} />
                    {z.zone === 'cheeks' || z.zone === 'under_eyes' ? <span className="chip">{p(`side.${r.side}`)}</span> : null}
                  </span>
                  {r.reason && <span className="why">{p(`reason.${r.reason}`)}</span>}
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 34 }} aria-labelledby="fit">
        <h2 id="fit" style={{ fontSize: '1.7rem' }}>{d.snapshot.bestFit}</h2>
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 6 }}><strong>{fmt(d.snapshot.bestFitOn, { path: p(`path.${vm.path}`) })}</strong></p>
          {vm.pathMismatch ? (
            <div data-testid="path-mismatch">
              <p>{p('fit.better')}</p>
              <p style={{ marginBottom: 12 }}><strong>{p(`path.${vm.bestFit.path}`)}</strong> <ConfidenceBadge c={vm.bestFit.confidence} /></p>
              <button type="button" className="btn gold" disabled={busy} onClick={() => void doSwitch(vm.bestFit.path)} data-testid="switch-path">{fmt(d.snapshot.switchBtn, { path: p(`path.${vm.bestFit.path}`) })}</button>
              {err && <p className="error-text" role="alert">{err}</p>}
            </div>
          ) : (
            <p style={{ marginBottom: 0 }}>{p('fit.match')}</p>
          )}
        </div>
      </section>

      {vm.path === 'maintenance' && (
        <section style={{ marginTop: 34 }} aria-labelledby="routine" data-testid="routine-section">
          <h2 id="routine" style={{ fontSize: '1.7rem' }}>{d.snapshot.routine}</h2>
          {vm.routine ? (
            <div className="card accent" style={{ marginTop: 12 }}>
              <p className="help">{d.snapshot.routineLead}</p>
              <p className={vm.routine.status === 'sample' ? 'notice' : 'notice calm'} data-testid="routine-status" style={{ fontSize: '0.88rem' }}>{vm.routine.status === 'sample' ? p('routine.sample') : p('routine.approved')}</p>
              <ol style={{ marginBottom: 0 }}>
                {vm.routine.template.items.map((it, i) => (
                  <li key={i}><strong>{p(`routine.cat.${it.category}`)}.</strong> {lang === 'hi' ? it.text_hi : it.text_en}</li>
                ))}
              </ol>
              {budget && <p className="help" style={{ marginTop: 10 }}>{fmt(d.snapshot.routineBudget, { budget: d.q.budget.opt[budget as keyof typeof d.q.budget.opt] })}</p>}
            </div>
          ) : (
            <p className="notice calm" style={{ marginTop: 12 }} data-testid="routine-held">{routineHeldText[vm.routineHeld ?? ''] ?? ''}</p>
          )}
        </section>
      )}

      <section style={{ marginTop: 34 }} aria-labelledby="next">
        <h2 id="next" style={{ fontSize: '1.7rem' }}>{d.snapshot.next}</h2>
        <div className="card accent" style={{ marginTop: 12 }}>
          <p>{p(`next.${vm.nextStep}`)}</p>
          {vm.showBooking && !state.booking && (
            <>
              <p className="help">{d.snapshot.bookLead}</p>
              <button type="button" className="btn" onClick={onBook} data-testid="book-cta">{d.snapshot.book}</button>
            </>
          )}
        </div>
      </section>

      {vm.talkQuestions.length > 0 && (
        <section style={{ marginTop: 34 }} aria-labelledby="qs">
          <h2 id="qs" style={{ fontSize: '1.7rem' }}>{d.snapshot.questions}</h2>
          <ul className="check-list" style={{ marginTop: 12 }}>{vm.talkQuestions.map((k) => <li key={k}>{p(k)}</li>)}</ul>
        </section>
      )}

      <aside className="notice" style={{ marginTop: 34 }} data-testid="disclaimer">
        <strong>{d.snapshot.disclaimerTitle}</strong>
        <p style={{ margin: '6px 0 0' }}>{d.snapshot.disclaimer}</p>
      </aside>

      <section style={{ marginTop: 24 }} className="card flat">
        {state.expiresAt && <p style={{ marginBottom: 8 }}>{fmt(d.snapshot.expires, { date: new Date(state.expiresAt).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
        <p className="help" style={{ marginBottom: 10 }}>{d.snapshot.keepLink}</p>
        <button type="button" className="btn secondary small" onClick={() => navigator.clipboard?.writeText(location.href).then(() => setCopied(true)).catch(() => {})}>{copied ? d.common.copied : d.snapshot.copyLink}</button>
      </section>
    </div>
  );
}

void ApiError;
