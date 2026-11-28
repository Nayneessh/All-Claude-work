-- =====================================================================================================
-- THE SLATE — views, RPCs (transaction-safe operations), default configuration, private storage.
-- RPCs are SECURITY INVOKER: Row Level Security applies exactly as for direct table access.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- Views (security_invoker => RLS of the caller applies)
-- ---------------------------------------------------------------------------------------------------
create view public.v_mandate_overview with (security_invoker = true) as
select
  m.id, m.user_id, m.title, m.company_id, coalesce(co.name, m.company) as company_name, m.stakeholder, m.level, m.positions, m.location,
  m.work_mode, m.reporting_to, m.span, m.budget, m.urgency, m.confidential, m.status, m.received_on, m.started_on, m.target_close,
  m.notes, m.status_note, m.waiting_on, m.waiting_since, m.created_at, m.updated_at, m.closed_at, m.close_outcome, m.close_note, m.last_activity_at,
  coalesce(cs.total, 0)::int as candidate_total, coalesce(cs.live, 0)::int as candidate_live,
  coalesce(cs.selected, 0)::int as selected_count, coalesce(cs.offered, 0)::int as offered_count, coalesce(cs.joined, 0)::int as joined_count,
  coalesce(cs.rejected, 0)::int as rejected_count, coalesce(cs.dropped, 0)::int as dropped_count,
  coalesce(ag.names, '{}'::text[]) as consultants, coalesce(ag.shared_count, 0)::int as shared_count,
  (coalesce(st.waiting_steps, 0) + coalesce(cs.hmfb, 0) + case when m.waiting_on is not null and btrim(m.waiting_on) <> '' then 1 else 0 end)::int as waiting_count,
  coalesce(st.open_steps, 0)::int as open_steps, coalesce(st.done_steps, 0)::int as done_steps, coalesce(st.overdue_steps, 0)::int as overdue_steps,
  jd.id as jd_id, jd.file_name as jd_file_name
from public.mandates m
left join public.companies co on co.id = m.company_id
left join lateral (
  select count(*) total,
    count(*) filter (where cm.status in ('active', 'on_hold', 'selected', 'offered')) live,
    count(*) filter (where cm.status = 'selected') selected, count(*) filter (where cm.status = 'offered') offered,
    count(*) filter (where cm.status = 'joined') joined, count(*) filter (where cm.status = 'rejected') rejected,
    count(*) filter (where cm.status = 'dropped') dropped, count(*) filter (where cm.stage = 'hmfb' and cm.status = 'active') hmfb
  from public.candidate_mandates cm where cm.mandate_id = m.id) cs on true
left join lateral (
  select array_agg(a.name order by a.name) names, count(*) filter (where ma.shared_at is not null) shared_count
  from public.mandate_agencies ma join public.agencies a on a.id = ma.agency_id where ma.mandate_id = m.id) ag on true
left join lateral (
  select count(*) filter (where s.status in ('todo', 'waiting')) open_steps, count(*) filter (where s.status = 'done') done_steps,
    count(*) filter (where s.status = 'waiting') waiting_steps,
    count(*) filter (where s.status in ('todo', 'waiting') and s.due_date < (now() at time zone 'Asia/Kolkata')::date) overdue_steps
  from public.steps s where s.mandate_id = m.id) st on true
left join lateral (
  select d.id, d.file_name from public.mandate_documents d where d.mandate_id = m.id and d.kind = 'jd' and d.is_current limit 1) jd on true;

create view public.v_candidate_pipeline with (security_invoker = true) as
select
  cm.id as association_id, cm.user_id, cm.candidate_id, cm.mandate_id, cm.stage, cm.status, cm.offered_ctc, cm.joining_date, cm.joining_status,
  cm.selected_at, cm.closed_reason, cm.closed_at, cm.rounds, cm.created_at as added_at, cm.updated_at as stage_updated_at,
  c.name, c.current_company, c.designation, c.phone, c.email, c.source, c.current_ctc, c.expected_ctc, c.notice_period, c.current_location, c.open_to_relocate,
  m.title as mandate_title, coalesce(co.name, m.company) as mandate_company, m.location as mandate_location, m.level as mandate_level,
  m.urgency as mandate_urgency, m.status as mandate_status
