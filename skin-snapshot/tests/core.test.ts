import { describe, expect, it } from 'vitest';
import { evaluateGateA, evaluateGateB, combineSafety, routineRestrictions } from '../src/core/safety';
import { answersSchema, questionsFor, missingQuestions } from '../src/core/questionnaire';
import { PATHS, expectedGrid, FINDINGS, ZONE_ATTRIBUTES, ATTRIBUTES, ZONES, CONFIDENCES } from '../src/core/types';
import { parseAiResult, normaliseObservations, mergePasses, OutputValidationError } from '../src/core/validate-output';
import { PHRASES, missingPhraseKeys, phrase } from '../src/core/phrases';
import { scanText, scanAll } from '../src/core/lexicon';
import { composeSnapshot, snapshotPhraseKeys } from '../src/core/snapshot';
import { selectRoutine, type RoutineTemplate } from '../src/core/routine';
import { buildWhatsappMessage, bookingSchema, firstNameOf, normaliseWhatsapp, whatsappLink, bookableDays } from '../src/core/booking';
import { generateCaseCode, isCaseCode, generateToken, isToken, sha256Hex } from '../src/core/ids';
import { isExpired, DEFAULT_RETENTION } from '../src/core/retention';
import { laplacianVariance, lumaStats, lightProblems, sharpnessNormalised, THRESHOLDS } from '../src/core/vision-metrics';
import { evaluateFrame, eulerFromMatrix, noseRatio, signedYaw, allPass, primaryInstruction, type Pt } from '../src/core/pose';
import { makeAiResult, validAnswers, SAMPLE_TEMPLATES } from './helpers';

describe('Gate A (answers)', () => {
  it('passes a clean maintenance questionnaire', () => {
    const r = evaluateGateA('maintenance', validAnswers('maintenance'));
    expect(r.stop).toBe(false);
    expect(r.flags).toEqual([]);
  });

  it.each([
    ['mole_changing', 'changing_mole'],
    ['sore_not_healing', 'non_healing_sore'],
    ['infection_signs', 'infection_signs'],
    ['severe_inflammation', 'severe_inflammation'],
    ['eye_area_problem', 'eye_area_problem'],
  ])('stops every path on %s=yes', (question, flag) => {
    for (const path of PATHS) {
      const r = evaluateGateA(path, { ...validAnswers(path), [question]: 'yes' });
      expect(r.stop, `${path}:${question}`).toBe(true);
      expect(r.flags.map((f) => f.code)).toContain(flag);
    }
  });

  it('applies the stricter concerns-only screen', () => {
    for (const q of ['rapid_worsening', 'painful_lumps', 'bleeding_or_oozing']) {
      expect(evaluateGateA('concerns', { ...validAnswers('concerns'), [q]: 'yes' }).stop).toBe(true);
    }
    // Those questions do not exist on other paths, so they cannot stop them.
    expect(questionsFor('maintenance').some((q) => q.id === 'rapid_worsening')).toBe(false);
  });

  it('sends raised or changing marks straight to referral (scars path)', () => {
    expect(evaluateGateA('scars', { ...validAnswers('scars'), mark_type: ['flat', 'raised'] }).stop).toBe(true);
    expect(evaluateGateA('scars', { ...validAnswers('scars'), marks_changing: 'yes' }).stop).toBe(true);
    expect(evaluateGateA('scars', validAnswers('scars')).stop).toBe(false);
  });

  it('restricts routine advice for pregnancy, breastfeeding, unknown, or medicines, without stopping', () => {
    for (const v of ['pregnant', 'breastfeeding', 'prefer_not']) {
      const r = evaluateGateA('concerns', { ...validAnswers('concerns'), pregnant_bf: v });
      expect(r.stop).toBe(false);
      expect(r.restrictions).toContain('no_routine');
    }
    expect(routineRestrictions({ ...validAnswers('concerns'), medicines: 'prescription_tablets' })).toContain('no_routine');
    expect(routineRestrictions(validAnswers('concerns'))).toEqual([]);
  });

  it('every red-flag question on every path is covered by a rule (no silent gaps)', () => {
    for (const path of PATHS) {
      for (const q of questionsFor(path, 'health')) {
        const flagged = evaluateGateA(path, { ...validAnswers(path), [q.id]: 'yes' }).stop;
        expect(flagged, `${path}:${q.id}`).toBe(true);
      }
    }
  });
});

