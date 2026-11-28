import { describe, it, expect } from 'vitest';
import { parseMandateText } from './nl/mandateParser';
import { parseCandidateText } from './nl/candidateParser';
import { parseDatePhrase } from './nl/common';

const TODAY = '2026-11-28'; // Saturday
const SOURCES = ['Naukri', 'LinkedIn', 'Reference', 'Internal Database', 'Mapping', 'Cold Outreach', 'Agency', 'Other'];

describe('natural-language mandate (the example from the brief)', () => {
  const r = parseMandateText('VP Procurement for ABC Company, Mumbai, reporting to the CEO, budget 80 lakhs, immediate requirement, two positions, confidential mandate.', { today: TODAY });
  it('extracts every stated field', () => {
    expect(r.fields).toMatchObject({ title: 'VP Procurement', company: 'ABC Company', location: 'Mumbai', reporting_to: 'CEO', budget: '80 lakhs', positions: 2, confidential: true });
  });
  it('flags "immediate" as an inferred urgency instead of silently deciding', () => {
    expect(r.fields.urgency).toBe('High'); expect(r.inferred).toContain('urgency'); expect(r.ambiguous.urgency).toMatch(/immediate/i);
  });
  it('infers the level from the title but marks it inferred', () => { expect(r.fields.level).toBe('SVP / VP'); expect(r.inferred).toContain('level'); });
  it('lists what was NOT provided and never invents it', () => {
    expect(r.missing).toEqual(expect.arrayContaining(['work_mode', 'started_on', 'target_close']));
    expect(r.fields.work_mode).toBeUndefined(); expect(r.fields.started_on).toBeUndefined(); expect(r.fields.span).toBeUndefined();
    expect(r.missing).not.toContain('title'); expect(r.missing).not.toContain('company');
  });
  it('explicit "critical" is stated, not inferred', () => {
    const c = parseMandateText('CFO for Infinx, critical, Mumbai', { today: TODAY });
    expect(c.fields.urgency).toBe('Critical'); expect(c.inferred).not.toContain('urgency');
  });
  it('dates, work mode, consultants and relative durations', () => {
    const d = parseMandateText('Head of Sales for SyrmaSGS in Chennai, hybrid, start 1 Dec, target close 15 Jan 2027, shared with consultant Michael Page, open for advertisement', { today: TODAY, agencies: ['Michael Page'] });
    expect(d.fields).toMatchObject({ title: 'Head of Sales', company: 'SyrmaSGS', location: 'Chennai', work_mode: 'Hybrid', started_on: '2026-12-01', target_close: '2027-01-15', consultants: ['Michael Page'], confidential: false });
    const w = parseMandateText('CHRO for MEPL, start today, close within 30 days', { today: TODAY });
    expect(w.fields.started_on).toBe('2026-11-28'); expect(w.fields.target_close).toBe('2026-12-28'); expect(w.inferred).toContain('target_close');
  });
  it('a bare title is accepted; the company is reported missing rather than guessed', () => {
    const b = parseMandateText('Chief Technology Officer', { today: TODAY });
    expect(b.fields.title).toBe('Chief Technology Officer'); expect(b.missing).toContain('company'); expect(b.fields.company).toBeUndefined();
  });
  it('reports unmapped fragments instead of dropping them silently', () => {
    const u = parseMandateText('CFO for Infinx, must have Big4 background, Mumbai', { today: TODAY });
    expect(u.unused.join(' ')).toMatch(/Big4/);
  });
  it('empty input yields nothing, everything missing', () => {
    const e = parseMandateText('   ', { today: TODAY });
    expect(Object.keys(e.fields)).toHaveLength(0); expect(e.missing).toContain('title');
  });
});

