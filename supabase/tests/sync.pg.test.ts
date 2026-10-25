import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { configureRuntime } from '@/data/runtime';
import { db as local, resetDb, tbl } from '@/data/db';
import { seedLibrary } from '@/data/repo/exercises';
import { createProgram } from '@/data/repo/programs';
import * as S from '@/data/repo/sessions';
import { ensureProfile } from '@/data/repo/profile';
import { routineV6Program, routineV6Tree } from '@/data/seed/routineV6';
import { claimLocalData, pendingCount, pullAll, syncOnce } from '@/data/sync/engine';
import { toSyncError } from '@/data/sync/supabaseRemote';
import { SyncError, type PullCursor, type Remote, type RemoteRow } from '@/data/sync/types';
import type { TableName } from '@/domain/types';
import { A, B, as, freshDb } from './harness';

/**
 * The real client sync engine against the real migration (Postgres + RLS + the guard trigger), not a hand-written fake.
 * `pgRemote` does what PostgREST does for supabase-js: one atomic INSERT … ON CONFLICT (id) DO UPDATE per batch, as the
 * authenticated user, and keyset pulls ordered by (server_updated_at, id).
 */
function pgRemote(pg: PGlite, uid: string, gate: { offline: boolean } = { offline: false }): Remote {
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (gate.offline) throw new SyncError('Failed to fetch', true);
    try { return await fn(); } catch (e) { const x = e as { message: string; code?: string }; throw toSyncError({ message: x.message, code: x.code }); }
  };
  return {
    upsert: (table: TableName, rows: RemoteRow[]) => wrap(async () => {
      if (!rows.length) return;
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const sets = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
      await as(pg, uid, () => pg.query(
        `insert into public.${table} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) on conflict (id) do update set ${sets}`,
        [JSON.stringify(rows)]));
    }),
    pull: (table: TableName, cursor: PullCursor | null, limit: number) => wrap(async () => {
      const r = await as(pg, uid, () => cursor
        ? pg.query<{ j: RemoteRow }>(`select to_jsonb(t) j from public.${table} t where (server_updated_at, id) > ($1::timestamptz, $2::uuid) order by server_updated_at, id limit $3`, [cursor.ts, cursor.id, limit])
        : pg.query<{ j: RemoteRow }>(`select to_jsonb(t) j from public.${table} t order by server_updated_at, id limit $1`, [limit]));
      return r.rows.map((x) => x.j);
    }),
  };
}

const TODAY = '2026-10-26';
let pg: PGlite;
let tick = 0;
const T0 = Date.now() - 2 * 86_400_000; // the phone's clock: two days ago, so it is never ahead of the server's clock
const countRemote = async (table: string, uid = A): Promise<number> => (await as(pg, uid, () => pg.query<{ n: number }>(`select count(*)::int n from public.${table}`))).rows[0]!.n;

async function newDevice(uid: string | null): Promise<void> {
  tick = 0;
  configureRuntime({ now: () => new Date(T0 + tick++ * 1000).toISOString(), newId: () => randomUUID(), userId: uid, deviceId: 'phone' });
  await resetDb(); await seedLibrary(); await ensureProfile();
}
async function logMonday(): Promise<string> {
  const { program } = await createProgram(routineV6Program(), routineV6Tree(), TODAY);
  const tpl = (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!;
  const s = await S.startScheduled(program.id, tpl.template_key, TODAY, TODAY);
  for (const v of await S.sessionExercises(s.id)) for (const st of v.sets) await S.logSet(st.id, { weight_kg: st.planned_weight_kg ?? 20, reps: 10, rir: 1 });
  await S.finishSession(s.id, { session_rpe: 8, notes: 'felt strong' });
  return s.id;
}

beforeAll(async () => { pg = await freshDb(); }, 60_000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec(`delete from auth.users where id in ('${A}','${B}'); insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test')`); });

