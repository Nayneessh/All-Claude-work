import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, classifyCompletion, sessionTimes } from './sessionState';

describe('session state machine', () => {
  it('allows the documented transitions and rejects the rest', () => {
    expect(canTransition('planned', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed_as_planned')).toBe(true);
    expect(canTransition('completed_as_planned', 'in_progress')).toBe(true); // reopen to correct
    expect(canTransition('skipped', 'planned')).toBe(true);
    expect(canTransition('in_progress', 'skipped')).toBe(true); // started, nothing logged
    expect(canTransition('planned', 'completed_as_planned')).toBe(false);
    expect(canTransition('skipped', 'completed_as_planned')).toBe(false);
    expect(() => assertTransition('cancelled', 'in_progress')).toThrow(/Invalid session transition/);
    expect(() => assertTransition('planned', 'skipped')).not.toThrow();
  });
});

describe('completion classification', () => {
  const slot = (plannedSets: number, done: number, over = {}) => ({ plannedSets, completedWorkingSets: done, skipped: false, origin: 'planned' as const, ...over });
  it('completed as planned when everything was done unchanged', () => {
    const c = classifyCompletion([slot(3, 3), slot(4, 4)]);
    expect(c).toEqual({ status: 'completed_as_planned', completionPct: 1, modifications: [] });
  });
  it('partial when planned work was left incomplete — the session is kept', () => {
    const c = classifyCompletion([slot(3, 3), slot(4, 1)]);
    expect(c.status).toBe('partial');
    expect(c.completionPct).toBeCloseTo(4 / 7, 5);
  });
  it('completed with modifications for substitutions, additions and extra sets', () => {
    expect(classifyCompletion([slot(3, 3, { origin: 'substituted' }), slot(3, 3)]).status).toBe('completed_modified');
    expect(classifyCompletion([slot(3, 3), slot(0, 4, { origin: 'added' })]).modifications).toContain('1 added');
    expect(classifyCompletion([slot(3, 4)]).modifications).toContain('extra sets');
  });
  it('a substituted exercise still counts towards completion of its planned slot', () => {
    expect(classifyCompletion([slot(3, 3, { origin: 'substituted' })]).completionPct).toBe(1);
  });
  it('a skipped exercise makes the session partial and is listed', () => {
    const c = classifyCompletion([slot(3, 3), slot(3, 0, { skipped: true })]);
    expect(c.status).toBe('partial');
    expect(c.modifications).toContain('1 skipped');
  });
  it('unplanned sessions have no completion percentage', () => {
    expect(classifyCompletion([slot(0, 5, { origin: 'added' })])).toMatchObject({ completionPct: null, status: 'completed_as_planned' });
  });
});

describe('session timing', () => {
  it('excludes paused time from active time', () => {
    const t = sessionTimes({ started_at: '2026-10-26T10:00:00.000Z', finished_at: '2026-10-26T11:00:00.000Z', paused_at: null, paused_total_s: 600 }, '2026-10-26T12:00:00.000Z');
    expect(t.totalMs).toBe(3_600_000);
    expect(t.pausedMs).toBe(600_000);
    expect(t.activeMs).toBe(3_000_000);
  });
  it('a currently paused session keeps accruing paused time', () => {
    const t = sessionTimes({ started_at: '2026-10-26T10:00:00.000Z', finished_at: null, paused_at: '2026-10-26T10:30:00.000Z', paused_total_s: 0 }, '2026-10-26T10:45:00.000Z');
    expect(t.pausedMs).toBe(900_000);
    expect(t.activeMs).toBe(1_800_000);
  });
  it('is zero before the session starts', () => {
    expect(sessionTimes({ started_at: null, finished_at: null, paused_at: null, paused_total_s: 0 }, '2026-10-26T10:00:00.000Z')).toEqual({ totalMs: 0, activeMs: 0, pausedMs: 0 });
  });
});
