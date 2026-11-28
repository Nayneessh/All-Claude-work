import { test, expect } from '@playwright/test';

test('mobile profile: shell, menu and key pages render without horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('YOUR LOGO HERE')).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'The Slate' }).click();
  await expect(page.getByLabel('Add a task')).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
});
