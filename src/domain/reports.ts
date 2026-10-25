import type { ISODate } from './types';
import { addDays, daysBetween, mean } from './periods';
import { type AnalyticsCtx, type AnalyticsSet, type MuscleStats, type SessionLite, exerciseVolume, inPeriod, muscleStats, periodStats, plannedVsActual, sessionDurations, performedSets } from './analytics';
import type { PrEvent } from './records';
import { attendance, type AttendanceSummary, type OccurrenceResult } from './adherence';

export interface ReportInput {
  from: ISODate;
  to: ISODate;
  sets: AnalyticsSet[];
  ctx: AnalyticsCtx;
  results: OccurrenceResult[];
  prs: PrEvent[];
  sessions: SessionLite[];
}

export interface PeriodReport {
  from: ISODate; to: ISODate;
  sessionsPlanned: number; sessionsDone: number;
  attendance: AttendanceSummary;
  totals: ReturnType<typeof periodStats>;
  muscles: MuscleStats[];
  topExercises: ReturnType<typeof exerciseVolume>;
  prs: PrEvent[];
  skipped: number; substituted: number;
  avgDurationMin: number | null; avgSessionRpe: number | null;
  plannedVsActual: ReturnType<typeof plannedVsActual>;
  observations: string[];
}

export function buildReport(i: ReportInput, previous?: PeriodReport): PeriodReport {
  const sets = inPeriod(i.sets, i.from, i.to);
  const totals = periodStats(sets, i.ctx);
  const sessions = i.sessions.filter((s) => s.session_date >= i.from && s.session_date <= i.to);
  const results = i.results.filter((r) => r.date >= i.from && r.date <= i.to);
  const att = attendance(results);
  const durs = sessionDurations(sessions);
  const rpes = sessions.map((s) => s.session_rpe).filter((x): x is number => x !== null);
  const done = sessions.filter((s) => ['completed_as_planned', 'completed_modified', 'partial'].includes(s.status)).length;
  const skipped = sessions.filter((s) => s.status === 'skipped' || s.status === 'cancelled').length;
  const prs = i.prs.filter((p) => !p.is_baseline && p.date >= i.from && p.date <= i.to);
  const modified = sessions.filter((s) => s.status === 'completed_modified').length;
  const r: PeriodReport = {
    from: i.from, to: i.to, sessionsPlanned: att.planned, sessionsDone: done, attendance: att, totals,
    muscles: muscleStats(sets, i.ctx), topExercises: exerciseVolume(sets, i.ctx).slice(0, 5), prs, skipped, substituted: modified,
    avgDurationMin: durs.length ? Math.round(mean(durs.map((d) => d.minutes)) as number) : null,
    avgSessionRpe: rpes.length ? Math.round((mean(rpes) as number) * 10) / 10 : null,
    plannedVsActual: plannedVsActual(performedSets(sets, i.ctx), i.ctx), observations: [],
  };
  const obs = r.observations;
  if (att.rate !== null) obs.push(`Attendance ${Math.round(att.rate * 100)}% (${att.attended} of ${att.planned} planned sessions).`);
  if (prs.length) obs.push(`${prs.length} personal record${prs.length === 1 ? '' : 's'} set.`);
  if (totals.unknownVolumeSets) obs.push(`${totals.unknownVolumeSets} set(s) have no load recorded and are not in the volume total.`);
  if (previous && previous.totals.volumeKg > 0) {
    const ch = ((totals.volumeKg - previous.totals.volumeKg) / previous.totals.volumeKg) * 100;
    obs.push(`Volume ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(0)}% versus the previous period.`);
  }
  if (r.plannedVsActual.ratio !== null) obs.push(`Performed ${(r.plannedVsActual.ratio * 100).toFixed(0)}% of planned volume on comparable sets.`);
  return r;
}

export const previousPeriod = (from: ISODate, to: ISODate): { from: ISODate; to: ISODate } => {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
};
