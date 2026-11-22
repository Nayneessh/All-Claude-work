'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { ConsentKey } from '../core/consent';
import type { VisitorState } from '../server/service';
import { api, errorText } from '../lib/api';
import { photoStore } from '../lib/photostore';
import { fmt } from '../i18n';
import { useLang } from './LangProvider';

/** Delete my photos and case, and consent withdrawal. Always available on the case page. */
export function PrivacyControls({ state, token, onChanged }: { state: VisitorState; token: string; onChanged: () => void }) {
  const { lang, dict: d } = useLang();
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const del = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/case', { method: 'DELETE', token });
      photoStore.clear();
      setDeleted(true);
    } catch (e) {
      setErr(errorText(e, d.errors));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (key: ConsentKey) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ deleted: boolean }>(`/api/case/consents/${key}/withdraw`, { method: 'POST', token });
      photoStore.clear();
      setMsg(d.controls.withdrawn);
      if (r.deleted) setDeleted(true);
      else onChanged();
    } catch (e) {
      setErr(errorText(e, d.errors));
    } finally {
      setBusy(false);
    }
  };

  if (deleted) {
    return (
      <div className="card accent" role="status" data-testid="deleted">
        <h2 style={{ fontSize: '1.5rem' }}>{d.controls.deleted}</h2>
        <p style={{ marginBottom: 12 }}><Link className="btn" href={`/${lang}`}>{d.system.notFound.home}</Link></p>
      </div>
    );
  }
  const retention = state.booking ? fmt(d.start.retention, { hours: state.settings.unbookedHours, days: state.settings.closedDays }) : fmt(d.start.retention, { hours: state.settings.unbookedHours, days: state.settings.closedDays });
  return (
    <section className="card flat stack" aria-labelledby="controls" data-testid="privacy-controls">
      <h2 id="controls" style={{ fontSize: '1.5rem' }}>{d.controls.title}</h2>
      <p>{d.controls.lead}</p>
      <div>
        <h3>{d.controls.deleteAll}</h3>
        <p className="help">{d.controls.deleteLead}</p>
        {!confirm ? (
          <button type="button" className="btn danger" onClick={() => setConfirm(true)} data-testid="delete-case">{d.controls.deleteAll}</button>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn danger" disabled={busy} onClick={() => void del()} data-testid="delete-confirm">{d.controls.deleteConfirm}</button>
            <button type="button" className="btn secondary" onClick={() => setConfirm(false)}>{d.common.cancel}</button>
          </div>
        )}
      </div>
      <div>
        <h3>{d.controls.withdraw}</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(state.consents as ConsentKey[]).filter((k) => k !== 'privacy' || true).map((k) => (
            <li key={k} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <span><strong>{d.controls.consentNames[k]}</strong><br /><span className="help" style={{ margin: 0 }}>{d.controls.effects[k]}</span></span>
                <button type="button" className="btn secondary small" disabled={busy} onClick={() => void withdraw(k)} data-testid={`withdraw-${k}`}>{d.controls.withdrawBtn}</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="help">{fmt(d.controls.retention, { text: retention })}</p>
      {msg && <p role="status" className="notice calm">{msg}</p>}
      {err && <p role="alert" className="error-text">{err}</p>}
    </section>
  );
}
