import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787',
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  // The group-interface specs run at ?classic=1 (tests/e2e/classic.ts); quest specs use the default UI.
  projects: [
    { name: 'classic', testIgnore: /quest\.spec\.ts$/ },
    { name: 'quest', testMatch: /quest\.spec\.ts$/ },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
