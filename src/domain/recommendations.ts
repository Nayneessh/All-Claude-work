import type { ISODate, Recommendation } from './types';
import { addDays, weekStartOf } from './periods';
import { assessProgress, type SessionPerf } from './progression';
import type { DipFlag } from './dips';
import type { OccurrenceResult } from './adherence';

/**
 * Rule-based, explainable recommendations (blueprint §18). Every item has:
 *   Observation → Evidence → Suggestion → Expected trade-off → Action (accept / edit / dismiss / defer).
 * NOTHING here changes a program: `proposed_change` is only applied after the user accepts it through the
 * scoped-edit preview dialog. A single session never produces a recommendation.
 */
export type RecProposal = Pick<Recommendation, 'kind' | 'dedupe_key' | 'exercise_id' | 'muscle' | 'observation' | 'evidence' | 'suggestion' | 'tradeoff' | 'proposed_change'>;

export interface RecSetView { weight_kg: number | null; reps: number | null; rir: number | null }
export interface RecSessionView { date: ISODate; sets: RecSetView[] }
export interface RecPlanView { plan_key: string; template_key: string; sets: number; reps_min: number | null; reps_max: number | null; start_load_kg: number | null; rir_target: number | null }

export interface RecInput {
  today: ISODate;
  weekStart: number;
  /** current prescription per exercise id (first match wins) */
  planByExercise: Map<string, RecPlanView>;
  /** last sessions per exercise, oldest → newest */
  recentByExercise: Map<string, RecSessionView[]>;
  perfsByExercise: Map<string, SessionPerf[]>;
  attendance: OccurrenceResult[];
  dips: DipFlag[];
  lowReadinessShare: number;
  nameOf: (exerciseId: string) => string;
  incrementKg: (exerciseId: string) => number;
}

const topSet = (s: RecSessionView): RecSetView | null =>
  s.sets.filter((x) => x.weight_kg !== null && x.reps !== null).sort((a, b) => (b.weight_kg as number) - (a.weight_kg as number))[0] ?? null;

