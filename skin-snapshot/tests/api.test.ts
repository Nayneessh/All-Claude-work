import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setup, makeJpeg, SECRET } from './api-harness';
import { COSMO } from './db-harness';
import { validAnswers } from './helpers';
import { PowBotCheck, leadingZeroBits } from '../src/server/botcheck';
import { signToken } from '../src/server/signing';
import { scanAll } from '../src/core/lexicon';
import { phrase } from '../src/core/phrases';
import { snapshotPhraseKeys } from '../src/core/snapshot';

let h: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  h = await setup();
}, 120_000);
afterAll(async () => {
  await h.db.close();
});

describe('health and config', () => {
  it('reports health, and exposes only non-sensitive config', async () => {
    const r = await h.call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, db: 'ok', ai: 'mock', storage: 'postgres' });
    const c = await h.call('GET', '/api/config');
    expect(Object.keys(c.json).sort()).toEqual(['botcheck', 'closedDays', 'maintenance', 'servicePromise', 'testBanner', 'unbookedHours', 'whatsappConfigured']);
  });
  it('sends no-store, noindex and no-referrer headers on every response', async () => {
    const r = await h.call('GET', '/api/health');
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    expect(r.res.headers.get('x-robots-tag')).toContain('noindex');
    expect(r.res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('starting a case: age gate and consents', () => {
  const base = { lang: 'en', path: 'maintenance', ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true } };
  it.each([
    ['age not confirmed', { ageConfirmed: false }],
    ['privacy consent missing', { consents: { health: true, photos_ai: true } }],
    ['health consent unticked', { consents: { privacy: true, health: false, photos_ai: true } }],
    ['photo and AI consent unticked', { consents: { privacy: true, health: true, photos_ai: false } }],
    ['unknown path', { path: 'wrinkles' }],
    ['honeypot filled', { hp: 'x' }],
    ['unknown field', { admin: true }],
  ])('rejects: %s', async (_n, over) => {
    const r = await h.call('POST', '/api/cases', { body: { ...base, ...over } });
    expect(r.status).toBe(422);
  });
  it('records each consent with version and time, and returns only a private token', async () => {
    const r = await h.call('POST', '/api/cases', { body: { ...base, consents: { ...base.consents, evaluation: true } } });
    expect(r.status).toBe(201);
    expect(Object.keys(r.json)).toEqual(['token']);
    expect(r.json.token).toHaveLength(43);
    const rows = await h.db.query(`select key, version, granted_at, withdrawn_at from ss.consents order by id desc limit 4`);
    expect(rows.map((x: any) => x.key).sort()).toEqual(['evaluation', 'health', 'photos_ai', 'privacy']);
    expect(rows.every((x: any) => x.version && x.granted_at && !x.withdrawn_at)).toBe(true);
    const stored = await h.db.query(`select token_hash from ss.cases order by created_at desc limit 1`);
    expect(stored[0].token_hash).not.toBe(r.json.token);
    expect(stored[0].token_hash).toHaveLength(64);
  });
  it('unknown, short or tampered tokens look like "not found"', async () => {
    const good = await h.startCase();
    expect((await h.call('GET', '/api/case', { token: good })).status).toBe(200);
    for (const bad of ['x', good.slice(0, 42), good.slice(0, 42) + (good.endsWith('A') ? 'B' : 'A'), 'A'.repeat(43)]) {
      expect((await h.call('GET', '/api/case', { token: bad })).status, bad).toBe(404);
    }
    expect((await h.call('GET', '/api/case')).status).toBe(404);
  });
});

describe('the three paths ask different things', () => {
  it('rejects answers meant for another path and accepts the right ones', async () => {
    const t = await h.startCase('concerns');
    const wrong = await h.call('POST', '/api/case/answers', { token: t, body: { answers: validAnswers('maintenance') } });
    expect(wrong.status).toBe(422);
    expect((await h.answer(t, 'concerns')).status).toBe(200);
  });
  it('incomplete questionnaires are rejected, and out-of-vocabulary values too', async () => {
    const t = await h.startCase('scars');
    const partial = await h.call('POST', '/api/case/answers', { token: t, body: { answers: { mark_age: 'under_6m' } } });
    expect(partial.status).toBe(422);
    const bad = await h.answer(t, 'scars', { mark_age: 'forever' });
    expect(bad.status).toBe(422);
  });
});

describe('Gate A: answer-based safety stop', () => {
  it.each([
    ['maintenance', { mole_changing: 'yes' }],
    ['concerns', { infection_signs: 'yes' }],
    ['concerns', { rapid_worsening: 'yes' }],
    ['scars', { mark_type: ['raised'] }],
    ['scars', { marks_changing: 'yes' }],
  ])('%s with %j stops the flow before any photo is requested', async (path, over) => {
    const t = await h.startCase(path as any);
    const a = await h.answer(t, path as any, over);
    expect(a.json.stopped).toBe(true);
    const state = (await h.call('GET', '/api/case', { token: t })).json;
    expect(state.stage).toBe('safety_stopped');
    expect(state.safety.stopped).toBe(true);
    expect(state.snapshot.routine).toBeNull();
    expect(state.snapshot.showBooking).toBe(false);
    expect(state.snapshot.zones).toEqual([]);
    // No photo can be requested, no analysis can start, no booking can be made.
    expect((await h.call('POST', '/api/case/photos', { token: t, body: { slot: 'front', contentType: 'image/jpeg', size: 50000 } })).status).toBe(409);
    expect((await h.call('POST', '/api/case/analyze', { token: t })).status).toBe(409);
    const b = await h.call('POST', '/api/case/booking', { token: t, body: { name: 'Asha', whatsapp: '+919876543210', day: '2026-12-01', window: 'morning', method: 'chat', contactConsent: true } });
    expect(b.status).toBe(409);
    expect((await h.db.query(`select 1 from ss.bookings where case_id = (select id from ss.cases where token_hash = $1)`, [await (await import('../src/core/ids')).sha256Hex(t)])).length).toBe(0);
  });
  it('flags the case for the cosmetologist with metadata only', async () => {
    const t = await h.startCase('maintenance');
    await h.answer(t, 'maintenance', { eye_area_problem: 'yes' });
    const list = (await h.call('GET', '/api/console/cases?flagged=true', { staff: h.tokens.cosmo })).json;
    const mine = list.find((x: any) => x.flag_codes.includes('eye_area_problem'));
    expect(mine).toBeTruthy();
    expect(mine.first_name).toBeNull();
    const open = (await h.call('GET', `/api/console/cases/${mine.id}`, { staff: h.tokens.cosmo })).json;
    expect(open.details_visible).toBe(false);
    expect(open.answers).toBeUndefined();
    expect(open.photos).toBeUndefined();
  });
});

describe('photos: upload, sanitising, privacy', () => {
  it('nothing is stored before the browser asks to upload, and tokens are scoped', async () => {
    const t = await h.startCase();
    await h.answer(t, 'maintenance');
    expect((await h.db.query(`select count(*)::int n from ss.photos where case_id = (select id from ss.cases order by created_at desc limit 1)`))[0].n).toBe(0);
    const init = await h.call('POST', '/api/case/photos', { token: t, body: { slot: 'front', contentType: 'image/jpeg', size: 80000 } });
    expect(init.status).toBe(200);
    expect(init.json.uploadUrl).toMatch(/^\/api\/uploads\//);
    const jpeg = await makeJpeg();
    // unsigned, tampered, wrong-photo and expired tokens are refused
    expect((await h.call('PUT', `/api/uploads/${init.json.photoId}`, { raw: jpeg as any })).status).toBe(403);
    expect((await h.call('PUT', init.json.uploadUrl + 'x', { raw: jpeg as any })).status).toBe(403);
    const expired = await signToken(SECRET, { a: 'upload', id: init.json.photoId, exp: Math.floor(Date.now() / 1000) - 5 });
    expect((await h.call('PUT', `/api/uploads/${init.json.photoId}?t=${encodeURIComponent(expired)}`, { raw: jpeg as any })).status).toBe(403);
    const other = await signToken(SECRET, { a: 'upload', id: '00000000-0000-4000-8000-000000000000', exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await h.call('PUT', `/api/uploads/${init.json.photoId}?t=${encodeURIComponent(other)}`, { raw: jpeg as any })).status).toBe(403);
    const viewToken = await signToken(SECRET, { a: 'view', id: init.json.photoId, exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await h.call('PUT', `/api/uploads/${init.json.photoId}?t=${encodeURIComponent(viewToken)}`, { raw: jpeg as any })).status).toBe(403);
    // the real upload works
    expect((await h.call('PUT', init.json.uploadUrl, { raw: jpeg as any })).status).toBe(204);
    const done = await h.call('POST', `/api/case/photos/${init.json.photoId}/complete`, { token: t });
    expect(done.json.ok).toBe(true);
  });

  it('re-encodes the image, removing EXIF/GPS metadata and capping size', async () => {
    const sharp = (await import('sharp')).default;
    const raw = await makeJpeg({ w: 900, h: 1200, seed: 5 });
    const withExif = await sharp(raw).withExif({ IFD0: { Copyright: 'SECRET-DEVICE-ID', Make: 'Phone', Model: 'X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '19/1 0/1 0/1' } as any }).jpeg().toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy();
    const t = await h.startCase();
    await h.answer(t, 'maintenance');
    const r = await h.uploadPhoto(t, 'front', withExif);
    expect(r.done!.json.ok).toBe(true);
    const row = (await h.db.query(`select o.bytes from ss.objects o join ss.photos p on p.object_key = o.key where p.id = $1`, [r.init.json.photoId]))[0];
    const stored = Buffer.from(row.bytes);
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored.toString('latin1')).not.toContain('SECRET-DEVICE-ID');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1600);
    // the raw upload object is removed once sanitised
    expect((await h.db.query(`select count(*)::int n from ss.objects where key like '%.upload'`))[0].n).toBe(0);
  });

  it('rejects non-images, tiny, dark and blurry photos with a reason, and frees the slot', async () => {
    const t = await h.startCase();
    await h.answer(t, 'maintenance');
    const junk = await h.uploadPhoto(t, 'front', Buffer.from('not an image at all'.repeat(100)));
    expect(junk.done!.json).toEqual({ ok: false, reason: 'unreadable' });
    const tiny = await h.uploadPhoto(t, 'front', await makeJpeg({ w: 100, h: 100 }));
    expect(tiny.done!.json).toEqual({ ok: false, reason: 'too_small' });
    const dark = await h.uploadPhoto(t, 'front', await makeJpeg({ mean: 12, amp: 5, grad: 0 }));
    expect(dark.done!.json).toEqual({ ok: false, reason: 'too_dark' });
    const blurry = await h.uploadPhoto(t, 'front', await makeJpeg({ amp: 0, grad: 0 }));
    expect(blurry.done!.json).toEqual({ ok: false, reason: 'too_blurry' });
    const state = (await h.call('GET', '/api/case', { token: t })).json;
    expect(state.photos).toEqual([]);
  });

  it('uploading a slot again replaces the earlier photo and queues its object for deletion', async () => {
    const t = await h.startCase();
    await h.answer(t, 'maintenance');
    const a = await h.uploadPhoto(t, 'front', await makeJpeg({ seed: 1 }));
    const key = (await h.db.query(`select object_key k from ss.photos where id=$1`, [a.init.json.photoId]))[0].k;
    const b = await h.uploadPhoto(t, 'front', await makeJpeg({ seed: 2 }));
    expect(b.done!.json.ok).toBe(true);
    expect((await h.db.query(`select count(*)::int n from ss.objects where key=$1`, [key]))[0].n).toBe(0);
    expect((await h.call('GET', '/api/case', { token: t })).json.photos).toHaveLength(1);
  });

  it('the phone-continuation token can upload photos but nothing else', async () => {
    const t = await h.startCase();
    await h.answer(t, 'maintenance');
    const cs = await h.call('POST', '/api/case/capture-session', { token: t });
    expect(cs.status).toBe(201);
    const cap = cs.json.token;
    const up = await h.uploadPhoto(cap, 'front', undefined, true);
    expect(up.done!.json.ok).toBe(true);
    expect((await h.call('GET', '/api/case', { capture: cap })).json.photos[0].slot).toBe('front');
    expect((await h.call('POST', '/api/case/answers', { capture: cap, body: { answers: {} } })).status).toBe(403);
    expect((await h.call('POST', '/api/case/analyze', { capture: cap })).status).toBe(403);
    expect((await h.call('DELETE', '/api/case', { capture: cap })).status).toBe(403);
    expect((await h.call('POST', '/api/case/booking', { capture: cap, body: {} })).status).toBe(403);
    // expired capture sessions stop working
    await h.db.query(`update ss.capture_sessions set expires_at = now() - interval '1 minute'`);
    expect((await h.call('GET', '/api/case', { capture: cap })).status).toBe(404);
  });
});

describe('analysis, snapshot and gate B', () => {
  it('maintenance path: snapshot with zones, labels and a (sample) routine; no condition names, scores or digits', async () => {
    const f = await h.fullFlow('maintenance');
    expect(f.analyze!.json.started).toBe(true);
    const s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.stage).toBe('snapshot_ready');
    const vm = s.snapshot;
    expect(vm.stopped).toBe(false);
    expect(vm.zones.length).toBeGreaterThan(0);
    expect(vm.routine.status).toBe('sample');
    expect(vm.nextStep).toBe('optional_talk');
    expect(vm.showBooking).toBe(true);
    const allowed = new Set(['clear', 'likely', 'not_sure', 'not_assessed']);
    for (const z of vm.zones) for (const r of z.rows) expect(allowed.has(r.confidence)).toBe(true);
    for (const lang of ['en', 'hi'] as const) expect(scanAll(snapshotPhraseKeys(vm).map((k) => phrase(lang, k)), { numeric: true })).toEqual([]);
    // the raw response JSON itself must not contain forbidden terms either
    expect(JSON.stringify(vm)).not.toMatch(/acne|melasma|diagnos|skin_age|score|hydrat/i);
    // provider output is stored as validated codes, with model and prompt version recorded
    const a = (await h.db.query(`select provider, model, prompt_version, passes, status from ss.analyses order by queued_at desc limit 1`))[0];
    expect(a).toMatchObject({ provider: 'mock', model: 'mock-v1', prompt_version: 'prompt-v1', passes: 2, status: 'done' });
  });

  it('concerns and scars: observations for their own attributes, recommended talk, no routine', async () => {
    for (const p of ['concerns', 'scars'] as const) {
      const f = await h.fullFlow(p);
      const vm = (await h.call('GET', '/api/case', { token: f.token })).json.snapshot;
      expect(vm.routine).toBeNull();
      expect(vm.nextStep).toBe('recommended_talk');
      const attrs = new Set(vm.zones.flatMap((z: any) => z.rows.map((r: any) => r.attribute)));
      if (p === 'concerns') expect(attrs.has('breakouts')).toBe(true);
      else expect(attrs.has('marks_scars')).toBe(true);
      expect(attrs.has('fine_lines')).toBe(false);
      expect(vm.expectKey).toBe(`expect.${p}`);
    }
  });

  it('INVARIANT: a red flag found in the photos stops the flow, with no routine and no booking', async () => {
    await h.setSetting('ai_mock_scenario', 'red_flag');
    const f = await h.fullFlow('maintenance');
    await h.setSetting('ai_mock_scenario', 'normal');
    const s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.stage).toBe('safety_stopped');
    expect(s.snapshot.stopped).toBe(true);
    expect(s.snapshot.routine).toBeNull();
    expect(s.snapshot.showBooking).toBe(false);
    expect(s.safety.source).toBe('image');
    expect(JSON.stringify(s)).not.toContain('lesion');
    const b = await h.call('POST', '/api/case/booking', { token: f.token, body: { name: 'Asha', whatsapp: '+919876543210', day: '2026-12-01', window: 'morning', method: 'chat', contactConsent: true } });
    expect(b.status).toBe(409);
    expect((await h.db.query(`select count(*)::int n from ss.events where name='safety_stop' and props->>'source'='image'`))[0].n).toBeGreaterThan(0);
  });

  it('poor-quality photos ask for a retake instead of giving a snapshot', async () => {
    await h.setSetting('ai_mock_scenario', 'poor_quality');
    const f = await h.fullFlow('maintenance');
    await h.setSetting('ai_mock_scenario', 'normal');
    const s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.stage).toBe('needs_retake');
    expect(s.snapshot).toBeNull();
    expect(s.retake.issues).toContain('photo_too_dark');
  });

  it('an invalid or failing provider never produces a snapshot, and leaks no model text', async () => {
    for (const scenario of ['invalid', 'error']) {
      await h.setSetting('ai_mock_scenario', scenario);
      const f = await h.fullFlow('maintenance');
      const s = (await h.call('GET', '/api/case', { token: f.token })).json;
      expect(s.stage).toBe('analysis_failed');
      expect(s.snapshot).toBeNull();
      expect(JSON.stringify(s)).not.toMatch(/acne|skin_score|diagnosis/);
      // the case can retry once the provider recovers
      await h.setSetting('ai_mock_scenario', 'normal');
      await h.call('POST', '/api/case/analyze', { token: f.token });
      expect((await h.call('GET', '/api/case', { token: f.token })).json.stage).toBe('snapshot_ready');
    }
  });

  it('path mismatch holds the routine and a switch re-asks the stricter questions and re-runs Gate A', async () => {
    await h.setSetting('ai_mock_scenario', 'mismatch');
    const f = await h.fullFlow('maintenance');
    await h.setSetting('ai_mock_scenario', 'normal');
    let s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.snapshot.pathMismatch).toBe(true);
    expect(s.snapshot.routine).toBeNull();
    expect(s.snapshot.routineHeld).toBe('path_mismatch');
    // switch to the better-fitting path
    const sw = await h.call('POST', '/api/case/switch-path', { token: f.token, body: { path: 'concerns' } });
    expect(sw.json.needsQuestions).toEqual(expect.arrayContaining(['pregnant_bf', 'medicines', 'rapid_worsening', 'painful_lumps']));
    s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.stage).toBe('needs_path_questions');
    expect(s.snapshot).toBeNull();
    // a red flag in the new questions stops the case
    const bad = await h.call('POST', '/api/case/answers', { token: f.token, body: { answers: { ...validAnswers('concerns'), painful_lumps: 'yes' } } });
    expect(bad.json.stopped).toBe(true);
    expect((await h.call('GET', '/api/case', { token: f.token })).json.snapshot.routine).toBeNull();
  });

  it('pregnancy answers (concerns path) restrict routine advice and are visible to the cosmetologist', async () => {
    const f = await h.fullFlow('concerns', { pregnant_bf: 'pregnant' });
    const state = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(state.snapshot.routine).toBeNull();
    const row = (await h.db.query(`select restrictions from ss.cases where token_hash = $1`, [await (await import('../src/core/ids')).sha256Hex(f.token)]))[0];
    expect(row.restrictions).toContain('no_routine');
  });

  it('logs identifiers and timings but never answers, images or model output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await h.fullFlow('maintenance');
    const lines = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(lines.some((l) => l.includes('analysis.done'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toMatch(/dry_tight|budget|b500_1500|base64|\/9j\/|observations|finding/);
    }
  });
});

