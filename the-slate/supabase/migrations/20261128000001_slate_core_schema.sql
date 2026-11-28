-- =====================================================================================================
-- THE SLATE — core schema evolution (additive, non-destructive).
-- * No existing column is dropped or renamed. Legacy columns stay (deprecated) so the previous app version can still read.
-- * Existing rows are back-filled into the new structures (companies, agencies, candidate-mandate associations,
--   status history, activity log, task fields) so no history is lost.
-- * Every new table has RLS (owner = user_id). History/audit tables are insert-by-trigger, read-only for users.
-- Portable: plain Postgres + the Supabase `auth.uid()` convention (see docs/MIGRATION_GUIDE.md).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. New tables
-- ---------------------------------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_user_name_uq on public.companies (user_id, lower(btrim(name)));

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'agency' check (kind in ('agency', 'consultant')),
  contact_name text, email text, phone text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index agencies_user_name_uq on public.agencies (user_id, lower(btrim(name)));

-- Configurable lists: sources, rejection/drop reasons, pipeline stages, hiring levels, task categories.
create table public.config_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('source', 'rejection_reason', 'drop_reason', 'pipeline_stage', 'hiring_level', 'task_category')),
  key text not null check (length(btrim(key)) > 0),
  label text not null check (length(btrim(label)) > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key)
);

-- Person-level fields on the existing candidates table; the pipeline position moves to candidate_mandates.
alter table public.candidates
  add column if not exists current_ctc text,
  add column if not exists additional_benefits text,
  add column if not exists current_location text,
  add column if not exists open_to_relocate boolean,
  alter column mandate_id drop not null;
alter table public.candidates add column search_doc text generated always as (
  lower(coalesce(name, '') || ' ' || coalesce(current_company, '') || ' ' || coalesce(designation, '') || ' ' ||
        coalesce(current_location, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' ||
        coalesce(source, '') || ' ' || coalesce(notice_period, ''))) stored;

-- A candidate's position in ONE mandate's pipeline. (candidate, mandate) is unique.
create table public.candidate_mandates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  stage text not null default 'sourced',
  status text not null default 'active' check (status in ('active', 'on_hold', 'selected', 'offered', 'joined', 'rejected', 'dropped')),
  rounds jsonb not null default '[]',
  offered_ctc text,
  joining_date date,
  joining_status text check (joining_status in ('expected', 'confirmed', 'at_risk', 'deferred', 'joined')),
  selected_at timestamptz,
  closed_reason text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, mandate_id)
);
create index cm_user_mandate_idx on public.candidate_mandates (user_id, mandate_id);
create index cm_candidate_idx on public.candidate_mandates (candidate_id);
create index cm_status_idx on public.candidate_mandates (user_id, status);
create index cm_joining_idx on public.candidate_mandates (user_id, joining_date) where joining_date is not null;

-- Append-only: every stage/status change, with reason + comment.
create table public.candidate_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  mandate_id uuid references public.mandates(id) on delete cascade,
  from_stage text, to_stage text not null,
  from_status text, to_status text not null,
  reason_type text check (reason_type in ('rejection', 'drop')),
  reason text,
  comment text,
  changed_at timestamptz not null default now()
);
create index csh_candidate_idx on public.candidate_status_history (candidate_id, changed_at desc);
create index csh_user_time_idx on public.candidate_status_history (user_id, changed_at desc);

-- Meaningful recruitment activity only (page views are never recorded here).
create table public.recruitment_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mandate_id uuid references public.mandates(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  kind text not null,
  meaningful boolean not null default true,
  summary text,
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index ra_user_time_idx on public.recruitment_activities (user_id, occurred_at desc);
create index ra_mandate_time_idx on public.recruitment_activities (mandate_id, occurred_at desc);

create table public.mandate_agencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete restrict,
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mandate_id, agency_id)
);
create index ma_user_idx on public.mandate_agencies (user_id, mandate_id);

