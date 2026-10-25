import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Public client configuration only (project URL + publishable key). Data is protected by Row Level Security;
 * no service-role key is ever shipped. Without configuration the app simply runs local-only.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const cloudConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (!client) {
    client = createClient(url as string, key as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'monster-gains-auth' },
      global: { headers: { 'x-client-info': 'monster-gains' } },
    });
  }
  return client;
}
