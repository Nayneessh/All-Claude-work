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
  // rows re-render when a set completes (live query), so resolve the target afresh and retry once on a detached node
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = page.locator('[data-testid^="set-"]:not(.done):not(.skipped)').first();
      await row.waitFor({ timeout: 5000 });
      const repsInput = row.locator('input[aria-label$="Reps"], input[aria-label$="Time"]').first();
      if (await repsInput.inputValue() === '') await repsInput.fill(reps);
      await row.getByRole('button', { name: /^Complete set/ }).click();
      return;
    } catch (e) { if (attempt === 2) throw e; await page.waitForTimeout(150); }
  }
}

/** "3/9 sets" in the workout header → { done: 3, total: 9 } */
export async function setProgress(page: Page): Promise<{ done: number; total: number }> {
  const t = await page.getByText(/^\d+\/\d+ sets$/).first().innerText();
  const [done, total] = t.split(' ')[0]!.split('/').map(Number);
  return { done: done!, total: total! };
}

/** Completes exactly `count` sets, waiting for the header counter after each so a stale render is never re-clicked. */
export async function completeSets(page: Page, count: number, reps = '10'): Promise<void> {
  await page.locator('[data-testid^="set-"]').first().waitFor();
  for (let i = 0; i < count; i++) {
    const { done } = await setProgress(page);
    await completeNextSet(page, reps);
    await expect.poll(async () => (await setProgress(page)).done, { timeout: 5000 }).toBe(done + 1);
  }
}

export async function completeAllSets(page: Page, reps = '10'): Promise<number> {
  await page.locator('[data-testid^="set-"]').first().waitFor();
  let n = 0;
  for (let guard = 0; guard < 80; guard++) {
    const { done, total } = await setProgress(page);
    if (done >= total) break;
    await completeNextSet(page, reps);
    await expect.poll(async () => (await setProgress(page)).done, { timeout: 5000 }).toBe(done + 1); // header follows the live query
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
