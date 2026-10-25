import { describe, expect, it } from 'vitest';
import { configureRuntime, runtime } from '../runtime';
import { db, resetDb, tbl } from '../db';
import { seedLibrary } from '../repo/exercises';
import { createProgram } from '../repo/programs';
import * as S from '../repo/sessions';
import { ensureProfile, saveProfile } from '../repo/profile';
import { routineV6Program, routineV6Tree } from '../seed/routineV6';
import { seedId } from '../seed/exercises';
import { claimLocalData, loadConflicts, loadFailures, pendingCount, pullAll, pushAll, syncOnce } from './engine';
import { createSyncManager } from './manager';
import { FakeServer } from '@/test/fakeServer';
import { SyncError, type Remote } from './types';

const USER = 'user-1';
const TODAY = '2026-10-26';
let tick = 0, ids = 0;
const T0 = Date.parse('2026-10-26T06:00:00.000Z');
const tickClock = () => new Date(T0 + tick++ * 1000).toISOString();

async function fresh(opts: { signedIn?: boolean } = {}) {
  tick = 0; ids = 0;
  configureRuntime({ now: tickClock, newId: () => `id-${String(++ids).padStart(5, '0')}`, userId: opts.signedIn === false ? null : USER, deviceId: 'phone' });
  await resetDb();
  await seedLibrary();
  await ensureProfile();
  const server = new FakeServer(USER);
  return server;
}

