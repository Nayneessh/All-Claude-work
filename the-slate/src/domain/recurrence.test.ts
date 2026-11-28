import { describe, it, expect } from 'vitest';
import { expandOccurrences, occursOn, occurrencesBetween, progressFor, reminderMinutes } from './recurrence';
import { task } from './fixtures';
import type { TaskDone, TaskOverride } from './types';

describe('recurrence', () => {
  it('once / daily / weekdays', () => {
    const once = task({ repeat: 'once', start_date: '2026-12-02' });
    expect(occursOn(once, '2026-12-02')).toBe(true); expect(occursOn(once, '2026-12-03')).toBe(false);
    const daily = task({ repeat: 'daily', start_date: '2026-12-01' });
    expect(occursOn(daily, '2026-11-30')).toBe(false); expect(occursOn(daily, '2026-12-01')).toBe(true); expect(occursOn(daily, '2027-03-01')).toBe(true);
    const wk = task({ repeat: 'weekdays', start_date: '2026-11-23' }); // Monday
    expect(occurrencesBetween(wk, '2026-11-23', '2026-11-29')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  });
  it('custom: chosen weekdays, every N weeks, with an end date', () => {
    const t = task({ repeat: 'custom', start_date: '2026-11-23', rec_days: [1, 4], rec_every_weeks: 2, end_date: '2026-12-31' });
    expect(occurrencesBetween(t, '2026-11-23', '2026-12-13')).toEqual(['2026-11-23', '2026-11-26', '2026-12-07', '2026-12-10']);
    expect(occursOn(t, '2027-01-04')).toBe(false); // after end date
  });
  it('overrides move ONE occurrence and keep the series; the original estimate is kept', () => {
    const t = task({ id: 'r', repeat: 'daily', start_date: '2026-12-01', due_time: '10:00', est_minutes: 30 });
    const ov: TaskOverride[] = [{ id: 'o', task_id: 'r', day: '2026-12-05', new_day: '2026-12-06', start_time: '16:00', sched_minutes: 90 }];
    const occ = expandOccurrences([t], ov, [], '2026-12-04', '2026-12-07');
    expect(occ.filter((o) => o.day === '2026-12-05')).toHaveLength(0);
    const moved = occ.filter((o) => o.day === '2026-12-06');
    expect(moved).toHaveLength(2); // the moved one + the normal 6th
    const m = moved.find((o) => o.moved)!;
    expect(m).toMatchObject({ originDay: '2026-12-05', start: '16:00', minutes: 90, estMinutes: 30 });
  });
  it('scheduled duration (not the estimate) blocks the calendar', () => {
    const t = task({ est_minutes: 30, sched_minutes: 120, due_time: '13:00' });
    const [o] = expandOccurrences([t], [], [], '2026-11-28', '2026-11-28');
    expect(o.minutes).toBe(120); expect(o.estMinutes).toBe(30);
  });
  it('completion is per occurrence day and respects reopening', () => {
    const t = task({ id: 'd', repeat: 'daily', start_date: '2026-11-26', due_time: null });
    const done: TaskDone[] = [{ task_id: 'd', day: '2026-11-27', completed_at: 'x', undone_at: null }, { task_id: 'd', day: '2026-11-28', completed_at: 'x', undone_at: 'y' }];
    const occ = expandOccurrences([t], [], done, '2026-11-26', '2026-11-28');
    expect(occ.map((o) => o.done)).toEqual([false, true, false]);
  });
  it('sub-task progress rolls nested levels up to leaf tasks', () => {
    const parent = task({ id: 'p' }); const a = task({ id: 'a', parent_id: 'p' }); const b = task({ id: 'b', parent_id: 'p' }); const b1 = task({ id: 'b1', parent_id: 'b' }); const b2 = task({ id: 'b2', parent_id: 'b' });
    const done: TaskDone[] = ['a', 'b1'].map((id) => ({ task_id: id, day: '2026-11-28', completed_at: 'x', undone_at: null }));
    expect(progressFor([parent, a, b, b1, b2], done, 'p', '2026-11-28')).toEqual({ done: 2, total: 3, pct: 67 });
    expect(progressFor([parent], [], 'p', '2026-11-28')).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('reminders: primary + follow-up, and a moved occurrence moves its reminder', () => {
    const t = task({ due_time: '13:00', reminder_time: '12:45', followup_minutes: 30 });
    const [o] = expandOccurrences([t], [], [], '2026-11-28', '2026-11-28');
    expect(reminderMinutes(o)).toEqual({ primary: 12 * 60 + 45, followup: 13 * 60 + 15 });
    expect(reminderMinutes({ ...o, moved: true, start: '15:00' })).toEqual({ primary: 14 * 60 + 45, followup: 15 * 60 + 15 });
    expect(reminderMinutes({ ...o, task: task({ reminder_time: null }) })).toEqual({ primary: null, followup: null });
  });
});
