'use client';
// Re-encodes a photo in the browser. Drawing to a canvas and exporting JPEG drops EXIF, GPS and device
// data, and lets us shrink to about 1.5 MB before anything is uploaded.
export const TARGET_BYTES = 1.5 * 1024 * 1024;

export interface Encoded {
  blob: Blob;
  width: number;
  height: number;
}

function toBlob(c: HTMLCanvasElement | OffscreenCanvas, q: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality: q });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', q));
}

export async function encodeJpeg(src: CanvasImageSource, sw: number, sh: number, maxSide = 1600): Promise<Encoded> {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  let w = Math.round(sw * scale);
  let h = Math.round(sh * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  let q = 0.9;
  let blob = await toBlob(c, q);
  // First lower quality, then reduce dimensions, until under the target (when quality allows).
  while (blob.size > TARGET_BYTES && q > 0.55) {
    q -= 0.07;
    blob = await toBlob(c, q);
  }
  while (blob.size > TARGET_BYTES && Math.max(w, h) > 900) {
    w = Math.round(w * 0.85);
    h = Math.round(h * 0.85);
    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = h;
    c2.getContext('2d')!.drawImage(c, 0, 0, w, h);
    blob = await toBlob(c2, 0.8);
  }
  return { blob, width: w, height: h };
}

export async function bitmapFromFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}
