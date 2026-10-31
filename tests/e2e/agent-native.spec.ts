import { test, expect, type Page } from '@playwright/test';
import { sampleProfile } from '../../packages/contracts/src/index.js';

async function app(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const content = {
    name: 'Alex Morgan',
    jobTitle: 'Data Analyst',
    profileVersion: 1,
    hash: 'draft-qa',
    claims: [
      {
        factId: 'experience-1',
        kind: 'experience',
        text: 'Built SQL reports.',
        reason: 'Matches reporting requirements.',
      },
    ],
    omittedFacts: [],
  };
  const match = {
    score: 78,
    matches: ['SQL'],
    gaps: [],
    explanation: 'SQL evidence supports this role.',
    requirements: { required: ['SQL'], preferred: [] },
    job: {
      id: 'job-qa',
      title: 'Data Analyst',
      company: 'Example Company',
      location: 'Sydney',
      employmentType: 'Full-time',
      description: 'Use SQL for reporting.',
      source: { name: 'QA example', version: '1', fictional: true },
    },
  };
  const mission = {
    id: 'mission-qa',
    goal: 'Find a data role',
    status: 'AWAITING_JOB',
    createdAt: '2026-10-31T00:00:00Z',
    mode: 'fixture',
    events: [],
    data: {
      apiCalls: 2,
      analysis: {
        strengths: ['SQL reporting'],
        gaps: ['Explore visualisation'],
        directions: ['Data analysis'],
        actions: ['Choose a role'],
      },
      matches: [match],
      selectedJob: match,
      resumeDraft: content,
      questions: [{ id: 'q1', question: 'Tell me about your SQL project.', focus: 'Evidence' }],
    },
  };
  const resumes = [
    { id: 'r1', content, approvedAt: '2026-10-31T00:00:00Z' },
    {
      id: 'r2',
      content: { ...content, jobTitle: 'Reporting Analyst' },
      approvedAt: '2026-10-30T00:00:00Z',
    },
  ];
  const bodies: any[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/resume-agent/restore')) {
      bodies.push(route.request().postDataJSON());
      mission.data.resumeDraft = { ...content, hash: 'restored-draft' };
      (mission.data as any).resumeChanges = [];
      return route.fulfill({ json: { resumeDraft: mission.data.resumeDraft } });
    }
    if (path.endsWith('/resume-agent')) {
      bodies.push(route.request().postDataJSON());
      mission.data.resumeDraft = {
        ...content,
        hash: 'edited-draft',
        claims: [{ ...content.claims[0], text: 'Built SQL reports for the reporting team.' }],
      };
      (mission.data as any).resumeChat = [
        { role: 'user', text: route.request().postDataJSON().message },
        { role: 'assistant', text: 'Updated the draft. Review the preview before saving.' },
      ];
      (mission.data as any).resumeChanges = [
        {
          factId: content.claims[0].factId,
          before: content.claims[0].text,
          after: mission.data.resumeDraft.claims[0].text,
        },
      ];
      return route.fulfill({ json: { resumeDraft: mission.data.resumeDraft } });
    }
    if (path === '/api/session')
      return route.fulfill({
        json: { user: { id: 'qa', name: 'Alex Morgan' }, csrf: 'qa', mode: 'fixture' },
      });
    if (path === '/api/workspace')
      return route.fulfill({
        json: {
          profile: { id: 'p1', version: 1, data: sampleProfile },
          sampleProfile,
          missions: [mission],
          resumes,
        },
      });
    if (path === '/api/profile-threads' && route.request().method() === 'POST') {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          id: 't1',
          revision: 0,
          profileVersion: 1,
          workingForm: sampleProfile,
          proposals: [],
          messages: [],
          interview: { phase: 'interview' },
        },
      });
    }
    if (path.endsWith('/messages') || path.endsWith('/polish')) {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          id: 't1',
          revision: 1,
          profileVersion: 1,
          workingForm: sampleProfile,
          proposals: [],
          messages: [
            {
              id: 'reply',
              role: 'assistant',
              text: 'Your profile is already clear. Add a specific project outcome when you have evidence.',
            },
          ],
          interview: { phase: 'interview' },
        },
      });
    }
    if (path.endsWith('/job-fit'))
      return route.fulfill({ json: { job: match.job, items: [], profileVersion: 1 } });
    if (path === '/api/career-memories')
      return route.fulfill({
        json: {
          memories: [
            {
              id: 'memory-qa',
              title: 'SQL reporting story',
              text: 'I used SQL to prepare reports.',
              kind: 'NOTE',
              status: 'CONFIRMED',
              revision: 1,
              star: {},
              source: { kind: 'user', quote: 'I used SQL to prepare reports.' },
            },
          ],
          records: [],
          missions: [],
        },
      });
    if (path === '/api/tools/dashboard')
      return route.fulfill({
        json: {
          total: 0,
          interviewCount: 0,
          rejected: 0,
          interviewRate: null,
          rejectionRate: null,
          applications: [],
          recurringGaps: [],
          limitations: [],
          reminders: [],
        },
      });
    return route.fulfill({ json: [] });
  });
  return { errors, bodies, mission };
}

