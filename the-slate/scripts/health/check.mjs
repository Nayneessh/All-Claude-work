#!/usr/bin/env node
// THE SLATE — daily infrastructure health check (GitHub · Vercel · Supabase). STRICTLY READ-ONLY: it only performs GET requests and the
// anonymous `slate_health_detail` probe. It never redeploys, deletes or changes anything. Exit code 1 = at least one FAIL.
//   node scripts/health/check.mjs [--out report.md] [--json report.json]
// Configuration (env): see docs/MONITORING.md. Anything not configured is reported as SKIP, never silently ignored.
import { writeFileSync } from 'node:fs';

const T = (ms) => AbortSignal.timeout(ms);
const hours = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Infinity);
const mins = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : Infinity);

export async function runChecks(env = process.env, f = fetch) {
  const out = [];
  const add = (group, name, status, detail = '') => out.push({ group, name, status, detail });
  const guard = async (group, name, fn) => { try { await fn(); } catch (e) { add(group, name, 'fail', `${e.name === 'TimeoutError' ? 'timed out' : e.message}`); } };
  const gh = (path) => f(`https://api.github.com${path}`, { signal: T(15000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'slate-health', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) } });

  // ───────────────────────── GitHub
  const repo = env.GITHUB_REPOSITORY;
  if (!repo) add('GitHub', 'repository', 'skip', 'GITHUB_REPOSITORY not set');
  else {
    await guard('GitHub', 'Repository available', async () => { const r = await gh(`/repos/${repo}`); add('GitHub', 'Repository available', r.ok ? 'pass' : 'fail', `${repo} → HTTP ${r.status}`); });
    await guard('GitHub', 'Latest change to the-slate/', async () => { const r = await gh(`/repos/${repo}/commits?path=the-slate&per_page=1`); const j = r.ok ? await r.json() : []; const c = j[0];
      add('GitHub', 'Latest change to the-slate/', r.ok ? 'pass' : 'warn', c ? `${c.sha.slice(0, 7)} · ${c.commit.committer.date} · ${c.commit.message.split('\n')[0].slice(0, 80)}` : `HTTP ${r.status}`); });
    await guard('GitHub', 'Workflow runs', async () => {
      const r = await gh(`/repos/${repo}/actions/runs?per_page=50`); if (!r.ok) return add('GitHub', 'Workflow runs', 'warn', `HTTP ${r.status}`);
      const runs = (await r.json()).workflow_runs.filter((x) => /^slate/i.test(x.name)); const latest = new Map(); for (const x of runs) if (!latest.has(x.name)) latest.set(x.name, x);
      const bad = [...latest.values()].filter((x) => x.conclusion === 'failure');
      if (!latest.size) add('GitHub', 'Workflow runs', 'warn', 'no “Slate …” workflow runs found yet (workflows run after merge to main)');
      else add('GitHub', 'Workflow runs', bad.length ? 'fail' : 'pass', bad.length ? `failing: ${bad.map((x) => `${x.name} (${x.html_url})`).join(', ')}` : `${latest.size} workflow(s), latest runs OK`);
    });
    for (const [kind, label] of [['dependabot/alerts', 'Dependabot alerts'], ['secret-scanning/alerts', 'Secret-scanning alerts']]) await guard('GitHub', label, async () => {
      const r = await gh(`/repos/${repo}/${kind}?state=open&per_page=100`);
      if ([401, 403, 404].includes(r.status)) return add('GitHub', label, 'skip', `not accessible with this token (HTTP ${r.status}); needs a token with security-events read`);
      if (!r.ok) return add('GitHub', label, 'warn', `HTTP ${r.status}`);
      const a = await r.json(); const sev = (s) => a.filter((x) => (x.security_advisory?.severity ?? x.severity) === s).length;
      add('GitHub', label, kind.startsWith('secret') ? (a.length ? 'fail' : 'pass') : sev('critical') + sev('high') ? 'fail' : a.length ? 'warn' : 'pass', `${a.length} open${a.length && !kind.startsWith('secret') ? ` (critical ${sev('critical')}, high ${sev('high')})` : ''}`);
    });
  }

  // ───────────────────────── Vercel / production URL
  const app = (env.APP_URL ?? '').replace(/\/$/, '');
  if (!app) add('Vercel', 'production URL', 'skip', 'APP_URL not set');
  else {
    await guard('Vercel', 'Production URL available', async () => {
      const t0 = Date.now(); const r = await f(app + '/', { signal: T(20000), redirect: 'follow' }); const html = await r.text(); const ms = Date.now() - t0;
      add('Vercel', 'Production URL available', r.ok && /<title>THE SLATE/i.test(html) ? (ms > 3000 ? 'warn' : 'pass') : 'fail', `HTTP ${r.status} in ${ms} ms${/<title>THE SLATE/i.test(html) ? '' : ' — page is not THE SLATE'}`);
      const src = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
      if (src) { const a = await f(new URL(src, app + '/').href, { signal: T(20000) }); add('Vercel', 'App bundle loads', a.ok ? 'pass' : 'fail', `${src} → HTTP ${a.status}`); } else add('Vercel', 'App bundle loads', 'fail', 'no script tag found in the page');
      const d = await f(app + '/mandates', { signal: T(20000) }); add('Vercel', 'Deep link (SPA fallback)', d.ok ? 'pass' : 'fail', `/mandates → HTTP ${d.status}`);
    });
    if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) add('Vercel', 'Deployment status & build failures', 'skip', 'VERCEL_TOKEN / VERCEL_PROJECT_ID not set');
    else await guard('Vercel', 'Deployment status & build failures', async () => {
      const q = new URLSearchParams({ projectId: env.VERCEL_PROJECT_ID, limit: '20', ...(env.VERCEL_TEAM_ID ? { teamId: env.VERCEL_TEAM_ID } : {}) });
      const r = await f(`https://api.vercel.com/v6/deployments?${q}`, { signal: T(20000), headers: { authorization: `Bearer ${env.VERCEL_TOKEN}` } });
      if (!r.ok) return add('Vercel', 'Deployment status & build failures', 'fail', `API HTTP ${r.status}`);
      const d = (await r.json()).deployments ?? []; const prod = d.find((x) => x.target === 'production'); const recentErr = d.filter((x) => x.state === 'ERROR' && hours(new Date(x.created).toISOString()) < 24);
      add('Vercel', 'Latest production deployment', !prod ? 'warn' : prod.state === 'READY' ? 'pass' : 'fail', prod ? `${prod.state} · ${new Date(prod.created).toISOString()}` : 'none found');
      add('Vercel', 'Build failures (24 h)', recentErr.length ? 'warn' : 'pass', `${recentErr.length} failed build(s)`);
    });
  }

  // ───────────────────────── Supabase
  const sb = (env.SUPABASE_URL ?? '').replace(/\/$/, ''); const key = env.SUPABASE_ANON_KEY ?? '';
  if (!sb || !key) add('Supabase', 'project', 'skip', 'SUPABASE_URL / SUPABASE_ANON_KEY not set');
  else {
    const H = { apikey: key, authorization: `Bearer ${key}` };
    await guard('Supabase', 'Auth service', async () => { const r = await f(`${sb}/auth/v1/health`, { signal: T(15000), headers: H }); add('Supabase', 'Auth service', r.ok ? 'pass' : 'fail', `HTTP ${r.status}`); });
    let detail = null;
    await guard('Supabase', 'Database & API connection', async () => {
      const t0 = Date.now(); const r = await f(`${sb}/rest/v1/rpc/slate_health_detail`, { method: 'POST', signal: T(20000), headers: { ...H, 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) return add('Supabase', 'Database & API connection', 'fail', `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      detail = await r.json(); add('Supabase', 'Database & API connection', detail.ok ? 'pass' : 'fail', `answered in ${Date.now() - t0} ms`);
    });
    if (detail) {
      const b = detail.last_backup;
      if (!b) add('Supabase', 'Backup', 'warn', 'no backup has run yet');
      else add('Supabase', 'Backup (nightly, verified)', b.status === 'ok' && b.verified && hours(b.finished_at) < 36 ? 'pass' : 'fail', `${b.status}${b.verified ? ', verified' : ', NOT verified'} · ${b.finished_at} · ${Math.round(hours(b.finished_at))} h ago`);
      const jn = detail.jobs?.['slate-notify-5min'], jb = detail.jobs?.['slate-backup-daily'];
      if (detail.jobs?.error || !jn) add('Supabase', 'Scheduled jobs', 'warn', detail.jobs?.error ?? 'job status not readable');
      else {
        add('Supabase', 'Reminder job (every 5 min)', mins(jn.last_run) < 20 && jn.last_status === 'succeeded' ? 'pass' : 'fail', `${jn.last_status} · ${Math.round(mins(jn.last_run))} min ago`);
        add('Supabase', 'Backup job (nightly)', jb && hours(jb.last_run) < 36 && jb.last_status === 'succeeded' ? 'pass' : 'warn', jb ? `${jb.last_status} · ${Math.round(hours(jb.last_run))} h ago` : 'not scheduled');
      }
    }
    await guard('Supabase', 'Storage service', async () => { const r = await f(`${sb}/storage/v1/object/public/slate-health-probe/none`, { signal: T(15000), headers: H }); add('Supabase', 'Storage service', r.status < 500 ? 'pass' : 'fail', `API answered HTTP ${r.status}`); });
    await guard('Supabase', 'AI parser function', async () => { const r = await f(`${sb}/functions/v1/slate-parse`, { signal: T(15000), headers: H }); const j = r.ok ? await r.json() : null;
      add('Supabase', 'AI parser function', !r.ok ? 'fail' : j.ai ? 'pass' : 'warn', !r.ok ? `HTTP ${r.status}` : j.ai ? `AI enabled (${j.model})` : 'deployed; no ANTHROPIC_API_KEY set → the built-in rule-based reader is used'); });
    if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) add('Supabase', 'Platform status & platform backups', 'skip', 'SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set');
    else await guard('Supabase', 'Platform status & platform backups', async () => {
      const m = { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` };
      const p = await f(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}`, { signal: T(20000), headers: m }); const pj = p.ok ? await p.json() : null;
      add('Supabase', 'Project status', pj?.status === 'ACTIVE_HEALTHY' ? 'pass' : 'fail', pj ? pj.status : `HTTP ${p.status}`);
      const b = await f(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/backups`, { signal: T(20000), headers: m });
      if (!b.ok) add('Supabase', 'Platform (Supabase-managed) backups', 'warn', `not available (HTTP ${b.status}) — free plans have none; THE SLATE's own nightly backup is the safety net`);
      else { const bj = await b.json(); const n = bj.backups?.length ?? 0; add('Supabase', 'Platform (Supabase-managed) backups', n ? 'pass' : 'warn', `${n} backup(s)${bj.pitr_enabled ? ', PITR on' : ''}`); }
    });
  }
  return out;
}

