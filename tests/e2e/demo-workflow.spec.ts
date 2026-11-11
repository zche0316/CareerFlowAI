import { test, expect, type Page } from '@playwright/test';
import { fillProfileFixture } from './profile-fixture.js';
import { go } from './nav.js';

// The local demo route from docs/LOCAL_DEMO.md, driven only through the Quest interface on the
// fixture-mode server: no route mocks and no API shortcuts.

const noSidewaysScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test('the demo workflow runs end to end in the Quest interface', async ({ page }) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // 1. Sign in (a fresh account).
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Demo Candidate');
  await page.getByLabel('Email address').fill(`demo-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Demo-QA-disposable-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();

  // 2. Build and approve the profile.
  await expect(page.getByRole('heading', { name: 'Build your profile' })).toBeVisible();
  await fillProfileFixture(page);
  await page.getByRole('button', { name: 'Review profile draft', exact: true }).click();
  await page.getByLabel('I reviewed this exact draft').check();
  await page.getByRole('button', { name: 'Approve & save profile', exact: true }).click();

  // 3. Start a quest (the form opens after approval).
  await expect(page.getByRole('heading', { name: 'What’s your next career goal?' })).toBeVisible();
  await page.getByLabel('Demo roles').check();
  await page.getByRole('button', { name: 'Send the party out', exact: true }).click();

  // 4. Choose one role from the shortlist.
  await expect(
    page.getByRole('heading', { name: 'Pick the job your party should chase.' }),
  ).toBeVisible({ timeout: 45000 });
  const roles = page.locator('button.qj-role');
  expect(await roles.count()).toBeGreaterThan(1);
  // Save a second role to the quest log for later; the run keeps waiting for a choice.
  await roles.nth(1).click();
  const saved = await page.locator('article.job-card h3').first().innerText();
  await page.getByRole('button', { name: 'Save to my quests for later' }).click();
  await expect(page.getByText('Saved to your quests.', { exact: false })).toBeVisible();
  await roles.first().click();
  const title = await page.locator('article.job-card h3').first().innerText();
  await page.getByRole('button', { name: 'Select this opportunity' }).first().click();

  // 5. Resume team stops at the draft review.
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.qm-crumb')).toContainText(title);
  const approve = page.getByRole('button', { name: 'Approve this draft', exact: true });
  await expect(approve).toBeDisabled();

  // 6. Return once with a comment, then approve the revised draft.
  await page.locator('label.quest-pick', { hasText: 'Rewriter' }).click();
  await page.getByLabel('What should change?').fill('Keep the wording closer to the facts.');
  await page.getByRole('button', { name: 'Send back · 2 left', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send back · 1 left', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.getByLabel('I read this exact draft.').check();
  await approve.click();

  // 7. Interview practice: one answer, finish early, read the feedback.
  await expect(page.getByRole('heading', { name: 'Face the interview panel.' })).toBeVisible({
    timeout: 45000,
  });
  await page
    .getByLabel('Your answer', { exact: true })
    .fill('I used SQL in a student project to clean a sample dataset and report what changed.');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByRole('button', { name: 'Retreat · get feedback now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Battle over', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByRole('heading', { name: 'Areas to improve' })).toBeVisible({
    timeout: 45000,
  });

  // The battle log shows what each agent did.
  await page.getByRole('button', { name: /^Battle log · \d+ events$/ }).click();
  await expect(page.getByRole('region', { name: 'Model calls' })).toBeVisible();

  // 8. Export the approved resume.
  await go(page, 'My documents');
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeVisible();
  await page.locator('.download-formats summary').first().click();
  const pdf = page.getByRole('link', { name: 'Download PDF', exact: true }).first();
  await expect(pdf).toBeVisible();
  expect((await page.request.get((await pdf.getAttribute('href'))!)).status()).toBe(200);
  await expect(
    page.getByRole('link', { name: 'Download DOCX', exact: true }).first(),
  ).toBeVisible();

  // 9. Record the application status (applying itself stays manual).
  await go(page, 'Optional tools');
  await expect(page.getByRole('heading', { name: 'Application progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Record target status', exact: true }).click();
  await expect(page.getByText(`${title} · applied`, { exact: true })).toBeVisible();

  // 10. Scout: a sweep reads the demo roles and skips the ones the quest already saw. Packages
  // start only for new roles above the minimum match; the Scout spec covers that path.
  await go(page, 'Scout');
  await page.getByRole('button', { name: 'Send Scout out now', exact: true }).click();
  await expect(page.getByText(/8 fetched · \d+ new · [1-9]\d* seen before/)).toBeVisible({
    timeout: 60000,
  });

  // The Quest log lists both roles: the chosen one as applied, the saved one ready to tailor.
  await go(page, 'Quests');
  await expect(page.locator('section.qa-group.applied')).toContainText(title);
  const later = page.locator('li.qa-card', { hasText: saved });
  await expect(later.locator('.quest-chip')).toHaveText('Saved');
  await expect(page.locator('section.ql-group.ended')).toContainText(title);

  // A saved role starts its own run at the resume team with the role already chosen.
  await later.getByRole('button', { name: 'Tailor resume' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your party built a draft. Now it’s your call.' }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.qm-crumb')).toContainText(saved);

  // The Coach on Home keeps advice for this profile version, outside any one run.
  await go(page, 'Home');
  const coach = page.getByRole('region', { name: 'Coach' });
  await expect(coach.getByRole('heading', { name: 'Next steps' })).toBeVisible();
  await coach.getByRole('button', { name: 'Refresh advice' }).click();
  await expect(coach.getByText('Strength', { exact: true })).toBeVisible();

  // Nothing overflows at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ['Home', 'Quests', 'Scout']) {
    await go(page, label);
    expect(await noSidewaysScroll(page), label).toBe(true);
  }
  expect(errors).toEqual([]);
});
