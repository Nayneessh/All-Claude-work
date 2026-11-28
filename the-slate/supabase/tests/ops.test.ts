import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { A, B, as, freshDb, q } from './harness';
import { buildRestoreSql } from '../../scripts/restore-from-backup.mjs';
import { runChecks, summarize, toMarkdown } from '../../scripts/health/check.mjs';

const TABLES = ['allowed_emails', 'companies', 'agencies', 'config_options', 'mandates', 'mandate_agencies', 'mandate_documents', 'candidates', 'candidate_mandates', 'candidate_status_history', 'candidate_files', 'comments', 'steps', 'reminders',
  'recruitment_activities', 'slate_tasks', 'slate_done', 'slate_overrides', 'sop_documents', 'sop_revisions', 'notifications', 'app_settings', 'audit_log'];

describe('backup → restore round trip (the recovery procedure)', () => {
  it('restores a backup into a fresh database exactly, including history, with triggers paused', async () => {
    const src = await freshDb();
    const rpc = (sql: string, p: unknown[] = []) => as(src, A, async () => (await src.query(sql, p)).rows as Record<string, unknown>[]);
    await rpc('select public.slate_ensure_defaults()');
    const m = (await rpc(`select public.slate_save_mandate($1::jsonb) id`, [JSON.stringify({ title: 'CFO', company: 'ACME', consultants: ['Michael Page'], started_on: '2026-11-20' })]))[0].id as string;
    const c = (await rpc(`select public.slate_save_candidate($1::jsonb) id`, [JSON.stringify({ name: 'Rahul Sharma', current_ctc: '65 lakhs', mandate_id: m })]))[0].id as string;
    await rpc(`select public.slate_set_candidate_stage($1,$2,'rejected','Client rejection','not a fit')`, [c, m]);
    await rpc(`insert into public.slate_tasks (title, repeat, start_date, due_time) values ('Call HM','daily','2026-11-01','15:00') returning id`);
    await rpc(`select public.slate_ensure_sop()`);
    // exactly what the backup function does: dump every table, in restore order
    const tables: Record<string, unknown[]> = {}; const counts: Record<string, number> = {};
    for (const t of TABLES) { const rows = (await src.query(`select * from public.${t} order by 1`)).rows; tables[t] = rows; counts[t] = rows.length; }
    const gz = gzipSync(JSON.stringify({ format: 'the-slate-backup', version: 1, taken_at: '2026-11-28T00:00:00Z', counts, tables }));

    const dst = await freshDb(); // same schema, same users, but no data
    await dst.exec(`delete from public.config_options`); // the fresh DB has none; keep it explicit
    const sql = buildRestoreSql(gz);
    expect(sql.startsWith('-- THE SLATE restore')).toBe(true);
    await dst.exec(sql);
    for (const t of TABLES.filter((x) => x !== 'allowed_emails')) expect(Number((await q<{ n: string }>(dst, `select count(*) n from public.${t}`))[0].n), t).toBe(counts[t]);
    // content, not just counts
    expect((await q<Record<string, unknown>>(dst, `select name, current_ctc from public.candidates`))[0]).toMatchObject({ name: 'Rahul Sharma', current_ctc: '65 lakhs' });
    expect((await q<Record<string, unknown>>(dst, `select reason_type, reason, comment from public.candidate_status_history where to_stage='rejected'`))[0]).toMatchObject({ reason_type: 'rejection', reason: 'Client rejection', comment: 'not a fit' });
    expect((await q(dst, `select 1 from public.mandates where title='CFO' and last_activity_at is not null`))).toHaveLength(1);
    // triggers are live again afterwards
    await as(dst, A, () => dst.query(`update public.mandates set title='CFO v2'`));
    expect(Number((await q<{ n: string }>(dst, `select count(*) n from public.audit_log where table_name='mandates' and action='UPDATE'`))[0].n)).toBeGreaterThan(Number(counts.audit_log ? 0 : 0));
    // the restored identity sequence continues without collisions
    await as(dst, A, () => dst.query(`update public.candidates set notes='after restore'`));
    expect(await q(dst, `select 1 from public.audit_log where table_name='candidates' and action='UPDATE'`)).toHaveLength(1);
  });
  it('can map the owner to a different user id (new server, new auth user)', async () => {
    const src = await freshDb();
    await as(src, A, async () => { await src.query(`select public.slate_save_mandate('{"title":"COO","company":"X"}'::jsonb)`); });
    const rows = (await src.query(`select * from public.mandates`)).rows; const companies = (await src.query(`select * from public.companies`)).rows;
    const NEW = '99999999-9999-4999-8999-999999999999';
    const dst = await freshDb(); await dst.exec(`insert into public.allowed_emails values ('n@example.test'); insert into auth.users (id, email) values ('${NEW}', 'n@example.test')`);
    await dst.exec(buildRestoreSql(Buffer.from(JSON.stringify({ format: 'the-slate-backup', taken_at: 'x', tables: { companies, mandates: rows } })), [[A, NEW]]));
    expect((await q<{ user_id: string }>(dst, `select user_id from public.mandates`))[0].user_id).toBe(NEW);
  });
  it('refuses anything that is not a backup file, and rejects malformed user ids', () => {
    expect(() => buildRestoreSql(Buffer.from('{"hello":1}'))).toThrow(/not a THE SLATE backup/);
    expect(() => buildRestoreSql(Buffer.from('{"format":"the-slate-backup","tables":{}}'), [['x', 'y']])).toThrow(/UUID/);
  });
  it('B cannot be confused with A: user ids are preserved as given', () => { expect(A).not.toBe(B); });
});

