import { test, expect } from '@playwright/test';

test('prototype navigation keeps profile, memory and existing tools reachable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Navigation QA');
  await page.getByLabel('Email address').fill(`navigation-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Build your profile', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stories & notes', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Career memory and STAR library', exact: true }),
  ).toBeVisible();
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Optional tools', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Application tools' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Record target status', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Cover letter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cover letter', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
