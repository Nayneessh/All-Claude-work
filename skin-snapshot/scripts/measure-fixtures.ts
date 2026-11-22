// Prints the sharpness metric for each camera fixture, to sanity-check thresholds against known images.
import sharp from 'sharp';
import { laplacianVariance, sharpnessNormalised } from '../src/core/vision-metrics';

async function main() {
  for (const f of ['face_ok', 'face_dark_proxy', 'face_blur', 'face_far', 'face_tilt', 'face_dim']) {
  const { data, info } = await sharp(`e2e/fixtures/${f}.jpg`).extract({ left: 190, top: 80, width: 260, height: 340 }).resize({ width: 256 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    console.log(f.padEnd(18), 'raw', Math.round(laplacianVariance(data, info.width, info.height) * 10) / 10, 'normalised', Math.round(sharpnessNormalised(data, info.width, info.height) * 10) / 10);
  }
}
main();
