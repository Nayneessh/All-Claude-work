// Drives the real app inside the Android emulator's WebView (debug build) through Playwright's Android support (DevTools over adb).
//
//   node cdp-journey.mjs <outDir> full       first launch → log a set → kill the process → relaunch → the set is still there
//   node cdp-journey.mjs <outDir> seed       fresh install: onboarding → quick workout → exercise → log a set (reps 10)
//   node cdp-journey.mjs <outDir> verify     after an in-place update: the workout and the logged set are still there
//   node cdp-journey.mjs <outDir> keyboard   real touch + real soft keyboard: typing must never lose focus or flicker the keyboard
import { _android as android } from '@playwright/test';

const OUT = process.argv[2] ?? 'out';
const MODE = process.argv[3] ?? 'full';
const PKG = 'com.monstergains.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => { if (!cond) throw new Error(`CHECK FAILED: ${msg}`); console.log(`ok  ${msg}`); };

const [device] = await android.devices();
if (!device) throw new Error('no Android device/emulator found');
console.log(`device: ${device.model()} (${device.serial()})  mode=${MODE}`);

async function launch() {
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function onboard(page) {
  await page.getByRole('button', { name: 'Next' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await page.getByRole('button', { name: 'Quick workout' }).first().waitFor({ timeout: 20_000 });
}

/** A quick (unplanned) workout works on any weekday/date, so these checks never depend on the routine's schedule. */
async function quickWorkoutWithSet(page) {
  await page.getByRole('button', { name: 'Quick workout' }).first().click();
  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  await page.getByLabel('Search exercises').fill('bench');
  await page.locator('button.item').first().click();
  await page.getByText('0/3 sets').waitFor({ timeout: 20_000 });
  await page.getByLabel('Set 1 Reps').first().fill('10');
  await page.getByRole('button', { name: 'Complete set 1' }).first().click();
  await page.getByText('1/3 sets').waitFor({ timeout: 10_000 });
}

async function expectSetStillThere(page, why) {
  await page.getByText('1/3 sets').or(page.getByRole('button', { name: /Resume/ }).first()).first().waitFor({ timeout: 30_000 });
  if (!/workout/.test(page.url())) await page.getByRole('button', { name: /Resume/ }).first().click();
  await page.getByText('1/3 sets').waitFor({ timeout: 15_000 });
  const reps = await page.getByLabel('Set 1 Reps').first().inputValue();
  check(reps === '10', `${why}: the logged set is still there (reps=${reps})`);
}

// ── real touch + real soft keyboard helpers ─────────────────────────────────────────────────────────────────────────────────────
const imeShown = async () => {
  const out = await device.shell('dumpsys input_method');
  const text = out.toString();
  const m = text.match(/mInputShown=(true|false)/) ?? text.match(/mIsInputViewShown=(true|false)/) ?? text.match(/isInputViewShown=(true|false)/);
  return m ? m[1] === 'true' : null;
};

async function calibrate(page) {
  // Where is the WebView on the screen? Tap a known screen point and read back where the page saw the touch.
  await page.evaluate(() => { window.__cal = null; document.addEventListener('pointerdown', (e) => { window.__cal = { x: e.clientX, y: e.clientY }; }, { capture: true, once: true }); });
  await device.shell('input tap 540 1500');
  await sleep(600);
  const cal = await page.evaluate(() => window.__cal);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  if (!cal) throw new Error('calibration tap was not seen by the page');
  return { dpr, ox: 540 - cal.x * dpr, oy: 1500 - cal.y * dpr };
}
async function realTap(page, cal, locator) {
  // a real finger can only hit what is on the screen: bring the element to the middle of the visible area first
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(500);
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box to tap');
  const x = Math.round(cal.ox + (box.x + box.width / 2) * cal.dpr);
  const y = Math.round(cal.oy + (box.y + box.height / 2) * cal.dpr);
  await device.shell(`input tap ${x} ${y}`);
}
/** Tap until `appears` is visible (a tap that lands on a moving layout can miss once); keep a screenshot if it never works. */
async function tapUntilVisible(page, cal, tapTarget, appears, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await realTap(page, cal, tapTarget);
    try { await appears.waitFor({ state: 'visible', timeout: 6_000 }); return; } catch { console.log(`   [${name}] tap ${attempt} did not open it, retrying`); }
  }
  await device.screenshot({ path: `${OUT}/06-tap-failed-${name.replace(/\W+/g, '-').toLowerCase()}.png` });
  throw new Error(`CHECK FAILED: ${name} did not open after 3 real taps`);
}

async function keyboardStability(page, cal, label, openByTapping, text) {
  await openByTapping();
  const field = page.getByLabel(label);
  await field.waitFor({ timeout: 10_000 });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) ?? document.activeElement;
    window.__kb = { blur: 0, resize: 0 };
    el.addEventListener('blur', () => { window.__kb.blur++; });
    window.visualViewport?.addEventListener('resize', () => { window.__kb.resize++; });
  }, `input[aria-label="${label}"]`);
  await sleep(1200);
  // some emulators only show the soft keyboard once the field itself is tapped
  if (!(await page.evaluate((l) => document.activeElement?.getAttribute('aria-label') === l, label))) await realTap(page, cal, field);
  await sleep(800);
  const samples = [];
  let sampling = true;
  const sampler = (async () => { while (sampling) { samples.push(await imeShown()); await sleep(200); } })();
  for (const ch of text) { await device.shell(`input text ${ch}`); await sleep(750); } // spans several 1 s re-renders of the screen
  await sleep(1200);
  sampling = false; await sampler;
  const known = samples.filter((s) => s !== null);
  const shownAtLeastOnce = known.some(Boolean);
  const transitions = known.reduce((n, s, i) => (i > 0 && s !== known[i - 1] ? n + 1 : n), 0);
  const stats = await page.evaluate(() => window.__kb);
  const value = await field.inputValue();
  const focused = await page.evaluate((l) => document.activeElement?.getAttribute('aria-label') === l, label);
  console.log(`   [${label}] value="${value}" blur=${stats.blur} viewportResize=${stats.resize} imeSamples=${known.length} imeShown=${shownAtLeastOnce} imeTransitions=${transitions} focused=${focused}`);
  await device.screenshot({ path: `${OUT}/06-keyboard-${label.replace(/\W+/g, '-').toLowerCase()}.png` });
  check(value === text, `${label}: everything typed arrived ("${value}")`);
  check(stats.blur === 0, `${label}: the field never lost focus while typing (blur events=${stats.blur})`);
  check(focused, `${label}: the field is still focused after typing`);
  if (shownAtLeastOnce) check(transitions <= 1, `${label}: the soft keyboard did not flicker (open/close transitions=${transitions})`);
  else console.log(`   [${label}] note: this emulator never reported the soft keyboard as shown; only focus stability was asserted`);
}

