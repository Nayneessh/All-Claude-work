'use client';
import { useEffect, useMemo, useState } from 'react';
import { PHOTO_SLOTS, REQUIRED_SLOTS, type PathId, type PhotoSlot } from '../core/types';
import { fmt } from '../i18n';
import { ApiError, api, putWithProgress, withRetry } from '../lib/api';
import { track } from '../lib/analytics';
import { browserFamily, chromeIntentUrl, inAppBrowser, platform } from '../lib/device';
import { photoStore, useHeldPhotos } from '../lib/photostore';
import { CameraCapture, type Captured, type Unavailable } from './CameraCapture';
import { useLang } from './LangProvider';
import { PhoneQr } from './PhoneQr';
import { UploadCapture } from './UploadCapture';

type Stage = 'capture' | 'confirm' | 'uploading' | 'phone';

function InAppNotice({ onStay }: { onStay: () => void }) {
  const { dict: d } = useLang();
  const [copied, setCopied] = useState(false);
  const android = platform() === 'android';
  return (
    <div className="notice" role="alert" data-testid="inapp-notice">
      <h3>{d.camera.inApp.title}</h3>
      <p>{d.camera.inApp.lead}</p>
      <div className="btn-row">
        {android && <a className="btn" href={chromeIntentUrl(location.href)}>{d.camera.inApp.open}</a>}
        <button type="button" className="btn secondary" onClick={() => navigator.clipboard?.writeText(location.href).then(() => setCopied(true)).catch(() => {})}>{copied ? d.common.copied : d.camera.inApp.copyLink}</button>
        <button type="button" className="btn secondary" onClick={onStay}>{d.camera.inApp.stay}</button>
      </div>
    </div>
  );
}

function BlockedHelp({ why, onRetry }: { why: Unavailable; onRetry: () => void }) {
  const { dict: d } = useLang();
  const steps = d.camera.blocked.steps;
  const fam = browserFamily();
  const list = fam === 'chrome-android' ? steps.chromeAndroid : fam === 'safari-ios' ? steps.safariIos : fam === 'desktop' ? steps.desktop : steps.other;
  if (why === 'denied') {
    return (
      <div className="card accent" data-testid="camera-blocked">
        <h3>{d.camera.blocked.title}</h3>
        <p>{d.camera.blocked.lead}</p>
        <ol>{list.map((s) => <li key={s}>{s}</li>)}</ol>
        <button type="button" className="btn secondary small" onClick={onRetry}>{d.common.retry}</button>
      </div>
    );
  }
  const t = why === 'no_camera' ? d.camera.noCamera : d.camera.unsupported;
  return (
    <div className="card accent" data-testid="camera-unavailable">
      <h3>{t.title}</h3>
      <p style={{ marginBottom: 0 }}>{t.lead}</p>
    </div>
  );
}

