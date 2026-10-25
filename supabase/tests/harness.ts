import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local Postgres (PGlite, real Postgres semantics incl. RLS, roles, triggers) with the Supabase pieces the migrations rely on
 * stubbed minimally: roles anon/authenticated/service_role, auth.users + auth.uid() (reads request.jwt.claim.sub — the same
 * setting PostgREST sets per request), storage.buckets/objects + storage.foldername().
 * The migration SQL under test is the exact file that gets applied to the Supabase project.
 */
const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p,1)-1]; end $$;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
grant select on auth.users to authenticated;
-- Supabase gives these roles broad default privileges in public; the migration must tighten them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';

export const migrationSql = (file: string): string => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8');

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(migrationSql('20261025000001_core_schema.sql'));
  await db.exec(migrationSql('20261025000002_seed_exercise_library.sql'));
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test')`);
  return db;
}

/** Run `fn` as an authenticated end-user (RLS applies), then restore the session role. */
export async function as<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon`);
  try { return await fn(); } finally { await db.exec(`reset role`); }
}

/** Resolves to the error (code + message) a statement raises, or null when it succeeds. */
export async function failure(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try { await p; return null; } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message ?? String(e) }; }
}
