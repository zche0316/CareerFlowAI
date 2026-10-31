import { test, expect } from '@playwright/test';

for (const calls of [11, 12]) {
  test(`failed mission recovery with ${calls} calls`, async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        path === '/api/session'
          ? { user: { name: 'Recovery QA' }, mode: 'fixture' }
          : path === '/api/workspace'
            ? {
                profile: { version: 1, data: { name: 'Recovery QA', skills: [] } },
                resumes: [],
                missions: [
                  {
                    id: 'recovery-qa',
                    goal: 'Find a suitable role',
                    status: 'FAILED',
                    mode: 'fixture',
                    createdAt: '2026-10-30T00:00:00Z',
                    error: 'The mission reached its 12-call budget.',
                    data: { apiCalls: calls },
                    events: [],
                  },
                ],
              }
            : [];
      await route.fulfill({ json: body });
    });
    await page.goto('/');
    await page
      .getByRole('button', {
        name: calls === 12 ? 'Review saved results' : 'Review and retry',
        exact: true,
      })
      .click();
    await expect(page.getByText('STEP 02 OF 08', { exact: true })).toBeVisible();
    await expect(page.getByText('Before you start', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Your career team is preparing this step.', { exact: false }),
    ).toHaveCount(0);
    if (calls === 12) {
      await expect(page.getByRole('button', { name: 'Retry failed step' })).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText('Your saved results are still available');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Start a new mission', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'What’s your next career goal?' }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole('button', { name: 'Close mission form' }).click();
      await page.screenshot({ path: 'output/ui-tightening/recovery-mobile.png', fullPage: true });
    } else {
      await expect(page.getByRole('button', { name: 'Retry failed step' })).toBeEnabled();
      await expect(
        page.getByRole('button', { name: 'Start a new mission', exact: true }),
      ).toHaveCount(0);
    }
  });
}
