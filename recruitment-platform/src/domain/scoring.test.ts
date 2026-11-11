import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, classify, computeScore, meanConfidence, pointsLost, stateFromRating, validateWeights } from './scoring';
import type { CriterionAssessment, GateResult, Rating, ScoreResult } from './types';

const W = [25, 15, 20, 15, 15, 5, 5];
const criteria = W.map((weight, i) => ({ id: `c${i}`, weight, name: `C${i}` }));
const ratings = (rs: (Rating | null)[]): Pick<CriterionAssessment, 'criterionId' | 'rating' | 'state'>[] =>
  rs.map((r, i) => ({ criterionId: `c${i}`, rating: r, state: stateFromRating(r) }));
const passGate: GateResult = { gateId: 'g', status: 'pass', evidence: [], note: '' };
const base = { extractionConfidence: 0.95, assessmentConfidence: 0.9, inconsistencies: [] as string[], policy: DEFAULT_POLICY };

describe('weights', () => {
  it('default 25/15/20/15/15/5/5 totals 100', () => {
    expect(validateWeights(criteria).ok).toBe(true);
  });
  it('rejects totals other than 100, negatives and empty rubrics', () => {
    expect(validateWeights([{ id: 'a', name: 'A', weight: 90 }]).problems.join()).toMatch(/total 100/);
    expect(validateWeights([{ id: 'a', name: 'A', weight: -5 }, { id: 'b', name: 'B', weight: 105 }]).ok).toBe(false);
    expect(validateWeights([]).ok).toBe(false);
  });
});

describe('computeScore: Criterion Score = (Rating ÷ 5) × Weight', () => {
  it('all 5s = 100, all 3s = 60, all 0s = 0', () => {
    expect(computeScore(criteria, ratings([5, 5, 5, 5, 5, 5, 5]), DEFAULT_POLICY).total).toBe(100);
    expect(computeScore(criteria, ratings([3, 3, 3, 3, 3, 3, 3]), DEFAULT_POLICY).total).toBe(60);
    expect(computeScore(criteria, ratings([0, 0, 0, 0, 0, 0, 0]), DEFAULT_POLICY).total).toBe(0);
  });
  it('matches a hand calculation', () => {
    // 4/5*25=20, 5/5*15=15, 4/5*20=16, 3/5*15=9, 4/5*15=12, 5/5*5=5, 4/5*5=4 → 81
    const s = computeScore(criteria, ratings([4, 5, 4, 3, 4, 5, 4]), DEFAULT_POLICY);
    expect(s.total).toBe(81);
    expect(s.lines[0].points).toBe(20);
    expect(s.coverage).toBe(1);
    expect(s.floor).toBe(81);
    expect(s.ceiling).toBe(81);
  });
  it('is reproducible: identical inputs give identical outputs', () => {
    const a = computeScore(criteria, ratings([4, 3, 4, 2, 5, 3, 4]), DEFAULT_POLICY);
    const b = computeScore(criteria, ratings([4, 3, 4, 2, 5, 3, 4]), DEFAULT_POLICY);
    expect(a).toEqual(b);
  });
  it('never trusts a model-supplied total: only ratings feed the score', () => {
    const polluted = ratings([4, 4, 4, 4, 4, 4, 4]).map((r) => ({ ...r, total: 99 }));
    expect(computeScore(criteria, polluted, DEFAULT_POLICY).total).toBe(80);
  });
  it('scales when weights do not total 100 (approval blocks this, scoring stays honest)', () => {
    const half = [{ id: 'a', weight: 30 }, { id: 'b', weight: 20 }];
    const s = computeScore(half, [{ criterionId: 'a', rating: 5, state: 'met' }, { criterionId: 'b', rating: 0, state: 'not_met' }], DEFAULT_POLICY);
    expect(s.total).toBe(60);
  });
  it('throws on an all-zero-weight rubric', () => {
    expect(() => computeScore([{ id: 'a', weight: 0 }], [], DEFAULT_POLICY)).toThrow();
  });
});

describe('missing evidence policy (Not Evident is not zero)', () => {
  const partial = ratings([5, 5, 5, 5, null, null, null]); // 15% + 15 + ... assessed weight = 75
  it('rescale: scores only assessed weight, records coverage and a floor/ceiling range', () => {
    const s = computeScore(criteria, partial, DEFAULT_POLICY);
    expect(s.total).toBe(100);
    expect(s.coverage).toBe(0.75);
    expect(s.floor).toBe(75);
    expect(s.ceiling).toBe(100);
  });
  it('zero policy: conservative, floor equals total', () => {
    const s = computeScore(criteria, partial, { ...DEFAULT_POLICY, missingEvidencePolicy: 'zero' });
    expect(s.total).toBe(75);
  });
  it('unable_to_assess is treated like missing evidence, even if a rating slipped through', () => {
    const s = computeScore(criteria, [{ criterionId: 'c0', rating: 5, state: 'unable_to_assess' }], DEFAULT_POLICY);
    expect(s.coverage).toBe(0);
    expect(s.total).toBe(0);
  });
  it('an absent criterion in the model output counts as missing, not as a silent zero', () => {
    const s = computeScore(criteria, ratings([5, 5, 5, 5, 5, 5, 5]).slice(0, 5), DEFAULT_POLICY);
    expect(s.coverage).toBe(0.9);
    expect(s.total).toBe(100);
  });
});

