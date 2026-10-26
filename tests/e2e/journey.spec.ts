import { test, expect, type Page } from '@playwright/test';

async function createAccount(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Browser QA');
  await page.getByLabel('Email address').fill(`browser-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clearer path forward.' })).toBeVisible();
}

async function openRankedJobs(page: Page) {
  await createAccount(page);
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile' }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Career missions', exact: true }).click();
  await page.getByRole('button', { name: 'New career mission' }).click();
  await page.getByLabel('Job source', { exact: true }).selectOption('fixtures');
  await page.getByRole('button', { name: 'Start career mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
}

async function openInterview(page: Page) {
  await openRankedJobs(page);
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your evidence-grounded resume' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Approve & save resume' })).toBeDisabled();
  await page.getByLabel('I reviewed the selected claims').check();
  await page.getByRole('button', { name: 'Approve & save resume' }).click();
  await expect(page.getByLabel('Your response', { exact: true })).toBeVisible({ timeout: 30000 });
}

test('a user must explicitly review a profile before v1 is persisted', async ({ page }) => {
  await createAccount(page);
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  const approve = page.getByRole('button', { name: 'Approve & save profile' });
  await expect(approve).toBeDisabled();
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'output/acceptance/cfs-13-profile-review.png', fullPage: true });
  await page.getByLabel('I reviewed this exact draft').check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/acceptance/cfs-13-approved-v1.png', fullPage: true });
});

test('a user compares ranked jobs and selects one for downstream context', async ({ page }) => {
  await openRankedJobs(page);
  const jobCards = page.locator('article.job-card');
  const jobCount = await jobCards.count();
  expect(jobCount).toBeGreaterThan(1);
  const scoreTexts = await jobCards.locator('.score').allTextContents();
  const scores = scoreTexts.map((text) => Number(text.match(/\d+/)?.[0]));
  expect(scores).toEqual([...scores].sort((left, right) => right - left));
  await expect(page.getByText('Evidence, gaps & source', { exact: true })).toHaveCount(jobCount);
  await expect(jobCards.locator('details')).toHaveCount(jobCount);
  await page.screenshot({ path: 'output/acceptance/cfs-21-ranked-jobs.png', fullPage: true });

  const selectedTitle = await jobCards.locator('h3').first().innerText();
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your evidence-grounded resume' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Your selected opportunity' })).toBeVisible();
  await expect(page.locator('article.job-card')).toHaveCount(1);
  await expect(
    page.getByText(`Selected ${selectedTitle} for resume and interview preparation.`),
  ).toBeVisible();
  await page.screenshot({
    path: 'output/acceptance/cfs-21-selected-job-handoff.png',
    fullPage: true,
  });
});

test('resume revisions require fresh approval and stop at the two-revision limit', async ({
  page,
}) => {
  await openRankedJobs(page);
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your evidence-grounded resume' })).toBeVisible({
    timeout: 30000,
  });
  const confirm = page.getByLabel('I reviewed the selected claims');
  const approve = page.getByRole('button', { name: 'Approve & save resume' });
  await confirm.check();
  await expect(approve).toBeEnabled();
  await page.getByText('Request a revision instead', { exact: true }).click();
  await page
    .getByLabel('Emphasis or ordering feedback')
    .fill('Emphasise my approved SQL evidence.');
  await page.getByRole('button', { name: 'Request revision · 0/2 used', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Request revision · 1/2 used',
      exact: true,
      includeHidden: true,
    }),
  ).toBeAttached({ timeout: 30000 });
  await expect(confirm).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await confirm.check();
  await page.getByText('Request a revision instead', { exact: true }).click();
  await page.getByRole('button', { name: 'Request revision · 1/2 used', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Request revision · 2/2 used',
      exact: true,
      includeHidden: true,
    }),
  ).toBeAttached({ timeout: 30000 });
  await page.getByText('Request a revision instead', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Request revision · 2/2 used', exact: true }),
  ).toBeDisabled();
  await expect(confirm).not.toBeChecked();
  await expect(page.getByText('Both revisions have been used.', { exact: false })).toBeVisible();
  await page.screenshot({
    path: 'output/acceptance/cfs-26-resume-revision-limit.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Back to resume', exact: true }).click();
  await confirm.check();
  await approve.click();
  await expect(page.getByLabel('Your response', { exact: true })).toBeVisible({ timeout: 30000 });
});

test('a cancelled resume draft stays out of the approved document library after reload', async ({
  page,
}) => {
  await openRankedJobs(page);
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your evidence-grounded resume' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Cancel further work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & save resume' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Download approved resume', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Document library', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A home for your approved documents.' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'output/acceptance/cfs-27-cancelled-resume-library.png',
    fullPage: true,
  });
});

test('UC4 shows a grouped resume and approval while evidence stays collapsed', async ({ page }) => {
  await openRankedJobs(page);
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await page.getByRole('button', { name: '04 · Resume tailoring', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toBeVisible({
    timeout: 30000,
  });
  const details = page.locator('.resume-details');
  await expect(details).not.toHaveAttribute('open');
  const preview = page.getByRole('article', { name: 'Resume preview' });
  await expect(preview.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible();
  await expect(preview.locator('.resume-skill-list li')).toHaveCount(4);
  await expect(
    preview.getByRole('heading', { name: 'Experience & projects', exact: true }),
  ).toBeVisible();
  const approve = page.getByRole('button', { name: 'Approve & save resume', exact: true });
  await expect(approve).toBeVisible();
  await expect(approve).toBeDisabled();
  await page.getByText('Job & tailoring details', { exact: true }).click();
  await expect(details).toHaveAttribute('open', '');
  await expect(
    details.getByRole('heading', { name: 'Approved context', exact: true }),
  ).toBeVisible();
  await expect(details.locator('.resume-evidence-list li')).toHaveCount(6);
  await page.getByText('Job & tailoring details', { exact: true }).click();
  await page.getByLabel('I reviewed the selected claims').check();
  await expect(approve).toBeEnabled();
  await page.screenshot({ path: 'output/acceptance/uc4-redesign-desktop.png', fullPage: true });
  await approve.click();
  await expect(
    page.getByRole('heading', { name: 'Your resume is saved.', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('link', { name: 'Download approved resume', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.resume-state')).toHaveText('Approved & saved');
  const downloadLink = await page
    .getByRole('link', { name: 'Download approved resume', exact: true })
    .getAttribute('href');
  const download = await page.request.get(downloadLink!);
  expect(download.status()).toBe(200);
  const text = await download.text();
  expect(text).toContain('SKILLS\n');
  expect(text.indexOf('SKILLS')).toBeLessThan(text.indexOf('EXPERIENCE & PROJECTS'));
  expect(text.indexOf('EXPERIENCE & PROJECTS')).toBeLessThan(text.indexOf('EDUCATION'));
  expect(text).toContain(
    'Built a student project that cleaned a sample dataset and produced SQL reports.',
  );
});

test('UC4 mobile dock stays reachable and revision dialog preserves explicit approval', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRankedJobs(page);
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await page.getByRole('button', { name: '04 · Resume tailoring', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toBeVisible({
    timeout: 30000,
  });
  const approve = page.getByRole('button', { name: 'Approve & save resume', exact: true });
  const dock = page.locator('.resume-decision-docked .resume-action-dock');
  const dockBox = await dock.boundingBox();
  expect(dockBox).toBeTruthy();
  expect(dockBox!.y).toBeGreaterThanOrEqual(0);
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(845);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(approve).toBeDisabled();
  await page.screenshot({ path: 'output/acceptance/uc4-redesign-mobile.png', fullPage: true });
  const revise = page.getByRole('button', { name: 'Request a revision instead', exact: true });
  await revise.click();
  const dialog = page.getByRole('dialog', { name: 'Request a revision', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Emphasis or ordering feedback')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(revise).toBeFocused();
  await revise.click();
  await page
    .getByLabel('Emphasis or ordering feedback')
    .fill('Prioritise my approved SQL project experience.');
  await page.getByRole('button', { name: 'Request revision · 0/2 used', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Request revision · 1/2 used',
      exact: true,
      includeHidden: true,
    }),
  ).toBeAttached({ timeout: 30000 });
  await expect(page.getByLabel('I reviewed the selected claims')).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const footerBox = await page.locator('.resume-paper-footer').boundingBox();
      const finalDock = await dock.boundingBox();
      return footerBox!.y + footerBox!.height - finalDock!.y;
    })
    .toBeLessThanOrEqual(0);
});

test('a user finishes early and receives feedback from the saved response', async ({ page }) => {
  await openInterview(page);
  const questionCount = await page.getByRole('button', { name: /^Question \d+$/ }).count();
  expect(questionCount).toBeGreaterThan(1);
  await page
    .getByLabel('Your response', { exact: true })
    .fill(
      'I used SQL in my student project to check a sample dataset and prepare a report. My task was to review missing values and document the queries.',
    );
  await page.getByRole('button', { name: 'Save response', exact: true }).click();
  await expect(page.getByText(`1 of ${questionCount} responses saved`)).toBeVisible();
  await page.getByRole('button', { name: 'Finish early & get feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Areas to improve' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('1 response retained.', { exact: false })).toBeVisible();
  await expect(
    page.getByText('You finished early; feedback reflects the available answers.', {
      exact: false,
    }),
  ).toBeVisible();
  if (process.env.PROVIDER_MODE !== 'openai') {
    await expect(
      page.getByText('Demo feedback is rule-based, not an AI assessment.', { exact: false }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: `output/acceptance/interview-early-exit-${process.env.PROVIDER_MODE === 'openai' ? 'live' : 'fixture'}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Document library', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/acceptance/desktop-journey.png', fullPage: true });
});

