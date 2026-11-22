'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { phrase } from '../core/phrases';
import { REQUIRED_SLOTS, type PathId } from '../core/types';
import type { VisitorState } from '../server/service';
import { fmt } from '../i18n';
import { ApiError, api } from '../lib/api';
import { track } from '../lib/analytics';
import { prefetchFaceModel } from '../lib/face';
import { hasGetUserMedia } from '../lib/device';
import { photoStore } from '../lib/photostore';
import { Analysis } from './Analysis';
import { BookingForm } from './BookingForm';
import { CaptureWizard } from './CaptureWizard';
import { Confirmation } from './Confirmation';
import { useLang } from './LangProvider';
import { PrivacyControls } from './PrivacyControls';
import { Questionnaire } from './Questionnaire';
import { SafetyStop } from './SafetyStop';
import { SnapshotView } from './SnapshotView';

type Intro = 'tips' | 'ai' | 'capture';

export function CaseApp({ token }: { token: string }) {
  const { lang, dict: d } = useLang();
  const [state, setState] = useState<VisitorState | null>(null);
  const [gone, setGone] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [view, setView] = useState<'main' | 'booking'>('main');
  const [intro, setIntro] = useState<Intro>('tips');
  const [analysing, setAnalysing] = useState(false);
  const analyseRef = useRef(false);
  const viewedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api<VisitorState>(`/api/case?lang=${lang}`, { token });
      setState(s);
      setLoadErr(false);
      return s;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setLoadErr(true);
      return null;
    }
  }, [token, lang]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Photos held on this device are discarded when the visitor leaves the case.
  useEffect(() => {
    const clear = () => photoStore.clear();
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      setTimeout(() => {
        if (!location.pathname.includes('/case/')) photoStore.clear();
      }, 400);
    };
  }, []);

  // Start fetching the face model while the visitor answers questions.
  useEffect(() => {
    if (state && state.stage === 'consented' && hasGetUserMedia()) prefetchFaceModel();
  }, [state?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = useCallback(async () => {
    if (analyseRef.current) return;
    analyseRef.current = true;
    setAnalysing(true);
    photoStore.clear(); // photos are on the server now
    const poll = setInterval(() => void refresh(), 3500);
    try {
      await api('/api/case/analyze', { method: 'POST', token });
    } catch {
      /* state tells the story */
    } finally {
      clearInterval(poll);
      await refresh();
      analyseRef.current = false;
      setAnalysing(false);
    }
  }, [token, refresh]);

  // Photos already on the server but not analysed yet (for example after continuing on a phone).
  useEffect(() => {
    if (state && state.stage === 'photos_ready' && state.analysis.status !== 'running' && !analyseRef.current) void runAnalysis();
  }, [state?.stage, state?.analysis.status, runAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stage polling while the server works.
  useEffect(() => {
    if (!state || state.stage !== 'analysing' || analysing) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [state?.stage, analysing, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state?.snapshot && !state.safety.stopped && !viewedRef.current) {
      viewedRef.current = true;
      track('snapshot_viewed', { path: state.path });
    }
  }, [state]);

  if (gone) {
    return (
      <div className="container flow-wrap narrow" style={{ textAlign: 'center' }} data-testid="case-gone">
        <h1>{d.system.caseGone.title}</h1>
        <hr className="gold-rule" style={{ marginInline: 'auto' }} />
        <p className="lead" style={{ marginInline: 'auto' }}>{d.system.caseGone.lead}</p>
        <p><Link className="btn" href={`/${lang}/start`}>{d.nav.start}</Link></p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="container flow-wrap narrow" style={{ textAlign: 'center' }}>
        {loadErr ? (
          <>
            <p className="error-text" role="alert" style={{ justifyContent: 'center' }}>{d.errors.network}</p>
            <button className="btn" onClick={() => void refresh()}>{d.common.retry}</button>
          </>
        ) : (
          <div className="spinner" style={{ margin: '40px auto' }} role="status" aria-label={d.common.loading} />
        )}
      </div>
    );
  }

  const path: PathId = state.pendingPath ?? state.path;

  // 1. Safety stop ends the cosmetic flow.
  if (state.safety.stopped) return <SafetyStop state={state} token={token} onChanged={refresh} />;

  // 2. Questions (all of them, or the missing ones after a path switch)
  if (state.stage === 'needs_path_questions' || !state.hasAnswers) {
    return <Questionnaire key={path + state.needsQuestions.join()} token={token} path={path} only={state.pendingPath ? state.needsQuestions : undefined} onDone={() => void refresh()} />;
  }

  // 3. Analysis in progress
  if (analysing || state.stage === 'analysing' || (state.stage === 'photos_ready' && state.analysis.status !== 'failed')) return <Analysis />;

  if (state.stage === 'analysis_failed') {
    return (
      <div className="container flow-wrap narrow" style={{ textAlign: 'center' }} data-testid="analysis-failed">
        <h1>{d.analysis.title}</h1>
        <p className="notice" role="alert">{d.analysis.failed}</p>
        <button className="btn" onClick={() => void runAnalysis()} data-testid="retry-analysis">{d.analysis.retry}</button>
        <div style={{ marginTop: 32, textAlign: 'left' }}><PrivacyControls state={state} token={token} onChanged={refresh} /></div>
      </div>
    );
  }

  if (state.stage === 'needs_retake') {
    return (
      <div className="container flow-wrap narrow" data-testid="needs-retake">
        <h1>{d.analysis.retakeTitle}</h1>
        <hr className="gold-rule" />
        <p className="lead">{d.analysis.retakeLead}</p>
        <ul>{(state.retake?.issues ?? []).map((i) => <li key={i}>{phrase(lang, `reason.${i}`)}</li>)}</ul>
        <RetakeButton token={token} onDone={() => { setIntro('capture'); void refresh(); }} />
      </div>
    );
  }

  // 4. Capture photos (needs the photo and AI consent)
  if (!state.consents.includes('photos_ai') && !state.snapshot) {
    return (
      <div className="container flow-wrap narrow" style={{ textAlign: 'center' }} data-testid="consent-withdrawn">
        <h1>{d.controls.withdrawn}</h1>
        <p className="lead" style={{ marginInline: 'auto' }}>{d.controls.effects.photos_ai}</p>
        <p><Link className="btn" href={`/${lang}/start`}>{d.nav.start}</Link></p>
        <div style={{ marginTop: 32, textAlign: 'left' }}><PrivacyControls state={state} token={token} onChanged={refresh} /></div>
      </div>
    );
  }
  const storedRequired = REQUIRED_SLOTS.every((s) => state.photos.some((p) => p.slot === s && p.status === 'stored'));
  if (!state.snapshot || (!storedRequired && state.stage !== 'snapshot_ready')) {
    if (intro === 'tips') {
      return (
        <div className="container flow-wrap narrow" data-testid="tips">
          <p className="eyebrow">{d.camera.title}</p>
          <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.tips.title}</h1>
          <hr className="gold-rule" />
          <ul className="check-list lead">{d.tips.items.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="btn-row" style={{ marginTop: 20 }}><button className="btn" onClick={() => setIntro('ai')} data-testid="tips-ok">{d.tips.start}</button></div>
        </div>
      );
    }
    if (intro === 'ai') {
      return (
        <div className="container flow-wrap narrow" data-testid="ai-explainer">
          <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.ai.title}</h1>
          <hr className="gold-rule" />
          <div className="grid g2">
            <div className="card"><ul className="check-list" style={{ marginBottom: 0 }}>{d.ai.does.map((t) => <li key={t}>{t}</li>)}</ul></div>
            <div className="card accent"><ul className="cross-list" style={{ marginBottom: 0 }}>{d.ai.doesNot.map((t) => <li key={t}>{t}</li>)}</ul></div>
          </div>
          <div className="btn-row" style={{ marginTop: 22 }}><button className="btn" onClick={() => setIntro('capture')} data-testid="ai-ok">{d.ai.ok}</button></div>
        </div>
      );
    }
    return (
      <div className="container flow-wrap narrow" data-testid="capture-page">
        <CaptureWizard token={token} mode="full" path={state.path} onComplete={() => void runAnalysis()} />
      </div>
    );
  }

  // 5. Booking form
  if (view === 'booking') {
    return <BookingForm token={token} promise={state.settings.servicePromise} onCancel={() => setView('main')} onDone={() => { setView('main'); void refresh(); }} />;
  }

  // 6. Snapshot (with the confirmation on top once a talk has been requested)
  return (
    <>
      {state.booking && <Confirmation state={state} />}
      <SnapshotView state={state} token={token} onBook={() => setView('booking')} onChanged={() => void refresh()} />
      <div className="container narrow" style={{ paddingBottom: 56 }}>
        <PrivacyControls state={state} token={token} onChanged={refresh} />
      </div>
    </>
  );
}

function RetakeButton({ token, onDone }: { token: string; onDone: () => void }) {
  const { dict: d } = useLang();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      data-testid="retake-photos"
      onClick={async () => {
        setBusy(true);
        photoStore.clear();
        await api('/api/case/retake', { method: 'POST', token }).catch(() => {});
        onDone();
      }}
    >
      {d.analysis.retakeBtn}
    </button>
  );
}

void fmt;
