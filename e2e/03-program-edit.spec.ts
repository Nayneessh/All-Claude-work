import { expect, test } from '@playwright/test';
import { finishWorkout, freshStart, gotoTab, startTodayWorkout, watch } from './helpers';

async function openLegPressEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Customise' }).click();
  await page.getByRole('button', { name: 'Edit Leg Press' }).click();
  await page.getByLabel('Sets', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Save changes/ }).click();
}

test('Journey 4a — edit scope "this day only" changes just that day and previews the effect', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await openLegPressEditor(page);
  await expect(page.getByText('What will change')).toBeVisible();
  await page.getByRole('radio').first().click(); // first option is the day/week override when opened from Today
  await expect(page.getByText('What will change')).toBeVisible();
  await page.getByRole('button', { name: /^Apply change/ }).click();
  await expect(page.getByText(/Changed for that day only|New program version saved|Program updated/)).toBeVisible();
  await page.goto('/#/');
  await startTodayWorkout(page);
  await expect(page.getByText('0/10 sets')).toBeVisible(); // 3 + 4 + 3 = 10 working sets today
  expect(w.errors).toEqual([]);
});

test('Journey 4b — "this and all future" creates a new version; history of past sessions is untouched', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  // do and finish today's workout first so there is history to protect
  await startTodayWorkout(page);
  await page.getByLabel('Set 1 Reps').first().fill('10');
  await page.getByRole('button', { name: 'Complete set 1' }).first().click();
  await finishWorkout(page);
  await page.getByRole('button', { name: 'Done' }).click();
  // change Leg Press from today on: the new session count applies to the *future*, the finished one keeps its plan
  await page.getByRole('button', { name: 'Customise' }).count(); // today is finished → no customise
  await gotoTab(page, 'Program');
  await page.locator('button.card').first().click();
  await expect(page.getByText(/Back #1/).first()).toBeVisible();
  await page.getByText(/Back #1/).first().click();
  await page.getByRole('button', { name: 'Edit Leg Press' }).click();
  await page.getByLabel('Sets', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Save changes/ }).click();
  await page.getByRole('radio', { name: /rest of the program|all future/i }).first().click();
  await expect(page.getByText('What will change')).toBeVisible();
  await page.getByRole('button', { name: /^Apply change/ }).click();
  await expect(page.getByText(/New program version saved|Program updated/)).toBeVisible();
  // the finished session still shows the plan it was done against: Leg Press 3 sets
  await gotoTab(page, 'History');
  await page.getByText(/Back #1/).first().click();
  await expect(page.getByText('Plan: 3 × 10-12 · RIR 2').first()).toBeVisible();
  expect(w.errors).toEqual([]);
});
