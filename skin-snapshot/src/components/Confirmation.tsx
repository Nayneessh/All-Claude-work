'use client';
import { useEffect, useState } from 'react';
import type { VisitorState } from '../server/service';
import { fmt } from '../i18n';
import { track } from '../lib/analytics';
import { isMobile } from '../lib/device';
import { useLang } from './LangProvider';

export function Confirmation({ state }: { state: VisitorState }) {
  const { lang, dict: d } = useLang();
  const b = state.booking!;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mobile, setMobile] = useState(true);
  useEffect(() => {
    setMobile(isMobile());
  }, []);
  useEffect(() => {
    if (b.whatsappUrl && !mobile) import('qrcode').then((Q) => Q.toDataURL(b.whatsappUrl!, { margin: 1, width: 440, color: { dark: '#243A31', light: '#FFFFFF' } })).then(setQr).catch(() => {});
  }, [b.whatsappUrl, mobile]);
  const copy = (key: string, v: string) => navigator.clipboard?.writeText(v).then(() => setCopied(key)).catch(() => {});
  const day = new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${b.day}T00:00:00Z`));
  return (
    <div className="container flow-wrap narrow" data-testid="confirmation">
      <p className="eyebrow">{d.confirm.status}: <span className="chip" data-testid="booking-status">{d.confirm.statuses[b.status as keyof typeof d.confirm.statuses] ?? b.status}</span></p>
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.confirm.title}</h1>
      <hr className="gold-rule" />
      <p className="lead">{fmt(d.confirm.lead, { name: b.firstName, code: state.code })}</p>
      <p>{d.confirm.next}</p>

      <div className="card accent stack">
        <h3>{d.confirm.messageLabel}</h3>
        <div className="copy-box">
          <code data-testid="wa-message">{b.message}</code>
          <button type="button" className="btn secondary small" onClick={() => copy('m', b.message)}>{copied === 'm' ? d.common.copied : d.confirm.copyMessage}</button>
        </div>
        {b.whatsappUrl ? (
          <>
            <div className="btn-row">
              <a className="btn" href={b.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_opened')} data-testid="open-whatsapp">{d.confirm.open}</a>
            </div>
            {!mobile && qr && (
              <div>
                <p className="help">{d.confirm.onLaptop}</p>
                <div className="qr"><img src={qr} alt="QR code" data-testid="wa-qr" /></div>
              </div>
            )}
            {b.whatsappNumber && !mobile && (
              <div className="copy-box">
                <code>{d.confirm.number}: {b.whatsappNumber}</code>
                <button type="button" className="btn secondary small" onClick={() => copy('n', b.whatsappNumber!)}>{copied === 'n' ? d.common.copied : d.confirm.copyNumber}</button>
              </div>
            )}
          </>
        ) : (
          <p className="notice" data-testid="wa-not-configured">{d.confirm.notConfigured}</p>
        )}
      </div>
      <div className="card flat" style={{ marginTop: 16 }}>
        <h3>{d.confirm.summary}</h3>
        <p style={{ marginBottom: 4 }}>{d.confirm.preferred}: {day}, {d.booking.windows[b.window as keyof typeof d.booking.windows]}, {d.booking.methods[b.method as keyof typeof d.booking.methods]}</p>
        <p style={{ marginBottom: 0 }}>{fmt(d.confirm.promise, { promise: state.settings.servicePromise })}</p>
      </div>
      <p className="notice calm small" style={{ marginTop: 16 }}>{d.confirm.moreImages}</p>
    </div>
  );
}
