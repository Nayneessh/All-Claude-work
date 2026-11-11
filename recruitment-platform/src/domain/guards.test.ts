import { describe, expect, it } from 'vitest';
import { ImmutableRecordError, guardWrite } from './guards';
import { DEFAULT_POLICY } from './scoring';
import type { Rubric } from './types';

const rubric = (o: Partial<Rubric> = {}): Rubric => ({
  id: 'r', mandateId: 'm', entityId: 'e', mandateVersion: 1, version: 1, status: 'approved',
  criteria: [{ id: 'c', category: 'other', name: 'n', description: '', classification: 'preferred', weight: 100, keywords: [], expectedEvidence: '', guidance: '', verification: '' }],
  gates: [], policy: DEFAULT_POLICY, roleIntelligence: { purpose: '', responsibilities: [], mandatory: [], preferred: [], competencies: [], industry: [], leadership: [], scale: [], achievements: [], progression: [], practical: [] },
  generatedBy: 'manual', createdBy: 'u', createdAt: 't', ...o,
});

describe('guardWrite', () => {
  it('inserts are always allowed', () => expect(() => guardWrite('assessments', undefined, { id: 'a' })).not.toThrow());
  it.each(['assessments', 'audit_logs', 'decisions', 'mandate_versions'])('%s are append-only', (t) => {
    expect(() => guardWrite(t, { id: 'x' }, { id: 'x' })).toThrow(ImmutableRecordError);
  });
  it('ordinary tables stay editable', () => expect(() => guardWrite('candidates', { id: 'x' }, { id: 'x' })).not.toThrow());
  it('drafts are editable', () => {
    const d = rubric({ status: 'draft' });
    expect(() => guardWrite('rubrics', d, { ...d, criteria: [] })).not.toThrow();
  });
  it('an approved rubric cannot change weights, gates or policy', () => {
    const a = rubric();
    const edited = rubric({ criteria: [{ ...a.criteria[0], weight: 90 }] });
    expect(() => guardWrite('rubrics', a, edited)).toThrow(ImmutableRecordError);
    expect(() => guardWrite('rubrics', a, rubric({ policy: { ...DEFAULT_POLICY, threshold: 60 } }))).toThrow(ImmutableRecordError);
  });
  it('an approved rubric can be retired to superseded but not reopened as a draft', () => {
    const a = rubric();
    expect(() => guardWrite('rubrics', a, { ...a, status: 'superseded' })).not.toThrow();
    expect(() => guardWrite('rubrics', a, { ...a, status: 'draft' })).toThrow(ImmutableRecordError);
    expect(() => guardWrite('rubrics', { ...a, status: 'superseded' }, { ...a, status: 'approved' })).toThrow(ImmutableRecordError);
  });
});
