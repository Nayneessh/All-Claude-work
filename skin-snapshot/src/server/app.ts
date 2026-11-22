// The HTTP API. Hono, so the same app runs inside Next.js on Vercel (src/app/api) or on any Node host
// (src/server/standalone.ts). No Vercel-specific code in here.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { isConsentKey } from '../core/consent';
import { isLang, type Lang } from '../core/types';
import { scanText } from '../core/lexicon';
import * as repo from '../data/repo';
import type { StaffClaims } from '../data/db';
import type { Deps } from './deps';
import { MAX_UPLOAD_BYTES } from './images';
import { runPurge } from './purge';
import {
  HttpError, book, completePhoto, createCaptureSession as createCapture, createCase, deleteCaseFully, getVisitorState, initPhoto, receiveUpload,
  recordEvent, resolveCase, retakePhotos, saveAnswers, startAnalysis, switchPath, withdrawConsent, drainStorageDeletions,
} from './service';
import { signToken, verifyToken } from './signing';
import { ConfigError } from './config';
import { log } from './analysis';

type Env = { Variables: { deps: Deps } };

const clientIp = (c: Context) => (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown');

export function createApp(getDeps: () => Promise<Deps>) {
  const app = new Hono<Env>().basePath('/api');

  // No caching, no indexing, no referrer for any API response.
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.use('*', async (c, next) => {
    try {
      c.set('deps', await getDeps());
    } catch (e) {
      if (e instanceof ConfigError) return c.json({ error: 'not_configured', message: e.message }, 503);
      throw e;
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: 'invalid_request' }, 422);
    if (err instanceof ConfigError) return c.json({ error: 'not_configured', message: err.message }, 503);
    const msg = String((err as Error)?.message ?? '');
    if (/forbidden/.test(msg)) return c.json({ error: 'forbidden' }, 403);
    if (/not_found/.test(msg)) return c.json({ error: 'not_found' }, 404);
    if (/bad_status|invalid input/.test(msg)) return c.json({ error: 'invalid_request' }, 422);
    log('api.error', { path: c.req.path, name: (err as Error)?.name });
    return c.json({ error: 'internal' }, 500);
  });

  const deps = (c: Context<Env>) => c.get('deps');
  const ctx = (c: Context) => ({ ip: clientIp(c), ua: c.req.header('user-agent') });
  const json = async (c: Context) => {
    try {
      return await c.req.json();
    } catch {
      throw new HttpError(400, 'invalid_json');
    }
  };
  const langOf = (c: Context): Lang | undefined => {
    const l = c.req.query('lang');
    return isLang(l) ? l : undefined;
  };
  const tokens = (c: Context) => ({ caseToken: c.req.header('x-case-token'), captureToken: c.req.header('x-capture-token') });
  const fullCase = async (c: Context<Env>) => {
    const r = await resolveCase(deps(c), tokens(c));
    if (r.scope !== 'full') throw new HttpError(403, 'forbidden');
    return r.c;
  };
  const anyCase = async (c: Context<Env>) => (await resolveCase(deps(c), tokens(c)));

  // ---------------------------------------------------------------- public
  app.get('/health', async (c) => {
    const d = deps(c);
    try {
      await d.db.query('select 1');
      return c.json({ ok: true, db: 'ok', ai: d.ai.name, storage: d.store.kind, env: d.config.env });
    } catch {
      return c.json({ ok: false, db: 'down' }, 503);
    }
  });

  app.get('/config', async (c) => {
    const d = deps(c);
    const s = await d.settings();
    return c.json({
      testBanner: d.config.testBanner, botcheck: d.botcheck.kind, servicePromise: s.servicePromise, whatsappConfigured: Boolean(s.whatsappNumber),
      maintenance: s.maintenanceMode, unbookedHours: s.retentionUnbookedHours, closedDays: s.retentionClosedDays,
    });
  });

  app.get('/botcheck', async (c) => c.json({ challenge: await deps(c).botcheck.challenge() }));
  app.post('/events', async (c) => {
    await recordEvent(deps(c), await json(c), ctx(c));
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- visitor case
  app.post('/cases', async (c) => c.json(await createCase(deps(c), await json(c), ctx(c)), 201));

  app.get('/case', async (c) => {
    const { c: row } = await anyCase(c);
    return c.json(await getVisitorState(deps(c), row, langOf(c)));
  });

  app.post('/case/answers', async (c) => {
    const row = await fullCase(c);
    return c.json(await saveAnswers(deps(c), row, await json(c)));
  });

  app.post('/case/switch-path', async (c) => {
    const row = await fullCase(c);
    const b = await json(c);
    return c.json(await switchPath(deps(c), row, b?.path));
  });

  app.post('/case/photos', async (c) => {
    const { c: row } = await anyCase(c);
    return c.json(await initPhoto(deps(c), row, await json(c)));
  });

  app.put('/uploads/:photoId', async (c) => {
    const d = deps(c);
    const tok = await verifyToken(d.config.signingSecret, c.req.query('t') ?? '', 'upload');
    if (!tok || tok.id !== c.req.param('photoId')) throw new HttpError(403, 'forbidden');
    const buf = new Uint8Array(await c.req.arrayBuffer());
    await receiveUpload(d, tok.id, buf, tok.max ?? MAX_UPLOAD_BYTES);
    return c.body(null, 204);
  });

  app.post('/case/photos/:photoId/complete', async (c) => {
    const { c: row } = await anyCase(c);
    return c.json(await completePhoto(deps(c), row, c.req.param('photoId')));
  });

  app.post('/case/analyze', async (c) => {
    const row = await fullCase(c);
    const r = await startAnalysis(deps(c), row);
    return c.json({ ...r });
  });

  app.post('/case/retake', async (c) => {
    const row = await fullCase(c);
    await retakePhotos(deps(c), row);
    return c.body(null, 204);
  });

  app.post('/case/capture-session', async (c) => {
    const row = await fullCase(c);
    return c.json(await createCapture(deps(c), row), 201);
  });

  app.post('/case/booking', async (c) => {
    const row = await fullCase(c);
    const b = await json(c);
    await book(deps(c), row, b, ctx(c), isLang(b?.lang) ? b.lang : undefined);
    const fresh = (await repo.getCaseById(deps(c).db, row.id))!;
    return c.json(await getVisitorState(deps(c), fresh, isLang(b?.lang) ? b.lang : undefined), 201);
  });

  app.post('/case/consents/:key/withdraw', async (c) => {
    const row = await fullCase(c);
    const key = c.req.param('key');
    if (!isConsentKey(key)) throw new HttpError(404, 'not_found');
    return c.json(await withdrawConsent(deps(c), row, key));
  });

  app.delete('/case', async (c) => {
    const row = await fullCase(c);
    await deleteCaseFully(deps(c), row, 'visitor_request');
    return c.json({ deleted: true });
  });

  // ---------------------------------------------------------------- development sign-in (never available in staging or production)
  app.post('/dev/token', async (c) => {
    const d = deps(c);
    if (d.config.authProvider !== 'dev' || d.config.isProd) throw new HttpError(404, 'not_found');
    const b = z.object({ role: z.enum(['admin', 'cosmetologist']), aal: z.enum(['aal1', 'aal2']).default('aal2') }).parse(await json(c));
    const id = b.role === 'admin' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const email = b.role === 'admin' ? 'admin@example.test' : 'cosmo@example.test';
    await d.db.query(`insert into ss.staff (user_id, email, role) values ($1,$2,$3) on conflict do nothing`, [id, email, b.role]);
    const { DevAuth } = await import('./auth');
    return c.json({ token: await DevAuth.mint(d.config.signingSecret, { sub: id, email, aal: b.aal }) });
  });

  // ---------------------------------------------------------------- jobs
  const purgeHandler = async (c: Context<Env>) => {
    const d = deps(c);
    const auth = c.req.header('authorization');
    if (!d.config.cronSecret || auth !== `Bearer ${d.config.cronSecret}`) throw new HttpError(401, 'unauthorized');
    return c.json(await runPurge(d));
  };
  app.get('/jobs/purge', purgeHandler);
  app.post('/jobs/purge', purgeHandler);

  // ---------------------------------------------------------------- console
  const staff = async (c: Context<Env>): Promise<StaffClaims> => {
    const h = c.req.header('authorization') ?? '';
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) throw new HttpError(401, 'unauthorized');
    const claims = await deps(c).auth.verify(m[1]!);
    if (!claims) throw new HttpError(401, 'unauthorized');
    return claims;
  };
  const asStaff = async <T>(c: Context<Env>, fn: (q: import('../data/db').Queryable) => Promise<T>) => deps(c).db.asStaff(await staff(c), fn);
  const call = async (c: Context<Env>, sql: string, params: unknown[] = []) => asStaff(c, async (q) => (await q.query<{ r: any }>(`select ${sql} as r`, params))[0]!.r);

  const photoUrls = async (c: Context<Env>, claims: StaffClaims, photos: { id: string; slot: string; width?: number; height?: number }[]) => {
    const d = deps(c);
    const exp = Math.floor(Date.now() / 1000) + 60;
    return Promise.all(
      photos.map(async (p) => ({ id: p.id, slot: p.slot, width: p.width, height: p.height, url: `/api/media/${encodeURIComponent(await signToken(d.config.signingSecret, { a: 'view', id: p.id, exp, by: claims.sub, byEmail: claims.email }))}` })),
    );
  };

  app.get('/console/me', async (c) => c.json(await call(c, 'ss.console_me()')));

  app.get('/console/cases', async (c) => {
    const q = c.req.query();
    return c.json(await call(c, 'ss.console_list_cases($1,$2,$3,$4,$5)', [q.path || null, q.status || null, q.flagged === 'true' ? true : q.flagged === 'false' ? false : null, Number(q.limit ?? 50), Number(q.offset ?? 0)]));
  });

  app.get('/console/cases/:id', async (c) => {
    const claims = await staff(c);
    const out = await deps(c).db.asStaff(claims, async (q) => (await q.query<{ r: any }>(`select ss.console_open_case($1::uuid) as r`, [c.req.param('id')]))[0]!.r);
    if (out.photos) out.photos = await photoUrls(c, claims, out.photos);
    return c.json(out);
  });

  app.post('/console/cases/:id/status', async (c) => {
    const b = z.object({ status: z.enum(['requested', 'contacted', 'scheduled', 'completed', 'no_response', 'closed']) }).parse(await json(c));
    const s = await deps(c).settings();
    return c.json(await call(c, 'ss.console_set_status($1::uuid,$2,$3)', [c.req.param('id'), b.status, s.retentionClosedDays]));
  });

  app.post('/console/cases/:id/notes', async (c) => {
    const b = z.object({ body: z.string().trim().min(1).max(4000) }).parse(await json(c));
    return c.json({ id: await call(c, 'ss.console_add_note($1::uuid,$2)', [c.req.param('id'), b.body]) }, 201);
  });

  app.post('/console/cases/:id/feedback', async (c) => {
    const b = z
      .object({
        analysisId: z.string().uuid().nullable().optional(),
        kind: z.enum(['observation', 'missed_flag', 'false_flag']).default('observation'),
        zone: z.string().max(30).nullable().optional(),
        attribute: z.string().max(30).nullable().optional(),
        verdict: z.enum(['agree', 'disagree']),
        comment: z.string().max(500).nullable().optional(),
      })
      .parse(await json(c));
    await call(c, 'ss.console_feedback($1::uuid,$2::uuid,$3,$4,$5,$6,$7)', [c.req.param('id'), b.analysisId ?? null, b.kind, b.zone ?? null, b.attribute ?? null, b.verdict, b.comment ?? null]);
    return c.body(null, 204);
  });

  app.delete('/console/cases/:id', async (c) => {
    await call(c, 'ss.console_delete_case($1::uuid)', [c.req.param('id')]);
    await drainStorageDeletions(deps(c));
    return c.body(null, 204);
  });

  app.get('/console/cases/:id/export', async (c) => {
    const claims = await staff(c);
    const out = await deps(c).db.asStaff(claims, async (q) => (await q.query<{ r: any }>(`select ss.console_export_case($1::uuid) as r`, [c.req.param('id')]))[0]!.r);
    if (out.photos) out.photos = await photoUrls(c, claims, out.photos);
    c.header('Content-Disposition', `attachment; filename="case-${out.code}.json"`);
    return c.json(out);
  });

  app.post('/console/cases/:id/block-number', async (c) => {
    const b = z.object({ reason: z.string().max(200).default('') }).parse(await json(c));
    await asStaff(c, async (q) => {
      const h = (await q.query<{ r: string }>(`select ss.console_booking_number_hash($1::uuid) as r`, [c.req.param('id')]))[0]!.r;
      if (!h) throw new HttpError(404, 'not_found');
      await q.query(`select ss.console_block_number($1,$2)`, [h, b.reason]);
    });
    return c.body(null, 204);
  });

  app.get('/console/templates', async (c) => c.json(await call(c, 'ss.console_list_templates()')));

  const templateBody = z.object({
    name: z.string().trim().min(1).max(120),
    steps: z.union([z.literal(2), z.literal(3)]),
    skinFeel: z.enum(['dry', 'balanced', 'oily', 'any']),
    sensitivity: z.enum(['low', 'high', 'any']),
    budgetBands: z.array(z.enum(['under_500', 'b500_1500', 'b1500_3000', 'over_3000', 'prefer_not'])).max(5),
    items: z.array(z.object({ category: z.enum(['cleanser', 'moisturiser', 'sunscreen', 'other']), text_en: z.string().trim().min(1).max(400), text_hi: z.string().trim().min(1).max(400) }).strict()).min(2).max(3),
    approve: z.boolean(),
  });
  const saveTemplate = async (c: Context<Env>, id: string | null) => {
    const b = templateBody.parse(await json(c));
    // Condition names, treatment and medicine claims are not allowed in routine text, in either language.
    const hits = b.items.flatMap((i) => [...scanText(i.text_en, { numeric: false }), ...scanText(i.text_hi, { numeric: false })]);
    if (hits.length) throw new HttpError(422, 'banned_terms', 'Routine text may not name conditions, treatments or medicines.', { terms: hits.map((h) => h.term) });
    if (b.items.length !== b.steps) throw new HttpError(422, 'invalid_request', 'The number of items must equal the number of steps.');
    return call(c, 'ss.console_save_template($1::uuid,$2,$3,$4,$5,$6::text[],$7::jsonb,$8)', [id, b.name, b.steps, b.skinFeel, b.sensitivity, b.budgetBands, JSON.stringify(b.items), b.approve]);
  };
  app.post('/console/templates', async (c) => c.json({ id: await saveTemplate(c, null) }, 201));
  app.put('/console/templates/:id', async (c) => c.json({ id: await saveTemplate(c, c.req.param('id')) }));
  app.delete('/console/templates/:id', async (c) => {
    await call(c, 'ss.console_delete_template($1::uuid)', [c.req.param('id')]);
    return c.body(null, 204);
  });

  app.get('/console/stats', async (c) => c.json(await call(c, 'ss.console_counts($1)', [Number(c.req.query('weeks') ?? 8)])));
  app.get('/console/access-log', async (c) => c.json(await call(c, 'ss.console_access_log($1,$2)', [Number(c.req.query('limit') ?? 100), c.req.query('before') ? Number(c.req.query('before')) : null])));
  app.get('/console/staff', async (c) => c.json(await call(c, 'ss.console_staff()')));
  app.get('/console/settings', async (c) => c.json(await call(c, 'ss.console_get_settings()')));
  app.put('/console/settings/:key', async (c) => {
    const key = c.req.param('key');
    if (!['allow_sample_routines', 'gate_b_min_confidence', 'service_promise', 'whatsapp_number', 'maintenance_mode', 'ai_mock_scenario'].includes(key)) throw new HttpError(404, 'not_found');
    const b = z.object({ value: z.union([z.string().max(200), z.number(), z.boolean()]) }).parse(await json(c));
    await call(c, 'ss.console_set_setting($1,$2::jsonb)', [key, JSON.stringify(b.value)]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- signed photo view (staff only, 60 s links)
  app.get('/media/:token', async (c) => {
    const d = deps(c);
    const tok = await verifyToken(d.config.signingSecret, decodeURIComponent(c.req.param('token')), 'view');
    if (!tok) throw new HttpError(403, 'forbidden');
    const photo = await repo.getPhoto(d.db, tok.id);
    if (!photo?.object_key) throw new HttpError(404, 'not_found');
    const obj = await d.store.get(photo.object_key);
    if (!obj) throw new HttpError(404, 'not_found');
    await d.db.query(`insert into ss.access_log (actor, actor_email, action, case_id, case_code, meta) values ($1,$2,'view_photo',$3,(select code from ss.cases where id=$3),$4::jsonb)`, [tok.by ?? null, tok.byEmail ?? null, photo.case_id, JSON.stringify({ slot: photo.slot })]);
    return new Response(obj.bytes as BodyInit, { headers: { 'content-type': obj.contentType, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
