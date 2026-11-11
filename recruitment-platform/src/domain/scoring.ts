import type {
  CriterionAssessment, CriterionState, Flag, GateResult, Rating, RubricCriterion, ScoreLine, ScoreResult,
  ScreeningPolicy, ScreeningStatus,
} from './types';

/**
 * Deterministic scoring engine (plan §5.2, §6). The AI only produces criterion-level ratings with evidence;
 * this module — plain code — applies the approved weights, mandatory gates and policy. Same inputs ⇒ same output.
 */

export const DEFAULT_POLICY: ScreeningPolicy = {
  threshold: 75,
  borderlineFloor: 70,
  strongAt: 85,
  exceptionalAt: 90,
  minExtractionConfidence: 0.6,
  minEvidenceCoverage: 0.6,
  minAssessmentConfidence: 0.5,
  missingEvidencePolicy: 'rescale',
};

export const round1 = (n: number): number => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function stateFromRating(rating: Rating | null, unable = false): CriterionState {
  if (unable) return 'unable_to_assess';
  if (rating === null) return 'not_evident';
  if (rating === 0) return 'not_met';
  if (rating <= 2) return 'partially_met';
  return 'met';
}

export interface WeightCheck { ok: boolean; total: number; problems: string[] }

export function validateWeights(criteria: Pick<RubricCriterion, 'id' | 'name' | 'weight'>[]): WeightCheck {
  const problems: string[] = [];
  const total = criteria.reduce((a, c) => a + c.weight, 0);
  for (const c of criteria) {
    if (!Number.isFinite(c.weight) || c.weight < 0) problems.push(`"${c.name}" has an invalid weight (${c.weight}).`);
  }
  if (Math.abs(total - 100) > 1e-9) problems.push(`Weights must total 100 (currently ${round1(total)}).`);
  if (criteria.length === 0) problems.push('A rubric needs at least one weighted criterion.');
  return { ok: problems.length === 0, total, problems };
}

/** Criterion Score = (Rating ÷ 5) × Weight; total = Σ. Missing evidence follows the explicit policy, never an implicit zero. */
export function computeScore(
  criteria: Pick<RubricCriterion, 'id' | 'weight'>[],
  assessed: Pick<CriterionAssessment, 'criterionId' | 'rating' | 'state'>[],
  policy: ScreeningPolicy,
): ScoreResult {
  const byId = new Map(assessed.map((a) => [a.criterionId, a]));
  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0);
  if (totalWeight <= 0) throw new Error('Cannot score a rubric whose weights total zero.');

  let points = 0;
  let assessedWeight = 0;
  let missingWeight = 0;
  const lines: ScoreLine[] = criteria.map((c) => {
    const a = byId.get(c.id);
    const rating = a && a.state !== 'unable_to_assess' ? a.rating : null;
    if (rating === null) {
      missingWeight += c.weight;
      return { criterionId: c.id, weight: c.weight, rating: null, points: 0 };
    }
    const pts = (rating / 5) * c.weight;
    points += pts;
    assessedWeight += c.weight;
    return { criterionId: c.id, weight: c.weight, rating, points: round2(pts) };
  });

  const scale = 100 / totalWeight;
  const floor = points * scale;
  const ceiling = (points + missingWeight) * scale;
  let total: number;
  if (policy.missingEvidencePolicy === 'zero') total = floor;
  else total = assessedWeight > 0 ? (points / assessedWeight) * 100 : 0;

  return {
    total: round1(total),
    floor: round1(floor),
    ceiling: round1(ceiling),
    coverage: Math.round((assessedWeight / totalWeight) * 1000) / 1000,
    lines,
    policy: policy.missingEvidencePolicy,
  };
}

export interface ClassifyInput {
  score: ScoreResult;
  gates: GateResult[];
  extractionConfidence: number;
  assessmentConfidence: number;
  /** Problems found by the validation layer (unsupported evidence, uncovered criteria, ...). */
  inconsistencies: string[];
  policy: ScreeningPolicy;
}

export interface Classification { status: ScreeningStatus; reasons: string[]; flags: Flag[] }

/**
 * Screening classification with the plan's §6.5 safeguards. Precedence (first match wins):
 *  1 low extraction confidence → Manual Review      (a "fail" on bad OCR is not a fail)
 *  2 low assessment confidence / material inconsistency → Manual Review
 *  3 verified mandatory failure → Mandatory Non-Compliance   (never hidden by a high weighted score)
 *  4 mandatory requirement unclear → Verification Required   (never treated as a verified failure)
 *  5 too little assessable evidence → Manual Review
 *  6 score bands: ≥90 Exceptional, ≥85 Strong, ≥75 Potential, 70–74.9 Borderline Review, else Below Threshold.
 * "Below Threshold" is an internal, reviewable status — no external rejection is ever sent.
 */
