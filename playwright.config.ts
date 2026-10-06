import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  outputDir: 'test-results/browser',
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    actionTimeout: 15_000,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 960 },
    locale: 'en-US',
    timezoneId: 'Europe/Rome',
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
})
