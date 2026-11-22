// Face-pose checks from landmarks. Landmarks are normalised image coordinates from the on-device
// face model (MediaPipe Face Landmarker, 478 points). Pure functions, unit-tested with synthetic faces.
import { THRESHOLDS, type LightProblem } from './vision-metrics';
import type { PhotoSlot } from './types';

export interface Pt {
  x: number;
  y: number;
  z?: number;
}

// MediaPipe mesh indices
export const LM = { noseTip: 1, forehead: 10, chin: 152, contourImageLeft: 234, contourImageRight: 454, eyeOuterL: 33, eyeOuterR: 263 } as const;

export interface FaceBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function faceBox(lm: readonly Pt[]): FaceBox {
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/** Roll in degrees from the outer eye corners. Positive means the head tilts clockwise on screen. */
export function rollDegrees(lm: readonly Pt[]): number {
  const a = lm[LM.eyeOuterL]!;
  const b = lm[LM.eyeOuterR]!;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/**
 * Where the nose sits between the two face contours: 0.5 is frontal. Smaller means the nose has moved
 * toward the left of the image, which is the person's RIGHT shoulder, exposing their LEFT cheek.
 */
export function noseRatio(lm: readonly Pt[]): number {
  const l = lm[LM.contourImageLeft]!.x;
  const r = lm[LM.contourImageRight]!.x;
  const span = r - l;
  if (Math.abs(span) < 1e-6) return 0.5;
  return (lm[LM.noseTip]!.x - l) / span;
}

/** Euler angles in degrees from a column-major 4x4 face transform (MediaPipe facialTransformationMatrixes). */
export function eulerFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const yaw = (Math.atan2(m[8]!, m[10]!) * 180) / Math.PI;
  const pitch = (Math.asin(Math.max(-1, Math.min(1, -m[9]!))) * 180) / Math.PI;
  const roll = (Math.atan2(m[1]!, m[5]!) * 180) / Math.PI;
  return { yaw, pitch, roll };
}

/**
 * Signed yaw. Magnitude comes from the transform matrix when available (accurate), else from the nose
 * ratio. The sign always comes from the landmarks: positive = left cheek toward the camera.
 */
export function signedYaw(lm: readonly Pt[], matrix?: ArrayLike<number>): number {
  const r = noseRatio(lm);
  const sign = r < 0.5 ? 1 : -1;
  if (matrix) return sign * Math.abs(eulerFromMatrix(matrix).yaw);
  // Approximation: a head turned by t degrees shifts the nose by about 0.5*sin(t) of the half-width.
  const off = Math.min(1, Math.abs(r - 0.5) * 2);
  return sign * (Math.asin(Math.min(1, off)) * 180) / Math.PI;
}

export type CheckId = 'face' | 'single' | 'centered' | 'distance' | 'angle' | 'tilt' | 'light' | 'sharp' | 'steady' | 'filter';

export interface CheckResult {
  id: CheckId;
  ok: boolean;
  /** hard = the photo cannot be used; soft = usable but not ideal */
  severity: 'hard' | 'soft';
  /** Message key suffix, e.g. "too_far". The UI maps it to text in the visitor's language. */
  code: string;
}

export interface FrameInput {
  slot: PhotoSlot;
  faces: readonly (readonly Pt[])[];
  matrix?: ArrayLike<number>;
  lightProblems: readonly LightProblem[];
  blur: number;
  steadyMove?: number;
  detailRatio?: number;
}

const ok = (id: CheckId): CheckResult => ({ id, ok: true, severity: 'hard', code: 'ok' });

/** Full evaluation of one frame against what the current slot needs. */
export function evaluateFrame(f: FrameInput): CheckResult[] {
  const out: CheckResult[] = [];
  if (f.faces.length === 0) {
    return [{ id: 'face', ok: false, severity: 'hard', code: 'no_face' }];
  }
  out.push(ok('face'));
  if (f.faces.length > 1) {
    return [...out, { id: 'single', ok: false, severity: 'hard', code: 'multiple_faces' }];
  }
  out.push(ok('single'));
  const lm = f.faces[0]!;
  const box = faceBox(lm);

  // Distance
  if (box.h < THRESHOLDS.distanceMin) out.push({ id: 'distance', ok: false, severity: 'hard', code: 'too_far' });
  else if (box.h > THRESHOLDS.distanceMax) out.push({ id: 'distance', ok: false, severity: 'hard', code: 'too_close' });
  else out.push(ok('distance'));

  // Centering
  if (Math.abs(box.cx - 0.5) > THRESHOLDS.centerX || Math.abs(box.cy - 0.5) > THRESHOLDS.centerY) {
    out.push({ id: 'centered', ok: false, severity: 'hard', code: 'not_centered' });
  } else out.push(ok('centered'));

  // Angle
  const yaw = signedYaw(lm, f.matrix);
  const pitch = f.matrix ? eulerFromMatrix(f.matrix).pitch : 0;
  if (f.slot === 'front' || f.slot === 'closeup') {
    if (Math.abs(yaw) > THRESHOLDS.frontYawMax || Math.abs(pitch) > THRESHOLDS.pitchMax) {
      out.push({ id: 'angle', ok: false, severity: 'soft', code: Math.abs(pitch) > THRESHOLDS.pitchMax ? (pitch > 0 ? 'chin_down' : 'chin_up') : 'face_forward' });
    } else out.push(ok('angle'));
  } else {
    const want = f.slot === 'left' ? 1 : -1;
    const toward = yaw * want; // positive when turned the right way
    if (toward < 0 && Math.abs(yaw) > 15) out.push({ id: 'angle', ok: false, severity: 'soft', code: 'turn_other_way' });
    else if (toward < THRESHOLDS.sideYawMin) out.push({ id: 'angle', ok: false, severity: 'soft', code: 'turn_more' });
    else if (toward > THRESHOLDS.sideYawMax) out.push({ id: 'angle', ok: false, severity: 'soft', code: 'turn_less' });
    else if (Math.abs(pitch) > THRESHOLDS.pitchMax) out.push({ id: 'angle', ok: false, severity: 'soft', code: pitch > 0 ? 'chin_down' : 'chin_up' });
    else out.push(ok('angle'));
  }

  // Tilt
  const roll = f.matrix ? eulerFromMatrix(f.matrix).roll : rollDegrees(lm);
  out.push(Math.abs(rollNormalised(roll)) > THRESHOLDS.tiltMax ? { id: 'tilt', ok: false, severity: 'soft', code: 'level_head' } : ok('tilt'));

  // Light
  if (f.lightProblems.length) {
    const p = f.lightProblems[0]!;
    out.push({ id: 'light', ok: false, severity: 'hard', code: p });
  } else out.push(ok('light'));

  // Sharpness
  out.push(f.blur < THRESHOLDS.sharpMin ? { id: 'sharp', ok: false, severity: 'hard', code: 'blurry' } : ok('sharp'));

  // Steadiness (live only)
  if (f.steadyMove !== undefined) {
    out.push(f.steadyMove > THRESHOLDS.steadyMove ? { id: 'steady', ok: false, severity: 'soft', code: 'hold_still' } : ok('steady'));
  }

  // Suspected filter
  if (f.detailRatio !== undefined && f.detailRatio < THRESHOLDS.smoothRatioMin && f.blur >= THRESHOLDS.sharpMin) {
    out.push({ id: 'filter', ok: false, severity: 'soft', code: 'possible_filter' });
  }
  return out;
}

function rollNormalised(r: number): number {
  // atan2-based angles can come back near +/-180 for an upright face depending on the source.
  let v = r;
  while (v > 90) v -= 180;
  while (v < -90) v += 180;
  return v;
}

export function allPass(results: readonly CheckResult[]): boolean {
  return results.every((r) => r.ok);
}

export function hardFailures(results: readonly CheckResult[]): CheckResult[] {
  return results.filter((r) => !r.ok && r.severity === 'hard');
}

/** The single most useful instruction to show right now. */
export function primaryInstruction(results: readonly CheckResult[]): CheckResult | null {
  const order: CheckId[] = ['face', 'single', 'distance', 'centered', 'light', 'angle', 'tilt', 'sharp', 'steady', 'filter'];
  for (const id of order) {
    const r = results.find((x) => x.id === id && !x.ok);
    if (r) return r;
  }
  return null;
}
