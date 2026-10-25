-- Monster Gains — core schema (v1)
-- Design rules (see docs/DATA_MODEL.md):
--   * Every user-owned row has a client-generated uuid PK, so offline creates are idempotent (upsert by id).
--   * No hard deletes from clients: rows are archived/soft-deleted (deleted_at / archived_at). DELETE is revoked.
--   * Planned values and actual values live in separate columns; program versions are immutable history.
--   * Sync is deterministic last-writer-wins on client_updated_at (see mg_row_guard()).


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,                                   -- = user_id (set by the client after sign-in)
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  units text not null default 'kg' check (units in ('kg','lb')),
  week_start smallint not null default 1 check (week_start between 1 and 7),
  timezone text,
  language text not null default 'en',
  birth_year smallint check (birth_year between 1900 and 2100),
  height_cm numeric check (height_cm between 50 and 260),
  experience text check (experience in ('beginner','intermediate','advanced')),
  training_years numeric check (training_years between 0 and 80),
  goals text[] not null default '{}',
  preferred_days smallint[] not null default '{}',
  session_minutes smallint check (session_minutes between 10 and 300),
  equipment text[] not null default '{}',
  constraints_note text check (char_length(constraints_note) <= 4000),
  settings jsonb not null default '{}'::jsonb,
  baseline jsonb not null default '{}'::jsonb,
  onboarding_done boolean not null default false,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ---------------------------------------------------------------------------
-- exercises (user_id NULL = built-in library entry, read-only for clients)
-- ---------------------------------------------------------------------------
create table public.exercises (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  seed_key text unique,
  name text not null check (char_length(name) between 1 and 120),
  aliases text[] not null default '{}',
  category text not null default 'compound'
    check (category in ('compound','isolation','cardio','mobility','stretching','isometric','sport','conditioning')),
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  movement_pattern text check (movement_pattern in ('push','pull','squat','hinge','lunge','carry','rotation','flexion','extension','gait','other')),
  equipment text not null default 'other',
  laterality text not null default 'bilateral' check (laterality in ('bilateral','unilateral','alternating')),
  position text,
  resistance_type text not null default 'free_weight' check (resistance_type in ('free_weight','machine','cable','bodyweight','band','none')),
  tracking_method text not null default 'weight_reps'
    check (tracking_method in ('weight_reps','bodyweight_reps','assisted_reps','duration','distance','distance_duration','weight_duration')),
  load_mode text not null default 'total' check (load_mode in ('total','per_hand','per_side','bodyweight','assisted')),
  bodyweight_fraction numeric not null default 1 check (bodyweight_fraction between 0 and 1.5),
  technique text check (char_length(technique) <= 4000),
  cues text check (char_length(cues) <= 2000),
  demo_url text check (char_length(demo_url) <= 500),
  default_tempo text check (char_length(default_tempo) <= 20),
  default_rest_s integer check (default_rest_s between 0 and 1800),
  difficulty smallint check (difficulty between 1 and 5),
  substitute_ids uuid[] not null default '{}',
  variation_of uuid references public.exercises(id),
  variation_label text check (char_length(variation_label) <= 80),
  is_custom boolean not null default false,
  archived_at timestamptz,
  notes text check (char_length(notes) <= 4000),
  seed_version integer,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text,
  check ((user_id is null) = (seed_key is not null))
);

-- ---------------------------------------------------------------------------
-- equipment profiles
-- ---------------------------------------------------------------------------
create table public.equipment_profiles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  available_equipment text[] not null default '{}',
  machine_settings jsonb not null default '{}'::jsonb,   -- { "<exercise_id>": "seat 5, pin 3" }
  is_default boolean not null default false,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ---------------------------------------------------------------------------
-- programs, versions, templates, planned exercises
-- ---------------------------------------------------------------------------
create table public.programs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 4000),
  goal text,
  methodology text check (char_length(methodology) <= 2000),
  split text,
  source text,
  status text not null default 'active' check (status in ('active','paused','completed','archived','abandoned')),
  start_date date,
  end_date date,
  duration_weeks smallint check (duration_weeks between 1 and 260),
  weekly_frequency smallint check (weekly_frequency between 0 and 14),
  deload_weeks integer[] not null default '{}',
  progression_method text,
  target_notes text,
  notes text check (char_length(notes) <= 4000),
  is_template boolean not null default false,
  paused_intervals jsonb not null default '[]'::jsonb,   -- [{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"|null }]
  cloned_from uuid references public.programs(id),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

create table public.program_versions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id),
  version_no integer not null check (version_no >= 1),
  effective_from date not null,
  summary text check (char_length(summary) <= 1000),
  scope text,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text,
  unique (program_id, version_no)
);

