import type { ISODate, ReadinessRecord } from './types';
import { addDays, mean, weekStartOf } from './periods';
import { type AnalyticsCtx, type AnalyticsSet, exerciseVolume, inPeriod, muscleStats, periodStats } from './analytics';
import { assessProgress, type SessionPerf } from './progression';
import { attendance, type OccurrenceResult } from './adherence';
import { GROUP_LABELS, type MuscleGroup } from './muscles';
import { readinessScore } from './readiness';

/**
 * Dip detection (blueprint §11). Every flag explains WHAT changed, since WHEN, by HOW MUCH, versus WHICH
 * comparison period, which exercises/muscles contributed, how persistent it is, relevant notes and
 * POSSIBLE explanations — always labelled as hypotheses. Planned deloads never raise a flag.
 */
export type DipKind = 'volume_drop' | 'missed_sessions' | 'frequency_change' | 'fewer_reps_same_load' | 'e1rm_decline' | 'undertrained_muscle' | 'effort_rising';

export interface DipFlag {
  id: string;
  kind: DipKind;
  severity: 'info' | 'watch';
  title: string;
  summary: string;
  startDate: ISODate;
  magnitudePct: number | null;
  comparison: { label: string; current: number | null; baseline: number | null; unit: string };
  contributors: { label: string; deltaPct: number | null; id?: string }[];
  persistence: number;
  notes: string[];
  hypotheses: string[];
  drill: { type: 'week' | 'exercise' | 'muscle'; id: string };
}

export interface DipInput {
  today: ISODate;
  sets: AnalyticsSet[];
  ctx: AnalyticsCtx;
  attendance: OccurrenceResult[];
  perfsByExercise: Map<string, SessionPerf[]>;
  readiness: ReadinessRecord[];
  sessionNotes: { date: ISODate; notes: string }[];
}

export const DIP_THRESHOLDS = {
  volumeDropPct: 20,
  baselineWeeks: 4,
  minBaselineWeeks: 3,
  attendanceFloor: 0.7,
  frequencyChangePct: 30,
  repsDrop: 2,
  effortRirDrop: 1,
  undertrainedFraction: 0.5,
  undertrainedMinBaselineSets: 4,
};

const pct = (cur: number, base: number): number => ((cur - base) / base) * 100;