export function generateRecommendations(input: RecInput): RecProposal[] {
  const out: RecProposal[] = [];
  const wk = weekStartOf(input.today, input.weekStart);
  const month = input.today.slice(0, 7);

  for (const [exId, plan] of input.planByExercise) {
    const recent = (input.recentByExercise.get(exId) ?? []).slice(-2);
    const name = input.nameOf(exId);
    if (recent.length < 2 || plan.reps_max === null) continue; // one session is never enough
    const [a, b] = recent as [RecSessionView, RecSessionView];
    const hitTop = (s: RecSessionView): boolean => s.sets.length >= Math.min(plan.sets, 2) && s.sets.every((x) => x.reps !== null && x.reps >= (plan.reps_max as number));
    const missedBottom = (s: RecSessionView): boolean => {
      if (plan.reps_min === null) return false;
      const rated = s.sets.filter((x) => x.reps !== null);
      return rated.length >= 2 && rated.filter((x) => (x.reps as number) < (plan.reps_min as number)).length >= Math.ceil(rated.length / 2);
    };
    const tb = topSet(b);
    if (hitTop(a) && hitTop(b) && tb?.weight_kg != null) {
      const inc = input.incrementKg(exId);
      const newLoad = Math.round((tb.weight_kg + inc) * 100) / 100;
      out.push({
        kind: 'increase_load', dedupe_key: `increase_load:${exId}:${wk}`, exercise_id: exId, muscle: null,
        observation: `You reached the top of the rep range (${plan.reps_max}) on every set of ${name} in your last 2 sessions.`,
        evidence: { sessions: [a.date, b.date], reps_max: plan.reps_max, top_load_kg: tb.weight_kg },
        suggestion: `Increase ${name} from ${tb.weight_kg} kg to ${newLoad} kg and aim for ${plan.reps_min ?? plan.reps_max}+ reps.`,
        tradeoff: 'Heavier load usually means fewer reps at first and slightly higher effort; if form slips, return to the previous load.',
        proposed_change: { type: 'update_prescription', plan_key: plan.plan_key, template_key: plan.template_key, patch: { start_load_kg: newLoad } },
      });
    } else if (missedBottom(a) && missedBottom(b) && tb?.weight_kg != null) {
      const newLoad = Math.max(0, Math.round(tb.weight_kg * 0.925 * 4) / 4);
      out.push({
        kind: 'reduce_load', dedupe_key: `reduce_load:${exId}:${wk}`, exercise_id: exId, muscle: null,
        observation: `Half or more of your sets on ${name} fell below ${plan.reps_min} reps in each of the last 2 sessions.`,
        evidence: { sessions: [a.date, b.date], reps_min: plan.reps_min, top_load_kg: tb.weight_kg },
        suggestion: `Reduce ${name} to about ${newLoad} kg (−7.5%) so the work lands in the ${plan.reps_min}–${plan.reps_max} rep range with good technique.`,
        tradeoff: 'A lighter load lowers mechanical tension per rep but lets you complete the prescribed reps; you can add load back as reps return.',
        proposed_change: { type: 'update_prescription', plan_key: plan.plan_key, template_key: plan.template_key, patch: { start_load_kg: newLoad } },
      });
    } else {
      const ta = topSet(a);
      if (tb && ta && tb.weight_kg === ta.weight_kg && (tb.reps as number) < plan.reps_max && (tb.reps as number) >= (plan.reps_min ?? 0)) {
        out.push({
          kind: 'add_reps_first', dedupe_key: `add_reps_first:${exId}:${wk}`, exercise_id: exId, muscle: null,
          observation: `${name}: same load as last time (${tb.weight_kg} kg), reps ${ta.reps} → ${tb.reps}, still below the top of the range (${plan.reps_max}).`,
          evidence: { sessions: [a.date, b.date] },
          suggestion: 'Keep the load and add reps before adding weight.', tradeoff: 'Progress is slower per session but more sustainable and keeps technique tight.', proposed_change: null,
        });
      }
    }
  }

  for (const [exId, perfs] of input.perfsByExercise) {
    const a = assessProgress(perfs, input.today, undefined, { lowReadinessShare: input.lowReadinessShare });
    if (a.signal === 'plateau') {
      out.push({
        kind: 'plateau_review', dedupe_key: `plateau_review:${exId}:${month}`, exercise_id: exId, muscle: null,
        observation: `${input.nameOf(exId)}: ${a.reasons[0]}`, evidence: { sessions: a.sessionsConsidered, best: a.bestScore },
        suggestion: 'Review the stimulus: add a set, change the rep range, swap to a close variation, or confirm recovery (sleep, food) before changing the program.',
        tradeoff: 'Changing too much at once hides what worked; change one thing for 3–4 weeks and compare.', proposed_change: null,
      });
    }
  }

  const declining = input.dips.filter((d) => d.kind === 'e1rm_decline').length;
  if (declining >= 2 || (declining >= 1 && input.lowReadinessShare >= 0.5)) {
    out.push({
      kind: 'deload_review', dedupe_key: `deload_review:${month}`, exercise_id: null, muscle: null,
      observation: `${declining} lift${declining === 1 ? ' is' : 's are'} trending down${input.lowReadinessShare >= 0.5 ? ' and readiness has been low on most recent days' : ''}.`,
      evidence: { declining_lifts: declining, low_readiness_share: input.lowReadinessShare },
      suggestion: 'Consider a lighter week (about half the sets, same loads) and compare how the next sessions feel.',
      tradeoff: 'A deload gives up one week of volume for a chance to rebound; if the decline is from missed sessions or poor sleep it may not help.', proposed_change: { type: 'deload_review' },
    });
  }

  const yesterday = addDays(input.today, -1);
  const missed = input.attendance.find((r) => r.date === yesterday && r.outcome === 'missed');
  if (missed) {
    out.push({
      kind: 'reschedule_missed', dedupe_key: `reschedule_missed:${missed.template_key}:${yesterday}`, exercise_id: null, muscle: null,
      observation: `Yesterday's session (${yesterday}) was not logged.`, evidence: { date: yesterday },
      suggestion: 'Reschedule it to the next free day, or mark it skipped so history stays accurate.',
      tradeoff: 'Doubling up reduces recovery between sessions; skipping lowers weekly volume.', proposed_change: { type: 'reschedule', template_key: missed.template_key, from: yesterday },
    });
  }

  for (const d of input.dips.filter((x) => x.kind === 'undertrained_muscle')) {
    out.push({
      kind: 'muscle_volume', dedupe_key: `muscle_volume:${d.drill.id}:${wk}`, exercise_id: null, muscle: d.drill.id,
      observation: d.summary, evidence: { comparison: d.comparison }, suggestion: `If this wasn't intentional, add 2 sets for ${d.title.replace(' volume was low', '')} next week.`,
      tradeoff: 'More sets add recovery cost; only add them if recent sessions feel fresh.', proposed_change: null,
    });
  }
  return out;
}
