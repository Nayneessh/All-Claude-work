import { describe, it, expect } from 'vitest';
import { layoutOverlaps, moveBlock, resizeEnd, resizeStart, snap } from './calendar';

describe('calendar geometry', () => {
  it('snaps to 15 minutes', () => { expect(snap(62)).toBe(60); expect(snap(68)).toBe(75); });
  it('moves a block, keeps its length, never leaves the day', () => {
    expect(moveBlock({ startMin: 600, durMin: 30 }, 62, 0)).toMatchObject({ startMin: 660, durMin: 30 });
    expect(moveBlock({ startMin: 600, durMin: 30 }, -9999, 2)).toMatchObject({ startMin: 0, deltaDays: 2 });
    expect(moveBlock({ startMin: 1400, durMin: 30 }, 500, 0).startMin).toBe(1410);
  });
  it('stretching a 30-minute 1 PM task to 3 PM blocks the full two hours', () => {
    expect(resizeEnd({ startMin: 13 * 60, durMin: 30 }, 90)).toEqual({ startMin: 780, durMin: 120 });
  });
  it('resize keeps a minimum block and the opposite edge fixed', () => {
    expect(resizeEnd({ startMin: 600, durMin: 60 }, -600).durMin).toBe(15);
    expect(resizeStart({ startMin: 600, durMin: 60 }, -30)).toEqual({ startMin: 570, durMin: 90 });
    expect(resizeStart({ startMin: 600, durMin: 60 }, 600)).toEqual({ startMin: 645, durMin: 15 });
  });
  it('lays out overlapping blocks side by side and leaves non-overlapping ones full width', () => {
    const l = layoutOverlaps([{ id: 'a', startMin: 600, endMin: 660 }, { id: 'b', startMin: 630, endMin: 700 }, { id: 'c', startMin: 640, endMin: 650 }, { id: 'd', startMin: 800, endMin: 830 }]);
    const by = Object.fromEntries(l.map((x) => [x.item.id, x]));
    expect(by.a.cols).toBe(3); expect(new Set([by.a.col, by.b.col, by.c.col]).size).toBe(3);
    expect(by.d).toMatchObject({ col: 0, cols: 1 });
  });
  it('adjacent blocks (one ends when the next starts) do not overlap', () => {
    const l = layoutOverlaps([{ startMin: 600, endMin: 630 }, { startMin: 630, endMin: 660 }]);
    expect(l.every((x) => x.cols === 1)).toBe(true);
  });
});