describe('Gate B (image)', () => {
  it('over-flags by default: even a "not_sure" report stops the flow', () => {
    expect(evaluateGateB([{ code: 'lesion_visible', confidence: 'not_sure' }]).stop).toBe(true);
  });
  it('can be configured to require higher confidence', () => {
    expect(evaluateGateB([{ code: 'lesion_visible', confidence: 'not_sure' }], 'likely').stop).toBe(false);
    expect(evaluateGateB([{ code: 'lesion_visible', confidence: 'likely' }], 'likely').stop).toBe(true);
  });
  it('combines with Gate A', () => {
    const a = evaluateGateA('maintenance', validAnswers('maintenance'));
    const b = evaluateGateB([{ code: 'infection_signs', confidence: 'clear' }]);
    const s = combineSafety(a, b);
    expect(s.stopped).toBe(true);
    expect(s.flags[0]!.source).toBe('image');
  });
});

describe('questionnaire validation', () => {
  it('has different questions per path', () => {
    const ids = PATHS.map((p) => questionsFor(p).map((q) => q.id).join(','));
    expect(new Set(ids).size).toBe(3);
  });
  it('accepts valid answers and rejects unknown keys, bad values and exclusive conflicts', () => {
    for (const p of PATHS) expect(answersSchema(p).safeParse(validAnswers(p)).success).toBe(true);
    expect(answersSchema('maintenance').safeParse({ ...validAnswers('maintenance'), extra: 'x' }).success).toBe(false);
    expect(answersSchema('maintenance').safeParse({ ...validAnswers('maintenance'), skin_feel: 'purple' }).success).toBe(false);
    expect(answersSchema('maintenance').safeParse({ ...validAnswers('maintenance'), current_products: ['none', 'serum'] }).success).toBe(false);
    expect(answersSchema('maintenance').safeParse({ ...validAnswers('maintenance'), budget: undefined }).success).toBe(false);
  });
  it('detects which questions a path switch still needs', () => {
    const missing = missingQuestions('concerns', validAnswers('maintenance')).map((q) => q.id);
    expect(missing).toContain('pregnant_bf');
    expect(missing).toContain('rapid_worsening');
    expect(missing).not.toContain('budget');
  });
});

