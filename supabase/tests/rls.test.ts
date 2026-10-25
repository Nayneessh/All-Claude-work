import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, as, asAnon, failure, freshDb } from './harness';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LIB_EXERCISE = '(select id from public.exercises where seed_key = \'leg-press\')';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); }, 60_000);
afterAll(async () => { await db.close(); });

async function seedUser(uid: string, base: number): Promise<void> {
  await as(db, uid, async () => {
    await db.query(`insert into public.profiles (id, user_id, display_name) values ($1, $1, 'Athlete')`, [uid]);
    await db.query(`insert into public.programs (id, user_id, name) values ($1, $2, 'Program')`, [id(base), uid]);
    await db.query(`insert into public.workout_sessions (id, user_id, name, session_date, status, dedupe_key) values ($1, $2, 'Back #1', '2026-10-26', 'in_progress', 'sched:k:2026-10-26')`, [id(base + 1), uid]);
    await db.query(`insert into public.session_exercises (id, user_id, session_id, exercise_id) values ($1, $2, $3, ${LIB_EXERCISE})`, [id(base + 2), uid, id(base + 1)]);
    await db.query(`insert into public.set_records (id, user_id, session_id, session_exercise_id, exercise_id, session_date, set_number, weight_kg, reps, status)
      values ($1, $2, $3, $4, ${LIB_EXERCISE}, '2026-10-26', 1, 80, 10, 'completed')`, [id(base + 3), uid, id(base + 1), id(base + 2)]);
  });
}

