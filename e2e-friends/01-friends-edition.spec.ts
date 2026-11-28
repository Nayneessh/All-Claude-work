import { expect, test, type Page } from '@playwright/test';
import { gotoTab, watch } from '../e2e/helpers';

/**
 * The "friends" edition: same app, same Supabase, but it starts empty — the author's own routine is not offered, not loaded
 * and not even present in the bundle (scripts/check-friends-bundle.mjs asserts the last part when the bundle is built).
 */

/** Monday 26 Oct 2026 — the day the author's routine has a workout planned. Here nothing may be planned. */
const FIXED_NOW = new Date('2026-10-26T09:00:00');
const OWNER_TRACES = /Arms First|Chest = Back|\bv6\b|Back #1|Chest #1|Triceps #1|Biceps #1/;

async function firstLaunch(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Your program' })).toBeVisible();
  await expect(page.getByText('Start with a clean slate')).toBeVisible();
  await expect(page.getByText('Load my v6 routine')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page.getByText('No program yet').first()).toBeVisible();
}

test('First launch is a clean slate: no routine offered, none loaded, nothing planned for today', async ({ page }) => {
  const w = watch(page);
  await firstLaunch(page);
  await expect(page.getByRole('button', { name: /Start workout/ })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(OWNER_TRACES);
  await gotoTab(page, 'Program');
  await expect(page.getByText('No program yet').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(OWNER_TRACES);
  expect(w.errors).toEqual([]);
});

test('The local database holds no program, template, planned exercise or session — but the full exercise library is there', async ({ page }) => {
  const w = watch(page);
  await firstLaunch(page);
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('monster-gains'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out: Record<string, number> = {};
    for (const name of ['programs', 'program_versions', 'workout_templates', 'planned_exercises', 'program_modifications', 'workout_sessions', 'session_exercises', 'set_records', 'exercises']) {
      out[name] = db.objectStoreNames.contains(name)
        ? await new Promise<number>((res, rej) => { const r = db.transaction(name).objectStore(name).count(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })
        : -1; // a missing store must not pass silently
    }
    db.close();
    return out;
  });
  for (const k of ['programs', 'program_versions', 'workout_templates', 'planned_exercises', 'program_modifications', 'workout_sessions', 'session_exercises', 'set_records']) expect(counts[k], k).toBe(0);
  expect(counts.exercises, 'built-in exercise library').toBeGreaterThanOrEqual(100);
  expect(w.errors).toEqual([]);
});

test('Choose from the list and add to the list: a custom exercise goes into a program of their own and is trained', async ({ page }) => {
  const w = watch(page);
  await firstLaunch(page);

  // add to the list
  await page.goto('/#/exercises');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Name').first().fill('My Cable Fly');
  await page.locator('.field', { hasText: 'Primary muscles' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Save exercise' }).click();
  await expect(page.getByText('Exercise created')).toBeVisible();

  // their own program from the list (built-in or their own exercise)
  await gotoTab(page, 'Program');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Name').fill('My Push');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('My Push').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add training day' }).click();
  await page.getByLabel('Name').fill('Push · chest');
  await page.getByRole('button', { name: 'Mon', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Apply change/ }).click();
  await page.getByText('Push · chest').first().click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByLabel('Search exercises').fill('bench');
  await page.locator('button.item').first().click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByLabel('Search exercises').fill('My Cable Fly');
  await page.locator('button.item').first().click();
  await page.getByRole('button', { name: /Save changes/ }).click();
  await page.getByRole('button', { name: /^Apply change/ }).click();

  // it shows up on Today (a Monday) and can be trained
  await gotoTab(page, 'Today');
  await expect(page.getByText('Push · chest').first()).toBeVisible();
  await expect(page.getByText('My Cable Fly').first()).toBeVisible();
  await page.getByRole('button', { name: /Start workout/ }).first().click();
  await page.getByLabel('Set 1 Reps').first().fill('10');
  await page.getByRole('button', { name: 'Complete set 1' }).first().click();
  await expect(page.getByText(/^1\/\d+ sets$/)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(OWNER_TRACES);
  expect(w.errors).toEqual([]);
});

test('A quick workout needs no program: log a set, reload, it is still there', async ({ page }) => {
  const w = watch(page);
  await firstLaunch(page);
  await page.getByRole('button', { name: 'Start a quick workout' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  await page.getByLabel('Search exercises').fill('bench');
  await page.locator('button.item').first().click();
  await expect(page.getByText('0/3 sets')).toBeVisible();
  await page.getByLabel('Set 1 Reps').first().fill('10');
  await page.getByRole('button', { name: 'Complete set 1' }).first().click();
  await expect(page.getByText('1/3 sets')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1/3 sets').or(page.getByRole('button', { name: /Resume/ }).first()).first()).toBeVisible();
  if (!/workout/.test(page.url())) await page.getByRole('button', { name: /Resume/ }).first().click();
  await expect(page.getByText('1/3 sets')).toBeVisible();
  expect(w.errors).toEqual([]);
});