describe('classify: bands and the 74-vs-75 safeguard', () => {
  const score = (total: number, coverage = 1, floor = total, ceiling = total): ScoreResult => ({ total, floor, ceiling, coverage, lines: [], policy: 'rescale' });
  const run = (total: number, over: Partial<Parameters<typeof classify>[0]> = {}) =>
    classify({ ...base, score: score(total), gates: [passGate], ...over }).status;

  it('bands', () => {
    expect(run(100)).toBe('exceptional_match');
    expect(run(90)).toBe('exceptional_match');
    expect(run(89.9)).toBe('strong_match');
    expect(run(85)).toBe('strong_match');
    expect(run(84.9)).toBe('potential_match');
    expect(run(75)).toBe('potential_match');
  });
  it('74.9 is not auto-rejected: it goes to the borderline review queue', () => {
    expect(run(74.9)).toBe('borderline_review');
    expect(run(70)).toBe('borderline_review');
  });
  it('69.9 is Below Threshold only for a high-confidence assessment', () => {
    expect(run(69.9)).toBe('below_threshold');
    expect(run(60, { extractionConfidence: 0.4 })).toBe('manual_review');
  });
  it('a verified mandatory failure is not hidden by a 95 score', () => {
    const r = classify({ ...base, score: score(95), gates: [passGate, { gateId: 'x', status: 'fail', evidence: [], note: '' }] });
    expect(r.status).toBe('mandatory_non_compliance');
  });
  it('an unclear mandatory requirement is Verification Required, never a failure', () => {
    expect(run(95, { gates: [{ gateId: 'x', status: 'needs_verification', evidence: [], note: '' }] })).toBe('verification_required');
  });
  it('fail outranks needs-verification when both occur', () => {
    const gates: GateResult[] = [
      { gateId: 'a', status: 'needs_verification', evidence: [], note: '' },
      { gateId: 'b', status: 'fail', evidence: [], note: '' },
    ];
    expect(run(95, { gates })).toBe('mandatory_non_compliance');
  });
  it('low extraction confidence sends even a "fail" to manual review (OCR errors can fake failures)', () => {
    const gates: GateResult[] = [{ gateId: 'b', status: 'fail', evidence: [], note: '' }];
    expect(run(95, { gates, extractionConfidence: 0.3 })).toBe('manual_review');
  });
  it('material inconsistency → manual review', () => {
    expect(run(95, { inconsistencies: ['criterion c1 missing'] })).toBe('manual_review');
  });
  it('low assessment confidence → manual review', () => {
    expect(run(95, { assessmentConfidence: 0.3 })).toBe('manual_review');
  });
  it('insufficient evidence coverage → manual review', () => {
    expect(classify({ ...base, score: score(95, 0.4), gates: [passGate] }).status).toBe('manual_review');
  });
  it('flags when unassessed criteria could flip a below-threshold outcome', () => {
    const r = classify({ ...base, score: score(60, 0.7, 42, 72 + 4), gates: [passGate] });
    expect(r.status).toBe('below_threshold');
    expect(r.flags.map((f) => f.code)).toContain('missing_evidence_could_change_outcome');
  });
  it('threshold is policy, not a constant', () => {
    expect(classify({ ...base, policy: { ...DEFAULT_POLICY, threshold: 80, borderlineFloor: 75 }, score: score(78), gates: [passGate] }).status).toBe('borderline_review');
  });
  it('explains itself', () => {
    expect(classify({ ...base, score: score(88), gates: [passGate] }).reasons[0]).toMatch(/88/);
  });
});

describe('explainability helpers', () => {
  it('pointsLost ranks the biggest shortfalls first and ignores Not Evident', () => {
    const s = computeScore(criteria, ratings([5, 1, 5, 5, 5, null, 5]), DEFAULT_POLICY);
    const lost = pointsLost(s);
    expect(lost[0].criterionId).toBe('c1');
    expect(lost.some((l) => l.criterionId === 'c5')).toBe(false);
  });
  it('meanConfidence handles empty input', () => {
    expect(meanConfidence([])).toBe(0);
    expect(meanConfidence([{ confidence: 1 }, { confidence: 0.5 }])).toBe(0.75);
  });
  it('stateFromRating', () => {
    expect(stateFromRating(0)).toBe('not_met');
    expect(stateFromRating(2)).toBe('partially_met');
    expect(stateFromRating(3)).toBe('met');
    expect(stateFromRating(null)).toBe('not_evident');
    expect(stateFromRating(4, true)).toBe('unable_to_assess');
  });
});
