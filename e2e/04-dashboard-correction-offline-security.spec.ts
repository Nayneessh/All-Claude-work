import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { completeAllSets, finishWorkout, freshStart, gotoTab, startTodayWorkout, watch } from './helpers';

test('Journey 5 — dashboard: empty state first, real numbers after a workout, nothing invented', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await gotoTab(page, 'Progress');
  await expect(page.getByText('Your progress starts with your first workout')).toBeVisible();
  await gotoTab(page, 'Today');
  await startTodayWorkout(page);
  await completeAllSets(page, '10');
  await finishWorkout(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await gotoTab(page, 'Progress');
  await expect(page.getByText('Plan vs reality')).toBeVisible();
  await expect(page.getByText('Muscle groups')).toBeVisible();
  await expect(page.getByText('Strength trend')).toBeVisible();
  // e1RM is always labelled as an estimate
  await expect(page.getByText(/estimated|e1RM/i).first()).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 6 — historical correction: totals follow, audit trail records it, the plan is untouched', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await completeAllSets(page, '10');
  await finishWorkout(page);
  await page.getByRole('button', { name: 'View details' }).click();
  await expect(page.getByText('65 × 10').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit set 1' }).first().click();
  await expect(page.getByText(/finished\. Your correction updates totals/)).toBeVisible();
  await page.getByLabel(/^Load/).fill('70');
  await page.getByLabel('Reps').fill('9');
  await page.getByLabel(/Why\?/).fill('typo');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('70 × 9').first()).toBeVisible();
  await expect(page.getByText('Plan: 3 × 8-12').first()).toBeVisible();
  await page.getByRole('button', { name: /Corrections & audit trail \(([1-9])/ }).click();
  await expect(page.getByText(/typo/).first()).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('Journey 7 — offline: a whole workout is logged with no network, saved locally, and survives a restart', async ({ page, context }) => {
  const w = watch(page);
  await freshStart(page);
  await page.waitForFunction(() => document.documentElement.dataset.screensReady === '1'); // every screen cached before the network drops
  await context.setOffline(true);
  await startTodayWorkout(page);
  await completeAllSets(page, '11');
  await finishWorkout(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await context.setOffline(false);
  await page.reload();
  await gotoTab(page, 'History');
  await expect(page.getByText(/Back #1/).first()).toBeVisible();
  await page.getByText(/Back #1/).first().click();
  await expect(page.getByText('65 × 11').first()).toBeVisible();
  expect(w.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(e))).toEqual([]);
});

test('Journey 7b — an export is a complete, readable backup of what was logged', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await startTodayWorkout(page);
  await completeAllSets(page, '10');
  await finishWorkout(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save a full backup/ }).click()]);
  const path = await dl.path();
  const json = JSON.parse(readFileSync(path!, 'utf8')) as { app?: string; tables?: Record<string, unknown[]> };
  expect(json.app ?? '').toMatch(/monster/i);
  const t = json.tables ?? {};
  expect((t.workout_sessions ?? []).length).toBeGreaterThanOrEqual(1);
  expect((t.set_records ?? []).filter((r) => (r as { status: string }).status === 'completed').length).toBe(9);
  expect(JSON.stringify(json)).not.toMatch(/service_role|access_token|refresh_token/);
  expect(w.errors).toEqual([]);
});

test('Journey 8 — security: no privileged secrets in the shipped bundle, no tokens stored while signed out', async ({ page }) => {
  const w = watch(page);
  const dist = join(process.cwd(), 'dist');
  const files: string[] = [];
  const walk = (d: string): void => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|html|css|json|svg)$/.test(f.name)) files.push(p); } };
  walk(dist);
  expect(files.length).toBeGreaterThan(3);
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  expect(all).not.toMatch(/service_role/i);
  expect(all).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/);
  expect(all).not.toMatch(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/);
  // JWTs in the bundle must not be a service-role token
  for (const m of all.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    const payload = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')) as { role?: string };
    expect(payload.role).not.toBe('service_role');
  }
  await freshStart(page);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toMatch(/access_token|refresh_token/);
  expect(w.errors).toEqual([]);
});
