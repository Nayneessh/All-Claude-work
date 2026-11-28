import { createClient } from '@supabase/supabase-js';
import { ENV } from './env';

/** The only place the backend client is created. Swap here (or point the env vars at a self-hosted Supabase) to migrate. */
export const supabase = createClient(ENV.supabaseUrl || 'http://localhost', ENV.supabaseKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

/** PostgREST / Postgres errors -> a message a person can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string } | null;
  const msg = err?.message ?? String(e);
  if (err?.code === '23505') return 'That already exists.';
  if (err?.code === '23514') return msg.replace(/^new row for relation .*?violates check constraint .*$/i, 'That value is not allowed.');
  if (err?.code === '23503') return 'This record is still referenced elsewhere.';
  if (err?.code === '42501' || /row-level security/i.test(msg)) return 'You do not have permission to do that.';
  if (err?.code === 'P0002') return msg;
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Network problem — check your connection and try again.';
  if (/JWT|session/i.test(msg)) return 'Your session expired — please sign in again.';
  return msg || 'Something went wrong.';
}
export async function must<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyError(error));
  return data as T;
}
