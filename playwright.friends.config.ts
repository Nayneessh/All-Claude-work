import { defineConfig, devices } from '@playwright/test';

/** End-to-end journeys for the "friends" edition: built with VITE_EDITION=friends (no routine in the bundle) into dist-friends. */
export default defineConfig({
  testDir: 'e2e-friends',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-friends' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Pixel 7'],
    browserName: 'chromium',
  },
  webServer: {
    command: 'npm run build:friends && npm run preview:friends',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