create table public.workout_templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id),
  program_version_id uuid not null references public.program_versions(id),
  template_key uuid not null,                            -- stable identity of the "same" day across versions
  name text not null check (char_length(name) between 1 and 120),
  weekday smallint check (weekday between 1 and 7),      -- 1 = Monday … 7 = Sunday
  sequence integer not null default 0,
  workout_type text not null default 'strength' check (workout_type in ('strength','cardio','mixed','mobility','sport','rest')),
  target_muscles text[] not null default '{}',
  est_duration_min smallint check (est_duration_min between 0 and 600),
  warmup text check (char_length(warmup) <= 2000),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text,
  unique (program_version_id, template_key)
);

create table public.planned_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_version_id uuid not null references public.program_versions(id),
  template_id uuid not null references public.workout_templates(id),
  plan_key uuid not null,                                -- stable identity of the "same" prescription across versions
  position integer not null default 0,
  label text check (char_length(label) <= 10),           -- A1, A2, B1 …
  superset_group text check (char_length(superset_group) <= 10),
  exercise_id uuid not null references public.exercises(id),
  muscle_label text check (char_length(muscle_label) <= 80),
  sets smallint not null check (sets between 1 and 30),
  reps_min smallint check (reps_min between 0 and 500),
  reps_max smallint check (reps_max between 0 and 500),
  rir_target numeric check (rir_target between 0 and 10),
  rir_last_only boolean not null default false,
  rpe_target numeric check (rpe_target between 1 and 10),
  rest_min_s integer check (rest_min_s between 0 and 1800),
  rest_max_s integer check (rest_max_s between 0 and 1800),
  rest_mode text not null default 'after_set' check (rest_mode in ('after_set','after_pair')),
  tempo text check (char_length(tempo) <= 20),
  technique_code text check (technique_code in ('myo_rest_pause','half_reps_stretch','drop_25','double_drop','myo_activation','negatives','rir1_no_failure','no_failure','cheat_negative')),
  technique_text text check (char_length(technique_text) <= 500),
  start_load_kg numeric check (start_load_kg between 0 and 1500),
  load_note text check (char_length(load_note) <= 200),
  duration_target_s integer check (duration_target_s between 0 and 86400),
  distance_target_m numeric check (distance_target_m >= 0),
  cue text check (char_length(cue) <= 500),
  notes text check (char_length(notes) <= 2000),
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text,
  unique (template_id, plan_key),
  check (reps_max is null or reps_min is null or reps_max >= reps_min),
  check (rest_max_s is null or rest_min_s is null or rest_max_s >= rest_min_s)
);

-- ---------------------------------------------------------------------------
-- workout sessions, performed exercises, set records
-- ---------------------------------------------------------------------------
create table public.workout_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid references public.programs(id),
  program_version_id uuid references public.program_versions(id),
  template_id uuid references public.workout_templates(id),
  template_key uuid,
  dedupe_key text check (char_length(dedupe_key) <= 200),
  name text not null check (char_length(name) between 1 and 120),
  workout_type text not null default 'strength' check (workout_type in ('strength','cardio','mixed','mobility','sport','rest')),
  scheduled_date date,
  session_date date not null,
  status text not null default 'planned'
    check (status in ('planned','in_progress','completed_as_planned','completed_modified','partial','skipped','cancelled','rescheduled')),
  started_at timestamptz,
  finished_at timestamptz,
  paused_at timestamptz,
  paused_total_s integer not null default 0 check (paused_total_s >= 0),
  rescheduled_to date,
  skip_reason text check (char_length(skip_reason) <= 500),
  session_rpe numeric check (session_rpe between 1 and 10),
  energy smallint check (energy between 1 and 5),
  motivation smallint check (motivation between 1 and 5),
  readiness smallint check (readiness between 1 and 5),
  notes text check (char_length(notes) <= 4000),
  change_reason text check (char_length(change_reason) <= 1000),
  tags text[] not null default '{}',
  is_bookmarked boolean not null default false,
  location text check (char_length(location) <= 120),
  equipment_profile_id uuid references public.equipment_profiles(id),
  repeated_from uuid references public.workout_sessions(id),
  corrected_after_completion boolean not null default false,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);
create unique index workout_sessions_dedupe_idx
  on public.workout_sessions (user_id, dedupe_key) where dedupe_key is not null and deleted_at is null;

create table public.session_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id),
  position integer not null default 0,
  exercise_id uuid not null references public.exercises(id),           -- exercise ACTUALLY performed
  planned_exercise_id uuid references public.planned_exercises(id),
  plan_key uuid,
  planned jsonb,                                                       -- frozen copy of the prescription at session creation
  origin text not null default 'planned' check (origin in ('planned','added','substituted')),
  substituted_from_exercise_id uuid references public.exercises(id),
  substitution_scope text check (substitution_scope in ('session','future')),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','skipped')),
  skip_reason text check (char_length(skip_reason) <= 500),
  superset_group text check (char_length(superset_group) <= 10),
  label text check (char_length(label) <= 10),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

