import type { PageText } from './types';

/**
 * Blind representation (plan §11.3): remove identity and protected attributes before any assessment sees the CV.
 * Gender, age, religion, marital status and similar fields are never inputs to scoring, and names/contact details
 * are replaced with neutral tokens so a model cannot infer protected characteristics from them.
 * Evidence quotes are still verified against the original text, so redaction never weakens traceability.
 */

export interface RedactionResult { pages: PageText[]; redactions: string[] }

// Label-style lines only ("Gender: Male"). Requiring a colon keeps ordinary CV bullets such as
// "Single-source negotiation..." or "Age-verification project" intact. A dash is accepted only after the
// unambiguous multi-word labels (date of birth, marital status), never after single words like "age".
const LABEL = String.raw`\s*:`;
const DASH_OK = String.raw`\s*[:\-–—]`;
const PROTECTED_FIELD = [
  ['date of birth / age', new RegExp(String.raw`^\s*(?:date of birth|d\.?o\.?b\.?|birth ?date)${DASH_OK}[^\n]*$|^\s*age${LABEL}[^\n]*$|^\s*born\s+(?:on|in)\s+\d[^\n]*$`, 'gim')],
  ['gender / sex', new RegExp(String.raw`^\s*(?:gender|sex)${LABEL}[^\n]*$`, 'gim')],
  ['marital status', new RegExp(String.raw`^\s*(?:marital status|family status)${DASH_OK}[^\n]*$|^\s*(?:spouse|husband|wife|children)${LABEL}[^\n]*$|^\s*(?:married|unmarried|single|divorced|widowed)\s*$`, 'gim')],
  ['religion / caste', new RegExp(String.raw`^\s*(?:religion|caste|community|ethnicity)${LABEL}[^\n]*$`, 'gim')],
  ["father's / mother's name", new RegExp(String.raw`^\s*(?:father'?s? name|mother'?s? name)${LABEL}[^\n]*$|^\s*(?:son of|daughter of|s\/o|d\/o|w\/o)\b[^\n]*$`, 'gim')],
  ['photograph reference', new RegExp(String.raw`^\s*(?:photograph|photo)${LABEL}[^\n]*$`, 'gim')],
] as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin|github|facebook|instagram|twitter|x)\.com\/[^\s)]+/gi;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redactProtected(pages: PageText[], candidateName?: string): RedactionResult {
  const redactions = new Set<string>();
  const nameTokens = (candidateName ?? '').split(/\s+/).filter((t) => t.length >= 3);

  const out = pages.map((p) => {
    let text = p.text;
    for (const [label, re] of PROTECTED_FIELD) {
      text = text.replace(re, () => { redactions.add(`${label} removed`); return '[REDACTED]'; });
    }
    text = text.replace(EMAIL, () => { redactions.add('email replaced'); return '[EMAIL]'; });
    text = text.replace(PROFILE_URL, () => { redactions.add('profile URL replaced'); return '[URL]'; });
    text = text.replace(PHONE, (m) => {
      // Do not eat year ranges such as "2015 - 2019" or long numbers in achievements: require a plausible phone shape.
      const digits = m.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) return m;
      redactions.add('phone replaced');
      return '[PHONE]';
    });
    if (candidateName && candidateName.trim()) {
      const full = new RegExp(escapeRe(candidateName.trim()).replace(/\s+/g, '\\s+'), 'gi');
      text = text.replace(full, () => { redactions.add('name replaced'); return '[CANDIDATE]'; });
      for (const t of nameTokens) {
        text = text.replace(new RegExp(`\\b${escapeRe(t)}\\b`, 'gi'), () => { redactions.add('name replaced'); return '[CANDIDATE]'; });
      }
    }
    return { page: p.page, text };
  });

  return { pages: out, redactions: [...redactions].sort() };
}
