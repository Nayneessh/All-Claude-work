import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Real Postgres semantics (PGlite): roles, RLS, SECURITY DEFINER, triggers. Loads the exact migration files. */
export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

export const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const COSMO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const NOBODY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

export async function seedStaff(db: PGlite) {
  await db.exec(`
    insert into ss.staff (user_id, email, role) values
      ('${ADMIN}', 'admin@example.test', 'admin'),
      ('${COSMO}', 'cosmo@example.test', 'cosmetologist');`);
}

/** Run as a signed-in API caller with the given verified claims, the way the API does. */
export async function asClaims<T>(db: PGlite, claims: Record<string, unknown> | null, fn: () => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? {})]);
    const out = await fn();
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}
export const staff = (id: string, email: string, aal: 'aal1' | 'aal2' = 'aal2') => ({ sub: id, email, aal });

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    await db.exec('set local role anon');
    const out = await fn();
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

export async function failure(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function seedCase(db: PGlite, o: { booked?: boolean; flagged?: boolean; contact?: boolean; code?: string } = {}) {
  const code = o.code ?? `SS-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const hash = `h${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into ss.cases (code, token_hash, lang, path, stage, answers, safety_stopped, safety_flags, expires_at)
     values ($1, $2, 'en', 'maintenance', $3, '{"budget":"b500_1500","skin_feel":"dry_tight"}'::jsonb, $4, $5::jsonb, now() + interval '72 hours') returning id`,
    [code, hash, o.flagged ? 'safety_stopped' : 'snapshot_ready', !!o.flagged, o.flagged ? '[{"code":"changing_mole","source":"answers"}]' : '[]'],
  );
  const id = rows[0]!.id;
  await db.query(`insert into ss.consents (case_id, key, version, lang) values ($1,'privacy','v','en'),($1,'health','v','en'),($1,'photos_ai','v','en')`, [id]);
  await db.query(`insert into ss.photos (case_id, slot, status, object_key, width, height) values ($1,'front','stored',$2,800,1000)`, [id, `cases/${id}/front.jpg`]);
  await db.query(`insert into ss.objects (key, content_type, bytes) values ($1,'image/jpeg', '\\x00'::bytea)`, [`cases/${id}/front.jpg`]);
  await db.query(
    `insert into ss.analyses (case_id, path, status, result, finished_at) values ($1,'maintenance','done','{"observations":[]}'::jsonb, now())`,
    [id],
  );
  if (o.booked) {
    await db.query(
      `insert into ss.bookings (case_id, name, first_name, whatsapp_e164, whatsapp_hash, preferred_day, time_window, method)
       values ($1,'Priya Sharma','Priya','+919876543210','whash', current_date + 2, 'morning', 'chat')`,
      [id],
    );
    if (o.contact !== false) await db.query(`insert into ss.consents (case_id, key, version, lang) values ($1,'whatsapp','v','en')`, [id]);
    await db.query(`update ss.cases set booked_at = now(), expires_at = null where id = $1`, [id]);
  }
  return { id, code };
}
