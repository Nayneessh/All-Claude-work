import { describe, expect, it } from 'vitest';
import { nextDays, parseTime } from './reminders';

describe('reminder helpers', () => {
  it('places "not logged" prompts on the next scheduled training days only (Mon-Sat routine, Sunday rest)', () => {
    const days = nextDays('2026-10-26', new Set([1, 2, 3, 4, 5, 6]), false); // Monday
    expect(days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(days.every((d) => !d.done)).toBe(true);
  });
  it('marks today as done once the workout is finished so its prompt is cancelled', () => {
    const days = nextDays('2026-10-26', new Set([1, 2]), true);
    expect(days[0]).toEqual({ date: '2026-10-26', done: true });
    expect(days[1]).toEqual({ date: '2026-10-27', done: false });
  });
  it('wraps across the week and skips rest days', () => {
    expect(nextDays('2026-11-01', new Set([1]), false).map((d) => d.date)).toEqual(['2026-11-02']); // Sunday → next Monday
  });
  it('parses and clamps HH:MM', () => {
    expect(parseTime('17:30')).toEqual({ hour: 17, minute: 30 });
    expect(parseTime('99:99')).toEqual({ hour: 23, minute: 59 });
  });
});
