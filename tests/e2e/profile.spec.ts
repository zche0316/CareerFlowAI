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
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
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

test('a new profile starts with no invented background or sharing permissions', async ({
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
  for (const name of ['Career Coach', 'Job Matcher', 'Resume Tailor', 'Interview Coach']) {
    await expect(page.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
  }
});

test('an unchanged AI request fills an editable form and shows questions and evidence without saving', async ({
  page,
}) => {
  const notes = 'My name is Casey. I use Python and want a data analyst role in Sydney.';
  const followUp = 'What education would you like to add, or should we record none yet?';
  let prepareCount = 0;
  let persistenceCount = 0;
  await page.route('**/api/profiles/prepare', async (route) => {
    prepareCount += 1;
    expect(route.request().postDataJSON().notes).toBe(notes);
    await route.fulfill({
      json: {
        data: {
          ...sampleProfile,
          name: 'Casey',
          goals: 'Find a data analyst role in Sydney.',
          skills: ['Python'],
          interests: [],
          education: '',
          experience: '',
          sharing: { coach: false, matching: false, resume: false, interview: false },
        },
        followUpQuestions: [followUp],
        proposedChanges: [{ field: 'name', proposedValue: 'Casey', evidence: 'My name is Casey.' }],
        discardedFields: ['experience'],
      },
    });
  });
  await page.route('**/api/profiles/drafts**', async (route) => {
    persistenceCount += 1;
    await route.fulfill({ status: 500, json: { error: 'Unexpected profile save request.' } });
  });
  await openProfile(page);
  await page.getByLabel('Notes for Profile Builder').fill(notes);
  await page.getByRole('button', { name: 'Organise with Profile Builder' }).click();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Casey');
  await expect(page.getByLabel('Full name', { exact: true })).toBeEditable();
  await expect(page.getByLabel('Skills · comma separated', { exact: true })).toHaveValue('Python');
  await expect(page.getByRole('textbox', { name: 'Career goals', exact: true })).toHaveValue(
    'Find a data analyst role in Sydney.',
  );
  await expect(page.getByText(followUp, { exact: true })).toBeVisible();
  await page.getByText('Review Profile Builder proposed changes', { exact: true }).click();
  await expect(page.getByText('Evidence: “My name is Casey.”', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Unsupported suggestions were discarded for: experience/),
  ).toBeVisible();
  await expect(page.getByText('Not approved yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
  expect(prepareCount).toBe(1);
  expect(persistenceCount).toBe(0);
  await page.screenshot({
    path: 'output/acceptance/cfs-56-builder-supported-draft.png',
    fullPage: true,
  });
});

test('late AI results cannot replace manual edits or start a conflicting review', async ({
  page,
}) => {
  const request = holdRequest();
  await page.route('**/api/profiles/prepare', async (route) => {
    request.arrived();
    await request.released;
    await route.fulfill({
      json: {
        data: { ...sampleProfile, name: 'Old AI draft' },
        followUpQuestions: ['Old follow-up that should be ignored?'],
        proposedChanges: [],
        discardedFields: [],
      },
    });
  });
  await openProfile(page);
  await page.getByLabel('Notes for Profile Builder').fill('I use Python and want a data role.');
  await page.getByRole('button', { name: 'Organise with Profile Builder' }).click();
  await request.started;
  await expect(page.getByRole('button', { name: 'Review profile draft' })).toBeDisabled();
  await page.getByLabel('Full name', { exact: true }).fill('My newer manual name');
  request.release();
  await expect(page.getByRole('button', { name: 'Organise with Profile Builder' })).toBeEnabled();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('My newer manual name');
  await expect(page.getByText('Old follow-up that should be ignored?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
  await page.screenshot({
    path: 'output/acceptance/cfs-56-late-ai-edit-preserved.png',
    fullPage: true,
  });
});

test('changing builder notes invalidates the in-flight suggestion', async ({ page }) => {
  const request = holdRequest();
  await page.route('**/api/profiles/prepare', async (route) => {
    request.arrived();
    await request.released;
    await route.fulfill({
      json: {
        data: { ...sampleProfile, name: 'Outdated notes result' },
        followUpQuestions: [],
        proposedChanges: [],
        discardedFields: [],
      },
    });
  });
  await openProfile(page);
  await page.getByLabel('Notes for Profile Builder').fill('My first notes mention Python.');
  await page.getByRole('button', { name: 'Organise with Profile Builder' }).click();
  await request.started;
  await page.getByLabel('Notes for Profile Builder').fill('My updated notes mention SQL instead.');
  request.release();
  await expect(page.getByRole('button', { name: 'Organise with Profile Builder' })).toBeEnabled();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Notes for Profile Builder')).toHaveValue(
    'My updated notes mention SQL instead.',
  );
});

test('a prepared draft from older inputs cannot be approved after a manual edit', async ({
  page,
}) => {
  const request = holdRequest();
  await page.route('**/api/profiles/drafts', async (route) => {
    request.arrived();
    await request.released;
    await draftResponse(route);
  });
  await openProfile(page);
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByLabel('Notes for Profile Builder').fill('Additional background to review later.');
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await request.started;
  await expect(page.getByRole('button', { name: 'Organise with Profile Builder' })).toBeDisabled();
  await page.getByLabel('Full name', { exact: true }).fill('Changed while preparing');
  request.release();
  await expect(page.getByRole('button', { name: 'Review profile draft' })).toBeEnabled();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(
    'Changed while preparing',
  );
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toHaveCount(0);
});

test('navigation makes an old AI response irrelevant to the new editing session', async ({
  page,
}) => {
  const request = holdRequest();
  await page.route('**/api/profiles/prepare', async (route) => {
    request.arrived();
    await request.released;
    await route.fulfill({
      json: {
        data: { ...sampleProfile, name: 'Previous session result' },
        followUpQuestions: [],
        proposedChanges: [],
        discardedFields: [],
      },
    });
  });
  await openProfile(page);
  await page
    .getByLabel('Notes for Profile Builder')
    .fill('I want a data analyst job using Python.');
  await page.getByRole('button', { name: 'Organise with Profile Builder' }).click();
  await request.started;
  await page.getByRole('button', { name: 'Career missions', exact: true }).click();
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('New editing session');
  request.release();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('New editing session');
  await expect(page.getByLabel('Notes for Profile Builder')).toHaveValue('');
});

test('a newly approved version invalidates an older AI response', async ({ page }) => {
  let approved: unknown = null;
  const request = holdRequest();
  await page.route('**/api/profiles/prepare', async (route) => {
    request.arrived();
    await request.released;
    await route.fulfill({
      json: {
        data: { ...sampleProfile, name: 'Old profile suggestion' },
        followUpQuestions: [],
        proposedChanges: [],
        discardedFields: [],
      },
    });
  });
  await openProfile(page, () => approved);
  await page
    .getByLabel('Notes for Profile Builder')
    .fill('I have a newer career goal to organise.');
  await page.getByRole('button', { name: 'Organise with Profile Builder' }).click();
  await request.started;
  approved = {
    id: 'new-approved-version',
    version: 2,
    data: { ...sampleProfile, name: 'New approved profile' },
  };
  await expect(page.getByText('Approved v2', { exact: true })).toBeVisible({ timeout: 7000 });
  const response = page.waitForResponse((r) => r.url().endsWith('/api/profiles/prepare'));
  request.release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('New approved profile');
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

test('AI failure preserves manual input and allows manual draft preparation', async ({ page }) => {
  await page.route('**/api/profiles/prepare', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'Profile Builder is unavailable. Continue manually or retry.' },
    }),
  );
  await page.route('**/api/profiles/drafts', draftResponse);
  await openProfile(page);
  await page.getByRole('button', { name: 'Use fictional example' }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Manual fallback QA');
  await page
    .getByLabel('Notes for Profile Builder')
    .fill('My existing form has the information I want to keep.');
  await page.getByRole('button', { name: 'Organise with Profile Builder' }).click();
  await expect(
    page.getByText('Profile Builder is unavailable. Continue manually or retry.'),
  ).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Manual fallback QA');
  await expect(page.getByLabel('Skills · comma separated', { exact: true })).toHaveValue(
    'Python, SQL, Git, Excel',
  );
  await page.getByRole('button', { name: 'Review profile draft' }).click();
  await expect(
    page.getByRole('heading', { name: 'Manual fallback QA', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & save profile' })).toBeDisabled();
  await page.screenshot({ path: 'output/acceptance/cfs-56-manual-fallback.png', fullPage: true });
});
