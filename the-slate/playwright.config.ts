import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the REAL built app against a REAL Supabase project, signed in as a dedicated test user
 * (E2E_EMAIL / E2E_PASSWORD). That user is isolated from every other account by Row Level Security.
 * Run:  npm run build && NODE_USE_ENV_PROXY=1 E2E_EMAIL=… E2E_PASSWORD=… npx playwright test --trace off
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4175', screenshot: 'only-on-failure', trace: 'off', actionTimeout: 15_000 },
  // When E2E_BASE_URL points at a deployed site (preview/production) no local server is started.
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'npm run preview', url: 'http://127.0.0.1:4175', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'desktop', testMatch: /slate\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'test-results/auth.json' }, dependencies: ['setup'] },
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 7'], storageState: 'test-results/auth.json' }, dependencies: ['setup'] },
  ],
});
