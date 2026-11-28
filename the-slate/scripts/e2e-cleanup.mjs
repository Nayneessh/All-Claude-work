// Deletes every row owned by the dedicated E2E test account, through the normal API (RLS limits it to that account's own rows).
// Usage: NODE_USE_ENV_PROXY=1 E2E_EMAIL=… E2E_PASSWORD=… VITE_SUPABASE_URL=… VITE_SUPABASE_PUBLISHABLE_KEY=… node scripts/e2e-cleanup.mjs
import { createClient } from '@supabase/supabase-js';
const { E2E_EMAIL, E2E_PASSWORD, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!E2E_EMAIL || !E2E_PASSWORD || !VITE_SUPABASE_URL || !VITE_SUPABASE_PUBLISHABLE_KEY) { console.error('Missing environment variables'); process.exit(2); }
const c = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: s, error } = await c.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD }); if (error) throw error;
const order = [['slate_overrides', 'id'], ['slate_done', 'id'], ['slate_tasks', 'id'], ['reminders', 'id'], ['steps', 'id'], ['comments', 'id'], ['candidate_files', 'id'], ['candidate_mandates', 'id'], ['mandate_documents', 'id'],
  ['mandate_agencies', 'id'], ['candidates', 'id'], ['mandates', 'id'], ['agencies', 'id'], ['companies', 'id'], ['sop_documents', 'id'], ['notifications', 'id'], ['push_subscriptions', 'id'], ['config_options', 'id'], ['app_settings', 'user_id']];
for (const [t, k] of order) {
  const { data, error: e } = await c.from(t).delete().not(k, 'is', null).select(k);
  console.log(`${e ? 'ERR ' : 'ok  '}${t.padEnd(22)} ${e ? e.message : (data?.length ?? 0) + ' deleted'}`);
}
console.log('account', s.user.email, 'is now empty');
