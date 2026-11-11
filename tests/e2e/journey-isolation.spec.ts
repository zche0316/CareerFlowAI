import { test, expect } from '@playwright/test';
import { step } from './nav.js';
import { sampleProfile } from '../../packages/contracts/src/index.js';

test('background completion preserves deliberate earlier-stage review and blocks future routes', async ({
  page,
}) => {
  const match = {
    score: 64,
    matches: ['SQL'],
    gaps: ['Workday'],
    explanation: 'SQL reporting is evidenced.',
    requirements: { required: ['SQL', 'Workday'], preferred: [] },
    job: {
      id: 'target',
      title: 'Reporting Analyst',
      company: 'Example',
      location: 'Sydney',
      employmentType: 'Full-time',
      description: 'SQL reporting and Workday.',
      source: { name: 'Example', version: '1', fictional: true },
    },
  };
  const mission: any = {
    id: 'isolation',
    goal: 'Find a reporting role',
    status: 'RUNNING',
    mode: 'fixture',
    createdAt: '2026-10-31T00:00:00Z',
    events: [],
    data: { selectedJob: match, matches: [match], apiCalls: 3 },
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/job-fit'))
      return route.fulfill({ json: { job: match.job, items: [], profileVersion: 1 } });
    if (path.endsWith('/cancel')) {
      mission.status = 'CANCELLED';
      return route.fulfill({ json: mission });
    }
    const body =
      path === '/api/session'
        ? { user: { id: 'isolation-user', name: 'Candidate' }, csrf: 'test' }
        : path === '/api/workspace'
          ? { profile: { version: 1, data: sampleProfile }, missions: [mission], resumes: [] }
          : [];
    return route.fulfill({ json: body });
  });
  await page.goto('/?view=missions&mission=isolation&step=3');
  await expect(page.getByRole('list', { name: 'Agent progress' })).toContainText(
    'Target job selected',
  );
  await step(page, 3);
  await expect(page).toHaveURL(/step=2/);
  mission.status = 'AWAITING_APPROVAL';
  mission.data.resumeDraft = {
    name: 'Candidate',
    jobTitle: 'Reporting Analyst',
    profileVersion: 1,
    hash: 'isolated-draft',
    claims: [],
    omittedFacts: [],
  };
  // The header chip follows the background change; the user stays on the step they opened.
  await expect(page.locator('.qm-chips')).toContainText('Your call', { timeout: 10000 });
  await expect(page).toHaveURL(/step=2/);
  await expect(page.getByRole('heading', { name: 'Target locked in.', exact: true })).toBeVisible();
  await page.goto('/?view=missions&mission=isolation&step=4');
  await expect(page).toHaveURL(/step=3/);
  await expect(
    page.getByRole('button', { name: 'Approve & save resume', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel further work', exact: true }).click();
  await expect(page.locator('.qm-chips')).toContainText('cancelled');
  await page.reload();
  await expect(page.locator('.qm-chips')).toContainText('cancelled');
});
