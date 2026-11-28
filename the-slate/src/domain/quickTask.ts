import { addDays, dow, fromMin, toMin, type DateStr, type TimeStr } from '../lib/time';
import type { Repeat } from './types';
import { parseDatePhrase } from './nl/common';

export interface QuickTask { title: string; start_date: DateStr; due_time: TimeStr | null; repeat: Repeat; rec_days: number[] | null; est_minutes: number | null; reminder_time: TimeStr | null; hints: string[] }
const WD: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WD_RE = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*';

/** Turns one typed line into a task. Only what is clearly stated is applied; the rest is left for the detailed form. */
export function parseQuickTask(raw: string, today: DateStr, opts: { deadlineLeadMin?: number } = {}): QuickTask {
  let t = ' ' + raw.replace(/\s+/g, ' ').trim() + ' ';
  const hints: string[] = [];
  const cut = (re: RegExp) => { const m = t.match(re); if (m) t = t.replace(m[0], ' '); return m; };
  let repeat: Repeat = 'once'; let rec: number[] | null = null; let date: DateStr = today;

  // recurrence
  if (cut(/\b(?:every\s*day|daily|each\s+day)\b/i)) { repeat = 'daily'; hints.push('repeats daily'); }
  else if (cut(/\b(?:every\s+)?(?:week\s*days?|weekdays?|mon(?:day)?\s*(?:to|-|–)\s*fri(?:day)?|monday\s+to\s+friday)\b/i)) { repeat = 'weekdays'; hints.push('repeats Mon–Fri'); }
  else {
    const m = cut(new RegExp(`\\bevery\\s+((?:${WD_RE}(?:\\s*(?:,|and|&)\\s*)?)+)\\b`, 'i'));
    if (m) { rec = [...new Set([...m[1].toLowerCase().matchAll(/(sun|mon|tue|wed|thu|fri|sat)/g)].map((x) => WD[x[1]]))].sort(); repeat = 'custom'; hints.push('repeats weekly'); }
    else if (cut(/\b(?:weekly|every\s+week)\b/i)) { repeat = 'custom'; rec = [dow(today)]; hints.push('repeats weekly'); }
  }
  // date
  let m: RegExpMatchArray | null;
  if (cut(/\bday after tomorrow\b/i)) date = addDays(today, 2);
  else if (cut(/\btomorrow\b/i)) date = addDays(today, 1);
  else if (cut(/\btoday\b/i)) date = today;
  else if ((m = cut(new RegExp(`\\b(?:on|next|this|by|before)\\s+${WD_RE}\\b`, 'i')))) { const d = parseDatePhrase(`${/next/i.test(m[0]) ? 'next' : 'this'} ${m[1]}`, today); if (d) date = d; }
  else if ((m = cut(/\b(?:on|by)\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}(?:\s+\d{4})?)\b/i))) { const d = parseDatePhrase(m[1], today); if (d) date = d; }
  if (repeat === 'custom' && rec && !rec.includes(dow(date))) { for (let i = 0; i < 7; i++) { const d = addDays(date, i); if (rec.includes(dow(d))) { date = d; break; } } }

  // duration
  let est: number | null = null;
  if ((m = cut(/\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i))) { const n = Number(m[1]); est = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n); est = Math.max(5, Math.min(1440, est)); hints.push(`${est} min`); }
  // time
  let time: TimeStr | null = null; let deadline = false;
  const ampm = (h: string, mi: string | undefined, ap: string) => { let hh = Number(h) % 12; if (/p/i.test(ap)) hh += 12; return fromMin(hh * 60 + Number(mi ?? 0)); };
  if ((m = cut(/\b(by|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))) { time = ampm(m[2], m[3], m[4]); deadline = true; }
  else if ((m = cut(/\b(?:at|@|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)) || (m = cut(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))) { time = ampm(m[1], m[2], m[3]); }
  else if ((m = cut(/\b(by|before|at|@)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i))) { time = fromMin(Number(m[2]) * 60 + Number(m[3])); deadline = /by|before/i.test(m[1]); }
  else if ((m = cut(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) { time = fromMin(Number(m[1]) * 60 + Number(m[2])); }
  let reminder: TimeStr | null = null;
  if (time) { reminder = deadline ? fromMin(Math.max(0, toMin(time) - (opts.deadlineLeadMin ?? 30))) : time; hints.push(deadline ? `due ${time}, reminder ${reminder}` : `at ${time}`); }

  const title = t.replace(/\s+/g, ' ').replace(/\s+([.,;!?])/g, '$1').replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '').replace(/\b(?:on|at|by|for|every)$/i, '').trim();
  return { title: title || raw.trim().replace(/[.]+$/, ''), start_date: date, due_time: time, repeat, rec_days: rec, est_minutes: est, reminder_time: reminder, hints };
}
