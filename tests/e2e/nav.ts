import { expect, type Page } from '@playwright/test';

// Quest top-bar navigation. Primary pages are buttons in the Main navigation; the rest sit
// in its More menu.
const primary = ['Home', 'Quests', 'Jobs', 'Scout', 'World', 'Party', 'Character'];

export async function go(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'Main', exact: true });
  // Home carries a "N waiting for you" badge in its accessible name while a run waits.
  if (primary.includes(label))
    return nav.getByRole('button', { name: new RegExp(`^${label}( \\d+ waiting for you)?$`) }).click();
  await nav.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

// The five-step route in a quest's header.
const steps = ['Profile', 'Analysis', 'Shortlist', 'Review', 'Practice'];
export async function step(page: Page, n: 1 | 2 | 3 | 4 | 5) {
  const route = page.getByRole('list', { name: 'Quest route' });
  await expect(route).toBeVisible();
  await route.getByRole('button', { name: steps[n - 1], exact: true }).click();
}

// The profile page a user opens to work on their profile: the builder before the first approval,
// the approved profile afterwards. Read from Home's main action, so route-mocked workspaces work.
export async function openProfile(page: Page) {
  await go(page, 'Home');
  const hero = page.locator('.qh-cta button');
  await expect(hero).toBeVisible();
  if ((await hero.innerText()).includes('Build my profile')) return hero.click();
  await go(page, 'My profile');
}
