import { test, expect } from '@playwright/test';
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
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example', exact: true }).click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Projects', exact: true }).click();
  await page.getByLabel('Projects 1 title', { exact: true }).fill('Alpha data project');
  await page
    .getByLabel('Projects 1 details', { exact: true })
    .fill('I used SQL. The outcome is unknown.');
  await page.getByText('Conversation history & recovery', { exact: true }).click();
  await page.getByRole('button', { name: 'Start profile conversation', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('When did Alpha data project start?');
  await page.getByRole('button', { name: 'Skip this question', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'end, or is it ongoing',
  );
  await page.getByRole('button', { name: 'Finish this experience', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'This experience is finished',
  );
  await expect(page.getByRole('log').locator('article').last()).not.toContainText('When did Alpha');
  await page.reload();
  await page.getByRole('button', { name: 'Career chat', exact: true }).click();
  await expect(page.getByText('Finished experiences', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add another experience', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'different experience',
  );
  await page.getByRole('button', { name: 'Finish interview & review', exact: true }).click();
  await expect(page.getByLabel('Your next profile message')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Career chat', exact: true }).click();
  await expect(
    page.getByText('Interview finished — review your draft.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume interview', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).not.toContainText('When did Alpha');
  await page.getByText('Finished experiences', { exact: true }).click();
  await page.getByRole('button', { name: 'Reopen this experience', exact: true }).click();
  await expect(page.getByRole('log').locator('article').last()).toContainText(
    'end, or is it ongoing',
  );
  await page.getByRole('button', { name: 'Finish interview & review', exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft now', exact: true }).click();
  await expect(page.getByLabel('I reviewed this exact draft')).not.toBeChecked();
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
  expect(modelTurns).toBe(0);
  await page.screenshot({ path: 'output/interview-controls-20261029/review.png', fullPage: true });
});

test('finishing a pending new experience requests organisation before any draft adoption and surfaces failure', async ({
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
  await page.getByRole('button', { name: 'Send profile message', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use these details in my draft', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish this experience', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Test organiser unavailable');
  expect(requestBody.recordSection).toBe('projects');
  expect(requestBody.recordId).toBeTruthy();
  expect(requestBody.currentProfile.projects || []).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Use these details in my draft', exact: true }),
  ).toBeVisible();
});