// ── scenarios ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (MODE === 'full' || MODE === 'seed' || MODE === 'keyboard') await device.shell(`pm clear ${PKG}`);
let page = await launch();

if (MODE === 'full') {
  await onboard(page);
  check(true, 'first launch inside Android WebView shows onboarding and reaches Today');
  await device.screenshot({ path: `${OUT}/03-webview-today.png` });
  await quickWorkoutWithSet(page);
  check(true, 'a set was logged ("1/3 sets") in the real WebView');
  await device.screenshot({ path: `${OUT}/04-webview-logged.png` });
  await sleep(1500);
  console.log('-- killing the app process, as Android may at any time');
  await device.shell(`am force-stop ${PKG}`);
  await sleep(2000);
  page = await launch();
  await expectSetStillThere(page, 'after the process was killed and relaunched');
  await device.screenshot({ path: `${OUT}/05-webview-after-restart.png` });
}

if (MODE === 'seed') {
  await onboard(page);
  await quickWorkoutWithSet(page);
  check(true, 'seeded: onboarding done, quick workout with one logged set (reps 10)');
  await sleep(1500);
}

if (MODE === 'verify') {
  await expectSetStillThere(page, 'after updating the app in place');
  await device.screenshot({ path: `${OUT}/07-after-update.png` });
}

if (MODE === 'keyboard') {
  await device.shell('settings put secure show_ime_with_hard_keyboard 1');
  await onboard(page);
  const cal = await calibrate(page);
  console.log(`calibration: dpr=${cal.dpr} offset=(${Math.round(cal.ox)},${Math.round(cal.oy)})`);
  await page.getByRole('button', { name: 'Quick workout' }).first().click();
  // 1) the exercise search inside a sheet (the screen behind it re-renders every second)
  await keyboardStability(page, cal, 'Search exercises', async () => { await realTap(page, cal, page.getByRole('button', { name: 'Add exercise' }).first()); }, 'bench');
  await page.locator('button.item').first().click();
  await page.getByText('0/3 sets').waitFor({ timeout: 20_000 });
  // 2) a set row on the workout screen
  await page.evaluate(() => document.activeElement?.blur?.()); // put the keyboard away without pressing Back (Back would leave the screen)
  await sleep(800);
  await keyboardStability(page, cal, 'Set 1 Reps', async () => { await realTap(page, cal, page.getByLabel('Set 1 Reps').first()); }, '12');
  // 3) a text field in another sheet (Add activity on Today)
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(1000);
  await page.goto(page.url().split('#')[0] + '#/');
  await page.getByRole('button', { name: 'Add activity' }).waitFor({ timeout: 15_000 });
  await sleep(1000);
  await keyboardStability(page, cal, 'Minutes', async () => {
    await tapUntilVisible(page, cal, page.getByRole('button', { name: 'Add activity' }), page.getByLabel('Minutes'), 'Add activity sheet');
    await realTap(page, cal, page.getByLabel('Minutes'));
  }, '45');
}

await device.close();
