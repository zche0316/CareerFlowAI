import { test, expect } from '@playwright/test';
test('structured records and locally imported text remain separate from approval and survive reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Import QA');
  await page.getByLabel('Email address').fill(`import-qa-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-import-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Build profile', exact: true }).click();
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example', exact: true }).click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Work experience', exact: true }).click();
  await page
    .getByLabel('Work experience 1 title', { exact: true })
    .fill('Fictional Software Engineer');
  await page.getByLabel('Work experience 1 organisation', { exact: true }).fill('Example Pty Ltd');
  await page.getByLabel('Work experience 1 start month', { exact: true }).fill('2024-01');
  await page.getByLabel('Work experience 1 end month', { exact: true }).fill('2025-02');
  await page.getByLabel('Work experience 1 details', { exact: true }).fill('Built SQL reports.\n');
  await page
    .getByLabel('Work experience 1 technologies', { exact: true })
    .pressSequentially('Python, SQL');
  await page.getByRole('button', { name: 'Add Work experience', exact: true }).click();
  await page.getByLabel('Work experience 2 title', { exact: true }).fill('Fictional Analyst');
  await page
    .getByRole('group', { name: 'Work experience 2', exact: true })
    .getByRole('button', { name: 'Move up', exact: true })
    .click();
  await expect(page.getByLabel('Work experience 1 title', { exact: true })).toHaveValue(
    'Fictional Analyst',
  );
  await page
    .getByRole('group', { name: 'Work experience 1', exact: true })
    .getByRole('button', { name: 'Move down', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add Work experience', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Work experience 3', exact: true }).click();
  await page.getByRole('button', { name: 'Add Projects', exact: true }).click();
  await page.getByLabel('Projects 1 title', { exact: true }).fill('Fictional Dashboard Project');
  await page
    .getByText('Already have career material? Optional resume import', { exact: true })
    .click();
  await page.getByLabel('Resume file', { exact: true }).setInputFiles({
    name: 'fictional-import.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional Resume\nExample role\nJan 2024 - Feb 2025\nBuilt SQL reports.'),
  });
  await expect(page.getByText('Fictional Resume', { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Organize extracted text into records' }),
  ).toBeDisabled();
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Build profile', exact: true }).click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await expect(page.getByLabel('Work experience 1 title', { exact: true })).toHaveValue(
    'Fictional Software Engineer',
  );
  await expect(page.getByLabel('Projects 1 title', { exact: true })).toHaveValue(
    'Fictional Dashboard Project',
  );
  await expect(page.getByLabel('Work experience 1 technologies', { exact: true })).toHaveValue(
    'Python, SQL',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  ).toBe(true);
  await page
    .getByText('Already have career material? Optional resume import', { exact: true })
    .click();
  await expect(page.getByLabel('Saved imports')).toBeVisible();
  await page.screenshot({
    path: 'output/profile-workflow-20261029/structured-profile.png',
    fullPage: true,
  });
});
