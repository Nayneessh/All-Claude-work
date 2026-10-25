import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banner, Button, Field, Seg } from '@/ui/kit';
import { useApp } from '@/app/AppContext';
import { changePassword, resetPassword, signIn, signUp } from '@/services/auth';
import { cloudConfigured } from '@/services/supabase';

export function Auth() {
  const nav = useNavigate();
  const loc = useLocation();
  const { auth, online } = useApp();
  const back = (loc.state as { from?: string } | null)?.from ?? '/';
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (auth.status === 'signed_in') {
    return (
      <div className="screen no-nav col">
        <h1>Signed in</h1>
        <Banner icon="cloud">Your data is backed up to <strong>{auth.email}</strong> and syncs automatically.</Banner>
        <Button variant="primary" block onClick={() => nav(back, { replace: true })}>Continue</Button>
      </div>
    );
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (!email.includes('@')) { setErr('Enter a valid email address.'); return; }
    if (mode !== 'reset' && !pw) { setErr('Enter your password.'); return; }
    setBusy(true);
    const res = mode === 'in' ? await signIn(email, pw) : mode === 'up' ? await signUp(email, pw) : await resetPassword(email, window.location.origin.startsWith('http') ? `${window.location.origin}/` : undefined);
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? 'Something went wrong.'); return; }
    if (res.message) setMsg(res.message);
    if (mode === 'up' && res.needsConfirm) setMode('in');
    if (mode === 'in') nav(back, { replace: true });
  }

  return (
    <div className="screen no-nav">
      <img className="hero-logo" src="./logo.svg" alt="" />
      <h1 className="center mt-3">Monster Gains</h1>
      <p className="center dim mt-1">{mode === 'reset' ? 'Reset your password' : 'Back up your progress and sync it between devices.'}</p>
      {!cloudConfigured && <div className="mt-4"><Banner tone="warn" icon="warn">Cloud sync is not configured in this build. The app works fully offline.</Banner></div>}
      {!online && <div className="mt-4"><Banner tone="info" icon="cloudoff">You are offline. You can keep training and sign in later — nothing is lost.</Banner></div>}
      {auth.expired && <div className="mt-4"><Banner tone="warn" icon="lock">Your session ended. Sign in again to resume syncing. Your data on this device is safe.</Banner></div>}
      <form className="col mt-5" onSubmit={(e) => void submit(e)} noValidate>
        {mode !== 'reset' && <Seg value={mode} onChange={(v) => { setMode(v); setErr(null); setMsg(null); }} options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }]} label="Account mode" />}
        <Field label="Email" error={err && /email/i.test(err) ? err : null}>{(id) => <input id={id} className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}</Field>
        {mode !== 'reset' && <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : undefined}>{(id) => <input id={id} className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>}
        {err && !/email/i.test(err) && <Banner tone="err" icon="warn">{err}</Banner>}
        {msg && <Banner icon="info">{msg}</Banner>}
        <Button type="submit" variant="primary" block disabled={busy || !cloudConfigured}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
        {mode === 'in' && <Button variant="ghost" block onClick={() => { setMode('reset'); setErr(null); }}>Forgot password?</Button>}
        {mode === 'reset' && <Button variant="ghost" block onClick={() => setMode('in')}>Back to sign in</Button>}
      </form>
      <div className="divider" />
      <Button block variant="soft" onClick={() => nav(back, { replace: true })}>Continue offline for now</Button>
      <p className="tiny dim center mt-3">Everything is saved on this phone first. Signing in adds a cloud backup.</p>
    </div>
  );
}

/** Landing screen for the password-reset email link (token handed over by main.tsx). */
export function RecoverPassword() {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await changePassword(pw);
    setBusy(false);
    if (!r.ok) setErr(r.error ?? 'Could not update the password.'); else setDone(true);
  }
  return (
    <div className="screen no-nav">
      <h1>Choose a new password</h1>
      {done ? <div className="col mt-4"><Banner icon="check">Password updated.</Banner><Button variant="primary" block onClick={() => nav('/', { replace: true })}>Continue</Button></div> : (
        <form className="col mt-4" onSubmit={(e) => void submit(e)}>
          <Field label="New password" hint="At least 8 characters">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          {err && <Banner tone="err" icon="warn">{err}</Banner>}
          <Button type="submit" variant="primary" block disabled={busy}>Update password</Button>
        </form>
      )}
    </div>
  );
}