test('approved profile links route to editing and polish sends a real edit request', async ({
  page,
}) => {
  const { errors, bodies } = await app(page);
  await page.goto('/?view=profile');
  await expect(page).toHaveURL(/view=approved-profile/);
  await expect(page.getByRole('button', { name: 'Build profile', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  const doc = await page.getByLabel('Profile document', { exact: true }).boundingBox();
  const edit = await page
    .getByRole('complementary', { name: 'Profile conversation sidebar' })
    .boundingBox();
  expect(doc!.x).toBeLessThan(edit!.x);
  const polish = page.getByRole('button', { name: 'Polish profile', exact: true });
  await expect(polish).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    })
    .check();
  await polish.click();
  await expect(page.getByRole('log')).toContainText('already clear');
  expect(bodies[0].mode).toBe('edit');
  expect(bodies.at(-1).consent).toBe(true);
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/agent-native/edit-desktop.png' });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Manual edit preserved');
  await page.getByRole('button', { name: 'Stories & notes', exact: true }).click();
  await expect(page.getByLabel('Career memory and STAR library')).toBeVisible();
  await expect(polish).not.toBeVisible();
  await page.getByText('SQL reporting story', { exact: true }).click();
  await page.getByRole('button', { name: 'Discuss with my agent', exact: true }).click();
  await expect(page.getByLabel('Your next profile message')).toHaveValue(/SQL reporting story/);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Manual edit preserved');
  expect(errors).toEqual([]);
});

