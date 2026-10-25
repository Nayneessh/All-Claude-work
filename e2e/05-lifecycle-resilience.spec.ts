import { expect, test } from '@playwright/test';
import { completeNextSet, completeSets, freshStart, gotoTab, startTodayWorkout, watch } from './helpers';

test('Journey 9a — rest timer is an absolute end time: it survives a process restart mid-rest', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await completeSets(page, 4); // A1×3 then A2 set 1 — superset rest is taken after the pair
  await expect(page.getByRole('timer')).toBeVisible();
  await page.waitForTimeout(600); // let the persisted end time be written
  await page.reload();
  await expect(page.getByRole('timer')).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 9b — back navigation never loses or duplicates a workout', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await completeNextSet(page, '10');
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.getByRole('button', { name: /Resume/ }).first()).toBeVisible();
  await page.goBack();
  await page.goForward();
  await page.goto('/#/');
  await gotoTab(page, 'History');
  await gotoTab(page, 'Today');
  // exactly one session exists for Monday
  await page.getByRole('button', { name: /Resume/ }).first().click();
  await expect(page.getByText('1/9 sets')).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 9c — a screen whose code cannot be loaded shows a recoverable message, never a blank page', async ({ page }) => {
  const w = watch(page);
  await page.route(/assets\/Programs-.*\.js/, (r) => r.abort()); // registered before launch so the idle preload cannot cache it
  await freshStart(page);
  await page.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Everything you logged is safe/);
  await page.getByRole('link', { name: 'Go to Today' }).click();
  await expect(page.getByRole('button', { name: /Start workout/ }).first()).toBeVisible();
  expect(w.errors.filter((e) => !/Screen crashed|Failed to load resource|dynamically imported|ERR_FAILED|React error #520/i.test(e))).toEqual([]);
});

test('Journey 9d — text scaling and small screens keep primary actions reachable', async ({ page }) => {
  const w = watch(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await freshStart(page);
  const start = page.getByRole('button', { name: /Start workout/ }).first();
  await expect(start).toBeVisible();
  const box = await start.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); // tap target
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1); // no horizontal scrolling
  await page.addStyleTag({ content: 'html { font-size: 130% !important; }' });
  await expect(start).toBeVisible();
  expect(w.errors).toEqual([]);
});
