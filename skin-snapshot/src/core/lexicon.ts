// Terms the snapshot must never contain. Applied to every string the visitor can read in the
// snapshot, in both languages, and to cosmetologist routine templates when they are saved.
//
// Educational pages may name conditions. The AI snapshot never does (blueprint section 4).

/** Condition names, diagnostic language and treatment claims. English, matched case-insensitively. */
export const BANNED_EN: readonly string[] = [
  'acne', 'melasma', 'rosacea', 'eczema', 'dermatitis', 'psoriasis', 'vitiligo', 'melanoma', 'carcinoma',
  'cancer', 'tumor', 'tumour', 'keloid', 'hyperpigmentation', 'hypopigmentation', 'folliculitis', 'cystic',
  'ringworm', 'scabies', 'impetigo', 'cellulitis', 'lupus', 'urticaria', 'hives', 'chloasma',
  'diagnos', 'disease', 'disorder', 'syndrome', 'prescri', 'medication', 'antibiotic', 'steroid', 'retinoid',
  'isotretinoin', 'hydroquinone', 'treatment plan', 'cure', 'hydration', 'hydrated', 'dehydrat', 'moisture level',
  'moisture content', 'skin age', 'skin-age', 'biological age', 'looks younger', 'years old', 'age of your skin',
];

/** Hindi (Devanagari). Matched as substrings. */
export const BANNED_HI: readonly string[] = [
  'मुँहासे', 'मुंहासे', 'मुहांसे', 'मुहासे', 'झाइयाँ', 'झाइयां', 'झांइयां', 'मेलाज़्मा', 'मेलास्मा', 'एक्ज़िमा', 'एक्जिमा',
  'सोरायसिस', 'कैंसर', 'मेलेनोमा', 'विटिलिगो', 'सफ़ेद दाग', 'सफेद दाग', 'रोसेशिया', 'बीमारी', 'निदान',
  'एंटीबायोटिक', 'स्टेरॉयड', 'रेटिनॉइड', 'इलाज', 'उपचार योजना', 'त्वचा की उम्र', 'नमी का स्तर',
];

/** Digits, percent signs and score-like words. Applied to AI-derived text only. */
const NUMERIC_CLAIM = /[0-9०-९]|%|percent|प्रतिशत|\bscor(?:e|ed|es|ing)\b|स्कोर/i;

export interface LexiconHit {
  term: string;
  kind: 'condition_or_claim' | 'numeric';
}

export function scanText(text: string, opts: { numeric: boolean }): LexiconHit[] {
  const hits: LexiconHit[] = [];
  const lower = text.toLowerCase();
  for (const term of BANNED_EN) if (lower.includes(term)) hits.push({ term, kind: 'condition_or_claim' });
  for (const term of BANNED_HI) if (text.includes(term)) hits.push({ term, kind: 'condition_or_claim' });
  if (opts.numeric) {
    const m = text.match(NUMERIC_CLAIM);
    if (m) hits.push({ term: m[0], kind: 'numeric' });
  }
  return hits;
}

export function scanAll(texts: readonly string[], opts: { numeric: boolean }): LexiconHit[] {
  return texts.flatMap((t) => scanText(t, opts));
}
