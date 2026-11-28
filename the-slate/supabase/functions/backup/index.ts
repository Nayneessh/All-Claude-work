// Supabase Edge Function: backup
// Full logical backup of every table to a private Storage bucket, with checksum + automatic verification and 30-day retention.
// Triggered nightly by pg_cron (x-cron-secret) or manually by the signed-in owner from Settings → Data & security.
// Secrets (push_config) and device push endpoints are deliberately NOT included. Auth users live in Supabase Auth (see docs/BACKUP_AND_RECOVERY.md).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
// restore order (parents before children)
const TABLES: [string, string][] = [['allowed_emails', 'email'], ['companies', 'id'], ['agencies', 'id'], ['config_options', 'id'], ['mandates', 'id'], ['mandate_agencies', 'id'], ['mandate_documents', 'id'], ['candidates', 'id'],
  ['candidate_mandates', 'id'], ['candidate_status_history', 'id'], ['candidate_files', 'id'], ['comments', 'id'], ['steps', 'id'], ['reminders', 'id'], ['recruitment_activities', 'id'], ['slate_tasks', 'id'], ['slate_done', 'id'],
  ['slate_overrides', 'id'], ['sop_documents', 'id'], ['sop_revisions', 'id'], ['notifications', 'id'], ['app_settings', 'user_id'], ['audit_log', 'id']];
const KEEP_DAYS = 30, KEEP_MIN = 7, PAGE = 1000;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const gzip = async (s: string) => new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzip = async (b: Uint8Array) => await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('push_config').select('value').eq('key', 'cron_secret').maybeSingle();
  const viaCron = !!cfg?.value && req.headers.get('x-cron-secret') === cfg.value;
  if (!viaCron) { const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''); const { data: u } = tok ? await sb.auth.getUser(tok) : { data: null }; if (!u?.user) return json({ error: 'unauthorised' }, 401); }

  const { data: run, error: re } = await sb.from('backup_runs').insert({ status: 'running' }).select('id').single();
  if (re || !run) return json({ error: re?.message ?? 'cannot start' }, 500);
  try {
    const tables: Record<string, unknown[]> = {}; const counts: Record<string, number> = {};
    for (const [t, order] of TABLES) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from(t).select('*').order(order).range(from, from + PAGE - 1);
        if (error) throw new Error(`${t}: ${error.message}`);
        rows.push(...(data ?? [])); if ((data ?? []).length < PAGE) break;
      }
      tables[t] = rows; counts[t] = rows.length;
    }
    const taken = new Date(); const stamp = taken.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const payload = JSON.stringify({ format: 'the-slate-backup', version: 1, taken_at: taken.toISOString(), counts, tables });
    const bytes = await gzip(payload); const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
    const path = `${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/slate-${stamp}.json.gz`;
    const up = await sb.storage.from('backups').upload(path, bytes, { contentType: 'application/gzip', upsert: false });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    // verify: download again, compare checksum, parse, compare row counts
    const dl = await sb.storage.from('backups').download(path); if (dl.error || !dl.data) throw new Error(`verify download: ${dl.error?.message}`);
    const back = new Uint8Array(await dl.data.arrayBuffer()); const sha2 = hex(await crypto.subtle.digest('SHA-256', back));
    const parsed = JSON.parse(await gunzip(back)) as { counts: Record<string, number>; tables: Record<string, unknown[]> };
    const verified = sha2 === sha && TABLES.every(([t]) => parsed.tables[t]?.length === counts[t] && parsed.counts[t] === counts[t]);
    if (!verified) throw new Error('verification failed: downloaded backup does not match what was written');

    // retention: delete files older than KEEP_DAYS but always keep the newest KEEP_MIN
    let removed = 0;
    try {
      const files: { name: string; created: number }[] = [];
      const years = (await sb.storage.from('backups').list('', { limit: 100 })).data ?? [];
      for (const y of years) for (const m of (await sb.storage.from('backups').list(y.name, { limit: 100 })).data ?? [])
        for (const f of (await sb.storage.from('backups').list(`${y.name}/${m.name}`, { limit: 1000 })).data ?? []) if (f.name.endsWith('.json.gz')) files.push({ name: `${y.name}/${m.name}/${f.name}`, created: new Date(f.created_at ?? 0).getTime() });
      files.sort((a, b) => b.created - a.created);
      const old = files.slice(KEEP_MIN).filter((f) => Date.now() - f.created > KEEP_DAYS * 86_400_000).map((f) => f.name);
      if (old.length) { await sb.storage.from('backups').remove(old); removed = old.length; }
    } catch (e) { console.error('retention', (e as Error).message); }

    await sb.from('backup_runs').update({ status: 'ok', finished_at: new Date().toISOString(), path, size_bytes: bytes.length, sha256: sha, row_counts: counts, verified: true }).eq('id', run.id);
    return json({ ok: true, path, bytes: bytes.length, sha256: sha, verified: true, removed, counts });
  } catch (e) {
    await sb.from('backup_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: String((e as Error).message).slice(0, 500) }).eq('id', run.id);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
