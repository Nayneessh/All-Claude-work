/** Pure geometry for the drag/resize calendar. Minutes are minutes since midnight; day offsets are whole days. */
export const SNAP = 15;
export const MIN_BLOCK = 15;
export const snap = (m: number, step = SNAP): number => Math.round(m / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Block { startMin: number; durMin: number }

/** Move a block by a vertical delta (minutes) and a day delta, snapped, kept inside the day. */
export function moveBlock(b: Block, deltaMin: number, deltaDays: number, step = SNAP): Block & { deltaDays: number } {
  const start = clamp(snap(b.startMin + deltaMin, step), 0, 1440 - Math.min(b.durMin, 1440));
  return { startMin: Math.min(start, 1440 - b.durMin), durMin: b.durMin, deltaDays };
}
/** Drag the bottom edge: changes the duration only. The start never moves. */
export function resizeEnd(b: Block, deltaMin: number, step = SNAP): Block {
  const end = clamp(snap(b.startMin + b.durMin + deltaMin, step), b.startMin + MIN_BLOCK, 1440);
  return { startMin: b.startMin, durMin: end - b.startMin };
}
/** Drag the top edge: the end stays where it is. */
export function resizeStart(b: Block, deltaMin: number, step = SNAP): Block {
  const end = b.startMin + b.durMin;
  const start = clamp(snap(b.startMin + deltaMin, step), 0, end - MIN_BLOCK);
  return { startMin: start, durMin: end - start };
}
export const pxToMin = (px: number, pxPerHour: number): number => (px / pxPerHour) * 60;

export interface Laid<T> { item: T; col: number; cols: number }
/** Side-by-side layout for overlapping blocks (like Google Calendar): each cluster shares the width of its widest overlap. */
export function layoutOverlaps<T extends { startMin: number; endMin: number }>(items: T[]): Laid<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Laid<T>[] = [];
  let cluster: Laid<T>[] = [];
  let clusterEnd = -1;
  const flush = () => { const cols = Math.max(1, ...cluster.map((c) => c.col + 1)); for (const c of cluster) c.cols = cols; out.push(...cluster); cluster = []; };
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.item.endMin > it.startMin).map((c) => c.col));
    let col = 0; while (used.has(col)) col++;
    cluster.push({ item: it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}
export const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }): boolean => a.startMin < b.endMin && b.startMin < a.endMin;
