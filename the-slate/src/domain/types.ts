import type { DateStr, TimeStr } from '../lib/time';

export type Urgency = 'Low' | 'Medium' | 'High' | 'Critical';
export const URGENCIES: Urgency[] = ['Low', 'Medium', 'High', 'Critical'];
export type MandateStatus = 'active' | 'on_hold' | 'closed' | 'cancelled';
export type WorkMode = 'WFO' | 'Hybrid' | 'Remote';
export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'WFO', label: 'Work from office' }, { value: 'Hybrid', label: 'Hybrid' }, { value: 'Remote', label: 'Remote' },
];

/** Row of v_mandate_overview */
export interface MandateRow {
  id: string; user_id: string; title: string; company_id: string | null; company_name: string | null; stakeholder: string | null; level: string | null;
  positions: number; location: string | null; work_mode: WorkMode | null; reporting_to: string | null; span: string | null; budget: string | null;
  urgency: Urgency; confidential: boolean; status: MandateStatus; received_on: DateStr | null; started_on: DateStr | null; target_close: DateStr | null;
  notes: string | null; status_note: string | null; waiting_on: string | null; waiting_since: DateStr | null;
  created_at: string; updated_at: string; closed_at: string | null; close_outcome: 'filled' | 'cancelled' | null; close_note: string | null; last_activity_at: string | null;
  candidate_total: number; candidate_live: number; selected_count: number; offered_count: number; joined_count: number; rejected_count: number; dropped_count: number;
  consultants: string[]; shared_count: number; waiting_count: number; open_steps: number; done_steps: number; overdue_steps: number;
  jd_id: string | null; jd_file_name: string | null;
}

export type CandidateStatus = 'active' | 'on_hold' | 'selected' | 'offered' | 'joined' | 'rejected' | 'dropped';
export type JoiningStatus = 'expected' | 'confirmed' | 'at_risk' | 'deferred' | 'joined';
/** Row of v_candidate_pipeline (one candidate in one mandate's pipeline) */
export interface PipelineRow {
  association_id: string; user_id: string; candidate_id: string; mandate_id: string; stage: string; status: CandidateStatus;
  offered_ctc: string | null; joining_date: DateStr | null; joining_status: JoiningStatus | null; selected_at: string | null;
  closed_reason: string | null; closed_at: string | null; rounds: unknown; added_at: string; stage_updated_at: string;
  name: string; current_company: string | null; designation: string | null; phone: string | null; email: string | null; source: string | null;
  current_ctc: string | null; expected_ctc: string | null; notice_period: string | null; current_location: string | null; open_to_relocate: boolean | null;
  mandate_title: string; mandate_company: string | null; mandate_location: string | null; mandate_level: string | null; mandate_urgency: Urgency; mandate_status: MandateStatus;
}

export interface Candidate {
  id: string; name: string; current_company: string | null; designation: string | null; phone: string | null; email: string | null; source: string | null;
  current_ctc: string | null; expected_ctc: string | null; additional_benefits: string | null; notice_period: string | null;
  current_location: string | null; open_to_relocate: boolean | null; notes: string | null; created_at: string; updated_at: string;
  assocs?: Association[];
}
export interface Association { association_id: string; mandate_id: string; mandate_title: string; mandate_company: string | null; stage: string; status: CandidateStatus; joining_date: DateStr | null }

export interface StatusHistory {
  id: string; candidate_id: string; mandate_id: string | null; from_stage: string | null; to_stage: string; from_status: string | null; to_status: string;
  reason_type: 'rejection' | 'drop' | null; reason: string | null; comment: string | null; changed_at: string;
}
export interface Activity { id: string; mandate_id: string | null; candidate_id: string | null; kind: string; meaningful: boolean; summary: string | null; detail: Record<string, unknown>; occurred_at: string }

export type ConfigKind = 'source' | 'rejection_reason' | 'drop_reason' | 'pipeline_stage' | 'hiring_level' | 'task_category';
export interface ConfigOption { id: string; kind: ConfigKind; key: string; label: string; sort_order: number; active: boolean; meta: { kind?: StageKind; funnel?: boolean } & Record<string, unknown> }
export type StageKind = 'progress' | 'hold' | 'selected' | 'offered' | 'joined' | 'rejected' | 'dropped';

export interface Agency { id: string; name: string; kind: 'agency' | 'consultant'; contact_name: string | null; email: string | null; phone: string | null; notes: string | null; active: boolean }
export interface MandateAgency { id: string; mandate_id: string; agency_id: string; shared_at: string | null }
export interface MandateDocument { id: string; mandate_id: string; kind: 'jd' | 'other'; file_name: string; path: string; size: number | null; mime: string; is_current: boolean; replaced_at: string | null; created_at: string }
export interface Comment { id: string; mandate_id: string | null; candidate_id: string | null; body: string; created_at: string }
export interface Step { id: string; scope: 'mandate' | 'candidate'; mandate_id: string; candidate_id: string | null; seq: number; phase: string | null; title: string; hint: string | null; status: 'todo' | 'waiting' | 'done' | 'skipped'; due_date: DateStr | null; follow_up_date: DateStr | null; note: string | null; completed_at: string | null }
export interface CandidateFile { id: string; candidate_id: string; mandate_id: string; kind: 'cv' | 'other'; file_name: string; path: string; size: number | null; mime: string | null; created_at: string }

// ---- The Slate
export type Difficulty = 'easy' | 'moderate' | 'focus' | 'extra_focus';
export const DIFFICULTIES: { value: Difficulty; label: string; points: number }[] = [
  { value: 'easy', label: 'Easy', points: 5 }, { value: 'moderate', label: 'Moderate', points: 10 },
  { value: 'focus', label: 'Focus', points: 20 }, { value: 'extra_focus', label: 'Extra Focus', points: 30 },
];
export type Repeat = 'once' | 'daily' | 'weekdays' | 'custom';
export interface Task {
  id: string; title: string; parent_id: string | null; repeat: Repeat; start_date: DateStr; due_time: TimeStr | null; xp: number; archived_at: string | null;
  notes: string | null; difficulty: Difficulty; est_minutes: number; sched_minutes: number | null; category: string | null;
  reminder_time: TimeStr | null; followup_minutes: number | null; rec_days: number[] | null; rec_every_weeks: number; end_date: DateStr | null; sort_order: number; created_at: string;
}
export interface TaskDone { task_id: string; day: DateStr; completed_at: string; undone_at: string | null }
export interface TaskOverride { id: string; task_id: string; day: DateStr; new_day: DateStr; start_time: TimeStr; sched_minutes: number }
export interface AppNotification { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }
export interface SopDoc { id: string; title: string; body: string; updated_at: string }

/** Stored in app_settings.data (validated with zod in lib/settings.ts) */
export interface Settings {
  timezone: string; inactivityDays: number; nearCloseDays: number; weekStartsOn: 0 | 1; defaultReminderTime: string;
  calendarStartHour: number; calendarEndHour: number; maskSensitive: boolean; density: 'comfortable' | 'compact';
  defaultFollowupMinutes: number; notifyInApp: boolean; idleLogoutMinutes: number; joiningAlertDays: number[];
}
export const DEFAULT_SETTINGS: Settings = {
  timezone: 'Asia/Kolkata', inactivityDays: 5, nearCloseDays: 7, weekStartsOn: 1, defaultReminderTime: '10:00',
  calendarStartHour: 7, calendarEndHour: 21, maskSensitive: false, density: 'comfortable', defaultFollowupMinutes: 30,
  notifyInApp: true, idleLogoutMinutes: 0, joiningAlertDays: [7, 1, 0],
};