export function summarize(results) { const c = (s) => results.filter((r) => r.status === s).length; return { pass: c('pass'), warn: c('warn'), fail: c('fail'), skip: c('skip'), ok: c('fail') === 0 }; }
export function toMarkdown(results, now = new Date()) {
  const s = summarize(results); const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(now);
  const icon = { pass: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };
  let md = `# THE SLATE — daily health report\n\n**${s.ok ? '✅ ALL SYSTEMS OK' : '❌ ATTENTION NEEDED'}** · checked ${now.toISOString()} UTC (${ist} IST)\n\n${s.pass} passed · ${s.warn} warnings · ${s.fail} failed · ${s.skip} skipped\n`;
  for (const g of [...new Set(results.map((r) => r.group))]) { md += `\n## ${g}\n\n| | Check | Result |\n|---|---|---|\n`; for (const r of results.filter((x) => x.group === g)) md += `| ${icon[r.status]} | ${r.name} | ${String(r.detail).replace(/\|/g, '\\|')} |\n`; }
  return md + '\n_Read-only check. Nothing was changed, redeployed or deleted._\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const results = await runChecks(); const md = toMarkdown(results); console.log(md);
  if (arg('--out')) writeFileSync(arg('--out'), md); if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ checked_at: new Date().toISOString(), summary: summarize(results), results }, null, 2));
  if (process.env.ALERT_WEBHOOK_URL && !summarize(results).ok) { // optional extra channel (Slack/Discord/ntfy compatible)
    const bad = results.filter((r) => r.status === 'fail').map((r) => `• ${r.group}: ${r.name} — ${r.detail}`).join('\n');
    await fetch(process.env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `THE SLATE health check FAILED\n${bad}`, content: `THE SLATE health check FAILED\n${bad}` }) }).catch(() => {});
  }
  process.exit(summarize(results).ok ? 0 : 1);
}
