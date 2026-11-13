import { fillProfileFixture } from './profile-fixture.js';
import { test, expect, type Page } from '@playwright/test';
import { go, openProfile, step } from './nav.js';

async function createAccount(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Browser QA');
  await page.getByLabel('Email address').fill(`browser-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build your profile' })).toBeVisible();
}

async function openRankedJobs(page: Page) {
  await createAccount(page);
  await openProfile(page);
  await fillProfileFixture(page);
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile' }).click();
  await expect(page.getByRole('button', { name: 'Send the party out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Find roles form', exact: true }).click();
  await openProfile(page);
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await go(page, 'Quests');
  await page.getByRole('button', { name: 'Find roles' }).click();
  await page.getByLabel('Demo roles').check();
  await page.getByRole('button', { name: 'Send the party out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
}

async function openInterview(page: Page) {
  await openRankedJobs(page);
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  // Choosing a role opens the draft review once the resume team has finished.
  // The resume team (selector, rewriter, critic rounds) runs in the worker after the stage
  // opens; on a slow CI runner the draft can take well over the default 5 s to appear.
  const approve = page.getByRole('button', { name: 'Approve this draft', exact: true });
  await expect(approve).toBeVisible({ timeout: 45000 });
  await expect(approve).toBeDisabled();
  await page.getByLabel('I read this exact draft.').check();
  await approve.click();
  await expect(page.getByRole('heading', { name: 'Face the interview panel.' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Your turn', exact: true })).toBeVisible();
}

async function answer(page: Page, text: string) {
  await page.getByLabel('Your answer', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  // Each answer may get one follow-up; skipping it moves to the next question.
  const skip = page.getByRole('button', { name: 'Skip follow-up', exact: true });
  await expect(skip.or(page.getByRole('heading', { name: 'Battle over' }))).toBeVisible({
    timeout: 20000,
  });
}

test('a user must explicitly review a profile before v1 is persisted', async ({ page }) => {
  await createAccount(page);
  await openProfile(page);
  await fillProfileFixture(page);
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  const approve = page.getByRole('button', { name: 'Approve & save profile' });
  await expect(approve).toBeDisabled();
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'output/acceptance/cfs-13-profile-review.png', fullPage: true });
  await page.getByLabel('I reviewed this exact draft').check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('button', { name: 'Send the party out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Find roles form', exact: true }).click();
  await openProfile(page);
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.reload();
  await openProfile(page);
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/acceptance/cfs-13-approved-v1.png', fullPage: true });
});

test('a user compares ranked jobs and selects one for downstream context', async ({ page }) => {
  await openRankedJobs(page);
  const rows = page.locator('table.qj-table tbody tr');
  const roles = page.locator('button.qj-role');
  const jobCount = await roles.count();
  expect(jobCount).toBeGreaterThan(1);
  const scores = (await rows.locator('.qj-score b').allTextContents()).map(Number);
  expect(scores).toEqual([...scores].sort((left, right) => right - left));
  await roles.nth(1).click();
  await expect(roles.nth(1)).toHaveAttribute('aria-pressed', 'true');
  const detail = page.locator('article.job-card').first();
  await expect(detail.locator('h3')).toHaveText(await roles.nth(1).locator('strong').innerText());
  await roles.first().click();
  await detail.getByText('Evidence, gaps & source', { exact: true }).click();
  await expect(detail).toContainText('Preferred skills (optional)');
  await expect(detail).toContainText('40% required skills');
  await expect(detail.getByRole('list', { name: 'Suitability score components' })).toContainText(
    'preferred: 5% weight',
  );
  await detail.getByText('Skill extraction evidence', { exact: true }).click();
  await expect(detail).toContainText('Required skills:');
  await page.screenshot({ path: 'output/acceptance/cfs-21-ranked-jobs.png', fullPage: true });

  const selectedTitle = await detail.locator('h3').innerText();
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.qm-crumb')).toContainText(selectedTitle);
  // The chosen role stays on the Shortlist step.
  await step(page, 'Shortlist');
  await expect(page.getByRole('heading', { name: 'Target locked in.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your selected opportunity' })).toBeVisible();
  await expect(page.locator('article.job-card')).toHaveCount(1);
  await expect(page.locator('article.job-card h3')).toHaveText(selectedTitle);
  // Verify persisted context rather than a transient selection notice.
  await page.reload();
  await step(page, 'Review');
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.qm-crumb')).toContainText(selectedTitle);
  await page.screenshot({
    path: 'output/acceptance/cfs-21-selected-job-handoff.png',
    fullPage: true,
  });
});

test('a user finishes early and receives feedback from the saved response', async ({ page }) => {
  await openInterview(page);
  const questionCount = await page
    .getByRole('group', { name: 'Questions' })
    .getByRole('button')
    .count();
  expect(questionCount).toBeGreaterThan(1);
  await answer(
    page,
    'I used SQL in my student project to check a sample dataset and prepare a report. My task was to review missing values and document the queries.',
  );
  await page.getByRole('button', { name: 'Retreat · get feedback now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Battle over', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText('You retreated early; feedback covers the answers you gave.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Areas to improve' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('1 response retained.', { exact: false })).toBeVisible();
  if (process.env.PROVIDER_MODE !== 'openai') {
    await expect(
      page.getByText('Demo feedback is rule-based, not an AI assessment.', { exact: false }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: `output/acceptance/interview-early-exit-${process.env.PROVIDER_MODE === 'openai' ? 'live' : 'fixture'}.png`,
    fullPage: true,
  });
  await go(page, 'My documents');
  await page.locator('.download-formats summary').click();
  await expect(page.getByRole('link', { name: 'Download TXT', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download DOCX', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/acceptance/desktop-journey.png', fullPage: true });
});

test('a user answers every interview question and receives complete feedback', async ({ page }) => {
  await openInterview(page);
  const questionTabs = page.getByRole('group', { name: 'Questions' }).getByRole('button');
  const questionCount = await questionTabs.count();
  expect(questionCount).toBeGreaterThan(0);
  expect(questionCount).toBeLessThanOrEqual(3);

  for (let index = 0; index < questionCount; index += 1) {
    await questionTabs.nth(index).click();
    await answer(
      page,
      `In example ${index + 1}, I identified the situation, completed the relevant action myself and reviewed the result before reporting it.`,
    );
  }

  const finish = page.getByRole('button', { name: 'Finish battle · get feedback', exact: true });
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect(page.getByRole('heading', { name: 'Strengths', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Areas to improve', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next practice', exact: true })).toBeVisible();
  await expect(
    page.getByText(`${questionCount} responses retained.`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('You retreated early')).toHaveCount(0);
  await page.screenshot({
    path: `output/acceptance/interview-complete-${process.env.PROVIDER_MODE === 'openai' ? 'live' : 'fixture'}.png`,
    fullPage: true,
  });

  const completedId = new URL(page.url()).searchParams.get('mission');
  await page.getByRole('button', { name: 'Back to journey results', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Completed journey results' })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your journey results', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'output/acceptance/completed-journey-results.png',
    fullPage: true,
  });
  for (const label of ['Shortlist', 'Review', 'Practice'] as const) {
    await step(page, label);
    await expect(
      page.getByText('Saved journey · Read-only history', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run revised analysis' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select this opportunity' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve & save resume' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refine wording' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Answer', exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('region', { name: 'Saved interview answers' })).toContainText(
    'In example 1',
  );
  await page.getByRole('button', { name: 'Back to results', exact: true }).click();
  await go(page, 'My profile');
  await go(page, 'Jobs');
  await page.getByRole('button', { name: 'Send the party out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
  expect(new URL(page.url()).searchParams.get('mission')).not.toBe(completedId);
  const previous = await (await page.request.get(`/api/missions/${completedId}`)).json();
  expect(previous.status).toBe('COMPLETE');
  expect(previous.data.answers).toHaveLength(questionCount);
  expect(previous.data.approvedResumeId).toBeTruthy();
});

test('mobile workspace stays usable without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await createAccount(page);
  await expect(page.getByRole('heading', { name: 'Build your profile' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'output/acceptance/mobile-workspace.png', fullPage: true });
});