create table public.mandate_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  kind text not null default 'jd' check (kind in ('jd', 'other')),
  file_name text not null,
  path text not null unique,
  size bigint check (size is null or size <= 10485760),
  mime text not null check (mime in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  is_current boolean not null default true,
  replaced_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index md_one_current_uq on public.mandate_documents (mandate_id, kind) where is_current;
create index md_user_idx on public.mandate_documents (user_id, mandate_id);

-- Mandate extras
alter table public.mandates
  add column company_id uuid references public.companies(id) on delete restrict,
  add column last_activity_at timestamptz,
  add column waiting_on text,
  add column waiting_since date;
create index mandates_company_idx on public.mandates (company_id);

-- Tasks (The Slate)
alter table public.slate_tasks
  add column notes text,
  add column difficulty text not null default 'moderate' check (difficulty in ('easy', 'moderate', 'focus', 'extra_focus')),
  add column est_minutes integer not null default 30 check (est_minutes between 5 and 1440),
  add column sched_minutes integer check (sched_minutes is null or sched_minutes between 5 and 1440),
  add column category text,
  add column reminder_time time,
  add column followup_minutes integer check (followup_minutes is null or followup_minutes between 5 and 1440),
  add column rec_days smallint[],
  add column rec_every_weeks smallint not null default 1 check (rec_every_weeks between 1 and 52),
  add column end_date date,
  add column sort_order integer not null default 0;
alter table public.slate_tasks drop constraint slate_tasks_repeat_check;
alter table public.slate_tasks add constraint slate_tasks_repeat_check check (repeat in ('daily', 'weekdays', 'once', 'custom'));
alter table public.slate_tasks add constraint slate_tasks_custom_days check (repeat <> 'custom' or (rec_days is not null and cardinality(rec_days) > 0));
alter table public.slate_tasks add constraint slate_tasks_not_own_parent check (parent_id is null or parent_id <> id);
alter table public.slate_done add column undone_at timestamptz;

-- Per-occurrence move/resize of a task (recurring tasks move one occurrence without touching the series).
create table public.slate_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.slate_tasks(id) on delete cascade,
  day date not null,
  new_day date not null,
  start_time time not null,
  sched_minutes integer not null check (sched_minutes between 5 and 1440),
  updated_at timestamptz not null default now(),
  unique (task_id, day)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create unique index notifications_dedupe_uq on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_time_idx on public.notifications (user_id, created_at desc);

create table public.sop_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Standard Operating Procedures',
  body text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.sop_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sop_id uuid not null references public.sop_documents(id) on delete cascade,
  body text not null,
  saved_at timestamptz not null default now()
);
create index sop_rev_idx on public.sop_revisions (sop_id, saved_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  actor uuid,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changes jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_user_time_idx on public.audit_log (user_id, at desc);
create index audit_row_idx on public.audit_log (table_name, row_id);

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  path text, size_bytes bigint, sha256 text,
  row_counts jsonb not null default '{}',
  verified boolean not null default false,
  error text
);

-- ---------------------------------------------------------------------------------------------------
-- 2. Back-fill from existing data (triggers do not exist yet, so legacy timestamps are untouched)
-- ---------------------------------------------------------------------------------------------------
insert into public.companies (user_id, name)
select distinct on (user_id, lower(btrim(company))) user_id, btrim(company)
from public.mandates where company is not null and btrim(company) <> ''
order by user_id, lower(btrim(company)), created_at;
update public.mandates m set company_id = c.id
from public.companies c where c.user_id = m.user_id and lower(btrim(c.name)) = lower(btrim(m.company)) and m.company_id is null;

insert into public.agencies (user_id, name)
select distinct on (m.user_id, lower(btrim(a))) m.user_id, btrim(a)
from public.mandates m, unnest(m.agencies) a where btrim(a) <> ''
order by m.user_id, lower(btrim(a)), m.created_at;
insert into public.mandate_agencies (user_id, mandate_id, agency_id, shared_at)
select m.user_id, m.id, ag.id, case when m.agency_shared then coalesce(m.agency_shared_at, m.updated_at) end
from public.mandates m
cross join lateral unnest(m.agencies) a
join public.agencies ag on ag.user_id = m.user_id and lower(btrim(ag.name)) = lower(btrim(a))
on conflict (mandate_id, agency_id) do nothing;

