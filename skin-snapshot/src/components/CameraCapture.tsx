'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { allPass, primaryInstruction, type CheckResult } from '../core/pose';
import { THRESHOLDS } from '../core/vision-metrics';
import type { PhotoSlot } from '../core/types';
import { fmt } from '../i18n';
import { track } from '../lib/analytics';
import { hasGetUserMedia } from '../lib/device';
import { analyseSource, loadFaceModel, reloadFaceModelOnCpu } from '../lib/face';
import { encodeJpeg } from '../lib/imaging';
import { useLang } from './LangProvider';
import { PhotoReview } from './PhotoReview';

export interface Captured {
  blob: Blob;
  width: number;
  height: number;
  checks: Record<string, string | number | boolean | null>;
}

export type Unavailable = 'denied' | 'no_camera' | 'in_use' | 'unsupported';

const MODEL_GIVE_UP_MS = 45_000;
const NO_RESULT_GIVE_UP_MS = 12_000;
const MAX_RESTARTS = 3;

/**
 * Opens the camera. Starts with the settings we would like, then relaxes them: some phones refuse a size or a
 * facing mode they cannot match exactly, and that must not look like "no camera".
 */
async function openStream(facing: 'user' | 'environment'): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false },
    { video: { facingMode: { ideal: facing } }, audio: false },
    { video: true, audio: false },
  ];
  let last: unknown;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      last = e;
      const n = (e as DOMException).name;
      // Permission refused or no camera at all: asking again with other settings will not change that.
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError' || n === 'NotFoundError' || n === 'DevicesNotFoundError') throw e;
    }
  }
  throw last;
}

function whyUnavailable(e: unknown): Unavailable {
  const n = (e as DOMException)?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'denied';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'in_use';
  return 'no_camera';
}

