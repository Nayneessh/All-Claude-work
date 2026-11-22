import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off', ...devices['Desktop Chrome'], launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      APP_ENV: 'test', NODE_ENV: 'production', AI_PROVIDER: 'mock', AUTH_PROVIDER: 'dev', BOTCHECK: 'off', SIGNING_SECRET: 'e2e-signing-secret', CRON_SECRET: 'e2e-cron',
      WHATSAPP_NUMBER: '+919876500000', NEXT_PUBLIC_AUTH_MODE: 'dev', TEST_BANNER: '1', RETENTION_UNBOOKED_HOURS: '24', NEXT_TELEMETRY_DISABLED: '1', RATE_LIMIT_SCALE: '100',
    },
  },
});
