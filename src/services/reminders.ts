import type { AppSettings } from '@/domain/types';
import { addDays, isoWeekday } from '@/domain/periods';
import { cancelNotifications, isNative, requestNotificationPermission, scheduleNotification } from './platform';

/**
 * Local reminders (no server involved). All are configurable, snoozable and disableable:
 *  - weekly workout reminder on chosen weekdays
 *  - "not logged yet" prompt on scheduled training days (cancelled automatically once you train)
 *  - weekly summary on Sunday evening
 */
export interface ReminderConfig { enabled: boolean; time: string; days: number[]; snooze_min: number; missed_prompt: boolean; weekly_summary: boolean }
export const DEFAULT_REMINDERS: ReminderConfig = { enabled: false, time: '17:30', days: [1, 2, 3, 4, 5, 6], snooze_min: 30, missed_prompt: true, weekly_summary: true };

const WEEKLY_IDS = [1001, 1002, 1003, 1004, 1005, 1006, 1007];
const MISSED_IDS = [2001, 2002, 2003, 2004, 2005, 2006, 2007];
const SUMMARY_ID = 3001;

export const parseTime = (t: string): { hour: number; minute: number } => { const [h, m] = t.split(':').map(Number) as [number, number]; return { hour: Math.min(23, Math.max(0, h)), minute: Math.min(59, Math.max(0, m)) }; };

export async function applyReminders(cfg: AppSettings['reminders'] | undefined, trainingDays: { date: string; done: boolean }[]): Promise<void> {
  if (!isNative()) return;
  await cancelNotifications([...WEEKLY_IDS, ...MISSED_IDS, SUMMARY_ID]);
  const c = { ...DEFAULT_REMINDERS, ...(cfg ?? {}) };
  if (!c.enabled) return;
  if (!(await requestNotificationPermission())) return;
  const { hour, minute } = parseTime(c.time);
  for (const wd of c.days) await scheduleNotification(1000 + wd, 'Training today', "Your workout is ready. Let's go.", new Date(), { weekday: wd, hour, minute });
  if (c.missed_prompt) {
    for (const [i, d] of trainingDays.filter((x) => !x.done).slice(0, 7).entries()) {
      const at = new Date(`${d.date}T20:30:00`);
      if (at.getTime() > Date.now()) await scheduleNotification(MISSED_IDS[i] ?? 2001, 'Workout not logged yet', 'Still time to train — or skip it so your history stays accurate.', at);
    }
  }
  if (c.weekly_summary) await scheduleNotification(SUMMARY_ID, 'Your week in review', 'See how this week went in Progress → Reports.', new Date(), { weekday: 7, hour: 18, minute: 0 });
}

/** Next 7 days with a scheduled workout (used to place "not logged" prompts). */
export function nextDays(today: string, scheduledWeekdays: Set<number>, doneToday: boolean): { date: string; done: boolean }[] {
  const out: { date: string; done: boolean }[] = [];
  for (let i = 0; i < 7; i++) { const d = addDays(today, i); if (scheduledWeekdays.has(isoWeekday(d))) out.push({ date: d, done: i === 0 && doneToday }); }
  return out;
}
