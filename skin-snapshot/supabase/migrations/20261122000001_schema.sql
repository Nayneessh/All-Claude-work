-- Skin Snapshot, Phase 1. Schema.
-- Plain PostgreSQL: runs on Supabase or any Postgres 15+. All objects live in schema "ss",
-- which Supabase does not expose through its REST API.
set check_function_bodies = off;

create schema if not exists ss;

-- Roles that Supabase provides. Created only when missing so the same file runs on plain Postgres.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create table ss.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table ss.cases (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  token_hash text not null unique,
  lang text not null check (lang in ('en', 'hi')),
  path text not null check (path in ('maintenance', 'concerns', 'scars')),
  stage text not null default 'consented' check (stage in (
    'consented', 'answers_done', 'photos_ready', 'analysing', 'snapshot_ready',
    'safety_stopped', 'analysis_failed', 'needs_retake', 'needs_path_questions')),
  answers jsonb not null default '{}'::jsonb,
  answers_at timestamptz,
  safety_flags jsonb not null default '[]'::jsonb,
  restrictions jsonb not null default '[]'::jsonb,
  safety_stopped boolean not null default false,
  gate_a_version text,
  pending_path text check (pending_path in ('maintenance', 'concerns', 'scars')),
  session_id text,
  device_hash text,
  ip_hash text,
  eval_consent boolean not null default false,
  health_withdrawn boolean not null default false,
  contact_withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Retention deadline. NULL for an open booked case (it runs until closure plus the closure period).
  expires_at timestamptz,
  booked_at timestamptz,
  closed_at timestamptz
);
create index cases_expires_idx on ss.cases (expires_at) where expires_at is not null;
create index cases_created_idx on ss.cases (created_at desc);

create table ss.consents (
  id bigserial primary key,
  case_id uuid not null references ss.cases (id) on delete cascade,
  key text not null check (key in ('privacy', 'health', 'photos_ai', 'whatsapp', 'evaluation')),
  version text not null,
  lang text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create unique index consents_one_active on ss.consents (case_id, key) where withdrawn_at is null;

create table ss.photos (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references ss.cases (id) on delete cascade,
  slot text not null check (slot in ('front', 'left', 'right', 'closeup')),
  status text not null default 'pending' check (status in ('pending', 'stored')),
  content_type text not null default 'image/jpeg',
  size_bytes integer,
  width integer,
  height integer,
  client_checks jsonb,
  server_checks jsonb,
  object_key text,
  created_at timestamptz not null default now(),
  stored_at timestamptz,
  unique (case_id, slot)
);

-- Object storage used by the "postgres" storage adapter. The "s3" adapter does not use it.
create table ss.objects (
  key text primary key,
  content_type text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

-- Keys whose backing object must be removed (needed for external object stores).
create table ss.storage_deletions (
  key text primary key,
  queued_at timestamptz not null default now()
);

create table ss.analyses (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references ss.cases (id) on delete cascade,
  path text not null check (path in ('maintenance', 'concerns', 'scars')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  passes integer,
  disagreements integer,
  gate_b jsonb,
  -- Validated, normalised observations only. Never raw model text.
  result jsonb,
  error_code text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  lock_until timestamptz
);
create index analyses_case_idx on ss.analyses (case_id, queued_at desc);

create table ss.bookings (
  case_id uuid primary key references ss.cases (id) on delete cascade,
  name text not null,
  first_name text not null,
  whatsapp_e164 text not null,
  whatsapp_hash text not null,
  preferred_day date not null,
  time_window text not null check (time_window in ('morning', 'afternoon', 'evening')),
  method text not null check (method in ('whatsapp_call', 'whatsapp_video', 'chat')),
  note text not null default '',
  status text not null default 'requested' check (status in (
    'requested', 'contacted', 'scheduled', 'completed', 'no_response', 'closed')),
  requested_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  contacted_at timestamptz
);
create index bookings_status_idx on ss.bookings (status, requested_at desc);

create table ss.staff (
  user_id uuid primary key,
  email text not null,
  role text not null check (role in ('admin', 'cosmetologist')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table ss.case_notes (
  id bigserial primary key,
  case_id uuid not null references ss.cases (id) on delete cascade,
  author uuid not null,
  author_email text,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table ss.ai_feedback (
  id bigserial primary key,
  case_id uuid not null references ss.cases (id) on delete cascade,
  analysis_id uuid references ss.analyses (id) on delete cascade,
  kind text not null default 'observation' check (kind in ('observation', 'missed_flag', 'false_flag')),
  zone text,
  attribute text,
  verdict text check (verdict in ('agree', 'disagree')),
  comment text,
  author uuid not null,
  created_at timestamptz not null default now()
);
create unique index ai_feedback_one_per_author on ss.ai_feedback (case_id, (coalesce(analysis_id, '00000000-0000-0000-0000-000000000000'::uuid)), kind, (coalesce(zone, '')), (coalesce(attribute, '')), author);

-- Append-only: who opened which case and when. Survives case deletion by design.
create table ss.access_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text,
  action text not null,
  case_id uuid,
  case_code text,
  meta jsonb not null default '{}'::jsonb
);
create index access_log_at_idx on ss.access_log (at desc);

create table ss.routine_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  steps smallint not null check (steps in (2, 3)),
  skin_feel text not null default 'any' check (skin_feel in ('dry', 'balanced', 'oily', 'any')),
  sensitivity text not null default 'any' check (sensitivity in ('low', 'high', 'any')),
  budget_bands text[] not null default '{}',
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  approved boolean not null default false,
  sample boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- First-party analytics. Step names and timings only; no photos, answers or contact details.
create table ss.events (
  id bigserial primary key,
  at timestamptz not null default now(),
  session_id text,
  name text not null,
  path text,
  lang text,
  props jsonb not null default '{}'::jsonb
);
create index events_name_at_idx on ss.events (name, at);
create index events_session_idx on ss.events (session_id, at);

create table ss.rate_limits (
  key text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);
create index rate_limits_exp_idx on ss.rate_limits (expires_at);

create table ss.blocked_numbers (
  whatsapp_hash text primary key,
  reason text,
  blocked_by uuid,
  blocked_at timestamptz not null default now()
);

-- IDs only. Replayed after any backup restore so deleted cases stay deleted.
create table ss.deletion_ledger (
  id bigserial primary key,
  case_id uuid not null,
  case_code text,
  reason text not null check (reason in ('visitor_request', 'consent_withdrawn', 'retention_expired', 'staff_request')),
  deleted_at timestamptz not null default now()
);

create table ss.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references ss.cases (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create function ss.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger cases_touch before update on ss.cases for each row execute function ss.touch_updated_at();
create trigger templates_touch before update on ss.routine_templates for each row execute function ss.touch_updated_at();

-- When a photo row disappears, queue its object for removal (covers cascades from case deletion).
create function ss.queue_object_deletion() returns trigger language plpgsql as $$
begin
  if old.object_key is not null then
    insert into ss.storage_deletions (key) values (old.object_key) on conflict do nothing;
  end if;
  return old;
end $$;
create trigger photos_queue_deletion after delete on ss.photos for each row execute function ss.queue_object_deletion();

-- Access log is append-only, even for the table owner's application code.
create function ss.access_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'access_log is append-only' using errcode = '42501';
end $$;
create trigger access_log_no_update before update or delete on ss.access_log for each row execute function ss.access_log_immutable();