export function classify(i: ClassifyInput): Classification {
  const { policy, score } = i;
  const flags: Flag[] = [];
  const reasons: string[] = [];

  if (score.floor < policy.threshold && score.ceiling >= policy.threshold && score.total < policy.threshold) {
    flags.push({
      code: 'missing_evidence_could_change_outcome',
      severity: 'info',
      message: `Unassessed criteria could lift the score from ${score.total} to as high as ${score.ceiling}. Treat Below Threshold as provisional.`,
    });
  }

  if (i.extractionConfidence < policy.minExtractionConfidence) {
    reasons.push(`Extraction confidence ${pct(i.extractionConfidence)} is below the ${pct(policy.minExtractionConfidence)} minimum — the CV data may be wrong, so no automatic outcome is applied.`);
    return { status: 'manual_review', reasons, flags };
  }
  if (i.inconsistencies.length > 0) {
    reasons.push(`Assessment inconsistency: ${i.inconsistencies.join('; ')}.`);
    return { status: 'manual_review', reasons, flags };
  }
  if (i.assessmentConfidence < policy.minAssessmentConfidence) {
    reasons.push(`Assessment confidence ${pct(i.assessmentConfidence)} is below the ${pct(policy.minAssessmentConfidence)} minimum.`);
    return { status: 'manual_review', reasons, flags };
  }

  const failed = i.gates.filter((g) => g.status === 'fail');
  if (failed.length) {
    reasons.push(`Mandatory requirement not met (${failed.length}). Score ${score.total} does not override a verified mandatory failure.`);
    return { status: 'mandatory_non_compliance', reasons, flags };
  }
  const unclear = i.gates.filter((g) => g.status === 'needs_verification');
  if (unclear.length) {
    reasons.push(`${unclear.length} mandatory requirement(s) cannot be confirmed from the CV and need verification. Unclear is not treated as failed.`);
    return { status: 'verification_required', reasons, flags };
  }

  if (score.coverage < policy.minEvidenceCoverage) {
    reasons.push(`Only ${pct(score.coverage)} of the rubric weight has assessable evidence (minimum ${pct(policy.minEvidenceCoverage)}).`);
    return { status: 'manual_review', reasons, flags };
  }

  const t = score.total;
  if (t >= policy.exceptionalAt) { reasons.push(`Score ${t} ≥ ${policy.exceptionalAt} and all mandatory gates passed.`); return { status: 'exceptional_match', reasons, flags }; }
  if (t >= policy.strongAt) { reasons.push(`Score ${t} ≥ ${policy.strongAt} and all mandatory gates passed.`); return { status: 'strong_match', reasons, flags }; }
  if (t >= policy.threshold) { reasons.push(`Score ${t} meets the ${policy.threshold}-point screening threshold and all mandatory gates passed.`); return { status: 'potential_match', reasons, flags }; }
  if (t >= policy.borderlineFloor) {
    reasons.push(`Score ${t} is within the ${policy.borderlineFloor}–${round1(policy.threshold - 0.1)} borderline band; the gap to ${policy.threshold} is smaller than assessment uncertainty, so a person decides.`);
    return { status: 'borderline_review', reasons, flags };
  }
  reasons.push(`Score ${t} is below the ${policy.threshold}-point threshold with a high-confidence assessment. Internal status only; reviewable and overridable.`);
  return { status: 'below_threshold', reasons, flags };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export interface PointLoss { criterionId: string; lost: number; weight: number; rating: Rating | null }

/** Where the points went: biggest shortfalls first. Supports "why 85 rather than 65" explainability. */
export function pointsLost(score: ScoreResult): PointLoss[] {
  return score.lines
    .map((l) => ({ criterionId: l.criterionId, weight: l.weight, rating: l.rating, lost: round2(l.rating === null ? 0 : l.weight - l.points) }))
    .filter((l) => l.lost > 0)
    .sort((a, b) => b.lost - a.lost);
}

export function meanConfidence(c: Pick<CriterionAssessment, 'confidence'>[]): number {
  if (c.length === 0) return 0;
  return c.reduce((a, x) => a + x.confidence, 0) / c.length;
}
