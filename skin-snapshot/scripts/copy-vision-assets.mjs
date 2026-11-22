// Copies the MediaPipe WASM runtime from node_modules into public/vision so the browser
// loads everything from our own origin (no third-party CDN, no data leaving the site).
// The face model (public/vision/face_landmarker.task) is committed to the repository.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dst = join(root, 'public', 'vision', 'wasm');
if (!existsSync(src)) {
  console.warn('[copy-vision-assets] @mediapipe/tasks-vision not installed yet, skipping');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-vision-assets] copied MediaPipe WASM to public/vision/wasm');