from public.candidate_mandates cm
join public.candidates c on c.id = cm.candidate_id
join public.mandates m on m.id = cm.mandate_id
left join public.companies co on co.id = m.company_id;

revoke all on public.v_mandate_overview, public.v_candidate_pipeline from anon;

-- ---------------------------------------------------------------------------------------------------
-- Defaults (idempotent). Configurable afterwards in Settings.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_seed_defaults(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.config_options (user_id, kind, key, label, sort_order, meta)
  select p_user, v.kind, v.key, v.label, v.ord, v.meta::jsonb from (values
    ('pipeline_stage', 'sourced', 'Sourced', 10, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'contacted', 'Contacted', 20, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'interested', 'Interested (call fixed)', 30, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'discovery', 'Discovery call done', 40, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'shared', 'Shared with HM', 50, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'hmfb', 'HM feedback awaited', 60, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'shortlisted', 'Shortlisted by HM', 70, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'r1', 'Round 1', 80, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'r2', 'Round 2', 90, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'r3', 'Round 3', 100, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'r4', 'Round 4', 110, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'final', 'Final round', 120, '{"kind":"progress","funnel":true}'),
    ('pipeline_stage', 'selected', 'Selected', 130, '{"kind":"selected","funnel":true}'),
    ('pipeline_stage', 'offered', 'Offered', 140, '{"kind":"offered","funnel":true}'),
    ('pipeline_stage', 'joined', 'Joined', 150, '{"kind":"joined","funnel":true}'),
    ('pipeline_stage', 'hold', 'On hold', 160, '{"kind":"hold","funnel":false}'),
    ('pipeline_stage', 'rejected', 'Rejected', 170, '{"kind":"rejected","funnel":false}'),
    ('pipeline_stage', 'dropped', 'Dropped', 180, '{"kind":"dropped","funnel":false}'),
    ('source', 'naukri', 'Naukri', 10, '{}'), ('source', 'linkedin', 'LinkedIn', 20, '{}'), ('source', 'reference', 'Reference', 30, '{}'),
    ('source', 'internal_database', 'Internal Database', 40, '{}'), ('source', 'mapping', 'Mapping', 50, '{}'),
    ('source', 'cold_outreach', 'Cold Outreach', 60, '{}'), ('source', 'agency', 'Agency', 70, '{}'), ('source', 'other', 'Other', 80, '{}'),
    ('rejection_reason', 'interview_rejection', 'Interview rejection', 10, '{}'), ('rejection_reason', 'client_rejection', 'Client rejection', 20, '{}'),
    ('rejection_reason', 'internal_rejection', 'Internal rejection', 30, '{}'), ('rejection_reason', 'profile_mismatch', 'Profile mismatch', 40, '{}'),
    ('rejection_reason', 'position_filled', 'Position filled', 50, '{}'), ('rejection_reason', 'other', 'Other', 90, '{}'),
    ('drop_reason', 'withdrew', 'Candidate withdrew', 10, '{}'), ('drop_reason', 'accepted_other_offer', 'Accepted another offer', 20, '{}'),
    ('drop_reason', 'compensation_mismatch', 'Compensation mismatch', 30, '{}'), ('drop_reason', 'notice_period_issue', 'Notice period issue', 40, '{}'),
    ('drop_reason', 'location_work_mode', 'Location / work-mode', 50, '{}'), ('drop_reason', 'unresponsive', 'Candidate became unresponsive', 60, '{}'),
    ('drop_reason', 'role_on_hold', 'Role on hold / cancelled', 70, '{}'), ('drop_reason', 'other', 'Other', 90, '{}'),
    ('hiring_level', 'cxo', 'CXO / C-suite', 10, '{}'), ('hiring_level', 'president_md', 'President / MD / BU Head', 20, '{}'),
    ('hiring_level', 'svp_vp', 'SVP / VP', 30, '{}'), ('hiring_level', 'director', 'Director', 40, '{}'),
    ('hiring_level', 'avp_sr_manager', 'AVP / Sr. Manager', 50, '{}'), ('hiring_level', 'manager', 'Manager', 60, '{}'),
    ('task_category', 'recruitment', 'Recruitment', 10, '{}'), ('task_category', 'client', 'Client follow-up', 20, '{}'),
    ('task_category', 'admin', 'Admin', 30, '{}'), ('task_category', 'personal', 'Personal', 40, '{}')
  ) as v(kind, key, label, ord, meta)
  on conflict (user_id, kind, key) do nothing;
  -- Levels already in use on existing mandates must exist as options (so filters/forms show them).
  insert into public.config_options (user_id, kind, key, label, sort_order)
  select distinct m.user_id, 'hiring_level', lower(regexp_replace(m.level, '[^a-zA-Z0-9]+', '_', 'g')), m.level, 100
  from public.mandates m where m.user_id = p_user and m.level is not null and btrim(m.level) <> ''
    and not exists (select 1 from public.config_options c where c.user_id = p_user and c.kind = 'hiring_level' and lower(c.label) = lower(m.level))
  on conflict (user_id, kind, key) do nothing;
end $$;
revoke all on function public.slate_seed_defaults(uuid) from public, anon, authenticated;

create or replace function public.slate_ensure_defaults() returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform public.slate_seed_defaults((select auth.uid()));
end $$;

select public.slate_seed_defaults(id) from auth.users;

-- ---------------------------------------------------------------------------------------------------
-- Master-data helpers
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_upsert_company(p_name text) returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  select id into v_id from public.companies where user_id = v_uid and lower(btrim(name)) = lower(btrim(p_name));
  if v_id is null then insert into public.companies (user_id, name) values (v_uid, btrim(p_name)) returning id into v_id; end if;
  return v_id;
end $$;

create or replace function public.slate_upsert_agency(p_name text, p_kind text default 'agency') returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  select id into v_id from public.agencies where user_id = v_uid and lower(btrim(name)) = lower(btrim(p_name));
  if v_id is null then insert into public.agencies (user_id, name, kind) values (v_uid, btrim(p_name), coalesce(nullif(p_kind, ''), 'agency')) returning id into v_id; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Save a mandate (create or edit) with its company and consultants in ONE transaction.
-- p: {id?, title, company, level, positions, location, work_mode, reporting_to, span, budget, urgency, confidential,
--     stakeholder, received_on, started_on, target_close, notes, waiting_on, consultants: ["Name", ...]}
-- `consultants` (when present) is the complete desired set: missing ones are added, absent ones are unassigned.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_save_mandate(p jsonb) returns uuid language plpgsql set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_id uuid := nullif(p->>'id', '')::uuid; v_company uuid; v_name text; v_agency uuid; v_keep uuid[] := '{}';
  v_title text := btrim(coalesce(p->>'title', ''));
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_title = '' then raise exception 'Mandate title is required' using errcode = '23514'; end if;
  v_company := public.slate_upsert_company(p->>'company');

  if v_id is null then
    insert into public.mandates (user_id, title, company, company_id, stakeholder, level, positions, location, work_mode, reporting_to, span, budget, urgency, confidential,
                                 received_on, started_on, target_close, notes, waiting_on, waiting_since)
    values (v_uid, v_title, nullif(btrim(p->>'company'), ''), v_company, nullif(btrim(p->>'stakeholder'), ''), nullif(btrim(p->>'level'), ''),
            coalesce(nullif(p->>'positions', '')::int, 1), nullif(btrim(p->>'location'), ''), nullif(p->>'work_mode', ''), nullif(btrim(p->>'reporting_to'), ''),
            nullif(btrim(p->>'span'), ''), nullif(btrim(p->>'budget'), ''), coalesce(nullif(p->>'urgency', ''), 'Medium'), coalesce((p->>'confidential')::boolean, false),
            nullif(p->>'received_on', '')::date, nullif(p->>'started_on', '')::date, nullif(p->>'target_close', '')::date, nullif(btrim(p->>'notes'), ''),
            nullif(btrim(p->>'waiting_on'), ''), case when nullif(btrim(p->>'waiting_on'), '') is not null then current_date end)
    returning id into v_id;
  else
    update public.mandates set
      title = v_title, company = nullif(btrim(p->>'company'), ''), company_id = v_company, stakeholder = nullif(btrim(p->>'stakeholder'), ''),
      level = nullif(btrim(p->>'level'), ''), positions = coalesce(nullif(p->>'positions', '')::int, 1), location = nullif(btrim(p->>'location'), ''),
      work_mode = nullif(p->>'work_mode', ''), reporting_to = nullif(btrim(p->>'reporting_to'), ''), span = nullif(btrim(p->>'span'), ''),
      budget = nullif(btrim(p->>'budget'), ''), urgency = coalesce(nullif(p->>'urgency', ''), 'Medium'), confidential = coalesce((p->>'confidential')::boolean, false),
      received_on = nullif(p->>'received_on', '')::date, started_on = nullif(p->>'started_on', '')::date, target_close = nullif(p->>'target_close', '')::date,
      notes = nullif(btrim(p->>'notes'), ''), waiting_on = nullif(btrim(p->>'waiting_on'), ''),
      waiting_since = case when nullif(btrim(p->>'waiting_on'), '') is null then null when waiting_on is distinct from nullif(btrim(p->>'waiting_on'), '') then current_date else waiting_since end
    where id = v_id;
    if not found then raise exception 'Mandate not found' using errcode = 'P0002'; end if;
  end if;

  if p ? 'consultants' and jsonb_typeof(p->'consultants') = 'array' then
    for v_name in select btrim(x) from jsonb_array_elements_text(p->'consultants') x where btrim(x) <> '' loop
      v_agency := public.slate_upsert_agency(v_name, 'consultant');
      insert into public.mandate_agencies (user_id, mandate_id, agency_id, shared_at) values (v_uid, v_id, v_agency, now())
      on conflict (mandate_id, agency_id) do nothing;
      v_keep := v_keep || v_agency;
    end loop;
    delete from public.mandate_agencies where mandate_id = v_id and not (agency_id = any (v_keep));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Save a candidate (create or edit) and optionally associate with a mandate, atomically.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_save_candidate(p jsonb) returns uuid language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid := nullif(p->>'id', '')::uuid; v_mandate uuid := nullif(p->>'mandate_id', '')::uuid;
        v_name text := btrim(coalesce(p->>'name', ''));
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_name = '' then raise exception 'Candidate name is required' using errcode = '23514'; end if;
  if v_id is null then
    insert into public.candidates (user_id, name, current_company, designation, phone, email, source, current_ctc, expected_ctc, additional_benefits, notice_period,
                                   current_location, open_to_relocate, notes)
    values (v_uid, v_name, nullif(btrim(p->>'current_company'), ''), nullif(btrim(p->>'designation'), ''), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'email'), ''),
            nullif(btrim(p->>'source'), ''), nullif(btrim(p->>'current_ctc'), ''), nullif(btrim(p->>'expected_ctc'), ''), nullif(btrim(p->>'additional_benefits'), ''),
            nullif(btrim(p->>'notice_period'), ''), nullif(btrim(p->>'current_location'), ''), nullif(p->>'open_to_relocate', '')::boolean, nullif(btrim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.candidates set name = v_name, current_company = nullif(btrim(p->>'current_company'), ''), designation = nullif(btrim(p->>'designation'), ''),
      phone = nullif(btrim(p->>'phone'), ''), email = nullif(btrim(p->>'email'), ''), source = nullif(btrim(p->>'source'), ''), current_ctc = nullif(btrim(p->>'current_ctc'), ''),
      expected_ctc = nullif(btrim(p->>'expected_ctc'), ''), additional_benefits = nullif(btrim(p->>'additional_benefits'), ''), notice_period = nullif(btrim(p->>'notice_period'), ''),
      current_location = nullif(btrim(p->>'current_location'), ''), open_to_relocate = nullif(p->>'open_to_relocate', '')::boolean, notes = nullif(btrim(p->>'notes'), '')
    where id = v_id;
    if not found then raise exception 'Candidate not found' using errcode = 'P0002'; end if;
  end if;
  if v_mandate is not null then
    insert into public.candidate_mandates (user_id, candidate_id, mandate_id) values (v_uid, v_id, v_mandate) on conflict (candidate_id, mandate_id) do nothing;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Change a candidate's stage. Status is derived from the stage's configured kind. Rejection / drop need a reason.
-- History row + activity are written by triggers inside the same transaction; nothing is overwritten.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_set_candidate_stage(
  p_candidate uuid, p_mandate uuid, p_stage text, p_reason text default null, p_comment text default null,
  p_joining_date date default null, p_offered_ctc text default null, p_joining_status text default null)
returns public.candidate_mandates language plpgsql set search_path = '' as $$
declare cm public.candidate_mandates; v_kind text; v_status text; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into cm from public.candidate_mandates where candidate_id = p_candidate and mandate_id = p_mandate for update;
  if not found then raise exception 'Candidate is not associated with this mandate' using errcode = 'P0002'; end if;
  select coalesce(meta->>'kind', 'progress') into v_kind from public.config_options
   where user_id = cm.user_id and kind = 'pipeline_stage' and key = p_stage and active;
  if v_kind is null then raise exception 'Unknown or inactive stage: %', p_stage using errcode = '23514'; end if;
  v_status := case v_kind when 'hold' then 'on_hold' when 'progress' then 'active' else v_kind end;
  if v_status in ('rejected', 'dropped') and v_reason is null then
    raise exception 'A reason is required to mark a candidate as %', v_status using errcode = '23514';
  end if;
  perform set_config('slate.ctx', jsonb_build_object('reason', v_reason, 'comment', v_comment)::text, true);
  update public.candidate_mandates set stage = p_stage, status = v_status,
    closed_reason = case when v_status in ('rejected', 'dropped') then v_reason else null end,
    joining_date = coalesce(p_joining_date, joining_date), offered_ctc = coalesce(nullif(btrim(p_offered_ctc), ''), offered_ctc),
    joining_status = coalesce(nullif(p_joining_status, ''), joining_status)
  where id = cm.id returning * into cm;
  if v_comment is not null then
    insert into public.comments (user_id, mandate_id, candidate_id, body) values (cm.user_id, p_mandate, p_candidate, v_comment);
  end if;
  perform set_config('slate.ctx', '', true);
  return cm;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Talent Pool search: every whitespace-separated term must appear (partial match) in the person's fields
-- or in the title/company/location of any associated mandate. Returns one page + the total count.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_search_candidates(
  p_q text default null, p_mandate uuid default null, p_status text default null, p_stage text default null,
  p_source text default null, p_location text default null, p_limit integer default 24, p_offset integer default 0)
returns table (total bigint, candidate jsonb) language sql stable set search_path = '' as $$
  with toks as (
    select lower(btrim(t)) as t from unnest(regexp_split_to_array(coalesce(p_q, ''), '\s+')) t where btrim(t) <> ''
  ), base as (
    select c.*,
      (select coalesce(jsonb_agg(jsonb_build_object('association_id', cm.id, 'mandate_id', m.id, 'mandate_title', m.title,
          'mandate_company', coalesce(co.name, m.company), 'stage', cm.stage, 'status', cm.status, 'joining_date', cm.joining_date)
          order by cm.updated_at desc), '[]'::jsonb)
         from public.candidate_mandates cm join public.mandates m on m.id = cm.mandate_id left join public.companies co on co.id = m.company_id
        where cm.candidate_id = c.id) as assocs,
      (select lower(string_agg(coalesce(m.title, '') || ' ' || coalesce(co.name, m.company, '') || ' ' || coalesce(m.location, ''), ' '))
         from public.candidate_mandates cm join public.mandates m on m.id = cm.mandate_id left join public.companies co on co.id = m.company_id
        where cm.candidate_id = c.id) as mdoc
    from public.candidates c
  ), filtered as (
    select b.* from base b
    where not exists (select 1 from toks where position(toks.t in (b.search_doc || ' ' || coalesce(b.mdoc, ''))) = 0)
      and (p_source is null or p_source = '' or lower(b.source) = lower(p_source))
      and (p_location is null or p_location = '' or lower(coalesce(b.current_location, '')) like '%' || lower(p_location) || '%')
      and (p_mandate is null or exists (select 1 from public.candidate_mandates x where x.candidate_id = b.id and x.mandate_id = p_mandate))
      and (p_status is null or p_status = '' or exists (select 1 from public.candidate_mandates x where x.candidate_id = b.id and x.status = p_status))
      and (p_stage is null or p_stage = '' or exists (select 1 from public.candidate_mandates x where x.candidate_id = b.id and x.stage = p_stage))
  )
  select count(*) over () as total,
    to_jsonb(f) - 'search_doc' - 'mdoc' - 'user_id' - 'status_log' - 'rounds' as candidate
  from filtered f
  order by f.created_at desc
  limit greatest(least(coalesce(p_limit, 24), 200), 1) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Activity counts for the timeline (meaningful events only)
create or replace function public.slate_activity_summary(p_since timestamptz) returns table (day date, kind text, n bigint)
language sql stable set search_path = '' as $$
  select (a.occurred_at at time zone 'Asia/Kolkata')::date, a.kind, count(*)
  from public.recruitment_activities a where a.meaningful and a.occurred_at >= p_since
  group by 1, 2 order by 1, 2;
$$;

-- Funnel: how many candidates ever reached each funnel stage (by configured order) vs. sit there now.
create or replace function public.slate_funnel(p_mandate uuid default null) returns table (stage_key text, label text, sort_order integer, reached bigint, current_count bigint)
language sql stable set search_path = '' as $$
  with ord as (
    select key, label, sort_order from public.config_options
    where kind = 'pipeline_stage' and active and coalesce((meta->>'funnel')::boolean, false) and user_id = (select auth.uid())
  ), seen as (
    select h.candidate_id, h.mandate_id, h.to_stage as stage from public.candidate_status_history h where p_mandate is null or h.mandate_id = p_mandate
    union
    select cm.candidate_id, cm.mandate_id, cm.stage from public.candidate_mandates cm where p_mandate is null or cm.mandate_id = p_mandate
  ), best as (
    select s.candidate_id, s.mandate_id, max(o.sort_order) as mx from seen s join ord o on o.key = s.stage group by 1, 2
  )
  select o.key, o.label, o.sort_order,
    (select count(*) from best b where b.mx >= o.sort_order),
    (select count(*) from public.candidate_mandates cm where cm.stage = o.key and (p_mandate is null or cm.mandate_id = p_mandate))
  from ord o order by o.sort_order;
$$;

-- ---------------------------------------------------------------------------------------------------
-- The Slate: completion (keeps history; reopening marks undone_at instead of deleting) and calendar moves
-- ---------------------------------------------------------------------------------------------------
create or replace function public.slate_set_task_done(p_task uuid, p_day date, p_done boolean) returns void language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.slate_tasks where id = p_task) then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if p_done then
    insert into public.slate_done (user_id, task_id, day, completed_at, undone_at) values (v_uid, p_task, p_day, now(), null)
    on conflict (task_id, day) do update set completed_at = now(), undone_at = null;
  else
    update public.slate_done set undone_at = now() where task_id = p_task and day = p_day and undone_at is null;
  end if;
