import { defineConfig } from '@playwright/test';
// Records the landing-page demo video and screenshots from a fixture-mode app (CFS-163).
//   PORT=8792 ... node scripts/local-run.mjs   (fixture mode, throwaway database)
//   npx playwright test -c site/record/playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: /\.record\.ts$/,
  workers: 1,
  timeout: 300000,
  outputDir: '../../.runtime/site-record',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8792',
    headless: true,
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    launchOptions: { slowMo: 180 },
  },
  reporter: [['list']],
});