export function detectDips(input: DipInput): DipFlag[] {
  const { today, sets, ctx } = input;
  const flags: DipFlag[] = [];
  const ws = ctx.opts.weekStart;
  const lastWeek = addDays(weekStartOf(today, ws), -7);
  const lastWeekEnd = addDays(lastWeek, 6);
  const baseWeeks = Array.from({ length: DIP_THRESHOLDS.baselineWeeks }, (_, i) => addDays(lastWeek, -7 * (i + 1)));
  const weekSets = (w: ISODate): AnalyticsSet[] => inPeriod(sets, w, addDays(w, 6));
  const baseStats = baseWeeks.map((w) => ({ w, st: periodStats(weekSets(w), ctx) })).filter((b) => b.st.trained);
  const last = periodStats(weekSets(lastWeek), ctx);
  const isDeloadWeek = ((): boolean => {
    const ids = new Set(weekSets(lastWeek).map((s) => s.session_id));
    const tagged = [...ids].filter((id) => ctx.sessions.get(id)?.tags.includes('deload')).length;
    return ids.size > 0 && tagged / ids.size >= 0.5;
  })();
  const readinessIn = (from: ISODate, to: ISODate): number | null =>
    mean(input.readiness.filter((r) => r.record_date >= from && r.record_date <= to).map(readinessScore).filter((x): x is number => x !== null));
  const notesIn = (from: ISODate, to: ISODate): string[] => input.sessionNotes.filter((n) => n.date >= from && n.date <= to && n.notes.trim()).map((n) => `${n.date}: ${n.notes.trim()}`).slice(0, 4);

  // 1 + 3: volume drop and frequency change versus the trailing baseline
  if (baseStats.length >= DIP_THRESHOLDS.minBaselineWeeks && !isDeloadWeek) {
    const baseVol = mean(baseStats.map((b) => b.st.volumeKg)) as number;
    const baseSessions = mean(baseStats.map((b) => b.st.sessions)) as number;
    if (baseVol > 0) {
      const change = pct(last.volumeKg, baseVol);
      if (change <= -DIP_THRESHOLDS.volumeDropPct) {
        // contributors: biggest per-exercise volume drops
        const cur = new Map(exerciseVolume(weekSets(lastWeek), ctx).map((r) => [r.exercise_id, r]));
        const baseAll = baseStats.flatMap((b) => weekSets(b.w));
        const base = exerciseVolume(baseAll, ctx);
        const contributors = base
          .map((r) => {
            const avg = r.volumeKg / baseStats.length;
            const now = cur.get(r.exercise_id)?.volumeKg ?? 0;
            return { label: r.name, id: r.exercise_id, deltaKg: now - avg, deltaPct: avg > 0 ? pct(now, avg) : null };
          })
          .filter((c) => c.deltaKg < 0)
          .sort((a, b) => a.deltaKg - b.deltaKg)
          .slice(0, 3)
          .map(({ label, id, deltaPct }) => ({ label, id, deltaPct }));
        let persistence = 1;
        for (let i = 0; i < 3; i++) {
          const w = baseWeeks[i]!;
          const st = periodStats(weekSets(w), ctx);
          if (st.trained && baseVol > 0 && pct(st.volumeKg, baseVol) <= -15) persistence += 1; else break;
        }
        const hypotheses: string[] = [];
        if (last.sessions < baseSessions) hypotheses.push(`Fewer sessions were completed (${last.sessions} vs ~${baseSessions.toFixed(1)} per week).`);
        const skipped = input.attendance.filter((r) => r.date >= lastWeek && r.date <= lastWeekEnd && (r.outcome === 'skipped' || r.outcome === 'missed')).length;
        if (skipped) hypotheses.push(`${skipped} planned session${skipped === 1 ? ' was' : 's were'} skipped or missed.`);
        const rNow = readinessIn(lastWeek, lastWeekEnd);
        const rBase = readinessIn(addDays(lastWeek, -28), addDays(lastWeek, -1));
        if (rNow !== null && rBase !== null && rNow < rBase - 8) hypotheses.push('Self-reported readiness was lower than usual.');
        if (last.unknownVolumeSets > 0) hypotheses.push(`${last.unknownVolumeSets} set(s) have no load recorded, which lowers the computed total.`);
        flags.push({
          id: `volume_drop:${lastWeek}`, kind: 'volume_drop', severity: persistence >= 2 ? 'watch' : 'info',
          title: 'Weekly volume dropped',
          summary: `Volume in the week of ${lastWeek} was ${Math.abs(change).toFixed(0)}% below your ${baseStats.length}-week average.`,
          startDate: lastWeek, magnitudePct: change,
          comparison: { label: `${baseStats.length}-week average`, current: last.volumeKg, baseline: baseVol, unit: 'kg' },
          contributors, persistence, notes: notesIn(lastWeek, lastWeekEnd),
          hypotheses: hypotheses.length ? hypotheses : ['No obvious cause in the logged data.'],
          drill: { type: 'week', id: lastWeek },
        });
      }
    }
    if (baseSessions >= 2) {
      const fc = pct(last.sessions, baseSessions);
      if (Math.abs(fc) >= DIP_THRESHOLDS.frequencyChangePct && Math.abs(last.sessions - baseSessions) >= 1) {
        flags.push({
          id: `frequency:${lastWeek}`, kind: 'frequency_change', severity: 'info',
          title: fc < 0 ? 'Training frequency fell' : 'Training frequency rose',
          summary: `${last.sessions} session${last.sessions === 1 ? '' : 's'} in the week of ${lastWeek} versus ~${baseSessions.toFixed(1)} per week before.`,
          startDate: lastWeek, magnitudePct: fc,
          comparison: { label: `${baseStats.length}-week average`, current: last.sessions, baseline: baseSessions, unit: 'sessions' },
          contributors: [], persistence: 1, notes: notesIn(lastWeek, lastWeekEnd), hypotheses: [], drill: { type: 'week', id: lastWeek },
        });
      }
    }
  }

  // 2: missed sessions (last 14 days)
  const recent = input.attendance.filter((r) => r.date >= addDays(today, -13) && r.date <= today);
  const att = attendance(recent);
  if (att.planned >= 3 && att.rate !== null && att.rate < DIP_THRESHOLDS.attendanceFloor) {
    flags.push({
      id: `missed:${weekStartOf(today, ws)}`, kind: 'missed_sessions', severity: 'watch',
      title: 'Missed sessions',
      summary: `${att.attended} of ${att.planned} planned sessions done in the last 14 days (${Math.round(att.rate * 100)}%).`,
      startDate: addDays(today, -13), magnitudePct: (att.rate - 1) * 100,
      comparison: { label: 'planned sessions', current: att.attended, baseline: att.planned, unit: 'sessions' },
      contributors: [], persistence: 1, notes: [], hypotheses: ['Skips may reflect schedule or recovery needs — see the notes on those sessions.'], drill: { type: 'week', id: addDays(weekStartOf(today, ws), -7) },
    });
  }

  // 4, 5, 7: per-exercise signals
  for (const [exId, perfs] of input.perfsByExercise) {
    const name = ctx.exercises.get(exId)?.name ?? 'Exercise';
    const comp = perfs.filter((p) => p.comparable);
    // fewer reps at the same load (latest vs previous session)
    if (comp.length >= 2) {
      const [prev, cur] = [comp.at(-2)!, comp.at(-1)!];
      const bestAt = (sid: string): Map<number, number> => {
        const m = new Map<number, number>();
        for (const s of sets) {
          if (s.session_id !== sid || s.status !== 'completed' || s.set_type === 'warmup' || s.parent_set_id || s.weight_kg === null || s.reps === null) continue;
          const b = Math.round(s.weight_kg * 2) / 2;
          m.set(b, Math.max(m.get(b) ?? 0, s.reps));
        }
        return m;
      };
      const a = bestAt(prev.session_id);
      const b = bestAt(cur.session_id);
      const common = [...b.keys()].filter((k) => a.has(k)).sort((x, y) => y - x)[0];
      if (common !== undefined && (a.get(common) as number) - (b.get(common) as number) >= DIP_THRESHOLDS.repsDrop) {
        flags.push({
          id: `reps:${exId}:${cur.date}`, kind: 'fewer_reps_same_load', severity: 'info',
          title: `${name}: fewer reps at the same weight`,
          summary: `${b.get(common)} reps at ${common} kg on ${cur.date} versus ${a.get(common)} on ${prev.date}.`,
          startDate: cur.date, magnitudePct: pct(b.get(common) as number, a.get(common) as number),
          comparison: { label: `previous session (${prev.date})`, current: b.get(common) as number, baseline: a.get(common) as number, unit: 'reps' },
          contributors: [], persistence: 1, notes: [], hypotheses: ['One session is not a trend — check sleep, fatigue and rest times before reading into it.'], drill: { type: 'exercise', id: exId },
        });
      }
    }
    const assess = assessProgress(perfs, today, undefined, { lowReadinessShare: lowShare(input.readiness, addDays(today, -21), today) });
    if (assess.signal === 'regressing' || assess.signal === 'possible_fatigue') {
      flags.push({
        id: `e1rm:${exId}:${today.slice(0, 7)}`, kind: 'e1rm_decline', severity: 'watch',
        title: `${name}: performance trending down`, summary: assess.reasons[0] ?? 'Performance is lower across recent comparable sessions.',
        startDate: perfs.filter((p) => p.comparable).at(-3)?.date ?? today, magnitudePct: assess.changePct,
        comparison: { label: 'previous 3 sessions', current: assess.latestScore, baseline: assess.bestScore, unit: 'kg e1RM' },
        contributors: [], persistence: 3, notes: [], hypotheses: assess.reasons.slice(1), drill: { type: 'exercise', id: exId },
      });
    }
    if (comp.length >= 6) {
      const l3 = comp.slice(-3), p3 = comp.slice(-6, -3);
      const rl = mean(l3.map((p) => p.avgRir).filter((x): x is number => x !== null));
      const rp = mean(p3.map((p) => p.avgRir).filter((x): x is number => x !== null));
      const sl = mean(l3.map((p) => p.score as number)) as number, sp = mean(p3.map((p) => p.score as number)) as number;
      if (rl !== null && rp !== null && rp - rl >= DIP_THRESHOLDS.effortRirDrop && Math.abs(pct(sl, sp)) <= 2) {
        flags.push({
          id: `effort:${exId}:${today.slice(0, 7)}`, kind: 'effort_rising', severity: 'info',
          title: `${name}: same output, higher effort`, summary: `Reps in reserve fell from ${rp.toFixed(1)} to ${rl.toFixed(1)} while performance was unchanged.`,
          startDate: l3[0]!.date, magnitudePct: null, comparison: { label: 'previous 3 sessions', current: rl, baseline: rp, unit: 'RIR' },
          contributors: [], persistence: 3, notes: [], hypotheses: ['Rising effort for unchanged output can reflect accumulated fatigue — a hypothesis, not a diagnosis.'], drill: { type: 'exercise', id: exId },
        });
      }
    }
  }

  // 6: undertrained muscle groups
  if (baseStats.length >= DIP_THRESHOLDS.minBaselineWeeks) {
    const baseMuscle = new Map<MuscleGroup, number>();
    for (const b of baseStats) for (const m of muscleStats(weekSets(b.w), ctx, 'direct')) baseMuscle.set(m.group, (baseMuscle.get(m.group) ?? 0) + m.sets / baseStats.length);
    const lastMuscle = new Map(muscleStats(weekSets(lastWeek), ctx, 'direct').map((m) => [m.group, m.sets]));
    if (!isDeloadWeek) {
      for (const [g, avg] of baseMuscle) {
        const cur = lastMuscle.get(g) ?? 0;
        if (avg >= DIP_THRESHOLDS.undertrainedMinBaselineSets && cur < avg * DIP_THRESHOLDS.undertrainedFraction) {
          flags.push({
            id: `muscle:${g}:${lastWeek}`, kind: 'undertrained_muscle', severity: 'info',
            title: `${GROUP_LABELS[g]} volume was low`, summary: `${cur} direct sets in the week of ${lastWeek} versus ~${avg.toFixed(1)} per week before.`,
            startDate: lastWeek, magnitudePct: pct(cur, avg), comparison: { label: `${baseStats.length}-week average`, current: cur, baseline: avg, unit: 'sets' },
            contributors: [], persistence: 1, notes: [], hypotheses: [], drill: { type: 'muscle', id: g },
          });
        }
      }
    }
  }
  return flags;
}

function lowShare(records: ReadinessRecord[], from: ISODate, to: ISODate): number {
  const rs = records.filter((r) => r.record_date >= from && r.record_date <= to).map(readinessScore).filter((x): x is number => x !== null);
  return rs.length ? rs.filter((x) => x < 50).length / rs.length : 0;
}