export function CaptureWizard({ token, mode, path, onComplete }: { token: string; mode: 'full' | 'capture'; path: PathId; onComplete: () => void }) {
  const { dict: d } = useLang();
  const slots: PhotoSlot[] = useMemo(() => (path === 'maintenance' ? ['front', 'left', 'right'] : ['front', 'left', 'right', 'closeup']), [path]);
  const held = useHeldPhotos();
  const [slot, setSlot] = useState<PhotoSlot>(() => slots.find((s) => !photoStore.get(s)) ?? slots[0]!);
  const [stage, setStage] = useState<Stage>(() => (REQUIRED_SLOTS.every((s) => photoStore.get(s)) ? 'confirm' : 'capture'));
  const [method, setMethod] = useState<'camera' | 'upload'>('camera');
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [inApp, setInApp] = useState<string | null>(null);
  const [dismissedInApp, setDismissedInApp] = useState(false);
  const [progress, setProgress] = useState<{ n: number; total: number; frac: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const auth = mode === 'full' ? { token } : { capture: token };

  useEffect(() => {
    const a = inAppBrowser();
    setInApp(a);
    if (a) track('inapp_browser_detected', { reason: 'in_app' });
  }, []);

  const next = (after: PhotoSlot) => {
    const order = slots;
    const remaining = order.filter((s) => s !== after && !photoStore.get(s));
    const requiredMissing = remaining.find((s) => REQUIRED_SLOTS.includes(s));
    if (requiredMissing) return setSlot(requiredMissing);
    if (remaining.length) return setSlot(remaining[0]!); // optional close-up
    setStage('confirm');
  };

  const onCaptured = (s: PhotoSlot) => (c: Captured) => {
    photoStore.set(s, { blob: c.blob, width: c.width, height: c.height, checks: c.checks });
    setProblem(null);
    next(s);
  };

  const onUnavailable = (why: Unavailable) => {
    setUnavailable(why);
    setMethod('upload');
    track(why === 'denied' ? 'camera_blocked' : 'upload_fallback_used', { reason: why === 'denied' ? 'denied' : 'no_camera' });
  };

  const uploadAll = async () => {
    setStage('uploading');
    setProblem(null);
    setSlow(false);
    const ordered = slots.filter((s) => photoStore.get(s));
    try {
      for (let i = 0; i < ordered.length; i++) {
        const s = ordered[i]!;
        const p = photoStore.get(s)!;
        setProgress({ n: i + 1, total: ordered.length, frac: 0 });
        const slowTimer = setTimeout(() => setSlow(true), 12_000);
        try {
          const done = await withRetry(async () => {
            const init = await api<{ photoId: string; uploadUrl: string; headers: Record<string, string> }>('/api/case/photos', { ...auth, body: { slot: s, contentType: 'image/jpeg', size: p.blob.size, width: p.width, height: p.height, checks: p.checks } });
            await putWithProgress(init.uploadUrl, p.blob, (f) => setProgress({ n: i + 1, total: ordered.length, frac: f }), init.headers);
            return api<{ ok: boolean; reason?: string }>(`/api/case/photos/${init.photoId}/complete`, { method: 'POST', ...auth });
          });
          if (!done.ok) {
            photoStore.remove(s);
            setProblem((d.camera.rejected as Record<string, string>)[done.reason ?? 'unreadable'] ?? d.camera.rejected.unreadable);
            setSlot(s);
            setStage('capture');
            setMethod('camera');
            return;
          }
        } finally {
          clearTimeout(slowTimer);
        }
      }
      onComplete();
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 0 ? d.camera.slowConnection : d.camera.uploadFailed);
      setStage('confirm');
    }
  };

  if (stage === 'phone') {
    return <PhoneQr token={token} onDone={onComplete} onCancel={() => setStage('capture')} />;
  }

  if (stage === 'uploading') {
    const pr = progress;
    return (
      <div className="card stack" data-testid="uploading" role="status" aria-live="polite">
        <h2 style={{ fontSize: '1.6rem' }}>{pr ? fmt(d.camera.uploading, { n: pr.n, total: pr.total }) : d.common.loading}</h2>
        <div className="bar" aria-hidden="true"><i style={{ width: `${Math.round(((pr ? (pr.n - 1 + pr.frac) / pr.total : 0) as number) * 100)}%` }} /></div>
        {slow && <p className="muted">{d.camera.slowConnection}</p>}
      </div>
    );
  }

  if (stage === 'confirm') {
    return (
      <div className="stack" data-testid="confirm-photos">
        <h2 style={{ fontSize: '1.8rem' }}>{d.camera.confirmTitle}</h2>
        <p className="lead">{d.camera.confirmLead}</p>
        <div className="thumbs">
          {PHOTO_SLOTS.filter((s) => held[s]).map((s) => (
            <div key={s} className="thumb" data-testid={`thumb-${s}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={held[s]!.url} alt={d.camera.slots[s].name} />
              <div className="cap">
                <span>{d.camera.slots[s].short}</span>
                <button type="button" className="btn secondary small" onClick={() => { setSlot(s); setStage('capture'); }}>{d.camera.replace}</button>
              </div>
            </div>
          ))}
        </div>
        {problem && <p className="error-text" role="alert">{problem}</p>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => void uploadAll()} data-testid="confirm-upload">{d.camera.confirm}</button>
        </div>
      </div>
    );
  }

  // capture
  const showInApp = inApp && !dismissedInApp && mode === 'full';
  return (
    <div className="stack" data-testid="capture">
      {showInApp && <InAppNotice onStay={() => setDismissedInApp(true)} />}
      <div className="slot-tabs" aria-label={d.camera.title}>
        {slots.map((s) => (
          <span key={s} className={`slot-tab${s === slot ? ' now' : held[s] ? ' done' : ''}`} aria-current={s === slot ? 'step' : undefined}>
            {d.camera.slots[s].short}{s === 'closeup' ? ` (${d.camera.optional})` : ''}
          </span>
        ))}
      </div>
      <h2 style={{ fontSize: '1.7rem' }}>{d.camera.slots[slot].name}</h2>
      {problem && <p className="error-text" role="alert">{problem}</p>}
      {unavailable && <BlockedHelp why={unavailable} onRetry={() => { setUnavailable(null); setMethod('camera'); setCameraKey((k) => k + 1); }} />}
      {method === 'camera' && !unavailable ? (
        <CameraCapture key={`${slot}-${cameraKey}`} slot={slot} onCaptured={onCaptured(slot)} onUnavailable={onUnavailable} />
      ) : (
        <UploadCapture key={`u-${slot}`} slot={slot} onCaptured={onCaptured(slot)} />
      )}
      <div className="btn-row">
        {method === 'camera' && !unavailable && (
          <button type="button" className="btn secondary small" onClick={() => { setMethod('upload'); track('upload_fallback_used'); }} data-testid="use-upload">{d.camera.uploadInstead}</button>
        )}
        {method === 'upload' && !unavailable && (
          <button type="button" className="btn secondary small" onClick={() => { setMethod('camera'); setCameraKey((k) => k + 1); }}>{d.camera.title}</button>
        )}
        {mode === 'full' && (
          <button type="button" className="btn secondary small" onClick={() => setStage('phone')} data-testid="continue-phone">{d.camera.continuePhone}</button>
        )}
        {slot === 'closeup' && (
          <button type="button" className="btn secondary small" onClick={() => setStage('confirm')} data-testid="skip-closeup">{d.camera.skipCloseup}</button>
        )}
      </div>
    </div>
  );
}
