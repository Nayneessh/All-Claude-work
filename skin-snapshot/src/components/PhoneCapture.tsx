'use client';
import { useEffect, useState } from 'react';
import type { VisitorState } from '../server/service';
import { ApiError, api } from '../lib/api';
import { photoStore } from '../lib/photostore';
import { CaptureWizard } from './CaptureWizard';
import { useLang } from './LangProvider';

/** The page a phone opens from the QR code. It can only take and upload photos for one case. */
export function PhoneCapture({ token }: { token: string }) {
  const { dict: d } = useLang();
  const [state, setState] = useState<VisitorState | null>(null);
  const [gone, setGone] = useState(false);
  const [step, setStep] = useState<'tips' | 'capture' | 'done'>('tips');
  useEffect(() => {
    api<VisitorState>('/api/case', { capture: token }).then(setState).catch((e) => e instanceof ApiError && e.status === 404 && setGone(true));
    return () => photoStore.clear();
  }, [token]);

  if (gone) return <div className="container flow-wrap narrow" data-testid="capture-gone"><h1>{d.system.caseGone.title}</h1><p className="lead">{d.system.caseGone.lead}</p></div>;
  if (!state) return <div className="container flow-wrap narrow"><div className="spinner" role="status" aria-label={d.common.loading} /></div>;
  if (step === 'done') {
    return <div className="container flow-wrap narrow" data-testid="phone-done"><h1>{d.camera.allCaptured}</h1><p className="lead">{d.camera.phoneDoneOnPhone}</p></div>;
  }
  if (step === 'tips') {
    return (
      <div className="container flow-wrap narrow" data-testid="phone-tips">
        <p className="eyebrow">{d.camera.phoneTitle}</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.tips.title}</h1>
        <hr className="gold-rule" />
        <ul className="check-list lead">{d.tips.items.map((t) => <li key={t}>{t}</li>)}</ul>
        <div className="btn-row"><button className="btn" onClick={() => setStep('capture')} data-testid="phone-start">{d.tips.start}</button></div>
      </div>
    );
  }
  return (
    <div className="container flow-wrap narrow">
      <CaptureWizard token={token} mode="capture" path={state.path} onComplete={() => { photoStore.clear(); setStep('done'); }} />
    </div>
  );
}
