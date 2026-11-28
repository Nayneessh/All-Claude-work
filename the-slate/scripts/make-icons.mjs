// Renders public/favicon.svg to the PNG icons used by the web-app manifest and push notifications.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#0A1428">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), await page.screenshot({ type: 'png', omitBackground: false }));
  await page.close();
}
await browser.close();
