import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../src/server/app';
import { S3Store } from '../src/storage';
import { signToken, verifyToken } from '../src/server/signing';
import { setup } from './api-harness';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('module boundaries (hosting and vendor independence)', () => {
  it('src/core is pure: it imports only itself, zod and libphonenumber-js, never I/O, frameworks or vendors', () => {
    for (const f of files('src/core')) {
      for (const i of imports(f)) {
        const ok = i.startsWith('./') || i === 'zod' || i === 'libphonenumber-js/min';
        expect(ok, `${f} imports ${i}`).toBe(true);
      }
    }
  });
  it('no Vercel- or Supabase-specific code outside the adapters that isolate them', () => {
    const allowed = new Set(['src/ai/providers.ts', 'src/server/auth.ts', 'src/lib/console.ts', 'src/server/config.ts', 'src/server/deps.ts', 'src/app/api/[[...route]]/route.ts', 'src/server/app.ts']);
    for (const f of files('src')) {
      const text = readFileSync(f, 'utf8');
      const vendor = /@vercel\/|@supabase\/|hono\/vercel/.test(text);
      if (vendor) expect(allowed.has(f), `${f} references a hosting/vendor package`).toBe(true);
    }
  });
  it('the data layer is the only code that writes SQL for application tables', () => {
    for (const f of files('src')) {
      if (f.startsWith('src/data/') || f.startsWith('src/server/')) continue;
      const text = readFileSync(f, 'utf8');
      expect(/\bss\.[a-z_]+/.test(text) && /select |insert into |update ss\./i.test(text), `${f} contains SQL`).toBe(false);
    }
  });
  it('no secrets or hosts are hard-coded: server code reads configuration only through server/config.ts', () => {
    for (const f of files('src')) {
      if (f === 'src/server/config.ts' || f === 'src/lib/siteenv.ts' || f.startsWith('src/app/') || f.startsWith('src/components/') || f === 'src/lib/console.ts') continue;
      const text = readFileSync(f, 'utf8');
      const reads = [...text.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]!).filter((r) => !r.startsWith('NEXT_PUBLIC_')); // public browser values are allowed
      for (const r of reads) expect(['DB_POOL_MAX', 'NODE_ENV', 'PORT'], `${f} reads process.env.${r}`).toContain(r);
    }
  });
});

