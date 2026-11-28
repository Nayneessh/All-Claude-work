import { test as setup, expect } from '@playwright/test';
import { EMAIL, PASSWORD } from './helpers';

setup('sign in once and keep the session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  // wrong password is refused with a clear message
  await page.getByLabel('Email').fill(EMAIL); await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  await page.context().storageState({ path: 'test-results/auth.json' });
});
