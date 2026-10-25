import type { ISODate } from './types';

/**
 * Calendar-date helpers. Dates are 'YYYY-MM-DD' strings and all arithmetic runs in UTC, so DST
 * transitions can never shift a workout onto the wrong day. Weekdays: 1 = Monday … 7 = Sunday.
 */
const MS_DAY = 86_400_000;

export function parseDate(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

export function formatDate(ms: number): ISODate {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** The user's current local calendar date. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function localDateOf(iso: string): ISODate {
  return todayISO(new Date(iso));
}

export const addDays = (d: ISODate, n: number): ISODate => formatDate(parseDate(d) + n * MS_DAY);
export const daysBetween = (a: ISODate, b: ISODate): number => Math.round((parseDate(b) - parseDate(a)) / MS_DAY);

export function isoWeekday(d: ISODate): number {
  const w = new Date(parseDate(d)).getUTCDay(); // 0 = Sunday
  return w === 0 ? 7 : w;
}

/** First day of the week containing `d`, for a week that starts on `weekStart` (1 = Mon … 7 = Sun). */
export function weekStartOf(d: ISODate, weekStart = 1): ISODate {
  const back = (isoWeekday(d) - weekStart + 7) % 7;
  return addDays(d, -back);
}

export const weekEndOf = (d: ISODate, weekStart = 1): ISODate => addDays(weekStartOf(d, weekStart), 6);
export const monthKey = (d: ISODate): string => d.slice(0, 7);
export const inRange = (d: ISODate, from: ISODate, to: ISODate): boolean => d >= from && d <= to;

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function eachWeekStart(from: ISODate, to: ISODate, weekStart = 1): ISODate[] {
  const out: ISODate[] = [];
  for (let d = weekStartOf(from, weekStart); d <= to; d = addDays(d, 7)) out.push(d);
  return out;
}

export type RangeKey = '7d' | '4w' | '8w' | '12w' | '6m' | '1y' | 'all' | 'custom';

export function rangeFor(key: RangeKey, today: ISODate, custom?: { from: ISODate; to: ISODate }, earliest?: ISODate): { from: ISODate; to: ISODate } {
  switch (key) {
    case '7d': return { from: addDays(today, -6), to: today };
    case '4w': return { from: addDays(today, -27), to: today };
    case '8w': return { from: addDays(today, -55), to: today };
    case '12w': return { from: addDays(today, -83), to: today };
    case '6m': return { from: addDays(today, -182), to: today };
    case '1y': return { from: addDays(today, -364), to: today };
    case 'custom': return custom ?? { from: addDays(today, -27), to: today };
    case 'all': return { from: earliest ?? addDays(today, -364), to: today };
  }
}

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function stdev(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
