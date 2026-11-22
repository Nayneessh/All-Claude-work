import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { ANSWERS, FX, passIntro } from './helpers';

// Live guidance against a simulated camera (Chromium's fake video device fed from a file).
// The fixtures are a public-domain studio portrait, so these tests prove the logic runs on-device end to end.
// They do not replace tests on real phones and real skin tones: see docs/TESTING.md.
test.describe.configure({ mode: 'serial' });
const BASE = 'http://localhost:3100';

async function launch(fixture: string | null, opts: { grant?: boolean; ua?: string } = {}) {
  const args = ['--use-fake-device-for-media-stream'];
  if (opts.grant !== false) args.push('--use-fake-ui-for-media-stream');
  if (fixture) args.push(`--use-file-for-fake-video-capture=${FX(fixture + '.mjpeg')}`);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  const ctx = await browser.newContext({ baseURL: BASE, permissions: opts.grant === false ? [] : ['camera'], userAgent: opts.ua, viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  return { browser, page };
}

async function reachCamera(page: Page, path: 'maintenance' | 'concerns' = 'maintenance') {
  const create = await page.request.post('/api/cases', { data: { lang: 'en', path, ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true }, sessionId: 'cam-' + Math.random().toString(36).slice(2, 12) } });
  const { token } = await create.json();
  const answers = (ANSWERS as Record<string, Record<string, unknown>>)[path];
  const a = await page.request.post('/api/case/answers', { headers: { 'x-case-token': token }, data: { answers } });
  expect(a.status()).toBe(200);
  await page.goto(`/en/case/${token}`);
  await passIntro(page);
  await expect(page.getByTestId('video')).toBeVisible({ timeout: 30_000 });
  return token as string;
}

const hint = (page: Page) => page.getByTestId('camera-hint');
async function hintText(page: Page) {
  return ((await hint(page).textContent()) ?? '').toLowerCase();
}
async function waitHint(page: Page, re: RegExp, timeout = 45_000) {
  await expect.poll(async () => re.test(await hintText(page)), { timeout, intervals: [300] }).toBe(true);
}
async function neverPasses(page: Page, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    expect(await page.getByTestId('oval').getAttribute('data-pass')).toBe('0');
    expect(await page.getByTestId('countdown').count()).toBe(0);
    await page.waitForTimeout(250);
  }
}

