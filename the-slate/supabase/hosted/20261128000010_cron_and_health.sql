-- =====================================================================================================
-- SUPABASE-HOSTED PARTS (need the pg_cron + pg_net extensions and the Edge Functions runtime).
-- Kept apart from supabase/migrations/ so that those stay plain, portable Postgres.
-- Applied to the live hiring-copilot project as three migrations: slate_cron_jobs, notifications_dedupe_full_index (portable, lives in
-- migrations/), slate_health_detail. On another Supabase project, run this file once AFTER the migrations and AFTER deploying the functions
-- (supabase functions deploy notify backup slate-parse send-reminders --no-verify-jwt).
-- 1) replace YOUR-PROJECT-REF below; 2) make sure public.push_config has the keys: vapid_public, vapid_private, vapid_subject, cron_secret.
-- =====================================================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into public.push_config (key, value) values ('functions_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1') on conflict (key) do nothing;

-- Reminder engine: task reminders + follow-ups, daily idle-mandate digest, joining alerts (every 5 minutes)
select cron.schedule('slate-notify-5min', '*/5 * * * *', $cron$
  select net.http_post(
    url := (select value from public.push_config where key = 'functions_url') || '/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.push_config where key = 'cron_secret')),
    body := '{}'::jsonb)
$cron$);

-- Nightly verified backup at 02:00 IST (20:30 UTC)
select cron.schedule('slate-backup-daily', '30 20 * * *', $cron$
  select net.http_post(
    url := (select value from public.push_config where key = 'functions_url') || '/backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.push_config where key = 'cron_secret')),
    body := '{}'::jsonb)
$cron$);

-- Legacy hiring follow-up reminders (existing job, unchanged): send-reminders-5min

-- Non-sensitive health probe for the 8 AM monitor: backup + job status and row totals. Callable without signing in.
create or replace function public.slate_health_detail() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_backup jsonb; v_jobs jsonb := '{}'::jsonb; j record;
begin
  select to_jsonb(b) into v_backup from (select finished_at, status, verified, size_bytes from public.backup_runs order by started_at desc limit 1) b;
  begin
    for j in select d.jobname, (select max(r.end_time) from cron.job_run_details r where r.jobid = d.jobid) as last_run,
                    (select r.status from cron.job_run_details r where r.jobid = d.jobid order by r.start_time desc limit 1) as last_status
             from cron.job d where d.jobname like 'slate-%' loop
      v_jobs := v_jobs || jsonb_build_object(j.jobname, jsonb_build_object('last_run', j.last_run, 'last_status', j.last_status));
    end loop;
  exception when others then v_jobs := jsonb_build_object('error', 'cron schedule not readable');
  end;
  return jsonb_build_object('ok', true, 'db_time', now(), 'schema', 'slate-1', 'last_backup', coalesce(v_backup, 'null'::jsonb), 'jobs', v_jobs,
    'counts', jsonb_build_object('mandates', (select count(*) from public.mandates), 'candidates', (select count(*) from public.candidates), 'tasks', (select count(*) from public.slate_tasks)));
end $$;
revoke all on function public.slate_health_detail() from public;
grant execute on function public.slate_health_detail() to anon, authenticated;
