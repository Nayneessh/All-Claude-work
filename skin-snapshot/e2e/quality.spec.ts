import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ANSWERS, FX, answerQuestionnaire, devSignIn, passIntro, startCase, uploadAllSlots } from './helpers';

test.describe.configure({ mode: 'serial' });

async function scan(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `accessibility violations on ${name}`).toEqual([]);
}

test('accessibility: public pages in English and Hindi', async ({ page }) => {
  const pages = ['', '/healthy-skin', '/acne-pigmentation', '/scars-marks', '/how-it-works', '/about', '/faq', '/contact', '/privacy', '/consent', '/terms', '/disclaimer', '/camera-help', '/start', '/start?path=maintenance'];
  for (const lang of ['en', 'hi']) {
    for (const p of pages) {
      await page.goto(`/${lang}${p}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await scan(page, `${lang}${p}`);
    }
  }
});

test('accessibility: the whole assessment flow (questions, tips, camera fallback, snapshot, booking, confirmation, safety stop)', async ({ page }) => {
  await startCase(page, 'en', 'maintenance');
  await scan(page, 'questionnaire step 1');
  await answerQuestionnaire(page, ANSWERS.maintenance);
  await expect(page.getByTestId('tips')).toBeVisible();
  await scan(page, 'tips');
  await page.getByTestId('tips-ok').click();
  await scan(page, 'ai explainer');
  await page.getByTestId('ai-ok').click();
  await expect(page.getByTestId('upload-capture')).toBeVisible({ timeout: 30_000 });
  await scan(page, 'capture (upload fallback)');
  await page.getByTestId('file-input').setInputFiles(FX('face_ok.jpg'));
  await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 40_000 });
  await scan(page, 'photo review');
  await page.getByTestId('use-photo').click();
  await uploadAllSlots(page, FX('face_ok.jpg'), 2);
  await scan(page, 'confirm photos');
  await page.getByTestId('confirm-upload').click();
  await expect(page.getByTestId('snapshot')).toBeVisible({ timeout: 90_000 });
  await scan(page, 'snapshot');
  await page.getByTestId('book-cta').click();
  await scan(page, 'booking form');
  await page.getByTestId('b-name').fill('Meera');
  await page.getByTestId('b-wa').fill('+91 98111 22233');
  await page.getByTestId('b-consent').check();
  await page.getByTestId('b-submit').click();
  await expect(page.getByTestId('confirmation')).toBeVisible();
  await scan(page, 'confirmation');

  await startCase(page, 'hi', 'concerns');
  await answerQuestionnaire(page, { ...ANSWERS.concerns, infection_signs: 'yes' });
  await expect(page.getByTestId('safety-stop')).toBeVisible();
  await scan(page, 'safety stop (Hindi)');
});

test('accessibility: console', async ({ page }) => {
  await page.goto('/console');
  await scan(page, 'console sign-in');
  await devSignIn(page, 'admin');
  await scan(page, 'console queue');
  await page.getByRole('link', { name: 'Routine templates' }).click();
  await expect(page.getByTestId('templates')).toBeVisible();
  await scan(page, 'console templates');
  await page.getByRole('link', { name: 'Counts' }).click();
  await expect(page.getByTestId('measures')).toBeVisible();
  await scan(page, 'console counts');
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(page.getByTestId('access-log')).toBeVisible();
  await scan(page, 'console access log');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('s-wa')).toBeVisible();
  await scan(page, 'console settings');
  await page.getByRole('link', { name: 'Queue' }).click();
  await page.getByTestId('queue').locator('tbody tr').first().getByRole('link').first().click();
  await expect(page.getByTestId('case-view')).toBeVisible();
  await scan(page, 'console case');
});

test('keyboard: the questionnaire and consent form can be completed with the keyboard alone', async ({ page }) => {
  await page.goto('/en/start?path=maintenance');
  await page.getByTestId('age').focus();
  for (const id of ['age', 'consent-privacy', 'consent-health', 'consent-photos_ai']) {
    await page.getByTestId(id).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId(id)).toBeChecked();
  }
  await page.getByTestId('begin').focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/case\//);
  await expect(page.getByTestId('q-skin_feel-dry_tight')).toBeVisible();
  await page.getByTestId('q-skin_feel-dry_tight').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('q-skin_feel-dry_tight')).toBeChecked();
});

test('performance: home page main content within 2.5 s on a throttled mobile connection', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  // "Fast 3G / slow 4G" class: 1.6 Mbit/s down, 750 kbit/s up, 150 ms round trip; CPU 4x slower
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const results: Record<string, { lcp: number; fcp: number; kb: number }> = {};
  for (const url of ['/en', '/hi', '/en/start?path=maintenance', '/en/healthy-skin']) {
    await cdp.send('Network.clearBrowserCache');
    let bytes = 0;
    const onData = (e: { encodedDataLength: number }) => (bytes += e.encodedDataLength);
    cdp.on('Network.loadingFinished', onData as never);
    await page.addInitScript(() => {
      (window as unknown as { __lcp: number }).__lcp = 0;
      new PerformanceObserver((l) => {
        const e = l.getEntries();
        (window as unknown as { __lcp: number }).__lcp = e[e.length - 1]!.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ lcp: (window as unknown as { __lcp: number }).__lcp, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0 }));
    results[url] = { lcp: Math.round(m.lcp), fcp: Math.round(m.fcp), kb: Math.round(bytes / 1024) };
    cdp.off('Network.loadingFinished', onData as never);
  }
  console.log('PERF (throttled: 1.6 Mbit/s, 150 ms RTT, 4x CPU slowdown):', JSON.stringify(results));
  for (const [url, r] of Object.entries(results)) expect(r.lcp, `LCP ${url}`).toBeLessThan(2500);
  await ctx.close();
});
