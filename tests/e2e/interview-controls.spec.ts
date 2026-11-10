import { fillProfileFixture } from './profile-fixture.js';
import { test, expect } from './classic.js';
test('interview controls stop and skip without model calls, survive reload and lead to review without approval', async ({
  page,
}) => {
  let modelTurns = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/profile-threads\/[^/]+\/messages$/.test(r.url())) modelTurns++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Interview Controls');
  await page.getByLabel('Email address').fill(`controls-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Controls-QA-disposable-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await fillProfileFixture(page);
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Projects', exact: true }).click();
  await page.getByLabel('Projects 1 title', { exact: true }).fill('Alpha data project');
  await page
    .getByLabel('Projects 1 details', { exact: true })
    .fill('I used SQL. The outcome is unknown.');
  await page.getByText('Need an earlier conversation?', { exact: true }).click();
  await page.getByText('Recovery options', { exact: true }).click();
  await page.getByRole('button', { name: 'Start a separate conversation', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('When did Alpha data project start?');
  await expect(page.getByText('Switch experience', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Finish this experience', exact: true }),
  ).toHaveCount(0);
  for (let i = 0; i < 10; i++) {
    const skip = page.getByRole('button', { name: 'Skip this question', exact: true });
    if (!(await skip.count())) break;
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/controls') && r.request().method() === 'POST'),
      skip.click(),
    ]);
  }
  await page.getByRole('button', { name: 'Finish this experience', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'This experience is finished',
  );
  await expect(page.getByRole('log').locator('article').last()).not.toContainText('When did Alpha');
  await page.reload();
  await page
    .getByRole('button', { name: 'Build profile', exact: true })
    .or(page.getByRole('button', { name: 'My profile', exact: true }))
    .first()
    .click();
  await expect(page.getByText('Switch experience', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add another experience', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'different experience',
  );
  await page.getByRole('button', { name: 'End conversation & review', exact: true }).click();
  await expect(page.getByLabel('Your next profile message')).not.toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: 'Build profile', exact: true })
    .or(page.getByRole('button', { name: 'My profile', exact: true }))
    .first()
    .click();
  await expect(
    page.getByText('Interview finished — review your draft.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume interview', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).not.toContainText('When did Alpha');
  await page.getByRole('button', { name: 'End conversation & review', exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft now', exact: true }).click();
  await expect(page.getByLabel('I reviewed this exact draft')).not.toBeChecked();
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
  expect(modelTurns).toBe(0);
  await page.screenshot({ path: 'output/interview-controls-20261029/review.png', fullPage: true });
});

test('finishing a pending experience retains suggestions without a hidden model call', async ({
  page,
}) => {
  let requestBody: any;
  await page.route('**/api/profile-threads/*/organise', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'ORGANISATION_FAILED',
        error: 'Test organiser unavailable; original answers retained.',
      }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Pending Story QA');
  await page.getByLabel('Email address').fill(`pending-story-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Pending-story-disposable-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page
    .getByLabel('Your next profile message')
    .fill(
      'Title: Fictional Pending Story\nType: course project\nOrganisation: Example University\nDates: 2025-01 to 2025-02, completed.\nBackground: We checked synthetic data.\nPersonal actions: I wrote SQL checks.\nOutcomes: The result is unknown.\nTools: SQL\nReflection: I learned to test assumptions.',
    );
  await page
    .getByLabel(
      'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
      { exact: true },
    )
    .check();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/profile-threads/*/messages', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Send profile message', exact: true }).click();
  await expect(page.getByLabel('Your next profile message')).toHaveValue('');
  await expect(page.getByLabel('Submitted profile message')).toContainText(
    'Fictional Pending Story',
  );
  await expect(page.getByLabel('Submitted profile message')).toContainText('Sending');
  release();

  await expect(
    page.getByRole('button', { name: 'Use these details in my draft', exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 12; i++) {
    const skip = page.getByRole('button', { name: 'Skip this question', exact: true });
    if (!(await skip.count())) break;
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/controls') && r.request().method() === 'POST'),
      skip.click(),
    ]);
  }
  await page.getByRole('button', { name: 'Finish this experience', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'This experience is finished',
  );
  expect(requestBody).toBeUndefined();
  await expect(
    page.getByRole('button', { name: 'Use these details in my draft', exact: true }),
  ).toBeVisible();
});