export function CameraCapture({ slot, onCaptured, onUnavailable }: { slot: PhotoSlot; onCaptured: (c: Captured) => void; onUnavailable: (why: Unavailable) => void }) {
  const { dict: d } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const restarts = useRef(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [restart, setRestart] = useState(0);
  const [phase, setPhase] = useState<'starting' | 'live' | 'review'>('starting');
  const [needsTap, setNeedsTap] = useState(false);
  const [guidance, setGuidance] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [epoch, setEpoch] = useState(0);
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
    const giveUp = setTimeout(() => alive && setGuidance((g) => (g === 'loading' ? 'failed' : g)), MODEL_GIVE_UP_MS);
    loadFaceModel()
      .then(() => alive && setGuidance((g) => (g === 'failed' ? g : 'ready')))
      .catch(() => alive && setGuidance('failed'));
    return () => {
      alive = false;
      clearTimeout(giveUp);
    };
  }, []);

  // Camera. The <video> element stays mounted for the whole life of this component (it is only hidden while a
  // photo is being reviewed), so a retake never leaves it without a picture.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      stopStream();
      setPhase('starting');
      setNeedsTap(false);
      if (!hasGetUserMedia()) return onUnavailable('unsupported');
      try {
        const stream = await openStream(facing);
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        // Phones can stop the camera on their own (a call, another app, the screen locking).
        stream.getVideoTracks().forEach((t) =>
          t.addEventListener('ended', () => {
            if (cancelled || streamRef.current !== stream) return;
            if (restarts.current >= MAX_RESTARTS) return onUnavailable('in_use');
            restarts.current++;
            setRestart((n) => n + 1);
          }),
        );
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.muted = true;
        v.setAttribute('playsinline', '');
        // Some phones (low-power mode, strict autoplay rules) will not start the picture until the visitor taps.
        const played = await v.play().then(() => true).catch(() => false);
        if (cancelled) return;
        setPhase('live');
        if (!played || v.paused) setNeedsTap(true);
        else {
          // Played, but make sure frames really arrive; if not, ask for a tap rather than showing a black box.
          setTimeout(() => {
            if (!cancelled && v.videoWidth === 0) setNeedsTap(true);
          }, 4000);
        }
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setCanSwitch(devs.filter((x) => x.kind === 'videoinput').length > 1);
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (cancelled) return;
        onUnavailable(whyUnavailable(e));
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, restart]);

  // Coming back to the tab or app: resume the picture, or restart the camera if the phone stopped it.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const v = videoRef.current;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!v) return;
      if (track && track.readyState === 'ended') setRestart((n) => n + 1);
      else if (v.paused && v.srcObject) void v.play().catch(() => setNeedsTap(true));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const tapToStart = () => {
    const v = videoRef.current;
    if (!v) return;
    void v.play().then(() => setNeedsTap(false)).catch(() => setRestart((n) => n + 1));
  };

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
        try {
          const c = document.createElement('canvas');
          c.width = Math.min(1280, v.videoWidth);
          c.height = Math.round((c.width * v.videoHeight) / v.videoWidth);
          c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
          const a = await analyseSource(c, slot, { live: false });
          res = a.results;
          metrics = { blur: a.metrics.blur, p95: a.metrics.p95 };
        } catch {
          /* the photo can still be used; the server checks it again */
        }
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
    let fails = 0;
    let okFrames = 0;
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
    // If live checks stop working on this device, try once on the processor, then fall back to the manual shutter.
    let degraded = false;
    const degrade = async () => {
      if (degraded || !alive) return;
      degraded = true;
      try {
        const switched = await reloadFaceModelOnCpu();
        if (!alive) return;
        if (switched) return setEpoch((n) => n + 1);
      } catch {
        /* fall through */
      }
      if (alive) setGuidance('failed');
    };
    // Only counts time while the picture is really playing (not while the visitor has yet to tap "start").
    let watchdog: ReturnType<typeof setTimeout>;
    const arm = () => {
      watchdog = setTimeout(() => {
        if (!alive || okFrames > 0) return;
        const v = videoRef.current;
        if (!v || v.paused || v.videoWidth === 0) return arm();
        void degrade();
      }, NO_RESULT_GIVE_UP_MS);
    };
    arm();
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth > 0 && !v.paused) {
        try {
          const a = await analyseSource(v, slot, { live: true, prevCentre: live.current.centre });
          if (!alive) return;
          fails = 0;
          okFrames++;
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
          if (++fails >= 8) return void degrade();
        }
      }
      t = setTimeout(tick, 110);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
      clearTimeout(watchdog);
      clearInterval(live.current.timer);
      live.current.count = null;
      live.current.stable = 0;
    };
  }, [phase, guidance, slot, capture, epoch]);

  const retake = () => {
    if (still) URL.revokeObjectURL(still.url);
    setStill(null);
    setResults([]);
    live.current.stable = 0;
    setPhase('live');
    const v = videoRef.current;
    if (v?.paused && v.srcObject) void v.play().catch(() => setNeedsTap(true));
    track('retake');
  };

  const reviewing = phase === 'review' && still;
  const instr = primaryInstruction(results);
  const pass = guidance === 'ready' && results.length > 0 && allPass(results);
  const msgs = d.camera.msg as Record<string, string>;
  let hint: string;
  if (phase === 'starting') hint = msgs.loading!;
  else if (needsTap) hint = d.camera.tapStart;
  else if (guidance === 'loading') hint = msgs.loadingModel!;
  else if (guidance === 'failed') hint = d.camera.modelFailed;
  else if (count !== null) hint = fmt(d.camera.countdown, { n: count });
  else if (pass) hint = msgs.ready!;
  else if (instr) hint = msgs[instr.code] ?? '';
  else hint = d.camera.slots[slot].how;

  return (
    <>
      {reviewing && (
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
      )}
      <div data-testid="camera" className="stack" style={reviewing ? { display: 'none' } : undefined}>
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
          {needsTap && (
            <button type="button" className="btn gold camera-tap" onClick={tapToStart} data-testid="camera-tap">{d.camera.tapStart}</button>
          )}
          <div className={`camera-hint${pass ? ' pass' : ''}`} role="status" aria-live="polite" data-testid="camera-hint">{hint}</div>
        </div>
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{d.camera.slots[slot].how}</p>
        <div className="shutter-row">
          {canSwitch && <button type="button" className="btn secondary small" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>{d.camera.switchCam}</button>}
          <button type="button" className="shutter" aria-label={d.camera.take} onClick={() => void capture()} disabled={phase !== 'live' || busy || needsTap} data-testid="shutter" />
        </div>
      </div>
    </>
  );
}