test('new missions automatically use profile search defaults and the full career team', async ({
  page,
}) => {
  await app(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New career mission', exact: true }).click();
  await expect(page.getByLabel('Career goal', { exact: true })).toHaveValue(sampleProfile.goals);
  await expect(page.getByLabel('Job keywords', { exact: true })).toHaveValue('data analyst');
  await expect(page.getByLabel('City / locality', { exact: true })).toHaveValue(
    sampleProfile.location,
  );
  await expect(page.getByLabel('Job source', { exact: true })).toHaveValue('auto');
  await expect(page.getByLabel('Job source', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(
    'All four specialists use this approved profile automatically.',
  );
});

test('resume editing uses suggestions and chat, refreshes the preview and requires fresh confirmation', async ({
  page,
}) => {
  const { mission, bodies, errors } = await app(page);
  mission.status = 'AWAITING_APPROVAL';
  await page.goto('/?view=missions&mission=mission-qa&step=3');
  await expect(page.getByRole('region', { name: 'Resume agent' })).toBeVisible();
  await expect(page.getByText('Choose and order source statements for this job')).toHaveCount(0);
  const confirmation = page.getByLabel('I reviewed this resume and am ready to save it.');
  await confirmation.check();
  await page.getByRole('button', { name: 'Refine wording', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText(
    'Built SQL reports for the reporting team.',
  );
  await expect(confirmation).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Approve & save resume' })).toBeDisabled();
  expect(bodies.at(-1).draftHash).toBe('draft-qa');
  const changed = page.getByRole('button', { name: /Changed.*Built SQL reports/ });
  await expect(changed).toBeVisible();
  await changed.click();
  await expect(page.getByRole('group', { name: 'Wording comparison' })).toContainText('Before');
  await expect(page.getByRole('group', { name: 'Wording comparison' })).toContainText('After');
  await page.screenshot({
    path: 'output/agent-native/resume-wording-comparison.png',
    fullPage: true,
  });
  await page.reload();
  await expect(changed).toBeVisible();
  await changed.click();
  await page.getByRole('button', { name: 'Keep original', exact: true }).click();
  await expect(page.locator('.resume-change-text')).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText(
    'Built SQL reports.',
  );
  await page
    .getByLabel('Ask for a change', { exact: true })
    .fill('Emphasise my reporting experience');
  await page.getByRole('button', { name: 'Send resume message' }).click();
  await expect(page.getByRole('log')).toContainText('Emphasise my reporting experience');
  await page.screenshot({ path: 'output/agent-native/resume-agent-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/agent-native/resume-agent-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('output workspaces stay compact and usable across stages and mobile', async ({ page }) => {
  const { errors } = await app(page);
  await page.goto('/');
  await page.screenshot({ path: 'output/agent-native/home-desktop.png' });
  await expect(
    page.getByRole('heading', { name: 'Application progress', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'My documents', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Reporting Analyst', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Reporting Analyst', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/agent-native/documents-desktop.png' });
  await page.goto('/?view=missions&mission=mission-qa&step=1');
  await expect(page.getByRole('heading', { name: 'Career Coach', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run revised analysis' })).toBeDisabled();
  await page.screenshot({ path: 'output/agent-native/analysis-desktop.png' });
  await page.getByRole('button', { name: '03 · Job matching', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'SQL evidence supports' })).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: '04 · Resume tailoring', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toHaveCount(1);
  await page.screenshot({ path: 'output/agent-native/resume-desktop.png' });
  await page.goto('/?view=tools');
  await expect(
    page.getByRole('heading', { name: 'Application progress', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cover letter', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Cover letter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cover letter', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Application progress', exact: true }),
  ).not.toBeVisible();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?view=profile');
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `output/agent-native/build-${width}.png`,
      fullPage: width === 390,
    });
  }
  expect(errors).toEqual([]);
});

test('global Find jobs starts fresh after the latest completed journey instead of reopening an older search', async ({
  page,
}) => {
  await app(page);
  const older = {
    id: 'older-search',
    status: 'AWAITING_JOB',
    mode: 'fixture',
    goal: 'Older search',
    createdAt: '2026-10-30T00:00:00Z',
    data: { matches: [] },
    events: [],
  };
  const latest = {
    ...older,
    id: 'latest-complete',
    status: 'COMPLETE',
    goal: 'Completed application',
    createdAt: '2026-10-31T00:00:00Z',
    data: {
      approvedResumeId: 'saved',
      feedback: { strengths: [], improvements: [], nextSteps: [] },
    },
  };
  await page.route('**/api/workspace', (route) =>
    route.fulfill({
      json: {
        profile: { id: 'p1', version: 1, data: sampleProfile },
        missions: [latest, older],
        resumes: [],
        drafts: [],
      },
    }),
  );
  await page.goto('/?view=approved-profile');
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build profile', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Find jobs', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Start career mission', exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/older-search/);
});

test('overview shows three concise recent journeys and keeps unsuccessful attempts in history', async ({
  page,
}) => {
  await app(page);
  const missions = Array.from({ length: 6 }, (_, i) => ({
    id: `recent-${i}`,
    status: i < 4 ? 'COMPLETE' : i === 4 ? 'FAILED' : 'NO_MATCHES',
    mode: 'openai',
    goal: 'A long repeated career goal that should not become every journey title',
    createdAt: '2026-11-01T00:00:00Z',
    data: {
      selectedJob: i < 4 ? { job: { title: `Analyst ${i}`, company: `Example ${i}` } } : undefined,
    },
    events: [],
  }));
  await page.route('**/api/workspace', (route) =>
    route.fulfill({
      json: {
        profile: { id: 'p1', version: 1, data: sampleProfile },
        missions,
        resumes: [],
        drafts: [],
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.search-row')).toHaveCount(3);
  await expect(page.locator('.search-row').first()).toContainText('Analyst 0 · Example 0');
  await expect(page.locator('.search-row').first()).toContainText('Completed');
  await expect(page.locator('.search-list')).not.toContainText('Failed');
  await page.getByRole('button', { name: 'View all journeys (6)', exact: true }).click();
  await expect(page.locator('.search-row')).toHaveCount(6);
  await expect(page.locator('.search-list')).toContainText('Failed');
  await expect(page.locator('.search-list')).toContainText('No matches');
  await page.getByRole('button', { name: 'Show recent journeys', exact: true }).click();
  await expect(page.locator('.search-row')).toHaveCount(3);
  await page
    .locator('section[aria-labelledby="recent-searches-title"]')
    .screenshot({ path: 'output/agent-native/recent-journeys.png' });
});
