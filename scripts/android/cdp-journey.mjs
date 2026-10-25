// Drives the real app inside the Android emulator's WebView (debug build) through Playwright's Android support (DevTools over adb),
// then kills the app process and relaunches it to prove the logged data survives.
import { _android as android } from '@playwright/test';

const OUT = process.argv[2] ?? 'out';
const PKG = 'com.monstergains.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, msg) => { if (!cond) throw new Error(`CHECK FAILED: ${msg}`); console.log(`ok  ${msg}`); };

const [device] = await android.devices();
if (!device) throw new Error('no Android device/emulator found');
console.log(`device: ${device.model()} (${device.serial()})`);

async function launch() {
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

await device.shell(`pm clear ${PKG}`);
let page = await launch();
await page.getByRole('button', { name: 'Next' }).waitFor({ timeout: 30_000 });
check(true, 'first launch inside Android WebView shows onboarding');
await device.screenshot({ path: `${OUT}/02-webview-onboarding.png` });
await page.getByRole('button', { name: 'Next' }).click();
await page.getByRole('button', { name: 'Next' }).click();
await page.getByRole('button', { name: 'Start training' }).click();
await page.getByRole('button', { name: /Start workout|Resume/ }).first().waitFor({ timeout: 20_000 });
await device.screenshot({ path: `${OUT}/03-webview-today.png` });
await page.getByRole('button', { name: /Start workout/ }).first().click();
await page.getByLabel('Set 1 Reps').first().waitFor({ timeout: 20_000 });
await page.getByLabel('Set 1 Reps').first().fill('10');
await page.getByRole('button', { name: 'Complete set 1' }).first().click();
await page.getByText('1/9 sets').waitFor({ timeout: 10_000 });
check(true, 'a set was logged ("1/9 sets") in the real WebView');
await device.screenshot({ path: `${OUT}/04-webview-logged.png` });
await sleep(1500); // let the local database flush

console.log('-- killing the app process, as Android may at any time');
await device.shell(`am force-stop ${PKG}`);
await sleep(2000);
page = await launch();
await page.getByText('1/9 sets').or(page.getByRole('button', { name: /Resume/ }).first()).first().waitFor({ timeout: 30_000 });
if (!/workout/.test(page.url())) await page.getByRole('button', { name: /Resume/ }).first().click();
await page.getByText('1/9 sets').waitFor({ timeout: 15_000 });
check(true, 'after the process was killed and relaunched, the logged set is still there');
await device.screenshot({ path: `${OUT}/05-webview-after-restart.png` });
const reps = await page.getByLabel('Set 1 Reps').first().inputValue();
check(reps === '10', `the stored value survived the restart (reps=${reps})`);
await device.close();
