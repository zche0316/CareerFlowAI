import { test, expect } from './classic.js';
test('authentication matches the workspace and offers no demo or sample bypass', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open demo workspace' })).toHaveCount(0);
  await expect(page.getByText('Live AI enabled', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Career paths for every stage')).toBeVisible();
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signIn).toHaveCSS('border-radius', '999px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/auth-brand/sign-in-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Auth Candidate');
  const email = `auth-${Date.now()}@careerflow.test`;
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Auth-candidate-password');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/auth-brand/register-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Build your profile', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Demo test data', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use fictional example' })).toHaveCount(0);
  const sampleResponse = await page.request.get('/api/workspace');
  expect(await sampleResponse.json()).not.toHaveProperty('sampleProfile');
  const demo = await page.request.post('/api/auth/demo', { data: {} });
  expect(demo.ok()).toBe(false);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Auth-candidate-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Build your profile', exact: true }),
  ).toBeVisible();
});
