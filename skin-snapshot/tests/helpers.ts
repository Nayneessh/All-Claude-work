import { questionsFor, type Answers } from '../src/core/questionnaire';
import type { AiResult } from '../src/core/ai-schema';
import { FINDINGS, PATH_ATTRIBUTES, ZONE_ATTRIBUTES, allowedSides, CONFIDENCES, type PathId } from '../src/core/types';
import type { RoutineTemplate } from '../src/core/routine';

export function validAnswers(path: PathId): Answers {
  const a: Answers = {};
  for (const q of questionsFor(path)) {
    // First non-risky option: for yes/no health questions that is "no".
    if (q.options.includes('no') && q.options.includes('yes')) a[q.id] = 'no';
    else if (q.id === 'mark_type') a[q.id] = ['flat'];
    else if (q.id === 'pregnant_bf') a[q.id] = 'no';
    else if (q.id === 'medicines') a[q.id] = 'none';
    else if (q.kind === 'multi') a[q.id] = [q.options[0]!];
    else a[q.id] = q.options[0]!;
  }
  if (path === 'maintenance') a.time_per_day = 'two_steps';
  return a;
}

/** Deterministic pseudo-random for reproducible fuzz. */
function rng(seed: number) {
  let s = seed + 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function makeAiResult(path: PathId, seed = 0): AiResult {
  const r = rng(seed);
  const observations: AiResult['observations'] = [];
  for (const attribute of PATH_ATTRIBUTES[path]) {
    for (const zone of ZONE_ATTRIBUTES[attribute]) {
      const conf = CONFIDENCES[Math.floor(r() * 4)]!;
      const sides = allowedSides(zone);
      const side = sides[Math.floor(r() * sides.length)]!;
      if (conf === 'not_assessed') {
        observations.push({ zone, attribute, finding: 'not_assessed', side, confidence: conf, reason: 'photo_blurry' });
      } else {
        const list = FINDINGS[attribute] as readonly string[];
        observations.push({ zone, attribute, finding: list[Math.floor(r() * list.length)]!, side, confidence: conf, reason: 'none' });
      }
    }
  }
  return {
    image_quality: { overall: 'good', issues: [] },
    observations,
    best_fit_path: path,
    best_fit_confidence: 'likely',
    red_flags: [],
  };
}

const item = (category: any, en: string, hi: string) => ({ category, text_en: en, text_hi: hi });
export const SAMPLE_TEMPLATES: RoutineTemplate[] = [];
for (const steps of [2, 3] as const) {
  for (const feel of ['dry', 'balanced', 'oily'] as const) {
    for (const sensitivity of ['low', 'high'] as const) {
      SAMPLE_TEMPLATES.push({
        id: `sample-${steps}-${feel}-${sensitivity}`,
        name: `Sample ${steps} steps ${feel} ${sensitivity}`,
        steps,
        skin_feel: feel,
        sensitivity,
        budget_bands: [],
        approved: false,
        sample: true,
        items: [
          item('cleanser', 'A gentle face cleanser.', 'एक सौम्य फ़ेस क्लींज़र।'),
          item('moisturiser', 'A light moisturiser.', 'एक हल्का मॉइस्चराइज़र।'),
          ...(steps === 3 ? [item('sunscreen', 'A daily sunscreen.', 'रोज़ लगाने वाला सनस्क्रीन।')] : []),
        ],
      });
    }
  }
}
