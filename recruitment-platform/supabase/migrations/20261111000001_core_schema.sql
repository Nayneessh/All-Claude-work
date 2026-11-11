-- Recruitment Intelligence Platform — core schema, row-level security, immutability and storage policies.
-- Model: one row per domain record. Columns that drive access control, foreign keys and filtering are real, typed columns;
-- the full record lives in `data jsonb`. CHECK constraints keep the two in agreement so a client cannot show one entity
-- while storing under another.
--
-- Roles (profiles.role): super_admin | admin | recruiter | viewer
--   super_admin, admin  → see every entity (central administration)
--   recruiter, viewer   → only entities listed in profiles.entity_ids
--   viewer              → read-only, no CV downloads
-- Append-only (enforced by triggers, even for the service role): assessments, decisions, audit_logs, mandate_versions.
-- Approved rubrics are frozen (only approved → superseded is allowed).

-- ───────────────────────── Tables ─────────────────────────
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  code text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  role text not null default 'viewer' check (role in ('super_admin', 'admin', 'recruiter', 'viewer')),
  active boolean not null default false,
  entity_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.mandates (
  id uuid primary key,
  entity_id uuid not null references public.entities(id),
  status text not null check (status in ('open', 'on_hold', 'closed', 'archived')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint mandates_entity_matches check (entity_id::text = data->>'entityId'),
  constraint mandates_status_matches check (status = data->>'status')
);

create table public.mandate_versions (
  id uuid primary key,
  mandate_id uuid not null references public.mandates(id),
  entity_id uuid not null references public.entities(id),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint mandate_versions_entity_matches check (entity_id::text = data->>'entityId')
);

create table public.rubrics (
  id uuid primary key,
  mandate_id uuid not null references public.mandates(id),
  entity_id uuid not null references public.entities(id),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint rubrics_entity_matches check (entity_id::text = data->>'entityId'),
  constraint rubrics_status_matches check (status = data->>'status')
);

create table public.candidates (
  id uuid primary key,
  entity_id uuid not null references public.entities(id),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint candidates_entity_matches check (entity_id::text = data->>'entityId')
);

create table public.candidate_documents (
  id uuid primary key,
  candidate_id uuid not null references public.candidates(id),
  entity_id uuid not null references public.entities(id),
  sha256 text not null default '',
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint candidate_documents_entity_matches check (entity_id::text = data->>'entityId')
);

create table public.assessments (
  id uuid primary key,
  mandate_id uuid not null references public.mandates(id),
  candidate_id uuid not null references public.candidates(id),
  entity_id uuid not null references public.entities(id),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint assessments_entity_matches check (entity_id::text = data->>'entityId')
);

create table public.decisions (
  id uuid primary key,
  assessment_id uuid not null references public.assessments(id),
  mandate_id uuid not null references public.mandates(id),
  candidate_id uuid not null references public.candidates(id),
  entity_id uuid not null references public.entities(id),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint decisions_entity_matches check (entity_id::text = data->>'entityId')
);

create table public.processing_jobs (
  id uuid primary key,
  mandate_id uuid not null references public.mandates(id),
  entity_id uuid not null references public.entities(id),
  status text not null check (status in ('uploaded', 'queued', 'extracting', 'extracted', 'screening', 'completed', 'needs_review', 'failed')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint processing_jobs_entity_matches check (entity_id::text = data->>'entityId'),
  constraint processing_jobs_status_matches check (status = data->>'status')
);

create table public.audit_logs (
  id uuid primary key,
  at timestamptz not null,
  user_id uuid not null,
  entity_id uuid references public.entities(id),
  target_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index on public.departments (entity_id);
create index on public.mandates (entity_id, status);
create index on public.mandate_versions (mandate_id);
create index on public.rubrics (mandate_id, status);
create index on public.candidates (entity_id);
create index on public.candidate_documents (candidate_id);
create index on public.candidate_documents (entity_id, sha256);
create index on public.assessments (mandate_id, candidate_id);
create index on public.assessments (entity_id);
create index on public.decisions (assessment_id);
create index on public.processing_jobs (mandate_id, status);
create index on public.audit_logs (at desc);
create index on public.audit_logs (target_id);

-- ───────────────────────── Access helpers ─────────────────────────
-- SECURITY DEFINER so policies can read profiles without recursing into profiles' own RLS.
create function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('super_admin', 'admin'), false)
$$;

create function public.app_is_writer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('super_admin', 'admin', 'recruiter'), false)
$$;

create function public.app_can_see_entity(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and (p.role in ('super_admin', 'admin') or e = any (p.entity_ids))
  )
$$;

-- A candidate is central; it is visible through its owning entity or through any assessment in an entity the user can see.
create function public.app_can_see_candidate(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.candidates x where x.id = c and public.app_can_see_entity(x.entity_id))
      or exists (select 1 from public.assessments a where a.candidate_id = c and public.app_can_see_entity(a.entity_id))
$$;

-- ───────────────────────── Row-level security ─────────────────────────
alter table public.entities enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.mandates enable row level security;
alter table public.mandate_versions enable row level security;
alter table public.rubrics enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_documents enable row level security;
alter table public.assessments enable row level security;
alter table public.decisions enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.audit_logs enable row level security;

create policy entities_read on public.entities for select to authenticated using (public.app_can_see_entity(id));
create policy entities_write on public.entities for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

create policy departments_read on public.departments for select to authenticated using (public.app_can_see_entity(entity_id));
create policy departments_write on public.departments for all to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.app_is_admin());
create policy profiles_insert on public.profiles for insert to authenticated with check (public.app_is_admin());
create policy profiles_update on public.profiles for update to authenticated using (public.app_is_admin()) with check (public.app_is_admin());

