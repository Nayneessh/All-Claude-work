#!/usr/bin/env node
// Production security smoke test: anonymous callers and a *different* signed-in user must see nothing, and secrets must stay unreadable.
// Needs a dedicated, otherwise-empty test account:  SUPABASE_URL, SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD   (Node 22: NODE_USE_ENV_PROXY=1 behind proxies)
import { createClient } from '@supabase/supabase-js';
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, E2E_EMAIL: email, E2E_PASSWORD: password } = process.env;
if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required'); process.exit(2); }
const c = createClient(url, key, { auth: { persistSession: false } }); const out = []; const rec = (n, ok, x = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' — ' + x : ''}`);
const unreadable = (r) => !!r.error || (r.data ?? []).length === 0; // permission denied OR zero rows both mean "not readable"
const OWNED = ['mandates', 'candidates', 'steps', 'slate_tasks', 'slate_done', 'candidate_mandates', 'candidate_status_history', 'recruitment_activities', 'companies', 'agencies', 'comments', 'candidate_files', 'app_settings', 'push_subscriptions', 'notifications', 'sop_documents', 'audit_log', 'v_mandate_overview', 'v_candidate_pipeline'];
for (const t of [...OWNED, 'push_config', 'allowed_emails']) rec(`anonymous cannot read ${t}`, unreadable(await c.from(t).select('*').limit(1)));
rec('anonymous cannot call write RPCs', !!(await c.rpc('slate_save_mandate', { p: { title: 'x' } })).error);
rec('health probe answers', (await c.rpc('slate_health')).data?.ok === true);
if (email && password) {
  const s = await c.auth.signInWithPassword({ email, password }); rec('test account can sign in', !!s.data?.session);
  for (const t of [...OWNED, 'push_config', 'allowed_emails']) { const r = await c.from(t).select('*').limit(1); rec(`other user cannot read ${t}`, unreadable(r), r.error ? 'denied' : 'empty'); }
  for (const f of ['slate_log_activity', 'slate_seed_defaults']) rec(`internal function ${f} is not callable`, !!(await c.rpc(f, {})).error);
} else console.log('(no E2E_EMAIL/E2E_PASSWORD: signed-in checks skipped)');
console.log(out.join('\n')); const bad = out.filter((x) => x.startsWith('FAIL')).length; console.log(`\n${out.length - bad}/${out.length} passed`); process.exit(bad ? 1 : 0);
