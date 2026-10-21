import { test, expect, type Page } from '@playwright/test';

async function openRankedJobs(page: Page) {
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
