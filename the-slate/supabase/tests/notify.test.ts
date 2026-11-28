import { describe, it, expect } from 'vitest';
import { dueTaskReminders, idleDigest, joiningAlerts } from '../functions/notify/logic';
import type { Task } from '../functions/_shared/types';

const task = (o: Partial<Task> = {}): Task => ({ id: 't1', title: 'Call HM', parent_id: null, repeat: 'once', start_date: '2026-12-01', due_time: '16:00', xp: 10, archived_at: null, notes: null, difficulty: 'moderate', est_minutes: 30,
  sched_minutes: null, category: null, reminder_time: '15:30', followup_minutes: 30, rec_days: null, rec_every_weeks: 1, end_date: null, sort_order: 0, created_at: '2026-11-01T00:00:00Z', ...o });
const at = (h: number, m = 0) => h * 60 + m;
const run = (nowMin: number, tasks: Task[], done: { task_id: string; day: string; completed_at: string; undone_at: string | null }[] = [], overrides: never[] = []) => dueTaskReminders({ today: '2026-12-01', nowMin, tasks, done, overrides });

describe('reminder engine (server side)', () => {
  it('fires the primary reminder at its time, not before', () => {
    expect(run(at(15, 29), [task()])).toHaveLength(0);
    const r = run(at(15, 30), [task()]); expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: 'task:t1:2026-12-01:primary', title: '⏰ Call HM' });
  });
  it('fires the follow-up 30 minutes later only while the task is still open', () => {
    expect(run(at(16, 0), [task()]).map((n) => n.key)).toEqual(['task:t1:2026-12-01:primary', 'task:t1:2026-12-01:followup']);
    const done = [{ task_id: 't1', day: '2026-12-01', completed_at: 'x', undone_at: null }];
    expect(run(at(16, 0), [task()], done)).toHaveLength(0); // completed: no reminders at all
    expect(run(at(16, 0), [task()], [{ ...done[0], undone_at: 'reopened' }])).toHaveLength(2); // reopened counts as open
  });
  it('skips reminders older than the grace window (a long outage does not flood you)', () => { expect(run(at(19, 1), [task()])).toHaveLength(0); });
  it('recurring tasks remind on each occurrence day with day-specific dedupe keys', () => {
    const t = task({ repeat: 'daily', start_date: '2026-11-01' });
    expect(run(at(15, 31), [t])[0].key).toBe('task:t1:2026-12-01:primary');
  });
  it('a moved occurrence moves its reminder with it', () => {
    const t = task({ repeat: 'daily', start_date: '2026-11-01' });
    const ov = [{ id: 'o', task_id: 't1', day: '2026-12-01', new_day: '2026-12-01', start_time: '18:00', sched_minutes: 60 }] as never[];
    expect(run(at(15, 31), [t], [], ov)).toHaveLength(0); expect(run(at(17, 31), [t], [], ov)).toHaveLength(1);
  });
  it('tasks without a reminder time, sub-tasks and archived tasks never notify', () => {
    expect(run(at(16, 0), [task({ reminder_time: null }), task({ id: 's', parent_id: 't1' }), task({ id: 'a', archived_at: 'x' })])).toHaveLength(0);
  });
});

describe('daily digests', () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  it('idle digest lists the most urgent idle mandates once a day', () => {
    const m = (id: string, u: string, last: string, status = 'active') => ({ id, title: id, company_name: 'ACME', urgency: u, status, last_activity_at: last, created_at: '2026-11-01T00:00:00Z' });
    const n = idleDigest({ today: '2026-12-01', threshold: 5, dayOf, rows: [m('A', 'Low', '2026-11-20T00:00:00Z'), m('B', 'Critical', '2026-11-25T00:00:00Z'), m('C', 'High', '2026-11-30T00:00:00Z'), m('D', 'High', '2026-11-01T00:00:00Z', 'closed')] })!;
    expect(n.key).toBe('digest:idle:2026-12-01'); expect(n.title).toMatch(/2 mandates/); expect(n.title).toMatch(/🔴/); expect(n.body.startsWith('B (ACME)')).toBe(true);
    expect(idleDigest({ today: '2026-12-01', threshold: 5, dayOf, rows: [m('C', 'High', '2026-11-30T00:00:00Z')] })).toBeNull();
  });
  it('joining alerts at 7, 1 and 0 days for selected/offered candidates only', () => {
    const r = (d: string, status = 'offered') => ({ assoc_id: d + status, name: 'Rahul', mandate_title: 'CFO', joining_date: d, status });
    const out = joiningAlerts({ today: '2026-12-01', alertDays: [7, 1, 0], rows: [r('2026-12-08'), r('2026-12-02'), r('2026-12-01'), r('2026-12-05'), r('2026-12-02', 'rejected')] });
    expect(out.map((n) => n.key.split(':')[2])).toEqual(['7', '1', '0']); expect(out[2].title).toMatch(/due to join today/);
  });
});
