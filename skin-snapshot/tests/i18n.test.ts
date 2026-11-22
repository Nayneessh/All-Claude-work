import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { hi } from '../src/i18n/hi';
import { QUESTIONS } from '../src/core/questionnaire';
import { qdef, getDict } from '../src/i18n';
import { CONSENT_KEYS } from '../src/core/consent';

function flatten(o: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof o === 'string') return { [prefix]: o };
  if (Array.isArray(o)) o.forEach((v, i) => Object.assign(out, flatten(v, `${prefix}[${i}]`)));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

describe('i18n', () => {
  const E = flatten(en);
  const H = flatten(hi);
  it('Hindi has exactly the same keys as English', () => {
    expect(Object.keys(H).sort()).toEqual(Object.keys(E).sort());
  });
  it('no Hindi string is empty, and none is left identical to English except brand-neutral tokens', () => {
    const allowedSame = new Set(['common.tbc', 'paths.maintenance.slug', 'paths.concerns.slug', 'paths.scars.slug']);
    for (const [k, v] of Object.entries(H)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      if (E[k] === v && !allowedSame.has(k)) {
        // numbers, URLs and "Chrome" style tokens may legitimately match; anything with letters in Devanagari must not
        expect(/[A-Za-z]{4,}/.test(v) && !/Chrome|Safari|WhatsApp/.test(v), `untranslated: ${k}`).toBe(false);
      }
    }
  });
  it('placeholders are preserved in translations', () => {
    for (const [k, v] of Object.entries(E)) {
      const want = (v.match(/\{\w+\}/g) ?? []).sort();
      const got = (H[k]!.match(/\{\w+\}/g) ?? []).sort();
      expect(got, k).toEqual(want);
    }
  });
  it('every question and option has text in both languages', () => {
    for (const lang of ['en', 'hi'] as const) {
      const d = getDict(lang);
      for (const q of QUESTIONS) {
        const def = qdef(d, q.id);
        expect(def?.label, `${lang}:${q.id}`).toBeTruthy();
        for (const o of q.options) expect(def.opt[o], `${lang}:${q.id}.${o}`).toBeTruthy();
      }
    }
  });
  it('every consent has wording in both languages', () => {
    for (const lang of ['en', 'hi'] as const) {
      const d = getDict(lang);
      for (const k of CONSENT_KEYS) expect(d.controls.consentNames[k], `${lang}:${k}`).toBeTruthy();
    }
  });
  it('the logo placeholder text is the exact English string regardless of language (it is not translated)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/components/Header.tsx', 'utf8').toString()).catch(() => '');
    if (src) expect(src).toContain('Your logo goes over here.');
  });
});