create table public.set_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id),
  session_exercise_id uuid not null references public.session_exercises(id),
  exercise_id uuid not null references public.exercises(id),           -- denormalised for history queries
  session_date date not null,                                          -- denormalised for history queries
  set_number integer not null check (set_number >= 1),
  set_type text not null default 'working'
    check (set_type in ('warmup','working','drop','rest_pause','myo','cluster','amrap','backoff','negative','partial')),
  parent_set_id uuid references public.set_records(id),                -- components of advanced techniques
  status text not null default 'planned' check (status in ('planned','completed','failed','skipped')),
  side text not null default 'both' check (side in ('both','left','right')),
  -- planned (prescription) values — never overwritten by logging
  planned_weight_kg numeric check (planned_weight_kg between 0 and 1500),
  planned_reps_min smallint,
  planned_reps_max smallint,
  planned_rir numeric,
  planned_duration_s integer,
  -- actual values — NULL means "not recorded", never zero
  weight_kg numeric check (weight_kg between 0 and 1500),
  reps smallint check (reps between 0 and 1000),
  reps_partial smallint check (reps_partial between 0 and 1000),
  reps_assisted smallint check (reps_assisted between 0 and 1000),
  duration_s numeric check (duration_s >= 0),
  distance_m numeric check (distance_m >= 0),
  assist_kg numeric check (assist_kg between 0 and 500),
  bodyweight_kg numeric check (bodyweight_kg between 20 and 500),
  rpe numeric check (rpe between 1 and 10),
  rir numeric check (rir between 0 and 10),
  failure text check (failure in ('none','technical','muscular')),
  tempo text check (char_length(tempo) <= 20),
  eccentric_s numeric check (eccentric_s >= 0),
  pause_bottom_s numeric check (pause_bottom_s >= 0),
  concentric_s numeric check (concentric_s >= 0),
  pause_top_s numeric check (pause_top_s >= 0),
  rom text check (rom in ('full','partial','custom')),
  quality smallint check (quality between 1 and 5),
  rest_before_s integer check (rest_before_s between 0 and 7200),
  started_at timestamptz,
  completed_at timestamptz,
  load_estimated boolean not null default false,
  bar_velocity numeric check (bar_velocity >= 0),
  discomfort text check (char_length(discomfort) <= 500),
  note text check (char_length(note) <= 1000),
  extras jsonb not null default '{}'::jsonb,                           -- cardio: incline, hr, cadence, stroke_rate, power, rounds …
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ---------------------------------------------------------------------------
-- goals, body, recovery, photos
-- ---------------------------------------------------------------------------
create table public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  goal_type text not null check (goal_type in ('exercise_load','exercise_reps_at_load','exercise_e1rm','weekly_frequency','weekly_sets','weekly_volume','adherence','bodyweight','measurement','cardio','mobility','custom')),
  exercise_id uuid references public.exercises(id),
  muscle text,
  measurement_key text,
  target_value numeric not null,
  target_weight_kg numeric,
  baseline_value numeric,
  baseline_date date,
  target_date date,
  priority smallint not null default 2 check (priority between 1 and 3),
  status text not null default 'active' check (status in ('active','paused','completed','abandoned')),
  completed_at timestamptz,
  milestones jsonb not null default '[]'::jsonb,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

