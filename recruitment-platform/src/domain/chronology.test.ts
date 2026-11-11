import { describe, expect, it } from 'vitest';
import { analyseChronology, evaluateExperienceGate, mergeIntervals, seniorityLevel } from './chronology';

const asOf = new Date(Date.UTC(2026, 10, 11)); // 11 Nov 2026

describe('analyseChronology', () => {
  it('counts months inclusively and does not double-count overlaps', () => {
    const r = analyseChronology([
      { company: 'A', title: 'Manager', start: '2015-01', end: '2018-12' }, // 48
      { company: 'B', title: 'Head', start: '2018-07', end: '2022-12' }, // overlaps 6, adds 42
    ], asOf);
    expect(r.totalMonths).toBe(96); // 2015-01..2022-12, the 6-month overlap counted once
    expect(r.flags.join(' ')).toMatch(/overlap by 6 months/);
  });
  it("treats 'present' as the as-of month", () => {
    const r = analyseChronology([{ company: 'A', title: 'VP', start: '2019-01', end: 'present' }], asOf);
    expect(r.totalMonths).toBe(95); // 2019-01..2026-11
    expect(r.totalYears).toBe(7.9);
  });
  it('flags gaps for verification but never changes totals', () => {
    const r = analyseChronology([
      { company: 'A', title: 'Manager', start: '2010-01', end: '2014-12' },
      { company: 'B', title: 'Manager', start: '2016-06', end: '2020-12' },
    ], asOf);
    expect(r.flags.join(' ')).toMatch(/Gap of 1y 5m/);
    expect(r.flags.join(' ')).toMatch(/not penalised/);
    expect(r.totalMonths).toBe(60 + 55);
  });
  it('ignores short transitions (<=6 months) and same-employer role changes', () => {
    const r = analyseChronology([
      { company: 'Acme', title: 'Manager', start: '2010-01', end: '2014-06' },
      { company: 'Acme', title: 'Senior Manager', start: '2014-01', end: '2018-06' },
      { company: 'B', title: 'Director', start: '2018-10', end: '2022-06' },
    ], asOf);
    expect(r.flags).toEqual([]);
  });
  it('flags missing dates, reversed dates and future starts without crashing', () => {
    const r = analyseChronology([
      { company: 'A', title: 'X' },
      { company: 'B', title: 'Y', start: '2020-05', end: '2019-01' },
      { company: 'C', title: 'Z', start: '2031-01', end: 'present' },
      { company: 'D', title: 'W', start: '2020-01', end: '2021-12' },
    ], asOf);
    expect(r.flags.length).toBe(3);
    expect(r.totalMonths).toBe(24);
    expect(r.datedShare).toBe(0.25);
  });
  it('relevant experience only counts relevant roles', () => {
    const r = analyseChronology([
      { company: 'A', title: 'Procurement Manager', start: '2010-01', end: '2014-12' },
      { company: 'B', title: 'Sales Manager', start: '2015-01', end: '2018-12' },
    ], asOf, (e) => /procurement/i.test(e.title));
    expect(r.relevantYears).toBe(5);
    expect(r.totalYears).toBe(9);
  });
  it('reads progression from the title ladder', () => {
    const up = analyseChronology([
      { company: 'A', title: 'Assistant Manager', start: '2005-01', end: '2009-12' },
      { company: 'B', title: 'VP – Procurement', start: '2010-01', end: '2020-12' },
    ], asOf);
    expect(up.progression).toBe('ascending');
    const down = analyseChronology([
      { company: 'A', title: 'Director', start: '2005-01', end: '2009-12' },
      { company: 'B', title: 'Manager', start: '2010-01', end: '2020-12' },
    ], asOf);
    expect(down.progression).toBe('descending');
  });
  it('handles an empty history', () => {
    const r = analyseChronology([], asOf);
    expect(r.totalYears).toBe(0);
    expect(r.datedShare).toBe(0);
    expect(r.progression).toBe('unclear');
  });
});

describe('seniorityLevel', () => {
  it('orders titles sensibly', () => {
    const lv = (t: string) => seniorityLevel(t);
    expect(lv('Assistant Manager')).toBeLessThan(lv('Manager'));
    expect(lv('Manager')).toBeLessThan(lv('Senior Manager'));
    expect(lv('Assistant Vice President')).toBeLessThan(lv('Vice President'));
    expect(lv('Vice President')).toBeLessThan(lv('Chief Procurement Officer'));
    expect(lv('Head of Sourcing')).toBeGreaterThan(lv('Manager'));
    expect(lv('Gardener')).toBe(0);
  });
});

describe('mergeIntervals', () => {
  it('merges overlapping and keeps disjoint', () => {
    expect(mergeIntervals([{ start: 5, end: 10 }, { start: 8, end: 12 }, { start: 20, end: 25 }])).toEqual([{ start: 5, end: 12 }, { start: 20, end: 25 }]);
  });
});

describe('evaluateExperienceGate', () => {
  const full = { relevantYears: 12, totalYears: 15, datedShare: 1 };
  it('passes when met', () => expect(evaluateExperienceGate(10, full, 0.9).status).toBe('pass'));
  it('fails only when the chronology is complete and extraction trustworthy', () => {
    expect(evaluateExperienceGate(15, full, 0.9).status).toBe('fail');
    expect(evaluateExperienceGate(15, { ...full, datedShare: 0.6 }, 0.9).status).toBe('needs_verification');
    expect(evaluateExperienceGate(15, full, 0.6).status).toBe('needs_verification');
  });
  it('can gate on total instead of relevant years', () => {
    expect(evaluateExperienceGate(14, full, 0.9, 'total').status).toBe('pass');
  });
});