describe('client sync engine ⇄ real Postgres schema + RLS', () => {
  it('syncs a complete logged workout, every row accepted by the real constraints, then reports nothing pending', async () => {
    await newDevice(A);
    const sessionId = await logMonday();
    const out = await syncOnce(pgRemote(pg, A));
    expect(out.error).toBeNull();
    expect(out.failed).toBe(0);
    expect(await pendingCount()).toBe(0);
    expect(await countRemote('workout_sessions')).toBe(1);
    expect(await countRemote('set_records')).toBe(9);
    const s = (await as(pg, A, () => pg.query<{ status: string; session_rpe: string; notes: string }>(`select status, session_rpe::text, notes from public.workout_sessions where id = $1`, [sessionId]))).rows[0]!;
    expect(s).toMatchObject({ status: 'completed_as_planned', session_rpe: '8', notes: 'felt strong' });
    // planned and actual stay separate on the server too
    const set = (await as(pg, A, () => pg.query<{ w: number; pw: number }>(`select r.weight_kg::float8 w, r.planned_weight_kg::float8 pw from public.set_records r join public.exercises e on e.id = r.exercise_id where e.seed_key = 'underhand-lat-pulldown' order by set_number limit 1`))).rows[0]!;
    expect(set.pw).toBe(65);
    expect(set.w).toBe(65);
  });

  it('is exactly-once: re-syncing, and even re-pushing everything after a lost acknowledgement, never duplicates anything', async () => {
    await newDevice(A);
    await logMonday();
    const remote = pgRemote(pg, A);
    await syncOnce(remote);
    const before = { s: await countRemote('workout_sessions'), t: await countRemote('set_records'), p: await countRemote('programs') };
    await syncOnce(remote);
    // simulate "the server applied it but the phone never heard back": mark all rows dirty again and push again
    for (const t of ['workout_sessions', 'session_exercises', 'set_records', 'programs', 'program_versions', 'workout_templates', 'planned_exercises'] as const) {
      await tbl(t).toCollection().modify({ _dirty: 1 } as never);
    }
    const again = await syncOnce(remote);
    expect(again.error).toBeNull();
    expect({ s: await countRemote('workout_sessions'), t: await countRemote('set_records'), p: await countRemote('programs') }).toEqual(before);
  });

  it('offline logging then reconnect: edits made without a network reach the server once, in a valid order', async () => {
    await newDevice(A);
    const gate = { offline: false };
    const remote = pgRemote(pg, A, gate);
    const { program } = await createProgram(routineV6Program(), routineV6Tree(), TODAY);
    const tpl = (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!;
    const s = await S.startScheduled(program.id, tpl.template_key, TODAY, TODAY);
    expect((await syncOnce(remote)).error).toBeNull();
    gate.offline = true;
    const sets = (await S.sessionExercises(s.id)).flatMap((v) => v.sets);
    for (const st of sets.slice(0, 4)) await S.logSet(st.id, { weight_kg: 70, reps: 8, rir: 2 });
    await S.addExerciseToSession(s.id, (await tbl('exercises').toArray()).find((e) => e.seed_key === 'hammer-curl')!.id, 2);
    const failed = await syncOnce(remote);
    expect(failed.error?.retryable).toBe(true);
    expect(await pendingCount()).toBeGreaterThan(0);
    local.close(); await local.open(); // app closed and reopened while offline
    gate.offline = false;
    expect((await syncOnce(remote)).error).toBeNull();
    expect(await pendingCount()).toBe(0);
    expect(await countRemote('set_records')).toBe(11);
    const done = (await as(pg, A, () => pg.query<{ n: number }>(`select count(*)::int n from public.set_records where status = 'completed' and reps = 8`))).rows[0]!.n;
    expect(done).toBe(4);
  });

  it('reinstall / new phone: signing in pulls the whole history back, identical to what was logged', async () => {
    await newDevice(A);
    await logMonday();
    await syncOnce(pgRemote(pg, A));
    const original = (await tbl('set_records').toArray()).map((r) => ({ id: r.id, w: r.weight_kg, reps: r.reps, status: r.status })).sort((a, b) => a.id.localeCompare(b.id));
    await newDevice(null); // wiped phone, signed out
    expect(await tbl('set_records').count()).toBe(0);
    configureRuntime({ userId: A });
    await claimLocalData(A);
    const pulled = await pullAll(pgRemote(pg, A));
    expect(pulled).toBeGreaterThan(0);
    const restored = (await tbl('set_records').toArray()).map((r) => ({ id: r.id, w: r.weight_kg, reps: r.reps, status: r.status })).sort((a, b) => a.id.localeCompare(b.id));
    expect(restored).toEqual(original);
    expect(await tbl('workout_sessions').count()).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it('another device’s newer edit wins and is pulled; the server never lets an older replay clobber it', async () => {
    await newDevice(A);
    const sid = await logMonday();
    const remote = pgRemote(pg, A);
    await syncOnce(remote);
    const target = (await tbl('set_records').where('session_id').equals(sid).toArray())[0]!;
    // device 2 corrects the set later (direct write as the same user, newer client_updated_at)
    await as(pg, A, () => pg.query(`update public.set_records set reps = 12, client_updated_at = now() - interval '1 day' where id = $1`, [target.id]));
    // device 1 replays an older version of the same set
    const stale = { ...target, reps: 3, client_updated_at: '2026-01-01T00:00:00.000Z', _dirty: undefined } as unknown as RemoteRow;
    delete (stale as Record<string, unknown>)._dirty;
    await remote.upsert('set_records', [stale]);
    const server = (await as(pg, A, () => pg.query<{ reps: number }>(`select reps from public.set_records where id = $1`, [target.id]))).rows[0]!;
    expect(server.reps).toBe(12);
    await pullAll(remote);
    expect((await tbl('set_records').get(target.id))!.reps).toBe(12);
  });

  it('another account can never read, overwrite or even detect this account’s workout', async () => {
    await newDevice(A);
    await logMonday();
    await syncOnce(pgRemote(pg, A));
    const asB = pgRemote(pg, B);
    expect(await asB.pull('set_records', null, 100)).toHaveLength(0);
    expect(await asB.pull('workout_sessions', null, 100)).toHaveLength(0);
    const mine = (await tbl('set_records').toArray())[0]!;
    const evil = { ...mine, user_id: B, reps: 1 } as unknown as RemoteRow;
    delete (evil as Record<string, unknown>)._dirty;
    await expect(asB.upsert('set_records', [evil])).rejects.toBeInstanceOf(SyncError);
    expect((await as(pg, A, () => pg.query<{ reps: number }>(`select reps from public.set_records where id = $1`, [mine.id]))).rows[0]!.reps).toBe(10);
  });
});
