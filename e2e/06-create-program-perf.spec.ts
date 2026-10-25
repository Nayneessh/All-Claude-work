import { expect, test } from '@playwright/test';
import { freshStart, gotoTab, watch } from './helpers';

test('Journey 2 — create a program from scratch: day, exercise, scope, then train it', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await gotoTab(page, 'Program');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Name').fill('Test Push');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Test Push').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add training day' }).click();
  await page.getByLabel('Name').fill('Push · chest');
  await page.getByRole('button', { name: 'Mon', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Apply change/ }).click();
  await expect(page.getByText('Push · chest').first()).toBeVisible();
  await page.getByText('Push · chest').first().click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByLabel('Search exercises').fill('bench');
  await page.locator('button.item').first().click();
  await page.getByRole('button', { name: /Save changes/ }).click();
  await page.getByRole('button', { name: /^Apply change/ }).click();
  await gotoTab(page, 'Today');
  await expect(page.getByText('Push · chest').first()).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Performance — cold start to interactive, and a set is logged within budget', async ({ page }) => {
  const w = watch(page);
  const t0 = Date.now();
  await freshStart(page);
  const startupMs = Date.now() - t0; // includes the three onboarding taps
  expect(startupMs).toBeLessThan(8000);
  await page.getByRole('button', { name: /Start workout/ }).first().click();
  await page.getByLabel('Set 1 Reps').first().fill('10');
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Complete set 1' }).first().click();
  await expect(page.getByText('1/9 sets')).toBeVisible();
  const logMs = Date.now() - t1;
  console.log(`PERF startup(incl. onboarding)=${startupMs}ms setLogged=${logMs}ms`);
  expect(logMs).toBeLessThan(1000);
  expect(w.errors).toEqual([]);
});

test('Add activity — MMA is logged as its own session and the strength day stays planned', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByRole('button', { name: 'MMA Training' }).click();
  await page.getByLabel('Minutes').fill('45');
  await page.getByRole('button', { name: '7', exact: true }).click();
  await page.getByRole('button', { name: 'Save activity' }).click();
  await expect(page.getByText('MMA Training logged')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start workout/ }).first()).toBeVisible(); // Monday strength still planned
  await gotoTab(page, 'History');
  await expect(page.getByText('MMA Training').first()).toBeVisible();
  expect(w.errors).toEqual([]);
});
