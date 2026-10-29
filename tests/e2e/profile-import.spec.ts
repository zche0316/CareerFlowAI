import { test, expect } from '@playwright/test';
import { AGENTS, sampleProfile } from '../../packages/contracts/src/index.js';
// Controlled transport verifies view state independently of PDF parsing/model quality.
test('new imports clear previous pages and consent; organization uses explicitly selected source pages', async ({
  page,
}) => {
  let current: any = null,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const make = (id: string, filename: string, lengths: number[]) => ({
    id,
    filename,
    status: 'EXTRACTED',
    pages: lengths.map((n, i) => ({
      page: i + 1,
      text: 'x'.repeat(n),
      method: 'pdf-text',
      route: 'text',
    })),
    proposed: { records: [], questions: [], rejected: [] },
    calls: 0,
    events: [],
    router: { lightModel: 'test-text', visionModel: 'test-vision' },
    mode: 'openai',
  });
  await page.route('**/api/session', (r) =>
    r.fulfill({
      json: {
        user: { id: 'import-ui-qa', name: 'Import QA' },
        csrf: 'test-token',
        mode: 'fixture',
      },
    }),
  );
  await page.route('**/api/workspace', (r) =>
    r.fulfill({
      json: { profile: null, sampleProfile, missions: [], resumes: [], agents: AGENTS },
    }),
  );
  await page.route('**/api/profile-threads', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/career-memories', (r) =>
    r.fulfill({ json: { memories: [], records: [], missions: [] } }),
  );
  await page.route('**/api/profiles/imports', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: current ? [current] : [] });
    const input = r.request().postDataJSON();
    if (input.filename === 'single.txt') {
      await gate;
      current = make('new-source', input.filename, [100]);
    } else current = make('old-source', input.filename, [9000, 7001, 100, 100]);
    await r.fulfill({ json: current });
  });
  await page.route('**/api/profiles/imports/old-source/structure', async (r) => {
    expect(r.request().postDataJSON().pages).toEqual([3, 4]);
    current.proposed.repairs = [
      { title: 'Supported record', fields: [{ field: 'location', value: 'Unverified City' }] },
    ];
    await r.fulfill({ json: current });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'My career profile', exact: true }).click();
  await page.getByText('Edit profile details manually', { exact: true }).click();
  await page
    .getByText('Already have career material? Optional resume import', { exact: true })
    .click();
  await page.getByLabel('Resume file', { exact: true }).setInputFiles({
    name: 'bilingual.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('controlled fixture'),
  });
  await expect(page.getByText('Current file: 4 page(s).', { exact: false })).toBeVisible();
  await expect(
    page.getByLabel('Include page 1 in record organization', { exact: false }),
  ).toBeChecked();
  await expect(
    page.getByLabel('Include page 2 in record organization', { exact: false }),
  ).not.toBeChecked();
  await page.getByLabel('Include page 1 in record organization', { exact: false }).uncheck();
  await page.getByLabel('Include page 3 in record organization', { exact: false }).check();
  await page.getByLabel('Include page 4 in record organization', { exact: false }).check();
  await page
    .getByLabel('I allow the selected page images or extracted resume text', { exact: false })
    .check();
  await page
    .getByRole('button', { name: 'Organize extracted text into records', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Organize extracted text into records', exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Resume file', { exact: true })
    .setInputFiles({ name: 'single.txt', mimeType: 'text/plain', buffer: Buffer.from('New file') });
  await expect(page.getByRole('heading', { name: /bilingual.pdf/ })).toHaveCount(0);
  await expect(page.getByText('Current file: 4 page(s).', { exact: false })).toHaveCount(0);
  release();
  await expect(page.getByText('Current file: 1 page(s).', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Recognize page 2', { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel('I allow the selected page images or extracted resume text', { exact: false }),
  ).not.toBeChecked();
});
