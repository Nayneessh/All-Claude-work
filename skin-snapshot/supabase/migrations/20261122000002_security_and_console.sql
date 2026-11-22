-- Row-level security, role checks and the staff console API.
-- Design: no browser or staff session can read these tables directly. Everything staff do goes through
-- SECURITY DEFINER functions that (1) require an active staff row, (2) require a two-step-verified
-- session (aal2), and (3) write the access log in the same transaction.
-- The API sets the verified JWT claims with set_config('request.jwt.claims', ...) and runs
-- "set local role authenticated", exactly as PostgREST does.
set check_function_bodies = off;

-- 1. Lock every table: RLS on, no table privileges for API roles, no default function execute for PUBLIC.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'ss' loop
    execute format('alter table ss.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on schema ss from public;
grant usage on schema ss to authenticated, service_role;
revoke all on all tables in schema ss from public, anon, authenticated;
revoke all on all sequences in schema ss from public, anon, authenticated;
alter default privileges in schema ss revoke all on tables from public, anon, authenticated;
alter default privileges in schema ss revoke execute on functions from public;

-- The application's own connection role is the table owner and bypasses RLS. API roles get no policies except those
-- granted explicitly in section 3, so they are denied by default.

-- 2. Claims helpers
create function ss.claims() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function ss.uid() returns uuid language sql stable as $$
  select nullif(ss.claims() ->> 'sub', '')::uuid
$$;

-- Role of the calling staff member, or NULL. Requires an active staff row AND two-step verification.
create function ss.current_staff_role() returns text language sql stable security definer set search_path = ss, pg_temp as $$
  select s.role from ss.staff s
  where s.user_id = ss.uid() and s.active and ss.claims() ->> 'aal' = 'aal2'
$$;

create function ss.require_staff(allowed text[] default array['admin', 'cosmetologist']) returns text
language plpgsql stable security definer set search_path = ss, pg_temp as $$
declare r text := ss.current_staff_role();
begin
  if r is null or not (r = any (allowed)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return r;
end $$;

create function ss.log_access(p_action text, p_case uuid, p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = ss, pg_temp as $$
begin
  insert into ss.access_log (actor, actor_email, action, case_id, case_code, meta)
  values (ss.uid(), ss.claims() ->> 'email', p_action, p_case, (select code from ss.cases where id = p_case), p_meta);
end $$;

-- Photos, answers and AI output are shown only for cases whose visitor asked to be contacted and has
-- not withdrawn that consent. Flagged cases that never booked show metadata only.
create function ss.case_details_visible(p_case uuid) returns boolean language sql stable security definer set search_path = ss, pg_temp as $$
  select exists (
    select 1 from ss.bookings b
    join ss.consents c on c.case_id = b.case_id and c.key = 'whatsapp' and c.withdrawn_at is null
    join ss.cases k on k.id = b.case_id and k.contact_withdrawn_at is null
    where b.case_id = p_case)
$$;

-- 3. Policies (defence in depth) and the one table staff may read directly: routine templates.
create policy staff_read_templates on ss.routine_templates for select to authenticated using (ss.current_staff_role() is not null);
grant select on ss.routine_templates to authenticated;
create policy staff_read_self on ss.staff for select to authenticated using (user_id = ss.uid());
grant select (user_id, email, role, active) on ss.staff to authenticated;
grant all on all tables in schema ss to service_role;
grant usage, select on all sequences in schema ss to service_role;

-- 4. Console functions

create function ss.console_me() returns jsonb language plpgsql stable security definer set search_path = ss, pg_temp as $$
declare r text := ss.require_staff();
begin
  return jsonb_build_object('user_id', ss.uid(), 'email', ss.claims() ->> 'email', 'role', r);
end $$;

create function ss.console_list_cases(
  p_path text default null, p_status text default null, p_flagged boolean default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = ss, pg_temp as $$
declare out jsonb;
begin
  perform ss.require_staff();
  select coalesce(jsonb_agg(row_to_json(q)::jsonb), '[]'::jsonb) into out from (
    select c.id, c.code, c.path, c.stage, c.created_at,
           c.safety_stopped as flagged,
           (select coalesce(jsonb_agg(f ->> 'code'), '[]'::jsonb) from jsonb_array_elements(c.safety_flags) f) as flag_codes,
           b.status as booking_status,
           case when ss.case_details_visible(c.id) then b.first_name end as first_name,
           b.preferred_day, b.time_window, b.method, b.requested_at,
           case when ss.case_details_visible(c.id) then c.answers ->> 'budget' end as budget,
           c.contact_withdrawn_at is not null as contact_withdrawn
    from ss.cases c
    left join ss.bookings b on b.case_id = c.id
    where (b.case_id is not null or c.safety_stopped)
      and (p_path is null or c.path = p_path)
      and (p_status is null or b.status = p_status)
      and (p_flagged is null or c.safety_stopped = p_flagged)
    order by coalesce(b.requested_at, c.created_at) desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  ) q;
  return out;
end $$;

create function ss.console_open_case(p_case uuid) returns jsonb language plpgsql security definer set search_path = ss, pg_temp as $$
declare
  k ss.cases%rowtype;
  vis boolean;
  out jsonb;
begin
  perform ss.require_staff();
  select * into k from ss.cases where id = p_case;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  vis := ss.case_details_visible(p_case);
  perform ss.log_access('open_case', p_case, jsonb_build_object('details_visible', vis));
  out := jsonb_build_object(
    'id', k.id, 'code', k.code, 'path', k.path, 'lang', k.lang, 'stage', k.stage, 'created_at', k.created_at,
    'flagged', k.safety_stopped, 'flags', k.safety_flags, 'restrictions', k.restrictions,
    'contact_withdrawn_at', k.contact_withdrawn_at, 'health_withdrawn', k.health_withdrawn,
    'details_visible', vis,
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'version', version, 'granted_at', granted_at, 'withdrawn_at', withdrawn_at) order by id), '[]'::jsonb) from ss.consents where case_id = p_case),
    'booking', (select to_jsonb(b) - 'whatsapp_hash' from ss.bookings b where b.case_id = p_case),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'author_email', author_email, 'body', body, 'created_at', created_at) order by id desc), '[]'::jsonb) from ss.case_notes where case_id = p_case)
  );
  if vis then
    out := out || jsonb_build_object(
      'answers', k.answers,
      'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slot', slot, 'object_key', object_key, 'width', width, 'height', height, 'client_checks', client_checks) order by slot), '[]'::jsonb) from ss.photos where case_id = p_case and status = 'stored'),
      'analysis', (select jsonb_build_object('id', a.id, 'model', a.model, 'provider', a.provider, 'prompt_version', a.prompt_version, 'passes', a.passes, 'disagreements', a.disagreements, 'latency_ms', a.latency_ms, 'finished_at', a.finished_at, 'result', a.result, 'gate_b', a.gate_b)
                   from ss.analyses a where a.case_id = p_case and a.status = 'done' order by a.finished_at desc limit 1),
      'feedback', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'zone', zone, 'attribute', attribute, 'verdict', verdict, 'comment', comment, 'author', author)), '[]'::jsonb) from ss.ai_feedback where case_id = p_case)
    );
  end if;
  return out;