describe('portability', () => {
  it('the API runs on a plain Node HTTP server with no Next.js or Vercel involved', async () => {
    const h = await setup();
    const server = serve({ fetch: createApp(async () => h.deps).fetch, port: 0 });
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, storage: 'postgres' });
    const created = await fetch(`http://127.0.0.1:${port}/api/cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: 'en', path: 'scars', ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true } }) });
    expect(created.status).toBe(201);
    server.close();
    await h.db.close();
  });
  it('S3-compatible storage adapter produces short-lived presigned upload URLs and never leaks the secret', async () => {
    const s3 = new S3Store({ endpoint: 'https://s3.example.test', region: 'ap-south-1', bucket: 'photos', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLEKEY' });
    const url = (await s3.presignUpload('cases/abc/def.upload', 'image/jpeg', 300))!;
    expect(url).toMatch(/^https:\/\/s3\.example\.test\/photos\/cases\/abc\/def\.upload\?/);
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).not.toContain('SECRETEXAMPLEKEY');
  });
  it('signed links expire and are bound to one action', async () => {
    const now = Date.now();
    const t = await signToken('k', { a: 'view', id: 'p1', exp: Math.floor(now / 1000) + 60 });
    expect(await verifyToken('k', t, 'view', now)).toMatchObject({ id: 'p1' });
    expect(await verifyToken('k', t, 'upload', now)).toBeNull();
    expect(await verifyToken('other', t, 'view', now)).toBeNull();
    expect(await verifyToken('k', t, 'view', now + 61_000)).toBeNull();
  });
});

describe('development sign-in is unavailable outside development', () => {
  it('refuses to start in staging or production with the development auth provider or the mock AI', async () => {
    const { loadConfig } = await import('../src/server/config');
    expect(() => loadConfig({ APP_ENV: 'staging', AUTH_PROVIDER: 'dev', SIGNING_SECRET: 'x' })).toThrow(/AUTH_PROVIDER=dev/);
    expect(() => loadConfig({ APP_ENV: 'production', AI_PROVIDER: 'mock', SIGNING_SECRET: 'x' })).toThrow(/mock/);
    expect(() => loadConfig({ APP_ENV: 'production', SIGNING_SECRET: 'x', AUTH_PROVIDER: 'supabase', AI_PROVIDER: 'openai-compatible' })).not.toThrow();
  });
  it('/api/dev/token does not exist when the provider is not "dev"', async () => {
    const h = await setup({}, {});
    (h.deps.config as { authProvider: string }).authProvider = 'supabase';
    const r = await h.call('POST', '/api/dev/token', { body: { role: 'admin' } });
    expect(r.status).toBe(404);
    await h.db.close();
  });
});

describe('retake', () => {
  it('clears photos and analysis but keeps answers and consents, and the case can capture again', async () => {
    const h = await setup();
    const f = await h.fullFlow('maintenance');
    expect((await h.call('GET', '/api/case', { token: f.token })).json.stage).toBe('snapshot_ready');
    expect((await h.call('POST', '/api/case/retake', { token: f.token })).status).toBe(204);
    const s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.stage).toBe('answers_done');
    expect(s.photos).toEqual([]);
    expect(s.hasAnswers).toBe(true);
    expect(s.consents).toContain('photos_ai');
    expect((await h.uploadPhoto(f.token, 'front')).done!.json.ok).toBe(true);
    await h.db.close();
  });
});

describe('Turnstile adapter (mocked network)', () => {
  it('accepts only when the provider says success, and never without a token', async () => {
    const { TurnstileBotCheck } = await import('../src/server/botcheck');
    const bc = new TurnstileBotCheck('secret');
    expect(await bc.verify(undefined, '1.2.3.4')).toBe(false);
    const real = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (_u: unknown, init: { body: URLSearchParams }) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({ success: init.body.get('response') === 'good' }));
    }) as typeof fetch;
    try {
      expect(await bc.verify('good', '1.2.3.4')).toBe(true);
      expect(await bc.verify('bad', '1.2.3.4')).toBe(false);
      expect(calls[0]).toContain('secret=secret');
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('hosted defaults', () => {
  it('a Vercel deployment without APP_ENV is staging with 24-hour retention; production must be explicit; the signing secret can derive from the database credential', async () => {
    const { loadConfig } = await import('../src/server/config');
    const c = loadConfig({ VERCEL: '1', NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@h/db' });
    expect(c.env).toBe('staging');
    expect(c.testBanner).toBe(true);
    expect(c.noindex).toBe(true);
    expect(c.retentionUnbookedHours).toBe(24);
    expect(c.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(loadConfig({ VERCEL: '1', NODE_ENV: 'production', APP_ENV: 'production', DATABASE_URL: 'x' }).env).toBe('production');
    expect(loadConfig({ VERCEL: '1', NODE_ENV: 'production', APP_ENV: 'production' }).signingSecret).toBe('');
    expect(loadConfig({ VERCEL: '1', NODE_ENV: 'production', SIGNING_SECRET: 'explicit', DATABASE_URL: 'x' }).signingSecret).toBe('explicit');
  });
  it('staging without a database runs on a temporary in-memory store; production never does', async () => {
    const { loadConfig } = await import('../src/server/config');
    const a = loadConfig({ VERCEL: '1', NODE_ENV: 'production' });
    const b = loadConfig({ VERCEL: '1', NODE_ENV: 'production' });
    expect(a.env).toBe('staging');
    expect(a.demoStore).toBe(true);
    expect(a.signingSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.signingSecret).not.toBe(b.signingSecret); // random per process, never a fixed value
    expect(loadConfig({ VERCEL: '1', NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@h/db' }).demoStore).toBe(false);
    const prod = loadConfig({ VERCEL: '1', NODE_ENV: 'production', APP_ENV: 'production' });
    expect(prod.demoStore).toBe(false);
    const { buildDeps, ConfigError } = Object.assign({}, await import('../src/server/deps'), await import('../src/server/config'));
    await expect(buildDeps(prod)).rejects.toBeInstanceOf(ConfigError);
  });
  it('a missing staff sign-in setting does not stop the public flow; only console calls report it', async () => {
    const { UnconfiguredAuth } = await import('../src/server/auth');
    await expect(new UnconfiguredAuth().verify()).rejects.toThrow(/not configured/);
  });
  it('admins can check the AI connection; cosmetologists cannot', async () => {
    const h = await setup();
    expect((await h.call('POST', '/api/console/ai-check', { staff: h.tokens.cosmo })).status).toBe(403);
    const r = await h.call('POST', '/api/console/ai-check', { staff: h.tokens.admin });
    expect(r.json).toMatchObject({ provider: 'mock', ok: true });
    await h.db.close();
  });
});
