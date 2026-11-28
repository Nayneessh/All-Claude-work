import type { MandateRow, PipelineRow, Task } from './types';

export const TODAY = '2026-11-28';
export const mandate = (o: Partial<MandateRow> = {}): MandateRow => ({
  id: 'm1', user_id: 'u', title: 'CFO', company_id: 'c1', company_name: 'INFINX', stakeholder: null, level: 'CXO / C-suite', positions: 1, location: 'Mumbai', work_mode: 'Hybrid',
  reporting_to: 'CEO', span: null, budget: '2 cr', urgency: 'Medium', confidential: false, status: 'active', received_on: '2026-11-01', started_on: '2026-11-10', target_close: '2026-12-31',
  notes: null, status_note: null, waiting_on: null, waiting_since: null, created_at: '2026-11-01T05:00:00Z', updated_at: '2026-11-20T05:00:00Z', closed_at: null, close_outcome: null, close_note: null,
  last_activity_at: '2026-11-27T05:00:00Z', candidate_total: 3, candidate_live: 3, selected_count: 0, offered_count: 0, joined_count: 0, rejected_count: 0, dropped_count: 0,
  consultants: [], shared_count: 0, waiting_count: 0, open_steps: 5, done_steps: 2, overdue_steps: 0, jd_id: null, jd_file_name: null, ...o,
});
export const pipeline = (o: Partial<PipelineRow> = {}): PipelineRow => ({
  association_id: 'a1', user_id: 'u', candidate_id: 'c1', mandate_id: 'm1', stage: 'r1', status: 'active', offered_ctc: null, joining_date: null, joining_status: null, selected_at: null,
  closed_reason: null, closed_at: null, rounds: [], added_at: '2026-11-05T05:00:00Z', stage_updated_at: '2026-11-05T05:00:00Z', name: 'Asha Rao', current_company: 'Acme', designation: 'VP',
  phone: null, email: null, source: 'LinkedIn', current_ctc: null, expected_ctc: null, notice_period: null, current_location: 'Mumbai', open_to_relocate: null,
  mandate_title: 'CFO', mandate_company: 'INFINX', mandate_location: 'Mumbai', mandate_level: 'CXO / C-suite', mandate_urgency: 'Medium', mandate_status: 'active', ...o,
});
export const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Task', parent_id: null, repeat: 'once', start_date: '2026-11-28', due_time: '13:00', xp: 10, archived_at: null, notes: null, difficulty: 'moderate', est_minutes: 30,
  sched_minutes: null, category: null, reminder_time: null, followup_minutes: null, rec_days: null, rec_every_weeks: 1, end_date: null, sort_order: 0, created_at: '2026-11-01T00:00:00Z', ...o,
});