end $$;

create function ss.console_set_status(p_case uuid, p_status text, p_closed_days integer default 90) returns jsonb
language plpgsql security definer set search_path = ss, pg_temp as $$
declare old_status text;
begin
  perform ss.require_staff();
  select status into old_status from ss.bookings where case_id = p_case for update;
  if not found then raise exception 'no_booking' using errcode = 'P0002'; end if;
  if p_status not in ('requested', 'contacted', 'scheduled', 'completed', 'no_response', 'closed') then
    raise exception 'bad_status' using errcode = '22023';
  end if;
  update ss.bookings set status = p_status, status_changed_at = now(),
    contacted_at = case when p_status = 'contacted' and contacted_at is null then now() else contacted_at end
  where case_id = p_case;
  if p_status = 'closed' then
    update ss.cases set closed_at = now(), expires_at = now() + make_interval(days => p_closed_days) where id = p_case;
  else
    update ss.cases set closed_at = null, expires_at = null where id = p_case;
  end if;
  perform ss.log_access('status_change', p_case, jsonb_build_object('from', old_status, 'to', p_status));
  return jsonb_build_object('status', p_status);
end $$;

create function ss.console_add_note(p_case uuid, p_body text) returns bigint language plpgsql security definer set search_path = ss, pg_temp as $$
declare nid bigint;
begin
  perform ss.require_staff();
  if not exists (select 1 from ss.cases where id = p_case) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into ss.case_notes (case_id, author, author_email, body) values (p_case, ss.uid(), ss.claims() ->> 'email', p_body) returning id into nid;
  perform ss.log_access('add_note', p_case);
  return nid;
