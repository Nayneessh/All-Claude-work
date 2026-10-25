import type { ISODate } from '@/domain/types';
import { isoWeekday, parseDate } from '@/domain/periods';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayShort = (n: number): string => WD[(n - 1 + 7) % 7] as string;
export const weekdayLong = (n: number): string => WD_LONG[(n - 1 + 7) % 7] as string;
export function fmtDate(d: ISODate, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const dt = new Date(parseDate(d));
  const base = `${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
  return `${opts.weekday === false ? '' : weekdayShort(isoWeekday(d)) + ' '}${base}${opts.year ? ` ${dt.getUTCFullYear()}` : ''}`;
}
export const fmtMonth = (key: string): string => { const [y, m] = key.split('-') as [string, string]; return `${MON[Number(m) - 1]} ${y}`; };
export const fmtClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
export const fmtMin = (min: number | null): string => (min === null ? '—' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`);
export const pct = (n: number | null, digits = 0): string => (n === null ? '—' : `${(n * 100).toFixed(digits)}%`);
export const signed = (n: number, digits = 0): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