async function startMonday() {
  const { program } = await createProgram(routineV6Program(), routineV6Tree(), TODAY);
  const tpl = (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!;
  return S.startScheduled(program.id, tpl.template_key, TODAY, TODAY);
}

describe('sync — offline workout end to end', () => {
  it('start online → go offline → log & edit → close/reopen → reconnect → exactly-once on the server', async () => {
    const server = await fresh();
    const remote = server.remote();

    // 1. start a workout online and sync it
    const session = await startMonday();
    expect((await syncOnce(remote)).error).toBeNull();
    expect(server.count('workout_sessions')).toBe(1);
    expect(server.count('set_records')).toBe(9);
    expect(await pendingCount()).toBe(0);

    // 2. network drops; the user logs and edits several sets
    server.offline = true;
    const views = await S.sessionExercises(session.id);
    const sets = views.flatMap((v) => v.sets);
    for (const s of sets.slice(0, 5)) await S.logSet(s.id, { weight_kg: 60, reps: 10, rir: 1 });
    await S.editSet(sets[1]!.id, { weight_kg: 62.5, reps: 9 });
    await S.addExerciseToSession(session.id, seedId('hammer-curl'), 2);
    const offlineAttempt = await syncOnce(remote);
    expect(offlineAttempt.error).toBeInstanceOf(SyncError);
    expect(offlineAttempt.error!.retryable).toBe(true);
    const pendingOffline = await pendingCount();
    expect(pendingOffline).toBeGreaterThan(0); // nothing lost, nothing acknowledged

    // 3. app is closed and reopened — local data is still there
    db.close();
    await db.open();
    const reread = (await S.sessionExercises(session.id)).flatMap((v) => v.sets);
    expect(reread.filter((s) => s.status === 'completed')).toHaveLength(5);
    expect(reread.find((s) => s.id === sets[1]!.id)).toMatchObject({ weight_kg: 62.5, reps: 9 });
    expect(await pendingCount()).toBe(pendingOffline);

    // 4. connectivity returns
    server.offline = false;
    const ok = await syncOnce(remote);
    expect(ok.error).toBeNull();
    expect(await pendingCount()).toBe(0);

    // 5. the remote has the right records — exactly once
    expect(server.count('workout_sessions')).toBe(1);
    expect(server.count('session_exercises')).toBe(4);
    expect(server.count('set_records')).toBe(11);
    expect(server.get('set_records', sets[1]!.id)).toMatchObject({ weight_kg: 62.5, reps: 9, status: 'completed', planned_weight_kg: 65 });
    expect(server.get('set_records', sets[0]!.id)).toMatchObject({ weight_kg: 60, reps: 10 });

    // 6. syncing again is a no-op (idempotent), and replaying the same rows creates nothing new
    const calls = server.upsertCalls;
    await syncOnce(remote);
    expect(server.upsertCalls).toBe(calls);
    await db.table('set_records').toCollection().modify({ _dirty: 1 }); // force a full replay
    await pushAll(remote);
    expect(server.count('set_records')).toBe(11);
    expect(server.count('workout_sessions')).toBe(1);
  });

  it('an edit made while a push is in flight stays dirty and is sent next time', async () => {
    const server = await fresh();
    const session = await startMonday();
    const set = (await S.sessionExercises(session.id))[0]!.sets[0]!;
    await S.logSet(set.id, { weight_kg: 60, reps: 10 });
    const base = server.remote();
    const racing: Remote = {
      pull: base.pull,
      upsert: async (t, rows) => {
        await base.upsert(t, rows);
        if (t === 'set_records') await S.editSet(set.id, { reps: 12 }); // user edits right after the request was built
      },
    };
    await pushAll(racing);
    expect((await tbl('set_records').get(set.id))!._dirty).toBe(1);
    expect(server.get('set_records', set.id)).toMatchObject({ reps: 10 });
    await pushAll(server.remote());
    expect(server.get('set_records', set.id)).toMatchObject({ reps: 12 });
    expect((await tbl('set_records').get(set.id))!._dirty).toBe(0);
  });

  it('pushes parents before children so foreign keys always resolve', async () => {
    const server = await fresh();
    await startMonday();
    const res = await pushAll(server.remote());
    expect(res.failed).toBe(0);
    expect(res.retryableError).toBeNull();
    expect(server.count('programs')).toBe(1);
    expect(server.count('planned_exercises')).toBe(32);
    expect(server.count('workout_templates')).toBe(6);
  });
});

describe('sync — conflicts are deterministic and never silent', () => {
  it('a newer edit from another device wins and the overwritten local edit is logged', async () => {
    const server = await fresh();
    const session = await startMonday();
    await syncOnce(server.remote());
    const set = (await S.sessionExercises(session.id))[0]!.sets[0]!;
    await S.logSet(set.id, { weight_kg: 60, reps: 10 });            // local, not yet pushed
    const local = (await tbl('set_records').get(set.id))!;
    server.injectRemote('set_records', { ...local, weight_kg: 70, reps: 8, client_updated_at: new Date(Date.parse(local.client_updated_at) + 60_000).toISOString() });
    await syncOnce(server.remote());
    expect(await tbl('set_records').get(set.id)).toMatchObject({ weight_kg: 70, reps: 8, _dirty: 0 });
    const log = await loadConflicts();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ table: 'set_records', id: set.id, kept: 'remote', lost: { weight_kg: 60, reps: 10 } });
  });

  it('a newer local edit wins: the server ignores the stale write and keeps the newer data', async () => {
    const server = await fresh();
    const session = await startMonday();
    await syncOnce(server.remote());
    const set = (await S.sessionExercises(session.id))[0]!.sets[0]!;
    const base = (await tbl('set_records').get(set.id))!;
    server.injectRemote('set_records', { ...base, weight_kg: 55, reps: 5, client_updated_at: new Date(Date.parse(base.client_updated_at) + 1000).toISOString() });
    // local edit is NEWER than the remote one
    tick += 3600;
    await S.logSet(set.id, { weight_kg: 60, reps: 10 });
    await syncOnce(server.remote());
    expect(server.get('set_records', set.id)).toMatchObject({ weight_kg: 60, reps: 10 });
    expect(await loadConflicts()).toHaveLength(0);
  });

  it('a stale replay (older client_updated_at) can never overwrite newer server data', async () => {
    const server = await fresh();
    const session = await startMonday();
    await syncOnce(server.remote());
    const set = (await S.sessionExercises(session.id))[0]!.sets[0]!;
    await S.logSet(set.id, { weight_kg: 60, reps: 10 });
    await syncOnce(server.remote());
    const stale = { ...(await tbl('set_records').get(set.id))!, weight_kg: 1, reps: 1, client_updated_at: '2026-01-01T00:00:00.000Z' };
    await server.remote().upsert('set_records', [{ ...stale }]);
    expect(server.get('set_records', set.id)).toMatchObject({ weight_kg: 60, reps: 10 });
  });

  it('pulls rows another device created, in multiple pages', async () => {
    const server = await fresh();
    for (let i = 0; i < 1100; i++) {
      server.injectRemote('audit_events', { id: `remote-${i}`, entity_type: 'x', entity_id: `e${i}`, action: 'a', before: null, after: null, reason: null, occurred_at: '2026-10-20T00:00:00.000Z', created_at: '2026-10-20T00:00:00.000Z', client_updated_at: '2026-10-20T00:00:00.000Z', deleted_at: null, device_id: 'tablet' });
    }
    const n = await pullAll(server.remote());
    expect(n).toBe(1100);
    expect(await tbl('audit_events').count()).toBe(1100);
    expect(await tbl('audit_events').where('_dirty').equals(1).count()).toBe(0); // pulled rows are not re-pushed
    expect(await pullAll(server.remote())).toBeLessThanOrEqual(1100); // look-back may re-read recent rows; they are idempotent
    expect(await tbl('audit_events').count()).toBe(1100);
  });
});