end $$;

create function ss.console_feedback(
  p_case uuid, p_analysis uuid, p_kind text, p_zone text, p_attribute text, p_verdict text, p_comment text default null
) returns void language plpgsql security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff();
  if not ss.case_details_visible(p_case) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into ss.ai_feedback (case_id, analysis_id, kind, zone, attribute, verdict, comment, author)
  values (p_case, p_analysis, p_kind, p_zone, p_attribute, p_verdict, p_comment, ss.uid())
  on conflict (case_id, (coalesce(analysis_id, '00000000-0000-0000-0000-000000000000'::uuid)), kind, (coalesce(zone, '')), (coalesce(attribute, '')), author)
  do update set verdict = excluded.verdict, comment = excluded.comment, created_at = now();
  perform ss.log_access('ai_feedback', p_case, jsonb_build_object('kind', p_kind, 'zone', p_zone, 'attribute', p_attribute, 'verdict', p_verdict));
end $$;

create function ss.console_delete_case(p_case uuid) returns void language plpgsql security definer set search_path = ss, pg_temp as $$
declare c text;
begin
  perform ss.require_staff();
  select code into c from ss.cases where id = p_case;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform ss.log_access('delete_case', p_case);
  insert into ss.deletion_ledger (case_id, case_code, reason) values (p_case, c, 'staff_request');
  delete from ss.cases where id = p_case;
end $$;

create function ss.console_export_case(p_case uuid) returns jsonb language plpgsql security definer set search_path = ss, pg_temp as $$
declare out jsonb;
begin
  perform ss.require_staff();
  if not ss.case_details_visible(p_case) then raise exception 'forbidden' using errcode = '42501'; end if;
  out := ss.console_open_case(p_case);
  perform ss.log_access('export_case', p_case);
  return out || jsonb_build_object('exported_at', now());
end $$;

create function ss.console_list_templates() returns jsonb language plpgsql stable security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff();
  return (select coalesce(jsonb_agg(to_jsonb(t) order by steps, skin_feel, sensitivity, name), '[]'::jsonb) from ss.routine_templates t);
end $$;

create function ss.console_save_template(
  p_id uuid, p_name text, p_steps integer, p_skin_feel text, p_sensitivity text, p_budget_bands text[], p_items jsonb, p_approve boolean
) returns uuid language plpgsql security definer set search_path = ss, pg_temp as $$
declare tid uuid;
begin
  perform ss.require_staff();
  if p_id is null then
    insert into ss.routine_templates (name, steps, skin_feel, sensitivity, budget_bands, items, approved, sample, approved_by, approved_at, updated_by)
    values (p_name, p_steps, p_skin_feel, p_sensitivity, coalesce(p_budget_bands, '{}'), p_items, p_approve, false,
            case when p_approve then ss.uid() end, case when p_approve then now() end, ss.uid())
    returning id into tid;
  else
    update ss.routine_templates set name = p_name, steps = p_steps, skin_feel = p_skin_feel, sensitivity = p_sensitivity,
      budget_bands = coalesce(p_budget_bands, '{}'), items = p_items, approved = p_approve,
      sample = case when p_approve then false else sample end,
      approved_by = case when p_approve then ss.uid() else null end,
      approved_at = case when p_approve then now() else null end,
      updated_by = ss.uid()
    where id = p_id returning id into tid;
    if tid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  perform ss.log_access('save_template', null, jsonb_build_object('template', tid, 'approved', p_approve));
  return tid;
