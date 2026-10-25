import { expect, test } from '@playwright/test';
import { completeAllSets, completeNextSet, finishWorkout, freshStart, gotoTab, startTodayWorkout, watch } from './helpers';

test('Journey 3 — perform a workout end to end and find it in History', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await expect(page.getByText('0/9 sets')).toBeVisible();
  await completeNextSet(page, '10');
  await expect(page.getByText('1/9 sets')).toBeVisible();
  const n = await completeAllSets(page, '10');
  expect(n).toBe(8);
  await expect(page.getByText('9/9 sets')).toBeVisible();
  await finishWorkout(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await gotoTab(page, 'History');
  await expect(page.getByText(/Back #1/).first()).toBeVisible();
  // planned vs actual detail
  await page.getByText(/Back #1/).first().click();
  await expect(page.getByText('Sets — planned vs actual')).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 3b — an interrupted workout is restored after a full reload (nothing logged is lost)', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  const id = await startTodayWorkout(page);
  await completeNextSet(page, '9');
  await completeNextSet(page, '11');
  await expect(page.getByText('2/9 sets')).toBeVisible();
  // simulate Android killing the WebView: hard reload on the workout URL
  await page.reload();
  await expect(page.getByText('2/9 sets')).toBeVisible();
  // and from Today the session is offered as "Resume"
  await page.goto('/#/');
  await expect(page.getByRole('button', { name: /Resume/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Resume/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/workout/${id}$`));
  await expect(page.getByText('2/9 sets')).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 3c — typed-but-uncompleted values survive backgrounding and a process restart', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  const reps = page.getByLabel('Set 1 Reps').first();
  await reps.fill('12');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByLabel('Set 1 Reps').first()).toHaveValue('12');
  expect(w.errors).toEqual([]);
});

test('Finishing with nothing logged never records zeros — it offers to skip', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('No sets logged yet')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as skipped' }).click();
  await gotoTab(page, 'History');
  await expect(page.getByText(/skipped/i).first()).toBeVisible();
  expect(w.errors).toEqual([]);
});
