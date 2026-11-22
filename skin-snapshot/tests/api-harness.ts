import sharp from 'sharp';
import { createApp } from '../src/server/app';
import { buildDeps, makeSettingsReader, type Deps } from '../src/server/deps';
import { loadConfig, type Config } from '../src/server/config';
import { DevAuth } from '../src/server/auth';
import { pgliteDb } from '../src/data/db';
import { validAnswers } from './helpers';
import { ADMIN, COSMO, NOBODY } from './db-harness';
import type { PathId } from '../src/core/types';

export const SECRET = 'test-signing-secret';

export async function makeJpeg(opts: { w?: number; h?: number; mean?: number; amp?: number; seed?: number; grad?: number } = {}): Promise<Buffer> {
  const { w = 640, h = 800, mean = 130, amp = 38, seed = 1, grad = 0.05 } = opts;
  const raw = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < raw.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((s >> 8) % 100) / 100 - 0.5;
    raw[i] = Math.max(0, Math.min(255, mean + noise * 2 * amp + ((i / 3) % w) * grad));
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

export async function setup(env: Record<string, string> = {}, over: Partial<Deps> = {}) {
  const config: Config = loadConfig({ APP_ENV: 'test', AI_PROVIDER: 'mock', AI_PASSES: '2', SIGNING_SECRET: SECRET, CRON_SECRET: 'cron-secret', WHATSAPP_NUMBER: '+919876500000', ...env });
  const db = over.db ?? (await pgliteDb());
  await db.query(`insert into ss.staff (user_id, email, role) values ($1,'admin@example.test','admin'),($2,'cosmo@example.test','cosmetologist') on conflict do nothing`, [ADMIN, COSMO]);
  const deps = await buildDeps(config, { db, settings: makeSettingsReader(config, db, 0), ...over });
  const app = createApp(async () => deps);
  const tok = (sub: string, email: string, aal: 'aal1' | 'aal2' = 'aal2') => DevAuth.mint(SECRET, { sub, email, aal });
  const tokens = {
    admin: await tok(ADMIN, 'admin@example.test'),
    cosmo: await tok(COSMO, 'cosmo@example.test'),
    cosmoWeak: await tok(COSMO, 'cosmo@example.test', 'aal1'),
    nobody: await tok(NOBODY, 'x@example.test'),
  };
  const call = async (method: string, path: string, opts: { token?: string; capture?: string; staff?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(opts.headers ?? {}) };
    if (opts.token) headers['x-case-token'] = opts.token;
    if (opts.capture) headers['x-capture-token'] = opts.capture;
    if (opts.staff) headers.authorization = `Bearer ${opts.staff}`;
    let body: BodyInit | undefined = opts.raw;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await app.request(path, { method, headers, body });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, res };
  };
  const startCase = async (path: PathId = 'maintenance', extra: Record<string, unknown> = {}) => {
    const r = await call('POST', '/api/cases', { body: { lang: 'en', path, ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true }, sessionId: 'sess-' + Math.random().toString(36).slice(2, 12), ...extra } });
    if (r.status !== 201) throw new Error('startCase failed: ' + r.text);
    return r.json.token as string;
  };
  const answer = (token: string, path: PathId, over: Record<string, unknown> = {}) => call('POST', '/api/case/answers', { token, body: { answers: { ...validAnswers(path), ...over } } });
  const uploadPhoto = async (token: string, slot: string, jpeg?: Buffer, viaCapture = false) => {
    const data = jpeg ?? (await makeJpeg({ seed: slot.length * 7 + 3 }));
    const init = await call('POST', '/api/case/photos', viaCapture ? { capture: token, body: { slot, contentType: 'image/jpeg', size: data.length } } : { token, body: { slot, contentType: 'image/jpeg', size: data.length } });
    if (init.status !== 200) return { init };
    const put = await call('PUT', init.json.uploadUrl, { raw: data as unknown as BodyInit });
    const done = await call('POST', `/api/case/photos/${init.json.photoId}/complete`, viaCapture ? { capture: token } : { token });
    return { init, put, done };
  };
  const fullFlow = async (path: PathId = 'maintenance', answers: Record<string, unknown> = {}) => {
    const token = await startCase(path);
    const a = await answer(token, path, answers);
    if (a.json?.stopped) return { token, stopped: true as const };
    for (const slot of ['front', 'left', 'right']) {
      const r = await uploadPhoto(token, slot);
      if (r.done?.json?.ok !== true) throw new Error(`photo ${slot} failed: ${JSON.stringify(r.done?.json ?? r.init.json)}`);
    }
    const an = await call('POST', '/api/case/analyze', { token });
    return { token, stopped: false as const, analyze: an };
  };
  const setSetting = (key: string, value: unknown) => call('PUT', `/api/console/settings/${key}`, { staff: tokens.admin, body: { value } });
  return { deps, db, app, call, tokens, startCase, answer, uploadPhoto, fullFlow, setSetting, config };
}
