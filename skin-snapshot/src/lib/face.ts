'use client';
// On-device face guidance. MediaPipe Face Landmarker runs in the browser (WASM, served from our own
// origin). Frames never leave the device during live guidance.
import { evaluateFrame, faceBox, type CheckResult, type Pt } from '../core/pose';
import { lightProblems, lumaStats, rgbaToGray, sharpnessNormalised, skinDetailRatio } from '../core/vision-metrics';
import type { PhotoSlot } from '../core/types';
import { platform } from './device';

type FaceLandmarker = import('@mediapipe/tasks-vision').FaceLandmarker;
let loading: Promise<FaceLandmarker> | null = null;
let lastTs = 0;
// The graphics-chip path is faster but is the least reliable on iPhones and some Android phones, so iPhones
// start on the processor, and any device falls back to it if the live checks stop producing results.
let cpuOnly = false;

export function loadFaceModel(): Promise<FaceLandmarker> {
  if (!loading) {
    loading = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/vision/wasm');
      const make = (delegate: 'GPU' | 'CPU') =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/vision/face_landmarker.task', delegate },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: false,
        });
      const order: Array<'GPU' | 'CPU'> = cpuOnly || platform() === 'ios' ? ['CPU', 'GPU'] : ['GPU', 'CPU'];
      try {
        return await make(order[0]!);
      } catch {
        return await make(order[1]!);
      }
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** Drops the loaded model and loads it again on the processor. Returns false when it was already there. */
export async function reloadFaceModelOnCpu(): Promise<boolean> {
  if (cpuOnly) return false;
  cpuOnly = true;
  const old = loading;
  loading = null;
  try {
    (await old)?.close();
  } catch {
    /* it never loaded, nothing to close */
  }
  await loadFaceModel();
  return true;
}

/** Start downloading the model early (for example while the visitor answers questions). */
export function prefetchFaceModel(): void {
  void loadFaceModel().catch(() => {});
}

const work = typeof document !== 'undefined' ? document.createElement('canvas') : (null as unknown as HTMLCanvasElement);

function crop(src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number, outW: number): { data: Uint8ClampedArray; w: number; h: number } {
  const outH = Math.max(8, Math.round((outW * h) / w));
  work.width = outW;
  work.height = outH;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, Math.max(0, x * sw), Math.max(0, y * sh), Math.max(1, w * sw), Math.max(1, h * sh), 0, 0, outW, outH);
  return { data: ctx.getImageData(0, 0, outW, outH).data as unknown as Uint8ClampedArray, w: outW, h: outH };
}

export interface FrameAnalysis {
  results: CheckResult[];
  faces: number;
  box: { cx: number; cy: number; h: number } | null;
  metrics: { blur: number; p5: number; p95: number; detail: number | null };
}

export async function analyseSource(
  src: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
  slot: PhotoSlot,
  opts: { live: boolean; prevCentre?: { cx: number; cy: number } | null },
): Promise<FrameAnalysis> {
  const model = await loadFaceModel();
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : (src as HTMLCanvasElement | ImageBitmap).width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : (src as HTMLCanvasElement | ImageBitmap).height;
  lastTs = Math.max(lastTs + 1, Math.round(performance.now()));
  const det = model.detectForVideo(src as never, lastTs);
  const faces = det.faceLandmarks.map((f) => f.map((p) => ({ x: p.x, y: p.y, z: p.z }) as Pt));
  const matrix = det.facialTransformationMatrixes?.[0]?.data;

  if (faces.length === 0) {
    return { results: evaluateFrame({ slot, faces: [], lightProblems: [], blur: 0 }), faces: 0, box: null, metrics: { blur: 0, p5: 0, p95: 0, detail: null } };
  }
  const box = faceBox(faces[0]!);
  const pad = 0.08;
  const fx = Math.max(0, box.minX - pad * box.w);
  const fy = Math.max(0, box.minY - pad * box.h);
  const fw = Math.min(1 - fx, box.w * (1 + 2 * pad));
  const fh = Math.min(1 - fy, box.h * (1 + 2 * pad));

  const faceSmall = crop(src, sw, sh, fx, fy, fw, fh, 96);
  const faceGray = rgbaToGray(faceSmall.data, faceSmall.w, faceSmall.h);
  const sharp = crop(src, sw, sh, fx, fy, fw, fh, 256);
  const sharpGray = rgbaToGray(sharp.data, sharp.w, sharp.h);
  const blur = sharpnessNormalised(sharpGray, sharp.w, sharp.h);
  const detail = faces.length === 1 ? skinDetailRatio(sharpGray, sharp.w, sharp.h) : null;
  const whole = crop(src, sw, sh, 0, 0, 1, 1, 48);
  const bgMean = lumaStats(rgbaToGray(whole.data, whole.w, whole.h)).mean;
  const light = lightProblems({ gray: faceGray, w: faceSmall.w, h: faceSmall.h }, bgMean);
  const stats = lumaStats(faceGray);

  let steady: number | undefined;
  if (opts.live) {
    steady = opts.prevCentre ? Math.hypot(box.cx - opts.prevCentre.cx, box.cy - opts.prevCentre.cy) : 0;
  }
  const results = evaluateFrame({ slot, faces, matrix, lightProblems: light, blur, steadyMove: steady, detailRatio: detail ?? undefined });
  return { results, faces: faces.length, box: { cx: box.cx, cy: box.cy, h: box.h }, metrics: { blur: Math.round(blur), p5: stats.p5, p95: stats.p95, detail: detail === null ? null : Math.round(detail * 1000) / 1000 } };
}
