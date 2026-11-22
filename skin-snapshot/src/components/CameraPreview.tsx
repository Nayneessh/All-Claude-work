'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PhotoSlot } from '../core/types';
import { CameraCapture, type Captured, type Unavailable } from './CameraCapture';
import { BlockedHelp } from './CaptureWizard';
import { useLang } from './LangProvider';
import { UploadCapture } from './UploadCapture';

const SLOTS: PhotoSlot[] = ['front', 'left', 'right'];

/**
 * A practice run of the guided camera. It needs no case and no server: the photos live in this page's memory
 * and are gone when the visitor leaves. It exists so the camera can be tried the moment a visitor wants to.
 */
export function CameraPreview() {
  const { lang, dict: d } = useLang();
  const [slot, setSlot] = useState<PhotoSlot>('front');
  const [shots, setShots] = useState<Partial<Record<PhotoSlot, string>>>({});
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [key, setKey] = useState(0);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const done = SLOTS.every((s) => shots[s]);
  const onCaptured = (s: PhotoSlot) => (c: Captured) => {
    const url = URL.createObjectURL(c.blob);
    urls.current.push(url);
    setShots((p) => ({ ...p, [s]: url }));
    const nextSlot = SLOTS.find((x) => x !== s && !shots[x]);
    if (nextSlot) setSlot(nextSlot);
  };
  const reset = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setShots({});
    setSlot('front');
    setKey((k) => k + 1);
  };

  if (done) {
    return (
      <div className="stack" data-testid="preview-done">
        <p className="notice calm" role="status">{d.camera.preview.done}</p>
        <p>{d.camera.preview.doneLead}</p>
        <div className="thumbs">
          {SLOTS.map((s) => (
            <div key={s} className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shots[s]} alt={d.camera.slots[s].name} />
              <div className="cap"><span>{d.camera.slots[s].short}</span></div>
            </div>
          ))}
        </div>
        <div className="btn-row">
          <Link className="btn" href={`/${lang}/start`}>{d.camera.preview.start}</Link>
          <button type="button" className="btn secondary" onClick={reset}>{d.camera.preview.again}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" data-testid="camera-preview">
      <p className="notice calm">{d.camera.preview.lead}</p>
      <div className="slot-tabs" aria-label={d.camera.title}>
        {SLOTS.map((s) => (
          <span key={s} className={`slot-tab${s === slot ? ' now' : shots[s] ? ' done' : ''}`} aria-current={s === slot ? 'step' : undefined}>{d.camera.slots[s].short}</span>
        ))}
      </div>
      <h2 style={{ fontSize: '1.7rem' }}>{d.camera.slots[slot].name}</h2>
      {unavailable && (
        <BlockedHelp why={unavailable} onRetry={() => { setUnavailable(null); setKey((k) => k + 1); }} />
      )}
      {unavailable ? (
        <UploadCapture key={`u-${slot}`} slot={slot} onCaptured={onCaptured(slot)} />
      ) : (
        <CameraCapture key={`${slot}-${key}`} slot={slot} onCaptured={onCaptured(slot)} onUnavailable={setUnavailable} />
      )}
    </div>
  );
}
