import { test, expect, type Page } from '@playwright/test';
import { sampleProfile } from '../../packages/contracts/src/index.js';

async function workbench(
  page: Page,
  options: {
    rejectApproval?: boolean;
    delayDecision?: boolean;
    firstEducation?: boolean;
    withExperience?: boolean;
  } = {},
) {
  const initial = structuredClone(sampleProfile);
  if (options.withExperience)
    initial.workExperiences = [
      {
        id: 'intern-one',
        title: 'Business Analyst Intern',
        organisation: 'Northstar Logistics',
        location: 'Sydney',
        startMonth: '2025-11',
        endMonth: '2026-02',
        current: false,
        overview: 'I supported reporting using SQL and Excel; I did not manage the team.',
        details: [
          'I supported reporting using SQL and Excel; I did not manage the team.',
          'Warehouses used different labels.',
          'I was responsible for consistent categories.',
          'I compared labels with my supervisor.',
          'Reporting preparation took about one hour.',
        ],
        starStory: {
          situation: 'Warehouses used different labels.',
          task: 'I was responsible for consistent categories.',
          action: 'I compared labels with my supervisor.',
          result: 'Reporting preparation took about one hour.',
        },
        technologies: ['SQL', 'Excel'],
        url: '',
        evidence: [],
      },
    ];
  if (options.firstEducation) {
    delete initial.educations;
    initial.education = '';
  }
  const thread: any = {
    id: 'workbench-thread',
    revision: 1,
    profileVersion: 1,
    workingForm: initial,
    messages: [
      {
        id: 'answer',
        role: 'user',
        text: 'I also used Tableau to visualise our SQL reports. I want to work on public-interest data.',
      },
      {
        id: 'advice',
        role: 'assistant',
        text: 'I have suggested updates to your skills and career direction. Review each change in your profile.',
      },
    ],
    proposals: [
      {
        id: 'skills-change',
        field: 'skills',
        before: initial.skills,
        after: [...initial.skills, 'Tableau'],
        status: 'PENDING',
        evidence: [{ quote: 'I also used Tableau to visualise our SQL reports.' }],
      },
      {
        id: 'goal-change',
        field: 'goals',
        before: initial.goals,
        after: 'Find a data analyst role working on public-interest data.',
        status: 'PENDING',
        evidence: [{ quote: 'I want to work on public-interest data.' }],
      },
    ],
    interview: { phase: 'interview', closed: [] },
    interviewRecords: [],
  };
  const workspace: any = {
    profile: { id: 'profile-1', version: 1, data: initial },
    missions: [],
    resumes: [],
    sampleProfile,
  };
  if (options.firstEducation)
    thread.proposals.push({
      id: 'education-change',
      field: 'educations',
      before: [],
      after: [
        {
          id: 'degree-1',
          title: 'Bachelor of Commerce',
          major: 'Business Analytics',
          relevantCoursework: ['Database Systems', 'Business Statistics'],
          organisation: 'University of Sydney',
          startMonth: '2024-02',
          endMonth: null,
          expectedEndMonth: '2026-11',
          current: true,
          details: [],
          technologies: [],
          url: '',
          evidence: [],
        },
      ],
      status: 'PENDING',
      evidence: [{ quote: 'I study Bachelor of Commerce at the University of Sydney.' }],
    });
  let draft: any;
  const decisions: any[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session')
      return route.fulfill({
        json: { user: { id: 'qa', name: 'Alex Morgan' }, csrf: 'qa', mode: 'fixture' },
      });
    if (path === '/api/workspace') return route.fulfill({ json: workspace });
    if (path === '/api/profile-threads')
      return route.fulfill({
        json: [{ id: thread.id, title: 'Profile edits', updatedAt: '2026-10-31T00:00:00Z' }],
      });
    if (path === '/api/profile-threads/workbench-thread') return route.fulfill({ json: thread });
    if (path.includes('/proposals/')) {
      const body = route.request().postDataJSON();
      decisions.push(body);
      const p = thread.proposals.find((p: any) => path.endsWith(p.id));
      if (options.delayDecision) await new Promise((resolve) => setTimeout(resolve, 350));
      p.status = body.decision === 'apply' ? 'APPLIED_TO_FORM' : 'REJECTED';
      thread.revision++;
      thread.workingForm = {
        ...body.currentProfile,
        ...(body.decision === 'apply' ? { [p.field]: p.after } : {}),
      };
      return route.fulfill({
        json: { thread, field: p.field, value: p.after, applied: body.decision === 'apply' },
      });
    }
    if (path === '/api/profiles/drafts') {
      draft = { id: 'draft-qa', data: route.request().postDataJSON() };
      return route.fulfill({ json: draft });
    }
    if (path.endsWith('/approve')) {
      if (options.rejectApproval)
        return route.fulfill({ status: 409, json: { error: 'Profile changed. Review again.' } });
      workspace.profile = { id: 'profile-2', version: 2, data: draft.data };
      return route.fulfill({ json: workspace.profile });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Accept Skills change', exact: true }),
  ).toBeVisible();
  return { decisions };
}

test('shows one experience overview with an expandable personal STAR example and source notes', async ({
  page,
}) => {
  await workbench(page, { withExperience: true });
  const block = page.getByRole('region', { name: 'Work experience block', exact: true });
  await expect(block.locator('.profile-experience-overview')).toHaveText(
    'I supported reporting using SQL and Excel; I did not manage the team.',
  );
  await expect(block.locator('.profile-source-notes p')).not.toBeVisible();
  await expect(block.locator('.profile-star-story dd')).toHaveCount(4);
  await block.getByText('Personal STAR example', { exact: true }).click();
  await expect(block.locator('.profile-star-story')).toContainText(
    'I compared labels with my supervisor.',
  );
  await expect(block.locator('li')).toHaveCount(0);
  await page.screenshot({ path: 'output/agent-native/experience-star.png', fullPage: true });
  await block.getByText('Source notes', { exact: true }).click();
  await expect(block.locator('.profile-source-notes p')).toContainText(
    'I did not manage the team.',
  );
});

test('accepts the first education record when the new profile omitted the optional list', async ({
  page,
}) => {
  const { decisions } = await workbench(page, { firstEducation: true });
  const accept = page.getByRole('button', { name: 'Accept Education change', exact: true });
  await expect(accept).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Use these details in my draft', exact: true }),
  ).toBeEnabled();
  await accept.click();
  await expect(page.locator('#profile-change-educations')).toContainText('Bachelor of Commerce');
  await expect(page.locator('#profile-change-educations')).toContainText('Added to draft');
  await expect(page.locator('#profile-change-educations')).toContainText(
    'Major: Business Analytics',
  );
  await expect(page.locator('#profile-change-educations')).toContainText(
    'Relevant coursework: Database Systems, Business Statistics',
  );
  expect(decisions[0].decision).toBe('apply');
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await expect(page.getByLabel('Education records 1 major', { exact: true })).toHaveValue(
    'Business Analytics',
  );
  await expect(
    page.getByLabel('Education records 1 relevant coursework', { exact: true }),
  ).toHaveValue('Database Systems\nBusiness Statistics');
  const start = page.getByLabel('Education records 1 start month', { exact: true });
  await expect(start).toBeEnabled();
  await expect(start).toHaveValue('2024-02');
  await expect(
    page.getByLabel('Education records 1 expected completion month', { exact: true }),
  ).toHaveValue('2026-11');
  await expect(page.getByLabel('Education records 1 end month', { exact: true })).toBeDisabled();
  await start.fill('2024-03');
  await expect(start).toHaveValue('2024-03');
  await page.screenshot({
    path: 'output/profile-workbench/education-accepted.png',
    fullPage: true,
  });
});

