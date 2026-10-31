import { test, expect } from '@playwright/test';

test('profile workbench approves and reloads a real saved profile without model calls', async ({
  page,
}) => {
  let modelCalls = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/profile-threads\/[^/]+\/(messages|organise)$/.test(request.url())
    )
      modelCalls++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Workbench QA');
  await page.getByLabel('Email address').fill(`workbench-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Workbench-disposable-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByLabel('Profile document', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/agent-native/build-empty.png' });
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example', exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start career mission', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close mission form', exact: true }).click();
  await page.getByRole('button', { name: 'Build profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/workspace')).json();
  expect(saved.profile.version).toBe(1);
  await page.screenshot({ path: 'output/profile-workbench/real-saved-profile.png' });
  await page.reload();
  await page.getByRole('button', { name: 'Build profile', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Name block', exact: true })).toContainText(
    'Alex Morgan',
  );
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-just-approved')).toHaveCount(0);
  expect(modelCalls).toBe(0);
});

test('profile polish uses the configured provider and keeps suggestions separate from approval', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Polish QA');
  await page.getByLabel('Email address').fill(`polish-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Polish-disposable-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example', exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start career mission', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close mission form', exact: true }).click();
  await page.getByRole('button', { name: 'Build profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    })
    .check();
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/polish') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Polish profile', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.messages.at(-1).text).toMatch(
    /Prepared wording changes|No supported wording changes/,
  );
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await expect(page.getByText('Approved v2', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'output/agent-native/live-polish.png' });
});
