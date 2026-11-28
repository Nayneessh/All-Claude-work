import { describe, it, expect } from 'vitest';
import { agencyStats, agingBy, candidateStats, companyStats, criticalAttention, funnelSteps, mandateKpis, rejectDropStats, summarizeActivity, upcomingJoiners, withClocks } from './analytics';
import { slateStats } from './slateStats';
import { mandate, pipeline, task, TODAY } from './fixtures';
import type { Agency, ConfigOption } from './types';

const rows = withClocks([
  mandate({ id: 'a', title: 'A', company_name: 'INFINX', urgency: 'Critical', last_activity_at: '2026-11-20T00:00:00Z', started_on: '2026-10-01' }), // stalled + inactive
  mandate({ id: 'b', title: 'B', company_name: 'INFINX' }), // healthy
  mandate({ id: 'c', title: 'C', company_name: 'MEPL', status: 'on_hold' }),
  mandate({ id: 'd', title: 'D', company_name: 'MEPL', target_close: '2026-11-20' }), // overdue
  mandate({ id: 'e', title: 'E', company_name: 'MEPL', status: 'closed', joined_count: 1 }),
  mandate({ id: 'f', title: 'F', company_name: 'ISHARYA', candidate_total: 0, started_on: '2026-11-20', target_close: '2026-12-02' }), // no candidates + near close
], { today: TODAY });

describe('mandate dashboard maths', () => {
  it('states are mutually exclusive and add up to the total', () => {
    const k = mandateKpis(rows);
    expect(k).toMatchObject({ total: 6, active: 2, inactive: 1, onHold: 1, overdue: 1, closed: 1, critical: 1, nearClose: 1 });
    expect(k.active + k.inactive + k.onHold + k.overdue + k.closed).toBe(k.total);
  });
  it('critical attention ranks overdue/idle/no-candidate mandates and skips healthy and closed ones', () => {
    const a = criticalAttention(rows, { inactivityDays: 5 });
    expect(a.map((x) => x.mc.m.id)).toEqual(expect.arrayContaining(['a', 'd', 'f']));
    expect(a.map((x) => x.mc.m.id)).not.toContain('b'); expect(a.map((x) => x.mc.m.id)).not.toContain('e');
    expect(a.find((x) => x.mc.m.id === 'f')!.reasons.join()).toMatch(/No candidates/);
    expect(a[0].score).toBeGreaterThanOrEqual(a[a.length - 1].score);
  });
  it('company analytics', () => {
    const c = companyStats(rows);
    expect(c.find((x) => x.company === 'MEPL')).toMatchObject({ mandates: 3, open: 2, closed: 1, joined: 1 });
  });
  it('aging buckets open mandates only', () => {
    const a = agingBy(rows, 'company');
    expect(a.find((x) => x.label === 'INFINX')).toMatchObject({ count: 2, maxDays: 58 });
    expect(a.reduce((s, x) => s + x.count, 0)).toBe(5);
  });
  it('agency analytics attribute candidates only where recorded', () => {
    const agencies: Agency[] = [{ id: 'g1', name: 'Michael Page', kind: 'agency', contact_name: null, email: null, phone: null, notes: null, active: true }, { id: 'g2', name: 'Elite Butlers', kind: 'agency', contact_name: null, email: null, phone: null, notes: null, active: true }];
    const links = [{ id: 'l1', mandate_id: 'a', agency_id: 'g1', shared_at: 'x' }, { id: 'l2', mandate_id: 'b', agency_id: 'g1', shared_at: 'x' }, { id: 'l3', mandate_id: 'b', agency_id: 'g2', shared_at: 'x' }];
    const p = [pipeline({ mandate_id: 'a', source: 'Agency', status: 'joined' }), pipeline({ mandate_id: 'b', source: 'Agency' }), pipeline({ mandate_id: 'b', source: 'Elite Butlers', status: 'offered' }), pipeline({ mandate_id: 'a', source: 'LinkedIn' })];
    const { stats, unattributed } = agencyStats(rows, links, agencies, p);
    expect(stats.find((s) => s.agency === 'Michael Page')).toMatchObject({ assigned: 2, active: 2, submitted: 1, joined: 1 });
    expect(stats.find((s) => s.agency === 'Elite Butlers')).toMatchObject({ assigned: 1, submitted: 1, offered: 1 });
    expect(unattributed).toBe(1); // "Agency" on a mandate with two agencies cannot be attributed
  });
});

