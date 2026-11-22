'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { allPass, primaryInstruction, type CheckResult } from '../core/pose';
import { THRESHOLDS } from '../core/vision-metrics';
import type { PhotoSlot } from '../core/types';
import { fmt } from '../i18n';
import { track } from '../lib/analytics';
import { hasGetUserMedia } from '../lib/device';
import { analyseSource, loadFaceModel } from '../lib/face';
import { encodeJpeg } from '../lib/imaging';
import { useLang } from './LangProvider';
import { PhotoReview } from './PhotoReview';

export interface Captured {
  blob: Blob;
  width: number;
  height: number;
  checks: Record<string, string | number | boolean | null>;
}

export type Unavailable = 'denied' | 'no_camera' | 'unsupported';

export function CameraCapture({ slot, onCaptured, onUnavailable }: { slot: PhotoSlot; onCaptured: (c: Captured) => void; onUnavailable: (why: Unavailable) => void }) {
  const { dict: d } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>(slot === 'closeup' ? 'user' : 'user');
  const [phase, setPhase] = useState<'starting' | 'live' | 'review'>('starting');
  const [guidance, setGuidance] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [results, setResults] = useState<CheckResult[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [still, setStill] = useState<{ url: string; captured: Captured; results: CheckResult[] } | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef({ stable: 0, pass: false, count: null as number | null, timer: 0 as unknown as ReturnType<typeof setInterval>, centre: null as null | { cx: number; cy: number }, lastMetrics: {} as Record<string, number> });

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Face model: load in the background; the camera works without it (manual shutter, checks after capture).
  useEffect(() => {
    let alive = true;
    loadFaceModel().then(() => alive && setGuidance('ready')).catch(() => alive && setGuidance('failed'));
    return () => {
      alive = false;
    };
  }, []);

  // Camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      stopStream();
      setPhase('starting');
      if (!hasGetUserMedia()) return onUnavailable('unsupported');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        v.muted = true;
        await v.play().catch(() => {});
        setPhase('live');
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          setCanSwitch(devs.filter((x) => x.kind === 'videoinput').length > 1);
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException).name;
        onUnavailable(name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : 'no_camera');
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    clearInterval(live.current.timer);
    live.current.count = null;
    setCount(null);
    try {
      const enc = await encodeJpeg(v, v.videoWidth, v.videoHeight);
      let res: CheckResult[] = [];
      let metrics: Record<string, number> = {};
      if (guidance === 'ready') {
        const c = document.createElement('canvas');
        c.width = Math.min(1280, v.videoWidth);
        c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        const a = await analyseSource(c, slot, { live: false });
        res = a.results;
        metrics = { blur: a.metrics.blur, p95: a.metrics.p95 };
      }
      const checks: Captured['checks'] = { source: 'camera', guidance: guidance === 'ready', ...metrics };
      setStill({ url: URL.createObjectURL(enc.blob), captured: { blob: enc.blob, width: enc.width, height: enc.height, checks }, results: res });
      setPhase('review');
    } finally {
      setBusy(false);
    }
  }, [guidance, slot]);

  // Live guidance loop and auto-capture countdown
  useEffect(() => {
    if (phase !== 'live' || guidance !== 'ready') return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const cancelCountdown = () => {
      clearInterval(live.current.timer);
      live.current.count = null;
      setCount(null);
    };
    const startCountdown = () => {
      live.current.count = THRESHOLDS.countdownSeconds;
      setCount(live.current.count);
      live.current.timer = setInterval(() => {
        if (!live.current.pass) return cancelCountdown();
        const n = (live.current.count ?? 1) - 1;
        if (n <= 0) {
          clearInterval(live.current.timer);
          void capture();
        } else {
          live.current.count = n;
          setCount(n);
        }
      }, 1000);
    };
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          const a = await analyseSource(v, slot, { live: true, prevCentre: live.current.centre });
          if (!alive) return;
          live.current.centre = a.box ? { cx: a.box.cx, cy: a.box.cy } : null;
          setResults(a.results);
          const pass = allPass(a.results);
          live.current.pass = pass;
          if (pass) {
            live.current.stable++;
            if (live.current.stable >= THRESHOLDS.stableFrames && live.current.count === null) startCountdown();
          } else {
            live.current.stable = 0;
            if (live.current.count !== null) cancelCountdown();
          }
        } catch {
          /* skip a frame */
        }
      }
      t = setTimeout(tick, 110);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(live.current.timer);
      live.current.count = null;
      live.current.stable = 0;
    };
  }, [phase, guidance, slot, capture]);

  const retake = () => {
    if (still) URL.revokeObjectURL(still.url);
    setStill(null);
    setResults([]);
    live.current.stable = 0;
    setPhase('live');
    track('retake');
  };

  if (phase === 'review' && still) {
    return (
      <PhotoReview
        url={still.url}
        results={still.results}
        busy={busy}
        onRetake={retake}
        onUse={(override) => {
          const c = still.captured;
          onCaptured({ ...c, checks: { ...c.checks, filter_override: override } });
          URL.revokeObjectURL(still.url);
          setStill(null);
        }}
      />
    );
  }

  const instr = primaryInstruction(results);
  const pass = guidance === 'ready' && results.length > 0 && allPass(results);
  const msgs = d.camera.msg as Record<string, string>;
  let hint: string;
  if (phase === 'starting') hint = msgs.loading!;
  else if (guidance === 'loading') hint = msgs.loadingModel!;
  else if (guidance === 'failed') hint = d.camera.modelFailed;
  else if (count !== null) hint = fmt(d.camera.countdown, { n: count });
  else if (pass) hint = msgs.ready!;
  else if (instr) hint = msgs[instr.code] ?? '';
  else hint = d.camera.slots[slot].how;

  return (
    <div data-testid="camera" className="stack">
      <div className="camera-shell">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted autoPlay className={facing === 'user' ? 'mirror' : ''} data-testid="video" />
        <div className={`camera-overlay${pass ? ' pass' : ''}`} aria-hidden="true">
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <div
              data-testid="oval"
              data-pass={pass ? '1' : '0'}
              style={{
                height: '68%', aspectRatio: '0.78', borderRadius: '50%', marginTop: '-6%',
                border: `${pass ? 7 : 5}px ${pass ? 'solid' : 'dashed'} ${pass ? '#9CC4AE' : '#F5E6C8'}`,
                boxShadow: '0 0 0 999px rgba(27,42,35,0.42)', background: pass ? 'rgba(74,107,93,0.18)' : 'transparent',
              }}
            />
          </div>
        </div>
        <div className="camera-top"><span className="chip">{d.camera.slots[slot].name}</span></div>
        {count !== null && <div className="countdown" aria-live="assertive" data-testid="countdown">{count}</div>}
        <div className={`camera-hint${pass ? ' pass' : ''}`} role="status" aria-live="polite" data-testid="camera-hint">{hint}</div>
      </div>
      <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{d.camera.slots[slot].how}</p>
      <div className="shutter-row">
        {canSwitch && <button type="button" className="btn secondary small" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>{d.camera.switchCam}</button>}
        <button type="button" className="shutter" aria-label={d.camera.take} onClick={() => void capture()} disabled={phase !== 'live' || busy} data-testid="shutter" />
      </div>
    </div>
  );
}
