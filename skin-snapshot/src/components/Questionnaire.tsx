'use client';
import { useMemo, useState } from 'react';
import { SECTIONS, questionsFor, type Answers, type Question } from '../core/questionnaire';
import type { PathId } from '../core/types';
import { qdef } from '../i18n';
import { ApiError, api, errorText } from '../lib/api';
import { fmt } from '../i18n';
import { useLang } from './LangProvider';

function QuestionField({ q, value, onChange, invalid }: { q: Question; value: string | string[] | undefined; onChange: (v: string | string[]) => void; invalid: boolean }) {
  const { dict: d } = useLang();
  const def = qdef(d, q.id);
  const multi = q.kind === 'multi';
  const sel = multi ? ((value as string[] | undefined) ?? []) : value;
  const toggle = (o: string) => {
    if (!multi) return onChange(o);
    let next = [...(sel as string[])];
    if (next.includes(o)) next = next.filter((x) => x !== o);
    else if (o === q.exclusive) next = [o];
    else next = [...next.filter((x) => x !== q.exclusive), o];
    onChange(next);
  };
  const yn = q.options.length === 2 && q.options.includes('yes');
  return (
    <fieldset data-testid={`q-${q.id}`} aria-invalid={invalid} aria-describedby={`${q.id}-help`}>
      <legend>{def.label}</legend>
      {def.help && <p className="help" id={`${q.id}-help`}>{def.help}</p>}
      <div className={`options${yn ? '' : ''}`} role={multi ? 'group' : 'radiogroup'}>
        {q.options.map((o) => {
          const checked = multi ? (sel as string[]).includes(o) : sel === o;
          return (
            <label key={o} className={`opt${multi ? ' multi' : ''}`}>
              <input type={multi ? 'checkbox' : 'radio'} name={q.id} value={o} checked={checked} onChange={() => toggle(o)} data-testid={`q-${q.id}-${o}`} />
              <span className="mark" aria-hidden="true" />
              <span>{def.opt[o]}</span>
            </label>
          );
        })}
      </div>
      {invalid && <p className="error-text" role="alert">{d.questionnaire.pleaseAnswer}</p>}
    </fieldset>
  );
}

/** Asks the questions for a path in three short sections. After a path switch only the missing ones are asked. */
export function Questionnaire({ token, path, only, onDone }: { token: string; path: PathId; only?: readonly string[]; onDone: () => void }) {
  const { dict: d } = useLang();
  const [answers, setAnswers] = useState<Answers>({});
  const [sIdx, setSIdx] = useState(0);
  const [showInvalid, setShowInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({ s, qs: questionsFor(path, s).filter((q) => !only || only.includes(q.id)) })).filter((x) => x.qs.length > 0),
    [path, only],
  );
  const cur = sections[sIdx]!;
  const last = sIdx === sections.length - 1;
  const missing = cur.qs.filter((q) => answers[q.id] === undefined || (Array.isArray(answers[q.id]) && (answers[q.id] as string[]).length === 0));

  const next = async () => {
    if (missing.length) {
      setShowInvalid(true);
      document.querySelector<HTMLElement>(`[data-testid="q-${missing[0]!.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setShowInvalid(false);
    if (!last) {
      setSIdx(sIdx + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/case/answers', { token, body: { answers } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'invalid_answers' ? d.questionnaire.pleaseAnswer : errorText(e, d.errors));
      setBusy(false);
    }
  };

  return (
    <div className="container flow-wrap narrow" data-testid="questionnaire">
      <ol className="progress" aria-hidden="true">
        {sections.map((_, i) => <li key={i} className={i < sIdx ? 'done' : i === sIdx ? 'now' : ''} />)}
      </ol>
      <p className="eyebrow">{fmt(d.common.step, { n: sIdx + 1, total: sections.length })}</p>
      <h1 style={{ fontSize: 'clamp(1.7rem,5vw,2.4rem)' }}>{d.questionnaire.sections[cur.s].title}</h1>
      <hr className="gold-rule" />
      <p className="lead" style={{ marginBottom: 26 }}>{d.questionnaire.sections[cur.s].lead}</p>
      {cur.qs.map((q) => (
        <QuestionField key={q.id} q={q} value={answers[q.id]} invalid={showInvalid && missing.includes(q)} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
      ))}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="btn-row">
        {sIdx > 0 && <button type="button" className="btn secondary" onClick={() => setSIdx(sIdx - 1)}>{d.common.back}</button>}
        <button type="button" className="btn" onClick={next} disabled={busy} data-testid="q-next">{busy ? d.questionnaire.saving : last ? d.common.continue : d.common.next}</button>
      </div>
    </div>
  );
}
