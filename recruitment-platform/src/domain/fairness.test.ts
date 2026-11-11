import { describe, expect, it } from 'vitest';
import { redactProtected } from './fairness';

const cv = `Rahul Sharma
Email: rahul.sharma@example.com | Phone: +91 98765 43210
linkedin.com/in/rahulsharma
Date of Birth: 12 May 1978
Gender: Male
Marital Status: Married
Religion: Hindu

EXPERIENCE
VP Procurement, Acme (2015 - 2019)
Single-source negotiation across 40 suppliers saved ₹12 crore. Rahul led the programme.
Age-verification platform rollout.
Managed spend of 650000000 annually.`;

describe('redactProtected', () => {
  const r = redactProtected([{ page: 1, text: cv }], 'Rahul Sharma');
  const t = r.pages[0].text;

  it('removes protected attribute lines', () => {
    for (const s of ['12 May 1978', 'Male', 'Married', 'Hindu']) expect(t).not.toContain(s);
  });
  it('replaces name, email, phone and profile URLs with neutral tokens', () => {
    expect(t).not.toMatch(/Rahul|Sharma|example\.com|98765|linkedin/i);
    expect(t).toContain('[CANDIDATE]');
  });
  it('keeps role-relevant evidence intact, including look-alike bullets', () => {
    expect(t).toContain('Single-source negotiation across 40 suppliers saved ₹12 crore');
    expect(t).toContain('Age-verification platform rollout');
    expect(t).toContain('VP Procurement, Acme (2015 - 2019)');
    expect(t).toContain('650000000');
  });
  it('reports what it removed, for the audit record', () => {
    expect(r.redactions).toEqual(expect.arrayContaining(['name replaced', 'email replaced', 'phone replaced', 'gender / sex removed']));
  });
  it('preserves page numbers', () => {
    expect(redactProtected([{ page: 3, text: 'x' }]).pages[0].page).toBe(3);
  });
});
