import { useState, type FormEvent } from 'react';
import { supabase, friendlyError } from '../../lib/supabase';
import { Field, Seg, TextInput } from '../../ui/kit';
import { useAuth } from './AuthProvider';

export function Login() {
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ t: 'err' | 'ok'; s: string } | null>(null);
  const redirect = window.location.origin + '/';
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setMsg(null);
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect, shouldCreateUser: false } });
        if (error) throw error; setMsg({ t: 'ok', s: 'Check your inbox: we sent a sign-in link.' });
      }
    } catch (x) { setMsg({ t: 'err', s: /invalid login/i.test((x as Error).message) ? 'Email or password is incorrect.' : friendlyError(x) }); } finally { setBusy(false); }
  }
  async function reset() {
    if (!email.trim()) { setMsg({ t: 'err', s: 'Enter your email first.' }); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
    setMsg(error ? { t: 'err', s: friendlyError(error) } : { t: 'ok', s: 'If that email is registered, a reset link is on its way.' });
  }
  return (
    <div className="login">
      <form className="box stack" onSubmit={submit} aria-label="Sign in">
        <div className="mark"><b>THE SLATE</b><small>ONE COMMAND CENTRE · COMPLETE CONTROL</small></div>
        <div className="center"><Seg value={mode} onChange={setMode} options={[{ value: 'password', label: 'Password' }, { value: 'link', label: 'Email me a link' }]} /></div>
        <Field label="Email" htmlFor="em"><TextInput id="em" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {mode === 'password' && <Field label="Password" htmlFor="pw"><TextInput id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        {msg && <div className={`banner ${msg.t === 'err' ? 'bad' : 'good'}`} role="alert">{msg.s}</div>}
        <button className="btn primary" disabled={busy} type="submit">{busy ? <span className="spinner" /> : mode === 'password' ? 'Sign in' : 'Send sign-in link'}</button>
        {mode === 'password' && <button type="button" className="btn ghost sm" onClick={reset}>Forgot password?</button>}
        <div className="tiny muted center">Private system. Access is limited to authorised users.</div>
      </form>
    </div>
  );
}

/** Shown after following a password-reset email. */
export function SetPassword() {
  const { clearRecovery } = useAuth();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState('');
  async function go(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 10) return setErr('Use at least 10 characters.'); if (pw !== pw2) return setErr('The passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password: pw }); if (error) setErr(friendlyError(error)); else clearRecovery();
  }
  return (
    <div className="login"><form className="box stack" onSubmit={go}>
      <div className="mark"><b>NEW PASSWORD</b></div>
      <Field label="New password"><TextInput type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Repeat"><TextInput type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      {err && <div className="banner bad">{err}</div>}<button className="btn primary" type="submit">Save password</button>
    </form></div>
  );
}
