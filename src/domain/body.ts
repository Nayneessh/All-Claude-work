import type { BodyMeasurement, ISODate } from './types';
import { daysBetween, localDateOf, mean } from './periods';

export type BodyKey = 'bodyweight_kg' | 'waist_cm' | 'chest_cm' | 'arm_cm' | 'thigh_cm' | 'hip_cm' | 'calf_cm' | 'body_fat_pct' | 'muscle_mass_kg';
export const BODY_LABELS: Record<BodyKey, string> = {
  bodyweight_kg: 'Bodyweight', waist_cm: 'Waist', chest_cm: 'Chest', arm_cm: 'Arm', thigh_cm: 'Thigh', hip_cm: 'Hip', calf_cm: 'Calf',
  body_fat_pct: 'Body fat (estimate)', muscle_mass_kg: 'Muscle mass (estimate)',
};

export interface Point { date: ISODate; value: number }

export function seriesOf(rows: BodyMeasurement[], key: BodyKey): Point[] {
  return rows
    .filter((r) => !r.deleted_at && r[key] !== null)
    .map((r) => ({ date: localDateOf(r.measured_at), value: r[key] as number }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function rollingAverage(points: Point[], windowDays = 7): Point[] {
  return points.map((p) => {
    const win = points.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < windowDays);
    return { date: p.date, value: mean(win.map((w) => w.value)) as number };
  });
}

/** Least-squares slope in units per week over the last `days` days (needs ≥ 3 points). */
export function weeklyRate(points: Point[], today: ISODate, days = 28): number | null {
  const pts = points.filter((p) => daysBetween(p.date, today) <= days && p.date <= today);
  if (pts.length < 3) return null;
  const x = pts.map((p) => daysBetween(pts[0]!.date, p.date) / 7);
  const mx = mean(x) as number, my = mean(pts.map((p) => p.value)) as number;
  const den = x.reduce((a, v) => a + (v - mx) ** 2, 0);
  if (den === 0) return null;
  return x.reduce((a, v, i) => a + (v - mx) * (pts[i]!.value - my), 0) / den;
}

/** Most recent bodyweight on or before `date`, else the supplied fallback (profile baseline). Never 0. */
export function bodyweightOn(rows: BodyMeasurement[], date: ISODate, fallbackKg: number | null = null): number | null {
  const s = seriesOf(rows, 'bodyweight_kg').filter((p) => p.date <= date);
  return s.length ? s[s.length - 1]!.value : fallbackKg;
}
