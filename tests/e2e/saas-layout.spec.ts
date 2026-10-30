import { test, expect, type Page } from '@playwright/test';

async function expectCompactHeader(page: Page) {
  const box = await page.locator('header.sidebar').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBe(56);
  expect(box!.y).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('compact SaaS workspace preserves profile, selection, exact approval and exports at both widths', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await page.getByLabel('Email address').fill(`layout-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-layout-check-2026');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your career profile', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectCompactHeader(page);
  expect(await page.evaluate(() => document.fonts.check('12px "Inter Variable"'))).toBe(true);
  const chat = await page.locator('.profile-chat-main').boundingBox();
  const profile = await page.locator('.profile-draft-side').boundingBox();
  expect(profile!.x).toBeGreaterThan(chat!.x + chat!.width);
  await expect(
    page.getByRole('button', { name: 'Send profile message', exact: true }),
  ).toBeDisabled();
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example', exact: true }).click();
  await expect(page.locator('.skill-pill')).toHaveText(['Python', 'SQL', 'Git', 'Excel']);
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Approve & save profile', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+Home');
  await page.screenshot({ path: 'output/saas-review/profile-desktop.png' });
  await page.getByRole('button', { name: 'Career missions', exact: true }).click();
  await page.getByRole('button', { name: 'New career mission', exact: true }).click();
  await page.getByLabel('Job source', { exact: true }).selectOption('fixtures');
  await page.getByRole('button', { name: 'Start career mission', exact: true }).click();
  const choose = page.getByRole('button', { name: 'Select this opportunity', exact: true });
  await expect(choose.first()).toBeVisible({ timeout: 30000 });
  await expectCompactHeader(page);
  const jobs = await page.locator('.job-card').all();
  const firstRow = await Promise.all(jobs.slice(0, 3).map((job) => job.boundingBox()));
  expect(firstRow[0]!.y).toBeLessThan(450);
  expect(
    Math.max(...firstRow.map((b) => b!.height)) - Math.min(...firstRow.map((b) => b!.height)),
  ).toBeLessThan(2);
  await expect(page.locator('.score.fit-high').first()).toBeVisible();
  await page.screenshot({ path: 'output/saas-review/jobs-desktop.png' });
  await page.getByRole('button', { name: '02 · Career analysis', exact: true }).click();
  const citation = page.locator('details.citation').first();
  await citation.locator('summary').click();
  await expect(citation.locator('small')).toBeVisible();
  await citation.locator('summary').press('Enter');
  await expect(citation.locator('small')).not.toBeVisible();
  await page.screenshot({ path: 'output/saas-review/analysis-desktop.png' });
  await page.getByRole('button', { name: '03 · Job matching', exact: true }).click();
  await choose.first().click();
  await expect(
    page.getByRole('heading', { name: 'Your evidence-grounded resume', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const approve = page.getByRole('button', { name: 'Approve & save resume', exact: true });
  await expect(approve).toBeDisabled();
  const dock = await page.locator('.resume-action-bar').boundingBox();
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: 'output/saas-review/resume-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCompactHeader(page);
  await expect(
    page
      .getByRole('button', { name: '04 · Resume tailoring', exact: true })
      .locator('.phase-label'),
  ).toBeVisible();
  const mobileDock = await page.locator('.resume-action-bar').boundingBox();
  expect(mobileDock!.x).toBeGreaterThanOrEqual(0);
  expect(mobileDock!.x + mobileDock!.width).toBeLessThanOrEqual(390);
  expect(mobileDock!.y + mobileDock!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'output/saas-review/resume-mobile.png' });
  await page.getByText('Request a revision instead', { exact: true }).click();
  const revision = page.getByLabel('Emphasis or ordering feedback', { exact: true });
  await expect(revision).toBeVisible();
  const revisionBox = await revision.boundingBox();
  expect(revisionBox!.y).toBeGreaterThanOrEqual(56);
  expect(revisionBox!.x + revisionBox!.width).toBeLessThanOrEqual(390);
  await page.locator('.resume-action-bar details > summary').click();
  await page.getByLabel('I reviewed the selected claims').check();
  await approve.click();
  await expect(page.getByLabel('Your response', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Control+Home');
  await page.screenshot({ path: 'output/saas-review/interview-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '05 · Interview practice', exact: true }).click();
  await page.keyboard.press('Control+Home');
  await page.screenshot({ path: 'output/saas-review/interview-desktop.png' });
  await page.getByRole('button', { name: 'Document library', exact: true }).click();
  const resumeSelect = await page
    .getByLabel('Resume for wording review', { exact: true })
    .boundingBox();
  const sourceSelect = await page.getByLabel('Source claim', { exact: true }).boundingBox();
  expect(sourceSelect!.x).toBeGreaterThan(resumeSelect!.x + resumeSelect!.width);
  expect(sourceSelect!.y).toBe(resumeSelect!.y);
  await expect(page.getByRole('link', { name: 'Download TXT', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download DOCX', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/saas-review/library-desktop.png' });
  await page.getByRole('button', { name: 'Career missions', exact: true }).click();
  await page.screenshot({ path: 'output/saas-review/home-desktop.png' });
  await page.reload();
  await expect(page.getByText('Approved profile v', { exact: false })).toBeVisible();
});

test('login uses the locally bundled sans-serif typography', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.locator('.login-brand h1').evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Inter');
  await page.screenshot({ path: 'output/saas-review/login-desktop.png' });
});
