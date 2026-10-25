/**
 * Row types. They mirror the Postgres tables 1:1 (snake_case) so the local IndexedDB store and
 * Supabase share one shape and sync needs no mapping layer. See docs/DATA_MODEL.md.
 * Timestamps are ISO-8601 UTC strings; calendar dates are local 'YYYY-MM-DD' strings.
 */

export type Unit = 'kg' | 'lb';
export type ISODate = string; // 'YYYY-MM-DD'
export type ISOTime = string; // ISO-8601 instant

export interface SyncFields {
  id: string;
  user_id: string | null;
  created_at: ISOTime;
  client_updated_at: ISOTime;
  server_updated_at?: ISOTime | null;
  deleted_at: ISOTime | null;
  device_id: string | null;
}

export type TrackingMethod =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'assisted_reps'
  | 'duration'
  | 'distance'
  | 'distance_duration'
  | 'weight_duration';
export type LoadMode = 'total' | 'per_hand' | 'per_side' | 'bodyweight' | 'assisted';
export type ExerciseCategory =
  | 'compound'
  | 'isolation'
  | 'cardio'
  | 'mobility'
  | 'stretching'
  | 'isometric'
  | 'sport'
  | 'conditioning';
export type MovementPattern =
  | 'push'
  | 'pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'carry'
  | 'rotation'
  | 'flexion'
  | 'extension'
  | 'gait'
  | 'other';
export type Laterality = 'bilateral' | 'unilateral' | 'alternating';
export type ResistanceType = 'free_weight' | 'machine' | 'cable' | 'bodyweight' | 'band' | 'none';

export interface Profile extends SyncFields {
  display_name: string | null;
  units: Unit;
  week_start: number;
  timezone: string | null;
  language: string;
  birth_year: number | null;
  height_cm: number | null;
  experience: 'beginner' | 'intermediate' | 'advanced' | null;
  training_years: number | null;
  goals: string[];
  preferred_days: number[];
  session_minutes: number | null;
  equipment: string[];
  constraints_note: string | null;
  settings: AppSettings;
  baseline: Record<string, unknown>;
  onboarding_done: boolean;
}

export interface AppSettings {
  default_rest_s?: number;
  rpe_mode?: 'rir' | 'rpe' | 'both' | 'none';
  e1rm_formula?: 'epley' | 'brzycki' | 'lombardi';
  double_per_hand?: boolean;
  unrated_counts_as_hard?: boolean;
  secondary_muscle_weight?: number;
  auto_start_rest?: boolean;
  rest_sound?: boolean;
  rest_vibrate?: boolean;
  text_scale?: number;
  reminders?: { enabled: boolean; time: string; days: number[]; snooze_min: number; missed_prompt: boolean; weekly_summary: boolean };
  pr_types?: string[];
  plate_bar_kg?: number;
  plates_kg?: number[];
  app_lock?: { enabled: boolean };
}

export interface Exercise extends SyncFields {
  seed_key: string | null;
  name: string;
  aliases: string[];
  category: ExerciseCategory;
  primary_muscles: string[];
  secondary_muscles: string[];
  movement_pattern: MovementPattern | null;
  equipment: string;
  laterality: Laterality;
  position: string | null;
  resistance_type: ResistanceType;
  tracking_method: TrackingMethod;
  load_mode: LoadMode;
  bodyweight_fraction: number;
  technique: string | null;
  cues: string | null;
  demo_url: string | null;
  default_tempo: string | null;
  default_rest_s: number | null;
  difficulty: number | null;
  substitute_ids: string[];
  variation_of: string | null;
  variation_label: string | null;
  is_custom: boolean;
  archived_at: ISOTime | null;
  notes: string | null;
  seed_version: number | null;
}

export interface EquipmentProfile extends SyncFields {
  name: string;
  available_equipment: string[];
  machine_settings: Record<string, string>;
  is_default: boolean;
  notes: string | null;
}

export type ProgramStatus = 'active' | 'paused' | 'completed' | 'archived' | 'abandoned';

export interface Program extends SyncFields {
  name: string;
  description: string | null;
  goal: string | null;
  methodology: string | null;
  split: string | null;
  source: string | null;
  status: ProgramStatus;
  start_date: ISODate | null;
  end_date: ISODate | null;
  duration_weeks: number | null;
  weekly_frequency: number | null;
  deload_weeks: number[];
  progression_method: string | null;
  target_notes: string | null;
  notes: string | null;
  is_template: boolean;
  paused_intervals: { from: ISODate; to: ISODate | null }[];
  cloned_from: string | null;
}

