import { describe, it, expect } from 'vitest';
import { validate, quoted } from '../functions/slate-parse/validate';

const TEXT = 'VP Procurement for ABC Company, Mumbai, reporting to the CEO, budget 80 lakhs, immediate requirement, two positions, confidential mandate.';
describe('AI answer validation (anti-fabrication)', () => {
  it('keeps fields backed by a real quote and drops invented ones', () => {
    const o = validate('mandate', TEXT, { fields: { title: 'VP Procurement', company: 'ABC Company', location: 'Mumbai', budget: '80 lakhs', positions: 2, confidential: true, span: '25 people', stakeholder: 'Rahul Mehta' },
      evidence: { title: 'VP Procurement', company: 'ABC Company', location: 'Mumbai', budget: 'budget 80 lakhs', positions: 'two positions', confidential: 'confidential mandate', span: '25 people', stakeholder: 'hiring manager Rahul Mehta' } }, {});
    expect(Object.keys(o.fields).sort()).toEqual(['budget', 'company', 'confidential', 'location', 'positions', 'title']);
    expect(o.dropped.sort()).toEqual(['span', 'stakeholder']); // the quotes do not occur in the text
  });
  it('an inferred field is kept without a literal quote but must be flagged', () => {
    const o = validate('mandate', TEXT, { fields: { title: 'VP Procurement', company: 'ABC Company', urgency: 'High' }, evidence: { title: 'VP Procurement', company: 'ABC Company' }, inferred: ['urgency'], ambiguous: { urgency: '"immediate" read as High' } }, {});
    expect(o.fields.urgency).toBe('High'); expect(o.inferred).toEqual(['urgency']); expect(o.ambiguous.urgency).toMatch(/immediate/);
    const noFlag = validate('mandate', TEXT, { fields: { title: 'VP Procurement', company: 'ABC Company', urgency: 'High' }, evidence: { title: 'VP Procurement', company: 'ABC Company', urgency: 'urgent' } }, {});
    expect(noFlag.fields.urgency).toBeUndefined(); // unflagged and unquoted -> discarded
  });
  it('rejects values outside the allowed enums, lists and formats', () => {
    const o = validate('mandate', 'CFO for Infinx, Remote, critical, start 2026-12-01', { fields: { title: 'CFO', company: 'Infinx', work_mode: 'Remote', urgency: 'Whenever', level: 'Wizard', started_on: '1 Dec' },
      evidence: { title: 'CFO', company: 'Infinx', work_mode: 'Remote', urgency: 'critical', level: 'CFO', started_on: 'start 2026-12-01' } }, { levels: ['CXO / C-suite'] });
    expect(o.fields).toMatchObject({ title: 'CFO', work_mode: 'Remote' }); expect(o.fields.urgency).toBeUndefined(); expect(o.fields.level).toBeUndefined(); expect(o.fields.started_on).toBeUndefined();
  });
  it('candidate: contact details must literally appear; source is mapped to the user list; mandate id must be a known one', () => {
    const t = 'Rahul Sharma, rahul@abc.com, sourced through linkedin, for the CFO role';
    const o = validate('candidate', t, { fields: { name: 'Rahul Sharma', email: 'rahul@abc.com', phone: '9876543210', source: 'linkedin', mandate_id: 'm-1', current_ctc: '65 lakhs' },
      evidence: { name: 'Rahul Sharma', email: 'rahul@abc.com', phone: 'rahul', source: 'sourced through linkedin', current_ctc: '65 lakhs' }, inferred: ['mandate_id'] }, { sources: ['LinkedIn', 'Naukri', 'Other'], mandates: [{ id: 'm-1', title: 'CFO', company: 'Infinx' }] });
    expect(o.fields).toMatchObject({ name: 'Rahul Sharma', email: 'rahul@abc.com', source: 'LinkedIn', mandate_id: 'm-1' });
    expect(o.fields.phone).toBeUndefined(); expect(o.fields.current_ctc).toBeUndefined();
    const bad = validate('candidate', t, { fields: { name: 'Rahul Sharma', mandate_id: 'm-999' }, evidence: { name: 'Rahul Sharma' }, inferred: ['mandate_id'] }, { mandates: [{ id: 'm-1', title: 'CFO', company: null }] });
    expect(bad.fields.mandate_id).toBeUndefined();
  });
  it('reports what is missing and never returns unknown fields', () => {
    const o = validate('candidate', 'Rahul Sharma', { fields: { name: 'Rahul Sharma', favourite_colour: 'blue' }, evidence: { name: 'Rahul Sharma', favourite_colour: 'blue' } }, {});
    expect(Object.keys(o.fields)).toEqual(['name']); expect(o.missing).toContain('phone'); expect(o.missing).not.toContain('name');
  });
  it('quote matching ignores case and punctuation', () => { expect(quoted('Budget: 80 Lakhs.', 'budget 80 lakhs')).toBe(true); expect(quoted('abc', 'xyz')).toBe(false); expect(quoted('abc', '')).toBe(false); });
});