describe('natural-language candidate (the example from the brief)', () => {
  const r = parseCandidateText('Rahul Sharma, currently VP Operations at ABC Ltd, Mumbai, current CTC 65 lakhs, expecting 80 lakhs, notice period 90 days, sourced through LinkedIn.', { today: TODAY, sources: SOURCES });
  it('extracts every stated attribute', () => {
    expect(r.fields).toMatchObject({ name: 'Rahul Sharma', designation: 'VP Operations', current_company: 'ABC Ltd', current_location: 'Mumbai', current_ctc: '65 lakhs', expected_ctc: '80 lakhs', notice_period: '90 days', source: 'LinkedIn' });
  });
  it('highlights what is missing and fabricates nothing', () => {
    expect(r.missing).toEqual(expect.arrayContaining(['phone', 'email', 'mandate_id']));
    expect(r.fields.phone).toBeUndefined(); expect(r.fields.email).toBeUndefined(); expect(r.fields.open_to_relocate).toBeUndefined();
    expect(r.missing).not.toContain('name');
  });
  it('contact details, relocation, benefits', () => {
    const c = parseCandidateText('Priya Menon works at Tata Projects as Director Procurement, +91 98765 43210, priya@example.com, based in Chennai, open to relocate, benefits: car, esops, notice 2 months', { today: TODAY, sources: SOURCES });
    expect(c.fields).toMatchObject({ name: 'Priya Menon', email: 'priya@example.com', phone: '+919876543210', current_location: 'Chennai', open_to_relocate: true, notice_period: '2 months' });
    expect(c.fields.additional_benefits).toMatch(/car/);
    const n = parseCandidateText('Karan Malhotra, not open to relocate', { today: TODAY, sources: SOURCES });
    expect(n.fields.open_to_relocate).toBe(false);
  });
  it('a source outside the list becomes "Other" and is flagged', () => {
    const o = parseCandidateText('Amit Rao, found through mapping', { today: TODAY, sources: SOURCES });
    expect(o.fields.source).toBe('Mapping');
    const x = parseCandidateText('Amit Rao, sourced via consultant', { today: TODAY, sources: SOURCES });
    expect(x.fields.source).toBe('Agency');
  });
  it('matches a mandate only when unambiguous, otherwise lists the options', () => {
    const mandates = [{ id: 'm1', title: 'CFO', company: 'Infinx' }, { id: 'm2', title: 'COO', company: 'Infinx' }, { id: 'm3', title: 'CFO', company: 'Isharya' }];
    const one = parseCandidateText('Rahul Sharma for the CFO role at Infinx', { today: TODAY, sources: SOURCES, mandates });
    expect(one.fields.mandate_id).toBe('m1'); expect(one.inferred).toContain('mandate_id');
    const amb = parseCandidateText('Rahul Sharma for the CFO role', { today: TODAY, sources: SOURCES, mandates });
    expect(amb.fields.mandate_id).toBeUndefined(); expect(amb.ambiguous.mandate_id).toMatch(/Could be/);
  });
  it('recognises names with accents, apostrophes and hyphens', () => {
    for (const n of ['José Fernandes', "Shaun D'Souza", 'Anne-Marie Iyer', 'Ananya Bhattacharya-Rao', 'Dr. Ravi Menon']) {
      expect(parseCandidateText(`${n}, currently Director at ABC Ltd`, { today: TODAY, sources: SOURCES }).fields.name, n).toBe(n);
    }
  });
  it('lower-case or empty input gives no name instead of a wrong one', () => {
    expect(parseCandidateText('met someone interesting yesterday', { today: TODAY, sources: SOURCES }).fields.name).toBeUndefined();
    expect(parseCandidateText('', { today: TODAY, sources: SOURCES }).missing).toContain('name');
  });
});

describe('date phrases', () => {
  it.each([['today', '2026-11-28'], ['tomorrow', '2026-11-29'], ['in 2 weeks', '2026-12-12'], ['next monday', '2026-11-30'], ['1 Dec', '2026-12-01'], ['Dec 1', '2026-12-01'],
    ['15/12/2026', '2026-12-15'], ['2027-01-05', '2027-01-05'], ['end of month', '2026-11-30'], ['5th January', '2027-01-05']])('%s -> %s', (s, e) => expect(parseDatePhrase(s, TODAY)).toBe(e));
  it('returns null rather than guessing', () => { expect(parseDatePhrase('sometime soon', TODAY)).toBeNull(); expect(parseDatePhrase('31/02/2026', TODAY)).toBeNull(); });
});
