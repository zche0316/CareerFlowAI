import { test, expect } from '@playwright/test';

test('prototype navigation keeps profile, memory and existing tools reachable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Navigation QA');
  await page.getByLabel('Email address').fill(`navigation-${Date.now()}@careerflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('Browser-QA-password');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build your profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Career memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your memories', exact: true })).toBeVisible();
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Optional tools', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next steps, organised.' })).toBeVisible();
  await page.getByRole('button', { name: 'Open 03 · Job matching', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job matching', exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
