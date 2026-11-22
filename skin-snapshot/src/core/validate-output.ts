// Validation and merging of model output. Nothing from a provider reaches a visitor
// unless it passes through here.
import { aiResultSchema, type AiObservation, type AiResult } from './ai-schema';
import { evaluateGateB, type GateBResult } from './safety';
import {
  FINDINGS,
  PATH_ATTRIBUTES,
  ZONE_ATTRIBUTES,
  allowedSides,
  expectedGrid,
  type Attribute,
  type AssessedConfidence,
  type Confidence,
  type PathId,
  type Reason,
  type Zone,
} from './types';

export class OutputValidationError extends Error {
  constructor(
    public code: 'schema' | 'vocabulary' | 'matrix' | 'empty',
    message: string,
  ) {
    super(message);
  }
}

const key = (o: { zone: Zone; attribute: Attribute }) => `${o.zone}:${o.attribute}`;
const RANK: Record<Confidence, number> = { not_assessed: 0, not_sure: 1, likely: 2, clear: 3 };

/** Parse and enforce the closed vocabulary. Throws OutputValidationError on any violation. */
export function parseAiResult(raw: unknown): AiResult {
  const parsed = aiResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OutputValidationError('schema', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  for (const o of parsed.data.observations) {
    if (!ZONE_ATTRIBUTES[o.attribute].includes(o.zone)) {
      throw new OutputValidationError('matrix', `attribute ${o.attribute} is not reported for zone ${o.zone}`);
    }
    if (!allowedSides(o.zone).includes(o.side)) {
      throw new OutputValidationError('matrix', `side ${o.side} is not valid for zone ${o.zone}`);
    }
    if (o.confidence === 'not_assessed') {
      if (o.finding !== 'not_assessed' || o.reason === 'none') {
        throw new OutputValidationError('vocabulary', 'not_assessed needs finding=not_assessed and a reason');
      }
    } else {
      if (o.finding === 'not_assessed') throw new OutputValidationError('vocabulary', 'assessed observation without a finding');
      if (!(FINDINGS[o.attribute] as readonly string[]).includes(o.finding)) {
        throw new OutputValidationError('vocabulary', `finding ${o.finding} is not valid for ${o.attribute}`);
      }
    }
  }
  return parsed.data;
}

export interface NormalisedObservation {
  zone: Zone;
  attribute: Attribute;
  finding: string | null;
  side: AiObservation['side'];
  confidence: Confidence;
  reason: Reason | null;
}

/**
 * Reduce a validated result to exactly the grid a path asks for. Missing rows become
 * "not assessed"; rows from attributes the path does not assess are dropped; duplicates keep
 * the more cautious entry.
 */
export function normaliseObservations(result: AiResult, path: PathId): NormalisedObservation[] {
  const want = new Set(PATH_ATTRIBUTES[path]);
  const byKey = new Map<string, NormalisedObservation>();
  for (const o of result.observations) {
    if (!want.has(o.attribute)) continue;
    const next: NormalisedObservation = {
      zone: o.zone,
      attribute: o.attribute,
      finding: o.confidence === 'not_assessed' ? null : o.finding,
      side: o.side,
      confidence: o.confidence,
      reason: o.reason === 'none' ? null : (o.reason as Reason),
    };
    const prev = byKey.get(key(o));
    // Keep the lower confidence if the model repeated itself.
    if (!prev || RANK[next.confidence] < RANK[prev.confidence]) byKey.set(key(o), next);
  }
  const out: NormalisedObservation[] = [];
  for (const cell of expectedGrid(path)) {
    out.push(
      byKey.get(key(cell)) ?? {
        zone: cell.zone,
        attribute: cell.attribute,
        finding: null,
        side: allowedSides(cell.zone)[0]!,
        confidence: 'not_assessed',
        reason: 'zone_hidden',
      },
    );
  }
  return out;
}

/** Overall photo quality; poor quality should prompt a retake rather than a snapshot. */
export function qualityNeedsRetake(result: AiResult): boolean {
  return result.image_quality.overall === 'poor';
}

/**
 * Merge independent passes. Agreement keeps the finding. Disagreement on a finding turns the row
 * into "not sure" using the milder of the two findings, so one noisy pass cannot overstate it.
 * Red flags are the union across passes (over-flag by design).
 */
export function mergePasses(passes: readonly AiResult[], path: PathId): {
  observations: NormalisedObservation[];
  bestFit: { path: PathId; confidence: AssessedConfidence };
  redFlags: AiResult['red_flags'];
  quality: AiResult['image_quality'];
  disagreements: number;
} {
  if (passes.length === 0) throw new OutputValidationError('empty', 'no passes');
  const normalised = passes.map((p) => normaliseObservations(p, path));
  const base = normalised[0]!;
  let disagreements = 0;
  const merged = base.map((row, i): NormalisedObservation => {
    let out = row;
    for (let p = 1; p < normalised.length; p++) {
      const other = normalised[p]![i]!;
      out = mergeRow(out, other);
    }
    if (out !== row && (out.confidence !== row.confidence || out.finding !== row.finding)) disagreements++;
    return out;
  });

  const flagMap = new Map<string, AiResult['red_flags'][number]>();
  for (const p of passes) {
    for (const f of p.red_flags) {
      const prev = flagMap.get(f.code);
      if (!prev || RANK[f.confidence] > RANK[prev.confidence]) flagMap.set(f.code, f);
    }
  }

  const fits = passes.map((p) => p.best_fit_path);
  const agree = fits.every((f) => f === fits[0]);
  const worstFitConf = passes.map((p) => p.best_fit_confidence).sort((a, b) => RANK[a] - RANK[b])[0]!;
  const quality = passes
    .map((p) => p.image_quality)
    .sort((a, b) => ['good', 'fair', 'poor'].indexOf(b.overall) - ['good', 'fair', 'poor'].indexOf(a.overall))[0]!;

  return {
    observations: merged,
    bestFit: agree ? { path: fits[0]!, confidence: worstFitConf } : { path, confidence: 'not_sure' },
    redFlags: [...flagMap.values()],
    quality,
    disagreements,
  };
}

function mergeRow(a: NormalisedObservation, b: NormalisedObservation): NormalisedObservation {
  if (a.confidence === 'not_assessed' && b.confidence === 'not_assessed') return a;
  if (a.confidence === 'not_assessed') return { ...b, confidence: 'not_sure' };
  if (b.confidence === 'not_assessed') return { ...a, confidence: 'not_sure' };
  if (a.finding === b.finding && a.side === b.side) {
    return RANK[a.confidence] <= RANK[b.confidence] ? a : b;
  }
  const list = FINDINGS[a.attribute] as readonly string[];
  const ia = list.indexOf(a.finding!);
  const ib = list.indexOf(b.finding!);
  // The "milder" finding is the earlier one in each vocabulary list except where list order starts at the
  // concerning end; the lists are ordered from least to most marked, except radiance/shine where we simply keep pass one.
  const finding = ia >= 0 && ib >= 0 && a.attribute !== 'shine' && a.attribute !== 'radiance' ? list[Math.min(ia, ib)]! : a.finding;
  return { ...a, finding, side: a.side === b.side ? a.side : allowedSides(a.zone)[0]!, confidence: 'not_sure' };
}

export function gateBFromResult(redFlags: AiResult['red_flags'], min: AssessedConfidence): GateBResult {
  return evaluateGateB(redFlags, min);
}
