import { expect, type Page } from '@playwright/test';

/** Monday 26 Oct 2026 — the routine's day 1, so Today always has a planned workout. */
export const FIXED_NOW = new Date('2026-10-26T09:00:00');

export interface Watch { errors: string[] }

/** Collects uncaught page errors and console errors; every journey asserts this stays empty. */
export function watch(page: Page): Watch {
  const w: Watch = { errors: [] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') w.errors.push(`console: ${m.text()}`); });
  return w;
}

export async function freshStart(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page.getByRole('button', { name: /Start workout/ }).first()).toBeVisible();
}

export async function startTodayWorkout(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Start workout/ }).first().click();
  await expect(page).toHaveURL(/#\/workout\/[0-9a-f-]+$/);
  return page.url().split('/workout/')[1]!;
}

/** Fills reps (and load when empty) then taps the check on the first not-yet-done set. */
export async function completeNextSet(page: Page, reps = '10'): Promise<void> {
  const row = page.locator('[data-testid^="set-"]:not(.done)').first();
  await row.scrollIntoViewIfNeeded();
  const repsInput = row.locator('input[aria-label$="Reps"], input[aria-label$="Time"]').first();
  if (await repsInput.inputValue() === '') await repsInput.fill(reps);
  await row.getByRole('button', { name: /^Complete set/ }).click();
}

export async function completeAllSets(page: Page, reps = '10'): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 60; guard++) {
    const left = await page.locator('[data-testid^="set-"]:not(.done)').count();
    if (left === 0) break;
    // sets skipped/warm-up rows are still ".set-r" — stop when no completable set remains
    const completable = await page.locator('[data-testid^="set-"]:not(.done):not(.skipped)').count();
    if (completable === 0) break;
    await completeNextSet(page, reps);
    n++;
  }
  return n;
}

export async function finishWorkout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('heading', { name: 'Workout saved' })).toBeVisible();
}

export async function gotoTab(page: Page, label: 'Today' | 'Program' | 'History' | 'Progress' | 'More'): Promise<void> {
  await page.getByRole('link', { name: label, exact: true }).click();
}
