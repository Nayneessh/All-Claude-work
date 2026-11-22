// The only shape an AI provider is allowed to return. There is no field for a diagnosis,
// score, skin age, percentage, hydration reading or product. Free text is not accepted.
import { z } from 'zod';
import {
  ALL_FINDING_CODES,
  ASSESSED_CONFIDENCES,
  ATTRIBUTES,
  CONFIDENCES,
  IMAGE_RED_FLAG_CODES,
  PATHS,
  REASONS,
  SIDES,
  ZONES,
} from './types';

export const AI_SCHEMA_VERSION = 'skin-snapshot-result/v1';

export const observationSchema = z
  .object({
    zone: z.enum(ZONES),
    attribute: z.enum(ATTRIBUTES),
    /** A code from FINDINGS[attribute], or "not_assessed" when the photos cannot show it. */
    finding: z.enum(['not_assessed', ...ALL_FINDING_CODES] as [string, ...string[]]),
    side: z.enum(SIDES),
    confidence: z.enum(CONFIDENCES),
    /** Required when confidence is not_assessed. */
    reason: z.enum(['none', ...REASONS] as [string, ...string[]]),
  })
  .strict();

export const aiResultSchema = z
  .object({
    image_quality: z
      .object({
        overall: z.enum(['good', 'fair', 'poor']),
        issues: z.array(z.enum(REASONS)).max(8),
      })
      .strict(),
    observations: z.array(observationSchema).max(80),
    best_fit_path: z.enum(PATHS),
    best_fit_confidence: z.enum(ASSESSED_CONFIDENCES),
    red_flags: z
      .array(
        z
          .object({
            code: z.enum(IMAGE_RED_FLAG_CODES),
            confidence: z.enum(ASSESSED_CONFIDENCES),
          })
          .strict(),
      )
      .max(IMAGE_RED_FLAG_CODES.length),
  })
  .strict();

export type AiObservation = z.infer<typeof observationSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;

/** JSON Schema handed to providers that support structured output / forced tool use. */
export function aiResultJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(aiResultSchema, { target: 'draft-7' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

const UNSUPPORTED_KEYS = new Set(['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'format', 'default']);

/**
 * Portable variant for providers whose strict structured-output modes reject length keywords.
 * Our own zod validation still enforces them on the way back in.
 */
export function aiResultJsonSchemaPortable(): Record<string, unknown> {
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (n && typeof n === 'object') {
      return Object.fromEntries(Object.entries(n as Record<string, unknown>).filter(([k]) => !UNSUPPORTED_KEYS.has(k)).map(([k, v]) => [k, strip(v)]));
    }
    return n;
  };
  return strip(aiResultJsonSchema()) as Record<string, unknown>;
}