-- Stage/status normalisation: terminal statuses win, otherwise keep the stage.
insert into public.candidate_mandates (user_id, candidate_id, mandate_id, stage, status, rounds, offered_ctc, joining_date, joining_status, selected_at, closed_reason, closed_at, created_at, updated_at)
select c.user_id, c.id, c.mandate_id,
  case when c.status in ('joined', 'offered', 'rejected', 'dropped') then c.status
       when c.status = 'on_hold' then 'hold'
       else coalesce(nullif(c.stage, ''), 'sourced') end,
  case when c.status in ('joined', 'offered', 'rejected', 'dropped', 'on_hold') then c.status
       when c.stage = 'selected' then 'selected'
       else 'active' end,
  coalesce(c.rounds, '[]'::jsonb), c.offered_ctc, c.joining_date,
  case when c.status = 'joined' then 'joined' when c.joining_date is not null then 'expected' end,
  c.selected_at, c.closed_reason, c.closed_at, c.created_at, c.updated_at
from public.candidates c where c.mandate_id is not null;

-- Status history from the old status_log (previous stage via lag); candidates without a log get one honest import row.
insert into public.candidate_status_history (user_id, candidate_id, mandate_id, from_stage, to_stage, from_status, to_status, comment, changed_at)
select c.user_id, c.id, c.mandate_id,
  lag(e->>'stage') over (partition by c.id order by (e->>'at')::timestamptz),
  coalesce(e->>'stage', cm.stage),
  null,
  case when e->>'stage' in ('joined', 'offered', 'rejected', 'dropped', 'selected') then e->>'stage' when e->>'stage' = 'hold' then 'on_hold' else 'active' end,
  nullif(e->>'note', ''), (e->>'at')::timestamptz
from public.candidates c
join public.candidate_mandates cm on cm.candidate_id = c.id and cm.mandate_id = c.mandate_id
cross join lateral jsonb_array_elements(c.status_log) e
where jsonb_typeof(c.status_log) = 'array' and jsonb_array_length(c.status_log) > 0;
insert into public.candidate_status_history (user_id, candidate_id, mandate_id, from_stage, to_stage, from_status, to_status, comment, changed_at)
select cm.user_id, cm.candidate_id, cm.mandate_id, null, cm.stage, null, cm.status, 'Imported from Hiring Copilot', cm.created_at
from public.candidate_mandates cm
where not exists (select 1 from public.candidate_status_history h where h.candidate_id = cm.candidate_id and h.mandate_id = cm.mandate_id);

-- Activity history (so the 30-day clock and timelines reflect real past work)
insert into public.recruitment_activities (user_id, mandate_id, kind, summary, occurred_at)
select user_id, id, 'mandate_created', 'Mandate created', created_at from public.mandates;
insert into public.recruitment_activities (user_id, mandate_id, kind, summary, occurred_at)
select user_id, id, 'clock_started', '30-day clock started', (started_on::timestamp at time zone 'Asia/Kolkata') from public.mandates where started_on is not null;
insert into public.recruitment_activities (user_id, mandate_id, kind, summary, detail, occurred_at)
select user_id, id, 'mandate_status_changed', 'Mandate ' || status, jsonb_build_object('to', status), coalesce(status_changed_at, closed_at, updated_at)
from public.mandates where status <> 'active' or status_changed_at is not null;
insert into public.recruitment_activities (user_id, mandate_id, kind, summary, occurred_at)
select user_id, id, 'shared_with_consultant', 'Shared with consultant', agency_shared_at from public.mandates where agency_shared and agency_shared_at is not null;
insert into public.recruitment_activities (user_id, mandate_id, candidate_id, kind, summary, occurred_at)
select user_id, mandate_id, id, 'candidate_added', 'Candidate added: ' || name, created_at from public.candidates where mandate_id is not null;
insert into public.recruitment_activities (user_id, mandate_id, candidate_id, kind, summary, detail, occurred_at)
select h.user_id, h.mandate_id, h.candidate_id, 'candidate_stage_changed', 'Stage: ' || h.to_stage, jsonb_build_object('to', h.to_stage), h.changed_at
from public.candidate_status_history h where h.comment is distinct from 'Imported from Hiring Copilot';
insert into public.recruitment_activities (user_id, mandate_id, candidate_id, kind, summary, occurred_at)
select user_id, mandate_id, candidate_id, 'comment_added', 'Comment added', created_at from public.comments;
insert into public.recruitment_activities (user_id, mandate_id, candidate_id, kind, summary, detail, occurred_at)
select user_id, mandate_id, candidate_id, 'step_status_changed', 'Checklist: ' || title, jsonb_build_object('to', status), completed_at
from public.steps where status = 'done' and completed_at is not null;
insert into public.recruitment_activities (user_id, mandate_id, candidate_id, kind, summary, occurred_at)
select user_id, mandate_id, candidate_id, 'cv_uploaded', 'CV uploaded: ' || file_name, created_at from public.candidate_files;

