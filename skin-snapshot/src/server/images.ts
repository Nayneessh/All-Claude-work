// Server-side image handling. Never trust the browser: every upload is decoded, re-encoded
// (which drops EXIF, GPS and device metadata), size-limited and re-checked for sharpness and light.
import sharp from 'sharp';
import { lumaStats, sharpnessNormalised } from '../core/vision-metrics';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export interface ServerChecks {
  blur: number;
  p5: number;
  p95: number;
  clipFraction: number;
}

export type SanitizeResult =
  | { ok: true; bytes: Uint8Array; width: number; height: number; checks: ServerChecks }
  | { ok: false; reason: 'unreadable' | 'too_small' | 'too_large' | 'too_blurry' | 'too_dark' };

/** Lenient server limits. The browser applies the stricter live guidance; these catch what slips past it. */
const SERVER_SHARP_MIN = 2.5; // normalised; the browser applies the stricter live threshold
const SERVER_P95_MIN = 38;

export async function sanitizeImage(input: Uint8Array): Promise<SanitizeResult> {
  if (input.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: 'too_large' };
  try {
    const img = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: 'unreadable' };
    if (Math.min(meta.width, meta.height) < 320) return { ok: false, reason: 'too_small' };
    const out = await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const g = await sharp(out.data).resize({ width: 256 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const blur = sharpnessNormalised(g.data, g.info.width, g.info.height);
    const s = lumaStats(g.data);
    const checks: ServerChecks = { blur: Math.round(blur * 10) / 10, p5: s.p5, p95: s.p95, clipFraction: Math.round(s.clipFraction * 1000) / 1000 };
    if (s.p95 < SERVER_P95_MIN) return { ok: false, reason: 'too_dark' };
    if (blur < SERVER_SHARP_MIN) return { ok: false, reason: 'too_blurry' };
    return { ok: true, bytes: new Uint8Array(out.data), width: out.info.width, height: out.info.height, checks };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/** Smaller copy for the vision model: less data sent, faster, cheaper. */
export async function downscaleForModel(input: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(input).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return new Uint8Array(out);
}
