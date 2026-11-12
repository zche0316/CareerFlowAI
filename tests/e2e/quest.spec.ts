import { test, expect, type Page } from '@playwright/test';
import { sampleProfile } from '../../packages/contracts/src/index.js';

// These specs use the real fixture-mode server: no route mocks and no model calls.
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;

async function signUp(page: Page): Promise<Api> {
  const made = await page.request.post('/api/auth/register', {
    data: {
      email: `qa-quest-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Quest Tester',
    },
  });
  expect(made.status()).toBe(201);
  const { csrf } = await made.json();
  return async (path, method = 'GET', body) => {
    const r = await page.request.fetch('/api' + path, {
      method,
      headers: { 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { data: body }),
    });
    expect(r.status(), `${method} ${path}`).toBeLessThan(400);
    return r.json();
  };
}

async function approveProfile(api: Api) {
  const draft = await api('/profiles/drafts', 'POST', sampleProfile);
  await api(`/profiles/drafts/${draft.id}/approve`, 'POST', { reviewed: true });
}

async function waitFor(api: Api, id: string, status: string) {
  for (let i = 0; i < 300; i++) {
    const m = await api('/missions/' + id);
    if (m.status === status) return m;
    if (m.status === 'FAILED') throw Error(m.error);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Timed out waiting for ' + status);
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test('a quest runs from the log through review, a return to the Rewriter and the interview panel', async ({
  page,
}) => {
  const api = await signUp(page);
  await approveProfile(api);
  const { id } = await api('/missions', 'POST', { goal: 'Find a graduate data analyst role' });
  const shortlist = await waitFor(api, id, 'AWAITING_JOB');

  await page.goto('/?view=missions');
  await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quest log', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Runs waiting on you/ })).toBeVisible();

  await page.goto(`/?view=missions&mission=${id}&step=2`);
  await expect(
    page.getByRole('heading', { name: 'Pick the job your party should chase.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shortlist', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible();

  await api(`/missions/${id}/decisions`, 'POST', {
    kind: 'job',
    jobId: shortlist.data.matches[0].job.id,
  });
  await waitFor(api, id, 'AWAITING_APPROVAL');
  await page.goto(`/?view=missions&mission=${id}&step=3`);
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'How your party worked it out', exact: true }),
  ).toBeVisible();
  const approve = page.getByRole('button', { name: 'Approve this draft', exact: true });
  await expect(approve).toBeDisabled();

  // A return names one specialist; the draft comes back for a fresh review.
  await page.locator('label.quest-pick', { hasText: 'Rewriter' }).click();
  await expect(page.getByRole('radio', { name: /Rewriter/ })).toBeChecked();
  await page.getByLabel('What should change?').fill('Keep the wording closer to the facts.');
  await page.getByRole('button', { name: 'Send back · 2 left', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send back · 1 left', exact: true })).toBeVisible({
    timeout: 30000,
  });
  const returned = await waitFor(api, id, 'AWAITING_APPROVAL');
  expect(returned.data.resumeTeam.humanReturns).toBe(1);
  expect(returned.data.resumeTeam.handoffs.some((h: any) => h.to === 'rewriter')).toBe(true);

  await page.getByLabel('I read this exact draft.').check();
  await approve.click();
  await expect(page.getByRole('heading', { name: 'Face the interview panel.' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('heading', { name: 'Your turn', exact: true })).toBeVisible();

  const answer = page.locator('.boss-turn textarea, textarea').first();
  await answer.fill('We worked on a dashboard as a group.');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Answer the follow-up', exact: true })).toBeVisible(
    {
      timeout: 20000,
    },
  );
  await expect(page.getByRole('heading', { name: 'Last round', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retreat · get feedback now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Battle over', exact: true })).toBeVisible({
    timeout: 30000,
  });
  const done = await waitFor(api, id, 'COMPLETE');
  expect(done.data.rounds).toHaveLength(1);

  await page.getByRole('button', { name: /^Battle log · \d+ events$/ }).click();
  await expect(page).toHaveURL(/step=8/);
  await expect(page.getByRole('region', { name: 'Model calls' })).toBeVisible();
  await page
    .getByRole('group', { name: 'Filter the log' })
    .getByRole('button', { name: 'Your decisions' })
    .click();
  await expect(page.locator('.bl-row').first()).toBeVisible();

  await page.getByRole('button', { name: 'Back to the quest', exact: true }).click();
  await page.getByRole('button', { name: 'Save points', exact: true }).click();
  await expect(page).toHaveURL(/step=9/);
  await expect(page.getByRole('heading', { name: 'Your runs', exact: true })).toBeVisible();
  await expect(page.locator('.sp-slot').first()).toBeVisible();
  await expect(page.getByLabel('Can branch here').first()).toBeVisible();
});

test('quest pages render from real records at desktop and phone width', async ({ page }) => {
  const api = await signUp(page);
  await approveProfile(api);
  const { id } = await api('/missions', 'POST', { goal: 'Find a graduate data analyst role' });
  await waitFor(api, id, 'AWAITING_JOB');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const pages: [string, string | RegExp][] = [
    ['home', /./],
    ['missions', 'Quest log'],
    ['character', 'Alex Morgan'],
    ['party', 'Meet your party.'],
    ['world', 'Every country plays by different rules.'],
    ['season', 'Graduate Season'],
    ['scout', 'Scout finds the roles. You make the calls.'],
  ];
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const [view, heading] of pages) {
      await page.goto(`/?view=${view}`);
      await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible();
      expect(await noSidewaysScroll(page), `${view} at ${size.width}px`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('a Scout sweep fills the batch review and each package opens at its draft review', async ({
  page,
}) => {
  const api = await signUp(page);
  await approveProfile(api);
  // This spec covers the opt-in mode where each shortlisted role also gets a resume team.
  const setting = (await api('/scout')).setting;
  await api('/scout/settings', 'PUT', { ...setting, autoPackage: true });
  await page.goto('/?view=scout');
  await expect(
    page.getByRole('heading', { name: 'Scout finds the roles. You make the calls.' }),
  ).toBeVisible();
  await expect(page.getByText('No packages yet', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Send Scout out now', exact: true }).click();
  const ready = page.getByRole('button', { name: 'Review the draft' });
  await expect(ready).toHaveCount(3, { timeout: 45000 });
  await expect(page.getByText(/8 fetched · 8 new · 0 seen before/)).toBeVisible();
  await expect(page.getByText(/Job Matcher → Resume team/)).toBeVisible();
  await expect(page.getByRole('table')).toContainText('demo role');
  expect(await noSidewaysScroll(page)).toBe(true);

  // Discarding one package cancels only that quest.
  await page.getByRole('button', { name: 'Discard' }).first().click();
  await page.getByRole('button', { name: 'Yes, discard', exact: true }).click();
  await expect(ready).toHaveCount(2);

  await ready.first().click();
  await expect(page).toHaveURL(/step=3/);
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve this draft', exact: true }),
  ).toBeDisabled();

  const scout = await api('/scout');
  expect(scout.sweeps[0].packages.map((p: any) => p.status).sort()).toEqual([
    'AWAITING_APPROVAL',
    'AWAITING_APPROVAL',
    'CANCELLED',
  ]);
});
