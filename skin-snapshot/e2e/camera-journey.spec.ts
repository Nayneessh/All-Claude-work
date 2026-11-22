import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { ANSWERS, FX, answerQuestionnaire, passIntro } from './helpers';

// The visitor's own route to the camera: pick a journey, agree, answer, and the camera starts and takes photos.
// Runs against the standard test server (port 3100) or, with HOSTED_URL set, against a hosted-like server that has
// no database at all (the temporary in-memory store).
test.describe.configure({ mode: 'serial' });
const BASE = process.env.HOSTED_URL ?? 'http://localhost:3100';

async function launch(opts: { fixture?: string; init?: string; ua?: string } = {}) {
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${FX((opts.fixture ?? 'face_ok') + '.mjpeg')}`];
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  const ctx = await browser.newContext({ baseURL: BASE, permissions: ['camera'], userAgent: opts.ua, viewport: { width: 1000, height: 900 } });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  return { browser, page };
}

const live = (page: Page) => page.evaluate(() => { const v = document.querySelector('[data-testid=video]') as HTMLVideoElement | null; return !!v && v.videoWidth > 0 && !v.paused && v.readyState >= 2; });
async function expectLiveVideo(page: Page) {
  await expect.poll(() => live(page), { timeout: 30_000, intervals: [300] }).toBe(true);
}

/** Exactly what a visitor does: home page, "choose a path", consents, questions. No shortcuts through the API. */
async function throughTheUi(page: Page, path: 'maintenance' | 'concerns' = 'maintenance') {
  await page.goto('/en/start');
  await page.getByTestId(`pick-${path}`).click();
  await page.getByTestId('age').check();
  await page.getByTestId('consent-privacy').check();
  await page.getByTestId('consent-health').check();
  await page.getByTestId('consent-photos_ai').check();
  await page.getByTestId('begin').click();
  await page.waitForURL(/\/en\/case\//, { timeout: 30_000 });
  await answerQuestionnaire(page, (ANSWERS as Record<string, Record<string, string | string[]>>)[path]!);
  await passIntro(page);
  await expect(page.getByTestId('video')).toBeVisible({ timeout: 30_000 });
}

test('choosing a journey leads to a live camera that takes photos; Retake brings the picture back', async () => {
  const { browser, page } = await launch();
  try {
    await throughTheUi(page);
    await expectLiveVideo(page);
    await page.getByTestId('shutter').click();
    await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('retake').click();
    // The regression: the picture used to stay black after Retake because the video element was replaced.
    await expectLiveVideo(page);
    const t0 = await page.evaluate(() => (document.querySelector('[data-testid=video]') as HTMLVideoElement).currentTime);
    await page.waitForTimeout(800);
    const t1 = await page.evaluate(() => (document.querySelector('[data-testid=video]') as HTMLVideoElement).currentTime);
    expect(t1).toBeGreaterThan(t0);
    // All three required photos, then the confirm screen
    for (let i = 0; i < 3; i++) {
      await expectLiveVideo(page);
      await page.getByTestId('shutter').click();
      await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('use-photo').or(page.getByTestId('use-anyway')).first().click();
    }
    await expect(page.getByTestId('confirm-photos')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid^=thumb-]')).toHaveCount(3);
  } finally {
    await browser.close();
  }
});

test('the practice camera needs no case and no server: three photos, kept only on the screen', async () => {
  const { browser, page } = await launch();
  try {
    const calls: string[] = [];
    page.on('request', (r) => { if (/\/api\/case/.test(r.url())) calls.push(r.url()); });
    await page.goto('/en/start');
    await page.getByTestId('try-camera').click();
    await expect(page.getByTestId('camera-preview')).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await expectLiveVideo(page);
      await page.getByTestId('shutter').click();
      await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('use-photo').or(page.getByTestId('use-anyway')).first().click();
    }
    await expect(page.getByTestId('preview-done')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start my skin check' })).toBeVisible();
    expect(calls).toEqual([]); // nothing about a case, nothing uploaded
  } finally {
    await browser.close();
  }
});

test('a phone that blocks autoplay shows "Tap to start the camera", and the tap starts it', async () => {
  const { browser, page } = await launch({
    init: `(() => { const p = HTMLMediaElement.prototype.play; let blocked = true; HTMLMediaElement.prototype.play = function () { if (blocked) { blocked = false; return Promise.reject(new DOMException('blocked', 'NotAllowedError')); } return p.call(this); }; })();`,
  });
  try {
    await page.goto('/en/camera-preview');
    await expect(page.getByTestId('camera-tap')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('shutter')).toBeDisabled();
    await page.getByTestId('camera-tap').click();
    await expect(page.getByTestId('camera-tap')).toHaveCount(0);
    await expectLiveVideo(page);
  } finally {
    await browser.close();
  }
});

test('a phone that refuses the requested size or facing mode still gets a camera', async () => {
  const { browser, page } = await launch({
    init: `(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let n = 0; navigator.mediaDevices.getUserMedia = (c) => { n++; if (n <= 2) return Promise.reject(new DOMException('no match', 'OverconstrainedError')); return g(c); }; })();`,
  });
  try {
    await page.goto('/en/camera-preview');
    await expectLiveVideo(page);
    await expect(page.getByTestId('camera-unavailable')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('a busy camera (another app has it) says so and can be retried', async () => {
  const { browser, page } = await launch({
    init: `(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__cameraFree = false; navigator.mediaDevices.getUserMedia = (c) => (window.__cameraFree ? g(c) : Promise.reject(new DOMException('in use', 'NotReadableError'))); })();`,
  });
  try {
    await page.goto('/en/camera-preview');
    await expect(page.getByTestId('camera-unavailable')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('The camera is busy')).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __cameraFree: boolean }).__cameraFree = true; });
    await page.getByRole('button', { name: 'Try again' }).first().click();
    await expectLiveVideo(page);
  } finally {
    await browser.close();
  }
});

test('Hindi: the practice camera page opens and shows the Hindi start-camera text when blocked', async () => {
  const { browser, page } = await launch({
    init: `(() => { const p = HTMLMediaElement.prototype.play; let blocked = true; HTMLMediaElement.prototype.play = function () { if (blocked) { blocked = false; return Promise.reject(new DOMException('blocked', 'NotAllowedError')); } return p.call(this); }; })();`,
  });
  try {
    await page.goto('/hi/camera-preview');
    await expect(page.getByTestId('camera-tap')).toHaveText('कैमरा शुरू करने के लिए टैप करें', { timeout: 20_000 });
  } finally {
    await browser.close();
  }
});

void (null as unknown as Browser);