export interface ProgramVersion extends SyncFields {
  program_id: string;
  version_no: number;
  effective_from: ISODate;
  summary: string | null;
  scope: string | null;
}

export type WorkoutType = 'strength' | 'cardio' | 'mixed' | 'mobility' | 'sport' | 'rest';

export interface WorkoutTemplate extends SyncFields {
  program_id: string;
  program_version_id: string;
  template_key: string;
  name: string;
  weekday: number | null;
  sequence: number;
  workout_type: WorkoutType;
  target_muscles: string[];
  est_duration_min: number | null;
  warmup: string | null;
  notes: string | null;
}

export type TechniqueCode =
  | 'myo_rest_pause'
  | 'half_reps_stretch'
  | 'drop_25'
  | 'double_drop'
  | 'myo_activation'
  | 'negatives'
  | 'rir1_no_failure'
  | 'no_failure'
  | 'cheat_negative';

export interface PlannedFields {
  position: number;
  label: string | null;
  superset_group: string | null;
  exercise_id: string;
  muscle_label: string | null;
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  rir_target: number | null;
  rir_last_only: boolean;
  rpe_target: number | null;
  rest_min_s: number | null;
  rest_max_s: number | null;
  rest_mode: 'after_set' | 'after_pair';
  tempo: string | null;
  technique_code: TechniqueCode | null;
  technique_text: string | null;
  start_load_kg: number | null;
  load_note: string | null;
  duration_target_s: number | null;
  distance_target_m: number | null;
  cue: string | null;
  notes: string | null;
  is_optional: boolean;
}

export interface PlannedExercise extends SyncFields, PlannedFields {
  program_version_id: string;
  template_id: string;
  plan_key: string;
}

export type SessionStatus =
  | 'planned'
  | 'in_progress'
  | 'completed_as_planned'
  | 'completed_modified'
  | 'partial'
  | 'skipped'
  | 'cancelled'
  | 'rescheduled';

export interface WorkoutSession extends SyncFields {
  program_id: string | null;
  program_version_id: string | null;
  template_id: string | null;
  template_key: string | null;
  dedupe_key: string | null;
  name: string;
  workout_type: WorkoutType;
  scheduled_date: ISODate | null;
  session_date: ISODate;
  status: SessionStatus;
  started_at: ISOTime | null;
  finished_at: ISOTime | null;
  paused_at: ISOTime | null;
  paused_total_s: number;
  rescheduled_to: ISODate | null;
  skip_reason: string | null;
  session_rpe: number | null;
  energy: number | null;
  motivation: number | null;
  readiness: number | null;
  notes: string | null;
  change_reason: string | null;
  tags: string[];
  is_bookmarked: boolean;
  location: string | null;
  equipment_profile_id: string | null;
  repeated_from: string | null;
  corrected_after_completion: boolean;
}

export type SessionExerciseStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface SessionExercise extends SyncFields {
  session_id: string;
  position: number;
  exercise_id: string;
  planned_exercise_id: string | null;
  plan_key: string | null;
  planned: PlannedSnapshot | null;
  origin: 'planned' | 'added' | 'substituted';
  substituted_from_exercise_id: string | null;
  substitution_scope: 'session' | 'future' | null;
  status: SessionExerciseStatus;
  skip_reason: string | null;
  superset_group: string | null;
  label: string | null;
  notes: string | null;
}

/** Frozen copy of the prescription taken when the session was created (never edited afterwards). */
export type PlannedSnapshot = PlannedFields & { snapshot_exercise_id: string };

export type SetType = 'warmup' | 'working' | 'drop' | 'rest_pause' | 'myo' | 'cluster' | 'amrap' | 'backoff' | 'negative' | 'partial';
export type SetStatus = 'planned' | 'completed' | 'failed' | 'skipped';

export interface SetRecord extends SyncFields {
  session_id: string;
  session_exercise_id: string;
  exercise_id: string;
  session_date: ISODate;
  set_number: number;
  set_type: SetType;
  parent_set_id: string | null;
  status: SetStatus;
  side: 'both' | 'left' | 'right';
  planned_weight_kg: number | null;
  planned_reps_min: number | null;
  planned_reps_max: number | null;
  planned_rir: number | null;
  planned_duration_s: number | null;
  weight_kg: number | null;
  reps: number | null;
  reps_partial: number | null;
  reps_assisted: number | null;
  duration_s: number | null;
  distance_m: number | null;
  assist_kg: number | null;
  bodyweight_kg: number | null;
  rpe: number | null;
  rir: number | null;
  failure: 'none' | 'technical' | 'muscular' | null;
  tempo: string | null;
  eccentric_s: number | null;
  pause_bottom_s: number | null;
  concentric_s: number | null;
  pause_top_s: number | null;
  rom: 'full' | 'partial' | 'custom' | null;
  quality: number | null;
  rest_before_s: number | null;
  started_at: ISOTime | null;
  completed_at: ISOTime | null;
  load_estimated: boolean;
  bar_velocity: number | null;
  discomfort: string | null;
  note: string | null;
  extras: Record<string, unknown>;
}