end $$;

create function ss.console_delete_template(p_id uuid) returns void language plpgsql security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff();
  delete from ss.routine_templates where id = p_id;
  perform ss.log_access('delete_template', null, jsonb_build_object('template', p_id));
end $$;

create function ss.console_block_number(p_hash text, p_reason text) returns void language plpgsql security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff();
  insert into ss.blocked_numbers (whatsapp_hash, reason, blocked_by) values (p_hash, p_reason, ss.uid()) on conflict (whatsapp_hash) do update set reason = excluded.reason;
  perform ss.log_access('block_number', null);
end $$;

-- Hash of the booking's number, so staff can block a number without ever handling a raw list.
create function ss.console_booking_number_hash(p_case uuid) returns text language plpgsql stable security definer set search_path = ss, pg_temp as $$
declare h text;
begin
  perform ss.require_staff();
  select whatsapp_hash into h from ss.bookings where case_id = p_case;
  return h;
end $$;

create function ss.console_access_log(p_limit integer default 100, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff(array['admin']);
  return (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from (
    select id, at, actor_email, action, case_code, meta from ss.access_log
    where p_before is null or id < p_before order by id desc limit least(greatest(p_limit, 1), 500)) l);
end $$;

create function ss.console_staff() returns jsonb language plpgsql stable security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff(array['admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'role', role, 'active', active, 'created_at', created_at) order by created_at), '[]'::jsonb) from ss.staff);
end $$;

create function ss.console_get_settings() returns jsonb language plpgsql stable security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff();
  return (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from ss.settings);
end $$;

create function ss.console_set_setting(p_key text, p_value jsonb) returns void language plpgsql security definer set search_path = ss, pg_temp as $$
begin
  perform ss.require_staff(array['admin']);
  insert into ss.settings (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform ss.log_access('set_setting', null, jsonb_build_object('key', p_key));
end $$;

-- Weekly counts, funnel and the four proposed Phase 1 success measures.
create function ss.console_counts(p_weeks integer default 8) returns jsonb language plpgsql stable security definer set search_path = ss, pg_temp as $$
declare weeks jsonb; m jsonb;
begin
  perform ss.require_staff();
  select coalesce(jsonb_agg(w order by w ->> 'week_start' desc), '[]'::jsonb) into weeks from (
    select jsonb_build_object(
      'week_start', to_char(date_trunc('week', e.at), 'YYYY-MM-DD'),
      'visitors', count(distinct e.session_id) filter (where e.name = 'page_view'),
      'path_selected', count(*) filter (where e.name = 'path_selected'),
      'assessments_started', count(*) filter (where e.name = 'assessment_started'),
      'consents_completed', count(*) filter (where e.name = 'consent_completed'),
      'camera_started', count(*) filter (where e.name = 'camera_started'),
      'photos_completed', count(*) filter (where e.name = 'photos_completed'),
      'snapshots', count(*) filter (where e.name = 'snapshot_ready'),
      'bookings', count(*) filter (where e.name = 'booking_requested'),
      'flags', count(*) filter (where e.name = 'safety_stop')) as w
    from ss.events e
    where e.at >= date_trunc('week', now()) - make_interval(weeks => greatest(p_weeks, 1) - 1)
    group by date_trunc('week', e.at)) x;

  with s as (
    select session_id,
      bool_or(name = 'camera_started') as cam,
      bool_or(name = 'snapshot_ready') as snap,
      bool_or(name = 'snapshot_viewed') as viewed,
      bool_or(name = 'booking_requested') as booked,
      bool_or(name = 'safety_stop') as stopped,
      bool_or(name = 'routine_shown') as routine,
      min(at) filter (where name = 'photos_completed') as t_photos,
      min(at) filter (where name = 'snapshot_ready') as t_snap
    from ss.events where session_id is not null and at >= now() - interval '90 days' group by session_id
  ), d as (
    select extract(epoch from (t_snap - t_photos)) as secs from s where t_photos is not null and t_snap is not null and t_snap >= t_photos
  )
  select jsonb_build_object(
    'camera_sessions', (select count(*) from s where cam),
    'camera_to_snapshot', (select count(*) from s where cam and snap),
    'camera_to_snapshot_pct', (select case when count(*) filter (where cam) = 0 then null else round(100.0 * count(*) filter (where cam and snap) / count(*) filter (where cam), 1) end from s),
    'snapshot_viewers', (select count(*) from s where viewed),
    'snapshot_to_booking', (select count(*) from s where viewed and booked),
    'snapshot_to_booking_pct', (select case when count(*) filter (where viewed) = 0 then null else round(100.0 * count(*) filter (where viewed and booked) / count(*) filter (where viewed), 1) end from s),
    'time_to_snapshot_p50_s', (select round((percentile_cont(0.5) within group (order by secs))::numeric, 1) from d),
    'time_to_snapshot_p95_s', (select round((percentile_cont(0.95) within group (order by secs))::numeric, 1) from d),
    'within_60s_pct', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where secs <= 60) / count(*), 1) end from d),
    'safety_leaks', (select count(*) from s where stopped and routine)
  ) into m;

  -- Funnel (sessions reaching each step) and median seconds between consecutive steps.
  with first_at as (
    select session_id, name, min(at) as t from ss.events
    where session_id is not null and at >= now() - interval '90 days'
      and name in ('assessment_started', 'consent_completed', 'questionnaire_completed', 'camera_started', 'photos_completed', 'snapshot_ready', 'booking_requested')
    group by session_id, name
  ), steps(name, ord) as (
    values ('assessment_started', 1), ('consent_completed', 2), ('questionnaire_completed', 3), ('camera_started', 4), ('photos_completed', 5), ('snapshot_ready', 6), ('booking_requested', 7)
  ), reach as (
    select st.name, st.ord, count(distinct f.session_id) as sessions from steps st left join first_at f on f.name = st.name group by st.name, st.ord
  ), gaps as (
    select a.name as from_step, b.name as to_step, extract(epoch from (b.t - a.t)) as secs
    from first_at a join steps sa on sa.name = a.name
    join steps sb on sb.ord = sa.ord + 1 join first_at b on b.name = sb.name and b.session_id = a.session_id
    where b.t >= a.t
  ), pair as (
    select from_step, to_step, round((percentile_cont(0.5) within group (order by secs))::numeric, 1) as median_s, count(*) as n
    from gaps group by from_step, to_step
  )
  select m || jsonb_build_object(
    'funnel', (select coalesce(jsonb_agg(jsonb_build_object('step', name, 'sessions', sessions) order by ord), '[]'::jsonb) from reach),
    'stage_seconds', (select coalesce(jsonb_agg(jsonb_build_object('from', from_step, 'to', to_step, 'median_s', median_s, 'n', n)), '[]'::jsonb) from pair)
  ) into m;
  return jsonb_build_object('weeks', weeks, 'measures', m);
end $$;

-- Allow only signed-in API roles to call the console functions. Each re-checks role and two-step state itself.
grant execute on function
  ss.console_me(), ss.console_list_cases(text, text, boolean, integer, integer), ss.console_open_case(uuid),
  ss.console_set_status(uuid, text, integer), ss.console_add_note(uuid, text),
  ss.console_feedback(uuid, uuid, text, text, text, text, text), ss.console_delete_case(uuid), ss.console_export_case(uuid),
  ss.console_list_templates(), ss.console_save_template(uuid, text, integer, text, text, text[], jsonb, boolean),
  ss.console_delete_template(uuid), ss.console_block_number(text, text), ss.console_booking_number_hash(uuid),
  ss.console_access_log(integer, bigint), ss.console_staff(), ss.console_get_settings(), ss.console_set_setting(text, jsonb),
  ss.console_counts(integer), ss.current_staff_role(), ss.uid(), ss.claims()
to authenticated;