end $$;

-- Move/resize one occurrence. One-time tasks change directly; recurring tasks get a per-occurrence override
-- (p_scope = 'this') or the series time/duration changes (p_scope = 'series'). est_minutes is NEVER touched.
create or replace function public.slate_move_task(p_task uuid, p_day date, p_new_day date, p_start time, p_minutes integer, p_scope text default 'this')
returns void language plpgsql set search_path = '' as $$
declare t public.slate_tasks; v_shift integer; v_rem time;
begin
  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then raise exception 'Duration must be between 5 and 1440 minutes' using errcode = '23514'; end if;
  select * into t from public.slate_tasks where id = p_task for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  v_shift := case when t.due_time is null then 0 else (extract(epoch from (p_start - t.due_time)) / 60)::int end;
  v_rem := case when t.reminder_time is null then null
                else least(greatest(t.reminder_time + make_interval(mins => v_shift), time '00:00'), time '23:59') end;
  if t.repeat = 'once' then
    update public.slate_tasks set start_date = p_new_day, due_time = p_start, sched_minutes = p_minutes, reminder_time = v_rem, notified_day = null where id = p_task;
  elsif p_scope = 'series' then
    update public.slate_tasks set due_time = p_start, sched_minutes = p_minutes, reminder_time = v_rem where id = p_task;
  else
    if p_new_day = p_day and p_start = t.due_time and p_minutes = coalesce(t.sched_minutes, t.est_minutes) then
      delete from public.slate_overrides where task_id = p_task and day = p_day;
    else
      insert into public.slate_overrides (user_id, task_id, day, new_day, start_time, sched_minutes) values (t.user_id, p_task, p_day, p_new_day, p_start, p_minutes)
      on conflict (task_id, day) do update set new_day = excluded.new_day, start_time = excluded.start_time, sched_minutes = excluded.sched_minutes;
    end if;
  end if;
