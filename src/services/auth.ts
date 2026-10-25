import type { Session } from '@supabase/supabase-js';
import { cloudConfigured, getClient } from './supabase';

export interface AuthState {
  status: 'loading' | 'unconfigured' | 'signed_out' | 'signed_in';
  userId: string | null;
  email: string | null;
  /** True when the session ended unexpectedly (expired/revoked) — local data is untouched and the user is asked to sign in again. */
  expired: boolean;
}

export const initialAuth: AuthState = { status: 'loading', userId: null, email: null, expired: false };

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (/invalid login|invalid credentials/.test(m)) return 'Email or password is incorrect.';
  if (/email not confirmed/.test(m)) return 'Please confirm your email first — check your inbox for the link, then sign in.';
  if (/already registered|already been registered/.test(m)) return 'An account with this email already exists. Try signing in.';
  if (/password should be at least|weak/.test(m)) return 'Choose a longer password (at least 8 characters).';
  if (/rate limit|too many/.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network|failed to|offline/.test(m)) return 'No connection. You can keep training offline and sign in later.';
  return message;
}

const fromSession = (s: Session | null, expired = false): AuthState =>
  s ? { status: 'signed_in', userId: s.user.id, email: s.user.email ?? null, expired: false } : { status: 'signed_out', userId: null, email: null, expired };

/** Restores the persisted session (works offline: the stored session is read locally) and follows later changes. */
export async function initAuth(onChange: (s: AuthState) => void): Promise<() => void> {
  const c = getClient();
  if (!c) { onChange({ status: 'unconfigured', userId: null, email: null, expired: false }); return () => undefined; }
  try {
    const { data } = await c.auth.getSession();
    onChange(fromSession(data.session));
  } catch {
    onChange({ status: 'signed_out', userId: null, email: null, expired: false });
  }
  const { data: sub } = c.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') onChange(fromSession(null, true));
    else onChange(fromSession(session));
  });
  return () => sub.subscription.unsubscribe();
}

export interface AuthResult { ok: boolean; error?: string; needsConfirm?: boolean; message?: string }

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Cloud sync is not configured in this build.' };
  try {
    const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    return error ? { ok: false, error: friendly(error.message) } : { ok: true };
  } catch (e) { return { ok: false, error: friendly(e instanceof Error ? e.message : 'Network error') }; }
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Cloud sync is not configured in this build.' };
  if (password.length < 8) return { ok: false, error: 'Choose a longer password (at least 8 characters).' };
  try {
    const { data, error } = await c.auth.signUp({ email: email.trim(), password });
    if (error) return { ok: false, error: friendly(error.message) };
    if (!data.session) return { ok: true, needsConfirm: true, message: 'Account created. Open the confirmation email, then come back and sign in.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: friendly(e instanceof Error ? e.message : 'Network error') }; }
}

export async function signOut(): Promise<void> {
  const c = getClient();
  try { await c?.auth.signOut(); } catch { /* offline: the local session is cleared by the next successful call; data stays on the device */ }
}

export async function resetPassword(email: string, redirectTo?: string): Promise<AuthResult> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Cloud sync is not configured in this build.' };
  try {
    const { error } = await c.auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : undefined);
    return error ? { ok: false, error: friendly(error.message) } : { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  } catch (e) { return { ok: false, error: friendly(e instanceof Error ? e.message : 'Network error') }; }
}

export async function changePassword(password: string): Promise<AuthResult> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Cloud sync is not configured in this build.' };
  if (password.length < 8) return { ok: false, error: 'Choose a longer password (at least 8 characters).' };
  try {
    const { error } = await c.auth.updateUser({ password });
    return error ? { ok: false, error: friendly(error.message) } : { ok: true, message: 'Password updated.' };
  } catch (e) { return { ok: false, error: friendly(e instanceof Error ? e.message : 'Network error') }; }
}

/** Permanently deletes the cloud account and its data (server-side function). Local data is handled by the caller. */
export async function deleteCloudAccount(): Promise<AuthResult> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Cloud sync is not configured in this build.' };
  try {
    const { error } = await c.rpc('delete_my_account');
    if (error) return { ok: false, error: friendly(error.message) };
    await signOut();
    return { ok: true };
  } catch (e) { return { ok: false, error: friendly(e instanceof Error ? e.message : 'Network error') }; }
}

export { cloudConfigured };
