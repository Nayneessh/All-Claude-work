'use client';
import Link from 'next/link';
import { phrase } from '../core/phrases';
import type { VisitorState } from '../server/service';
import { IconHeart } from './icons';
import { useLang } from './LangProvider';
import { PrivacyControls } from './PrivacyControls';

/** The calm referral. No routine, no cosmetic booking prompt, no observations. */
export function SafetyStop({ state, token, onChanged }: { state: VisitorState; token: string; onChanged: () => void }) {
  const { lang, dict: d } = useLang();
  const p = (k: string) => phrase(lang, k);
  return (
    <div className="container flow-wrap narrow" data-testid="safety-stop">
      <div className="safety">
        <span className="icon-badge" style={{ marginBottom: 14, background: '#fff' }}><IconHeart size={26} /></span>
        <h1>{p('safety.title')}</h1>
        <p className="lead">{p('safety.body')}</p>
        <p style={{ fontWeight: 700 }}>{p('safety.action')}</p>
        {state.safety.source && <p className="help">{p(`safety.source.${state.safety.source}`)}</p>}
        <p className="muted small" style={{ marginBottom: 0 }}>{d.safety.ctaNote}</p>
      </div>
      <p className="notice calm small" style={{ marginTop: 18 }}>{d.safety.flagged}</p>
      <div className="btn-row" style={{ marginTop: 18 }}>
        <Link className="btn" href={`/${lang}`}>{d.safety.start}</Link>
      </div>
      <div style={{ marginTop: 32 }}>
        <PrivacyControls state={state} token={token} onChanged={onChanged} />
      </div>
    </div>
  );
}