describe('sync — failures are isolated', () => {
  it('a rejected row is isolated and reported; every other row still syncs', async () => {
    const server = await fresh();
    const session = await startMonday();
    const sets = (await S.sessionExercises(session.id)).flatMap((v) => v.sets);
    // bypass client validation to simulate a row the server will reject (check constraint)
    await tbl('set_records').update(sets[2]!.id, { reps: 5000, _dirty: 1 });
    const res = await pushAll(server.remote());
    expect(res.failed).toBe(1);
    expect(res.retryableError).toBeNull();
    expect(server.count('set_records')).toBe(8);
    const failures = await loadFailures();
    expect(Object.keys(failures)).toEqual([`set_records:${sets[2]!.id}`]);
    // not retried in a loop…
    const calls = server.upsertCalls;
    await pushAll(server.remote());
    expect(server.upsertCalls).toBe(calls);
    // …but a corrected edit is sent again
    await S.editSet(sets[2]!.id, { reps: 8 });
    expect((await pushAll(server.remote())).failed).toBe(0);
    expect(server.get('set_records', sets[2]!.id)).toMatchObject({ reps: 8 });
  });

  it('a transient failure leaves everything dirty and reports a retryable error', async () => {
    const server = await fresh();
    await startMonday();
    server.failNext = new SyncError('503 Service Unavailable', true, '503');
    const res = await pushAll(server.remote());
    expect(res.retryableError).not.toBeNull();
    expect(await pendingCount()).toBeGreaterThan(0);
    expect((await pushAll(server.remote())).retryableError).toBeNull();
    expect(await pendingCount()).toBe(0);
  });

  it('never pushes another user’s rows or the built-in library', async () => {
    const server = await fresh();
    await startMonday();
    await pushAll(server.remote());
    expect(server.count('exercises')).toBe(0); // built-ins stay local
    await tbl('programs').toCollection().modify({ user_id: 'someone-else', _dirty: 1 });
    expect((await pushAll(server.remote())).pushed).toBe(0); // not ours → not pushed
  });
});

