import { fillProfileFixture } from './profile-fixture.js';
import { test, expect } from '@playwright/test';
import { go, step } from './nav.js';

test('five-step journey automatically hands off and preserves decisions across reloads', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Journey Candidate');
  await page.getByLabel('Email address').fill(`guided-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Disposable-Journey-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await fillProfileFixture(page);
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start career mission', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Start career mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 45000,
  });
  await expect(page).toHaveURL(/step=2/);
  const missionId = new URL(page.url()).searchParams.get('mission');
  await step(page, 1);
  await expect(page.getByRole('region', { name: 'Journey profile snapshot' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('mission')).toBe(missionId);
  await expect(page.getByLabel('Your next profile message')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue this journey', exact: true }).click();
  await expect(page).toHaveURL(/step=2/);
  await page.goBack();
  await expect(page).toHaveURL(/step=0/);
  await expect(page.getByRole('region', { name: 'Journey profile snapshot' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/step=2/);

  // Steps the quest has not reached cannot be opened.
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByRole('button', { name: 'Approve this draft', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(page).toHaveURL(/step=3/);
  await expect(
    page.getByRole('button', { name: 'Approve this draft', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Job requirements to review' })).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).searchParams.get('mission')).toBe(missionId);
  await page.getByLabel('I read this exact draft.').check();
  await page.getByRole('button', { name: 'Approve this draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your turn', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(page).toHaveURL(/step=4/);
  await page
    .getByLabel('Your answer', { exact: true })
    .fill(
      'I used SQL to check records and discussed unexpected results with my supervisor. I supported the analysis and did not manage the team.',
    );
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByRole('button', { name: 'Retreat · get feedback now', exact: true }).click();
  await expect(page.getByText('Strengths', { exact: true })).toBeVisible({ timeout: 45000 });
  await go(page, 'Quests');
  const finished = page.locator('li', { hasText: 'Quest complete.' });
  await expect(finished.getByRole('button', { name: 'Open results' })).toBeVisible();
  expect(errors).toEqual([]);
});
