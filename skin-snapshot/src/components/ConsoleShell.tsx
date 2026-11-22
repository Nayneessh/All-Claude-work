'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DEV_MODE, authStage, capi, supa, type AuthStage } from '../lib/console';

interface Me { email: string; role: 'admin' | 'cosmetologist'; user_id: string }
const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const devLogin = async (role: 'admin' | 'cosmetologist') => {
    const r = await api<{ token: string }>('/api/dev/token', { body: { role } });
    sessionStorage.setItem('ss_dev_token', r.token);
    onDone();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supa().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr('Email or password is not correct.');
    else onDone();
  };
  return (
    <div className="container narrow flow-wrap">
      <h1>Cosmetologist console</h1>
      <hr className="gold-rule" />
      {DEV_MODE ? (
        <div className="card stack">
          <p className="notice">Development sign-in. Not available on staging or production.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => void devLogin('cosmetologist')} data-testid="dev-cosmo">Sign in as cosmetologist</button>
            <button className="btn secondary" onClick={() => void devLogin('admin')} data-testid="dev-admin">Sign in as admin</button>
          </div>
        </div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <div className="field"><label htmlFor="c-email">Email</label><input id="c-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="c-email" /></div>
          <div className="field"><label htmlFor="c-pass">Password</label><input id="c-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="c-pass" /></div>
          {err && <p className="error-text" role="alert">{err}</p>}
          <button className="btn" disabled={busy} data-testid="c-signin">Sign in</button>
        </form>
      )}
    </div>
  );
}

function Mfa({ stage, onDone }: { stage: 'need_enroll' | 'need_code'; onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const s = supa();
      if (stage === 'need_enroll') {
        const { data, error } = await s.auth.mfa.enroll({ factorType: 'totp', friendlyName: `console-${Date.now()}` });
        if (error || !data) return setErr(error?.message ?? 'Could not start enrolment');
        setFactorId(data.id);
        setQr(data.totp.qr_code);
        setSecret(data.totp.secret);
      } else {
        const { data } = await s.auth.mfa.listFactors();
        const f = data?.totp?.find((x) => x.status === 'verified');
        if (f) setFactorId(f.id);
        else setErr('No authenticator is set up for this account.');
      }
    })();
  }, [stage]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setErr(null);
    const s = supa();
    const ch = await s.auth.mfa.challenge({ factorId });
    if (ch.error) { setBusy(false); return setErr(ch.error.message); }
    const v = await s.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
    setBusy(false);
    if (v.error) setErr('That code was not correct. Try the newest code.');
    else onDone();
  };
  return (
    <div className="container narrow flow-wrap">
      <h1>{stage === 'need_enroll' ? 'Set up two-step verification' : 'Enter your authenticator code'}</h1>
      <hr className="gold-rule" />
      <form className="card stack" onSubmit={verify}>
        {stage === 'need_enroll' && (
          <>
            <p>Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then enter the 6-digit code it shows.</p>
            {qr && <div className="qr"><img src={qr} alt="Authenticator QR code" /></div>}
            {secret && <p className="help">Cannot scan? Enter this key: <code>{secret}</code></p>}
          </>
        )}
        <div className="field"><label htmlFor="c-code">6-digit code</label><input id="c-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} data-testid="c-code" /></div>
        {err && <p className="error-text" role="alert">{err}</p>}
        <button className="btn" disabled={busy || code.length < 6} data-testid="c-verify">Verify</button>
      </form>
    </div>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  const path = usePathname();
  const reload = useCallback(async () => {
    const s = await authStage().catch(() => 'signed_out' as AuthStage);
    setStage(s);
    if (s === 'ready') {
      try {
        setMe(await capi<Me>('/api/console/me'));
        setDenied(false);
      } catch {
        setDenied(true);
      }
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const signOut = async () => {
    if (DEV_MODE) sessionStorage.removeItem('ss_dev_token');
    else await supa().auth.signOut();
    setMe(null);
    setStage('signed_out');
  };

  if (stage === 'loading') return <div className="container flow-wrap"><div className="spinner" role="status" aria-label="Loading" /></div>;
  if (stage === 'signed_out') return <Login onDone={() => void reload()} />;
  if (stage === 'need_enroll' || stage === 'need_code') return <Mfa stage={stage} onDone={() => void reload()} />;
  if (denied) {
    return (
      <div className="container narrow flow-wrap" data-testid="console-denied">
        <h1>No access</h1>
        <p className="notice">This account is not authorised for the console. Ask an administrator to add you.</p>
        <button className="btn secondary" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }
  if (!me) return <div className="container flow-wrap"><div className="spinner" role="status" aria-label="Loading" /></div>;
  const link = (href: string, label: string) => <Link href={href} aria-current={path === href ? 'page' : undefined} style={{ color: 'var(--champagne)', fontWeight: 600, padding: '10px 4px', textDecorationColor: 'var(--amber)', textDecoration: path === href ? 'underline' : 'none', textUnderlineOffset: 8 }}>{label}</Link>;
  return (
    <MeCtx.Provider value={me}>
      <header className="site-header">
        <div className="container header-row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--champagne)' }}>Console</strong>
          <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }} aria-label="Console">
            {link('/console', 'Queue')}
            {link('/console/templates', 'Routine templates')}
            {link('/console/stats', 'Counts')}
            {me.role === 'admin' && link('/console/access-log', 'Access log')}
            {me.role === 'admin' && link('/console/settings', 'Settings')}
          </nav>
          <div className="header-right" style={{ color: 'var(--champagne)', fontSize: '0.88rem' }}>
            <span data-testid="me">{me.email} · {me.role}</span>
            <button className="btn on-sage small" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="container flow-wrap" id="main">{children}</main>
    </MeCtx.Provider>
  );
}