create table public.body_measurements (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null,
  bodyweight_kg numeric check (bodyweight_kg between 20 and 500),
  waist_cm numeric check (waist_cm between 20 and 300),
  chest_cm numeric check (chest_cm between 20 and 300),
  arm_cm numeric check (arm_cm between 5 and 100),
  thigh_cm numeric check (thigh_cm between 10 and 200),
  hip_cm numeric check (hip_cm between 20 and 300),
  calf_cm numeric check (calf_cm between 10 and 100),
  body_fat_pct numeric check (body_fat_pct between 2 and 70),
  body_fat_method text,
  muscle_mass_kg numeric check (muscle_mass_kg between 5 and 200),
  conditions text,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

create table public.readiness_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_date date not null,
  sleep_hours numeric check (sleep_hours between 0 and 24),
  sleep_quality smallint check (sleep_quality between 1 and 5),
  energy smallint check (energy between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  stress smallint check (stress between 1 and 5),
  motivation smallint check (motivation between 1 and 5),
  perceived_recovery smallint check (perceived_recovery between 1 and 5),
  fatigue smallint check (fatigue between 1 and 5),
  resting_hr smallint check (resting_hr between 20 and 250),
  hrv_ms numeric check (hrv_ms between 1 and 500),
  soreness_areas text[] not null default '{}',
  illness_note text check (char_length(illness_note) <= 1000),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);
create unique index readiness_records_day_idx on public.readiness_records (user_id, record_date) where deleted_at is null;

create table public.progress_photos (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  taken_at timestamptz not null,
  storage_path text,                                      -- '<user_id>/<id>.jpg' in the private progress-photos bucket
  pose text,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

-- ---------------------------------------------------------------------------
-- audit trail, program modifications, recommendations
-- ---------------------------------------------------------------------------
create table public.program_modifications (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id),
  from_version_id uuid references public.program_versions(id),
  to_version_id uuid references public.program_versions(id),
  session_id uuid references public.workout_sessions(id),
  scope text not null,
  kind text not null,
  description text not null check (char_length(description) <= 2000),
  payload jsonb not null default '{}'::jsonb,
  effective_from date,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

create table public.audit_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before jsonb,
  after jsonb,
  reason text check (char_length(reason) <= 1000),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);

create table public.recommendations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  exercise_id uuid references public.exercises(id),
  muscle text,
  observation text not null,
  evidence jsonb not null default '{}'::jsonb,
  suggestion text not null,
  tradeoff text,
  proposed_change jsonb,
  status text not null default 'open' check (status in ('open','accepted','edited','dismissed','deferred')),
  deferred_until date,
  resolved_at timestamptz,
  response_note text check (char_length(response_note) <= 1000),
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text
);
create unique index recommendations_dedupe_idx on public.recommendations (user_id, dedupe_key) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Indexes (sync pulls + history/dashboard queries)
-- ---------------------------------------------------------------------------
create index set_records_exercise_hist_idx on public.set_records (user_id, exercise_id, session_date desc);
create index set_records_session_idx on public.set_records (session_id);
create index set_records_session_exercise_idx on public.set_records (session_exercise_id);
create index set_records_parent_idx on public.set_records (parent_set_id) where parent_set_id is not null;
create index session_exercises_session_idx on public.session_exercises (session_id);
create index session_exercises_exercise_idx on public.session_exercises (user_id, exercise_id);
create index workout_sessions_date_idx on public.workout_sessions (user_id, session_date desc);
create index workout_sessions_program_idx on public.workout_sessions (program_id, scheduled_date);
create index workout_templates_version_idx on public.workout_templates (program_version_id);
create index planned_exercises_version_idx on public.planned_exercises (program_version_id, template_id);
create index program_versions_program_idx on public.program_versions (program_id, effective_from);
create index audit_events_entity_idx on public.audit_events (user_id, entity_type, entity_id, occurred_at desc);
create index body_measurements_date_idx on public.body_measurements (user_id, measured_at desc);
create index exercises_user_idx on public.exercises (user_id);
create index goals_user_status_idx on public.goals (user_id, status);

-- ---------------------------------------------------------------------------
-- Sync guard: deterministic last-writer-wins + server cursor + identity protection
-- ---------------------------------------------------------------------------
create or replace function public.mg_row_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.client_updated_at := least(coalesce(new.client_updated_at, now()), clock_timestamp() + interval '10 minutes');
    new.server_updated_at := clock_timestamp();
    return new;
  end if;

  -- UPDATE (also reached by upsert ... on conflict do update)
  if new.client_updated_at < old.client_updated_at then
    return null;                                  -- stale write: the newer row stays; replays are harmless
  end if;
  new.user_id := old.user_id;                     -- ownership can never be changed
  new.created_at := old.created_at;
  new.client_updated_at := least(new.client_updated_at, clock_timestamp() + interval '10 minutes');
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare
  t text;
  owned text[] := array['profiles','exercises','equipment_profiles','programs','program_versions','workout_templates',
    'planned_exercises','workout_sessions','session_exercises','set_records','goals','body_measurements',
    'readiness_records','progress_photos','program_modifications','audit_events','recommendations'];
begin
  foreach t in array owned loop
    execute format('create index %I on public.%I (user_id, server_updated_at, id)', t || '_sync_idx', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.mg_row_guard()', t || '_guard', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    if t = 'exercises' then
      execute format($p$create policy %I on public.%I for select to authenticated using (user_id is null or user_id = (select auth.uid()))$p$, t || '_select', t);
    else
      execute format($p$create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t || '_select', t);
    end if;
    execute format($p$create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t || '_update', t);
    -- deliberately NO delete policy and DELETE revoked below: history is archived, never destroyed by a client.
  end loop;
end $$;

-- Least privilege: no anonymous access, no client-side deletes.
revoke all on all tables in schema public from anon;
revoke delete, truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke delete, truncate, references, trigger on tables from authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion (explicit, user-initiated, server-side only)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from storage.objects where bucket_id = 'progress-photos' and (storage.foldername(name))[1] = uid::text;
  delete from auth.users where id = uid;       -- cascades to every user-owned row
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket for optional progress photos (owner folder = user id)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create policy "progress photos: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "progress photos: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "progress photos: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "progress photos: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
