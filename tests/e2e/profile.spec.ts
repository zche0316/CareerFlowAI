import { test, expect, type Page, type Route } from '@playwright/test';
import { AGENTS, sampleProfile } from '../../packages/contracts/src/index.js';

// These browser checks inject API timing/failures deliberately. The database
// integration suite separately exercises the real profile API and persistence.
async function openProfile(page: Page, approvedProfile: () => unknown = () => null) {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        user: { id: 'profile-ui-qa', name: 'Profile QA', email: 'profile-ui@careerflow.test' },
        csrf: 'profile-ui-test-token',
        mode: 'fixture',
      },
    }),
  );
  await page.route('**/api/workspace', (route) =>
    route.fulfill({
      json: {
        profile: approvedProfile(),
        missions: [],
        resumes: [],
        sampleProfile,
        agents: AGENTS,
        mode: 'fixture',
      },
    }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Build profile', exact: true })
    .or(page.getByRole('button', { name: 'My profile', exact: true }))
    .first()
    .click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toBeVisible();
}

function holdRequest() {
  let arrived!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (arrived = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  return { arrived, started, released, release };
}

async function draftResponse(route: Route) {
  const data = route.request().postDataJSON();
  await route.fulfill({
    json: {
      id: 'profile-ui-draft',
      data,
      facts: [{ id: 'goal-1', kind: 'goal', text: data.goals, source: 'User input' }],
    },
  });
}

test('a new profile starts with no invented background and automatic career-team access', async ({
  page,
}) => {
  await openProfile(page);
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Preferred location', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Employment preference', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Education or “none yet”', { exact: true })).toHaveValue('');
  await expect(
    page.getByLabel('Experience and projects or “none yet”', { exact: true }),
  ).toHaveValue('');
  await expect(
    page.getByText('Your career team uses approved profile facts when you start a mission.', {
      exact: false,
    }),
  ).toBeVisible();
});

test('a pending save locks the reviewed form and a failed save keeps it available', async ({
  page,
}) => {
  const request = holdRequest();
  await page.route('**/api/profiles/drafts', draftResponse);
  await page.route('**/api/profiles/drafts/profile-ui-draft/approve', async (route) => {
    request.arrived();
    await request.released;
    await route.fulfill({ status: 500, json: { error: 'Injected save failure' } });
  });
  await openProfile(page);
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  const reviewed = page.getByLabel('I reviewed this exact draft');
  await reviewed.check();
  await page.getByRole('button', { name: 'Approve & save profile' }).click();
  await request.started;
  await expect(page.getByLabel('Full name', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard draft', exact: true })).toBeDisabled();
  request.release();
  await expect(page.getByText('Injected save failure', { exact: true })).toBeVisible();
  await expect(reviewed).toBeChecked();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toBeEnabled();
  await expect(page.getByLabel('Full name', { exact: true })).toBeEnabled();
  await page.screenshot({
    path: 'output/acceptance/cfs-13-failed-save-retains-review.png',
    fullPage: true,
  });
});

test('failed discard keeps the exact reviewed draft available for retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/profiles/drafts', draftResponse);
  await page.route('**/api/profiles/drafts/profile-ui-draft', async (route) => {
    attempts += 1;
    await route.fulfill({
      status: attempts === 1 ? 500 : 200,
      json: attempts === 1 ? { error: 'Injected discard failure' } : { discarded: true },
    });
  });
  await openProfile(page);
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  const reviewed = page.getByLabel('I reviewed this exact draft');
  await reviewed.check();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(
    page.getByText('The draft could not be discarded. It is still available; try again.'),
  ).toBeVisible();
  await expect(reviewed).toBeChecked();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toBeEnabled();
  await page.screenshot({
    path: 'output/acceptance/cfs-12-failed-discard-retains-draft.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('field errors can be corrected and changed drafts require fresh review', async ({ page }) => {
  await page.route('**/api/profiles/drafts', async (route) => {
    const data = route.request().postDataJSON();
    if (data.endDate < data.startDate) {
      await route.fulfill({
        status: 400,
        json: {
          error: 'Please correct the highlighted fields.',
          fields: { endDate: ['End date must not precede start date.'] },
        },
      });
    } else {
      await draftResponse(route);
    }
  });
  await openProfile(page);
  await page.getByText('Demo test data', { exact: true }).click();
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByLabel('Experience start date (optional)', { exact: true }).fill('2026-02-02');
  await page.getByLabel('Experience end date (optional)', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await expect(page.getByText('End date must not precede start date.')).toBeVisible();
  const endDate = page.getByLabel('Experience end date (optional)', { exact: true });
  await expect(endDate).toHaveAttribute('aria-invalid', 'true');
  await expect(endDate).toHaveAccessibleDescription('End date must not precede start date.');
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
  await endDate.fill('2026-03-03');
  await expect(endDate).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByText('End date must not precede start date.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toBeDisabled();
  await page.getByLabel('I reviewed this exact draft').check();
  await page
    .getByRole('textbox', { name: 'Career goals', exact: true })
    .fill('A new goal needs a fresh review.');
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await expect(page.getByLabel('I reviewed this exact draft')).not.toBeChecked();
  await page.screenshot({
    path: 'output/acceptance/cfs-12-correction-review-gate.png',
    fullPage: true,
  });
});

test('a delayed chat update cannot overwrite a manual edit or approve the profile', async ({
  page,
}) => {
  const request = holdRequest();
  const form = structuredClone(sampleProfile);
  form.name = '';
  const thread = {
    id: 'chat-ui',
    revision: 2,
    profileVersion: 0,
    workingForm: form,
    messages: [{ id: 'assistant', role: 'assistant', text: 'Review your name.' }],
    proposals: [
      {
        id: 'name',
        field: 'name',
        before: '',
        after: 'Suggested name',
        evidence: [{ quote: 'Suggested name' }],
        status: 'PENDING',
      },
    ],
  };
  await page.route('**/api/profile-threads', (r) =>
    r.fulfill({ json: [{ id: 'chat-ui', title: 'Test' }] }),
  );
  await page.route('**/api/profile-threads/chat-ui', (r) => r.fulfill({ json: thread }));
  await page.route('**/api/profile-threads/chat-ui/proposals', async (r) => {
    request.arrived();
    await request.released;
    await r.fulfill({
      json: {
        fields: ['name'],
        data: { ...form, name: 'Suggested name' },
        thread: { ...thread, revision: 3, proposals: [] },
      },
    });
  });
  await openProfile(page);
  await page.getByRole('button', { name: 'Use these details in my draft', exact: true }).click();
  await request.started;
  await page.getByLabel('Full name', { exact: true }).fill('My manual name');
  request.release();
  await expect(
    page
      .getByRole('region', { name: 'Persistent Profile Builder', exact: true })
      .getByRole('alert'),
  ).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('My manual name');
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
});

test('a failed conversation keeps manual details and manual review available', async ({ page }) => {
  const thread = {
    id: 'failed-chat',
    revision: 1,
    profileVersion: 0,
    workingForm: {},
    proposals: [],
    messages: [],
  };
  await page.route('**/api/profile-threads', (r) =>
    r.fulfill({ json: r.request().method() === 'POST' ? thread : [] }),
  );
  await page.route('**/api/profile-threads/failed-chat/messages', (r) =>
    r.fulfill({
      json: {
        ...thread,
        revision: 2,
        messages: [
          {
            id: 'failure',
            role: 'assistant',
            text: 'Model processing failed. Your message is saved.',
            failed: true,
          },
        ],
      },
    }),
  );
  await page.route('**/api/profiles/drafts', draftResponse);
  await openProfile(page);
  await page.getByLabel('Full name', { exact: true }).fill('Manual candidate');
  await page.getByLabel('Your next profile message').fill('I would like to explore analyst roles.');
  await page
    .getByLabel(
      'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    )
    .check();
  await page.getByRole('button', { name: 'Send profile message', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Model processing failed.');
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Manual candidate');
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toBeDisabled();
});

test('a finished legacy conversation can prepare missing saved details without another interview or automatic approval', async ({
  page,
}) => {
  const record = {
    id: 'legacy-project',
    title: 'Legacy Data Project',
    organisation: '',
    location: '',
    startMonth: null,
    endMonth: null,
    current: false,
    details: ['I used SQL.'],
    technologies: ['SQL'],
    url: '',
    evidence: [],
  };
  let t: any = {
    id: 'legacy-recovery',
    revision: 1,
    profileVersion: 0,
    workingForm: sampleProfile,
    proposals: [],
    messages: [{ id: 'legacy-user', role: 'user', text: 'My Legacy Data Project used SQL.' }],
    interview: {
      phase: 'review',
      active: null,
      closed: ['projects:legacy data project:'],
      addressed: [],
      question: null,
    },
    hasUnfiledExperience: true,
    interviewRecords: [],
  };
  await page.route('**/api/profile-threads', (r) =>
    r.fulfill({ json: [{ id: t.id, title: 'Legacy conversation' }] }),
  );
  await page.route('**/api/profile-threads/legacy-recovery', (r) => r.fulfill({ json: t }));
  await page.route('**/api/profile-threads/legacy-recovery/messages', async (r) => {
    expect(r.request().postDataJSON().recoverSavedAnswers).toBe(true);
    t = {
      ...t,
      revision: 2,
      hasUnfiledExperience: false,
      proposals: [
        {
          id: 'p',
          field: 'projects',
          after: [record],
          status: 'PENDING',
          evidence: [{ quote: 'My Legacy Data Project used SQL.' }],
        },
      ],
    };
    await r.fulfill({ json: t });
  });
  await page.route('**/api/profile-threads/legacy-recovery/proposals', (r) => {
    t = { ...t, revision: 3, proposals: [] };
    return r.fulfill({
      json: { thread: t, data: { ...sampleProfile, projects: [record] }, fields: ['projects'] },
    });
  });
  await openProfile(page);
  await expect(page.getByLabel('Your next profile message')).not.toBeVisible();
  await page
    .getByLabel(
      'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    )
    .check();
  await page
    .getByRole('button', { name: 'Prepare missing experience from saved answers', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Review profile draft now', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Use these details in my draft', exact: true }).click();
  await expect(page.getByLabel('Projects 1 title')).toHaveValue('Legacy Data Project');
  await expect(
    page.getByRole('button', { name: 'Review profile draft now', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
});

test('saved-answer preparation with no proposals reports no changes instead of silently returning to review', async ({
  page,
}) => {
  const t: any = {
    id: 'empty-recovery',
    revision: 1,
    profileVersion: 0,
    workingForm: sampleProfile,
    proposals: [],
    messages: [],
    interview: {
      phase: 'review',
      active: null,
      closed: ['projects:legacy:'],
      addressed: [],
      question: null,
    },
    hasUnfiledExperience: true,
    interviewRecords: [],
  };
  await page.route('**/api/profile-threads', (r) =>
    r.fulfill({ json: [{ id: t.id, title: 'Empty preparation' }] }),
  );
  await page.route('**/api/profile-threads/empty-recovery', (r) => r.fulfill({ json: t }));
  await page.route('**/api/profile-threads/empty-recovery/messages', (r) =>
    r.fulfill({
      json: {
        ...t,
        revision: 2,
        messages: [
          {
            id: 'result',
            role: 'assistant',
            text: 'No source-supported draft updates were prepared. Your draft is unchanged.',
            preparation: {
              status: 'no_changes',
              modelRecords: 0,
              acceptedRecords: 0,
              changes: 0,
              rejectedRecords: [],
            },
          },
        ],
      },
    }),
  );
  await openProfile(page);
  await page
    .getByLabel(
      'I allow the configured model to process this conversation, working form and retrieved confirmed evidence.',
    )
    .check();
  await page
    .getByRole('button', { name: 'Prepare missing experience from saved answers', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Persistent Profile Builder', exact: true })
      .getByRole('alert'),
  ).toContainText('No source-supported suggestions');
  await expect(
    page.getByRole('status').filter({ hasText: 'No draft updates were prepared' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use these details in my draft', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Preparation details', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Review current draft without this experience', exact: true }),
  ).toBeVisible();
});
