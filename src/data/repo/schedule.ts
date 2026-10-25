import type { ISODate, WorkoutSession, WorkoutTemplate } from '@/domain/types';
import { addDays } from '@/domain/periods';
import { occurrences } from '@/domain/versioning';
import { activePrograms, type ProgramBundle } from './programs';
import { schedKey, sessionByDedupe } from './sessions';

export interface Upcoming { date: ISODate; bundle: ProgramBundle; template: WorkoutTemplate }

export async function upcomingWorkouts(from: ISODate, count: number, horizonDays = 21): Promise<Upcoming[]> {
  const out: Upcoming[] = [];
  for (const bundle of await activePrograms()) {
    for (const o of occurrences(bundle.program, bundle.versions, bundle.templates, from, addDays(from, horizonDays))) out.push({ date: o.date, bundle, template: o.template });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.template.sequence - b.template.sequence)).slice(0, count);
}

export interface WeekDay { date: ISODate; items: { template: WorkoutTemplate; bundle: ProgramBundle; session: WorkoutSession | null }[] }

export async function weekOverview(weekStart: ISODate): Promise<WeekDay[]> {
  const bundles = await activePrograms();
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const items: WeekDay['items'] = [];
    for (const bundle of bundles) {
      for (const o of occurrences(bundle.program, bundle.versions, bundle.templates, date, date)) {
        items.push({ template: o.template, bundle, session: (await sessionByDedupe(schedKey(o.template.template_key, date))) ?? null });
      }
    }
    days.push({ date, items });
  }
  return days;
}
