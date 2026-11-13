import { test, expect } from '@playwright/test';
import { go } from './nav.js';
import { blankProfile } from '../../packages/contracts/src/index.js';
test('a candidate with no resume or formal work builds a story, selects job content, exports and reviews saved feedback', async ({
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
  await expect(page.getByRole('heading', { name: 'Build your profile' })).toBeVisible();
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
    page.getByRole('region', { name: 'Projects & other experience block', exact: true }),
  ).toContainText('Fictional course data project');
  await page.screenshot({
    path: 'output/chat-first-20261029/profile-conversation.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send the party out', exact: true })).toBeVisible();
  await page.getByLabel('Demo roles').check();
  await page.getByRole('slider').fill('0');
  await page.getByRole('button', { name: 'Send the party out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this opportunity' }).first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();
  // CFS-123: the role requires a skill this profile has no evidence for, so the team asks once.
  const question = page.getByRole('region', { name: 'Have you used these?' });
  await expect(question).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText('Your resume team has a question about skills the role requires.'),
  ).toBeVisible();
  const continueButton = question.getByRole('button', { name: 'Continue with my answers' });
  await expect(continueButton).toBeDisabled();
  await question
    .getByRole('textbox')
    .first()
    .fill('I used it in the fictional course data project to check the data quality.');
  // The first option after "Not in my profile" is the course project.
  await question.getByRole('combobox').first().selectOption({ index: 1 });
  await question.getByRole('checkbox').first().check();
  await page.screenshot({ path: 'output/agent-native/evidence-question.png', fullPage: true });
  await continueButton.click();
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible({ timeout: 45000 });
  await page.getByText('Edit it yourself', { exact: true }).click();
  await page.getByRole('button', { name: 'Refine wording', exact: true }).click();
  await expect(page.getByRole('log')).toContainText(
    /Review the preview before saving\.|No wording changes needed\. The visible resume is unchanged\./,
  );
  await expect(page.getByLabel('I read this exact draft.')).not.toBeChecked();
  await page.getByLabel('I read this exact draft.').check();
  await page.getByRole('button', { name: 'Approve this draft', exact: true }).click();
  await expect(page.getByLabel('Your answer', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Your answer', { exact: true }).fill(action);
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByRole('button', { name: 'Retreat · get feedback now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Strengths', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole('button', {
      name: 'Save interview feedback as draft learning memory',
      exact: true,
    }),
  ).toHaveCount(0);
  // Delay the initial list until a new suggestion has already been saved.
  let releaseInitial!: () => void;
  let initialSeen!: () => void;
  let initialReturned!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    initialSeen = resolve;
  });
  const returned = new Promise<void>((resolve) => {
    initialReturned = resolve;
  });
  let initial = true;
  await page.route('**/api/resumes/*/wording', async (route) => {
    if (route.request().method() === 'GET' && initial) {
      initial = false;
      initialSeen();
      await gate;
      await route.fulfill({ json: [] });
      initialReturned();
    } else await route.continue();
  });
  await go(page, 'My documents');
  await page.getByRole('button', { name: 'Polish wording', exact: true }).first().click();
  await seen;
  // The resume team's Rewriter already dropped the leading "I"; this bullet still has a filler lead-in.
  await page
    .getByLabel('Resume bullet', { exact: true })
    .selectOption({ label: 'Was responsible for checking the data quality.' });
  await page.getByLabel('Use AI to suggest a factual rewrite of this bullet.').check();
  await page.getByRole('button', { name: 'Suggest rewrite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use this wording', exact: true })).toBeVisible();
  releaseInitial();
  await returned;
  await expect(page.getByRole('button', { name: 'Use this wording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this wording', exact: true }).click();
  await page.getByLabel('I reviewed the accepted wording.').check();
  await page.getByRole('button', { name: 'Create revised resume version', exact: true }).click();
  await page.locator('.download-formats summary').click();
  const pdf = page
    .locator('.wording-saved')
    .getByRole('link', { name: 'Download PDF', exact: true });
  await expect(pdf).toBeVisible();
  const response = await page.request.get((await pdf.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 4).toString()).toBe('%PDF');
  expect(uploads).toBe(0);
  await page.screenshot({ path: 'output/chat-first-20261029/native-edition.png', fullPage: true });
});