describe('sync — first sign-in', () => {
  it('data created before signing in is claimed and pushed; nothing is pushed while signed out', async () => {
    const server = await fresh({ signedIn: false });
    await saveProfile({ display_name: 'Nay', onboarding_done: true });
    await startMonday();
    expect(await pendingCount()).toBeGreaterThanOrEqual(0);
    expect((await pushAll(server.remote())).pushed).toBe(0);
    const { claimed } = await claimLocalData(USER);
    expect(claimed).toBeGreaterThan(20);
    expect(runtime.userId).toBe(USER);
    const res = await syncOnce(server.remote());
    expect(res.error).toBeNull();
    expect(server.count('workout_sessions')).toBe(1);
    expect(server.count('profiles')).toBe(1);
    expect(server.get('profiles', USER)).toMatchObject({ display_name: 'Nay', user_id: USER });
  });

  it('an existing server profile is never replaced by a fresh local placeholder (reinstall / second device)', async () => {
    const server = await fresh({ signedIn: false });
    server.injectRemote('profiles', { id: USER, display_name: 'Real Profile', units: 'lb', week_start: 1, language: 'en', goals: [], preferred_days: [], equipment: [], settings: {}, baseline: {}, onboarding_done: true, created_at: '2026-09-01T00:00:00.000Z', client_updated_at: '2026-09-01T00:00:00.000Z', deleted_at: null, device_id: 'old-phone', timezone: null, birth_year: null, height_cm: null, experience: null, training_years: null, session_minutes: null, constraints_note: null });
    configureRuntime({ userId: USER });
    await pullAll(server.remote());
    await claimLocalData(USER);
    await syncOnce(server.remote());
    const profiles = await tbl('profiles').toArray();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: USER, display_name: 'Real Profile', units: 'lb' });
    expect(server.get('profiles', USER)).toMatchObject({ display_name: 'Real Profile' });
  });

  it('a duplicate scheduled session from another device is held back and reported, not silently merged', async () => {
    const server = await fresh();
    const s = await startMonday();
    server.injectRemote('workout_sessions', { ...(await tbl('workout_sessions').get(s.id))!, id: 'other-device-session', dedupe_key: s.dedupe_key });
    const res = await pushAll(server.remote());
    expect(res.failed).toBeGreaterThanOrEqual(1);
    expect(Object.keys(await loadFailures()).some((k) => k.startsWith('workout_sessions:'))).toBe(true);
  });
});

describe('sync manager', () => {
  function harness(over: { online?: boolean; remote?: Remote | null } = {}) {
    const timers: { fn: () => void; ms: number }[] = [];
    const state = { online: over.online ?? true, remote: over.remote ?? null as Remote | null };
    const mgr = createSyncManager({ remote: () => state.remote, online: () => state.online, schedule: (fn, ms) => { const t = { fn, ms }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }; } });
    return { mgr, timers, state };
  }

  it('reports signed-out, offline and idle states', async () => {
    const server = await fresh();
    const h = harness({ remote: null });
    expect((await h.mgr.syncNow()).status).toBe('signed_out');
    h.state.remote = server.remote();
    h.state.online = false;
    expect((await h.mgr.syncNow()).status).toBe('offline');
    h.state.online = true;
    const snap = await h.mgr.syncNow();
    expect(snap.status).toBe('idle');
    expect(snap.lastSyncAt).not.toBeNull();
  });

  it('debounces local changes and backs off exponentially on transient errors', async () => {
    const server = await fresh();
    await startMonday();
    const h = harness({ remote: server.remote() });
    h.mgr.notifyLocalChange();
    expect(h.timers.map((t) => t.ms)).toEqual([3000]);
    server.offline = true;
    let snap = await h.mgr.syncNow();
    expect(snap.status).toBe('error');
    expect(snap.pending).toBeGreaterThan(0);
    expect(snap.lastError).toMatch(/fetch/);
    expect(h.timers.at(-1)!.ms).toBe(5000);
    snap = await h.mgr.syncNow();
    expect(h.timers.at(-1)!.ms).toBe(10_000);
    server.offline = false;
    snap = await h.mgr.syncNow();
    expect(snap.status).toBe('idle');
    expect(snap.pending).toBe(0);
  });
});