test('a user answers every interview question and receives complete feedback', async ({ page }) => {
  await openInterview(page);
  const questionTabs = page.getByRole('button', { name: /^Question \d+$/ });
  const questionCount = await questionTabs.count();
  expect(questionCount).toBeGreaterThan(0);
  expect(questionCount).toBeLessThanOrEqual(3);

  for (let index = 0; index < questionCount; index += 1) {
    await questionTabs.nth(index).click();
    await page
      .getByLabel('Your response', { exact: true })
      .fill(
        `In example ${index + 1}, I identified the situation, completed the relevant action myself and reviewed the result before reporting it.`,
      );
    await page.getByRole('button', { name: 'Save response', exact: true }).click();
    await expect(page.getByText(`${index + 1} of ${questionCount} responses saved`)).toBeVisible();
  }

  await expect(
    page.getByRole('button', { name: 'Complete interview & get feedback' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Complete interview & get feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Strengths', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Areas to improve', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next practice', exact: true })).toBeVisible();
  await expect(
    page.getByText(`${questionCount} responses retained.`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('You finished early; feedback reflects the available answers.'),
  ).toHaveCount(0);
  await page.screenshot({
    path: `output/acceptance/interview-complete-${process.env.PROVIDER_MODE === 'openai' ? 'live' : 'fixture'}.png`,
    fullPage: true,
  });

  await page.getByLabel('Practice offer salary').fill('65000');
  await page.getByLabel('Your target salary').fill('72000');
  await page.getByLabel('Currency').fill('AUD');
  await page
    .getByLabel('Your negotiation response')
    .fill(
      'I am interested in the role and would like to discuss the salary range based on the scope and my confirmed reporting experience.',
    );
  await page.getByRole('button', { name: 'Practice salary negotiation' }).click();
  await expect(page.getByRole('heading', { name: 'Simulated recruiter reply' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Negotiation strengths' })).toBeVisible();
  await page.getByRole('button', { name: 'Record my choice: accept' }).click();
  await expect(
    page.getByText('Practice decision recorded: accept.', { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `output/acceptance/cfs-33-salary-negotiation-${process.env.PROVIDER_MODE === 'openai' ? 'live' : 'fixture'}.png`,
    fullPage: true,
  });
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
