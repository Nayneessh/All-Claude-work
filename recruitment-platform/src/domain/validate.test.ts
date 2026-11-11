import { describe, expect, it } from 'vitest';
import type { AssessmentModelOutput } from './contract';
import { extractionConfidence, validateAssessmentOutput } from './validate';
import type { RubricCriterion, GateDef } from './types';

const crit = (id: string): RubricCriterion => ({ id, category: 'other', name: `Crit ${id}`, description: '', classification: 'preferred', weight: 50, keywords: [], expectedEvidence: '', guidance: '', verification: '' });
const gate: GateDef = { id: 'g1', type: 'certification', name: 'CPSM', requirement: 'CPSM', keywords: [], verification: '' };
const rubric = { criteria: [crit('a'), crit('b')], gates: [gate] };
const pages = [{ page: 1, text: 'Led sourcing for ₹650 crore annual spend.\nManaged a team of 45 buyers.' }, { page: 2, text: 'CPSM certified 2015.' }];
const ok = (o: Partial<AssessmentModelOutput> = {}): AssessmentModelOutput => ({
  criteria: [
    { criterionId: 'a', rating: 4, evidence: [{ quote: 'Led sourcing for ₹650 crore annual spend' }], interpretation: 'strong', verification: '', confidence: 0.9 },
    { criterionId: 'b', rating: 3, evidence: [{ quote: 'Managed a team of 45 buyers' }], interpretation: 'ok', verification: '', confidence: 0.8 },
  ],
  gates: [{ gateId: 'g1', status: 'pass', evidence: [{ quote: 'CPSM certified 2015' }], note: '' }],
  summary: '', strengths: [], gaps: [], missingInformation: [], verificationQuestions: [], recommendedAction: '', ...o,
});

describe('validateAssessmentOutput', () => {
  it('accepts a complete, evidenced output and resolves the page from the CV', () => {
    const v = validateAssessmentOutput(rubric, ok(), { pages });
    expect(v.inconsistencies).toEqual([]);
    expect(v.criteria[0]).toMatchObject({ rating: 4, state: 'met' });
    expect(v.criteria[0].evidence[0].page).toBe(1);
    expect(v.gates[0].status).toBe('pass');
  });
  it('discards invented quotes and withholds a positive rating that rests on them', () => {
    const out = ok();
    out.criteria[0].evidence = [{ quote: 'Awarded Procurement Leader of the Year by the UN' }];
    const v = validateAssessmentOutput(rubric, out, { pages });
    expect(v.criteria[0].rating).toBeNull();
    expect(v.criteria[0].state).toBe('not_evident');
    expect(v.inconsistencies.join()).toMatch(/without verifiable CV evidence/);
  });
  it('keeps a rating when at least one quote verifies, dropping only the invented one', () => {
    const out = ok();
    out.criteria[0].evidence.push({ quote: 'Won a Nobel prize for sourcing' });
    const v = validateAssessmentOutput(rubric, out, { pages });
    expect(v.criteria[0].rating).toBe(4);
    expect(v.criteria[0].evidence).toHaveLength(1);
    expect(v.notes.join()).toMatch(/discarded/);
  });
  it('Not Met (0) from absence becomes Not Evident, never proof of non-compliance', () => {
    const out = ok();
    out.criteria[1] = { criterionId: 'b', rating: 0, evidence: [], interpretation: 'no mention', verification: '', confidence: 0.7 };
    const v = validateAssessmentOutput(rubric, out, { pages });
    expect(v.criteria[1]).toMatchObject({ rating: null, state: 'not_evident' });
    expect(v.inconsistencies).toEqual([]);
  });
  it('omitted criteria are flagged and cannot silently score', () => {
    const out = ok();
    out.criteria = out.criteria.slice(0, 1);
    const v = validateAssessmentOutput(rubric, out, { pages });
    expect(v.criteria[1]).toMatchObject({ rating: null, state: 'unable_to_assess' });
    expect(v.inconsistencies.join()).toMatch(/was not assessed/);
  });
  it('rejects unknown ids, duplicates and out-of-range ratings', () => {
    const out = ok();
    out.criteria.push({ criterionId: 'zzz', rating: 3, evidence: [], interpretation: '', verification: '', confidence: 1 });
    out.criteria.push({ ...out.criteria[0] });
    out.criteria[1].rating = 7;
    const v = validateAssessmentOutput(rubric, out, { pages });
    expect(v.inconsistencies.join()).toMatch(/unknown criterion/);
    expect(v.inconsistencies.join()).toMatch(/more than once/);
    expect(v.inconsistencies.join()).toMatch(/invalid rating/);
  });
  it('a gate Fail with no verifiable evidence is downgraded to Needs Verification', () => {
    const out = ok({ gates: [{ gateId: 'g1', status: 'fail', evidence: [{ quote: 'no CPSM anywhere on the CV' }], note: 'missing' }] });
    const v = validateAssessmentOutput(rubric, out, { pages });
    expect(v.gates[0].status).toBe('needs_verification');
  });
  it('a missing gate result defaults to Needs Verification', () => {
    const v = validateAssessmentOutput(rubric, ok({ gates: [] }), { pages });
    expect(v.gates[0].status).toBe('needs_verification');
  });
  it('matches quotes against the redacted text too, but locates them in the original', () => {
    const redacted = [{ page: 1, text: '[CANDIDATE] led sourcing for ₹650 crore.' }];
    const out = ok();
    out.criteria[0].evidence = [{ quote: '[CANDIDATE] led sourcing for ₹650 crore.' }];
    const v = validateAssessmentOutput(rubric, out, { pages, alsoMatch: redacted });
    expect(v.criteria[0].rating).toBe(4);
  });
  it('is whitespace and case tolerant', () => {
    const out = ok();
    out.criteria[0].evidence = [{ quote: 'led   SOURCING for ₹650\ncrore annual spend' }];
    expect(validateAssessmentOutput(rubric, out, { pages }).criteria[0].rating).toBe(4);
  });
});

describe('extractionConfidence', () => {
  const full = { name: 'Rahul Sharma', email: 'r@x.com', employment: [{ start: '2015-01', company: 'A', title: 'VP' }], education: [{}] };
  it('is high for a complete extraction and low for a thin one', () => {
    expect(extractionConfidence(full, { textLength: 3000, ocrRequired: false })).toBeGreaterThanOrEqual(0.9);
    expect(extractionConfidence({ name: '', employment: [], education: [] }, { textLength: 100, ocrRequired: false })).toBeLessThan(0.2);
  });
  it('scanned PDFs and legacy .doc files are capped for human review', () => {
    expect(extractionConfidence(full, { textLength: 3000, ocrRequired: true })).toBe(0.2);
    expect(extractionConfidence(full, { textLength: 3000, ocrRequired: false, isLegacyDoc: true })).toBeLessThanOrEqual(0.55);
  });
});
