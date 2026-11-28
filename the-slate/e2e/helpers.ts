import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL ?? '';
export const PASSWORD = process.env.E2E_PASSWORD ?? '';
export const SB_URL = process.env.VITE_SUPABASE_URL ?? '';
export const SB_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/** A second, independent client signed in as the same test user — used to verify what the UI persisted in the database. */
export async function dbClient() {
  const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw error;
  return c;
}
export async function openMenu(page: Page, label: string) {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
}
export const MINI_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
