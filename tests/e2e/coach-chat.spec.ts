import { test, expect } from '@playwright/test';
import { sampleProfile } from '../../packages/contracts/src/index.js';
import { go } from './nav.js';

// Ask Coach on the Coach page (CFS-146), in fixture mode: no model calls.
test('Ask Coach answers with your evidence and sends profile news to the Profile Builder', async ({
  page,
}) => {
  const made = await page.request.post('/api/auth/register', {
    data: {
      email: `qa-coach-chat-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Coach Chat Tester',
    },
  });
  const { csrf } = await made.json();
  const api = async (path: string, method = 'GET', body?: unknown) =>
    (
      await page.request.fetch('/api' + path, {
        method,
        headers: { 'X-CSRF-Token': csrf },
        ...(body === undefined ? {} : { data: body }),
      })
    ).json();
  const draft = await api('/profiles/drafts', 'POST', sampleProfile);
  await api(`/profiles/drafts/${draft.id}/approve`, 'POST', { reviewed: true });

  await page.goto('/');
  await go(page, 'Coach');
  const chat = page.getByRole('region', { name: 'Ask Coach' });
  await expect(chat).toBeVisible();
  await chat.getByRole('button', { name: 'Which roles fit my profile best?' }).click();
  const log = chat.getByRole('list', { name: 'Ask Coach conversation' });
  await expect(log.locator('li.coach')).toHaveCount(1, { timeout: 20000 });
  await expect(log.locator('li.coach').first()).toContainText('Your evidence:');

  await chat.getByLabel('Your question').fill('I just finished a Python course.');
  await chat.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(log.locator('li.coach').last()).toContainText('Profile Builder');

  await chat.screenshot({ path: 'output/acceptance/ask-coach.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  ).toBe(true);
  await chat.getByRole('button', { name: 'Clear' }).click();
  await expect(log.locator('li')).toHaveCount(0);
});

// Before the first approval the Coach has nothing to read; it says so instead of loading forever.
test('the Coach page explains what it needs before the first profile approval', async ({
  page,
}) => {
  await page.request.post('/api/auth/register', {
    data: {
      email: `qa-coach-empty-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Coach Empty Tester',
    },
  });
  await page.goto('/');
  await go(page, 'Coach');
  await expect(
    page.getByRole('heading', { name: 'Your Coach needs a profile first' }),
  ).toBeVisible();
  await expect(page.getByText('Loading your Coach…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Build my profile', exact: true }).click();
  await expect(page.getByLabel('Your next profile message')).toBeVisible();
});
