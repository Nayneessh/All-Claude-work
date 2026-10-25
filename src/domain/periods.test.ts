import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, eachWeekStart, isoWeekday, median, rangeFor, stdev, weekStartOf } from './periods';

describe('periods', () => {
  it('computes ISO weekdays (Mon=1 … Sun=7)', () => {
    expect(isoWeekday('2026-10-26')).toBe(1); // Monday — program start
    expect(isoWeekday('2026-10-25')).toBe(7); // Sunday
    expect(isoWeekday('2026-10-31')).toBe(6);
  });
  it('finds the week start for Monday- and Sunday-start weeks', () => {
    expect(weekStartOf('2026-10-29', 1)).toBe('2026-10-26');
    expect(weekStartOf('2026-10-26', 1)).toBe('2026-10-26');
    expect(weekStartOf('2026-10-25', 1)).toBe('2026-10-19');
    expect(weekStartOf('2026-10-29', 7)).toBe('2026-10-25');
  });
  it('is not affected by DST transitions', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('lists week starts covering a range', () => {
    expect(eachWeekStart('2026-10-28', '2026-11-10', 1)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });
  it('builds named ranges', () => {
    expect(rangeFor('7d', '2026-10-31')).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(rangeFor('4w', '2026-10-31').from).toBe('2026-10-04');
    expect(rangeFor('custom', '2026-10-31', { from: '2026-01-01', to: '2026-02-01' })).toEqual({ from: '2026-01-01', to: '2026-02-01' });
  });
  it('median/stdev handle small inputs', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(stdev([5])).toBeNull();
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});
