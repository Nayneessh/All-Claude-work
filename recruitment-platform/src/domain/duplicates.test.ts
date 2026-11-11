import { describe, expect, it } from 'vitest';
import { findDuplicates, nameSimilarity, normaliseEmail, normalisePhone, sameCompany } from './duplicates';
import type { Candidate } from './types';

const cand = (o: Partial<Candidate>): Candidate => ({
  id: 'c1', code: 'CND-1', entityId: 'e', name: 'Rahul Sharma', employment: [], education: [], certifications: [], skills: [],
  industries: [], achievements: [], extractionConfidence: 1, verificationStatus: 'unverified', identityFlags: [],
  createdAt: '', updatedAt: '', ...o,
});

describe('normalisers', () => {
  it('phone: country code, leading zero and punctuation all compare equal', () => {
    const a = normalisePhone('+91 98765 43210');
    expect(a).toBe('9876543210');
    expect(normalisePhone('098765-43210')).toBe(a);
    expect(normalisePhone('12345')).toBeUndefined();
  });
  it('email: case-insensitive; garbage rejected', () => {
    expect(normaliseEmail(' Rahul@X.COM ')).toBe('rahul@x.com');
    expect(normaliseEmail('not-an-email')).toBeUndefined();
  });
  it('company: strips legal suffixes', () => {
    expect(sameCompany('Tata Steel Ltd.', 'Tata Steel Limited')).toBe(true);
    expect(sameCompany('Acme', 'Beta')).toBe(false);
    expect(sameCompany(undefined, 'Beta')).toBe(false);
  });
});

describe('nameSimilarity', () => {
  it('order, initials, titles and one-letter typos', () => {
    expect(nameSimilarity('Rahul Sharma', 'Sharma, Rahul')).toBe(1);
    expect(nameSimilarity('R. Sharma', 'Rahul Sharma')).toBe(1);
    expect(nameSimilarity('Dr. Rahul Sharma', 'Rahul Sharma')).toBe(1);
    expect(nameSimilarity('Rahul Sharma', 'Rahull Sharma')).toBe(1);
    expect(nameSimilarity('Rahul Sharma', 'Priya Nair')).toBe(0);
    expect(nameSimilarity('', 'Priya')).toBe(0);
  });
});

describe('findDuplicates', () => {
  const existing = [cand({ id: 'a', name: 'Rahul Sharma', email: 'rahul@x.com', phone: '+91 98765 43210', currentCompany: 'Acme Pvt Ltd', employment: [{ company: 'Acme Pvt Ltd', title: 'VP', description: '' }, { company: 'Beta Corp', title: 'GM', description: '' }] })];

  it('same email → strong', () => {
    const m = findDuplicates({ name: 'Rahul Sharma', email: 'RAHUL@x.com', employers: [] }, existing);
    expect(m[0]).toMatchObject({ candidateId: 'a', level: 'strong', nameConflict: false });
  });
  it('same phone → strong, even with a different email', () => {
    const m = findDuplicates({ name: 'Rahul K Sharma', email: 'other@y.com', phone: '9876543210', employers: [] }, existing);
    expect(m[0].level).toBe('strong');
  });
  it('shared identifier with a clearly different name is flagged for review', () => {
    const m = findDuplicates({ name: 'Anita Desai', email: 'rahul@x.com', employers: [] }, existing);
    expect(m[0]).toMatchObject({ level: 'strong', nameConflict: true });
  });
  it('a similar name ALONE is never a duplicate', () => {
    expect(findDuplicates({ name: 'Rahul Sharma', employers: ['Gamma'] }, existing)).toEqual([]);
  });
  it('similar name + same current employer → possible, not strong', () => {
    const m = findDuplicates({ name: 'Rahul Sharma', currentCompany: 'Acme Private Limited', employers: [] }, existing);
    expect(m[0]).toMatchObject({ level: 'possible' });
  });
  it('similar name + two shared employers → possible', () => {
    expect(findDuplicates({ name: 'Rahul Sharma', employers: ['Acme', 'Beta Corporation'] }, existing)[0].level).toBe('possible');
  });
  it('skips already-merged records', () => {
    expect(findDuplicates({ name: 'X', email: 'rahul@x.com', employers: [] }, [{ ...existing[0], mergedInto: 'z' }])).toEqual([]);
  });
});