describe('AI output validation (closed vocabulary)', () => {
  it('accepts a well-formed result', () => {
    expect(() => parseAiResult(makeAiResult('maintenance'))).not.toThrow();
  });
  it.each([
    ['a diagnosis field', (r: any) => ({ ...r, diagnosis: 'acne' })],
    ['a score field', (r: any) => ({ ...r, skin_score: 87 })],
    ['a skin age field', (r: any) => ({ ...r, skin_age: 31 })],
    ['a hydration field', (r: any) => ({ ...r, hydration: 'low' })],
    ['free text in a finding', (r: any) => { r.observations[0].finding = 'looks like melasma'; return r; }],
    ['a finding from another attribute', (r: any) => { r.observations[0].finding = 'many'; return r; }],
    ['an attribute reported for the wrong zone', (r: any) => { r.observations[0] = { ...r.observations[0], attribute: 'fine_lines', zone: 'nose', finding: 'faint' }; return r; }],
    ['a side that is not valid for the zone', (r: any) => { r.observations[0].side = 'left'; return r; }],
    ['not_assessed without a reason', (r: any) => { r.observations[0] = { ...r.observations[0], confidence: 'not_assessed', finding: 'not_assessed', reason: 'none' }; return r; }],
    ['an unknown red-flag code', (r: any) => ({ ...r, red_flags: [{ code: 'melanoma', confidence: 'likely' }] })],
    ['a product recommendation field', (r: any) => ({ ...r, products: ['X cream'] })],
    ['a percentage as a string value', (r: any) => { r.observations[0].confidence = '80%'; return r; }],
  ])('rejects %s', (_name, mutate) => {
    const r = mutate(makeAiResult('maintenance'));
    expect(() => parseAiResult(r)).toThrow(OutputValidationError);
  });

  it('fills missing grid cells as not assessed and drops rows the path does not assess', () => {
    const r = makeAiResult('maintenance');
    r.observations = r.observations.slice(0, 5);
    r.observations.push({ zone: 'cheeks', attribute: 'breakouts', finding: 'many', side: 'both', confidence: 'clear', reason: 'none' });
    const rows = normaliseObservations(parseAiResult(r), 'maintenance');
    expect(rows).toHaveLength(expectedGrid('maintenance').length);
    expect(rows.some((x) => x.attribute === 'breakouts')).toBe(false);
    expect(rows.filter((x) => x.confidence === 'not_assessed').length).toBeGreaterThan(0);
    expect(rows.filter((x) => x.confidence === 'not_assessed').every((x) => x.reason && x.finding === null)).toBe(true);
  });

  it('merging passes downgrades disagreement to "not sure" and unions red flags', () => {
    const a = makeAiResult('concerns');
    const b = makeAiResult('concerns');
    const rowA = a.observations.find((o) => o.attribute === 'breakouts' && o.zone === 'cheeks')!;
    Object.assign(rowA, { finding: 'few_small', confidence: 'clear', reason: 'none' });
    const row = b.observations.find((o) => o.attribute === 'breakouts' && o.zone === 'cheeks')!;
    Object.assign(row, { finding: 'many', confidence: 'clear', reason: 'none' });
    b.red_flags = [{ code: 'lesion_visible', confidence: 'not_sure' }];
    const m = mergePasses([parseAiResult(a), parseAiResult(b)], 'concerns');
    const merged = m.observations.find((o) => o.attribute === 'breakouts' && o.zone === 'cheeks')!;
    expect(merged.confidence).toBe('not_sure');
    expect(m.redFlags.map((f) => f.code)).toContain('lesion_visible');
    expect(m.disagreements).toBeGreaterThan(0);
  });
});

describe('phrase library and banned terms', () => {
  it('has every phrase in English and Hindi', () => {
    expect(missingPhraseKeys()).toEqual([]);
  });
  it('has a phrase for every finding, zone, attribute, side, confidence and reason', () => {
    for (const attr of ATTRIBUTES) for (const f of FINDINGS[attr]) expect(PHRASES.en[`obs.${attr}.${f}`], `${attr}.${f}`).toBeTruthy();
    for (const z of ZONES) expect(PHRASES.hi[`zone.${z}`]).toBeTruthy();
    for (const c of CONFIDENCES) expect(PHRASES.hi[`conf.${c}`]).toBeTruthy();
  });
  it('contains no condition name, score, skin age, hydration claim or digit in any phrase (EN and HI)', () => {
    for (const lang of ['en', 'hi'] as const) {
      for (const [key, text] of Object.entries(PHRASES[lang])) {
        const hits = scanText(text, { numeric: true });
        expect(hits, `${lang}:${key} -> ${text}`).toEqual([]);
      }
    }
  });
  it('the scanner itself catches what it should', () => {
    for (const bad of ['This looks like acne', 'Possible melasma', 'Skin age: 34', 'Hydration is low', 'Score 7 out of 10', '45% oily', 'a diagnosis of rosacea']) {
      expect(scanText(bad, { numeric: true }).length, bad).toBeGreaterThan(0);
    }
    for (const bad of ['यह मुँहासे जैसा है', 'झाइयाँ दिख रही हैं', 'त्वचा की उम्र 30 वर्ष', 'कैंसर']) {
      expect(scanText(bad, { numeric: true }).length, bad).toBeGreaterThan(0);
    }
    expect(scanText('Slightly uneven texture on both cheeks', { numeric: true })).toEqual([]);
  });
});