end $$;

create or replace function public.slate_ensure_sop() returns public.sop_documents language plpgsql set search_path = '' as $$
declare d public.sop_documents; v_uid uuid := (select auth.uid());
begin
  select * into d from public.sop_documents where user_id = v_uid order by sort_order, created_at limit 1;
  if not found then insert into public.sop_documents (user_id) values (v_uid) returning * into d; end if;
  return d;
end $$;

-- Public key only (the private key and cron secret never leave the database)
create or replace function public.slate_vapid_public_key() returns text language sql stable security definer set search_path = '' as $$
  select value from public.push_config where key = 'vapid_public';
$$;

-- Unauthenticated liveness probe for monitoring: proves the API + database answer; exposes nothing else.
create or replace function public.slate_health() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', 'slate-1');
$$;

-- ---------------------------------------------------------------------------------------------------
-- Function privileges: nothing is callable by anon except the health probe.
-- ---------------------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'slate_ensure_defaults()', 'slate_upsert_company(text)', 'slate_upsert_agency(text,text)', 'slate_save_mandate(jsonb)', 'slate_save_candidate(jsonb)',
    'slate_set_candidate_stage(uuid,uuid,text,text,text,date,text,text)', 'slate_search_candidates(text,uuid,text,text,text,text,integer,integer)',
    'slate_activity_summary(timestamptz)', 'slate_funnel(uuid)', 'slate_set_task_done(uuid,date,boolean)', 'slate_move_task(uuid,date,date,time,integer,text)',
    'slate_ensure_sop()', 'slate_vapid_public_key()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- trigger functions are never RPC endpoints
  foreach f in array array[
    'slate_mandate_company_sync()', 'slate_mandate_activity()', 'slate_cm_history()', 'slate_cm_guard()', 'slate_comment_activity()', 'slate_step_activity()',
    'slate_doc_supersede()', 'slate_doc_activity()', 'slate_ma_activity()', 'slate_audit()', 'slate_sop_revision()', 'slate_task_inherit()', 'slate_task_cascade()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.slate_health() from public;
grant execute on function public.slate_health() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Private storage: JDs (versioned, no client delete) and server-side backups (no client access at all)
-- ---------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jds', 'jds', false, 10485760, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do update set public = false;
create policy "jds read own" on storage.objects for select to authenticated using (bucket_id = 'jds' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "jds insert own" on storage.objects for insert to authenticated with check (bucket_id = 'jds' and (storage.foldername(name))[1] = (select auth.uid())::text);