describe('schema and seed', () => {
  it('applies cleanly on a fresh database and seeds the built-in exercise library idempotently', async () => {
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.exercises where user_id is null`);
    expect(n.rows[0]!.n).toBe(110);
    await db.exec((await import('./harness')).migrationSql('20261025000002_seed_exercise_library.sql')); // re-apply
    const m = await db.query<{ n: number }>(`select count(*)::int n from public.exercises where user_id is null`);
    expect(m.rows[0]!.n).toBe(110);
  });
  it('enables and FORCES row level security on every user-owned table, with exactly select/insert/update policies', async () => {
    const t = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
    expect(t.rows.length).toBe(17);
    for (const r of t.rows) { expect(r.relrowsecurity, r.relname).toBe(true); expect(r.relforcerowsecurity, r.relname).toBe(true); }
    const p = await db.query<{ tablename: string; cmd: string }>(`select tablename, cmd from pg_policies where schemaname = 'public'`);
    expect(p.rows.length).toBe(17 * 3);
    expect(p.rows.some((x) => x.cmd === 'DELETE' || x.cmd === 'ALL')).toBe(false);
  });
});

describe('identity isolation (RLS)', () => {
  beforeAll(async () => { await seedUser(A, 100); await seedUser(B, 200); }, 30_000);

  it('each user sees only their own rows in every table they populated', async () => {
    for (const table of ['profiles', 'programs', 'workout_sessions', 'session_exercises', 'set_records']) {
      const a = await as(db, A, () => db.query<{ user_id: string }>(`select user_id from public.${table}`));
      const b = await as(db, B, () => db.query<{ user_id: string }>(`select user_id from public.${table}`));
      expect(a.rows.length, `${table} A`).toBe(1); expect(a.rows.every((r) => r.user_id === A), `${table} A`).toBe(true);
      expect(b.rows.length, `${table} B`).toBe(1); expect(b.rows.every((r) => r.user_id === B), `${table} B`).toBe(true);
    }
  });
  it('an unauthenticated session (no uid) sees nothing and can write nothing', async () => {
    const r = await as(db, null, () => db.query(`select * from public.set_records`));
    expect(r.rows).toHaveLength(0);
    const e = await as(db, null, () => failure(db.query(`insert into public.programs (id, user_id, name) values ($1, $2, 'x')`, [id(900), A])));
    expect(e?.message).toMatch(/row-level security/);
  });
  it('the anon role has no access to any table', async () => {
    for (const table of ['profiles', 'exercises', 'set_records', 'workout_sessions']) {
      const e = await asAnon(db, () => failure(db.query(`select * from public.${table}`)));
      expect(e?.message, table).toMatch(/permission denied/);
    }
  });
  it('B cannot insert a row owned by A', async () => {
    const e = await as(db, B, () => failure(db.query(`insert into public.programs (id, user_id, name) values ($1, $2, 'sneaky')`, [id(901), A])));
    expect(e?.message).toMatch(/row-level security/);
  });
  it('B cannot update or take over A’s rows, and an upsert onto A’s id is rejected', async () => {
    const upd = await as(db, B, () => db.query(`update public.set_records set reps = 999 where id = $1`, [id(103)]));
    expect(upd.affectedRows).toBe(0);
    // ownership can never change: the guard trigger pins user_id, so the statement is harmless
    await as(db, B, () => db.query(`update public.programs set user_id = $2 where id = $1`, [id(200), A]));
    const owner = await db.query<{ user_id: string }>(`select user_id from public.programs where id = $1`, [id(200)]);
    expect(owner.rows[0]!.user_id).toBe(B);
    const upsert = await as(db, B, () => failure(db.query(
      `insert into public.programs (id, user_id, name) values ($1, $2, 'hijack') on conflict (id) do update set name = excluded.name`, [id(100), B])));
    expect(upsert?.message).toMatch(/row-level security/);
    const still = await as(db, A, () => db.query<{ name: string; reps: number }>(`select p.name, s.reps from public.programs p, public.set_records s where p.id = $1 and s.id = $2`, [id(100), id(103)]));
    expect(still.rows[0]).toMatchObject({ name: 'Program', reps: 10 });
  });
  it('a user cannot reassign their own row to someone else (ownership is pinned by the guard)', async () => {
    await as(db, A, () => db.query(`update public.programs set user_id = $2 where id = $1`, [id(100), B]));
    const owner = await db.query<{ user_id: string }>(`select user_id from public.programs where id = $1`, [id(100)]);
    expect(owner.rows[0]!.user_id).toBe(A);
    const bSees = await as(db, B, () => db.query(`select 1 from public.programs where id = $1`, [id(100)]));
    expect(bSees.rows).toHaveLength(0);
  });
  it('clients can never DELETE or TRUNCATE — history is archived, not destroyed', async () => {
    for (const table of ['set_records', 'workout_sessions', 'programs', 'exercises']) {
      const e = await as(db, A, () => failure(db.query(`delete from public.${table}`)));
      expect(e?.message, table).toMatch(/permission denied/);
    }
    const t = await as(db, A, () => failure(db.query(`truncate public.set_records`)));
    expect(t?.message).toMatch(/permission denied/);
  });
});

describe('built-in library vs custom exercises', () => {
  it('everyone can read built-ins but not modify or remove them', async () => {
    for (const uid of [A, B]) {
      const r = await as(db, uid, () => db.query<{ n: number }>(`select count(*)::int n from public.exercises where user_id is null`));
      expect(r.rows[0]!.n).toBe(110);
      const upd = await as(db, uid, () => db.query(`update public.exercises set name = 'pwned' where user_id is null`));
      expect(upd.affectedRows).toBe(0);
      const ins = await as(db, uid, () => failure(db.query(`insert into public.exercises (id, user_id, seed_key, name) values ($1, null, 'evil', 'Evil')`, [id(950)])));
      expect(ins?.message).toMatch(/row-level security/);
    }
  });
  it('custom exercises are private to their owner', async () => {
    await as(db, A, () => db.query(`insert into public.exercises (id, user_id, name, is_custom) values ($1, $2, 'My Cable Fly', true)`, [id(960), A]));
    const b = await as(db, B, () => db.query(`select 1 from public.exercises where id = $1`, [id(960)]));
    expect(b.rows).toHaveLength(0);
    const a = await as(db, A, () => db.query(`select 1 from public.exercises where id = $1`, [id(960)]));
    expect(a.rows).toHaveLength(1);
  });
  it('an exercise is either built-in (seed_key, no owner) or custom (owner, no seed_key) — never both', async () => {
    const e = await as(db, A, () => failure(db.query(`insert into public.exercises (id, user_id, seed_key, name) values ($1, $2, 'x-key', 'Mixed')`, [id(961), A])));
    expect(e).not.toBeNull();
  });
});

describe('sync guard (deterministic last-writer-wins, idempotency)', () => {
  const upsert = (uid: string, name: string, at: string) => db.query(
    `insert into public.programs (id, user_id, name, client_updated_at) values ($1, $2, $3, $4)
     on conflict (id) do update set name = excluded.name, client_updated_at = excluded.client_updated_at`, [id(300), uid, name, at]);
  it('upserting the same row repeatedly is idempotent (exactly one row)', async () => {
    for (let i = 0; i < 3; i++) await as(db, A, () => upsert(A, 'v1', '2026-01-26T08:00:00Z'));
    const r = await as(db, A, () => db.query<{ n: number }>(`select count(*)::int n from public.programs where id = $1`, [id(300)]));
    expect(r.rows[0]!.n).toBe(1);
  });
  it('a newer client edit wins; a stale replay (older client_updated_at) is ignored and never overwrites it', async () => {
    await as(db, A, () => upsert(A, 'newer', '2026-01-26T09:00:00Z'));
    await as(db, A, () => upsert(A, 'stale replay', '2026-01-26T08:30:00Z'));
    const r = await as(db, A, () => db.query<{ name: string }>(`select name from public.programs where id = $1`, [id(300)]));
    expect(r.rows[0]!.name).toBe('newer');
  });
  it('server_updated_at advances on every accepted write (keyset pull cursor) and ownership is immutable', async () => {
    const before = await as(db, A, () => db.query<{ s: string }>(`select server_updated_at::text s from public.programs where id = $1`, [id(300)]));
    await as(db, A, () => upsert(A, 'newest', '2026-01-26T10:00:00Z'));
    const after = await as(db, A, () => db.query<{ s: string; user_id: string }>(`select server_updated_at::text s, user_id from public.programs where id = $1`, [id(300)]));
    expect(after.rows[0]!.s > before.rows[0]!.s).toBe(true);
    expect(after.rows[0]!.user_id).toBe(A);
  });
  it('a device with a wrong (far-future) clock cannot win forever: client_updated_at is clamped', async () => {
    await as(db, A, () => upsert(A, 'future clock', '2099-01-01T00:00:00Z'));
    const r = await as(db, A, () => db.query<{ future: boolean }>(`select client_updated_at < now() + interval '1 hour' as future from public.programs where id = $1`, [id(300)]));
    expect(r.rows[0]!.future).toBe(true);
  });
  it('a duplicate scheduled session (same dedupe_key) is rejected per user, but another user may use the same key', async () => {
    const dup = await as(db, A, () => failure(db.query(`insert into public.workout_sessions (id, user_id, name, session_date, dedupe_key) values ($1, $2, 'dup', '2026-10-26', 'sched:k:2026-10-26')`, [id(310), A])));
    expect(dup?.code).toBe('23505');
    // B already holds the very same key from seeding: uniqueness is per user, not global
    const both = await db.query<{ n: number }>(`select count(distinct user_id)::int n from public.workout_sessions where dedupe_key = 'sched:k:2026-10-26'`);
    expect(both.rows[0]!.n).toBe(2);
  });
});

describe('data integrity constraints', () => {
  const bad = (cols: string, vals: string) => as(db, A, () => failure(db.query(
    `insert into public.set_records (id, user_id, session_id, session_exercise_id, exercise_id, session_date, set_number, ${cols}) values ($1, $2, $3, $4, ${LIB_EXERCISE}, '2026-10-26', 9, ${vals})`, [id(Math.floor(Math.random() * 1e6) + 5000), A, id(101), id(102)])));
  it('rejects impossible actuals (negative reps, RPE > 10, absurd weight, unknown status)', async () => {
    expect((await bad('reps', '-1'))?.code).toBe('23514');
    expect((await bad('rpe', '11'))?.code).toBe('23514');
    expect((await bad('weight_kg', '5000'))?.code).toBe('23514');
    expect((await bad('status', `'done'`))?.code).toBe('23514');
  });
  it('stores a missing actual as NULL, not zero (planned and actual are separate columns)', async () => {
    await as(db, A, () => db.query(`insert into public.set_records (id, user_id, session_id, session_exercise_id, exercise_id, session_date, set_number, planned_weight_kg, planned_reps_min, planned_reps_max)
      values ($1, $2, $3, $4, ${LIB_EXERCISE}, '2026-10-26', 2, 80, 10, 12)`, [id(120), A, id(101), id(102)]));
    const r = await as(db, A, () => db.query<{ weight_kg: number | null; reps: number | null; planned_weight_kg: number }>(`select weight_kg::float8, reps, planned_weight_kg::float8 from public.set_records where id = $1`, [id(120)]));
    expect(r.rows[0]).toMatchObject({ weight_kg: null, reps: null, planned_weight_kg: 80 });
  });
  it('foreign keys prevent orphan sets', async () => {
    const e = await as(db, A, () => failure(db.query(`insert into public.set_records (id, user_id, session_id, session_exercise_id, exercise_id, session_date, set_number)
      values ($1, $2, $3, $4, ${LIB_EXERCISE}, '2026-10-26', 1)`, [id(121), A, id(999), id(998)])));
    expect(e?.code).toBe('23503');
  });
});

describe('private photo storage', () => {
  it('the bucket is private, size-limited and image-only', async () => {
    const b = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'progress-photos'`);
    expect(b.rows[0]).toMatchObject({ public: false, file_size_limit: '5242880', allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] });
  });
  it('users can only write to and read from their own folder', async () => {
    const own = await as(db, A, () => failure(db.query(`insert into storage.objects (bucket_id, name) values ('progress-photos', $1)`, [`${A}/2026-10-26.jpg`])));
    expect(own).toBeNull();
    const foreign = await as(db, A, () => failure(db.query(`insert into storage.objects (bucket_id, name) values ('progress-photos', $1)`, [`${B}/stolen.jpg`])));
    expect(foreign?.message).toMatch(/row-level security/);
    const seenByB = await as(db, B, () => db.query(`select 1 from storage.objects where bucket_id = 'progress-photos'`));
    expect(seenByB.rows).toHaveLength(0);
    const seenByA = await as(db, A, () => db.query(`select 1 from storage.objects where bucket_id = 'progress-photos'`));
    expect(seenByA.rows).toHaveLength(1);
  });
});

describe('account deletion', () => {
  it('requires authentication and is not callable by anon', async () => {
    const none = await as(db, null, () => failure(db.query(`select public.delete_my_account()`)));
    expect(none?.message).toMatch(/not authenticated/);
    const anon = await asAnon(db, () => failure(db.query(`select public.delete_my_account()`)));
    expect(anon?.message).toMatch(/permission denied/);
  });
  it('removes the caller’s data and files — and only the caller’s', async () => {
    await as(db, A, () => db.query(`select public.delete_my_account()`));
    const left = await db.query<{ n: number }>(`select (select count(*) from public.set_records where user_id = $1)::int a, (select count(*) from public.set_records where user_id = $2)::int b`, [A, B]);
    expect(left.rows[0]).toMatchObject({ a: 0, b: 1 });
    const files = await db.query<{ n: number }>(`select count(*)::int n from storage.objects where name like $1`, [`${A}/%`]);
    expect(files.rows[0]!.n).toBe(0);
    const lib = await db.query<{ n: number }>(`select count(*)::int n from public.exercises where user_id is null`);
    expect(lib.rows[0]!.n).toBe(110);
  });
});
