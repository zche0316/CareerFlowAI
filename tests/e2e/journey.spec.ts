import { test, expect } from '@playwright/test';
test('a user reviews facts and completes the approval-gated career journey', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Browser QA');
  await page.getByLabel('Email address').fill(`browser-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clearer path forward.' })).toBeVisible();
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile' }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Career missions', exact: true }).click();
  await page.getByRole('button', { name: 'New career mission' }).click();
  await page.getByRole('button', { name: 'Start career mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your evidence-grounded resume' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Approve & save resume' })).toBeDisabled();
  await page.getByLabel('I reviewed the selected claims').check();
  await page.getByRole('button', { name: 'Approve & save resume' }).click();
  await expect(page.getByLabel('Your response', { exact: true })).toBeVisible({ timeout: 30000 });
  await page
    .getByLabel('Your response', { exact: true })
    .fill(
      'I used SQL in my student project to check a sample dataset and prepare a report. My task was to review missing values and document the queries.',
    );
  await page.getByRole('button', { name: 'Save response', exact: true }).click();
  await page.getByRole('button', { name: 'Finish early & get feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Areas to improve' })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText('Demo feedback is rule-based, not an AI assessment.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Document library', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/acceptance/desktop-journey.png', fullPage: true });
});
test('mobile workspace stays usable without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo workspace' }).click();
  await expect(page.getByRole('heading', { name: 'A clearer path forward.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'output/acceptance/mobile-workspace.png', fullPage: true });
});