update public.mandates m set last_activity_at = x.last_at
from (select mandate_id, max(occurred_at) last_at from public.recruitment_activities where meaningful and mandate_id is not null group by mandate_id) x
where x.mandate_id = m.id;

-- Tasks: keep the legacy "nudge 1h after due time" behaviour as an explicit follow-up setting; map XP to difficulty buckets.
update public.slate_tasks set reminder_time = due_time, followup_minutes = 60 where due_time is not null;

-- ---------------------------------------------------------------------------------------------------
-- 3. Constraints on existing columns (validated: existing data conforms)
-- ---------------------------------------------------------------------------------------------------
alter table public.mandates add constraint mandates_urgency_check check (urgency in ('Low', 'Medium', 'High', 'Critical'));
alter table public.mandates add constraint mandates_positions_check check (positions >= 1);
alter table public.mandates add constraint mandates_work_mode_check check (work_mode is null or work_mode in ('WFO', 'Hybrid', 'Remote'));
alter table public.mandates add constraint mandates_dates_check check (target_close is null or received_on is null or target_close >= received_on) not valid;
alter table public.comments alter column mandate_id drop not null;
alter table public.comments add constraint comments_has_parent check (mandate_id is not null or candidate_id is not null);

-- ---------------------------------------------------------------------------------------------------
-- 4. Trigger functions
-- ---------------------------------------------------------------------------------------------------
-- Writes one activity row. Internal: not callable by API roles.
create or replace function public.slate_log_activity(p_user uuid, p_mandate uuid, p_candidate uuid, p_kind text, p_summary text, p_detail jsonb default '{}', p_meaningful boolean default true, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.recruitment_activities (user_id, mandate_id, candidate_id, kind, meaningful, summary, detail, occurred_at)
  values (p_user, p_mandate, p_candidate, p_kind, p_meaningful, p_summary, coalesce(p_detail, '{}'::jsonb), p_at);
  if p_meaningful and p_mandate is not null then
    update public.mandates set last_activity_at = greatest(coalesce(last_activity_at, p_at), p_at) where id = p_mandate;
  end if;
end $$;
revoke all on function public.slate_log_activity(uuid, uuid, uuid, text, text, jsonb, boolean, timestamptz) from public, anon, authenticated;

-- Keeps mandates.company (legacy text) and company_id (new FK) consistent whichever one a writer sets.
create or replace function public.slate_mandate_company_sync() returns trigger language plpgsql set search_path = '' as $$
declare cid uuid; nm text;
begin
  if new.company_id is not null and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id) then
    select name into nm from public.companies where id = new.company_id;
    new.company := nm;
  elsif new.company is not null and btrim(new.company) <> '' and (tg_op = 'INSERT' or new.company is distinct from old.company) then
    select id into cid from public.companies where user_id = new.user_id and lower(btrim(name)) = lower(btrim(new.company));
    if cid is null then
      insert into public.companies (user_id, name) values (new.user_id, btrim(new.company)) returning id into cid;
    end if;
    new.company_id := cid;
  end if;
  return new;
end $$;