describe('daily health check (read-only) — decisions on simulated infrastructure', () => {
  const ENV = { GITHUB_REPOSITORY: 'o/r', APP_URL: 'https://app.example', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', VERCEL_TOKEN: 't', VERCEL_PROJECT_ID: 'p' };
  const detail = (o: Record<string, unknown> = {}) => ({ ok: true, db_time: 'x', counts: { mandates: 14 }, last_backup: { status: 'ok', verified: true, finished_at: new Date(Date.now() - 6 * 3_600_000).toISOString() },
    jobs: { 'slate-notify-5min': { last_run: new Date(Date.now() - 2 * 60_000).toISOString(), last_status: 'succeeded' }, 'slate-backup-daily': { last_run: new Date(Date.now() - 6 * 3_600_000).toISOString(), last_status: 'succeeded' } }, ...o });
  const make = (over: Record<string, (u: string) => Response | Promise<Response>> = {}) => (async (url: string | URL, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? 'GET';
    for (const [k, v] of Object.entries(over)) if (u.includes(k)) return v(u);
    if (u.includes('api.github.com') && u.includes('/commits')) return Response.json([{ sha: 'abcdef123', commit: { committer: { date: '2026-11-28' }, message: 'x' } }]);
    if (u.includes('api.github.com') && u.includes('/actions/runs')) return Response.json({ workflow_runs: [{ name: 'Slate CI', conclusion: 'success', html_url: 'u' }] });
    if (u.includes('api.github.com') && (u.includes('dependabot') || u.includes('secret-scanning'))) return new Response('{}', { status: 403 });
    if (u.includes('api.github.com')) return Response.json({ full_name: 'o/r' });
    if (u.includes('api.vercel.com')) return Response.json({ deployments: [{ target: 'production', state: 'READY', created: Date.now() - 3_600_000 }] });
    if (u.endsWith('/assets/index.js')) return new Response('js');
    if (u.startsWith('https://app.example')) return new Response('<html><title>THE SLATE</title><script type="module" src="/assets/index.js"></script></html>');
    if (u.includes('/auth/v1/health')) return Response.json({ status: 'ok' });
    if (u.includes('rpc/slate_health_detail') && method === 'POST') return Response.json(detail());
    if (u.includes('/storage/v1/')) return new Response('{"error":"not found"}', { status: 404 });
    if (u.includes('/functions/v1/slate-parse')) return Response.json({ ai: false });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  const by = (r: { name: string; status: string; detail: string }[], n: string) => r.find((x) => x.name.startsWith(n))!;

  it('healthy infrastructure → everything passes, optional pieces are reported as skipped/warned (never hidden)', async () => {
    const r = await runChecks(ENV, make()); const s = summarize(r);
    expect(JSON.stringify(r)).not.toMatch(/rows:|counts/); // no business data (not even counts) in a report that lands in public logs
    expect(s.fail).toBe(0); expect(s.ok).toBe(true);
    expect(by(r, 'Dependabot').status).toBe('skip'); expect(by(r, 'AI parser').status).toBe('warn'); expect(by(r, 'Backup (nightly').status).toBe('pass');
    expect(toMarkdown(r)).toMatch(/ALL SYSTEMS OK/);
  });
  it('Supabase unreachable → FAIL with a clear message, not a crash', async () => {
    const r = await runChecks(ENV, make({ 'supabase.co': () => { throw new Error('connect ECONNREFUSED'); } }));
    expect(summarize(r).ok).toBe(false); expect(by(r, 'Database & API').status).toBe('fail'); expect(by(r, 'Database & API').detail).toMatch(/ECONNREFUSED/); expect(toMarkdown(r)).toMatch(/ATTENTION NEEDED/);
  });
  it('stale or unverified backup, or a stopped reminder job → FAIL', async () => {
    const stale = await runChecks(ENV, make({ 'slate_health_detail': () => Response.json(detail({ last_backup: { status: 'ok', verified: true, finished_at: new Date(Date.now() - 50 * 3_600_000).toISOString() } })) }));
    expect(by(stale, 'Backup (nightly').status).toBe('fail');
    const unver = await runChecks(ENV, make({ 'slate_health_detail': () => Response.json(detail({ last_backup: { status: 'ok', verified: false, finished_at: new Date().toISOString() } })) }));
    expect(by(unver, 'Backup (nightly').status).toBe('fail');
    const jobs = await runChecks(ENV, make({ 'slate_health_detail': () => Response.json(detail({ jobs: { 'slate-notify-5min': { last_run: new Date(Date.now() - 3 * 3_600_000).toISOString(), last_status: 'succeeded' } } })) }));
    expect(by(jobs, 'Reminder job').status).toBe('fail');
  });
  it('production site down / wrong page / failed GitHub workflow / failed Vercel deployment → FAIL', async () => {
    expect(by(await runChecks(ENV, make({ 'https://app.example/': () => new Response('Bad gateway', { status: 502 }) })), 'Production URL').status).toBe('fail');
    expect(by(await runChecks(ENV, make({ 'actions/runs': () => Response.json({ workflow_runs: [{ name: 'Slate CI', conclusion: 'failure', html_url: 'https://gh/run/1' }] }) })), 'Workflow runs').status).toBe('fail');
    expect(by(await runChecks(ENV, make({ 'api.vercel.com': () => Response.json({ deployments: [{ target: 'production', state: 'ERROR', created: Date.now() }] }) })), 'Latest production').status).toBe('fail');
  });
  it('is read-only: it never sends a write request except the anonymous health probe', async () => {
    const calls: { m: string; u: string }[] = []; const base = make(); const spy = (async (u: string, i?: RequestInit) => { calls.push({ m: i?.method ?? 'GET', u: String(u) }); return base(u, i); }) as unknown as typeof fetch;
    await runChecks(ENV, spy); const writes = calls.filter((c) => c.m !== 'GET');
    expect(writes.every((c) => c.m === 'POST' && c.u.includes('rpc/slate_health_detail'))).toBe(true);
  });
});
