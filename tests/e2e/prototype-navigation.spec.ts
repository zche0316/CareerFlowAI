import { test, expect } from '@playwright/test';
import { go } from './nav.js';

test('prototype navigation keeps profile and memory reachable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Navigation QA');
  await page.getByLabel('Email address').fill(`navigation-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Build your profile', exact: true }),
  ).toBeVisible();
  await go(page, 'My profile');
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stories & notes', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Career memory and STAR library', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
