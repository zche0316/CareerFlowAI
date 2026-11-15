import { test, expect, type Page } from '@playwright/test';
import { fillProfileFixture } from '../../tests/e2e/profile-fixture.js';
import { go } from '../../tests/e2e/nav.js';

// The landing-page walkthrough: one fictional candidate from sign-up to interview feedback.
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `site/assets/${name}.png`, fullPage: false });
const pause = (page: Page, ms = 1200) => page.waitForTimeout(ms);

test('record the CareerFlow walkthrough', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Sam Rivera');
  await page.getByLabel('Email address').fill(`walkthrough-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Walkthrough-disposable-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build your profile' })).toBeVisible();
  await pause(page);
  await shot(page, 'profile-builder');
  await fillProfileFixture(page);
  await pause(page);
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'What’s your next career goal?' })).toBeVisible();
  await pause(page);
  await page.getByLabel('Demo roles').check();
  await page.getByRole('button', { name: 'Send the party out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pick a role.', exact: true })).toBeVisible({ timeout: 60000 });
  await page.locator('button.qj-role').first().click();
  await pause(page, 1500);
  await shot(page, 'shortlist');
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();

  await expect(page.getByRole('heading', { name: 'Review your resume.', exact: true })).toBeVisible({ timeout: 60000 });
  await pause(page, 1500);
  await shot(page, 'resume-team');
  await page.getByLabel('I read this exact draft.').check();
  await page.getByRole('button', { name: 'Approve this draft', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Interview practice', exact: true })).toBeVisible({ timeout: 60000 });
  await pause(page, 1500);
  await shot(page, 'interview');
  await page.getByLabel('Your answer', { exact: true }).fill(
    'The weekly report was built by hand and took four hours. I wrote a SQL view and a pandas script, and it now takes fifteen minutes to check.',
  );
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByRole('button', { name: 'Retreat · get feedback now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Battle over', exact: true })).toBeVisible({ timeout: 60000 });
  await pause(page, 1500);
  await shot(page, 'feedback');

  await go(page, 'Character');
  await pause(page, 1500);
  await shot(page, 'character');
  await go(page, 'Scout');
  await pause(page, 1200);
  await shot(page, 'scout');
  await go(page, 'Home');
  await pause(page, 1500);
  await shot(page, 'home');
});