test('profile leads conversation; block decisions preserve independent changes and approval confirms persistence', async ({
  page,
}) => {
  const { decisions } = await workbench(page);
  const document = page.getByLabel('Profile document', { exact: true });
  const sidebar = page.getByRole('complementary', { name: 'Profile conversation sidebar' });
  const docBox = await document.boundingBox(),
    chatBox = await sidebar.boundingBox();
  expect(docBox!.x).toBeLessThan(chatBox!.x);
  expect(docBox!.width).toBeGreaterThan(chatBox!.width);
  await page.screenshot({
    path: 'output/profile-workbench/suggestions-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Accept Skills change', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Skills block' })).toContainText('Added to draft');
  await expect(
    page.getByRole('button', { name: 'Accept Career direction change', exact: true }),
  ).toBeVisible();
  expect(decisions[0].decision).toBe('apply');
  expect(decisions[0].revision).toBe(1);
  await page.getByRole('button', { name: 'Keep current Career direction', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Career direction block' })).toContainText(
    sampleProfile.goals,
  );
  await expect(
    page.getByRole('button', { name: 'Review profile draft', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByText('Approved v2', { exact: true })).toBeVisible();
  await expect(page.getByText('Profile approved and saved', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-just-approved')).toHaveCount(1);
  await page.screenshot({ path: 'output/profile-workbench/approved-desktop.png', fullPage: true });
});

test('manual conflict keeps the edit and blocks stale apply; mobile and reduced motion remain legible', async ({
  page,
}) => {
  await workbench(page);
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByLabel('Skills · comma separated', { exact: true }).fill('SQL, R');
  await expect(
    page.getByRole('button', { name: 'Accept Skills change', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Skills block' })).toContainText(
    'Your current edit',
  );
  await page.getByRole('button', { name: 'Keep current Skills', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Skills block' })).toContainText('R');
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const change = page.locator('.profile-inline-change');
  expect(await change.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await expect(page.getByText('Suggested change', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'output/profile-workbench/suggestions-mobile.png',
    fullPage: true,
  });
});

test('approval failure leaves the draft reviewable and never plays success', async ({ page }) => {
  await workbench(page, { rejectApproval: true });
  await page.getByRole('button', { name: 'Keep current Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Keep current Career direction', exact: true }).click();
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Profile changed. Review again.');
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-just-approved')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Approve & save profile', exact: true }),
  ).toBeEnabled();
});

test('an edit made while a block is applying wins over the late response', async ({ page }) => {
  await workbench(page, { delayDecision: true });
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page.getByRole('button', { name: 'Accept Skills change', exact: true }).click();
  await page.getByLabel('Skills · comma separated', { exact: true }).fill('SQL, R');
  await expect(page.getByRole('region', { name: 'Skills block' })).toContainText('R');
  await expect(page.getByRole('region', { name: 'Skills block' })).not.toContainText('Tableau');
  await expect(page.locator('.profile-canvas').getByRole('alert')).toContainText(
    'Your edit was kept',
  );
});

test('intermediate screens keep the document and conversation usable', async ({ page }) => {
  await workbench(page);
  for (const width of [1024, 820, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(
      page.getByRole('button', { name: 'Accept Skills change', exact: true }),
    ).toBeVisible();
  }
});

test('record a short preview of suggestion, accept and approval motion', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: 'output/profile-workbench/motion', size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  await workbench(page);
  await page.waitForTimeout(700);
  await page.getByRole('region', { name: 'Skills block', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Accept Skills change', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Keep current Career direction', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByText('Approved v2', { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await context.close();
});