create policy mandates_read on public.mandates for select to authenticated using (public.app_can_see_entity(entity_id));
create policy mandates_insert on public.mandates for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));
create policy mandates_update on public.mandates for update to authenticated using (public.app_is_writer() and public.app_can_see_entity(entity_id)) with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

create policy mandate_versions_read on public.mandate_versions for select to authenticated using (public.app_can_see_entity(entity_id));
create policy mandate_versions_insert on public.mandate_versions for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

create policy rubrics_read on public.rubrics for select to authenticated using (public.app_can_see_entity(entity_id));
create policy rubrics_insert on public.rubrics for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));
create policy rubrics_update on public.rubrics for update to authenticated using (public.app_is_writer() and public.app_can_see_entity(entity_id)) with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

create policy candidates_read on public.candidates for select to authenticated using (public.app_can_see_candidate(id));
create policy candidates_insert on public.candidates for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));
create policy candidates_update on public.candidates for update to authenticated using (public.app_is_writer() and public.app_can_see_entity(entity_id)) with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

create policy candidate_documents_read on public.candidate_documents for select to authenticated using (public.app_can_see_candidate(candidate_id));
create policy candidate_documents_insert on public.candidate_documents for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));
create policy candidate_documents_update on public.candidate_documents for update to authenticated using (public.app_is_writer() and public.app_can_see_entity(entity_id)) with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

create policy assessments_read on public.assessments for select to authenticated using (public.app_can_see_entity(entity_id));
create policy assessments_insert on public.assessments for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

create policy decisions_read on public.decisions for select to authenticated using (public.app_can_see_entity(entity_id));
create policy decisions_insert on public.decisions for insert to authenticated
  with check (public.app_is_writer() and public.app_can_see_entity(entity_id) and data->>'decidedBy' = auth.uid()::text);

create policy processing_jobs_read on public.processing_jobs for select to authenticated using (public.app_can_see_entity(entity_id));
create policy processing_jobs_insert on public.processing_jobs for insert to authenticated with check (public.app_is_writer() and public.app_can_see_entity(entity_id));
create policy processing_jobs_update on public.processing_jobs for update to authenticated using (public.app_is_writer() and public.app_can_see_entity(entity_id)) with check (public.app_is_writer() and public.app_can_see_entity(entity_id));

-- Audit: administrators read it; any active user appends rows attributed to themselves.
create policy audit_logs_read on public.audit_logs for select to authenticated using (public.app_is_admin());
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (public.app_role() is not null and user_id = auth.uid() and (entity_id is null or public.app_can_see_entity(entity_id)));

-- ───────────────────────── Privileges ─────────────────────────
-- Supabase grants broad defaults in `public`; take them away and give back only what the policies need.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke execute on all functions in schema public from public;

grant select on public.entities, public.departments, public.mandates, public.mandate_versions, public.rubrics, public.candidates,
  public.candidate_documents, public.assessments, public.decisions, public.processing_jobs, public.audit_logs, public.profiles to authenticated;
