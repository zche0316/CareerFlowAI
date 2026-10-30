import { test, expect } from '@playwright/test';
import { blankProfile } from '../../packages/contracts/src/index.js';
test('a candidate with no resume or formal work builds a story, selects job content, exports and retains feedback as a draft', async ({
  page,
}) => {
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/profiles/imports')) uploads++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fictional Native QA');
  await page.getByLabel('Email address').fill(`native-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Native-QA-disposable-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Tell us your story' }),
  ).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Resume file', { exact: true })).not.toBeVisible();
  const situation = 'A fictional course dataset contained missing values.';
  const task = 'I was responsible for checking the data quality.';
  const action = 'I used SQL to identify missing values and wrote a report.';
  // Scripted model transport for browser UI; the API suite separately exercises
  // persisted conversation proposals, exact source grounding and atomic application.
  let working: any = structuredClone(blankProfile);
  let thread: any = {
    id: crypto.randomUUID(),
    revision: 1,
    profileVersion: 0,
    messages: [],
    proposals: [],
    workingForm: working,
  };
  await page.route('**/api/profile-threads/**/messages', async (route) => {
    const body = route.request().postDataJSON();
    working = {
      ...body.currentProfile,
      name: 'Fictional Native QA',
      goals: 'Find graduate SQL data analyst opportunities',
      careerStage: 'student',
      location: 'Sydney',
      skills: ['SQL'],
      education: 'Studying software engineering (fictional)',
      experience: 'none yet',
      projects: [
        {
          id: 'fictional-course',
          title: 'Fictional course data project',
          organisation: '',
          location: '',
          startMonth: null,
          endMonth: null,
          current: false,
          details: [situation, task, action],
          technologies: ['SQL'],
          url: '',
          evidence: [],
        },
      ],
    };
    thread = {
      ...thread,
      revision: thread.revision + 1,
      messages: [
        ...thread.messages,
        { id: 'u1', role: 'user', text: body.text },
        {
          id: 'a1',
          role: 'assistant',
          text: 'Your course project is ready to review. Unknown results stay unknown. When did the project start?',
          questions: ['Would you like to add dates?'],
        },
      ],
      proposals: [
        {
          id: 'p1',
          field: 'projects',
          before: [],
          after: working.projects,
          status: 'PENDING',
          evidence: [{ quote: body.text }],
        },
      ],
    };
    await route.fulfill({ json: thread });
  });
  await page.route('**/api/profile-threads/**/proposals', async (route) => {
    const body = route.request().postDataJSON();
    const fields = [
      'name',
      'goals',
      'careerStage',
      'location',
      'skills',
      'education',
      'experience',
      'projects',
    ];
    const data = {
      ...body.currentProfile,
      ...Object.fromEntries(fields.map((k) => [k, working[k]])),
    };
    thread = {
      ...thread,
      revision: thread.revision + 1,
      workingForm: data,
      proposals: thread.proposals.map((p: any) => ({ ...p, status: 'APPLIED_TO_FORM' })),
    };
    await route.fulfill({ json: { thread, data, fields } });
  });
  await page
    .getByLabel('Your next profile message')
    .fill(
      'I am Fictional Native QA, a student targeting graduate SQL data analyst roles in Sydney. I am studying software engineering and have no formal work experience. My Fictional course data project: ' +
        [situation, task, action].join(' ') +
        ' The outcome is not known yet.',
    );
  await page
    .getByLabel(
      'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    )
    .check();
  await page.getByRole('button', { name: 'Send profile message', exact: true }).click();
  await expect(page.getByRole('log')).not.toContainText('When did the project start?');
  await page.getByRole('button', { name: 'Use these details in my draft', exact: true }).click();
  await expect(
    page
      .locator('.profile-draft-side')
      .locator('summary')
      .filter({ hasText: 'Fictional course data project' }),
  ).toHaveCount(1);
  for (const name of ['Career Coach', 'Job Matcher', 'Resume Tailor', 'Interview Coach'])
    await page.getByRole('checkbox', { name, exact: true }).check();
  await page.screenshot({
    path: 'output/chat-first-20261029/profile-conversation.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByText('Approved v1', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Find jobs using this approved profile', exact: true })
    .click();
  await page.getByLabel('Job source', { exact: true }).selectOption('fixtures');
  await page.getByRole('slider').fill('0');
  await page.getByRole('button', { name: 'Start career mission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Your evidence-grounded resume', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByText('Choose and order source statements for this job', { exact: true }).click();
  await page.getByRole('checkbox', { name: /^Include source projects-.*-detail-1$/ }).uncheck();
  await page
    .getByRole('button', { name: 'Save job-specific content selection', exact: true })
    .click();
  await expect(
    page.getByLabel('I reviewed the selected claims', { exact: false }),
  ).not.toBeChecked();
  await page.getByLabel('I reviewed the selected claims', { exact: false }).check();
  await page.getByRole('button', { name: 'Approve & save resume', exact: true }).click();
  await expect(page.getByLabel('Your response', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Your response', { exact: true }).fill(action);
  await page.getByRole('button', { name: 'Save response', exact: true }).click();
  await page.getByRole('button', { name: 'Finish early & get feedback', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Save interview feedback as draft learning memory',
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole('button', { name: 'Save interview feedback as draft learning memory', exact: true })
    .click();
  await page.getByRole('button', { name: 'My documents', exact: true }).click();
  await page.getByLabel('Source claim', { exact: true }).selectOption({ label: action });
  await page
    .getByLabel('I allow the configured model to process this selected approved claim.')
    .check();
  await page.getByRole('button', { name: 'Suggest source-grounded wording', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Accept reviewed wording', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Accept reviewed wording', exact: true }).click();
  await page
    .getByLabel('I reviewed the accepted wording and want a separate approved resume edition.')
    .check();
  await page.getByRole('button', { name: 'Save reviewed wording edition', exact: true }).click();
  const pdf = page.getByRole('link', { name: 'Download reviewed PDF', exact: true });
  await expect(pdf).toBeVisible();
  const response = await page.request.get((await pdf.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 4).toString()).toBe('%PDF');
  expect(uploads).toBe(0);
  await page.screenshot({ path: 'output/chat-first-20261029/native-edition.png', fullPage: true });
});
