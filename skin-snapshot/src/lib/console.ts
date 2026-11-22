'use client';
// Staff sign-in. Supabase Auth with a mandatory authenticator-app code (TOTP). The console only
// receives data once the session is "aal2" (two-step verified); the database enforces the same rule.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, api, type ApiOpts } from './api';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const DEV_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === 'dev';

let client: SupabaseClient | null = null;
export function supa(): SupabaseClient {
  if (!url || !anon) throw new Error('Supabase is not configured');
  client ??= createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, storage: typeof window !== 'undefined' ? window.sessionStorage : undefined } });
  return client;
}

export async function staffToken(): Promise<string | null> {
  if (DEV_MODE) return sessionStorage.getItem('ss_dev_token');
  const { data } = await supa().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function capi<T = any>(path: string, o: Omit<ApiOpts, 'staff'> = {}): Promise<T> {
  const t = await staffToken();
  if (!t) throw new ApiError(401, 'unauthorized');
  return api<T>(path, { ...o, staff: t });
}

export type AuthStage = 'loading' | 'signed_out' | 'need_enroll' | 'need_code' | 'ready';

export async function authStage(): Promise<AuthStage> {
  if (DEV_MODE) return sessionStorage.getItem('ss_dev_token') ? 'ready' : 'signed_out';
  const { data } = await supa().auth.getSession();
  if (!data.session) return 'signed_out';
  const { data: aal } = await supa().auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === 'aal2') return 'ready';
  return aal?.nextLevel === 'aal2' ? 'need_code' : 'need_enroll';
}