export type GoalType =
  | 'exercise_load'
  | 'exercise_reps_at_load'
  | 'exercise_e1rm'
  | 'weekly_frequency'
  | 'weekly_sets'
  | 'weekly_volume'
  | 'adherence'
  | 'bodyweight'
  | 'measurement'
  | 'cardio'
  | 'mobility'
  | 'custom';

export interface Goal extends SyncFields {
  title: string;
  goal_type: GoalType;
  exercise_id: string | null;
  muscle: string | null;
  measurement_key: string | null;
  target_value: number;
  target_weight_kg: number | null;
  baseline_value: number | null;
  baseline_date: ISODate | null;
  target_date: ISODate | null;
  priority: number;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  completed_at: ISOTime | null;
  milestones: { value: number; label: string; reached_at: ISOTime | null }[];
  notes: string | null;
}

export interface BodyMeasurement extends SyncFields {
  measured_at: ISOTime;
  bodyweight_kg: number | null;
  waist_cm: number | null;
  chest_cm: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
  hip_cm: number | null;
  calf_cm: number | null;
  body_fat_pct: number | null;
  body_fat_method: string | null;
  muscle_mass_kg: number | null;
  conditions: string | null;
  notes: string | null;
}

export interface ReadinessRecord extends SyncFields {
  record_date: ISODate;
  sleep_hours: number | null;
  sleep_quality: number | null;
  energy: number | null;
  soreness: number | null;
  stress: number | null;
  motivation: number | null;
  perceived_recovery: number | null;
  fatigue: number | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  soreness_areas: string[];
  illness_note: string | null;
  notes: string | null;
}

export interface ProgressPhoto extends SyncFields {
  taken_at: ISOTime;
  storage_path: string | null;
  pose: string | null;
  note: string | null;
}

export interface ProgramModification extends SyncFields {
  program_id: string;
  from_version_id: string | null;
  to_version_id: string | null;
  session_id: string | null;
  scope: string;
  kind: string;
  description: string;
  payload: Record<string, unknown>;
  effective_from: ISODate | null;
}

export interface AuditEvent extends SyncFields {
  entity_type: string;
  entity_id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  occurred_at: ISOTime;
}

export interface Recommendation extends SyncFields {
  kind: string;
  dedupe_key: string;
  exercise_id: string | null;
  muscle: string | null;
  observation: string;
  evidence: Record<string, unknown>;
  suggestion: string;
  tradeoff: string | null;
  proposed_change: Record<string, unknown> | null;
  status: 'open' | 'accepted' | 'edited' | 'dismissed' | 'deferred';
  deferred_until: ISODate | null;
  resolved_at: ISOTime | null;
  response_note: string | null;
}

export interface TableMap {
  profiles: Profile;
  exercises: Exercise;
  equipment_profiles: EquipmentProfile;
  programs: Program;
  program_versions: ProgramVersion;
  workout_templates: WorkoutTemplate;
  planned_exercises: PlannedExercise;
  workout_sessions: WorkoutSession;
  session_exercises: SessionExercise;
  set_records: SetRecord;
  goals: Goal;
  body_measurements: BodyMeasurement;
  readiness_records: ReadinessRecord;
  progress_photos: ProgressPhoto;
  program_modifications: ProgramModification;
  audit_events: AuditEvent;
  recommendations: Recommendation;
}
export type TableName = keyof TableMap;

/** Parents first: the order in which tables must be pushed so foreign keys resolve. */
export const SYNC_ORDER: TableName[] = [
  'profiles',
  'exercises',
  'equipment_profiles',
  'programs',
  'program_versions',
  'workout_templates',
  'planned_exercises',
  'workout_sessions',
  'session_exercises',
  'set_records',
  'goals',
  'body_measurements',
  'readiness_records',
  'progress_photos',
  'program_modifications',
  'audit_events',
  'recommendations',
];
