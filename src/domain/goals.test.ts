import { describe, expect, it } from 'vitest';
import { defaultMilestones, evaluateGoal, markMilestones } from './goals';

const goal = (over = {}) => ({ target_value: 120, baseline_value: 100, target_date: '2027-02-01', milestones: [], status: 'active' as const, ...over });

describe('goals', () => {
  it('computes progress percentage between baseline and target', () => {
    const p = evaluateGoal(goal(), [{ date: '2026-11-01', value: 100 }, { date: '2026-12-01', value: 110 }], '2026-12-02');
    expect(p.pct).toBe(50);
    expect(p.current).toBe(110);
  });
  it('works for goals that go down (bodyweight loss) and clamps to 0–100', () => {
    const down = evaluateGoal(goal({ baseline_value: 90, target_value: 80 }), [{ date: '2026-11-01', value: 90 }, { date: '2026-12-01', value: 85 }], '2026-12-02');
    expect(down.pct).toBe(50);
    expect(evaluateGoal(goal(), [{ date: '2026-12-01', value: 150 }], '2026-12-02').pct).toBe(100);
    expect(evaluateGoal(goal(), [{ date: '2026-12-01', value: 90 }], '2026-12-02').pct).toBe(0);
  });
  it('projects a date only from enough recent history and labels it an estimate', () => {
    const hist = [0, 1, 2, 3, 4].map((i) => ({ date: `2026-11-${String(1 + i * 7).padStart(2, '0')}`, value: 100 + i * 2 }));
    const p = evaluateGoal(goal({ target_value: 112 }), hist, '2026-11-29');
    expect(p.projectedDate).not.toBeNull();
    expect(p.note).toMatch(/estimate/);
    expect(evaluateGoal(goal(), [{ date: '2026-11-29', value: 105 }], '2026-11-29').projectedDate).toBeNull();
  });
  it('projects nothing when progress is flat or moving away', () => {
    const flat = [0, 1, 2, 3].map((i) => ({ date: `2026-11-${String(1 + i * 7).padStart(2, '0')}`, value: 100 }));
    expect(evaluateGoal(goal(), flat, '2026-11-29').projectedDate).toBeNull();
  });
  it('tracks milestones without ever un-reaching them', () => {
    const ms = defaultMilestones(100, 120);
    expect(ms.map((m) => m.value)).toEqual([105, 110, 115, 120]);
    const g = { target_value: 120, baseline_value: 100, milestones: ms };
    const a = markMilestones(g, 111, '2026-12-01T00:00:00.000Z');
    expect(a.filter((m) => m.reached_at).length).toBe(2);
    const b = markMilestones({ ...g, milestones: a }, 104, '2026-12-05T00:00:00.000Z');
    expect(b.filter((m) => m.reached_at).length).toBe(2); // a later dip does not erase history
  });
});
