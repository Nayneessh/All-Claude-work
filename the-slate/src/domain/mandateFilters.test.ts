import { describe, it, expect } from 'vitest';
import { applyMandateFilters, DEFAULT_FILTERS } from './mandateFilters';
import { withClocks } from './analytics';
import { mandate, TODAY } from './fixtures';

const rows = withClocks([
  mandate({ id: 'a', title: 'CFO', company_name: 'INFINX', urgency: 'Critical', last_activity_at: '2026-11-20T00:00:00Z', location: 'Mumbai', consultants: ['Michael Page'] }),
  mandate({ id: 'b', title: 'COO', company_name: 'MEPL', urgency: 'Low', location: 'Chennai', waiting_count: 2 }),
  mandate({ id: 'c', title: 'CHRO', company_name: 'MEPL', status: 'on_hold' }),
  mandate({ id: 'd', title: 'CMO', company_name: 'ISHARYA', target_close: '2026-11-20' }),
  mandate({ id: 'e', title: 'CTO', company_name: 'INFINX', status: 'closed' }),
], { today: TODAY });
const ids = (o: Partial<typeof DEFAULT_FILTERS>) => applyMandateFilters(rows, { ...DEFAULT_FILTERS, ...o }, 5).map((r) => r.m.id);

describe('mandate filters (on loaded database rows)', () => {
  it('default shows open mandates only, highest priority first', () => { expect(ids({})).toEqual(['a', 'd', 'b', 'c'].sort((x, y) => ids({}).indexOf(x) - ids({}).indexOf(y))); expect(ids({})).not.toContain('e'); expect(ids({})[0]).toBe('a'); });
  it('each view isolates its state', () => {
    expect(ids({ view: 'closed' })).toEqual(['e']); expect(ids({ view: 'on_hold' })).toEqual(['c']); expect(ids({ view: 'overdue' })).toEqual(['d']);
    expect(ids({ view: 'inactive' })).toEqual(['a']); expect(ids({ view: 'critical' })).toEqual(['a']); expect(ids({ view: 'all' })).toHaveLength(5);
  });
  it('idle and waiting-on-someone', () => { expect(ids({ view: 'idle' })).toEqual(['a']); expect(ids({ view: 'waiting' })).toEqual(['b']); });
  it('company, location, consultant, urgency and lifecycle status filters combine', () => {
    expect(ids({ company: 'MEPL', view: 'all' }).sort()).toEqual(['b', 'c']); expect(ids({ location: 'Chennai' })).toEqual(['b']);
    expect(ids({ consultant: 'Michael Page' })).toEqual(['a']); expect(ids({ urgency: 'Low' })).toEqual(['b']); expect(ids({ status: 'on_hold', view: 'all' })).toEqual(['c']);
    expect(ids({ company: 'MEPL', urgency: 'Low' })).toEqual(['b']);
  });
  it('free text searches title, company, location and consultant; every word must match', () => {
    expect(ids({ q: 'michael' })).toEqual(['a']); expect(ids({ q: 'infinx cfo' })).toEqual(['a']); expect(ids({ q: 'infinx coo' })).toEqual([]); expect(ids({ q: 'chen' })).toEqual(['b']);
  });
  it('"most idle" sorts by days without activity', () => { expect(ids({ sort: 'idle' })[0]).toBe('a'); });
});