const book = (t: string, over: Record<string, unknown> = {}) => {
  const day = new Date(Date.now() + 2 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
  return h.call('POST', '/api/case/booking', { token: t, body: { name: 'Priya Sharma', whatsapp: '+91 98765 43210', day, window: 'evening', method: 'whatsapp_video', contactConsent: true, note: 'After 6 pm please', ...over } });
};

describe('booking and WhatsApp hand-off', () => {
  it('creates the booking, records WhatsApp consent, and builds a message with only first name and code', async () => {
    const f = await h.fullFlow('maintenance');
    const r = await book(f.token);
    expect(r.status).toBe(201);
    const b = r.json.booking;
    expect(b.status).toBe('requested');
    expect(b.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.firstName).toBe('Priya');
    expect(b.message).toBe(`Hello, I'm Priya. My case code is ${r.json.code}.`);
    expect(b.whatsappUrl).toBe(`https://wa.me/919876500000?text=${encodeURIComponent(b.message)}`);
    expect(b.message + b.whatsappUrl).not.toMatch(/Sharma|photo|answer|dry_tight|case\/|98765 43210|\+919876543210/);
    const consent = await h.db.query(`select key from ss.consents where case_id = (select id from ss.cases where code=$1) and key='whatsapp' and withdrawn_at is null`, [r.json.code]);
    expect(consent).toHaveLength(1);
    // the retention deadline is lifted for booked cases
    expect((await h.db.query(`select expires_at from ss.cases where code=$1`, [r.json.code]))[0].expires_at).toBeNull();
    // and the cosmetologist sees it at the top of the queue
    const q = (await h.call('GET', '/api/console/cases', { staff: h.tokens.cosmo })).json;
    expect(q[0].code).toBe(r.json.code);
    expect(q[0]).toMatchObject({ first_name: 'Priya', booking_status: 'requested', method: 'whatsapp_video', time_window: 'evening', budget: 'under_500' });
  });
  it('the Hindi message has the same two items only', async () => {
    const f = await h.fullFlow('maintenance');
    const day = new Date(Date.now() + 2 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const r = await h.call('POST', '/api/case/booking', { token: f.token, body: { name: 'Anita Verma', whatsapp: '+919811122233', day, window: 'morning', method: 'chat', contactConsent: true, lang: 'hi' } });
    expect(r.json.booking.message).toBe(`नमस्ते, मैं Anita हूँ। मेरा केस कोड ${r.json.code} है।`);
  });
  it('is idempotent: a second submit does not create a second booking', async () => {
    const f = await h.fullFlow('maintenance');
    await book(f.token);
    const again = await book(f.token, { name: 'Someone Else' });
    expect(again.status).toBe(201);
    expect(again.json.booking.firstName).toBe('Priya');
  });
  it.each([
    ['no contact consent', { contactConsent: false }],
    ['bad number', { whatsapp: '12345' }],
    ['number without country code that is not Indian', { whatsapp: '555' }],
    ['day outside the next seven', { day: '2030-01-01' }],
    ['unknown window', { window: 'midnight' }],
    ['unknown method', { method: 'phone' }],
    ['name with markup', { name: '<img src=x>' }],
    ['note too long', { note: 'x'.repeat(301) }],
  ])('rejects: %s', async (_n, over) => {
    const f = await h.fullFlow('maintenance');
    expect((await book(f.token, over)).status).toBe(422);
  });
  it('requires a finished snapshot first', async () => {
    const t = await h.startCase();
    expect((await book(t)).status).toBe(409);
  });
  it('rate-limits per number, and blocked numbers cannot book', async () => {
    const hashes = await import('../src/server/signing');
    for (let i = 0; i < 5; i++) {
      const f = await h.fullFlow('maintenance');
      expect((await book(f.token, { whatsapp: '+919000000001' })).status).toBe(201);
    }
    const f6 = await h.fullFlow('maintenance');
    expect((await book(f6.token, { whatsapp: '+919000000001' })).status).toBe(429);
    const f7 = await h.fullFlow('maintenance');
    expect((await book(f7.token, { whatsapp: '+919000000002' })).status).toBe(201);
    const block = await h.call('POST', `/api/console/cases/${(await h.db.query(`select id from ss.cases order by created_at desc limit 1`))[0].id}/block-number`, { staff: h.tokens.cosmo, body: { reason: 'spam' } });
    expect(block.status).toBe(204);
    const f8 = await h.fullFlow('maintenance');
    expect((await book(f8.token, { whatsapp: '+919000000002' })).status).toBe(429);
    void hashes;
  });
});

describe('console: authentication, roles and audit', () => {
  it('refuses missing, invalid, non-staff and single-step sessions', async () => {
    expect((await h.call('GET', '/api/console/cases')).status).toBe(401);
    expect((await h.call('GET', '/api/console/cases', { staff: 'junk' })).status).toBe(401);
    expect((await h.call('GET', '/api/console/cases', { staff: h.tokens.nobody })).status).toBe(403);
    expect((await h.call('GET', '/api/console/cases', { staff: h.tokens.cosmoWeak })).status).toBe(403);
    expect((await h.call('GET', '/api/console/cases', { staff: h.tokens.cosmo })).status).toBe(200);
  });
  it('visitor tokens cannot call the console, and staff tokens cannot act as visitors', async () => {
    const t = await h.startCase();
    expect((await h.call('GET', '/api/console/cases', { staff: t })).status).toBe(401);
    expect((await h.call('GET', '/api/case', { token: h.tokens.cosmo })).status).toBe(404);
  });
  it('role limits: cosmetologist cannot read the access log, staff list or change settings; admin can', async () => {
    expect((await h.call('GET', '/api/console/access-log', { staff: h.tokens.cosmo })).status).toBe(403);
    expect((await h.call('GET', '/api/console/staff', { staff: h.tokens.cosmo })).status).toBe(403);
    expect((await h.call('PUT', '/api/console/settings/service_promise', { staff: h.tokens.cosmo, body: { value: 'x' } })).status).toBe(403);
    expect((await h.call('GET', '/api/console/access-log', { staff: h.tokens.admin })).status).toBe(200);
    expect((await h.call('GET', '/api/console/staff', { staff: h.tokens.admin })).status).toBe(200);
    expect((await h.call('PUT', '/api/console/settings/nonsense', { staff: h.tokens.admin, body: { value: 'x' } })).status).toBe(404);
  });
  it('opening a case, viewing a photo and changing status are all recorded in the access log', async () => {
    const f = await h.fullFlow('maintenance');
    await book(f.token);
    const id = (await h.db.query(`select id from ss.cases order by created_at desc limit 1`))[0].id;
    const open = (await h.call('GET', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).json;
    expect(open.details_visible).toBe(true);
    expect(open.photos).toHaveLength(3);
    expect(open.photos[0].object_key).toBeUndefined();
    expect(open.answers.budget).toBe('under_500');
    expect(open.analysis.result.observations.length).toBeGreaterThan(0);
    const img = await h.call('GET', open.photos[0].url);
    expect(img.status).toBe(200);
    expect(img.res.headers.get('content-type')).toBe('image/jpeg');
    expect((await h.call('GET', open.photos[0].url + 'tamper')).status).toBe(403);
    for (const s of ['contacted', 'scheduled', 'completed', 'no_response', 'closed']) expect((await h.call('POST', `/api/console/cases/${id}/status`, { staff: h.tokens.cosmo, body: { status: s } })).status).toBe(200);
    expect((await h.call('POST', `/api/console/cases/${id}/status`, { staff: h.tokens.cosmo, body: { status: 'bogus' } })).status).toBe(422);
    const log = (await h.call('GET', '/api/console/access-log?limit=50', { staff: h.tokens.admin })).json as any[];
    const mine = log.filter((l) => l.case_code === open.code).map((l) => l.action);
    expect(mine).toEqual(expect.arrayContaining(['open_case', 'view_photo', 'status_change']));
    expect(log.find((l) => l.action === 'open_case' && l.case_code === open.code).actor_email).toBe('cosmo@example.test');
  });
  it('notes, AI feedback, missed-flag report, export and deletion work; deletion removes it everywhere', async () => {
    const f = await h.fullFlow('maintenance');
    await book(f.token);
    const id = (await h.db.query(`select id from ss.cases order by created_at desc limit 1`))[0].id;
    expect((await h.call('POST', `/api/console/cases/${id}/notes`, { staff: h.tokens.cosmo, body: { body: 'Prefers evenings' } })).status).toBe(201);
    const open = (await h.call('GET', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).json;
    expect(open.notes[0].body).toBe('Prefers evenings');
    const row = open.analysis.result.observations.find((o: any) => o.confidence !== 'not_assessed');
    expect((await h.call('POST', `/api/console/cases/${id}/feedback`, { staff: h.tokens.cosmo, body: { analysisId: open.analysis.id, zone: row.zone, attribute: row.attribute, verdict: 'disagree' } })).status).toBe(204);
    expect((await h.call('POST', `/api/console/cases/${id}/feedback`, { staff: h.tokens.cosmo, body: { kind: 'missed_flag', verdict: 'disagree', comment: 'x' } })).status).toBe(204);
    const exp = await h.call('GET', `/api/console/cases/${id}/export`, { staff: h.tokens.cosmo });
    expect(exp.status).toBe(200);
    expect(exp.res.headers.get('content-disposition')).toContain('attachment');
    expect(exp.json.feedback.length).toBe(2);
    expect((await h.call('DELETE', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).status).toBe(204);
    expect((await h.call('GET', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).status).toBe(404);
    expect((await h.call('GET', '/api/case', { token: f.token })).status).toBe(404);
    expect((await h.db.query(`select count(*)::int n from ss.objects where key like $1`, [`cases/${id}/%`]))[0].n).toBe(0);
    expect((await h.db.query(`select count(*)::int n from ss.deletion_ledger where case_id=$1`, [id]))[0].n).toBe(1);
  });
  it('routine templates: edit, approve, banned terms refused, and approved text reaches visitors without the sample label', async () => {
    const tpl = (await h.call('GET', '/api/console/templates', { staff: h.tokens.cosmo })).json.find((t: any) => t.steps === 2 && t.skin_feel === 'dry' && t.sensitivity === 'low');
    const body = (items: any[]) => ({ name: 'Dry, 2 steps', steps: 2, skinFeel: 'dry', sensitivity: 'low', budgetBands: [], items, approve: true });
    const good = [{ category: 'cleanser', text_en: 'A mild cleanser, morning and evening.', text_hi: 'एक हल्का क्लींज़र, सुबह और शाम।' }, { category: 'moisturiser', text_en: 'A richer moisturiser.', text_hi: 'एक गाढ़ा मॉइस्चराइज़र।' }];
    const bad = await h.call('PUT', `/api/console/templates/${tpl.id}`, { staff: h.tokens.cosmo, body: body([{ category: 'cleanser', text_en: 'Use isotretinoin for acne.', text_hi: 'x' }, good[1]]) });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toBe('banned_terms');
    expect((await h.call('PUT', `/api/console/templates/${tpl.id}`, { staff: h.tokens.cosmo, body: body(good) })).status).toBe(200);
    const f = await h.fullFlow('maintenance', { skin_feel: 'dry_tight', sensitivity: 'rarely', time_per_day: 'two_steps' });
    const vm = (await h.call('GET', '/api/case', { token: f.token })).json.snapshot;
    expect(vm.routine.status).toBe('approved');
    expect(vm.routine.template.items[0].text_en).toBe('A mild cleanser, morning and evening.');
    // with samples switched off and no approved template for another combination, nothing is invented
    await h.setSetting('allow_sample_routines', false);
    const noSamples = await h.fullFlow('maintenance', { skin_feel: 'oily_all', sensitivity: 'often', time_per_day: 'three_steps' });
    const vm2 = (await h.call('GET', '/api/case', { token: noSamples.token })).json.snapshot;
    expect(vm2.routine).toBeNull();
    expect(vm2.routineHeld).toBe('no_template');
    await h.setSetting('allow_sample_routines', true);
  });
});

describe('consent withdrawal and deletion by the visitor', () => {
  it('withdrawing photo/AI consent deletes photos and analysis; the case continues without them', async () => {
    const f = await h.fullFlow('maintenance');
    const w = await h.call('POST', '/api/case/consents/photos_ai/withdraw', { token: f.token });
    expect(w.json.deleted).toBe(false);
    const s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.photos).toEqual([]);
    expect(s.consents).not.toContain('photos_ai');
    expect(s.snapshot).toBeNull();
    expect((await h.call('POST', '/api/case/photos', { token: f.token, body: { slot: 'front', contentType: 'image/jpeg', size: 50000 } })).status).toBe(403);
  });
  it('withdrawing health-answers consent erases the answers and snapshot', async () => {
    const f = await h.fullFlow('maintenance');
    await h.call('POST', '/api/case/consents/health/withdraw', { token: f.token });
    const s = (await h.call('GET', '/api/case', { token: f.token })).json;
    expect(s.hasAnswers).toBe(false);
    expect(s.snapshot).toBeNull();
    expect((await h.call('POST', '/api/case/answers', { token: f.token, body: { answers: validAnswers('maintenance') } })).status).toBe(403);
  });
  it('withdrawing WhatsApp consent stops contact and hides details from the console', async () => {
    const f = await h.fullFlow('maintenance');
    const day = new Date(Date.now() + 2 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const r = await h.call('POST', '/api/case/booking', { token: f.token, body: { name: 'Ravi', whatsapp: '+919811100011', day, window: 'morning', method: 'chat', contactConsent: true } });
    const id = (await h.db.query(`select id from ss.cases where code=$1`, [r.json.code]))[0].id;
    expect((await h.call('GET', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).json.details_visible).toBe(true);
    await h.call('POST', '/api/case/consents/whatsapp/withdraw', { token: f.token });
    const open = (await h.call('GET', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).json;
    expect(open.details_visible).toBe(false);
    expect(open.photos).toBeUndefined();
    expect(open.contact_withdrawn_at).toBeTruthy();
  });
  it('withdrawing the privacy consent, or pressing "delete my photos and case", removes everything at once', async () => {
    for (const how of ['privacy', 'delete'] as const) {
      const f = await h.fullFlow('maintenance');
      const id = (await h.db.query(`select id from ss.cases order by created_at desc limit 1`))[0].id;
      const r = how === 'privacy' ? await h.call('POST', '/api/case/consents/privacy/withdraw', { token: f.token }) : await h.call('DELETE', '/api/case', { token: f.token });
      expect(r.status).toBe(200);
      expect((await h.call('GET', '/api/case', { token: f.token })).status).toBe(404);
      for (const t of ['cases', 'photos', 'analyses', 'consents', 'bookings']) {
        expect((await h.db.query(`select count(*)::int n from ss.${t} where ${t === 'cases' ? 'id' : 'case_id'}=$1`, [id]))[0].n, t).toBe(0);
      }
      expect((await h.db.query(`select count(*)::int n from ss.objects where key like $1`, [`cases/${id}/%`]))[0].n).toBe(0);
      expect((await h.db.query(`select reason from ss.deletion_ledger where case_id=$1`, [id]))[0].reason).toBe(how === 'privacy' ? 'consent_withdrawn' : 'visitor_request');
      // the console no longer shows it
      expect((await h.call('GET', `/api/console/cases/${id}`, { staff: h.tokens.cosmo })).status).toBe(404);
    }
  });
});

describe('retention and purge', () => {
  it('refuses callers without the cron secret', async () => {
    expect((await h.call('POST', '/api/jobs/purge')).status).toBe(401);
    expect((await h.call('POST', '/api/jobs/purge', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });
  it('deletes unbooked cases after the deadline (photos, objects, answers) but keeps booked ones', async () => {
    const unbooked = await h.fullFlow('maintenance');
    const booked = await h.fullFlow('maintenance');
    await h.call('POST', '/api/case/booking', { token: booked.token, body: { name: 'Kiran', whatsapp: '+919833300033', day: new Date(Date.now() + 2 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10), window: 'morning', method: 'chat', contactConsent: true } });
    const idOf = async (tok: string) => (await h.db.query(`select id from ss.cases where token_hash=$1`, [await (await import('../src/core/ids')).sha256Hex(tok)]))[0]?.id;
    const u = await idOf(unbooked.token);
    const b = await idOf(booked.token);
    // not yet expired
    await h.call('POST', '/api/jobs/purge', { headers: { authorization: 'Bearer cron-secret' } });
    expect(await idOf(unbooked.token)).toBe(u);
    // 73 hours later
    await h.db.query(`update ss.cases set expires_at = now() - interval '1 minute' where id=$1`, [u]);
    expect((await h.call('GET', '/api/case', { token: unbooked.token })).status).toBe(404); // link already dead
    const r = await h.call('POST', '/api/jobs/purge', { headers: { authorization: 'Bearer cron-secret' } });
    expect(r.json.expiredCases).toBeGreaterThanOrEqual(1);
    expect(await idOf(unbooked.token)).toBeUndefined();
    expect((await h.db.query(`select count(*)::int n from ss.objects where key like $1`, [`cases/${u}/%`]))[0].n).toBe(0);
    expect((await h.db.query(`select reason from ss.deletion_ledger where case_id=$1`, [u]))[0].reason).toBe('retention_expired');
    expect(await idOf(booked.token)).toBe(b);
    // closing the booked case starts the 90-day clock; once past it the case is purged
    await h.call('POST', `/api/console/cases/${b}/status`, { staff: h.tokens.cosmo, body: { status: 'closed' } });
    expect(await idOf(booked.token)).toBe(b);
    await h.db.query(`update ss.cases set expires_at = now() - interval '1 minute' where id=$1`, [b]);
    await h.call('POST', '/api/jobs/purge', { headers: { authorization: 'Bearer cron-secret' } });
    expect(await idOf(booked.token)).toBeUndefined();
  });
});

describe('analytics', () => {
  it('accepts whitelisted events with only step names and timings; rejects anything else', async () => {
    const ok = await h.call('POST', '/api/events', { body: { name: 'path_selected', sessionId: 'abcdefgh12', path: 'scars', lang: 'hi' } });
    expect(ok.status).toBe(204);
    for (const bad of [{ name: 'photo_uploaded', sessionId: 'abcdefgh12' }, { name: 'page_view', sessionId: 'abcdefgh12', answers: { skin: 'x' } }, { name: 'page_view', sessionId: 'x' }, { name: 'page_view', sessionId: 'abcdefgh12', email: 'a@b.c' }]) {
      expect((await h.call('POST', '/api/events', { body: bad })).status).toBe(422);
    }
    const props = await h.db.query(`select props from ss.events where name='path_selected' order by id desc limit 1`);
    expect(Object.keys(props[0].props).filter((k) => props[0].props[k] !== undefined)).toEqual([]);
  });
  it('the server records funnel events through the whole journey', async () => {
    const f = await h.fullFlow('maintenance');
    const sid = (await h.db.query(`select session_id from ss.cases where token_hash=$1`, [await (await import('../src/core/ids')).sha256Hex(f.token)]))[0].session_id;
    const names = (await h.db.query(`select name from ss.events where session_id=$1 order by id`, [sid])).map((r: any) => r.name);
    expect(names).toEqual(expect.arrayContaining(['consent_completed', 'questionnaire_completed', 'photos_completed', 'analysis_started', 'snapshot_ready']));
  });
});

describe('bot protection (proof of work)', () => {
  it('requires a solved, unexpired, single-use challenge', async () => {
    const t = await setup({ BOTCHECK: 'pow', BOTCHECK_DIFFICULTY: '10' });
    const body = (botToken?: string) => ({ lang: 'en', path: 'maintenance', ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true }, botToken });
    expect((await t.call('POST', '/api/cases', { body: body() })).status).toBe(403);
    expect((await t.call('POST', '/api/cases', { body: body('garbage') })).status).toBe(403);
    const ch = (await t.call('GET', '/api/botcheck')).json.challenge;
    expect(ch.d).toBe(10);
    let n = 0;
    for (;;) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ch.c}:${n}`)));
      if (leadingZeroBits(digest) >= ch.d) break;
      n++;
    }
    const token = Buffer.from(JSON.stringify({ ...ch, n: String(n) })).toString('base64url');
    expect((await t.call('POST', '/api/cases', { body: body(token) })).status).toBe(201);
    expect((await t.call('POST', '/api/cases', { body: body(token) })).status).toBe(403); // replay
    const forged = Buffer.from(JSON.stringify({ ...ch, d: 1, n: '0' })).toString('base64url');
    expect((await t.call('POST', '/api/cases', { body: body(forged) })).status).toBe(403);
    await t.db.close();
    void PowBotCheck;
  }, 120_000);
});

describe('rate limits', () => {
  it('limits case creation per visitor address', async () => {
    const t = await setup();
    const body = { lang: 'en', path: 'maintenance', ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true } };
    let last = 0;
    for (let i = 0; i < 14; i++) last = (await t.call('POST', '/api/cases', { body, headers: { 'x-forwarded-for': '203.0.113.9' } })).status;
    expect(last).toBe(429);
    expect((await t.call('POST', '/api/cases', { body, headers: { 'x-forwarded-for': '203.0.113.10' } })).status).toBe(201);
    await t.db.close();
  });
});

void COSMO;
