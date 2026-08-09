import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    // Cookie-authenticated API mutations require an allowlisted Origin (ARCH-SEC-02A).
    extraHTTPHeaders: {
      Origin: process.env.E2E_WEB_ORIGIN ?? process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  outputDir: 'test-results',
});
