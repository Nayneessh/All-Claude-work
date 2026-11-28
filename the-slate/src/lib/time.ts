/** Date helpers. All calendar logic works on plain 'YYYY-MM-DD' strings so it is timezone-safe and trivially testable. */
export const DEFAULT_TZ = 'Asia/Kolkata';
export type DateStr = string; // YYYY-MM-DD
export type TimeStr = string; // HH:MM or HH:MM:SS

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the given timezone. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): DateStr {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}
/** Minutes since midnight in the given timezone. */
export function minutesNowIn(tz: string = DEFAULT_TZ, now: Date = new Date()): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
}
/** The calendar day (in tz) an instant falls on. */
export function dayOf(iso: string | Date, tz: string = DEFAULT_TZ): DateStr {
  return todayIn(tz, typeof iso === 'string' ? new Date(iso) : iso);
}

const toUTC = (d: DateStr) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
export const fromUTC = (ms: number): DateStr => { const x = new Date(ms); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
export const addDays = (d: DateStr, n: number): DateStr => fromUTC(toUTC(d) + n * 86_400_000);
export const diffDays = (a: DateStr, b: DateStr): number => Math.round((toUTC(a) - toUTC(b)) / 86_400_000); // a - b
/** 0 = Sunday … 6 = Saturday */
export const dow = (d: DateStr): number => new Date(toUTC(d)).getUTCDay();
export const startOfWeek = (d: DateStr, weekStartsOn: 0 | 1 = 1): DateStr => addDays(d, -((dow(d) - weekStartsOn + 7) % 7));
export const startOfMonth = (d: DateStr): DateStr => `${d.slice(0, 7)}-01`;
export const endOfMonth = (d: DateStr): DateStr => { const [y, m] = d.split('-').map(Number); return fromUTC(Date.UTC(y, m, 0)); };
export const daysInRange = (from: DateStr, to: DateStr): DateStr[] => { const out: DateStr[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
export const isDateStr = (s: unknown): s is DateStr => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s));

/** 'HH:MM[:SS]' -> minutes since midnight. */
export const toMin = (t: TimeStr): number => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
/** minutes since midnight -> 'HH:MM' */
export const fromMin = (m: number): TimeStr => { const c = Math.max(0, Math.min(1439, Math.round(m))); return `${pad(Math.floor(c / 60))}:${pad(c % 60)}`; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthName = (i: number) => MONTHS[i];
export const dayName = (i: number) => DAYS[i];
export const fmtDate = (d?: DateStr | null): string => { if (!d) return '—'; const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
export const fmtDateShort = (d?: DateStr | null): string => { if (!d) return '—'; const [, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]}`; };
export const fmtTime = (t?: TimeStr | null): string => { if (!t) return ''; const m = toMin(t); const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`; };
export const fmtDuration = (min: number): string => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);
export const fmtDateTime = (iso?: string | null, tz: string = DEFAULT_TZ): string => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h12' }).format(new Date(iso));
};
export function relativeDays(d: DateStr | null | undefined, today: DateStr): string {
  if (!d) return '—';
  const n = diffDays(d, today);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