create or replace function public.slate_mandate_activity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.slate_log_activity(new.user_id, new.id, null, 'mandate_created', 'Mandate created');
    if new.started_on is not null then
      perform public.slate_log_activity(new.user_id, new.id, null, 'clock_started', '30-day clock started');
    end if;
  else
    if new.status is distinct from old.status then
      perform public.slate_log_activity(new.user_id, new.id, null, 'mandate_status_changed', 'Mandate ' || new.status, jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if old.started_on is null and new.started_on is not null then
      perform public.slate_log_activity(new.user_id, new.id, null, 'clock_started', '30-day clock started');
    end if;
    if new.waiting_on is distinct from old.waiting_on then
      perform public.slate_log_activity(new.user_id, new.id, null, 'waiting_updated', coalesce('Waiting on ' || new.waiting_on, 'No longer waiting'), '{}', true);
    end if;
  end if;
  return new;
end $$;

-- candidate_mandates: history row (+reason/comment from the RPC context), activity rows
create or replace function public.slate_cm_history() returns trigger language plpgsql security definer set search_path = '' as $$
declare ctx jsonb := coalesce(nullif(current_setting('slate.ctx', true), ''), '{}')::jsonb;
        v_rtype text;
begin
  if tg_op = 'INSERT' then
    insert into public.candidate_status_history (user_id, candidate_id, mandate_id, from_stage, to_stage, from_status, to_status, comment)
    values (new.user_id, new.candidate_id, new.mandate_id, null, new.stage, null, new.status, nullif(ctx->>'comment', ''));
    perform public.slate_log_activity(new.user_id, new.mandate_id, new.candidate_id, 'candidate_added', 'Candidate added to mandate', jsonb_build_object('stage', new.stage));
    return new;
  end if;
  if new.stage is distinct from old.stage or new.status is distinct from old.status then
    v_rtype := case new.status when 'rejected' then 'rejection' when 'dropped' then 'drop' end;
    insert into public.candidate_status_history (user_id, candidate_id, mandate_id, from_stage, to_stage, from_status, to_status, reason_type, reason, comment)
    values (new.user_id, new.candidate_id, new.mandate_id, old.stage, new.stage, old.status, new.status, v_rtype, coalesce(nullif(ctx->>'reason', ''), new.closed_reason), nullif(ctx->>'comment', ''));
    perform public.slate_log_activity(new.user_id, new.mandate_id, new.candidate_id, 'candidate_stage_changed', 'Stage: ' || old.stage || ' → ' || new.stage,
      jsonb_build_object('from', old.stage, 'to', new.stage, 'status', new.status, 'reason_type', v_rtype));
  end if;
  if new.rounds is distinct from old.rounds then
    perform public.slate_log_activity(new.user_id, new.mandate_id, new.candidate_id, 'interview_updated', 'Interview round updated');
  end if;
  if new.joining_date is distinct from old.joining_date and new.joining_date is not null then
    perform public.slate_log_activity(new.user_id, new.mandate_id, new.candidate_id, 'joining_date_set', 'Joining date set', jsonb_build_object('date', new.joining_date));
  end if;
  return new;
end $$;

create or replace function public.slate_cm_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'selected' and new.selected_at is null then new.selected_at := now(); end if;
  if new.status in ('rejected', 'dropped') then
    -- A reason is mandatory, and it must be given for THIS classification: a rejection never inherits a drop reason (or vice versa).
    if new.closed_reason is null or btrim(new.closed_reason) = ''
       or (tg_op = 'UPDATE' and old.status in ('rejected', 'dropped') and new.status is distinct from old.status and new.closed_reason is not distinct from old.closed_reason) then
      raise exception 'A reason is required when a candidate is %', new.status using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or old.status not in ('rejected', 'dropped') then new.closed_at := now(); end if;
  elsif tg_op = 'UPDATE' and old.status in ('rejected', 'dropped') then
    new.closed_reason := null; new.closed_at := null;
  end if;
  if new.status = 'joined' then new.joining_status := 'joined'; end if;
  return new;
end $$;

create or replace function public.slate_comment_activity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.mandate_id is not null then
    perform public.slate_log_activity(new.user_id, new.mandate_id, new.candidate_id, 'comment_added', 'Comment added', '{}', true, new.created_at);
  end if;
  return new;
end $$;

create or replace function public.slate_step_activity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform public.slate_log_activity(new.user_id, new.mandate_id, new.candidate_id, 'step_status_changed', 'Checklist: ' || new.title,
      jsonb_build_object('from', old.status, 'to', new.status), new.status in ('done', 'waiting', 'skipped'));
  end if;
  return new;
end $$;

create or replace function public.slate_doc_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare had boolean;
begin
  select exists (select 1 from public.mandate_documents d where d.mandate_id = new.mandate_id and d.kind = new.kind and d.id <> new.id) into had;
  perform public.slate_log_activity(new.user_id, new.mandate_id, null, case when had then 'document_replaced' else 'document_uploaded' end,
    case when new.kind = 'jd' then 'Job description ' || (case when had then 'replaced' else 'uploaded' end) else 'Document uploaded' end, jsonb_build_object('file', new.file_name));
  return new;
end $$;

-- Only one current document per (mandate, kind): the previous one is demoted atomically.
create or replace function public.slate_doc_supersede() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_current then
    update public.mandate_documents set is_current = false, replaced_at = now()
    where mandate_id = new.mandate_id and kind = new.kind and is_current and id <> new.id;
  end if;
  return new;
end $$;

create or replace function public.slate_ma_activity() returns trigger language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  select name into nm from public.agencies where id = new.agency_id;
  if tg_op = 'INSERT' then
    perform public.slate_log_activity(new.user_id, new.mandate_id, null, 'consultant_assigned', 'Consultant assigned: ' || coalesce(nm, ''), jsonb_build_object('agency', nm));
  elsif old.shared_at is null and new.shared_at is not null then
    perform public.slate_log_activity(new.user_id, new.mandate_id, null, 'shared_with_consultant', 'Shared with ' || coalesce(nm, 'consultant'), jsonb_build_object('agency', nm));
  end if;
  return new;
end $$;

-- Generic audit trail (who changed what). Written with definer rights; users can read, never edit.
create or replace function public.slate_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_diff jsonb; v_row jsonb;
begin
  if tg_op = 'INSERT' then v_new := to_jsonb(new); v_row := v_new; v_diff := v_new;
  elsif tg_op = 'DELETE' then v_old := to_jsonb(old); v_row := v_old; v_diff := v_old;
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
    select jsonb_object_agg(k, jsonb_build_object('old', v_old->k, 'new', v_new->k)) into v_diff
    from jsonb_object_keys(v_new) k where v_new->k is distinct from v_old->k and k not in ('updated_at', 'last_activity_at', 'search_doc');
    if v_diff is null then return new; end if;
  end if;
  insert into public.audit_log (user_id, actor, table_name, row_id, action, changes)
  values (nullif(v_row->>'user_id', '')::uuid, (select auth.uid()), tg_table_name, coalesce(v_row->>'id', v_row->>'user_id'), tg_op, v_diff);
  return coalesce(new, old);
end $$;

create or replace function public.slate_sop_revision() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.body is distinct from old.body and not exists (
    select 1 from public.sop_revisions r where r.sop_id = new.id and r.saved_at > now() - interval '10 minutes') then
    insert into public.sop_revisions (user_id, sop_id, body) values (new.user_id, new.id, old.body);
    delete from public.sop_revisions where sop_id = new.id and id not in (select id from public.sop_revisions where sop_id = new.id order by saved_at desc limit 50);
  end if;
  return new;
end $$;

-- Sub-tasks inherit the parent's schedule; parent changes cascade; no cycles.
create or replace function public.slate_task_inherit() returns trigger language plpgsql set search_path = '' as $$
declare p public.slate_tasks;
begin
  if new.parent_id is not null then
    if tg_op = 'UPDATE' and exists (
      with recursive d as (select id from public.slate_tasks where parent_id = new.id union all select t.id from public.slate_tasks t join d on t.parent_id = d.id)
      select 1 from d where d.id = new.parent_id) then
      raise exception 'A task cannot be moved under its own sub-task' using errcode = '23514';
    end if;
    select * into p from public.slate_tasks where id = new.parent_id;
    if found and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
      new.repeat := p.repeat; new.start_date := p.start_date; new.rec_days := p.rec_days; new.rec_every_weeks := p.rec_every_weeks; new.end_date := p.end_date;
    end if;
  end if;
  return new;
end $$;
create or replace function public.slate_task_cascade() returns trigger language plpgsql set search_path = '' as $$
begin
  update public.slate_tasks set repeat = new.repeat, start_date = new.start_date, rec_days = new.rec_days, rec_every_weeks = new.rec_every_weeks, end_date = new.end_date
  where parent_id = new.id and (repeat is distinct from new.repeat or start_date is distinct from new.start_date or rec_days is distinct from new.rec_days
                                or rec_every_weeks is distinct from new.rec_every_weeks or end_date is distinct from new.end_date);
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------------------------------
create trigger mandates_company_sync before insert or update of company, company_id on public.mandates for each row execute function public.slate_mandate_company_sync();
create trigger mandates_activity after insert or update on public.mandates for each row execute function public.slate_mandate_activity();
create trigger cm_guard before insert or update on public.candidate_mandates for each row execute function public.slate_cm_guard();
create trigger cm_history after insert or update on public.candidate_mandates for each row execute function public.slate_cm_history();
create trigger cm_updated before update on public.candidate_mandates for each row execute function public.set_updated_at();
create trigger comments_activity after insert on public.comments for each row execute function public.slate_comment_activity();
create trigger steps_activity after update on public.steps for each row execute function public.slate_step_activity();
create trigger md_supersede before insert on public.mandate_documents for each row execute function public.slate_doc_supersede();
create trigger md_activity after insert on public.mandate_documents for each row execute function public.slate_doc_activity();
create trigger ma_activity after insert or update on public.mandate_agencies for each row execute function public.slate_ma_activity();
create trigger sop_revision after update on public.sop_documents for each row execute function public.slate_sop_revision();
create trigger sop_updated before update on public.sop_documents for each row execute function public.set_updated_at();
create trigger tasks_updated before update on public.slate_tasks for each row execute function public.set_updated_at();
create trigger tasks_inherit before insert or update of parent_id on public.slate_tasks for each row execute function public.slate_task_inherit();
create trigger tasks_cascade after update of repeat, start_date, rec_days, rec_every_weeks, end_date on public.slate_tasks for each row execute function public.slate_task_cascade();
create trigger companies_updated before update on public.companies for each row execute function public.set_updated_at();
create trigger agencies_updated before update on public.agencies for each row execute function public.set_updated_at();
create trigger config_updated before update on public.config_options for each row execute function public.set_updated_at();
create trigger overrides_updated before update on public.slate_overrides for each row execute function public.set_updated_at();

do $$ declare t text; begin
  foreach t in array array['mandates', 'candidates', 'candidate_mandates', 'companies', 'agencies', 'mandate_agencies', 'mandate_documents',
                           'config_options', 'slate_tasks', 'slate_done', 'slate_overrides', 'sop_documents', 'app_settings', 'comments', 'candidate_files'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.slate_audit()', 'audit_' || t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['companies', 'agencies', 'config_options', 'candidate_mandates', 'mandate_agencies', 'mandate_documents', 'slate_overrides', 'notifications', 'sop_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_owner', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  -- read-only for users (rows are written by triggers / service role only)
  foreach t in array array['candidate_status_history', 'recruitment_activities', 'sop_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;
alter table public.backup_runs enable row level security;
create policy backup_runs_read on public.backup_runs for select to authenticated using (true);
revoke all on public.backup_runs from anon;
revoke insert, update, delete on public.backup_runs from authenticated;

-- Existing tables previously reachable by anon only through RLS; tighten as defence in depth.
revoke all on public.mandates, public.candidates, public.steps, public.comments, public.reminders, public.candidate_files,
  public.slate_tasks, public.slate_done, public.app_settings, public.push_subscriptions, public.push_config, public.allowed_emails from anon;
