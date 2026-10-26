import { expect, test } from '@playwright/test';
import { completeSets, freshStart, startTodayWorkout, watch } from './helpers';

test('Swap exercise: pick a replacement → confirm → the exercise is replaced, history keeps the plan', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await page.getByRole('button', { name: 'Underhand Lat Pulldown options' }).click();
  await page.getByRole('button', { name: /Substitute exercise/ }).click();
  const picker = page.getByRole('dialog', { name: /Replace Underhand Lat Pulldown/ });
  await expect(picker).toBeVisible();
  await picker.locator('button.item').first().click();
  // the confirmation sheet must appear (this used to close the whole flow instead)
  const confirm = page.getByRole('dialog', { name: 'Substitute' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText('The original prescription is kept')).toBeVisible();
  await confirm.getByRole('button', { name: 'Swap exercise' }).click();
  await expect(page.getByText(/^Swapped to /)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Underhand Lat Pulldown options' })).toHaveCount(0);
  // nothing else was disturbed: the workout is still usable and 9 sets remain
  await expect(page.getByText('0/9 sets')).toBeVisible();
  await completeSets(page, 1);
  await expect(page.getByText('1/9 sets')).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Typing in a sheet never loses focus (the on-screen keyboard must stay open) even while the screen re-renders every second', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await page.getByRole('button', { name: 'Add activity' }).click();
  const minutes = page.getByLabel('Minutes');
  await minutes.click();
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    (window as unknown as { __focusLost: number }).__focusLost = 0;
    el.addEventListener('blur', () => { (window as unknown as { __focusLost: number }).__focusLost++; });
  });
  for (const ch of '45') { await page.keyboard.type(ch); await page.waitForTimeout(1300); } // spans two clock ticks of the Today screen
  await expect(minutes).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __focusLost: number }).__focusLost)).toBe(0);
  await expect(minutes).toHaveValue('45');
  expect(w.errors).toEqual([]);
});

test('Typing in the exercise search keeps focus and filters live', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const search = page.getByLabel('Search exercises');
  await expect(search).toBeFocused();
  await page.evaluate(() => { (window as unknown as { __lost: number }).__lost = 0; document.activeElement?.addEventListener('blur', () => { (window as unknown as { __lost: number }).__lost++; }); });
  for (const ch of 'bench') { await page.keyboard.type(ch); await page.waitForTimeout(1200); }
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __lost: number }).__lost)).toBe(0);
  await expect(search).toHaveValue('bench');
  expect(w.errors).toEqual([]);
});

test('Swap for "future sessions too": the scope preview appears and applying it creates a new program version', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await page.getByRole('button', { name: 'Leg Press options' }).click();
  await page.getByRole('button', { name: /Substitute exercise/ }).click();
  await page.getByRole('dialog', { name: /Replace Leg Press/ }).locator('button.item').first().click();
  const confirm = page.getByRole('dialog', { name: 'Substitute' });
  await confirm.getByText('Future sessions too').click();
  await confirm.getByRole('button', { name: 'Swap exercise' }).click();
  const scope = page.getByRole('dialog', { name: /Apply this change to/ });
  await expect(scope).toBeVisible();
  await expect(scope.getByText('What will change')).toBeVisible();
  await scope.getByRole('button', { name: /^Apply change/ }).click();
  await expect(page.getByText(/New program version saved|Program updated/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(w.errors).toEqual([]);
});

test('Typing reps in a set row keeps focus while the workout clock ticks (no keyboard flicker)', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  const reps = page.getByLabel('Set 1 Reps').first();
  await reps.click();
  await page.evaluate(() => { (window as unknown as { __b: number }).__b = 0; document.activeElement?.addEventListener('blur', () => { (window as unknown as { __b: number }).__b++; }); });
  for (const ch of '12') { await page.keyboard.type(ch); await page.waitForTimeout(1300); }
  await expect(reps).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __b: number }).__b)).toBe(0);
  await expect(reps).toHaveValue('12');
  // the draft was saved without disturbing the input: complete the set with the typed value
  await page.getByRole('button', { name: 'Complete set 1' }).first().click();
  await expect(page.getByText('1/9 sets')).toBeVisible();
  await expect(reps).toHaveValue('12');
  expect(w.errors).toEqual([]);
});
