import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
async function signup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Memory QA');
  await page.getByLabel('Email address').fill(`memory-browser-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Memory-QA-disposable-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
}
test('saved profile conversation survives reload, retains manual form edits and manages confirmed memory', async ({
  page,
}) => {
  await signup(page);
  await page.getByText('Conversation history & recovery', { exact: true }).click();
  await page.getByRole('button', { name: 'Start profile conversation', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Saved profile messages' })).toContainText(
    'Which role',
  );
  await page
    .getByLabel('Your next profile message')
    .fill('Fictional QA: I used SQL in the Atlas student project.');
  await page
    .getByLabel(
      'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    )
    .check();
  await page.getByRole('button', { name: 'Send profile message', exact: true }).click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Manual edit stays');
  await expect(page.getByRole('log', { name: 'Saved profile messages' })).toContainText(
    'Your message is saved.',
  );
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Manual edit stays');
  await page.reload();
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Saved profile messages' })).toContainText(
    'Atlas student project',
  );
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
  await page.getByText('Keep this answer as a memory', { exact: true }).click();
  await page.getByRole('button', { name: 'Save message as draft memory', exact: true }).click();
  await expect(page.getByLabel('Memory text', { exact: true })).toHaveValue(
    'Fictional QA: I used SQL in the Atlas student project.',
  );
  await page.getByLabel('Memory title', { exact: true }).fill('Atlas SQL evidence');
  await page.getByRole('button', { name: 'Save draft memory', exact: true }).click();
  await expect(page.getByText('Draft memory saved.', { exact: false })).toBeVisible();
  await page.getByLabel('Evidence search', { exact: true }).fill('Atlas');
  await page.getByRole('button', { name: 'Search confirmed evidence', exact: true }).click();
  await expect(page.getByText('No keyword match.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm reviewed memory', exact: true }).click();
  await expect(page.getByText('CONFIRMED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search confirmed evidence', exact: true }).click();
  await expect(page.locator('code').filter({ hasText: 'memory:' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit / correct memory', exact: true }).click();
  await page.getByLabel('Memory title', { exact: true }).fill('Atlas Python evidence');
  await page
    .getByLabel('Memory text', { exact: true })
    .fill('Fictional QA: I used Python in the Atlas student project.');
  await page.getByRole('button', { name: 'Save draft memory', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reviewed memory', exact: true }).click();
  await expect(page.getByText('SUPERSEDED', { exact: true })).toBeVisible();
  await page.getByLabel('Evidence search', { exact: true }).fill('SQL');
  await page.getByRole('button', { name: 'Search confirmed evidence', exact: true }).click();
  await expect(page.getByText('No keyword match.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  ).toBe(true);
  await page.screenshot({
    path: 'output/conversational-profile-20261029/conversation-memory.png',
    fullPage: true,
  });
});

test('STAR drafts allow unknown outcomes and remain user-reviewed memories', async ({ page }) => {
  await signup(page);
  await page.getByText('Career memory & STAR library', { exact: true }).click();
  await page.getByLabel('Memory type', { exact: true }).selectOption('STAR');
  await page.getByLabel('Memory title', { exact: true }).fill('Fictional Atlas story');
  await page
    .getByLabel('STAR situation', { exact: true })
    .fill('A fictional student dataset had missing values.');
  await page
    .getByLabel('STAR task', { exact: true })
    .fill('My task was to document missing values.');
  await page.getByLabel('STAR action', { exact: true }).fill('I used SQL to count missing values.');
  await page.getByRole('button', { name: 'Save draft memory', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm reviewed memory', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm reviewed memory', exact: true }).click();
  await expect(page.getByText('CONFIRMED', { exact: true })).toBeVisible();
  await expect(page.getByText('Approved v1', { exact: true })).toHaveCount(0);
});

test('reviewed wording creates a downloadable edition and application answers stay separate', async ({
  page,
}) => {
  await signup(page);
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example', exact: true }).click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page
    .getByLabel('Experience and projects or “none yet”', { exact: true })
    .fill('I used SQL to clean 120 records.');
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Career missions', exact: true }).click();
  await page.getByRole('button', { name: 'New career mission', exact: true }).click();
  await page.getByLabel('Job source', { exact: true }).selectOption('manual');
  await page
    .getByLabel('Listing url', { exact: true })
    .fill('https://www.seek.com.au/job/12345678');
  await page.getByLabel('Listing title', { exact: true }).fill('Fictional Data Analyst');
  await page.getByLabel('Listing company', { exact: true }).fill('Fictional QA Company');
  await page.getByLabel('Listing location', { exact: true }).fill('Sydney');
  await page
    .getByLabel('Listing description', { exact: true })
    .fill('Fictional test listing. Required skills: SQL, Python, data analysis. Bachelor degree.');
  await page.getByRole('slider').fill('0');
  await page.getByRole('button', { name: 'Start career mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(page.getByLabel('I reviewed the selected claims')).toBeVisible({ timeout: 30000 });
  await page.getByLabel('I reviewed the selected claims').check();
  await page.getByRole('button', { name: 'Approve & save resume', exact: true }).click();
  await expect(page.getByLabel('Your response', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: 'Check application fields', exact: true }).click();
  await expect(page.getByText('Full application schema unknown', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Document library', exact: true }).click();
  await page.getByLabel('Source claim', { exact: true }).selectOption('experience-1');
  await page
    .getByLabel('I allow the configured model to process this selected approved claim.')
    .check();
  await page.getByRole('button', { name: 'Suggest source-grounded wording', exact: true }).click();
  await expect(page.getByLabel('Suggested expression', { exact: true })).toHaveValue(
    'used SQL to clean 120 records.',
  );
  await page.getByRole('button', { name: 'Accept reviewed wording', exact: true }).click();
  await page
    .getByLabel('I reviewed the accepted wording and want a separate approved resume edition.')
    .check();
  await page.getByRole('button', { name: 'Save reviewed wording edition', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Download reviewed PDF', exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get('/api/session')).json();
  await writeFile(
    'output/conversational-profile-20261029/browser-account.json',
    JSON.stringify({ email: session.user.email }),
  );
  await page.screenshot({
    path: 'output/conversational-profile-20261029/wording-edition.png',
    fullPage: true,
  });
});

