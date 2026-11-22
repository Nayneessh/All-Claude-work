'use client';
import { useEffect, useRef, useState } from 'react';
import { REQUIRED_SLOTS } from '../core/types';
import { ApiError, api, errorText, sleep } from '../lib/api';
import { useLang } from './LangProvider';

/** Continue on a phone: a short-lived, single-purpose link in a QR code. Photos never travel in the QR. */
export function PhoneQr({ token, onDone, onCancel }: { token: string; onDone: () => void; onCancel: () => void }) {
  const { lang, dict: d } = useLang();
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const s = await api<{ token: string }>('/api/case/capture-session', { method: 'POST', token });
        const url = `${location.origin}/${lang}/continue/${s.token}`;
        setLink(url);
        const QR = await import('qrcode');
        setQr(await QR.toDataURL(url, { margin: 1, width: 440, color: { dark: '#243A31', light: '#FFFFFF' } }));
        // Wait for the phone to finish uploading the required photos.
        while (alive.current) {
          await sleep(2500);
          const st = await api<{ photos: { slot: string; status: string }[] }>('/api/case', { token }).catch(() => null);
          if (st && REQUIRED_SLOTS.every((s) => st.photos.some((p) => p.slot === s && p.status === 'stored'))) {
            if (alive.current) onDone();
            return;
          }
        }
      } catch (e) {
        if (alive.current) setErr(errorText(e, d.errors));
        if (e instanceof ApiError) return;
      }
    })();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card stack" data-testid="phone-qr">
      <h2 style={{ fontSize: '1.6rem' }}>{d.camera.phoneTitle}</h2>
      <p>{d.camera.phoneLead}</p>
      {qr ? <div className="qr"><img src={qr} alt="QR code" /></div> : !err && <div className="spinner" role="status" aria-label={d.common.loading} />}
      {link && (
        <>
          <p className="help" style={{ margin: 0 }}>{d.camera.phoneLink}</p>
          <div className="copy-box">
            <code data-testid="phone-link">{link}</code>
            <button type="button" className="btn secondary small" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {})}>{copied ? d.common.copied : d.common.copy}</button>
          </div>
          <p role="status" className="muted" style={{ margin: 0 }}>{d.camera.phoneWaiting}</p>
        </>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
      <div className="btn-row"><button type="button" className="btn secondary" onClick={onCancel}>{d.common.cancel}</button></div>
    </div>
  );
}
