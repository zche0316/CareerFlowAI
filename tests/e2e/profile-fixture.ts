import type { Page } from '@playwright/test';
import { sampleProfile } from '../../packages/contracts/src/index.js';
// Tests enter their own data through the real editor; no product demo bypass exists.
export async function fillProfileFixture(page: Page) {
  const summary = page.getByText('Edit profile details manually', { exact: true });
  const opened = await page.locator('details.manual-profile-editor').getAttribute('open');
  if (opened === null) await summary.click();
  await page.getByLabel('Full name', { exact: true }).fill(sampleProfile.name);
  await page.getByLabel('Preferred location', { exact: true }).fill(sampleProfile.location);
  await page
    .getByLabel('Skills · comma separated', { exact: true })
    .fill(sampleProfile.skills.join(', '));
  await page
    .getByLabel('Career interests · comma separated', { exact: true })
    .fill(sampleProfile.interests.join(', '));
  await page.getByLabel('Career goals', { exact: true }).fill(sampleProfile.goals);
  await page.getByLabel('Education or “none yet”', { exact: true }).fill(sampleProfile.education);
  await page
    .getByLabel('Experience and projects or “none yet”', { exact: true })
    .fill(sampleProfile.experience);
  await page
    .getByLabel('Years of experience', { exact: true })
    .fill(String(sampleProfile.experienceYears));
  await page.getByText('Job preferences', { exact: true }).click();
  await page
    .getByLabel('Employment preference', { exact: true })
    .fill(sampleProfile.employmentType);
  await page.getByText('Job preferences', { exact: true }).click();
  if (opened === null) await summary.click();
}