describe('snapshot composition and safety invariants', () => {
  const base = (path: any, over: any = {}) => {
    const answers = validAnswers(path);
    const gate = evaluateGateA(path, answers);
    const ai = parseAiResult(makeAiResult(path));
    const m = mergePasses([ai], path);
    return composeSnapshot({
      path,
      answers,
      safety: combineSafety(gate),
      observations: m.observations,
      bestFit: m.bestFit,
      quality: m.quality.overall,
      templates: SAMPLE_TEMPLATES,
      allowSampleRoutines: true,
      ...over,
    });
  };

  it('maintenance: routine from a template, optional talk', () => {
    const vm = base('maintenance');
    expect(vm.stopped).toBe(false);
    expect(vm.routine?.template.steps).toBe(2);
    expect(vm.routine?.status).toBe('sample');
    expect(vm.nextStep).toBe('optional_talk');
    expect(vm.showBooking).toBe(true);
  });
  it('concerns and scars: no routine, talk recommended', () => {
    for (const p of ['concerns', 'scars'] as const) {
      const vm = base(p);
      expect(vm.routine).toBeNull();
      expect(vm.routineHeld).toBe('not_maintenance');
      expect(vm.nextStep).toBe('recommended_talk');
      expect(vm.expectKey).toBe(`expect.${p}`);
    }
  });
  it('INVARIANT: a stopped case has no observations, no routine, no booking prompt', () => {
    for (const path of PATHS) {
      const answers = { ...validAnswers(path), mole_changing: 'yes' };
      const gate = evaluateGateA(path, answers);
      const vm = composeSnapshot({
        path, answers, safety: combineSafety(gate), observations: [], bestFit: { path, confidence: 'clear' },
        quality: 'good', templates: SAMPLE_TEMPLATES, allowSampleRoutines: true,
      });
      expect(vm.stopped).toBe(true);
      expect(vm.routine).toBeNull();
      expect(vm.showBooking).toBe(false);
      expect(vm.zones).toEqual([]);
      expect(vm.nextStep).toBe('see_dermatologist');
    }
  });
  it('INVARIANT: an image red flag stops an otherwise clean case', () => {
    const answers = validAnswers('maintenance');
    const vm = composeSnapshot({
      path: 'maintenance', answers,
      safety: combineSafety(evaluateGateA('maintenance', answers), evaluateGateB([{ code: 'open_wound_visible', confidence: 'not_sure' }])),
      observations: [], bestFit: { path: 'maintenance', confidence: 'clear' }, quality: 'good', templates: SAMPLE_TEMPLATES, allowSampleRoutines: true,
    });
    expect(vm.stopped).toBe(true);
    expect(vm.safetySource).toBe('image');
    expect(vm.routine).toBeNull();
  });
  it('holds the routine when pregnancy/medicine answers restrict it', () => {
    const answers = { ...validAnswers('maintenance'), pregnant_bf: 'pregnant' };
    const vm = base('maintenance', { answers, safety: combineSafety(evaluateGateA('maintenance', answers)) });
    expect(vm.routine).toBeNull();
    expect(vm.routineHeld).toBe('restriction');
  });
  it('holds the routine when photos fit another path better (stricter questions not yet asked)', () => {
    const vm = base('maintenance', { bestFit: { path: 'concerns', confidence: 'likely' } });
    expect(vm.pathMismatch).toBe(true);
    expect(vm.routine).toBeNull();
    expect(vm.routineHeld).toBe('path_mismatch');
  });
  it('shows no routine at all when only unapproved templates exist and samples are off', () => {
    const vm = base('maintenance', { allowSampleRoutines: false });
    expect(vm.routine).toBeNull();
    expect(vm.routineHeld).toBe('no_template');
  });
  it('FUZZ: 300 random model outputs never put a banned term, digit or condition name into the rendered snapshot', () => {
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const path = PATHS[i % 3]!;
      const vm = base(path, { observations: mergePasses([parseAiResult(makeAiResult(path, i))], path).observations });
      for (const lang of ['en', 'hi'] as const) {
        const texts = snapshotPhraseKeys(vm).map((k) => phrase(lang, k));
        expect(scanAll(texts, { numeric: true }), `seed ${i} ${lang}`).toEqual([]);
      }
      n++;
    }
    expect(n).toBe(300);
  });
});

