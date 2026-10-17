import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: 'http://localhost:8787',
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
