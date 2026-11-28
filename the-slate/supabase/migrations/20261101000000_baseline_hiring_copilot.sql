-- =====================================================================================================
-- BASELINE — the Hiring Copilot schema exactly as it existed on 2026-11-28 (before THE SLATE).
-- Purpose: lets a brand-new Supabase/Postgres instance be built from zero by replaying migrations in order.
-- The live hiring-copilot project already contains all of this (applied earlier as six migrations), so this file
-- is NOT applied to it again; it is replayed only on fresh databases (new server, tests).
-- =====================================================================================================

create table if not exists public.allowed_emails (email text primary key);
alter table public.allowed_emails enable row level security;

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.enforce_allowed_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    raise exception 'Sign-ups are restricted';
  end if;
  return new;
end $$;
drop trigger if exists enforce_allowed_email on auth.users;
create trigger enforce_allowed_email before insert on auth.users for each row execute function public.enforce_allowed_email();

create table if not exists public.mandates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null, company text, stakeholder text, level text,
  positions integer not null default 1, location text, work_mode text, reporting_to text, span text, budget text,
  urgency text not null default 'Medium', confidential boolean not null default false,
  status text not null default 'active' check (status = any (array['active','on_hold','closed','cancelled'])),
  target_close date, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  closed_at timestamptz, close_outcome text check (close_outcome = any (array['filled','cancelled'])), close_note text,
  agencies text[] not null default '{}', agency_shared boolean not null default false, agency_shared_at timestamptz,
  received_on date, started_on date, status_note text, status_changed_at timestamptz
);
create index if not exists mandates_user_idx on public.mandates (user_id);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  mandate_id uuid not null references public.mandates(id),
  name text not null, current_company text, designation text, phone text, email text, notice_period text,
  expected_ctc text, offered_ctc text, joining_date date,
  status text not null default 'active' check (status = any (array['active','on_hold','rejected','dropped','offered','joined'])),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source text, selected_at timestamptz, closed_reason text, closed_at timestamptz,
  rounds jsonb not null default '[]', status_log jsonb not null default '[]', stage text
);
create index if not exists candidates_mandate_idx on public.candidates (mandate_id);
create index if not exists candidates_user_idx on public.candidates (user_id);

create table if not exists public.steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  scope text not null check (scope = any (array['mandate','candidate'])),
  mandate_id uuid not null references public.mandates(id),
  candidate_id uuid references public.candidates(id),
  seq numeric not null, phase text, title text not null, hint text, template_key text,
  is_adhoc boolean not null default false,
  status text not null default 'todo' check (status = any (array['todo','waiting','done','skipped'])),
  due_date date, due_auto boolean not null default false, follow_up_date date, note text, skip_reason text,
  completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint candidate_scope_needs_candidate check (scope = 'mandate' or candidate_id is not null)
);
create index if not exists steps_candidate_idx on public.steps (candidate_id);
create index if not exists steps_mandate_idx on public.steps (mandate_id);
create index if not exists steps_open_due_idx on public.steps (user_id, status, due_date);
create index if not exists steps_user_idx on public.steps (user_id);

create table if not exists public.app_settings (
  user_id uuid primary key default auth.uid() references auth.users(id),
  data jsonb not null default '{}', updated_at timestamptz not null default now()
);

create table if not exists public.candidate_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  candidate_id uuid not null references public.candidates(id),
  mandate_id uuid not null references public.mandates(id),
  kind text not null default 'cv' check (kind = any (array['cv','other'])),
  file_name text not null, path text not null unique, size bigint, mime text,
  created_at timestamptz not null default now()
);
create index if not exists candidate_files_cand_idx on public.candidate_files (candidate_id);
create index if not exists candidate_files_user_idx on public.candidate_files (user_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  mandate_id uuid not null references public.mandates(id),
  candidate_id uuid references public.candidates(id),
  body text not null, created_at timestamptz not null default now()
);
create index if not exists comments_candidate on public.comments (candidate_id);
create index if not exists comments_mandate on public.comments (mandate_id);
create index if not exists comments_user_created on public.comments (user_id, created_at desc);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  mandate_id uuid references public.mandates(id), candidate_id uuid references public.candidates(id), step_id uuid references public.steps(id),
  kind text not null, title text not null, due_at timestamptz not null, done_at timestamptz, notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due on public.reminders (due_at) where done_at is null;
create index if not exists reminders_step on public.reminders (step_id);
create index if not exists reminders_user on public.reminders (user_id);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  endpoint text not null unique, p256dh text not null, auth text not null, user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_user on public.push_subscriptions (user_id);

create table if not exists public.push_config (key text primary key, value text not null);
alter table public.push_config enable row level security;

create table if not exists public.slate_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null, parent_id uuid references public.slate_tasks(id),
  repeat text not null default 'daily' check (repeat = any (array['daily','weekdays','once'])),
  start_date date not null, due_time time, xp integer not null default 10, notified_day date, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists slate_tasks_parent_idx on public.slate_tasks (parent_id);
create index if not exists slate_tasks_user_idx on public.slate_tasks (user_id);

create table if not exists public.slate_done (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  task_id uuid not null references public.slate_tasks(id),
  day date not null, completed_at timestamptz not null default now(),
  unique (task_id, day)
);
create index if not exists slate_done_task_idx on public.slate_done (task_id);
create index if not exists slate_done_user_day_idx on public.slate_done (user_id, day);

drop trigger if exists mandates_updated on public.mandates;
create trigger mandates_updated before update on public.mandates for each row execute function public.set_updated_at();
drop trigger if exists candidates_updated on public.candidates;
create trigger candidates_updated before update on public.candidates for each row execute function public.set_updated_at();
drop trigger if exists steps_updated on public.steps;
create trigger steps_updated before update on public.steps for each row execute function public.set_updated_at();
drop trigger if exists settings_updated on public.app_settings;
create trigger settings_updated before update on public.app_settings for each row execute function public.set_updated_at();

do $$ declare t text; begin
  foreach t in array array['app_settings','candidate_files','candidates','mandates','steps'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['comments','push_subscriptions','reminders','slate_done','slate_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
create policy "own settings" on public.app_settings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own files" on public.candidate_files for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own candidates" on public.candidates for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own mandates" on public.mandates for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own steps" on public.steps for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy comments_owner on public.comments for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_owner on public.push_subscriptions for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reminders_owner on public.reminders for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy slate_done_owner on public.slate_done for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy slate_tasks_owner on public.slate_tasks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Private CV bucket (files live under <user_id>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 10485760, array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/png','image/jpeg'])
on conflict (id) do nothing;
create policy "cvs read own" on storage.objects for select to authenticated using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cvs insert own" on storage.objects for insert to authenticated with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "cvs delete own" on storage.objects for delete to authenticated using (bucket_id = 'cvs' and (storage.foldername(name))[1] = (select auth.uid())::text);
