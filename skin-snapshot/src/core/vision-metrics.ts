// Image-quality measurements shared by the browser (live camera, uploads) and the server
// (re-check before analysis). Pure functions over pixel arrays so they are unit-testable.
//
// The light check is deliberately relative. It looks at clipping, dynamic range, backlight and
// left/right imbalance, never "average brightness above X", so darker skin tones are not rejected
// as "too dark" when the lighting is good.

export const THRESHOLDS = {
  /** Face-height as a fraction of frame height. */
  distanceMin: 0.42,
  distanceMax: 0.82,
  /** Face centre may sit this far from the frame centre (fraction of frame). */
  centerX: 0.14,
  centerY: 0.16,
  /** Roll (head tilt) limit in degrees. */
  tiltMax: 8,
  /** Front shot: yaw and pitch limits in degrees. */
  frontYawMax: 11,
  pitchMax: 14,
  /** Side shots: yaw must land in this range (degrees, magnitude). */
  sideYawMin: 32,
  sideYawMax: 58,
  /**
   * Sharpness: Laplacian variance of the face crop divided by the square of its mean brightness. Plain
   * Laplacian variance scales with brightness squared, so it would call a darker-skinned face "blurry".
   * Dividing by mean^2 makes the score independent of skin tone and exposure. Lower is blurrier.
   * Calibrated on synthetic fixtures only; must be re-calibrated on real devices (docs/TESTING.md).
   */
  sharpMin: 8,
  /** Light: 95th percentile luma must reach this, else the face is under-exposed. */
  highlightMin: 62,
  /** Light: spread between 5th and 95th percentile luma. */
  rangeMin: 22,
  /** Light: fraction of face pixels allowed at near-white. */
  clipMax: 0.08,
  /** Light: left/right half-mean imbalance allowed (0 to 1). */
  imbalanceMax: 0.38,
  /** Backlight: background brighter than face by this ratio and face is dim. */
  backlightRatio: 1.9,
  /** Frames of continuous success before the countdown starts. */
  stableFrames: 6,
  /** Max face-centre movement between frames (fraction of frame) to count as steady. */
  steadyMove: 0.012,
  /** Filter suspicion: skin-patch detail relative to face-edge detail. Lower means smoother. */
  smoothRatioMin: 0.05,
  countdownSeconds: 3,
} as const;

export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (rgba[j]! * 299 + rgba[j + 1]! * 587 + rgba[j + 2]! * 114) / 1000;
  }
  return g;
}

/** Variance of the 4-neighbour Laplacian. A standard sharpness score. */
export function laplacianVariance(gray: ArrayLike<number>, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Exposure-independent sharpness (see THRESHOLDS.sharpMin). */
export function sharpnessNormalised(gray: ArrayLike<number>, w: number, h: number): number {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i]!;
  const mean = gray.length ? sum / gray.length : 0;
  return (laplacianVariance(gray, w, h) / Math.max(mean, 16) ** 2) * 10_000;
}

export interface LumaStats {
  p5: number;
  p50: number;
  p95: number;
  clipFraction: number;
  mean: number;
}

export function lumaStats(gray: ArrayLike<number>): LumaStats {
  const hist = new Uint32Array(256);
  let sum = 0;
  let clip = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) {
    const v = gray[i]!;
    hist[v | 0]!++;
    sum += v;
    if (v >= 245) clip++;
  }
  const pct = (p: number) => {
    const target = p * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= target) return v;
    }
    return 255;
  };
  return { p5: pct(0.05), p50: pct(0.5), p95: pct(0.95), clipFraction: n ? clip / n : 0, mean: n ? sum / n : 0 };
}

/** 0 = same brightness on both halves, 1 = one half black. */
export function halfImbalance(gray: ArrayLike<number>, w: number, h: number): number {
  let l = 0;
  let r = 0;
  let nl = 0;
  let nr = 0;
  const mid = w >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]!;
      if (x < mid) {
        l += v;
        nl++;
      } else {
        r += v;
        nr++;
      }
    }
  }
  if (!nl || !nr) return 0;
  const ml = l / nl;
  const mr = r / nr;
  const hi = Math.max(ml, mr);
  return hi === 0 ? 0 : Math.abs(ml - mr) / hi;
}

export type LightProblem = 'too_dim' | 'too_bright' | 'uneven' | 'backlit';

export function lightProblems(face: { gray: ArrayLike<number>; w: number; h: number }, backgroundMean?: number): LightProblem[] {
  const s = lumaStats(face.gray);
  const out: LightProblem[] = [];
  if (s.p95 < THRESHOLDS.highlightMin || s.p95 - s.p5 < THRESHOLDS.rangeMin) out.push('too_dim');
  if (s.clipFraction > THRESHOLDS.clipMax) out.push('too_bright');
  if (halfImbalance(face.gray, face.w, face.h) > THRESHOLDS.imbalanceMax) out.push('uneven');
  if (backgroundMean !== undefined && s.mean > 0 && backgroundMean / s.mean > THRESHOLDS.backlightRatio && s.mean < 110) out.push('backlit');
  return out;
}

/**
 * Smoothness heuristic for suspected beauty filters: ratio of fine detail inside skin patches
 * to fine detail over the whole face crop. Real skin has pore-level texture; heavy smoothing
 * removes it while eyes and brows stay sharp. Best-effort only. It can be wrong.
 */
export function skinDetailRatio(gray: ArrayLike<number>, w: number, h: number): number {
  const whole = laplacianVariance(gray, w, h);
  if (whole <= 0) return 0;
  // Cheek-ish patches: left and right of centre, lower middle band
  const patches: [number, number, number, number][] = [
    [Math.round(w * 0.12), Math.round(h * 0.55), Math.round(w * 0.3), Math.round(h * 0.25)],
    [Math.round(w * 0.58), Math.round(h * 0.55), Math.round(w * 0.3), Math.round(h * 0.25)],
  ];
  let acc = 0;
  for (const [x0, y0, pw, ph] of patches) {
    const buf = new Uint8ClampedArray(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) buf[y * pw + x] = gray[(y0 + y) * w + (x0 + x)]!;
    acc += laplacianVariance(buf, pw, ph);
  }
  return acc / patches.length / whole;
}
