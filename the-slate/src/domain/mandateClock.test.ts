import { describe, it, expect } from 'vitest';
import { computeBand, computeClock, inactivityLevel } from './mandateClock';
import { mandate, TODAY } from './fixtures';

const clock = (o = {}, opts = {}) => computeClock(mandate(o), { today: TODAY, ...opts });

describe('30-day mandate clock', () => {
  it('starts on the Work Start Date: day 1 is that date, progress counts toward 30', () => {
    const c = clock({ started_on: '2026-11-28' });
    expect(c.clockStarted).toBe(true); expect(c.clockDay).toBe(1); expect(c.daysOpen).toBe(0); expect(c.clockProgress).toBe(0);
    const c2 = clock({ started_on: '2026-11-13' });
    expect(c2.daysOpen).toBe(15); expect(c2.clockDay).toBe(16); expect(c2.clockProgress).toBeCloseTo(0.5);
    expect(clock({ started_on: '2026-10-29' }).clockExpired).toBe(true);
  });
  it('does not start without a Work Start Date but still reports days open from the received date', () => {
    const c = clock({ started_on: null, received_on: '2026-11-18' });
    expect(c.clockStarted).toBe(false); expect(c.clockDay).toBeNull(); expect(c.clockProgress).toBe(0); expect(c.daysOpen).toBe(10);
  });
  it('becomes INACTIVE after 5 days without meaningful activity (not before)', () => {
    expect(clock({ last_activity_at: '2026-11-24T05:00:00Z' }).state).toBe('active'); // 4 days
    const c = clock({ last_activity_at: '2026-11-23T05:00:00Z' }); // 5 days
    expect(c.state).toBe('inactive'); expect(c.idleDays).toBe(5); expect(c.alerts[0].kind).toBe('inactive');
  });
  it('the threshold is configurable', () => {
    expect(clock({ last_activity_at: '2026-11-24T05:00:00Z' }, { inactivityDays: 3 }).state).toBe('inactive');
  });
  it('alert severity follows urgency and escalates when idle time doubles', () => {
    expect(inactivityLevel('Low', 5, 5)).toBe('info'); expect(inactivityLevel('Medium', 5, 5)).toBe('warning');
    expect(inactivityLevel('High', 5, 5)).toBe('high'); expect(inactivityLevel('Critical', 5, 5)).toBe('critical');
    expect(inactivityLevel('Low', 10, 5)).toBe('warning'); expect(inactivityLevel('Critical', 20, 5)).toBe('critical');
    expect(clock({ urgency: 'Critical', last_activity_at: '2026-11-20T05:00:00Z' }).alerts[0].level).toBe('critical');
  });
  it('distinguishes the five states with a clear precedence', () => {
    expect(clock().state).toBe('active');
    expect(clock({ status: 'closed' }).state).toBe('closed'); expect(clock({ status: 'cancelled' }).state).toBe('closed');
    expect(clock({ status: 'on_hold', last_activity_at: '2026-10-01T05:00:00Z' }).state).toBe('on_hold'); // on hold never raises inactivity
    expect(clock({ target_close: '2026-11-20' }).state).toBe('overdue');
    expect(clock({ target_close: '2026-11-20', last_activity_at: '2026-11-01T00:00:00Z' }).state).toBe('overdue'); // overdue outranks inactive
    expect(clock({ status: 'closed', target_close: '2026-01-01' }).state).toBe('closed'); // closed is never overdue
  });
  it('flags nearing target close, empty mandates and the completed 30-day clock', () => {
    expect(clock({ target_close: '2026-12-03' }).nearClose).toBe(true);
    expect(clock({ target_close: '2026-12-30' }).nearClose).toBe(false);
    expect(clock({ candidate_total: 0, started_on: '2026-11-20' }).alerts.some((a) => a.kind === 'no_candidates')).toBe(true);
    expect(clock({ started_on: '2026-10-01' }).alerts.some((a) => a.kind === 'clock_expired')).toBe(true);
  });
  it('a missing last_activity_at falls back to the creation date (never "0 days idle forever")', () => {
    expect(clock({ last_activity_at: null, created_at: '2026-11-01T05:00:00Z' }).idleDays).toBe(27);
  });
});

describe('colour band precedence', () => {
  const band = (o = {}, opts = {}) => { const m = mandate(o); return computeBand(m, computeClock(m, { today: TODAY, ...opts })); };
  it('maps each condition to its colour key', () => {
    expect(band({ urgency: 'Critical' }).primary).toBe('critical');
    expect(band({ selected_count: 1 }).primary).toBe('selected');
    expect(band({ offered_count: 1 }).primary).toBe('offered');
    expect(band({ joined_count: 1 }).primary).toBe('joined');
    expect(band({ shared_count: 1 }).primary).toBe('shared');
    expect(band().primary).toBe('none');
  });
  it('"open 30+ days with no meaningful activity" is Dark Grey (stalled) and needs BOTH conditions', () => {
    expect(band({ started_on: '2026-10-01', last_activity_at: '2026-11-01T00:00:00Z' }).primary).toBe('stalled');
    expect(band({ started_on: '2026-10-01', last_activity_at: '2026-11-27T00:00:00Z' }).primary).not.toBe('stalled'); // old but active
    expect(band({ started_on: '2026-11-20', last_activity_at: '2026-11-01T00:00:00Z' }).primary).not.toBe('stalled'); // idle but young
  });
  it('precedence: stalled > critical > joined > offered > selected > shared; lower ones stay visible as secondary stripes', () => {
    const all = band({ started_on: '2026-10-01', last_activity_at: '2026-11-01T00:00:00Z', urgency: 'Critical', joined_count: 1, offered_count: 1, selected_count: 1, shared_count: 1 });
    expect(all.primary).toBe('stalled'); expect(all.secondary).toEqual(['critical', 'joined', 'offered', 'selected', 'shared']);
    expect(band({ urgency: 'Critical', offered_count: 1, shared_count: 1 })).toEqual({ primary: 'critical', secondary: ['offered', 'shared'] });
    expect(band({ joined_count: 1, offered_count: 1 }).primary).toBe('joined');
  });
  it('closed mandates are never critical/stalled; a filled one stays gold', () => {
    expect(band({ status: 'closed', urgency: 'Critical' }).primary).toBe('closed');
    expect(band({ status: 'closed', urgency: 'Critical', joined_count: 1 }).primary).toBe('joined');
  });
});