describe('candidate analytics', () => {
  const stages: ConfigOption[] = ['sourced', 'r1', 'offered', 'joined'].map((k, i) => ({ id: k, kind: 'pipeline_stage', key: k, label: k, sort_order: i, active: true, meta: {} }));
  const p = [pipeline({ stage: 'r1' }), pipeline({ candidate_id: 'c2', stage: 'offered', status: 'offered', source: 'Naukri' }), pipeline({ candidate_id: 'c1', mandate_id: 'm2', stage: 'rejected', status: 'rejected', closed_reason: 'Client rejection', mandate_title: 'COO' }),
    pipeline({ candidate_id: 'c3', stage: 'dropped', status: 'dropped', closed_reason: 'Candidate withdrew' })];
  it('stage, status, source and distinct people counts', () => {
    const s = candidateStats(p, stages);
    expect(s.associations).toBe(4); expect(s.people).toBe(3);
    expect(s.byStage.find((x) => x.key === 'r1')!.n).toBe(1); expect(s.byStage.some((x) => x.key === 'rejected')).toBe(true); // unknown stages are still shown
    expect(s.byStatus).toMatchObject({ active: 1, offered: 1, rejected: 1, dropped: 1 });
    expect(s.bySource[0]).toMatchObject({ label: 'LinkedIn', n: 3 });
  });
  it('rejections and drops are counted separately with their own reasons', () => {
    const r = rejectDropStats(p);
    expect(r).toMatchObject({ rejected: 1, dropped: 1 });
    expect(r.rejectionReasons).toEqual([{ reason: 'Client rejection', count: 1 }]); expect(r.dropReasons).toEqual([{ reason: 'Candidate withdrew', count: 1 }]);
  });
  it('funnel percentages', () => {
    const f = funnelSteps([{ stage_key: 'sourced', label: 'S', sort_order: 1, reached: 10, current_count: 2 }, { stage_key: 'r1', label: 'R', sort_order: 2, reached: 5, current_count: 1 }, { stage_key: 'joined', label: 'J', sort_order: 3, reached: 1, current_count: 1 }]);
    expect(f.map((x) => x.pctOfFirst)).toEqual([100, 50, 10]); expect(f[1].pctOfPrev).toBe(50); expect(f[0].pctOfPrev).toBeNull();
  });
  it('upcoming joiners: next 30 days, ordered, with alert levels; past-due and already-joined handled', () => {
    const j = upcomingJoiners([
      pipeline({ name: 'Today', joining_date: '2026-11-28', status: 'offered' }), pipeline({ name: 'Soon', joining_date: '2026-12-03', status: 'selected' }),
      pipeline({ name: 'Later', joining_date: '2026-12-25', status: 'offered' }), pipeline({ name: 'TooFar', joining_date: '2027-02-01', status: 'offered' }),
      pipeline({ name: 'Late', joining_date: '2026-11-25', status: 'offered' }), pipeline({ name: 'Done', joining_date: '2026-11-10', status: 'joined' }), pipeline({ name: 'NoDate', joining_date: null, status: 'offered' }),
    ], TODAY, 30);
    expect(j.map((x) => x.row.name)).toEqual(['Late', 'Today', 'Soon', 'Later']);
    expect(j.map((x) => x.level)).toEqual(['overdue', 'today', 'soon', 'upcoming']);
  });
  it('activity timeline uses recorded events within each range', () => {
    const a = [{ day: '2026-11-27', kind: 'candidate_added', n: 2 }, { day: '2026-11-10', kind: 'comment_added', n: 3 }, { day: '2026-08-01', kind: 'candidate_added', n: 4 }, { day: '2025-10-01', kind: 'candidate_added', n: 9 }];
    expect(summarizeActivity(a, TODAY, '1w').total).toBe(2);
    expect(summarizeActivity(a, TODAY, '30d').total).toBe(5);
    expect(summarizeActivity(a, TODAY, '6m').total).toBe(9);
    expect(summarizeActivity(a, TODAY, '1y').total).toBe(9);
    expect(summarizeActivity(a, TODAY, '1y').byGroup.find((g) => g.key === 'candidates')!.n).toBe(6);
  });
});

describe('Slate dashboard maths', () => {
  const tasks = [task({ id: 'x', start_date: TODAY, due_time: '10:00', est_minutes: 30, sched_minutes: 90, difficulty: 'focus' }), task({ id: 'y', start_date: TODAY, due_time: null, difficulty: 'easy' }),
    task({ id: 'o', start_date: '2026-11-20' }), task({ id: 'r', repeat: 'daily', start_date: '2026-11-20', due_time: null, difficulty: 'extra_focus' })];
  const done = [{ task_id: 'x', day: TODAY, completed_at: 'z', undone_at: null }, { task_id: 'r', day: '2026-11-27', completed_at: 'z', undone_at: null }];
  const s = slateStats(tasks, [], done, TODAY);
  it('today, pending, completion %, overdue, focus, minutes and points', () => {
    expect(s).toMatchObject({ todayTotal: 3, todayDone: 1, todayPending: 2, completionPct: 33, overdue: 1, focusPending: 1, estMinutes: 90, scheduledMinutes: 150, pointsToday: 20 });
  });
  it('recurring-task performance over the last 14 days', () => {
    expect(s.recurring[0]).toMatchObject({ id: 'r', occurrences: 9, done: 1 });
  });
  it('weekly strip has seven days starting Monday', () => { expect(s.week).toHaveLength(7); expect(s.week[0].day).toBe('2026-11-23'); });
});
