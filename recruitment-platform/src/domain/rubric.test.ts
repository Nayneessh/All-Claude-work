import { describe, expect, it } from 'vitest';
import { RubricInvalidError, RubricLockedError, approveRubric, assertEditable, checkRubric, diffMandate, reviseRubric } from './rubric';
import { DEFAULT_POLICY } from './scoring';
import type { Mandate, Rubric, RubricCriterion } from './types';

const crit = (id: string, weight: number): RubricCriterion => ({ id, category: 'other', name: `Criterion ${id}`, description: '', classification: 'preferred', weight, keywords: ['k'], expectedEvidence: '', guidance: '', verification: '' });
const rubric = (over: Partial<Rubric> = {}): Rubric => ({
  id: 'r1', mandateId: 'm1', entityId: 'e1', mandateVersion: 1, version: 1, status: 'draft',
  criteria: [crit('a', 60), crit('b', 40)], gates: [], policy: DEFAULT_POLICY,
  roleIntelligence: { purpose: '', responsibilities: [], mandatory: [], preferred: [], competencies: [], industry: [], leadership: [], scale: [], achievements: [], progression: [], practical: [] },
  generatedBy: 'manual', createdBy: 'u', createdAt: 't', ...over,
});

describe('rubric lifecycle', () => {
  it('approves a valid draft and stamps the approver', () => {
    const a = approveRubric(rubric(), 'u9', '2026-11-11T00:00:00Z');
    expect(a).toMatchObject({ status: 'approved', approvedBy: 'u9' });
  });
  it('refuses weights that do not total 100', () => {
    expect(() => approveRubric(rubric({ criteria: [crit('a', 60), crit('b', 30)] }), 'u', 't')).toThrow(RubricInvalidError);
  });
  it('an approved rubric is locked: AI or user cannot silently edit it mid-cycle', () => {
    const approved = approveRubric(rubric(), 'u', 't');
    expect(() => assertEditable(approved)).toThrow(RubricLockedError);
    expect(() => approveRubric(approved, 'u', 't')).toThrow(RubricLockedError);
  });
  it('revision creates an independent draft v+1 and leaves the original untouched', () => {
    const approved = approveRubric(rubric(), 'u', 't');
    const next = reviseRubric(approved, 'r2', 'u2', 't2');
    expect(next).toMatchObject({ id: 'r2', version: 2, status: 'draft', approvedBy: undefined });
    next.criteria[0].weight = 10;
    next.criteria[0].keywords.push('zzz');
    expect(approved.criteria[0].weight).toBe(60);
    expect(approved.criteria[0].keywords).toEqual(['k']);
  });
  it('rejects incoherent policy and duplicate criterion names', () => {
    expect(checkRubric(rubric({ policy: { ...DEFAULT_POLICY, borderlineFloor: 80 } })).join()).toMatch(/borderline floor/);
    expect(checkRubric(rubric({ policy: { ...DEFAULT_POLICY, strongAt: 95 } })).join()).toMatch(/ascend/);
    const dup = rubric({ criteria: [crit('a', 50), { ...crit('b', 50), name: 'criterion a' }] });
    expect(checkRubric(dup).join()).toMatch(/Duplicate criterion/);
  });
});

const mandate = (o: Partial<Mandate> = {}): Mandate => ({
  id: 'm1', code: 'MND-1', version: 1, entityId: 'e', title: 'VP Procurement', function: 'Procurement', reportingManager: 'CEO', location: 'Mumbai',
  minExperience: 15, education: 'MBA', certifications: [], competencies: [], mandatoryIndustries: [], preferredIndustries: [],
  currency: 'INR', priority: 'high', hiringManager: 'HM', jdText: 'JD', status: 'open', createdBy: 'u', createdAt: '', updatedAt: '', ...o,
});

describe('diffMandate', () => {
  it('JD / experience / education / industry / location changes are material', () => {
    expect(diffMandate(mandate(), mandate({ jdText: 'new JD' })).material).toBe(true);
    expect(diffMandate(mandate(), mandate({ minExperience: 12 })).material).toBe(true);
    expect(diffMandate(mandate(), mandate({ mandatoryIndustries: ['Steel'] })).material).toBe(true);
    expect(diffMandate(mandate(), mandate({ location: 'Pune' })).material).toBe(true);
  });
  it('compensation, priority, hiring manager and target date are tracked but not material', () => {
    const d = diffMandate(mandate(), mandate({ compMax: 5_000_000, priority: 'low', hiringManager: 'Z', targetDate: '2027-01-01' }));
    expect(d.material).toBe(false);
    expect(d.changes.length).toBe(4);
  });
  it('no change → no changes', () => {
    expect(diffMandate(mandate(), mandate())).toEqual({ material: false, changes: [] });
  });
});
