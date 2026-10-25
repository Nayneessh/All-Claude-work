import { expect, test } from '@playwright/test';
import { freshStart, watch } from './helpers';

test('Journey 1 — first launch: onboarding, v6 routine loaded, Today shows Monday', async ({ page }) => {
  const w = watch(page);
  await page.clock.setFixedTime(new Date('2026-10-26T09:00:00'));
  await page.goto('/');
  await expect(page.getByRole('img', { name: /Monster Gains|logo/i }).first().or(page.locator('img[src*="logo"]').first())).toBeVisible();
  await expect(page.getByText(/Monster Gains/i).first()).toBeVisible();
  await freshStart(page);
  await expect(page.getByText(/Back #1/).first()).toBeVisible();
  await expect(page.getByText(/Underhand Lat Pull/i).first()).toBeVisible();
  // bottom navigation present and usable
  for (const t of ['Today', 'Program', 'History', 'Progress', 'More']) await expect(page.getByRole('link', { name: t, exact: true })).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 1b — relaunch skips onboarding and keeps data', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await page.reload();
  await expect(page.getByRole('button', { name: /Start workout/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start training' })).toHaveCount(0);
  expect(w.errors).toEqual([]);
});
