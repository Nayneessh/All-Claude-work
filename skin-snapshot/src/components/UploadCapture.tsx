'use client';
import { useRef, useState } from 'react';
import type { PhotoSlot } from '../core/types';
import type { CheckResult } from '../core/pose';
import { track } from '../lib/analytics';
import { analyseSource, loadFaceModel } from '../lib/face';
import { bitmapFromFile, encodeJpeg } from '../lib/imaging';
import { useLang } from './LangProvider';
import { PhotoReview } from './PhotoReview';
import type { Captured } from './CameraCapture';

/** Upload fallback. The photo goes through the same checks as the live camera before it can be used. */
export function UploadCapture({ slot, onCaptured }: { slot: PhotoSlot; onCaptured: (c: Captured) => void }) {
  const { dict: d } = useLang();
  const [busy, setBusy] = useState(false);
  const [still, setStill] = useState<{ url: string; captured: Captured; results: CheckResult[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    track('upload_fallback_used');
    try {
      const bmp = await bitmapFromFile(f);
      const enc = await encodeJpeg(bmp, bmp.width, bmp.height);
      let results: CheckResult[] = [];
      let metrics: Record<string, number> = {};
      try {
        await loadFaceModel();
        const c = document.createElement('canvas');
        c.width = Math.min(1280, bmp.width);
        c.height = Math.round((c.width * bmp.height) / bmp.width);
        c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
        const a = await analyseSource(c, slot, { live: false });
        results = a.results;
        metrics = { blur: a.metrics.blur, p95: a.metrics.p95 };
      } catch {
        /* the server still checks sharpness and light */
      }
      setStill({ url: URL.createObjectURL(enc.blob), captured: { blob: enc.blob, width: enc.width, height: enc.height, checks: { source: 'upload', ...metrics } }, results });
    } catch {
      setErr(d.camera.rejected.unreadable);
    } finally {
      setBusy(false);
      if (gallery.current) gallery.current.value = '';
      if (camera.current) camera.current.value = '';
    }
  };

  if (still) {
    return (
      <PhotoReview
        url={still.url}
        results={still.results}
        onRetake={() => { URL.revokeObjectURL(still.url); setStill(null); }}
        onUse={(o) => { onCaptured({ ...still.captured, checks: { ...still.captured.checks, filter_override: o } }); setStill(null); }}
      />
    );
  }
  return (
    <div className="card" data-testid="upload-capture">
      <h3>{d.camera.slots[slot].name}</h3>
      <p>{d.camera.slots[slot].how}</p>
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => gallery.current?.click()} data-testid="choose-file">{d.camera.chooseFile}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => camera.current?.click()}>{d.camera.takeWithPhone}</button>
      </div>
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} data-testid="file-input" />
      <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {busy && <p className="help" role="status">{d.common.loading}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
  );
}