describe('routine selection', () => {
  it('uses only approved templates unless samples are allowed, and prefers approved over sample', () => {
    const answers = validAnswers('maintenance');
    expect(selectRoutine(SAMPLE_TEMPLATES, answers, { allowSamples: false })).toBeNull();
    const approved: RoutineTemplate = { ...SAMPLE_TEMPLATES[0]!, id: 'x', approved: true, sample: false };
    expect(selectRoutine([...SAMPLE_TEMPLATES, approved], answers, { allowSamples: true })?.status).toBe('approved');
  });
  it('matches steps, skin feel and sensitivity', () => {
    const a = { ...validAnswers('maintenance'), time_per_day: 'three_steps', skin_feel: 'oily_all', sensitivity: 'often' };
    const r = selectRoutine(SAMPLE_TEMPLATES, a, { allowSamples: true });
    expect(r?.template.steps).toBe(3);
    expect(r?.template.skin_feel).toBe('oily');
    expect(r?.template.sensitivity).toBe('high');
  });
});

describe('booking and WhatsApp hand-off', () => {
  it('message contains only first name and case code', () => {
    const code = generateCaseCode();
    for (const lang of ['en', 'hi'] as const) {
      const msg = buildWhatsappMessage(lang, firstNameOf('Priya Sharma'), code);
      expect(msg).toContain('Priya');
      expect(msg).toContain(code);
      expect(msg).not.toContain('Sharma');
      expect(msg).not.toMatch(/https?:|\/case\/|photo|answer/i);
    }
    expect(whatsappLink('+919876543210', 'Hello')).toBe('https://wa.me/919876543210?text=Hello');
  });
  it('validates numbers with country code and rejects junk', () => {
    expect(normaliseWhatsapp('+91 98765 43210')).toBe('+919876543210');
    expect(normaliseWhatsapp('+14155552671')).toBe('+14155552671');
    expect(normaliseWhatsapp('12345')).toBeNull();
    expect(normaliseWhatsapp('hello')).toBeNull();
  });
  it('offers the next seven days and requires contact consent', () => {
    expect(bookableDays(new Date('2026-11-22T10:00:00Z'))).toHaveLength(7);
    expect(bookableDays(new Date('2026-11-22T10:00:00Z'))[0]).toBe('2026-11-23');
    const ok = { name: 'Priya', whatsapp: '+919876543210', day: '2026-11-23', window: 'morning', method: 'chat', contactConsent: true };
    expect(bookingSchema.safeParse(ok).success).toBe(true);
    expect(bookingSchema.safeParse({ ...ok, contactConsent: false }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...ok, window: 'midnight' }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...ok, name: '<script>' }).success).toBe(false);
  });
});

