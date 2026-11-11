import { test as base, expect } from '@playwright/test';

// The group-interface specs run at ?classic=1. The flag is added before the app reads the URL,
// on every navigation in the test's browser context.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      const url = new URL(window.location.href);
      if (url.protocol.startsWith('http') && !url.searchParams.has('classic')) {
        url.searchParams.set('classic', '1');
        window.history.replaceState(window.history.state, '', url);
      }
    });
    await use(context);
  },
});
export { expect };
export type { Page, Route } from '@playwright/test';