grant insert, update on public.entities, public.departments, public.mandates, public.rubrics, public.candidates,
  public.candidate_documents, public.processing_jobs to authenticated;
grant insert, update on public.profiles to authenticated;
grant insert on public.mandate_versions, public.assessments, public.decisions, public.audit_logs to authenticated;
grant execute on function public.app_role(), public.app_is_admin(), public.app_is_writer(),
  public.app_can_see_entity(uuid), public.app_can_see_candidate(uuid) to authenticated;

-- ───────────────────────── Immutability ─────────────────────────
create function public.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: records cannot be updated or deleted', tg_table_name using errcode = 'P0001';
end $$;

create trigger assessments_append_only before update or delete on public.assessments for each row execute function public.forbid_change();
create trigger decisions_append_only before update or delete on public.decisions for each row execute function public.forbid_change();
create trigger audit_logs_append_only before update or delete on public.audit_logs for each row execute function public.forbid_change();
create trigger mandate_versions_append_only before update or delete on public.mandate_versions for each row execute function public.forbid_change();
create trigger assessments_no_truncate before truncate on public.assessments for each statement execute function public.forbid_change();
create trigger decisions_no_truncate before truncate on public.decisions for each statement execute function public.forbid_change();
create trigger audit_logs_no_truncate before truncate on public.audit_logs for each statement execute function public.forbid_change();
create trigger mandate_versions_no_truncate before truncate on public.mandate_versions for each statement execute function public.forbid_change();

-- An approved rubric never changes; it can only be retired (approved → superseded). Rubrics are never deleted.
create function public.rubric_freeze() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rubrics cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  if old.status = 'approved' and new.status in ('approved', 'superseded')
     and (old.data - 'status') = (new.data - 'status') then
    return new;
  end if;
  if old.status = 'superseded' and new.data = old.data then
    return new;
  end if;
  raise exception 'an approved rubric is frozen: create a new version instead' using errcode = 'P0001';
end $$;
create trigger rubrics_freeze before update or delete on public.rubrics for each row execute function public.rubric_freeze();

-- Nothing else is hard-deleted either: soft-delete / merge links live in the record.
create function public.forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception '% records are never hard-deleted', tg_table_name using errcode = 'P0001';
end $$;
create trigger mandates_no_delete before delete on public.mandates for each row execute function public.forbid_delete();
create trigger candidates_no_delete before delete on public.candidates for each row execute function public.forbid_delete();
create trigger candidate_documents_no_delete before delete on public.candidate_documents for each row execute function public.forbid_delete();
create trigger processing_jobs_no_delete before delete on public.processing_jobs for each row execute function public.forbid_delete();

-- ───────────────────────── Profiles: escalation guard + bootstrap ─────────────────────────
-- Only a super_admin may grant admin-level roles; nobody may edit their own role or activation.
create function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := public.app_role();
begin
  if auth.uid() is null then return new; end if; -- trusted server contexts (migrations, service role)
  if tg_op = 'INSERT' then
    if new.role in ('super_admin', 'admin') and actor is distinct from 'super_admin' then
      raise exception 'only a super admin can create administrators' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active or new.entity_ids is distinct from old.entity_ids) then
    raise exception 'you cannot change your own role, activation or entity access' using errcode = '42501';
  end if;
  if (new.role in ('super_admin', 'admin') or old.role in ('super_admin', 'admin')) and new.role is distinct from old.role and actor is distinct from 'super_admin' then
    raise exception 'only a super admin can change administrator roles' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public.profiles_guard();

-- First sign-up becomes the super admin; everyone after starts as an inactive viewer until an administrator activates them.
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, name, role, active)
  values (new.id, new.email, coalesce(split_part(new.email, '@', 1), ''), case when first_user then 'super_admin' else 'viewer' end, first_user);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────────────────── Storage (original CVs) ─────────────────────────
-- Private bucket; object path is <entity_id>/<job_id>/<file>. Viewers cannot download. Files are write-once.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 10485760,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy cvs_read on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and public.app_is_writer() and public.app_can_see_entity(((storage.foldername(name))[1])::uuid));
create policy cvs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs' and public.app_is_writer() and public.app_can_see_entity(((storage.foldername(name))[1])::uuid));
