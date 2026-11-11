import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local Postgres (PGlite — real Postgres semantics incl. RLS, roles, triggers) with the Supabase pieces the migration relies on
 * stubbed minimally: roles anon/authenticated/service_role, auth.users + auth.uid() (reads request.jwt.claim.sub, the setting
 * PostgREST sets per request), storage.buckets/objects + storage.foldername(). The migration under test is the exact file that
 * gets applied to the Supabase project.
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

export const U = {
  super: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  rec1: '33333333-3333-4333-8333-333333333333',
  view1: '44444444-4444-4444-8444-444444444444',
  rec2: '55555555-5555-4555-8555-555555555555',
  off: '66666666-6666-4666-8666-666666666666',
};
export const E1 = 'e1111111-1111-4111-8111-111111111111';
export const E2 = 'e2222222-2222-4222-8222-222222222222';

export const migrationSql = (file: string): string => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8');

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(migrationSql('20261111000001_core_schema.sql'));
  // First sign-up becomes super admin (bootstrap); the rest are inactive viewers until activated below.
  for (const [k, id] of Object.entries(U)) await db.exec(`insert into auth.users (id, email) values ('${id}', '${k}@example.test')`);
  await db.exec(`
    update public.profiles set role='admin', active=true where id='${U.admin}';
    update public.profiles set role='recruiter', active=true, entity_ids=array['${E1}']::uuid[] where id='${U.rec1}';
    update public.profiles set role='viewer', active=true, entity_ids=array['${E1}']::uuid[] where id='${U.view1}';
    update public.profiles set role='recruiter', active=true, entity_ids=array['${E2}']::uuid[] where id='${U.rec2}';
    update public.profiles set role='recruiter', active=false, entity_ids=array['${E1}']::uuid[] where id='${U.off}';
    insert into public.entities (id, name, code) values ('${E1}', 'Entity One', 'E1'), ('${E2}', 'Entity Two', 'E2');
  `);
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

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const j = (o: unknown): string => JSON.stringify(o).replace(/'/g, "''");

export async function insertMandate(db: PGlite, id: string, entity: string, status = 'open'): Promise<void> {
  await db.exec(`insert into public.mandates (id, entity_id, status, data) values ('${id}', '${entity}', '${status}', '${j({ id, entityId: entity, status })}')`);
}
export async function insertCandidate(db: PGlite, id: string, entity: string): Promise<void> {
  await db.exec(`insert into public.candidates (id, entity_id, data) values ('${id}', '${entity}', '${j({ id, entityId: entity })}')`);
}
export async function insertAssessment(db: PGlite, id: string, mandate: string, candidate: string, entity: string): Promise<void> {
  await db.exec(`insert into public.assessments (id, mandate_id, candidate_id, entity_id, data) values ('${id}', '${mandate}', '${candidate}', '${entity}', '${j({ id, entityId: entity, status: 'strong_match' })}')`);
}
