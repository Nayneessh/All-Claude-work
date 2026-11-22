'use client';
import { useRef, useState } from 'react';
import { allPass } from '../core/pose';
import { browserFamily, hasGetUserMedia, inAppBrowser, platform, ua } from '../lib/device';
import { analyseSource, loadFaceModel } from '../lib/face';

interface Report {
  [k: string]: string | number | boolean | null;
}

/** A diagnostics page for real-device testing: reports camera, model speed and which checks fire. */
export function CameraSelfTest() {
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const run = async () => {
    setRunning(true);
    const r: Report = { userAgent: ua(), platform: platform(), browserFamily: browserFamily(), inAppBrowser: inAppBrowser(), secureContext: typeof isSecureContext === 'undefined' ? null : isSecureContext, getUserMedia: hasGetUserMedia(), screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`, connection: (navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null };
    setReport({ ...r });
    try {
      const perm = await navigator.permissions?.query({ name: 'camera' as PermissionName }).catch(() => null);
      r.cameraPermission = perm?.state ?? 'unknown';
    } catch {
      r.cameraPermission = 'unknown';
    }
    const t0 = performance.now();
    try {
      await loadFaceModel();
      r.modelLoadMs = Math.round(performance.now() - t0);
    } catch (e) {
      r.modelError = String((e as Error).message ?? e);
    }
    setReport({ ...r });
    if (hasGetUserMedia()) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        const v = videoRef.current!;
        v.srcObject = s;
        await v.play();
        const tr = s.getVideoTracks()[0]!;
        const st = tr.getSettings();
        r.cameraResolution = `${st.width}x${st.height}@${Math.round(st.frameRate ?? 0)}`;
        r.cameraLabel = tr.label;
        if (r.modelLoadMs !== undefined) {
          let frames = 0, withFace = 0, passes = 0, ms = 0;
          const codes = new Map<string, number>();
          const end = performance.now() + 6000;
          while (performance.now() < end) {
            const a0 = performance.now();
            const a = await analyseSource(v, 'front', { live: true });
            ms += performance.now() - a0;
            frames++;
            if (a.faces > 0) withFace++;
            if (allPass(a.results)) passes++;
            for (const c of a.results.filter((x) => !x.ok)) codes.set(c.code, (codes.get(c.code) ?? 0) + 1);
            await new Promise((x) => setTimeout(x, 60));
          }
          r.frames = frames;
          r.avgInferenceMs = Math.round(ms / Math.max(1, frames));
          r.facesDetectedPct = Math.round((100 * withFace) / Math.max(1, frames));
          r.allChecksPassPct = Math.round((100 * passes) / Math.max(1, frames));
          r.topProblems = [...codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}:${n}`).join(' ');
        }
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        r.cameraError = (e as DOMException).name;
      }
    }
    setReport({ ...r });
    setRunning(false);
  };

  const text = report ? Object.entries(report).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
  return (
    <div className="stack">
      <p>This page checks your camera, the on-device face model and how fast it runs. No photos are saved or uploaded. Run it on each phone and laptop you test with, then copy the result.</p>
      <div className="camera-shell" style={{ maxWidth: 420 }}><video ref={videoRef} playsInline muted className="mirror" /></div>
      <div className="btn-row">
        <button className="btn" onClick={() => void run()} disabled={running} data-testid="selftest-run">{running ? 'Running… look at the camera' : 'Run camera self-test'}</button>
        {report && <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})}>{copied ? 'Copied' : 'Copy result'}</button>}
      </div>
      {report && <pre className="card flat" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.82rem' }} data-testid="selftest-report">{text}</pre>}
    </div>
  );
}
