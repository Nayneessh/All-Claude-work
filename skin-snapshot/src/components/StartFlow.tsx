'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PATHS, isPath, type PathId } from '../core/types';
import { ApiError, api, errorText } from '../lib/api';
import { sessionId, track } from '../lib/analytics';
import { getBotToken } from '../lib/pow';
import { fmt } from '../i18n';
import { useLang } from './LangProvider';
import { PATH_ICON } from './pages';

interface PublicConfig {
  unbookedHours: number;
  closedDays: number;
  maintenance: boolean;
}

export function StartFlow() {
  const { lang, dict: d, hours, days } = useLang();
  const router = useRouter();
  const sp = useSearchParams();
  const q = sp.get('path');
  const path: PathId | null = isPath(q) ? q : null;
  const [age, setAge] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [health, setHealth] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [evaluation, setEvaluation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<PublicConfig>({ unbookedHours: hours, closedDays: days, maintenance: false });

  useEffect(() => {
    api<PublicConfig>('/api/config').then(setCfg).catch(() => {});
  }, []);
  useEffect(() => {
    if (path) track('assessment_started', { path, lang });
  }, [path, lang]);

  const ready = age && privacy && health && photos;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path) return;
    if (!ready) {
      setError(d.start.tickAll);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const botToken = await getBotToken();
      const r = await api<{ token: string }>('/api/cases', {
        body: { lang, path, ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true, ...(evaluation ? { evaluation: true } : {}) }, sessionId: sessionId(), botToken },
      });
      router.push(`/${lang}/case/${r.token}`);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'maintenance' ? d.start.maintenanceMode : errorText(err, d.errors));
      setBusy(false);
    }
  };

  if (!path) {
    return (
      <div className="container flow-wrap narrow">
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.start.pickTitle}</h1>
        <hr className="gold-rule" />
        <p className="lead">{d.start.pickLead}</p>
        <div className="grid g3" style={{ marginTop: 22 }}>
          {PATHS.map((p) => {
            const Icon = PATH_ICON[p];
            return (
              <Link key={p} href={`/${lang}/start?path=${p}`} className="card path-card" onClick={() => track('path_selected', { path: p, lang })} data-testid={`pick-${p}`}>
                <span className="icon-badge"><Icon size={24} /></span>
                <h3>{d.paths[p].name}</h3>
                <p style={{ margin: 0 }}>{d.paths[p].short}</p>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  const [pre, post] = d.start.consents.privacy.split('{link}');
  return (
    <form className="container flow-wrap narrow" onSubmit={submit} noValidate data-testid="start-form">
      <p className="eyebrow">{fmt(d.start.leadPath, { path: d.paths[path].name })}</p>
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>{d.start.title}</h1>
      <hr className="gold-rule" />
      <p><Link href={`/${lang}/start`}>{d.start.changePath}</Link></p>

      <fieldset style={{ marginTop: 22 }}>
        <legend>{d.start.ageTitle}</legend>
        <label className="consent-row">
          <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} data-testid="age" />
          <span>{d.start.ageLabel}</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>{d.start.consentTitle}</legend>
        <p className="help">{d.start.consentLead}</p>
        <label className="consent-row">
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} data-testid="consent-privacy" />
          <span>{pre}<Link href={`/${lang}/privacy`} target="_blank">{d.start.consents.privacyLink}</Link>{post}</span>
        </label>
        <label className="consent-row">
          <input type="checkbox" checked={health} onChange={(e) => setHealth(e.target.checked)} data-testid="consent-health" />
          <span>{d.start.consents.health}</span>
        </label>
        <label className="consent-row">
          <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} data-testid="consent-photos_ai" />
          <span>{d.start.consents.photos_ai}</span>
        </label>
        <label className="consent-row">
          <input type="checkbox" checked={evaluation} onChange={(e) => setEvaluation(e.target.checked)} data-testid="consent-evaluation" />
          <span>{d.start.consents.evaluation}</span>
        </label>
        <p className="notice calm small">{fmt(d.start.retention, { hours: cfg.unbookedHours, days: cfg.closedDays })} <Link href={`/${lang}/consent`} target="_blank">{d.common.learnMore}</Link></p>
      </fieldset>

      <div className="hp" aria-hidden="true"><label>{d.booking.honeypot}<input type="text" name="hp" tabIndex={-1} autoComplete="off" /></label></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn" type="submit" disabled={busy || cfg.maintenance} data-testid="begin">{busy ? d.start.working : d.start.begin}</button>
      </div>
    </form>
  );
}
