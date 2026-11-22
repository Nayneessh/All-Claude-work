import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';

export const FX = (name: string) => join(process.cwd(), 'e2e', 'fixtures', name);

const MAINT: Record<string, string | string[]> = {
  skin_feel: 'comfortable', sun_exposure: 'moderate', current_products: ['cleanser'], time_per_day: 'two_steps', sensitivity: 'rarely',
  mole_changing: 'no', sore_not_healing: 'no', infection_signs: 'no', severe_inflammation: 'no', eye_area_problem: 'no',
  makeup_today: 'no', budget: 'b500_1500',
};
const CONCERNS: Record<string, string | string[]> = {
  duration: 'one_to_6m', worsened_by: ['sun'], tried: ['nothing'], pregnant_bf: 'no', medicines: 'none',
  mole_changing: 'no', sore_not_healing: 'no', infection_signs: 'no', severe_inflammation: 'no', eye_area_problem: 'no',
  rapid_worsening: 'no', painful_lumps: 'no', bleeding_or_oozing: 'no', makeup_today: 'no', budget: 'b500_1500',
};

export const ANSWERS = { maintenance: MAINT, concerns: CONCERNS };

/** Consents and age, then land on the private case page. */
export async function startCase(page: Page, lang: 'en' | 'hi', path: string, opts: { evaluation?: boolean } = {}) {
  await page.goto(`/${lang}/start?path=${path}`);
  await page.getByTestId('age').check();
  await page.getByTestId('consent-privacy').check();
  await page.getByTestId('consent-health').check();
  await page.getByTestId('consent-photos_ai').check();
  if (opts.evaluation) await page.getByTestId('consent-evaluation').check();
  await page.getByTestId('begin').click();
  await page.waitForURL(new RegExp(`/${lang}/case/`));
  return page.url().split('/case/')[1]!;
}

/** Fill the questionnaire sections in order. Overrides win over defaults. */
export async function answerQuestionnaire(page: Page, answers: Record<string, string | string[]>) {
  await expect(page.getByTestId('questionnaire')).toBeVisible();
  for (let i = 0; i < 4; i++) {
    if (!(await page.getByTestId('questionnaire').isVisible().catch(() => false))) break;
    const fields = page.locator('fieldset[data-testid^="q-"]');
    const n = await fields.count();
    for (let f = 0; f < n; f++) {
      const id = (await fields.nth(f).getAttribute('data-testid'))!.replace('q-', '');
      const v = answers[id];
      if (v === undefined) throw new Error(`no answer for ${id}`);
      for (const o of Array.isArray(v) ? v : [v]) await page.getByTestId(`q-${id}-${o}`).locator('xpath=ancestor::label').click();
    }
    await page.getByTestId('q-next').click();
    await page.waitForTimeout(250);
  }
}

export async function passIntro(page: Page) {
  await page.getByTestId('tips-ok').click();
  await page.getByTestId('ai-ok').click();
}

/** Upload-fallback capture of every required slot from a still image. */
export async function uploadAllSlots(page: Page, file: string, slots = 3) {
  for (let i = 0; i < slots; i++) {
    await expect(page.getByTestId('file-input')).toBeAttached({ timeout: 30_000 });
    await page.getByTestId('file-input').setInputFiles(file);
    await expect(page.getByTestId('photo-review')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('use-photo').click();
  }
}

export async function devSignIn(page: Page, role: 'cosmo' | 'admin' = 'cosmo') {
  await page.goto('/console');
  await page.getByTestId(`dev-${role}`).click();
  await expect(page.getByTestId('me')).toBeVisible();
}
