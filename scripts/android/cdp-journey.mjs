// Drives the real app inside the Android emulator's WebView (debug build) via Chrome DevTools, then kills and relaunches the process.
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';

const OUT = process.argv[2] ?? 'out';
const PKG = 'com.monstergains.app';
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchAndConnect() {
  sh(`adb shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  let pid = '';
  for (let i = 0; i < 30 && !pid; i++) { await sleep(1000); try { pid = sh(`adb shell pidof ${PKG}`).split(' ')[0]; } catch { /* not yet */ } }
  if (!pid) throw new Error('app process did not start');
  for (let i = 0; i < 30; i++) {
    try {
      const sockets = sh(`adb shell "cat /proc/net/unix" | grep webview_devtools_remote_${pid} || true`);
      if (sockets) break;
    } catch { /* retry */ }
    await sleep(1000);
  }
  sh(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  let page;
  for (let i = 0; i < 30 && !page; i++) { page = browser.contexts().flatMap((c) => c.pages())[0]; if (!page) await sleep(1000); }
  if (!page) throw new Error('no WebView page');
  return { browser, page };
}
const check = (cond, msg) => { if (!cond) throw new Error(`CHECK FAILED: ${msg}`); console.log(`ok  ${msg}`); };

sh(`adb shell pm clear ${PKG}`);
let { browser, page } = await launchAndConnect();
await page.waitForSelector('text=Next', { timeout: 30000 });
check(true, 'onboarding shown on first launch inside Android WebView');
await page.screenshot({ path: `${OUT}/02-webview-onboarding.png` });
await page.getByRole('button', { name: 'Next' }).click();
await page.getByRole('button', { name: 'Next' }).click();
await page.getByRole('button', { name: 'Start training' }).click();
await page.getByRole('button', { name: /Start workout|Resume/ }).first().waitFor({ timeout: 20000 });
await page.screenshot({ path: `${OUT}/03-webview-today.png` });
await page.getByRole('button', { name: /Start workout/ }).first().click();
await page.getByLabel('Set 1 Reps').first().waitFor({ timeout: 20000 });
await page.getByLabel('Set 1 Reps').first().fill('10');
await page.getByRole('button', { name: 'Complete set 1' }).first().click();
await page.getByText('1/9 sets').waitFor({ timeout: 10000 });
check(true, 'a set was logged ("1/9 sets")');
await page.screenshot({ path: `${OUT}/04-webview-logged.png` });
await sleep(1000); // let the local database flush
await browser.close();

console.log('-- killing the app process (as Android may at any time)');
sh(`adb shell am force-stop ${PKG}`);
await sleep(2000);
({ browser, page } = await launchAndConnect());
await page.getByText('1/9 sets').or(page.getByRole('button', { name: /Resume/ }).first()).first().waitFor({ timeout: 30000 });
const url = page.url();
if (!/workout/.test(url)) await page.getByRole('button', { name: /Resume/ }).first().click();
await page.getByText('1/9 sets').waitFor({ timeout: 15000 });
check(true, 'after the process was killed and relaunched, the logged set is still there');
await page.screenshot({ path: `${OUT}/05-webview-after-restart.png` });
const reps = await page.getByLabel('Set 1 Reps').first().inputValue();
check(reps === '10', `the stored value survived the restart (reps=${reps})`);
await browser.close();