describe('identifiers and retention', () => {
  it('case codes are well-formed and distinct; tokens are 256-bit', async () => {
    const codes = new Set(Array.from({ length: 2000 }, generateCaseCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(isCaseCode(c)).toBe(true);
    const t = generateToken();
    expect(isToken(t)).toBe(true);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('unbooked cases expire after 72 hours; booked cases 90 days after closure', () => {
    const created = new Date('2026-11-01T00:00:00Z');
    expect(isExpired({ createdAt: created, booked: false, closedAt: null }, DEFAULT_RETENTION, new Date('2026-11-03T23:00:00Z'))).toBe(false);
    expect(isExpired({ createdAt: created, booked: false, closedAt: null }, DEFAULT_RETENTION, new Date('2026-11-04T00:01:00Z'))).toBe(true);
    expect(isExpired({ createdAt: created, booked: true, closedAt: null }, DEFAULT_RETENTION, new Date('2027-06-01T00:00:00Z'))).toBe(false);
    expect(isExpired({ createdAt: created, booked: true, closedAt: new Date('2026-11-10T00:00:00Z') }, DEFAULT_RETENTION, new Date('2027-02-07T23:00:00Z'))).toBe(false);
    expect(isExpired({ createdAt: created, booked: true, closedAt: new Date('2026-11-10T00:00:00Z') }, DEFAULT_RETENTION, new Date('2027-02-08T00:01:00Z'))).toBe(true);
  });
});

describe('image metrics', () => {
  const flat = (v: number, w = 64, h = 64) => new Uint8ClampedArray(w * h).fill(v);
  const noisy = (base: number, amp: number, w = 64, h = 64) => {
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < a.length; i++) a[i] = base + (((i * 7919) % 13) - 6) * amp;
    return a;
  };
  it('sharpness separates textured from flat images', () => {
    expect(laplacianVariance(flat(120), 64, 64)).toBe(0);
    expect(sharpnessNormalised(noisy(120, 8), 64, 64)).toBeGreaterThan(THRESHOLDS.sharpMin);
    expect(sharpnessNormalised(flat(120), 64, 64)).toBeLessThan(THRESHOLDS.sharpMin);
  });
  it('sharpness does not depend on skin tone or exposure: the same texture at 40% brightness scores the same', () => {
    const bright = noisy(170, 8);
    const dark = Uint8ClampedArray.from(bright, (v) => v * 0.4);
    const a = sharpnessNormalised(bright, 64, 64);
    const b = sharpnessNormalised(dark, 64, 64);
    expect(Math.abs(a - b) / a).toBeLessThan(0.1);
    // plain Laplacian variance would have fallen to about 16% and been called blurry
    expect(laplacianVariance(dark, 64, 64) / laplacianVariance(bright, 64, 64)).toBeLessThan(0.25);
  });
  it('light check is relative: a dark-skinned face in good light is not "too dark"', () => {
    // darker skin: mean around 70, highlights reaching 120, with natural spread
    const g = new Uint8ClampedArray(64 * 64);
    for (let i = 0; i < g.length; i++) g[i] = 50 + ((i * 131) % 71);
    expect(lightProblems({ gray: g, w: 64, h: 64 })).toEqual([]);
  });
  it('flags a genuinely dim image, glare, side lighting and backlight', () => {
    expect(lightProblems({ gray: flat(25), w: 64, h: 64 })).toContain('too_dim');
    const glare = new Uint8ClampedArray(64 * 64).fill(250);
    expect(lightProblems({ gray: glare, w: 64, h: 64 })).toContain('too_bright');
    const side = new Uint8ClampedArray(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) side[y * 64 + x] = x < 32 ? 200 : 70 + ((x * y) % 40);
    expect(lightProblems({ gray: side, w: 64, h: 64 })).toContain('uneven');
    const dimFace = new Uint8ClampedArray(64 * 64);
    for (let i = 0; i < dimFace.length; i++) dimFace[i] = 40 + ((i * 17) % 60);
    expect(lightProblems({ gray: dimFace, w: 64, h: 64 }, 220)).toContain('backlit');
  });
  it('luma stats', () => {
    const s = lumaStats(Uint8ClampedArray.from([0, 0, 255, 255, 100]));
    expect(s.clipFraction).toBeCloseTo(0.4);
  });
});

// Build a synthetic 478-point face. yawDeg > 0 means the left cheek is turned toward the camera.
function face(opts: { cx?: number; cy?: number; h?: number; yawDeg?: number; rollDeg?: number } = {}): Pt[] {
  const { cx = 0.5, cy = 0.5, h = 0.6, yawDeg = 0, rollDeg = 0 } = opts;
  const lm: Pt[] = Array.from({ length: 478 }, () => ({ x: cx, y: cy }));
  const halfW = h * 0.38;
  const yaw = (yawDeg * Math.PI) / 180;
  const roll = (rollDeg * Math.PI) / 180;
  const rot = (x: number, y: number): Pt => ({ x: cx + x * Math.cos(roll) - y * Math.sin(roll), y: cy + x * Math.sin(roll) + y * Math.cos(roll) });
  lm[10] = rot(0, -h / 2);
  lm[152] = rot(0, h / 2);
  lm[234] = rot(-halfW * Math.cos(yaw), 0);
  lm[454] = rot(halfW * Math.cos(yaw), 0);
  // nose moves toward image-left (negative x) for positive yaw
  lm[1] = rot(-halfW * Math.sin(yaw) * 1.1, h * 0.05);
  lm[33] = rot(-halfW * 0.6, -h * 0.1);
  lm[263] = rot(halfW * 0.6, -h * 0.1);
  return lm;
}
const matrix = (yawDeg: number, pitchDeg = 0, rollDeg = 0): number[] => {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180, r = (rollDeg * Math.PI) / 180;
  // R = Ry * Rx * Rz, returned column-major 4x4
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
  const R = [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
  return [R[0]![0]!, R[1]![0]!, R[2]![0]!, 0, R[0]![1]!, R[1]![1]!, R[2]![1]!, 0, R[0]![2]!, R[1]![2]!, R[2]![2]!, 0, 0, 0, 0, 1];
};

describe('pose and live-guidance checks', () => {
  const good = { lightProblems: [] as never[], blur: 200 };
  it('recovers yaw, pitch and roll from a transform matrix', () => {
    const e = eulerFromMatrix(matrix(40, 5, 3));
    expect(e.yaw).toBeCloseTo(40, 0);
    expect(e.pitch).toBeCloseTo(5, 0);
    expect(e.roll).toBeCloseTo(3, 0);
  });
  it('takes the sign of the turn from the landmarks', () => {
    expect(noseRatio(face({ yawDeg: 0 }))).toBeCloseTo(0.5, 2);
    expect(signedYaw(face({ yawDeg: 45 }), matrix(45))).toBeGreaterThan(30);
    expect(signedYaw(face({ yawDeg: -45 }), matrix(-45))).toBeLessThan(-30);
  });
  it('front shot: passes when centred, near, level and facing forward', () => {
    const r = evaluateFrame({ slot: 'front', faces: [face()], matrix: matrix(2), ...good });
    expect(allPass(r)).toBe(true);
  });
  it('gives a specific instruction for each failure', () => {
    const code = (over: object, slot: any = 'front') => primaryInstruction(evaluateFrame({ slot, faces: [face()], matrix: matrix(0), ...good, ...over }))?.code;
    expect(evaluateFrame({ slot: 'front', faces: [], ...good })[0]!.code).toBe('no_face');
    expect(code({ faces: [face(), face({ cx: 0.2 })] })).toBe('multiple_faces');
    expect(code({ faces: [face({ h: 0.25 })] })).toBe('too_far');
    expect(code({ faces: [face({ h: 0.95 })] })).toBe('too_close');
    expect(code({ faces: [face({ cx: 0.8 })] })).toBe('not_centered');
    expect(code({ lightProblems: ['too_dim'] })).toBe('too_dim');
    expect(code({ lightProblems: ['uneven'] })).toBe('uneven');
    expect(code({ blur: 5 })).toBe('blurry');
    expect(code({ steadyMove: 0.1 })).toBe('hold_still');
    expect(code({ faces: [face({ rollDeg: 20 })], matrix: matrix(0, 0, 20) })).toBe('level_head');
    expect(code({ faces: [face({ yawDeg: 25 })], matrix: matrix(25) })).toBe('face_forward');
    expect(code({ detailRatio: 0.005 })).toBe('possible_filter');
  });
  it('left shot wants the left cheek toward the camera at about 45 degrees; right shot the opposite', () => {
    const left = evaluateFrame({ slot: 'left', faces: [face({ yawDeg: 45 })], matrix: matrix(45), ...good });
    expect(allPass(left)).toBe(true);
    const leftWrong = evaluateFrame({ slot: 'left', faces: [face({ yawDeg: -45 })], matrix: matrix(-45), ...good });
    expect(primaryInstruction(leftWrong)?.code).toBe('turn_other_way');
    const right = evaluateFrame({ slot: 'right', faces: [face({ yawDeg: -45 })], matrix: matrix(-45), ...good });
    expect(allPass(right)).toBe(true);
    expect(primaryInstruction(evaluateFrame({ slot: 'left', faces: [face({ yawDeg: 15 })], matrix: matrix(15), ...good }))?.code).toBe('turn_more');
    expect(primaryInstruction(evaluateFrame({ slot: 'left', faces: [face({ yawDeg: 70 })], matrix: matrix(70), ...good }))?.code).toBe('turn_less');
  });
});