test('good light, centred and still: overlay turns green, 3-second countdown, automatic capture, review', async () => {
  const { browser, page } = await launch('face_ok');
  try {
    await reachCamera(page);
    await waitHint(page, /looking good|taking the photo in/);
    await expect(page.getByTestId('oval')).toHaveAttribute('data-pass', '1', { timeout: 20_000 });
    await expect(page.getByTestId('countdown')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('use-photo').or(page.getByTestId('use-anyway')).first()).toBeVisible();
    // retake goes back to a live camera
    await page.getByTestId('retake').click();
    await expect(page.getByTestId('video')).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('darker-skin proxy (same face at 45% brightness) is NOT rejected as too dark or blurry', async () => {
  const { browser, page } = await launch('face_dark_proxy');
  try {
    await reachCamera(page);
    await expect(page.getByTestId('oval')).toHaveAttribute('data-pass', '1', { timeout: 30_000 });
    const t = await hintText(page);
    expect(t).not.toMatch(/too dark|blurry/);
  } finally {
    await browser.close();
  }
});

for (const [fixture, re, label] of [
  ['face_dim', /too dark/, 'underexposed picture: "too dark" instruction, never counts down'],
  ['face_blur', /blurry/, 'blurred picture: "blurry" instruction'],
  ['face_two', /more than one face/, 'two faces: asks for a solo photo'],
  ['face_tilt', /level|tilt/, 'tilted head: asks to keep head level'],
  ['face_far', /closer/, 'face too small in frame: asks to move closer'],
] as const) {
  test(label, async () => {
    const { browser, page } = await launch(fixture);
    try {
      await reachCamera(page);
      await waitHint(page, re);
      await neverPasses(page, 4000);
    } finally {
      await browser.close();
    }
  });
}

test('manual shutter on an underexposed frame: photo is rejected with a specific reason and cannot be used', async () => {
  const { browser, page } = await launch('face_dim');
  try {
    await reachCamera(page);
    await waitHint(page, /too dark/);
    await page.getByTestId('shutter').click();
    await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('photo-review')).toContainText('too dark');
    await expect(page.getByTestId('use-photo')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('side shots: a frontal face is told to turn; a soft angle problem still allows a manual photo', async () => {
  const { browser, page } = await launch('face_ok');
  try {
    await reachCamera(page);
    // take the front photo automatically, then check the left-side prompt
    await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('use-photo').or(page.getByTestId('use-anyway')).first().click();
    await expect(page.getByRole('heading', { name: 'Left side' })).toBeVisible();
    await waitHint(page, /turn a little more|turn/);
    await page.getByTestId('shutter').click();
    await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('photo-review')).toContainText('Turn a little more');
    await expect(page.getByTestId('use-photo')).toBeVisible(); // soft failure: allowed
  } finally {
    await browser.close();
  }
});

test('camera permission blocked: step-by-step help for this browser, plus the upload option', async () => {
  const { browser, page } = await launch('face_ok', { grant: false });
  try {
    await reachCamera(page).catch(() => {});
    await expect(page.getByTestId('camera-blocked')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('camera-blocked')).toContainText('Camera access is blocked');
    await expect(page.getByTestId('upload-capture')).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('no camera on this device: upload option plus continue-on-phone QR code', async () => {
  const browser: Browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  try {
    const create = await page.request.post('/api/cases', { data: { lang: 'en', path: 'maintenance', ageConfirmed: true, consents: { privacy: true, health: true, photos_ai: true } } });
    const { token } = await create.json();
    await page.request.post('/api/case/answers', { headers: { 'x-case-token': token }, data: { answers: ANSWERS.maintenance } });
    await page.goto(`/en/case/${token}`);
    await passIntro(page);
    await expect(page.getByTestId('camera-unavailable')).toContainText('No camera found');
    await page.getByTestId('continue-phone').click();
    await expect(page.getByTestId('phone-qr')).toBeVisible();
    await expect(page.getByTestId('phone-qr').locator('img')).toBeVisible({ timeout: 20_000 });
    const link = (await page.getByTestId('phone-link').textContent())!;
    expect(link).toMatch(/\/en\/continue\/[A-Za-z0-9_-]{43}$/);

    // the phone: open the link, take the three photos through the upload route, and the laptop moves on
    const phone = await ctx.newPage();
    await phone.goto(link);
    await phone.getByTestId('phone-start').click();
    for (let i = 0; i < 3; i++) {
      await phone.getByTestId('file-input').setInputFiles(FX('face_ok.jpg'));
      await expect(phone.getByTestId('photo-review')).toBeVisible({ timeout: 40_000 });
      await phone.getByTestId('use-photo').click();
    }
    await phone.getByTestId('confirm-upload').click();
    await expect(phone.getByTestId('phone-done')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('snapshot')).toBeVisible({ timeout: 90_000 });
  } finally {
    await browser.close();
  }
});

test('in-app browser (Instagram) is detected and told to open in Chrome or Safari', async () => {
  const { browser, page } = await launch('face_ok', { ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.0 Android' });
  try {
    await reachCamera(page);
    await expect(page.getByTestId('inapp-notice')).toBeVisible();
    await expect(page.getByTestId('inapp-notice')).toContainText('Open in Chrome or Safari');
    await expect(page.getByRole('link', { name: 'Open in Chrome' })).toHaveAttribute('href', /^intent:\/\//);
  } finally {
    await browser.close();
  }
});
