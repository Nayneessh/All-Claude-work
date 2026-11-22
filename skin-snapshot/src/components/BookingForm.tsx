'use client';
import { useMemo, useState } from 'react';
import { METHODS, TIME_WINDOWS, bookableDays } from '../core/booking';
import { ApiError, api, errorText } from '../lib/api';
import { track } from '../lib/analytics';
import { getBotToken } from '../lib/pow';
import { fmt } from '../i18n';
import { useLang } from './LangProvider';

export function BookingForm({ token, promise, onDone, onCancel }: { token: string; promise: string; onDone: () => void; onCancel: () => void }) {
  const { lang, dict: d } = useLang();
  const days = useMemo(() => bookableDays(), []);
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [day, setDay] = useState(days[0]!);
  const [window_, setWindow] = useState<(typeof TIME_WINDOWS)[number]>('morning');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('whatsapp_call');
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [top, setTop] = useState<string | null>(null);
  const fmtDay = (iso: string) => new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!name.trim()) er.name = d.booking.errors.name;
    if (!/^\+?[\d\s()-]{7,20}$/.test(whatsapp.trim())) er.whatsapp = d.booking.errors.whatsapp;
    if (!consent) er.consent = d.booking.errors.consent;
    setErrs(er);
    setTop(null);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const botToken = await getBotToken();
      await api('/api/case/booking', { token, body: { name: name.trim(), whatsapp: whatsapp.trim(), day, window: window_, method, contactConsent: true, note: note.trim(), botToken, lang } });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_booking' && err.fields) {
        const m: Record<string, string> = {};
        for (const f of err.fields) m[f] = (d.booking.errors as Record<string, string>)[f] ?? d.booking.errors.generic;
        setErrs(m);
      } else if (err instanceof ApiError && err.code === 'rate_limited') setTop(d.booking.errors.rate);
      else if (err instanceof ApiError && err.code === 'bot_check_failed') setTop(d.booking.errors.bot);
      else setTop(errorText(err, d.errors));
      setBusy(false);
    }
  };

  return (
    <form className="container flow-wrap narrow" onSubmit={submit} noValidate data-testid="booking-form" onFocus={() => track('booking_started')}>
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.booking.title}</h1>
      <hr className="gold-rule" />
      <p className="lead">{d.booking.lead}</p>
      <p className="notice calm">{fmt(d.booking.promise, { promise })}</p>

      <div className={`field${errs.name ? ' invalid' : ''}`}>
        <label htmlFor="b-name">{d.booking.name}</label>
        <input id="b-name" type="text" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby="b-name-h" aria-invalid={!!errs.name} data-testid="b-name" />
        <span className="help" id="b-name-h" style={{ margin: 0 }}>{d.booking.nameHelp}</span>
        {errs.name && <span className="error-text" role="alert">{errs.name}</span>}
      </div>
      <div className={`field${errs.whatsapp ? ' invalid' : ''}`}>
        <label htmlFor="b-wa">{d.booking.whatsapp}</label>
        <input id="b-wa" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} aria-describedby="b-wa-h" aria-invalid={!!errs.whatsapp} data-testid="b-wa" />
        <span className="help" id="b-wa-h" style={{ margin: 0 }}>{d.booking.whatsappHelp}</span>
        {errs.whatsapp && <span className="error-text" role="alert">{errs.whatsapp}</span>}
      </div>
      <div className={`field${errs.day ? ' invalid' : ''}`}>
        <label htmlFor="b-day">{d.booking.day}</label>
        <select id="b-day" value={day} onChange={(e) => setDay(e.target.value)} data-testid="b-day">
          {days.map((x) => <option key={x} value={x}>{fmtDay(x)}</option>)}
        </select>
        {errs.day && <span className="error-text" role="alert">{errs.day}</span>}
      </div>
      <fieldset>
        <legend>{d.booking.window}</legend>
        <div className="options">
          {TIME_WINDOWS.map((w) => (
            <label key={w} className="opt"><input type="radio" name="window" checked={window_ === w} onChange={() => setWindow(w)} data-testid={`b-window-${w}`} /><span className="mark" aria-hidden="true" /><span>{d.booking.windows[w]}</span></label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{d.booking.method}</legend>
        <div className="options">
          {METHODS.map((m) => (
            <label key={m} className="opt"><input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} data-testid={`b-method-${m}`} /><span className="mark" aria-hidden="true" /><span>{d.booking.methods[m]}</span></label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="b-note">{d.booking.note}</label>
        <textarea id="b-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="help" style={{ margin: 0 }}>{d.booking.noteHelp}</span>
      </div>
      <label className={`consent-row`} style={errs.consent ? { borderStyle: 'dashed' } : undefined}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="b-consent" />
        <span>{d.booking.consent}</span>
      </label>
      {errs.consent && <p className="error-text" role="alert">{errs.consent}</p>}
      <div className="hp" aria-hidden="true"><label>{d.booking.honeypot}<input type="text" tabIndex={-1} autoComplete="off" /></label></div>
      <p className="help">{d.booking.disclaimer}</p>
      {top && <p className="error-text" role="alert">{top}</p>}
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={onCancel}>{d.common.back}</button>
        <button type="submit" className="btn" disabled={busy} data-testid="b-submit">{busy ? d.booking.submitting : d.booking.submit}</button>
      </div>
    </form>
  );
}
